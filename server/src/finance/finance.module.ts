import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { NotificationModule } from '../notification/notification.module';
import { PrismaService } from '../prisma.service';
import { SaasAccessModule } from '../saas-access/saas-access.module';
import { FinanceController } from './finance.controller';
import { FinanceService } from './finance.service';
import { PaymentSettlementService } from './payment-settlement.service';
import { PersonalAccountFinanceService } from './personal-account-finance.service';

@Module({
  imports: [AuthModule, NotificationModule, SaasAccessModule],
  controllers: [FinanceController],
  providers: [FinanceService, PaymentSettlementService, PersonalAccountFinanceService, PrismaService],
  exports: [FinanceService, PaymentSettlementService, PersonalAccountFinanceService],
})
export class FinanceModule {}