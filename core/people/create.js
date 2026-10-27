import { button, field, mountModal, modal, phoneField } from '../../ui/ui.js';
import { createPerson, findPeopleByPhone, getAllPeople, savePeople } from './data.js';

export function personCreateForm(preset = {}) {
  return `<form class="form-grid" data-person-create-form>
    ${field({ label: 'Имя', name: 'name', value: preset.name || '', required: true })}
    ${field({ label: 'Фамилия', name: 'surname', value: preset.surname || '' })}
    ${phoneField({ label: 'Телефон', name: 'phone', value: preset.phone || '' })}
    <div class="form-error" data-error></div>
    ${button('Сохранить', { type: 'submit' })}
  </form>`;
}

export function bindPersonCreateForm(root, { onCreated = () => {} } = {}) {
  const form = root?.querySelector?.('[data-person-create-form]');
  if (!form || form.dataset.personCreateReady === 'true') return;
  form.dataset.personCreateReady = 'true';
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const name = String(data.get('name') || '').trim();
    const surname = String(data.get('surname') || '').trim();
    const phone = String(data.get('phone') || '').trim();
    const all = getAllPeople();
    try {
      if (!name) throw Error('Имя обязательно.');
      const phoneMatches = phone ? findPeopleByPhone(phone) : [];
      if (phoneMatches.length > 1) {
        throw Error('Телефон уже связан с несколькими людьми. Выберите существующего человека.');
      }
      if (phoneMatches.length === 1) {
        onCreated(phoneMatches[0]);
        return;
      }
      const person = createPerson(name, surname, phone);
      all.push(person);
      savePeople(all);
      onCreated(person);
    } catch (error) {
      const node = form.querySelector('[data-error]');
      if (node) node.textContent = error instanceof Error ? error.message : 'Не удалось создать';
    }
  });
}

export function openPersonCreate({
  root = document.body,
  preset = {},
  variant = 'medium',
  surface = '',
  className = '',
  onCreated = () => {},
} = {}) {
  const m = mountModal(root, modal(personCreateForm(preset), { variant, surface, className, title: 'Создать' }));
  if (!m) return null;
  bindPersonCreateForm(m, {
    onCreated: (person) => {
      m.remove();
      onCreated(person);
    },
  });
  return m;
}
