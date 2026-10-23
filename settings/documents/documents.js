import {
  actionBlock,
  button,
  documentTile,
  documentTiles,
  emptyState,
  field,
  initSegmentControls,
  modal,
  mountModal,
  mountV2ZLayer,
  openDocumentViewer,
  openNotice,
  page,
  segmentControl,
  selectFile,
  shortDateTime,
  shortDateTimeParts,
  textareaField,
  v2ListEntries,
  v2ListEntry,
  v2ZLayer,
  workspaceHeaderContext,
} from '../../ui/ui.js';
import { readOnlyReceipt } from '../../ui/receipt/index.js';
import { escapeHtml } from '../../ui/utils/escape-html.js';
import { phonesMatch } from '../../core/phone/index.js';
import { getAllPeople } from '../../core/people/data.js';
import {
  createStandaloneDocument,
  deleteDocument,
  getDocuments,
  getPlatformDocumentBases,
  renderPlatformBaseText,
  saveDocument,
} from './data.js';
import {
  CORE_DOCUMENT_IDS,
  DOCUMENT_CLASS,
  canDeleteDocument,
  canSignDocument,
  isCoreDocument,
  isFileDocument,
  visibleDocumentVersion,
} from './policy.js';
import { getConsents } from './consents.js';
import { getDocumentHistory } from './history.js';

const VIEWS = [
  { value: 'documents', label: 'Документы' },
  { value: 'history', label: 'История' },
];

const USER_PDF_FILE_LIMIT = 15 * 1024 * 1024;
const USER_PDF_TOTAL_LIMIT = 30 * 1024 * 1024;

let currentView = 'documents';

function headerContext(title = 'Документы', c = null, v = null) {
  return workspaceHeaderContext({
    title,
    v: v || {
      data: 'data-documents-settings',
      aria: 'Настройки документов',
    },
    c,
  });
}

function isRknGuide(item = {}) {
  return item?.attachment?.type === 'RKN_GUIDE_PDF'
    && Boolean(item?.attachment?.pdfBase64);
}

function isUserPdf(item = {}) {
  return item?.attachment?.type === 'USER_PDF'
    && Boolean(item?.attachment?.dataUrl);
}

function documentPdfDataUrl(item = {}) {
  if (isUserPdf(item)) return String(item.attachment.dataUrl || '');
  if (!isRknGuide(item)) return '';
  const mimeType = String(item?.attachment?.mimeType || 'application/pdf');
  return `data:${mimeType};base64,${String(item?.attachment?.pdfBase64 || '')}`;
}

function documentMoment(item = {}) {
  const direct = item?.attachment?.generatedAt
    || item?.attachment?.uploadedAt
    || item?.updatedAt
    || item?.createdAt
    || '';
  if (direct) return direct;
  const history = getDocumentHistory().find((entry) =>
    entry.documentId === item.id
    && Number(entry.documentVersion || 0) === Number(item.version || 0)
  );
  return history?.createdAt || '';
}

function currentProfileDocuments() {
  const grouped = new Map();
  getDocuments().forEach((item) => {
    if (item?.hidden) return;
    const key = String(item.id || '');
    if (!key) return;
    const current = grouped.get(key);
    if (!current) {
      grouped.set(key, item);
      return;
    }
    const currentVersion = Number(current.version || 0);
    const nextVersion = Number(item.version || 0);
    if (nextVersion > currentVersion) grouped.set(key, item);
    else if (nextVersion === currentVersion && Date.parse(documentMoment(item) || 0) > Date.parse(documentMoment(current) || 0)) {
      grouped.set(key, item);
    }
  });
  return [...grouped.values()];
}

function coreDocuments() {
  const byId = new Map(currentProfileDocuments().map((item) => [item.id, item]));
  return CORE_DOCUMENT_IDS.map((id) => byId.get(id)).filter(Boolean);
}

function otherDocuments() {
  return currentProfileDocuments()
    .filter((item) => !isCoreDocument(item))
    .sort((left, right) => Date.parse(documentMoment(right) || 0) - Date.parse(documentMoment(left) || 0));
}

function templates() {
  const documentsById = new Map(getDocuments().map((item) => [String(item.id || ''), item]));
  return getPlatformDocumentBases()
    .map((base) => {
      const current = documentsById.get(String(base.documentId || '')) || null;
      return {
        id: String(base.documentId || ''),
        templateKey: String(base.key || ''),
        system: true,
        kind: base.kind || 'agreement',
        documentClass: DOCUMENT_CLASS.CORE_LEGAL,
        title: current?.title || base.title || 'Шаблон',
        personConsent: Boolean(base.personConsent),
        required: Boolean(base.required),
        signable: Boolean(base.personConsent),
        version: Number(current?.version || base.version || 1),
        text: current ? String(current.text || '') : renderPlatformBaseText(base),
        sourceMode: current?.sourceMode === 'CUSTOM' ? 'CUSTOM' : 'BOOK',
        baseKey: String(base.key || ''),
        baseVersion: Number(base.version || 1),
      };
    })
    .filter((item) => item.id)
    .sort((left, right) => CORE_DOCUMENT_IDS.indexOf(left.id) - CORE_DOCUMENT_IDS.indexOf(right.id));
}

function consentStateText(status) {
  if (status === 'revoked') return 'Отозвано';
  if (status === 'declined') return 'Не подписано';
  return 'Подписано';
}

function consentStateKind(status) {
  if (status === 'revoked') return 'revoked';
  if (status === 'declined') return 'pending';
  return 'signed';
}

function consentPerson(item, people) {
  if (item.subjectType === 'ACCOUNT') {
    return people.find((person) => (person.accounts || []).includes(item.subjectKey)) || null;
  }
  if (item.subjectType !== 'CONTACT_POINT') return null;
  if (item.contactType === 'PHONE') {
    return people.find((person) => (person.phones || []).some((value) => phonesMatch(value, item.contactValue))) || null;
  }
  if (item.contactType === 'EMAIL') {
    const target = String(item.contactValue || '').trim().toLowerCase();
    return people.find((person) => (person.emails || []).some((value) => String(value || '').trim().toLowerCase() === target)) || null;
  }
  if (item.contactType === 'TELEGRAM') {
    const target = String(item.contactValue || '').trim();
    return people.find((person) => (person.telegrams || []).some((value) => String(value || '').trim() === target)) || null;
  }
  return null;
}

function consentSubjectLabel(item, people = getAllPeople()) {
  const person = consentPerson(item, people);
  if (person) return [person.name, person.surname].filter(Boolean).join(' ') || person.phones?.[0] || 'Человек';
  if (item.subjectType === 'CONTACT_POINT') return item.contactValue || 'Контакт';
  return 'Человек';
}

function signedDocumentSnapshot(item) {
  const historical = getDocumentHistory().find((entry) =>
    entry.documentId === item.documentId
    && Number(entry.documentVersion || 0) === Number(item.documentVersion || 0)
    && entry.snapshot
  );
  if (historical?.snapshot) return historical.snapshot;
  return getDocuments().find((document) =>
    document.id === item.documentId
    && Number(document.version || 0) === Number(item.documentVersion || 0)
  ) || null;
}

function openDocument(item) {
  if (!item) return null;
  return openDocumentViewer({
    title: item.title || 'Документ',
    version: visibleDocumentVersion(item),
    content: item.text || '',
    pdfDataUrl: documentPdfDataUrl(item),
  });
}

function documentTypeText(item) {
  if (isCoreDocument(item)) return 'Основной документ';
  if (isRknGuide(item)) return 'PDF-помощник';
  if (isFileDocument(item)) return 'Файл';
  return 'Документ';
}

function documentCard(item, data) {
  const moment = documentMoment(item);
  const date = moment ? shortDateTime(moment, '') : '';
  return documentTile({
    title: item.title || 'Документ',
    version: visibleDocumentVersion(item),
    meta: [documentTypeText(item), date].filter(Boolean).join(' · '),
    data,
    aria: `Открыть информацию о документе ${item.title || 'Документ'}`,
  });
}

function documentsMarkup() {
  const core = coreDocuments();
  const other = otherDocuments();
  return `
    <section class="document-group document-group--core" data-document-group="core">
      <h3 class="document-group__title">Основные документы</h3>
      ${core.length
        ? documentTiles(core.map((item) => documentCard(item, `data-profile-document="${String(item.id || '')}"`)), { layout: 'rail' })
        : emptyState('Основные документы не загрузились', 'Обновите раздел.')}
    </section>
    <section class="document-group document-group--other" data-document-group="other">
      <h3 class="document-group__title">Другие документы</h3>
      ${other.length
        ? documentTiles(other.map((item) => documentCard(item, `data-profile-document="${String(item.id || '')}"`)), { layout: 'rail' })
        : emptyState('Других документов пока нет', 'Здесь появятся PDF-помощники и добавленные вами документы.')}
    </section>
  `;
}

function historyItems() {
  return [...getConsents()].sort((left, right) =>
    Date.parse(right.eventAt || right.createdAt || 0) - Date.parse(left.eventAt || left.createdAt || 0)
  );
}

function historyCard(item) {
  const snapshot = signedDocumentSnapshot(item);
  const date = shortDateTime(item.eventAt || item.acceptedAt || item.revokedAt || item.createdAt, '');
  return documentTile({
    title: snapshot?.title || item.documentId || 'Документ',
    version: item.documentVersion || snapshot?.version || 1,
    meta: date,
    status: consentStateText(item.status),
    statusState: consentStateKind(item.status),
    data: `data-signing-event="${String(item.id || '')}"`,
    aria: `Открыть факт подписания ${snapshot?.title || item.documentId || 'документа'}`,
  });
}

function historyMarkup() {
  const items = historyItems();
  if (!items.length) return emptyState('Истории подписаний пока нет', 'Здесь появятся факты подписания, отказа и отзыва.');
  return documentTiles(items.map(historyCard));
}

function contentMarkup() {
  return currentView === 'history' ? historyMarkup() : documentsMarkup();
}

function bindSettings(scope, root) {
  scope.querySelector('[data-documents-settings]')?.addEventListener('click', () => openSettingsMenu(root));
}

function detailReceipt(item) {
  const moment = documentMoment(item);
  const parts = shortDateTimeParts(moment);
  const rows = [{ label: 'Тип', value: documentTypeText(item) }];
  const version = visibleDocumentVersion(item);
  if (version !== '') rows.push({ label: 'Версия', value: String(version) });
  if (canSignDocument(item)) rows.push({ label: 'Подписание', value: 'Доступно' });
  rows.push({
    label: canDeleteDocument(item) ? 'Добавлен' : 'Обновлён',
    value: parts.date ? [parts.date, parts.time].filter(Boolean).join(' · ') : '—',
  });
  return readOnlyReceipt({ title: 'Информация о документе', items: rows });
}

function openDocumentDetailSettings(root, layer, item) {
  const actions = [];
  if (isCoreDocument(item)) {
    actions.push(button('Открыть шаблон', { variant: 'outline', data: 'data-detail-template' }));
  } else if (canDeleteDocument(item)) {
    actions.push(button(isRknGuide(item) ? 'Убрать документ' : 'Удалить документ', { variant: 'critical', data: 'data-detail-delete' }));
  }
  const sheet = mountModal(document.body, modal(
    `<div class="compact-form">${actions.join('')}</div>`,
    {
      title: 'Настройки документа',
      variant: 'x',
      surface: 'app',
      className: 'modal--form-sheet',
    },
  ));
  if (!sheet) return null;

  sheet.querySelector('[data-detail-template]')?.addEventListener('click', () => {
    sheet.v2Close?.();
    const template = templates().find((entry) => entry.id === item.id);
    if (template) openTemplateEditor(root, template);
  });

  sheet.querySelector('[data-detail-delete]')?.addEventListener('click', () => {
    sheet.v2Close?.();
    const rkn = isRknGuide(item);
    const confirm = mountModal(document.body, modal(
      `<div class="compact-form">
        <p>${rkn
          ? 'Документ будет убран из отображения. Системный файл останется в архиве.'
          : 'Документ будет удалён из текущих документов. Уже существующие факты подписания не удаляются.'}</p>
        ${button(rkn ? 'Убрать' : 'Удалить', { variant: 'critical', data: 'data-confirm-document-delete' })}
      </div>`,
      {
        title: rkn ? 'Убрать документ' : 'Удалить документ',
        variant: 'x',
        surface: 'app',
        className: 'modal--form-sheet',
      },
    ));
    confirm?.querySelector('[data-confirm-document-delete]')?.addEventListener('click', () => {
      try {
        deleteDocument(item.id);
        confirm.v2Close?.();
        layer.v2Close?.();
        renderMain(root);
      } catch (error) {
        openNotice({
          title: 'Документ не удалён',
          message: error instanceof Error ? error.message : 'Не удалось удалить документ',
        });
      }
    });
  });

  return sheet;
}

function openDocumentDetail(root, item) {
  const layer = mountV2ZLayer(root, v2ZLayer('', { className: 'documents-detail-layer' }), { stack: true });
  if (!layer) return null;

  layer.innerHTML = page([
    headerContext('Документ', null, {
      data: 'data-document-detail-settings',
      aria: 'Настройки документа',
    }),
    `<section class="document-detail" data-document-detail>
      ${documentTiles([
        documentTile({
          title: item.title || 'Документ',
          version: visibleDocumentVersion(item),
          meta: documentTypeText(item),
          data: 'data-document-content-open',
          aria: 'Открыть содержимое документа',
        }),
      ])}
      ${detailReceipt(item)}
    </section>`,
  ]);

  layer.querySelector('[data-document-content-open]')?.addEventListener('click', () => openDocument(item));
  layer.querySelector('[data-document-detail-settings]')?.addEventListener('click', () => openDocumentDetailSettings(root, layer, item));
  window.dispatchEvent(new CustomEvent('book:v2-context-changed'));
  return layer;
}

function openSigningDetail(item) {
  const snapshot = signedDocumentSnapshot(item);
  const person = consentSubjectLabel(item);
  const parts = shortDateTimeParts(item.eventAt || item.acceptedAt || item.revokedAt || item.createdAt);
  const title = snapshot?.title || item.documentId || 'Документ';
  const version = item.documentVersion || snapshot?.version || 1;
  const moment = [parts.date, parts.time].filter(Boolean).join(' - ') || '—';

  return mountModal(document.body, modal(
    `<div class="documents-signing-info" data-signing-info>
      <strong class="documents-signing-info__title">${escapeHtml(String(title))}</strong>
      <span class="documents-signing-info__version">Версия ${escapeHtml(String(version))}</span>
      <strong class="documents-signing-info__person">${escapeHtml(String(person))}</strong>
      <span class="documents-signing-info__moment">${escapeHtml(String(moment))}</span>
      <span class="documents-signing-info__status">${escapeHtml(consentStateText(item.status))}</span>
    </div>`,
    {
      title: 'Информация о подписании',
      variant: 's',
      surface: 'app',
      className: 'documents-signing-info-sheet',
    },
  ));
}

function renderTemplatesLayer(layer, root) {
  const items = templates();
  layer.innerHTML = page([
    headerContext('Шаблоны'),
    items.length
      ? documentTiles(items.map((item) => documentTile({
          title: item.title || 'Шаблон',
          version: item.version || 1,
          meta: item.sourceMode === 'CUSTOM' ? 'Ваш вариант' : 'Системный шаблон',
          data: `data-template-open="${String(item.id || '')}"`,
          aria: `Открыть шаблон ${item.title || ''}`,
        })), { layout: 'rail' })
      : emptyState('Шаблоны недоступны', 'Базовые шаблоны Реестра не загрузились.'),
  ]);

  bindSettings(layer, root);
  layer.querySelectorAll('[data-template-open]').forEach((control) => {
    control.addEventListener('click', () => {
      const item = templates().find((template) => template.id === control.dataset.templateOpen);
      if (item) renderTemplateEditor(layer, root, item);
    });
  });
  window.dispatchEvent(new CustomEvent('book:v2-context-changed'));
}

function openTemplatesLayer(root) {
  const layer = mountV2ZLayer(root, v2ZLayer('', { className: 'documents-templates-layer' }), { stack: true });
  if (!layer) return null;
  renderTemplatesLayer(layer, root);
  return layer;
}

function setPrimaryVisible(source, visible) {
  if (!source) return;
  const actions = source.closest('.modal-actions');
  if (actions) actions.hidden = !visible;
}

function renderTemplateEditor(layer, root, item) {
  layer.innerHTML = page([
    headerContext(item.title || 'Шаблон'),
    `<form class="form-grid" data-template-form>
      ${field({ label: 'Название', name: 'documentTitle', value: item.title || '', required: true })}
      ${textareaField({ label: 'Текст документа', name: 'documentText', value: item.text || '', rows: 16, placeholder: 'Текст документа' })}
    </form>`,
    actionBlock(button('Сохранить', {
      data: 'data-template-save',
      aria: 'Сохранить шаблон',
    })),
  ]);

  const form = layer.querySelector('[data-template-form]');
  const primary = layer.querySelector('[data-template-save]');
  const initialTitle = String(item.title || '');
  const initialText = String(item.text || '');

  const sync = () => {
    const title = String(form?.querySelector('[name="documentTitle"]')?.value || '').trim();
    const body = String(form?.querySelector('[name="documentText"]')?.value || '');
    setPrimaryVisible(primary, Boolean(title) && (title !== initialTitle || body !== initialText));
  };
  form?.addEventListener('input', sync);
  form?.addEventListener('change', sync);

  primary?.addEventListener('click', () => {
    const title = String(form?.querySelector('[name="documentTitle"]')?.value || '').trim();
    if (!title) return;
    const saved = saveDocument({
      ...item,
      documentClass: DOCUMENT_CLASS.CORE_LEGAL,
      title,
      text: String(form?.querySelector('[name="documentText"]')?.value || ''),
      sourceMode: 'CUSTOM',
    });
    renderMain(root);
    renderTemplateEditor(layer, root, saved);
  });

  bindSettings(layer, root);
  setPrimaryVisible(primary, false);
}

function openTemplateEditor(root, item) {
  const layer = mountV2ZLayer(root, v2ZLayer('', { className: 'documents-template-editor' }), { stack: true });
  if (!layer) return null;
  renderTemplateEditor(layer, root, item);
  return layer;
}

function userPdfStoredBytes() {
  return getDocuments().reduce((total, item) => {
    if (!isUserPdf(item)) return total;
    return total + Number(item?.attachment?.size || 0);
  }, 0);
}

function signableSetting(checked = false) {
  return v2ListEntries([
    v2ListEntry({
      title: 'Для подписания',
      subtitle: 'Если включено, PDF становится пользовательским документом, а не обычным файлом',
      interactive: false,
      toggleData: 'data-document-signable',
      toggleAria: 'Разрешить использовать документ для подписания',
      toggleChecked: checked,
    }),
  ]);
}

function renderNewDocumentEditor(layer, root, draft = {}) {
  let signable = Boolean(draft.signable);
  const attachment = draft.attachment || null;
  layer.innerHTML = page([
    headerContext('Новый документ'),
    attachment ? documentTiles([
      documentTile({
        title: draft.title || attachment.fileName || 'PDF',
        version: '',
        meta: 'PDF',
        interactive: false,
      }),
    ]) : '',
    `<form class="form-grid" data-new-document-form>
      ${field({ label: 'Название', name: 'documentTitle', value: draft.title || '', required: true, placeholder: 'Название документа' })}
      ${attachment ? '' : textareaField({ label: 'Текст документа', name: 'documentText', value: draft.text || '', rows: 16, placeholder: 'Текст документа' })}
      ${signableSetting(signable)}
    </form>`,
    actionBlock(button('Сохранить', {
      data: 'data-new-document-save',
      aria: 'Сохранить документ',
    })),
  ]);

  const form = layer.querySelector('[data-new-document-form]');
  const primary = layer.querySelector('[data-new-document-save]');
  const toggle = layer.querySelector('[data-document-signable]');

  const sync = () => {
    const title = String(form?.querySelector('[name="documentTitle"]')?.value || '').trim();
    const body = String(form?.querySelector('[name="documentText"]')?.value || '').trim();
    setPrimaryVisible(primary, Boolean(title && (attachment || body)));
  };

  toggle?.addEventListener('click', () => {
    signable = !signable;
    toggle.setAttribute('aria-pressed', signable ? 'true' : 'false');
    toggle.classList.toggle('is-on', signable);
    toggle.querySelector('.app-setting-toggle__switch')?.classList.toggle('is-on', signable);
  });
  form?.addEventListener('input', sync);
  form?.addEventListener('change', sync);

  primary?.addEventListener('click', () => {
    const title = String(form?.querySelector('[name="documentTitle"]')?.value || '').trim();
    const body = String(form?.querySelector('[name="documentText"]')?.value || '');
    if (!title || (!attachment && !body.trim())) return;
    createStandaloneDocument({
      title,
      text: body,
      signable,
      documentClass: attachment && !signable ? DOCUMENT_CLASS.FILE : DOCUMENT_CLASS.USER_DOCUMENT,
      attachment,
    });
    layer.v2Close?.();
    currentView = 'documents';
    renderMain(root);
  });

  bindSettings(layer, root);
  sync();
}

function openNewDocumentEditor(root, draft = {}) {
  const layer = mountV2ZLayer(root, v2ZLayer('', { className: 'documents-new-editor' }), { stack: true });
  if (!layer) return null;
  renderNewDocumentEditor(layer, root, draft);
  return layer;
}

async function choosePdf(root) {
  const file = await selectFile({ accept: 'application/pdf,.pdf' }).catch(() => null);
  if (!file) return;
  if (file.type && file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
    openNotice({ title: 'Нужен PDF', message: 'Выберите файл в формате PDF.' });
    return;
  }
  if (file.size > USER_PDF_FILE_LIMIT) {
    openNotice({ title: 'Файл слишком большой', message: 'Сейчас один PDF может быть не больше 15 МБ.' });
    return;
  }
  if (userPdfStoredBytes() + file.size > USER_PDF_TOTAL_LIMIT) {
    openNotice({ title: 'Недостаточно места', message: 'Для текущего серверного архива суммарный объём загруженных PDF ограничен 30 МБ.' });
    return;
  }
  openNewDocumentEditor(root, {
    title: file.name.replace(/\.pdf$/i, '') || 'Документ',
    attachment: {
      type: 'USER_PDF',
      fileName: file.name || 'document.pdf',
      mimeType: file.type || 'application/pdf',
      size: file.size,
      dataUrl: file.dataUrl,
      uploadedAt: new Date().toISOString(),
    },
  });
}

function openAddDocumentMenu(root) {
  const layer = mountModal(document.body, modal(
    `<div class="compact-form">
      ${button('Создать документ', { data: 'data-create-text-document', variant: 'outline' })}
      ${button('Загрузить PDF', { data: 'data-upload-pdf-document' })}
    </div>`,
    {
      title: 'Добавить документ',
      variant: 'x',
      surface: 'app',
      className: 'modal--form-sheet',
    },
  ));
  if (!layer) return null;

  layer.querySelector('[data-create-text-document]')?.addEventListener('click', () => {
    layer.v2Close?.();
    openNewDocumentEditor(root);
  });
  layer.querySelector('[data-upload-pdf-document]')?.addEventListener('click', () => {
    layer.v2Close?.();
    void choosePdf(root);
  });
  return layer;
}

function openSettingsMenu(root) {
  const layer = mountModal(document.body, modal(
    `<div class="compact-form">
      ${button('Шаблоны', { data: 'data-open-document-templates', variant: 'outline' })}
      ${button('Добавить документ', { data: 'data-add-profile-document' })}
    </div>`,
    {
      title: 'Документы',
      variant: 'x',
      surface: 'app',
      className: 'modal--form-sheet',
    },
  ));
  if (!layer) return null;

  layer.querySelector('[data-open-document-templates]')?.addEventListener('click', () => {
    layer.v2Close?.();
    openTemplatesLayer(root);
  });
  layer.querySelector('[data-add-profile-document]')?.addEventListener('click', () => {
    layer.v2Close?.();
    openAddDocumentMenu(root);
  });
  return layer;
}

function bindMain(root) {
  bindSettings(root, root);

  initSegmentControls(root);
  root.querySelector('[name="documentsView"]')?.addEventListener('change', (event) => {
    currentView = event.target.value === 'history' ? 'history' : 'documents';
    renderMain(root);
  });

  root.querySelectorAll('[data-profile-document]').forEach((control) => {
    control.addEventListener('click', () => {
      const item = currentProfileDocuments().find((document) => document.id === control.dataset.profileDocument);
      if (item) openDocumentDetail(root, item);
    });
  });

  root.querySelectorAll('[data-signing-event]').forEach((control) => {
    control.addEventListener('click', () => {
      const item = getConsents().find((event) => event.id === control.dataset.signingEvent);
      if (item) openSigningDetail(item);
    });
  });
}

function renderMain(root) {
  root.innerHTML = page([
    headerContext('Документы'),
    segmentControl(VIEWS, {
      value: currentView,
      name: 'documentsView',
      aria: 'Документы и история подписаний',
    }),
    `<section class="documents-content" data-documents-content>${contentMarkup()}</section>`,
  ]);
  bindMain(root);
  window.dispatchEvent(new CustomEvent('book:v2-context-changed'));
}

export function render(root) {
  renderMain(root);
}
