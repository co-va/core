import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BusinessStateModule } from '../business-state/business-state.module';
import { CommunicationModule } from '../communication/communication.module';
import { DocumentRegistryModule } from '../document-registry/document-registry.module';
import { EmailVerificationModule } from '../email-verification/email-verification.module';
import { EventModule } from '../event/event.module';
import { NoteModule } from '../note/note.module';
import { TenantDocumentArchiveModule } from '../tenant-document-archive/tenant-document-archive.module';
import { NotificationModule } from '../notification/notification.module';
import { PlatformNoticeModule } from '../platform-notice/platform-notice.module';
import { ProfileModule } from '../profile/profile.module';
import { PrismaService } from '../prisma.service';
import { TimeModule } from '../time/time.module';
import { RecordModule } from '../record/record.module';
import { ProcedureModule } from '../procedure/procedure.module';
import { FinanceModule } from '../finance/finance.module';
import { LoyaltyModule } from '../loyalty/loyalty.module';
import { AccountGuard } from './account.guard';
import { AccountBookingTargetsController } from './account-booking-targets.controller';
import { AccountCalendarController } from './account-calendar.controller';
import { AccountCalendarGoogleAdapter } from './account-calendar-google.adapter';
import { AccountCalendarService } from './account-calendar.service';
import { AccountCalendarYandexAdapter } from './account-calendar-yandex.adapter';
import { AccountDepositController } from './account-deposit.controller';
import { AccountEmailVerificationController } from './account-email-verification.controller';
import { AccountEventController } from './account-event.controller';
import { AccountNoteController } from './account-note.controller';
import { AccountMessengerController } from './account-messenger.controller';
import { AccountPersonalAccountController } from './account-personal-account.controller';
import { AccountPushController } from './account-push.controller';
import { AccountSettingsController } from './account-settings.controller';
import { BookingConsentController } from './booking-consent.controller';
import { BookingPdnConsentGuard } from './booking-pdn-consent.guard';
import { BookingFlowController } from './booking-flow.controller';
import { BookingFlowService } from './booking-flow.service';
import { PersonIdentityService } from './person-identity.service';
import { OnlineBookingController } from './online-booking.controller';
import { OnlineBookingService } from './online-booking.service';
import { SaasAccessModule } from '../saas-access/saas-access.module';

@Module({
  imports: [AuthModule, BusinessStateModule, CommunicationModule, DocumentRegistryModule, EmailVerificationModule, EventModule, NoteModule, TenantDocumentArchiveModule, NotificationModule, PlatformNoticeModule, ProfileModule, TimeModule, RecordModule, ProcedureModule, FinanceModule, LoyaltyModule, SaasAccessModule],
  controllers: [OnlineBookingController, BookingFlowController, AccountBookingTargetsController, AccountCalendarController, AccountEmailVerificationController, AccountEventController, AccountNoteController, AccountMessengerController, BookingConsentController, AccountSettingsController, AccountDepositController, AccountPersonalAccountController, AccountPushController],
  providers: [OnlineBookingService, BookingFlowService, AccountCalendarService, AccountCalendarGoogleAdapter, AccountCalendarYandexAdapter, AccountGuard, BookingPdnConsentGuard, PersonIdentityService, PrismaService],
})
export class OnlineBookingModule {}
