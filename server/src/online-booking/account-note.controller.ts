import { Body, Controller, Delete, Get, Param, Put, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { NoteService } from '../note/note.service';
import { AccountGuard } from './account.guard';

type AccountRequest = Request & { accountAuth?: { accountId: string; tenantId: string } };

@Controller('online-booking/account/notes')
@UseGuards(AccountGuard)
export class AccountNoteController {
  constructor(private readonly notes: NoteService) {}

  @Get()
  list(@Req() req: AccountRequest) {
    return this.notes.listOwned('account', String(req.accountAuth?.accountId || ''));
  }

  @Get(':id')
  get(@Req() req: AccountRequest, @Param('id') id: string) {
    return this.notes.getOwned('account', String(req.accountAuth?.accountId || ''), id);
  }

  @Put(':id')
  upsert(@Req() req: AccountRequest, @Param('id') id: string, @Body() body: unknown) {
    return this.notes.upsertOwned('account', String(req.accountAuth?.accountId || ''), id, body);
  }

  @Delete(':id')
  remove(@Req() req: AccountRequest, @Param('id') id: string) {
    return this.notes.removeOwned('account', String(req.accountAuth?.accountId || ''), id);
  }
}
