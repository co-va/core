import { normalizePhone } from '../../../core/phone/index.js';
import { normalizeUEI } from '../../../core/uei-format.js';

type Row = Record<string, any>;
const text = (v: unknown) => String(v ?? '').trim();
const uei = (v: unknown) => text(v) ? normalizeUEI(v) : '';
export function resolveTransferredPerson(people: Row[], identity: Row, input: Row, targetId = '') {
  const phone = text(input.phone) ? normalizePhone(input.phone) : '';
  if (text(input.phone) && (!phone || text(input.phone).replace(/\D/g, '').length > phone.replace(/\D/g, '').length)) throw Error('Неверный формат телефона');
  const code = uei(input.uei);
  if (code === '0000') throw Error('0000 не является действительным UEI');
  const byPhone = phone ? people.filter(p => (p.phones || []).some((v: unknown) => normalizePhone(v) === phone)) : [];
  const byUei = code ? people.filter(p => text(identity.relations?.[`person:${p.key}`] || p.uei) === code) : [];
  if (byPhone.length > 1 || byUei.length > 1) throw Error('Не удалось однозначно определить человека');
  const explicit = targetId || text(input.personKey);
  const person = explicit ? people.find(p => p.key === explicit) : byPhone[0] || byUei[0];
  if (explicit && !person) throw Error('Не найден человек по указанному ID');
  if (byPhone[0] && person && byPhone[0].key !== person.key) throw Error(`Телефон уже принадлежит ${byPhone[0].name}. Проверьте данные.`);
  if (byUei[0] && person && byUei[0].key !== person.key) throw Error('UEI конфликтует с уже сохранённым UEI');
  if (person) {
    if (!targetId && text(input.name) && text(input.name) !== text(person.name)) throw Error(`Телефон уже принадлежит ${person.name}. В импортируемых данных указано имя ${input.name}. Проверьте данные.`);
    if (!targetId && text(input.surname) && text(input.surname) !== text(person.surname)) throw Error('Фамилия не совпадает с сохранённой. Проверьте данные.');
    const saved = text(identity.relations?.[`person:${person.key}`] || person.uei);
    if (code && saved && code !== saved) throw Error(`Телефон уже связан с ${person.name}. Сохранён UEI ${saved}, в импортируемых данных UEI ${code}. Проверьте данные.`);
  }
  // Email is data, never an identity anchor.
  if (!person && !phone && !code && text(input.email) && people.some(p => (p.emails || []).includes(text(input.email)))) throw Error('Email уже используется. Укажите телефон, UEI или ID человека для однозначного сопоставления.');
  return { person: person || null, phone, uei: code };
}
