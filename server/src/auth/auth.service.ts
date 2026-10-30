import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { compare, hash } from 'bcryptjs';
import { PrismaService } from '../prisma.service';

type PlatformPhoneRow = { platformAccountId: string };

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

  private async accountByIdentifier(identifier: string) {
    const raw = String(identifier || '').trim();
    const normalizedEmail = raw.toLowerCase();
    if (normalizedEmail.includes('@')) {
      return this.prisma.platformAccount.findUnique({
        where: { email: normalizedEmail },
        include: { memberships: { include: { tenant: true } } },
      });
    }

    const normalizedPhone = canonicalPhone(raw);
    if (normalizedPhone.length < 10) return null;

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

  async login(identifier: string, password: string) {
    const account = await this.accountByIdentifier(identifier);
    if (!account || !(await compare(String(password || ''), account.passwordHash))) {
      throw new UnauthorizedException('Неверный email, телефон или пароль');
    }

    const membership = account.memberships[0];
    if (!membership) throw new UnauthorizedException('Учётная запись не привязана к пространству');

    const accessToken = await this.jwt.signAsync({
      sub: account.id,
      tenantId: membership.tenantId,
      role: membership.role,
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
