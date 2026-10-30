import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { EmailVerificationService } from '../email-verification/email-verification.service';
import { JwtAuthGuard } from './jwt-auth.guard';

type AuthRequest = Request & { auth?: { platformAccountId: string } };

@Controller('auth/email-verification')
export class PlatformEmailVerificationController {
  constructor(private readonly verification: EmailVerificationService) {}

  @Post('confirm')
  confirm(@Body() body: { token?: unknown }) {
    return this.verification.confirmPlatform(body?.token);
  }

  @UseGuards(JwtAuthGuard)
  @Get('status')
  status(@Req() request: AuthRequest) {
    return this.verification.statusPlatform(request.auth!.platformAccountId);
  }

  @UseGuards(JwtAuthGuard)
  @Post('request')
  request(@Req() request: AuthRequest) {
    return this.verification.requestPlatform(request.auth!.platformAccountId);
  }

  @UseGuards(JwtAuthGuard)
  @Post('change')
  change(@Req() request: AuthRequest, @Body() body: { email?: unknown }) {
    return this.verification.changePlatform(request.auth!.platformAccountId, body?.email);
  }
}
