// One canonical heartbeat feeds both online/offline and accounted foreground time.
export const PRESENCE_ONLINE_MS = 120_000;

export function isAccountOnline(lastSeenAt: Date | string | null | undefined, now = Date.now()): boolean {
  if (!lastSeenAt) return false;
  const timestamp = new Date(lastSeenAt).getTime();
  return Number.isFinite(timestamp) && timestamp <= now && now - timestamp < PRESENCE_ONLINE_MS;
}

// Credit only the interval between successive authenticated foreground heartbeats.
// Never count an outage/closed browser beyond the 2-minute presence timeout.
// Split UTC-day boundaries so future daily/weekly/monthly reports share these totals.
export function creditPresenceDays(lastSeenAt: Date | string | null | undefined, seenAt: Date): Array<{ day: Date; milliseconds: number }> {
  if (!isAccountOnline(lastSeenAt, seenAt.getTime())) return [];
  let start = new Date(lastSeenAt!).getTime();
  const end = seenAt.getTime();
  const slices: Array<{ day: Date; milliseconds: number }> = [];
  while (start < end) {
    const date = new Date(start);
    const day = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    const nextDay = day.getTime() + 86_400_000;
    const stop = Math.min(end, nextDay);
    slices.push({ day, milliseconds: stop - start });
    start = stop;
  }
  return slices;
}
