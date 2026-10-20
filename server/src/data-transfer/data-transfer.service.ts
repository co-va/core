import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { ProfileService } from '../profile/profile.service';
import { BusinessStateService } from '../business-state/business-state.service';
import { RecordImportService } from '../record/record-import.service';
import { FinanceImportService } from '../finance/finance-import.service';
import { FinanceService } from '../finance/finance.service';
import { InventoryService } from '../inventory/inventory.service';
import { HistoryImportService } from '../history/history-import.service';
import { DataTransferAnalyser } from './data-transfer.analyser';
import type { AnalysedRow, Domain, SourceBundle, SourceRow } from './data-transfer.types';
import {
  arrayValue,
  clone,
  email,
  financeFact,
  hash,
  importedPersonKey,
  importedWorkplaceKey,
  inventoryFact,
  normalized,
  objectValue,
  parseSource,
  personFact,
  personMatches,
  phone,
  procedureFact,
  recordFact,
  rowIdentity,
  scheduleFact,
  sourceWorkplaceTargetKey,
  stableId,
  text,
  workplaceFact,
} from './data-transfer.source';

function summary(source: SourceBundle, analysed: AnalysedRow[]) {
  const ready = analysed.filter((row) => row.status === 'ready').length;
  const duplicates = analysed.filter((row) => row.status === 'duplicate').length;
  const issues = analysed.filter((row) => row.status === 'error').map((row) => ({
    sheet: row.sheet,
    row: row.row,
    reason: row.reason || 'ошибка',
  }));
  return {
    ready,
    errors: issues.length,
    duplicates,
    issues,
    domains: [...new Set(analysed.map((row) => row.domain))],
    ignoredSheets: source.ignoredSheets,
  };
}

@Injectable()
export class DataTransferService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly profiles: ProfileService,
    private readonly business: BusinessStateService,
    private readonly records: RecordImportService,
    private readonly financeImport: FinanceImportService,
    private readonly finance: FinanceService,
    private readonly inventory: InventoryService,
    private readonly history: HistoryImportService,
    private readonly analyser: DataTransferAnalyser,
  ) {}

  async check(tenantId: string, bodyValue: unknown) {
    const body = objectValue(bodyValue);
    const source = await parseSource(body.fileName, body.dataUrl);
    const analysed = await this.analyser.analyse(tenantId, source);
    return summary(source, analysed);
  }

  private provenance(source: SourceBundle, row: SourceRow) {
    return { importKey: row.importKey, fileName: source.fileName, sheet: row.sheet, row: row.row };
  }

  private async activeWorkplaces(tenantId: string) {
    return this.prisma.workplace.findMany({ where: { tenantId, deletedAt: null }, orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] });
  }

  private resolveCurrentWorkplace(referenceValue: unknown, workplaces: any[], sourceRows: SourceRow[] = []) {
    const reference = text(referenceValue);
    if (!reference) return workplaces.length === 1 ? workplaces[0] : null;
    const key = normalized(reference);
    const matches = workplaces.filter((item) => normalized(item.key) === key || normalized(item.name) === key);
    if (matches.length === 1) return matches[0];
    if (matches.length > 1) return null;
    const sourceMatches = sourceRows.filter((row) => row.domain === 'workplace').filter((row) => {
      const fact = workplaceFact(row.values);
      return [fact.externalId, fact.key, fact.name].some((value) => normalized(value) === key);
    });
    if (sourceMatches.length !== 1) return null;
    const expectedKey = sourceWorkplaceTargetKey(workplaceFact(sourceMatches[0].values), workplaces);
    return workplaces.find((item) => text(item.key) === expectedKey) || null;
  }

  private async applyWorkplace(tenantId: string, platformAccountId: string, source: SourceBundle, row: SourceRow) {
    const fact = workplaceFact(row.values);
    const key = importedWorkplaceKey(fact);
    await this.profiles.upsertWorkplace(tenantId, platformAccountId, key, {
      name: fact.name || key,
      city: fact.city,
      address: fact.address,
      phone: fact.phone,
      ...(fact.currency ? { currency: fact.currency } : {}),
      ...(fact.timeZone ? { timeZone: fact.timeZone } : {}),
      ...(fact.from ? { from: fact.from } : {}),
      ...(fact.to ? { to: fact.to } : {}),
    });
    await this.history.markProvenance(tenantId, 'workplace', key, this.provenance(source, row));
    return key;
  }

  private async applyPerson(tenantId: string, source: SourceBundle, row: SourceRow, fact = personFact(row.values)) {
    const key = importedPersonKey(fact);
    const person = {
      key,
      name: fact.name,
      surname: fact.surname,
      phones: fact.phone ? [fact.phone] : [],
      emails: fact.email ? [fact.email] : [],
      telegrams: [],
      accounts: [],
      links: [],
      tags: [],
      provenance: this.provenance(source, row),
    };
    await this.business.upsertPerson(tenantId, key, { person, position: 0 });
    await this.history.markProvenance(tenantId, 'person', key, this.provenance(source, row));
    return person;
  }

  private async ensureRecordPerson(tenantId: string, source: SourceBundle, row: SourceRow, fact: ReturnType<typeof recordFact>) {
    const state = await this.business.get(tenantId);
    const embedded = {
      externalId: fact.personExternalId,
      name: fact.personName,
      surname: fact.personSurname,
      phone: fact.personPhone,
      email: fact.personEmail,
    };
    const sourcePerson = embedded.externalId
      ? source.rows.find((candidate) => candidate.domain === 'person' && personFact(candidate.values).externalId === embedded.externalId)
      : null;
    const resolvedFact = sourcePerson ? personFact(sourcePerson.values) : embedded;
    if (embedded.externalId) {
      const expectedKey = importedPersonKey(resolvedFact);
      const exact = arrayValue(state.people).find((person) => text(objectValue(person).key) === expectedKey);
      if (exact) return clone(exact);
    }
    const matches = arrayValue(state.people).filter((person) => personMatches(person, resolvedFact));
    if (matches.length === 1) return clone(matches[0]);
    if (matches.length > 1) throw new BadRequestException('неоднозначно найден человек');
    if (!text(resolvedFact.name) && !text(resolvedFact.surname) && !phone(resolvedFact.phone) && !email(resolvedFact.email)) {
      throw new BadRequestException('не найден человек');
    }
    return this.applyPerson(tenantId, source, sourcePerson || row, resolvedFact as ReturnType<typeof personFact>);
  }

  private async applySchedule(tenantId: string, source: SourceBundle, row: SourceRow) {
    const fact = scheduleFact(row.values);
    const workplaces = await this.activeWorkplaces(tenantId);
    const workplace = this.resolveCurrentWorkplace(fact.workplace, workplaces, source.rows);
    if (!workplace) throw new BadRequestException('не найдено рабочее пространство');
    const operational = await this.business.getOperational(tenantId);
    const days = arrayValue(operational.days).filter((day) => !(text(day.workplaceId) === workplace.key && text(day.date).slice(0, 10) === fact.date));
    days.push({ date: fact.date, workplaceId: workplace.key, from: fact.from, to: fact.to, provenance: this.provenance(source, row) });
    await this.business.updateOperationalDataset(tenantId, 'days', { value: days });
  }

  private procedureSnapshot(fact: ReturnType<typeof procedureFact>, workplaceKey: string, procedureId: string, provenance: Record<string, any>) {
    const cost = fact.price == null ? { mode: 'amount', amount: '', free: false } : { mode: 'amount', amount: fact.price, free: false };
    return {
      id: procedureId,
      photo: '',
      name: fact.name || procedureId,
      description: '',
      duration: fact.duration,
      breakDuration: 0,
      cost,
      groupBooking: { enabled: false, capacity: 2 },
      workplaces: [{ workplaceId: workplaceKey, cost }],
      provenance,
    };
  }

  private async applyProcedure(tenantId: string, source: SourceBundle, row: SourceRow) {
    const historical = row.domain === 'procedure-history';
    const fact = procedureFact(row.values, historical);
    const workplaces = await this.activeWorkplaces(tenantId);
    const workplace = this.resolveCurrentWorkplace(fact.workplace, workplaces, source.rows);
    if (!workplace) throw new BadRequestException('не найдено рабочее пространство');
    const procedureId = fact.externalId || stableId('procedure', [normalized(fact.name), workplace.key]);
    const provenance = this.provenance(source, row);
    const snapshot = this.procedureSnapshot(fact, workplace.key, procedureId, provenance);
    if (historical || fact.effectiveAt) {
      const eventId = stableId('procedure-history', [procedureId, fact.effectiveAt, fact.price, fact.duration, workplace.key]);
      await this.history.recordProcedureSnapshot(tenantId, { procedureId, eventId, effectiveAt: fact.effectiveAt, snapshot, provenance });
      return procedureId;
    }
    const operational = await this.business.getOperational(tenantId);
    const procedures = arrayValue(operational.procedures).filter((item) => text(item.id) !== procedureId);
    const now = new Date().toISOString();
    procedures.push({ ...snapshot, createdAt: now, updatedAt: now });
    await this.business.updateOperationalDataset(tenantId, 'procedures', { value: procedures });
    await this.history.markProvenance(tenantId, 'procedure', procedureId, provenance);
    return procedureId;
  }

  private statusEventType(status: string) {
    if (/отмен|cancel/.test(status)) return 'cancelled';
    if (/не приш|no show|no-show/.test(status)) return 'no-show';
    if (/пришел|пришёл|arrived|completed|заверш/.test(status)) return 'arrived';
    if (/подтверж|confirm/.test(status)) return 'confirmed';
    return '';
  }

  private async applyRecord(tenantId: string, source: SourceBundle, row: SourceRow) {
    const fact = recordFact(row.values);
    const workplaces = await this.activeWorkplaces(tenantId);
    const workplace = this.resolveCurrentWorkplace(fact.workplace, workplaces, source.rows);
    if (!workplace) throw new BadRequestException('не найдено рабочее пространство');
    const person = await this.ensureRecordPerson(tenantId, source, row, fact);
    const recordId = stableId('import-record', rowIdentity('record', row.values));
    const procedureId = fact.procedureId || (fact.procedureName ? stableId('record-procedure', [recordId, fact.procedureName]) : '');
    const procedures = fact.procedureName || procedureId ? [{
      id: procedureId,
      name: fact.procedureName || procedureId,
      duration: fact.duration,
      cost: fact.price == null ? '' : fact.price,
      priceKnown: fact.price != null,
      groupBooking: { enabled: false, capacity: 1 },
    }] : [];
    const provenance = {
      ...this.provenance(source, row),
      ...(fact.status && !fact.statusAt ? { sourceStatus: fact.status } : {}),
    };
    const result = await this.records.importHistorical(tenantId, {
      id: recordId,
      date: fact.date,
      workplaceId: workplace.key,
      from: fact.from,
      to: fact.to,
      person,
      procedures,
      products: [],
      createdAt: fact.createdAt,
      provenance,
    });
    await this.history.markProvenance(tenantId, 'record', recordId, provenance);
    if (result.settlementCreated) await this.history.markProvenance(tenantId, 'finance-settlement', `record:${recordId}`, provenance);
    if (result.createdEventId) await this.history.markProvenance(tenantId, 'record-event', result.createdEventId, provenance);

    const eventType = this.statusEventType(fact.status);
    if (eventType && fact.statusAt) {
      const eventId = stableId('record-event', [recordId, eventType, fact.statusAt]);
      const event = {
        id: eventId,
        recordId,
        type: eventType,
        category: 'action',
        at: fact.statusAt,
        source: 'import',
        actor: {},
        subject: {
          personId: text(person.id), personKey: text(person.key), name: text(person.name), surname: text(person.surname),
        },
        payload: { appointment: { date: fact.date, workplaceId: workplace.key, from: fact.from, to: fact.to } },
        provenance,
      };
      await this.business.upsertRecordEvent(tenantId, eventId, { event, position: 1 });
      await this.history.markProvenance(tenantId, 'record-event', eventId, provenance);
    }
    return result;
  }

  private sourceRecordId(referenceValue: unknown, source: SourceBundle) {
    const reference = text(referenceValue);
    if (!reference) return '';
    const sourceRow = source.rows.find((row) => row.domain === 'record' && recordFact(row.values).externalId === reference);
    return sourceRow ? stableId('import-record', rowIdentity('record', sourceRow.values)) : reference;
  }

  private async applyFinance(tenantId: string, source: SourceBundle, row: SourceRow) {
    const fact = financeFact(row.values);
    const operationId = stableId('import-finance', rowIdentity('finance', row.values));
    const provenance = this.provenance(source, row);
    if (/оплат|payment/.test(fact.kind)) {
      const result = await this.financeImport.importRecordPayment(tenantId, {
        operationId,
        recordId: this.sourceRecordId(fact.recordRef, source),
        amount: fact.amount,
        tips: fact.tips,
        occurredAt: fact.occurredAt,
        wallet: fact.wallet,
        provenance,
      });
      await this.history.markProvenance(tenantId, 'finance-operation', operationId, provenance);
      return result;
    }
    await this.finance.listArticles(tenantId);
    const result = await this.financeImport.importManualOperation(tenantId, {
      operationId,
      direction: fact.direction,
      amount: fact.amount,
      occurredAt: fact.occurredAt,
      wallet: fact.wallet,
      article: fact.article,
      note: fact.note,
      provenance,
    });
    await this.history.markProvenance(tenantId, 'finance-operation', operationId, provenance);
    return result;
  }

  private inventoryMatch(items: Record<string, any>[], fact: ReturnType<typeof inventoryFact>) {
    const expectedItemId = fact.externalId ? `import-item-${hash(fact.externalId)}` : '';
    const matches = items.filter((item) => {
      if (expectedItemId && text(item.itemId) === expectedItemId) return true;
      if (fact.sku && normalized(item.sku) === normalized(fact.sku)) return true;
      if (fact.barcode && normalized(item.barcode) === normalized(fact.barcode)) return true;
      return normalized(item.manufacturer) === normalized(fact.manufacturer)
        && normalized(item.name) === normalized(fact.name)
        && normalized(item.unit) === normalized(fact.unit);
    });
    if (matches.length > 1) throw new BadRequestException('неоднозначно найдена позиция склада');
    return matches[0] || null;
  }

  private async applyInventory(tenantId: string, source: SourceBundle, row: SourceRow) {
    const movement = row.domain === 'inventory-movement';
    const fact = inventoryFact(row.values, movement);
    let snapshot = await this.inventory.snapshot(tenantId);
    let item = this.inventoryMatch(snapshot.items, fact);
    const provenance = this.provenance(source, row);
    if (!item && movement) throw new BadRequestException('не найдена позиция склада');
    if (!item) {
      const itemId = fact.externalId ? `import-item-${hash(fact.externalId)}` : `import-item-${hash([fact.sku, fact.barcode, fact.manufacturer, fact.name, fact.unit])}`;
      await this.inventory.createItem(tenantId, {
        itemId,
        name: fact.name || itemId,
        manufacturer: fact.manufacturer,
        unit: fact.unit,
        sku: fact.sku,
        barcode: fact.barcode,
        location: fact.location,
        quantity: 0,
        purchasePrice: fact.price,
      });
      await this.history.markProvenance(tenantId, 'inventory-item', itemId, provenance);
      snapshot = await this.inventory.snapshot(tenantId);
      item = snapshot.items.find((value: Record<string, any>) => text(value.itemId) === itemId) || null;
    }
    if (!item) throw new BadRequestException('не найдена позиция склада');

    if (movement) {
      const movementId = stableId('import-inventory-movement', rowIdentity(row.domain, row.values));
      const existing = await this.prisma.inventoryMovement.findFirst({ where: { tenantId, movementId } });
      if (existing) return { duplicate: true };
      await this.inventory.createMovement(tenantId, {
        movementId,
        kind: fact.kind,
        sourceType: 'inventory-item',
        sourceId: item.itemId,
        occurredAt: fact.occurredAt,
        workplaceKey: fact.workplace,
        recordId: this.sourceRecordId(fact.recordRef, source),
        note: fact.note,
        lines: [{ itemId: item.itemId, quantity: fact.quantity, unitCost: fact.price }],
      });
      await this.history.markProvenance(tenantId, 'inventory-movement', movementId, provenance);
      return { duplicate: false };
    }

    const currentBalance = Number(item.balance || 0);
    const desired = Number(fact.quantity || 0);
    const difference = desired - currentBalance;
    if (Math.abs(difference) < 0.000001) return { duplicate: true };
    const movementId = stableId('import-inventory-balance', [row.importKey, desired]);
    const existing = await this.prisma.inventoryMovement.findFirst({ where: { tenantId, movementId } });
    if (existing) return { duplicate: true };
    await this.inventory.createMovement(tenantId, {
      movementId,
      kind: 'ADJUSTMENT',
      sourceType: 'inventory-item',
      sourceId: item.itemId,
      occurredAt: fact.occurredAt || new Date().toISOString(),
      note: 'Перенос данных',
      lines: [{ itemId: item.itemId, quantity: difference, unitCost: difference > 0 ? fact.price : null }],
    });
    await this.history.markProvenance(tenantId, 'inventory-movement', movementId, provenance);
    return { duplicate: false };
  }

  async apply(tenantId: string, platformAccountId: string, bodyValue: unknown) {
    const body = objectValue(bodyValue);
    const source = await parseSource(body.fileName, body.dataUrl);
    const analysed = await this.analyser.analyse(tenantId, source);
    const ready = analysed.filter((row) => row.status === 'ready');
    const issues = analysed.filter((row) => row.status === 'error').map((row) => ({ sheet: row.sheet, row: row.row, reason: row.reason || 'ошибка' }));
    let transferred = 0;
    let duplicates = analysed.filter((row) => row.status === 'duplicate').length;
    const order: Domain[] = ['workplace', 'person', 'schedule', 'procedure-history', 'procedure', 'record', 'finance', 'inventory', 'inventory-movement'];

    for (const domain of order) {
      for (const row of ready.filter((item) => item.domain === domain)) {
        try {
          let result: unknown = null;
          if (domain === 'workplace') result = await this.applyWorkplace(tenantId, platformAccountId, source, row);
          else if (domain === 'person') result = await this.applyPerson(tenantId, source, row);
          else if (domain === 'schedule') result = await this.applySchedule(tenantId, source, row);
          else if (domain === 'procedure' || domain === 'procedure-history') result = await this.applyProcedure(tenantId, source, row);
          else if (domain === 'record') result = await this.applyRecord(tenantId, source, row);
          else if (domain === 'finance') result = await this.applyFinance(tenantId, source, row);
          else result = await this.applyInventory(tenantId, source, row);
          if (objectValue(result).duplicate === true) duplicates += 1;
          else transferred += 1;
        } catch (error) {
          const message = error instanceof Error ? error.message : text(error);
          issues.push({ sheet: row.sheet, row: row.row, reason: message || 'ошибка' });
        }
      }
    }

    return {
      ready: transferred,
      errors: issues.length,
      duplicates,
      issues,
      domains: [...new Set(analysed.map((row) => row.domain))],
      ignoredSheets: source.ignoredSheets,
    };
  }
}
