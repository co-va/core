import { Module } from '@nestjs/common';
import { AccountGuard } from '../account/account.guard';
import { AuthModule } from '../auth/auth.module';
import { EmailVerificationModule } from '../email-verification/email-verification.module';
import { LoyaltyModule } from '../loyalty/loyalty.module';
import { PrismaService } from '../prisma.service';
import { RecordModule } from '../record/record.module';
import { TenantDocumentArchiveModule } from '../tenant-document-archive/tenant-document-archive.module';
import { AccountContactsController } from './account-contacts.controller';
import { AccountContactsService } from './account-contacts.service';

@Module({
  imports: [AuthModule, EmailVerificationModule, LoyaltyModule, RecordModule, TenantDocumentArchiveModule],
  controllers: [AccountContactsController],
  providers: [AccountContactsService, AccountGuard, PrismaService],
})
export class AccountContactsModule {}
