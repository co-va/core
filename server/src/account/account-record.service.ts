import { ForbiddenException, Injectable } from '@nestjs/common';
import { NotificationEventService } from '../notification/notification-event.service';
import { PrismaService } from '../prisma.service';
import { BookingFlowService } from '../online-booking/booking-flow.service';
import { OnlineBookingService } from '../online-booking/online-booking.service';
import { ConsentPolicyService } from '../tenant-document-archive/consent-policy.service';

@Injectable()
export class AccountRecordService {
  constructor(
    private readonly account: OnlineBookingService,
    private readonly bookingFlow: BookingFlowService,
    private readonly notificationEvents: NotificationEventService,
    private readonly prisma: PrismaService,
    private readonly consentPolicy: ConsentPolicyService,
  ) {}

  async canRecord(tenantId: string, accountId: string) {
    const link = await this.prisma.accountTenantLink.findUnique({
      where: { accountId_tenantId: { accountId, tenantId } },
      select: { id: true },
    });
    if (!link) return false;
    return this.consentPolicy.hasActivePdnConsent(tenantId, accountId);
  }

  async listTargets(accountId: string) {
    const links = await this.prisma.accountTenantLink.findMany({
      where: { accountId },
      orderBy: { updatedAt: 'desc' },
      select: { tenantId: true, createdAt: true },
    });
    if (!links.length) return [];

    const allowed = (await Promise.all(links.map(async (link) => (
      (await this.canRecord(link.tenantId, accountId)) ? link : null
    )))).filter((link): link is (typeof links)[number] => Boolean(link));
    if (!allowed.length) return [];

    const profiles = await this.prisma.profile.findMany({
      where: { tenantId: { in: allowed.map((link) => link.tenantId) } },
      orderBy: { createdAt: 'asc' },
      select: { tenantId: true, name: true, surname: true, profession: true, phone: true },
    });
    const profileByTenantId = new Map<string, (typeof profiles)[number]>();
    profiles.forEach((profile) => {
      if (!profileByTenantId.has(profile.tenantId)) profileByTenantId.set(profile.tenantId, profile);
    });

    return allowed.flatMap((link) => {
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

  context(tenantId: string, workplace = '') {
    return this.account.getContext(tenantId, workplace);
  }

  async create(tenantId: string, accountId: string, body: Record<string, any>) {
    if (!(await this.canRecord(tenantId, accountId))) {
      throw new ForbiddenException('Запись недоступна');
    }

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
