import { accountErrorMessage, updateAccount, updateGlobalAccount } from '../core/account/index.js';
import {
  actionBlock,
  button,
  collectLinks,
  collectRepeatedField,
  datePicker,
  field,
  formValidationMessage,
  initDatePickers,
  initLinks,
  initRepeatedFields,
  links,
  mountV2ZLayer,
  v2ZLayer,
  v2Section,
  openNotice,
  phoneField,
  repeatedField,
  select,
} from '../ui/ui.js';
import { formError, formView } from '../ui/forms/index.js';

function profileData(account = {}) {
  return account.profileData && typeof account.profileData === 'object' ? account.profileData : {};
}

function unique(values = [], limit = 5) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => String(value || '').trim()).filter(Boolean))].slice(0, limit);
}

function editorMarkup(account = {}) {
  const profile = profileData(account);
  const today = new Date();
  const currentYear = today.getFullYear();
  const maxBirthDate = `${currentYear}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const fields = `<div class="form-grid">
    ${field({ label: 'Имя', name: 'name', value: account.name || '', required: true, autocomplete: 'given-name' })}
    ${field({ label: 'Фамилия', name: 'surname', value: account.surname || '', autocomplete: 'family-name' })}
    ${phoneField({ label: 'Телефон', name: 'phone', value: account.phone || '', required: true })}
    ${repeatedField({ label: 'Дополнительные телефоны', name: 'additionalPhone', values: profile.phones || [], type: 'tel', addLabel: '+ Телефон', showEmptyRow: false })}
    ${field({ label: 'Email', name: 'email', value: account.email || '', type: 'email', readonly: true })}
    ${repeatedField({ label: 'Дополнительные email', name: 'additionalEmail', values: profile.emails || [], type: 'email', placeholder: 'name@example.com', addLabel: '+ Email', showEmptyRow: false })}
    ${field({ label: 'Telegram', name: 'telegram', value: profile.telegram || '', placeholder: '@username', maxlength: 100 })}
    ${select({
      label: 'Пол',
      name: 'gender',
      value: profile.gender || '',
      options: [
        { value: '', label: 'Не указан' },
        { value: 'male', label: 'Мужской' },
        { value: 'female', label: 'Женский' },
      ],
    })}
    ${datePicker({label:'Дата рождения',name:'birthDate',value:profile.birthDate||'',max:maxBirthDate,minYear:currentYear-110,maxYear:currentYear,initialYear:currentYear-30,allowClear:true})}
    ${links({ label:'Ссылки', links:Array.isArray(profile.links)?profile.links:[], name:'accountProfileLinks' })}
  </div>`;
  return formView(`
    ${v2Section('Личные данные', fields)}
    ${formError('', { data: 'data-account-personal-error', keepEmpty: true })}
    ${actionBlock(button('Сохранить', { type: 'submit', data: 'data-account-personal-save' }))}
  `, { className: 'account-personal-data-form', data: 'data-account-personal-form' });
}

function formSignature(form) {
  return JSON.stringify([...new FormData(form).entries()].map(([key, value]) => [key, String(value)]));
}

export function openAccountPersonalDataZ(root, state, { onSaved, onDirtyChange, onClosed } = {}) {
  const layer = mountV2ZLayer(root, v2ZLayer(editorMarkup(state.account || {}), { className: 'account-personal-data-z' }), {
    stack: true,
    onClose: () => {
      onDirtyChange?.(false);
      onClosed?.();
    },
  });
  if (!layer) return null;
  initRepeatedFields(layer);
  initLinks(layer);
  initDatePickers(layer);

  const form = layer.querySelector('[data-account-personal-form]');
  const errorNode = layer.querySelector('[data-account-personal-error]');
  const saveButton = layer.querySelector('[data-account-personal-save]');
  const saveActions = saveButton?.closest('.modal-actions');
  const initialSignature = form ? formSignature(form) : '';
  const syncDirty = () => {
    const dirty = Boolean(form && formSignature(form) !== initialSignature);
    if (saveActions) saveActions.hidden = !dirty;
    onDirtyChange?.(dirty);
  };
  form?.addEventListener('input', syncDirty);
  form?.addEventListener('change', syncDirty);
  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const validationError = formValidationMessage(form);
    if (validationError) {
      if (errorNode) errorNode.textContent = validationError;
      return;
    }
    const data = new FormData(form);
    if (errorNode) errorNode.textContent = '';
    if (saveButton) saveButton.disabled = true;
    try {
      const currentProfile = profileData(state.account || {});
      const payload = {
        name: data.get('name'),
        surname: data.get('surname'),
        phone: data.get('phone'),
        profileData: {
          ...currentProfile,
          phones: unique(collectRepeatedField(form, 'additionalPhone')),
          emails: unique(collectRepeatedField(form, 'additionalEmail').map((value) => String(value).toLowerCase())),
          telegram: String(data.get('telegram') || '').trim(),
          gender: String(data.get('gender') || ''),
          birthDate: String(data.get('birthDate') || ''),
          links: collectLinks(form, 'accountProfileLinks').slice(0, 8),
        },
      };
      const account = state.globalAccount
        ? await updateGlobalAccount(payload)
        : await updateAccount(state.tenantId, payload);
      state.account = account;
      onDirtyChange?.(false);
      layer.v2Close?.();
      await onSaved?.(account);
    } catch (error) {
      if (saveButton) saveButton.disabled = false;
      openNotice({
        title: 'Данные не сохранены',
        message: accountErrorMessage(error, 'Не удалось сохранить данные'),
        action: 'Закрыть',
        variant: 'technical',
      });
    }
  });
  syncDirty();
  return layer;
}
