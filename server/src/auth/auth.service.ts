import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { compare, hash } from 'bcryptjs';
import { PrismaService } from '../prisma.service';
import { creditPresenceDays } from './presence-policy';
import { LoginRequestContext, recordLoginAttempt } from '../history/login-audit';

type PlatformPhoneRow = { platformAccountId: string };

const PROFESSIONAL_EMAIL_LOGIN_CUTOFF = new Date('2026-10-30T12:24:17.000Z');

function canonicalPhone(value: unknown) {
  const digits = String(value ?? '').replace(/\D/g, '');
  if (digits.length === 10) return `7${digits}`;
  if (digits.length === 11 && digits.startsWith('8')) return `7${digits.slice(1)}`;
  return digits;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  private async accountByIdentifier(value: string) {
    const raw = String(value || '').trim();
    const normalizedEmail = raw.toLowerCase();
    if (normalizedEmail.includes('@')) {
      const account = await this.prisma.platformAccount.findUnique({
        where: { email: normalizedEmail },
        include: { memberships: { include: { tenant: true } }, platformAdmin: true },
      });
      if (!account) return null;
      if (account.platformAdmin) return account;
      return account.createdAt < PROFESSIONAL_EMAIL_LOGIN_CUTOFF ? account : null;
    }

    const normalizedPhone = canonicalPhone(raw);
    if (normalizedPhone.length < 10 || normalizedPhone.length > 15) return null;

    const rows = await this.prisma.$queryRaw<PlatformPhoneRow[]>`
      SELECT DISTINCT "platformAccountId"
      FROM "Profile"
      WHERE (
        CASE
          WHEN LENGTH(REGEXP_REPLACE("phone", '[^0-9]', '', 'g')) = 10
            THEN '7' || REGEXP_REPLACE("phone", '[^0-9]', '', 'g')
          WHEN LENGTH(REGEXP_REPLACE("phone", '[^0-9]', '', 'g')) = 11
            AND LEFT(REGEXP_REPLACE("phone", '[^0-9]', '', 'g'), 1) = '8'
            THEN '7' || SUBSTRING(REGEXP_REPLACE("phone", '[^0-9]', '', 'g') FROM 2)
          ELSE REGEXP_REPLACE("phone", '[^0-9]', '', 'g')
        END
      ) = ${normalizedPhone}
      LIMIT 2
    `;
    if (rows.length !== 1) return null;

    return this.prisma.platformAccount.findUnique({
      where: { id: rows[0].platformAccountId },
      include: { memberships: { include: { tenant: true } } },
    });
  }

  async login(identifier: string, password: string, context?: LoginRequestContext) {
    const account = await this.accountByIdentifier(identifier);
    if (!account || !(await compare(String(password || ''), account.passwordHash))) {
      await recordLoginAttempt(this.prisma, {
        surface: 'professional', result: 'denied', reason: 'invalid-credentials',
        tenantId: account?.memberships[0]?.tenantId || null,
        platformAccountId: account?.id || null, context,
      });
      throw new UnauthorizedException('Неверный телефон, email или пароль');
    }

    const membership = account.memberships[0];
    if (!membership) {
      await recordLoginAttempt(this.prisma, {
        surface: 'professional', result: 'denied', reason: 'missing-membership',
        platformAccountId: account.id, context,
      });
      throw new UnauthorizedException('Учётная запись не привязана к пространству');
    }

    const accessToken = await this.jwt.signAsync({
      sub: account.id,
      tenantId: membership.tenantId,
      role: membership.role,
    });

    await recordLoginAttempt(this.prisma, {
      surface: 'professional', result: 'success', reason: 'authenticated',
      tenantId: membership.tenantId, platformAccountId: account.id, context,
    });

    return {
      accessToken,
      account: {
        id: account.id,
        email: account.email,
      },
      tenant: { id: membership.tenant.id, name: membership.tenant.name },
      role: membership.role,
    };
  }

  async changePassword(platformAccountId: string, currentPassword: unknown, newPassword: unknown) {
    const account = await this.prisma.platformAccount.findUnique({ where: { id: platformAccountId } });
    if (!account || !(await compare(String(currentPassword || ''), account.passwordHash))) {
      throw new UnauthorizedException('Текущий пароль неверен');
    }
    const next = String(newPassword || '');
    if (next.length < 8) throw new UnauthorizedException('Новый пароль должен содержать минимум 8 символов');
    await this.prisma.platformAccount.update({
      where: { id: platformAccountId },
      data: { passwordHash: await hash(next, 12) },
    });
    return { changed: true };
  }

  async touchPresence(platformAccountId: string, tenantId: string) {
    const member = await this.prisma.membership.findUnique({
      where: { tenantId_platformAccountId: { tenantId, platformAccountId } },
      select: { id: true },
    });
    if (!member) throw new UnauthorizedException('Учётная запись не привязана к пространству');

    // Serialise concurrent tabs/devices by locking the same membership presence row.
    // One authoritative lastSeenAt drives both presence and elapsed-time accounting.
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        INSERT INTO "TenantAccountPresence" ("tenantId", "platformAccountId", "lastSeenAt")
        VALUES (${tenantId}, ${platformAccountId}, CURRENT_TIMESTAMP)
        ON CONFLICT ("tenantId", "platformAccountId") DO NOTHING
      `;
      const rows = await tx.$queryRaw<Array<{ lastSeenAt: Date }>>`
        SELECT "lastSeenAt" FROM "TenantAccountPresence"
        WHERE "tenantId" = ${tenantId} AND "platformAccountId" = ${platformAccountId}
        FOR UPDATE
      `;
      const previous = rows[0]?.lastSeenAt || null;
      const seenAt = new Date();
      const days = creditPresenceDays(previous, seenAt);
      const elapsedMs = days.reduce((total, entry) => total + entry.milliseconds, 0);
      // Duplicate/overlapping requests cannot double-count the time elapsed.
      await tx.tenantAccountPresence.update({
        where: { tenantId_platformAccountId: { tenantId, platformAccountId } },
        data: {
          lastSeenAt: seenAt,
          ...(elapsedMs ? { totalOnlineMs: { increment: BigInt(elapsedMs) } } : {}),
        },
      });
      for (const { day, milliseconds } of days) {
        await tx.tenantAccountPresenceDay.upsert({
          where: { tenantId_platformAccountId_day: { tenantId, platformAccountId, day } },
          create: { tenantId, platformAccountId, day, onlineMs: BigInt(milliseconds) },
          update: { onlineMs: { increment: BigInt(milliseconds) } },
        });
      }
    });
    return { accepted: true };
  }

  async me(platformAccountId: string, tenantId: string) {
    const membership = await this.prisma.membership.findUnique({
      where: { tenantId_platformAccountId: { tenantId, platformAccountId } },
      include: { account: true, tenant: true },
    });
    if (!membership) throw new UnauthorizedException();

    return {
      account: {
        id: membership.account.id,
        email: membership.account.email,
      },
      tenant: { id: membership.tenant.id, name: membership.tenant.name },
      role: membership.role,
    };
  }
}
