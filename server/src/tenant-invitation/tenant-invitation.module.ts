import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaService } from '../prisma.service';
import { TransactionalEmailModule } from '../transactional-email/transactional-email.module';
import { TenantInvitationController } from './tenant-invitation.controller';
import { TenantInvitationService } from './tenant-invitation.service';
import { TenantPublicRegistrationService } from './tenant-public-registration.service';
import { DocumentRegistryModule } from '../document-registry/document-registry.module';

@Module({
  imports: [AuthModule, TransactionalEmailModule, DocumentRegistryModule],
  controllers: [TenantInvitationController],
  providers: [TenantInvitationService, TenantPublicRegistrationService, PrismaService],
  exports: [TenantInvitationService],
})
export class TenantInvitationModule {}
