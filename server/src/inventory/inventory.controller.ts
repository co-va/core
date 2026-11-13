import { Body, Controller, Delete, Get, Param, Post, Put, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { InventoryService } from './inventory.service';

type AuthenticatedRequest = Request & {
  auth?: { platformAccountId: string; tenantId: string; role: string };
};

@Controller('inventory')
@UseGuards(JwtAuthGuard)
export class InventoryController {
  constructor(private readonly inventory: InventoryService) {}

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
