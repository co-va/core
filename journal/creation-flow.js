import { openRecordCreationOwner } from '../ui/ui.js';
import { openRecords } from '../core/records/records.js';
import { loadOperationalState } from '../core/runtime/operational-state.js';

export async function openJournalCreation({
  date = '',
  workplaceId = '',
  timeHint = '',
  surfaceRoot = null,
  bodyRoot = null,
  onCreated = () => {},
} = {}) {
  await loadOperationalState({ full: true });
  const owner = openRecordCreationOwner({
    surfaceRoot,
    bodyRoot,
  });
  if (!owner) return null;

  openRecords({
    context: 'journal',
    workplaceId,
    date,
    timeHint,
    creationOwner: owner,
    onCreated,
  });
  return owner;
}
