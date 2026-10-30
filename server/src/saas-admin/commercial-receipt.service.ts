import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { PlatformNoticeService } from '../platform-notice/platform-notice.service';
import { PrismaService } from '../prisma.service';
import { SaasAccessService } from '../saas-access/saas-access.service';
import { TransactionalEmailService } from '../transactional-email/transactional-email.service';
import { CommercialTenantService } from './commercial-tenant.service';

type ReceiptUpload = {
  originalname: string;
  mimetype: string;
  buffer: Buffer;
  size: number;
};

type OrderRow = {
  id: string;
  tenantId: string;
  status: string;
  totalMinor: number;
  currency: string;
  paidAt: Date | null;
  receiptUrl: string;
  receiptKind: string;
  receiptFileName: string;
  receiptMimeType: string;
  receiptFileSha256: string;
  receiptSentAt: Date | null;
  receiptSentTo: string;
  receiptMessageId: string;
};

const MAX_RECEIPT_BYTES = 10 * 1024 * 1024;
const RECEIPT_MIME_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
]);

function cleanFileName(value: unknown) {
  const normalized = String(value || '').trim().replace(/[\\/:*?"<>|\u0000-\u001F]/g, '_');
  return normalized.slice(0, 180) || 'receipt';
}

@Injectable()
export class CommercialReceiptService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly commercial: CommercialTenantService,
    private readonly access: SaasAccessService,
    private readonly email: TransactionalEmailService,
    private readonly notices: PlatformNoticeService,
  ) {}

  private async audit(actorAdminId: string, tenantId: string, eventType: string, orderId: string, metadata: unknown = {}) {
    await this.prisma.$executeRawUnsafe(
      `INSERT INTO "CommercialAuditEvent" ("id","actorAdminId","tenantId","eventType","entityType","entityId","metadata","occurredAt") VALUES ($1,$2,$3,$4,'ORDER',$5,$6::jsonb,CURRENT_TIMESTAMP)`,
      randomUUID(), actorAdminId, tenantId, eventType, orderId, JSON.stringify(metadata ?? {}),
    );
  }

  private validateFile(file: ReceiptUpload | undefined) {
    if (!file?.buffer?.length) throw new BadRequestException('Прикрепите PDF, фото или скриншот чека');
    if (file.size <= 0 || file.size > MAX_RECEIPT_BYTES) {
      throw new BadRequestException('Файл чека должен быть не больше 10 МБ');
    }
    const mimeType = String(file.mimetype || '').trim().toLowerCase();
    if (!RECEIPT_MIME_TYPES.has(mimeType)) {
      throw new BadRequestException('Чек можно прикрепить как PDF или изображение');
    }
    return {
      fileName: cleanFileName(file.originalname),
      mimeType,
      sha256: createHash('sha256').update(file.buffer).digest('hex'),
    };
  }

  private async order(tenantId: string, orderId: string) {
    const [order] = await this.prisma.$queryRawUnsafe<OrderRow[]>(
      `SELECT "id","tenantId","status","totalMinor","currency","paidAt","receiptUrl","receiptKind","receiptFileName","receiptMimeType","receiptFileSha256","receiptSentAt","receiptSentTo","receiptMessageId"
       FROM "CommercialOrder" WHERE "id"=$1 AND "tenantId"=$2 LIMIT 1`,
      orderId, tenantId,
    );
    if (!order) throw new NotFoundException('Коммерческий счёт не найден');
    return order;
  }

  private async activateLive(tenantId: string, orderId: string, paidAt: Date, actorAdminId: string) {
    await this.commercial.applySelectedCapabilities(tenantId);
    const before = await this.access.resolveTenantAccess(tenantId);
    await this.access.setCommercialMode(tenantId, 'LIVE', actorAdminId);
    const access = await this.access.resolveTenantAccess(tenantId);
    if (before.commercialMode !== 'LIVE') {
      await this.audit(actorAdminId, tenantId, 'LIVE_PAID_PERIOD_STARTED', orderId, {
        paidAt: paidAt.toISOString(),
        receiptSent: true,
      });
    }
    return access;
  }

  async completeFilePayment(tenantId: string, orderIdValue: unknown, file: ReceiptUpload | undefined, actorAdminId: string) {
    const orderId = String(orderIdValue || '').trim();
    const receipt = this.validateFile(file);
    const order = await this.order(tenantId, orderId);

    if (order.totalMinor <= 0) throw new BadRequestException('Для тарифа 0 ₽ ручная оплата не требуется');
    if (!['PENDING', 'PAID'].includes(order.status)) throw new BadRequestException('Этот счёт нельзя подтвердить как оплаченный');

    if (order.receiptSentAt) {
      if (order.receiptKind !== 'FILE' || order.receiptFileSha256 !== receipt.sha256) {
        throw new BadRequestException('Чек уже был отправлен. Заменить его после отправки нельзя');
      }
      const paidAt = order.paidAt || order.receiptSentAt;
      const access = await this.activateLive(tenantId, orderId, paidAt, actorAdminId);
      const orders = await this.commercial.orderHistory(tenantId);
      return {
        access,
        order: orders.find((item) => item.id === orderId) || null,
        receipt: {
          kind: 'FILE',
          fileName: order.receiptFileName,
          mimeType: order.receiptMimeType,
          sentTo: order.receiptSentTo,
          sentNow: false,
          messageId: order.receiptMessageId,
        },
      };
    }

    const owner = await this.prisma.membership.findFirst({
      where: { tenantId, role: 'OWNER' },
      orderBy: { createdAt: 'asc' },
      include: { account: true, tenant: true },
    });
    if (!owner?.account?.email) throw new BadRequestException('У владельца нет email для отправки чека');

    const paidAt = order.paidAt || new Date();
    let paymentRecorded = false;
    await this.prisma.$transaction(async (tx) => {
      if (order.status === 'PENDING') {
        await tx.$executeRawUnsafe(
          `UPDATE "CommercialOrder" SET "status"='PAID',"paidAt"=$1,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$2 AND "tenantId"=$3 AND "status"='PENDING'`,
          paidAt, orderId, tenantId,
        );
        const [existingPayment] = await tx.$queryRawUnsafe<Array<{ id: string }>>(
          `SELECT "id" FROM "CommercialPayment" WHERE "orderId"=$1 AND "provider"='MANUAL' AND "status"='SUCCEEDED' LIMIT 1`,
          orderId,
        );
        if (!existingPayment) {
          await tx.$executeRawUnsafe(
            `INSERT INTO "CommercialPayment" ("id","orderId","provider","providerPaymentId","status","amountMinor","currency","walletKey","occurredAt","createdAt","updatedAt")
             VALUES ($1,$2,'MANUAL',$3,'SUCCEEDED',$4,$5,'',$6,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
            randomUUID(), orderId, `manual:${orderId}`, order.totalMinor, order.currency, paidAt,
          );
          paymentRecorded = true;
        }
        await tx.$executeRawUnsafe(
          `UPDATE "CommercialTenantTerms" SET "livePaidStartsAt"=COALESCE("livePaidStartsAt",$1),"updatedAt"=CURRENT_TIMESTAMP WHERE "tenantId"=$2`,
          paidAt, tenantId,
        );
      }

      await tx.$executeRawUnsafe(
        `UPDATE "CommercialOrder"
         SET "receiptUrl"='',"receiptKind"='FILE',"receiptFileName"=$1,"receiptMimeType"=$2,"receiptFileSha256"=$3,"updatedAt"=CURRENT_TIMESTAMP
         WHERE "id"=$4 AND "tenantId"=$5 AND "receiptSentAt" IS NULL`,
        receipt.fileName, receipt.mimeType, receipt.sha256, orderId, tenantId,
      );
    });

    if (paymentRecorded) {
      await this.audit(actorAdminId, tenantId, 'PAYMENT_RECORDED', orderId, {
        provider: 'MANUAL',
        amountMinor: order.totalMinor,
        currency: order.currency,
        paidAt: paidAt.toISOString(),
      });
    }

    const emailAddress = owner.account.email.trim().toLowerCase();
    const displayName = String(owner.tenant.name || '').trim() || 'LIVE';
    const emailResult = await this.email.send({
      to: emailAddress,
      toName: displayName,
      subject: 'Чек об оплате LIVE',
      tag: 'commercial-live-receipt',
      text: `Оплата ${(order.totalMinor / 100).toLocaleString('ru-RU')} ${order.currency} подтверждена. Чек приложен к письму.`,
      html: `<p>Оплата тарифа LIVE подтверждена.</p><p><strong>${(order.totalMinor / 100).toLocaleString('ru-RU')} ${order.currency}</strong></p><p>Чек приложен к этому письму.</p>`,
      attachments: [{
        filename: receipt.fileName,
        content: file!.buffer,
        contentType: receipt.mimeType,
      }],
    });

    await this.prisma.$executeRawUnsafe(
      `UPDATE "CommercialOrder"
       SET "receiptSentAt"=CURRENT_TIMESTAMP,"receiptSentTo"=$1,"receiptMessageId"=$2,"updatedAt"=CURRENT_TIMESTAMP
       WHERE "id"=$3 AND "tenantId"=$4`,
      emailAddress, emailResult.messageId, orderId, tenantId,
    );

    await this.audit(actorAdminId, tenantId, 'COMMERCIAL_RECEIPT_SENT', orderId, {
      kind: 'FILE',
      fileName: receipt.fileName,
      mimeType: receipt.mimeType,
      sha256: receipt.sha256,
      sentTo: emailAddress,
      messageId: emailResult.messageId,
    });

    await this.notices.createForTenantOwner(tenantId, {
      type: 'COMMERCIAL_RECEIPT_READY',
      title: 'Чек отправлен · LIVE готов',
      body: 'Оплата подтверждена. Чек отправлен на email.',
      metadata: { orderId, receiptKind: 'FILE', receiptFileName: receipt.fileName },
    }).catch(() => null);

    const access = await this.activateLive(tenantId, orderId, paidAt, actorAdminId);
    const orders = await this.commercial.orderHistory(tenantId);
    return {
      access,
      order: orders.find((item) => item.id === orderId) || null,
      receipt: {
        kind: 'FILE',
        fileName: receipt.fileName,
        mimeType: receipt.mimeType,
        sentTo: emailAddress,
        sentNow: true,
        messageId: emailResult.messageId,
      },
    };
  }
}
