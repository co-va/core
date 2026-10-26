import { Body, Controller, Param, Post } from '@nestjs/common';
import { PlatformNoticeService } from '../platform-notice/platform-notice.service';
import { BookingFlowService } from './booking-flow.service';

@Controller('online-booking')
export class BookingFlowController {
  constructor(
    private readonly flow: BookingFlowService,
    private readonly platformNotices: PlatformNoticeService,
  ) {}

  @Post(':tenantId/booking-state')
  bookingState(@Param('tenantId') tenantId: string, @Body() body: Record<string, any>) {
    return this.flow.bookingState(tenantId, body || {});
  }

  @Post(':tenantId/confirm')
  async confirm(@Param('tenantId') tenantId: string, @Body() body: Record<string, any>) {
    const result = await this.flow.confirm(tenantId, body || {});
    void this.platformNotices.createForTenantOwner(tenantId, {
      type: 'BOOKING_CREATED',
      title: 'Новая запись',
      body: `Запись на ${String(result?.date || '').slice(0, 10)} в ${String(result?.from || '')}.`,
      metadata: {
        bookingSessionId: String(result?.bookingSessionId || ''),
        recordIds: Array.isArray(result?.records) ? result.records.map((record: any) => String(record?.id || '')).filter(Boolean) : [],
        date: String(result?.date || '').slice(0, 10),
        time: String(result?.from || ''),
        workplaceKey: String(result?.workplaceKey || ''),
        source: 'online-booking',
      },
    }).catch(() => null);
    return result;
  }
}
