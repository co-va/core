import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { PrismaService } from './prisma.service';
import { AuthModule } from './auth/auth.module';
import { WorkspaceModule } from './workspace/workspace.module';
import { ProfileModule } from './profile/profile.module';
import { OnlineBookingModule } from './online-booking/online-booking.module';
import { BusinessStateModule } from './business-state/business-state.module';
import { BusinessStateHttpModule } from './business-state/business-state-http.module';
import { TenantDocumentArchiveModule } from './tenant-document-archive/tenant-document-archive.module';
import { AuxiliaryStateModule } from './auxiliary-state/auxiliary-state.module';
import { FinanceModule } from './finance/finance.module';
import { LoyaltyModule } from './loyalty/loyalty.module';
import { InventoryModule } from './inventory/inventory.module';
import { HistoryModule } from './history/history.module';
import { NotificationModule } from './notification/notification.module';
import { CommunicationModule } from './communication/communication.module';
import { SaasAccessModule } from './saas-access/saas-access.module';
import { TenantInvitationModule } from './tenant-invitation/tenant-invitation.module';
import { SaasAdminModule } from './saas-admin/saas-admin.module';
import { PlatformNoticeModule } from './platform-notice/platform-notice.module';
import { PasswordResetModule } from './password-reset/password-reset.module';
import { AccountUnreadModule } from './account-unread/account-unread.module';

@Module({
  imports: [
    AuthModule,
    WorkspaceModule,
    ProfileModule,
    BusinessStateModule,
    BusinessStateHttpModule,
    TenantDocumentArchiveModule,
    AuxiliaryStateModule,
    FinanceModule,
    LoyaltyModule,
    InventoryModule,
    HistoryModule,
    NotificationModule,
    CommunicationModule,
    OnlineBookingModule,
    SaasAccessModule,
    TenantInvitationModule,
    SaasAdminModule,
    PlatformNoticeModule,
    PasswordResetModule,
    AccountUnreadModule,
  ],
  controllers: [HealthController],
  providers: [PrismaService],
})
export class AppModule {}
