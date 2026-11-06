import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaService } from '../prisma.service';
import { HistoryController } from './history.controller';
import { HistoryService } from './history.service';
import { HistoryMembershipGuard } from './history-membership.guard';

@Module({
  imports: [AuthModule],
  controllers: [HistoryController],
  providers: [HistoryService, HistoryMembershipGuard, PrismaService],
  exports: [HistoryService],
})
export class HistoryModule {}
