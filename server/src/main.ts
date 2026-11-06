import { NestFactory } from '@nestjs/core';
import { json, static as serveStatic, urlencoded } from 'express';
import type { NextFunction, Request, Response } from 'express';
import { resolve } from 'node:path';
import { AppModule } from './app.module';

const API_HOST = 'api.va-tools.ru';
const ADMIN_HOST = 'admin.va-tools.ru';
const APP_HOST = 'app.va-tools.ru';
const PROF_HOST = 'prof.va-tools.ru';
const USER_HOST = 'user.va-tools.ru';
const LANDING_HOST = 'va-tools.ru';
const LANDING_WWW_HOST = 'www.va-tools.ru';
const TEMP_APP_HOST = 'va-app-temp-volokovykh.msk1.amvera.tech';
const TEMP_USER_PREVIEW_ORIGIN = 'https://user-volokovykh.msk1.amvera.tech';

function normalizeOrigin(value: string) {
  try {
    return new URL(value).origin;
  } catch {
    return value;
  }
}

function requestHost(request: Request) {
  const forwarded = String(request.headers['x-forwarded-host'] || '').split(',')[0].trim();
  const raw = forwarded || String(request.headers.host || '').trim();
  return raw.split(':')[0].trim().toLowerCase();
}

function allowedOrigins() {
  if (process.env.NODE_ENV === 'production') {
    return [
      `https://${ADMIN_HOST}`,
      `https://${PROF_HOST}`,
      `https://${USER_HOST}`,
      `https://${API_HOST}`,
      TEMP_USER_PREVIEW_ORIGIN,
    ];
  }

  const frontendOrigin = normalizeOrigin(
    String(process.env.FRONTEND_ORIGIN || 'http://localhost:8080').trim(),
  );
  const origins: Array<string | RegExp> = [frontendOrigin];
  if (frontendOrigin === 'http://localhost:8080') {
    origins.push(/^https:\/\/[a-z0-9-]+-8080\.app\.github\.dev$/i);
  }
  return origins;
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  // Do not trust arbitrary forwarded IP headers. Configure the exact number
  // of known reverse-proxy hops in Amvera via AUDIT_TRUST_PROXY_HOPS.
  const configuredProxyHops = process.env.AUDIT_TRUST_PROXY_HOPS;
  if (configuredProxyHops && configuredProxyHops !== '0') {
    const hops = Number(configuredProxyHops);
    if (!Number.isSafeInteger(hops) || hops < 1 || hops > 3) {
      throw new Error('AUDIT_TRUST_PROXY_HOPS must be an integer between 1 and 3');
    }
    app.getHttpAdapter().getInstance().set('trust proxy', hops);
  }
  app.use(json({ limit: '50mb' }));
  app.use(urlencoded({ extended: true, limit: '50mb' }));

  const siteRoot = resolve(process.cwd(), '../site');
  const staticSite = serveStatic(siteRoot, {
    index: 'index.html',
    fallthrough: true,
  });

  app.use((request: Request, response: Response, next: NextFunction) => {
    if (!['GET', 'HEAD'].includes(request.method)) return next();

    const host = requestHost(request);

    if (host === LANDING_WWW_HOST) {
      return response.redirect(301, `https://${LANDING_HOST}${request.originalUrl || '/'}`);
    }

    if (host === LANDING_HOST) {
      if (request.path === '/') {
        return response.sendFile(resolve(siteRoot, 'landing/index.html'), {
          headers: {
            'Cache-Control': 'no-store, no-cache, must-revalidate',
            Pragma: 'no-cache',
            Expires: '0',
          },
        });
      }
      if (request.path === '/landing' || request.path === '/landing/') {
        return response.redirect(302, '/');
      }
      if (request.path.startsWith('/css/') || request.path.startsWith('/ui/')) {
        return staticSite(request, response, () => response.status(404).send('Not Found'));
      }
      return response.status(404).send('Not Found');
    }

    if (host === API_HOST) {
      if (request.path === '/') return response.redirect(302, `https://${ADMIN_HOST}/admin/`);
      return next();
    }

    if (host === ADMIN_HOST) {
      if (request.path === '/') return response.redirect(302, '/admin/');
      if (
        request.path.startsWith('/admin/')
        || request.path.startsWith('/core/')
        || request.path.startsWith('/ui/')
        || request.path.startsWith('/css/')
      ) {
        return staticSite(request, response, next);
      }
      return response.status(404).send('Not Found');
    }

    if (host === TEMP_APP_HOST || host === APP_HOST) {
      // The retired Professional origins redirect to the standalone application.
      // Preserve ?booking=... deep links on the guest Booking entry.
      const originalUrl = request.originalUrl || '/';
      const guestBookingQuery = request.path === '/' && typeof request.query.booking === 'string';
      const redirectPath = guestBookingQuery ? `/booking${originalUrl.slice(1)}` : originalUrl;
      return response.redirect(302, `https://${PROF_HOST}${redirectPath}`);
    }

    if (host === USER_HOST) return response.status(404).send('Not Found');

    return next();
  });

  app.enableCors({
    origin: allowedOrigins(),
    credentials: true,
  });

  const port = Number(process.env.PORT || 3000);
  await app.listen(port, '0.0.0.0');
}

bootstrap();
