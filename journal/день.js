import {
  ALL_WORKPLACES_ID,
  focusNoteReels,
  initDateNavigator,
  initJournalDayTimeline,
  initNoteReels,
  journalDayTimeline,
  noteReels,
} from '../ui/ui.js';
import { getWorkplaces } from '../core/workplace-time.js';
import { getDays, getDay, getDayTime, getDaysForDate, getScheduleConflicts } from '../core/day/index.js';
import { getTimeUsagesForScope } from '../core/time/index.js';
import { getTimeAvailabilityAt } from '../core/time/index.js';
import { getRecordPaymentState, recordAmountDue } from '../core/finance/index.js';
import { getNotesForDay } from '../core/note/index.js';
import { noteTargetLabel, noteVisibleForWorkplace, resolveNoteTarget } from './note-target.js';

function dateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
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

function withFinancialState(usages = []) {
  return (Array.isArray(usages) ? usages : []).map((usage) => usage?.type === 'record' ? {
    ...usage,
    paid: Boolean(getRecordPaymentState(usage).fullyPaid),
    financialTotal: recordAmountDue(usage),
  } : usage);
}

async function openExistingRecord(record, rerender = () => {}) {
  const { openRecordView } = await import('../core/records/view.js');
  openRecordView(record, { onClose: rerender });
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

export function renderJournalDay(root, {
  date = new Date(),
  workplaceId = '',
  onChange = () => {},
  onWorkplaceFieldClick = () => {},
  navigationRoot = null,
  focusTarget = null,
} = {}) {
  root.innerHTML = navigationRoot
    ? '<div data-journal-day-content><div data-journal-y-host></div><div data-journal-timeline-host></div></div>'
    : '<div data-journal-day-navigator></div><div data-journal-day-content><div data-journal-y-host></div><div data-journal-timeline-host></div></div>';

  const navigatorRoot = navigationRoot || root.querySelector('[data-journal-day-navigator]');
  if (navigatorRoot) initDateNavigator(navigatorRoot, { date, onChange });

  const contentRoot = root.querySelector('[data-journal-day-content]');
  const yRoot = contentRoot?.querySelector('[data-journal-y-host]');
  const timelineRoot = contentRoot?.querySelector('[data-journal-timeline-host]');
  const workplaces = getWorkplaces();
  const dayDate = dateKey(date);
  const allMode = workplaceId === ALL_WORKPLACES_ID;
  let activeTime = currentTimeForDay(dayDate);
  let clockTimer = null;

  const dispose = () => {
    if (clockTimer) clearTimeout(clockTimer);
    clockTimer = null;
  };

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

  const rerender = () => {
    dispose();
    return renderJournalDay(root, {
      date,
      workplaceId,
      onChange,
      onWorkplaceFieldClick,
      navigationRoot,
      focusTarget,
    });
  };

  const renderY = () => {
    if (!yRoot) return;
    yRoot.innerHTML = noteReels(visibleNotes, {
      activeTime,
      relatedIds,
      targetLabel: noteTargetLabel,
    });
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

  timelineRoot.innerHTML = journalDayTimeline({ from: time.from, to: time.to, usages, day: dayDate });

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
