import { initViewNavigation, openRecordCreationOwner, viewNavigation } from '../ui/ui.js';
import { openRecords } from '../core/records/records.js';
import { createJournalEventFlow } from './event-create.js';
import { createJournalNoteFlow } from './note-create.js';

const JOURNAL_CREATE_MODES = [
  { id: 'record', label: 'Запись' },
  { id: 'event', label: 'Событие' },
  { id: 'note', label: 'Заметка' },
];

export function openJournalCreation({
  context = 'professional',
  date = '',
  workplaceId = '',
  timeHint = '',
  surfaceRoot = null,
  bodyRoot = null,
  eventActions = null,
  onRecordRequest = null,
  onCreated = () => {},
  onCancel = () => {},
} = {}) {
  const owner = openRecordCreationOwner({ onCancel, surfaceRoot, bodyRoot });
  if (!owner) return null;

  const accountMode = String(context || '').trim().toLowerCase() === 'account';
  const modes = accountMode ? JOURNAL_CREATE_MODES.filter((mode) => mode.id !== 'note') : JOURNAL_CREATE_MODES;
  const flowContext = { date, workplaceId: accountMode ? '' : workplaceId, timeHint };
  let activeMode = 'record';
  let recordFlow = null;
  let eventFlow = null;
  let noteFlow = null;

  const renderAccountRecord = () => {
    const view = owner.render({
      step: 'record',
      title: false,
      body: '<div class="form-grid"></div>',
      action: { label: 'Записаться', data: 'data-account-journal-record-create' },
    });
    view?.action?.addEventListener('click', () => {
      owner.commit?.();
      onRecordRequest?.({ date: String(date || '').slice(0, 10), from: String(timeHint || '') });
    });
  };

  const renderActiveMode = () => {
    if (activeMode === 'event') {
      if (!eventFlow) eventFlow = createJournalEventFlow({ owner, ...flowContext, eventActions, onCreated });
      else eventFlow.resume();
      return;
    }

    if (activeMode === 'note') {
      if (!noteFlow) noteFlow = createJournalNoteFlow({ owner, ...flowContext, onCreated });
      else noteFlow.resume();
      return;
    }

    if (accountMode) {
      renderAccountRecord();
      return;
    }
    recordFlow?.resumeRecord?.();
  };

  const renderModeSwitch = () => {
    const host = owner.setShellHeader(viewNavigation({
      views: modes,
      activeView: activeMode,
      className: 'segment-control--two',
      ariaLabel: 'Режим Journal',
    }));
    initViewNavigation(host, {
      views: modes,
      activeView: activeMode,
      onChange: (mode) => {
        if (mode === activeMode) return;
        activeMode = mode;
        renderModeSwitch();
        renderActiveMode();
      },
    });
  };

  renderModeSwitch();
  if (accountMode) {
    renderAccountRecord();
  } else {
    recordFlow = openRecords({
      context: 'journal',
      date,
      workplaceId,
      timeHint,
      professionalActions: true,
      creationOwner: owner,
      onCreated,
    });
  }
  return owner;
}
