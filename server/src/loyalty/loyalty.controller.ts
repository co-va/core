import { Body, Controller, Delete, Get, Param, Post, Put, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { DepositService } from './deposit.service';
import { PersonalAccountService } from './personal-account.service';

type AuthenticatedRequest = Request & {
  auth?: { platformAccountId: string; tenantId: string; role: string };
};

@Controller('loyalty')
@UseGuards(JwtAuthGuard)
export class LoyaltyController {
  constructor(
    private readonly deposits: DepositService,
    private readonly personalAccounts: PersonalAccountService,
  ) {}

  @Get('deposits')
  listDeposits(@Req() request: AuthenticatedRequest) {
    return this.deposits.list(request.auth!.tenantId);
  }

  @Get('deposits/person/:personKey')
  listPersonDeposits(
    @Req() request: AuthenticatedRequest,
    @Param('personKey') personKey: string,
  ) {
    return this.deposits.list(request.auth!.tenantId, personKey);
  }

  @Post('deposits/fund')
  fundDeposit(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    return this.deposits.fund(request.auth!.tenantId, body);
  }

  @Post('deposits/:depositId/fund')
  fundExistingDeposit(
    @Req() request: AuthenticatedRequest,
    @Param('depositId') depositId: string,
    @Body() body: unknown,
  ) {
    return this.deposits.fundExisting(request.auth!.tenantId, depositId, body);
  }

  @Put('deposits/:depositId/funding/:operationId')
  correctDepositFunding(
    @Req() request: AuthenticatedRequest,
    @Param('depositId') depositId: string,
    @Param('operationId') operationId: string,
    @Body() body: unknown,
  ) {
    return this.deposits.correctFunding(request.auth!.tenantId, depositId, operationId, body);
  }

  @Delete('deposits/:depositId/funding/:operationId')
  deleteDepositFunding(
    @Req() request: AuthenticatedRequest,
    @Param('depositId') depositId: string,
    @Param('operationId') operationId: string,
  ) {
    return this.deposits.deleteFunding(request.auth!.tenantId, depositId, operationId);
  }

  @Put('deposits/:depositId/settings')
  updateDepositSettings(
    @Req() request: AuthenticatedRequest,
    @Param('depositId') depositId: string,
    @Body() body: unknown,
  ) {
    return this.deposits.updateSettings(request.auth!.tenantId, depositId, body);
  }

  @Post('deposits/:depositId/withdraw')
  withdrawDeposit(
    @Req() request: AuthenticatedRequest,
    @Param('depositId') depositId: string,
    @Body() body: unknown,
  ) {
    return this.deposits.withdraw(request.auth!.tenantId, depositId, body);
  }

  @Delete('deposits/program/:programId')
  deleteProgramDeposits(
    @Req() request: AuthenticatedRequest,
    @Param('programId') programId: string,
  ) {
    return this.deposits.hardDeleteProgram(request.auth!.tenantId, programId);
  }

  @Delete('deposits/:depositId')
  deleteDeposit(
    @Req() request: AuthenticatedRequest,
    @Param('depositId') depositId: string,
  ) {
    return this.deposits.hardDelete(request.auth!.tenantId, depositId);
  }

  @Get('personal-accounts')
  listPersonalAccounts(@Req() request: AuthenticatedRequest) {
    return this.personalAccounts.list(request.auth!.tenantId);
  }

  @Get('personal-accounts/person/:personKey')
  getPersonalAccount(
    @Req() request: AuthenticatedRequest,
    @Param('personKey') personKey: string,
  ) {
    return this.personalAccounts.get(request.auth!.tenantId, personKey);
  }

  @Put('personal-accounts/person/:personKey')
  updatePersonalAccountSettings(
    @Req() request: AuthenticatedRequest,
    @Param('personKey') personKey: string,
    @Body() body: unknown,
  ) {
    return this.personalAccounts.updateSettings(request.auth!.tenantId, personKey, body);
  }

  @Post('personal-accounts/person/:personKey/fund')
  fundPersonalAccount(
    @Req() request: AuthenticatedRequest,
    @Param('personKey') personKey: string,
    @Body() body: unknown,
  ) {
    return this.personalAccounts.fund(request.auth!.tenantId, personKey, body);
  }

  @Post('personal-accounts/person/:personKey/withdraw')
  withdrawPersonalAccount(
    @Req() request: AuthenticatedRequest,
    @Param('personKey') personKey: string,
    @Body() body: unknown,
  ) {
    return this.personalAccounts.withdraw(request.auth!.tenantId, personKey, body);
  }

  @Post('personal-accounts/person/:personKey/pay')
  payFromPersonalAccount(
    @Req() request: AuthenticatedRequest,
    @Param('personKey') personKey: string,
    @Body() body: unknown,
  ) {
    return this.personalAccounts.pay(request.auth!.tenantId, personKey, body);
  }

  @Post('personal-accounts/person/:personKey/finalize-debt')
  finalizePersonalAccountDebt(
    @Req() request: AuthenticatedRequest,
    @Param('personKey') personKey: string,
    @Body() body: unknown,
  ) {
    return this.personalAccounts.finalizeDebt(request.auth!.tenantId, personKey, body);
  }

  @Post('personal-accounts/payment/:operationId/refund')
  refundPersonalAccountPayment(
    @Req() request: AuthenticatedRequest,
    @Param('operationId') operationId: string,
    @Body() body: unknown,
  ) {
    return this.personalAccounts.refundPayment(request.auth!.tenantId, operationId, body);
  }

  @Post('personal-accounts/debts/:debtId/settle')
  settlePersonalAccountDebt(
    @Req() request: AuthenticatedRequest,
    @Param('debtId') debtId: string,
    @Body() body: unknown,
  ) {
    return this.personalAccounts.settleDebt(request.auth!.tenantId, debtId, body);
  }
}
