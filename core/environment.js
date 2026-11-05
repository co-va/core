export const PRODUCTION_API_BASE = 'https://api.va-tools.ru';
export const ADMIN_APP_ORIGIN = 'https://admin.va-tools.ru';
export const LOCAL_STAGING_API_BASE = 'http://localhost:3000';
export const CODESPACES_STAGING_API_BASE = '/api';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
const PRODUCTION_HOSTS = new Set([
  new URL(ADMIN_APP_ORIGIN).hostname,
  new URL(PRODUCTION_API_BASE).hostname,
]);
const CODESPACES_SUFFIX = '.app.github.dev';

function normalizedBase(value) {
  return String(value || '').trim().replace(/\/$/, '');
}

export function resolveApiBase({ hostname = '', override = '' } = {}) {
  const explicit = normalizedBase(override);
  if (explicit) return explicit;

  const host = String(hostname || '').trim().toLowerCase();
  if (LOCAL_HOSTS.has(host)) return LOCAL_STAGING_API_BASE;
  if (host.endsWith(CODESPACES_SUFFIX)) return CODESPACES_STAGING_API_BASE;
  if (PRODUCTION_HOSTS.has(host)) return PRODUCTION_API_BASE;

  return '';
}

export function resolveRuntimeEnvironment({ hostname = '', override = '' } = {}) {
  const base = resolveApiBase({ hostname, override });
  return base === PRODUCTION_API_BASE ? 'production' : 'staging';
}

const runtimeHostname = typeof globalThis.location?.hostname === 'string' ? globalThis.location.hostname : '';
const runtimeOverride = typeof globalThis.__PLATFORM_API_BASE__ === 'string' ? globalThis.__BOOK_API_BASE__ : '';

export const API_BASE = resolveApiBase({ hostname: runtimeHostname, override: runtimeOverride });
export const RUNTIME_ENVIRONMENT = resolveRuntimeEnvironment({ hostname: runtimeHostname, override: runtimeOverride });
