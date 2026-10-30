import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { CommunicationService } from '../communication/communication.service';
import { NotificationEventService } from '../notification/notification-event.service';
import { ConsentPolicyService } from '../tenant-document-archive/consent-policy.service';
import { PrismaService } from '../prisma.service';
import { AccountGuard } from './account.guard';

type AccountRequest = Request & { accountAuth?: { accountId: string; tenantId: string } };

function acceptedMessages(value: unknown) {
  return (Array.isArray(value) ? value : []).some((item: any) => String(item?.documentId || '').trim() === 'messages-consent' && Boolean(item?.accepted));
}

function acceptedDocumentIds(value: unknown) {
  return (Array.isArray(value) ? value : [])
    .filter((item: any) => Boolean(item?.accepted))
    .map((item: any) => String(item?.documentId || '').trim())
    .filter(Boolean);
}

@Controller('online-booking')
export class BookingConsentController {
  constructor(
    private readonly consentPolicy: ConsentPolicyService,
    private readonly communications: CommunicationService,
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationEventService,
  ) {}

  private async currentContactPoints(request: AccountRequest) {
    const auth = request.accountAuth!;
    const account = await this.prisma.account.findUnique({
      where: { id: auth.accountId },
      select: { phone: true, email: true },
    });
    if (!account) return [];
    const telegram = await this.communications.telegramIdentity(auth.tenantId, { phone: account.phone });
    return [
      { type: 'PHONE', value: account.phone },
      { type: 'EMAIL', value: account.email },
      ...(telegram?.externalUserId ? [{ type: 'TELEGRAM', value: telegram.externalUserId }] : []),
    ].filter((item) => String(item.value || '').trim());
  }

  @UseGuards(AccountGuard)
  @Get(':tenantId/account/consent-state')
  async state(@Req() request: AccountRequest) {
    const auth = request.accountAuth!;
    return this.consentPolicy.accountConsentState(auth.tenantId, auth.accountId);
  }

  @UseGuards(AccountGuard)
  @Post(':tenantId/account/consents')
  async accept(@Req() request: AccountRequest, @Body() body: { consents?: unknown }) {
    const auth = request.accountAuth!;
    await this.consentPolicy.acceptAccountConsents(auth.tenantId, auth.accountId, body?.consents || [], 'online-booking-account');
    const consentState = await this.consentPolicy.accountConsentState(auth.tenantId, auth.accountId);
    if (consentState?.pdnActive) {
      await this.prisma.accountTenantLink.upsert({
        where: { accountId_tenantId: { accountId: auth.accountId, tenantId: auth.tenantId } },
        create: { accountId: auth.accountId, tenantId: auth.tenantId },
        update: { updatedAt: new Date() },
      });
    }
    if (acceptedMessages(body?.consents)) {
      const contacts = await this.currentContactPoints(request);
      for (const contact of contacts) {
        await this.consentPolicy.acceptContactPointConsent(auth.tenantId, contact.type, contact.value, 'messages-consent', 'online-booking-account');
      }
    }
    const documents = acceptedDocumentIds(body?.consents);
    if (documents.length) {
      await this.notifications.createEventForTenantOwner(auth.tenantId, {
        type: 'consent.accepted',
        entityType: 'account',
        entityId: auth.accountId,
        context: {
          document: documents.join(', '),
          date: new Date().toISOString().slice(0, 10),
        },
        metadata: { accountId: auth.accountId, documents },
      }).catch(() => null);
    }
    return consentState;
  }

  @UseGuards(AccountGuard)
  @Post(':tenantId/account/consents/:documentId/revoke')
  async revoke(
    @Req() request: AccountRequest,
    @Param('documentId') documentId: string,
  ) {
    const auth = request.accountAuth!;
    await this.consentPolicy.revokeAccountConsent(auth.tenantId, auth.accountId, documentId, 'online-booking');
    if (documentId === 'messages-consent') {
      const contacts = await this.currentContactPoints(request);
      for (const contact of contacts) {
        await this.consentPolicy.revokeContactPointConsent(auth.tenantId, contact.type, contact.value, documentId, 'online-booking');
      }
    }
    const result = await this.consentPolicy.accountConsentState(auth.tenantId, auth.accountId);
    await this.notifications.createEventForTenantOwner(auth.tenantId, {
      type: 'consent.revoked',
      entityType: 'account',
      entityId: auth.accountId,
      context: {
        document: documentId,
        date: new Date().toISOString().slice(0, 10),
      },
      metadata: { accountId: auth.accountId, documentId },
    }).catch(() => null);
    return result;
  }
}