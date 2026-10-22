import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  CapabilityValueType,
  TenantInvitationStatus,
  MembershipRole,
  TenantAccessStatus,
} from '@prisma/client';
import { createHash, randomBytes } from 'crypto';
import { hash as hashPassword } from 'bcryptjs';
import { PrismaService } from '../prisma.service';
import { TransactionalEmailService } from '../transactional-email/transactional-email.service';
import { RegistrationDocumentService } from '../document-registry/registration-document.service';

const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const STARTER_PLAN_KEY = 'starter-people';
const REGISTRATION_LINK_EMAIL_PREFIX = 'registration+';
const REGISTRATION_LINK_EMAIL_SUFFIX = '@registration.invalid';
const DEFAULT_FRONTEND_ORIGIN = 'https://app.va-tools.ru';

export const TOOL_CAPABILITY_KEYS = [
  'workplaces.access',
  'timetable.access',
  'people.access',
  'finance.cash.access',
  'finance.dds.access',
  'finance.income_expense.access',
  'finance.articles.access',
  'finance.special.access',
  'finance.investment.self.access',
  'finance.investment.raise.access',
  'finance.investment.external.access',
  'finance.z_report.access',
  'journal.day.access',
  'journal.month.access',
  'journal.list.access',
  'services.access',
  'online_booking.access',
  'notifications.access',
  'integrations.access',
  'documents.access',
  'tags.access',
] as const;
const TOOL_CAPABILITY_SET = new Set<string>(TOOL_CAPABILITY_KEYS);

const CAPABILITY_CATALOG: Array<{
  key: string;
  groupKey: string;
  name: string;
  valueType: CapabilityValueType;
  position: number;
  starterEnabled?: boolean;
  starterLimit?: number | null;
}> = [
  { key: 'profile.access', groupKey: 'system', name: 'Профиль', valueType: CapabilityValueType.BOOLEAN, position: 5, starterEnabled: true },
  { key: 'workplaces.access', groupKey: 'profile', name: 'Рабочие пространства', valueType: CapabilityValueType.BOOLEAN, position: 10, starterEnabled: true },
  { key: 'workplaces.max', groupKey: 'system', name: 'Количество рабочих пространств', valueType: CapabilityValueType.LIMIT, position: 15, starterLimit: 1 },
  { key: 'timetable.access', groupKey: 'work', name: 'График', valueType: CapabilityValueType.BOOLEAN, position: 20, starterEnabled: false },
  { key: 'people.access', groupKey: 'people', name: 'Люди', valueType: CapabilityValueType.BOOLEAN, position: 30, starterEnabled: true },
  { key: 'finance.cash.access', groupKey: 'finance', name: 'Касса', valueType: CapabilityValueType.BOOLEAN, position: 40, starterEnabled: false },
  { key: 'finance.dds.access', groupKey: 'finance', name: 'ДДС', valueType: CapabilityValueType.BOOLEAN, position: 50, starterEnabled: false },
  { key: 'finance.income_expense.access', groupKey: 'finance', name: 'Доход / Расход', valueType: CapabilityValueType.BOOLEAN, position: 60, starterEnabled: false },
  { key: 'finance.articles.access', groupKey: 'finance', name: 'Статьи', valueType: CapabilityValueType.BOOLEAN, position: 70, starterEnabled: false },
  { key: 'finance.special.access', groupKey: 'finance', name: 'Прочие операции', valueType: CapabilityValueType.BOOLEAN, position: 80, starterEnabled: false },
  { key: 'finance.investment.self.access', groupKey: 'finance', name: 'Инвестиции · в себя', valueType: CapabilityValueType.BOOLEAN, position: 82, starterEnabled: false },
  { key: 'finance.investment.raise.access', groupKey: 'finance', name: 'Инвестиции · привлекать', valueType: CapabilityValueType.BOOLEAN, position: 84, starterEnabled: false },
  { key: 'finance.investment.external.access', groupKey: 'finance', name: 'Инвестиции · инвестировать', valueType: CapabilityValueType.BOOLEAN, position: 86, starterEnabled: false },
  { key: 'finance.z_report.access', groupKey: 'finance', name: 'Z-отчёт', valueType: CapabilityValueType.BOOLEAN, position: 90, starterEnabled: false },
  { key: 'journal.day.access', groupKey: 'journal', name: 'День', valueType: CapabilityValueType.BOOLEAN, position: 100, starterEnabled: false },
  { key: 'journal.month.access', groupKey: 'journal', name: 'Месяц', valueType: CapabilityValueType.BOOLEAN, position: 110, starterEnabled: false },
  { key: 'journal.list.access', groupKey: 'journal', name: 'Список', valueType: CapabilityValueType.BOOLEAN, position: 120, starterEnabled: false },
  { key: 'services.access', groupKey: 'settings', name: 'Услуги', valueType: CapabilityValueType.BOOLEAN, position: 130, starterEnabled: true },
  { key: 'online_booking.access', groupKey: 'settings', name: 'Онлайн-запись', valueType: CapabilityValueType.BOOLEAN, position: 140, starterEnabled: false },
  { key: 'notifications.access', groupKey: 'settings', name: 'Уведомления', valueType: CapabilityValueType.BOOLEAN, position: 150, starterEnabled: false },
  { key: 'integrations.access', groupKey: 'settings', name: 'Интеграции', valueType: CapabilityValueType.BOOLEAN, position: 160, starterEnabled: false },
  { key: 'documents.access', groupKey: 'settings', name: 'Документы', valueType: CapabilityValueType.BOOLEAN, position: 170, starterEnabled: false },
  { key: 'tags.access', groupKey: 'settings', name: 'Ярлыки', valueType: CapabilityValueType.BOOLEAN, position: 180, starterEnabled: false },
  { key: 'journal.access', groupKey: 'system', name: 'Журнал', valueType: CapabilityValueType.BOOLEAN, position: 900, starterEnabled: false },
  { key: 'finance.access', groupKey: 'system', name: 'Финансы', valueType: CapabilityValueType.BOOLEAN, position: 910, starterEnabled: false },
  { key: 'payments.access', groupKey: 'system', name: 'Оплаты', valueType: CapabilityValueType.BOOLEAN, position: 920, starterEnabled: false },
  { key: 'chat.access', groupKey: 'system', name: 'Чат', valueType: CapabilityValueType.BOOLEAN, position: 930, starterEnabled: false },
];

function normalizeEmail(value: unknown) {
  return String(value || '').trim().toLowerCase();
}

function normalizeName(value: unknown) {
  return String(value || '').trim();
}

function normalizePhone(value: unknown) {
  return String(value || '').trim();
}

function validRegistrationPhone(value: string) {
  return value.replace(/\D/g, '').length >= 5;
}

function invitationHash(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

function createToken() {
  return randomBytes(32).toString('base64url');
}

function isRegistrationLinkEmail(email: string) {
  return email.startsWith(REGISTRATION_LINK_EMAIL_PREFIX) && email.endsWith(REGISTRATION_LINK_EMAIL_SUFFIX);
}

function normalizeToolSelection(value: unknown) {
  return [...new Set((Array.isArray(value) ? value : [])
    .map((item) => String(item || '').trim())
    .filter((key) => TOOL_CAPABILITY_SET.has(key)))];
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  })[char] || char);
}

@Injectable()
export class TenantInvitationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly email: TransactionalEmailService,
    private readonly jwt: JwtService,
    private readonly registrationDocuments: RegistrationDocumentService,
  ) {}

  async ensureStarterPlan() {
    const capabilityIds = new Map<string, string>();
    for (const item of CAPABILITY_CATALOG) {
      const capability = await this.prisma.capability.upsert({
        where: { key: item.key },
        create: {
          key: item.key,
          groupKey: item.groupKey,
          name: item.name,
          valueType: item.valueType,
          defaultEnabled: false,
          defaultLimit: item.valueType === CapabilityValueType.LIMIT ? null : undefined,
          position: item.position,
          isActive: true,
        },
        update: {
          groupKey: item.groupKey,
          name: item.name,
          valueType: item.valueType,
          position: item.position,
          isActive: true,
        },
      });
      capabilityIds.set(item.key, capability.id);
    }

    const plan = await this.prisma.plan.upsert({
      where: { key: STARTER_PLAN_KEY },
      create: {
        key: STARTER_PLAN_KEY,
        name: 'Старт',
        description: 'Профиль, услуги, люди и одно рабочее пространство',
        position: 10,
        isActive: true,
      },
      update: {
        name: 'Старт',
        description: 'Профиль, услуги, люди и одно рабочее пространство',
        position: 10,
        isActive: true,
      },
    });

    for (const item of CAPABILITY_CATALOG) {
      const capabilityId = capabilityIds.get(item.key)!;
      await this.prisma.planCapability.upsert({
        where: { planId_capabilityId: { planId: plan.id, capabilityId } },
        create: {
          planId: plan.id,
          capabilityId,
          enabled: item.valueType === CapabilityValueType.BOOLEAN ? Boolean(item.starterEnabled) : null,
          limit: item.valueType === CapabilityValueType.LIMIT ? (item.starterLimit ?? null) : null,
        },
        update: {
          enabled: item.valueType === CapabilityValueType.BOOLEAN ? Boolean(item.starterEnabled) : null,
          limit: item.valueType === CapabilityValueType.LIMIT ? (item.starterLimit ?? null) : null,
        },
      });
    }
    return plan;
  }

  private createInvitationToken() {
    const token = createToken();
    return {
      token,
      tokenHash: invitationHash(token),
      expiresAt: new Date(Date.now() + INVITATION_TTL_MS),
    };
  }

  private registrationUrl(token: string) {
    const configuredOrigin = String(process.env.FRONTEND_ORIGIN || '').trim();
    const origin = (configuredOrigin || DEFAULT_FRONTEND_ORIGIN).replace(/\/+$/, '');
    return `${origin}/invite/?token=${encodeURIComponent(token)}`;
  }

  private async ensurePlatformAdminId() {
    const admin = await this.prisma.platformAdmin.findFirst({
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true },
    });
    if (!admin) throw new BadRequestException('Публичная регистрация временно недоступна');
    return admin.id;
  }

  private async ensureEmailAvailable(email: string) {
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
    if (existingInvitation) throw new ConflictException('На этот email уже создано активное приглашение');
  }

  private async findReusablePublicInvitation(email: string) {
    return this.prisma.tenantInvitation.findFirst({
      where: { email, status: TenantInvitationStatus.PENDING },
      include: { tenant: true },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
  }

  private async createPendingInvitation(adminId: string, input: {
    email: string;
    name: string;
    tenantName: string;
    tokenHash: string;
    expiresAt: Date;
    tools?: string[];
  }) {
    const plan = await this.ensureStarterPlan();
    return this.prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({ data: { name: input.tenantName } });
      await tx.tenantAccess.create({
        data: {
          tenantId: tenant.id,
          planId: plan.id,
          status: TenantAccessStatus.ACTIVE,
          isOwnerBook: false,
          commercialMode: 'DEMO',
        },
      });
      const selectedTools = Array.isArray(input.tools)
        ? [...new Set(input.tools.map((value) => String(value || '').trim()).filter((key) => TOOL_CAPABILITY_SET.has(key)))]
        : null;
      if (selectedTools) {
        const toolCapabilities = await tx.capability.findMany({
          where: { key: { in: [...TOOL_CAPABILITY_KEYS] } },
          select: { id: true, key: true },
        });
        for (const capability of toolCapabilities) {
          await tx.tenantCapabilityOverride.create({
            data: {
              tenantId: tenant.id,
              capabilityId: capability.id,
              enabled: selectedTools.includes(capability.key),
              limit: null,
            },
          });
        }
      }
      const invitation = await tx.tenantInvitation.create({
        data: {
          tenantId: tenant.id,
          createdByAdminId: adminId,
          email: input.email,
          name: input.name,
          tokenHash: input.tokenHash,
          expiresAt: input.expiresAt,
        },
      });
      return { tenant, invitation };
    });
  }

  private async createEmailInvitation(adminId: string, input: {
    email: string;
    name: string;
    tenantName: string;
    tools?: string[];
  }, emailDelivery: 'required' | 'best-effort' = 'required') {
    const { token, tokenHash, expiresAt } = this.createInvitationToken();
    const created = await this.createPendingInvitation(adminId, {
      ...input,
      tokenHash,
      expiresAt,
    });
    try {
      await this.sendInvitationEmail({ email: input.email, name: input.name, token });
    } catch (error) {
      if (emailDelivery === 'required') {
        await this.prisma.tenant.delete({ where: { id: created.tenant.id } }).catch(() => undefined);
        throw error;
      }
    }
    return { created, token, expiresAt };
  }

  private async acceptPendingInvitation(
    invitation: { id: string; tenantId: string; tenant: { id: string; name: string } },
    email: string,
    password: string,
    registrationProfile: { name: string; surname: string; phone: string },
    registrationDocuments: Array<{
      documentVersionId: string;
      key: string;
      version: number;
      accepted: boolean;
      action: string;
    }>,
  ) {
    const passwordHash = await hashPassword(password, 12);
    const result = await this.prisma.$transaction(async (tx) => {
      const account = await tx.platformAccount.create({ data: { email, passwordHash } });
      const membership = await tx.membership.create({
        data: {
          tenantId: invitation.tenantId,
          platformAccountId: account.id,
          role: MembershipRole.OWNER,
        },
      });
      const acceptedAt = new Date();
      await tx.profile.create({
        data: {
          tenantId: invitation.tenantId,
          platformAccountId: account.id,
          name: registrationProfile.name,
          surname: registrationProfile.surname,
          phone: registrationProfile.phone,
          phones: [registrationProfile.phone],
          telegrams: [],
          emails: [email],
          customProfessions: [],
        },
      });
      await tx.tenantInvitation.update({
        where: { id: invitation.id },
        data: {
          email,
          name: registrationProfile.name,
          status: TenantInvitationStatus.ACCEPTED,
          acceptedAt,
        },
      });
      for (const document of registrationDocuments) {
        const eventId = randomBytes(18).toString('hex');
        const evidence = JSON.stringify({
          documentKey: document.key,
          documentVersion: document.version,
          registration: true,
        });
        await tx.$executeRaw`
          INSERT INTO "PlatformConsentEvent" (
            "id", "tenantId", "platformAccountId", "documentVersionId",
            "action", "source", "technicalEvidence", "occurredAt"
          ) VALUES (
            ${eventId}, ${invitation.tenantId}, ${account.id}, ${document.documentVersionId},
            ${document.action}, 'platform-registration', ${evidence}::jsonb, ${acceptedAt}
          )
        `;
      }
      return { account, membership };
    });

    const accessToken = await this.jwt.signAsync({
      sub: result.account.id,
      tenantId: invitation.tenantId,
      role: result.membership.role,
    });
    return {
      accessToken,
      account: { id: result.account.id, email: result.account.email },
      tenant: { id: invitation.tenant.id, name: invitation.tenant.name },
      role: result.membership.role,
    };
  }

  async createInvitation(adminId: string, input: { email?: unknown; name?: unknown; tools?: unknown }) {
    const email = normalizeEmail(input?.email);
    const name = normalizeName(input?.name);
    const tools = normalizeToolSelection(input?.tools);
    if (!tools.length) throw new BadRequestException('Перед приглашением выберите хотя бы один инструмент');
    if (!email || !email.includes('@')) throw new BadRequestException('Укажите корректный email');
    await this.ensureEmailAvailable(email);
    const { created } = await this.createEmailInvitation(adminId, {
      email,
      name,
      tenantName: name || email.split('@')[0] || 'Профиль',
      tools,
    });
    return this.invitationDto(created.invitation);
  }

  async startPublicRegistration(input: { email?: unknown } = {}) {
    const email = normalizeEmail(input?.email);
    if (!email || !email.includes('@')) throw new BadRequestException('Укажите корректный email');

    const existingAccount = await this.prisma.platformAccount.findUnique({
      where: { email },
      select: { id: true },
    });
    if (existingAccount) throw new ConflictException('Учётная запись с таким email уже зарегистрирована');

    const reusable = await this.findReusablePublicInvitation(email);
    if (reusable) {
      const { token, tokenHash, expiresAt } = this.createInvitationToken();
      await this.prisma.tenantInvitation.update({
        where: { id: reusable.id },
        data: { tokenHash, expiresAt },
      });
      await this.sendInvitationEmail({ email, name: reusable.name, token }).catch(() => undefined);
      return {
        token,
        invitationId: reusable.id,
        tenantId: reusable.tenantId,
        expiresAt,
      };
    }

    await this.ensureEmailAvailable(email);
    const adminId = await this.ensurePlatformAdminId();
    const { created, token, expiresAt } = await this.createEmailInvitation(adminId, {
      email,
      name: '',
      tenantName: 'Новый профиль',
    }, 'best-effort');
    return {
      token,
      invitationId: created.invitation.id,
      tenantId: created.tenant.id,
      expiresAt,
    };
  }

  async createRegistrationLink(adminId: string, input: { tools?: unknown } = {}) {
    const tools = normalizeToolSelection(input?.tools);
    if (!tools.length) throw new BadRequestException('Перед формированием ссылки выберите хотя бы один инструмент');
    const { token, tokenHash, expiresAt } = this.createInvitationToken();
    const email = `${REGISTRATION_LINK_EMAIL_PREFIX}${tokenHash.slice(0, 24)}${REGISTRATION_LINK_EMAIL_SUFFIX}`;
    const created = await this.createPendingInvitation(adminId, {
      email,
      name: '',
      tenantName: 'Новый профиль',
      tokenHash,
      expiresAt,
    });
    const url = this.registrationUrl(token);
    return {
      id: created.invitation.id,
      tenantId: created.tenant.id,
      url,
      expiresAt,
    };
  }

  async resendInvitation(adminId: string, invitationId: string) {
    const invitation = await this.prisma.tenantInvitation.findUnique({ where: { id: invitationId } });
    if (!invitation || invitation.createdByAdminId !== adminId) throw new NotFoundException('Приглашение не найдено');
    if (invitation.status !== TenantInvitationStatus.PENDING) throw new ConflictException('Это приглашение уже не активно');
    if (isRegistrationLinkEmail(invitation.email)) throw new ConflictException('Эта ссылка не отправляется по email');
    const oldTokenHash = invitation.tokenHash;
    const oldExpiresAt = invitation.expiresAt;
    const { token, tokenHash, expiresAt } = this.createInvitationToken();
    const updated = await this.prisma.tenantInvitation.update({
      where: { id: invitation.id },
      data: { tokenHash, expiresAt },
    });
    try {
      await this.sendInvitationEmail({ email: invitation.email, name: invitation.name, token });
    } catch (error) {
      await this.prisma.tenantInvitation.update({
        where: { id: invitation.id },
        data: { tokenHash: oldTokenHash, expiresAt: oldExpiresAt },
      }).catch(() => undefined);
      throw error;
    }
    return this.invitationDto(updated);
  }

  async deleteUnregisteredInvitation(adminId: string, invitationId: string) {
    const invitation = await this.prisma.tenantInvitation.findUnique({
      where: { id: invitationId },
      include: {
        tenant: {
          include: {
            memberships: { select: { id: true }, take: 1 },
            profiles: { select: { id: true }, take: 1 },
          },
        },
      },
    });
    if (!invitation || invitation.createdByAdminId !== adminId) throw new NotFoundException('Приглашение не найдено');
    if (invitation.status === TenantInvitationStatus.ACCEPTED) {
      throw new ConflictException('Зарегистрированного пользователя нельзя удалить этим действием');
    }
    if (invitation.tenant.memberships.length || invitation.tenant.profiles.length) {
      throw new ConflictException('У этого рабочего пространства уже есть зарегистрированные данные');
    }
    await this.prisma.tenant.delete({ where: { id: invitation.tenantId } });
    return { deleted: true, invitationId, tenantId: invitation.tenantId };
  }

  async inspect(tokenValue: unknown) {
    const invitation = await this.findActiveInvitation(String(tokenValue || ''));
    const requiresEmail = isRegistrationLinkEmail(invitation.email);
    return {
      email: requiresEmail ? '' : invitation.email,
      name: invitation.name,
      requiresEmail,
      expiresAt: invitation.expiresAt,
      demo: { activatedAt: '', expiresAt: '', days: 14 },
      documents: await this.registrationDocuments.documents(),
      tenant: { id: invitation.tenant.id, name: invitation.tenant.name },
    };
  }

  async accept(input: {
    token?: unknown;
    password?: unknown;
    email?: unknown;
    name?: unknown;
    surname?: unknown;
    phone?: unknown;
    documents?: unknown;
  }) {
    const token = String(input?.token || '').trim();
    const password = String(input?.password || '');
    if (password.length < 10) throw new BadRequestException('Пароль должен содержать минимум 10 символов');
    const invitation = await this.findActiveInvitation(token);
    const email = isRegistrationLinkEmail(invitation.email)
      ? normalizeEmail(input?.email)
      : invitation.email;
    if (!email || !email.includes('@')) throw new BadRequestException('Укажите корректный email');
    const name = normalizeName(input?.name);
    const surname = normalizeName(input?.surname);
    const phone = normalizePhone(input?.phone);
    if (!name) throw new BadRequestException('Укажите имя');
    if (!phone || !validRegistrationPhone(phone)) throw new BadRequestException('Укажите корректный номер телефона');
    const registrationDocuments = await this.registrationDocuments.validate(input?.documents);
    const existingAccount = await this.prisma.platformAccount.findUnique({ where: { email } });
    if (existingAccount) throw new ConflictException('Учётная запись с таким email уже зарегистрирована');
    const existingInvitation = await this.prisma.tenantInvitation.findFirst({
      where: {
        email,
        status: TenantInvitationStatus.PENDING,
        id: { not: invitation.id },
      },
      select: { id: true },
    });
    if (existingInvitation) throw new ConflictException('На этот email уже создано другое активное приглашение');
    return this.acceptPendingInvitation(
      invitation,
      email,
      password,
      { name, surname, phone },
      registrationDocuments,
    );
  }

  async listInvitations(adminId: string) {
    const rows = await this.prisma.tenantInvitation.findMany({
      where: { createdByAdminId: adminId },
      include: { tenant: true },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((row) => ({
      ...this.invitationDto(row),
      tenant: { id: row.tenant.id, name: row.tenant.name },
    }));
  }

  private async findActiveInvitation(token: string) {
    if (!token) throw new BadRequestException('Приглашение отсутствует');
    const invitation = await this.prisma.tenantInvitation.findUnique({
      where: { tokenHash: invitationHash(token) },
      include: { tenant: true },
    });
    if (!invitation) throw new NotFoundException('Приглашение не найдено');
    if (invitation.status !== TenantInvitationStatus.PENDING) throw new ConflictException('Приглашение уже использовано или отозвано');
    if (invitation.expiresAt.getTime() <= Date.now()) throw new ConflictException('Срок действия приглашения истёк');
    return invitation;
  }

  private async sendInvitationEmail(input: { email: string; name: string; token: string }) {
    const url = this.registrationUrl(input.token);
    const safeName = escapeHtml(input.name || '');
    const greeting = safeName ? `Здравствуйте, ${safeName}.` : 'Здравствуйте.';
    return this.email.send({
      to: input.email,
      toName: input.name,
      subject: 'Приглашение в систему',
      tag: 'tenant-invitation',
      text: `${input.name ? `Здравствуйте, ${input.name}.` : 'Здравствуйте.'}\
\
Вам открыто персональное рабочее пространство. Создайте пароль и начните настройку:\
${url}\
\
Ссылка действует 7 дней.`,
      html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#292522"><h2>Рабочее пространство</h2><p>${greeting}</p><p>Вам открыто персональное рабочее пространство. Создайте пароль и начните настройку.</p><p style="margin:28px 0"><a href="${url}" style="background:#292522;color:#fff;text-decoration:none;padding:14px 20px;border-radius:12px;display:inline-block">Создать пароль и войти</a></p><p style="color:#817a74;font-size:14px">Ссылка действует 7 дней.</p></div>`,
    });
  }

  private invitationDto(invitation: {
    id: string;
    tenantId: string;
    email: string;
    name: string;
    status: TenantInvitationStatus;
    expiresAt: Date;
    acceptedAt: Date | null;
    revokedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }) {
    const registrationLink = isRegistrationLinkEmail(invitation.email);
    return {
      id: invitation.id,
      tenantId: invitation.tenantId,
      email: registrationLink ? '' : invitation.email,
      registrationLink,
      name: invitation.name,
      status: invitation.status,
      expiresAt: invitation.expiresAt,
      acceptedAt: invitation.acceptedAt,
      revokedAt: invitation.revokedAt,
      createdAt: invitation.createdAt,
      updatedAt: invitation.updatedAt,
    };
  }
}
