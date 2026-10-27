import { BadRequestException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

export type GoogleCalendarCredentials = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scope: string;
};

export type ExternalCalendar = {
  id: string;
  name: string;
  writable: boolean;
  primary: boolean;
  timeZone: string;
};

export type ExternalCalendarEvent = {
  id: string;
  etag: string;
  updated: string;
  deleted: boolean;
  title: string;
  description: string;
  date: string;
  from: string;
  to: string;
  allDay: boolean;
  localType: string;
  localId: string;
};

type GoogleTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
};

type GoogleEvent = Record<string, any>;

function text(value: unknown) { return String(value ?? '').trim(); }
function nextDate(value: string) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return value;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}
function isoLocalParts(value: unknown) {
  const raw = text(value);
  const match = raw.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/);
  return match ? { date: match[1], time: match[2] } : { date: '', time: '' };
}
function jsonBody(value: unknown) { return JSON.stringify(value); }

@Injectable()
export class AccountCalendarGoogleAdapter {
  private client() {
    const clientId = text(process.env.GOOGLE_CALENDAR_CLIENT_ID);
    const clientSecret = text(process.env.GOOGLE_CALENDAR_CLIENT_SECRET);
    if (!clientId || !clientSecret) throw new ServiceUnavailableException('Google Calendar пока не настроен');
    return { clientId, clientSecret };
  }

  available() {
    return Boolean(text(process.env.GOOGLE_CALENDAR_CLIENT_ID) && text(process.env.GOOGLE_CALENDAR_CLIENT_SECRET));
  }

  callbackUrl() {
    const base = text(process.env.PUBLIC_API_URL).replace(/\/$/, '');
    if (!/^https:\/\//i.test(base)) throw new ServiceUnavailableException('Google Calendar требует публичный HTTPS API');
    return `${base}/online-booking/account/calendar/google/callback`;
  }

  authorizationUrl(state: string) {
    const { clientId } = this.client();
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', this.callbackUrl());
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', 'https://www.googleapis.com/auth/calendar');
    url.searchParams.set('access_type', 'offline');
    url.searchParams.set('prompt', 'consent');
    url.searchParams.set('include_granted_scopes', 'true');
    url.searchParams.set('state', state);
    return url.toString();
  }

  async exchangeCode(code: string): Promise<GoogleCalendarCredentials> {
    const { clientId, clientSecret } = this.client();
    const body = new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: this.callbackUrl(),
      grant_type: 'authorization_code',
    });
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    const payload = await response.json().catch(() => ({})) as GoogleTokenResponse;
    if (!response.ok || !payload.access_token) {
      throw new BadRequestException(payload.error_description || 'Google не подтвердил подключение календаря');
    }
    return {
      accessToken: payload.access_token,
      refreshToken: text(payload.refresh_token),
      expiresAt: Date.now() + Math.max(30, Number(payload.expires_in) || 3600) * 1000,
      scope: text(payload.scope),
    };
  }

  private async refresh(credentials: GoogleCalendarCredentials) {
    if (credentials.expiresAt > Date.now() + 60_000 && credentials.accessToken) return;
    if (!credentials.refreshToken) throw new ServiceUnavailableException('Google Calendar требует повторного подключения');
    const { clientId, clientSecret } = this.client();
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: credentials.refreshToken,
        grant_type: 'refresh_token',
      }),
    });
    const payload = await response.json().catch(() => ({})) as GoogleTokenResponse;
    if (!response.ok || !payload.access_token) throw new ServiceUnavailableException('Google Calendar требует повторного подключения');
    credentials.accessToken = payload.access_token;
    credentials.expiresAt = Date.now() + Math.max(30, Number(payload.expires_in) || 3600) * 1000;
    if (payload.scope) credentials.scope = payload.scope;
  }

  private async request(credentials: GoogleCalendarCredentials, url: string, init: RequestInit = {}) {
    await this.refresh(credentials);
    const headers = new Headers(init.headers || {});
    headers.set('Authorization', `Bearer ${credentials.accessToken}`);
    if (init.body != null && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    let response = await fetch(url, { ...init, headers });
    if (response.status === 401 && credentials.refreshToken) {
      credentials.expiresAt = 0;
      await this.refresh(credentials);
      headers.set('Authorization', `Bearer ${credentials.accessToken}`);
      response = await fetch(url, { ...init, headers });
    }
    return response;
  }

  async calendars(credentials: GoogleCalendarCredentials): Promise<ExternalCalendar[]> {
    const result: ExternalCalendar[] = [];
    let pageToken = '';
    do {
      const url = new URL('https://www.googleapis.com/calendar/v3/users/me/calendarList');
      url.searchParams.set('maxResults', '250');
      if (pageToken) url.searchParams.set('pageToken', pageToken);
      const response = await this.request(credentials, url.toString());
      const payload = await response.json().catch(() => ({})) as any;
      if (!response.ok) throw new ServiceUnavailableException(payload?.error?.message || 'Не удалось получить календари Google');
      for (const item of Array.isArray(payload.items) ? payload.items : []) {
        const id = text(item?.id);
        if (!id) continue;
        const accessRole = text(item?.accessRole);
        result.push({
          id,
          name: text(item?.summaryOverride || item?.summary) || 'Google Calendar',
          writable: ['owner', 'writer'].includes(accessRole),
          primary: item?.primary === true,
          timeZone: text(item?.timeZone) || 'UTC',
        });
      }
      pageToken = text(payload.nextPageToken);
    } while (pageToken);
    return result;
  }

  normalizeEvent(item: GoogleEvent): ExternalCalendarEvent {
    const allDay = Boolean(item?.start?.date);
    const start = allDay
      ? { date: text(item?.start?.date).slice(0, 10), time: '00:00' }
      : isoLocalParts(item?.start?.dateTime);
    const end = allDay
      ? { date: text(item?.end?.date).slice(0, 10), time: '23:59' }
      : isoLocalParts(item?.end?.dateTime);
    const privateProps = item?.extendedProperties?.private && typeof item.extendedProperties.private === 'object'
      ? item.extendedProperties.private
      : {};
    return {
      id: text(item?.id),
      etag: text(item?.etag),
      updated: text(item?.updated),
      deleted: text(item?.status) === 'cancelled',
      title: text(item?.summary) || 'Событие',
      description: text(item?.description),
      date: start.date,
      from: start.time,
      to: end.time || (allDay ? '23:59' : start.time),
      allDay,
      localType: text(privateProps.covaLocalType),
      localId: text(privateProps.covaLocalId),
    };
  }

  async events(credentials: GoogleCalendarCredentials, calendarId: string, syncToken = '') {
    const read = async (token: string) => {
      const items: ExternalCalendarEvent[] = [];
      let pageToken = '';
      let nextSyncToken = '';
      do {
        const url = new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`);
        url.searchParams.set('maxResults', '2500');
        url.searchParams.set('showDeleted', 'true');
        url.searchParams.set('singleEvents', 'true');
        if (token) url.searchParams.set('syncToken', token);
        if (pageToken) url.searchParams.set('pageToken', pageToken);
        const response = await this.request(credentials, url.toString());
        if (response.status === 410 && token) return null;
        const payload = await response.json().catch(() => ({})) as any;
        if (!response.ok) throw new ServiceUnavailableException(payload?.error?.message || 'Не удалось синхронизировать Google Calendar');
        for (const raw of Array.isArray(payload.items) ? payload.items : []) {
          const item = this.normalizeEvent(raw);
          if (item.id) items.push(item);
        }
        pageToken = text(payload.nextPageToken);
        if (!pageToken) nextSyncToken = text(payload.nextSyncToken);
      } while (pageToken);
      return { items, nextSyncToken, fullSync: !token };
    };
    const incremental = await read(syncToken);
    if (incremental) return incremental;
    const full = await read('');
    if (!full) throw new ServiceUnavailableException('Не удалось восстановить синхронизацию Google Calendar');
    return full;
  }

  private eventBody(input: {
    title: string;
    description: string;
    date: string;
    from: string;
    to: string;
    timeZone: string;
    localType: string;
    localId: string;
  }) {
    const crossesMidnight = input.to <= input.from;
    const endDate = crossesMidnight ? nextDate(input.date) : input.date;
    return {
      summary: input.title || 'Событие',
      description: input.description || '',
      status: 'confirmed',
      start: { dateTime: `${input.date}T${input.from}:00`, timeZone: input.timeZone || 'UTC' },
      end: { dateTime: `${endDate}T${input.to}:00`, timeZone: input.timeZone || 'UTC' },
      extendedProperties: {
        private: {
          covaLocalType: input.localType,
          covaLocalId: input.localId,
        },
      },
    };
  }

  async upsertEvent(credentials: GoogleCalendarCredentials, calendarId: string, externalId: string, input: {
    title: string;
    description: string;
    date: string;
    from: string;
    to: string;
    timeZone: string;
    localType: string;
    localId: string;
  }) {
    const path = externalId
      ? `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(externalId)}`
      : `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`;
    const response = await this.request(credentials, path, {
      method: externalId ? 'PUT' : 'POST',
      body: jsonBody(this.eventBody(input)),
    });
    const payload = await response.json().catch(() => ({})) as any;
    if (!response.ok) throw new ServiceUnavailableException(payload?.error?.message || 'Google Calendar не сохранил событие');
    return this.normalizeEvent(payload);
  }

  async deleteEvent(credentials: GoogleCalendarCredentials, calendarId: string, externalId: string) {
    if (!externalId) return;
    const response = await this.request(credentials, `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(externalId)}`, { method: 'DELETE' });
    if (!response.ok && response.status !== 404 && response.status !== 410) {
      const payload = await response.json().catch(() => ({})) as any;
      throw new ServiceUnavailableException(payload?.error?.message || 'Google Calendar не удалил событие');
    }
  }

  async watch(credentials: GoogleCalendarCredentials, calendarId: string, address: string, token: string) {
    if (!/^https:\/\//i.test(address)) return null;
    const channelId = randomUUID();
    const expiration = Date.now() + 6 * 24 * 60 * 60 * 1000;
    const response = await this.request(credentials, `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/watch`, {
      method: 'POST',
      body: jsonBody({ id: channelId, type: 'web_hook', address, token, expiration }),
    });
    const payload = await response.json().catch(() => ({})) as any;
    if (!response.ok) return null;
    return {
      channelId: text(payload.id) || channelId,
      resourceId: text(payload.resourceId),
      expiresAt: new Date(Number(payload.expiration) || expiration),
    };
  }
}
