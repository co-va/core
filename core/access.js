import { apiRequest } from './auth.js';
import { openCommercialLiveFlow } from './commercial-flow.js';

let currentAccess = {
  tenantId: '',
  status: 'ACTIVE',
  isOwnerBook: false,
  commercialMode: '',
  demoActivatedAt: '',
  demoExpiresAt: '',
  liveRequestedAt: '',
  liveApprovedAt: '',
  paidAccessStartsAt: '',
  paidAccessEndsAt: '',
  paidAccessExpired: false,
  plan: null,
  capabilities: [],
};
let capabilityMap = new Map();
let renewalPromptOpened = false;

function applyAccess(value) {
  currentAccess = value && typeof value === 'object' ? value : currentAccess;
  capabilityMap = new Map((Array.isArray(currentAccess.capabilities) ? currentAccess.capabilities : []).map((item) => [item.key, item]));
  return currentAccess;
}

function demoExpired(access) {
  if (access?.commercialMode !== 'DEMO' || !access?.demoActivatedAt || !access?.demoExpiresAt) return false;
  const expiresAt = new Date(access.demoExpiresAt).getTime();
  return Number.isFinite(expiresAt) && expiresAt <= Date.now();
}

function paidAccessExpired(access) {
  return access?.commercialMode === 'LIVE' && access?.paidAccessExpired === true;
}

function openRequiredLiveFlowIfNeeded(access) {
  if (!demoExpired(access)) return;
  queueMicrotask(() => {
    void openCommercialLiveFlow({ required:true })
      .then((payload) => {
        if (payload?.access) applyAccess(payload.access);
      })
      .catch(() => undefined);
  });
}

function openRenewalFlowIfNeeded(access) {
  if (!paidAccessExpired(access) || renewalPromptOpened) return;
  renewalPromptOpened = true;
  queueMicrotask(() => {
    void openCommercialLiveFlow({ required:false })
      .then((payload) => {
        if (payload?.access) applyAccess(payload.access);
      })
      .catch(() => undefined);
  });
}

export async function activateBookDemo() {
  const response = await apiRequest('/saas-access/demo/activate', {
    method: 'POST',
    body: JSON.stringify({}),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.message || 'Не удалось открыть DEMO');
  return applyAccess(payload);
}

export async function requestLiveMode() {
  const payload = await openCommercialLiveFlow({ required:false });
  if (payload?.access) applyAccess(payload.access);
  return payload;
}

export async function loadBookAccess() {
  const response = await apiRequest('/saas-access/me');
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.message || 'Не удалось загрузить доступы');
  const access = applyAccess(payload);
  openRequiredLiveFlowIfNeeded(access);
  openRenewalFlowIfNeeded(access);
  return access;
}

export function getBookAccess() {
  return currentAccess;
}

export function getBookCapability(key) {
  return capabilityMap.get(String(key || '').trim()) || null;
}

export function canUseBookCapability(key) {
  if (currentAccess.status === 'SUSPENDED') return false;
  const capability = getBookCapability(key);
  if (!capability) return currentAccess.isOwnerBook === true;
  if (capability.valueType !== 'BOOLEAN') return true;
  return capability.enabled === true;
}

export function getBookLimit(key) {
  if (currentAccess.status === 'SUSPENDED') return 0;
  const capability = getBookCapability(key);
  if (!capability) return null;
  return capability.valueType === 'LIMIT' ? capability.limit : null;
}

export function canUseRealPersonalData() {
  if (currentAccess.status === 'SUSPENDED') return false;
  return currentAccess.commercialMode === 'LIVE';
}
