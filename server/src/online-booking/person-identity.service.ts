import { BadRequestException, Injectable } from '@nestjs/common';
import { BusinessStateService } from '../business-state/business-state.service';
import { PrismaService } from '../prisma.service';

function text(value: unknown) {
  return String(value ?? '').trim();
}

function arrayValue(value: unknown): any[] {
  return Array.isArray(value) ? value : [];
}

function objectValue(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
}

function uniqueStrings(values: unknown[]) {
  return [...new Set(values.map((value) => text(value)).filter(Boolean))];
}

function canonicalPhone(value: unknown) {
  const digits = text(value).replace(/\D/g, '');
  if (digits.length === 10) return `7${digits}`;
  if (digits.length === 11 && digits.startsWith('8')) return `7${digits.slice(1)}`;
  return digits;
}

function phoneDisplay(value: unknown) {
  const canonical = canonicalPhone(value);
  return canonical ? `+${canonical}` : '';
}

function canonicalEmail(value: unknown) {
  return text(value).toLowerCase();
}

function telegramId(value: unknown) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const source = value as Record<string, unknown>;
    return text(source.telegramId ?? source.externalUserId ?? source.id);
  }
  return text(value);
}

function accountIds(person: Record<string, any>) {
  return uniqueStrings(arrayValue(person.accounts));
}

function mergePhones(current: unknown, incoming: string[]) {
  const values = arrayValue(current).map((value) => text(value)).filter(Boolean);
  const known = new Set(values.map(canonicalPhone).filter(Boolean));
  for (const value of incoming) {
    const canonical = canonicalPhone(value);
    if (!canonical || known.has(canonical)) continue;
    values.push(phoneDisplay(value));
    known.add(canonical);
  }
  return values;
}

function mergeEmails(current: unknown, incoming: string[]) {
  const values = arrayValue(current).map(canonicalEmail).filter(Boolean);
  return [...new Set([...values, ...incoming.map(canonicalEmail).filter(Boolean)])];
}

function mergeTelegrams(current: unknown, incoming: string[]) {
  const values = arrayValue(current).map((value) => value);
  const known = new Set(values.map(telegramId).filter(Boolean));
  for (const value of incoming.map(telegramId).filter(Boolean)) {
    if (known.has(value)) continue;
    values.push(value);
    known.add(value);
  }
  return values;
}

type ContactSet = {
  phones: string[];
  emails: string[];
  telegrams: string[];
  profilePhoto: string;
  primaryVerifiedEmail: string;
};

type PersonMatch = {
  person: Record<string, any>;
  position: number;
  matchedBy: {
    phones: string[];
    emails: string[];
    telegrams: string[];
  };
};

type PersonBinding = {
  person: Record<string, any>;
  personExisted: boolean;
  ambiguous?: boolean;
};

@Injectable()
export class PersonIdentityService {
  constructor(
    private readonly businessState: BusinessStateService,
    private readonly prisma: PrismaService,
  ) {}

  private async contactsForAccount(account: Record<string, any>): Promise<ContactSet> {
    const accountId = text(account?.id);
    if (!accountId) throw new BadRequestException('У Account отсутствует id');

    const rows = await this.prisma.accountContact.findMany({
      where: { accountId },
      select: { type: true, value: true },
      orderBy: { createdAt: 'asc' },
    });
    const profileData = objectValue(account.profileData);

    const phones = uniqueStrings([
      account.phone,
      ...arrayValue(profileData.phones),
      ...rows.filter((row) => String(row.type) === 'PHONE').map((row) => phoneDisplay(row.value)),
    ].map(phoneDisplay).filter(Boolean));

    const emails = uniqueStrings([
      account.email,
      ...arrayValue(profileData.emails),
      ...rows.filter((row) => String(row.type) === 'EMAIL').map((row) => canonicalEmail(row.value)),
    ].map(canonicalEmail).filter(Boolean));

    const telegrams = uniqueStrings([
      account.telegramId,
      ...rows.filter((row) => String(row.type) === 'TELEGRAM').map((row) => telegramId(row.value)),
    ].map(telegramId).filter(Boolean));

    // The verified flag is a SQL migration-backed Account field, intentionally
    // not part of Prisma's generated Account model.
    const verifiedRows=await this.prisma.$queryRaw<Array<{emailVerifiedAt:Date|null}>>`
      SELECT "emailVerifiedAt" FROM "Account" WHERE "id"=${accountId} LIMIT 1
    `;
    return {
      phones,emails,telegrams,profilePhoto:text(profileData.photo),
      primaryVerifiedEmail:verifiedRows[0]?.emailVerifiedAt?canonicalEmail(account.email):'',
    };
  }

  private matchPerson(person: Record<string, any>, contacts: ContactSet) {
    const personPhones = new Set(arrayValue(person.phones).map(canonicalPhone).filter(Boolean));
    const personEmails = new Set(arrayValue(person.emails).map(canonicalEmail).filter(Boolean));
    const personTelegrams = new Set(arrayValue(person.telegrams).map(telegramId).filter(Boolean));

    const phones = contacts.phones.filter((value) => personPhones.has(canonicalPhone(value)));
    const emails = contacts.emails.filter((value) => personEmails.has(canonicalEmail(value)));
    const telegrams = contacts.telegrams.filter((value) => personTelegrams.has(telegramId(value)));

    return { phones, emails, telegrams };
  }

  private enrichPerson(personValue: unknown, accountId: string, contacts: ContactSet): Record<string, any> {
    const person = objectValue(personValue);
    return {
      ...person,
      photo: contacts.profilePhoto,
      accounts: uniqueStrings([...accountIds(person), accountId]),
      phones: mergePhones(person.phones, contacts.phones),
      // Verified self-declared Email is always first. Older imported Emails
      // remain secondary; never silently remove independent addresses.
      emails: contacts.primaryVerifiedEmail
        ? [contacts.primaryVerifiedEmail,...mergeEmails(person.emails,contacts.emails)
            .filter(value=>value!==contacts.primaryVerifiedEmail)]
        : mergeEmails(person.emails,contacts.emails),
      telegrams: mergeTelegrams(person.telegrams, contacts.telegrams),
    };
  }

  private async stateForContacts(tenantId: string, contacts: ContactSet) {
    const business = await this.businessState.get(tenantId);
    const people = arrayValue(business.people).map((value) => objectValue(value));
    const matches: PersonMatch[] = [];

    people.forEach((person, position) => {
      const matchedBy = this.matchPerson(person, contacts);
      if (!matchedBy.phones.length && !matchedBy.emails.length && !matchedBy.telegrams.length) return;
      matches.push({ person, position, matchedBy });
    });

    return { business, people, matches };
  }

  private async createBoundPerson(
    tenantId: string,
    account: Record<string, any>,
    contacts: ContactSet,
    matchedPersonKeys: string[] = [],
  ) {
    const accountId = text(account.id);
    const profileData = objectValue(account.profileData);
    const state = await this.businessState.get(tenantId);
    const people = arrayValue(state.people).map((value) => objectValue(value));
    const key = `account-${accountId}`;
    const now = new Date().toISOString();

    const person: Record<string, any> = {
      key,
      id: '',
      name: text(account.name),
      surname: text(account.surname),
      photo: contacts.profilePhoto,
      gender: text(profileData.gender),
      birthDate: text(profileData.birthDate),
      phones: mergePhones([], contacts.phones),
      telegrams: mergeTelegrams([], contacts.telegrams),
      emails: mergeEmails([], contacts.emails),
      accounts: [accountId],
      links: [],
      tags: [],
      discountPercent: 0,
      visits: 0,
      totalSpent: 0,
      lastVisit: '',
      programs: [],
      contactStatus: 'registered',
      createdAt: now,
    };

    if (matchedPersonKeys.length > 0) {
      person.identityReview = {
        status: 'CONTACT_CONFLICT',
        matchedPersonKeys: uniqueStrings(matchedPersonKeys),
        createdAt: now,
      };
    }

    await this.businessState.upsertPerson(tenantId, key, {
      person,
      position: people.length,
    });
    return person;
  }

  async findOrAttachExistingPerson(tenantId: string, account: Record<string, any>): Promise<PersonBinding | null> {
    const accountId = text(account?.id);
    if (!accountId) throw new BadRequestException('У Account отсутствует id');

    const contacts = await this.contactsForAccount(account);
    const existingIdentity: any = await this.businessState.bookingIdentityForAccount(tenantId, accountId);
    if (existingIdentity?.matchedPerson?.key || existingIdentity?.person?.key) {
      const direct = objectValue(existingIdentity.matchedPerson || existingIdentity.person);
      const enriched = this.enrichPerson(direct, accountId, contacts);
      const state = await this.businessState.get(tenantId);
      const people = arrayValue(state.people).map((value) => objectValue(value));
      const position = Math.max(0, people.findIndex((person) => text(person.key) === text(enriched.key)));
      await this.businessState.upsertPerson(tenantId, text(enriched.key), { person: enriched, position });
      return { person: enriched, personExisted: true };
    }

    const state = await this.stateForContacts(tenantId, contacts);
    if (!state.matches.length) return null;

    const matchedKeys = uniqueStrings(state.matches.map((match) => match.person.key));
    if (matchedKeys.length !== 1) {
      const person = await this.createBoundPerson(tenantId, account, contacts, matchedKeys);
      return { person, personExisted: false, ambiguous: true };
    }

    const match = state.matches.find((item) => text(item.person.key) === matchedKeys[0])!;
    // An Email/Telegram-only coincidence can belong to another person.
    // Preserve it for explicit professional review, not automatic merging.
    if (!match.matchedBy.phones.length) {
      const person = await this.createBoundPerson(tenantId,account,contacts,matchedKeys);
      return {person,personExisted:false,ambiguous:true};
    }
    const enriched = this.enrichPerson(match.person, accountId, contacts);
    await this.businessState.upsertPerson(tenantId, matchedKeys[0], {
      person: enriched,
      position: match.position,
    });
    return { person: enriched, personExisted: true };
  }

  async bindFirstAccess(tenantId: string, account: Record<string, any>): Promise<PersonBinding> {
    const existing = await this.findOrAttachExistingPerson(tenantId, account);
    if (existing) return existing;
    const contacts = await this.contactsForAccount(account);
    const person = await this.createBoundPerson(tenantId, account, contacts);
    return { person, personExisted: false };
  }

  async syncLinkedPeople(account: Record<string, any>) {
    const accountId = text(account?.id);
    if (!accountId) throw new BadRequestException('У Account отсутствует id');
    const contacts = await this.contactsForAccount(account);
    const rows = await this.prisma.person.findMany({
      orderBy: [{ tenantId: 'asc' }, { position: 'asc' }, { createdAt: 'asc' }],
    });
    const linked = rows.filter((row) => accountIds(objectValue(row.data)).includes(accountId));

    for (const row of linked) {
      const enriched = this.enrichPerson(row.data, accountId, contacts);
      await this.businessState.upsertPerson(row.tenantId, row.key, {
        person: enriched,
        position: row.position,
      });
    }

    return { synced: linked.length };
  }

  async personStats(tenantId: string, account: Record<string, any>) {
    const accountId = text(account?.id);
    if (!accountId) return null;
    const identity = await this.businessState.bookingIdentityForAccount(tenantId, accountId);
    const members = arrayValue(identity?.memberPeople).length
      ? arrayValue(identity.memberPeople).map((value) => objectValue(value))
      : identity?.person ? [objectValue(identity.person)] : [];
    if (!members.length) return null;

    return {
      visits: members.reduce((sum, person) => sum + Math.max(0, Number(person.visits || 0)), 0),
      totalSpent: members.reduce((sum, person) => sum + Math.max(0, Number(person.totalSpent || 0)), 0),
      lastVisit: members.map((person) => text(person.lastVisit)).filter(Boolean).sort().at(-1) || '',
    };
  }

}
