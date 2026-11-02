import { Body, Controller, Delete, Get, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AccountDocumentService } from '../document-registry/account-document.service';
import { EmailVerificationService } from '../email-verification/email-verification.service';
import { NotificationEventService } from '../notification/notification-event.service';
import { WebPushService } from '../notification/web-push.service';
import { PrismaService } from '../prisma.service';
import { AccountGuard } from '../online-booking/account.guard';
import { BookingFlowService } from '../online-booking/booking-flow.service';
import { BookingPdnConsentGuard } from '../online-booking/booking-pdn-consent.guard';
import { OnlineBookingService } from '../online-booking/online-booking.service';

type AccountRequest = Request & { accountAuth?: { accountId: string; tenantId: string } };

@Controller('account')
export class AccountRuntimeController {
  constructor(
    private readonly account: OnlineBookingService,
    private readonly bookingFlow: BookingFlowService,
    private readonly accountDocuments: AccountDocumentService,
    private readonly emailVerification: EmailVerificationService,
    private readonly webPush: WebPushService,
    private readonly notificationEvents: NotificationEventService,
    private readonly prisma: PrismaService,
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
  records(@Req() request: AccountRequest) {
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
  async recordTargets(@Req() request: AccountRequest) {
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
      select: { tenantId: true, name: true, surname: true, profession: true, phone: true },
    });
    const profileByTenantId = new Map<string, (typeof profiles)[number]>();
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

  @UseGuards(AccountGuard)
  @Get('professionals/:tenantId/record-context')
  recordContext(
    @Param('tenantId') tenantId: string,
    @Query('workplace') workplace = '',
  ) {
    return this.account.getContext(tenantId, workplace);
  }

  @UseGuards(AccountGuard, BookingPdnConsentGuard)
  @Post('professionals/:tenantId/records')
  async createRecord(
    @Param('tenantId') tenantId: string,
    @Req() request: AccountRequest,
    @Body() body: Record<string, any>,
  ) {
    const accountId = request.accountAuth!.accountId;
    const participantMode = ['self', 'other', 'joint'].includes(String(body?.mode || ''))
      && Array.isArray(body?.participants)
      && body.participants.length > 0;

    let created: Record<string, any>;
    if (participantMode) {
      const account = await this.account.getAccount(tenantId, accountId) as Record<string, any>;
      const result = await this.bookingFlow.confirm(tenantId, {
        ...(body || {}),
        booker: {
          name: [String(account?.name || '').trim(), String(account?.surname || '').trim()].filter(Boolean).join(' '),
          phone: String(account?.phone || '').trim(),
          email: String(account?.email || '').trim(),
        },
      }, {
        legalVerified: true,
        source: 'account-journal',
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
      created = await this.account.createRequest(tenantId, accountId, body || {}) as Record<string, any>;
    }

    const recordId = String(created?.recordId || '');
    const recordIds = Array.isArray(created?.recordIds) && created.recordIds.length
      ? created.recordIds
      : recordId ? [recordId] : [];
    const date = String(created?.date || '').slice(0, 10);
    const time = String(created?.from || '');
    const workplaceKey = String(created?.workplaceKey || '');

    void Promise.allSettled([
      this.notificationEvents.createEventForTenantOwner(tenantId, {
        type: 'booking.created',
        entityType: 'record',
        entityId: recordId,
        context: { date, time, workplace: workplaceKey },
        metadata: { recordId, recordIds, date, time, workplaceKey, source: 'account-journal' },
      }),
      this.notificationEvents.createEventForPerson(tenantId, { accountId }, {
        type: 'booking.created',
        entityType: 'record',
        entityId: recordId,
        context: { date, time, workplace: workplaceKey, record: { id: recordId } },
      }),
    ]);

    return created;
  }
}
