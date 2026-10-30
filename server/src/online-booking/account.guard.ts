import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { EmailVerificationService } from '../email-verification/email-verification.service';
import { PrismaService } from '../prisma.service';
import type { Request } from 'express';

type AccountToken = {
  sub?: string;
  kind?: string;
};

@Injectable()
export class AccountGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    private readonly emailVerification: EmailVerificationService,
  ) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<Request & { accountAuth?: { accountId: string; tenantId: string } }>();
    const authorization = String(request.headers.authorization || '');
    const token = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
    if (!token) throw new UnauthorizedException('Требуется вход в аккаунт');

    try {
      const payload = await this.jwt.verifyAsync<AccountToken>(token);
      if (payload.kind !== 'account' || !payload.sub) throw new Error('invalid account token');
      const account = await this.prisma.account.findUnique({
        where: { id: payload.sub },
        select: { profileData: true },
      });
      const profileData = account?.profileData && typeof account.profileData === 'object' && !Array.isArray(account.profileData)
        ? account.profileData as Record<string, unknown>
        : {};
      if (!account || String(profileData.deletedAt || '').trim()) throw new Error('inactive account token');
      const tenantId = String(request.params?.tenantId || '').trim();
      request.accountAuth = { accountId: payload.sub, tenantId };
      void this.emailVerification.requestAccount(payload.sub).catch(() => undefined);

      if (tenantId) {
        const requestPath = String((request as any).path || request.url || '').split('?')[0];
        const chatThread = request.method === 'GET' && /\/account\/chat\/?$/.test(requestPath);
        const messengerThread = request.method === 'GET' && /\/account\/messenger\/conversations\/[^/]+\/messages\/?$/.test(requestPath);
        const conversationId = messengerThread ? String(request.params?.conversationId || '').trim() : '';

        if (chatThread || messengerThread) {
          await this.prisma.$executeRaw`
            UPDATE "CommunicationMessage" m
            SET "status" = 'delivered',
                "deliveredAt" = COALESCE(m."deliveredAt", CURRENT_TIMESTAMP)
            WHERE m."tenantId" = ${tenantId}
              AND m."direction" = 'outbound'
              AND m."purpose" = 'DIRECT'
              AND m."readAt" IS NULL
              AND m."failedAt" IS NULL
              AND m."status" <> 'failed'
              AND m."deliveredAt" IS NULL
              AND EXISTS (
                SELECT 1
                FROM "AccountContact" c
                WHERE c."accountId" = ${payload.sub}
                  AND c."type" = 'PHONE'
                  AND c."value" = m."personPhone"
              )
          `;

          await this.prisma.$executeRaw`
            UPDATE "CommunicationMessage" m
            SET "status" = 'read',
                "deliveredAt" = COALESCE(m."deliveredAt", CURRENT_TIMESTAMP),
                "readAt" = COALESCE(m."readAt", CURRENT_TIMESTAMP)
            WHERE m."tenantId" = ${tenantId}
              AND m."direction" = 'outbound'
              AND m."purpose" = 'DIRECT'
              AND m."failedAt" IS NULL
              AND m."status" <> 'failed'
              AND (${conversationId} = '' OR m."conversationId" = ${conversationId})
              AND EXISTS (
                SELECT 1
                FROM "AccountContact" c
                WHERE c."accountId" = ${payload.sub}
                  AND c."type" = 'PHONE'
                  AND c."value" = m."personPhone"
              )
          `;
        }
      }
      return true;
    } catch {
      throw new UnauthorizedException('Войдите в аккаунт заново');
    }
  }
}
