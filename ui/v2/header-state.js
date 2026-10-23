const menuHeaderState = new WeakMap();

function rootApp(root) {
  return root?.matches?.('[data-v2-app]')
    ? root
    : root?.closest?.('[data-v2-app]') || root?.querySelector?.('[data-v2-app]');
}

function captureHeader(header) {
  const title = header.querySelector('.v2-header__title');
  const cSlot = header.querySelector('.v2-header__slot--c');
  const dSlot = header.querySelector('.v2-header__slot--d');
  const dControl = dSlot?.querySelector('.v2-header__control');
  return {
    title,
    titleHtml: title?.innerHTML ?? '',
    titleAria: title?.getAttribute('aria-label'),
    cSlot,
    cHidden: Boolean(cSlot?.hidden),
    cDisplay: cSlot?.style.display ?? '',
    hadCClass: header.classList.contains('has-c'),
    dControl,
    dDisabled: Boolean(dControl?.disabled),
    dClassName: dControl?.className || '',
    dHtml: dControl?.innerHTML ?? '',
    dAria: dControl?.getAttribute('aria-label'),
  };
}

function applyMenuHeader(header, state) {
  if (state.title) {
    state.title.textContent = 'Меню';
    if (state.title.matches('button')) state.title.setAttribute('aria-label', 'Меню');
  }
  if (state.cSlot) {
    state.cSlot.hidden = true;
    state.cSlot.style.display = 'none';
  }
  header.classList.remove('has-c');
  if (state.dControl) state.dControl.disabled = false;
}

function restoreHeader(header, state) {
  if (state.title?.isConnected) {
    state.title.innerHTML = state.titleHtml;
    if (state.titleAria == null) state.title.removeAttribute('aria-label');
    else state.title.setAttribute('aria-label', state.titleAria);
  }
  if (state.cSlot?.isConnected) {
    state.cSlot.hidden = state.cHidden;
    state.cSlot.style.display = state.cDisplay;
  }
  header.classList.toggle('has-c', state.hadCClass);
  if (state.dControl?.isConnected) {
    state.dControl.disabled = state.dDisabled;
    state.dControl.className = state.dClassName;
    state.dControl.innerHTML = state.dHtml;
    if (state.dAria == null) state.dControl.removeAttribute('aria-label');
    else state.dControl.setAttribute('aria-label', state.dAria);
  }
}

export function setV2MenuHeaderState(root, open) {
  const app = rootApp(root);
  const header = app?.querySelector?.(':scope > [data-v2-header]');
  if (!app || !header) return Boolean(open);

  if (open) {
    if (header.dataset.v2MenuHeader === 'true' && menuHeaderState.has(header)) return true;
    if (!menuHeaderState.has(header)) menuHeaderState.set(header, captureHeader(header));
    applyMenuHeader(header, menuHeaderState.get(header));
    header.dataset.v2MenuHeader = 'true';
    return true;
  }

  const state = menuHeaderState.get(header);
  if (state) restoreHeader(header, state);
  menuHeaderState.delete(header);
  delete header.dataset.v2MenuHeader;
  return false;
}

export function bindV2MenuHeaderState(root) {
  const app = rootApp(root);
  if (!app || typeof MutationObserver !== 'function') return () => {};
  let queued = false;
  const sync = () => {
    queued = false;
    if (!app.isConnected || !app.classList.contains('is-deck-open')) return;
    const header = app.querySelector(':scope > [data-v2-header]');
    if (!header || header.dataset.v2MenuHeader === 'true') return;
    setV2MenuHeaderState(app, true);
  };
  const observer = new MutationObserver(() => {
    if (queued) return;
    queued = true;
    queueMicrotask(sync);
  });
  observer.observe(app, { childList: true, subtree: true });
  return () => {
    observer.disconnect();
    setV2MenuHeaderState(app, false);
  };
}
