import { Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PlatformNoticeService } from './platform-notice.service';

type AuthenticatedRequest = Request & { auth?: { platformAccountId: string; tenantId: string; role: string } };

@Controller('platform-notices')
@UseGuards(JwtAuthGuard)
export class PlatformNoticeController {
  constructor(private readonly notices: PlatformNoticeService) {}

  @Get()
  list(@Req() request: AuthenticatedRequest) {
    return this.notices.list(request.auth!.tenantId, request.auth!.platformAccountId);
  }

  @Post(':noticeId/read')
  read(@Req() request: AuthenticatedRequest, @Param('noticeId') noticeId: string) {
    return this.notices.markRead(request.auth!.tenantId, request.auth!.platformAccountId, noticeId);
  }
}
