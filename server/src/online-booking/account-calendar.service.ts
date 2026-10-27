import { BadRequestException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma.service';
import { EventService } from '../event/event.service';
import { OnlineBookingService } from './online-booking.service';
import {
  AccountCalendarGoogleAdapter,
  type ExternalCalendar,
  type ExternalCalendarEvent,
  type GoogleCalendarCredentials,
} from './account-calendar-google.adapter';
import {
  AccountCalendarYandexAdapter,
  type YandexCalendar,
  type YandexCalendarCredentials,
} from './account-calendar-yandex.adapter';

type Provider = 'google' | 'yandex';
type SecretBox = { encrypted: string; iv: string; tag: string };
type LocalPayload = {
  title: string;
  description: string;
  date: string;
  from: string;
  to: string;
  localType: 'event' | 'record';
  localId: string;
  updatedAt: string;
};

function text(value: unknown) { return String(value ?? '').trim(); }
function objectValue(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
}
function arrayValue(value: unknown): any[] { return Array.isArray(value) ? value : []; }
function sha(value: unknown) { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function providerValue(value: unknown): Provider {
  const provider = text(value).toLowerCase();
  if (provider !== 'google' && provider !== 'yandex') throw new BadRequestException('Неизвестный календарь');
  return provider;
}
function externalTimestamp(value: string) {
  const raw = text(value);
  if (!raw) return 0;
  const compact = raw.match(/^(\d{4})(\d{2})(\d{2})T?(\d{2})?(\d{2})?(\d{2})?Z?$/);
  if (compact) {
    return Date.UTC(
      Number(compact[1]), Number(compact[2]) - 1, Number(compact[3]),
      Number(compact[4] || 0), Number(compact[5] || 0), Number(compact[6] || 0),
    );
  }
  const parsed = new Date(raw).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

@Injectable()
export class AccountCalendarService {
  private readonly logger = new Logger(AccountCalendarService.name);
  private readonly syncing = new Map<string, Promise<any>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly events: EventService,
    private readonly booking: OnlineBookingService,
    private readonly google: AccountCalendarGoogleAdapter,
    private readonly yandex: AccountCalendarYandexAdapter,
  ) {}

  private encryptionKey() {
    const secret = text(process.env.ACCOUNT_CALENDAR_CREDENTIALS_KEY);
    if (!secret) throw new ServiceUnavailableException('Подключение календарей пока не настроено');
    return createHash('sha256').update(secret).digest();
  }

  private encrypt(value: unknown): SecretBox {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.encryptionKey(), iv);
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
    return {
      encrypted: encrypted.toString('base64url'),
      iv: iv.toString('base64url'),
      tag: cipher.getAuthTag().toString('base64url'),
    };
  }

  private decrypt<T>(connection: any): T {
    const decipher = createDecipheriv(
      'aes-256-gcm',
      this.encryptionKey(),
      Buffer.from(text(connection.credentialsIv), 'base64url'),
    );
    decipher.setAuthTag(Buffer.from(text(connection.credentialsTag), 'base64url'));
    const raw = Buffer.concat([
      decipher.update(Buffer.from(text(connection.encryptedCredentials), 'base64url')),
      decipher.final(),
    ]).toString('utf8');
    return JSON.parse(raw) as T;
  }

  private async saveCredentials(connectionId: string, credentials: unknown) {
    const box = this.encrypt(credentials);
    await this.prisma.accountCalendarConnection.update({
      where: { id: connectionId },
      data: {
        encryptedCredentials: box.encrypted,
        credentialsIv: box.iv,
        credentialsTag: box.tag,
      },
    });
  }

  private googleReady() {
    return Boolean(text(process.env.ACCOUNT_CALENDAR_CREDENTIALS_KEY) && this.google.available() && /^https:\/\//i.test(text(process.env.PUBLIC_API_URL)));
  }

  private yandexReady() {
    return Boolean(text(process.env.ACCOUNT_CALENDAR_CREDENTIALS_KEY) && this.yandex.available());
  }

  async status(accountId: string) {
    const connections = await this.prisma.accountCalendarConnection.findMany({
      where: { accountId },
      include: { bindings: { orderBy: [{ primary: 'desc' }, { name: 'asc' }] } },
      orderBy: { provider: 'asc' },
    });
    const byProvider = new Map(connections.map((connection) => [connection.provider, connection]));
    const project = (provider: Provider, available: boolean) => {
      const connection = byProvider.get(provider);
      return {
        provider,
        available,
        connected: Boolean(connection && connection.status === 'active'),
        label: connection?.label || '',
        exportCalendarId: connection?.exportCalendarId || '',
        lastSyncAt: connection?.lastSyncAt?.toISOString?.() || '',
        lastError: connection?.lastError || '',
        calendars: (connection?.bindings || []).map((binding: any) => ({
          id: binding.externalCalendarId,
          name: binding.name,
          enabled: binding.enabled,
          writable: binding.writable,
          primary: binding.primary,
          export: binding.externalCalendarId === connection?.exportCalendarId,
        })),
      };
    };
    return {
      google: project('google', this.googleReady()),
      yandex: project('yandex', this.yandexReady()),
    };
  }

  async beginGoogle(accountId: string) {
    if (!this.googleReady()) throw new ServiceUnavailableException('Google Calendar пока не настроен на сервере');
    const state = await this.jwt.signAsync({ kind: 'account-calendar-google', accountId }, { expiresIn: '10m' });
    return { url: this.google.authorizationUrl(state) };
  }

  async finishGoogle(codeValue: unknown, stateValue: unknown) {
    const code = text(codeValue);
    const state = text(stateValue);
    if (!code || !state) throw new BadRequestException('Google не вернул данные подключения');
    let payload: any;
    try {
      payload = await this.jwt.verifyAsync(state);
    } catch {
      throw new BadRequestException('Срок подключения Google истёк. Подключите календарь ещё раз.');
    }
    if (payload?.kind !== 'account-calendar-google' || !text(payload?.accountId)) throw new BadRequestException('Некорректное подключение Google');
    const accountId = text(payload.accountId);
    const credentials = await this.google.exchangeCode(code);
    const calendars = await this.google.calendars(credentials);
    await this.replaceConnection(accountId, 'google', calendars.find((calendar) => calendar.primary)?.name || 'Google Calendar', credentials, calendars);
    await this.syncAccount(accountId, { force: true });
    return { accountId };
  }

  async connectYandex(accountId: string, input: unknown) {
    if (!this.yandexReady()) throw new ServiceUnavailableException('Яндекс Календарь пока не настроен на сервере');
    const source = objectValue(input);
    const credentials: YandexCalendarCredentials = {
      login: text(source.login),
      password: text(source.password),
    };
    if (!credentials.login || !credentials.password) throw new BadRequestException('Укажите логин Яндекса и пароль приложения Календаря');
    const calendars = await this.yandex.calendars(credentials);
    await this.replaceConnection(accountId, 'yandex', credentials.login, credentials, calendars);
    await this.syncAccount(accountId, { force: true });
    return this.status(accountId);
  }

  private async replaceConnection(
    accountId: string,
    provider: Provider,
    label: string,
    credentials: GoogleCalendarCredentials | YandexCalendarCredentials,
    calendars: Array<ExternalCalendar | YandexCalendar>,
  ) {
    const account = await this.prisma.account.findUnique({ where: { id: accountId }, select: { id: true } });
    if (!account) throw new BadRequestException('Аккаунт не найден');
    const box = this.encrypt(credentials);
    const existing = await this.prisma.accountCalendarConnection.findUnique({
      where: { accountId_provider: { accountId, provider } },
    });
    let connection: any;
    if (existing) {
      await this.prisma.accountCalendarItemLink.deleteMany({ where: { connectionId: existing.id } });
      await this.prisma.accountCalendarBinding.deleteMany({ where: { connectionId: existing.id } });
      connection = await this.prisma.accountCalendarConnection.update({
        where: { id: existing.id },
        data: {
          label,
          status: 'active',
          encryptedCredentials: box.encrypted,
          credentialsIv: box.iv,
          credentialsTag: box.tag,
          exportCalendarId: '',
          lastError: '',
          lastSyncAt: null,
        },
      });
    } else {
      connection = await this.prisma.accountCalendarConnection.create({
        data: {
          accountId,
          provider,
          label,
          status: 'active',
          encryptedCredentials: box.encrypted,
          credentialsIv: box.iv,
          credentialsTag: box.tag,
        },
      });
    }
    const rows = calendars.filter((calendar) => text(calendar.id));
    if (!rows.length) throw new BadRequestException('В календаре нет доступных календарей');
    await this.prisma.accountCalendarBinding.createMany({
      data: rows.map((calendar) => ({
        connectionId: connection.id,
        externalCalendarId: text(calendar.id),
        name: text(calendar.name) || provider,
        enabled: true,
        writable: Boolean(calendar.writable),
        primary: Boolean(calendar.primary),
        timeZone: text(calendar.timeZone) || 'UTC',
        collectionUrl: text((calendar as YandexCalendar).collectionUrl),
      })),
    });
    const exportCalendar = rows.find((calendar) => calendar.primary && calendar.writable)
      || rows.find((calendar) => calendar.writable)
      || null;
    await this.prisma.accountCalendarConnection.update({
      where: { id: connection.id },
      data: { exportCalendarId: text(exportCalendar?.id) },
    });
  }

  async disconnect(accountId: string, providerValueRaw: unknown) {
    const provider = providerValue(providerValueRaw);
    const connection = await this.prisma.accountCalendarConnection.findUnique({
      where: { accountId_provider: { accountId, provider } },
    });
    if (connection) await this.prisma.accountCalendarConnection.delete({ where: { id: connection.id } });
    return this.status(accountId);
  }

  async setExportCalendar(accountId: string, providerValueRaw: unknown, calendarIdValue: unknown) {
    const provider = providerValue(providerValueRaw);
    const calendarId = text(calendarIdValue);
    const connection = await this.prisma.accountCalendarConnection.findUnique({
      where: { accountId_provider: { accountId, provider } },
      include: { bindings: true },
    });
    if (!connection) throw new BadRequestException('Календарь не подключён');
    const binding = connection.bindings.find((item) => item.externalCalendarId === calendarId && item.writable && item.enabled);
    if (!binding) throw new BadRequestException('Этот календарь нельзя использовать для записи событий');
    await this.prisma.accountCalendarConnection.update({ where: { id: connection.id }, data: { exportCalendarId: calendarId } });
    return this.status(accountId);
  }

  async syncAccount(accountId: string, { force = false } = {}) {
    const running = this.syncing.get(accountId);
    if (running) return running;
    const job = this.syncAccountNow(accountId, force).finally(() => {
      if (this.syncing.get(accountId) === job) this.syncing.delete(accountId);
    });
    this.syncing.set(accountId, job);
    return job;
  }

  private async syncAccountNow(accountId: string, force: boolean) {
    const connections = await this.prisma.accountCalendarConnection.findMany({
      where: { accountId, status: 'active' },
      include: { bindings: true },
    });
    if (!connections.length) return { connected: 0, synced: 0, errors: [] };
    const results = [];
    for (const connection of connections) {
      if (!force && connection.lastSyncAt && Date.now() - connection.lastSyncAt.getTime() < 15_000) {
        results.push({ provider: connection.provider, skipped: true });
        continue;
      }
      try {
        await this.syncConnection(connection);
        await this.prisma.accountCalendarConnection.update({
          where: { id: connection.id },
          data: { lastSyncAt: new Date(), lastError: '' },
        });
        results.push({ provider: connection.provider, synced: true });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Ошибка синхронизации';
        this.logger.warn(`Personal calendar sync failed (${connection.provider}/${connection.id}): ${message}`);
        await this.prisma.accountCalendarConnection.update({
          where: { id: connection.id },
          data: { lastError: message.slice(0, 1000) },
        }).catch(() => null);
        results.push({ provider: connection.provider, error: message });
      }
    }
    return {
      connected: connections.length,
      synced: results.filter((item) => item.synced).length,
      errors: results.filter((item) => item.error).map((item) => ({ provider: item.provider, message: item.error })),
    };
  }

  private async syncConnection(connection: any) {
    const provider = providerValue(connection.provider);
    const bindings = await this.prisma.accountCalendarBinding.findMany({
      where: { connectionId: connection.id, enabled: true },
    });
    if (!bindings.length) return;
    const records = await this.booking.globalAccountRecords(connection.accountId);
    const recordById = new Map<string, any>(records.map((record: any): [string, any] => [text(record?.id), record]).filter(([id]) => Boolean(id)));

    if (provider === 'google') {
      const credentials = this.decrypt<GoogleCalendarCredentials>(connection);
      for (const binding of bindings) {
        const remote = await this.google.events(credentials, binding.externalCalendarId, binding.syncToken);
        await this.pullRemote(connection, binding, remote.items, remote.fullSync, recordById);
        await this.prisma.accountCalendarBinding.update({
          where: { id: binding.id },
          data: { syncToken: remote.nextSyncToken || binding.syncToken },
        });
      }
      await this.pushLocal(connection, bindings, credentials, recordById);
      await this.saveCredentials(connection.id, credentials);
      await this.ensureGoogleWatches(connection.id, credentials);
      return;
    }

    const credentials = this.decrypt<YandexCalendarCredentials>(connection);
    for (const binding of bindings) {
      const remote = await this.yandex.events(credentials, binding.collectionUrl || binding.externalCalendarId);
      await this.pullRemote(connection, binding, remote.items, true, recordById);
    }
    await this.pushLocal(connection, bindings, credentials, recordById);
  }

  private async pullRemote(
    connection: any,
    binding: any,
    remoteItems: Array<ExternalCalendarEvent & { href?: string }>,
    fullSync: boolean,
    recordById: Map<string, any>,
  ) {
    const seen = new Set<string>();
    for (const remote of remoteItems) {
      if (!remote.id) continue;
      seen.add(remote.id);
      let link = await this.prisma.accountCalendarItemLink.findUnique({
        where: { bindingId_externalId: { bindingId: binding.id, externalId: remote.id } },
      });

      if (!link && remote.localType && remote.localId) {
        if (remote.localType === 'record' && recordById.has(remote.localId)) {
          link = await this.prisma.accountCalendarItemLink.create({
            data: {
              connectionId: connection.id,
              bindingId: binding.id,
              localType: 'record',
              localId: remote.localId,
              externalId: remote.id,
              externalHref: text(remote.href),
              externalEtag: remote.etag,
              lastExternalUpdatedAt: remote.updated,
              payloadHash: '',
            },
          });
        } else if (remote.localType === 'event') {
          const local = await this.events.getOwned('account', connection.accountId, remote.localId).catch(() => null);
          if (local) {
            link = await this.prisma.accountCalendarItemLink.create({
              data: {
                connectionId: connection.id,
                bindingId: binding.id,
                localType: 'event',
                localId: remote.localId,
                externalId: remote.id,
                externalHref: text(remote.href),
                externalEtag: remote.etag,
                lastExternalUpdatedAt: remote.updated,
                lastLocalUpdatedAt: text(local.updatedAt),
                payloadHash: this.payloadHash(this.eventPayload(local)),
              },
            });
          }
        }
      }

      if (!link) {
        if (remote.deleted || !remote.date || !remote.from || !remote.to) continue;
        const localId = randomUUID();
        const saved = await this.events.upsertOwned('account', connection.accountId, localId, {
          event: {
            id: localId,
            ownerType: 'account',
            ownerId: connection.accountId,
            context: {
              scope: 'account',
              calendarSync: {
                originProvider: connection.provider,
                connectionId: connection.id,
                bindingId: binding.id,
                externalId: remote.id,
                allDay: remote.allDay,
              },
            },
            date: remote.date,
            from: remote.from,
            to: remote.to,
            title: remote.title,
            description: remote.description,
            color: '#777A7D',
          },
        });
        const desired = this.eventPayload(saved);
        await this.prisma.accountCalendarItemLink.create({
          data: {
            connectionId: connection.id,
            bindingId: binding.id,
            localType: 'event',
            localId,
            externalId: remote.id,
            externalHref: text(remote.href),
            externalEtag: remote.etag,
            lastExternalUpdatedAt: remote.updated,
            lastLocalUpdatedAt: text(saved.updatedAt),
            payloadHash: this.payloadHash(desired),
          },
        });
        continue;
      }

      if (link.localType === 'record') {
        if (remote.deleted) {
          await this.prisma.accountCalendarItemLink.delete({ where: { id: link.id } });
          continue;
        }
        const changed = text(link.externalEtag) !== text(remote.etag)
          || text(link.lastExternalUpdatedAt) !== text(remote.updated);
        await this.prisma.accountCalendarItemLink.update({
          where: { id: link.id },
          data: {
            externalHref: text(remote.href) || link.externalHref,
            externalEtag: remote.etag,
            lastExternalUpdatedAt: remote.updated,
            ...(changed ? { payloadHash: '' } : {}),
          },
        });
        continue;
      }

      if (remote.deleted) {
        await this.events.removeOwned('account', connection.accountId, link.localId);
        await this.prisma.accountCalendarItemLink.delete({ where: { id: link.id } });
        continue;
      }

      const remoteChanged = text(link.externalEtag) !== text(remote.etag)
        || text(link.lastExternalUpdatedAt) !== text(remote.updated);
      if (!remoteChanged) continue;
      const current = await this.events.getOwned('account', connection.accountId, link.localId).catch(() => null);
      const localChanged = current && text(link.lastLocalUpdatedAt) && text(current.updatedAt) !== text(link.lastLocalUpdatedAt);
      if (localChanged && new Date(current.updatedAt).getTime() > externalTimestamp(remote.updated)) {
        await this.prisma.accountCalendarItemLink.update({ where: { id: link.id }, data: { payloadHash: '' } });
        continue;
      }
      const saved = await this.events.upsertOwned('account', connection.accountId, link.localId, {
        event: {
          ...(current || {}),
          id: link.localId,
          ownerType: 'account',
          ownerId: connection.accountId,
          context: {
            ...objectValue(current?.context),
            scope: 'account',
            calendarSync: {
              ...objectValue(objectValue(current?.context).calendarSync),
              originProvider: connection.provider,
              connectionId: connection.id,
              bindingId: binding.id,
              externalId: remote.id,
              allDay: remote.allDay,
            },
          },
          date: remote.date,
          from: remote.from,
          to: remote.to,
          title: remote.title,
          description: remote.description,
          color: text(current?.color) || '#777A7D',
        },
      });
      await this.prisma.accountCalendarItemLink.update({
        where: { id: link.id },
        data: {
          externalHref: text(remote.href) || link.externalHref,
          externalEtag: remote.etag,
          lastExternalUpdatedAt: remote.updated,
          lastLocalUpdatedAt: text(saved.updatedAt),
          payloadHash: this.payloadHash(this.eventPayload(saved)),
        },
      });
    }

    if (!fullSync) return;
    const links = await this.prisma.accountCalendarItemLink.findMany({ where: { bindingId: binding.id } });
    for (const link of links) {
      if (seen.has(link.externalId)) continue;
      if (link.localType === 'record') {
        await this.prisma.accountCalendarItemLink.delete({ where: { id: link.id } });
      } else {
        await this.events.removeOwned('account', connection.accountId, link.localId);
        await this.prisma.accountCalendarItemLink.delete({ where: { id: link.id } });
      }
    }
  }

  private eventPayload(event: any): LocalPayload {
    return {
      title: text(event?.title) || 'Событие',
      description: text(event?.description),
      date: text(event?.date).slice(0, 10),
      from: text(event?.from),
      to: text(event?.to),
      localType: 'event',
      localId: text(event?.id),
      updatedAt: text(event?.updatedAt || event?.createdAt),
    };
  }

  private recordPayload(record: any): LocalPayload {
    const procedures = arrayValue(record?.procedures).map((item) => text(item?.name)).filter(Boolean);
    const title = procedures.length ? `Запись — ${procedures.join(', ')}` : 'Запись';
    return {
      title,
      description: 'Запись из личного журнала. Изменение или удаление во внешнем календаре не изменяет саму запись.',
      date: text(record?.date).slice(0, 10),
      from: text(record?.from),
      to: text(record?.to),
      localType: 'record',
      localId: text(record?.id),
      updatedAt: text(record?.updatedAt || record?.createdAt),
    };
  }

  private payloadHash(payload: LocalPayload) {
    return sha({
      title: payload.title,
      description: payload.description,
      date: payload.date,
      from: payload.from,
      to: payload.to,
      localType: payload.localType,
      localId: payload.localId,
    });
  }

  private async pushLocal(
    connection: any,
    bindings: any[],
    credentials: GoogleCalendarCredentials | YandexCalendarCredentials,
    recordById: Map<string, any>,
  ) {
    const bindingById = new Map(bindings.map((binding) => [binding.id, binding]));
    const exportBinding = bindings.find((binding) => binding.externalCalendarId === connection.exportCalendarId && binding.writable)
      || bindings.find((binding) => binding.primary && binding.writable)
      || bindings.find((binding) => binding.writable)
      || null;
    const localEvents = await this.events.listOwned('account', connection.accountId);
    const localEventById = new Map<string, any>(localEvents.map((event: any): [string, any] => [text(event?.id), event]).filter(([id]) => Boolean(id)));
    const links = await this.prisma.accountCalendarItemLink.findMany({ where: { connectionId: connection.id } });
    const linkByLocal = new Map(links.map((link) => [`${link.localType}:${link.localId}`, link]));

    for (const event of localEvents) {
      const payload = this.eventPayload(event);
      if (!payload.localId || !payload.date || !payload.from || !payload.to) continue;
      const originProvider = text(objectValue(objectValue(event?.context).calendarSync).originProvider);
      if (originProvider && originProvider !== connection.provider) continue;
      const link = linkByLocal.get(`event:${payload.localId}`) || null;
      const binding = link ? bindingById.get(link.bindingId) : exportBinding;
      if (!binding?.writable) continue;
      const hash = this.payloadHash(payload);
      if (link && link.payloadHash === hash && text(link.lastLocalUpdatedAt) === payload.updatedAt) continue;
      const remote = await this.writeRemote(connection.provider, credentials, binding, link, payload);
      await this.saveLink(connection.id, binding.id, link, payload, remote, hash);
    }

    for (const [recordId, record] of recordById.entries()) {
      if (!recordId || text(record?.status).toLowerCase() === 'cancelled') continue;
      const payload = this.recordPayload(record);
      if (!payload.date || !payload.from || !payload.to || !exportBinding) continue;
      const link = linkByLocal.get(`record:${recordId}`) || null;
      const binding = link ? bindingById.get(link.bindingId) : exportBinding;
      if (!binding?.writable) continue;
      const hash = this.payloadHash(payload);
      if (link && link.payloadHash === hash && text(link.lastLocalUpdatedAt) === payload.updatedAt) continue;
      const remote = await this.writeRemote(connection.provider, credentials, binding, link, payload);
      await this.saveLink(connection.id, binding.id, link, payload, remote, hash);
    }

    for (const link of links) {
      if (link.localType === 'event' && localEventById.has(link.localId)) continue;
      if (link.localType === 'record' && recordById.has(link.localId) && text(recordById.get(link.localId)?.status).toLowerCase() !== 'cancelled') continue;
      const binding = bindingById.get(link.bindingId);
      if (binding) await this.deleteRemote(connection.provider, credentials, binding, link).catch(() => null);
      await this.prisma.accountCalendarItemLink.delete({ where: { id: link.id } }).catch(() => null);
    }
  }

  private async writeRemote(provider: string, credentials: any, binding: any, link: any, payload: LocalPayload) {
    if (provider === 'google') {
      return this.google.upsertEvent(credentials, binding.externalCalendarId, text(link?.externalId), {
        ...payload,
        timeZone: text(binding.timeZone) || 'UTC',
      });
    }
    return this.yandex.upsertEvent(
      credentials,
      binding.collectionUrl || binding.externalCalendarId,
      text(link?.externalHref),
      text(link?.externalId),
      payload,
    );
  }

  private async deleteRemote(provider: string, credentials: any, binding: any, link: any) {
    if (provider === 'google') return this.google.deleteEvent(credentials, binding.externalCalendarId, link.externalId);
    return this.yandex.deleteEvent(credentials, link.externalHref);
  }

  private async saveLink(connectionId: string, bindingId: string, current: any, payload: LocalPayload, remote: any, payloadHash: string) {
    const data = {
      connectionId,
      bindingId,
      localType: payload.localType,
      localId: payload.localId,
      externalId: text(remote?.id) || text(current?.externalId),
      externalHref: text(remote?.href) || text(current?.externalHref),
      externalEtag: text(remote?.etag),
      lastExternalUpdatedAt: text(remote?.updated),
      lastLocalUpdatedAt: payload.updatedAt,
      payloadHash,
    };
    if (current) {
      await this.prisma.accountCalendarItemLink.update({ where: { id: current.id }, data });
    } else {
      await this.prisma.accountCalendarItemLink.create({ data });
    }
  }

  private async ensureGoogleWatches(connectionId: string, credentials: GoogleCalendarCredentials) {
    const base = text(process.env.PUBLIC_API_URL).replace(/\/$/, '');
    if (!/^https:\/\//i.test(base)) return;
    const bindings = await this.prisma.accountCalendarBinding.findMany({
      where: { connectionId, enabled: true },
    });
    for (const binding of bindings) {
      if (binding.channelExpiresAt && binding.channelExpiresAt.getTime() > Date.now() + 24 * 60 * 60 * 1000) continue;
      const channelToken = randomUUID();
      const watched = await this.google.watch(
        credentials,
        binding.externalCalendarId,
        `${base}/online-booking/account/calendar/google/webhook`,
        channelToken,
      );
      if (!watched) continue;
      await this.prisma.accountCalendarBinding.update({
        where: { id: binding.id },
        data: {
          channelId: watched.channelId,
          channelResourceId: watched.resourceId,
          channelToken,
          channelExpiresAt: watched.expiresAt,
        },
      });
    }
  }

  async googleWebhook(channelIdValue: unknown, channelTokenValue: unknown) {
    const channelId = text(channelIdValue);
    const channelToken = text(channelTokenValue);
    if (!channelId || !channelToken) return;
    const binding = await this.prisma.accountCalendarBinding.findFirst({
      where: { channelId, channelToken },
      include: { connection: true },
    });
    if (!binding || binding.connection.provider !== 'google' || binding.connection.status !== 'active') return;
    void this.syncAccount(binding.connection.accountId, { force: true }).catch((error) => {
      this.logger.warn(`Google webhook sync failed: ${error instanceof Error ? error.message : String(error)}`);
    });
  }
}
