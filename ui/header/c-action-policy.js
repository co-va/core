const LOWER_MARKER = 'v2CPolicyLower';
const DIRECT_MARKER = 'v2CPolicyDirect';

let scanQueued = false;

function labelOf(node) {
  return String(
    node?.dataset?.v2PrimaryLabel
    || node?.getAttribute?.('aria-label')
    || node?.textContent
    || ''
  ).replace(/\s+/g, ' ').trim();
}

function isAddAction(node) {
  if (!node) return false;
  const label = labelOf(node).toLocaleLowerCase('ru-RU');
  if (label === '+') return true;
  if (label.startsWith('добав')) return true;
  if (node.matches?.('[data-add],[data-add-workplace]')) return true;
  return [...(node.attributes || [])].some((attribute) => /^data-(?:[a-z0-9-]*-)?add(?:-|$)/i.test(attribute.name));
}

function setAddGlyph(node) {
  if (!node || node.textContent === '+') return;
  node.textContent = '+';
}

function actionKey(node) {
  if (!node) return '';
  const ignored = new Set([
    'data-v2-primary-action',
    'data-v2-primary-label',
    'data-v2-primary-visible',
    'data-v2-primary-variant',
    'data-v2-workspace-primary',
    'data-v2-c-policy-lower',
    'data-v2-c-policy-direct',
  ]);
  for (const attribute of node.attributes || []) {
    if (!attribute.name.startsWith('data-') || ignored.has(attribute.name)) continue;
    return `${attribute.name}=${attribute.value}`;
  }
  return '';
}

function sameAction(left, right) {
  const leftKey = actionKey(left);
  const rightKey = actionKey(right);
  return Boolean(leftKey && rightKey && leftKey === rightKey);
}

function cleanEmptyPolicyActions(root = document) {
  root.querySelectorAll?.('.modal-actions[data-v2-c-policy-actions]').forEach((wrapper) => {
    if (!wrapper.querySelector('button')) wrapper.remove();
  });
}

function normalizeBottomButton(button) {
  if (!button) return;
  button.classList.remove(
    'v2-header__control',
    'v2-header__control--text',
    'v2-header__control--white',
    'v2-header__control--danger',
    'v2-primary-source-only',
    'v2-workspace-source-hidden',
  );
  button.classList.add('ui-button');
  const danger = button.dataset.v2PrimaryVariant === 'danger';
  button.classList.toggle('ui-button--danger', danger);
  button.classList.toggle('ui-button--secondary', button.dataset.v2PrimaryVariant === 'secondary' || button.dataset.v2PrimaryVariant === 'white');
}

function syncLowerButton(button) {
  if (!button?.dataset?.[LOWER_MARKER]) return;
  const wrapper = button.closest('.modal-actions');
  const nextLabel = String(button.dataset.v2PrimaryLabel || '').trim();
  if (nextLabel && button.textContent !== nextLabel) button.textContent = nextLabel;
  const danger = button.dataset.v2PrimaryVariant === 'danger';
  button.classList.toggle('ui-button--danger', danger);
  button.classList.toggle('ui-button--secondary', button.dataset.v2PrimaryVariant === 'secondary' || button.dataset.v2PrimaryVariant === 'white');
  if (wrapper && button.dataset.v2CPolicyForceVisible !== 'true') {
    const hidden = button.dataset.v2PrimaryVisible === 'false';
    if (wrapper.hidden !== hidden) wrapper.hidden = hidden;
  }
}

function stripHeaderC(header, button) {
  const slot = button?.closest('.v2-header__slot--c');
  if (slot) slot.remove();
  header?.classList.remove('has-c');
  if (!header) return;
  const hasD = Boolean(header.querySelector('.v2-header__slot--d'));
  const layout = hasD ? '52px minmax(0,1fr) 0 46px' : '52px minmax(0,1fr)';
  if (header.style.gridTemplateColumns !== layout) header.style.gridTemplateColumns = layout;
}

function activeContextRoot(app) {
  const qLayers = [...document.querySelectorAll('[data-v2-q="true"]')]
    .filter((node) => node.isConnected);
  if (qLayers.length) {
    const q = qLayers.at(-1);
    return q.querySelector('.v2-layer') || q;
  }
  const layers = [...(app?.querySelectorAll?.('[data-v2-z-layer]') || [])]
    .filter((node) => node.isConnected);
  return layers.at(-1) || app?.querySelector?.('[data-v2-workspace-surface]') || null;
}

function sourceForWorkspaceC(header, button) {
  const app = header.closest('[data-v2-app]');
  const contextRoot = activeContextRoot(app);
  if (!contextRoot) return null;
  const candidates = [
    ...contextRoot.querySelectorAll('.v2-workspace-source-hidden,[data-v2-primary-action]'),
  ].filter((node) => node !== button && node.tagName === 'BUTTON');
  if (!candidates.length) return null;
  return candidates.find((node) => labelOf(node) === labelOf(button)) || candidates.at(-1);
}

function ensureInPlaceActionWrapper(source) {
  const existing = source.closest('.modal-actions');
  if (existing) return existing;
  const wrapper = document.createElement('div');
  wrapper.className = 'profile-actions modal-actions';
  wrapper.dataset.v2CPolicyActions = '';
  const pageAction = source.closest('.page-header-action');
  if (pageAction) {
    const pageHeader = pageAction.closest('.page-header');
    pageHeader?.insertAdjacentElement('afterend', wrapper);
    wrapper.append(source);
    return wrapper;
  }
  source.before(wrapper);
  wrapper.append(source);
  return wrapper;
}

function suppressWorkspacePromotion(source) {
  source.removeAttribute('data-v2-primary-action');
  if (source.hasAttribute('data-timetable-apply')) {
    source.dataset.v2CPolicyOrigin = 'timetable-apply';
    source.removeAttribute('data-timetable-apply');
  }
  if (source.hasAttribute('data-save-profile')) {
    source.dataset.v2CPolicyOrigin = source.dataset.v2CPolicyOrigin || 'save-profile';
    source.removeAttribute('data-save-profile');
  }
  if (source.type === 'submit' && !source.dataset.v2PrimaryVisible) {
    source.dataset.v2PrimaryVisible = 'false';
    source.dataset.v2CPolicyForceVisible = 'true';
  }
}

function dedupeAgainstExistingBottom(source, wrapperRoot) {
  const key = actionKey(source);
  if (!key) return null;
  return [...wrapperRoot.querySelectorAll('.modal-actions button')]
    .find((candidate) => candidate !== source && sameAction(candidate, source)) || null;
}

function convertWorkspaceC(header, button) {
  const source = sourceForWorkspaceC(header, button);
  if (!source) return false;
  if (isAddAction(source) || isAddAction(button)) {
    setAddGlyph(button);
    return true;
  }

  const contextRoot = activeContextRoot(header.closest('[data-v2-app]')) || document;
  const existingBottom = dedupeAgainstExistingBottom(source, contextRoot);
  if (existingBottom) {
    source.remove();
    stripHeaderC(header, button);
    return true;
  }

  const wrapper = ensureInPlaceActionWrapper(source);
  source.dataset[LOWER_MARKER] = 'true';
  normalizeBottomButton(source);
  suppressWorkspacePromotion(source);
  syncLowerButton(source);
  if (source.dataset.v2CPolicyForceVisible === 'true') wrapper.hidden = false;
  stripHeaderC(header, button);
  return true;
}

function activeBodyForHeader(header) {
  const q = header.closest('[data-v2-q="true"]');
  if (q) return q.querySelector('[data-v2-q-body]');
  const app = header.closest('[data-v2-app]');
  if (!app) return null;
  const layerBodies = [...app.querySelectorAll('[data-v2-z-layer] [data-v2-z-body]')]
    .filter((node) => node.isConnected);
  return layerBodies.at(-1) || app.querySelector('[data-v2-z] > [data-v2-z-body]') || app.querySelector('[data-v2-z-body]');
}

function directActionWrapper(body) {
  let wrapper = body.querySelector(':scope > .modal-actions[data-v2-c-policy-direct]');
  if (wrapper) return wrapper;
  wrapper = document.createElement('div');
  wrapper.className = 'profile-actions modal-actions';
  wrapper.dataset.v2CPolicyActions = '';
  wrapper.dataset[DIRECT_MARKER] = 'true';
  body.append(wrapper);
  return wrapper;
}

function convertDirectC(header, button) {
  if (isAddAction(button)) {
    setAddGlyph(button);
    return;
  }
  const body = activeBodyForHeader(header);
  if (!body) return;

  const existingBottom = dedupeAgainstExistingBottom(button, body);
  if (existingBottom) {
    stripHeaderC(header, button);
    return;
  }

  body.querySelectorAll(':scope > .modal-actions[data-v2-c-policy-direct]').forEach((wrapper) => wrapper.remove());
  const wrapper = directActionWrapper(body);
  button.dataset[LOWER_MARKER] = 'true';
  normalizeBottomButton(button);
  wrapper.append(button);
  stripHeaderC(header, button);
}

function scanHeaders() {
  document.querySelectorAll('[data-v2-header]').forEach((header) => {
    const button = header.querySelector('.v2-header__slot--c button');
    if (!button) return;
    if (button.matches('[data-v2-workspace-primary]') && convertWorkspaceC(header, button)) return;
    convertDirectC(header, button);
  });
}

function scanLowerActions() {
  document.querySelectorAll('button[data-v2-c-policy-lower]').forEach(syncLowerButton);
  cleanEmptyPolicyActions();
}

function scan() {
  scanQueued = false;
  scanHeaders();
  scanLowerActions();
}

function queueScan() {
  if (scanQueued) return;
  scanQueued = true;
  queueMicrotask(scan);
}

const observer = new MutationObserver(queueScan);
observer.observe(document.documentElement, {
  subtree: true,
  childList: true,
  attributes: true,
  attributeFilter: [
    'class',
    'disabled',
    'aria-label',
    'data-v2-primary-label',
    'data-v2-primary-visible',
    'data-v2-primary-variant',
  ],
});

queueScan();
