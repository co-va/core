import { Module } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { ProcedureModule } from '../procedure/procedure.module';
import { RecordModule } from '../record/record.module';
import { BusinessStateService } from './business-state.service';

@Module({
  imports: [RecordModule, ProcedureModule],
  providers: [BusinessStateService, PrismaService],
  exports: [BusinessStateService],
})
export class BusinessStateModule {}