import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PlatformNoticeService } from '../platform-notice/platform-notice.service';
import { PrismaService } from '../prisma.service';
import { TransactionalEmailService } from '../transactional-email/transactional-email.service';

type CommercialOrder = Record<string, unknown> & {
  id?: string;
  status?: string;
  totalMinor?: number;
  currency?: string;
};

function text(value: unknown) {
  return String(value ?? '').trim();
}

function html(value: unknown) {
  return text(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;',
  }[char] || char));
}

function htmlLines(value: unknown) {
  return html(value).replace(/\r?\n/g, '<br>');
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'message' in error) return String(error.message || '');
  return String(error || 'Не удалось отправить счёт');
}

@Injectable()
export class CommercialInvoiceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly email: TransactionalEmailService,
    private readonly notices: PlatformNoticeService,
  ) {}

  private paymentDetails() {
    const instructions = text(process.env.COMMERCIAL_PAYMENT_INSTRUCTIONS);
    const rawUrl = text(process.env.COMMERCIAL_PAYMENT_URL);
    let url = '';
    if (rawUrl) {
      try {
        const parsed = new URL(rawUrl);
        if (parsed.protocol !== 'https:') throw new Error('protocol');
        url = parsed.toString();
      } catch {
        throw new Error('Некорректная COMMERCIAL_PAYMENT_URL: нужна https-ссылка');
      }
    }
    return { instructions, url, configured: Boolean(instructions || url) };
  }

  private async audit(tenantId: string, eventType: string, orderId: string, metadata: unknown = {}) {
    await this.prisma.$executeRawUnsafe(
      `INSERT INTO "CommercialAuditEvent" ("id","actorAdminId","tenantId","eventType","entityType","entityId","metadata","occurredAt") VALUES ($1,NULL,$2,$3,'ORDER',$4,$5::jsonb,CURRENT_TIMESTAMP)`,
      randomUUID(), tenantId, eventType, orderId, JSON.stringify(metadata ?? {}),
    );
  }

  async sendPendingInvoice(tenantId: string, order: CommercialOrder | null) {
    const orderId = text(order?.id);
    const status = text(order?.status);
    const totalMinor = Math.max(0, Number(order?.totalMinor || 0));
    const currency = text(order?.currency) || 'RUB';
    if (!orderId || status !== 'PENDING' || totalMinor <= 0) {
      return { sent: false, skipped: true, alreadySent: false, paymentDetailsConfigured: false };
    }

    const [existing] = await this.prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT "id" FROM "CommercialAuditEvent" WHERE "tenantId"=$1 AND "eventType"='COMMERCIAL_INVOICE_SENT' AND "entityType"='ORDER' AND "entityId"=$2 ORDER BY "occurredAt" DESC LIMIT 1`,
      tenantId, orderId,
    );
    if (existing) {
      const details = this.paymentDetails();
      return { sent: false, skipped: false, alreadySent: true, paymentDetailsConfigured: details.configured };
    }

    try {
      const details = this.paymentDetails();
      if (!details.configured) {
        throw new Error('Не настроены реквизиты для оплаты LIVE');
      }

      const owner = await this.prisma.membership.findFirst({
        where: { tenantId, role: 'OWNER' },
        orderBy: { createdAt: 'asc' },
        include: { account: true, tenant: true },
      });
      if (!owner?.account?.email) throw new Error('У владельца нет email для отправки счёта');

      const emailAddress = owner.account.email.trim().toLowerCase();
      const displayName = text(owner.tenant.name) || 'LIVE';
      const amount = (totalMinor / 100).toLocaleString('ru-RU', { maximumFractionDigits: 2 });
      const paymentText = [
        details.instructions,
        details.url ? `Ссылка для оплаты: ${details.url}` : '',
      ].filter(Boolean).join('\n');
      const paymentHtml = [
        details.instructions ? `<p>${htmlLines(details.instructions)}</p>` : '',
        details.url ? `<p><a href="${html(details.url)}">Оплатить</a></p>` : '',
      ].filter(Boolean).join('');

      const result = await this.email.send({
        to: emailAddress,
        toName: displayName,
        subject: `Счёт LIVE · 30 дней · ${amount} ${currency}`,
        tag: 'commercial-live-invoice',
        text: `Счёт ${orderId}\nСумма: ${amount} ${currency}\nПериод: 30 дней платного доступа после подтверждения оплаты.\n\nБесплатный LIVE уже включён и продолжает работать. Оплаченные инструменты включатся после подтверждения оплаты.\n\n${paymentText}`,
        html: `<p>Счёт <strong>${html(orderId)}</strong></p><p>Сумма: <strong>${html(amount)} ${html(currency)}</strong></p><p>Период: <strong>30 дней платного доступа</strong> после подтверждения оплаты.</p><p>Бесплатный LIVE уже включён и продолжает работать. Оплаченные инструменты включатся после подтверждения оплаты.</p>${paymentHtml}`,
      });

      await this.audit(tenantId, 'COMMERCIAL_INVOICE_SENT', orderId, {
        sentTo: emailAddress,
        messageId: result.messageId,
        amountMinor: totalMinor,
        currency,
        paidAccessPeriodDays: 30,
        paymentUrlConfigured: Boolean(details.url),
        paymentInstructionsConfigured: Boolean(details.instructions),
      });

      await this.notices.createForTenantOwner(tenantId, {
        type: 'COMMERCIAL_INVOICE_SENT',
        title: 'Счёт отправлен · бесплатный LIVE работает',
        body: `Счёт на ${amount} ${currency} за 30 дней платного доступа отправлен на email. Платные инструменты включатся после оплаты.`,
        metadata: { orderId, amountMinor: totalMinor, currency, paidAccessPeriodDays: 30 },
      }).catch(() => null);

      return {
        sent: true,
        skipped: false,
        alreadySent: false,
        sentTo: emailAddress,
        messageId: result.messageId,
        paymentDetailsConfigured: true,
      };
    } catch (error) {
      const message = errorMessage(error);
      await this.audit(tenantId, 'COMMERCIAL_INVOICE_SEND_FAILED', orderId, { message }).catch(() => undefined);
      await this.notices.createForPlatformAdmins({
        type: 'COMMERCIAL_INVOICE_SEND_FAILED',
        title: 'Счёт LIVE не отправлен',
        body: message,
        metadata: { tenantId, orderId },
      }).catch(() => []);
      return {
        sent: false,
        skipped: false,
        alreadySent: false,
        paymentDetailsConfigured: false,
        error: message,
      };
    }
  }
}
