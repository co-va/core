import { Module } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { FinanceModule } from '../finance/finance.module';
import { ProcedureModule } from '../procedure/procedure.module';
import { TimeModule } from '../time/time.module';
import { InventoryModule } from '../inventory/inventory.module';
import { RecordService } from './record.service';

@Module({
  imports: [FinanceModule, ProcedureModule, TimeModule, InventoryModule],
  providers: [RecordService, PrismaService],
  exports: [RecordService],
})
export class RecordModule {}
