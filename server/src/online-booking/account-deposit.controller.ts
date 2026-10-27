import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { BusinessStateService } from '../business-state/business-state.service';
import { DepositService } from '../loyalty/deposit.service';
import { PrismaService } from '../prisma.service';
import { AccountGuard } from './account.guard';

type AccountRequest = Request & {
  accountAuth?: { accountId: string; tenantId: string };
};

function objectValue(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

@Controller('online-booking/account/deposits')
@UseGuards(AccountGuard)
export class AccountDepositController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly businessState: BusinessStateService,
    private readonly deposits: DepositService,
  ) {}

  @Get()
  async list(@Req() request: AccountRequest) {
    const accountId = String(request.accountAuth?.accountId || '').trim();
    const links = await this.prisma.accountTenantLink.findMany({
      where: { accountId },
      select: { tenantId: true },
      orderBy: { updatedAt: 'desc' },
    });

    const rows = await Promise.all(links.map(async ({ tenantId }) => {
      const identity = await this.businessState.bookingIdentityForAccount(tenantId, accountId);
      const person = identity?.person && typeof identity.person === 'object' && !Array.isArray(identity.person)
        ? identity.person as Record<string, unknown>
        : {};
      const personId = String(person.key ?? person.id ?? '').trim();
      if (!personId) return [];
      const [deposits, programRows] = await Promise.all([
        this.deposits.list(tenantId, personId),
        this.prisma.loyaltyDepositProgram.findMany({ where: { tenantId } }),
      ]);
      const programs = new Map(programRows.map((row) => [row.programId, objectValue(row.data)]));
      return deposits
        .filter((deposit: Record<string, any>) => {
          const override = deposit.visibleToPersonOverride;
          if (typeof override === 'boolean') return override;
          const program = programs.get(String(deposit.programId || '')) || {};
          return program.showToAll !== false;
        })
        .map((deposit: Record<string, unknown>) => ({ tenantId, ...deposit }));
    }));

    return rows.flat();
  }
}
