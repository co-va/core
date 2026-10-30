import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { FinanceModule } from '../finance/finance.module';
import { NotificationModule } from '../notification/notification.module';
import { PrismaService } from '../prisma.service';
import { DepositService } from './deposit.service';
import { LoyaltyController } from './loyalty.controller';
import { PersonalAccountService } from './personal-account.service';

@Module({
  imports: [AuthModule, FinanceModule, NotificationModule],
  controllers: [LoyaltyController],
  providers: [DepositService, PersonalAccountService, PrismaService],
  exports: [DepositService, PersonalAccountService],
})
export class LoyaltyModule {}