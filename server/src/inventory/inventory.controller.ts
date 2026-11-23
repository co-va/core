import { BadRequestException, Body, Controller, Delete, Get, Param, Post, Put, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { InventoryService } from './inventory.service';
import { InventoryCriteriaService } from './inventory-criteria.service';
import { InventoryCriteriaRecoveryService } from './inventory-criteria-recovery.service';
import { InventoryOrderExportService } from './inventory-order-export.service';

type AuthenticatedRequest = Request & {
  auth?: { platformAccountId: string; tenantId: string; role: string };
};

@Controller('inventory')
@UseGuards(JwtAuthGuard)
export class InventoryController {
  constructor(private readonly inventory: InventoryService,
    private readonly documents: InventoryOrderExportService,
    private readonly criteria: InventoryCriteriaService,
    private readonly recovery: InventoryCriteriaRecoveryService) {}

  @Get()
  snapshot(@Req() request: AuthenticatedRequest) {
    return this.inventory.snapshot(request.auth!.tenantId);
  }

  // Historical recipes may point at archived stock items. Resolve only
  // requested, tenant-owned names without adding archived stock to the picker.
  @Get('items/references')
  resolveItemReferences(@Req() request: AuthenticatedRequest, @Query('ids') ids = '') {
    const itemIds = String(ids).split(',').filter(Boolean);
    return this.inventory.resolveItemReferences(request.auth!.tenantId, { itemIds });
  }

  @Post('criteria/recovery/preview')
  previewClassificationRecovery(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    return this.recovery.preview(request.auth!.tenantId, body);
  }

  @Post('criteria/recovery/apply')
  applyClassificationRecovery(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    return this.recovery.apply(request.auth!.tenantId, body);
  }

  @Get('criteria')
  criteriaCatalog(@Req() request: AuthenticatedRequest) {
    return this.criteria.list(request.auth!.tenantId);
  }

  @Post('criteria')
  createCriterion(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    return this.criteria.create(request.auth!.tenantId, body);
  }

  @Put('criteria/:groupId')
  updateCriterion(@Req() request: AuthenticatedRequest,
    @Param('groupId') groupId: string, @Body() body: unknown) {
    return this.criteria.update(request.auth!.tenantId, groupId, body);
  }

  @Post('criteria/:groupId/values')
  createCriterionValue(@Req() request: AuthenticatedRequest,
    @Param('groupId') groupId: string, @Body() body: unknown) {
    return this.criteria.createValue(request.auth!.tenantId, groupId, body);
  }

  @Put('criteria/:groupId/values/order')
  reorderCriterionValues(@Req() request: AuthenticatedRequest,
    @Param('groupId') groupId: string, @Body() body: unknown) {
    return this.criteria.reorderValues(request.auth!.tenantId, groupId, body);
  }

  @Put('criteria/:groupId/values/:valueId')
  updateCriterionValue(@Req() request: AuthenticatedRequest,
    @Param('groupId') groupId: string, @Param('valueId') valueId: string,
    @Body() body: unknown) {
    return this.criteria.updateValue(request.auth!.tenantId, groupId, valueId, body);
  }

  @Get('classification-groups')
  classificationGroups(@Req() request: AuthenticatedRequest) {
    return this.inventory.listClassificationGroups(request.auth!.tenantId);
  }

  @Post('classification-groups')
  createClassificationGroup(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    return this.inventory.createClassificationGroup(request.auth!.tenantId, body);
  }

  @Put('classification-groups/:groupId')
  updateClassificationGroup(@Req() request: AuthenticatedRequest,
    @Param('groupId') groupId: string, @Body() body: unknown) {
    return this.inventory.updateClassificationGroup(request.auth!.tenantId, groupId, body);
  }

  @Put('items/:itemId/targets')
  updateStockTargets(@Req() request: AuthenticatedRequest,
    @Param('itemId') itemId: string, @Body() body: unknown) {
    return this.inventory.updateStockTargets(request.auth!.tenantId, itemId, body);
  }

  @Post('storage-locations')
  createStorageLocation(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    return this.inventory.createStorageLocation(request.auth!.tenantId, body);
  }

  @Put('storage-locations/:locationId')
  updateStorageLocation(@Req() request: AuthenticatedRequest, @Param('locationId') locationId: string, @Body() body: unknown) {
    return this.inventory.updateStorageLocation(request.auth!.tenantId, locationId, body);
  }

  @Post('transfers')
  transferStock(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    return this.inventory.transferStock(request.auth!.tenantId, body);
  }

  @Post('resource-uses')
  recordResourceUse(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    return this.inventory.recordResourceUse(request.auth!.tenantId, body);
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

  @Post('items/bulk-update')
  updateItemsBatch(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    return this.inventory.updateItemsBatch(request.auth!.tenantId, body);
  }

  @Post('items/positions/repair')
  repairItemPositions(@Req() request: AuthenticatedRequest) {
    return this.inventory.repairItemPositions(request.auth!.tenantId);
  }

  @Post('items/positions/clear')
  clearItemPositions(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    return this.inventory.clearItemPositions(request.auth!.tenantId, body);
  }

  @Post('items/archive-selection')
  archiveSelectedItems(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    return this.inventory.archiveSelectedItems(request.auth!.tenantId, body);
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
      throw new BadRequestException('Формат: PDF или Excel');
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

  @Post('orders/:orderId/supplier-returns')
  returnOrderToSupplier(@Req() request: AuthenticatedRequest,
    @Param('orderId') orderId: string, @Body() body: unknown) {
    return this.inventory.returnPurchaseOrderToSupplier(request.auth!.tenantId, orderId, body);
  }

  @Post('supplier-claims/:claimId/refund')
  refundSupplierClaim(@Req() request: AuthenticatedRequest,
    @Param('claimId') claimId: string, @Body() body: unknown) {
    return this.inventory.refundSupplierClaim(request.auth!.tenantId, claimId, body);
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
