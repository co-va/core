import { Body, Controller, Delete, Get, Param, Put, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { EventService } from '../event/event.service';
import { AccountGuard } from './account.guard';

type AccountRequest = Request & { accountAuth?: { accountId: string; tenantId: string } };

@Controller('online-booking/account/events')
@UseGuards(AccountGuard)
export class AccountEventController {
  constructor(private readonly events: EventService) {}

  @Get()
  list(@Req() request: AccountRequest) {
    return this.events.listOwned('account', request.accountAuth!.accountId);
  }

  @Get(':id')
  get(@Req() request: AccountRequest, @Param('id') id: string) {
    return this.events.getOwned('account', request.accountAuth!.accountId, id);
  }

  @Put(':id')
  upsert(@Req() request: AccountRequest, @Param('id') id: string, @Body() body: unknown) {
    return this.events.upsertOwned('account', request.accountAuth!.accountId, id, body);
  }

  @Delete(':id')
  remove(@Req() request: AccountRequest, @Param('id') id: string) {
    return this.events.removeOwned('account', request.accountAuth!.accountId, id);
  }
}
