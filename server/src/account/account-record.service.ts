import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
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

  async journal(accountId: string) {
    const [records, hidden, oldDeletionNotices] = await Promise.all([
      this.account.globalAccountRecords(accountId),
      this.prisma.accountHiddenRecord.findMany({
        where: { accountId },
        select: { tenantId: true, recordId: true },
      }),
      this.prisma.$queryRaw<Array<{ tenantId: string; entityId: string; body: string; createdAt: Date }>>`
        SELECT DISTINCT ON (n."tenantId", n."entityId")
          n."tenantId", n."entityId", n."body", n."createdAt"
        FROM "Notification" n
        INNER JOIN "NotificationDelivery" d
          ON d."notificationId" = n."id"
         AND d."tenantId" = n."tenantId"
         AND d."channel" = 'IN_APP'
        INNER JOIN "AccountTenantLink" l
          ON l."accountId" = ${accountId}
         AND l."tenantId" = n."tenantId"
        INNER JOIN "AccountContact" c
          ON c."accountId" = ${accountId}
         AND c."type" = 'PHONE'
         AND c."value" = d."recipientKey"
        WHERE n."type" = 'booking.deleted'
          AND n."entityType" = 'record'
          AND n."entityId" <> ''
        ORDER BY n."tenantId", n."entityId", n."createdAt" DESC
      `,
    ]);
    const key = (tenant: unknown, id: unknown) => `${String(tenant || '')}:${String(id || '')}`;
    const hiddenKeys = new Set(hidden.map((item) => key(item.tenantId, item.recordId)));
    const known = new Map<string, Record<string, any>>();
    for (const row of Array.isArray(records) ? records : []) {
      const record = row && typeof row === 'object' ? row as Record<string, any> : {};
      const id = String(record.id || record.sourceId || '');
      const tenantId = String(record.tenantId || '');
      if (tenantId && id) known.set(key(tenantId, id), record);
    }
    // Deletions made before archive deployment may still have an account notification.
    // The notification body is the only known historical detail: never invent a service or a date.
    for (const row of oldDeletionNotices) {
      const id = String(row.entityId || '');
      const tenantId = String(row.tenantId || '');
      const itemKey = key(tenantId, id);
      if (!id || !tenantId || known.has(itemKey)) continue;
      const message = String(row.body || '');
      known.set(itemKey, {
        id, tenantId,
        date: message.match(/\b\d{4}-\d{2}-\d{2}\b/)?.[0] || '',
        from: message.match(/\b\d{1,2}:\d{2}\b/)?.[0] || '',
        status: 'deleted',
        deletedAt: row.createdAt,
        deletedSummary: message,
        procedures: [],
      });
    }
    return [...known.entries()]
      .filter(([itemKey]) => !hiddenKeys.has(itemKey))
      .map(([, record]) => record);
  }

  async hideFromJournal(accountId: string, tenantId: string, recordId: string) {
    const tenant = String(tenantId || '').trim();
    const id = String(recordId || '').trim();
    if (!tenant || !id || tenant.length > 128 || id.length > 128) {
      throw new NotFoundException('Запись не найдена');
    }
    const visible = await this.journal(accountId);
    if (!visible.some((record) => String(record.tenantId) === tenant
      && String(record.id || record.sourceId) === id)) {
      throw new NotFoundException('Запись не найдена');
    }
    await this.prisma.accountHiddenRecord.upsert({
      where: { accountId_tenantId_recordId: { accountId, tenantId: tenant, recordId: id } },
      create: { accountId, tenantId: tenant, recordId: id },
      update: {},
    });
    return { hidden: true };
  }
}
