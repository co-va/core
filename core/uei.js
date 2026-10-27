import { normalizeUEI } from './uei-format.js';
export { normalizeUEI } from './uei-format.js';
import { queueUEIStore } from './business-persistence.js';

const EMPTY = '0000';
let storeState = normalizeStore();

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function normalizeStore(value = {}) {
  return {
    entities: value.entities && typeof value.entities === 'object' && !Array.isArray(value.entities) ? clone(value.entities) : {},
    relations: value.relations && typeof value.relations === 'object' && !Array.isArray(value.relations) ? clone(value.relations) : {},
    revoked: Array.isArray(value.revoked) ? clone(value.revoked) : [],
  };
}

function readStore() {
  return clone(storeState);
}

function writeStore(store) {
  const normalized = normalizeStore(store);
  storeState = clone(normalized);
  void queueUEIStore(normalized);
}

export function hydrateUEIFromServer(value = {}) {
  storeState = normalizeStore(value);
  return clone(storeState);
}

function relationKey(type, id) { return `${String(type)}:${String(id)}`; }

export function isValidUEI(value) {
  try { return normalizeUEI(value) !== EMPTY; } catch { return false; }
}

function ensureEntity(store, uei, entityType, entityId) {
  const entity = store.entities[uei] || { uei, owner: null, members: [], history: [], reserved: true };
  if (!entity.owner) entity.owner = { type: entityType, id: entityId };
  if (!entity.members.includes(relationKey(entityType, entityId))) entity.members.push(relationKey(entityType, entityId));
  store.entities[uei] = entity;
  return entity;
}

function recordHistory(entity, entityType, entityId, identifiers = []) {
  const key = relationKey(entityType, entityId);
  const existing = entity.history.find(item => item.key === key);
  const values = [...new Set((identifiers || []).map(v => String(v || '').trim()).filter(Boolean))];
  if (!existing) entity.history.push({ key, type: entityType, id: entityId, identifiers: values });
  else existing.identifiers = [...new Set([...(existing.identifiers || []), ...values])];
}

function addRevocation(store, entityType, entityId, uei) {
  const item = { key: relationKey(entityType, entityId), uei };
  if (!store.revoked.some(x => x.key === item.key && x.uei === item.uei)) store.revoked.push(item);
}

function releaseRelation(store, entityType, entityId, normalized) {
  const key = relationKey(entityType, entityId);
  if (store.relations[key] !== normalized) return;
  const entity = store.entities[normalized];
  if (entity) {
    entity.members = entity.members.filter(member => member !== key);
    if (entity.owner?.type === entityType && entity.owner?.id === entityId) {
      const nextOwner = entity.members[0] || null;
      if (nextOwner) {
        const separator = nextOwner.indexOf(':');
        entity.owner = { type: nextOwner.slice(0, separator), id: nextOwner.slice(separator + 1) };
      } else {
        entity.owner = null;
      }
    }
    if (!entity.members.length) delete store.entities[normalized];
  }
  delete store.relations[key];
}

export function listUEIs() {
  return Object.values(readStore().entities)
    .filter(entity => entity && entity.uei && entity.uei !== EMPTY)
    .sort((a, b) => a.uei.localeCompare(b.uei));
}

export function getUEI(entityType, entityId) { return readStore().relations[relationKey(entityType, entityId)] || ''; }

export function getMembers(uei) {
  const normalized = normalizeUEI(uei);
  if (normalized === EMPTY) return [];
  return [...(readStore().entities[normalized]?.members || [])];
}

export function getOptions(entityType, entityId) {
  const current = getUEI(entityType, entityId);
  return listUEIs().filter(entity => entity.uei !== current).map(entity => ({ value: entity.uei, label: entity.uei }));
}

export function createUEI({ entityType, entityId, value, identifiers = [] } = {}) {
  const uei = normalizeUEI(value);
  if (uei === EMPTY) throw Error('0000 не является действительным UEI.');
  const store = readStore();
  if (store.entities[uei]) throw Error('Этот UEI уже существует. Для связи с существующим UEI используйте поле «Связать».');
  const key = relationKey(entityType, entityId);
  if (store.relations[key]) throw Error('Профиль уже связан с UEI.');
  const entity = ensureEntity(store, uei, entityType, entityId);
  recordHistory(entity, entityType, entityId, identifiers);
  store.relations[key] = uei;
  writeStore(store);
  return uei;
}

export function linkUEI({ entityType, entityId, value, identifiers = [] } = {}) {
  const uei = normalizeUEI(value);
  if (uei === EMPTY) throw Error('0000 не является действительным UEI.');
  const store = readStore();
  if (!store.entities[uei]) throw Error('Такого UEI ещё нет. Сначала создайте его.');
  const key = relationKey(entityType, entityId);
  const current = store.relations[key] || '';
  if (current === uei) return uei;
  if (current && store.entities[current]) store.entities[current].members = store.entities[current].members.filter(member => member !== key);
  const entity = ensureEntity(store, uei, entityType, entityId);
  recordHistory(entity, entityType, entityId, identifiers);
  store.relations[key] = uei;
  writeStore(store);
  return uei;
}

export function detachUEI({ entityType, entityId, uei, explicit = true } = {}) {
  const normalized = normalizeUEI(uei || getUEI(entityType, entityId));
  if (normalized === EMPTY) return '';
  const store = readStore();
  const key = relationKey(entityType, entityId);
  if (store.relations[key] !== normalized) return store.relations[key] || '';
  const entity = store.entities[normalized];
  if (entity) {
    entity.members = entity.members.filter(member => member !== key);
    recordHistory(entity, entityType, entityId, []);
    if (entity.owner?.type === entityType && entity.owner?.id === entityId) {
      const nextOwner = entity.members[0] || null;
      if (nextOwner) {
        const separator = nextOwner.indexOf(':');
        entity.owner = { type: nextOwner.slice(0, separator), id: nextOwner.slice(separator + 1) };
      }
    }
  }
  delete store.relations[key];
  if (explicit) addRevocation(store, entityType, entityId, normalized);
  writeStore(store);
  return '';
}

export function releaseUEI({ entityType, entityId } = {}) {
  const current = getUEI(entityType, entityId);
  if (!current) return '';
  const normalized = normalizeUEI(current);
  if (normalized === EMPTY) return '';
  const store = readStore();
  releaseRelation(store, entityType, entityId, normalized);
  store.revoked = store.revoked.filter(item => !(item.key === relationKey(entityType, entityId) && item.uei === normalized));
  writeStore(store);
  return '';
}

export function replaceUEI({ entityType, entityId, value, identifiers = [] } = {}) {
  const requested = normalizeUEI(value);
  if (requested === EMPTY) throw Error('0000 не является действительным UEI.');
  const store = readStore();
  const key = relationKey(entityType, entityId);
  const current = store.relations[key] || '';
  if (current === requested) return requested;
  if (store.entities[requested]) throw Error('Этот UEI уже используется');
  if (current) releaseRelation(store, entityType, entityId, current);
  const entity = ensureEntity(store, requested, entityType, entityId);
  recordHistory(entity, entityType, entityId, identifiers);
  store.relations[key] = requested;
  store.revoked = store.revoked.filter(item => item.key !== key);
  writeStore(store);
  return requested;
}

export function findHistoricalUEI(entityType, identifier) {
  const needle = String(identifier || '').trim();
  if (!needle) return '';
  const store = readStore();
  for (const entity of Object.values(store.entities)) {
    if (entity.uei === EMPTY) continue;
    const match = (entity.history || []).some(item => item.type === entityType && (item.identifiers || []).includes(needle));
    if (match) return entity.uei;
  }
  return '';
}

export function applyUEI({ entityType, entityId, currentUEI = '', value = '', linkValue = '', identifiers = [] } = {}) {
  const current = normalizeUEI(currentUEI);

  if (linkValue) {
    return { uei: linkUEI({ entityType, entityId, value: linkValue, identifiers }), linked: true };
  }

  if (value && normalizeUEI(value) !== EMPTY) {
    const requested = normalizeUEI(value);
    if (current === requested) return { uei: requested };
    if (current !== EMPTY) detachUEI({ entityType, entityId, uei: current, explicit: false });
    return { uei: createUEI({ entityType, entityId, value: requested, identifiers }), created: true };
  }

  if (current !== EMPTY) {
    return { uei: detachUEI({ entityType, entityId, uei: current, explicit: true }) };
  }

  return { uei: '' };
}

export function clearTestState() {
  writeStore(normalizeStore());
}
