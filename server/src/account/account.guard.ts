import { CanActivate, ExecutionContext, Injectable, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
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
  ) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<Request & { accountAuth?: { accountId: string; tenantId: string } }>();
    const authorization = String(request.headers.authorization || '');
    const token = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
    if (!token) throw new UnauthorizedException('Требуется вход в аккаунт');

    let payload: AccountToken;
    try {
      payload = await this.jwt.verifyAsync<AccountToken>(token);
    } catch {
      throw new UnauthorizedException('Войдите в аккаунт заново');
    }
    if (payload.kind !== 'account' || !payload.sub) {
      throw new UnauthorizedException('Войдите в аккаунт заново');
    }

    let account;
    try {
      account = await this.prisma.account.findUnique({
        where: { id: payload.sub },
        select: { profileData: true },
      });
    } catch {
      throw new ServiceUnavailableException('Не удалось проверить аккаунт. Повторите попытку');
    }

    const profileData = account?.profileData && typeof account.profileData === 'object' && !Array.isArray(account.profileData)
      ? account.profileData as Record<string, unknown>
      : {};
    if (!account || String(profileData.deletedAt || '').trim()) {
      throw new UnauthorizedException('Войдите в аккаунт заново');
    }

    request.accountAuth = {
      accountId: payload.sub,
      tenantId: String(request.params?.tenantId || '').trim(),
    };
    return true;
  }
}
