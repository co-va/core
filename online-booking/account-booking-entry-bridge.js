import { getGlobalAccountRecords } from '../core/account/index.js';

let selectedTenantId = '';
let selectedWorkplaceKey = '';
let selectedHistory = null;

function text(value) {
  return String(value ?? '').trim();
}

function requestMoment(request = {}) {
  return `${text(request.date).slice(0, 10)}T${text(request.from || '00:00').padStart(5, '0')}`;
}

function requestProcedures(request = {}) {
  return Array.isArray(request.procedures) ? request.procedures : [];
}

function rememberContext(target) {
  const relationship = target.closest?.('[data-global-relationship]');
  if (relationship) {
    selectedTenantId = text(relationship.dataset.globalRelationship);
    selectedWorkplaceKey = '';
    selectedHistory = null;
    return;
  }

  const workplace = target.closest?.('[data-global-contact-workplace]');
  if (workplace) {
    selectedWorkplaceKey = text(workplace.dataset.globalContactWorkplace);
    selectedHistory = null;
    return;
  }

  const contactHistory = target.closest?.('[data-global-contact-history]');
  if (contactHistory) {
    selectedHistory = {
      index: Math.max(0, Number(contactHistory.dataset.globalContactHistory) || 0),
      workplaceOnly: false,
    };
    return;
  }

  const workplaceHistory = target.closest?.('[data-global-workplace-history]');
  if (workplaceHistory) {
    selectedHistory = {
      index: Math.max(0, Number(workplaceHistory.dataset.globalWorkplaceHistory) || 0),
      workplaceOnly: true,
    };
  }
}

async function repeatSelection() {
  if (!selectedTenantId || !selectedHistory) return { workplaceKey: selectedWorkplaceKey, procedureIds: [] };
  const records = await getGlobalAccountRecords().catch(() => []);
  const rows = (Array.isArray(records) ? records : [])
    .filter((record) => text(record?.tenantId) === selectedTenantId)
    .filter((record) => !selectedHistory.workplaceOnly
      || text(record?.workplaceId || record?.workplaceKey) === selectedWorkplaceKey)
    .sort((a, b) => requestMoment(b).localeCompare(requestMoment(a)));
  const request = rows[selectedHistory.index] || null;
  if (!request) return { workplaceKey: selectedWorkplaceKey, procedureIds: [] };
  return {
    workplaceKey: text(request.workplaceId || request.workplaceKey || selectedWorkplaceKey),
    procedureIds: requestProcedures(request).map((item) => text(item?.id)).filter(Boolean),
  };
}

async function openInternalBooking(button) {
  if (!selectedTenantId) return false;
  const isRepeat = text(button.textContent).includes('Повторить')
    || Boolean(button.closest?.('.account-contact-history-z'));
  const preset = isRepeat
    ? await repeatSelection()
    : { workplaceKey: selectedWorkplaceKey, procedureIds: [] };

  window.dispatchEvent(new CustomEvent('cova:account-start-booking', {
    detail: {
      tenantId: selectedTenantId,
      workplaceKey: preset.workplaceKey,
      procedureIds: preset.procedureIds,
      source: isRepeat ? 'repeat' : 'contact',
    },
  }));
  return true;
}

document.addEventListener('click', (event) => {
  const target = event.target instanceof Element ? event.target : null;
  if (!target) return;
  rememberContext(target);

  const booking = target.closest('[data-global-contact-booking]');
  if (!booking || !selectedTenantId) return;

  event.preventDefault();
  event.stopImmediatePropagation();
  void openInternalBooking(booking);
}, true);
