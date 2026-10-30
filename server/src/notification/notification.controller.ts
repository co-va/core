import { Body, Controller, Get, Param, Put, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { NotificationEventService } from './notification-event.service';

type OwnerRequest = Request & { auth?: { platformAccountId: string; tenantId: string; role: string } };

@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationController {
  constructor(private readonly notifications: NotificationEventService) {}

  @Get('catalog')
  catalog() {
    return this.notifications.catalog();
  }

  @Get('routing')
  routing(@Req() request: OwnerRequest) {
    return this.notifications.listPolicies(request.auth!.tenantId);
  }

  @Put('routing')
  setAllRouting(
    @Req() request: OwnerRequest,
    @Body() body: { enabled?: unknown },
  ) {
    return this.notifications.setAllEnabled(request.auth!.tenantId, body?.enabled);
  }

  @Get('routing/:eventType')
  routingPolicy(
    @Req() request: OwnerRequest,
    @Param('eventType') eventType: string,
  ) {
    return this.notifications.getPolicy(request.auth!.tenantId, eventType);
  }

  @Put('routing/:eventType')
  saveRouting(
    @Req() request: OwnerRequest,
    @Param('eventType') eventType: string,
    @Body() body: { enabled?: unknown; mode?: unknown; channels?: unknown; titleTemplate?: unknown; bodyTemplate?: unknown },
  ) {
    return this.notifications.savePolicy(request.auth!.tenantId, eventType, body || {});
  }
}
