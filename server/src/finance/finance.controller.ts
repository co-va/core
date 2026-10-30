import { Body, Controller, Delete, Get, Param, Post, Put, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { NotificationEventService } from '../notification/notification-event.service';
import { PrismaService } from '../prisma.service';
import { FinanceService } from './finance.service';
import { PaymentSettlementService } from './payment-settlement.service';

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

@Controller('finance')
@UseGuards(JwtAuthGuard)
export class FinanceController {
  constructor(
    private readonly finance: FinanceService,
    private readonly payments: PaymentSettlementService,
    private readonly notifications: NotificationEventService,
    private readonly prisma: PrismaService,
  ) {}

  private async notifyPerson(tenantId: string, personValue: unknown, type: string, entityId: string, context: JsonObject = {}) {
    const person = objectValue(personValue);
    if (!text(person.key) && !text(person.phone) && !text(person.accountId) && !Array.isArray(person.accounts)) return;
    await this.notifications.createEventForPerson(tenantId, person, {
      type,
      entityType: 'finance-operation',
      entityId,
      context,
    }).catch(() => null);
  }

  @Get()
  get(@Req() request: AuthenticatedRequest) {
    return this.finance.snapshot(request.auth!.tenantId);
  }

  @Put('settlements/:sourceType/:sourceId')
  saveSettlement(
    @Req() request: AuthenticatedRequest,
    @Param('sourceType') sourceType: string,
    @Param('sourceId') sourceId: string,
    @Body() body: unknown,
  ) {
    const source = objectValue(body);
    return this.finance.saveSettlement(request.auth!.tenantId, sourceType, sourceId, source.settlement ?? source);
  }

  @Get('articles')
  articles(@Req() request: AuthenticatedRequest) {
    return this.finance.listArticles(request.auth!.tenantId);
  }

  @Post('articles')
  createArticle(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    return this.finance.createArticle(request.auth!.tenantId, body);
  }

  @Put('articles/:articleId')
  updateArticle(
    @Req() request: AuthenticatedRequest,
    @Param('articleId') articleId: string,
    @Body() body: unknown,
  ) {
    return this.finance.updateArticle(request.auth!.tenantId, articleId, body);
  }

  @Delete('articles/:articleId')
  archiveArticle(
    @Req() request: AuthenticatedRequest,
    @Param('articleId') articleId: string,
  ) {
    return this.finance.archiveArticle(request.auth!.tenantId, articleId);
  }

  @Delete('wallets/:walletId/hard')
  hardDeleteWallet(
    @Req() request: AuthenticatedRequest,
    @Param('walletId') walletId: string,
  ) {
    return this.finance.hardDeleteWallet(
      request.auth!.tenantId,
      request.auth!.platformAccountId,
      walletId,
    );
  }

  @Post('operations/manual')
  manual(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    return this.finance.recordManualOperation(request.auth!.tenantId, body);
  }

  @Post('operations/special')
  special(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    return this.finance.recordSpecialOperation(request.auth!.tenantId, body);
  }

  @Post('operations/payment')
  async payment(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    const tenantId = request.auth!.tenantId;
    const input = objectValue(body);
    const result = await this.payments.recordPayment(tenantId, body);
    const operation = objectValue(objectValue(result).financePatch?.operation);
    const data = objectValue(operation.data);
    const person = objectValue(data.person || input.person);
    const operationId = text(operation.operationId);
    await this.notifyPerson(tenantId, person, 'finance.payment', operationId, {
      amount: data.total ?? input.serviceAmount,
      date: text(operation.occurredAt).slice(0, 10),
    });
    if (Number(data.personalAccountAmount || 0) > 0 || input.finalizeDebt === true) {
      await this.notifyPerson(tenantId, person, 'personal-account.changed', operationId, {
        amount: data.personalAccountAmount ?? data.total,
        date: text(operation.occurredAt).slice(0, 10),
      });
    }
    return result;
  }

  @Post('operations/:operationId/refund')
  async refund(
    @Req() request: AuthenticatedRequest,
    @Param('operationId') operationId: string,
    @Body() body: unknown,
  ) {
    const tenantId = request.auth!.tenantId;
    const payment = await this.prisma.financeOperation.findUnique({ where: { tenantId_operationId: { tenantId, operationId } } });
    const paymentData = objectValue(payment?.data);
    const result = await this.payments.recordRefund(tenantId, operationId, body);
    const input = objectValue(body);
    const person = objectValue(paymentData.person);
    await this.notifyPerson(tenantId, person, 'finance.refund', operationId, {
      amount: input.amount ?? paymentData.total,
      date: text(input.occurredAt).slice(0, 10),
    });
    if (Number(paymentData.personalAccountAmount || 0) > 0 || input.finalizeDebt === true) {
      await this.notifyPerson(tenantId, person, 'personal-account.changed', operationId, {
        amount: input.amount ?? paymentData.personalAccountAmount,
        date: text(input.occurredAt).slice(0, 10),
      });
    }
    return result;
  }

  @Put('operations/:operationId')
  correctOperation(
    @Req() request: AuthenticatedRequest,
    @Param('operationId') operationId: string,
    @Body() body: unknown,
  ) {
    return this.finance.correctOperation(request.auth!.tenantId, operationId, body);
  }

  @Delete('operations/:operationId/hard')
  hardDeleteOperation(
    @Req() request: AuthenticatedRequest,
    @Param('operationId') operationId: string,
  ) {
    return this.finance.hardDeleteOperation(request.auth!.tenantId, operationId);
  }

  @Post('operations/:operationId/cancel')
  cancel(
    @Req() request: AuthenticatedRequest,
    @Param('operationId') operationId: string,
    @Body() body: unknown,
  ) {
    return this.finance.cancelOperation(request.auth!.tenantId, operationId, body);
  }
}