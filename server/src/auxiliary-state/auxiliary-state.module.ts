import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { NotificationModule } from '../notification/notification.module';
import { PrismaService } from '../prisma.service';
import { SaasAccessModule } from '../saas-access/saas-access.module';
import { AuxiliaryStateController } from './auxiliary-state.controller';
import { AuxiliaryStateService } from './auxiliary-state.service';

@Module({
  imports: [AuthModule, NotificationModule, SaasAccessModule],
  controllers: [AuxiliaryStateController],
  providers: [PrismaService, AuxiliaryStateService],
  exports: [AuxiliaryStateService],
})
export class AuxiliaryStateModule {}