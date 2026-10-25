import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { SaasAccessService } from '../saas-access/saas-access.service';
import { CommercialCatalogService } from './commercial-catalog.service';
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
    const existingOrders = await this.commercial.orderHistory(tenantId) as CommercialOrder[];
    const pending = existingOrders.find((order) => order.status === 'PENDING');
    if (pending) {
      return {
        requiresPayment: true,
        access: await this.access.resolveTenantAccess(tenantId),
        commercial: await this.snapshot(tenantId),
        order: pending,
      };
    }

    const current = await this.commercial.getTenantCommercial(tenantId);
    const catalog = await this.catalog.catalog();
    const selectable = ((Array.isArray(catalog.products) ? catalog.products : []) as CatalogProduct[])
      .filter((product) => product.isActive && product.isSaleable);
    const selectedKeys = normalizedSelection(selectable, productKeys(body.productKeys));

    await this.commercial.updateTenantCommercial(tenantId, {
      productKeys: selectedKeys,
      discountPercent: current.terms.discountPercent,
      freeForever: current.terms.freeForever,
      freeUntil: current.terms.freeUntil,
    }, null, false);

    const orders = await this.commercial.createOrderSnapshot(tenantId, null) as CommercialOrder[];
    const order = orders[0] || null;
    const requiresPayment = Boolean(order && order.status === 'PENDING' && Number(order.totalMinor || 0) > 0);

    if (requiresPayment) {
      const commercial = await this.snapshot(tenantId);
      return {
        requiresPayment: true,
        access: commercial.access,
        commercial,
        order,
      };
    }

    await this.commercial.applySelectedCapabilities(tenantId);
    const transition = await this.access.requestLive(tenantId, platformAccountId);
    return {
      requiresPayment: false,
      access: transition.access,
      commercial: await this.snapshot(tenantId),
      order,
    };
  }
}
