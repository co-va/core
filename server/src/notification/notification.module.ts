import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ProfessionalPushModule } from '../push/professional-push.module';
import { TenantDocumentArchiveModule } from '../tenant-document-archive/tenant-document-archive.module';
import { PrismaService } from '../prisma.service';
import { NotificationController } from './notification.controller';
import { NotificationEventService } from './notification-event.service';
import { NotificationReminderService } from './notification-reminder.service';
import { NotificationService } from './notification.service';
import { ProfessionalServiceNoticeService } from './professional-service-notice.service';
import { WebPushService } from './web-push.service';

@Module({
  imports: [AuthModule, ProfessionalPushModule, TenantDocumentArchiveModule],
  controllers: [NotificationController],
  providers: [
    NotificationService,
    NotificationEventService,
    NotificationReminderService,
    ProfessionalServiceNoticeService,
    WebPushService,
    PrismaService,
  ],
  exports: [NotificationService, NotificationEventService, ProfessionalServiceNoticeService, WebPushService],
})
export class NotificationModule {}
