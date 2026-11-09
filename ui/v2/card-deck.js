import { text } from './html.js';

function v2NavigationIcon(id = '') {
  const key = String(id || '').toLowerCase();
  const paths = {
    people: '<circle cx="8" cy="9" r="3"></circle><circle cx="16" cy="9" r="3"></circle><path d="M3 20c.7-3.2 2.4-5 5-5s4.3 1.8 5 5M12 20c.6-2.8 2.1-4.4 4.4-4.4 2.2 0 3.7 1.6 4.3 4.4"></path>',
    contacts: '<circle cx="8" cy="9" r="3"></circle><circle cx="16" cy="9" r="3"></circle><path d="M3 20c.7-3.2 2.4-5 5-5s4.3 1.8 5 5M12 20c.6-2.8 2.1-4.4 4.4-4.4 2.2 0 3.7 1.6 4.3 4.4"></path>',
    finance: '<rect x="3" y="6" width="18" height="13" rx="2"></rect><path d="M3 10h18M15 15h3"></path>',
    cash: '<rect x="3" y="6" width="18" height="13" rx="2"></rect><path d="M3 10h18M15 15h3"></path>',
    dds: '<path d="M4 6h16M4 12h16M4 18h16"></path><path d="m8 3-3 3 3 3M16 15l3 3-3 3"></path>',
    'income-expense': '<path d="M7 4v16M17 4v16M3 8l4-4 4 4M13 16l4 4 4-4"></path>',
    articles: '<path d="M5 5h14M5 10h14M5 15h9M5 20h9"></path>',
    special: '<path d="M4 8h16M4 16h16M8 4 4 8l4 4M16 12l4 4-4 4"></path>',
    'z-report': '<path d="M5 4h14L6 20h13"></path>',
    timetable: '<rect x="3" y="5" width="18" height="16" rx="2"></rect><path d="M7 3v4M17 3v4M3 10h18"></path>',
    home: '<path d="m3 11 9-7 9 7v9h-6v-6H9v6H3Z"></path>',
    journal: '<path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3Z"></path><path d="M8 4v16"></path>',
    history: '<path d="M4 7h16M4 12h16M4 17h11"></path><circle cx="2.5" cy="7" r=".8"></circle><circle cx="2.5" cy="12" r=".8"></circle><circle cx="2.5" cy="17" r=".8"></circle>',
    profile: '<circle cx="12" cy="8" r="4"></circle><path d="M4 21c1-4.4 3.7-7 8-7s7 2.6 8 7"></path>',
    settings: '<circle cx="12" cy="12" r="3"></circle><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4"></path>',
    service: '<path d="m14 6 4-4 4 4-4 4M3 21l9-9M8 16l3 3"></path>',
    'online-booking': '<rect x="3" y="5" width="18" height="16" rx="2"></rect><path d="M7 3v4M17 3v4M3 10h18M8 15h8"></path>',
    communications: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"></path>',
    integrations: '<path d="M10 13a5 5 0 0 0 7.1.1l2-2a5 5 0 0 0-7.1-7.1l-1.1 1.1M14 11a5 5 0 0 0-7.1-.1l-2 2A5 5 0 0 0 12 20l1.1-1.1"></path>',
    documents: '<path d="M6 3h9l4 4v14H6Z"></path><path d="M15 3v5h5M9 13h6M9 17h6"></path>',
    tags: '<path d="M3 12V4h8l10 10-8 8Z"></path><circle cx="8" cy="8" r="1"></circle>',
    day: '<rect x="3" y="5" width="18" height="16" rx="2"></rect><path d="M7 3v4M17 3v4M3 10h18"></path>',
    month: '<path d="M5 20V11M10 20V6M15 20V9M20 20V3"></path>',
    list: '<path d="M8 6h13M8 12h13M8 18h13"></path><circle cx="3.5" cy="6" r="1"></circle><circle cx="3.5" cy="12" r="1"></circle><circle cx="3.5" cy="18" r="1"></circle>',
  };
  const body = paths[key] || '<rect x="4" y="4" width="16" height="16" rx="3"></rect>';
  return `<span class="v2-nav-icon" aria-hidden="true"><svg viewBox="0 0 24 24">${body}</svg></span>`;
}

function v2NestedMark(count = 0) {
  const value = Math.max(0, Number(count || 0));
  if (!value) return '';
  return `<span class="v2-f-nested" aria-hidden="true"><i></i><i></i><i></i><b>${value}</b></span>`;
}

export function v2CardDeck(items = [], {
  axis = 'x',
  active = '',
  data = 'data-v2-deck-item',
  className = '',
  role = '',
  level = 'f',
} = {}) {
  const values = (Array.isArray(items) ? items : []).filter(Boolean);
  if (!values.length) return '';
  const resolvedAxis = axis === 'y' ? 'y' : 'x';
  const activeId = String(active || values[0]?.id || '0');
  const activeIndex = Math.max(0, values.findIndex((item, index) => String(item.id || index) === activeId));
  const classes = ['v2-card-deck', `v2-card-deck--${resolvedAxis}`, className].filter(Boolean).join(' ');
  const roleData = role ? ` data-v2-deck-role="${text(role)}"` : '';
  return `<div class="${text(classes)}" data-v2-card-deck data-v2-deck-axis="${resolvedAxis}" data-v2-deck-level="${text(level)}" data-v2-deck-count="${values.length}"${roleData}>${values.map((item, index) => {
    const id = String(item.id || index);
    const isActive = index === activeIndex;
    const childrenCount = Number(item.childrenCount || item.children || 0);
    const customData = data ? ` ${data}="${text(id)}"` : '';
    return `<button type="button" class="v2-card-deck__card${isActive ? ' is-active' : ''}" data-v2-card-item="${text(id)}"${customData} data-v2-card-index="${index}" aria-label="${text(item.aria || item.label || '')}"${isActive ? ' aria-current="true"' : ''}>${level === 'f' ? v2NestedMark(childrenCount) : ''}${v2NavigationIcon(item.icon || id)}<strong>${text(item.label || '')}</strong></button>`;
  }).join('')}</div>`;
}
