import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PlatformNoticeModule } from '../platform-notice/platform-notice.module';
import { TenantDocumentArchiveModule } from '../tenant-document-archive/tenant-document-archive.module';
import { PrismaService } from '../prisma.service';
import { NotificationController } from './notification.controller';
import { NotificationEventService } from './notification-event.service';
import { NotificationReminderService } from './notification-reminder.service';
import { NotificationService } from './notification.service';
import { WebPushService } from './web-push.service';

@Module({
  imports: [AuthModule, PlatformNoticeModule, TenantDocumentArchiveModule],
  controllers: [NotificationController],
  providers: [NotificationService, NotificationEventService, NotificationReminderService, WebPushService, PrismaService],
  exports: [NotificationService, NotificationEventService, WebPushService],
})
export class NotificationModule {}