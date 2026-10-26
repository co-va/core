import { API_BASE } from '../environment.js';
import { getAccountToken } from './index.js';

export async function getGlobalAccountBookingTargets() {
  const token = getAccountToken('');
  if (!token) return [];
  const response = await fetch(`${API_BASE}/online-booking/account/booking-targets`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const payload = await response.json().catch(() => []);
  if (!response.ok) throw new Error(payload?.message || 'Не удалось загрузить специалистов');
  return Array.isArray(payload) ? payload : [];
}
