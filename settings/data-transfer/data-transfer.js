import { apiRequest } from '../../core/auth.js';
import { accordion, initAccordions, button, field, select, page, details, v2ListEntries, v2ListEntry, workspaceHeaderContext, selectFile, openNotice, dataTable, bindDataTable } from '../../ui/ui.js';
import { settingToggle } from '../../ui/settings/index.js';
import { escapeHtml } from '../../ui/utils/escape-html.js';

async function request(path, body) {
  const response = await apiRequest(`/data-transfer/${path}`, { method: 'POST', body: JSON.stringify(body) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || 'Не удалось обработать файл');
  return data;
}
async function download(body, filename) {
  const response = await apiRequest('/data-transfer/table', { method: 'POST', body: JSON.stringify(body) });
  if (!response.ok) throw new Error('Не удалось сохранить таблицу');
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement('a'); link.href = url; link.download = filename; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const errorText = error => error instanceof Error ? error.message : String(error);
export function render(root) {
  const state = { step: 'upload', input: null, inspected: null, result: null, busy: false, sortKey: 'reason', descending: false, onlyErrors: true };
  function draw() {
    const next = state.step === 'upload' ? 'Загрузить' : state.step === 'mapping' ? 'Проверить' : state.step === 'checked' ? 'Перенести' : 'Загрузить';
    root.innerHTML = page([
      workspaceHeaderContext({ title: 'Перенос данных', c: { label: next, data: 'data-transfer-next' } }),
      details([{ label: 'Шаг', value: state.step === 'upload' ? 'Загрузить' : state.step === 'mapping' ? 'Проверить' : state.step === 'checked' ? 'Перенести' : 'Результат' }]),
      state.step === 'upload' ? `<p>Загрузите XLSX или CSV. Можно перенести только нужные данные.</p>${button('Скачать шаблон', { variant: 'secondary', data: 'data-transfer-template' })}` : '',
      state.step === 'mapping' ? mapping() : '',
      state.result ? results() : '',
      '<p class="form-error" role="status" data-transfer-error></p>',
    ]);
    const nextButton = root.querySelector('[data-transfer-next]'); if (nextButton) nextButton.disabled = state.busy;
    nextButton?.addEventListener('click', advance);
    root.querySelector('[data-transfer-remap]')?.addEventListener('click', () => { state.step = 'mapping'; state.result = null; draw(); });
    root.querySelector('[data-transfer-template]')?.addEventListener('click', () => run(() => download({ template: true }, 'перенос-данных.xlsx')));
    root.querySelector('[data-transfer-table]')?.addEventListener('click', () => run(() => download({ rows: state.result.rows }, 'результат-переноса.xlsx')));
    root.querySelector('[data-transfer-errors-file]')?.addEventListener('click', () => run(() => download({ rows: state.result.rows.filter(row => row.reason) }, 'исправить-данные.xlsx')));
    root.querySelector('[data-transfer-only-errors]')?.addEventListener('click', () => { state.onlyErrors = !state.onlyErrors; draw(); });
    root.querySelectorAll('[data-sheet-domain]').forEach(input => input.addEventListener('change', () => {
      collect(); state.input.sheets[input.dataset.sheetDomain].columns = state.inspected.sheets.find(sheet => sheet.name === input.dataset.sheetDomain).columns; draw();
    }));
    root.querySelectorAll('[data-sheet-without-procedure]').forEach(control => control.addEventListener('click', () => {
      collect(); const item = state.input.sheets[control.dataset.sheetWithoutProcedure]; item.withoutProcedure = !item.withoutProcedure; draw();
    }));
    initAccordions(root);
    bindDataTable(root, key => { state.descending = state.sortKey === key ? !state.descending : false; state.sortKey = key; draw(); });
    window.dispatchEvent(new CustomEvent('book:v2-context-changed'));
  }
  function mapping() {
    return `${field({ label: 'Источник', name: 'transfer-source', value: state.input.source })}${state.inspected.sheets.map((sheet, index) => {
      const config = state.input.sheets[sheet.name];
      const fields = ['transferId','externalId','sourceKey', ...(state.inspected.domainFields[config.domain] || [])];
      const options = [{ value: '', label: 'Не переносить колонку' }, ...sheet.headers.map((header, i) => ({ value: String(i), label: header || `Колонка ${i + 1}` }))];
      return `<section>${details([{ label: 'Лист', value: `${sheet.name} · ${sheet.count} строк` }])}
        ${select({ label: 'Что переносим', name: `domain-${index}`, value: config.domain, data: `data-sheet-domain="${escapeHtml(sheet.name)}"`, options: [{ value: '', label: 'Выберите данные' }, ...Object.entries(state.inspected.domains).map(([value,label]) => ({ value,label })), { value: 'skip', label: 'Пропустить лист' }] })}
        ${config.domain && config.domain !== 'skip' ? accordion([{ title: 'Колонки файла', content: [...new Set(fields)].map(key => select({ label: state.inspected.fields[key], name: `column-${index}-${key}`, value: config.columns[key] == null ? '' : String(config.columns[key]), data: `data-column="${escapeHtml(key)}" data-sheet-index="${index}"`, options })).join('') }]) : ''}
        ${config.domain === 'consumables' ? `<p>Если процедура отсутствует, расходник требует исправления.</p>${settingToggle({ label: 'Импортировать без процедуры', checked: config.withoutProcedure === true, data: `data-sheet-without-procedure="${escapeHtml(sheet.name)}"` })}` : ''}
      </section>`;
    }).join('')}`;
  }
  function collect() {
    const source = root.querySelector('[name="transfer-source"]'); if (source) state.input.source = source.value.trim();
    state.inspected?.sheets.forEach((sheet, index) => {
      const config = state.input.sheets[sheet.name];
      const domain = root.querySelector(`[name="domain-${index}"]`); if (domain) config.domain = domain.value;
      const columns = root.querySelectorAll(`[data-sheet-index="${index}"][data-column]`);
      if (columns.length) { config.columns = {}; columns.forEach(input => { if (input.value !== '') config.columns[input.dataset.column] = Number(input.value); }); }
    });
  }
  function results() {
    const result = state.result;
    const summaries = Object.values(result.domains).map(stats => v2ListEntry({ interactive: false, title: stats.label, subtitle: `${result.preview ? 'Готово' : 'Перенесено'}: ${stats.transferred} · Уже есть: ${stats.unchanged} · Исправить: ${stats.failed}` }));
    const rows = result.rows.filter(row => !state.onlyErrors || row.reason).map(row => ({ sheet: row.sheet, row: row.row, transferId: row.transferId, reason: row.reason || (result.preview ? 'Готово' : row.status === 'unchanged' ? 'Уже перенесено' : 'Перенесено'), values: Object.entries(row.values).filter(([key]) => !['sourceKey','transferId'].includes(key)).map(([key,value]) => `${state.inspected.fields[key] || key}: ${String(value)}`).join('; ') }));
    return `${details([{ label: result.preview ? 'Готово к переносу' : 'Перенесено', value: result.transferred }, { label: 'Уже перенесено', value: result.unchanged }, { label: 'Требуют исправления', value: result.failed }])}
      ${v2ListEntries(summaries)}
      ${state.step === 'checked' ? button('Изменить колонки', { variant: 'secondary', data: 'data-transfer-remap' }) + '<p>Будут перенесены все понятные факты. Ошибки остальных останутся в таблице.</p>' : ''}
      ${button('Скачать всю таблицу с ID', { variant: 'secondary', data: 'data-transfer-table' })}
      ${result.failed ? button('Скачать данные для исправления', { variant: 'secondary', data: 'data-transfer-errors-file' }) : ''}
      ${settingToggle({ label: 'Только требуют исправления', checked: state.onlyErrors, data: 'data-transfer-only-errors' })}
      ${rows.length ? dataTable({ caption: 'Результат проверки данных', columns: [{ key: 'sheet', label: 'Данные' }, { key: 'row', label: 'Строка' }, { key: 'reason', label: 'Причина' }, { key: 'transferId', label: 'ID переноса' }, { key: 'values', label: 'Исходные значения' }], rows, sortKey: state.sortKey, descending: state.descending }) : ''}`;
  }
  async function run(work) {
    if (state.busy) return;
    state.busy = true;
    const control = root.querySelector('[data-transfer-next]'); if (control) control.disabled = true;
    try { await work(); }
    catch (error) { const node = root.querySelector('[data-transfer-error]'); if (node) node.textContent = errorText(error); else openNotice({ title: 'Перенос данных', message: errorText(error) }); }
    finally { state.busy = false; const control = root.querySelector('[data-transfer-next]'); if (control) control.disabled = false; }
  }
  async function advance() {
    if (state.busy) return;
    if (state.step === 'upload' || state.step === 'result') {
      const file = await selectFile({ accept: '.xlsx,.csv,.tsv' }); if (!file?.dataUrl) return;
      await run(async () => {
        const input = { dataUrl: file.dataUrl, filename: file.name || file.file?.name || 'данные.xlsx', source: file.name || file.file?.name || 'Файл', sheets: {} };
        const inspected = await request('inspect', input);
        inspected.sheets.forEach(sheet => { input.sheets[sheet.name] = { domain: sheet.domain, columns: sheet.columns, withoutProcedure: false }; });
        Object.assign(state, { input, inspected, step: 'mapping', result: null }); draw();
      });
    } else if (state.step === 'mapping') {
      collect(); await run(async () => { state.result = await request('check', state.input); state.step = 'checked'; draw(); });
    } else await run(async () => {
      state.result = await request('commit', state.input); state.step = 'result'; draw();
      window.dispatchEvent(new CustomEvent('book:server-mutation-completed', { detail: { scopes: ['business','operational','auxiliary','profile','inventory','finance'] } }));
    });
  }
  draw();
}
