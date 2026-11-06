import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AccountGuard as AccountApiGuard } from '../account/account.guard';
import { AccountGuard as BookingAccountGuard } from '../online-booking/account.guard';
import { AccountUnreadService } from './account-unread.service';

type AccountRequest = Request & { accountAuth?: { accountId: string; tenantId: string } };

abstract class AccountUnreadRoutes {
  constructor(protected readonly unread: AccountUnreadService) {}

  summary(@Req() request: AccountRequest) {
    return this.unread.summary(request.accountAuth!.accountId);
  }

  serviceUnseen(@Req() request: AccountRequest) {
    return this.unread.serviceUnseen(request.accountAuth!.accountId);
  }

  markServiceSeen(
    @Req() request: AccountRequest,
    @Body() body: { recordIds?: unknown },
  ) {
    return this.unread.markServiceRecordsSeen(request.accountAuth!.accountId, body?.recordIds);
  }
}

@Controller('account')
@UseGuards(AccountApiGuard)
export class AccountApiUnreadController extends AccountUnreadRoutes {
  constructor(unread: AccountUnreadService) {
    super(unread);
  }

  @Get('unread-summary')
  override summary(@Req() request: AccountRequest) {
    return super.summary(request);
  }

  @Get('service-unseen')
  override serviceUnseen(@Req() request: AccountRequest) {
    return super.serviceUnseen(request);
  }

  @Get('deleted-record-history')
  deletedRecordHistory(@Req() request: AccountRequest) {
    return this.unread.deletedRecordHistory(request.accountAuth!.accountId);
  }

  @Get('journal-hidden-records')
  journalHiddenRecords(@Req() request: AccountRequest) {
    return this.unread.journalHiddenRecords(request.accountAuth!.accountId);
  }

  @Post('journal-hidden-records')
  hideJournalRecord(
    @Req() request: AccountRequest,
    @Body() body: { tenantId?: unknown; recordId?: unknown },
  ) {
    return this.unread.hideJournalRecord(request.accountAuth!.accountId, body?.tenantId, body?.recordId);
  }

  @Post('service-unseen/seen')
  override markServiceSeen(
    @Req() request: AccountRequest,
    @Body() body: { recordIds?: unknown },
  ) {
    return super.markServiceSeen(request, body);
  }
}

@Controller('online-booking/account')
@UseGuards(BookingAccountGuard)
export class AccountUnreadController extends AccountUnreadRoutes {
  constructor(unread: AccountUnreadService) {
    super(unread);
  }

  @Get('unread-summary')
  override summary(@Req() request: AccountRequest) {
    return super.summary(request);
  }

  @Get('service-unseen')
  override serviceUnseen(@Req() request: AccountRequest) {
    return super.serviceUnseen(request);
  }

  @Post('service-unseen/seen')
  override markServiceSeen(
    @Req() request: AccountRequest,
    @Body() body: { recordIds?: unknown },
  ) {
    return super.markServiceSeen(request, body);
  }
}
