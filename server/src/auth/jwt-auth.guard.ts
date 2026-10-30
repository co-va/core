import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { PrismaService } from '../prisma.service';

function text(value: unknown) {
  return String(Array.isArray(value) ? value[0] : value ?? '').trim();
}

function canonicalPhone(value: unknown) {
  const digits = text(value).replace(/\D/g, '');
  if (digits.length === 10) return `7${digits}`;
  if (digits.length === 11 && digits.startsWith('8')) return `7${digits.slice(1)}`;
  return digits;
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<Request & { auth?: { platformAccountId: string; tenantId: string; role: string } }>();
    const authorization = String(request.headers.authorization || '');
    const [type, token] = authorization.split(' ');
    if (type !== 'Bearer' || !token) throw new UnauthorizedException();

    try {
      const payload = await this.jwt.verifyAsync<{ sub: string; tenantId: string; role: string }>(token);
      if (!payload.sub || !payload.tenantId) throw new UnauthorizedException();
      request.auth = { platformAccountId: payload.sub, tenantId: payload.tenantId, role: payload.role || '' };

      const requestPath = String((request as any).path || request.url || '').split('?')[0];
      const chatThread = request.method === 'GET' && /\/communications\/chat\/thread\/?$/.test(requestPath);
      const messengerThread = request.method === 'GET' && /\/communications\/messenger\/conversations\/[^/]+\/messages\/?$/.test(requestPath);

      if (chatThread || messengerThread) {
        await this.prisma.$executeRaw`
          UPDATE "CommunicationMessage"
          SET "status" = 'delivered',
              "deliveredAt" = COALESCE("deliveredAt", CURRENT_TIMESTAMP)
          WHERE "tenantId" = ${payload.tenantId}
            AND "direction" = 'inbound'
            AND "purpose" = 'DIRECT'
            AND "readAt" IS NULL
            AND "failedAt" IS NULL
            AND "status" <> 'failed'
            AND "deliveredAt" IS NULL
        `;
      }

      if (chatThread) {
        const phone = canonicalPhone((request.query as any)?.phone);
        const uei = text((request.query as any)?.uei);
        const externalThreadId = text((request.query as any)?.externalThreadId);
        if (phone || uei || externalThreadId) {
          await this.prisma.$executeRaw`
            UPDATE "CommunicationMessage"
            SET "status" = 'read',
                "deliveredAt" = COALESCE("deliveredAt", CURRENT_TIMESTAMP),
                "readAt" = COALESCE("readAt", CURRENT_TIMESTAMP)
            WHERE "tenantId" = ${payload.tenantId}
              AND "direction" = 'inbound'
              AND "purpose" = 'DIRECT'
              AND "failedAt" IS NULL
              AND "status" <> 'failed'
              AND (
                (${phone} <> '' AND "personPhone" = ${phone})
                OR (${phone} = '' AND ${uei} <> '' AND "uei" = ${uei})
                OR (${phone} = '' AND ${uei} = '' AND ${externalThreadId} <> '' AND "externalThreadId" = ${externalThreadId})
              )
          `;
        }
      } else if (messengerThread) {
        const conversationId = text(request.params?.conversationId);
        if (conversationId) {
          await this.prisma.$executeRaw`
            UPDATE "CommunicationMessage"
            SET "status" = 'read',
                "deliveredAt" = COALESCE("deliveredAt", CURRENT_TIMESTAMP),
                "readAt" = COALESCE("readAt", CURRENT_TIMESTAMP)
            WHERE "tenantId" = ${payload.tenantId}
              AND "conversationId" = ${conversationId}
              AND "direction" = 'inbound'
              AND "purpose" = 'DIRECT'
              AND "failedAt" IS NULL
              AND "status" <> 'failed'
          `;
        }
      }
      return true;
    } catch {
      throw new UnauthorizedException();
    }
  }
}
