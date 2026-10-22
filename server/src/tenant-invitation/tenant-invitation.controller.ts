import { Body, Controller, Post } from '@nestjs/common';
import { TenantInvitationService } from './tenant-invitation.service';
import { TenantPublicRegistrationService } from './tenant-public-registration.service';

@Controller('tenant-invitations')
export class TenantInvitationController {
  constructor(
    private readonly invitations: TenantInvitationService,
    private readonly publicRegistration: TenantPublicRegistrationService,
  ) {}

  @Post('public')
  startPublicRegistration(@Body() body: { email?: unknown }) {
    return this.publicRegistration.start(body || {});
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
