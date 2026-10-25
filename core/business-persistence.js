import { apiRequest } from './auth.js';

let serverReady = false;
let lastError = null;
let pendingPermanentError = null;
const laneQueues = new Map();
const runningLanes = new Set();
const idleWaiters = [];
const completedMutationScopes = new Set();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function responseJson(response, fallbackMessage) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload?.message || fallbackMessage);
    error.status = Number(response.status) || 0;
    throw error;
  }
  return payload;
}

function reportError(error) {
  const previousMessage = lastError?.message || '';
  lastError = error instanceof Error ? error : new Error(String(error || 'Ошибка серверного сохранения'));
  if (typeof window !== 'undefined' && lastError.message !== previousMessage) {
    window.dispatchEvent(new CustomEvent('book:business-persistence-error', { detail: { message: lastError.message } }));
  }
}

function mutationScope(path = '') {
  const value = String(path || '');
  if (value.startsWith('/events')) return 'business';
  if (value.startsWith('/notes')) return 'business';
  if (value.startsWith('/business-state/operational')) return 'operational';
  if (value.startsWith('/business-state/')) return 'business';
  if (value.startsWith('/tenant-document-archive/')) return 'documents';
  if (value.startsWith('/auxiliary-state/')) return 'auxiliary';
  return '';
}

function markMutationCompleted(path) {
  const scope = mutationScope(path);
  if (scope) completedMutationScopes.add(scope);
}

function reportCompletedMutationBatch() {
  if (typeof window === 'undefined' || !completedMutationScopes.size) return;
  const scopes = [...completedMutationScopes];
  completedMutationScopes.clear();
  window.dispatchEvent(new CustomEvent('book:server-mutation-completed', {
    detail: { scopes },
  }));
}

function laneQueue(lane) {
  const key = String(lane || 'business');
  if (!laneQueues.has(key)) laneQueues.set(key, []);
  return laneQueues.get(key);
}

function hasPendingWrites() {
  if (runningLanes.size) return true;
  return [...laneQueues.values()].some((items) => items.length);
}

function resolveIdle() {
  if (hasPendingWrites()) return;
  while (idleWaiters.length) idleWaiters.shift()?.();
}

async function send(item) {
  const response = await apiRequest(item.path, {
    ...item.options,
    keepalive: true,
  });
  return responseJson(response, item.fallbackMessage);
}

function failedRecordMutationId(item = null) {
  const method = String(item?.options?.method || '').toUpperCase();
  if (method !== 'PUT' && method !== 'DELETE') return '';
  const match = String(item?.path || '').match(/^\/business-state\/records\/([^/]+)$/);
  return match ? decodeURIComponent(match[1]) : '';
}

function discardImmediateRecordEvents(items, recordId, error) {
  const id = String(recordId || '');
  if (!id || !Array.isArray(items)) return;
  while (items.length) {
    const next = items[0];
    const path = String(next?.path || '');
    const method = String(next?.options?.method || '').toUpperCase();
    const deleteEventsPath = `/business-state/records/${encodeURIComponent(id)}/events`;
    if (method === 'DELETE' && path === deleteEventsPath) {
      items.shift();
      next.resolve?.({ ok: false, error });
      continue;
    }
    if (!path.startsWith('/business-state/record-events/')) break;
    let eventRecordId = '';
    try {
      eventRecordId = String(JSON.parse(next?.options?.body || '{}')?.event?.recordId || '');
    } catch {
      eventRecordId = '';
    }
    if (eventRecordId !== id) break;
    items.shift();
    next.resolve?.({ ok: false, error });
  }
}

async function runLane(lane) {
  const key = String(lane || 'business');
  if (runningLanes.has(key) || !serverReady) return;
  const items = laneQueue(key);
  if (!items.length) {
    laneQueues.delete(key);
    resolveIdle();
    return;
  }

  runningLanes.add(key);
  try {
    while (serverReady && items.length) {
      const item = items[0];
      try {
        const result = await send(item);
        items.shift();
        lastError = null;
        item.resolve?.(result);
        markMutationCompleted(item.path);
      } catch (error) {
        reportError(error);
        const status = Number(error?.status) || 0;
        if (status >= 400 && status < 500) {
          items.shift();
          if (!pendingPermanentError) pendingPermanentError = lastError;
          item.resolve?.({ ok: false, error: lastError });
          discardImmediateRecordEvents(items, failedRecordMutationId(item), lastError);
          continue;
        }
        await sleep(1200);
      }
    }
  } finally {
    runningLanes.delete(key);
    if (!items.length) laneQueues.delete(key);
    resolveIdle();
    if (!hasPendingWrites()) reportCompletedMutationBatch();
    if (serverReady && items.length) void runLane(key);
  }
}

function runPendingLanes() {
  if (!serverReady) return;
  for (const [lane, items] of laneQueues) {
    if (items.length) void runLane(lane);
  }
}

function enqueue(lane, path, options, fallbackMessage) {
  if (!serverReady) return Promise.resolve();
  let resolve;
  const done = new Promise((doneResolve) => { resolve = doneResolve; });
  laneQueue(lane).push({ path, options, fallbackMessage, resolve });
  void runLane(lane);
  return done;
}

function recordLane(recordId) {
  const id = String(recordId || '').trim();
  return id ? `record:${id}` : 'records';
}

export function setBusinessServerReady(value) {
  serverReady = Boolean(value);
  if (serverReady) runPendingLanes();
}

export function isBusinessServerReady() {
  return serverReady;
}

export function getBusinessPersistenceError() {
  return lastError;
}

export function queuePersonUpsert(person, position = 0) {
  const key = String(person?.key || '').trim();
  if (!key) return Promise.resolve();
  return enqueue('identity', `/business-state/people/${encodeURIComponent(key)}`, {
    method: 'PUT',
    body: JSON.stringify({ person, position }),
  }, 'Не удалось сохранить человека на сервере');
}

export function queuePersonDelete(key) {
  const id = String(key || '').trim();
  if (!id) return Promise.resolve();
  return enqueue('identity', `/business-state/people/${encodeURIComponent(id)}`, { method: 'DELETE' }, 'Не удалось удалить человека на сервере');
}

export function queueUEIStore(uei) {
  return enqueue('identity', '/business-state/uei', {
    method: 'PUT',
    body: JSON.stringify({ uei }),
  }, 'Не удалось сохранить UEI на сервере');
}

export function queueRecordUpsert(record, position = 0) {
  const id = String(record?.id || '').trim();
  if (!id) return Promise.resolve();
  return enqueue(recordLane(id), `/business-state/records/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify({ record, position }),
  }, 'Не удалось сохранить запись на сервере');
}

export function queueRecordDelete(id) {
  const recordId = String(id || '').trim();
  if (!recordId) return Promise.resolve();
  return enqueue(recordLane(recordId), `/business-state/records/${encodeURIComponent(recordId)}`, { method: 'DELETE' }, 'Не удалось удалить запись на сервере');
}

export function queueEventUpsert(event) {
  const id = String(event?.id || '').trim();
  if (!id) return Promise.resolve();
  return enqueue('events', `/events/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify({ event }) }, 'Не удалось сохранить событие на сервере');
}

export function queueEventDelete(id) {
  const eventId = String(id || '').trim();
  if (!eventId) return Promise.resolve();
  return enqueue('events', `/events/${encodeURIComponent(eventId)}`, { method: 'DELETE' }, 'Не удалось удалить событие на сервере');
}

export function queueNoteUpsert(note) {
  const id = String(note?.id || '').trim();
  if (!id) return Promise.resolve();
  return enqueue('notes', `/notes/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify({ note }),
  }, 'Не удалось сохранить заметку на сервере');
}

export function queueNoteDelete(id) {
  const noteId = String(id || '').trim();
  if (!noteId) return Promise.resolve();
  return enqueue('notes', `/notes/${encodeURIComponent(noteId)}`, { method: 'DELETE' }, 'Не удалось удалить заметку на сервере');
}

export function queueRecordEventUpsert(event, position = 0) {
  const id = String(event?.id || '').trim();
  if (!id) return Promise.resolve();
  const recordId = String(event?.recordId || '').trim();
  return enqueue(recordLane(recordId), `/business-state/record-events/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify({ event, position }),
  }, 'Не удалось сохранить историю записи на сервере');
}

export function queueRecordEventsDelete(recordId) {
  const id = String(recordId || '').trim();
  if (!id) return Promise.resolve();
  return enqueue(recordLane(id), `/business-state/records/${encodeURIComponent(id)}/events`, { method: 'DELETE' }, 'Не удалось удалить историю записи на сервере');
}

export function queueDocumentDataset(dataset, value) {
  const name = String(dataset || '').trim();
  if (!name) return Promise.resolve();
  return enqueue(`documents:${name}`, `/tenant-document-archive/${encodeURIComponent(name)}`, {
    method: 'PUT',
    body: JSON.stringify({ value }),
  }, 'Не удалось сохранить документы на сервере');
}

export function queueOperationalDataset(dataset, value) {
  const key = String(dataset || '').trim();
  if (!key) return Promise.resolve();
  return enqueue(`operational:${key}`, `/business-state/operational/${encodeURIComponent(key)}`, {
    method: 'PUT',
    body: JSON.stringify({ value }),
  }, 'Не удалось сохранить рабочие данные на сервере');
}

export function queueAuxiliaryDataset(dataset, value) {
  const key = String(dataset || '').trim();
  if (!key) return Promise.resolve();
  return enqueue(`auxiliary:${key}`, `/auxiliary-state/${encodeURIComponent(key)}`, {
    method: 'PUT',
    body: JSON.stringify({ value }),
  }, 'Не удалось сохранить связанные данные на сервере');
}

export async function flushBusinessPersistence({ timeoutMs = 12000 } = {}) {
  if (!serverReady) return;
  if (hasPendingWrites()) {
    let timer;
    await Promise.race([
      new Promise((resolve) => {
        idleWaiters.push(resolve);
        resolveIdle();
      }),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(lastError || new Error('Серверное сохранение не завершено')), timeoutMs);
      }),
    ]).finally(() => clearTimeout(timer));
  }
  if (pendingPermanentError) {
    const error = pendingPermanentError;
    pendingPermanentError = null;
    throw error;
  }
}