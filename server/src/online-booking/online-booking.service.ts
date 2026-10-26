import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AccountContactType, BookingPublicRouteType, BookingRequestStatus, Prisma } from '@prisma/client';
import { compare, hash } from 'bcryptjs';
import { AccountDocumentService } from '../document-registry/account-document.service';
import { PrismaService } from '../prisma.service';
import { BusinessStateService } from '../business-state/business-state.service';
import { ConsentPolicyService } from '../tenant-document-archive/consent-policy.service';
import { TenantDocumentArchiveService } from '../tenant-document-archive/tenant-document-archive.service';
import { ProfileService } from '../profile/profile.service';
import { PersonIdentityService } from './person-identity.service';
import { TimeService } from '../time/time.service';
import { RecordService } from '../record/record.service';
import { ProcedureService } from '../procedure/procedure.service';
import { SaasAccessService } from '../saas-access/saas-access.service';

function objectValue(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
}

function arrayValue(value: unknown): any[] {
  return Array.isArray(value) ? value : [];
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function text(value: unknown) {
  return String(value ?? '').trim();
}

const PROFILE_ROUTE_SCOPE = 'profile';
const PROFILE_ROUTE_RESERVED = new Set([
  'admin',
  'api',
  'chat',
  'core',
  'css',
  'journal',
  'main',
  'online-booking',
  'settings',
  'timetable',
  'ui',
]);

const CYRILLIC_SLUG_MAP: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z',
  и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r',
  с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh',
  щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
};

function publicRouteSlug(value: unknown) {
  const transliterated = [...text(value).toLocaleLowerCase('ru-RU')]
    .map((character) => CYRILLIC_SLUG_MAP[character] ?? character)
    .join('');
  return transliterated
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, 64);
}

function emailValue(value: unknown) {
  return text(value).toLowerCase();
}

function canonicalPhone(value: unknown) {
  const digits = text(value).replace(/\D/g, '');
  if (digits.length === 10) return `7${digits}`;
  if (digits.length === 11 && digits.startsWith('8')) return `7${digits.slice(1)}`;
  return digits;
}

function accountLoginContact(value: unknown) {
  const raw = text(value);
  const email = emailValue(raw);
  if (email && email.includes('@')) {
    return { type: AccountContactType.EMAIL, value: email };
  }
  const phone = canonicalPhone(raw);
  if (phone.length >= 10 && phone.length <= 15) {
    return { type: AccountContactType.PHONE, value: phone };
  }
  return null;
}

function dateValue(value: unknown) {
  const result = text(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(result) ? result : '';
}

function numeric(value: unknown, fallback = 0) {
  const result = Number(value);
  return Number.isFinite(result) ? result : fallback;
}

function percent(value: unknown) {
  return Math.max(0, Math.min(100, numeric(value, 0)));
}

function uniqueStrings(value: unknown, normalize: (item: unknown) => string, limit = 5) {
  return [...new Set(arrayValue(value).map(normalize).filter(Boolean))].slice(0, limit);
}

function normalizeProfileData(value: unknown) {
  const source = objectValue(value);
  const gender = text(source.gender);
  const links = arrayValue(source.links).map((item) => ({
    type: text(item?.type).slice(0, 40),
    url: text(item?.url).slice(0, 1000),
  })).filter((item) => item.url).slice(0, 8);
  return {
    gender: ['male', 'female'].includes(gender) ? gender : '',
    birthDate: dateValue(source.birthDate),
    photo: text(source.photo).slice(0, 5_000_000),
    phones: uniqueStrings(source.phones, (item) => {
      const value = text(item);
      return /^\+\d{8,15}$/.test(value) ? value : '';
    }),
    emails: uniqueStrings(source.emails, (item) => {
      const value = emailValue(item);
      return value.includes('@') ? value.slice(0, 254) : '';
    }),
    telegram: text(source.telegram).slice(0, 100),
    links,
  };
}

type AccountContactFact = {
  type: AccountContactType;
  value: string;
  isPrimary: boolean;
};

function accountContactFacts(account: {
  email?: unknown;
  phone?: unknown;
  telegramId?: unknown;
  profileData?: unknown;
}) {
  const profileData = normalizeProfileData(account.profileData);
  const facts: AccountContactFact[] = [];
  const push = (type: AccountContactType, value: string, isPrimary = false) => {
    const normalized = text(value);
    if (!normalized) return;
    const existing = facts.find((item) => item.type === type && item.value === normalized);
    if (existing) {
      existing.isPrimary = existing.isPrimary || isPrimary;
      return;
    }
    facts.push({ type, value: normalized, isPrimary });
  };

  push(AccountContactType.EMAIL, emailValue(account.email), true);
  push(AccountContactType.PHONE, canonicalPhone(account.phone), true);
  push(AccountContactType.TELEGRAM, text(account.telegramId), true);
  profileData.emails.forEach((value) => push(AccountContactType.EMAIL, emailValue(value)));
  profileData.phones.forEach((value) => push(AccountContactType.PHONE, canonicalPhone(value)));
  return facts;
}

function publicAccount(account: any) {
  return {
    id: account.id,
    email: account.email,
    name: account.name,
    surname: account.surname,
    phone: account.phone,
    telegramId: account.telegramId || '',
    profileData: normalizeProfileData(account.profileData),
    discountPercent: percent(account.discountPercent),
    visits: Math.max(0, Math.floor(numeric(account.visits, 0))),
    totalSpent: Math.max(0, numeric(account.totalSpent, 0)),
    lastVisit: text(account.lastVisit),
    programs: arrayValue(account.programs),
    createdAt: account.createdAt,
  };
}


@Injectable()
export class OnlineBookingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly accountDocuments: AccountDocumentService,
    private readonly businessState: BusinessStateService,
    private readonly tenantDocumentArchive: TenantDocumentArchiveService,
    private readonly consentPolicy: ConsentPolicyService,
    private readonly profile: ProfileService,
    private readonly personIdentity: PersonIdentityService,
    private readonly time: TimeService,
    private readonly records: RecordService,
    private readonly procedures: ProcedureService,
    private readonly access: SaasAccessService,
  ) {}

  private async publication(tenantId: string) {
    const publication = await this.prisma.bookingPublication.findUnique({ where: { tenantId } });
    if (!publication) throw new NotFoundException('Онлайн-запись ещё не опубликована');
    return publication;
  }

  private async bookingSource(tenantId: string) {
    const [profile, operational, documents] = await Promise.all([
      this.profile.publicBookingBundle(tenantId),
      this.businessState.publicOperational(tenantId),
      this.tenantDocumentArchive.publicDocuments(tenantId),
    ]);
    return { ...profile, ...operational, documents };
  }

  private async accountView(tenantId: string, account: any) {
    const identity = await this.businessState.bookingIdentityForAccount(tenantId, account.id);
    const person = identity?.person || {};
    const personStats = await this.personIdentity.personStats(tenantId, account);
    return publicAccount({
      ...account,
      discountPercent: person.discountPercent ?? account.discountPercent,
      visits: personStats?.visits ?? person.visits ?? account.visits,
      totalSpent: personStats?.totalSpent ?? person.totalSpent ?? account.totalSpent,
      lastVisit: personStats?.lastVisit || person.lastVisit || account.lastVisit,
      programs: Array.isArray(person.programs) ? person.programs : account.programs,
    });
  }

  private async issueAccountToken(account: { id: string }) {
    return this.jwt.signAsync({
      sub: account.id,
      kind: 'account',
    }, { expiresIn: '365d' });
  }

  private async bindAccountTenant(tenantId: string, account: any) {
    return this.personIdentity.bindFirstAccess(tenantId, account as any);
  }

  private async globalAccountView(accountId: string) {
    const account = await this.prisma.account.findUnique({ where: { id: accountId } });
    if (!account) throw new UnauthorizedException('Аккаунт не найден');
    return publicAccount(account);
  }

  private async assertContactsAvailable(
    contacts: AccountContactFact[],
    accountId = '',
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    if (!contacts.length) return;
    const existing = await tx.accountContact.findMany({
      where: {
        OR: contacts.map((contact) => ({ type: contact.type, value: contact.value })),
      },
      select: { accountId: true, type: true, value: true },
    });
    const conflict = existing.find((contact) => contact.accountId !== accountId);
    if (conflict) {
      throw new ConflictException('Этот контакт уже зарегистрирован. Войдите в аккаунт или восстановите пароль.');
    }
  }

  private async replaceAccountContacts(
    tx: Prisma.TransactionClient,
    accountId: string,
    contacts: AccountContactFact[],
  ) {
    await this.assertContactsAvailable(contacts, accountId, tx);
    await tx.accountContact.deleteMany({ where: { accountId } });
    if (contacts.length) {
      await tx.accountContact.createMany({
        data: contacts.map((contact) => ({ accountId, ...contact })),
      });
    }
  }

  private async tenantAccountIds(tenantId: string) {
    const business = await this.businessState.get(tenantId);
    return [...new Set(arrayValue(business.people)
      .flatMap((person) => arrayValue(person?.accounts).map((value) => text(value)))
      .filter(Boolean))];
  }

  async publish(tenantId: string, data: unknown) {
    const normalized = objectValue(data);
    return this.prisma.bookingPublication.upsert({
      where: { tenantId },
      create: { tenantId, data: normalized as Prisma.InputJsonValue, revision: 1 },
      update: { data: normalized as Prisma.InputJsonValue, revision: { increment: 1 } },
      select: { revision: true, updatedAt: true },
    });
  }

  private async ensurePublicRoute({
    tenantId,
    entityType,
    entityId,
    scopeKey,
    preferred,
    reserved = false,
  }: {
    tenantId: string;
    entityType: BookingPublicRouteType;
    entityId: string;
    scopeKey: string;
    preferred: unknown[];
    reserved?: boolean;
  }) {
    const existing = await this.prisma.bookingPublicRoute.findUnique({
      where: { entityType_entityId: { entityType, entityId } },
    });
    if (existing) return existing.slug;

    const bases = [...new Set(preferred.map(publicRouteSlug).filter(Boolean))]
      .filter((slug) => !reserved || !PROFILE_ROUTE_RESERVED.has(slug));
    const fallback = entityType === BookingPublicRouteType.PROFILE
      ? `profile-${entityId.slice(-8).toLowerCase()}`
      : `workplace-${entityId.slice(-8).toLowerCase()}`;
    if (!bases.length) bases.push(fallback);

    for (const base of bases) {
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const suffix = attempt === 0 ? '' : `-${attempt + 1}`;
        const candidate = `${base.slice(0, Math.max(1, 64 - suffix.length))}${suffix}`;
        try {
          const created = await this.prisma.bookingPublicRoute.create({
            data: { tenantId, entityType, entityId, scopeKey, slug: candidate },
          });
          return created.slug;
        } catch (error) {
          if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw error;
          const concurrent = await this.prisma.bookingPublicRoute.findUnique({
            where: { entityType_entityId: { entityType, entityId } },
          });
          if (concurrent) return concurrent.slug;
        }
      }
    }

    throw new ConflictException('Не удалось сформировать короткую ссылку онлайн-записи');
  }

  async ownerPublicRoute(tenantId: string) {
    const source = await this.profile.publicBookingRouteSource(tenantId);
    const profileSlug = await this.ensurePublicRoute({
      tenantId,
      entityType: BookingPublicRouteType.PROFILE,
      entityId: source.profile.id,
      scopeKey: PROFILE_ROUTE_SCOPE,
      preferred: [
        source.profile.name,
        [source.profile.name, source.profile.surname].filter(Boolean).join(' '),
      ],
      reserved: true,
    });

    const workplaces = [];
    for (const workplace of source.workplaces) {
      const slug = await this.ensurePublicRoute({
        tenantId,
        entityType: BookingPublicRouteType.WORKPLACE,
        entityId: workplace.id,
        scopeKey: `workplace:${tenantId}`,
        preferred: [workplace.name],
      });
      workplaces.push({ key: workplace.key, name: workplace.name, slug });
    }

    return { profileSlug, workplaces };
  }

  async resolvePublicRoute(profileSlugValue: unknown, workplaceSlugValue: unknown = '') {
    const profileSlug = publicRouteSlug(profileSlugValue);
    if (!profileSlug) throw new NotFoundException('Ссылка онлайн-записи не найдена');

    const profileRoute = await this.prisma.bookingPublicRoute.findUnique({
      where: { scopeKey_slug: { scopeKey: PROFILE_ROUTE_SCOPE, slug: profileSlug } },
    });
    if (!profileRoute || profileRoute.entityType !== BookingPublicRouteType.PROFILE) {
      throw new NotFoundException('Ссылка онлайн-записи не найдена');
    }

    const source = await this.profile.publicBookingRouteSource(profileRoute.tenantId);
    if (source.profile.id !== profileRoute.entityId) {
      throw new NotFoundException('Ссылка онлайн-записи не найдена');
    }

    const workplaceSlug = publicRouteSlug(workplaceSlugValue);
    if (!workplaceSlug) {
      return { tenantId: profileRoute.tenantId, workplaceKey: '' };
    }

    const workplaceRoute = await this.prisma.bookingPublicRoute.findUnique({
      where: {
        scopeKey_slug: {
          scopeKey: `workplace:${profileRoute.tenantId}`,
          slug: workplaceSlug,
        },
      },
    });
    const workplace = source.workplaces.find((item) => item.id === workplaceRoute?.entityId);
    if (!workplaceRoute || workplaceRoute.entityType !== BookingPublicRouteType.WORKPLACE || !workplace) {
      throw new NotFoundException('Рабочее пространство не найдено');
    }

    return { tenantId: profileRoute.tenantId, workplaceKey: workplace.key };
  }

  async getContext(tenantId: string, workplaceKey = '') {
    await this.access.assertRealOperationsAllowed(tenantId);
    const data = await this.bookingSource(tenantId);
    const sourceWorkplaces = arrayValue(data.workplaces);
    const requestedWorkplace = text(workplaceKey);
    const selected = requestedWorkplace
      ? sourceWorkplaces.find((item) => text(item?.key) === requestedWorkplace)
      : null;
    if (requestedWorkplace && !selected) throw new NotFoundException('Рабочее пространство не найдено');

    const generalWorkplaces = sourceWorkplaces.filter((item) => item?.visibleInPublicBooking !== false);
    const workplaces = selected ? [selected] : generalWorkplaces;
    const bookingWorkplaces = workplaces.map((workplace) => ({
      key: text(workplace?.key),
      name: text(workplace?.name),
      city: text(workplace?.city),
      address: text(workplace?.address),
      timeZone: text(workplace?.timeZone),
      from: text(workplace?.from),
      to: text(workplace?.to),
    }));
    const allowedKeys = new Set(workplaces.map((item) => text(item?.key)).filter(Boolean));
    const procedures = arrayValue(data.procedures).filter((procedure) => {
      const assignments = arrayValue(procedure?.workplaces);
      return assignments.some((item) => allowedKeys.has(text(item?.workplaceId ?? item?.key ?? item?.id)));
    });
    const days = arrayValue(data.days).filter((day) => allowedKeys.has(text(day?.workplaceId)));
    const [recordOccupancy, eventOccupancy, pending] = await Promise.all([
      this.records.publicOccupancy(tenantId),
      this.prisma.event.findMany({
        where: { tenantId },
        select: { id: true, workplaceId: true, date: true, from: true, to: true },
      }),
      this.prisma.bookingRequest.findMany({
        where: {
          tenantId,
          status: BookingRequestStatus.PENDING,
          ...(selected ? { workplaceKey: requestedWorkplace } : {}),
        },
        select: { id: true, workplaceKey: true, date: true, from: true, to: true },
      }),
    ]);
    const events = eventOccupancy.map((item) => ({
      id: item.id, type: 'event', workplaceId: item.workplaceId, date: item.date, from: item.from, to: item.to,
    }));
    const occupancy = [...recordOccupancy, ...events].filter((item) => allowedKeys.has(text(item?.workplaceId)));

    return {
      tenantId,
      revision: 0,
      settings: objectValue(data.bookingSettings),
      workplaces: bookingWorkplaces,
      procedures,
      days,
      documents: arrayValue(data.documents).filter((item) => Boolean(item?.personConsent)),
      occupancy: [
        ...occupancy,
        ...pending.map((item) => ({
          id: `booking-request:${item.id}`,
          type: 'booking-request',
          workplaceId: item.workplaceKey,
          date: item.date,
          from: item.from,
          to: item.to,
        })),
      ],
    };
  }

  async prepareAccount(tenantId: string, input: unknown) {
    await this.access.assertRealOperationsAllowed(tenantId);
    const source = objectValue(input);
    const identifierValue = text(source.identifier || (typeof input === 'string' ? input : ''));
    const email = emailValue(source.email);
    const phone = canonicalPhone(source.phone);
    const contacts: Array<{ type: AccountContactType; value: string; field: 'identifier' | 'email' | 'phone' }> = [];

    const identifier = accountLoginContact(identifierValue);
    if (identifier) contacts.push({ ...identifier, field: 'identifier' });
    if (email && email.includes('@')) contacts.push({ type: AccountContactType.EMAIL, value: email, field: 'email' });
    if (phone) contacts.push({ type: AccountContactType.PHONE, value: phone, field: 'phone' });
    if (!contacts.length) throw new BadRequestException('Введите телефон или email');

    const unique = [...new Map(contacts.map((contact) => [`${contact.type}:${contact.value}`, contact])).values()];
    const rows = await this.prisma.accountContact.findMany({
      where: { OR: unique.map((contact) => ({ type: contact.type, value: contact.value })) },
      select: { type: true, value: true },
    });
    const occupied = new Set(rows.map((row) => `${row.type}:${row.value}`));
    const conflicts = {
      identifier: unique.some((contact) => contact.field === 'identifier' && occupied.has(`${contact.type}:${contact.value}`)),
      email: unique.some((contact) => contact.field === 'email' && occupied.has(`${contact.type}:${contact.value}`)),
      phone: unique.some((contact) => contact.field === 'phone' && occupied.has(`${contact.type}:${contact.value}`)),
    };
    return {
      exists: conflicts.identifier || conflicts.email || conflicts.phone,
      conflicts,
      identifierType: identifier?.type || '',
    };
  }

  async registerAccount(tenantId: string, body: Record<string, any>) {
    await this.access.assertRealOperationsAllowed(tenantId);
    const email = emailValue(body.email);
    const password = text(body.password);
    const name = text(body.name);
    const phone = text(body.phone);
    const telegramId = text(body.telegramId);
    const profileData = normalizeProfileData(body.profileData);
    const accountTerms = objectValue(body.accountTerms);
    if (!email || !email.includes('@')) throw new BadRequestException('Введите корректный email');
    if (password.length < 6) throw new BadRequestException('Пароль должен содержать не менее 6 символов');
    if (!name) throw new BadRequestException('Введите имя');
    if (!/^\+\d{8,15}$/.test(phone)) throw new BadRequestException('Введите телефон полностью');

    const currentTerms = await this.accountDocuments.publicTerms();
    if (!accountTerms.accepted
      || text(accountTerms.key) !== currentTerms.key
      || Number(accountTerms.version || 0) !== currentTerms.version) {
      throw new BadRequestException('Необходимо принять актуальные Условия использования учетной записи');
    }

    const contacts = accountContactFacts({ email, phone, telegramId, profileData });
    const account = await this.prisma.$transaction(async (tx) => {
      await this.assertContactsAvailable(contacts, '', tx);
      const created = await tx.account.create({
        data: {
          createdViaTenantId: tenantId,
          email,
          passwordHash: await hash(password, 12),
          name,
          surname: text(body.surname),
          phone,
          telegramId,
          profileData: profileData as Prisma.InputJsonValue,
        },
      });
      await this.replaceAccountContacts(tx, created.id, contacts);
      return created;
    });

    await this.accountDocuments.accept(
      account.id,
      accountTerms,
      'online-booking-registration',
      { tenantContext: tenantId },
    );
    const binding = await this.bindAccountTenant(tenantId, account);
    return {
      accessToken: await this.issueAccountToken(account),
      account: await this.accountView(tenantId, account),
      personExisted: binding.personExisted,
    };
  }

  async loginAccount(tenantId: string, identifierValue: unknown, password: unknown) {
    await this.access.assertRealOperationsAllowed(tenantId);
    const identifier = accountLoginContact(identifierValue);
    if (!identifier) throw new BadRequestException('Введите телефон или email');
    const contact = await this.prisma.accountContact.findUnique({
      where: { type_value: { type: identifier.type, value: identifier.value } },
      include: { account: true },
    });
    const account = contact?.account || null;
    if (!account || !(await compare(text(password), account.passwordHash))) {
      throw new UnauthorizedException('Неверный телефон, email или пароль');
    }
    const binding = await this.bindAccountTenant(tenantId, account);
    return {
      accessToken: await this.issueAccountToken(account),
      account: await this.accountView(tenantId, account),
      personExisted: binding.personExisted,
    };
  }

  async resumeAccount(tenantId: string, accountId: string) {
    await this.access.assertRealOperationsAllowed(tenantId);
    const account = await this.prisma.account.findUnique({ where: { id: accountId } });
    if (!account) throw new UnauthorizedException('Аккаунт не найден');
    const binding = await this.bindAccountTenant(tenantId, account);
    return {
      accessToken: await this.issueAccountToken(account),
      account: await this.accountView(tenantId, account),
      personExisted: binding.personExisted,
    };
  }

  async getAccount(tenantId: string, accountId: string) {
    await this.access.assertRealOperationsAllowed(tenantId);
    const account = await this.prisma.account.findUnique({ where: { id: accountId } });
    if (!account) throw new UnauthorizedException('Аккаунт не найден');
    await this.bindAccountTenant(tenantId, account);
    return this.accountView(tenantId, account);
  }

  async accountTenantContactContext(tenantId: string, accountId: string) {
    await this.access.assertRealOperationsAllowed(tenantId);
    const account = await this.prisma.account.findUnique({ where: { id: accountId } });
    if (!account) throw new UnauthorizedException('Аккаунт не найден');
    await this.bindAccountTenant(tenantId, account);
    const identity = await this.businessState.bookingIdentityForAccount(tenantId, accountId);
    return {
      phone: account.phone,
      uei: text(identity?.uei),
    };
  }

  async updateAccount(tenantId: string, accountId: string, body: Record<string, any>) {
    await this.access.assertRealOperationsAllowed(tenantId);
    const account = await this.prisma.account.findUnique({ where: { id: accountId } });
    if (!account) throw new UnauthorizedException('Аккаунт не найден');

    const phone = text(body.phone) || account.phone;
    if (!/^\+\d{8,15}$/.test(phone)) throw new BadRequestException('Введите телефон полностью');
    const profileData = body.profileData == null
      ? normalizeProfileData(account.profileData)
      : normalizeProfileData({ ...objectValue(account.profileData), ...objectValue(body.profileData) });
    const telegramId = text(body.telegramId) || account.telegramId;
    const contacts = accountContactFacts({
      email: account.email,
      phone,
      telegramId,
      profileData,
    });

    const updated = await this.prisma.$transaction(async (tx) => {
      await this.replaceAccountContacts(tx, account.id, contacts);
      return tx.account.update({
        where: { id: account.id },
        data: {
          name: text(body.name) || account.name,
          surname: body.surname == null ? account.surname : text(body.surname),
          phone,
          telegramId,
          profileData: profileData as Prisma.InputJsonValue,
        },
      });
    });
    await this.bindAccountTenant(tenantId, updated);
    await this.personIdentity.syncLinkedPeople(updated as any);
    return this.accountView(tenantId, updated);
  }

  async syncAccountPersonContacts(accountId: string) {
    const account = await this.prisma.account.findUnique({ where: { id: accountId } });
    if (!account) throw new UnauthorizedException('Аккаунт не найден');
    return this.personIdentity.syncLinkedPeople(account as any);
  }

  async changeAccountPassword(tenantId: string, accountId: string, currentPassword: unknown, newPassword: unknown) {
    await this.access.assertRealOperationsAllowed(tenantId);
    const current = String(currentPassword ?? '');
    const next = String(newPassword ?? '');
    if (next.length < 8) throw new BadRequestException('Новый пароль должен содержать минимум 8 символов');
    const account = await this.prisma.account.findUnique({ where: { id: accountId } });
    if (!account) throw new UnauthorizedException('Аккаунт не найден');
    if (!(await compare(current, account.passwordHash))) throw new BadRequestException('Текущий пароль указан неверно');
    if (await compare(next, account.passwordHash)) throw new BadRequestException('Новый пароль должен отличаться от текущего');
    await this.prisma.account.update({
      where: { id: account.id },
      data: { passwordHash: await hash(next, 12) },
    });
    return { changed: true };
  }

  async createRequest(tenantId: string, accountId: string, body: Record<string, any>) {
    await this.access.assertRealOperationsAllowed(tenantId);
    const account = await this.prisma.account.findUnique({ where: { id: accountId } });
    if (!account) throw new UnauthorizedException('Аккаунт не найден');
    const data = await this.bookingSource(tenantId);
    if (!(await this.consentPolicy.hasActivePdnConsent(tenantId, accountId))) {
      throw new ConflictException('Необходимо подтвердить согласие на обработку персональных данных');
    }
    const workplaceKey = text(body.workplaceKey);
    const date = dateValue(body.date);
    const from = text(body.from);
    if (!workplaceKey || !date || this.time.timeToMinutes(from) == null) throw new BadRequestException('Не выбраны дата, время или рабочее пространство');

    const workplace = arrayValue(data.workplaces).find((item) => text(item?.key) === workplaceKey);
    if (!workplace) throw new BadRequestException('Рабочее пространство недоступно');
    if (this.time.isPastZonedStart(date, from, workplace?.timeZone)) {
      throw new ConflictException('Это время уже прошло');
    }

    const requestedIds = [...new Set(arrayValue(body.procedureIds).map((value) => text(value)).filter(Boolean))];
    const procedureSnapshots = await this.procedures.snapshots(tenantId, workplaceKey, requestedIds);
    const duration = procedureSnapshots.reduce((sum, procedure) => sum + Math.max(0, Number(procedure?.duration || 0)), 0);
    if (duration <= 0) throw new BadRequestException('Не удалось определить длительность процедур');
    const start = this.time.timeToMinutes(from)!;
    const to = this.time.minutesToTime(start + duration);
    if (!to) throw new BadRequestException('Выбранное время недоступно');

    const binding = await this.bindAccountTenant(tenantId, account);
    const person = binding.person;
    const identity = await this.businessState.bookingIdentityForAccount(tenantId, account.id);
    const pricingPerson = identity?.person || person;
    const personSnapshot = {
      key: text(person.key),
      id: text(person.id),
      accountId: account.id,
      name: text(account.name),
      surname: text(account.surname),
      phone: text(account.phone),
      email: text(account.email),
      telegramId: text(account.telegramId),
      discountPercent: percent(pricingPerson?.discountPercent),
    };
    const request = await this.prisma.bookingRequest.create({
      data: {
        tenantId,
        accountId,
        workplaceKey,
        date,
        from,
        to,
        procedures: requestedIds.map((id) => ({ id })) as Prisma.InputJsonValue,
      },
    });

    try {
      const record = await this.records.create(tenantId, {
        date,
        workplaceId: workplaceKey,
        from,
        to,
        person: personSnapshot,
        procedureIds: requestedIds,
        source: 'online-booking',
        sourceRequestId: request.id,
        createdBy: { type: 'account', accountId: account.id, profileId: '' },
      });
      const imported = await this.prisma.bookingRequest.update({
        where: { id: request.id },
        data: {
          status: BookingRequestStatus.IMPORTED,
          importedRecordId: text(record.id),
        },
      });
      return { ...imported, recordId: text(record.id) };
    } catch (error) {
      await this.prisma.bookingRequest.update({ where: { id: request.id }, data: { status: BookingRequestStatus.REJECTED } }).catch(() => null);
      throw error;
    }
  }

  async getMyRecords(tenantId: string, accountId: string) {
    await this.access.assertRealOperationsAllowed(tenantId);
    const account = await this.prisma.account.findUnique({ where: { id: accountId } });
    if (!account) throw new UnauthorizedException('Аккаунт не найден');
    await this.bindAccountTenant(tenantId, account);
    const identity = await this.businessState.bookingIdentityForAccount(tenantId, accountId);
    const people = identity?.memberPeople?.length
      ? identity.memberPeople
      : identity?.person ? [identity.person] : [];
    return this.records.listForPeople(tenantId, people);
  }


  async prepareGlobalAccount(input: unknown) {
    const source = objectValue(input);
    const identifierValue = text(source.identifier || (typeof input === 'string' ? input : ''));
    const email = emailValue(source.email);
    const phone = canonicalPhone(source.phone);
    const contacts: Array<{ type: AccountContactType; value: string; field: 'identifier' | 'email' | 'phone' }> = [];
    const identifier = accountLoginContact(identifierValue);
    if (identifier) contacts.push({ ...identifier, field: 'identifier' });
    if (email && email.includes('@')) contacts.push({ type: AccountContactType.EMAIL, value: email, field: 'email' });
    if (phone) contacts.push({ type: AccountContactType.PHONE, value: phone, field: 'phone' });
    if (!contacts.length) throw new BadRequestException('Введите телефон или email');

    const unique = [...new Map(contacts.map((contact) => [`${contact.type}:${contact.value}`, contact])).values()];
    const rows = await this.prisma.accountContact.findMany({
      where: { OR: unique.map((contact) => ({ type: contact.type, value: contact.value })) },
      select: { type: true, value: true },
    });
    const occupied = new Set(rows.map((row) => `${row.type}:${row.value}`));
    const conflicts = {
      identifier: unique.some((contact) => contact.field === 'identifier' && occupied.has(`${contact.type}:${contact.value}`)),
      email: unique.some((contact) => contact.field === 'email' && occupied.has(`${contact.type}:${contact.value}`)),
      phone: unique.some((contact) => contact.field === 'phone' && occupied.has(`${contact.type}:${contact.value}`)),
    };
    return {
      exists: conflicts.identifier || conflicts.email || conflicts.phone,
      conflicts,
      identifierType: identifier?.type || '',
    };
  }

  async registerGlobalAccount(body: Record<string, any>) {
    const email = emailValue(body.email);
    const password = text(body.password);
    const name = text(body.name);
    const phone = text(body.phone);
    const telegramId = text(body.telegramId);
    const profileData = normalizeProfileData(body.profileData);
    const accountTerms = objectValue(body.accountTerms);
    if (!email || !email.includes('@')) throw new BadRequestException('Введите корректный email');
    if (password.length < 6) throw new BadRequestException('Пароль должен содержать не менее 6 символов');
    if (!name) throw new BadRequestException('Введите имя');
    if (!/^\+\d{8,15}$/.test(phone)) throw new BadRequestException('Введите телефон полностью');

    const currentTerms = await this.accountDocuments.publicTerms();
    if (!accountTerms.accepted
      || text(accountTerms.key) !== currentTerms.key
      || Number(accountTerms.version || 0) !== currentTerms.version) {
      throw new BadRequestException('Необходимо принять актуальные Условия использования учетной записи');
    }

    const contacts = accountContactFacts({ email, phone, telegramId, profileData });
    const account = await this.prisma.$transaction(async (tx) => {
      await this.assertContactsAvailable(contacts, '', tx);
      const created = await tx.account.create({
        data: {
          email,
          passwordHash: await hash(password, 12),
          name,
          surname: text(body.surname),
          phone,
          telegramId,
          profileData: profileData as Prisma.InputJsonValue,
        },
      });
      await this.replaceAccountContacts(tx, created.id, contacts);
      return created;
    });

    await this.accountDocuments.accept(
      account.id,
      accountTerms,
      'account-registration',
      { entry: 'global-account' },
    );
    return {
      accessToken: await this.issueAccountToken(account),
      account: publicAccount(account),
    };
  }

  async loginGlobalAccount(identifierValue: unknown, password: unknown) {
    const identifier = accountLoginContact(identifierValue);
    if (!identifier) throw new BadRequestException('Введите телефон или email');
    const contact = await this.prisma.accountContact.findUnique({
      where: { type_value: { type: identifier.type, value: identifier.value } },
      include: { account: true },
    });
    const account = contact?.account || null;
    if (!account || !(await compare(text(password), account.passwordHash))) {
      throw new UnauthorizedException('Неверный телефон, email или пароль');
    }
    return {
      accessToken: await this.issueAccountToken(account),
      account: publicAccount(account),
    };
  }

  async getGlobalAccount(accountId: string) {
    return this.globalAccountView(accountId);
  }

  async updateGlobalAccount(accountId: string, body: Record<string, any>) {
    const account = await this.prisma.account.findUnique({ where: { id: accountId } });
    if (!account) throw new UnauthorizedException('Аккаунт не найден');
    const phone = text(body.phone) || account.phone;
    if (!/^\+\d{8,15}$/.test(phone)) throw new BadRequestException('Введите телефон полностью');
    const profileData = body.profileData == null
      ? normalizeProfileData(account.profileData)
      : normalizeProfileData({ ...objectValue(account.profileData), ...objectValue(body.profileData) });
    const telegramId = text(body.telegramId) || account.telegramId;
    const contacts = accountContactFacts({ email: account.email, phone, telegramId, profileData });
    const updated = await this.prisma.$transaction(async (tx) => {
      await this.replaceAccountContacts(tx, account.id, contacts);
      return tx.account.update({
        where: { id: account.id },
        data: {
          name: text(body.name) || account.name,
          surname: body.surname == null ? account.surname : text(body.surname),
          phone,
          telegramId,
          profileData: profileData as Prisma.InputJsonValue,
        },
      });
    });
    await this.personIdentity.syncLinkedPeople(updated as any);
    return publicAccount(updated);
  }

  async deleteGlobalAccount(accountId: string) {
    const account = await this.prisma.account.findUnique({
      where: { id: accountId },
      include: { contacts: true, tenantLinks: true },
    });
    if (!account) throw new UnauthorizedException('Аккаунт не найден');

    const contacts = account.contacts.map((contact) => ({
      type: String(contact.type || ''),
      value: String(contact.value || ''),
    }));

    for (const link of account.tenantLinks) {
      await this.consentPolicy.revokeAllForAccount(
        link.tenantId,
        account.id,
        contacts,
        'account-delete',
      );
    }

    const deletedAt = new Date().toISOString();
    await this.prisma.$transaction(async (tx) => {
      await tx.accountContact.deleteMany({ where: { accountId: account.id } });
      await tx.accountTenantLink.deleteMany({ where: { accountId: account.id } });
      await tx.account.update({
        where: { id: account.id },
        data: {
          email: `deleted+${account.id}@invalid.local`,
          name: '',
          surname: '',
          phone: '',
          telegramId: '',
          profileData: { deletedAt } as Prisma.InputJsonValue,
          passwordHash: await hash(`deleted:${account.id}:${deletedAt}`, 12),
        },
      });
    });

    return { deleted: true };
  }

  async changeGlobalAccountPassword(accountId: string, currentPassword: unknown, newPassword: unknown) {
    const current = String(currentPassword ?? '');
    const next = String(newPassword ?? '');
    if (next.length < 8) throw new BadRequestException('Новый пароль должен содержать минимум 8 символов');
    const account = await this.prisma.account.findUnique({ where: { id: accountId } });
    if (!account) throw new UnauthorizedException('Аккаунт не найден');
    if (!(await compare(current, account.passwordHash))) throw new BadRequestException('Текущий пароль указан неверно');
    if (await compare(next, account.passwordHash)) throw new BadRequestException('Новый пароль должен отличаться от текущего');
    await this.prisma.account.update({ where: { id: account.id }, data: { passwordHash: await hash(next, 12) } });
    return { changed: true };
  }

  private async accountInvestmentRelationships(tenantId: string, accountId: string) {
    const [row, raiseCapability] = await Promise.all([
      this.prisma.businessAuxiliaryState.findUnique({ where: { tenantId } }),
      this.access.resolveCapability(tenantId, 'finance.investment.raise.access').catch(() => null),
    ]);
    const canRaise = raiseCapability?.enabled === true;
    const data = objectValue(row?.data);
    const investments = arrayValue(data.investments)
      .map((value) => objectValue(value))
      .filter((entity) => {
        if (text(entity.deletedAt)) return false;
        const terms = objectValue(entity.investmentTerms);
        const status = text(terms.participantStatus);
        return text(terms.role) === 'raise'
          && text(terms.participantAccountId) === accountId
          && (status === 'accepted' || (status === 'pending' && canRaise));
      });
    if (!investments.length) return [];

    const acceptedIds = new Set(investments
      .filter((entity) => text(objectValue(entity.investmentTerms).participantStatus) === 'accepted')
      .map((entity) => text(entity.id))
      .filter(Boolean));
    const operations = await this.prisma.financeOperation.findMany({
      where: {
        tenantId,
        status: 'completed',
        kind: { in: ['investment-received', 'investment-return', 'investment-income-payment'] },
      },
      orderBy: [{ occurredAt: 'asc' }, { createdAt: 'asc' }],
    });

    const byEntity = new Map<string, any[]>();
    for (const operation of operations) {
      const operationData = objectValue(operation.data);
      const entityId = text(operationData.financeEntityId);
      if (!acceptedIds.has(entityId)) continue;
      const kind = text(operation.kind);
      const projection = kind === 'investment-received'
        ? { direction: 'OUT', economicType: 'INVESTMENT_CONTRIBUTION' }
        : kind === 'investment-return'
          ? { direction: 'IN', economicType: 'INVESTMENT_CAPITAL_RETURN' }
          : { direction: 'IN', economicType: 'INVESTMENT_INCOME' };
      const list = byEntity.get(entityId) || [];
      list.push({
        operationId: operation.operationId,
        operationKind: kind,
        operationStatus: operation.status,
        direction: projection.direction,
        economicType: projection.economicType,
        amount: numeric(operationData.total, 0),
        total: projection.direction === 'OUT' ? -numeric(operationData.total, 0) : numeric(operationData.total, 0),
        occurredAt: operation.occurredAt.toISOString(),
      });
      byEntity.set(entityId, list);
    }

    return investments.map((entity) => {
      const terms = objectValue(entity.investmentTerms);
      return {
        id: text(entity.id),
        name: text(entity.name),
        photo: text(entity.photo),
        cardAppearance: objectValue(entity.cardAppearance),
        investmentTerms: {
          role: 'external',
          investmentType: text(terms.investmentType),
          participationModel: text(terms.participationModel),
          objectName: text(terms.objectName),
          termMode: text(terms.termMode),
          endDate: text(terms.endDate),
          durationValue: numeric(terms.durationValue, 0),
          durationUnit: text(terms.durationUnit),
          targetAmount: numeric(terms.targetAmount, 0),
          sharePercent: numeric(terms.sharePercent, 0),
          returnPercent: numeric(terms.returnPercent, 0),
          participantName: text(terms.participantName),
          participantStatus: text(terms.participantStatus),
          participantRespondedAt: text(terms.participantRespondedAt),
        },
        investmentEvents: text(terms.participantStatus) === 'accepted'
          ? arrayValue(entity.investmentEvents)
            .map((event) => clone(objectValue(event)))
            .filter((event) => !text(event.deletedAt))
          : [],
        movements: text(terms.participantStatus) === 'accepted'
          ? (byEntity.get(text(entity.id)) || [])
          : [],
      };
    });
  }

  async decideGlobalAccountInvestment(accountId: string, tenantIdValue: unknown, investmentIdValue: unknown, decisionValue: unknown) {
    const tenantId = text(tenantIdValue);
    const investmentId = text(investmentIdValue);
    const decision = text(decisionValue);
    if (!tenantId || !investmentId) throw new BadRequestException('Инвестиция не выбрана');
    if (!['accepted', 'declined'].includes(decision)) throw new BadRequestException('Неизвестное решение');

    const link = await this.prisma.accountTenantLink.findUnique({
      where: { accountId_tenantId: { accountId, tenantId } },
      select: { accountId: true },
    });
    if (!link) throw new BadRequestException('Связь с проектом не найдена');

    const row = await this.prisma.businessAuxiliaryState.findUnique({ where: { tenantId } });
    if (!row) throw new BadRequestException('Инвестиция недоступна');
    const data = objectValue(row.data);
    const investments = arrayValue(data.investments).map((value) => clone(objectValue(value)));
    const index = investments.findIndex((entity) => text(entity.id) === investmentId && !text(entity.deletedAt));
    if (index < 0) throw new BadRequestException('Инвестиция не найдена');
    const entity = investments[index];
    const terms = objectValue(entity.investmentTerms);
    if (text(terms.role) !== 'raise' || text(terms.participantAccountId) !== accountId) {
      throw new BadRequestException('Предложение инвестиции недоступно');
    }
    if (text(terms.participantStatus) !== 'pending') {
      throw new BadRequestException('Решение по предложению уже принято');
    }
    const raiseCapability = await this.access.resolveCapability(tenantId, 'finance.investment.raise.access');
    if (raiseCapability.enabled !== true) {
      throw new BadRequestException('Предложение инвестиции больше недоступно');
    }

    investments[index] = {
      ...entity,
      investmentTerms: {
        ...terms,
        participantStatus: decision,
        participantRespondedAt: new Date().toISOString(),
      },
      updatedAt: new Date().toISOString(),
    };
    await this.prisma.businessAuxiliaryState.update({
      where: { tenantId },
      data: { data: {
        ...data,
        investments,
      } as Prisma.InputJsonValue },
    });
    return { investmentId, tenantId, status: decision };
  }

  async globalAccountRelationships(accountId: string) {
    await this.globalAccountView(accountId);
    const links = await this.prisma.accountTenantLink.findMany({
      where: { accountId },
      orderBy: { updatedAt: 'desc' },
    });
    const relationships = await Promise.all(links.map(async (link) => {
      try {
        const [data, relationshipProfile, investments] = await Promise.all([
          this.bookingSource(link.tenantId),
          this.profile.accountRelationshipProfile(link.tenantId),
          this.accountInvestmentRelationships(link.tenantId, accountId),
        ]);
        return {
          tenantId: link.tenantId,
          linkedAt: link.createdAt,
          context: {
            tenantId: link.tenantId,
            profile: objectValue(relationshipProfile),
            settings: objectValue(data.bookingSettings),
            workplaces: arrayValue(data.workplaces),
            investments,
          },
        };
      } catch {
        return null;
      }
    }));
    return relationships.filter(Boolean);
  }

  async deleteGlobalAccountRelationship(accountId: string, tenantIdValue: unknown) {
    const tenantId = text(tenantIdValue);
    if (!tenantId) throw new BadRequestException('Не выбран контакт');
    const account = await this.prisma.account.findUnique({
      where: { id: accountId },
      include: { contacts: true },
    });
    if (!account) throw new UnauthorizedException('Аккаунт не найден');

    const link = await this.prisma.accountTenantLink.findUnique({
      where: { accountId_tenantId: { accountId: account.id, tenantId } },
    });
    if (!link) return { deleted: true };

    const contacts = account.contacts.map((contact) => ({
      type: String(contact.type || ''),
      value: String(contact.value || ''),
    }));
    await this.consentPolicy.revokeAllForAccount(
      tenantId,
      account.id,
      contacts,
      'account-contact-delete',
    );
    await this.prisma.accountTenantLink.delete({
      where: { accountId_tenantId: { accountId: account.id, tenantId } },
    });
    return { deleted: true };
  }

  async globalAccountRecords(accountId: string) {
    await this.globalAccountView(accountId);
    const links = await this.prisma.accountTenantLink.findMany({
      where: { accountId },
      orderBy: { updatedAt: 'desc' },
    });
    const groups = await Promise.all(links.map(async (link) => {
      try {
        const rows = await this.getMyRecords(link.tenantId, accountId);
        return arrayValue(rows).map((row) => ({ ...row, tenantId: link.tenantId }));
      } catch {
        return [];
      }
    }));
    return groups.flat();
  }

  async ownerAccounts(tenantId: string) {
    const accountIds = await this.tenantAccountIds(tenantId);
    if (!accountIds.length) return [];
    const accounts = await this.prisma.account.findMany({
      where: { id: { in: accountIds } },
      orderBy: { updatedAt: 'desc' },
    });
    return accounts.map(publicAccount);
  }

  async syncOwnerAccounts(tenantId: string, value: unknown) {
    const allowed = new Set(await this.tenantAccountIds(tenantId));
    const items = arrayValue(value);
    let updated = 0;
    for (const item of items) {
      const accountId = text(item?.accountId ?? item?.id);
      if (!accountId || !allowed.has(accountId)) continue;
      const account = await this.prisma.account.findUnique({ where: { id: accountId } });
      if (!account) continue;
      await this.prisma.account.update({
        where: { id: account.id },
        data: {
          discountPercent: percent(item?.discountPercent),
          visits: Math.max(0, Math.floor(numeric(item?.visits, 0))),
          totalSpent: Math.max(0, numeric(item?.totalSpent, 0)),
          lastVisit: text(item?.lastVisit),
          programs: arrayValue(item?.programs) as Prisma.InputJsonValue,
        },
      });
      updated += 1;
    }
    return { updated };
  }


}
