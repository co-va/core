import {
  ALL_WORKPLACES_ID,
  button,
  clearV2Y,
  focusNoteReels,
  initDateNavigator,
  initJournalDayTimeline,
  initNoteReels,
  journalDayTimeline,
  modal,
  mountModal,
  noteReels,
  openRecordCreationOwner,
  setV2Y,
} from '../ui/ui.js';
import { getWorkplaces } from '../core/workplace-time.js';
import { getDays, getDay, getDayTime, getDaysForDate, getScheduleConflicts } from '../core/day/index.js';
import { getTimeUsagesForScope, getTimeAvailabilityAt } from '../core/time/index.js';
import { getRecordPaymentState, recordAmountDue } from '../core/finance/index.js';
import { getNotesForDay } from '../core/note/index.js';
import {
  accountNoteActions,
  accountNotesLoaded,
  getAccountNote,
  getAccountNotesForDay,
  loadAccountNotes,
} from '../core/note/account-owner.js';
import {
  accountEventActions,
  accountEventsLoaded,
  getAccountEvent,
  getAccountEvents,
  loadAccountEvents,
} from '../core/event/account-owner.js';
import { syncAccountCalendars } from '../core/calendar-sync/account.js';
import { createJournalEventFlow } from './event-create.js';
import { createJournalNoteFlow } from './note-create.js';
import { noteTargetLabel, noteVisibleForWorkplace, resolveNoteTarget } from './note-target.js';

function dateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function journalContext(value = 'professional') {
  return String(value || '').trim().toLowerCase() === 'account' ? 'account' : 'professional';
}

function readRecords(source) {
  const value = typeof source === 'function' ? source() : source;
  return Array.isArray(value) ? value : [];
}

function recordId(record = null) {
  return String(record?.id || record?.sourceId || '');
}

function currentTimeForDay(day) {
  const now = new Date();
  if (dateKey(now) !== String(day || '').slice(0, 10)) return '';
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}

function nextMinuteDelay() {
  const now = new Date();
  return Math.max(25, 60000 - ((now.getSeconds() * 1000) + now.getMilliseconds()) + 25);
}

function accountRecordPaid(record = null) {
  const payment = record?.payment && typeof record.payment === 'object' ? record.payment : null;
  const state = String(payment?.state || '').trim().toLowerCase();
  if (state) return state === 'paid';
  if (payment && ('due' in payment || 'paid' in payment)) {
    const due = Math.max(0, Number(payment.due) || 0);
    const paid = Math.max(0, Number(payment.paid) || 0);
    if (due <= 0.009 && paid > 0.009) return true;
  }
  const planTotal = Math.max(0, Number(record?.finance?.planTotal) || 0);
  const factTotal = Math.max(0, Number(record?.finance?.factTotal) || 0);
  return planTotal > 0.009 && factTotal + 0.009 >= planTotal;
}

function withFinancialState(usages = []) {
  return (Array.isArray(usages) ? usages : []).map((usage) => usage?.type === 'record' ? {
    ...usage,
    paid: Boolean(getRecordPaymentState(usage).fullyPaid),
    financialTotal: recordAmountDue(usage),
  } : usage);
}

function accountAmountDue(record = null) {
  const planTotal = Number(record?.finance?.planTotal);
  if (Number.isFinite(planTotal)) return Math.max(0, planTotal);
  return [...(Array.isArray(record?.procedures) ? record.procedures : []), ...(Array.isArray(record?.products) ? record.products : [])]
    .reduce((sum, item) => sum + Math.max(0, Number(item?.cost ?? item?.price) || 0), 0);
}

function accountUsage(record, resolveRecordContext) {
  const presentation = typeof resolveRecordContext === 'function' ? (resolveRecordContext(record) || {}) : {};
  const professional = presentation?.professional && typeof presentation.professional === 'object'
    ? presentation.professional
    : {};
  return {
    ...record,
    type: 'record',
    sourceId: recordId(record),
    person: professional,
    paid: accountRecordPaid(record),
    financialTotal: accountAmountDue(record),
  };
}

function accountEventUsage(event = null) {
  return {
    ...(event || {}),
    type: 'event',
    sourceId: String(event?.id || ''),
    rigidity: 'soft',
  };
}

function usageMinutes(value) {
  const match = String(value || '').match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const minutes = Number(match[1]) * 60 + Number(match[2]);
  return Number.isFinite(minutes) ? minutes : null;
}

function withAccountOverlaps(values = []) {
  const usages = (Array.isArray(values) ? values : []).map((usage) => ({ ...usage, overlap: false }));
  const intervals = usages.map((usage, index) => {
    const from = usageMinutes(usage?.from);
    const rawTo = usageMinutes(usage?.to);
    if (from == null || rawTo == null || rawTo === from) return null;
    return { index, from, to: rawTo > from ? rawTo : rawTo + 24 * 60 };
  }).filter(Boolean);
  for (let left = 0; left < intervals.length; left += 1) {
    for (let right = left + 1; right < intervals.length; right += 1) {
      const a = intervals[left], b = intervals[right];
      if (a.from < b.to && b.from < a.to) {
        usages[a.index].overlap = true;
        usages[b.index].overlap = true;
      }
    }
  }
  return usages;
}

async function openExistingRecord(record, rerender = () => {}) {
  const { openRecordView } = await import('../core/records/view.js');
  openRecordView(record, { onClose: rerender });
}

async function openAccountRecord(record, resolveRecordContext, rerender = () => {}) {
  const presentation = typeof resolveRecordContext === 'function' ? (resolveRecordContext(record) || {}) : {};
  const { openRecordView } = await import('../core/records/view.js');
  openRecordView(record, {
    context: 'account',
    professional: presentation?.professional || null,
    onClose: rerender,
  });
}

async function openAccountEvent(event, rerender = () => {}) {
  const { openEventView } = await import('./event-view.js');
  openEventView(event, { eventActions: accountEventActions, onClose: rerender });
}

async function openUsage(usage, rerender = () => {}) {
  if (usage?.type === 'record') {
    await openExistingRecord(usage, rerender);
    return;
  }
  if (usage?.type === 'event') {
    const { openEventView } = await import('./event-view.js');
    openEventView(usage, { onClose: rerender });
  }
}

function openAccountDayAction({ root, date, from, noteActions = null, targetSource = null, onCreated = () => {} } = {}) {
  const content = `<div class="modal-actions">
    ${button('Событие', { variant: 'secondary', data: 'data-account-day-event' })}
    ${button('Заметка', { variant: 'secondary', data: 'data-account-day-note' })}
    ${button('Записаться', { data: 'data-account-day-booking' })}
  </div>`;
  const layer = mountModal(document.body, modal(content, {
    variant: 'x',
    xRole: 'action',
    surface: 'app',
    title: 'Действие',
  }));
  if (!layer) return null;

  layer.querySelector('[data-account-day-booking]')?.addEventListener('click', () => {
    layer.v2Close?.();
    window.dispatchEvent(new CustomEvent('cova:account-journal-open-contacts'));
  });

  layer.querySelector('[data-account-day-note]')?.addEventListener('click', () => {
    layer.v2Close?.();
    const owner = openRecordCreationOwner({
      surfaceRoot: root.closest('[data-v2-z],[data-v2-z-layer]'),
      bodyRoot: root,
    });
    if (!owner) return;
    owner.setShellHeader('<div class="record-creation-step-title">Заметка</div>');
    createJournalNoteFlow({
      owner,
      date,
      noteActions,
      targetSource,
      onCreated,
    });
  });

  layer.querySelector('[data-account-day-event]')?.addEventListener('click', () => {
    layer.v2Close?.();
    const owner = openRecordCreationOwner({
      surfaceRoot: root.closest('[data-v2-z],[data-v2-z-layer]'),
      bodyRoot: root,
    });
    if (!owner) return;
    owner.setShellHeader('<div class="record-creation-step-title">Событие</div>');
    createJournalEventFlow({
      owner,
      date,
      workplaceId: '',
      timeHint: from,
      eventActions: accountEventActions,
      onCreated,
    });
  });

  return layer;
}

export function renderJournalDay(root, {
  context = 'professional',
  records = null,
  resolveRecordContext = () => ({}),
  date = new Date(),
  workplaceId = '',
  onChange = () => {},
  onWorkplaceFieldClick = () => {},
  navigationRoot = null,
  focusTarget = null,
} = {}) {
  const contextName = journalContext(context);
  const accountMode = contextName === 'account';
  root.dataset.journalDayContext = contextName;
  root.innerHTML = navigationRoot
    ? '<div data-journal-day-content><div data-journal-timeline-host></div></div>'
    : '<div data-journal-day-navigator></div><div data-journal-day-content><div data-journal-timeline-host></div></div>';

  const navigatorRoot = navigationRoot || root.querySelector('[data-journal-day-navigator]');
  if (navigatorRoot) initDateNavigator(navigatorRoot, { date, onChange });

  const contentRoot = root.querySelector('[data-journal-day-content]');
  const timelineRoot = contentRoot?.querySelector('[data-journal-timeline-host]');
  const dayDate = dateKey(date);
  let activeTime = currentTimeForDay(dayDate);
  let clockTimer = null;

  const dispose = () => {
    if (clockTimer) clearTimeout(clockTimer);
    clockTimer = null;
    clearV2Y(root);
  };

  const rerender = () => {
    dispose();
    return renderJournalDay(root, {
      context: contextName,
      records,
      resolveRecordContext,
      date,
      workplaceId,
      onChange,
      onWorkplaceFieldClick,
      navigationRoot,
      focusTarget: accountMode ? null : focusTarget,
    });
  };

  if (accountMode) {
    clearV2Y(root);
    if (!accountEventsLoaded()) {
      void loadAccountEvents().then(() => {
        if (root.isConnected) rerender();
      }).catch(() => {});
    }
    if (!accountNotesLoaded()) {
      void loadAccountNotes().then(() => {
        if (root.isConnected) rerender();
      }).catch(() => {});
    }
    void syncAccountCalendars().then(async (result) => {
      if (Number(result?.synced || 0) <= 0) return;
      await loadAccountEvents({ force: true });
      if (root.isConnected) rerender();
    }).catch(() => {});

    const allAccountRecords = readRecords(records);
    const accountRecords = allAccountRecords
      .filter((record) => String(record?.date || '').slice(0, 10) === dayDate)
      .filter((record) => String(record?.status || '').toLowerCase() !== 'cancelled');
    const accountEvents = getAccountEvents()
      .filter((event) => String(event?.date || '').slice(0, 10) === dayDate);
    const accountTargetSource = {
      readRecord: (id) => {
        const record = allAccountRecords.find((item) => recordId(item) === String(id || '')) || null;
        return record ? accountUsage(record, resolveRecordContext) : null;
      },
      recordsForDay: (targetDate) => allAccountRecords
        .filter((record) => String(record?.date || '').slice(0, 10) === String(targetDate || '').slice(0, 10))
        .map((record) => accountUsage(record, resolveRecordContext)),
      readEvent: (id) => getAccountEvent(id),
      eventsForDay: (targetDate) => getAccountEvents()
        .filter((event) => String(event?.date || '').slice(0, 10) === String(targetDate || '').slice(0, 10))
        .map(accountEventUsage),
    };
    const accountNotes = getAccountNotesForDay(dayDate);
    const renderAccountY = () => {
      const yRoot = setV2Y(root, noteReels(accountNotes, {
        activeTime,
        targetLabel: (note) => noteTargetLabel(note, { source: accountTargetSource }),
      }));
      if (!yRoot || yRoot.hidden) return;
      initNoteReels(yRoot, {
        onOpen: async ({ noteId }) => {
          const note = getAccountNote(noteId);
          if (!note) return;
          const { openNoteView } = await import('./note-view.js');
          openNoteView(note, {
            noteActions: accountNoteActions,
            targetSource: accountTargetSource,
            onSaved: rerender,
            onDeleted: rerender,
          });
        },
      });
    };
    renderAccountY();

    const usages = withAccountOverlaps([
      ...accountRecords.map((record) => accountUsage(record, resolveRecordContext)),
      ...accountEvents.map(accountEventUsage),
    ]);
    const recordById = new Map(accountRecords.map((record) => [recordId(record), record]).filter(([id]) => Boolean(id)));
    const eventById = new Map(accountEvents.map((event) => [String(event?.id || ''), event]).filter(([id]) => Boolean(id)));

    timelineRoot.innerHTML = journalDayTimeline({
      from: '09:00',
      to: '23:00',
      usages,
      day: dayDate,
    });
    initJournalDayTimeline(timelineRoot, {
      onUsageClick: ({ usageId }) => {
        const id = String(usageId || '');
        const event = eventById.get(id);
        if (event) {
          void openAccountEvent(event, rerender);
          return;
        }
        const record = recordById.get(id);
        if (record) void openAccountRecord(record, resolveRecordContext, rerender);
      },
      onSlotClick: ({ from }) => {
        openAccountDayAction({
          root,
          date: dayDate,
          from,
          noteActions: accountNoteActions,
          targetSource: accountTargetSource,
          onCreated: rerender,
        });
      },
    });
    return dispose;
  }

  const workplaces = getWorkplaces();
  const allMode = workplaceId === ALL_WORKPLACES_ID;
  const dayNotes = getNotesForDay(dayDate);
  const visibleNotes = dayNotes.filter((note) => noteVisibleForWorkplace(note, workplaceId, { allMode }));
  const relatedIds = focusTarget?.targetType && focusTarget?.targetId
    ? visibleNotes
      .filter((note) => note.targetType === focusTarget.targetType && note.targetId === focusTarget.targetId)
      .map((note) => note.id)
    : [];

  if (relatedIds.length) {
    const relatedNote = visibleNotes.find((note) => relatedIds.includes(note.id));
    const target = relatedNote ? resolveNoteTarget(relatedNote) : null;
    if (target?.entity?.from) activeTime = String(target.entity.from);
  }

  const renderY = () => {
    const yRoot = setV2Y(root, noteReels(visibleNotes, {
      activeTime,
      relatedIds,
      targetLabel: noteTargetLabel,
    }));
    if (!yRoot || yRoot.hidden) return;
    initNoteReels(yRoot, {
      onOpen: async ({ noteId }) => {
        const note = visibleNotes.find((item) => String(item?.id || '') === String(noteId || ''));
        if (!note) return;
        const { openNoteView } = await import('./note-view.js');
        openNoteView(note, {
          onSaved: rerender,
          onDeleted: rerender,
        });
      },
    });
    if (relatedIds.length) {
      requestAnimationFrame(() => focusNoteReels(yRoot, relatedIds));
    }
  };

  const scheduleLiveTimeRefresh = () => {
    if (!currentTimeForDay(dayDate)) return;
    if (clockTimer) clearTimeout(clockTimer);
    clockTimer = window.setTimeout(() => {
      clockTimer = null;
      if (!root.isConnected) return;
      const nextActiveTime = currentTimeForDay(dayDate);
      if (!nextActiveTime) return;
      activeTime = nextActiveTime;
      renderY();
      scheduleLiveTimeRefresh();
    }, nextMinuteDelay());
  };

  renderY();
  scheduleLiveTimeRefresh();

  if (allMode) {
    const days = getDaysForDate(getDays(), dayDate);
    if (!days.length) {
      timelineRoot.innerHTML = '<div class="time-day-state" aria-disabled="true">Выходной день</div>';
      return dispose;
    }

    const columns = days.map((day) => {
      const currentId = String(day?.workplaceId || '');
      const workplace = workplaces.find((item) => String(item?.key || '') === currentId) || null;
      const time = getDayTime(day, workplaces);
      if (!currentId || !time) return null;
      return {
        workplaceId: currentId,
        name: workplace?.name || 'Рабочее место',
        from: time.from,
        to: time.to,
        usages: withFinancialState(getTimeUsagesForScope({ date: dayDate, workplaceId: currentId })),
        conflict: getScheduleConflicts(days, {
          workplaceId: currentId,
          date: dayDate,
          from: time.from,
          to: time.to,
        }).length > 0,
      };
    }).filter(Boolean);

    if (!columns.length) {
      timelineRoot.innerHTML = '<div class="time-day-state" aria-disabled="true">Не задано рабочее время</div>';
      return dispose;
    }

    timelineRoot.innerHTML = journalDayTimeline({ columns, day: dayDate });
    initJournalDayTimeline(timelineRoot, {
      onWorkFieldClick: ({ workplaceId: nextWorkplaceId }) => {
        if (nextWorkplaceId) onWorkplaceFieldClick(nextWorkplaceId);
      },
    });
    return dispose;
  }

  const workingDay = getDay(getDays(), workplaceId, dayDate);
  if (!workingDay) {
    timelineRoot.innerHTML = '<div class="time-day-state" aria-disabled="true">Выходной день</div>';
    return dispose;
  }

  const time = getDayTime(workingDay, workplaces);
  if (!time) {
    timelineRoot.innerHTML = '<div class="time-day-state" aria-disabled="true">Не задано рабочее время</div>';
    return dispose;
  }

  const usages = withFinancialState(getTimeUsagesForScope({ date: dayDate, workplaceId }));
  const usageById = new Map(usages.map((usage) => [String(usage?.sourceId || usage?.id || ''), usage]));

  timelineRoot.innerHTML = journalDayTimeline({
    from: time.from,
    to: time.to,
    usages,
    day: dayDate,
    clipUsagesToWorkRange: true,
  });

  initJournalDayTimeline(timelineRoot, {
    onWorkFieldClick: () => onWorkplaceFieldClick(workplaceId),
    onUsageClick: ({ usageId }) => {
      const usage = usageById.get(String(usageId || ''));
      if (usage?.from) {
        activeTime = String(usage.from);
        renderY();
      }
      void openUsage(usage, rerender);
    },
    onSlotClick: async ({ from }) => {
      activeTime = String(from || '');
      renderY();

      const minuteState = getTimeAvailabilityAt({ date: dayDate, workplaceId, time: from });
      if (minuteState.state === 'occupied' && minuteState.usage) {
        const usage = usageById.get(String(minuteState.usage.sourceId || '')) || minuteState.usage;
        await openUsage(usage, rerender);
        return;
      }
      if (minuteState.state !== 'free') return;

      const { openJournalCreation } = await import('./creation-flow.js');
      openJournalCreation({
        date: dayDate,
        workplaceId,
        timeHint: from,
        surfaceRoot: root.closest('[data-v2-z],[data-v2-z-layer]'),
        bodyRoot: root,
        onCreated: rerender,
      });
    },
  });

  return dispose;
}
