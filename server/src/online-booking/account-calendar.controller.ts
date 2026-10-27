import { BadRequestException, Body, Controller, Delete, Get, Headers, Param, Post, Put, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AccountToolService, type AccountToolProvider } from '../saas-access/account-tool.service';
import { AccountGuard } from './account.guard';
import { AccountCalendarService } from './account-calendar.service';

type AccountRequest = Request & { accountAuth?: { accountId: string; tenantId: string } };

function calendarProvider(value: string): AccountToolProvider {
  const provider = String(value || '').trim().toLowerCase();
  if (provider !== 'google' && provider !== 'yandex') throw new BadRequestException('Неизвестный календарь');
  return provider;
}

@Controller('online-booking/account/calendar')
export class AccountCalendarController {
  constructor(
    private readonly calendars: AccountCalendarService,
    private readonly tools: AccountToolService,
  ) {}

  @UseGuards(AccountGuard)
  @Get()
  async status(@Req() request: AccountRequest) {
    const [status, availability] = await Promise.all([
      this.calendars.status(request.accountAuth!.accountId),
      this.tools.providerAvailability(),
    ]);
    return {
      google: {
        ...status.google,
        platformEnabled: availability.google,
        available: availability.google && status.google.available,
      },
      yandex: {
        ...status.yandex,
        platformEnabled: availability.yandex,
        available: availability.yandex && status.yandex.available,
      },
    };
  }

  @UseGuards(AccountGuard)
  @Post('google/connect')
  async beginGoogle(@Req() request: AccountRequest) {
    await this.tools.assertProviderEnabled('google');
    return this.calendars.beginGoogle(request.accountAuth!.accountId);
  }

  @Get('google/callback')
  async finishGoogle(
    @Req() request: Request,
    @Res() response: Response,
  ) {
    await this.tools.assertProviderEnabled('google');
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
    if ((await this.tools.providerAvailability()).google) {
      await this.calendars.googleWebhook(channelId, channelToken);
    }
    response.status(204).send();
  }

  @UseGuards(AccountGuard)
  @Post('yandex/connect')
  async connectYandex(@Req() request: AccountRequest, @Body() body: unknown) {
    await this.tools.assertProviderEnabled('yandex');
    return this.calendars.connectYandex(request.accountAuth!.accountId, body);
  }

  @UseGuards(AccountGuard)
  @Put(':provider/export')
  async setExportCalendar(
    @Req() request: AccountRequest,
    @Param('provider') provider: string,
    @Body() body: { calendarId?: unknown },
  ) {
    await this.tools.assertProviderEnabled(calendarProvider(provider));
    return this.calendars.setExportCalendar(request.accountAuth!.accountId, provider, body?.calendarId);
  }

  @UseGuards(AccountGuard)
  @Post('sync')
  async sync(@Req() request: AccountRequest) {
    await this.tools.ensureCatalog();
    return this.calendars.syncAccount(request.accountAuth!.accountId, { force: true });
  }

  @UseGuards(AccountGuard)
  @Delete(':provider')
  disconnect(@Req() request: AccountRequest, @Param('provider') provider: string) {
    return this.calendars.disconnect(request.accountAuth!.accountId, provider);
  }
}
