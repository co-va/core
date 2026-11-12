import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PlatformAdminGuard } from './platform-admin.guard';
import { CommercialFinanceService } from './commercial-finance.service';

@Controller('saas-admin/finance')
@UseGuards(JwtAuthGuard, PlatformAdminGuard)
export class CommercialFinanceController {
  constructor(private readonly finance: CommercialFinanceService) {}

  @Get('overview')
  overview() {
    return this.finance.overview();
  }
}
