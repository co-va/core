import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { EmailVerificationService } from '../email-verification/email-verification.service';
import { AccountGuard } from './account.guard';

type AccountRequest = Request & { accountAuth?: { accountId: string } };

@Controller('online-booking/account/email-verification')
export class AccountEmailVerificationController {
  constructor(private readonly verification: EmailVerificationService) {}

  @Post('confirm')
  confirm(@Body() body: { token?: unknown }) {
    return this.verification.confirmAccount(body?.token);
  }

  @UseGuards(AccountGuard)
  @Get('status')
  status(@Req() request: AccountRequest) {
    return this.verification.statusAccount(request.accountAuth!.accountId);
  }

  @UseGuards(AccountGuard)
  @Post('request')
  request(@Req() request: AccountRequest) {
    return this.verification.requestAccount(request.accountAuth!.accountId);
  }

  @UseGuards(AccountGuard)
  @Post('change')
  change(@Req() request: AccountRequest, @Body() body: { email?: unknown }) {
    return this.verification.changeAccount(request.accountAuth!.accountId, body?.email);
  }
}
