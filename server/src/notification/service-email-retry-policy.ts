// Retry policy for service Email only. The Postbox transport remains authoritative.
export const MAX_SERVICE_EMAIL_ATTEMPTS = 12;
export const SERVICE_EMAIL_SCAN_INTERVAL_MS = 30_000;
export const SERVICE_EMAIL_LEASE_SECONDS = 90;
export const SERVICE_EMAIL_BATCH_SIZE = 10;

export function serviceEmailRetryDelayMs(attempt: number) {
  const safeAttempt = Number.isFinite(attempt) ? Math.max(1, Math.floor(attempt)) : 1;
  return Math.min(60_000 * (2 ** Math.min(12, safeAttempt - 1)), 6 * 60 * 60_000);
}

export function serviceEmailShouldRetry(attempt: number) {
  return Number.isInteger(attempt) && attempt >= 1 && attempt < MAX_SERVICE_EMAIL_ATTEMPTS;
}

export function serviceEmailErrorSummary(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || 'Unknown Postbox error');
  return message.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[email]')
    .replace(/[\r\n\t]+/g, ' ').slice(0, 500);
}
