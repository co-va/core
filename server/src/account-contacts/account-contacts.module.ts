import { Module } from '@nestjs/common';
import { AccountGuard } from '../account/account.guard';
import { AuthModule } from '../auth/auth.module';
import { EmailVerificationModule } from '../email-verification/email-verification.module';
import { PrismaService } from '../prisma.service';
import { TenantDocumentArchiveModule } from '../tenant-document-archive/tenant-document-archive.module';
import { AccountContactsController } from './account-contacts.controller';
import { AccountContactsService } from './account-contacts.service';

@Module({
  imports: [AuthModule, EmailVerificationModule, TenantDocumentArchiveModule],
  controllers: [AccountContactsController],
  providers: [AccountContactsService, AccountGuard, PrismaService],
})
export class AccountContactsModule {}
