import { Body, Controller, Delete, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AccountGuard } from '../account/account.guard';
import { AccountContactsService } from './account-contacts.service';

type AccountRequest = Request & { accountAuth?: { accountId: string; tenantId: string } };

@Controller('account/contacts')
@UseGuards(AccountGuard)
export class AccountContactsController {
  constructor(private readonly contacts: AccountContactsService) {}

  @Get()
  list(@Req() request: AccountRequest) {
    return this.contacts.list(request.accountAuth!.accountId);
  }

  @Get('search')
  search(@Req() request: AccountRequest, @Query('phone') phone: string) {
    return this.contacts.searchByPhone(request.accountAuth!.accountId, phone);
  }

  @Get(':tenantId/workplaces/:workplaceKey/history')
  workplaceHistory(
    @Req() request: AccountRequest,
    @Param('tenantId') tenantId: string,
    @Param('workplaceKey') workplaceKey: string,
  ) {
    return this.contacts.workplaceHistory(request.accountAuth!.accountId, tenantId, workplaceKey);
  }

  @Get(':tenantId/records/:recordId')
  recordDetail(
    @Req() request: AccountRequest,
    @Param('tenantId') tenantId: string,
    @Param('recordId') recordId: string,
  ) {
    return this.contacts.recordDetail(request.accountAuth!.accountId, tenantId, recordId);
  }

  @Get(':tenantId/personal-account')
  personalAccount(@Req() request: AccountRequest, @Param('tenantId') tenantId: string) {
    return this.contacts.personalAccount(request.accountAuth!.accountId, tenantId);
  }

  @Get(':tenantId/deposits/:depositId')
  depositDetail(
    @Req() request: AccountRequest,
    @Param('tenantId') tenantId: string,
    @Param('depositId') depositId: string,
  ) {
    return this.contacts.depositDetail(request.accountAuth!.accountId, tenantId, depositId);
  }

  @Get(':tenantId')
  detail(@Req() request: AccountRequest, @Param('tenantId') tenantId: string) {
    return this.contacts.detail(request.accountAuth!.accountId, tenantId);
  }

  @Get(':tenantId/consents')
  consents(@Req() request: AccountRequest, @Param('tenantId') tenantId: string) {
    return this.contacts.consentState(request.accountAuth!.accountId, tenantId);
  }

  @Post(':tenantId/consents')
  acceptConsents(
    @Req() request: AccountRequest,
    @Param('tenantId') tenantId: string,
    @Body() body: { consents?: unknown },
  ) {
    return this.contacts.acceptConsents(request.accountAuth!.accountId, tenantId, body?.consents || []);
  }

  @Post(':tenantId/consents/:documentId/revoke')
  revokeConsent(
    @Req() request: AccountRequest,
    @Param('tenantId') tenantId: string,
    @Param('documentId') documentId: string,
  ) {
    return this.contacts.revokeConsent(request.accountAuth!.accountId, tenantId, documentId);
  }

  @Delete(':tenantId')
  remove(@Req() request: AccountRequest, @Param('tenantId') tenantId: string) {
    return this.contacts.remove(request.accountAuth!.accountId, tenantId);
  }
}
