import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';

type JsonObject = Record<string, any>;

function objectValue(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {};
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function text(value: unknown) {
  return String(value ?? '').trim();
}

function money(value: unknown) {
  const parsed = Number(String(value ?? '').replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(parsed) ? Math.round(Math.max(0, parsed) * 100) / 100 : 0;
}

function json(value: unknown): Prisma.InputJsonValue {
  return clone(value) as Prisma.InputJsonValue;
}

function occurredAt(value: unknown) {
  const date = value instanceof Date ? value : new Date(text(value));
  if (!Number.isFinite(date.getTime())) throw new BadRequestException('неверная дата');
  return date;
}

@Injectable()
export class FinanceImportService {
  constructor(private readonly prisma: PrismaService) {}

  private async wallet(tenantId: string, referenceValue: unknown) {
    const reference = text(referenceValue);
    if (!reference) throw new BadRequestException('не найден кошелёк');
    const normalized = reference.toLocaleLowerCase('ru-RU');
    if (reference === 'cash' || normalized === 'наличные') return { id: 'cash', name: 'Наличные' };
    if (reference === 'cashless' || normalized === 'безналичные' || normalized === 'безнал') return { id: 'cashless', name: 'Безналичные' };
    const row = await this.prisma.businessAuxiliaryState.findUnique({ where: { tenantId } });
    const wallets = Array.isArray(objectValue(row?.data).wallets) ? objectValue(row?.data).wallets : [];
    const matches = wallets
      .map((value: unknown) => objectValue(value))
      .filter((value: JsonObject) => !text(value.deletedAt))
      .filter((value: JsonObject) => text(value.id) === reference || text(value.name).toLocaleLowerCase('ru-RU') === normalized);
    if (matches.length !== 1) throw new BadRequestException('не найден кошелёк');
    return { id: text(matches[0].id), name: text(matches[0].name) };
  }

  private async existing(tenantId: string, operationId: string) {
    return this.prisma.financeOperation.findUnique({
      where: { tenantId_operationId: { tenantId, operationId } },
      include: { ledgerEntries: true },
    });
  }

  async importRecordPayment(tenantId: string, inputValue: unknown) {
    const input = objectValue(inputValue);
    const operationId = text(input.operationId);
    const recordId = text(input.recordId);
    if (!operationId) throw new BadRequestException('У финансовой операции отсутствует id');
    if (!recordId) throw new BadRequestException('не найдена запись');
    const duplicate = await this.existing(tenantId, operationId);
    if (duplicate) return { operation: duplicate, duplicate: true };

    const record = await this.prisma.record.findUnique({ where: { tenantId_recordId: { tenantId, recordId } } });
    if (!record) throw new BadRequestException('не найдена запись');
    const settlementRow = await this.prisma.financeSettlement.findUnique({
      where: { tenantId_sourceType_sourceId: { tenantId, sourceType: 'record', sourceId: recordId } },
    });
    if (!settlementRow) throw new BadRequestException('У записи отсутствует расчёт');
    const settlement = clone(objectValue(settlementRow.data));
    const total = money(input.amount);
    const tips = Math.min(total, money(input.tips));
    const serviceAmount = money(total - tips);
    if (total <= 0) throw new BadRequestException('не распознана сумма');
    const factAt = occurredAt(input.occurredAt);
    const wallet = await this.wallet(tenantId, input.wallet);

    const existingOperations = await this.prisma.financeOperation.findMany({
      where: { tenantId, sourceType: 'record', sourceId: recordId, status: 'completed', kind: { in: ['payment', 'refund'] } },
      select: { kind: true, data: true },
    });
    const paid = money(existingOperations.reduce((sum, row) => {
      const amount = money(objectValue(row.data).serviceAmount);
      return sum + (row.kind === 'refund' ? -amount : amount);
    }, 0));
    const due = Math.max(0, money(settlement.planTotal) - paid);
    if (serviceAmount > due + 0.009) throw new BadRequestException('оплата превышает сумму записи');

    const recordData = objectValue(record.data);
    const provenance = { type: 'import', ...objectValue(input.provenance) };
    const operation = await this.prisma.$transaction(async (tx) => {
      const created = await tx.financeOperation.create({
        data: {
          tenantId,
          operationId,
          kind: 'payment',
          status: 'completed',
          sourceType: 'record',
          sourceId: recordId,
          originalOperationId: '',
          occurredAt: factAt,
          data: json({
            workplace: text(recordData.workplaceId),
            person: clone(objectValue(recordData.person)),
            allocations: [{ walletId: wallet.id, walletName: wallet.name, amount: total }],
            depositAllocations: [],
            cashTotal: total,
            cashServiceAmount: serviceAmount,
            total,
            serviceAmount,
            tips,
            settlement,
            provenance,
          }),
        },
      });
      if (serviceAmount > 0) {
        await tx.financeLedgerEntry.create({
          data: {
            tenantId,
            financeOperationId: created.id,
            entryId: `${operationId}:service`,
            walletId: wallet.id,
            direction: 'IN',
            economicType: 'SERVICE_REVENUE',
            amount: serviceAmount,
            occurredAt: factAt,
            sourceType: 'record',
            sourceId: recordId,
            data: json({ walletName: wallet.name, component: 'service', provenance }),
          },
        });
      }
      if (tips > 0) {
        await tx.financeLedgerEntry.create({
          data: {
            tenantId,
            financeOperationId: created.id,
            entryId: `${operationId}:tips`,
            walletId: wallet.id,
            direction: 'IN',
            economicType: 'TIPS',
            amount: tips,
            occurredAt: factAt,
            sourceType: 'record',
            sourceId: recordId,
            data: json({ walletName: wallet.name, component: 'tips', provenance }),
          },
        });
      }
      return created;
    });
    return { operation, duplicate: false };
  }

  async importManualOperation(tenantId: string, inputValue: unknown) {
    const input = objectValue(inputValue);
    const operationId = text(input.operationId);
    if (!operationId) throw new BadRequestException('У финансовой операции отсутствует id');
    const duplicate = await this.existing(tenantId, operationId);
    if (duplicate) return { operation: duplicate, duplicate: true };
    const direction = text(input.direction).toUpperCase();
    if (!['IN', 'OUT'].includes(direction)) throw new BadRequestException('не распознан тип финансовой операции');
    const amount = money(input.amount);
    if (amount <= 0) throw new BadRequestException('не распознана сумма');
    const articleRef = text(input.articleId || input.article);
    if (!articleRef) throw new BadRequestException('не найдена статья');
    const articles = await this.prisma.financeArticle.findMany({ where: { tenantId, archivedAt: null } });
    const article = articles.find((row) => row.articleId === articleRef)
      || articles.find((row) => row.name.toLocaleLowerCase('ru-RU') === articleRef.toLocaleLowerCase('ru-RU'));
    if (!article || article.economicType === 'GROUP' || article.direction !== direction) throw new BadRequestException('не найдена статья');
    const wallet = await this.wallet(tenantId, input.wallet);
    const factAt = occurredAt(input.occurredAt);
    const provenance = { type: 'import', ...objectValue(input.provenance) };
    const sourceType = text(input.sourceType) || 'finance';
    const sourceId = text(input.sourceId) || operationId;
    const operation = await this.prisma.$transaction(async (tx) => {
      const created = await tx.financeOperation.create({
        data: {
          tenantId,
          operationId,
          kind: direction === 'IN' ? 'manual-income' : 'manual-expense',
          status: 'completed',
          sourceType,
          sourceId,
          originalOperationId: '',
          occurredAt: factAt,
          data: json({
            direction,
            articleId: article.articleId,
            walletId: wallet.id,
            walletName: wallet.name,
            note: text(input.note),
            total: amount,
            lines: [{ lineName: text(input.name) || article.name, quantity: 1, unitPrice: amount, total: amount, articleId: article.articleId }],
            provenance,
          }),
        },
      });
      await tx.financeLedgerEntry.create({
        data: {
          tenantId,
          financeOperationId: created.id,
          entryId: `${operationId}:1`,
          walletId: wallet.id,
          direction,
          economicType: article.economicType,
          amount,
          occurredAt: factAt,
          sourceType,
          sourceId,
          data: json({
            walletName: wallet.name,
            component: 'manual',
            articleId: article.articleId,
            articleName: article.name,
            lineName: text(input.name) || article.name,
            quantity: 1,
            unitPrice: amount,
            note: text(input.note),
            provenance,
          }),
        },
      });
      return created;
    });
    return { operation, duplicate: false };
  }
}
