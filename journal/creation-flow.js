import { initViewNavigation, openRecordCreationOwner, viewNavigation } from '../ui/ui.js';
import { openRecords } from '../core/records/records.js';
import { createJournalBreakFlow } from './break-create.js';

const JOURNAL_CREATE_MODES = [
  { id: 'record', label: 'Запись' },
  { id: 'break', label: 'Занять время' },
];

export function openJournalCreation({
  date = '',
  workplaceId = '',
  timeHint = '',
  onCreated = () => {},
  onCancel = () => {},
} = {}) {
  const owner = openRecordCreationOwner({ onCancel });
  if (!owner) return null;

  const context = { date, workplaceId, timeHint };
  let activeMode = 'record';
  let recordFlow = null;
  let breakFlow = null;

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
        if (activeMode === 'break') {
          if (!breakFlow) {
            breakFlow = createJournalBreakFlow({ owner, ...context, onCreated });
          } else {
            breakFlow.resume();
          }
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
