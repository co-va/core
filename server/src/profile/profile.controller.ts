import { Body, Controller, Delete, Get, Param, Post, Put, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ProfileService } from './profile.service';
import { WorkplaceLimitGuard } from './workplace-limit.guard';

type AuthenticatedRequest = Request & { auth?: { platformAccountId: string; tenantId: string; role: string } };

@Controller('profile')
@UseGuards(JwtAuthGuard)
export class ProfileController {
  constructor(private readonly profile: ProfileService) {}

  @Get()
  getProfile(@Req() request: AuthenticatedRequest) {
    return this.profile.get(request.auth!.tenantId, request.auth!.platformAccountId);
  }

  @Put()
  async updateProfile(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    const saved = await this.profile.updateProfile(request.auth!.tenantId, request.auth!.platformAccountId, body);
    return {
      profile: saved.profile,
      customProfessions: saved.customProfessions,
      professionCatalog: saved.professionCatalog,
    };
  }

  @Get('account-controls')
  accountControls(@Req() request: AuthenticatedRequest) {
    return this.profile.accountControls(request.auth!.tenantId, request.auth!.platformAccountId);
  }

  @Put('account-controls/consents/:documentKey')
  accountConsent(
    @Req() request: AuthenticatedRequest,
    @Param('documentKey') documentKey: string,
    @Body() body: { active?: unknown },
  ) {
    return this.profile.setAccountConsent(
      request.auth!.tenantId,
      request.auth!.platformAccountId,
      documentKey,
      body?.active,
    );
  }

  @Put('account-controls/service-notifications')
  serviceNotifications(
    @Req() request: AuthenticatedRequest,
    @Body() body: unknown,
  ) {
    return this.profile.setServiceNotifications(
      request.auth!.tenantId,
      request.auth!.platformAccountId,
      body,
    );
  }

  @Put('workplaces-order')
  reorderWorkplaces(
    @Req() request: AuthenticatedRequest,
    @Body() body: unknown,
  ) {
    return this.profile.reorderWorkplaces(
      request.auth!.tenantId,
      request.auth!.platformAccountId,
      body,
    );
  }

  @Put('workplaces/:key')
  @UseGuards(WorkplaceLimitGuard)
  upsertWorkplace(
    @Req() request: AuthenticatedRequest,
    @Param('key') key: string,
    @Body() body: unknown,
  ) {
    return this.profile.upsertWorkplace(request.auth!.tenantId, request.auth!.platformAccountId, key, body);
  }

  @Delete('workplaces/:key')
  deleteWorkplace(@Req() request: AuthenticatedRequest, @Param('key') key: string) {
    return this.profile.deleteWorkplace(request.auth!.tenantId, request.auth!.platformAccountId, key);
  }
}
