import { BadRequestException, ConflictException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { ConsentPolicyService } from '../tenant-document-archive/consent-policy.service';

function text(value: unknown) {
  return String(value ?? '').trim();
}

function objectValue(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
}

function arrayValue(value: unknown): any[] {
  return Array.isArray(value) ? value : [];
}

function canonicalPhone(value: unknown) {
  const digits = text(value).replace(/\D/g, '');
  if (digits.length === 10) return `7${digits}`;
  if (digits.length === 11 && digits.startsWith('8')) return `7${digits.slice(1)}`;
  return digits;
}

function profilePhones(profile: any) {
  return [...new Set([
    text(profile?.phone),
    ...arrayValue(profile?.phones).map((value) => text(value)),
  ].map(canonicalPhone).filter(Boolean))];
}

function profileCard(profile: any) {
  return {
    tenantId: text(profile?.tenantId),
    profile: {
      name: text(profile?.name),
      surname: text(profile?.surname),
      phone: text(profile?.phone),
      photo: text(profile?.photo),
      photoCropX: Number(profile?.photoCropX ?? 50),
      photoCropY: Number(profile?.photoCropY ?? 50),
      profession: text(profile?.profession),
      about: text(profile?.about),
      cardAppearance: objectValue(profile?.cardAppearance),
    },
  };
}

function recordMatchesAccount(dataValue: unknown, accountId: string, accountPhone: string) {
  const data = objectValue(dataValue);
  const participants = [
    objectValue(data.person),
    ...arrayValue(objectValue(data.group).participants).map((item) => objectValue(item)),
  ];
  const phone = canonicalPhone(accountPhone);
  return participants.some((person) => (
    text(person.accountId) === accountId
    || Boolean(phone && canonicalPhone(person.phone) === phone)
  ));
}

function workplaceCard(workplace: any) {
  return {
    key: text(workplace?.key),
    name: text(workplace?.name),
    photo: text(workplace?.photo),
    photoCropX: Number(workplace?.photoCropX ?? 50),
    photoCropY: Number(workplace?.photoCropY ?? 50),
    city: text(workplace?.city),
    address: text(workplace?.address),
    phone: text(workplace?.phone),
    links: arrayValue(workplace?.links),
    about: text(workplace?.about),
    cardAppearance: objectValue(workplace?.cardAppearance),
  };
}

@Injectable()
export class AccountContactsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly consentPolicy: ConsentPolicyService,
  ) {}

  private async account(accountId: string) {
    const account = await this.prisma.account.findUnique({
      where: { id: accountId },
      select: { id: true, phone: true, contacts: { select: { type: true, value: true } } },
    });
    if (!account) throw new UnauthorizedException('Аккаунт не найден');
    return account;
  }

  private async matchingRecords(accountId: string, accountPhone: string, tenantId = '') {
    const normalizedPhone = canonicalPhone(accountPhone);
    const phoneCandidates = [...new Set([
      text(accountPhone),
      normalizedPhone,
      normalizedPhone ? `+${normalizedPhone}` : '',
    ].filter(Boolean))];
    const where: any = {
      ...(tenantId ? { tenantId } : {}),
      OR: [
        { data: { path: ['person', 'accountId'], equals: accountId } },
        ...phoneCandidates.map((value) => ({ data: { path: ['person', 'phone'], equals: value } })),
      ],
    };
    const rows = await this.prisma.record.findMany({
      where,
      select: { tenantId: true, data: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
    return rows.filter((row) => recordMatchesAccount(row.data, accountId, accountPhone));
  }

  private async candidateTenantIds(accountId: string, accountPhone: string) {
    const [links, records] = await Promise.all([
      this.prisma.accountTenantLink.findMany({
        where: { accountId },
        select: { tenantId: true },
        orderBy: { updatedAt: 'desc' },
      }),
      this.matchingRecords(accountId, accountPhone),
    ]);
    return [...new Set([
      ...links.map((link) => text(link.tenantId)),
      ...records.map((record) => text(record.tenantId)),
    ].filter(Boolean))];
  }

  private async explicitlyRemoved(accountId: string, tenantId: string) {
    try {
      const state = await this.consentPolicy.accountConsentState(tenantId, accountId);
      const pdn = arrayValue(state?.consents).find((item) => text(item?.documentId) === 'pdn-consent');
      return text(pdn?.status) === 'revoked';
    } catch {
      return false;
    }
  }

  private async profileForTenant(tenantId: string) {
    const profile = await this.prisma.profile.findFirst({
      where: { tenantId },
      orderBy: { createdAt: 'asc' },
    });
    if (!profile) throw new NotFoundException('Профиль не найден');
    return profile;
  }

  async list(accountId: string) {
    const account = await this.account(accountId);
    const tenantIds = await this.candidateTenantIds(account.id, account.phone);
    if (!tenantIds.length) return [];

    const visible = [] as string[];
    for (const tenantId of tenantIds) {
      if (!(await this.explicitlyRemoved(account.id, tenantId))) visible.push(tenantId);
    }
    if (!visible.length) return [];

    const profiles = await this.prisma.profile.findMany({
      where: { tenantId: { in: visible } },
      orderBy: [{ tenantId: 'asc' }, { createdAt: 'asc' }],
    });
    const byTenant = new Map<string, any>();
    for (const profile of profiles) {
      if (!byTenant.has(profile.tenantId)) byTenant.set(profile.tenantId, profile);
    }
    return visible.map((tenantId) => byTenant.get(tenantId)).filter(Boolean).map(profileCard);
  }

  async searchByPhone(accountId: string, phoneValue: unknown) {
    const requestedPhone = canonicalPhone(phoneValue);
    if (requestedPhone.length < 10 || requestedPhone.length > 15) {
      throw new BadRequestException('Введите номер телефона полностью');
    }
    const account = await this.account(accountId);
    const contactTenantIds = new Set(await this.candidateTenantIds(account.id, account.phone));
    const profiles = await this.prisma.profile.findMany({
      orderBy: [{ tenantId: 'asc' }, { createdAt: 'asc' }],
    });
    const byTenant = new Map<string, any>();
    for (const profile of profiles) {
      if (!profilePhones(profile).includes(requestedPhone)) continue;
      if (!byTenant.has(profile.tenantId)) byTenant.set(profile.tenantId, profile);
    }

    const result = [] as any[];
    for (const profile of byTenant.values()) {
      const removed = await this.explicitlyRemoved(account.id, profile.tenantId);
      result.push({
        ...profileCard(profile),
        connected: contactTenantIds.has(profile.tenantId) && !removed,
      });
    }
    return result;
  }

  async detail(accountId: string, tenantIdValue: unknown) {
    const tenantId = text(tenantIdValue);
    if (!tenantId) throw new BadRequestException('Контакт не выбран');
    const account = await this.account(accountId);
    const profile = await this.profileForTenant(tenantId);
    const [link, records, removed] = await Promise.all([
      this.prisma.accountTenantLink.findUnique({
        where: { accountId_tenantId: { accountId: account.id, tenantId } },
      }),
      this.matchingRecords(account.id, account.phone, tenantId),
      this.explicitlyRemoved(account.id, tenantId),
    ]);

    const workplaceKeys = [...new Set(records
      .map((row) => text(objectValue(row.data).workplaceId))
      .filter(Boolean))];
    const workplaces = workplaceKeys.length
      ? await this.prisma.workplace.findMany({
          where: { tenantId, key: { in: workplaceKeys }, deletedAt: null },
          orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
        })
      : [];

    return {
      ...profileCard(profile),
      connected: Boolean((link || records.length) && !removed),
      workplaces: workplaces.map(workplaceCard),
    };
  }

  async consentState(accountId: string, tenantIdValue: unknown) {
    const tenantId = text(tenantIdValue);
    if (!tenantId) throw new BadRequestException('Контакт не выбран');
    await this.account(accountId);
    await this.profileForTenant(tenantId);
    return this.consentPolicy.accountConsentState(tenantId, accountId);
  }

  async connect(accountId: string, tenantIdValue: unknown, facts: unknown) {
    const tenantId = text(tenantIdValue);
    if (!tenantId) throw new BadRequestException('Контакт не выбран');
    await this.account(accountId);
    await this.profileForTenant(tenantId);
    await this.consentPolicy.acceptAccountConsents(tenantId, accountId, facts, 'account-contact');
    const state = await this.consentPolicy.accountConsentState(tenantId, accountId);
    if (!state.pdnActive) {
      throw new ConflictException('Необходимо подтвердить согласие на обработку персональных данных');
    }
    await this.prisma.accountTenantLink.upsert({
      where: { accountId_tenantId: { accountId, tenantId } },
      create: { accountId, tenantId },
      update: { updatedAt: new Date() },
    });
    return this.detail(accountId, tenantId);
  }

  async revokeConsent(accountId: string, tenantIdValue: unknown, documentIdValue: unknown) {
    const tenantId = text(tenantIdValue);
    const documentId = text(documentIdValue);
    if (!tenantId || !documentId) throw new BadRequestException('Не выбран контакт или документ');
    await this.account(accountId);
    await this.consentPolicy.revokeAccountConsent(tenantId, accountId, documentId, 'account-contact');
    return this.consentPolicy.accountConsentState(tenantId, accountId);
  }

  async remove(accountId: string, tenantIdValue: unknown) {
    const tenantId = text(tenantIdValue);
    if (!tenantId) throw new BadRequestException('Контакт не выбран');
    const account = await this.account(accountId);
    const state = await this.consentPolicy.accountConsentState(tenantId, account.id).catch(() => ({ consents: [] } as any));
    const pdn = arrayValue(state?.consents).find((item) => text(item?.documentId) === 'pdn-consent');
    if (pdn?.documentId) {
      await this.consentPolicy.revokeAccountConsent(tenantId, account.id, 'pdn-consent', 'account-contact-delete').catch(() => null);
    }
    await this.consentPolicy.revokeAllForAccount(
      tenantId,
      account.id,
      account.contacts.map((contact) => ({ type: contact.type, value: contact.value })),
      'account-contact-delete',
    );
    await this.prisma.accountTenantLink.deleteMany({ where: { accountId: account.id, tenantId } });
    return { deleted: true };
  }
}
