import { Module } from '@nestjs/common';
import { AccountGuard as CanonicalAccountGuard } from '../account/account.guard';
import { AuthModule } from '../auth/auth.module';
import { EmailVerificationModule } from '../email-verification/email-verification.module';
import { AccountGuard as LegacyAccountGuard } from '../online-booking/account.guard';
import { PrismaService } from '../prisma.service';
import { AccountUnreadController, CanonicalAccountUnreadController } from './account-unread.controller';
import { AccountUnreadService } from './account-unread.service';

@Module({
  imports: [AuthModule, EmailVerificationModule],
  controllers: [CanonicalAccountUnreadController, AccountUnreadController],
  providers: [AccountUnreadService, CanonicalAccountGuard, LegacyAccountGuard, PrismaService],
})
export class AccountUnreadModule {}
