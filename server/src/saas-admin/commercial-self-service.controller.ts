import { BadRequestException, Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { SaasAccessService } from '../saas-access/saas-access.service';
import { CommercialCatalogService } from './commercial-catalog.service';
import { CommercialInvoiceService } from './commercial-invoice.service';
import { CommercialTenantService } from './commercial-tenant.service';

type AuthenticatedRequest = Request & {
  auth?: { platformAccountId: string; tenantId: string; role: string };
};

type CatalogProduct = {
  key: string;
  name: string;
  description?: string;
  type: string;
  isActive: boolean;
  isSaleable: boolean;
  isFree: boolean;
  priceMinor: number;
  currency: string;
  includedProducts?: Array<{ key: string; name: string; type: string }>;
};

type CommercialOrder = Record<string, unknown> & {
  id?: string;
  status?: string;
  totalMinor?: number;
  currency?: string;
  receiptUrl?: string;
  receiptSentAt?: string;
};

function currentOrder(orders: CommercialOrder[]) {
  if (!Array.isArray(orders) || !orders.length) return null;
  return orders.find((order) => order.status === 'PENDING')
    || orders.find((order) => order.status === 'PAID' && order.receiptUrl)
    || orders[0]
    || null;
}

@Controller('saas-commercial')
@UseGuards(JwtAuthGuard)
export class CommercialSelfServiceController {
  constructor(
    private readonly commercial: CommercialTenantService,
    private readonly catalog: CommercialCatalogService,
    private readonly access: SaasAccessService,
    private readonly invoice: CommercialInvoiceService,
  ) {}

  private async snapshot(tenantId: string) {
    const [commercial, catalog, orders, access, tariffOffers] = await Promise.all([
      this.commercial.getTenantCommercial(tenantId),
      this.catalog.catalog(),
      this.commercial.orderHistory(tenantId),
      this.access.resolveTenantAccess(tenantId),
      this.catalog.tariffOffers(),
    ]);
    const catalogProducts = (Array.isArray(catalog.products) ? catalog.products : []) as CatalogProduct[];
    const byKey = new Map(catalogProducts.map((product) => [product.key, product]));

    return {
      ...commercial,
      access,
      tariffOffers,
      order: currentOrder(orders as CommercialOrder[]),
      baseProducts: catalogProducts
        .filter((product) => product.isActive && !product.isSaleable && product.isFree)
        .map((product) => ({
          key: product.key,
          name: product.name,
          description: product.description || '',
          type: product.type,
        })),
      products: commercial.products.map((product) => {
        const source = byKey.get(product.key);
        return {
          ...product,
          description: source?.description || '',
          includedProductKeys: (source?.includedProducts || []).map((item) => item.key),
          selected: Boolean(product.selected || source?.isFree),
          includedProducts: source?.includedProducts || [],
        };
      }),
    };
  }

  @Get('me')
  me(@Req() request: AuthenticatedRequest) {
    return this.snapshot(request.auth!.tenantId);
  }


  @Post('confirm-tariff')
  async confirmTariff(
    @Req() request: AuthenticatedRequest,
    @Body() body: { tariffKey?: unknown; periodMonths?: unknown },
  ) {
    const tenantId = request.auth!.tenantId;
    const platformAccountId = request.auth!.platformAccountId;
    const tariffKey = String(body?.tariffKey || '').trim();
    const periodMonths = Number(body?.periodMonths);
    if (tariffKey === 'tariff.start') {
      await this.commercial.selectStartTariff(tenantId);
      const access = (await this.access.requestLive(tenantId, platformAccountId)).access;
      return {
        requiresPayment: false, access,
        commercial: await this.snapshot(tenantId), order: null,
      };
    }
    if (!['tariff.start-plus','tariff.pro'].includes(tariffKey)) {
      throw new BadRequestException('Выберите Start, Start+ или Pro');
    }
    const orders = await this.commercial.createTariffOrder(tenantId, tariffKey, periodMonths);
    const order = (orders as CommercialOrder[]).find((item) =>
      item.status === 'PENDING' && item.tariffKey === tariffKey &&
      item.periodMonths === periodMonths
    ) || null;
    if (!order) throw new BadRequestException('Счёт не был создан');
    // Pending paid invoice leaves the account on free LIVE Start.
    // Paid capabilities are granted only when payment is confirmed by Admin.
    await this.commercial.selectStartTariff(tenantId);
    const access = (await this.access.requestLive(tenantId, platformAccountId)).access;
    const invoice = await this.invoice.sendPendingInvoice(tenantId, order);
    return {
      requiresPayment: true, access,
      commercial: await this.snapshot(tenantId), order, invoice,
    };
  }

}
