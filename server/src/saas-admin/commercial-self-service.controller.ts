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
    if (product.priceMinor === 0) selected.add(product.key);
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

@Controller('saas-commercial')
@UseGuards(JwtAuthGuard)
export class CommercialSelfServiceController {
  constructor(
    private readonly commercial: CommercialTenantService,
    private readonly catalog: CommercialCatalogService,
    private readonly access: SaasAccessService,
  ) {}

  private async snapshot(tenantId: string) {
    const [commercial, catalog] = await Promise.all([
      this.commercial.getTenantCommercial(tenantId),
      this.catalog.catalog(),
    ]);
    const catalogProducts = (Array.isArray(catalog.products) ? catalog.products : []) as CatalogProduct[];
    const byKey = new Map(catalogProducts.map((product) => [product.key, product]));

    return {
      ...commercial,
      baseProducts: catalogProducts
        .filter((product) => product.isActive && !product.isSaleable && product.priceMinor === 0)
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
          selected: Boolean(product.selected || product.priceMinor === 0),
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
    }, null as unknown as string);

    const orders = await this.commercial.createOrderSnapshot(tenantId, null as unknown as string);
    const transition = await this.access.requestLive(tenantId, platformAccountId);

    return {
      access: transition.access,
      commercial: await this.snapshot(tenantId),
      order: Array.isArray(orders) ? orders[0] || null : null,
    };
  }
}
