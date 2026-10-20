import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BusinessStateModule } from '../business-state/business-state.module';
import { FinanceModule } from '../finance/finance.module';
import { HistoryModule } from '../history/history.module';
import { InventoryModule } from '../inventory/inventory.module';
import { PrismaService } from '../prisma.service';
import { ProfileModule } from '../profile/profile.module';
import { RecordModule } from '../record/record.module';
import { DataTransferController } from './data-transfer.controller';
import { DataTransferAnalyser } from './data-transfer.analyser';
import { DataTransferService } from './data-transfer.service';

@Module({
  imports: [AuthModule, ProfileModule, BusinessStateModule, RecordModule, FinanceModule, InventoryModule, HistoryModule],
  controllers: [DataTransferController],
  providers: [DataTransferService, DataTransferAnalyser, PrismaService],
})
export class DataTransferModule {}
