import { Body, Controller, Delete, Get, Param, Post, Put, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { InventoryService } from './inventory.service';
import { InventoryOrderExportService } from './inventory-order-export.service';

type AuthenticatedRequest = Request & {
  auth?: { platformAccountId: string; tenantId: string; role: string };
};

@Controller('inventory')
@UseGuards(JwtAuthGuard)
export class InventoryController {
  constructor(private readonly inventory: InventoryService,
    private readonly documents: InventoryOrderExportService) {}

  @Get()
  snapshot(@Req() request: AuthenticatedRequest) {
    return this.inventory.snapshot(request.auth!.tenantId);
  }

  @Post('items')
  createItem(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    return this.inventory.createItem(request.auth!.tenantId, body);
  }

  @Put('items/:itemId')
  updateItem(
    @Req() request: AuthenticatedRequest,
    @Param('itemId') itemId: string,
    @Body() body: unknown,
  ) {
    return this.inventory.updateItem(request.auth!.tenantId, itemId, body);
  }

  @Post('items/reorder')
  reorderItems(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    return this.inventory.reorderItems(request.auth!.tenantId, body);
  }

  @Post('items/:itemId/offers')
  createSupplierOffer(
    @Req() request: AuthenticatedRequest,
    @Param('itemId') itemId: string,
    @Body() body: unknown,
  ) {
    return this.inventory.createSupplierOffer(request.auth!.tenantId, itemId, body);
  }

  @Put('items/:itemId/offers/:offerId')
  updateSupplierOffer(
    @Req() request: AuthenticatedRequest,
    @Param('itemId') itemId: string,
    @Param('offerId') offerId: string,
    @Body() body: unknown,
  ) {
    return this.inventory.updateSupplierOffer(request.auth!.tenantId, itemId, offerId, body);
  }

  @Delete('items/:itemId/offers/:offerId')
  archiveSupplierOffer(
    @Req() request: AuthenticatedRequest,
    @Param('itemId') itemId: string,
    @Param('offerId') offerId: string,
  ) {
    return this.inventory.archiveSupplierOffer(request.auth!.tenantId, itemId, offerId);
  }

  @Put('items/:itemId/primary-offer')
  setPrimarySupplierOffer(
    @Req() request: AuthenticatedRequest,
    @Param('itemId') itemId: string,
    @Body() body: unknown,
  ) {
    return this.inventory.setPrimarySupplierOffer(request.auth!.tenantId, itemId, body);
  }

  @Post('orders')
  createOrder(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    return this.inventory.createPurchaseOrder(request.auth!.tenantId, body);
  }

  @Put('orders/:orderId')
  updateOrder(@Req() request: AuthenticatedRequest, @Param('orderId') orderId: string, @Body() body: unknown) {
    return this.inventory.updatePurchaseOrder(request.auth!.tenantId, orderId, body);
  }

  @Delete('orders/:orderId')
  deleteOrder(@Req() request: AuthenticatedRequest, @Param('orderId') orderId: string) {
    return this.inventory.deletePurchaseOrder(request.auth!.tenantId, orderId);
  }

  // Download/share only a saved, tenant-owned supplier document.
  @Get('orders/:orderId/export/:format')
  async exportOrder(
    @Req() request: AuthenticatedRequest,
    @Param('orderId') orderId: string,
    @Param('format') format: string,
    @Res() response: import('express').Response,
  ) {
    if (format !== 'pdf' && format !== 'xlsx') {
      throw new (await import('@nestjs/common')).BadRequestException('Формат: PDF или Excel');
    }
    const order = await this.documents.supplierDocument(request.auth!.tenantId, orderId);
    const bytes = format === 'pdf'
      ? await this.documents.pdf(order)
      : await this.documents.excel(order);
    const label = String(orderId).replaceAll('-', '').slice(0, 12).toUpperCase();
    response.setHeader('Content-Type', format === 'pdf' ? 'application/pdf'
      : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    response.setHeader('Content-Disposition', `attachment; filename="zakaz_${label}.${format}"`);
    response.setHeader('Cache-Control', 'private, no-store');
    response.send(bytes);
  }

  @Post('orders/:orderId/pay')
  payOrder(@Req() request: AuthenticatedRequest, @Param('orderId') orderId: string, @Body() body: unknown) {
    return this.inventory.payPurchaseOrder(request.auth!.tenantId, orderId, body);
  }

  @Post('orders/:orderId/receive')
  receiveOrder(@Req() request: AuthenticatedRequest, @Param('orderId') orderId: string, @Body() body: unknown) {
    return this.inventory.receivePurchaseOrder(request.auth!.tenantId, orderId, body);
  }

  @Post('movements')
  createMovement(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    return this.inventory.createMovement(request.auth!.tenantId, body);
  }

  @Post('movements/:movementId/correct')
  correctMovement(
    @Req() request: AuthenticatedRequest,
    @Param('movementId') movementId: string,
    @Body() body: unknown,
  ) {
    return this.inventory.correctMovement(request.auth!.tenantId, movementId, body);
  }
}
