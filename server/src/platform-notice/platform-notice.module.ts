import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaService } from '../prisma.service';
import { ProfessionalPushModule } from '../push/professional-push.module';
import { PlatformNoticeController } from './platform-notice.controller';
import { PlatformNoticeService } from './platform-notice.service';

@Module({
  imports: [AuthModule, ProfessionalPushModule],
  controllers: [PlatformNoticeController],
  providers: [PlatformNoticeService, PrismaService],
  exports: [PlatformNoticeService],
})
export class PlatformNoticeModule {}
