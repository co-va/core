import { Body, Controller, Param, Post } from '@nestjs/common';
import { NotificationService } from '../notification/notification.service';
import { PlatformNoticeService } from '../platform-notice/platform-notice.service';
import { BookingFlowService } from './booking-flow.service';

@Controller('online-booking')
export class BookingFlowController {
  constructor(
    private readonly flow: BookingFlowService,
    private readonly notifications: NotificationService,
    private readonly platformNotices: PlatformNoticeService,
  ) {}

  @Post(':tenantId/booking-state')
  bookingState(@Param('tenantId') tenantId: string, @Body() body: Record<string, any>) {
    return this.flow.bookingState(tenantId, body || {});
  }

  @Post(':tenantId/confirm')
  async confirm(@Param('tenantId') tenantId: string, @Body() body: Record<string, any>) {
    const result = await this.flow.confirm(tenantId, body || {});
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
          source: 'online-booking',
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
    return result;
  }
}