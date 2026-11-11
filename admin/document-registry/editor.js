// Desktop/iPad Admin editor. The source platform docs and signed snapshots are immutable.
// A draft is persisted only by the guarded Core API, never in browser storage.
function html(value) {
  return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

function nextEdition(item) {
  const source = String(item?.editorEdition || item?.edition || '');
  const fromText = String(item?.content || '').split(/\r?\n/).slice(0, 8).join('\n')
    .match(/(?:редакция|версия)\s+(\d+(?:\.\d+)*)/i)?.[1] || '';
  const previous = source || fromText;
  if (/^\d+(?:\.\d+)*$/.test(previous)) {
    const parts = previous.split('.').map(Number);
    parts[parts.length - 1] += 1;
    return parts.join('.');
  }
  const technical = Number(item?.version);
  return Number.isSafeInteger(technical) && technical > 0 ? String(technical + 1) : '1';
}

export function openDocumentEditor({
  item = null, draft = null, application, saveDraft, publishDraft, onUpdated,
} = {}) {
  if (typeof saveDraft !== 'function' || typeof publishDraft !== 'function') return null;
  const current = draft || item || {};
  const existing = Boolean(item?.key || draft?.key);
  const edition = draft ? String(draft.edition || '') : nextEdition(item);
  const type = String(current.type || 'CUSTOM_LEGAL');
  const statusValue = ['CUSTOM_WORKING', 'USER_DOCUMENT_BASE', 'RKN_GUIDE_TEMPLATE'].includes(type)
    ? 'CUSTOM_WORKING' : 'CUSTOM_LEGAL';
  // Source legal types carry fixed semantics. Custom documents can change their status.
  const statusEditable = !existing || type === 'CUSTOM_LEGAL' || type === 'CUSTOM_WORKING';
  const purposeValue = ['REQUIRED','OPTIONAL','READING','REFERENCE'].includes(String(current.purpose || ''))
    ? String(current.purpose)
    : current.requiredForRegistration ? 'REQUIRED' : 'OPTIONAL';
  const title = String(current.title || '');
  const content = String(current.content ?? item?.content ?? '');
  const layer = document.createElement('div');
  layer.className = 'admin-drawer-backdrop admin-document-drawer-backdrop';
  layer.innerHTML = '<aside class="admin-drawer admin-document-drawer" role="dialog" aria-modal="true" aria-label="Редактировать документ">' +
    '<div class="admin-drawer-head"><div><span class="admin-document-head-version">' +
    (existing ? 'Черновик · Редакция ' + html(edition || '—') : 'Новый документ') +
    '</span><h3>' + html(title || 'Новый документ') + '</h3></div>' +
    '<button type="button" class="admin-close" data-close aria-label="Закрыть">×</button></div>' +
    '<div class="admin-document-reading"><form class="admin-registry-editor-content" data-document-editor>' +
    '<div class="admin-registry-editor-field"><label for="editor-document-title">Название</label>' +
    '<input id="editor-document-title" name="title" maxlength="250" required value="' + html(title) + '"></div>' +
    '<div class="admin-registry-editor-field"><label for="editor-document-edition">Редакция</label>' +
    '<input id="editor-document-edition" name="edition" maxlength="40" required value="' + html(edition) + '"></div>' +
    '<div class="admin-registry-editor-field"><label for="editor-document-purpose">Назначение</label>' +
    '<select id="editor-document-purpose" name="purpose" required>' +
      '<option value="REQUIRED"' + (purposeValue === 'REQUIRED' ? ' selected' : '') + '>Обязательно</option>' +
      '<option value="OPTIONAL"' + (purposeValue === 'OPTIONAL' ? ' selected' : '') + '>Необязательно</option>' +
      '<option value="READING"' + (purposeValue === 'READING' ? ' selected' : '') + '>Ознакомление</option>' +
      '<option value="REFERENCE"' + (purposeValue === 'REFERENCE' ? ' selected' : '') + '>Справочный</option>' +
    '</select></div>' +
    '<div class="admin-registry-editor-field"><label for="editor-document-type">Статус</label>' +
    '<select id="editor-document-type" name="type" required' + (statusEditable ? '' : ' disabled title="Тип исходного документа защищён"') + '>' +
      '<option value="CUSTOM_LEGAL"' + (statusValue === 'CUSTOM_LEGAL' ? ' selected' : '') + '>Правовой</option>' +
      '<option value="CUSTOM_WORKING"' + (statusValue === 'CUSTOM_WORKING' ? ' selected' : '') + '>Рабочий</option>' +
    '</select></div>' +
    '<div class="admin-registry-editor-field"><label for="editor-document-content">Текст документа</label>' +
    '<textarea id="editor-document-content" name="content" spellcheck="true" required>' + html(content) + '</textarea></div>' +
    '<p class="admin-registry-editor-error" role="alert" data-editor-error hidden></p>' +
    '<div class="admin-registry-editor-actions"><button type="submit" data-save-draft>Сохранить черновик</button>' +
    '<button type="button" class="is-publish" data-publish-draft>Опубликовать</button></div>' +
    '</form></div></aside>';
  document.body.append(layer);
  const form = layer.querySelector('[data-document-editor]');
  const error = layer.querySelector('[data-editor-error]');
  // Keep the fixed header synchronized with edits while only the document body scrolls.
  const titleField = form?.querySelector('[name="title"]');
  const editionField = form?.querySelector('[name="edition"]');
  titleField?.addEventListener('input', () => {
    const heading = layer.querySelector('.admin-drawer-head h3');
    if (heading) heading.textContent = titleField.value.trim() || 'Новый документ';
  });
  editionField?.addEventListener('input', () => {
    const label = layer.querySelector('.admin-document-head-version');
    if (label) label.textContent = 'Черновик · Редакция ' + (editionField.value.trim() || '—');
  });
  const controls = [...layer.querySelectorAll('[data-save-draft], [data-publish-draft]')];
  let closed = false;
  let busy = false;
  const close = () => {
    if (closed || busy) return;
    closed = true;
    document.removeEventListener('keydown', escape);
    layer.remove();
  };
  const escape = (event) => { if (event.key === 'Escape') close(); };
  document.addEventListener('keydown', escape);
  layer.querySelector('[data-close]')?.addEventListener('click', close);
  layer.addEventListener('click', (event) => { if (event.target === layer) close(); });
  const execute = async (publish) => {
    if (busy || !form.reportValidity()) return;
    if (publish && typeof window.confirm === 'function'
      && !window.confirm('Опубликовать новую редакцию? Предыдущая останется в истории.')) return;
    const data = new FormData(form);
    const payload = {
      key: draft?.key || item?.key || undefined,
      application,
      title: String(data.get('title') || '').trim(),
      edition: String(data.get('edition') || '').trim(),
      content: String(data.get('content') || '').trim(),
      type: statusEditable ? String(data.get('type') || 'CUSTOM_LEGAL') : statusValue,
      purpose: String(data.get('purpose') || 'OPTIONAL'),
      requiredForRegistration: String(data.get('purpose') || '') === 'REQUIRED',
    };
    busy = true;
    controls.forEach((button) => { button.disabled = true; });
    error.hidden = true;
    try {
      const saved = await saveDraft(payload);
      if (!saved?.key) throw new Error('Сервер не подтвердил сохранение черновика.');
      if (publish) await publishDraft(saved.key);
      busy = false;
      close();
      await onUpdated?.();
    } catch (failure) {
      error.textContent = failure?.message || 'Не удалось сохранить документ.';
      error.hidden = false;
    } finally {
      busy = false;
      controls.forEach((button) => { button.disabled = false; });
    }
  };
  form.addEventListener('submit', (event) => { event.preventDefault(); void execute(false); });
  layer.querySelector('[data-publish-draft]')?.addEventListener('click', () => { void execute(true); });
  return layer;
}
