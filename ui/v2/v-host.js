import { v2V } from './v.js';

function rootApp(root) {
  return root?.matches?.('[data-v2-app]')
    ? root
    : root?.closest?.('[data-v2-app]') || root?.querySelector?.('[data-v2-app]');
}

export function setV2V(root, options = null) {
  const app = rootApp(root);
  const host = app?.querySelector?.(':scope > [data-v2-v-host]');
  if (!host) return null;
  host.innerHTML = options ? v2V(options) : '';
  host.hidden = !options;
  return host.querySelector?.('[data-v2-v]') || null;
}

export function clearV2V(root) {
  return setV2V(root, null);
}
