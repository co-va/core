import { escapeHtml } from '../utils/escape-html.js';
import { button } from '../buttons/index.js';
import { select } from '../selectors/index.js';
import { phoneCountryOptions, phoneInputState } from '../../core/phone/index.js';

let phoneInputId = 0;
let phoneEventsReady = false;

function labelText(label, required) {
  const value = String(label || '');
  return required && value && !value.trim().endsWith('*') ? `${value} *` : value;
}

function phoneCountryLabel(iso) {
  const full = phoneCountryOptions().find((option) => option.value === iso)?.label || '';
  return full.match(/\+\d{1,4}\b/)?.[0] || iso;
}

function setPhoneCountry(host, iso) {
  const countryInput = host?.querySelector('input[data-phone-country]');
  const trigger = countryInput?.closest('.ui-select')?.querySelector('[data-ui-select-trigger]');
  if (!countryInput || !trigger) return;
  countryInput.value = iso;
  const valueNode = trigger.querySelector('.ui-select__value');
  if (valueNode) valueNode.textContent = phoneCountryLabel(iso);
}

function syncPhoneHost(host, rawValue, { detectCountry = true } = {}) {
  if (!host) return;
  const nationalInput = host.querySelector('[data-phone-national]');
  const valueInput = host.querySelector('[data-phone-value]');
  const countryInput = host.querySelector('input[data-phone-country]');
  if (!nationalInput || !valueInput || !countryInput) return;

  const raw = String(rawValue ?? nationalInput.value ?? '');
  const state = phoneInputState(raw, countryInput.value || 'RU');
  if (detectCountry && state.countryIso !== countryInput.value) setPhoneCountry(host, state.countryIso);

  nationalInput.value = state.displayNational;
  valueInput.value = state.canonical;
  host.dataset.phoneComplete = state.complete ? 'true' : 'false';
}

function ensurePhoneEvents() {
  if (phoneEventsReady || typeof document === 'undefined') return;
  phoneEventsReady = true;

  document.addEventListener('input', (event) => {
    const input = event.target.closest?.('[data-phone-national]');
    if (!input) return;
    syncPhoneHost(input.closest('[data-phone-input]'), input.value, { detectCountry: true });
  });

  document.addEventListener('change', (event) => {
    const country = event.target.closest?.('input[data-phone-country]');
    if (country) {
      const host = country.closest('[data-phone-input]');
      const national = host?.querySelector('[data-phone-national]');
      setPhoneCountry(host, country.value);
      syncPhoneHost(host, national?.value || '', { detectCountry: false });
      return;
    }

    const national = event.target.closest?.('[data-phone-national]');
    if (national) syncPhoneHost(national.closest('[data-phone-input]'), national.value, { detectCountry: true });
  });
}

export function field({ label = '', name = '', value = '', type = 'text', placeholder = '', required = false, readonly = false, disabled = false, inputmode = '', maxlength = '', autocomplete = '', min = '', max = '', step = '', data = '' } = {}) {
  return `<label class="field"><span>${escapeHtml(labelText(label, required))}</span><input name="${escapeHtml(name)}" type="${escapeHtml(type)}" value="${escapeHtml(value)}" placeholder="${escapeHtml(placeholder)}"${required ? ' required' : ''}${readonly ? ' readonly' : ''}${disabled ? ' disabled' : ''}${inputmode ? ` inputmode="${escapeHtml(inputmode)}"` : ''}${maxlength !== '' ? ` maxlength="${escapeHtml(maxlength)}"` : ''}${autocomplete ? ` autocomplete="${escapeHtml(autocomplete)}"` : ''}${min !== '' ? ` min="${escapeHtml(min)}"` : ''}${max !== '' ? ` max="${escapeHtml(max)}"` : ''}${step !== '' ? ` step="${escapeHtml(step)}"` : ''}${data ? ` ${data}` : ''}></label>`;
}

export function passwordField({ label = 'Пароль', name = 'password', value = '', required = false, autocomplete = 'current-password' } = {}) {
  const eye = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12s3.4-5.5 9.5-5.5 9.5 5.5 9.5 5.5-3.4 5.5-9.5 5.5S2.5 12 2.5 12Z"></path><circle cx="12" cy="12" r="2.5"></circle></svg>';
  return `<div class="field password-field" data-password-field><span>${escapeHtml(labelText(label, required))}</span><div class="password-field__control"><input name="${escapeHtml(name)}" type="password" value="${escapeHtml(value)}"${required ? ' required' : ''} autocomplete="${escapeHtml(autocomplete)}" data-password-input><button type="button" class="password-field__toggle" data-password-toggle aria-label="Показать пароль" aria-pressed="false">${eye}</button></div></div>`;
}

export function formValidationMessage(form) {
  if (!form?.elements) return '';
  const controls = [...form.elements];
  controls.forEach((control) => control?.removeAttribute?.('aria-invalid'));

  const phone = controls.find((control) => control?.matches?.('[data-phone-national]') && control.required && control.closest?.('[data-phone-input]')?.dataset.phoneComplete !== 'true');
  if (phone) {
    phone.setAttribute?.('aria-invalid', 'true');
    phone.focus?.({ preventScroll: true });
    return 'Введите номер телефона полностью.';
  }

  const invalid = controls.find((control) => control?.willValidate && !control.validity?.valid);
  if (!invalid) return '';

  invalid.setAttribute?.('aria-invalid', 'true');
  invalid.focus?.({ preventScroll: true });
  if (invalid.validity?.valueMissing) return 'Заполните обязательные поля.';
  if (invalid.type === 'email' && invalid.validity?.typeMismatch) return 'Введите корректный email.';
  if (invalid.validity?.tooLong) return 'Сократите введённый текст.';
  return 'Проверьте введённые данные.';
}

export function initPasswordFields(root = document) {
  root?.querySelectorAll?.('[data-password-field]').forEach((host) => {
    const input = host.querySelector('[data-password-input]');
    const toggle = host.querySelector('[data-password-toggle]');
    if (!input || !toggle || toggle.dataset.passwordReady === 'true') return;
    toggle.dataset.passwordReady = 'true';
    toggle.addEventListener('click', () => {
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      toggle.setAttribute('aria-pressed', show ? 'true' : 'false');
      toggle.setAttribute('aria-label', show ? 'Скрыть пароль' : 'Показать пароль');
    });
  });
}

export function phoneInput({ name = 'phone', value = '', required = false, aria = 'Телефон' } = {}) {
  ensurePhoneEvents();
  const state = phoneInputState(value, 'RU');
  const countryName = `${name}Country${++phoneInputId}`;
  const countrySelect = select({
    name: countryName,
    value: state.countryIso,
    options: phoneCountryOptions(),
    aria: 'Страна и код телефона',
    className: 'phone-input__country',
    data: 'data-phone-country',
    searchable: true,
  }).replace(/(<span class="ui-select__value">)[\s\S]*?(<\/span>)/, `$1${escapeHtml(phoneCountryLabel(state.countryIso))}$2`);
  return `<div class="phone-input" data-phone-input data-phone-complete="${state.complete ? 'true' : 'false'}">${countrySelect}<input class="phone-input__national" type="tel" value="${escapeHtml(state.displayNational)}" placeholder="903 123-45-67" inputmode="tel" autocomplete="tel" data-phone-national aria-label="${escapeHtml(aria)}"${required ? ' required' : ''}><input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(state.canonical)}" data-phone-value></div>`;
}

export function phoneField({ label = 'Телефон', name = 'phone', value = '', required = false } = {}) {
  return `<div class="field phone-field"><span>${escapeHtml(labelText(label, required))}</span>${phoneInput({ name, value, required, aria: label })}</div>`;
}

export function textareaField({ label = '', name = '', value = '', placeholder = '', required = false, rows = 4, maxlength = '' } = {}) {
  return `<label class="field"><span>${escapeHtml(labelText(label, required))}</span><textarea name="${escapeHtml(name)}" rows="${escapeHtml(rows)}" placeholder="${escapeHtml(placeholder)}"${required ? ' required' : ''}${maxlength !== '' ? ` maxlength="${escapeHtml(maxlength)}"` : ''}>${escapeHtml(value)}</textarea></label>`;
}

export function rangeField({ label = '', name = '', value = 0, min = 0, max = 100, step = 1, data = '', aria = '' } = {}) {
  return `<label class="field ui-range"><span>${escapeHtml(label)}</span><input type="range" name="${escapeHtml(name)}" value="${escapeHtml(value)}" min="${escapeHtml(min)}" max="${escapeHtml(max)}" step="${escapeHtml(step)}"${data ? ` ${data}` : ''}${aria ? ` aria-label="${escapeHtml(aria)}"` : ''}></label>`;
}

function photoCropPosition(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.min(100, Math.round(numeric))) : 50;
}
function photoFileDataUrl(file) {
  return new Promise((resolve, reject) => {
    if (!file) {
      resolve('');
      return;
    }
    const reader = new FileReader();
    reader.addEventListener('load', () => resolve(String(reader.result || '')), { once: true });
    reader.addEventListener('error', () => reject(reader.error || new Error('Не удалось прочитать фото')), { once: true });
    reader.readAsDataURL(file);
  });
}

export function selectPhotoFile({ accept = 'image/*' } = {}) {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.hidden = true;
    document.body.appendChild(input);

    const cleanup = () => input.remove();
    input.addEventListener('change', async () => {
      try {
        resolve(await photoFileDataUrl(input.files?.[0]));
      } catch (error) {
        reject(error);
      } finally {
        cleanup();
      }
    }, { once: true });
    input.addEventListener('cancel', () => {
      cleanup();
      resolve('');
    }, { once: true });
    input.click();
  });
}


export function selectFile({ accept = '' } = {}) {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = String(accept || '');
    input.hidden = true;
    document.body.appendChild(input);

    const cleanup = () => input.remove();
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) {
        cleanup();
        resolve(null);
        return;
      }
      try {
        const dataUrl = await photoFileDataUrl(file);
        resolve({
          name: String(file.name || ''),
          type: String(file.type || ''),
          size: Number(file.size || 0),
          dataUrl,
        });
      } catch (error) {
        reject(error);
      } finally {
        cleanup();
      }
    }, { once: true });
    input.addEventListener('cancel', () => {
      cleanup();
      resolve(null);
    }, { once: true });
    input.click();
  });
}

export function photoField({
  name = 'photo',
  value = '',
  cropX = 50,
  cropY = 50,
  cropXName = '',
  cropYName = '',
} = {}) {
  const x = photoCropPosition(cropX);
  const y = photoCropPosition(cropY);
  const resolvedCropXName = cropXName || `${name}CropX`;
  const resolvedCropYName = cropYName || `${name}CropY`;
  const preview = value
    ? `<div class="photo-field__preview" style="background-image:url('${escapeHtml(value)}')" aria-hidden="true"></div>`
    : '<div class="photo-field__preview photo-field__preview--empty" aria-hidden="true">Фото</div>';
  const toolsClass = value ? 'photo-field__tools' : 'photo-field__tools is-hidden';
  return `<div class="photo-field" data-photo-field>
    <span class="photo-field__label">Фото</span>
    <label class="photo-field__control">
      ${preview}
      <span class="photo-field__action">${value ? 'Изменить фото' : 'Добавить фото'}</span>
      <input type="file" accept="image/*" data-photo-input>
    </label>
    <div class="${toolsClass}" data-photo-tools>
      ${button('Кадр для A', { className:'photo-field__crop-toggle', data:'data-photo-crop-toggle', variant:'secondary' })}
      ${button('Удалить фото', { className:'photo-field__remove', data:'data-photo-remove', variant:'secondary' })}
    </div>
    <div class="photo-field__crop-panel photo-cropper" data-photo-crop-panel hidden>
      <div class="photo-cropper__preview" data-photo-crop-preview style="background-image:url('${escapeHtml(value)}');background-position:${x}% ${y}%"></div>
      <label class="field"><span>По горизонтали</span><input type="range" min="0" max="100" value="${x}" data-photo-crop-x></label>
      <label class="field"><span>По вертикали</span><input type="range" min="0" max="100" value="${y}" data-photo-crop-y></label>
    </div>
    <input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}" data-photo-value>
    <input type="hidden" name="${escapeHtml(resolvedCropXName)}" value="${x}" data-photo-crop-x-value>
    <input type="hidden" name="${escapeHtml(resolvedCropYName)}" value="${y}" data-photo-crop-y-value>
  </div>`;
}

function syncPhotoCropPreview(fieldRoot) {
  const value = fieldRoot.querySelector('[data-photo-value]');
  const cropX = fieldRoot.querySelector('[data-photo-crop-x-value]');
  const cropY = fieldRoot.querySelector('[data-photo-crop-y-value]');
  const preview = fieldRoot.querySelector('[data-photo-crop-preview]');
  if (!preview || !value) return;
  preview.style.backgroundImage = value.value ? `url("${value.value.replaceAll('"','%22')}")` : '';
  preview.style.backgroundPosition = `${photoCropPosition(cropX?.value)}% ${photoCropPosition(cropY?.value)}%`;
}

export function initPhotoField(root) {
  root.querySelectorAll('[data-photo-field]').forEach((fieldRoot) => {
    if (fieldRoot.dataset.photoInitialized === 'true') return;
    fieldRoot.dataset.photoInitialized = 'true';

    const input = fieldRoot.querySelector('[data-photo-input]');
    const value = fieldRoot.querySelector('[data-photo-value]');
    const cropXValue = fieldRoot.querySelector('[data-photo-crop-x-value]');
    const cropYValue = fieldRoot.querySelector('[data-photo-crop-y-value]');
    const cropX = fieldRoot.querySelector('[data-photo-crop-x]');
    const cropY = fieldRoot.querySelector('[data-photo-crop-y]');
    const preview = fieldRoot.querySelector('.photo-field__preview');
    const action = fieldRoot.querySelector('.photo-field__action');
    const tools = fieldRoot.querySelector('[data-photo-tools]');
    const cropPanel = fieldRoot.querySelector('[data-photo-crop-panel]');
    if (!input || !value || !preview || !action || !cropXValue || !cropYValue) return;

    const setCrop = (x, y) => {
      const nextX = photoCropPosition(x);
      const nextY = photoCropPosition(y);
      cropXValue.value = String(nextX);
      cropYValue.value = String(nextY);
      if (cropX) cropX.value = String(nextX);
      if (cropY) cropY.value = String(nextY);
      syncPhotoCropPreview(fieldRoot);
      cropXValue.dispatchEvent(new Event('change', { bubbles: true }));
    };

    const setOriginal = (src) => {
      value.value = src;
      preview.classList.toggle('photo-field__preview--empty', !src);
      preview.style.backgroundImage = src ? `url("${src.replaceAll('"','%22')}")` : '';
      preview.textContent = src ? '' : 'Фото';
      action.textContent = src ? 'Изменить фото' : 'Добавить фото';
      tools?.classList.toggle('is-hidden', !src);
      if (!src && cropPanel) cropPanel.hidden = true;
      value.dispatchEvent(new Event('change', { bubbles: true }));
    };

    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return;
      const src = await photoFileDataUrl(file).catch(() => '');
      if (!src) return;
      setOriginal(src);
      setCrop(50, 50);
      if (cropPanel) cropPanel.hidden = false;
    });

    fieldRoot.querySelector('[data-photo-crop-toggle]')?.addEventListener('click', () => {
      if (!value.value || !cropPanel) return;
      cropPanel.hidden = !cropPanel.hidden;
      if (!cropPanel.hidden) syncPhotoCropPreview(fieldRoot);
    });

    const onCropInput = () => {
      setCrop(cropX?.value, cropY?.value);
    };
    cropX?.addEventListener('input', onCropInput);
    cropY?.addEventListener('input', onCropInput);

    fieldRoot.querySelector('[data-photo-remove]')?.addEventListener('click', () => {
      input.value = '';
      setOriginal('');
      setCrop(50, 50);
    });

    syncPhotoCropPreview(fieldRoot);
  });
}
