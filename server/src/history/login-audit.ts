import { randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import type { Request } from 'express';
import { PrismaService } from '../prisma.service';

export type LoginRequestContext = {
  ip: string;
  userAgent: string;
  os: string;
  browser: string;
  deviceClass: string;
  displayMode: 'web' | 'pwa' | 'unknown';
  displayModeEvidence: 'client-asserted' | 'unavailable';
};

function userAgentClass(ua: string) {
  const os = /iphone|ipad|ipod/i.test(ua) ? 'iOS'
    : /android/i.test(ua) ? 'Android'
    : /windows/i.test(ua) ? 'Windows'
    : /mac os x|macintosh/i.test(ua) ? 'macOS'
    : /linux/i.test(ua) ? 'Linux' : 'unknown';
  const browser = /edg\//i.test(ua) ? 'Edge'
    : /firefox\//i.test(ua) ? 'Firefox'
    : /chrome\//i.test(ua) ? 'Chrome'
    : /safari\//i.test(ua) ? 'Safari' : 'unknown';
  const deviceClass = /ipad|tablet/i.test(ua) ? 'tablet'
    : /mobile|iphone|ipod|android/i.test(ua) ? 'mobile'
    : ua ? 'desktop' : 'unknown';
  return { os, browser, deviceClass };
}

// Only Express's request.ip is consulted. X-Forwarded-For is never parsed
// independently. Trusted proxy hops must be explicitly configured in main.ts.
export function loginContextFromRequest(request: Request): LoginRequestContext {
  const candidateIp = String(request.ip || '').trim().slice(0,64);
  const ip = isIP(candidateIp) ? candidateIp : '';
  const userAgent = String(request.headers['user-agent'] || '').slice(0,350);
  const requestedMode = String(request.headers['x-va-display-mode'] || '').trim().toLowerCase();
  const displayMode = requestedMode === 'web' || requestedMode === 'pwa'
    ? requestedMode : 'unknown';
  return {
    ip,
    userAgent,
    ...userAgentClass(userAgent),
    displayMode,
    displayModeEvidence: displayMode === 'unknown' ? 'unavailable' : 'client-asserted',
  };
}

export async function recordLoginAttempt(
  prisma: PrismaService,
  input: {
    surface: 'professional' | 'user';
    result: 'success' | 'denied';
    reason: string;
    tenantId?: string | null;
    platformAccountId?: string | null;
    accountId?: string | null;
    context?: LoginRequestContext;
  },
): Promise<void> {
  const correlationId = randomUUID();
  const identity = input.surface === 'professional'
    ? (input.platformAccountId || '')
    : (input.accountId || '');
  await prisma.platformActivityEvent.create({
    data: {
      tenantId: input.tenantId || null,
      platformAccountId: input.platformAccountId || null,
      subjectAccountId: input.accountId || null,
      eventType: input.result === 'success' ? 'AUTH_LOGIN_SUCCEEDED' : 'AUTH_LOGIN_DENIED',
      metadata: {
        contractVersion: 1,
        scope: 'platform',
        owner: { type: 'platform' },
        entityType: 'authentication',
        entityId: identity || 'anonymous',
        action: 'login',
        actor: { type: identity ? input.surface : 'anonymous', id: identity },
        before: null,
        after: null,
        reason: input.reason,
        source: { type: 'api', surface: input.surface },
        result: input.result,
        correlationId,
        context: {
          ip: input.context?.ip || '',
          userAgent: input.context?.userAgent || '',
          os: input.context?.os || 'unknown',
          browser: input.context?.browser || 'unknown',
          deviceClass: input.context?.deviceClass || 'unknown',
          displayMode: input.context?.displayMode || 'unknown',
          displayModeEvidence: input.context?.displayModeEvidence || 'unavailable',
          // User-Agent / display mode are claims, not device identity.
          deviceIdentityVerified: false,
        },
      },
    },
  });
}
