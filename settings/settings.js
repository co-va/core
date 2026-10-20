import { canUseBookCapability } from '../core/access.js';
import { folderList, pageHeader } from '../ui/ui.js';

const folders = [
  ['data-transfer', 'Перенос данных', '◫', () => import('./data-transfer/data-transfer.js'), ''],
  ['online-booking', 'Онлайн-запись', '◫', () => import('./online-booking/online-booking.js'), 'online_booking.access'],
  ['notifications', 'Уведомления', '◫', () => import('./notifications/notifications.js'), 'online_booking.access'],
  ['integrations', 'Интеграции', '◫', () => import('./integrations/integrations.js'), 'integrations.access'],
  ['documents', 'Документы', '◫', () => import('./documents/documents.js'), 'documents.access'],
  ['tags', 'Ярлыки', '◫', () => import('./tags/tags.js'), 'tags.access'],
];

function availableFolders() {
  return folders.filter((folder) => !folder[4] || canUseBookCapability(folder[4]));
}

function workspaceFolders() {
  return availableFolders();
}

export function settingsNavigationItems() {
  return workspaceFolders().map(([id, label]) => ({ id, label }));
}

export async function renderSettingsSection(root, key = '', { onBack = () => {} } = {}) {
  const visible = workspaceFolders();
  const folder = visible.find(([id]) => id === key) || visible[0];
  if (!folder) {
    root.innerHTML = pageHeader('Настройки');
    return;
  }
  const module = await folder[3]();
  return module.render(root, onBack);
}

function renderRows(root) {
  const visible = availableFolders();
  root.innerHTML = `${pageHeader('Настройки')}${folderList(visible.map(([key, label]) => ({ title: label, data: `data-settings-open="${key}"` })))}`;
  root.querySelectorAll('[data-settings-open]').forEach((element) => {
    element.addEventListener('click', async () => {
      const folder = visible.find(([key]) => key === element.dataset.settingsOpen);
      if (!folder) return;
      const { render } = await folder[3]();
      render(root, () => renderRows(root));
    });
  });
}

export function renderSettings(root) {
  renderRows(root);
}
