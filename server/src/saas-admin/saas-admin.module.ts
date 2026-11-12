import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { HistoryModule } from '../history/history.module';
import { TenantInvitationModule } from '../tenant-invitation/tenant-invitation.module';
import { DocumentRegistryModule } from '../document-registry/document-registry.module';
import { TransactionalEmailModule } from '../transactional-email/transactional-email.module';
import { PrismaService } from '../prisma.service';
import { SaasAccessModule } from '../saas-access/saas-access.module';
import { PlatformAdminGuard } from './platform-admin.guard';
import { SaasAdminController } from './saas-admin.controller';
import { SaasAdminService } from './saas-admin.service';
import { PlatformNoticeModule } from '../platform-notice/platform-notice.module';
import { CommercialCatalogController, CommercialPublicController } from './commercial-catalog.controller';
import { CommercialCatalogService } from './commercial-catalog.service';
import { CommercialTenantController } from './commercial-tenant.controller';
import { CommercialTenantService } from './commercial-tenant.service';
import { CommercialSelfServiceController } from './commercial-self-service.controller';
import { CommercialReceiptService } from './commercial-receipt.service';
import { CommercialInvoiceService } from './commercial-invoice.service';
import { AccountToolsController } from './account-tools.controller';
import { ToolReadinessController } from './tool-readiness.controller';
import { ToolReadinessService } from './tool-readiness.service';

@Module({
  imports: [AuthModule, HistoryModule, SaasAccessModule, TenantInvitationModule, DocumentRegistryModule, TransactionalEmailModule, PlatformNoticeModule],
  controllers: [SaasAdminController, AccountToolsController, ToolReadinessController, CommercialCatalogController, CommercialPublicController, CommercialTenantController, CommercialSelfServiceController],
  providers: [SaasAdminService, ToolReadinessService, CommercialCatalogService, CommercialTenantService, CommercialReceiptService, CommercialInvoiceService, PlatformAdminGuard, PrismaService],
})
export class SaasAdminModule {}
