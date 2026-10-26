import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { PrismaService } from '../prisma.service';
import { AccountGuard } from './account.guard';

type AccountRequest = Request & { accountAuth?: { accountId: string; tenantId: string } };

@Controller('online-booking/account')
@UseGuards(AccountGuard)
export class AccountBookingTargetsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('booking-targets')
  async list(@Req() request: AccountRequest) {
    const accountId = request.accountAuth!.accountId;
    const links = await this.prisma.accountTenantLink.findMany({
      where: { accountId },
      orderBy: { updatedAt: 'desc' },
      select: { tenantId: true, createdAt: true },
    });
    if (!links.length) return [];

    const profiles = await this.prisma.profile.findMany({
      where: { tenantId: { in: links.map((link) => link.tenantId) } },
      orderBy: { createdAt: 'asc' },
      select: {
        tenantId: true,
        name: true,
        surname: true,
        profession: true,
        phone: true,
      },
    });
    const profileByTenantId = new Map();
    profiles.forEach((profile) => {
      if (!profileByTenantId.has(profile.tenantId)) profileByTenantId.set(profile.tenantId, profile);
    });

    return links.flatMap((link) => {
      const profile = profileByTenantId.get(link.tenantId);
      if (!profile) return [];
      return [{
        tenantId: link.tenantId,
        linkedAt: link.createdAt,
        context: {
          tenantId: link.tenantId,
          profile: {
            name: profile.name,
            surname: profile.surname,
            profession: profile.profession,
            phone: profile.phone,
          },
        },
      }];
    });
  }
}
