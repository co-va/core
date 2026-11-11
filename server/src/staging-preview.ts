import type { NextFunction, Request, Response } from 'express';

export const STAGING_PREVIEW_HOST = 'va-app-volokovykh.msk1.amvera.tech';

const STAGING_RAW_BASE = 'https://raw.githubusercontent.com/co-va/core/staging';
const PREVIEW_FETCH_TIMEOUT_MS = 8_000;
const PREVIEW_CACHE_TTL_MS = 15_000;
const PREVIEW_CACHE_MAX_STALE_MS = 5 * 60_000;
const PREVIEW_CACHE_MAX_FILES = 96;
const PREVIEW_CACHE_MAX_FILE_BYTES = 2 * 1024 * 1024;

type PreviewCacheEntry = { body: Buffer; fetchedAt: number };
const previewAssetCache = new Map<string, PreviewCacheEntry>();
const pendingAssetFetches = new Map<string, Promise<Buffer | null>>();

function rememberPreviewAsset(file: string, body: Buffer) {
  if (body.byteLength > PREVIEW_CACHE_MAX_FILE_BYTES) return;
  previewAssetCache.delete(file);
  previewAssetCache.set(file, { body, fetchedAt: Date.now() });
  while (previewAssetCache.size > PREVIEW_CACHE_MAX_FILES) {
    const oldest = previewAssetCache.keys().next().value;
    if (!oldest) break;
    previewAssetCache.delete(oldest);
  }
}

function fetchPreviewAsset(file: string): Promise<Buffer | null> {
  const current = pendingAssetFetches.get(file);
  if (current) return current;

  const task = (async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PREVIEW_FETCH_TIMEOUT_MS);
    try {
      const upstream = await fetch(`${STAGING_RAW_BASE}/${file}?preview=${Date.now()}`, {
        cache: 'no-store',
        headers: { 'User-Agent': 'CO-VA-Staging-Preview' },
        signal: controller.signal,
      });
      if (upstream.status === 404) {
        previewAssetCache.delete(file);
        return null;
      }
      if (!upstream.ok) throw new Error('Staging asset fetch failed');
      const body = Buffer.from(await upstream.arrayBuffer());
      rememberPreviewAsset(file, body);
      return body;
    } finally {
      clearTimeout(timer);
    }
  })().finally(() => {
    pendingAssetFetches.delete(file);
  });
  pendingAssetFetches.set(file, task);
  return task;
}

function setPreviewAssetHeaders(response: Response, file: string, cacheStatus: string) {
  response.setHeader('Content-Type', CONTENT_TYPES.get(fileExtension(file)) || 'application/octet-stream');
  response.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  response.setHeader('Pragma', 'no-cache');
  response.setHeader('Expires', '0');
  response.setHeader('X-CO-VA-Preview', 'staging');
  response.setHeader('X-CO-VA-Preview-Cache', cacheStatus);
}


const CONTENT_TYPES = new Map<string, string>([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.webmanifest', 'application/manifest+json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
  ['.ico', 'image/x-icon'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2'],
]);

function requestHost(request: Request) {
  const forwarded = String(request.headers['x-forwarded-host'] || '').split(',')[0].trim();
  const raw = forwarded || String(request.headers.host || '').trim();
  return raw.split(':')[0].trim().toLowerCase();
}

function fileExtension(path: string) {
  const name = path.split('/').pop() || '';
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.slice(dot).toLowerCase() : '';
}

export function resolveStagingPreviewFile(pathname: string) {
  let path = String(pathname || '').split('?')[0];
  if (path === '/') return null;
  if (path.endsWith('/')) path = `${path}index.html`;

  let decoded: string;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    return null;
  }

  const relative = decoded.replace(/^\/+/, '');
  const segments = relative.split('/');
  if (!relative || segments.some((segment) => !segment || segment === '.' || segment === '..') || relative.includes('\\')) return null;
  if (!['admin', 'landing', 'core', 'ui', 'css'].includes(segments[0])) return null;
  if (!CONTENT_TYPES.has(fileExtension(relative))) return null;
  return relative;
}

export async function stagingPreviewMiddleware(
  request: Request,
  response: Response,
  next: NextFunction,
) {
  if (requestHost(request) !== STAGING_PREVIEW_HOST) return next();

  const method = request.method.toUpperCase();
  const loginRequest = method === 'POST' && request.path === '/auth/login';
  const documentRegistrySync = method === 'POST' && request.path === '/saas-admin/document-registry/sync';
  // The preview remains read-only for business mutations. Allow only the
  // existing authenticated, membership-scoped presence heartbeat so the Admin
  // can report its own online state on this host. JwtAuthGuard and membership
  // validation run downstream unchanged; no unauthenticated write is permitted.
  const authenticatedPresence = method === 'POST' && request.path === '/auth/presence';
  if (!['GET', 'HEAD'].includes(method)) {
    if (loginRequest || authenticatedPresence) return next();
    if (documentRegistrySync) {
      response.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      response.setHeader('X-CO-VA-Preview', 'staging');
      return response.status(200).json({ preview: true, synchronized: false });
    }
    response.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    response.setHeader('X-CO-VA-Preview', 'staging');
    return response.status(405).json({
      message: 'Staging preview доступен только для просмотра',
    });
  }

  // Core no longer contains the Professional/User browser app. Preview defaults to Admin.
  if (request.path === '/' || request.path === '/admin') return response.redirect(302, '/admin/');
  if (request.path === '/landing') return response.redirect(302, '/landing/');

  const file = resolveStagingPreviewFile(request.path);
  if (!file) return next();

  const cached = previewAssetCache.get(file);
  if (cached && Date.now() - cached.fetchedAt < PREVIEW_CACHE_TTL_MS) {
    setPreviewAssetHeaders(response, file, 'hit');
    if (method === 'HEAD') return response.status(200).end();
    return response.status(200).send(cached.body);
  }
  if (cached && Date.now() - cached.fetchedAt < PREVIEW_CACHE_MAX_STALE_MS) {
    // Serve a known-good snapshot immediately and refresh in the background.
    // Slow or temporarily unavailable GitHub must not block the Admin UI.
    void fetchPreviewAsset(file).catch(() => undefined);
    setPreviewAssetHeaders(response, file, 'stale');
    if (method === 'HEAD') return response.status(200).end();
    return response.status(200).send(cached.body);
  }

  try {
    const body = await fetchPreviewAsset(file);
    if (!body) return response.status(404).send('Preview file not found');
    setPreviewAssetHeaders(response, file, 'miss');
    if (method === 'HEAD') return response.status(200).end();
    return response.status(200).send(body);
  } catch {
    return response.status(502).send('Staging preview unavailable');
  }
}
