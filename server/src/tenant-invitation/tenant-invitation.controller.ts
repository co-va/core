import { Body, Controller, Post } from '@nestjs/common';
import { EmailVerificationService } from '../email-verification/email-verification.service';
import { TenantInvitationService } from './tenant-invitation.service';

@Controller('tenant-invitations')
export class TenantInvitationController {
  constructor(
    private readonly invitations: TenantInvitationService,
    private readonly emailVerification: EmailVerificationService,
  ) {}

  @Post('public')
  startPublicRegistration(@Body() body: { email?: unknown }) {
    return this.invitations.startPublicRegistration(body || {});
  }

  @Post('inspect')
  inspect(@Body() body: { token?: unknown }) {
    return this.invitations.inspect(body?.token);
  }

  @Post('accept')
  async accept(@Body() body: {
    token?: unknown;
    password?: unknown;
    email?: unknown;
    name?: unknown;
    surname?: unknown;
    phone?: unknown;
    documents?: unknown;
  }) {
    const result = await this.invitations.accept(body || {});
    const accountId = String((result as any)?.account?.id || '').trim();
    if (accountId) void this.emailVerification.requestPlatform(accountId).catch(() => undefined);
    return result;
  }
}
