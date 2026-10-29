import { Body, Controller, Delete, Get, Put, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { WebPushService } from '../notification/web-push.service';
import { AccountGuard } from './account.guard';

type AccountRequest = Request & { accountAuth?: { accountId: string; tenantId: string } };

@UseGuards(AccountGuard)
@Controller('online-booking/account/push')
export class AccountPushController {
  constructor(private readonly webPush: WebPushService) {}

  @Get('config')
  configuration() {
    return this.webPush.configuration();
  }

  @Put('subscription')
  saveSubscription(
    @Req() request: AccountRequest,
    @Body() body: { subscription?: unknown },
  ) {
    const userAgent = Array.isArray(request.headers['user-agent'])
      ? request.headers['user-agent'][0] || ''
      : request.headers['user-agent'] || '';
    return this.webPush.saveSubscription(
      null,
      request.accountAuth!.accountId,
      body?.subscription,
      userAgent,
    );
  }

  @Delete('subscription')
  deleteSubscription(
    @Req() request: AccountRequest,
    @Body() body: { endpoint?: unknown },
  ) {
    return this.webPush.deleteSubscription(null, request.accountAuth!.accountId, body?.endpoint);
  }
}
