import { captureOwnedState, restoreOwnedState, TransferState } from '../data-transfer/restore-state';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma, Workplace as WorkplaceRow } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { DEFAULT_WORKPLACE_CURRENCY, DEFAULT_WORKPLACE_SCHEDULE, resolveWorkplaceCurrency, resolveWorkplaceTimeZone, workplaceReferenceData } from '../time/workplace-time-zone';

type ProfileInput = {
  id?: string;
  platformAccountId?: string;
  key: string;
  name: string;
  surname: string;
  phone: string;
  phones: string[];
  telegrams: string[];
  emails: string[];
  about: string;
  photo: string;
  photoCropX: number;
  photoCropY: number;
  profession: string;
  experience: string;
  professionAbout: string;
  cardAppearance: Record<string, unknown>;
};

type LinkInput = { type: string; url: string };

type WorkplaceInput = {
  key: string;
  profileId: string;
  photo: string;
  photoCropX: number;
  photoCropY: number;
  name: string;
  color: string;
  city: string;
  address: string;
  phone: string;
  currency: string;
  timeZone: string;
  from: string;
  to: string;
  links: LinkInput[];
  about: string;
  cardAppearance: Record<string, unknown>;
  visibleInPublicBooking: boolean;
  createdAt: string;
  updatedAt: string;
};

type ProfileBundleInput = {
  profile: ProfileInput;
  customProfessions: string[];
  workplaces: WorkplaceInput[];
};

type WorkplaceCardTemplate = {
  appearance: Record<string, unknown>;
  photo: string;
};

function stringValue(value: unknown, fallback = '') {
  return typeof value === 'string' ? value : value == null ? fallback : String(value);
}

function stringList(value: unknown) {
  return (Array.isArray(value) ? value : [])
    .map((item) => stringValue(item).trim())
    .filter(Boolean);
}

function cropPosition(value: unknown, fallback = 50) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(0, Math.min(100, Math.round(numeric)));
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function normalizeLinks(value: unknown): LinkInput[] {
  return (Array.isArray(value) ? value : [])
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
    .map((item) => ({ type: stringValue(item.type), url: stringValue(item.url) }));
}

function normalizeProfile(value: unknown): ProfileInput {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const phones = stringList(source.phones);
  const fallbackPhone = stringValue(source.phone).trim();
  const normalizedPhones = phones.length ? phones : fallbackPhone ? [fallbackPhone] : [];
  const professionValue = stringValue(source.profession).trim();
  const profession = professionValue.toLocaleLowerCase('ru-RU') === 'другая' ? '' : professionValue;
  return {
    key: stringValue(source.key, 'profile') || 'profile',
    name: stringValue(source.name),
    surname: stringValue(source.surname),
    phone: normalizedPhones[0] || '',
    phones: normalizedPhones,
    telegrams: stringList(source.telegrams),
    emails: stringList(source.emails),
    about: stringValue(source.about),
    photo: stringValue(source.photo),
    photoCropX: cropPosition(source.photoCropX),
    photoCropY: cropPosition(source.photoCropY),
    profession,
    experience: stringValue(source.experience),
    professionAbout: stringValue(source.professionAbout),
    cardAppearance: objectValue(source.cardAppearance),
  };
}

function normalizeWorkplace(value: unknown): WorkplaceInput {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  return {
    key: stringValue(source.key).trim(),
    profileId: stringValue(source.profileId, 'profile') || 'profile',
    photo: stringValue(source.photo),
    photoCropX: cropPosition(source.photoCropX),
    photoCropY: cropPosition(source.photoCropY),
    name: stringValue(source.name),
    color: stringValue(source.color),
    city: stringValue(source.city),
    address: stringValue(source.address),
    phone: stringValue(source.phone),
    currency: resolveWorkplaceCurrency(source.city, source.currency || DEFAULT_WORKPLACE_CURRENCY),
    timeZone: resolveWorkplaceTimeZone(source.city, source.timeZone),
    from: stringValue(source.from, DEFAULT_WORKPLACE_SCHEDULE.from) || DEFAULT_WORKPLACE_SCHEDULE.from,
    to: stringValue(source.to, DEFAULT_WORKPLACE_SCHEDULE.to) || DEFAULT_WORKPLACE_SCHEDULE.to,
    links: normalizeLinks(source.links),
    about: stringValue(source.about),
    cardAppearance: objectValue(source.cardAppearance),
    visibleInPublicBooking: source.visibleInPublicBooking !== false,
    createdAt: stringValue(source.createdAt),
    updatedAt: stringValue(source.updatedAt),
  };
}

function normalizeBundle(value: unknown): ProfileBundleInput {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const workplaces = (Array.isArray(source.workplaces) ? source.workplaces : []).map(normalizeWorkplace);
  const keys = workplaces.map((item) => item.key);
  if (keys.some((key) => !key)) throw new BadRequestException('Не удалось определить рабочее пространство');
  if (new Set(keys).size !== keys.length) throw new BadRequestException('Обнаружены повторяющиеся рабочие пространства');
  return {
    profile: normalizeProfile(source.profile),
    customProfessions: stringList(source.customProfessions),
    workplaces,
  };
}

function profileData(profile: ProfileInput, customProfessions: string[]) {
  return {
    key: profile.key,
    name: profile.name,
    surname: profile.surname,
    phone: profile.phone,
    phones: profile.phones as Prisma.InputJsonValue,
    telegrams: profile.telegrams as Prisma.InputJsonValue,
    emails: profile.emails as Prisma.InputJsonValue,
    about: profile.about,
    photo: profile.photo,
    photoCropX: profile.photoCropX,
    photoCropY: profile.photoCropY,
    profession: profile.profession,
    experience: profile.experience,
    professionAbout: profile.professionAbout,
    cardAppearance: profile.cardAppearance as Prisma.InputJsonValue,
    customProfessions: customProfessions as Prisma.InputJsonValue,
  };
}

function workplaceData(workplace: WorkplaceInput, position: number) {
  return {
    key: workplace.key,
    position,
    photo: workplace.photo,
    photoCropX: workplace.photoCropX,
    photoCropY: workplace.photoCropY,
    name: workplace.name,
    color: workplace.color,
    city: workplace.city,
    address: workplace.address,
    phone: workplace.phone,
    currency: workplace.currency,
    timeZone: workplace.timeZone,
    from: workplace.from,
    to: workplace.to,
    links: workplace.links as Prisma.InputJsonValue,
    about: workplace.about,
    cardAppearance: workplace.cardAppearance as Prisma.InputJsonValue,
    visibleInPublicBooking: workplace.visibleInPublicBooking,
    sourceCreatedAt: workplace.createdAt,
    sourceUpdatedAt: workplace.updatedAt,
  };
}

function workplaceDto(workplace: WorkplaceRow): WorkplaceInput {
  return {
    key: workplace.key,
    profileId: 'profile',
    photo: workplace.photo,
    photoCropX: workplace.photoCropX,
    photoCropY: workplace.photoCropY,
    name: workplace.name,
    color: workplace.color,
    city: workplace.city,
    address: workplace.address,
    phone: workplace.phone,
    currency: workplace.currency,
    timeZone: workplace.timeZone,
    from: workplace.from,
    to: workplace.to,
    links: normalizeLinks(workplace.links),
    about: workplace.about,
    cardAppearance: objectValue(workplace.cardAppearance),
    visibleInPublicBooking: workplace.visibleInPublicBooking,
    createdAt: workplace.sourceCreatedAt,
    updatedAt: workplace.sourceUpdatedAt,
  };
}

function hasConfiguredCardAppearance(value: unknown) {
  const appearance = objectValue(value);
  return Array.isArray(appearance.lines)
    && appearance.lines.some((line) => line && typeof line === 'object' && !Array.isArray(line) && stringValue((line as Record<string, unknown>).field).trim());
}

function workplaceCardTemplate(value: unknown): WorkplaceCardTemplate {
  const source = objectValue(value);
  const templates = Array.isArray(source.cardAppearanceTemplates) ? source.cardAppearanceTemplates : [];
  const template = templates
    .filter((item) => item && typeof item === 'object' && !Array.isArray(item))
    .map((item) => objectValue(item))
    .find((item) => stringValue(item.scope).trim() === 'workplace') || {};
  return {
    appearance: objectValue(template.appearance),
    photo: stringValue(template.photo),
  };
}

function effectiveWorkplaceCardAppearance(workplace: WorkplaceRow, template: WorkplaceCardTemplate) {
  const appearance = objectValue(workplace.cardAppearance);
  if (hasConfiguredCardAppearance(appearance)) return appearance;
  if (hasConfiguredCardAppearance(template.appearance)) return template.appearance;
  return appearance;
}

function publicWorkplaceCardProfile(workplace: WorkplaceRow, profile: any, appearanceValue: unknown = workplace.cardAppearance) {
  const appearance = objectValue(appearanceValue);
  const lines = Array.isArray(appearance.lines)
    ? appearance.lines.filter((line) => line && typeof line === 'object' && !Array.isArray(line)) as Record<string, unknown>[]
    : [];
  const selected = new Set(lines.map((line) => stringValue(line.field).trim()).filter(Boolean));
  if (!selected.size) {
    selected.add('profileName');
    selected.add('profession');
    selected.add('profilePhone');
  }
  const uses = (...fields: string[]) => fields.some((field) => selected.has(field));
  const result: Record<string, unknown> = {};
  if (uses('profileName', 'profileFirstName')) result.name = stringValue(profile?.name);
  if (uses('profileName', 'profileSurname')) result.surname = stringValue(profile?.surname);
  if (uses('profession')) result.profession = stringValue(profile?.profession);
  if (uses('profilePhone')) {
    result.phone = stringValue(profile?.phone);
    result.phones = stringList(profile?.phones);
  }
  if (uses('profileEmail')) result.emails = stringList(profile?.emails);
  if (uses('profileTelegram')) result.telegrams = stringList(profile?.telegrams);
  if (uses('profileExperience')) result.experience = stringValue(profile?.experience);
  if (uses('profileAbout')) result.about = stringValue(profile?.about);
  if (uses('profileProfessionAbout')) result.professionAbout = stringValue(profile?.professionAbout);
  return result;
}

function canonical(value: ProfileBundleInput) {
  return JSON.stringify(value);
}

function normalizeProfessionName(value: unknown) {
  return stringValue(value).trim().replace(/\s+/g, ' ');
}

function normalizeProfessionKey(value: unknown) {
  return normalizeProfessionName(value).toLocaleLowerCase('ru-RU');
}

type ProfessionClient = Pick<Prisma.TransactionClient, 'platformProfession'>;

@Injectable()
export class ProfileService {
  transferState(tx: Prisma.TransactionClient, tenantId: string) { return captureOwnedState(tx, tenantId, ['Workplace', 'BookingPublication', 'BookingPublicRoute']); }
  restoreTransfer(tx: Prisma.TransactionClient, tenantId: string, before: TransferState, after: TransferState, checkOnly = false) { return restoreOwnedState(tx,tenantId,['Workplace', 'BookingPublication', 'BookingPublicRoute'],before,after,checkOnly); }

  constructor(private readonly prisma: PrismaService) {}

  private async observeProfessions(client: ProfessionClient, values: unknown[]) {
    const unique = new Map<string, string>();
    for (const value of values) {
      const name = normalizeProfessionName(value);
      const normalizedName = normalizeProfessionKey(name);
      if (!name || !normalizedName || normalizedName === 'другая' || name.length > 120 || unique.has(normalizedName)) continue;
      unique.set(normalizedName, name);
    }
    const now = new Date();
    for (const [normalizedName, name] of unique) {
      await client.platformProfession.upsert({
        where: { normalizedName },
        create: { normalizedName, name, firstSeenAt: now, lastSeenAt: now },
        update: { lastSeenAt: now },
      });
    }
  }

  private async bundle(tenantId: string, platformAccountId: string) {
    const [row, professionRows] = await Promise.all([
      this.prisma.profile.findUnique({
        where: { tenantId_platformAccountId: { tenantId, platformAccountId } },
        include: { workplaces: { where: { deletedAt: null }, orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] } },
      }),
      this.prisma.platformProfession.findMany({ orderBy: [{ name: 'asc' }], select: { name: true } }),
    ]);
    if (!row) throw new NotFoundException('Профиль не найден');
    return {
      profile: {
        id: row.id,
        platformAccountId: row.platformAccountId,
        key: row.key,
        name: row.name,
        surname: row.surname,
        phone: row.phone,
        phones: stringList(row.phones),
        telegrams: stringList(row.telegrams),
        emails: stringList(row.emails),
        about: row.about,
        photo: row.photo,
        photoCropX: row.photoCropX,
        photoCropY: row.photoCropY,
        profession: row.profession,
        experience: row.experience,
        professionAbout: row.professionAbout,
        cardAppearance: objectValue(row.cardAppearance),
      },
      customProfessions: stringList(row.customProfessions),
      professionCatalog: professionRows.map((item) => item.name),
      workplaceReferenceData: workplaceReferenceData(),
      workplaces: row.workplaces.map(workplaceDto),
    };
  }

  private async ensureProfile(tenantId: string, platformAccountId: string) {
    const existing = await this.prisma.profile.findUnique({ where: { tenantId_platformAccountId: { tenantId, platformAccountId } } });
    if (existing) return existing;
    const account = await this.prisma.platformAccount.findUnique({ where: { id: platformAccountId }, select: { email: true } });
    const empty = normalizeProfile({ emails: account?.email ? [account.email] : [] });
    return this.prisma.profile.create({ data: { tenantId, platformAccountId, ...profileData(empty, []) } });
  }

  async get(tenantId: string, platformAccountId: string) {
    await this.ensureProfile(tenantId, platformAccountId);
    return this.bundle(tenantId, platformAccountId);
  }

  async updateProfile(tenantId: string, platformAccountId: string, body: unknown) {
    const current = await this.ensureProfile(tenantId, platformAccountId);
    const source = body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : {};
    const profile = normalizeProfile(source.profile ?? source);
    const customProfessions = source.customProfessions === undefined
      ? stringList(current.customProfessions)
      : stringList(source.customProfessions);
    const saved = await this.prisma.$transaction(async (tx) => {
      const row = await tx.profile.update({
        where: { tenantId_platformAccountId: { tenantId, platformAccountId } },
        data: profileData(profile, customProfessions),
      });
      await this.observeProfessions(tx, [profile.profession, ...customProfessions]);
      return row;
    });
    const professionRows = await this.prisma.platformProfession.findMany({
      orderBy: [{ name: 'asc' }],
      select: { name: true },
    });
    return {
      profile: {
        id: saved.id,
        platformAccountId: saved.platformAccountId,
        key: saved.key,
        name: saved.name,
        surname: saved.surname,
        phone: saved.phone,
        phones: stringList(saved.phones),
        telegrams: stringList(saved.telegrams),
        emails: stringList(saved.emails),
        about: saved.about,
        photo: saved.photo,
        photoCropX: saved.photoCropX,
        photoCropY: saved.photoCropY,
        profession: saved.profession,
        experience: saved.experience,
        professionAbout: saved.professionAbout,
        cardAppearance: objectValue(saved.cardAppearance),
      },
      customProfessions: stringList(saved.customProfessions),
      professionCatalog: professionRows.map((item) => item.name),
    };
  }

  async reorderWorkplaces(tenantId: string, platformAccountId: string, body: unknown) {
    const profile = await this.prisma.profile.findUnique({
      where: { tenantId_platformAccountId: { tenantId, platformAccountId } },
      include: { workplaces: { where: { deletedAt: null }, orderBy: [{ position: 'asc' }, { createdAt: 'asc' }], select: { id: true, key: true } } },
    });
    if (!profile) throw new NotFoundException('Профиль не найден');

    const source = body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : {};
    const keys = Array.isArray(source.keys) ? source.keys.map((value) => stringValue(value).trim()).filter(Boolean) : [];
    const uniqueKeys = [...new Set(keys)];
    const currentKeys = profile.workplaces.map((item) => item.key);
    if (uniqueKeys.length !== currentKeys.length || uniqueKeys.some((key) => !currentKeys.includes(key))) {
      throw new BadRequestException('Некорректный порядок рабочих пространств');
    }

    const byKey = new Map(profile.workplaces.map((item) => [item.key, item.id]));
    await this.prisma.$transaction(uniqueKeys.map((key, position) => this.prisma.workplace.update({
      where: { id: byKey.get(key)! },
      data: { position },
    })));
    return this.bundle(tenantId, platformAccountId);
  }

  async upsertWorkplace(tenantId: string, platformAccountId: string, key: string, body: unknown) {
    const profile = await this.prisma.profile.findUnique({
      where: { tenantId_platformAccountId: { tenantId, platformAccountId } },
      include: { workplaces: { where: { deletedAt: null }, select: { position: true } } },
    });
    if (!profile) throw new NotFoundException('Профиль не найден');

    const workplace = normalizeWorkplace({
      ...(body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : {}),
      key,
    });
    if (!workplace.key) throw new BadRequestException('Не удалось определить рабочее пространство');
    const existing = await this.prisma.workplace.findUnique({ where: { tenantId_key: { tenantId, key: workplace.key } } });
    const now = new Date().toISOString();
    const position = existing ? existing.position : (profile.workplaces.reduce((max, item) => Math.max(max, item.position), -1) + 1);
    const normalized = {
      ...workplace,
      createdAt: existing?.sourceCreatedAt || workplace.createdAt || now,
      updatedAt: now,
    };

    await this.prisma.workplace.upsert({
      where: { tenantId_key: { tenantId, key: workplace.key } },
      create: {
        tenantId,
        profileId: profile.id,
        ...workplaceData(normalized, position),
      },
      update: { ...workplaceData(normalized, position), deletedAt: null },
    });
    return this.bundle(tenantId, platformAccountId);
  }

  async resolveTransferWorkplace(tenantId: string, input: Record<string, any>, tx: Prisma.TransactionClient) {
    const key = stringValue(input.workplaceKey).trim();
    const name = stringValue(input.workplace).trim();
    const rows = await tx.workplace.findMany({ where: { tenantId, deletedAt: null, ...(key ? { key } : { name }) } });
    if ((!key && !name) || rows.length !== 1) throw new BadRequestException('Не удалось однозначно определить рабочее пространство');
    if (key && name && rows[0].name !== name) throw new BadRequestException('Название рабочего пространства не совпадает с указанным ID');
    return rows[0];
  }

  async importWorkplace(tenantId: string, platformAccountId: string, input: Record<string, any>, targetId: string, tx: Prisma.TransactionClient) {
    if (!stringValue(input.name).trim()) throw new BadRequestException('Не указано название рабочего пространства');
    const profile = await tx.profile.findUnique({ where: { tenantId_platformAccountId: { tenantId, platformAccountId } } });
    if (!profile) throw new NotFoundException('Профиль не найден');
    const rows = await tx.workplace.findMany({ where: { tenantId, deletedAt: null } });
    const named = rows.filter(row => row.name === stringValue(input.name).trim());
    if (!targetId && !stringValue(input.workplaceKey).trim() && named.length > 1) throw new BadRequestException('Не удалось однозначно определить рабочее пространство');
    const key = targetId || stringValue(input.workplaceKey).trim() || named[0]?.key || randomUUID();
    const previous = rows.find(row => row.key === key);
    if (targetId && !previous) throw new NotFoundException('Перенесённое рабочее пространство не найдено');
    const value = normalizeWorkplace({ ...(previous || {}), ...input, key });
    const position = previous?.position ?? rows.length;
    await tx.workplace.upsert({ where: { tenantId_key: { tenantId, key } },
      create: { tenantId, profileId: profile.id, ...workplaceData(value, position) }, update: workplaceData(value, position) });
    return key;
  }

  async deleteWorkplace(tenantId: string, platformAccountId: string, key: string) {
    const profile = await this.prisma.profile.findUnique({ where: { tenantId_platformAccountId: { tenantId, platformAccountId } } });
    if (!profile) throw new NotFoundException('Профиль не найден');
    const existing = await this.prisma.workplace.findUnique({ where: { tenantId_key: { tenantId, key } } });
    if (!existing || existing.profileId !== profile.id) throw new NotFoundException('Рабочее пространство не найдено');
    await this.prisma.workplace.update({
      where: { tenantId_key: { tenantId, key } },
      data: { deletedAt: new Date() },
    });
    return this.bundle(tenantId, platformAccountId);
  }

  async accountControls(tenantId: string, platformAccountId: string) {
    const [documents, preferences] = await Promise.all([
      this.prisma.$queryRaw<Array<{
        documentId: string;
        key: string;
        type: string;
        title: string;
        requiredForRegistration: boolean;
        currentVersion: number;
        currentText: string;
        latestAction: string | null;
        latestOccurredAt: Date | null;
        latestVersion: number | null;
        latestText: string | null;
      }>>`
        SELECT
          d."id" AS "documentId",
          d."key",
          d."type",
          d."title",
          d."requiredForRegistration",
          current_v."version" AS "currentVersion",
          current_v."contentSnapshot" AS "currentText",
          latest_event."action" AS "latestAction",
          latest_event."occurredAt" AS "latestOccurredAt",
          latest_event."documentVersion" AS "latestVersion",
          latest_event."contentSnapshot" AS "latestText"
        FROM "PlatformDocument" d
        JOIN LATERAL (
          SELECT "version","contentSnapshot"
          FROM "PlatformDocumentVersion"
          WHERE "documentId" = d."id"
          ORDER BY "version" DESC
          LIMIT 1
        ) current_v ON true
        LEFT JOIN LATERAL (
          SELECT e."action", e."occurredAt", v."version" AS "documentVersion", v."contentSnapshot"
          FROM "PlatformConsentEvent" e
          JOIN "PlatformDocumentVersion" v ON v."id" = e."documentVersionId"
          WHERE e."platformAccountId" = ${platformAccountId}
            AND v."documentId" = d."id"
          ORDER BY e."occurredAt" DESC, e."id" DESC
          LIMIT 1
        ) latest_event ON true
        WHERE d."isActive" = true
          AND d."type" LIKE '%CONSENT%'
        ORDER BY d."requiredForRegistration" DESC, d."createdAt" ASC
      `,
      this.prisma.platformNotificationPreference.findUnique({
        where: { tenantId_platformAccountId: { tenantId, platformAccountId } },
      }),
    ]);

    const history = await this.prisma.$queryRaw<Array<{
      id: string;
      key: string;
      title: string;
      version: number;
      action: string;
      occurredAt: Date;
    }>>`
      SELECT
        e."id",
        d."key",
        d."title",
        v."version",
        e."action",
        e."occurredAt"
      FROM "PlatformConsentEvent" e
      JOIN "PlatformDocumentVersion" v ON v."id" = e."documentVersionId"
      JOIN "PlatformDocument" d ON d."id" = v."documentId"
      WHERE e."platformAccountId" = ${platformAccountId}
        AND d."type" LIKE '%CONSENT%'
      ORDER BY e."occurredAt" DESC, e."id" DESC
      LIMIT 200
    `;

    return {
      consents: documents.map((document) => {
        const active = document.latestAction === 'CONSENTED' && document.latestVersion === document.currentVersion;
        return {
          key: document.key,
          title: document.title,
          requiredForRegistration: document.requiredForRegistration,
          currentVersion: document.currentVersion,
          action: active ? 'CONSENTED' : (document.latestAction || 'DECLINED'),
          eventVersion: document.latestVersion,
          displayVersion: active ? document.latestVersion : document.currentVersion,
          documentText: active ? (document.latestText || document.currentText) : document.currentText,
          occurredAt: document.latestOccurredAt?.toISOString() || '',
          active,
        };
      }),
      history: history.map((event) => ({
        ...event,
        occurredAt: event.occurredAt.toISOString(),
      })),
      serviceNotifications: {
        email: preferences?.emailEnabled ?? true,
      },
    };
  }

  async setAccountConsent(
    tenantId: string,
    platformAccountId: string,
    documentKeyValue: unknown,
    activeValue: unknown,
  ) {
    const documentKey = stringValue(documentKeyValue).trim();
    const active = Boolean(activeValue);
    const rows = await this.prisma.$queryRaw<Array<{ documentVersionId: string; title: string; type: string; version: number }>>`
      SELECT
        v."id" AS "documentVersionId",
        d."title",
        d."type",
        v."version"
      FROM "PlatformDocument" d
      JOIN LATERAL (
        SELECT *
        FROM "PlatformDocumentVersion"
        WHERE "documentId" = d."id"
        ORDER BY "version" DESC
        LIMIT 1
      ) v ON true
      WHERE d."key" = ${documentKey}
        AND d."isActive" = true
      LIMIT 1
    `;
    const document = rows[0];
    if (!document || !document.type.includes('CONSENT')) {
      throw new BadRequestException('Согласие не найдено');
    }

    const now = new Date();
    const action = active ? 'CONSENTED' : 'REVOKED';
    await this.prisma.$executeRaw`
      INSERT INTO "PlatformConsentEvent" (
        "id","tenantId","platformAccountId","documentVersionId",
        "action","source","technicalEvidence","occurredAt"
      ) VALUES (
        ${randomUUID()},${tenantId},${platformAccountId},${document.documentVersionId},
        ${action},'profile-controls',
        ${JSON.stringify({ documentKey, documentVersion: document.version })}::jsonb,${now}
      )
    `;
    return this.accountControls(tenantId, platformAccountId);
  }

  async setServiceNotifications(
    tenantId: string,
    platformAccountId: string,
    input: unknown,
  ) {
    const source = input && typeof input === 'object' && !Array.isArray(input)
      ? input as Record<string, unknown>
      : {};
    const emailEnabled = source.email === undefined ? true : Boolean(source.email);
    await this.prisma.platformNotificationPreference.upsert({
      where: { tenantId_platformAccountId: { tenantId, platformAccountId } },
      create: { tenantId, platformAccountId, emailEnabled },
      update: { emailEnabled },
    });
    return this.accountControls(tenantId, platformAccountId);
  }

  async accountRelationshipProfile(tenantId: string) {
    const row = await this.prisma.profile.findFirst({
      where: { tenantId },
      include: { workplaces: { where: { deletedAt: null }, orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] } },
      orderBy: { createdAt: 'asc' },
    });
    if (!row) throw new ConflictException('Профиль ещё не готов');
    return {
      name: row.name,
      surname: row.surname,
      phone: row.phone,
      photo: row.photo,
      photoCropX: row.photoCropX,
      photoCropY: row.photoCropY,
      profession: row.profession,
      about: row.about,
      cardAppearance: objectValue(row.cardAppearance),
      workplaces: row.workplaces.map(workplaceDto),
    };
  }

  async publicBookingRouteSource(tenantId: string) {
    const row = await this.prisma.profile.findFirst({
      where: { tenantId },
      include: {
        workplaces: {
          where: { deletedAt: null },
          orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
          select: { id: true, key: true, name: true },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
    if (!row) throw new ConflictException('Профиль для онлайн-записи ещё не готов');
    return {
      profile: {
        id: row.id,
        name: row.name,
        surname: row.surname,
      },
      workplaces: row.workplaces.map((workplace) => ({
        id: workplace.id,
        key: workplace.key,
        name: workplace.name,
      })),
    };
  }

  async publicBookingBundle(tenantId: string) {
    const [row, auxiliaryState] = await Promise.all([
      this.prisma.profile.findFirst({
        where: { tenantId },
        include: { workplaces: { where: { deletedAt: null }, orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] } },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.businessAuxiliaryState.findUnique({ where: { tenantId }, select: { data: true } }),
    ]);
    if (!row) throw new ConflictException('Профиль для онлайн-записи ещё не готов');
    const cardTemplate = workplaceCardTemplate(auxiliaryState?.data);
    return {
      profile: {
        name: row.name,
        surname: row.surname,
        photo: row.photo,
        profession: row.profession,
        about: row.about,
        cardAppearance: objectValue(row.cardAppearance),
      },
      workplaces: row.workplaces.map((workplace) => {
        const dto = workplaceDto(workplace);
        const cardAppearance = effectiveWorkplaceCardAppearance(workplace, cardTemplate);
        return {
          ...dto,
          photo: dto.photo || cardTemplate.photo,
          cardAppearance,
          cardProfile: publicWorkplaceCardProfile(workplace, row, cardAppearance),
        };
      }),
      updatedAt: row.updatedAt,
    };
  }

}
