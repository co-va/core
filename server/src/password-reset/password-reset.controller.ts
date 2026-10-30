import { Body, Controller, Post } from '@nestjs/common';
import { PasswordResetService } from './password-reset.service';

@Controller()
export class PasswordResetController {
  constructor(private readonly resets: PasswordResetService) {}

  @Post('auth/password-reset/request')
  requestPlatform(@Body() body: { identifier?: unknown; email?: unknown; surface?: unknown }) {
    return this.resets.requestPlatform(body?.identifier ?? body?.email, body?.surface);
  }

  @Post('auth/password-reset/confirm')
  confirmPlatform(@Body() body: { token?: unknown; newPassword?: unknown }) {
    return this.resets.confirmPlatform(body?.token, body?.newPassword);
  }

  @Post('online-booking/account/password-reset/request')
  requestAccount(@Body() body: { identifier?: unknown }) {
    return this.resets.requestAccount(body?.identifier);
  }

  @Post('online-booking/account/password-reset/confirm')
  confirmAccount(@Body() body: { token?: unknown; newPassword?: unknown }) {
    return this.resets.confirmAccount(body?.token, body?.newPassword);
  }
}
