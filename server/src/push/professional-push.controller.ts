import { Body, Controller, Delete, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ProfessionalPushService } from './professional-push.service';

type AuthenticatedRequest = Request & { auth?: { platformAccountId: string; tenantId: string; role: string } };

@Controller('professional-push')
@UseGuards(JwtAuthGuard)
export class ProfessionalPushController {
  constructor(private readonly push: ProfessionalPushService) {}

  @Get('configuration')
  configuration() {
    return this.push.configuration();
  }

  @Get('subscription')
  subscription(@Req() request: AuthenticatedRequest, @Query('endpoint') endpoint: string) {
    return this.push.subscriptionState(request.auth!.platformAccountId, endpoint);
  }

  @Post('subscription')
  saveSubscription(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    return this.push.saveSubscription(
      request.auth!.platformAccountId,
      body,
      String(request.headers['user-agent'] || ''),
    );
  }

  @Delete('subscription')
  deleteSubscription(@Req() request: AuthenticatedRequest, @Body() body: { endpoint?: unknown }) {
    return this.push.deleteSubscription(request.auth!.platformAccountId, body?.endpoint);
  }
}
