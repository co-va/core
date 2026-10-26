import { Body, ConflictException, Controller, Param, Post } from '@nestjs/common';
import { NotificationService } from '../notification/notification.service';
import { PlatformNoticeService } from '../platform-notice/platform-notice.service';
import { BookingFlowService } from './booking-flow.service';

function text(value: unknown) {
  return String(value ?? '').trim();
}

function consentFacts(value: unknown) {
  const facts = new Map<string, { version: number; accepted: boolean }>();
  for (const item of Array.isArray(value) ? value : []) {
    const documentId = text(item?.documentId);
    if (!documentId) continue;
    facts.set(documentId, {
      version: Math.max(1, Number(item?.documentVersion || 1)),
      accepted: Boolean(item?.accepted),
    });
  }
  return facts;
}

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
    const booker = body?.booker && typeof body.booker === 'object' ? body.booker : {};
    const legalState = await this.flow.bookingState(tenantId, booker);
    const submitted = consentFacts(body?.consents);
    for (const consent of Array.isArray(legalState?.consents) ? legalState.consents : []) {
      const documentId = text(consent?.documentId);
      const fact = submitted.get(documentId);
      if (consent?.active || !fact?.accepted) continue;
      if (fact.version !== Math.max(1, Number(consent?.documentVersion || 1))) {
        throw new ConflictException('Версия согласия изменилась. Необходимо открыть и подтвердить актуальный документ.');
      }
    }

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
