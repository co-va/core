import { Body, Controller, Delete, Get, Param, Put, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { EventService } from './event.service';

type AuthenticatedRequest = Request & { auth?: { platformAccountId: string; tenantId: string; role: string } };

@Controller('events')
@UseGuards(JwtAuthGuard)
export class EventController {
  constructor(private readonly events: EventService) {}

  @Get()
  list(@Req() request: AuthenticatedRequest) {
    return this.events.list(request.auth!.tenantId);
  }

  @Get(':id')
  get(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    return this.events.get(request.auth!.tenantId, id);
  }

  @Put(':id')
  upsert(@Req() request: AuthenticatedRequest, @Param('id') id: string, @Body() body: unknown) {
    return this.events.upsert(request.auth!.tenantId, id, body);
  }

  @Delete(':id')
  remove(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    return this.events.remove(request.auth!.tenantId, id);
  }
}
