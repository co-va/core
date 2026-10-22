import { apiRequest } from './auth.js';

let serverReady = false;
let running = false;
let lastError = null;
let pendingPermanentError = null;
const queue = [];
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

function resolveIdle() {
  if (queue.length || running) return;
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

function discardImmediateRecordEvents(recordId, error) {
  const id = String(recordId || '');
  if (!id) return;
  while (queue.length) {
    const next = queue[0];
    const path = String(next?.path || '');
    const method = String(next?.options?.method || '').toUpperCase();
    const deleteEventsPath = `/business-state/records/${encodeURIComponent(id)}/events`;
    if (method === 'DELETE' && path === deleteEventsPath) {
      queue.shift();
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
    queue.shift();
    next.resolve?.({ ok: false, error });
  }
}

async function runQueue() {
  if (running || !serverReady) return;
  running = true;
  try {
    while (serverReady && queue.length) {
      const item = queue[0];
      try {
        const result = await send(item);
        queue.shift();
        lastError = null;
        item.resolve?.(result);
        markMutationCompleted(item.path);
      } catch (error) {
        reportError(error);
        const status = Number(error?.status) || 0;
        if (status >= 400 && status < 500) {
          queue.shift();
          pendingPermanentError = lastError;
          item.resolve?.({ ok: false, error: lastError });
          discardImmediateRecordEvents(failedRecordMutationId(item), lastError);
          continue;
        }
        await sleep(1200);
      }
    }
  } finally {
    running = false;
    resolveIdle();
    if (!queue.length) reportCompletedMutationBatch();
    if (serverReady && queue.length) void runQueue();
  }
}

function enqueue(path, options, fallbackMessage) {
  if (!serverReady) return Promise.resolve();
  let resolve;
  const done = new Promise((doneResolve) => { resolve = doneResolve; });
  queue.push({ path, options, fallbackMessage, resolve });
  void runQueue();
  return done;
}

export function setBusinessServerReady(value) {
  serverReady = Boolean(value);
  if (serverReady) void runQueue();
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
  return enqueue(`/business-state/people/${encodeURIComponent(key)}`, {
    method: 'PUT',
    body: JSON.stringify({ person, position }),
  }, 'Не удалось сохранить человека на сервере');
}

export function queuePersonDelete(key) {
  const id = String(key || '').trim();
  if (!id) return Promise.resolve();
  return enqueue(`/business-state/people/${encodeURIComponent(id)}`, { method: 'DELETE' }, 'Не удалось удалить человека на сервере');
}

export function queueUEIStore(uei) {
  return enqueue('/business-state/uei', {
    method: 'PUT',
    body: JSON.stringify({ uei }),
  }, 'Не удалось сохранить UEI на сервере');
}

export function queueRecordUpsert(record, position = 0) {
  const id = String(record?.id || '').trim();
  if (!id) return Promise.resolve();
  return enqueue(`/business-state/records/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify({ record, position }),
  }, 'Не удалось сохранить запись на сервере');
}

export function queueRecordDelete(id) {
  const recordId = String(id || '').trim();
  if (!recordId) return Promise.resolve();
  return enqueue(`/business-state/records/${encodeURIComponent(recordId)}`, { method: 'DELETE' }, 'Не удалось удалить запись на сервере');
}

export function queueEventUpsert(event) {
  const id = String(event?.id || '').trim();
  if (!id) return Promise.resolve();
  return enqueue(`/events/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify({ event }) }, 'Не удалось сохранить событие на сервере');
}

export function queueEventDelete(id) {
  const eventId = String(id || '').trim();
  if (!eventId) return Promise.resolve();
  return enqueue(`/events/${encodeURIComponent(eventId)}`, { method: 'DELETE' }, 'Не удалось удалить событие на сервере');
}

export function queueNoteUpsert(note) {
  const id = String(note?.id || '').trim();
  if (!id) return Promise.resolve();
  return enqueue(`/notes/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify({ note }),
  }, 'Не удалось сохранить заметку на сервере');
}

export function queueNoteDelete(id) {
  const noteId = String(id || '').trim();
  if (!noteId) return Promise.resolve();
  return enqueue(`/notes/${encodeURIComponent(noteId)}`, { method: 'DELETE' }, 'Не удалось удалить заметку на сервере');
}

export function queueRecordEventUpsert(event, position = 0) {
  const id = String(event?.id || '').trim();
  if (!id) return Promise.resolve();
  return enqueue(`/business-state/record-events/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify({ event, position }),
  }, 'Не удалось сохранить историю записи на сервере');
}

export function queueRecordEventsDelete(recordId) {
  const id = String(recordId || '').trim();
  if (!id) return Promise.resolve();
  return enqueue(`/business-state/records/${encodeURIComponent(id)}/events`, { method: 'DELETE' }, 'Не удалось удалить историю записи на сервере');
}

export function queueDocumentDataset(dataset, value) {
  const name = String(dataset || '').trim();
  if (!name) return Promise.resolve();
  return enqueue(`/tenant-document-archive/${encodeURIComponent(name)}`, {
    method: 'PUT',
    body: JSON.stringify({ value }),
  }, 'Не удалось сохранить документы на сервере');
}

export function queueOperationalDataset(dataset, value) {
  const key = String(dataset || '').trim();
  if (!key) return Promise.resolve();
  return enqueue(`/business-state/operational/${encodeURIComponent(key)}`, {
    method: 'PUT',
    body: JSON.stringify({ value }),
  }, 'Не удалось сохранить рабочие данные на сервере');
}

export function queueAuxiliaryDataset(dataset, value) {
  const key = String(dataset || '').trim();
  if (!key) return Promise.resolve();
  return enqueue(`/auxiliary-state/${encodeURIComponent(key)}`, {
    method: 'PUT',
    body: JSON.stringify({ value }),
  }, 'Не удалось сохранить связанные данные на сервере');
}

export async function flushBusinessPersistence({ timeoutMs = 12000 } = {}) {
  if (!serverReady) return;
  if (queue.length || running) {
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
