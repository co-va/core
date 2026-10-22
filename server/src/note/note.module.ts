import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaService } from '../prisma.service';
import { NoteController } from './note.controller';
import { NoteService } from './note.service';

@Module({
  imports: [AuthModule],
  controllers: [NoteController],
  providers: [NoteService, PrismaService],
  exports: [NoteService],
})
export class NoteModule {}
