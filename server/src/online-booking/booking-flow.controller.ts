import { Body, Controller, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { NotificationService } from '../notification/notification.service';
import { PlatformNoticeService } from '../platform-notice/platform-notice.service';
import { AccountGuard } from './account.guard';
import { BookingFlowService } from './booking-flow.service';
import { BookingPdnConsentGuard } from './booking-pdn-consent.guard';
import { OnlineBookingService } from './online-booking.service';

type AccountRequest = Request & { accountAuth?: { accountId: string; tenantId: string } };

@Controller('online-booking')
export class BookingFlowController {
  constructor(
    private readonly flow: BookingFlowService,
    private readonly notifications: NotificationService,
    private readonly platformNotices: PlatformNoticeService,
    private readonly booking: OnlineBookingService,
  ) {}

  private publishCreated(tenantId: string, result: any, source: string) {
    const date = String(result?.date || '').slice(0, 10);
    const time = String(result?.from || '');
    const workplaceKey = String(result?.workplaceKey || '');
    const records = Array.isArray(result?.records) ? result.records : [];
    const recordIds = records.map((record: any) => String(record?.id || '')).filter(Boolean);

    void Promise.allSettled([
      this.platformNotices.createForTenantOwner(tenantId, {
        type: 'BOOKING_CREATED',
        title: 'Новая запись',
        body: `Запись на ${date} в ${time}.`,
        metadata: {
          bookingSessionId: String(result?.bookingSessionId || ''),
          recordIds,
          date,
          time,
          workplaceKey,
          source,
        },
      }),
      ...records.map((record: any) => this.notifications.createEventForPerson(tenantId, record?.person || {}, {
        type: 'booking.created',
        entityType: 'record',
        entityId: String(record?.id || ''),
        context: {
          date,
          time: String(record?.from || time),
          workplace: workplaceKey,
          record: { id: String(record?.id || '') },
        },
      })),
    ]);
  }

  @Post(':tenantId/booking-state')
  bookingState(@Param('tenantId') tenantId: string, @Body() body: Record<string, any>) {
    return this.flow.bookingState(tenantId, body || {});
  }

  @Post(':tenantId/confirm')
  async confirm(@Param('tenantId') tenantId: string, @Body() body: Record<string, any>) {
    const result = await this.flow.confirm(tenantId, body || {});
    this.publishCreated(tenantId, result, 'online-booking');
    return result;
  }

  @UseGuards(AccountGuard, BookingPdnConsentGuard)
  @Post(':tenantId/account/confirm')
  async confirmAccount(
    @Param('tenantId') tenantId: string,
    @Req() request: AccountRequest,
    @Body() body: Record<string, any>,
  ) {
    const account = await this.booking.getAccount(tenantId, request.accountAuth!.accountId);
    const booker = {
      name: [String(account?.name || '').trim(), String(account?.surname || '').trim()].filter(Boolean).join(' '),
      phone: String(account?.phone || '').trim(),
      email: String(account?.email || '').trim(),
    };
    const result = await this.flow.confirm(tenantId, {
      ...(body || {}),
      booker,
      consents: [],
    });
    this.publishCreated(tenantId, result, 'account-journal');
    return result;
  }
}
