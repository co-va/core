import { documentPage } from '../../ui/documents/index.js';
import { modal, mountModal } from '../../ui/modals/index.js';
import {
  getRegistryBookUserDocuments,
  getRegistryUserHelperTemplates,
  getRegistryUserLegalTemplates,
  getRegistryDocument,
} from './catalog.js';
import {
  getDocumentRegistryHistory,
  hydrateDocumentRegistryHistory,
} from './history.js';

// The registry is a single three-section document list. The source catalog and
// persisted signing history stay canonical and are never copied into this view.
const DOCUMENT_ICON = '<svg class="admin-registry-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h8l4 4v14H6z"/><path d="M14 3v5h5M9 12h6M9 16h6"/></svg>';

function formatMoment(value) {
  const date = new Date(value || '');
  return Number.isFinite(date.getTime())
    ? date.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).replace(',', '')
    : '—';
}

function actionLabel(value) {
  const action = String(value || '').toUpperCase();
  if (action === 'ACCEPTED') return 'Принято';
  if (action === 'ACKNOWLEDGED') return 'Ознакомлен';
  if (action === 'CONSENTED') return 'Согласие дано';
  if (action === 'REVOKED') return 'Отозвано';
  if (action === 'DECLINED') return 'Отклонено';
  return action || 'Событие';
}

function actionState(value) {
  const action = String(value || '').toUpperCase();
  if (action === 'REVOKED') return 'suspended';
  if (action === 'DECLINED') return 'pending';
  return 'active';
}

function sectionMarkup(title, application, body, escapeHtml, extra = '') {
  return '<section class="admin-users-section admin-registry-section" ' + extra + '>' +
    '<h2 class="admin-users-section-title">' + escapeHtml(title) +
      (application ? '<span class="admin-registry-app"> / ' + escapeHtml(application) + '</span>' : '') + '</h2>' +
    body + '</section>';
}

function documentTable(items, escapeHtml) {
  const rows = items.map((item) => {
    const title = escapeHtml(item.title || 'Документ');
    const key = escapeHtml(item.key || '');
    const version = item.version == null || item.version === '' ? '—' : escapeHtml(String(item.version));
    return '<tr>' +
      '<td data-label="Документ"><button type="button" class="admin-registry-open" data-registry-document="' + key +
      '" aria-label="Открыть документ ' + title + '">' + DOCUMENT_ICON +
      '<strong class="admin-registry-title">' + title + '</strong></button></td>' +
      '<td data-label="Версия"><span class="admin-registry-version">' + version + '</span></td>' +
      '</tr>';
  }).join('');
  return '<div class="admin-card"><table class="admin-table admin-registry-table">' +
    '<thead><tr><th>Документ</th><th>Версия</th></tr></thead><tbody>' +
    (rows || '<tr><td colspan="2" class="admin-history-empty">Документов пока нет.</td></tr>') +
    '</tbody></table></div>';
}

function historyTable(escapeHtml) {
  const history = getDocumentRegistryHistory();
  if (!history.length) {
    return '<div class="admin-card admin-history-empty">Событий пока нет.</div>';
  }
  const rows = history.map((item) => {
    const title = escapeHtml(item.documentTitle || item.documentKey || 'Документ');
    const id = escapeHtml(item.id || '');
    const version = item.documentVersion ? 'Версия ' + escapeHtml(String(item.documentVersion)) : '';
    const account = escapeHtml(item.accountEmail || item.tenantName || '—');
    const subject = item.subjectType === 'ACCOUNT' ? 'User' : 'Professional';
    const action = escapeHtml(actionLabel(item.action));
    const status = actionState(item.action);
    const moment = escapeHtml(formatMoment(item.occurredAt));
    return '<tr>' +
      '<td data-label="Документ"><button type="button" class="admin-registry-open" data-registry-history="' + id +
      '" aria-label="Открыть сохранённый документ ' + title + '">' + DOCUMENT_ICON +
      '<span class="admin-registry-identity"><strong class="admin-registry-title">' + title +
      '</strong>' + (version ? '<small>' + version + '</small>' : '') + '</span></button></td>' +
      '<td data-label="Аккаунт"><span class="admin-registry-identity">' + account +
      '<small>' + subject + '</small></span></td>' +
      '<td data-label="Событие"><span class="admin-pill ' + status + '">' + action + '</span></td>' +
      '<td data-label="Дата"><time>' + moment + '</time></td></tr>';
  }).join('');
  return '<div class="admin-card"><table class="admin-table admin-registry-table admin-registry-history-table">' +
    '<thead><tr><th>Документ</th><th>Аккаунт</th><th>Событие</th><th>Дата</th></tr></thead><tbody>' +
    rows + '</tbody></table></div>';
}

function openDocument(item) {
  if (!item) return null;
  const title = item.title || item.documentTitle || 'Документ';
  const version = item.version || item.documentVersion || '';
  const content = item.content || item.documentContent || '';
  let backdrop = document.createElement('div');
  backdrop.className = 'admin-drawer-backdrop admin-document-drawer-backdrop';
  backdrop.innerHTML = '<aside class="admin-drawer admin-document-drawer" role="dialog" aria-modal="true" aria-label="Просмотр документа">' +
    '<div class="admin-drawer-head"><div><h3>Документ</h3></div>' +
    '<button type="button" class="admin-close" data-close aria-label="Закрыть">×</button></div>' +
    '<div class="admin-document-reading">' + documentPage({ title, version, content }) + '</div></aside>';

  // Reuse the same desktop drawer and mobile shared Q as Users / Tools.
  const sharedQ = Boolean(document.querySelector('.admin-mobile-app'));
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

export async function renderDocumentRegistry(root, { escapeHtml, setTitle, loadHistory }) {
  if (!root) return;
  setTitle?.('Реестр документов');

  // RKN assistance concerns the Professional as data operator, not the User
  // application's consent screens.
  const professional = [...getRegistryBookUserDocuments(), ...getRegistryUserHelperTemplates()];
  const user = getRegistryUserLegalTemplates();
  root.innerHTML = '<div class="admin-users-layout admin-registry-layout">' +
    sectionMarkup('Кабинет', 'Professional', documentTable(professional, escapeHtml), escapeHtml) +
    sectionMarkup('Записи', 'User', documentTable(user, escapeHtml), escapeHtml) +
    sectionMarkup('История', '', '<div data-registry-history-content><div class="admin-card admin-history-empty">Загрузка истории…</div></div>', escapeHtml) +
    '</div>';

  // Documents remain usable immediately, regardless of history API latency.
  root.querySelectorAll('[data-registry-document]').forEach((button) => {
    button.addEventListener('click', () => openDocument(getRegistryDocument(button.dataset.registryDocument)));
  });

  const host = root.querySelector('[data-registry-history-content]');
  if (!host) return;
  try {
    const items = typeof loadHistory === 'function' ? await loadHistory() : [];
    hydrateDocumentRegistryHistory(items);
    if (!host.isConnected) return;
    host.innerHTML = historyTable(escapeHtml);
    host.querySelectorAll('[data-registry-history]').forEach((button) => {
      button.addEventListener('click', () => {
        const item = getDocumentRegistryHistory().find((event) => event.id === button.dataset.registryHistory);
        if (item) openDocument(item);
      });
    });
  } catch {
    if (host.isConnected) {
      host.innerHTML = '<div class="admin-card admin-history-empty">Не удалось загрузить историю документов.</div>';
    }
  }
}
