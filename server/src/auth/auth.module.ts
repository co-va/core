import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { EmailVerificationModule } from '../email-verification/email-verification.module';
import { PrismaService } from '../prisma.service';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { PlatformEmailVerificationController } from './email-verification.controller';
import { JwtAuthGuard } from './jwt-auth.guard';

@Module({
  imports: [JwtModule.register({
    secret: process.env.JWT_SECRET || 'book-dev-only-change-me',
    signOptions: { expiresIn: '7d' },
  }), EmailVerificationModule],
  controllers: [AuthController, PlatformEmailVerificationController],
  providers: [AuthService, JwtAuthGuard, PrismaService],
  exports: [JwtAuthGuard, JwtModule],
})
export class AuthModule {}
