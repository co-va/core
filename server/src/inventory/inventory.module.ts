import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { FinanceModule } from '../finance/finance.module';
import { PrismaService } from '../prisma.service';
import { InventoryController } from './inventory.controller';
import { InventoryExcelController } from './inventory-excel.controller';
import { InventoryExcelService } from './inventory-excel-final.service';
import { InventoryService } from './inventory.service';
import { InventoryOrderExportService } from './inventory-order-export.service';

@Module({
  imports: [AuthModule, FinanceModule],
  controllers: [InventoryController, InventoryExcelController],
  providers: [InventoryService, InventoryExcelService, InventoryOrderExportService, PrismaService],
  exports: [InventoryService],
})
export class InventoryModule {}
