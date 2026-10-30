import { Body, Controller, Get, Post, Put, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';

type LoginBody = { identifier?: string; email?: string; password?: string };
type AuthRequest = Request & { auth?: { platformAccountId: string; tenantId: string; role: string } };

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('login')
  login(@Body() body: LoginBody) {
    return this.auth.login(body?.identifier || body?.email || '', body?.password || '');
  }

  @UseGuards(JwtAuthGuard)
  @Put('password')
  password(@Req() request: AuthRequest, @Body() body: { currentPassword?: unknown; newPassword?: unknown }) {
    return this.auth.changePassword(request.auth!.platformAccountId, body?.currentPassword, body?.newPassword);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@Req() request: AuthRequest) {
    return this.auth.me(request.auth!.platformAccountId, request.auth!.tenantId);
  }
}
