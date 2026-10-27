import { BadRequestException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { ExternalCalendar, ExternalCalendarEvent } from './account-calendar-google.adapter';

export type YandexCalendarCredentials = {
  login: string;
  password: string;
};

export type YandexCalendar = ExternalCalendar & {
  collectionUrl: string;
};

function text(value: unknown) { return String(value ?? '').trim(); }
function decodeXml(value: string) {
  return String(value || '')
    .replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'").replaceAll('&amp;', '&');
}
function tagBlock(xml: string, name: string) {
  const match = String(xml || '').match(new RegExp(`<(?:(?:[A-Za-z0-9_-]+):)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:(?:[A-Za-z0-9_-]+):)?${name}>`, 'i'));
  return match ? match[1] : '';
}
function tagText(xml: string, name: string) { return decodeXml(tagBlock(xml, name).replace(/<[^>]+>/g, '')).trim(); }
function responseBlocks(xml: string) {
  return [...String(xml || '').matchAll(/<(?:(?:[A-Za-z0-9_-]+):)?response(?:\s[^>]*)?>([\s\S]*?)<\/(?:(?:[A-Za-z0-9_-]+):)?response>/gi)].map((match) => match[1]);
}
function absoluteUrl(value: string, base = 'https://caldav.yandex.ru/') {
  try { return new URL(value, base).toString(); } catch { return value; }
}
function basic(credentials: YandexCalendarCredentials) {
  return `Basic ${Buffer.from(`${credentials.login}:${credentials.password}`).toString('base64')}`;
}
function icalUnescape(value: string) {
  return String(value || '').replace(/\\n/gi, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\');
}
function icalEscape(value: string) {
  return String(value || '').replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
}
function unfoldIcal(value: string) { return String(value || '').replace(/\r?\n[ \t]/g, ''); }
function property(lines: string[], name: string) {
  const prefix = `${name.toUpperCase()}`;
  const line = lines.find((item) => item.toUpperCase().startsWith(`${prefix}:`) || item.toUpperCase().startsWith(`${prefix};`)) || '';
  const colon = line.indexOf(':');
  return colon >= 0 ? { head: line.slice(0, colon), value: line.slice(colon + 1) } : { head: '', value: '' };
}
function dateParts(raw: string) {
  const digits = text(raw);
  const match = digits.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2}))?/);
  if (!match) return { date: '', time: '' };
  return { date: `${match[1]}-${match[2]}-${match[3]}`, time: match[4] ? `${match[4]}:${match[5]}` : '' };
}
function nextDate(value: string) {
  const date = new Date(`${value}T12:00:00Z`);
  if (!Number.isFinite(date.getTime())) return value;
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}
function compactDate(value: string) { return String(value || '').replaceAll('-', ''); }
function compactDateTime(date: string, time: string) { return `${compactDate(date)}T${String(time || '00:00').replace(':', '')}00`; }
function stamp() { return new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z'); }

@Injectable()
export class AccountCalendarYandexAdapter {
  available() { return true; }

  private async request(credentials: YandexCalendarCredentials, url: string, init: RequestInit = {}) {
    const headers = new Headers(init.headers || {});
    headers.set('Authorization', basic(credentials));
    const response = await fetch(url, { ...init, headers });
    if (response.status === 401 || response.status === 403) throw new BadRequestException('Яндекс не принял логин или пароль приложения Календаря');
    return response;
  }

  private async propfind(credentials: YandexCalendarCredentials, url: string, body: string, depth = '0') {
    const response = await this.request(credentials, url, {
      method: 'PROPFIND',
      headers: { Depth: depth, 'Content-Type': 'application/xml; charset=utf-8' },
      body,
    });
    const xml = await response.text();
    if (!response.ok && response.status !== 207) throw new ServiceUnavailableException('Яндекс Календарь не ответил на CalDAV-запрос');
    return xml;
  }

  async calendars(credentials: YandexCalendarCredentials): Promise<YandexCalendar[]> {
    if (!text(credentials.login) || !text(credentials.password)) throw new BadRequestException('Укажите логин Яндекса и пароль приложения Календаря');
    const root = 'https://caldav.yandex.ru/';
    const principalXml = await this.propfind(credentials, root, `<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:"><d:prop><d:current-user-principal/></d:prop></d:propfind>`);
    const principalBlock = tagBlock(principalXml, 'current-user-principal');
    const principalHref = tagText(principalBlock, 'href');
    if (!principalHref) throw new ServiceUnavailableException('Яндекс не вернул CalDAV-профиль');
    const principalUrl = absoluteUrl(principalHref, root);
    const homeXml = await this.propfind(credentials, principalUrl, `<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><c:calendar-home-set/></d:prop></d:propfind>`);
    const homeBlock = tagBlock(homeXml, 'calendar-home-set');
    const homeHref = tagText(homeBlock, 'href');
    if (!homeHref) throw new ServiceUnavailableException('Яндекс не вернул каталог календарей');
    const homeUrl = absoluteUrl(homeHref, principalUrl);
    const listXml = await this.propfind(credentials, homeUrl, `<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:cs="http://calendarserver.org/ns/"><d:prop><d:displayname/><d:resourcetype/><c:supported-calendar-component-set/><c:calendar-timezone/><cs:getctag/></d:prop></d:propfind>`, '1');
    const calendars: YandexCalendar[] = [];
    for (const block of responseBlocks(listXml)) {
      if (!/<(?:(?:[A-Za-z0-9_-]+):)?calendar(?:\s[^>]*)?\/?\s*>/i.test(tagBlock(block, 'resourcetype'))) continue;
      if (!/name=["']VEVENT["']/i.test(block)) continue;
      const href = tagText(block, 'href');
      if (!href) continue;
      const name = tagText(block, 'displayname') || 'Яндекс Календарь';
      calendars.push({
        id: absoluteUrl(href, homeUrl),
        name,
        writable: true,
        primary: calendars.length === 0,
        timeZone: 'Europe/Moscow',
        collectionUrl: absoluteUrl(href, homeUrl),
      });
    }
    if (!calendars.length) throw new ServiceUnavailableException('В Яндекс Календаре не найден доступный календарь');
    return calendars;
  }

  private parseEvent(ical: string, href: string, etag: string): ExternalCalendarEvent | null {
    const unfolded = unfoldIcal(ical);
    const match = unfolded.match(/BEGIN:VEVENT\r?\n([\s\S]*?)\r?\nEND:VEVENT/i);
    if (!match) return null;
    const lines = match[1].split(/\r?\n/).filter(Boolean);
    const uid = property(lines, 'UID');
    const start = property(lines, 'DTSTART');
    const end = property(lines, 'DTEND');
    const allDay = /VALUE=DATE/i.test(start.head) || /^\d{8}$/.test(start.value);
    const startParts = dateParts(start.value);
    const endParts = dateParts(end.value);
    const status = icalUnescape(property(lines, 'STATUS').value).toUpperCase();
    const updated = property(lines, 'LAST-MODIFIED').value || property(lines, 'DTSTAMP').value;
    return {
      id: icalUnescape(uid.value) || href,
      etag,
      updated,
      deleted: status === 'CANCELLED',
      title: icalUnescape(property(lines, 'SUMMARY').value) || 'Событие',
      description: icalUnescape(property(lines, 'DESCRIPTION').value),
      date: startParts.date,
      from: allDay ? '00:00' : startParts.time,
      to: allDay ? '23:59' : (endParts.time || startParts.time),
      allDay,
      localType: icalUnescape(property(lines, 'X-COVA-LOCAL-TYPE').value),
      localId: icalUnescape(property(lines, 'X-COVA-LOCAL-ID').value),
    };
  }

  async events(credentials: YandexCalendarCredentials, collectionUrl: string) {
    const response = await this.request(credentials, collectionUrl, {
      method: 'REPORT',
      headers: { Depth: '1', 'Content-Type': 'application/xml; charset=utf-8' },
      body: `<?xml version="1.0" encoding="utf-8"?><c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><d:getetag/><c:calendar-data/></d:prop><c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT"/></c:comp-filter></c:filter></c:calendar-query>`,
    });
    const xml = await response.text();
    if (!response.ok && response.status !== 207) throw new ServiceUnavailableException('Не удалось прочитать события Яндекс Календаря');
    const items: Array<ExternalCalendarEvent & { href: string }> = [];
    for (const block of responseBlocks(xml)) {
      const href = absoluteUrl(tagText(block, 'href'), collectionUrl);
      const data = decodeXml(tagBlock(block, 'calendar-data'));
      if (!href || !data) continue;
      const parsed = this.parseEvent(data, href, tagText(block, 'getetag'));
      if (parsed?.id) items.push({ ...parsed, href });
    }
    return { items, fullSync: true, nextSyncToken: '' };
  }

  private ical(input: {
    externalId?: string;
    title: string;
    description: string;
    date: string;
    from: string;
    to: string;
    localType: string;
    localId: string;
  }) {
    const uid = text(input.externalId) || `cova-${input.localType}-${input.localId}-${randomUUID()}@calendar`;
    const endDate = input.to <= input.from ? nextDate(input.date) : input.date;
    return [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//CO-VA//Personal Journal//RU',
      'CALSCALE:GREGORIAN',
      'BEGIN:VEVENT',
      `UID:${icalEscape(uid)}`,
      `DTSTAMP:${stamp()}`,
      `LAST-MODIFIED:${stamp()}`,
      `DTSTART:${compactDateTime(input.date, input.from)}`,
      `DTEND:${compactDateTime(endDate, input.to)}`,
      `SUMMARY:${icalEscape(input.title || 'Событие')}`,
      `DESCRIPTION:${icalEscape(input.description || '')}`,
      `X-COVA-LOCAL-TYPE:${icalEscape(input.localType)}`,
      `X-COVA-LOCAL-ID:${icalEscape(input.localId)}`,
      'STATUS:CONFIRMED',
      'END:VEVENT',
      'END:VCALENDAR',
      '',
    ].join('\r\n');
  }

  async upsertEvent(credentials: YandexCalendarCredentials, collectionUrl: string, href: string, externalId: string, input: {
    title: string;
    description: string;
    date: string;
    from: string;
    to: string;
    localType: string;
    localId: string;
  }) {
    const uid = externalId || `cova-${input.localType}-${input.localId}-${randomUUID()}@calendar`;
    const target = href || new URL(`${encodeURIComponent(uid)}.ics`, collectionUrl.endsWith('/') ? collectionUrl : `${collectionUrl}/`).toString();
    const response = await this.request(credentials, target, {
      method: 'PUT',
      headers: { 'Content-Type': 'text/calendar; charset=utf-8' },
      body: this.ical({ ...input, externalId: uid }),
    });
    if (!response.ok && response.status !== 201 && response.status !== 204) throw new ServiceUnavailableException('Яндекс Календарь не сохранил событие');
    return {
      id: uid,
      href: target,
      etag: text(response.headers.get('etag')),
      updated: stamp(),
      deleted: false,
      title: input.title,
      description: input.description,
      date: input.date,
      from: input.from,
      to: input.to,
      allDay: false,
      localType: input.localType,
      localId: input.localId,
    };
  }

  async deleteEvent(credentials: YandexCalendarCredentials, href: string) {
    if (!href) return;
    const response = await this.request(credentials, href, { method: 'DELETE' });
    if (!response.ok && response.status !== 404 && response.status !== 410) throw new ServiceUnavailableException('Яндекс Календарь не удалил событие');
  }
}
