import { Body, Controller, Get, Param, Put, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AccountToolService } from '../saas-access/account-tool.service';
import { PlatformAdminGuard } from './platform-admin.guard';

@Controller('saas-admin/account-tools')
@UseGuards(JwtAuthGuard, PlatformAdminGuard)
export class AccountToolsController {
  constructor(private readonly tools: AccountToolService) {}

  @Get()
  list() {
    return this.tools.list();
  }

  @Put(':key')
  setEnabled(@Param('key') key: string, @Body() body: { enabled?: unknown }) {
    return this.tools.setEnabled(key, body?.enabled);
  }
}
