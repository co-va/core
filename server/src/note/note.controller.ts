import { Body, Controller, Delete, Get, Param, Put, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { NoteService } from './note.service';

type AuthenticatedRequest = Request & {
  auth?: { platformAccountId: string; tenantId: string; role: string };
};

@Controller('notes')
@UseGuards(JwtAuthGuard)
export class NoteController {
  constructor(private readonly notes: NoteService) {}

  @Get()
  list(@Req() request: AuthenticatedRequest) {
    return this.notes.listProfile(request.auth!.tenantId, request.auth!.platformAccountId);
  }

  @Get(':id')
  get(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    return this.notes.getProfile(request.auth!.tenantId, request.auth!.platformAccountId, id);
  }

  @Put(':id')
  upsert(@Req() request: AuthenticatedRequest, @Param('id') id: string, @Body() body: unknown) {
    return this.notes.upsertProfile(request.auth!.tenantId, request.auth!.platformAccountId, id, body);
  }

  @Delete(':id')
  remove(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    return this.notes.removeProfile(request.auth!.tenantId, request.auth!.platformAccountId, id);
  }
}
