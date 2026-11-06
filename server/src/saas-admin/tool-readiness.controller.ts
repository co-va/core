import { Body, Controller, Get, Param, Put, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PlatformAdminGuard } from './platform-admin.guard';
import { ToolReadinessService } from './tool-readiness.service';

@Controller('saas-admin/tool-readiness')
@UseGuards(JwtAuthGuard, PlatformAdminGuard)
export class ToolReadinessController {
  constructor(private readonly readiness: ToolReadinessService) {}

  @Get()
  list() {
    return this.readiness.list();
  }

  @Put(':key')
  update(@Req() request: Request & { auth?: { platformAccountId: string } },
         @Param('key') key: string, @Body() body: Record<string, unknown>) {
    return this.readiness.update(key, body || {}, request.auth!.platformAccountId);
  }
}
