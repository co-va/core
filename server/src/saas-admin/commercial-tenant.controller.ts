import { Body, Controller, Get, Param, Post, Put, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PlatformAdminGuard } from './platform-admin.guard';
import { CommercialTenantService } from './commercial-tenant.service';

type AdminRequest = Request & {
  auth?: { platformAccountId: string; tenantId: string; role: string };
  platformAdminId?: string;
};

@Controller('saas-admin/commercial-tenants')
@UseGuards(JwtAuthGuard, PlatformAdminGuard)
export class CommercialTenantController {
  constructor(private readonly commercial: CommercialTenantService) {}

  @Get(':tenantId')
  detail(@Param('tenantId') tenantId: string) {
    return this.commercial.getTenantCommercial(tenantId);
  }

  @Put(':tenantId')
  update(
    @Req() request: AdminRequest,
    @Param('tenantId') tenantId: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.commercial.updateTenantCommercial(tenantId, body || {}, request.platformAdminId!);
  }

  @Post(':tenantId/orders')
  createOrder(@Req() request: AdminRequest, @Param('tenantId') tenantId: string) {
    return this.commercial.createOrderSnapshot(tenantId, request.platformAdminId!);
  }

  @Get(':tenantId/orders')
  orders(@Param('tenantId') tenantId: string) {
    return this.commercial.orderHistory(tenantId);
  }

  @Post(':tenantId/orders/:orderId/complete-payment')
  completePayment(
    @Req() request: AdminRequest,
    @Param('tenantId') tenantId: string,
    @Param('orderId') orderId: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.commercial.completeManualPayment(
      tenantId,
      orderId,
      body?.receiptUrl,
      request.platformAdminId!,
    );
  }
}
