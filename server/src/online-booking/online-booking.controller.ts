import { BadRequestException, Body, Controller, Delete, Get, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CommunicationService } from '../communication/communication.service';
import { AccountDocumentService } from '../document-registry/account-document.service';
import { NotificationService } from '../notification/notification.service';
import { WebPushService } from '../notification/web-push.service';
import { PlatformNoticeService } from '../platform-notice/platform-notice.service';
import { AccountGuard } from './account.guard';
import { BookingFlowService } from './booking-flow.service';
import { BookingPdnConsentGuard } from './booking-pdn-consent.guard';
import { PersonIdentityService } from './person-identity.service';
import { OnlineBookingService } from './online-booking.service';

type OwnerRequest = Request & { auth?: { platformAccountId: string; tenantId: string; role: string } };
type AccountRequest = Request & { accountAuth?: { accountId: string; tenantId: string } };

@Controller('online-booking')
export class OnlineBookingController {
  constructor(
    private readonly booking: OnlineBookingService,
    private readonly bookingFlow: BookingFlowService,
    private readonly accountDocuments: AccountDocumentService,
    private readonly notifications: NotificationService,
    private readonly platformNotices: PlatformNoticeService,
    private readonly communications: CommunicationService,
    private readonly webPush: WebPushService,
    private readonly personIdentity: PersonIdentityService,
  ) {}

  private async accountTelegramSettings(tenantId: string, accountId: string) {
    const context = await this.booking.accountTenantContactContext(tenantId, accountId);
    const identity = await this.communications.telegramIdentity(tenantId, context);
    if (!identity) return { telegram: { linked: false, enabled: false, username: '' } };
    return {
      telegram: {
        linked: true,
        enabled: true,
        username: identity.display || '',
      },
    };
  }

  @UseGuards(JwtAuthGuard)
  @Put('owner/publication')
  publish(@Req() request: OwnerRequest, @Body() body: { data?: unknown }) {
    return this.booking.publish(request.auth!.tenantId, body?.data || {});
  }

  @UseGuards(JwtAuthGuard)
  @Get('owner/route')
  ownerPublicRoute(@Req() request: OwnerRequest) {
    return this.booking.ownerPublicRoute(request.auth!.tenantId);
  }

  @UseGuards(JwtAuthGuard)
  @Get('owner/accounts')
  ownerAccounts(@Req() request: OwnerRequest) {
    return this.booking.ownerAccounts(request.auth!.tenantId);
  }

  @UseGuards(JwtAuthGuard)
  @Put('owner/accounts/sync')
  syncOwnerAccounts(@Req() request: OwnerRequest, @Body() body: { accounts?: unknown }) {
    return this.booking.syncOwnerAccounts(request.auth!.tenantId, body?.accounts || []);
  }

  @Get('account-terms')
  accountTerms() {
    return this.accountDocuments.publicTerms();
  }

  @Post('account/prepare')
  prepareGlobalAccount(@Body() body: { identifier?: unknown; email?: unknown; phone?: unknown }) {
    return this.booking.prepareGlobalAccount(body || {});
  }

  @Post('account/register')
  registerGlobalAccount(@Body() body: Record<string, any>) {
    return this.booking.registerGlobalAccount(body || {});
  }

  @Post('account/login')
  loginGlobalAccount(@Body() body: { identifier?: unknown; email?: unknown; password?: unknown }) {
    return this.booking.loginGlobalAccount(body?.identifier ?? body?.email ?? '', body?.password ?? '');
  }

  @UseGuards(AccountGuard)
  @Get('account/me')
  globalAccount(@Req() request: AccountRequest) {
    return this.booking.getGlobalAccount(request.accountAuth!.accountId);
  }

  @UseGuards(AccountGuard)
  @Put('account/me')
  updateGlobalAccount(@Req() request: AccountRequest, @Body() body: Record<string, any>) {
    return this.booking.updateGlobalAccount(request.accountAuth!.accountId, body || {});
  }

  @UseGuards(AccountGuard)
  @Delete('account/me')
  deleteGlobalAccount(@Req() request: AccountRequest) {
    return this.booking.deleteGlobalAccount(request.accountAuth!.accountId);
  }

  @UseGuards(AccountGuard)
  @Get('account/platform-state')
  globalAccountPlatformState(@Req() request: AccountRequest) {
    return this.accountDocuments.state(request.accountAuth!.accountId);
  }

  @UseGuards(AccountGuard)
  @Post('account/platform-terms')
  acceptGlobalAccountTerms(
    @Req() request: AccountRequest,
    @Body() body: { accountTerms?: unknown },
  ) {
    return this.accountDocuments.accept(
      request.accountAuth!.accountId,
      body?.accountTerms,
      'account',
      { entry: 'global-account' },
    );
  }

  @UseGuards(AccountGuard)
  @Put('account/password')
  changeGlobalAccountPassword(
    @Req() request: AccountRequest,
    @Body() body: { currentPassword?: unknown; newPassword?: unknown },
  ) {
    return this.booking.changeGlobalAccountPassword(
      request.accountAuth!.accountId,
      body?.currentPassword,
      body?.newPassword,
    );
  }

  @UseGuards(AccountGuard)
  @Get('account/relationships')
  globalAccountRelationships(@Req() request: AccountRequest) {
    return this.booking.globalAccountRelationships(request.accountAuth!.accountId);
  }

  @UseGuards(AccountGuard)
  @Delete('account/relationships/:tenantId')
  deleteGlobalAccountRelationship(
    @Param('tenantId') tenantId: string,
    @Req() request: AccountRequest,
  ) {
    return this.booking.deleteGlobalAccountRelationship(request.accountAuth!.accountId, tenantId);
  }

  @UseGuards(AccountGuard)
  @Post('account/investments/:tenantId/:investmentId/decision')
  decideGlobalAccountInvestment(
    @Param('tenantId') tenantId: string,
    @Param('investmentId') investmentId: string,
    @Req() request: AccountRequest,
    @Body() body: { decision?: unknown },
  ) {
    return this.booking.decideGlobalAccountInvestment(
      request.accountAuth!.accountId,
      tenantId,
      investmentId,
      body?.decision,
    );
  }

  @UseGuards(AccountGuard)
  @Get('account/records')
  globalAccountRecords(@Req() request: AccountRequest) {
    return this.booking.globalAccountRecords(request.accountAuth!.accountId);
  }

  @UseGuards(AccountGuard)
  @Get(':tenantId/account/platform-state')
  accountPlatformState(@Req() request: AccountRequest) {
    return this.accountDocuments.state(request.accountAuth!.accountId);
  }

  @UseGuards(AccountGuard)
  @Post(':tenantId/account/platform-terms')
  acceptAccountTerms(
    @Param('tenantId') tenantId: string,
    @Req() request: AccountRequest,
    @Body() body: { accountTerms?: unknown },
  ) {
    return this.accountDocuments.accept(
      request.accountAuth!.accountId,
      body?.accountTerms,
      'online-booking-account',
      { tenantContext: tenantId },
    );
  }

  @Get('route/:profileSlug')
  publicRoute(@Param('profileSlug') profileSlug: string, @Query('workplace') workplace = '') {
    return this.booking.resolvePublicRoute(profileSlug, workplace);
  }

  @Get(':tenantId/context')
  context(@Param('tenantId') tenantId: string, @Query('workplace') workplace = '') {
    return this.booking.getContext(tenantId, workplace);
  }

  @Post(':tenantId/account/prepare')
  prepareAccount(
    @Param('tenantId') tenantId: string,
    @Body() body: { identifier?: unknown; email?: unknown; phone?: unknown },
  ) {
    return this.booking.prepareAccount(tenantId, body || {});
  }

  @Post(':tenantId/account/register')
  registerAccount(@Param('tenantId') tenantId: string, @Body() body: Record<string, any>) {
    return this.booking.registerAccount(tenantId, body || {});
  }

  @Post(':tenantId/account/login')
  loginAccount(@Param('tenantId') tenantId: string, @Body() body: { identifier?: unknown; email?: unknown; password?: unknown }) {
    return this.booking.loginAccount(tenantId, body?.identifier ?? body?.email ?? '', body?.password ?? '');
  }

  @UseGuards(AccountGuard)
  @Get(':tenantId/account/me')
  account(@Param('tenantId') tenantId: string, @Req() request: AccountRequest) {
    return this.booking.getAccount(tenantId, request.accountAuth!.accountId);
  }

  @UseGuards(AccountGuard)
  @Put(':tenantId/account/me')
  updateAccount(@Param('tenantId') tenantId: string, @Req() request: AccountRequest, @Body() body: Record<string, any>) {
    return this.booking.updateAccount(tenantId, request.accountAuth!.accountId, body || {});
  }

  @Post(':tenantId/account/telegram-entry/resolve')
  async resolveTelegramEntry(
    @Param('tenantId') tenantId: string,
    @Body() body: { token?: unknown },
  ) {
    const resolved = await this.communications.resolveTelegramEntryAccount(tenantId, body?.token);
    if (!resolved.exists || !resolved.accountId) return { exists: false };
    const payload = await this.booking.resumeAccount(tenantId, resolved.accountId);
    await this.communications.bindTelegramEntry(tenantId, resolved.accountId, body?.token);
    await this.booking.syncAccountPersonContacts(resolved.accountId);
    return { ...payload, exists: true };
  }

  @UseGuards(AccountGuard)
  @Post(':tenantId/account/telegram-entry')
  async bindTelegramEntry(@Param('tenantId') tenantId: string, @Req() request: AccountRequest, @Body() body: { token?: unknown }) {
    const result = await this.communications.bindTelegramEntry(tenantId, request.accountAuth!.accountId, body?.token);
    await this.booking.syncAccountPersonContacts(request.accountAuth!.accountId);
    return result;
  }

  @UseGuards(AccountGuard)
  @Get(':tenantId/account/chat/settings')
  chatSettings(@Param('tenantId') tenantId: string, @Req() request: AccountRequest) {
    return this.accountTelegramSettings(tenantId, request.accountAuth!.accountId);
  }

  @UseGuards(AccountGuard)
  @Get(':tenantId/account/push/config')
  pushConfiguration() {
    return this.webPush.configuration();
  }

  @UseGuards(AccountGuard)
  @Put(':tenantId/account/push/subscription')
  savePushSubscription(
    @Param('tenantId') tenantId: string,
    @Req() request: AccountRequest,
    @Body() body: { subscription?: unknown },
  ) {
    const userAgent = Array.isArray(request.headers['user-agent'])
      ? request.headers['user-agent'][0] || ''
      : request.headers['user-agent'] || '';
    return this.webPush.saveSubscription(
      tenantId,
      request.accountAuth!.accountId,
      body?.subscription,
      userAgent,
    );
  }

  @UseGuards(AccountGuard)
  @Delete(':tenantId/account/push/subscription')
  deletePushSubscription(
    @Param('tenantId') tenantId: string,
    @Req() request: AccountRequest,
    @Body() body: { endpoint?: unknown },
  ) {
    return this.webPush.deleteSubscription(tenantId, request.accountAuth!.accountId, body?.endpoint);
  }

  @UseGuards(AccountGuard)
  @Get(':tenantId/account/records')
  myRecords(@Param('tenantId') tenantId: string, @Req() request: AccountRequest) {
    return this.booking.getMyRecords(tenantId, request.accountAuth!.accountId);
  }

  @UseGuards(AccountGuard)
  @Get(':tenantId/account/notifications')
  notificationsFeed(@Param('tenantId') tenantId: string, @Req() request: AccountRequest) {
    return this.notifications.listForAccount(tenantId, request.accountAuth!.accountId);
  }

  @UseGuards(AccountGuard)
  @Post(':tenantId/account/notifications/:notificationId/read')
  markNotificationRead(
    @Param('tenantId') tenantId: string,
    @Param('notificationId') notificationId: string,
    @Req() request: AccountRequest,
  ) {
    return this.notifications.markReadForAccount(tenantId, request.accountAuth!.accountId, notificationId);
  }

  @UseGuards(AccountGuard)
  @Get(':tenantId/account/chat')
  async accountChat(@Param('tenantId') tenantId: string, @Req() request: AccountRequest) {
    const context = await this.booking.accountTenantContactContext(tenantId, request.accountAuth!.accountId);
    return this.communications.listThread(tenantId, context, 500);
  }

  @UseGuards(AccountGuard)
  @Post(':tenantId/account/chat/messages')
  async sendAccountChatMessage(
    @Param('tenantId') tenantId: string,
    @Req() request: AccountRequest,
    @Body() body: { body?: unknown; attachments?: unknown },
  ) {
    const message = String(body?.body ?? '').trim();
    const attachments = Array.isArray(body?.attachments) ? body.attachments : [];
    if (!message && !attachments.length) throw new BadRequestException('Пустое сообщение');
    const context = await this.booking.accountTenantContactContext(tenantId, request.accountAuth!.accountId);
    return this.communications.recordMessage(tenantId, {
      phone: context.phone,
      uei: context.uei,
      direction: 'inbound',
      kind: attachments.length ? 'media' : 'message',
      purpose: 'DIRECT',
      channel: 'IN_APP',
      body: message,
      attachments,
      status: 'sent',
    });
  }

  @UseGuards(AccountGuard, BookingPdnConsentGuard)
  @Post(':tenantId/requests')
  async createRequest(@Param('tenantId') tenantId: string, @Req() request: AccountRequest, @Body() body: Record<string, any>) {
    const accountId = request.accountAuth!.accountId;
    const participantMode = ['self', 'other', 'joint'].includes(String(body?.mode || ''))
      && Array.isArray(body?.participants)
      && body.participants.length > 0;

    let created: Record<string, any>;
    if (participantMode) {
      const account = await this.booking.getAccount(tenantId, accountId) as Record<string, any>;
      const result = await this.bookingFlow.confirm(tenantId, {
        ...(body || {}),
        booker: {
          name: [String(account?.name || '').trim(), String(account?.surname || '').trim()].filter(Boolean).join(' '),
          phone: String(account?.phone || '').trim(),
          email: String(account?.email || '').trim(),
        },
      }, {
        legalVerified: true,
        source: 'online-booking',
        createdBy: { type: 'account', accountId, profileId: '' },
      });
      const records = Array.isArray(result?.records) ? result.records : [];
      created = {
        ...result,
        id: String(result?.bookingSessionId || ''),
        status: 'IMPORTED',
        recordId: String(records[0]?.id || ''),
        recordIds: records.map((record: any) => String(record?.id || '')).filter(Boolean),
      };
    } else {
      created = await this.booking.createRequest(tenantId, accountId, body || {}) as Record<string, any>;
    }

    const recordId = String(created?.recordId || '');
    const recordIds = Array.isArray(created?.recordIds) && created.recordIds.length ? created.recordIds : recordId ? [recordId] : [];
    const date = String(created?.date || '').slice(0, 10);
    const time = String(created?.from || '');
    const workplaceKey = String(created?.workplaceKey || '');

    void Promise.allSettled([
      this.platformNotices.createForTenantOwner(tenantId, {
        type: 'BOOKING_CREATED',
        title: 'Новая запись',
        body: `Запись на ${date} в ${time}.`,
        metadata: {
          recordId,
          recordIds,
          date,
          time,
          workplaceKey,
          source: 'account-journal',
        },
      }),
      this.notifications.createEventForPerson(tenantId, { accountId }, {
        type: 'booking.created',
        entityType: 'record',
        entityId: recordId,
        context: {
          date,
          time,
          workplace: workplaceKey,
          record: { id: recordId },
        },
      }),
    ]);
    return created;
  }
}