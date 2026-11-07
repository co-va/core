import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { PrismaService } from '../prisma.service';
import { SaasAccessService } from '../saas-access/saas-access.service';

type WorkplaceRequest = Request & {
  auth?: { platformAccountId: string; tenantId: string; role: string };
  params: { key?: string };
};

@Injectable()
export class WorkplaceLimitGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: SaasAccessService,
  ) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<WorkplaceRequest>();
    const tenantId = request.auth?.tenantId;
    const key = String(request.params?.key || '').trim();
    if (!tenantId || !key) return true;

    // A LIVE grant may be revoked independently of the numeric capacity limit.
    // DEMO uses the same server-resolved grant, ignoring invitation tool toggles.
    const workplaceAccess = await this.access.resolveCapability(tenantId, 'workplaces.access');
    if (workplaceAccess.enabled !== true) {
      throw new ForbiddenException({
        code: 'WORKPLACES_ACCESS_DENIED',
        message: 'Добавление рабочих пространств недоступно',
      });
    }

    const existing = await this.prisma.workplace.findUnique({
      where: { tenantId_key: { tenantId, key } },
      select: { id: true, deletedAt: true },
    });
    if (existing && !existing.deletedAt) return true;

    const capability = await this.access.resolveCapability(tenantId, 'workplaces.max');
    if (capability.limit === null) return true;

    const currentCount = await this.prisma.workplace.count({ where: { tenantId, deletedAt: null } });
    if (currentCount >= capability.limit) {
      throw new ForbiddenException({
        code: 'WORKPLACE_LIMIT',
        message: `Доступно рабочих пространств: ${capability.limit}`,
        limit: capability.limit,
      });
    }
    return true;
  }
}
