import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { PrismaService } from '../prisma.service';
import { ProfileService } from '../profile/profile.service';
import { AccountGuard } from './account.guard';

type AccountRequest = Request & { accountAuth?: { accountId: string; tenantId: string } };

@Controller('online-booking/account')
@UseGuards(AccountGuard)
export class AccountBookingTargetsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly profile: ProfileService,
  ) {}

  @Get('booking-targets')
  async list(@Req() request: AccountRequest) {
    const accountId = request.accountAuth!.accountId;
    const links = await this.prisma.accountTenantLink.findMany({
      where: { accountId },
      orderBy: { updatedAt: 'desc' },
      select: { tenantId: true, createdAt: true },
    });
    const targets = await Promise.all(links.map(async (link) => {
      try {
        const profile = await this.profile.accountRelationshipProfile(link.tenantId);
        return {
          tenantId: link.tenantId,
          linkedAt: link.createdAt,
          context: { tenantId: link.tenantId, profile },
        };
      } catch {
        return null;
      }
    }));
    return targets.filter(Boolean);
  }
}
