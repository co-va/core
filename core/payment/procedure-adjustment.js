import {
  calculateSettlement,
  getRecordPaymentState,
  resolveRecordSettlement,
  saveSettlementSnapshot,
} from '../finance/index.js';
import { getRecord } from '../record/index.js';

const numberValue = (value) => {
  const number = Number(String(value ?? '').replace(',', '.'));
  return Number.isFinite(number) ? Math.max(0, number) : 0;
};

const percentValue = (value) => Math.max(0, Math.min(100, numberValue(value)));

function procedureItem(record, procedureId) {
  const id = String(procedureId || '');
  const settlement = resolveRecordSettlement(record);
  const item = (Array.isArray(settlement?.items) ? settlement.items : []).find((entry) =>
    String(entry?.sourceType || 'procedure') === 'procedure'
      && String(entry?.sourceId || '') === id);
  return { settlement, item: item || null };
}

export function getRecordProcedurePaymentAdjustment(record, procedureId) {
  const current = getRecord(record?.id) || record;
  const { item } = procedureItem(current, procedureId);
  if (!item) return null;
  const price = numberValue(item.price);
  const programDiscount = percentValue(item.pricePercent) > 0;
  const correctionMode = programDiscount ? 'none' : String(item.correctionMode || 'none');
  const discountPercent = programDiscount
    ? percentValue(item.pricePercent)
    : percentValue(item.correctionPercent);
  const discountMoney = programDiscount
    ? numberValue(item.pricePercentMoney)
    : numberValue(item.correctionMoney);
  return {
    sourceId: String(item.sourceId || procedureId || ''),
    price,
    programDiscount,
    programPercent: percentValue(item.pricePercent),
    correctionMode: correctionMode === 'percent' || correctionMode === 'money' ? correctionMode : 'none',
    discountPercent,
    discountMoney,
  };
}

export async function saveRecordProcedurePaymentAdjustment(record, procedureId, adjustment = {}) {
  const current = getRecord(record?.id) || record;
  if (!current?.id) return null;
  if (getRecordPaymentState(current).hasPayments) {
    throw new Error('После факта оплаты стоимость записи изменяется через корректировку оплаты.');
  }

  const id = String(procedureId || '');
  const { settlement, item: target } = procedureItem(current, id);
  if (!target || !settlement) return null;

  const price = numberValue(adjustment.price);
  const programDiscount = percentValue(target.pricePercent) > 0;
  const requestedMode = String(adjustment.correctionMode || 'none');
  const mode = programDiscount
    ? 'none'
    : requestedMode === 'percent' || requestedMode === 'money' ? requestedMode : 'none';

  const items = settlement.items.map((item) => {
    if (String(item?.sourceType || 'procedure') !== 'procedure' || String(item?.sourceId || '') !== id) return { ...item };
    return {
      ...item,
      price,
      correctionMode: mode,
      correctionPercent: mode === 'percent' ? percentValue(adjustment.discountPercent) : '',
      correctionMoney: mode === 'money' ? Math.min(price, numberValue(adjustment.discountMoney)) : '',
    };
  });
  const next = calculateSettlement(items);
  return saveSettlementSnapshot({ source: { type: 'record', id: current.id }, settlement: next });
}
