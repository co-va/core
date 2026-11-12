import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

type OrderRow = {
  id: string;
  tenantId: string;
  status: string;
  totalMinor: number;
  currency: string;
  tariffKey: string | null;
  periodMonths: number | null;
  accessDays: number | null;
  createdAt: Date;
  paidAt: Date | null;
  receiptUrl: string;
  paymentProvider: string | null;
  walletKey: string | null;
  paymentOccurredAt: Date | null;
};
type PaymentRow = {
  id: string; orderId: string; status: string; amountMinor: number;
  currency: string; provider: string; walletKey: string;
  occurredAt: Date | null; tenantId: string;
};

@Injectable()
export class CommercialFinanceService {
  constructor(private readonly prisma: PrismaService) {}

  // This is an operational view of the existing commercial ledger, NOT a
  // bank statement and NOT a fiscal receipt issuing integration.
  async overview() {
    const [stats] = await this.prisma.$queryRawUnsafe<Array<{
      pendingCount: bigint; pendingMinor: bigint;
      paidCount: bigint; paidOrdersMinor: bigint;
      zeroCount: bigint;
    }>>(
      `SELECT
        COUNT(*) FILTER (WHERE "status"='PENDING')::bigint AS "pendingCount",
        COALESCE(SUM("totalMinor") FILTER (WHERE "status"='PENDING'),0)::bigint AS "pendingMinor",
        COUNT(*) FILTER (WHERE "status"='PAID')::bigint AS "paidCount",
        COALESCE(SUM("totalMinor") FILTER (WHERE "status"='PAID'),0)::bigint AS "paidOrdersMinor",
        COUNT(*) FILTER (WHERE "status"='ZERO')::bigint AS "zeroCount"
       FROM "CommercialOrder" WHERE "currency"='RUB'`,
    );
    const [payments] = await this.prisma.$queryRawUnsafe<Array<{
      confirmedCount: bigint; confirmedMinor: bigint; unassignedCount: bigint;
    }>>(
      `SELECT
        COUNT(*) FILTER (WHERE "status"='SUCCEEDED')::bigint AS "confirmedCount",
        COALESCE(SUM("amountMinor") FILTER (WHERE "status"='SUCCEEDED'),0)::bigint AS "confirmedMinor",
        COUNT(*) FILTER (WHERE "status"='SUCCEEDED' AND COALESCE("walletKey",'')='')::bigint AS "unassignedCount"
       FROM "CommercialPayment" WHERE "currency"='RUB'`,
    );
    const orders = await this.prisma.$queryRawUnsafe<OrderRow[]>(
      `SELECT o."id",o."tenantId",o."status",o."totalMinor",o."currency",
         o."tariffKey",o."periodMonths",o."accessDays",o."createdAt",
         o."paidAt",COALESCE(o."receiptUrl",'') AS "receiptUrl",
         p."provider" AS "paymentProvider",p."walletKey",
         p."occurredAt" AS "paymentOccurredAt"
       FROM "CommercialOrder" o
       LEFT JOIN LATERAL (
         SELECT "provider","walletKey","occurredAt"
         FROM "CommercialPayment"
         WHERE "orderId"=o."id" AND "status"='SUCCEEDED'
         ORDER BY "occurredAt" DESC NULLS LAST,"createdAt" DESC LIMIT 1
       ) p ON true
       ORDER BY o."createdAt" DESC LIMIT 150`,
    );
    const movements = await this.prisma.$queryRawUnsafe<PaymentRow[]>(
      `SELECT p."id",p."orderId",p."status",p."amountMinor",p."currency",
         p."provider",p."walletKey",p."occurredAt",o."tenantId"
       FROM "CommercialPayment" p
       JOIN "CommercialOrder" o ON o."id"=p."orderId"
       ORDER BY COALESCE(p."occurredAt",p."createdAt") DESC LIMIT 150`,
    );
    const num = (value: bigint | number | null | undefined) => Number(value || 0);
    const date = (value: Date | string | null) => value ? new Date(value).toISOString() : null;
    return {
      currency: 'RUB',
      summary: {
        pendingOrders: num(stats?.pendingCount),
        pendingMinor: num(stats?.pendingMinor),
        paidOrders: num(stats?.paidCount),
        paidOrdersMinor: num(stats?.paidOrdersMinor),
        confirmedPayments: num(payments?.confirmedCount),
        confirmedMinor: num(payments?.confirmedMinor),
        paymentsWithoutWallet: num(payments?.unassignedCount),
        zeroOrders: num(stats?.zeroCount),
      },
      paymentSetup: {
        paymentUrlConfigured: Boolean(String(process.env.COMMERCIAL_PAYMENT_URL || '').trim()),
        instructionsConfigured: Boolean(String(process.env.COMMERCIAL_PAYMENT_INSTRUCTIONS || '').trim()),
        bankReconciliationConnected: false,
      },
      orders: orders.map((o) => ({
        id:o.id, tenantId:o.tenantId, status:o.status,
        totalMinor:o.totalMinor, currency:o.currency, tariffKey:o.tariffKey,
        periodMonths:o.periodMonths, accessDays:o.accessDays,
        createdAt:date(o.createdAt), paidAt:date(o.paidAt),
        receiptUrl:o.receiptUrl || '', paymentProvider:o.paymentProvider || '',
        walletKey:o.walletKey || '', paymentOccurredAt:date(o.paymentOccurredAt),
      })),
      payments: movements.map((p) => ({
        id:p.id, orderId:p.orderId, tenantId:p.tenantId, status:p.status,
        amountMinor:p.amountMinor, currency:p.currency,
        provider:p.provider, walletKey:p.walletKey || '',
        occurredAt:date(p.occurredAt),
      })),
    };
  }
}
