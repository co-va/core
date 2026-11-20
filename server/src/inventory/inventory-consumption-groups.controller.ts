import { Body, Controller, Get, Param, Post, Put, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { InventoryConsumptionGroupsService } from './inventory-consumption-groups.service';

type Authorized = Request & { auth?: { tenantId: string } };

// Separate E underneath the existing Inventory F; no second stock owner.
@Controller('inventory/consumption-groups')
@UseGuards(JwtAuthGuard)
export class InventoryConsumptionGroupsController {
  constructor(private readonly groups: InventoryConsumptionGroupsService) {}

  @Get()
  list(@Req() request: Authorized) {
    return this.groups.list(request.auth!.tenantId);
  }

  @Post()
  create(@Req() request: Authorized, @Body() body: Record<string, unknown>) {
    return this.groups.create(request.auth!.tenantId, body || {});
  }

  @Put(':groupId')
  update(@Req() request: Authorized, @Param('groupId') groupId: string,
    @Body() body: Record<string, unknown>) {
    return this.groups.update(request.auth!.tenantId, groupId, body || {});
  }
}
