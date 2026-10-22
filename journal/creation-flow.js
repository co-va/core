import { initViewNavigation, openRecordCreationOwner, viewNavigation } from '../ui/ui.js';
import { openRecords } from '../core/records/records.js';
import { createJournalEventFlow } from './event-create.js';

const JOURNAL_CREATE_MODES = [
  { id: 'record', label: 'Запись' },
  { id: 'event', label: 'Событие' },
];

export function openJournalCreation({
  date = '',
  workplaceId = '',
  timeHint = '',
  surfaceRoot = null,
  bodyRoot = null,
  onCreated = () => {},
  onCancel = () => {},
} = {}) {
  const owner = openRecordCreationOwner({ onCancel, surfaceRoot, bodyRoot });
  if (!owner) return null;

  const context = { date, workplaceId, timeHint };
  let activeMode = 'record';
  let recordFlow = null;
  let eventFlow = null;

  const renderModeSwitch = () => {
    const host = owner.setShellHeader(viewNavigation({
      views: JOURNAL_CREATE_MODES,
      activeView: activeMode,
      className: 'segment-control--two',
      ariaLabel: 'Режим Journal',
    }));
    initViewNavigation(host, {
      views: JOURNAL_CREATE_MODES,
      activeView: activeMode,
      onChange: (mode) => {
        if (mode === activeMode) return;
        activeMode = mode;
        renderModeSwitch();
        if (activeMode === 'event') {
          if (!eventFlow) eventFlow = createJournalEventFlow({ owner, ...context, onCreated });
          else eventFlow.resume();
          return;
        }
        recordFlow?.resumeRecord?.();
      },
    });
  };

  renderModeSwitch();
  recordFlow = openRecords({
    context: 'journal',
    date,
    workplaceId,
    timeHint,
    professionalActions: true,
    creationOwner: owner,
    onCreated,
  });
  return owner;
}
