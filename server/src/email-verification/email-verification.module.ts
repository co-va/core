import { Module } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { TransactionalEmailModule } from '../transactional-email/transactional-email.module';
import { AccountEmailVerificationController, PlatformEmailVerificationController } from './email-verification.controller';
import { EmailVerificationService } from './email-verification.service';

@Module({
  imports: [TransactionalEmailModule],
  controllers: [PlatformEmailVerificationController, AccountEmailVerificationController],
  providers: [EmailVerificationService, PrismaService],
  exports: [EmailVerificationService],
})
export class EmailVerificationModule {}
