const PREFIX = 'cova:booking:draft:v1:';

function key(value) {
  return `${PREFIX}${String(value || '').trim()}`;
}

export function loadBookingDraft(id) {
  try {
    const raw = localStorage.getItem(key(id));
    if (!raw) return null;
    const value = JSON.parse(raw);
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

export function saveBookingDraft(id, value) {
  try {
    localStorage.setItem(key(id), JSON.stringify(value ?? null));
    return true;
  } catch {
    return false;
  }
}

export function clearBookingDraft(id) {
  try {
    localStorage.removeItem(key(id));
    return true;
  } catch {
    return false;
  }
}
