import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { BusinessStateService } from '../business-state/business-state.service';
import { InventoryService } from '../inventory/inventory.service';
import type { AnalysedRow, SourceBundle, SourceRow } from './data-transfer.types';
import {
  arrayValue,
  email,
  financeFact,
  hash,
  importedPersonKey,
  inventoryFact,
  normalized,
  objectValue,
  personFact,
  personMatches,
  phone,
  pick,
  procedureFact,
  recordFact,
  recordNaturalSignature,
  rowIdentity,
  scheduleFact,
  sourceWorkplaceTargetKey,
  stableId,
  text,
  workplaceFact,
} from './data-transfer.source';

@Injectable()
export class DataTransferAnalyser {
  constructor(
    private readonly prisma: PrismaService,
    private readonly business: BusinessStateService,
    private readonly inventory: InventoryService,
  ) {}

  workplaceReference(factValue: unknown, existing: any[], sourceRows: SourceRow[]) {
    const reference = text(factValue);
    const active = existing.filter((item) => !item.deletedAt);
    const source = sourceRows.filter((row) => row.domain === 'workplace');
    if (!reference) {
      const candidates = new Set([
        ...active.map((item) => text(item.key)).filter(Boolean),
        ...source.map((row) => sourceWorkplaceTargetKey(workplaceFact(row.values), active)).filter(Boolean),
      ]);
      return candidates.size === 1 ? [...candidates][0] : '';
    }
    const key = normalized(reference);
    const candidates = new Set<string>();
    active
      .filter((item) => normalized(item.key) === key || normalized(item.name) === key)
      .forEach((item) => candidates.add(text(item.key)));
    source
      .filter((row) => {
        const fact = workplaceFact(row.values);
        return [fact.externalId, fact.key, fact.name].some((value) => normalized(value) === key);
      })
      .forEach((row) => candidates.add(sourceWorkplaceTargetKey(workplaceFact(row.values), active)));
    return candidates.size === 1 ? [...candidates][0] : '';
  }

  async analyse(tenantId: string, source: SourceBundle): Promise<AnalysedRow[]> {
    const [workplaces, businessState, operational, financeOperations, inventorySnapshot, inventoryMovements, auxiliaryRow] = await Promise.all([
      this.prisma.workplace.findMany({ where: { tenantId, deletedAt: null } }),
      this.business.get(tenantId),
      this.business.getOperational(tenantId),
      this.prisma.financeOperation.findMany({ where: { tenantId }, select: { operationId: true } }),
      this.inventory.snapshot(tenantId),
      this.prisma.inventoryMovement.findMany({ where: { tenantId }, select: { movementId: true } }),
      this.prisma.businessAuxiliaryState.findUnique({ where: { tenantId } }),
    ]);
    const financeIds = new Set(financeOperations.map((item: { operationId: string }) => item.operationId));
    const movementIds = new Set(inventoryMovements.map((item: { movementId: string }) => item.movementId));
    const people = arrayValue(businessState.people);
    const storedRecords = arrayValue(businessState.records);
    const currentProcedures = arrayValue(operational.procedures);
    const currentDays = arrayValue(operational.days);
    const wallets = Array.isArray(objectValue(auxiliaryRow?.data).wallets) ? objectValue(auxiliaryRow?.data).wallets.map(objectValue) : [];
    const sourceRecordTargets = new Map<string, string>();
    for (const sourceRow of source.rows.filter((item) => item.domain === 'record')) {
      const sourceFact = recordFact(sourceRow.values);
      if (sourceFact.externalId) sourceRecordTargets.set(sourceFact.externalId, stableId('import-record', rowIdentity('record', sourceRow.values)));
    }
    const storedRecordIds = new Set(storedRecords.map((record) => text(objectValue(record).id)).filter(Boolean));
    const sourceInventoryRows = source.rows.filter((item) => item.domain === 'inventory');
    const inventoryCandidates = (fact: ReturnType<typeof inventoryFact>) => inventorySnapshot.items.filter((item: Record<string, any>) => {
      const expectedItemId = fact.externalId ? `import-item-${hash(fact.externalId)}` : '';
      if (expectedItemId && text(item.itemId) === expectedItemId) return true;
      if (fact.sku && normalized(item.sku) === normalized(fact.sku)) return true;
      if (fact.barcode && normalized(item.barcode) === normalized(fact.barcode)) return true;
      return normalized(item.manufacturer) === normalized(fact.manufacturer)
        && normalized(item.name) === normalized(fact.name)
        && normalized(item.unit) === normalized(fact.unit);
    });
    const sourceHasInventoryItem = (fact: ReturnType<typeof inventoryFact>) => sourceInventoryRows.some((candidate) => {
      const sourceFact = inventoryFact(candidate.values, false);
      if (fact.externalId && sourceFact.externalId === fact.externalId) return true;
      if (fact.sku && sourceFact.sku && normalized(sourceFact.sku) === normalized(fact.sku)) return true;
      if (fact.barcode && sourceFact.barcode && normalized(sourceFact.barcode) === normalized(fact.barcode)) return true;
      return normalized(sourceFact.manufacturer) === normalized(fact.manufacturer)
        && normalized(sourceFact.name) === normalized(fact.name)
        && normalized(sourceFact.unit) === normalized(fact.unit);
    });
    const duplicateKeys = new Set<string>();
    const seenKeys = new Set<string>();
    for (const row of source.rows) {
      if (seenKeys.has(row.importKey)) duplicateKeys.add(row.importKey);
      else seenKeys.add(row.importKey);
    }

    return Promise.all(source.rows.map(async (row) => {
      if (duplicateKeys.has(row.importKey) && source.rows.find((item) => item.importKey === row.importKey) !== row) {
        return { ...row, status: 'duplicate' as const };
      }
      if (row.domain === 'workplace') {
        const fact = workplaceFact(row.values);
        if (!fact.name && !fact.key) return { ...row, status: 'error', reason: 'не распознано рабочее пространство' };
        const ref = normalized(fact.key || fact.externalId || fact.name);
        const existing = workplaces.filter((item: { key: string; name: string }) => [item.key, item.name].some((value) => normalized(value) === ref));
        return { ...row, status: existing.length ? 'duplicate' : 'ready' };
      }
      if (row.domain === 'person') {
        const fact = personFact(row.values);
        if (!fact.name && !fact.surname && !fact.phone && !fact.email) return { ...row, status: 'error', reason: 'не распознан человек' };
        const exactKey = fact.externalId ? importedPersonKey(fact) : '';
        const exact = exactKey ? people.find((person) => text(objectValue(person).key) === exactKey) : null;
        const matches = exact ? [exact] : people.filter((person) => personMatches(person, fact));
        if (matches.length > 1) return { ...row, status: 'error', reason: 'неоднозначно найден человек' };
        return { ...row, status: matches.length === 1 ? 'duplicate' : 'ready' };
      }
      if (row.domain === 'schedule') {
        const fact = scheduleFact(row.values);
        if (!fact.date) return { ...row, status: 'error', reason: 'неверная дата' };
        if (!fact.from || !fact.to || fact.from >= fact.to) return { ...row, status: 'error', reason: 'неверное рабочее время' };
        const workplace = this.workplaceReference(fact.workplace, workplaces, source.rows);
        if (!workplace) return { ...row, status: 'error', reason: 'не найдено рабочее пространство' };
        const existing = currentDays.find((day) => text(day.workplaceId) === workplace && text(day.date).slice(0, 10) === fact.date && text(day.from) === fact.from && text(day.to) === fact.to);
        return { ...row, status: existing ? 'duplicate' : 'ready' };
      }
      if (row.domain === 'procedure' || row.domain === 'procedure-history') {
        const fact = procedureFact(row.values, row.domain === 'procedure-history');
        if (!fact.name && !fact.externalId) return { ...row, status: 'error', reason: 'не найдена процедура' };
        if (fact.price == null && pick(row.values, ['цена', 'стоимость', 'price', 'cost']) !== '') return { ...row, status: 'error', reason: 'не распознана сумма' };
        if (row.domain === 'procedure-history' && !fact.effectiveAt) return { ...row, status: 'error', reason: 'неверная дата' };
        const workplace = this.workplaceReference(fact.workplace, workplaces, source.rows);
        if (!workplace) return { ...row, status: 'error', reason: 'не найдено рабочее пространство' };
        if (row.domain === 'procedure-history') {
          const procedureId = fact.externalId || stableId('procedure', [normalized(fact.name), workplace]);
          const eventId = stableId('procedure-history', [procedureId, fact.effectiveAt, fact.price, fact.duration, workplace]);
          const duplicate = await this.prisma.$queryRaw<Array<{ eventId: string }>>`
            SELECT "eventId" FROM "BusinessHistoryEvent"
            WHERE "tenantId" = ${tenantId} AND "eventId" = ${eventId} LIMIT 1
          `;
          return { ...row, status: duplicate.length ? 'duplicate' : 'ready' };
        }
        const procedureId = fact.externalId || stableId('procedure', [normalized(fact.name), workplace]);
        const existing = currentProcedures.find((item) => text(item.id) === procedureId);
        return { ...row, status: existing ? 'duplicate' : 'ready' };
      }
      if (row.domain === 'record') {
        const fact = recordFact(row.values);
        if (!fact.date) return { ...row, status: 'error', reason: 'неверная дата' };
        if (!fact.from) return { ...row, status: 'error', reason: 'неверное время' };
        if (fact.price == null && pick(row.values, ['цена', 'стоимость', 'сумма', 'price', 'cost', 'total']) !== '') return { ...row, status: 'error', reason: 'не распознана сумма' };
        const workplace = this.workplaceReference(fact.workplace, workplaces, source.rows);
        if (!workplace) return { ...row, status: 'error', reason: 'не найдено рабочее пространство' };
        const embeddedPerson = personFact({
          имя: fact.personName,
          фамилия: fact.personSurname,
          телефон: fact.personPhone,
          email: fact.personEmail,
        });
        const sourcePerson = fact.personExternalId
          ? source.rows.find((candidate) => candidate.domain === 'person' && personFact(candidate.values).externalId === fact.personExternalId)
          : null;
        const resolvedPersonFact = sourcePerson ? personFact(sourcePerson.values) : embeddedPerson;
        const exactPersonKey = fact.personExternalId ? importedPersonKey(resolvedPersonFact) : '';
        const exactPerson = exactPersonKey ? people.find((person) => text(objectValue(person).key) === exactPersonKey) : null;
        const matches = exactPerson ? [exactPerson] : people.filter((person) => personMatches(person, resolvedPersonFact));
        if (matches.length > 1) return { ...row, status: 'error', reason: 'неоднозначно найден человек' };
        if (!matches.length && !text(resolvedPersonFact.name) && !text(resolvedPersonFact.surname) && !phone(resolvedPersonFact.phone) && !email(resolvedPersonFact.email)) {
          return { ...row, status: 'error', reason: 'не найден человек' };
        }
        const recordId = stableId('import-record', rowIdentity('record', row.values));
        const exact = storedRecords.find((record) => text(record.id) === recordId);
        if (exact) return { ...row, status: 'duplicate' };
        const signature = JSON.stringify([
          fact.date, fact.from, fact.to, workplace, fact.personPhone, fact.personEmail,
          normalized(`${fact.personName} ${fact.personSurname}`), normalized(fact.procedureName),
        ]);
        const natural = storedRecords.some((record) => recordNaturalSignature(record) === signature);
        return { ...row, status: natural ? 'duplicate' : 'ready' };
      }
      if (row.domain === 'finance') {
        const fact = financeFact(row.values);
        if (!fact.occurredAt) return { ...row, status: 'error', reason: 'неверная дата' };
        if (fact.amount == null || fact.amount <= 0) return { ...row, status: 'error', reason: 'не распознана сумма' };
        if (!fact.wallet) return { ...row, status: 'error', reason: 'не найден кошелёк' };
        const operationId = stableId('import-finance', rowIdentity('finance', row.values));
        if (financeIds.has(operationId)) return { ...row, status: 'duplicate' };
        const walletKey = normalized(fact.wallet);
        const walletMatches = ['cash', 'наличные', 'cashless', 'безналичные', 'безнал'].includes(walletKey)
          ? 1
          : wallets.filter((wallet: Record<string, any>) => !text(wallet.deletedAt)
            && (normalized(wallet.id) === walletKey || normalized(wallet.name) === walletKey)).length;
        if (walletMatches !== 1) return { ...row, status: 'error', reason: 'не найден кошелёк' };
        const isPayment = /оплат|payment/.test(fact.kind);
        if (isPayment) {
          if (!fact.recordRef) return { ...row, status: 'error', reason: 'не найдена запись' };
          const targetRecordId = sourceRecordTargets.get(fact.recordRef) || fact.recordRef;
          const sourceHasRecord = [...sourceRecordTargets.values()].includes(targetRecordId);
          if (!sourceHasRecord && !storedRecordIds.has(targetRecordId)) return { ...row, status: 'error', reason: 'не найдена запись' };
        }
        if (!isPayment && !fact.article) return { ...row, status: 'error', reason: 'не найдена статья' };
        return { ...row, status: 'ready' };
      }
      if (row.domain === 'inventory' || row.domain === 'inventory-movement') {
        const fact = inventoryFact(row.values, row.domain === 'inventory-movement');
        if (!fact.name && !fact.sku && !fact.barcode) return { ...row, status: 'error', reason: 'не найдена позиция склада' };
        if (fact.quantity == null || fact.quantity < 0) return { ...row, status: 'error', reason: 'не распознано количество' };
        if (fact.price == null && pick(row.values, ['цена', 'себестоимость', 'фактическая цена закупки', 'price', 'unit cost']) !== '') return { ...row, status: 'error', reason: 'не распознана сумма' };
        if (row.domain === 'inventory-movement') {
          if (!fact.occurredAt) return { ...row, status: 'error', reason: 'неверная дата' };
          if (!['RECEIPT', 'CONSUMPTION', 'WRITE_OFF', 'SALE', 'RETURN', 'ADJUSTMENT', 'CORRECTION'].includes(fact.kind)) {
            return { ...row, status: 'error', reason: 'не распознан тип складского движения' };
          }
          const movementId = stableId('import-inventory-movement', rowIdentity(row.domain, row.values));
          if (movementIds.has(movementId)) return { ...row, status: 'duplicate' };
          const matches = inventoryCandidates(fact);
          if (matches.length > 1) return { ...row, status: 'error', reason: 'неоднозначно найдена позиция склада' };
          if (!matches.length && !sourceHasInventoryItem(fact)) return { ...row, status: 'error', reason: 'не найдена позиция склада' };
          return { ...row, status: 'ready' };
        }
        const matches = inventoryCandidates(fact);
        if (matches.length > 1) return { ...row, status: 'error', reason: 'неоднозначно найдена позиция склада' };
        if (matches.length === 1 && Math.abs(Number(matches[0].balance || 0) - Number(fact.quantity || 0)) < 0.000001) return { ...row, status: 'duplicate' };
        return { ...row, status: 'ready' };
      }
      return { ...row, status: 'error', reason: 'не удалось распознать строку' };
    }));
  }
}
