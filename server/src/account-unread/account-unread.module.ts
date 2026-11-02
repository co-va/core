import { Module } from '@nestjs/common';
import { AccountGuard as AccountApiGuard } from '../account/account.guard';
import { AuthModule } from '../auth/auth.module';
import { EmailVerificationModule } from '../email-verification/email-verification.module';
import { AccountGuard as BookingAccountGuard } from '../online-booking/account.guard';
import { PrismaService } from '../prisma.service';
import { AccountApiUnreadController, AccountUnreadController } from './account-unread.controller';
import { AccountUnreadService } from './account-unread.service';

@Module({
  imports: [AuthModule, EmailVerificationModule],
  controllers: [AccountApiUnreadController, AccountUnreadController],
  providers: [AccountUnreadService, AccountApiGuard, BookingAccountGuard, PrismaService],
})
export class AccountUnreadModule {}
