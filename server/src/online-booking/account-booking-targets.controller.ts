import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AccountRecordService } from '../account/account-record.service';
import { AccountGuard } from './account.guard';

type AccountRequest = Request & { accountAuth?: { accountId: string; tenantId: string } };

@Controller('online-booking/account')
@UseGuards(AccountGuard)
export class AccountBookingTargetsController {
  constructor(private readonly records: AccountRecordService) {}

  @Get('booking-targets')
  list(@Req() request: AccountRequest) {
    return this.records.listTargets(request.accountAuth!.accountId);
  }
}
