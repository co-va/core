import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
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

function productKeys(value: unknown) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => String(item || '').trim()).filter(Boolean))];
}

function normalizedSelection(products: CatalogProduct[], requested: string[]) {
  const byKey = new Map(products.map((product) => [product.key, product]));
  const selected = new Set(
    requested.filter((key) => byKey.has(key)),
  );

  // Текущие бесплатные дополнительные инструменты входят в LIVE автоматически.
  for (const product of products) {
    if (product.isFree) selected.add(product.key);
  }

  const descendants = (key: string, target = new Set<string>()) => {
    const product = byKey.get(key);
    for (const child of product?.includedProducts || []) {
      if (target.has(child.key)) continue;
      target.add(child.key);
      descendants(child.key, target);
    }
    return target;
  };

  // Если выбран пакет/папка, вложенные позиции не считаются второй раз.
  const included = new Set<string>();
  for (const key of selected) {
    for (const childKey of descendants(key)) included.add(childKey);
  }
  for (const key of included) selected.delete(key);

  return [...selected];
}

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
    const [commercial, catalog, orders, access] = await Promise.all([
      this.commercial.getTenantCommercial(tenantId),
      this.catalog.catalog(),
      this.commercial.orderHistory(tenantId),
      this.access.resolveTenantAccess(tenantId),
    ]);
    const catalogProducts = (Array.isArray(catalog.products) ? catalog.products : []) as CatalogProduct[];
    const byKey = new Map(catalogProducts.map((product) => [product.key, product]));

    return {
      ...commercial,
      access,
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

  private async stageFreeLiveSelection(
    tenantId: string,
    current: Awaited<ReturnType<CommercialTenantService['getTenantCommercial']>>,
    selectable: CatalogProduct[],
    selectedKeys: string[],
  ) {
    const freeKeys = selectable.filter((product) => product.isFree).map((product) => product.key);
    const terms = {
      discountPercent: current.terms.discountPercent,
      freeForever: current.terms.freeForever,
      freeUntil: current.terms.freeUntil,
    };

    // Сначала применяем только бесплатные возможности, затем возвращаем выбранный
    // коммерческий состав без активации платных capability до подтверждения оплаты.
    await this.commercial.updateTenantCommercial(tenantId, {
      ...terms,
      productKeys: freeKeys,
    }, null, true);
    await this.commercial.updateTenantCommercial(tenantId, {
      ...terms,
      productKeys: selectedKeys,
    }, null, false);
  }

  @Get('me')
  me(@Req() request: AuthenticatedRequest) {
    return this.snapshot(request.auth!.tenantId);
  }

  @Post('confirm-live')
  async confirmLive(
    @Req() request: AuthenticatedRequest,
    @Body() body: Record<string, unknown>,
  ) {
    const tenantId = request.auth!.tenantId;
    const platformAccountId = request.auth!.platformAccountId;
    const [current, catalog, existingOrders, currentAccess] = await Promise.all([
      this.commercial.getTenantCommercial(tenantId),
      this.catalog.catalog(),
      this.commercial.orderHistory(tenantId) as Promise<CommercialOrder[]>,
      this.access.resolveTenantAccess(tenantId),
    ]);
    const selectable = ((Array.isArray(catalog.products) ? catalog.products : []) as CatalogProduct[])
      .filter((product) => product.isActive && product.isSaleable);
    const pending = existingOrders.find((order) => order.status === 'PENDING');

    if (pending) {
      const selectedKeys = current.products.filter((product) => product.selected).map((product) => product.key);
      await this.stageFreeLiveSelection(tenantId, current, selectable, selectedKeys);
      const access = currentAccess.commercialMode === 'LIVE'
        ? await this.access.resolveTenantAccess(tenantId)
        : (await this.access.requestLive(tenantId, platformAccountId)).access;
      const invoice = await this.invoice.sendPendingInvoice(tenantId, pending);
      return {
        requiresPayment: true,
        access,
        commercial: await this.snapshot(tenantId),
        order: pending,
        invoice,
      };
    }

    const selectedKeys = normalizedSelection(selectable, productKeys(body.productKeys));
    await this.stageFreeLiveSelection(tenantId, current, selectable, selectedKeys);

    const orders = await this.commercial.createOrderSnapshot(tenantId, null) as CommercialOrder[];
    const order = orders[0] || null;
    const requiresPayment = Boolean(order && order.status === 'PENDING' && Number(order.totalMinor || 0) > 0);

    if (!requiresPayment) {
      await this.commercial.applySelectedCapabilities(tenantId);
    }
    const transition = await this.access.requestLive(tenantId, platformAccountId);

    if (requiresPayment) {
      const invoice = await this.invoice.sendPendingInvoice(tenantId, order);
      return {
        requiresPayment: true,
        access: transition.access,
        commercial: await this.snapshot(tenantId),
        order,
        invoice,
      };
    }

    return {
      requiresPayment: false,
      access: transition.access,
      commercial: await this.snapshot(tenantId),
      order,
    };
  }
}
