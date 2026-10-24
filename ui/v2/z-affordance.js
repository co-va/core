const Z_DISMISS_STYLE = [
  'box-sizing:border-box',
  'display:grid',
  'place-items:center',
  'width:24px',
  'min-width:24px',
  'max-width:24px',
  'height:24px',
  'min-height:24px',
  'max-height:24px',
  'margin:0 0 2px 18px',
  'padding:0',
  'border:0',
  'border-radius:0',
  'background:transparent',
  'box-shadow:none',
  'color:#111',
  'font:inherit',
  'line-height:1',
  'cursor:pointer',
  'touch-action:manipulation',
  'position:relative',
  'z-index:3',
].join(';');

export function v2ZDismissAffordance() {
  return `<button type="button" data-v2-z-dismiss aria-label="Смахнуть экран вправо" style="${Z_DISMISS_STYLE}"><svg aria-hidden="true" viewBox="0 0 20 20" width="16" height="16" fill="none" style="filter:drop-shadow(0 2px 3px rgba(0,0,0,.45))"><path d="M7 4l6 6-6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>`;
}

export function bindV2ZDismissAffordance(surface, { onDismiss = null, isEnabled = null } = {}) {
  const control = surface?.querySelector?.(':scope > [data-v2-z-header] > [data-v2-z-dismiss], :scope > [data-v2-q-header] > [data-v2-z-dismiss]');
  if (!control || typeof onDismiss !== 'function') return () => {};
  const click = (event) => {
    if (typeof isEnabled === 'function' && !isEnabled()) return;
    event.preventDefault();
    event.stopPropagation();
    onDismiss();
  };
  control.addEventListener('click', click);
  return () => control.removeEventListener('click', click);
}
