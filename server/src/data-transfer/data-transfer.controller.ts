import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { DataTransferService } from './data-transfer.service';

type AuthenticatedRequest = Request & { auth?: { platformAccountId: string; tenantId: string; role: string } };

@Controller('data-transfer')
@UseGuards(JwtAuthGuard)
export class DataTransferController {
  constructor(private readonly transfer: DataTransferService) {}

  @Post('check')
  check(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    return this.transfer.check(request.auth!.tenantId, body);
  }

  @Post('apply')
  apply(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    return this.transfer.apply(request.auth!.tenantId, request.auth!.platformAccountId, body);
  }
}
