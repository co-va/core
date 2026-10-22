import { actionBlock, button, entityCard, initCalendar, initMultiSelect, modal, mountModal, timePicker, initTimePickers, twoColumnLayout, escapeHtml, mountV2ZLayer, v2HorizontalRail, v2ZLayer, workspaceHeaderContext, ALL_WORKPLACES_ID, getWorkplaceContext, setWorkplaceContext } from '../ui/ui.js';
import { getWorkplaces, resolveWorkplaceTime, getWorkingDayIndicators, getWorkingDayTotalMinutes, getWorkplaceMonthStats, getAllWorkplacesMonthStats, getWorkplaceMonthStatsMap } from '../core/workplace-time.js';
import { getDays, saveDays, getDay, getDayTime, createDay, updateDayTime, removeDay, getDayRemovalConflicts, getScheduleConflicts, findSuggestedInterval } from '../core/day/index.js';
import { getWorkingTimeUsageConflicts, isValidRange } from '../core/time/index.js';

function datesForWorkplace(days, workplaceId) { return days.filter((item) => item?.workplaceId === workplaceId).map((item) => item.date).filter(Boolean); }
function datesForAllWorkplaces(days) { return [...new Set(days.map((item) => item?.date).filter(Boolean))]; }
function workingDayForDate(days, workplaceId, date) { return getDay(days, workplaceId, date); }
function formatDateLabel(value) { const [year, month, day] = String(value || '').split('-'); return year && month && day ? `${day}.${month}.${year}` : String(value || ''); }
function formatDuration(totalMinutes) {
  const total = Math.max(0, Number(totalMinutes) || 0);
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  if (!minutes) return `${hours} ч`;
  if (!hours) return `${minutes} м`;
  return `${hours} ч ${minutes} м`;
}
function occupiedLabel(item) { return item?.type === 'break' ? 'Перерыв' : 'Запись'; }
function formatMonthStats(stats = {}) {
  const days = Math.max(0, Number(stats?.days) || 0);
  const hours = Math.max(0, Number(stats?.hours) || 0);
  const minutes = String(Math.max(0, Number(stats?.minutes) || 0)).padStart(2, '0');
  return { days, duration: `${hours} ч ${minutes} м` };
}
function notifyContext() {
  window.dispatchEvent(new CustomEvent('book:v2-context-changed'));
}

export function renderTimetable(root) {
  const workplaces = getWorkplaces();
  const workingDays = getDays();
  const context = getWorkplaceContext(workplaces);
  let selectedWorkplaceId = context.workplaceId;
  const initialDate = context.date;
  const initialMonth = new Date(initialDate.getFullYear(), initialDate.getMonth(), 1);

  const statsForMonth = (month) => ({
    aggregate: getAllWorkplacesMonthStats(workingDays, workplaces, month),
    byWorkplace: getWorkplaceMonthStatsMap(workingDays, workplaces, month),
  });

  const workplaceGraphCard = (workplace, stats, { data = '', aria = '' } = {}) => {
    const summary = formatMonthStats(stats);
    return entityCard({
      title: workplace?.name || 'Без названия',
      image: workplace?.photo || '',
      initial: (workplace?.name || '?').slice(0, 1).toUpperCase(),
      topRightMeta: [
        { value: `${summary.days} дней`, row: 1 },
        { value: summary.duration, row: 2 },
      ],
      interactive: true,
      data,
      aria: aria || `Открыть рабочее пространство ${workplace?.name || ''}`,
      className: 'entity-card--hero entity-card--rail entity-card--top-light',
    });
  };

  const aggregateGraphCard = (stats, { data = '', aria = 'Открыть общий график' } = {}) => {
    const summary = formatMonthStats(stats);
    return entityCard({
      title: 'Общий график',
      topRightMeta: [
        { value: `${summary.days} дней`, row: 1 },
        { value: summary.duration, row: 2 },
      ],
      interactive: true,
      data,
      aria,
      className: 'entity-card--hero entity-card--rail entity-card--top-light',
    });
  };

  const headerContextMarkup = (month, { inactiveA = false, title = '' } = {}) => {
    const allMode = selectedWorkplaceId === ALL_WORKPLACES_ID;
    const stats = allMode
      ? getAllWorkplacesMonthStats(workingDays, workplaces, month)
      : getWorkplaceMonthStats(workingDays, workplaces, selectedWorkplaceId, month);
    const summary = formatMonthStats(stats);
    const workplace = workplaces.find((item) => String(item?.key || '') === String(selectedWorkplaceId || '')) || null;
    return workspaceHeaderContext({
      title: title || (allMode ? 'Общий график' : (workplace?.name || 'Рабочее пространство')),
      a: {
        kind: 'logo',
        label: String(summary.days),
        settingsTag: !inactiveA,
        data: inactiveA ? '' : 'data-timetable-settings-open',
        aria: inactiveA ? `Рабочих дней: ${summary.days}` : `Настройки графика. Рабочих дней: ${summary.days}`,
        disabled: inactiveA,
      },
      hideD: true,
    });
  };

  root.innerHTML = `<div class="calendar-workspace">${headerContextMarkup(initialMonth)}<div data-timetable-calendar data-calendar-workspace-host></div>${actionBlock(button('Применить', {
    data: 'data-timetable-apply',
    aria: 'Применить',
    disabled: true,
  }))}</div>`;
  const calendarRoot = root.querySelector('[data-timetable-calendar]');
  const applyButton = root.querySelector('[data-timetable-apply]');
  const applyActions = applyButton?.closest('.modal-actions');
  let calendar; let selection; let selectionMode = null;

  const bindHeaderContext = () => {
    root.querySelector('[data-timetable-settings-open]')?.addEventListener('click', openTimetableSettingsMenu);
  };

  const renderHeader = (month) => {
    const current = root.querySelector('[data-workspace-header-context]');
    if (!current) return;
    current.outerHTML = headerContextMarkup(month);
    bindHeaderContext();
    notifyContext();
  };
  const isAllMode = () => selectedWorkplaceId === ALL_WORKPLACES_ID;
  const isWorkingDate = (date) => !isAllMode() && datesForWorkplace(workingDays, selectedWorkplaceId).includes(date);
  const syncApplyButton = (dates) => {
    const allMode = isAllMode();
    if (!dates.length) {
      selectionMode = null;
      applyButton.disabled = true;
      applyButton.textContent = 'Применить';
      applyButton.classList.remove('ui-button--danger');
      applyButton.setAttribute('aria-label', 'Применить');
      if (applyActions) applyActions.hidden = true;
      notifyContext();
      return;
    }
    const selectedDate = new Date(`${dates[0]}T00:00:00`);
    if (allMode) {
      setWorkplaceContext({ date: selectedDate });
      selectionMode = 'add-workplace';
      applyButton.textContent = 'Применить';
      applyButton.classList.remove('ui-button--danger');
      applyButton.setAttribute('aria-label', 'Применить');
    } else {
      setWorkplaceContext({ workplaceId: selectedWorkplaceId, date: selectedDate });
      selectionMode = isWorkingDate(dates[0]) ? 'make-off' : 'make-working';
      const makeOff = selectionMode === 'make-off';
      applyButton.textContent = makeOff ? 'Выходной' : 'Рабочий';
      applyButton.classList.toggle('ui-button--danger', makeOff);
      applyButton.setAttribute('aria-label', makeOff ? 'Сделать выходным' : 'Сделать рабочим');
    }
    applyButton.disabled = false;
    if (applyActions) applyActions.hidden = false;
    notifyContext();
  };
  const guard = (event) => {
    const calendarButton = event.target.closest('[data-calendar-date]'); if (!calendarButton || !selection || isAllMode()) return;
    const date = calendarButton.dataset.calendarDate || ''; if (!date || selection.isSelected(date)) return;
    const mode = isWorkingDate(date) ? 'make-off' : 'make-working';
    if (!selectionMode) selectionMode = mode; else if (mode !== selectionMode) { event.preventDefault(); event.stopImmediatePropagation(); }
  };
  calendarRoot.addEventListener('click', guard, true);

  const bindSelection = () => {
    selection?.destroy();
    selection = initMultiSelect(calendarRoot, { onChange: syncApplyButton });
    syncApplyButton([]);
  };

  const startSelectionSession = (month) => {
    const allMode = isAllMode();
    calendar = initCalendar(calendarRoot, {
      month,
      workingDates: allMode ? datesForAllWorkplaces(workingDays) : datesForWorkplace(workingDays, selectedWorkplaceId),
      renderDateContent: ({ dateKey, isCurrentMonth, isWorking }) => {
        if (!isCurrentMonth || !isWorking) return '';
        if (allMode) return `<span>${escapeHtml(formatDuration(getWorkingDayTotalMinutes(workingDays, workplaces, dateKey)))}</span>`;
        const time = getDayTime(workingDayForDate(workingDays, selectedWorkplaceId, dateKey), workplaces);
        return time ? `<span>${time.from}</span><span>${time.to}</span>` : '';
      },
      resolveDateIndicators: ({ dateKey, isCurrentMonth }) => isCurrentMonth
        ? getWorkingDayIndicators(workingDays, workplaces, dateKey, { excludeWorkplaceId: allMode ? '' : selectedWorkplaceId })
        : [],
      onDateSelect: (date) => {
        if (!date) return;
        const nextDate = new Date(`${date}T00:00:00`);
        if (allMode) setWorkplaceContext({ date: nextDate });
        else setWorkplaceContext({ workplaceId: selectedWorkplaceId, date: nextDate });
      },
      onMonthChange: (nextMonth) => {
        bindSelection();
        if (allMode) setWorkplaceContext({ date: nextMonth });
        else setWorkplaceContext({ workplaceId: selectedWorkplaceId, date: nextMonth });
        renderHeader(nextMonth);
      },
    });
    bindSelection();
  };

  function conflictWorkplaceLabel(day) {
    return workplaces.find((item) => String(item?.key || '') === String(day?.workplaceId || ''))?.name || 'Другое место работы';
  }

  function buildConflictEntry(date, base, workplaceId = selectedWorkplaceId) {
    const conflicts = getScheduleConflicts(workingDays, { workplaceId, date, from: base.from, to: base.to });
    if (!conflicts.length) return null;
    const suggested = findSuggestedInterval(workingDays, { workplaceId, date, baseFrom: base.from, baseTo: base.to });
    return { date, conflicts, suggested };
  }

  function conflictParticipant(day, { target = false, from = '', to = '' } = {}) {
    const workplaceId = String(day?.workplaceId || selectedWorkplaceId || '');
    return {
      workplaceId,
      name: target ? (workplaces.find((item) => String(item?.key || '') === workplaceId)?.name || 'Рабочее пространство') : conflictWorkplaceLabel(day),
      from: String(from || day?.from || ''),
      to: String(to || day?.to || ''),
      target,
    };
  }

  function conflictParticipants(entry, base, workplaceId = selectedWorkplaceId) {
    const target = conflictParticipant({ workplaceId }, {
      target: true,
      from: entry.suggested?.from || base.from,
      to: entry.suggested?.to || base.to,
    });
    const seen = new Set([target.workplaceId]);
    const existing = [];
    entry.conflicts.forEach((day) => {
      const workplaceId = String(day?.workplaceId || '');
      if (!workplaceId || seen.has(workplaceId)) return;
      seen.add(workplaceId);
      existing.push(conflictParticipant(day));
    });
    return [target, ...existing];
  }

  function draftDaysForConflict(date, participants) {
    const ids = new Set(participants.map((item) => String(item?.workplaceId || '')));
    const untouched = workingDays.filter((day) => String(day?.date || '').slice(0, 10) !== String(date || '').slice(0, 10)
      || !ids.has(String(day?.workplaceId || '')));
    const drafts = participants.map((item) => ({ date, workplaceId: item.workplaceId, from: item.from, to: item.to }));
    return [...untouched, ...drafts];
  }

  function draftScheduleConflicts(date, participants) {
    const draftDays = draftDaysForConflict(date, participants);
    const found = [];
    const seen = new Set();
    participants.forEach((participant) => {
      getScheduleConflicts(draftDays, {
        workplaceId: participant.workplaceId,
        date,
        from: participant.from,
        to: participant.to,
      }).forEach((other) => {
        const pair = [String(participant.workplaceId || ''), String(other?.workplaceId || '')].sort().join('::');
        if (!other?.workplaceId || seen.has(pair)) return;
        seen.add(pair);
        found.push({ participant, other });
      });
    });
    return found;
  }

  function expandConflictParticipants(participants, conflicts) {
    const next = participants.map((item) => ({ ...item }));
    const seen = new Set(next.map((item) => String(item?.workplaceId || '')));
    conflicts.forEach(({ other }) => {
      const workplaceId = String(other?.workplaceId || '');
      if (!workplaceId || seen.has(workplaceId)) return;
      seen.add(workplaceId);
      next.push(conflictParticipant(other));
    });
    return next;
  }

  function usageConflictMessages(date, participants) {
    const messages = [];
    participants.forEach((participant) => {
      if (!isValidRange(participant.from, participant.to)) return;
      getWorkingTimeUsageConflicts({
        date,
        workplaceId: participant.workplaceId,
        from: participant.from,
        to: participant.to,
      }).forEach((conflict) => {
        if (!conflict?.from || !conflict?.to) return;
        messages.push(`${participant.name}: ${occupiedLabel(conflict)} ${conflict.from}–${conflict.to} выходит за рабочее время.`);
      });
    });
    return messages;
  }

  function openWorkingDaysConflictModal(entries, base, workplaceId = selectedWorkplaceId) {
    let activeEntries = entries.map((entry) => ({
      date: entry.date,
      participants: conflictParticipants(entry, base, workplaceId),
      error: '',
    }));

    const rowMarkup = (entry, entryIndex) => {
      const participants = entry.participants.map((participant, participantIndex) => {
        const role = participant.target ? 'Добавляем' : 'Уже в графике';
        const timeFields = twoColumnLayout(
          timePicker({ name: `timetableConflictFrom${entryIndex}_${participantIndex}`, label: 'Начало', value: participant.from }),
          timePicker({ name: `timetableConflictTo${entryIndex}_${participantIndex}`, label: 'Окончание', value: participant.to }),
          { ariaLabel: `Интервал ${participant.name}` },
        );
        return `<div class="compact-form" data-timetable-conflict-participant="${participantIndex}"><div class="entity-details"><div><span>${escapeHtml(role)}</span><strong>${escapeHtml(participant.name)}</strong></div></div>${timeFields}</div>`;
      }).join('');
      return `<div class="compact-form" data-timetable-conflict-row="${entryIndex}"><div class="entity-details"><div><span>Дата</span><strong>${escapeHtml(formatDateLabel(entry.date))}</strong></div></div>${participants}<div class="form-error" data-timetable-conflict-error="${entryIndex}">${escapeHtml(entry.error || '')}</div></div>`;
    };

    const content = `<div class="modal-title"><h2>Конфликт времени</h2><p>Можно изменить время нового и уже существующих рабочих мест. Исправленные даты применяются сразу, остальные остаются для дальнейшей корректировки.</p></div><div data-timetable-conflict-rows></div>${button('Сохранить', { data: 'data-timetable-conflicts-save' })}`;
    const m = mountModal(document.body, modal(content, { title: 'Конфликт времени', variant: 'q' }));
    if (!m) return;
    const rowsRoot = m.querySelector('[data-timetable-conflict-rows]');

    const renderRows = () => {
      if (!rowsRoot) return;
      rowsRoot.innerHTML = activeEntries.map(rowMarkup).join('');
      initTimePickers(rowsRoot);
    };

    const readParticipants = (entry, entryIndex) => entry.participants.map((participant, participantIndex) => ({
      ...participant,
      from: m.querySelector(`[name="timetableConflictFrom${entryIndex}_${participantIndex}"]`)?.value || participant.from,
      to: m.querySelector(`[name="timetableConflictTo${entryIndex}_${participantIndex}"]`)?.value || participant.to,
    }));

    renderRows();
    m.querySelector('[data-timetable-conflicts-save]')?.addEventListener('click', () => {
      const remaining = [];
      let applied = 0;

      activeEntries.forEach((entry, entryIndex) => {
        const participants = readParticipants(entry, entryIndex);
        if (participants.some((participant) => !isValidRange(participant.from, participant.to))) {
          remaining.push({ ...entry, participants, error: 'Окончание должно быть позже начала.' });
          return;
        }

        const usageErrors = usageConflictMessages(entry.date, participants);
        if (usageErrors.length) {
          remaining.push({ ...entry, participants, error: usageErrors.join(' ') });
          return;
        }

        const scheduleConflicts = draftScheduleConflicts(entry.date, participants);
        if (scheduleConflicts.length) {
          remaining.push({
            ...entry,
            participants: expandConflictParticipants(participants, scheduleConflicts),
            error: 'Время всё ещё пересекается. Скорректируйте рабочие места этой даты.',
          });
          return;
        }

        participants.forEach((participant) => {
          const existing = getDay(workingDays, participant.workplaceId, entry.date);
          if (existing) updateDayTime(workingDays, participant.workplaceId, entry.date, participant.from, participant.to);
          else {
            const day = createDay({ date: entry.date, workplaceId: participant.workplaceId, from: participant.from, to: participant.to });
            if (day) workingDays.push(day);
          }
        });
        applied += 1;
      });

      if (applied) {
        saveDays(workingDays);
        const month = calendar?.getDisplayedMonth() || initialMonth;
        startSelectionSession(month);
        renderHeader(month);
      }

      if (!remaining.length) {
        m.remove();
        return;
      }

      activeEntries = remaining;
      renderRows();
    });
  }

  function applyWorkingDays(dates, base, workplaceId = selectedWorkplaceId) {
    const candidates = dates.filter((date) => !getDay(workingDays, workplaceId, date));
    const conflictEntries = candidates.map((date) => buildConflictEntry(date, base, workplaceId)).filter(Boolean);
    const conflictDates = new Set(conflictEntries.map((entry) => entry.date));
    const freeDates = candidates.filter((date) => !conflictDates.has(date));
    for (const date of freeDates) {
      const day = createDay({ date, workplaceId, from: base.from, to: base.to });
      if (day) workingDays.push(day);
    }
    if (freeDates.length) saveDays(workingDays);
    if (conflictEntries.length) {
      const month = calendar?.getDisplayedMonth() || initialMonth;
      if (freeDates.length) { startSelectionSession(month); renderHeader(month); }
      openWorkingDaysConflictModal(conflictEntries, base, workplaceId);
      return;
    }
    saveDays(workingDays);
    const month = calendar?.getDisplayedMonth() || initialMonth;
    startSelectionSession(month); renderHeader(month);
  }

  function openWorkingTimePicker(dates, workplaceId = selectedWorkplaceId) {
    const content = `<div class="modal-title"><h2>Рабочее время</h2><p>У этого рабочего места время не задано. Выберите интервал для отмеченных дат. Постоянное расписание рабочего места не изменится.</p></div><div class="compact-form">${timePicker({ name: 'timetableWorkingFrom', label: 'Начало', value: '00:00' })}${timePicker({ name: 'timetableWorkingTo', label: 'Окончание', value: '00:00' })}<div class="form-error" data-timetable-working-time-error></div>${button('Применить', { data: 'data-timetable-working-time-save' })}</div>`;
    const m = mountModal(document.body, modal(content, { title: 'Рабочее время', variant: 'x' }));
    if (!m) return;
    initTimePickers(m);
    m.querySelector('[data-timetable-working-time-save]')?.addEventListener('click', () => {
      const from = m.querySelector('[name="timetableWorkingFrom"]')?.value || '';
      const to = m.querySelector('[name="timetableWorkingTo"]')?.value || '';
      const error = m.querySelector('[data-timetable-working-time-error]');
      if (!isValidRange(from, to)) {
        if (error) error.textContent = 'Окончание должно быть позже начала.';
        return;
      }
      if (error) error.textContent = '';
      m.remove();
      applyWorkingDays(dates, { from, to }, workplaceId);
    });
  }

  function openAggregateWorkplaceApply(dates) {
    const month = calendar?.getDisplayedMonth() || initialMonth;
    const monthStats = statsForMonth(month);
    const cards = workplaces.map((workplace) => {
      const key = String(workplace?.key || '');
      return workplaceGraphCard(workplace, monthStats.byWorkplace[key], {
        data: `data-timetable-apply-workplace="${escapeHtml(key)}"`,
        aria: `Добавить рабочее пространство ${workplace?.name || ''}`,
      });
    });
    const activeSummary = formatMonthStats(monthStats.aggregate);
    const layer = mountV2ZLayer(root, v2ZLayer(`${workspaceHeaderContext({
      title: 'Добавить рабочее пространство',
      a: {
        kind: 'logo',
        label: String(activeSummary.days),
        aria: `Рабочих дней: ${activeSummary.days}`,
        disabled: true,
      },
      hideD: true,
    })}${v2HorizontalRail(cards.join(''), { className: 'timetable-workplace-card-rail' })}`, { className: 'timetable-workplace-picker-layer' }), { stack: true });
    if (!layer) return;
    layer.querySelectorAll('[data-timetable-apply-workplace]').forEach((card) => {
      card.addEventListener('click', () => {
        const targetId = String(card.dataset.timetableApplyWorkplace || '');
        if (!targetId) return;
        layer.v2Close?.();
        const base = resolveWorkplaceTime(workplaces, targetId);
        if (!base) {
          openWorkingTimePicker(dates, targetId);
          return;
        }
        applyWorkingDays(dates, base, targetId);
      });
    });
  }

  function openRemovalBlockedModal(entries = []) {
    const blocked = (Array.isArray(entries) ? entries : []).filter((entry) => Array.isArray(entry?.conflicts) && entry.conflicts.length);
    if (!blocked.length) return;
    const workplace = workplaces.find((item) => String(item?.key || '') === String(selectedWorkplaceId || '')) || null;
    const workplaceName = workplace?.name || 'Рабочее пространство';
    const multiple = blocked.length > 1;
    const title = multiple ? 'Не все дни можно сделать выходными' : 'День нельзя сделать выходным';
    const description = multiple
      ? `${workplaceName}: на этих датах есть занятое время. Рабочие дни сохранены.`
      : `${workplaceName}: на этой дате есть занятое время. Рабочий день сохранён.`;
    const rows = blocked.map((entry) => {
      const details = entry.conflicts
        .filter((conflict) => conflict?.from && conflict?.to)
        .map((conflict) => `${occupiedLabel(conflict)} ${conflict.from}–${conflict.to}`)
        .join(', ');
      return `<div><span>${escapeHtml(formatDateLabel(entry.date))}</span><strong>${escapeHtml(details || 'Есть занятое время')}</strong></div>`;
    }).join('');
    const content = `<div class="modal-title"><h2>${escapeHtml(title)}</h2><p>${escapeHtml(description)}</p></div><div class="entity-details">${rows}</div>${button('Понятно', { data: 'data-removal-blocked-close' })}`;
    const m = mountModal(document.body, modal(content, { title, variant: 'x' }));
    if (!m) return;
    m.querySelector('[data-removal-blocked-close]')?.addEventListener('click', () => m.remove());
  }

  function openSelectedWorkingTimeCorrection(dates = selection?.getSelectedDates?.() || []) {
    const selected = (Array.isArray(dates) ? dates : []).filter((date) => getDay(workingDays, selectedWorkplaceId, date));
    if (!selected.length || isAllMode()) return;

    const first = getDayTime(getDay(workingDays, selectedWorkplaceId, selected[0]), workplaces)
      || resolveWorkplaceTime(workplaces, selectedWorkplaceId)
      || { from: '09:00', to: '18:00' };

    const content = `<div class="compact-form">
      <div class="modal-title"><h2>Время работы</h2><p>Изменение применяется к выбранным рабочим датам.</p></div>
      <div class="time-range-fields">
        ${timePicker({ name: 'timetableCorrectionFrom', label: 'С', value: first.from, minuteStep: 1 })}
        ${timePicker({ name: 'timetableCorrectionTo', label: 'До', value: first.to, minuteStep: 1 })}
      </div>
      <div class="form-error" data-timetable-correction-error aria-live="polite"></div>
      ${button('Сохранить', { data: 'data-timetable-correction-save' })}
    </div>`;

    const m = mountModal(document.body, modal(content, { title: 'Время работы', variant: 'x' }));
    if (!m) return;
    initTimePickers(m);

    m.querySelector('[data-timetable-correction-save]')?.addEventListener('click', () => {
      const from = m.querySelector('[name="timetableCorrectionFrom"]')?.value || '';
      const to = m.querySelector('[name="timetableCorrectionTo"]')?.value || '';
      const error = m.querySelector('[data-timetable-correction-error]');
      if (!isValidRange(from, to)) {
        if (error) error.textContent = 'Окончание должно быть позже начала.';
        return;
      }

      for (const date of selected) {
        const usage = getWorkingTimeUsageConflicts({ date, workplaceId: selectedWorkplaceId, from, to })
          .filter((item) => item?.from && item?.to);
        if (usage.length) {
          if (error) error.textContent = `${formatDateLabel(date)}: ${usage.map((item) => `${occupiedLabel(item)} ${item.from}–${item.to}`).join(', ')} выходит за рабочее время.`;
          return;
        }

        const schedule = getScheduleConflicts(workingDays, {
          workplaceId: selectedWorkplaceId,
          date,
          from,
          to,
        });
        if (schedule.length) {
          if (error) error.textContent = `${formatDateLabel(date)}: время пересекается с другим рабочим пространством.`;
          return;
        }
      }

      selected.forEach((date) => updateDayTime(workingDays, selectedWorkplaceId, date, from, to));
      saveDays(workingDays);
      const month = calendar?.getDisplayedMonth() || initialMonth;
      m.v2Close?.();
      startSelectionSession(month);
      renderHeader(month);
    });
  }
  function openTimetableSettingsMenu() {
    const dates = selection?.getSelectedDates?.() || [];
    const canEditTime = !isAllMode() && dates.some((date) => getDay(workingDays, selectedWorkplaceId, date));
    const content = `<div class="compact-form">
      ${canEditTime ? button('Время работы', { variant: 'secondary', data: 'data-timetable-settings-time' }) : ''}
      ${button('Рабочее пространство', { variant: 'secondary', data: 'data-timetable-settings-workplace' })}
    </div>`;
    const m = mountModal(document.body, modal(content, { title: 'Настройки графика', variant: 'x' }));
    if (!m) return;
    m.querySelector('[data-timetable-settings-time]')?.addEventListener('click', () => {
      const selectedDates = selection?.getSelectedDates?.() || [];
      m.v2Close?.();
      openSelectedWorkingTimeCorrection(selectedDates);
    });
    m.querySelector('[data-timetable-settings-workplace]')?.addEventListener('click', () => {
      m.v2Close?.();
      openTimetableSettingsZ2();
    });
  }

  function openTimetableSettingsZ2() {
    const month = calendar?.getDisplayedMonth() || initialMonth;
    const monthStats = statsForMonth(month);
    const activeStats = isAllMode() ? monthStats.aggregate : monthStats.byWorkplace[selectedWorkplaceId];
    const activeSummary = formatMonthStats(activeStats);
    const cards = [
      aggregateGraphCard(monthStats.aggregate, {
        data: `data-timetable-settings-select="${ALL_WORKPLACES_ID}"`,
      }),
      ...workplaces.map((workplace) => {
        const key = String(workplace?.key || '');
        return workplaceGraphCard(workplace, monthStats.byWorkplace[key], {
          data: `data-timetable-settings-select="${escapeHtml(key)}"`,
        });
      }),
    ];
    const layer = mountV2ZLayer(root, v2ZLayer(`${workspaceHeaderContext({
      title: 'Настройки графика',
      a: {
        kind: 'logo',
        label: String(activeSummary.days),
        aria: `Рабочих дней: ${activeSummary.days}`,
        disabled: true,
      },
      hideD: true,
    })}${v2HorizontalRail(cards.join(''), { className: 'timetable-settings-card-rail' })}${(!isAllMode() && (selection?.getSelectedDates?.() || []).some((date) => getDay(workingDays, selectedWorkplaceId, date))) ? actionBlock(button('Время', { type: 'button', data: 'data-timetable-correct-selected-time', aria: 'Изменить время выбранных рабочих дней' })) : ''}`, { className: 'timetable-settings-layer' }), { stack: true });
    if (!layer) return;
    layer.querySelector('[data-timetable-correct-selected-time]')?.addEventListener('click', () => {
      const dates = selection?.getSelectedDates?.() || [];
      layer.v2Close?.();
      openSelectedWorkingTimeCorrection(dates);
    });
    layer.querySelectorAll('[data-timetable-settings-select]').forEach((card) => {
      card.addEventListener('click', () => {
        const nextId = String(card.dataset.timetableSettingsSelect || '');
        if (!nextId) return;
        selectedWorkplaceId = nextId;
        if (selectedWorkplaceId === ALL_WORKPLACES_ID) setWorkplaceContext({ date: month });
        else setWorkplaceContext({ workplaceId: selectedWorkplaceId, date: month });
        layer.v2Close?.();
        startSelectionSession(month);
        renderHeader(month);
      });
    });
  }

  bindHeaderContext();
  if (workplaces.length) startSelectionSession(initialMonth); else calendar = initCalendar(calendarRoot, { month: initialMonth, workingDates: [] });

  applyButton.addEventListener('click', () => {
    const dates = selection?.getSelectedDates?.() || [];
    if (!dates.length || !selectionMode) return;
    if (isAllMode()) {
      openAggregateWorkplaceApply(dates);
      return;
    }
    const makeWorking = selectionMode === 'make-working';
    if (makeWorking) {
      const base = resolveWorkplaceTime(workplaces, selectedWorkplaceId);
      if (!base) {
        openWorkingTimePicker(dates);
        return;
      }
      applyWorkingDays(dates, base);
      return;
    }

    const blockedRemoval = [];
    for (const date of dates) {
      if (removeDay(workingDays, selectedWorkplaceId, date)) continue;
      const conflicts = getDayRemovalConflicts(selectedWorkplaceId, date);
      if (conflicts.length) blockedRemoval.push({ date, conflicts });
    }
    saveDays(workingDays); const month = calendar.getDisplayedMonth(); startSelectionSession(month); renderHeader(month);
    if (blockedRemoval.length) openRemovalBlockedModal(blockedRemoval);
  });

  let refreshQueued = false;
  const syncCanonicalState = () => {
    if (refreshQueued) return;
    refreshQueued = true;
    queueMicrotask(() => {
      refreshQueued = false;
      if (!root.isConnected) return;
      const nextWorkplaces = getWorkplaces();
      const nextDays = getDays();
      workplaces.splice(0, workplaces.length, ...nextWorkplaces);
      workingDays.splice(0, workingDays.length, ...nextDays);
      if (!isAllMode() && !workplaces.some((item) => String(item?.key || '') === String(selectedWorkplaceId || ''))) {
        selectedWorkplaceId = getWorkplaceContext(workplaces).workplaceId;
      }
      const month = calendar?.getDisplayedMonth?.() || initialMonth;
      if (workplaces.length) startSelectionSession(month);
      else calendar = initCalendar(calendarRoot, { month, workingDates: [] });
      renderHeader(month);
    });
  };
  window.addEventListener('book:time-usage-changed', syncCanonicalState);
  window.addEventListener('book:workplaces-changed', syncCanonicalState);

  return () => {
    window.removeEventListener('book:time-usage-changed', syncCanonicalState);
    window.removeEventListener('book:workplaces-changed', syncCanonicalState);
    selection?.destroy?.();
  };
}
