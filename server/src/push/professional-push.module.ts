import { Module } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { ProfessionalPushService } from './professional-push.service';

@Module({
  providers: [ProfessionalPushService, PrismaService],
  exports: [ProfessionalPushService],
})
export class ProfessionalPushModule {}
