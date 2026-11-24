import { normalizePhone } from '../../../core/phone/index.js';
import { normalizeUEI } from '../../../core/uei-format.js';

type Obj = Record<string, any>;
const text = (value: unknown) => String(value ?? '').trim();
const normalPhone = (value: unknown): string => {
  try { return text(value) ? normalizePhone(value) : ''; } catch { return ''; }
};
const normalCode = (value: unknown): string => {
  try { return text(value) ? normalizeUEI(value) : ''; } catch { return ''; }
};
const normalEmail = (value: unknown) => text(value).toLowerCase();
const normalTelegram = (value: unknown) => text(value).toLowerCase().replace(/^@/, '');
const list = (value: unknown): string[] => Array.isArray(value) ? value.map(text).filter(Boolean) : [];
export const contactIdentityFields = [
  'uei', 'phone', 'additionalPhone', 'email', 'additionalEmail',
  'telegram', 'additionalTelegram',
] as const;
export type ContactIdentityField = typeof contactIdentityFields[number];
export type ContactCandidate = {
  key: string;
  code: string;
  name: string;
  matchedBy: ContactIdentityField[];
};
export function identityValue(field: ContactIdentityField, value: unknown) {
  if (field === 'uei') return normalCode(value);
  if (field === 'phone' || field === 'additionalPhone') return normalPhone(value);
  if (field === 'email' || field === 'additionalEmail') return normalEmail(value);
  return normalTelegram(value);
}
export function contactMatches(person: Obj, identity: Obj, field: ContactIdentityField, value: unknown) {
  const candidate = identityValue(field, value);
  if (!candidate) return false;
  if (field === 'uei') {
    const relations = identity.relations && typeof identity.relations === 'object' ? identity.relations : {};
    return identityValue(field, relations['person:' + text(person.key)] || person.uei) === candidate;
  }
  const key = field === 'phone' || field === 'additionalPhone' ? 'phones'
    : field === 'email' || field === 'additionalEmail' ? 'emails' : 'telegrams';
  return list(person[key]).some(value => identityValue(field, value) === candidate);
}
// Identifies possible people; never decides whether two people may be merged.
export function findContactCandidates(people: Obj[], identity: Obj, source: Obj): ContactCandidate[] {
  const candidates: ContactCandidate[] = [];
  for (const person of people) {
    const matchedBy = contactIdentityFields.filter(field =>
      text(source[field]) && contactMatches(person, identity, field, source[field]));
    if (!matchedBy.length) continue;
    const relations = identity.relations && typeof identity.relations === 'object' ? identity.relations : {};
    candidates.push({
      key: text(person.key),
      code: text(relations['person:' + text(person.key)] || person.uei),
      name: [text(person.name), text(person.surname)].filter(Boolean).join(' '),
      matchedBy,
    });
  }
  return candidates.filter(person => person.key);
}
export function reliableContactCandidate(candidate: ContactCandidate): boolean {
  return candidate.matchedBy.some(field =>
    field === 'uei' || field === 'phone' || field === 'additionalPhone');
}
