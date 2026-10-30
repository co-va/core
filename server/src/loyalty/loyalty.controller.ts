import { Body, Controller, Delete, Get, Param, Post, Put, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { NotificationEventService } from '../notification/notification-event.service';
import { DepositService } from './deposit.service';
import { PersonalAccountService } from './personal-account.service';

type AuthenticatedRequest = Request & {
  auth?: { platformAccountId: string; tenantId: string; role: string };
};

type JsonObject = Record<string, any>;

function objectValue(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {};
}

function text(value: unknown) {
  return String(value ?? '').trim();
}

@Controller('loyalty')
@UseGuards(JwtAuthGuard)
export class LoyaltyController {
  constructor(
    private readonly deposits: DepositService,
    private readonly personalAccounts: PersonalAccountService,
    private readonly notifications: NotificationEventService,
  ) {}

  private async notifyLoyalty(tenantId: string, resultValue: unknown) {
    const result = objectValue(resultValue);
    const person = objectValue(result.person);
    if (!text(person.key) && !text(person.phone) && !text(person.accountId) && !Array.isArray(person.accounts)) return;
    await this.notifications.createEventForPerson(tenantId, person, {
      type: 'loyalty.changed',
      entityType: 'loyalty',
      entityId: text(result.depositId || result.programId),
      context: {
        program: text(result.programName),
        date: new Date().toISOString().slice(0, 10),
      },
    }).catch(() => null);
  }

  private async notifyPersonalAccount(tenantId: string, personKeyValue: unknown, resultValue: unknown = null) {
    const result = objectValue(resultValue);
    const account = objectValue(result.account || result);
    const personKey = text(personKeyValue || account.personKey || objectValue(account.person).key);
    if (!personKey) return;
    await this.notifications.createEventForPersonKey(tenantId, personKey, {
      type: 'personal-account.changed',
      entityType: 'personal-account',
      entityId: personKey,
      context: {
        amount: account.balance ?? result.amount ?? '',
        date: new Date().toISOString().slice(0, 10),
      },
    }).catch(() => null);
  }

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
  async fundDeposit(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    const tenantId = request.auth!.tenantId;
    const result = await this.deposits.fund(tenantId, body);
    await this.notifyLoyalty(tenantId, result);
    return result;
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
  async updateDepositSettings(
    @Req() request: AuthenticatedRequest,
    @Param('depositId') depositId: string,
    @Body() body: unknown,
  ) {
    const tenantId = request.auth!.tenantId;
    const result = await this.deposits.updateSettings(tenantId, depositId, body);
    await this.notifyLoyalty(tenantId, result);
    return result;
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
  async updatePersonalAccountSettings(
    @Req() request: AuthenticatedRequest,
    @Param('personKey') personKey: string,
    @Body() body: unknown,
  ) {
    const tenantId = request.auth!.tenantId;
    const result = await this.personalAccounts.updateSettings(tenantId, personKey, body);
    await this.notifyPersonalAccount(tenantId, personKey, result);
    return result;
  }

  @Post('personal-accounts/person/:personKey/fund')
  async fundPersonalAccount(
    @Req() request: AuthenticatedRequest,
    @Param('personKey') personKey: string,
    @Body() body: unknown,
  ) {
    const tenantId = request.auth!.tenantId;
    const result = await this.personalAccounts.fund(tenantId, personKey, body);
    await this.notifyPersonalAccount(tenantId, personKey, result);
    return result;
  }

  @Post('personal-accounts/person/:personKey/withdraw')
  async withdrawPersonalAccount(
    @Req() request: AuthenticatedRequest,
    @Param('personKey') personKey: string,
    @Body() body: unknown,
  ) {
    const tenantId = request.auth!.tenantId;
    const result = await this.personalAccounts.withdraw(tenantId, personKey, body);
    await this.notifyPersonalAccount(tenantId, personKey, result);
    return result;
  }

  @Post('personal-accounts/person/:personKey/pay')
  async payFromPersonalAccount(
    @Req() request: AuthenticatedRequest,
    @Param('personKey') personKey: string,
    @Body() body: unknown,
  ) {
    const tenantId = request.auth!.tenantId;
    const result = await this.personalAccounts.pay(tenantId, personKey, body);
    await this.notifyPersonalAccount(tenantId, personKey, result);
    return result;
  }

  @Post('personal-accounts/person/:personKey/finalize-debt')
  async finalizePersonalAccountDebt(
    @Req() request: AuthenticatedRequest,
    @Param('personKey') personKey: string,
    @Body() body: unknown,
  ) {
    const tenantId = request.auth!.tenantId;
    const result = await this.personalAccounts.finalizeDebt(tenantId, personKey, body);
    await this.notifyPersonalAccount(tenantId, personKey, result);
    return result;
  }

  @Post('personal-accounts/payment/:operationId/refund')
  async refundPersonalAccountPayment(
    @Req() request: AuthenticatedRequest,
    @Param('operationId') operationId: string,
    @Body() body: unknown,
  ) {
    const tenantId = request.auth!.tenantId;
    const result = await this.personalAccounts.refundPayment(tenantId, operationId, body);
    await this.notifyPersonalAccount(tenantId, '', result);
    return result;
  }

  @Post('personal-accounts/debts/:debtId/settle')
  async settlePersonalAccountDebt(
    @Req() request: AuthenticatedRequest,
    @Param('debtId') debtId: string,
    @Body() body: unknown,
  ) {
    const tenantId = request.auth!.tenantId;
    const result = await this.personalAccounts.settleDebt(tenantId, debtId, body);
    await this.notifyPersonalAccount(tenantId, '', result);
    return result;
  }
}