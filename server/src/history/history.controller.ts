import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { HistoryService } from './history.service';

type AuthenticatedRequest = Request & {
  auth?: { platformAccountId: string; tenantId: string; role: string };
};

function values(value: unknown) {
  if (Array.isArray(value)) return value.flatMap((item) => String(item || '').split(',')).map((item) => item.trim()).filter(Boolean);
  return String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
}

@Controller('history')
@UseGuards(JwtAuthGuard)
export class HistoryController {
  constructor(private readonly history: HistoryService) {}

  @Get('as-of')
  asOf(
    @Req() request: AuthenticatedRequest,
    @Query('entityType') entityType: string,
    @Query('entityId') entityId: string,
    @Query('at') at: string,
  ) {
    return this.history.asOf(request.auth!.tenantId, entityType, entityId, at);
  }

  @Get()
  list(
    @Req() request: AuthenticatedRequest,
    @Query('personKey') personKey = '',
    @Query('personKeys') personKeys: string | string[] = '',
    @Query('recordId') recordId = '',
    @Query('workplaceKey') workplaceKey = '',
    @Query('procedureId') procedureId = '',
    @Query('documentId') documentId = '',
    @Query('inventoryItemId') inventoryItemId = '',
    @Query('financeOperationId') financeOperationId = '',
    @Query('entityType') entityType = '',
    @Query('entityId') entityId = '',
    @Query('from') from = '',
    @Query('to') to = '',
    @Query('limit') limit = '500',
  ) {
    return this.history.list(request.auth!.tenantId, {
      personKey,
      personKeys: values(personKeys),
      recordId,
      workplaceKey,
      procedureId,
      documentId,
      inventoryItemId,
      financeOperationId,
      entityType,
      entityId,
      from,
      to,
      limit: Number(limit),
    });
  }
}
