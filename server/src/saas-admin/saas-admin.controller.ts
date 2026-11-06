import { Body, Controller, Delete, Get, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { HistoryService } from '../history/history.service';
import { TenantInvitationService } from '../tenant-invitation/tenant-invitation.service';
import { PlatformAdminGuard } from './platform-admin.guard';
import { SaasAdminService } from './saas-admin.service';

type AdminRequest = Request & {
  auth?: { platformAccountId: string; tenantId: string; role: string };
  platformAdminId?: string;
};

@Controller('saas-admin')
@UseGuards(JwtAuthGuard, PlatformAdminGuard)
export class SaasAdminController {
  constructor(
    private readonly admin: SaasAdminService,
    private readonly invitations: TenantInvitationService,
    private readonly historyService: HistoryService,
  ) {}

  @Get('me')
  me(@Req() request: AdminRequest) {
    return this.admin.me(request.platformAdminId!, request.auth!.platformAccountId);
  }

  @Get('history')
  history(
    @Query('tenantId') tenantId = '',
    @Query('limit') limit = '100',
  ) {
    return this.historyService.listPlatform({ tenantId, limit: Number(limit) });
  }

  @Get('tenants')
  tenants() {
    return this.admin.tenants();
  }

  @Get('capabilities')
  capabilities() {
    return this.admin.capabilities();
  }

  @Delete('tenants/:tenantId')
  deleteTenant(@Param('tenantId') tenantId: string) {
    return this.admin.deleteTenant(tenantId);
  }

  @Get('document-registry/history')
  documentRegistryHistory() {
    return this.admin.documentRegistryHistory();
  }

  @Post('document-registry/sync')
  syncDocumentRegistry(@Body() body: { documents?: unknown }) {
    return this.admin.syncDocumentRegistry(body?.documents);
  }

  @Get('invitations')
  listInvitations(@Req() request: AdminRequest) {
    return this.invitations.listInvitations(request.platformAdminId!);
  }

  @Post('invitations')
  createInvitation(
    @Req() request: AdminRequest,
    @Body() body: { email?: unknown; name?: unknown; tools?: unknown },
  ) {
    return this.invitations.createInvitation(request.platformAdminId!, body || {});
  }

  @Post('invitations/link')
  createRegistrationLink(
    @Req() request: AdminRequest,
    @Body() body: { tools?: unknown },
  ) {
    return this.invitations.createRegistrationLink(request.platformAdminId!, body || {});
  }

  @Post('invitations/:id/resend')
  resendInvitation(@Req() request: AdminRequest, @Param('id') id: string) {
    return this.invitations.resendInvitation(request.platformAdminId!, id);
  }

  @Delete('invitations/:id')
  deleteInvitation(@Req() request: AdminRequest, @Param('id') id: string) {
    return this.invitations.deleteUnregisteredInvitation(request.platformAdminId!, id);
  }

  @Post('tenants/:tenantId/technical-email')
  sendTechnicalEmail(
    @Param('tenantId') tenantId: string,
    @Body() body: { subject?: unknown; body?: unknown },
  ) {
    return this.admin.sendTechnicalEmail(tenantId, body || {});
  }

  @Put('tenants/:tenantId/access')
  updateTenantAccess(
    @Req() request: AdminRequest,
    @Param('tenantId') tenantId: string,
    @Body() body: { status?: unknown; capabilities?: unknown; isTester?: unknown },
  ) {
    return this.admin.updateTenantAccess(tenantId, body || {}, request.auth!.platformAccountId);
  }

  @Put('tenants/:tenantId/commercial-mode')
  setCommercialMode(
    @Req() request: AdminRequest,
    @Param('tenantId') tenantId: string,
    @Body() body: { mode?: unknown },
  ) {
    return this.admin.setCommercialMode(tenantId, body?.mode, request.platformAdminId!);
  }

  @Put('tenants/:tenantId/capability-order')
  updateCapabilityOrder(@Req() request: AdminRequest, @Param('tenantId') tenantId: string, @Body() body: { keys?: unknown }) {
    return this.admin.updateCapabilityOrder(tenantId, body?.keys, request.auth!.platformAccountId);
  }
}
