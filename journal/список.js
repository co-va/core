import { ALL_WORKPLACES_ID, emptyState, escapeHtml, v2ListEntries, v2ListEntry, shortDate } from '../ui/ui.js';
import { getWorkplaces } from '../core/workplace-time.js';
import { getRecordPaymentState, recordAmountDue } from '../core/finance/index.js';
import { getRecords } from '../core/record/index.js';
import { isRecordCompletedSide, recordActivityTime, recordAppointmentTime, recordVisualState } from '../core/record/index.js';
import { openRecordView } from '../core/records/view.js';

function journalContext(value = 'professional') {
  return String(value || '').trim().toLowerCase() === 'account' ? 'account' : 'professional';
}

function readRecords(source, contextName) {
  if (contextName !== 'account' && source == null) return getRecords();
  const value = typeof source === 'function' ? source() : source;
  return Array.isArray(value) ? value : [];
}

function formatMoney(value = 0) {
  const amount = Math.max(0, Math.round(Number(value) || 0));
  return `${amount.toLocaleString('ru-RU').replaceAll('\u00a0', ' ')} ₽`;
}

function personName(person = {}, fallback = 'Человек') {
  return [person?.name, person?.surname].filter(Boolean).join(' ').trim() || fallback;
}

function workplaceName(workplaces, workplaceId) {
  const workplace = workplaces.find((item) => String(item?.key || '') === String(workplaceId || ''));
  return workplace?.name || 'Рабочее место';
}

function recordPresentation(record, contextName, workplaces, resolveRecordContext) {
  if (contextName !== 'account') {
    return {
      workplace: workplaceName(workplaces, record?.workplaceId),
      person: record?.person || {},
    };
  }
  const resolved = typeof resolveRecordContext === 'function' ? (resolveRecordContext(record) || {}) : {};
  const professional = resolved?.professional && typeof resolved.professional === 'object' ? resolved.professional : {};
  const workplace = resolved?.workplace && typeof resolved.workplace === 'object' ? resolved.workplace : {};
  return {
    workplace: String(workplace?.name || workplace?.title || 'Рабочее пространство'),
    person: professional,
  };
}

function paymentFor(record, contextName) {
  if (contextName === 'account') {
    const payment = record?.payment && typeof record.payment === 'object' ? record.payment : null;
    const state = String(payment?.state || '').trim().toLowerCase();
    const due = Math.max(0, Number(payment?.due) || 0);
    const paidAmount = Math.max(0, Number(payment?.paid) || 0);
    const paid = state ? state === 'paid' : Boolean(payment && due <= 0.009 && paidAmount > 0.009);
    if (paid) {
      return {
        paid: true,
        activity: {
          paidAt: payment?.paidAt || payment?.updatedAt || record?.updatedAt || record?.date || '',
        },
      };
    }
    const planTotal = Math.max(0, Number(record?.finance?.planTotal) || 0);
    const factTotal = Math.max(0, Number(record?.finance?.factTotal) || 0);
    const paidFromFinance = planTotal > 0.009 && factTotal + 0.009 >= planTotal;
    return {
      paid: paidFromFinance,
      activity: paidFromFinance ? { paidAt: record?.updatedAt || record?.date || '' } : null,
    };
  }
  const state = getRecordPaymentState(record);
  return {
    paid: Boolean(state.fullyPaid),
    activity: state.fullyPaid ? state.latestPayment : null,
  };
}

function displayAmountDue(record = null, contextName = 'professional') {
  if (contextName === 'account') {
    const planTotal = Number(record?.finance?.planTotal);
    if (Number.isFinite(planTotal)) return Math.max(0, planTotal);
  }
  if (contextName === 'account') {
    return [...(Array.isArray(record?.procedures) ? record.procedures : []), ...(Array.isArray(record?.products) ? record.products : [])]
      .reduce((sum, item) => sum + Math.max(0, Number(item?.cost ?? item?.price) || 0), 0);
  }
  return recordAmountDue(record);
}

function recordStatusClass(record, paid = false) {
  return `journal-list-record--${recordVisualState(record, { paid })}`;
}

function recordId(record) {
  return String(record?.id || record?.sourceId || '');
}

function recordEntry(record, workplaces, {
  contextName = 'professional',
  resolveRecordContext = () => ({}),
  focus = false,
  paid = false,
} = {}) {
  const presentation = recordPresentation(record, contextName, workplaces, resolveRecordContext);
  const name = personName(presentation.person, contextName === 'account' ? 'Профессионал' : 'Человек');
  const classes = [recordStatusClass(record, paid), focus ? 'journal-list-focus' : ''].filter(Boolean).join(' ');
  const id = recordId(record);
  const accountSubtitle = contextName === 'account'
    ? (presentation.person?.phone || presentation.person?.uei || '')
    : (record?.person?.phone || '');
  return v2ListEntry({
    overline: presentation.workplace,
    title: name,
    subtitle: accountSubtitle,
    rightTop: [shortDate(record?.date), String(record?.from || '')].filter(Boolean).join(' · '),
    rightBottom: formatMoney(displayAmountDue(record, contextName)),
    interactive: Boolean(id),
    data: id ? `data-journal-list-record="${escapeHtml(id)}"` : '',
    aria: id ? `Открыть запись ${name}` : '',
    className: classes,
    initial: (name || '?').slice(0, 1).toUpperCase(),
  });
}

function anchorEntry() {
  return '<div class="journal-list-anchor" data-journal-list-anchor aria-hidden="true"></div>';
}

function scrollToFocus(root, selector) {
  requestAnimationFrame(() => {
    const node = root.querySelector(selector);
    if (!node) return;
    const rootTop = root.getBoundingClientRect().top;
    const nodeTop = node.getBoundingClientRect().top;
    root.scrollTop += nodeTop - rootTop;
  });
}

function bindRecordClicks(root, records, { contextName, resolveRecordContext }) {
  if (typeof root?.querySelectorAll !== 'function') return;
  const byId = new Map(records.map((record) => [recordId(record), record]).filter(([id]) => Boolean(id)));
  root.querySelectorAll('[data-journal-list-record]').forEach((node) => node.addEventListener('click', () => {
    const record = byId.get(String(node.dataset.journalListRecord || ''));
    if (!record) return;
    if (contextName === 'account') {
      const presentation = typeof resolveRecordContext === 'function' ? (resolveRecordContext(record) || {}) : {};
      openRecordView(record, { context: 'account', professional: presentation?.professional || null });
      return;
    }
    openRecordView(record);
  }));
}

function renderTimeMode(root, records, workplaces, { contextName, resolveRecordContext }) {
  const now = Date.now();
  const ordered = [...records].sort((a, b) => recordAppointmentTime(a, 'from') - recordAppointmentTime(b, 'from'));
  const focusIndex = ordered.findIndex((record) => recordAppointmentTime(record, 'to') > now);
  const splitIndex = focusIndex >= 0 ? focusIndex : ordered.length;
  const entries = ordered.flatMap((record, index) => {
    const payment = paymentFor(record, contextName);
    const row = recordEntry(record, workplaces, {
      contextName,
      resolveRecordContext,
      focus: index === splitIndex,
      paid: payment.paid,
    });
    return index === splitIndex ? [anchorEntry(), row] : [row];
  });
  if (splitIndex === ordered.length) entries.push(anchorEntry());

  root.innerHTML = v2ListEntries(entries);
  bindRecordClicks(root, ordered, { contextName, resolveRecordContext });
  scrollToFocus(root, '[data-journal-list-anchor]');
}

function renderFlowMode(root, records, workplaces, { contextName, resolveRecordContext }) {
  const now = Date.now();
  const prepared = records.map((record) => {
    const payment = paymentFor(record, contextName);
    const completed = isRecordCompletedSide(record, { paid: payment.paid, now });
    return { record, payment, completed };
  });
  const completed = prepared
    .filter((item) => item.completed)
    .sort((a, b) => recordActivityTime(a.record, a.payment.activity, { completed: true }) - recordActivityTime(b.record, b.payment.activity, { completed: true }));
  const pending = prepared
    .filter((item) => !item.completed)
    .sort((a, b) => recordActivityTime(b.record, b.payment.activity) - recordActivityTime(a.record, a.payment.activity));

  const entries = [
    ...completed.map(({ record, payment }) => recordEntry(record, workplaces, {
      contextName,
      resolveRecordContext,
      paid: payment.paid,
    })),
    anchorEntry(),
    ...pending.map(({ record, payment }) => recordEntry(record, workplaces, {
      contextName,
      resolveRecordContext,
      paid: payment.paid,
    })),
  ];
  root.innerHTML = v2ListEntries(entries);
  bindRecordClicks(root, records, { contextName, resolveRecordContext });
  scrollToFocus(root, '[data-journal-list-anchor]');
}

export function renderJournalList(root, { mode = 'flow', workplaceId = ALL_WORKPLACES_ID } = {}) {
  const options = arguments[1] && typeof arguments[1] === 'object' ? arguments[1] : {};
  const contextName = journalContext(options.context);
  const accountMode = contextName === 'account';
  const records = options.records ?? null;
  const resolveRecordContext = typeof options.resolveRecordContext === 'function' ? options.resolveRecordContext : () => ({});
  root.dataset.journalListContext = contextName;
  const workplaces = accountMode ? [] : getWorkplaces();
  const allRecords = readRecords(records, contextName);
  const visibleRecords = accountMode
    ? allRecords
    : workplaceId === ALL_WORKPLACES_ID
      ? allRecords
      : allRecords.filter((record) => String(record?.workplaceId || '') === String(workplaceId || ''));

  if (!visibleRecords.length) {
    root.innerHTML = emptyState('Список', 'Записей пока нет.');
    return;
  }

  const renderOptions = { contextName, resolveRecordContext };
  if (mode === 'time') renderTimeMode(root, visibleRecords, workplaces, renderOptions);
  else renderFlowMode(root, visibleRecords, workplaces, renderOptions);
}
