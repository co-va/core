function rootApp(root) {
  return root?.matches?.('[data-v2-app]')
    ? root
    : root?.closest?.('[data-v2-app]') || root?.querySelector?.('[data-v2-app]');
}

export function setV2Y(root, content = '') {
  const app = rootApp(root);
  const host = app?.querySelector?.(':scope > [data-v2-y-host]');
  if (!host) return null;
  const html = String(content || '');
  host.innerHTML = html;
  const active = Boolean(html.trim());
  host.hidden = !active;
  host.style.paddingBottom = active ? '12px' : '';
  app.classList.toggle('has-v2-y', active);
  return host;
}

export function clearV2Y(root) {
  return setV2Y(root, '');
}
