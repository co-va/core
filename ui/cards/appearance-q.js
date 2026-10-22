import { actionBlock } from '../page/page.js';
import { button } from '../buttons/index.js';
import { workspaceHeaderContext } from '../header/index.js';
import { modal, mountModal } from '../modals/index.js';
import { select } from '../selectors/index.js';
import { mountEntityCardConstructor } from './entity-card-constructor.js';

function optionValue(options = [], preferred = '') {
  const values = (Array.isArray(options) ? options : []).map((item) => String(item?.value ?? ''));
  const candidate = String(preferred || '');
  return values.includes(candidate) ? candidate : (values[0] || '');
}

export function openEntityCardAppearanceQ(root, {
  title = 'Вид',
  typeLabel = 'Тип карты',
  typeOptions = [],
  initialType = '',
  targetLabel = 'Карта',
  initialTarget = 'all',
  targetOptions = () => [],
  resolve = () => ({}),
  save = async () => {},
  onSaved = () => {},
  allowPhoto = true,
} = {}) {
  const types = Array.isArray(typeOptions) ? typeOptions.filter(Boolean) : [];
  if (!types.length) return null;

  let type = optionValue(types, initialType);
  let target = String(initialTarget || 'all');
  const layer = mountModal(root, modal('<div data-entity-card-appearance-q></div>', {
    title,
    variant: 'q',
    className: 'entity-card-appearance-q',
  }));
  const host = layer?.querySelector('[data-entity-card-appearance-q]');
  const previewHost = layer?.querySelector('[data-v2-q-header-content]');
  if (!host) return layer;

  const render = () => {
    const targets = Array.isArray(targetOptions(type)) ? targetOptions(type).filter(Boolean) : [];
    target = targets.length ? optionValue(targets, target) : '';
    const editor = resolve(type, target) || {};
    const typeSelector = types.length > 1 ? select({
      name: 'entityCardAppearanceType',
      label: typeLabel,
      value: type,
      options: types,
      data: 'data-entity-card-appearance-type',
    }) : '';
    const targetSelector = targets.length ? select({
      name: 'entityCardAppearanceTarget',
      label: targetLabel,
      value: target,
      options: targets,
      data: 'data-entity-card-appearance-target',
    }) : '';
    const selectors = `${typeSelector}${targetSelector}`;

    if (previewHost) previewHost.replaceChildren();
    host.innerHTML = `${workspaceHeaderContext({ title })}
      ${selectors ? `<div class="form-grid entity-card-appearance-q__selectors">${selectors}</div>` : ''}
      <div data-entity-card-appearance-constructor></div>
      ${actionBlock(button('Сохранить', {
        data: 'data-card-q-save',
        aria: 'Сохранить вид карты',
      }))}`;

    host.querySelector('[name="entityCardAppearanceType"]')?.addEventListener('change', (event) => {
      type = String(event.target.value || '');
      target = 'all';
      render();
    });
    host.querySelector('[name="entityCardAppearanceTarget"]')?.addEventListener('change', (event) => {
      target = String(event.target.value || '');
      render();
    });

    const constructor = host.querySelector('[data-entity-card-appearance-constructor]');
    const saveButton = host.querySelector('[data-card-q-save]');
    const saveActions = saveButton?.closest('.modal-actions');
    let controller = null;
    const syncHeaderPreview = () => {
      if (!previewHost || !constructor) return;
      const preview = constructor.querySelector('[data-card-preview]');
      if (!preview) return;
      previewHost.innerHTML = preview.innerHTML;
      preview.hidden = true;
    };
    const syncSaveButton = ({ dirty = false, saving = false } = {}) => {
      syncHeaderPreview();
      if (!saveButton) return;
      saveButton.disabled = Boolean(saving);
      if (saveActions) saveActions.hidden = !dirty;
    };
    controller = mountEntityCardConstructor(constructor, {
      appearance: editor.appearance || {},
      fields: editor.fields || [],
      photo: editor.photo || '',
      photoPosition: editor.photoPosition || '50% 50%',
      allowPhoto,
      onSave: async ({ appearance, photo }) => {
        await save({ type, target, appearance, photo, editor });
        layer.v2Close?.();
        onSaved({ type, target });
      },
      onStateChange: syncSaveButton,
    });
    syncHeaderPreview();
    saveButton?.addEventListener('click', () => {
      void controller?.save?.();
    });
    syncSaveButton({
      dirty: controller?.isDirty?.() || false,
      saving: controller?.isSaving?.() || false,
    });
  };

  render();
  return layer;
}
