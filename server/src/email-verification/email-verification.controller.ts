import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AccountGuard } from '../online-booking/account.guard';
import { EmailVerificationService } from './email-verification.service';

type PlatformRequest = Request & { auth?: { platformAccountId: string } };
type AccountRequest = Request & { accountAuth?: { accountId: string } };

@Controller('auth/email-verification')
export class PlatformEmailVerificationController {
  constructor(private readonly verification: EmailVerificationService) {}

  @Post('confirm')
  confirm(@Body() body: { token?: unknown }) {
    return this.verification.confirmPlatform(body?.token);
  }

  @UseGuards(JwtAuthGuard)
  @Get('status')
  status(@Req() request: PlatformRequest) {
    return this.verification.statusPlatform(request.auth!.platformAccountId);
  }

  @UseGuards(JwtAuthGuard)
  @Post('request')
  request(@Req() request: PlatformRequest) {
    return this.verification.requestPlatform(request.auth!.platformAccountId);
  }

  @UseGuards(JwtAuthGuard)
  @Post('change')
  change(@Req() request: PlatformRequest, @Body() body: { email?: unknown }) {
    return this.verification.changePlatform(request.auth!.platformAccountId, body?.email);
  }
}

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
