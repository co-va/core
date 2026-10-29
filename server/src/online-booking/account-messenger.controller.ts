import { Body, Controller, Delete, Get, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { MessengerCoreService } from '../communication/messenger-core.service';
import { markMessengerConversationRead } from '../communication/messenger-read';
import { PrismaService } from '../prisma.service';
import { AccountGuard } from './account.guard';
import { OnlineBookingService } from './online-booking.service';

type AccountRequest = Request & { accountAuth?: { accountId: string; tenantId: string } };

@Controller('online-booking')
export class AccountMessengerController {
  constructor(
    private readonly booking: OnlineBookingService,
    private readonly messenger: MessengerCoreService,
    private readonly prisma: PrismaService,
  ) {}

  private async identity(tenantId: string, accountId: string) {
    const context = await this.booking.accountTenantContactContext(tenantId, accountId);
    return { phone: context.phone, uei: context.uei };
  }

  @UseGuards(AccountGuard)
  @Get(':tenantId/account/messenger/conversations')
  async conversations(@Param('tenantId') tenantId: string, @Req() request: AccountRequest) {
    const identity = await this.identity(tenantId, request.accountAuth!.accountId);
    await this.messenger.ensureDirect(tenantId, identity);
    return this.messenger.conversations(tenantId, 'person', identity);
  }

  @UseGuards(AccountGuard)
  @Get(':tenantId/account/messenger/conversations/:conversationId/messages')
  async messages(
    @Param('tenantId') tenantId: string,
    @Param('conversationId') conversationId: string,
    @Req() request: AccountRequest,
    @Query('limit') limit = '500',
  ) {
    const identity = await this.identity(tenantId, request.accountAuth!.accountId);
    return this.messenger.messages(tenantId, conversationId, 'person', identity, Number(limit));
  }

  @UseGuards(AccountGuard)
  @Post(':tenantId/account/messenger/conversations/:conversationId/read')
  async markRead(
    @Param('tenantId') tenantId: string,
    @Param('conversationId') conversationId: string,
    @Req() request: AccountRequest,
  ) {
    const identity = await this.identity(tenantId, request.accountAuth!.accountId);
    await this.messenger.messages(tenantId, conversationId, 'person', identity, 1);
    return markMessengerConversationRead(this.prisma, tenantId, conversationId, 'outbound');
  }

  @UseGuards(AccountGuard)
  @Post(':tenantId/account/messenger/conversations/:conversationId/messages')
  async send(
    @Param('tenantId') tenantId: string,
    @Param('conversationId') conversationId: string,
    @Req() request: AccountRequest,
    @Body() body: { body?: unknown; attachments?: unknown; replyToId?: unknown },
  ) {
    const identity = await this.identity(tenantId, request.accountAuth!.accountId);
    return this.messenger.sendToConversation(tenantId, conversationId, 'person', identity, body || {});
  }

  @UseGuards(AccountGuard)
  @Get(':tenantId/account/messenger/search')
  async search(
    @Param('tenantId') tenantId: string,
    @Req() request: AccountRequest,
    @Query('q') query = '',
    @Query('conversationId') conversationId = '',
  ) {
    const identity = await this.identity(tenantId, request.accountAuth!.accountId);
    return this.messenger.search(tenantId, 'person', identity, query, conversationId);
  }

  @UseGuards(AccountGuard)
  @Put(':tenantId/account/messenger/messages/:messageId')
  async edit(
    @Param('tenantId') tenantId: string,
    @Param('messageId') messageId: string,
    @Req() request: AccountRequest,
    @Body() body: { body?: unknown },
  ) {
    const identity = await this.identity(tenantId, request.accountAuth!.accountId);
    return this.messenger.editMessage(tenantId, messageId, 'person', identity, body?.body);
  }

  @UseGuards(AccountGuard)
  @Delete(':tenantId/account/messenger/messages/:messageId')
  async remove(
    @Param('tenantId') tenantId: string,
    @Param('messageId') messageId: string,
    @Req() request: AccountRequest,
  ) {
    const identity = await this.identity(tenantId, request.accountAuth!.accountId);
    return this.messenger.deleteMessage(tenantId, messageId, 'person', identity);
  }

  @UseGuards(AccountGuard)
  @Post(':tenantId/account/messenger/messages/:messageId/reactions')
  async react(
    @Param('tenantId') tenantId: string,
    @Param('messageId') messageId: string,
    @Req() request: AccountRequest,
    @Body() body: { emoji?: unknown },
  ) {
    const identity = await this.identity(tenantId, request.accountAuth!.accountId);
    return this.messenger.toggleReaction(tenantId, messageId, 'person', identity, body?.emoji);
  }

  @UseGuards(AccountGuard)
  @Post(':tenantId/account/messenger/messages/:messageId/pin')
  async pin(
    @Param('tenantId') tenantId: string,
    @Param('messageId') messageId: string,
    @Req() request: AccountRequest,
  ) {
    const identity = await this.identity(tenantId, request.accountAuth!.accountId);
    return this.messenger.togglePin(tenantId, messageId, 'person', identity);
  }

  @UseGuards(AccountGuard)
  @Post(':tenantId/account/messenger/messages/:messageId/forward')
  async forward(
    @Param('tenantId') tenantId: string,
    @Param('messageId') messageId: string,
    @Req() request: AccountRequest,
    @Body() body: { conversationId?: unknown },
  ) {
    const identity = await this.identity(tenantId, request.accountAuth!.accountId);
    return this.messenger.forwardMessage(tenantId, messageId, 'person', identity, String(body?.conversationId || ''));
  }

  @UseGuards(AccountGuard)
  @Post(':tenantId/account/messenger/messages/:messageId/vote')
  async vote(
    @Param('tenantId') tenantId: string,
    @Param('messageId') messageId: string,
    @Req() request: AccountRequest,
    @Body() body: { optionId?: unknown },
  ) {
    const identity = await this.identity(tenantId, request.accountAuth!.accountId);
    return this.messenger.votePoll(tenantId, messageId, 'person', identity, body?.optionId);
  }

  @UseGuards(AccountGuard)
  @Put(':tenantId/account/messenger/conversations/:conversationId/state')
  async state(
    @Param('tenantId') tenantId: string,
    @Param('conversationId') conversationId: string,
    @Req() request: AccountRequest,
    @Body() body: { archived?: unknown; muted?: unknown },
  ) {
    const identity = await this.identity(tenantId, request.accountAuth!.accountId);
    return this.messenger.setConversationState(tenantId, conversationId, 'person', identity, body || {});
  }
}
