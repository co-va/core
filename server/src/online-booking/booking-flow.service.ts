import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { BusinessStateService } from '../business-state/business-state.service';
import { ConsentPolicyService } from '../tenant-document-archive/consent-policy.service';
import { RecordService } from '../record/record.service';
import { ProcedureService } from '../procedure/procedure.service';
import { SaasAccessService } from '../saas-access/saas-access.service';
import { TimeService } from '../time/time.service';
import { OnlineBookingService } from './online-booking.service';

type JsonObject = Record<string, any>;

type BookingParticipant = {
  id: string;
  name: string;
  phone: string;
  email: string;
  procedureIds: string[];
};

const PDN_CONSENT_DOCUMENT_ID = 'pdn-consent';
const MARKETING_CONSENT_DOCUMENT_ID = 'messages-consent';

function objectValue(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {};
}

function arrayValue(value: unknown): any[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown) {
  return String(value ?? '').trim();
}

function canonicalPhone(value: unknown) {
  const digits = text(value).replace(/\D/g, '');
  if (digits.length === 10) return `7${digits}`;
  if (digits.length === 11 && digits.startsWith('8')) return `7${digits.slice(1)}`;
  return digits;
}

function displayPhone(value: unknown) {
  const normalized = canonicalPhone(value);
  return normalized ? `+${normalized}` : '';
}

function canonicalEmail(value: unknown) {
  return text(value).toLowerCase();
}

function dateValue(value: unknown) {
  const result = text(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(result) ? result : '';
}

function uniqueStrings(values: unknown[]) {
  return [...new Set(values.map((value) => text(value)).filter(Boolean))];
}

function personPhones(person: JsonObject) {
  return uniqueStrings([
    person.phone,
    ...arrayValue(person.phones),
  ].map(displayPhone).filter(Boolean));
}

function personEmails(person: JsonObject) {
  return uniqueStrings([
    person.email,
    ...arrayValue(person.emails),
  ].map(canonicalEmail).filter(Boolean));
}

function samePhone(left: unknown, right: unknown) {
  const a = canonicalPhone(left);
  const b = canonicalPhone(right);
  return Boolean(a && b && a === b);
}

function currentConsentState(person: unknown) {
  const state = objectValue(objectValue(person).consentState);
  return {
    pdnActive: state.pdnActive === true,
    marketingActive: state.marketingActive === true,
  };
}

function normalizeParticipant(value: unknown, index: number): BookingParticipant {
  const source = objectValue(value);
  return {
    id: text(source.id) || `participant-${index + 1}`,
    name: text(source.name),
    phone: displayPhone(source.phone),
    email: canonicalEmail(source.email),
    procedureIds: uniqueStrings(arrayValue(source.procedureIds)),
  };
}

function consentFacts(value: unknown) {
  const facts = new Map<string, { documentId: string; accepted: boolean }>();
  for (const item of arrayValue(value)) {
    const documentId = text(item?.documentId);
    if (!documentId) continue;
    facts.set(documentId, {
      documentId,
      accepted: Boolean(item?.accepted),
    });
  }
  return facts;
}

@Injectable()
export class BookingFlowService {
  constructor(
    private readonly online: OnlineBookingService,
    private readonly businessState: BusinessStateService,
    private readonly consentPolicy: ConsentPolicyService,
    private readonly records: RecordService,
    private readonly procedures: ProcedureService,
    private readonly time: TimeService,
    private readonly access: SaasAccessService,
  ) {}

  private async personMatches(tenantId: string, phoneValue: unknown) {
    const phone = displayPhone(phoneValue);
    if (!phone) return [];
    const business = await this.businessState.get(tenantId);
    return arrayValue(business.people)
      .map((item) => objectValue(item))
      .filter((person) => personPhones(person).some((value) => samePhone(value, phone)));
  }

  private resolveKnownPerson(people: JsonObject[], nameValue: unknown) {
    const exactName = text(nameValue).toLocaleLowerCase('ru-RU');
    const named = exactName
      ? people.filter((person) => text(person?.name).toLocaleLowerCase('ru-RU') === exactName)
      : [];
    return named.length === 1 ? named[0] : people.length === 1 ? people[0] : null;
  }

  async bookingState(tenantId: string, input: unknown) {
    const source = objectValue(input);
    const phone = displayPhone(source.phone);
    if (!phone) throw new BadRequestException('Введите телефон полностью');

    const people = await this.personMatches(tenantId, phone);
    const resolved = this.resolveKnownPerson(people, source.name);
    const legalState = currentConsentState(resolved);

    return {
      person: resolved ? {
        key: text(resolved.key),
        name: text(resolved.name),
        phone,
      } : null,
      ambiguous: people.length > 1 && !resolved,
      legalState,
      consents: [
        {
          documentId: PDN_CONSENT_DOCUMENT_ID,
          required: true,
          marketing: false,
          active: legalState.pdnActive,
        },
        {
          documentId: MARKETING_CONSENT_DOCUMENT_ID,
          required: false,
          marketing: true,
          active: legalState.marketingActive,
        },
      ],
    };
  }

  private async resolvePerson(tenantId: string, participant: BookingParticipant) {
    const business = await this.businessState.get(tenantId);
    const people = arrayValue(business.people).map((item) => objectValue(item));
    const phone = displayPhone(participant.phone);
    const email = canonicalEmail(participant.email);
    const phoneMatches = phone
      ? people.filter((person) => personPhones(person).some((value) => samePhone(value, phone)))
      : [];
    const name = participant.name.toLocaleLowerCase('ru-RU');
    const namedMatches = name
      ? phoneMatches.filter((person) => text(person?.name).toLocaleLowerCase('ru-RU') === name)
      : [];
    const existing = namedMatches.length === 1 ? namedMatches[0] : phoneMatches.length === 1 ? phoneMatches[0] : null;

    if (existing) {
      const next: JsonObject = {
        ...existing,
        name: text(existing.name) || participant.name,
        phones: uniqueStrings([...personPhones(existing), ...(phone ? [phone] : [])]),
        emails: uniqueStrings([...personEmails(existing), ...(email ? [email] : [])]),
      };
      await this.businessState.upsertPerson(tenantId, text(existing.key), { person: next });
      return {
        key: text(next.key),
        id: text(next.id),
        name: text(next.name),
        surname: text(next.surname),
        phone,
        email,
        discountPercent: Number(next.discountPercent || 0),
      };
    }

    const key = randomUUID();
    const created: JsonObject = {
      key,
      id: '',
      name: participant.name,
      surname: '',
      phones: phone ? [phone] : [],
      emails: email ? [email] : [],
      telegrams: [],
      accounts: [],
      links: [],
      tags: [],
      consentState: { pdnActive: false, marketingActive: false },
      discountPercent: 0,
      visits: 0,
      totalSpent: 0,
      lastVisit: '',
      programs: [],
      createdAt: new Date().toISOString(),
    };
    if (phoneMatches.length > 1) {
      created.identityReview = {
        status: 'CONTACT_CONFLICT',
        matchedPersonKeys: uniqueStrings(phoneMatches.map((person) => person.key)),
        createdAt: created.createdAt,
      };
    }
    await this.businessState.upsertPerson(tenantId, key, { person: created, position: people.length });
    return {
      key,
      id: '',
      name: participant.name,
      surname: '',
      phone,
      email,
      discountPercent: 0,
    };
  }

  private async personByKey(tenantId: string, keyValue: unknown) {
    const key = text(keyValue);
    if (!key) return null;
    const business = await this.businessState.get(tenantId);
    return arrayValue(business.people)
      .map((item) => objectValue(item))
      .find((person) => text(person.key) === key) || null;
  }

  private async ensureLegalState(tenantId: string, person: JsonObject, phone: string, inputFacts: unknown) {
    const facts = consentFacts(inputFacts);
    const state = currentConsentState(person);

    if (!state.pdnActive) {
      const fact = facts.get(PDN_CONSENT_DOCUMENT_ID);
      if (!fact?.accepted) {
        throw new ConflictException('Необходимо подтвердить согласие на обработку персональных данных');
      }
      await this.consentPolicy.acceptContactPointConsent(
        tenantId,
        'PHONE',
        phone,
        PDN_CONSENT_DOCUMENT_ID,
        'public-booking',
        text(person.key),
      );
      state.pdnActive = true;
    }

    if (!state.marketingActive && facts.get(MARKETING_CONSENT_DOCUMENT_ID)?.accepted) {
      await this.consentPolicy.acceptContactPointConsent(
        tenantId,
        'PHONE',
        phone,
        MARKETING_CONSENT_DOCUMENT_ID,
        'public-booking',
        text(person.key),
      );
      state.marketingActive = true;
    }
  }

  private assertAvailability(context: JsonObject, workplaceKey: string, date: string, from: string, duration: number) {
    const workplace = arrayValue(context.workplaces).find((item) => text(item?.key) === workplaceKey);
    const day = arrayValue(context.days).find((item) => text(item?.workplaceId) === workplaceKey && dateValue(item?.date) === date);
    if (!workplace || !day) throw new ConflictException('Эта дата больше не доступна');
    if (this.time.isPastZonedStart(date, from, workplace?.timeZone)) throw new ConflictException('Это время уже прошло');

    const start = this.time.timeToMinutes(from);
    const end = start == null ? null : start + duration;
    const to = end == null ? '' : this.time.minutesToTime(end);
    if (start == null || !to) throw new BadRequestException('Выбранное время недоступно');

    const planFrom = text(day?.from) || text(workplace?.from);
    const planTo = text(day?.to) || text(workplace?.to);
    const usages = arrayValue(context.occupancy)
      .filter((item) => text(item?.workplaceId) === workplaceKey && dateValue(item?.date) === date)
      .map((item) => ({ id: text(item?.id), from: text(item?.from), to: text(item?.to) }));
    const result = this.time.checkAvailability({ planFrom, planTo, from, to, usages });
    if (!result.ok) throw new ConflictException('Выбранное время уже занято или стало недоступно');
    return { to, start };
  }

  async confirm(tenantId: string, input: unknown) {
    await this.access.assertRealOperationsAllowed(tenantId);
    const source = objectValue(input);
    const workplaceKey = text(source.workplaceKey);
    const date = dateValue(source.date);
    const from = text(source.from);
    const mode = text(source.mode);
    const bookerSource = objectValue(source.booker);
    const booker = {
      name: text(bookerSource.name),
      phone: displayPhone(bookerSource.phone),
      email: canonicalEmail(bookerSource.email),
    };
    if (!workplaceKey || !date || this.time.timeToMinutes(from) == null) {
      throw new BadRequestException('Не выбраны рабочее пространство, дата или время');
    }
    if (!booker.name || !booker.phone) throw new BadRequestException('Укажите имя и телефон оформляющего запись');
    if (!['self', 'other', 'joint'].includes(mode)) throw new BadRequestException('Не выбран способ оформления записи');

    const participants = arrayValue(source.participants).map(normalizeParticipant);
    if (!participants.length || participants.some((participant) => !participant.name || !participant.procedureIds.length)) {
      throw new BadRequestException('Укажите участников и услуги каждого участника');
    }

    const context = await this.online.getContext(tenantId, workplaceKey);
    const workplace = arrayValue(context.workplaces).find((item) => text(item?.key) === workplaceKey);
    if (!workplace) throw new BadRequestException('Рабочее пространство недоступно');

    const prepared = [] as Array<{ participant: BookingParticipant; procedureIds: string[]; duration: number }>;
    for (const participant of participants) {
      const snapshots = await this.procedures.snapshots(tenantId, workplaceKey, participant.procedureIds, date);
      const duration = snapshots.reduce((sum, procedure) => sum + Math.max(0, Number(procedure?.duration || 0)), 0);
      if (!snapshots.length || duration <= 0) throw new BadRequestException(`Не удалось определить услуги для ${participant.name}`);
      prepared.push({ participant, procedureIds: snapshots.map((procedure) => text(procedure.id)), duration });
    }
    const totalDuration = prepared.reduce((sum, item) => sum + item.duration, 0);
    const slot = this.assertAvailability(context, workplaceKey, date, from, totalDuration);

    const bookerIdentity = await this.resolvePerson(tenantId, {
      id: 'booker-contact',
      name: booker.name,
      phone: booker.phone,
      email: booker.email,
      procedureIds: [],
    });
    const bookerPerson = await this.personByKey(tenantId, bookerIdentity.key);
    if (!bookerPerson) throw new ConflictException('Не удалось определить контакт оформляющего запись');
    await this.ensureLegalState(tenantId, bookerPerson, booker.phone, source.consents);

    const bookingSessionId = randomUUID();
    const createdBy = {
      type: 'booking',
      bookingSessionId,
      booker: {
        name: booker.name,
        phone: booker.phone,
        email: booker.email,
      },
      mode,
    };

    const records = [] as JsonObject[];
    let cursor = slot.start;
    try {
      for (const item of prepared) {
        const person = await this.resolvePerson(tenantId, item.participant);
        const recordFrom = this.time.minutesToTime(cursor);
        const recordTo = this.time.minutesToTime(cursor + item.duration);
        if (!recordFrom || !recordTo) throw new BadRequestException('Не удалось определить время записи');
        const record = await this.records.create(tenantId, {
          date,
          workplaceId: workplaceKey,
          from: recordFrom,
          to: recordTo,
          person,
          procedureIds: item.procedureIds,
          source: 'online-booking',
          sourceRequestId: `${bookingSessionId}:${item.participant.id}`,
          createdBy,
        });
        records.push(record);
        cursor += item.duration;
      }
    } catch (error) {
      for (const record of records.reverse()) {
        await this.businessState.deleteRecord(tenantId, text(record?.id)).catch(() => null);
      }
      throw error;
    }

    return {
      bookingSessionId,
      workplaceKey,
      date,
      from,
      to: slot.to,
      records: records.map((record) => ({
        id: text(record?.id),
        person: objectValue(record?.person),
        procedures: arrayValue(record?.procedures),
        from: text(record?.from),
        to: text(record?.to),
      })),
    };
  }
}
