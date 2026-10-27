import { initViewNavigation, openRecordCreationOwner, viewNavigation } from '../ui/ui.js';
import { openRecords } from '../core/records/records.js';
import { loadOperationalState } from '../core/runtime/operational-state.js';
import { createJournalEventFlow } from './event-create.js';
import { createJournalNoteFlow } from './note-create.js';

const JOURNAL_CREATE_MODES = [
  { id: 'record', label: 'Запись' },
  { id: 'event', label: 'Событие' },
  { id: 'note', label: 'Заметка' },
];

export async function openJournalCreation({
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
  const operationalReady = loadOperationalState({ full: true });

  const context = { date, workplaceId, timeHint };
  let activeMode = 'record';
  let recordFlow = null;
  let eventFlow = null;
  let noteFlow = null;

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

        if (activeMode === 'note') {
          if (!noteFlow) noteFlow = createJournalNoteFlow({ owner, ...context, onCreated });
          else noteFlow.resume();
          return;
        }

        recordFlow?.resumeRecord?.();
      },
    });
  };

  const onRecordCreated = (...args) => {
    if (typeof window === 'undefined') {
      onCreated(...args);
      return;
    }
    window.setTimeout(() => onCreated(...args), 0);
  };

  renderModeSwitch();
  recordFlow = openRecords({
    context: 'journal',
    date,
    workplaceId,
    timeHint,
    professionalActions: true,
    creationOwner: owner,
    stepBack: true,
    onCreated: onRecordCreated,
  });
  void operationalReady.catch(() => {});
  return owner;
}
