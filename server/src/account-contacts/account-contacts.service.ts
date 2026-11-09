import { BadRequestException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { DepositService } from '../loyalty/deposit.service';
import { depositPriceSourcesFromRows, expireDepositInstances } from '../loyalty/deposit-state';
import { resolvePersonPriceCondition } from '../../../core/loyalty/price-condition.js';
import { PersonalAccountService } from '../loyalty/personal-account.service';
import { PrismaService } from '../prisma.service';
import { RecordService } from '../record/record.service';
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

function participantMatchesAccount(personValue: unknown, accountId: string, accountPhone: string) {
  const person = objectValue(personValue);
  const phone = canonicalPhone(accountPhone);
  return text(person.accountId) === accountId
    || Boolean(phone && canonicalPhone(person.phone) === phone)
    || arrayValue(person.phones).some((value) => canonicalPhone(value) === phone);
}

function recordMatchesAccount(dataValue: unknown, accountId: string, accountPhone: string) {
  const data = objectValue(dataValue);
  const participants = [
    objectValue(data.person),
    ...arrayValue(objectValue(data.group).participants).map((item) => objectValue(item)),
  ];
  return participants.some((person) => participantMatchesAccount(person, accountId, accountPhone));
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

// A card is a projection of a SAVED Professional appearance, never a new
// User template. Only the six public loyalty-card fields may carry values.
// Other configured lines render empty rather than exposing private Person data.
function publicProgramCard(
  templates: unknown, scope: string,
  values: { uei?: unknown; title?: unknown; subtitle?: unknown; status?: unknown; metaLeft?: unknown; metaRight?: unknown },
) {
  const template = arrayValue(templates)
    .map(objectValue).find((item) => text(item.scope) === scope) || {};
  const appearance = objectValue(template.appearance);
  const visible = new Set(arrayValue(appearance.lines).map((line) => text(objectValue(line).field)));
  const fields = [
    { value: 'uei', label: 'UEI', text: text(values.uei) },
    { value: 'title', label: 'Название', text: text(values.title) },
    { value: 'subtitle', label: 'Подпись', text: text(values.subtitle) },
    { value: 'status', label: 'Статус', text: text(values.status) },
    { value: 'metaLeft', label: 'Данные слева', text: text(values.metaLeft) },
    { value: 'metaRight', label: 'Данные справа', text: text(values.metaRight) },
  ].filter((item) => visible.has(item.value));
  return {
    appearance,
    fields,
    photo: text(template.photo),
    photoPosition: text(template.photoPosition) || '50% 50%',
  };
}

// This is formatting only; the nominal and balances are taken from their
// existing sources. No new pricing/discount calculation takes place here.
function cardMoney(value: unknown) {
  return `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 })
    .format(Number(value || 0)).replaceAll('\\u00a0', ' ')} ₽`;
}

function depositCardStatus(value: unknown) {
  const status = text(value);
  return status === 'paused' ? 'Приостановлена'
    : status === 'closed' || status === 'ended' ? 'Завершена' : 'Активна';
}

// A discount may be shown only for the authenticated Account's own Person
// within a connected tenant. An explicit link to another account is never
// overridden by a coincidentally matching telephone number.
function personBelongsToAccount(personValue: unknown, accountId: string, accountPhone: string) {
  const person = objectValue(personValue);
  const linkedAccounts = [...arrayValue(person.accounts).map(text), text(person.accountId)].filter(Boolean);
  if (linkedAccounts.length) return linkedAccounts.includes(accountId);
  const phone = canonicalPhone(accountPhone);
  return Boolean(phone && [person.phone, ...arrayValue(person.phones)].map(canonicalPhone).includes(phone));
}

// Presentation contract only: percent and source are resolved by Core's existing
// shared loyalty price rules; no separate discount calculation is performed here.
function effectiveDiscountForPerson(personValue: unknown, depositRows: any[], at: Date) {
  const person = objectValue(personValue);
  const personKey = text(person.key || person.id);
  if (!personKey) return null;
  const condition = resolvePersonPriceCondition(
    person, depositPriceSourcesFromRows(depositRows, personKey, at),
  );
  if (condition.conflict || !condition.source || condition.percent <= 0) return null;
  const source = condition.source;
  return {
    percent: condition.percent,
    source: source.type,
    programName: source.type === 'program' ? text(source.name) : '',
  };
}

function completedRecord(record: Record<string, any>) {
  if (text(record.status) === 'cancelled') return false;
  if (text(record.attendance) === 'arrived') return true;
  const date = text(record.date).slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);
  return Boolean(date && date < today);
}

function recordSummary(record: Record<string, any>) {
  return {
    id: text(record.id),
    date: text(record.date).slice(0, 10),
    from: text(record.from),
    to: text(record.to),
    workplaceId: text(record.workplaceId),
    status: text(record.status),
    attendance: text(record.attendance),
    procedures: arrayValue(record.procedures).map((item) => {
      const procedure = objectValue(item);
      return {
        id: text(procedure.id),
        name: text(procedure.name),
        cost: Number(procedure.cost ?? procedure.price ?? 0),
        duration: Number(procedure.duration ?? 0),
      };
    }),
    finance: objectValue(record.finance),
    payment: objectValue(record.payment),
  };
}

@Injectable()
export class AccountContactsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly consentPolicy: ConsentPolicyService,
    private readonly personalAccounts: PersonalAccountService,
    private readonly deposits: DepositService,
    private readonly records: RecordService,
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
      select: { tenantId: true, recordId: true, data: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
    return rows.filter((row) => recordMatchesAccount(row.data, accountId, accountPhone));
  }

  private matchingParticipants(records: Array<{ data: unknown }>, accountId: string, accountPhone: string) {
    const result: Record<string, any>[] = [];
    const seen = new Set<string>();
    for (const row of records) {
      const data = objectValue(row.data);
      const participants = [
        objectValue(data.person),
        ...arrayValue(objectValue(data.group).participants).map((item) => objectValue(item)),
      ];
      for (const participant of participants) {
        if (!participantMatchesAccount(participant, accountId, accountPhone)) continue;
        const key = text(participant.key || participant.id || participant.accountId || participant.phone);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        result.push(participant);
      }
    }
    return result;
  }

  private async professionalPerson(tenantId: string, accountId: string, accountPhone: string, records: Array<{ data: unknown }>) {
    const recordParticipants = this.matchingParticipants(records, accountId, accountPhone);
    const recordKeys = new Set(recordParticipants.flatMap((person) => [text(person.key), text(person.id)]).filter(Boolean));
    const phone = canonicalPhone(accountPhone);
    const rows = await this.prisma.person.findMany({
      where: { tenantId },
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
    });
    for (const row of rows) {
      const person = objectValue(row.data);
      const key = text(person.key || row.key);
      const accountIds = arrayValue(person.accounts).map((value) => text(value));
      const phones = [person.phone, ...arrayValue(person.phones)].map(canonicalPhone).filter(Boolean);
      if (recordKeys.has(key) || accountIds.includes(accountId) || Boolean(phone && phones.includes(phone))) {
        return { ...person, key };
      }
    }
    return recordParticipants[0] || null;
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
    const link = await this.prisma.accountTenantLink.findUnique({
      where: { accountId_tenantId: { accountId, tenantId } },
      select: { id: true },
    });
    if (link) return false;
    try {
      const state = await this.consentPolicy.accountConsentState(tenantId, accountId);
      const pdn = arrayValue(state?.consents).find((item) => text(item?.documentId) === 'pdn-consent');
      return text(pdn?.status) === 'revoked' && text(pdn?.source) === 'account-contact-delete';
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

  private async contactContext(accountId: string, tenantIdValue: unknown) {
    const tenantId = text(tenantIdValue);
    if (!tenantId) throw new BadRequestException('Контакт не выбран');
    const account = await this.account(accountId);
    const [profile, link, records, removed] = await Promise.all([
      this.profileForTenant(tenantId),
      this.prisma.accountTenantLink.findUnique({
        where: { accountId_tenantId: { accountId: account.id, tenantId } },
      }),
      this.matchingRecords(account.id, account.phone, tenantId),
      this.explicitlyRemoved(account.id, tenantId),
    ]);
    if (removed || (!link && !records.length)) throw new NotFoundException('Контакт не найден');
    const person = await this.professionalPerson(tenantId, account.id, account.phone, records);
    return { tenantId, account, profile, link, records, person };
  }

  private async visibleDepositSummaries(tenantId: string, personKey: string) {
    if (!personKey) return [];
    await expireDepositInstances(this.prisma, tenantId);
    const [rows, programRows] = await Promise.all([
      this.prisma.loyaltyDepositInstance.findMany({
        where: { tenantId, personKey },
        orderBy: [{ fundedAt: 'desc' }, { createdAt: 'desc' }],
      }),
      this.prisma.loyaltyDepositProgram.findMany({ where: { tenantId } }),
    ]);
    const programs = new Map(programRows.map((row) => [row.programId, objectValue(row.data)]));
    // Price percentage comes from the same active-program source as the Person discount.
    const activePrices = new Map(depositPriceSourcesFromRows(rows, personKey, new Date())
      .map((source) => [text(source.depositId), source.percent]));
    return rows.map((row) => {
      const terms = objectValue(row.terms);
      const presentation = objectValue(terms.presentation);
      return {
        depositId: text(row.depositId),
        programId: text(row.programId),
        programName: text(row.programName),
        fundedAmount: Number(row.initialAmount || 0),
        balance: Number(row.balance || 0),
        status: text(row.status),
        discountPercent: activePrices.get(text(row.depositId)) || 0,
        cardProgram: objectValue(programs.get(row.programId)),
        terms,
        visibleToPersonOverride: typeof presentation.visibleToPerson === 'boolean' ? presentation.visibleToPerson : null,
      };
    }).filter((deposit) => {
      if (typeof deposit.visibleToPersonOverride === 'boolean') return deposit.visibleToPersonOverride;
      return objectValue(programs.get(deposit.programId)).showToAll !== false;
    });
  }

  private async programSummaries(tenantId: string, personValue: unknown) {
    const person = objectValue(personValue);
    const personKey = text(person.key || person.id);
    if (!personKey) return [];
    const [personalAccount, deposits, auxiliary, ueiState] = await Promise.all([
      this.personalAccounts.endUserSummary(tenantId, personKey).catch(() => null),
      this.visibleDepositSummaries(tenantId, personKey).catch(() => []),
      this.prisma.businessAuxiliaryState.findUnique({
        where: { tenantId }, select: { data: true },
      }),
      this.prisma.ueiState.findUnique({
        where: { tenantId }, select: { data: true },
      }),
    ]);
    const templates = objectValue(auxiliary?.data).cardAppearanceTemplates;
    const relations = objectValue(objectValue(ueiState?.data).relations);
    const name = [text(person.name), text(person.surname)].filter(Boolean).join(' ') || 'Без имени';
    return [
      personalAccount ? {
        type: 'personal-account',
        title: 'Личный счёт',
        balance: Number(personalAccount.balance || 0),
        debtTotal: Number(personalAccount.debtTotal || 0),
        card: publicProgramCard(templates, 'loyalty-personal-account', {
          title: name,
          subtitle: 'Личный счёт',
          status: Number(personalAccount.debtTotal || 0) > .009 ? 'Есть задолженность'
            : Number(personalAccount.balance || 0) > .009 ? 'Есть остаток' : 'Нулевой остаток',
          metaLeft: Number(personalAccount.debtTotal || 0) > .009 ? 'Задолженность' : 'Денежный остаток',
          metaRight: cardMoney(Number(personalAccount.debtTotal || 0) > .009
            ? personalAccount.debtTotal : personalAccount.balance),
        }),
      } : null,
      ...deposits.map((deposit: Record<string, any>) => {
        const program = objectValue(deposit.cardProgram);
        const amount = Number(program.amount || 0);
        return {
          type: 'deposit',
          depositId: text(deposit.depositId),
          title: text(deposit.programName) || 'Депозит',
          balance: Number(deposit.balance || 0),
          fundedAmount: Number(deposit.fundedAmount || 0),
          status: text(deposit.status),
          discountPercent: Number(deposit.discountPercent || 0),
          terms: {
            termRule: text(objectValue(deposit.terms).termRule),
            benefit: text(objectValue(deposit.terms).benefit),
          },
          card: publicProgramCard(templates, 'loyalty-deposit', {
            uei: relations[`loyalty-deposit-program:${text(deposit.programId)}`],
            title: program.name || deposit.programName || 'Депозит',
            subtitle: program.termRule || objectValue(deposit.terms).termRule || 'Бессрочно',
            status: depositCardStatus(program.status),
            metaLeft: program.benefit || objectValue(deposit.terms).benefit || 'Без дополнительной выгоды',
            metaRight: amount > 0 ? cardMoney(amount) : 'Свободная сумма',
          }),
        };
      }),
    ].filter(Boolean);
  }

  // Both list and detail use one batched read of canonical Person and deposit
  // sources. This does not expose another contact's discount by phone collision.
  private async accountDiscounts(accountId: string, accountPhone: string, tenantIds: string[]) {
    const result = new Map<string, ReturnType<typeof effectiveDiscountForPerson>>();
    if (!tenantIds.length) return result;
    const [rows, deposits] = await Promise.all([
      this.prisma.person.findMany({
        where: { tenantId: { in: tenantIds } },
        select: { tenantId: true, key: true, data: true },
      }),
      this.prisma.loyaltyDepositInstance.findMany({
        where: { tenantId: { in: tenantIds }, status: 'active' },
        select: {
          tenantId: true, personKey: true, status: true, terms: true,
          depositId: true, programId: true, programName: true,
        },
      }),
    ]);
    const candidates = new Map<string, Array<{ person: Record<string, any>; linked: boolean }>>();
    for (const row of rows) {
      const person: Record<string, any> = { ...objectValue(row.data), key: text(row.key) };
      if (!personBelongsToAccount(person, accountId, accountPhone)) continue;
      const linked = [...arrayValue(person.accounts).map(text), text(person.accountId)]
        .includes(accountId);
      const set = candidates.get(row.tenantId) || [];
      set.push({ person, linked });
      candidates.set(row.tenantId, set);
    }
    const byTenant = new Map<string, any[]>();
    for (const deposit of deposits) {
      const set = byTenant.get(deposit.tenantId) || [];
      set.push(deposit);
      byTenant.set(deposit.tenantId, set);
    }
    const now = new Date();
    for (const tenantId of tenantIds) {
      const people = candidates.get(tenantId) || [];
      const linked = people.filter((item) => item.linked);
      const matches = linked.length ? linked : people;
      // An ambiguous identity must not leak a percentage from someone else.
      const person = matches.length === 1 ? matches[0].person : null;
      result.set(tenantId, effectiveDiscountForPerson(
        person, byTenant.get(tenantId) || [], now,
      ));
    }
    return result;
  }

  private async projectedRecords(context: Awaited<ReturnType<AccountContactsService['contactContext']>>) {
    const people = this.matchingParticipants(context.records, context.account.id, context.account.phone);
    if (context.person) people.push(objectValue(context.person));
    const unique = new Map<string, Record<string, any>>();
    for (const person of people) {
      const key = text(person.key || person.id || person.accountId || person.phone);
      if (key && !unique.has(key)) unique.set(key, person);
    }
    if (!unique.size) return [];
    return this.records.listForPeople(context.tenantId, [...unique.values()]);
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
    const discounts = await this.accountDiscounts(account.id, account.phone, visible);
    return visible.map((tenantId) => {
      const profile = byTenant.get(tenantId);
      return profile ? { ...profileCard(profile), discount: discounts.get(tenantId) || null } : null;
    }).filter(Boolean);
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
    const context = await this.contactContext(accountId, tenantIdValue);
    const workplaceKeys = [...new Set(context.records
      .map((row) => {
        const data = objectValue(row.data);
        return text(data.workplaceId || data.workplaceKey);
      })
      .filter(Boolean))];
    const [workplaces, programs] = await Promise.all([
      workplaceKeys.length
        ? this.prisma.workplace.findMany({
            where: { tenantId: context.tenantId, key: { in: workplaceKeys }, deletedAt: null },
            orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
          })
        : [],
      this.programSummaries(context.tenantId, context.person),
    ]);

    const discounts = await this.accountDiscounts(
      context.account.id, context.account.phone, [context.tenantId],
    );
    return {
      ...profileCard(context.profile),
      connected: true,
      discount: discounts.get(context.tenantId) || null,
      workplaces: workplaces.map(workplaceCard),
      programs,
    };
  }

  async workplaceHistory(accountId: string, tenantIdValue: unknown, workplaceKeyValue: unknown) {
    const workplaceKey = text(workplaceKeyValue);
    if (!workplaceKey) throw new BadRequestException('Пространство не выбрано');
    const context = await this.contactContext(accountId, tenantIdValue);
    const allowed = context.records.some((row) => text(objectValue(row.data).workplaceId || objectValue(row.data).workplaceKey) === workplaceKey);
    if (!allowed) throw new NotFoundException('Пространство не найдено в истории контакта');
    const rows = await this.projectedRecords(context);
    return arrayValue(rows)
      .filter((record) => text(record.workplaceId) === workplaceKey && completedRecord(objectValue(record)))
      .map((record) => recordSummary(objectValue(record)));
  }

  async recordDetail(accountId: string, tenantIdValue: unknown, recordIdValue: unknown) {
    const recordId = text(recordIdValue);
    if (!recordId) throw new BadRequestException('Запись не выбрана');
    const context = await this.contactContext(accountId, tenantIdValue);
    if (!context.records.some((row) => text(row.recordId || objectValue(row.data).id) === recordId)) {
      throw new NotFoundException('Запись не найдена');
    }
    const rows = await this.projectedRecords(context);
    const record = arrayValue(rows).find((item) => text(item?.id) === recordId);
    if (!record || !completedRecord(objectValue(record))) throw new NotFoundException('Запись не найдена');
    return record;
  }

  async personalAccount(accountId: string, tenantIdValue: unknown) {
    const context = await this.contactContext(accountId, tenantIdValue);
    const personKey = text(objectValue(context.person).key || objectValue(context.person).id);
    if (!personKey) throw new NotFoundException('Личный счёт недоступен');
    const summary = await this.personalAccounts.endUserSummary(context.tenantId, personKey);
    if (!summary) throw new NotFoundException('Личный счёт недоступен');
    const detail = await this.personalAccounts.endUserView(context.tenantId, personKey);
    if (!detail) throw new NotFoundException('Личный счёт недоступен');
    return detail;
  }

  async depositDetail(accountId: string, tenantIdValue: unknown, depositIdValue: unknown) {
    const depositId = text(depositIdValue);
    if (!depositId) throw new BadRequestException('Депозит не выбран');
    const context = await this.contactContext(accountId, tenantIdValue);
    const personKey = text(objectValue(context.person).key || objectValue(context.person).id);
    if (!personKey) throw new NotFoundException('Депозит недоступен');
    const summaries = await this.visibleDepositSummaries(context.tenantId, personKey);
    if (!summaries.some((item) => text(item.depositId) === depositId)) throw new NotFoundException('Депозит недоступен');
    return this.deposits.get(context.tenantId, depositId);
  }

  async consentState(accountId: string, tenantIdValue: unknown) {
    const tenantId = text(tenantIdValue);
    if (!tenantId) throw new BadRequestException('Контакт не выбран');
    await this.account(accountId);
    await this.profileForTenant(tenantId);
    return this.consentPolicy.accountConsentState(tenantId, accountId);
  }

  async acceptConsents(accountId: string, tenantIdValue: unknown, facts: unknown) {
    const tenantId = text(tenantIdValue);
    if (!tenantId) throw new BadRequestException('Контакт не выбран');
    await this.account(accountId);
    await this.profileForTenant(tenantId);
    await this.consentPolicy.acceptAccountConsents(tenantId, accountId, facts, 'account-contact');
    await this.prisma.accountTenantLink.upsert({
      where: { accountId_tenantId: { accountId, tenantId } },
      create: { accountId, tenantId },
      update: { updatedAt: new Date() },
    });
    return this.consentPolicy.accountConsentState(tenantId, accountId);
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
