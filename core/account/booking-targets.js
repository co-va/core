import { API_BASE } from '../environment.js';
import { getAccountToken } from './index.js';

let cachedToken = '';
let cachedTargets = null;
let inFlight = null;

export async function getGlobalAccountBookingTargets({ refresh = false } = {}) {
  const token = getAccountToken('');
  if (!token) return [];
  if (cachedToken !== token) {
    cachedToken = token;
    cachedTargets = null;
    inFlight = null;
  }
  if (!refresh && Array.isArray(cachedTargets)) return cachedTargets;
  if (!refresh && inFlight) return inFlight;

  const load = (async () => {
    const response = await fetch(`${API_BASE}/online-booking/account/booking-targets`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const payload = await response.json().catch(() => []);
    if (!response.ok) throw new Error(payload?.message || 'Не удалось загрузить специалистов');
    const targets = Array.isArray(payload) ? payload : [];
    if (cachedToken === token) cachedTargets = targets;
    return targets;
  })();
  inFlight = load;
  try {
    return await load;
  } finally {
    if (inFlight === load) inFlight = null;
  }
}
