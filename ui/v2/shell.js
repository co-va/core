import { text, dataAttributes } from './html.js';
import { v2ZFrame } from './z-layout.js';

export function v2Shell({
  header = '',
  body = '',
  deck = '',
  eDeck = '',
  v = '',
  className = '',
  deckOpen = false,
  eOpen = false,
  zEnter = false,
  zData = 'data-v2-z',
} = {}) {
  const classes = ['v2-app', deck ? 'v2-app--with-deck' : '', eDeck ? 'has-e-deck' : '', deckOpen ? 'is-deck-open' : '', deckOpen && eOpen && eDeck ? 'is-e-open' : '', zEnter && !deckOpen ? 'is-z-entering' : '', className].filter(Boolean).join(' ');
  const feDeck = deck || eDeck ? `<div class="v2-fe-deck" data-v2-fe>${deck}${eDeck}</div>` : '';
  return `<section class="${classes}" data-v2-app>
    ${header}
    <div class="v2-y-host" data-v2-y-host hidden></div>
    <div class="v2-app__stage">
      ${feDeck}
      <div class="v2-front" data-v2-front>
        <main class="v2-z" ${zData}>
${v2ZFrame(body)}
</main>
      </div>
      <div class="v2-edge-swipe-zone" data-v2-edge-swipe aria-hidden="true"></div>
    </div>
    <div class="v2-v-host" data-v2-v-host${v ? '' : ' hidden'}>${v}</div>
  </section>`;
}

export function v2Section(title = '', content = '', { className = '' } = {}) {
  return `<section class="v2-section ${text(className)}"><h2 class="v2-section__title">${text(title)}</h2><div class="v2-section__content">${content}</div></section>`;
}

export function v2HorizontalRail(content = '', { className = '' } = {}) {
  return `<div class="v2-rail ${text(className)}" data-v2-horizontal-rail>${content}</div>`;
}

export function v2RailCard({ title = '', subtitle = '', meta = '', data = '', aria = '', className = '' } = {}) {
  return `<button type="button" class="v2-rail-card ${text(className)}"${dataAttributes(data)} aria-label="${text(aria || title)}"><strong>${text(title)}</strong>${subtitle ? `<span>${text(subtitle)}</span>` : ''}${meta ? `<small>${text(meta)}</small>` : ''}</button>`;
}
