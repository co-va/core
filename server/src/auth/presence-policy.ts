// Presence is a time-limited signal, independent of permissions and login history.
export const PRESENCE_ONLINE_MS = 120_000;

export function isAccountOnline(lastSeenAt: Date | string | null | undefined, now = Date.now()): boolean {
  if (!lastSeenAt) return false;
  const timestamp = new Date(lastSeenAt).getTime();
  return Number.isFinite(timestamp) && timestamp <= now && now - timestamp < PRESENCE_ONLINE_MS;
}
