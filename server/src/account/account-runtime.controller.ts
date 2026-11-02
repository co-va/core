import { Body, Controller, Delete, Get, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AccountDocumentService } from '../document-registry/account-document.service';
import { EmailVerificationService } from '../email-verification/email-verification.service';
import { WebPushService } from '../notification/web-push.service';
import { OnlineBookingService } from '../online-booking/online-booking.service';
import { AccountContactRecordService } from './account-contact-record.service';
import { AccountGuard } from './account.guard';
import { AccountRecordService } from './account-record.service';

type AccountRequest = Request & { accountAuth?: { accountId: string; tenantId: string } };

@Controller('account')
export class AccountRuntimeController {
  constructor(
    private readonly account: OnlineBookingService,
    private readonly records: AccountRecordService,
    private readonly contactRecords: AccountContactRecordService,
    private readonly accountDocuments: AccountDocumentService,
    private readonly emailVerification: EmailVerificationService,
    private readonly webPush: WebPushService,
  ) {}

  @Get('terms')
  terms() {
    return this.accountDocuments.publicTerms();
  }

  @Post('prepare')
  prepare(@Body() body: { identifier?: unknown; email?: unknown; phone?: unknown }) {
    return this.account.prepareGlobalAccount(body || {});
  }

  @Post('register')
  register(@Body() body: Record<string, any>) {
    return this.account.registerGlobalAccount(body || {});
  }

  @Post('login')
  login(@Body() body: { identifier?: unknown; email?: unknown; password?: unknown }) {
    return this.account.loginGlobalAccount(body?.identifier ?? body?.email ?? '', body?.password ?? '');
  }

  @UseGuards(AccountGuard)
  @Get('me')
  me(@Req() request: AccountRequest) {
    return this.account.getGlobalAccount(request.accountAuth!.accountId);
  }

  @UseGuards(AccountGuard)
  @Put('me')
  updateMe(@Req() request: AccountRequest, @Body() body: Record<string, any>) {
    return this.account.updateGlobalAccount(request.accountAuth!.accountId, body || {});
  }

  @UseGuards(AccountGuard)
  @Delete('me')
  deleteMe(@Req() request: AccountRequest) {
    return this.account.deleteGlobalAccount(request.accountAuth!.accountId);
  }

  @UseGuards(AccountGuard)
  @Get('platform-state')
  platformState(@Req() request: AccountRequest) {
    return this.accountDocuments.state(request.accountAuth!.accountId);
  }

  @UseGuards(AccountGuard)
  @Post('platform-terms')
  acceptPlatformTerms(@Req() request: AccountRequest, @Body() body: { accountTerms?: unknown }) {
    return this.accountDocuments.accept(
      request.accountAuth!.accountId,
      body?.accountTerms,
      'account',
      { entry: 'global-account' },
    );
  }

  @UseGuards(AccountGuard)
  @Put('password')
  changePassword(
    @Req() request: AccountRequest,
    @Body() body: { currentPassword?: unknown; newPassword?: unknown },
  ) {
    return this.account.changeGlobalAccountPassword(
      request.accountAuth!.accountId,
      body?.currentPassword,
      body?.newPassword,
    );
  }

  @UseGuards(AccountGuard)
  @Get('records')
  accountRecords(@Req() request: AccountRequest) {
    return this.account.globalAccountRecords(request.accountAuth!.accountId);
  }

  @Post('email-verification/confirm')
  confirmEmail(@Body() body: { token?: unknown }) {
    return this.emailVerification.confirmAccount(body?.token);
  }

  @UseGuards(AccountGuard)
  @Get('email-verification/status')
  emailStatus(@Req() request: AccountRequest) {
    return this.emailVerification.statusAccount(request.accountAuth!.accountId);
  }

  @UseGuards(AccountGuard)
  @Post('email-verification/request')
  requestEmail(@Req() request: AccountRequest) {
    return this.emailVerification.requestAccount(request.accountAuth!.accountId);
  }

  @UseGuards(AccountGuard)
  @Post('email-verification/change')
  changeEmail(@Req() request: AccountRequest, @Body() body: { email?: unknown }) {
    return this.emailVerification.changeAccount(request.accountAuth!.accountId, body?.email);
  }

  @UseGuards(AccountGuard)
  @Get('push/config')
  pushConfiguration() {
    return this.webPush.configuration();
  }

  @UseGuards(AccountGuard)
  @Get('push/subscription')
  pushSubscription(@Req() request: AccountRequest, @Query('endpoint') endpoint: string) {
    return this.webPush.subscriptionState(request.accountAuth!.accountId, endpoint);
  }

  @UseGuards(AccountGuard)
  @Put('push/subscription')
  savePushSubscription(
    @Req() request: AccountRequest,
    @Body() body: { subscription?: unknown },
  ) {
    const userAgent = Array.isArray(request.headers['user-agent'])
      ? request.headers['user-agent'][0] || ''
      : request.headers['user-agent'] || '';
    return this.webPush.saveSubscription(
      request.accountAuth!.accountId,
      body?.subscription,
      userAgent,
    );
  }

  @UseGuards(AccountGuard)
  @Delete('push/subscription')
  deletePushSubscription(
    @Req() request: AccountRequest,
    @Body() body: { endpoint?: unknown },
  ) {
    return this.webPush.deleteSubscription(request.accountAuth!.accountId, body?.endpoint);
  }

  @UseGuards(AccountGuard)
  @Get('record-targets')
  recordTargets(@Req() request: AccountRequest) {
    return this.records.listTargets(request.accountAuth!.accountId);
  }

  @UseGuards(AccountGuard)
  @Get('contacts/:tenantId/record-context')
  contactRecordContext(
    @Param('tenantId') tenantId: string,
    @Req() request: AccountRequest,
    @Query('workplace') workplace = '',
  ) {
    return this.contactRecords.context(tenantId, request.accountAuth!.accountId, workplace);
  }

  @UseGuards(AccountGuard)
  @Post('contacts/:tenantId/records')
  createContactRecord(
    @Param('tenantId') tenantId: string,
    @Req() request: AccountRequest,
    @Body() body: Record<string, any>,
  ) {
    return this.contactRecords.create(tenantId, request.accountAuth!.accountId, body || {});
  }

  @UseGuards(AccountGuard)
  @Get('professionals/:tenantId/record-context')
  recordContext(
    @Param('tenantId') tenantId: string,
    @Query('workplace') workplace = '',
  ) {
    return this.records.context(tenantId, workplace);
  }

  @UseGuards(AccountGuard)
  @Post('professionals/:tenantId/records')
  createRecord(
    @Param('tenantId') tenantId: string,
    @Req() request: AccountRequest,
    @Body() body: Record<string, any>,
  ) {
    return this.records.create(tenantId, request.accountAuth!.accountId, body || {});
  }
}
