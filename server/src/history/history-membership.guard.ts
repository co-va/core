import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { PrismaService } from '../prisma.service';

// A valid JWT alone does not prove that a Professional still belongs to a tenant.
@Injectable()
export class HistoryMembershipGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<Request & {
      auth?: { platformAccountId: string; tenantId: string };
    }>();
    const accountId = String(request.auth?.platformAccountId || '');
    const tenantId = String(request.auth?.tenantId || '');
    if (!accountId || !tenantId) throw new ForbiddenException('История недоступна');
    const membership = await this.prisma.membership.findUnique({
      where: {
        tenantId_platformAccountId: {
          tenantId,
          platformAccountId: accountId,
        },
      },
      select: { id: true },
    });
    if (!membership) throw new ForbiddenException('Нет доступа к истории пространства');
    return true;
  }
}
