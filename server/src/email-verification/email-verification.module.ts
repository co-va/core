import { Module } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { TransactionalEmailModule } from '../transactional-email/transactional-email.module';
import { EmailVerificationService } from './email-verification.service';

@Module({
  imports: [TransactionalEmailModule],
  providers: [EmailVerificationService, PrismaService],
  exports: [EmailVerificationService],
})
export class EmailVerificationModule {}
