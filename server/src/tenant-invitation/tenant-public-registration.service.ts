import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { TenantAccessStatus, TenantInvitationStatus } from '@prisma/client';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../prisma.service';
import { TransactionalEmailService } from '../transactional-email/transactional-email.service';
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
    private readonly email: TransactionalEmailService,
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

  private registrationUrl(token: string) {
    const origin = String(process.env.FRONTEND_ORIGIN || '').trim().replace(/\/+$/, '');
    if (!origin) throw new BadRequestException('Публичная регистрация временно недоступна');
    return `${origin}/invite/?token=${encodeURIComponent(token)}`;
  }

  private async sendRegistrationEmail(email: string, token: string) {
    const url = this.registrationUrl(token);
    return this.email.send({
      to: email,
      subject: 'Продолжить регистрацию',
      tag: 'public-registration',
      text: `Продолжите создание профиля по ссылке:\n${url}\n\nСсылка действует 7 дней.`,
      html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#292522"><h2>Создание профиля</h2><p>Продолжите регистрацию и настройте своё рабочее пространство.</p><p style="margin:28px 0"><a href="${url}" style="background:#292522;color:#fff;text-decoration:none;padding:14px 20px;border-radius:12px;display:inline-block">Продолжить регистрацию</a></p><p style="color:#817a74;font-size:14px">Ссылка действует 7 дней.</p></div>`,
    });
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
    if (existingInvitation) throw new ConflictException('Регистрация уже начата. Ссылка для продолжения отправлена на этот email');

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

    try {
      await this.sendRegistrationEmail(email, token);
    } catch (error) {
      await this.prisma.tenant.delete({ where: { id: created.tenant.id } }).catch(() => undefined);
      throw error;
    }

    return {
      token,
      invitationId: created.invitation.id,
      tenantId: created.tenant.id,
      expiresAt,
    };
  }
}
