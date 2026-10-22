import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { TenantAccessStatus, TenantInvitationStatus } from '@prisma/client';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../prisma.service';
import { TenantInvitationService } from './tenant-invitation.service';

const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function normalizeEmail(value: unknown) {
  return String(value || '').trim().toLowerCase();
}

function invitationHash(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

function createToken() {
  return randomBytes(32).toString('base64url');
}

@Injectable()
export class TenantPublicRegistrationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly invitations: TenantInvitationService,
  ) {}

  private async ensurePlatformAdminId() {
    const configuredEmail = String(process.env.PLATFORM_ADMIN_EMAIL || process.env.OWNER_EMAIL || '')
      .trim()
      .toLowerCase();
    if (!configuredEmail) throw new BadRequestException('Публичная регистрация временно недоступна');

    const account = await this.prisma.platformAccount.findUnique({
      where: { email: configuredEmail },
      select: { id: true },
    });
    if (!account) throw new BadRequestException('Публичная регистрация временно недоступна');

    const admin = await this.prisma.platformAdmin.upsert({
      where: { platformAccountId: account.id },
      create: { platformAccountId: account.id },
      update: {},
      select: { id: true },
    });
    return admin.id;
  }

  async start(input: { email?: unknown } = {}) {
    const email = normalizeEmail(input?.email);
    if (!email || !email.includes('@')) throw new BadRequestException('Укажите корректный email');

    const existingAccount = await this.prisma.platformAccount.findUnique({
      where: { email },
      select: { id: true },
    });
    if (existingAccount) throw new ConflictException('Учётная запись с таким email уже зарегистрирована');

    const existingInvitation = await this.prisma.tenantInvitation.findFirst({
      where: {
        email,
        status: TenantInvitationStatus.PENDING,
        expiresAt: { gt: new Date() },
      },
      select: { id: true },
    });
    if (existingInvitation) throw new ConflictException('На этот email уже создана активная регистрация');

    const adminId = await this.ensurePlatformAdminId();
    const plan = await this.invitations.ensureStarterPlan();
    const token = createToken();
    const tokenHash = invitationHash(token);
    const expiresAt = new Date(Date.now() + INVITATION_TTL_MS);

    const created = await this.prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({ data: { name: 'Новый профиль' } });
      await tx.tenantAccess.create({
        data: {
          tenantId: tenant.id,
          planId: plan.id,
          status: TenantAccessStatus.ACTIVE,
          isOwnerBook: false,
          commercialMode: 'DEMO',
        },
      });
      const invitation = await tx.tenantInvitation.create({
        data: {
          tenantId: tenant.id,
          createdByAdminId: adminId,
          email,
          name: '',
          tokenHash,
          expiresAt,
        },
      });
      return { tenant, invitation };
    });

    return {
      token,
      invitationId: created.invitation.id,
      tenantId: created.tenant.id,
      expiresAt,
    };
  }
}
