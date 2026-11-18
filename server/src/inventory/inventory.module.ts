import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { FinanceModule } from '../finance/finance.module';
import { PrismaService } from '../prisma.service';
import { InventoryController } from './inventory.controller';
import { InventoryCounterpartyController } from './inventory-counterparty.controller';
import { InventoryCounterpartyService } from './inventory-counterparty.service';
import { SaasAccessModule } from '../saas-access/saas-access.module';
import { InventoryExcelController } from './inventory-excel.controller';
import { InventoryExcelService } from './inventory-excel-final.service';
import { InventoryService } from './inventory.service';
import { InventoryCriteriaService } from './inventory-criteria.service';
import { InventoryOrderExportService } from './inventory-order-export.service';

@Module({
  imports: [AuthModule, FinanceModule, SaasAccessModule],
  controllers: [InventoryController, InventoryExcelController, InventoryCounterpartyController],
  providers: [InventoryService, InventoryExcelService, InventoryOrderExportService, InventoryCounterpartyService, InventoryCriteriaService, PrismaService],
  exports: [InventoryService],
})
export class InventoryModule {}
