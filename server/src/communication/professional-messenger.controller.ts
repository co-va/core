import { Body, Controller, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PrismaService } from '../prisma.service';
import { MessengerCoreService } from './messenger-core.service';
import { markMessengerConversationRead } from './messenger-read';

type OwnerRequest = Request & { auth?: { platformAccountId: string; tenantId: string; role: string } };

@Controller('communications/messenger')
export class ProfessionalMessengerController {
  constructor(
    private readonly messenger: MessengerCoreService,
    private readonly prisma: PrismaService,
  ) {}

  @UseGuards(JwtAuthGuard)
  @Post('direct')
  ensureDirect(
    @Req() request: OwnerRequest,
    @Body() body: { phone?: unknown; uei?: unknown },
  ) {
    return this.messenger.ensureDirect(request.auth!.tenantId, body || {});
  }

  @UseGuards(JwtAuthGuard)
  @Post('conversations/:conversationId/read')
  async markRead(
    @Req() request: OwnerRequest,
    @Param('conversationId') conversationId: string,
  ) {
    const tenantId = request.auth!.tenantId;
    await this.messenger.messages(tenantId, conversationId, 'professional', {}, 1);
    return markMessengerConversationRead(this.prisma, tenantId, conversationId, 'inbound');
  }
}
