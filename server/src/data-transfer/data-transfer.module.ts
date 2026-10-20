import { AuxiliaryStateModule } from '../auxiliary-state/auxiliary-state.module';
import { HistoryModule } from '../history/history.module';
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BusinessStateModule } from '../business-state/business-state.module';
import { ProfileModule } from '../profile/profile.module';
import { RecordModule } from '../record/record.module';
import { FinanceModule } from '../finance/finance.module';
import { InventoryModule } from '../inventory/inventory.module';
import { ProcedureModule } from '../procedure/procedure.module';
import { SaasAccessModule } from '../saas-access/saas-access.module';
import { PrismaService } from '../prisma.service';
import { DataTransferController } from './data-transfer.controller';
import { DataTransferService } from './data-transfer.service';
@Module({ imports: [HistoryModule, AuxiliaryStateModule, AuthModule, BusinessStateModule, ProfileModule, RecordModule, FinanceModule, InventoryModule, ProcedureModule, SaasAccessModule],
  controllers: [DataTransferController], providers: [DataTransferService, PrismaService] })
export class DataTransferModule {}
