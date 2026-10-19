import { getRecordPaymentState } from '../finance/index.js';
import { getRecord, updateRecord } from '../record/index.js';

export function setRecordLoyaltyProgram(record = null, loyaltyProgram = null) {
  const current = getRecord(record?.id) || record;
  if (!current?.id || getRecordPaymentState(current).hasPayments) return null;
  const next = loyaltyProgram && typeof loyaltyProgram === 'object'
    ? { ...loyaltyProgram }
    : null;
  return updateRecord(current.id, { loyaltyProgram: next });
}
