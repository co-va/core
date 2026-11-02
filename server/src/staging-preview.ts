import type { NextFunction, Request, Response } from 'express';

export const STAGING_PREVIEW_HOST = 'va-app-volokovykh.msk1.amvera.tech';

const STAGING_RAW_BASE = 'https://raw.githubusercontent.com/co-va/core/staging';
const PREVIEW_FETCH_TIMEOUT_MS = 8_000;

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
  if (path === '/') return 'index.html';
  if (path.endsWith('/')) path = `${path}index.html`;

  let decoded: string;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    return null;
  }

  const relative = decoded.replace(/^\/+/, '');
  if (!relative || relative.split('/').includes('..')) return null;
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
  if (!['GET', 'HEAD'].includes(method)) {
    if (loginRequest) return next();
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

  if (request.path === '/admin') return response.redirect(302, '/admin/');

  const file = resolveStagingPreviewFile(request.path);
  if (!file) return next();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PREVIEW_FETCH_TIMEOUT_MS);

  try {
    const upstream = await fetch(`${STAGING_RAW_BASE}/${file}?preview=${Date.now()}`, {
      cache: 'no-store',
      headers: { 'User-Agent': 'CO-VA-Staging-Preview' },
      signal: controller.signal,
    });

    if (upstream.status === 404) return response.status(404).send('Preview file not found');
    if (!upstream.ok) return response.status(502).send('Staging preview unavailable');

    response.setHeader('Content-Type', CONTENT_TYPES.get(fileExtension(file)) || 'application/octet-stream');
    response.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    response.setHeader('Pragma', 'no-cache');
    response.setHeader('Expires', '0');
    response.setHeader('X-CO-VA-Preview', 'staging');

    if (method === 'HEAD') return response.status(200).end();

    const body = Buffer.from(await upstream.arrayBuffer());
    return response.status(200).send(body);
  } catch {
    return response.status(502).send('Staging preview unavailable');
  } finally {
    clearTimeout(timer);
  }
}
