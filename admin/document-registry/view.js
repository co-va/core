import { openDocumentEditor } from './editor.js';
import { documentPage } from '../../ui/documents/index.js';
import { modal, mountModal } from '../../ui/modals/index.js';
import {
  getRegistryBookUserDocuments,
  getRegistryUserHelperTemplates,
  getRegistryUserLegalTemplates,
  getRegistryPlatformUserDocuments,
  getRegistryDocument,
} from './catalog.js';
import {
  getDocumentRegistryHistory,
  hydrateDocumentRegistryHistory,
} from './history.js';

// The registry is a single three-section document list. The source catalog and
// persisted signing history stay canonical and are never copied into this view.
const DOCUMENT_ICON = '<svg class="admin-registry-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h8l4 4v14H6z"/><path d="M14 3v5h5M9 12h6M9 16h6"/></svg>';
const ADD_DOCUMENT_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M5 3h9l4 4v5M14 3v5h4M5 3v18h8M16 15v8M12 19h8"/></svg>';
const escapeDocument = (value) => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');


// Short labels are for Admin's index only; legal source titles stay intact.
const SHORT_TITLES = Object.freeze({
  'privacy-policy': 'Политика ПДН',
  'saas-agreement': 'Оферта',
  'platform-processor-consent': 'Согласие Амвера',
  'marketing-consent': 'Маркетинг',
  'public-profile-consent': 'Публичный профиль',
  'dpa': 'Поручение ПДН',
  'rkn-notification-guide-template': 'Инструкция РКН',
  'user-document-pdn-policy': 'Политика ПДН',
  'user-document-pdn-consent': 'Согласие ПДН',
  'user-document-messages-consent': 'Маркетинг',
  'account-terms': 'Условия аккаунта',
  'platform-privacy-policy': 'Политика ПДН',
});

// Source content provenance: Git commits that introduced/last changed these
// exact, still-current unnumbered texts. Used only when the persisted version
// has no publishedAt, not as a fabricated legal edition or signature date.
const SOURCE_CONTENT_LAST_EDITED = Object.freeze({
  'user-document-pdn-policy': '18.09.2026', // 28223eb4658c
  'user-document-pdn-consent': '18.09.2026', // 28223eb4658c
  'user-document-messages-consent': '18.09.2026', // 28223eb4658c
  'rkn-notification-guide-template': '03.10.2026', // f9564343a31a
  'account-terms': '21.09.2026', // canonical 20260921143000_account_terms migration
});

// Only an explicitly published legal edition counts as a registry revision.
function legalEdition(content) {
  const header = String(content || '').split(/\r?\n/).slice(0, 8).join('\n');
  return header.match(/(?:юридическая\s+)?(?:редакция|версия)\s+(\d+(?:\.\d+)*)(?=\s|$)/i)?.[1] || '';
}

// The document header's issue date takes precedence over its technical
// publication timestamp. Unsigned templates without either stay undated.
function legalEditionDate(content) {
  const header = String(content || '').split(/\r?\n/).slice(0, 8).join('\n');
  const match = header.match(/(?:юридическая\s+)?редакция\s+\d+(?:\.\d+)*\s+от\s+(\d{2}\.\d{2}\.\d{4})(?=\s|$)/i);
  if (!match) return '';
  const [day, month, year] = match[1].split('.').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
    ? match[1] : '';
}

function publishedDocumentDate(item) {
  const fromLegalText = legalEditionDate(item?.content);
  if (fromLegalText) return fromLegalText;
  if (!item?.publishedAt) return item?.issuedAt || SOURCE_CONTENT_LAST_EDITED[item?.key] || '—';
  const date = new Date(item.publishedAt);
  if (!Number.isFinite(date.getTime())) return SOURCE_CONTENT_LAST_EDITED[item?.key] || '—';
  return [String(date.getUTCDate()).padStart(2, '0'), String(date.getUTCMonth() + 1).padStart(2, '0'), String(date.getUTCFullYear())].join('.');
}

function formatEventMoment(value) {
  const moment = new Date(value || '');
  if (!Number.isFinite(moment.getTime())) return { date: '—', time: '' };
  return {
    date: moment.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' }),
    time: moment.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }),
  };
}

function actionLabel(value) {
  const action = String(value || '').toUpperCase();
  if (action === 'ACCEPTED') return 'Принято';
  if (action === 'ACKNOWLEDGED') return 'Ознакомлен';
  if (action === 'CONSENTED') return 'Согласие дано';
  if (action === 'REVOKED') return 'Отозвано';
  if (action === 'DECLINED') return 'Отклонено';
  if (action === 'SUPERSEDED') return 'Редакция заменена';
  return action || 'Событие';
}

function actionState(value) {
  const action = String(value || '').toUpperCase();
  if (action === 'REVOKED') return 'suspended';
  if (action === 'DECLINED') return 'pending';
  return 'active';
}

function sectionMarkup(title, application, body, escapeHtml, extra = '') {
  const app = String(application || '').toLowerCase();
  const canCreate = app === 'professional' || app === 'user';
  return '<section class="admin-users-section admin-registry-section' +
    (canCreate ? '' : ' admin-registry-history-section') + '" ' + extra + '>' +
    (canCreate ? '<div class="admin-registry-section-title-line">' : '') +
    '<h2 class="admin-users-section-title">' + escapeHtml(title) +
      (application ? '<span class="admin-registry-app"> / ' + escapeHtml(application) + '</span>' : '') + '</h2>' +
    (canCreate ? '<button type="button" class="admin-registry-add" data-registry-add="' + app +
      '" aria-label="Добавить документ в ' + escapeHtml(title) + '" title="Добавить документ">' + ADD_DOCUMENT_ICON + '</button></div>' : '') +
    body + '</section>';
}

// A label describes the document's purpose, never whether this administrator signed it.
function documentPurpose(item) {
  const chosen = { REQUIRED: 'Обязательно', OPTIONAL: 'Необязательно',
    READING: 'Ознакомление', REFERENCE: 'Справочный' }[String(item?.purpose || '')];
  if (chosen) return chosen;
  if (item.key === 'platform-privacy-policy') return 'Ознакомление';
  if (item.type === 'RKN_GUIDE_TEMPLATE') return 'Справочный';
  // These working templates are provided to Professional but define the
  // downstream purpose for that Professional's own User-facing documents.
  if (item.type === 'USER_DOCUMENT_BASE') {
    if (item.key === 'user-document-pdn-policy') return 'Ознакомление';
    if (item.key === 'user-document-pdn-consent') return 'Обязательно';
    return 'Необязательно';
  }
  return item.requiredForRegistration ? 'Обязательно' : 'Необязательно';
}

function purposeMarkup(value, status) {
  const kind = value === 'Обязательно' ? 'required'
    : value === 'Необязательно' ? 'optional'
      : value === 'Справочный' ? 'reference' : 'reading';
  const symbol = kind === 'required' ? '✓' : kind === 'optional' ? '–'
    : kind === 'reference' ? 'i' : '•';
  return '<span class="admin-registry-purpose is-' + kind +
    (status === 'Рабочий' ? ' is-working' : ' is-platform') +
    '"><span class="admin-registry-purpose-mark" aria-hidden="true">' + symbol +
    '</span><span>' + value + '</span></span>';
}

// Status describes the document's parties, not whether an individual signed it.
function documentStatus(item) {
  return item.key === 'rkn-notification-guide-template'
    || item.type === 'USER_DOCUMENT_BASE'
    || item.type === 'CUSTOM_WORKING'
    ? 'Рабочий' : 'Правовой';
}

function documentStatusMarkup(item, hasDraft = false) {
  const status = documentStatus(item);
  // A draft is not a second document row: indicate it in the existing status cell.
  return '<span class="admin-pill' +
    (hasDraft ? ' admin-registry-status-draft' : status === 'Правовой' ? ' active' : ' working') +
    '">' + status + (hasDraft ? ' · Черновик' : '') + '</span>';
}

// A platform-supplied working base has an explicit source version in
// PlatformDocumentVersion. A Professional's private edits are NOT this version.
// The RKN instruction stays unversioned as an informational helper.
function sourceEdition(item) {
  if (item?.editorEdition) return String(item.editorEdition);
  const legal = legalEdition(item?.content);
  if (legal) return legal;
  if (item?.type === 'USER_DOCUMENT_BASE') {
    const version = Number(item?.version);
    return Number.isSafeInteger(version) && version > 0 ? String(version) : '…';
  }
  return item?.edition || '—';
}

function documentTable(items, escapeHtml, application, draftKeys = new Set()) {
  const rows = items.map((item) => {
    const title = escapeHtml(item.title || 'Документ');
    const shortTitle = escapeHtml(SHORT_TITLES[item.key] || item.title || 'Документ');
    const edition = escapeHtml(sourceEdition(item));
    const publicationDate = escapeHtml(publishedDocumentDate(item));
    const key = escapeHtml(item.key || '');
    const purpose = documentPurpose(item);
    return '<tr data-registry-row="' + key + '" tabindex="0" role="button" aria-label="Просмотреть ' + title + '">' +
      '<td data-label="Документ" title="' + title + '"><strong class="admin-registry-title">' + shortTitle + '</strong></td>' +
      '<td data-label="Версия"><span class="admin-registry-version" data-registry-version="' + key + '">' + edition + '</span></td>' +
      '<td data-label="Назначение">' + purposeMarkup(purpose, documentStatus(item)) + '</td>' +
      '<td data-label="Дата"><time class="admin-registry-published-date" data-registry-date="' + key + '">' + publicationDate + '</time></td>' +
      '<td data-label="Статус">' + documentStatusMarkup(item, draftKeys.has(item.key)) + '</td>' +
      '<td data-label="Открыть" class="admin-registry-open-cell"><button type="button" class="admin-registry-open admin-registry-open-icon" data-registry-document="' + key +
      '" aria-label="Редактировать документ ' + title + '" title="Редактировать: ' + title + '"' +
      (item.content || draftKeys.has(item.key) ? '' : ' disabled aria-disabled="true"') + '>' + DOCUMENT_ICON + '</button></td>' +
      '</tr>';
  }).join('');
  return '<div class="admin-card"><div class="admin-registry-documents-scroll"><table class="admin-table admin-registry-table admin-registry-documents-table" data-registry-application="' + application + '">' +
    '<thead><tr><th>Документ</th><th>Версия</th><th>Назначение</th><th>Дата</th><th>Статус</th><th aria-label="Открыть"></th></tr></thead><tbody>' +
    (rows || '<tr><td colspan="6" class="admin-history-empty">Документов пока нет.</td></tr>') +
    '</tbody></table></div></div>';
}

// Short presentation labels never replace the original immutable signed title.
function historyShortTitle(item) {
  const title = String(item.documentTitle || item.documentKey || 'Документ');
  if (SHORT_TITLES[item.documentKey]) return SHORT_TITLES[item.documentKey];
  if (/пользовательское соглашение|публичная оферта/i.test(title)) return 'Оферта';
  if (/условия использования уч[её]тной записи/i.test(title)) return 'Условия аккаунта';
  if (/согласие на.*(?:реклам|маркетингов)/i.test(title)) return 'Маркетинг';
  if (/согласие на поручение.*амвер/i.test(title)) return 'Согласие Амвера';
  if (/согласие на обработку персональных данных/i.test(title)) return 'Согласие ПДН';
  if (/политика обработки персональных данных/i.test(title)) return 'Политика ПДН';
  if (/согласие на распространение персональных данных/i.test(title)) return 'Публичный профиль';
  if (/поручение на обработку персональных данных/i.test(title)) return 'Поручение ПДН';
  return title;
}

function historyTable(escapeHtml, archivedVersions = []) {
  const snapshots = (Array.isArray(archivedVersions) ? archivedVersions : []).map((row) => ({
    ...row,
    id: 'revision-' + row.id,
    __archive: true,
    accountEmail: 'Архив редакций',
    subjectType: row.application === 'user' ? 'ACCOUNT' : 'PLATFORM_ACCOUNT',
    occurredAt: row.supersededAt,
    action: 'SUPERSEDED',
  }));
  const history = [...snapshots, ...getDocumentRegistryHistory()];
  if (!history.length) {
    return '<div class="admin-card admin-history-empty">Событий пока нет.</div>';
  }
  const rows = history.map((item) => {
    const title = escapeHtml(item.documentTitle || item.documentKey || 'Документ');
    const shortTitle = escapeHtml(historyShortTitle(item));
    const id = escapeHtml(item.id || '');
    const version = escapeHtml(item.editorEdition || legalEdition(item.documentContent) ||
      (item.__archive ? String(item.documentVersion || '—') : '—'));
    const archiveVersion = escapeHtml(String(item.documentVersion || ''));
    const account = escapeHtml(item.accountEmail || item.tenantName || '—');
    const subject = item.subjectType === 'ACCOUNT' ? 'User' : 'Professional';
    const action = escapeHtml(actionLabel(item.action));
    const status = actionState(item.action);
    const moment = formatEventMoment(item.occurredAt);
    return '<tr data-registry-history-row="' + id + '" tabindex="0" role="button" aria-label="Просмотреть архивный документ">' +
      '<td data-label="Документ" title="' + title + '"><strong class="admin-registry-title">' + shortTitle + '</strong></td>' +
      '<td data-label="Версия"><span class="admin-registry-version" title="Архивная копия ' + archiveVersion + '">' + version + '</span></td>' +
      '<td data-label="Аккаунт"><span class="admin-registry-history-account" title="' + account + ' · ' + subject + '">' +
      '<span class="admin-registry-account-email">' + account + '</span><small class="admin-registry-account-app">' + subject + '</small></span></td>' +
      '<td data-label="Дата"><time class="admin-registry-history-moment" datetime="' + escapeHtml(item.occurredAt || '') + '">' +
      '<span class="admin-registry-event-date">' + escapeHtml(moment.date) + '</span>' +
      '<small class="admin-registry-event-time">' + escapeHtml(moment.time) + '</small></time></td>' +
      '<td data-label="Событие"><span class="admin-pill ' + status + '">' + action + '</span></td>' +
      '<td data-label="Открыть" class="admin-registry-open-cell"><button type="button" class="admin-registry-open admin-registry-open-icon" data-registry-history="' + id +
      '" aria-label="Открыть сохранённый документ ' + title + '" title="Открыть: ' + title + '">' + DOCUMENT_ICON + '</button></td></tr>';
  }).join('');
  return '<div class="admin-card admin-registry-history-card"><div class="admin-registry-history-scroll"><table class="admin-table admin-registry-table admin-registry-history-table">' +
    '<thead><tr><th>Документ</th><th>Версия</th><th>Аккаунт</th><th>Дата</th><th>Событие</th><th aria-label="Открыть"></th></tr></thead><tbody>' +
    rows + '</tbody></table></div></div>';
}

function openDocument(item) {
  if (!item) return null;
  const title = item.title || item.documentTitle || 'Документ';
  const content = item.content || item.documentContent || '';
  // Both current and signed archived document readers show the revision
  // actually stated in that snapshot; the archive index is not a legal edition.
  const version = item.editorEdition || legalEdition(content) ||
    (item.__archive ? String(item.documentVersion || '') : item.type === 'USER_DOCUMENT_BASE' ? sourceEdition(item) : '');
  const sharedQ = Boolean(document.querySelector('.admin-mobile-app'));
  const heading = escapeDocument(title);
  const fixedHeader = sharedQ
    ? '<div><h3>Документ</h3></div>'
    : '<div><span class="admin-document-head-version">Версия ' + escapeDocument(version || '—') +
      '</span><h3>' + heading + '</h3></div>';
  let backdrop = document.createElement('div');
  backdrop.className = 'admin-drawer-backdrop admin-document-drawer-backdrop';
  backdrop.innerHTML = '<aside class="admin-drawer admin-document-drawer" role="dialog" aria-modal="true" aria-label="Просмотр документа">' +
    '<div class="admin-drawer-head">' + fixedHeader +
    '<button type="button" class="admin-close" data-close aria-label="Закрыть">×</button></div>' +
    '<div class="admin-document-reading">' + documentPage({ title, version, content }) + '</div></aside>';

  // Reuse the same desktop drawer and mobile shared Q as Users / Tools.
  if (sharedQ) {
    const html = modal(backdrop.innerHTML, { title: 'Документ', variant: 'q', className: 'admin-document-q' });
    const mounted = mountModal(document.querySelector('[data-v2-app]'), html);
    if (!mounted) return null;
    backdrop = mounted;
  } else {
    document.body.append(backdrop);
  }
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onEscape);
    if (sharedQ) backdrop.v2Close?.();
    else backdrop.remove();
  };
  const onEscape = (event) => { if (event.key === 'Escape') close(); };
  backdrop.querySelectorAll('[data-close]').forEach((button) => button.addEventListener('click', close));
  backdrop.addEventListener('click', (event) => { if (event.target === backdrop) close(); });
  document.addEventListener('keydown', onEscape);
  return backdrop;
}

export async function renderDocumentRegistry(root, { escapeHtml, setTitle, loadHistory, loadCurrentDocuments, loadWorkingTemplates, loadAccountTerms, loadDrafts, saveDraft, publishDraft, loadVersions }) {
  if (!root) return;
  setTitle?.('Реестр документов');

  // RKN assistance concerns the Professional as data operator, not the User
  // application's consent screens.
  // All platform-provided templates belong to Professional, including bases
  // intended for Professional ↔ User consents. User lists platform ↔ User only.
  const professional = [
    ...getRegistryBookUserDocuments(),
    ...getRegistryUserLegalTemplates(),
    ...getRegistryUserHelperTemplates(),
  ];
  const user = getRegistryPlatformUserDocuments();
  const currentDocumentsByKey = new Map();
  const draftsByKey = new Map();
  const sourceByKey = new Map([...professional, ...user].map((item) => [item.key, item]));
  const applicationFor = (item) => item?.application ||
    (item?.key === 'account-terms' || item?.key === 'platform-privacy-policy' ||
      String(item?.key || '').startsWith('admin-user-') ? 'user' : 'professional');
  const sourceFor = (key) => currentDocumentsByKey.get(key) || sourceByKey.get(key) || getRegistryDocument(key) ||
    draftsByKey.get(key);
  const refresh = () => renderDocumentRegistry(root, {
    escapeHtml, setTitle, loadHistory, loadCurrentDocuments, loadWorkingTemplates, loadAccountTerms,
    loadDrafts, saveDraft, publishDraft, loadVersions,
  });
  const edit = (item, application) => {
    if (document.querySelector('.admin-mobile-app')) {
      if (item?.content) openDocument(item);
      return;
    }
    if (item?.key && !item.content && !draftsByKey.has(item.key)) return;
    const purpose = documentPurpose(item || {});
    openDocumentEditor({
      item: item ? {
        ...item,
        purpose: ({ 'Обязательно': 'REQUIRED', 'Необязательно': 'OPTIONAL',
          'Ознакомление': 'READING', 'Справочный': 'REFERENCE' })[purpose],
      } : null,
      draft: item?.key ? draftsByKey.get(item.key) || null : null,
      application,
      saveDraft, publishDraft,
      onUpdated: refresh,
    });
  };

  root.innerHTML = '<div class="admin-users-layout admin-registry-layout">' +
    sectionMarkup('Кабинет', 'Professional', documentTable(professional, escapeHtml, 'professional'), escapeHtml) +
    sectionMarkup('Записи', 'User', documentTable(user, escapeHtml, 'user'), escapeHtml) +
    sectionMarkup('История', '', '<div data-registry-history-content><div class="admin-card admin-history-empty">Загрузка истории…</div></div>', escapeHtml) +
    '</div>';

  // The Admin-owned source displays its declared edition immediately.
  // When available, the API supplies the latest persisted document snapshot.
  // The DB's technical version index is never shown as a legal edition.
  const sourceButtons = Array.from(root.querySelectorAll('[data-registry-document]'));
  const enableDocumentButton = (key) => {
    for (const button of sourceButtons) {
      if (button.dataset.registryDocument !== key) continue;
      button.disabled = false;
      button.removeAttribute?.('aria-disabled');
    }
  };
  sourceButtons.forEach((button) => {
    button.addEventListener('click', (event) => {
      event?.stopPropagation?.();
      const key = button.dataset.registryDocument;
      const selected = sourceFor(key);
      edit(selected, applicationFor(selected));
    });
  });
  const renderExtras = () => {
    const draftKeys = new Set(draftsByKey.keys());
    for (const application of ['professional', 'user']) {
      const table = root.querySelector?.('[data-registry-application="' + application + '"]');
      if (!table) continue;
      const tbody = table.querySelector('tbody');
      if (!tbody) continue;
      tbody.querySelectorAll('[data-registry-extra]').forEach((row) => row.remove());
      const extrasByKey = new Map();
      for (const item of currentDocumentsByKey.values()) {
        if (!sourceByKey.has(item.key) && item.application === application &&
          String(item.key || '').startsWith('admin-' + application + '-')) extrasByKey.set(item.key, item);
      }
      for (const draft of draftsByKey.values()) {
        if (!sourceByKey.has(draft.key) && applicationFor(draft) === application && !extrasByKey.has(draft.key)) {
          extrasByKey.set(draft.key, { ...draft, editorEdition: draft.edition, publishedAt: null });
        }
      }
      const extras = [...extrasByKey.values()];
      if (extras.length) {
        const html = documentTable(extras, escapeHtml, application, draftKeys);
        const rows = html.match(/<tbody>([\s\S]*?)<\/tbody>/)?.[1] || '';
        tbody.insertAdjacentHTML('beforeend', rows.replaceAll('<tr data-registry-row', '<tr data-registry-extra data-registry-row'));
      }
      for (const row of tbody.querySelectorAll('[data-registry-row]')) {
        const key = row.dataset.registryRow;
        const item = sourceFor(key);
        const cell = row.querySelector('td[data-label="Статус"]');
        if (cell && item) cell.innerHTML = documentStatusMarkup(item, draftKeys.has(key));
        const purposeCell = row.querySelector('td[data-label="Назначение"]');
        if (purposeCell && item) purposeCell.innerHTML = purposeMarkup(documentPurpose(item), documentStatus(item));
      }
    }
  };
  root.addEventListener?.('click', (event) => {
    const addButton = event.target?.closest?.('[data-registry-add]');
    if (addButton) {
      edit(null, addButton.dataset.registryAdd);
      return;
    }
    const editButton = event.target?.closest?.('[data-registry-document]');
    if (editButton) {
      // Initial icons have their own handler for existing registry tests;
      // appended documents are handled by the stable root delegation.
      if (!sourceButtons.includes(editButton)) {
        const selected = sourceFor(editButton.dataset.registryDocument);
        edit(selected, applicationFor(selected));
      }
      return;
    }
    const row = event.target?.closest?.('[data-registry-row]');
    if (!row) return;
    const selected = sourceFor(row.dataset.registryRow);
    // An existing published edition wins over a pending draft in the viewer.
    if (selected?.content) openDocument(selected);
  });
  root.addEventListener?.('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const row = event.target?.closest?.('[data-registry-row]');
    if (!row || event.target !== row) return;
    event.preventDefault();
    const selected = sourceFor(row.dataset.registryRow);
    if (selected?.content) openDocument(selected);
  });
  root.querySelectorAll?.('[data-registry-add]').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.stopPropagation?.();
      edit(null, button.dataset.registryAdd);
    });
  });
  if (typeof loadDrafts === 'function') {
    void Promise.resolve().then(loadDrafts).then((rows) => {
      if (!Array.isArray(rows) || root.isConnected === false) return;
      draftsByKey.clear();
      for (const row of rows) {
        if (!row?.key) continue;
        draftsByKey.set(row.key, row);
        enableDocumentButton(row.key);
      }
      renderExtras();
    }).catch(() => {
      // A backend without the editorial migration must never imply a saved draft.
    });
  }
  if (typeof loadCurrentDocuments === 'function') {
    void Promise.resolve().then(loadCurrentDocuments).then((items) => {
      if (!Array.isArray(items) || root.isConnected === false) return;
      const badges = Array.from(root.querySelectorAll('[data-registry-version]'));
      const dates = Array.from(root.querySelectorAll('[data-registry-date]'));
      for (const item of items) {
        if (!item || typeof item.key !== 'string' || typeof item.content !== 'string') continue;
        currentDocumentsByKey.set(item.key, item);
        enableDocumentButton(item.key);
        const badge = badges.find((node) => node.dataset.registryVersion === item.key);
        if (badge) badge.textContent = sourceEdition(item);
        const date = dates.find((node) => node.dataset.registryDate === item.key);
        if (date) date.textContent = publishedDocumentDate(item);
      }
      renderExtras();
    }).catch(() => {
      // Older preview backend may lack this GET. Source document metadata remains.
    });
  }
  // The original platform-bases endpoint is already deployed in core/main.
  // It returns the canonical (not Professional-local) versions from
  // PlatformDocumentVersion. This keeps Admin's staging preview usable even
  // before the newer Admin-only /document-registry/current route is deployed.
  if (typeof loadWorkingTemplates === 'function') {
    void Promise.resolve().then(loadWorkingTemplates).then((items) => {
      if (!Array.isArray(items) || root.isConnected === false) return;
      const publishedBaseKeys = new Set([
        'user-document-pdn-policy',
        'user-document-pdn-consent',
        'user-document-messages-consent',
      ]);
      for (const item of items) {
        if (!publishedBaseKeys.has(item?.key)) continue;
        const version = Number(item?.version);
        if (!Number.isSafeInteger(version) || version < 1 || typeof item.content !== 'string') continue;
        const source = { ...item, type: 'USER_DOCUMENT_BASE', version };
        currentDocumentsByKey.set(item.key, source);
        enableDocumentButton(item.key);
        for (const badge of root.querySelectorAll('[data-registry-version]')) {
          if (badge.dataset.registryVersion === item.key) badge.textContent = String(version);
        }
        // This API does not supply a publication date. Retain the platform's
        // source issue date rather than inventing one or using tenant edits.
      }
    }).catch(() => {
      // Core's more recent Admin endpoint may still return the same versions.
      // The index must not guess a revision on network failure.
    });
  }

  // Account terms are stored exclusively in the platform DB, not in the
  // static template catalog. The public account endpoint returns the same
  // authoritative legal snapshot even if Admin's guarded GET is unavailable.
  if (typeof loadAccountTerms === 'function') {
    void Promise.resolve().then(loadAccountTerms).then((item) => {
      if (!item || typeof item.content !== 'string' || item.key !== 'account-terms'
        || root.isConnected === false) return;
      currentDocumentsByKey.set(item.key, item);
      enableDocumentButton(item.key);
      for (const badge of root.querySelectorAll('[data-registry-version]')) {
        if (badge.dataset.registryVersion === item.key) {
          badge.textContent = legalEdition(item.content) || '—';
        }
      }
      for (const date of root.querySelectorAll('[data-registry-date]')) {
        if (date.dataset.registryDate === item.key) date.textContent = publishedDocumentDate(item);
      }
    }).catch(() => {
      // Keep known index metadata; never invent a document body.
    });
  }

  const host = root.querySelector('[data-registry-history-content]');
  if (!host) return;
  try {
    const [eventsResult, versionsResult] = await Promise.all([
      typeof loadHistory === 'function' ? loadHistory() : Promise.resolve([]),
      typeof loadVersions === 'function' ? loadVersions().catch(() => []) : Promise.resolve([]),
    ]);
    hydrateDocumentRegistryHistory(eventsResult);
    const archived = Array.isArray(versionsResult) ? versionsResult : [];
    const archivedById = new Map(archived.map((item) => ['revision-' + item.id, {
      ...item, __archive: true, id: 'revision-' + item.id,
      content: item.documentContent,
      title: item.documentTitle,
    }]));
    if (!host.isConnected) return;
    host.innerHTML = historyTable(escapeHtml, archived);
    const viewHistorical = (id) => {
      const item = archivedById.get(id) || getDocumentRegistryHistory().find((event) => event.id === id);
      if (item) openDocument(item);
    };
    host.querySelectorAll('[data-registry-history]').forEach((button) => {
      button.addEventListener('click', (event) => {
        event?.stopPropagation?.();
        viewHistorical(button.dataset.registryHistory);
      });
    });
    host.addEventListener?.('click', (event) => {
      if (event.target?.closest?.('[data-registry-history]')) return;
      const row = event.target?.closest?.('[data-registry-history-row]');
      if (row) viewHistorical(row.dataset.registryHistoryRow);
    });
    host.addEventListener?.('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      if (event.target?.dataset?.registryHistoryRow) {
        event.preventDefault();
        viewHistorical(event.target.dataset.registryHistoryRow);
      }
    });
  } catch {
    if (host.isConnected) {
      host.innerHTML = '<div class="admin-card admin-history-empty">Не удалось загрузить историю документов.</div>';
    }
  }
}
