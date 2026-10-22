import { Body, Controller, Post } from '@nestjs/common';
import { TenantInvitationService } from './tenant-invitation.service';

@Controller('tenant-invitations')
export class TenantInvitationController {
  constructor(private readonly invitations: TenantInvitationService) {}

  @Post('public')
  startPublicRegistration(@Body() body: { email?: unknown }) {
    return this.invitations.startPublicRegistration(body || {});
  }

  @Post('inspect')
  inspect(@Body() body: { token?: unknown }) {
    return this.invitations.inspect(body?.token);
  }

  @Post('accept')
  accept(@Body() body: {
    token?: unknown;
    password?: unknown;
    email?: unknown;
    name?: unknown;
    surname?: unknown;
    phone?: unknown;
    documents?: unknown;
  }) {
    return this.invitations.accept(body || {});
  }
}
