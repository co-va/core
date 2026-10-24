import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BusinessStateModule } from '../business-state/business-state.module';
import { CommunicationModule } from '../communication/communication.module';
import { DocumentRegistryModule } from '../document-registry/document-registry.module';
import { TenantDocumentArchiveModule } from '../tenant-document-archive/tenant-document-archive.module';
import { NotificationModule } from '../notification/notification.module';
import { ProfileModule } from '../profile/profile.module';
import { PrismaService } from '../prisma.service';
import { TimeModule } from '../time/time.module';
import { RecordModule } from '../record/record.module';
import { ProcedureModule } from '../procedure/procedure.module';
import { FinanceModule } from '../finance/finance.module';
import { LoyaltyModule } from '../loyalty/loyalty.module';
import { AccountGuard } from './account.guard';
import { AccountDepositController } from './account-deposit.controller';
import { AccountMessengerController } from './account-messenger.controller';
import { AccountPersonalAccountController } from './account-personal-account.controller';
import { AccountSettingsController } from './account-settings.controller';
import { BookingConsentController } from './booking-consent.controller';
import { BookingPdnConsentGuard } from './booking-pdn-consent.guard';
import { PersonIdentityService } from './person-identity.service';
import { OnlineBookingController } from './online-booking.controller';
import { OnlineBookingService } from './online-booking.service';
import { SaasAccessModule } from '../saas-access/saas-access.module';

@Module({
  imports: [AuthModule, BusinessStateModule, CommunicationModule, DocumentRegistryModule, TenantDocumentArchiveModule, NotificationModule, ProfileModule, TimeModule, RecordModule, ProcedureModule, FinanceModule, LoyaltyModule, SaasAccessModule],
  controllers: [OnlineBookingController, AccountMessengerController, BookingConsentController, AccountSettingsController, AccountDepositController, AccountPersonalAccountController],
  providers: [OnlineBookingService, AccountGuard, BookingPdnConsentGuard, PersonIdentityService, PrismaService],
})
export class OnlineBookingModule {}
