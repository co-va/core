import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaService } from '../prisma.service';
import { ProfessionalPushController } from './professional-push.controller';
import { ProfessionalPushService } from './professional-push.service';

@Module({
  imports: [AuthModule],
  controllers: [ProfessionalPushController],
  providers: [ProfessionalPushService, PrismaService],
  exports: [ProfessionalPushService],
})
export class ProfessionalPushModule {}
