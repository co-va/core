import { button, modal, mountModal } from '../../ui/ui.js';

const CORRECT = '[data-record-payment-correct]';
const REFUND = '[data-record-payment-refund]';
const DELETE = '[data-record-payment-delete]';

function actionMenuBody() {
  return `<div class="form-grid">
    ${button('Корректировка оплаты', { variant: 'secondary', data: 'data-record-payment-v-correct' })}
    ${button('Возврат', { variant: 'danger', data: 'data-record-payment-v-refund' })}
    ${button('Удаление оплаты', { variant: 'critical', data: 'data-record-payment-v-delete' })}
  </div>`;
}

export function packRecordPaymentActionsIntoV(layer) {
  if (!layer) return null;
  const host = layer.querySelector('[data-record-payment-q-host]');
  const contextAction = layer.querySelector('[data-workspace-context-action]');
  if (!host || !contextAction) return layer;

  let sourceActions = null;
  let cleaned = false;

  const emitContextChange = () => {
    window.dispatchEvent(new CustomEvent('book:v2-context-changed'));
  };

  const setContextEnabled = (enabled) => {
    const disabled = !enabled;
    const changed = contextAction.disabled !== disabled;
    contextAction.disabled = disabled;
    contextAction.setAttribute('aria-label', enabled ? 'Действия оплаты' : 'Оплата');
    if (changed) emitContextChange();
  };

  const sync = () => {
    if (!layer.isConnected) {
      cleanup();
      return;
    }
    sourceActions = host.querySelector('.record-payment-actions');
    if (sourceActions) sourceActions.hidden = true;
    setContextEnabled(Boolean(sourceActions));
  };

  const delegate = (selector) => {
    const control = sourceActions?.querySelector(selector);
    if (!control || control.disabled) return;
    control.click();
  };

  const openMenu = () => {
    sync();
    if (!sourceActions) return null;
    const menu = mountModal(document.body, modal(actionMenuBody(), {
      variant: 'x',
      surface: 'app',
      title: 'Действия оплаты',
      xRole: 'action',
    }));
    if (!menu) return null;

    const run = (selector) => {
      menu.v2Close?.();
      delegate(selector);
    };
    menu.querySelector('[data-record-payment-v-correct]')?.addEventListener('click', () => run(CORRECT));
    menu.querySelector('[data-record-payment-v-refund]')?.addEventListener('click', () => run(REFUND));
    menu.querySelector('[data-record-payment-v-delete]')?.addEventListener('click', () => run(DELETE));
    return menu;
  };

  const observer = new MutationObserver(sync);
  observer.observe(host, { childList: true });
  contextAction.addEventListener('click', openMenu);

  const onContextChanged = () => {
    if (!layer.isConnected) cleanup();
  };

  function cleanup() {
    if (cleaned) return;
    cleaned = true;
    observer.disconnect();
    contextAction.removeEventListener('click', openMenu);
    window.removeEventListener('book:v2-context-changed', onContextChanged);
  }

  window.addEventListener('book:v2-context-changed', onContextChanged);
  sync();
  return layer;
}
