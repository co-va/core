import { Body, Controller, Delete, Get, Headers, Param, Post, Put, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AccountGuard } from './account.guard';
import { AccountCalendarService } from './account-calendar.service';

type AccountRequest = Request & { accountAuth?: { accountId: string; tenantId: string } };

@Controller('online-booking/account/calendar')
export class AccountCalendarController {
  constructor(private readonly calendars: AccountCalendarService) {}

  @UseGuards(AccountGuard)
  @Get()
  status(@Req() request: AccountRequest) {
    return this.calendars.status(request.accountAuth!.accountId);
  }

  @UseGuards(AccountGuard)
  @Post('google/connect')
  beginGoogle(@Req() request: AccountRequest) {
    return this.calendars.beginGoogle(request.accountAuth!.accountId);
  }

  @Get('google/callback')
  async finishGoogle(
    @Req() request: Request,
    @Res() response: Response,
  ) {
    await this.calendars.finishGoogle(request.query?.code, request.query?.state);
    const appUrl = String(process.env.ACCOUNT_APP_URL || '').trim() || '/';
    const separator = appUrl.includes('?') ? '&' : '?';
    response.redirect(`${appUrl}${separator}calendar=google&status=connected`);
  }

  @Post('google/webhook')
  async googleWebhook(
    @Headers('x-goog-channel-id') channelId = '',
    @Headers('x-goog-channel-token') channelToken = '',
    @Res() response: Response,
  ) {
    await this.calendars.googleWebhook(channelId, channelToken);
    response.status(204).send();
  }

  @UseGuards(AccountGuard)
  @Post('yandex/connect')
  connectYandex(@Req() request: AccountRequest, @Body() body: unknown) {
    return this.calendars.connectYandex(request.accountAuth!.accountId, body);
  }

  @UseGuards(AccountGuard)
  @Put(':provider/export')
  setExportCalendar(
    @Req() request: AccountRequest,
    @Param('provider') provider: string,
    @Body() body: { calendarId?: unknown },
  ) {
    return this.calendars.setExportCalendar(request.accountAuth!.accountId, provider, body?.calendarId);
  }

  @UseGuards(AccountGuard)
  @Post('sync')
  sync(@Req() request: AccountRequest) {
    return this.calendars.syncAccount(request.accountAuth!.accountId, { force: true });
  }

  @UseGuards(AccountGuard)
  @Delete(':provider')
  disconnect(@Req() request: AccountRequest, @Param('provider') provider: string) {
    return this.calendars.disconnect(request.accountAuth!.accountId, provider);
  }
}
