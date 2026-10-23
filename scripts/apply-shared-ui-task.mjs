import fs from 'node:fs';

const read = (file) => fs.readFileSync(file, 'utf8');
const write = (file, value) => fs.writeFileSync(file, value);
const exists = (file) => fs.existsSync(file);

function replaceExact(file, from, to, label = from.slice(0, 50)) {
  const source = read(file);
  const count = source.split(from).length - 1;
  if (count !== 1) throw new Error(`${file}: expected exactly one ${label}, found ${count}`);
  write(file, source.replace(from, to));
}

function replaceRegex(file, regex, to, label, expected = 1) {
  const source = read(file);
  const matches = [...source.matchAll(new RegExp(regex.source, regex.flags.includes('g') ? regex.flags : `${regex.flags}g`))];
  if (matches.length !== expected) throw new Error(`${file}: expected ${expected} ${label}, found ${matches.length}`);
  write(file, source.replace(regex, to));
}

function copy(src, dst) {
  if (!exists(src)) throw new Error(`Missing prepared file: ${src}`);
  fs.copyFileSync(src, dst);
}

// Prepared Shared foundation files. These are exact replacements already reviewed before application.
for (const [src, dst] of Object.entries({
  'UI_ALPHABET.new.tmp': 'UI_ALPHABET.md',
  'css/style.new.tmp': 'css/style.css',
  'ui/header/index.new.tmp': 'ui/header/index.js',
  'ui/v2/header.new.tmp': 'ui/v2/header.js',
  'ui/v2/shell.new.tmp': 'ui/v2/shell.js',
  'ui/v2/v2.new.tmp': 'ui/v2/v2.css',
  'ui/v2/v.new.tmp': 'ui/v2/v.css',
  'ui/v2/index.new.tmp': 'ui/v2/index.js',
  'ui/v2/v-host.new.tmp': 'ui/v2/v-host.js',
  'ui/ui.new.tmp': 'ui/ui.js',
  'journal/day.new.tmp': 'journal/день.js',
  'ui/note/index.new.tmp': 'ui/note/index.js',
  'ui/note/note.new.tmp': 'ui/note/note.css',
})) copy(src, dst);

// Shared V follows the active Shared surface and is not created by Header A.
replaceExact('ui/v2/index.js',
  "export { setV2V, clearV2V } from './v-host.js';",
  "export { setV2V, clearV2V, bindV2VContext } from './v-host.js';",
  'V host exports');
replaceExact('ui/v2/index.js',
  "import { bindV2HorizontalAffordances } from './horizontal-affordance.js';",
  "import { bindV2HorizontalAffordances } from './horizontal-affordance.js';\nimport { bindV2VContext } from './v-host.js';",
  'V context import');
replaceExact('ui/v2/index.js',
  "  const disposeHorizontalAffordances = bindV2HorizontalAffordances(app);\n  const onDeckOpenChange = options.onDeckOpenChange;",
  "  const disposeHorizontalAffordances = bindV2HorizontalAffordances(app);\n  const disposeVContext = bindV2VContext(app);\n  const onDeckOpenChange = options.onDeckOpenChange;",
  'V context bind');
replaceExact('ui/v2/index.js',
  "    disposeHorizontalAffordances?.();\n    dispose?.();",
  "    disposeHorizontalAffordances?.();\n    disposeVContext?.();\n    dispose?.();",
  'V context dispose');

// Professional shell composition: A reads only photo metadata. Settings no longer flow through A.
replaceRegex('core.js',
  /function workspaceProfileASlot\([\s\S]*?\n}\n\nfunction syncWorkspaceHeader/,
`function workspaceProfileASlot() {
  const profile = getProfile();
  const name = [profile.name, profile.surname].filter(Boolean).join(' ') || 'Профиль';
  const crop = (value) => Number.isFinite(Number(value)) ? Math.max(0, Math.min(100, Math.round(Number(value)))) : 50;
  return {
    kind: 'avatar',
    label: name,
    image: String(profile.photo || ''),
    imagePosition: \`${'${crop(profile.photoCropX)}'}% ${'${crop(profile.photoCropY)}'}%\`,
    initials: name.slice(0, 1).toUpperCase() || '?',
  };
}

function syncWorkspaceHeader`, 'workspaceProfileASlot');
replaceExact('core.js',
  "  const contextSource = contextRoot.querySelector('[data-workspace-context-action], .page-header__meta button');\n  const aSource = contextSource;\n  const dSource = contextRoot.querySelector('[data-workspace-d-action]');",
  "  const aContext = contextRoot.querySelector('[data-workspace-a-context]');\n  const dSource = contextRoot.querySelector('[data-workspace-d-action]');",
  'A source removal');
replaceRegex('core.js',
  /  const sourceAKind = aSource\?\.dataset\.workspaceAKind \|\| '';[\s\S]*?\n        };\n\n  header\.outerHTML = v2Header/,
`  const aSlot = aContext
    ? {
        kind: 'avatar',
        label: aContext.dataset.workspaceALabel || '',
        image: aContext.dataset.workspaceAImage || '',
        imagePosition: aContext.dataset.workspaceAImagePosition || '',
        initials: aContext.dataset.workspaceAInitials || '',
      }
    : workspaceProfileASlot();

  header.outerHTML = v2Header`, 'A slot composition');
replaceExact('core.js',
  "  app.querySelector('[data-v2-workspace-a]')?.addEventListener('click', () => aSource?.click());\n",
  '', 'A click forwarding');

// Existing profile/workplace settings become V actions; A remains the contextual photo.
replaceRegex('core/profile/profile.js',
  /function profileContext\(p,title=fullName\(p\)\)\{[\s\S]*?\n}\n\nfunction profileCard/,
`function profileContext(p,title=fullName(p)){
  return workspaceHeaderContext({
    title,
    a:{kind:'avatar',image:p.photo||'',imagePosition:avatarPosition(p),initials:initial(p)},
    v:{data:'data-profile-settings',aria:'Настройки профиля'},
  });
}

function profileCard`, 'profile context');
replaceRegex('core/profile/profile.js', /\[data-workspace-context-action\]/g, '[data-profile-settings]', 'profile settings selectors', 2);
replaceRegex('core/profile/profile.js',
  /a:\{\n        kind:'avatar',\n        image:current\.photo\|\|'',[\s\S]*?aria:'Настройки пространства',\n      },/,
`a:{
        kind:'avatar',
        image:current.photo||'',
        imagePosition:\`${'${crop(current.photoCropX)}'}% ${'${crop(current.photoCropY)}'}%\`,
        initials:(current.name||'?').slice(0,1).toUpperCase(),
      },
      v:{data:'data-workplace-settings',aria:'Настройки пространства'},`, 'workplace context');
replaceExact('core/profile/profile.js', "layer.querySelector('[data-profile-settings]')?.addEventListener('click',()=>openWorkplaceSettingsMenu(layer,existing,{onDeleted:closeAndRender}));", "layer.querySelector('[data-workplace-settings]')?.addEventListener('click',()=>openWorkplaceSettingsMenu(layer,existing,{onDeleted:closeAndRender}));", 'workplace settings selector');

replaceExact('core/profile/workplaces/workplaces.js',
  "  const source=root.querySelector('[data-workspace-context-action]');",
  "  const source=root.querySelector('[data-workspace-a-context]');",
  'workplace avatar context selector');

replaceRegex('core/service/context.js',
  /a: \{\n      kind: 'avatar',[\s\S]*?disabled: !settingsData,\n    \},\n    hideD,/,
`a: {
      kind: 'avatar',
      image: String(profile.photo || ''),
      imagePosition: \`${'${crop(profile.photoCropX)}'}% ${'${crop(profile.photoCropY)}'}%\`,
      initials: name.slice(0, 1).toUpperCase() || '?',
    },
    v: settingsData ? { data: settingsData, aria: settingsAria } : null,
    hideD,`, 'service A/V');

replaceRegex('journal/journal.js',
  /a: \{\n        kind: 'settings',\n        label: 'Настройки журнала',\n        data: 'data-journal-settings',\n        aria: 'Настройки журнала',\n      \},/,
  "v: { data: 'data-journal-settings', aria: 'Настройки журнала' },",
  'journal V');

replaceRegex('ui/record/runtime.js',
  /a: \{\n        kind: 'avatar',[\s\S]*?\n      \},\n      d:/,
`a: showA ? {
        kind: 'avatar',
        label: 'Запись',
        image: aImage,
        imagePosition: aImagePosition,
        initials: aInitials,
      } : null,
      v: showA && settings ? {
        data: 'data-record-owner-settings',
        aria: 'Настройки записи',
      } : null,
      d:`, 'record A/V');
replaceExact('ui/record/runtime.js', "import { v2QFrame, v2ZBodySections } from '../v2/z-layout.js';", "import { v2ZBodySections } from '../v2/z-layout.js';", 'record Q import');
replaceExact('ui/record/runtime.js',
  "    `${context.html}${v2QFrame('<div data-record-owner-host></div>')}`,",
  "    `${context.html}<div data-record-owner-host></div>`,",
  'record nested Q frame');

// People contexts: person photo remains A, settings/list actions move to V.
replaceRegex('core/people/people.js',
  /a: \{\n      kind: 'avatar',\n      image: person\.photo \|\| '',\n      initials: initials\(person\),\n      settingsTag: true,\n      data: 'data-person-settings',\n      aria: `Настройки \$\{name\(person\)\}`,\n    \},/,
`a: {
      kind: 'avatar',
      image: person.photo || '',
      initials: initials(person),
    },
    v: { data: 'data-person-settings', aria: \`Настройки ${'${name(person)}'}\` },`, 'person A/V');
replaceRegex('core/people/people.js',
  /a: \{\n      kind: 'settings',\n      data: 'data-people-list-settings',\n      aria: 'Настройки клиентов',\n    \},/,
  "v: { data: 'data-people-list-settings', aria: 'Настройки клиентов' },",
  'people list V');

// Timetable: A is photo only; graph settings move to V.
replaceRegex('timetable/timetable.js',
  /a: \{\n        kind: 'logo',[\s\S]*?disabled: inactiveA,\n      \},\n      hideD: true,/,
`a: workplace ? {
        kind: 'avatar',
        image: String(workplace.photo || ''),
        imagePosition: \`${'${Number(workplace.photoCropX || 50)}'}% ${'${Number(workplace.photoCropY || 50)}'}%\`,
        initials: String(workplace.name || '?').slice(0, 1).toUpperCase(),
      } : null,
      v: inactiveA ? null : {
        data: 'data-timetable-settings-open',
        aria: \`Настройки графика. Рабочих дней: ${'${summary.days}'}\`,
      },
      hideD: true,`, 'timetable A/V');

// End-user shell uses the same Shared V owner. renderV2Shell takes V independently from Header.
replaceExact('online-booking/account-shell.js',
  "  v2Header,\n  v2HorizontalRail,",
  "  v2Header,\n  v2HorizontalRail,\n  v2V,\n  setV2V,\n  clearV2V,",
  'end-user V imports');
replaceExact('online-booking/account-shell.js',
  "function renderV2Shell(root, state, { header, body = '', deck = true, className = '' } = {}) {\n  const deckMarkup = deck ? accountDeck(state) : '';",
  "function renderV2Shell(root, state, { header, body = '', deck = true, className = '', v = null } = {}) {\n  const deckMarkup = deck ? accountDeck(state) : '';\n  const vMarkup = v ? v2V(v) : '';",
  'end-user shell V option');
replaceExact('online-booking/account-shell.js',
  "      className,\n    });",
  "      className,\n      v: vMarkup,\n    });",
  'end-user initial V render');
replaceExact('online-booking/account-shell.js',
  "    if (z) z.innerHTML = body;\n    setV2DeckOpen(shell, Boolean(state.accountDeckOpen));",
  "    if (z) z.innerHTML = body;\n    const vHost = shell.querySelector(':scope > [data-v2-v-host]');\n    if (vHost) { vHost.innerHTML = vMarkup; vHost.hidden = !vMarkup; }\n    setV2DeckOpen(shell, Boolean(state.accountDeckOpen));",
  'end-user reused V render');
// Remove all A-side settings metadata. Actual V actions are added at each existing settings surface below.
replaceRegex('online-booking/account-shell.js', /, data: 'data-account-profile-settings', settingsTag: true, aria: 'Настройки профиля'/g, '', 'profile A settings metadata', 3);
replaceRegex('online-booking/account-shell.js', /, data: 'data-account-profile-settings', settingsTag: true, aria: 'Настройки контактов'/g, '', 'contacts A settings metadata', 1);
replaceRegex('online-booking/account-shell.js', /, data: 'data-global-contact-settings', settingsTag: true, aria: 'Настройки'/g, '', 'contact A settings metadata', 3);
replaceRegex('online-booking/account-shell.js', /, data: 'data-global-history-contact-settings', settingsTag: true, aria: 'Настройки'/g, '', 'history A settings metadata', 1);
replaceExact('online-booking/account-shell.js',
  "  renderV2Shell(root, state, {\n    header,\n    body: profileSummary(state),\n  });",
  "  renderV2Shell(root, state, {\n    header,\n    v: { data: 'data-account-profile-settings', aria: 'Настройки профиля' },\n    body: profileSummary(state),\n  });",
  'profile V render');
replaceExact('online-booking/account-shell.js',
  "  renderV2Shell(root, state, {\n    header: globalHomeHeader(state),\n    body: v2Section('Предстоящие визиты', upcoming),\n  });",
  "  renderV2Shell(root, state, {\n    header: globalHomeHeader(state),\n    v: { data: 'data-account-profile-settings', aria: 'Настройки профиля' },\n    body: v2Section('Предстоящие визиты', upcoming),\n  });",
  'home V render');
replaceExact('online-booking/account-shell.js',
  "  renderV2Shell(root, state, {\n    header,\n    body: `${searchable ? field({ name: 'accountContactSearch', type: 'search', placeholder: 'Поиск', autocomplete: 'off', data: 'data-account-contact-search' }) : ''}<div data-account-contact-list>${contactsBody(relationships)}</div>`,\n  });",
  "  renderV2Shell(root, state, {\n    header,\n    v: { data: 'data-account-profile-settings', aria: 'Настройки контактов' },\n    body: `${searchable ? field({ name: 'accountContactSearch', type: 'search', placeholder: 'Поиск', autocomplete: 'off', data: 'data-account-contact-search' }) : ''}<div data-account-contact-list>${contactsBody(relationships)}</div>`,\n  });",
  'contacts V render');
replaceExact('online-booking/account-shell.js',
  "  renderV2Shell(root, state, { header, body });",
  "  renderV2Shell(root, state, {\n    header,\n    v: { data: 'data-global-history-contact-settings', aria: 'Настройки' },\n    body,\n  });",
  'history-detail V render');
// Whenever a contact-layer header is installed, install its independent V before binding existing handlers.
replaceRegex('online-booking/account-shell.js',
  /  bindContactHeaderActions\(root, state, handlers, relationship, \{ repeatRequest: request, actionRoot: layer \}\);/,
  "  setV2V(root, { data: 'data-global-contact-settings', aria: 'Настройки' });\n  bindContactHeaderActions(root, state, handlers, relationship, { repeatRequest: request, actionRoot: layer });",
  'contact history V');
replaceRegex('online-booking/account-shell.js',
  /    bindContactHeaderActions\(root, state, handlers, relationship, \{ workplaceKey: key, actionRoot: layer \}\);/,
  "    setV2V(root, { data: 'data-global-contact-settings', aria: 'Настройки' });\n    bindContactHeaderActions(root, state, handlers, relationship, { workplaceKey: key, actionRoot: layer });",
  'workplace contact V');
replaceRegex('online-booking/account-shell.js',
  /    setGlobalAccountHeader\(root, contactHeaderMarkup\(relationship\)\);\n    bindContactHeaderActions/,
  "    setGlobalAccountHeader(root, contactHeaderMarkup(relationship));\n    setV2V(root, { data: 'data-global-contact-settings', aria: 'Настройки' });\n    bindContactHeaderActions",
  'contact detail V');
// Layers that previously had disabled/no A action must not inherit an older V.
replaceRegex('online-booking/account-shell.js',
  /(setGlobalAccountHeader\(root, v2Header\(\{[\s\S]*?b: String\(deposit\?\.programName \|\| 'Депозит'\),[\s\S]*?\}\)\);)/,
  "$1\n  clearV2V(root);",
  'deposit clears V');
replaceRegex('online-booking/account-shell.js',
  /(setGlobalAccountHeader\(root, v2Header\(\{[\s\S]*?b: 'Личный счёт',[\s\S]*?\}\)\);)/,
  "$1\n  clearV2V(root);",
  'personal account clears V');
replaceRegex('online-booking/account-shell.js',
  /(setGlobalAccountHeader\(root, v2Header\(\{\n    b: String\(investment\.name \|\| 'Инвестиция'\),[\s\S]*?\}\)\);)/,
  "$1\n  clearV2V(root);",
  'investment clears V');

// Q owns its own header/sheet. Portal veil covers H, while the Q sheet starts after Header and overlays Y.
write('ui/v2/geometry.js', `export function v2ModalPortalGeometry(hostRect = {}, viewport = {}) {
  const viewportLeft = Number(viewport.offsetLeft ?? 0);
  const viewportTop = Number(viewport.offsetTop ?? 0);
  const viewportWidth = Math.max(0, Number(viewport.width ?? 0));
  const viewportHeight = Math.max(0, Number(viewport.height ?? 0));
  const viewportRight = viewportLeft + viewportWidth;
  const viewportBottom = viewportTop + viewportHeight;
  const hostLeft = Number(hostRect.left ?? viewportLeft);
  const hostTop = Number(hostRect.top ?? viewportTop);
  const hostWidth = Math.max(0, Number(hostRect.width ?? 0));
  const hostHeight = Math.max(0, Number(hostRect.height ?? 0));
  const hostRight = Number(hostRect.right ?? (hostLeft + hostWidth));
  const hostBottom = Number(hostRect.bottom ?? (hostTop + hostHeight));
  const left = Math.max(viewportLeft, hostLeft);
  const right = Math.min(viewportRight, hostRight);
  const top = Math.max(viewportTop, hostTop);
  const bottom = Math.min(viewportBottom, hostBottom || viewportBottom);
  const width = Math.max(0, right - left);
  const height = Math.max(0, bottom - top);
  return { left, top, width, height, bottom: top + height };
}

export function v2QModalPortalGeometry(appRect = {}, viewport = {}, { edge = 16, headerBottom = null, headerHeight = 72 } = {}) {
  const base = v2ModalPortalGeometry(appRect, viewport);
  const safeEdge = Math.max(0, Number(edge) || 0);
  const right = base.left + base.width;
  const left = Math.min(right, base.left + safeEdge);
  const explicitHeaderBottom = Number(headerBottom);
  const fallbackTop = base.top + Math.max(0, Number(headerHeight) || 0);
  const top = Math.min(base.bottom, Math.max(base.top, Number.isFinite(explicitHeaderBottom) ? explicitHeaderBottom : fallbackTop));
  return { left, top, width: Math.max(0, right - left), height: Math.max(0, base.bottom - top), bottom: base.bottom };
}

function cssPixelValue(name) {
  const value = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name));
  return Number.isFinite(value) && value > 0 ? value : 0;
}

export function currentVisualViewport() {
  const vv = window.visualViewport;
  const stableHeight = cssPixelValue('--app-stable-vh');
  const stableWidth = cssPixelValue('--app-stable-vw');
  return {
    offsetLeft: Number(vv?.offsetLeft ?? 0),
    offsetTop: Number(vv?.offsetTop ?? 0),
    width: Number(vv?.width || stableWidth || window.innerWidth || 0),
    height: Number(vv?.height || stableHeight || window.innerHeight || 0),
  };
}
`);

let portal = read('ui/v2/modal-portal.js');
portal = portal.replace('function mountV2ModalPortal(host) {', 'function mountV2ModalPortal(host, app = null) {');
portal = portal.replace(
`    const standardGeometry = v2ModalPortalGeometry(host.getBoundingClientRect(), currentVisualViewport());
    const geometry = qLayer
      ? v2QModalPortalGeometry(host.getBoundingClientRect(), currentVisualViewport(), {
          hostIsZ: Boolean(host.matches?.('[data-v2-z], [data-v2-z-layer]')),
        })
      : standardGeometry;
    portal.style.left = \`${'${geometry.left}'}px\`;
    portal.style.top = \`${'${geometry.top}'}px\`;
    portal.style.width = \`${'${geometry.width}'}px\`;
    portal.style.height = \`${'${geometry.height}'}px\`;`,
`    const viewport = currentVisualViewport();
    const standardGeometry = v2ModalPortalGeometry(host.getBoundingClientRect(), viewport);
    let geometry = standardGeometry;
    if (qLayer && app) {
      const appRect = app.getBoundingClientRect();
      geometry = { left: appRect.left, top: appRect.top, width: appRect.width, height: appRect.height, bottom: appRect.bottom };
      const headerBottom = app.querySelector?.('[data-v2-header]')?.getBoundingClientRect?.().bottom;
      const qGeometry = v2QModalPortalGeometry(appRect, {
        offsetLeft: appRect.left,
        offsetTop: appRect.top,
        width: appRect.width,
        height: appRect.height,
      }, { headerBottom });
      portal.style.setProperty('--v2-q-top', \`${'${Math.max(0, qGeometry.top - geometry.top)}'}px\`);
      portal.style.setProperty('--v2-q-left', \`${'${Math.max(0, qGeometry.left - geometry.left)}'}px\`);
    } else {
      portal.style.removeProperty('--v2-q-top');
      portal.style.removeProperty('--v2-q-left');
    }
    portal.style.left = \`${'${geometry.left}'}px\`;
    portal.style.top = \`${'${geometry.top}'}px\`;
    portal.style.width = \`${'${geometry.width}'}px\`;
    portal.style.height = \`${'${geometry.height}'}px\`;`);
if (!portal.includes("portal.style.setProperty('--v2-q-top'")) throw new Error('modal portal geometry replacement failed');
portal = portal.replace('      qLayer = Boolean(value);\n      settle();', "      qLayer = Boolean(value);\n      portal.classList.toggle('is-q', qLayer);\n      settle();");
portal = portal.replace(/function lockModalHeader\(app, \{ allowContextActions = false \} = \{\}\) \{[\s\S]*?\n}\n\nfunction applicationLayers/, `function lockModalHeader(app) {
  const header = app?.querySelector?.('[data-v2-header]');
  if (!header) return () => {};
  header.inert = true;
  const release = retainModalHeaderTarget(header);
  return () => {
    release();
    if (!modalHeaderLocks.has(header)) header.inert = false;
  };
}

function applicationLayers`);
portal = portal.replace(/  const locksHeader = Boolean\(app && kind === 'standard' && !qLayer\);[\s\S]*?  const portalOwner = technical \? null : mountV2ModalPortal\(host\);/, `  const lockedStage = technical ? null : lockV2StageInteraction(app);
  const releaseHeaderLock = technical ? () => {} : lockModalHeader(app);
  const portalOwner = technical ? null : mountV2ModalPortal(host, app);`);
portal = portal.replace(/  if \(header\) \{\n    header\.inert = true;\n    header\.classList\.add\('is-modal-locked'\);\n  }\n/, '');
portal = portal.replace(/    if \(!qLayer\) return false;\n    const qHeaderAction =[\s\S]*?return Boolean\(qHeaderAction && app\?\.contains\?\.\(qHeaderAction\)\);/, '    return false;');
if (/allowContextActions\s*:\s*true|qHeaderAction/.test(portal)) throw new Error('Q tap-through exception remains');
write('ui/v2/modal-portal.js', portal);

replaceExact('ui/modals/index.js',
  "  if (resolvedVariant === 'q') content = v2QFrame(content);",
  "  if (resolvedVariant === 'q') content = v2QFrame(content, { header: title ? `<h2 class=\"v2-q-title\">${escapeHtml(title)}</h2>` : '' });",
  'Q own title');

let v2css = read('ui/v2/v2.css');
v2css = v2css.replace('.v2-layer-portal--viewport{position:fixed;right:auto;bottom:auto}', '.v2-layer-portal--viewport{position:fixed;right:auto;bottom:auto}\n.v2-layer-portal.is-q{border-radius:0}\n.v2-layer-portal.is-q>.v2-layer-backdrop[data-v2-q="true"]>.v2-layer--standard{top:var(--v2-q-top,72px);left:var(--v2-q-left,16px);right:0;bottom:0}\n.v2-q-title{margin:0;font-size:23px;line-height:1.1;font-weight:800}');
write('ui/v2/v2.css', v2css);

// Shared danger = red with white text.
let buttons = read('ui/buttons/buttons.css');
buttons = buttons.replace(/\.ui-button--danger\{[^}]*\}/, '.ui-button--danger{border-color:#FF1111;background:#FF1111;color:#fff}');
buttons = buttons.replace(/\.ui-button--critical\{[^}]*\}/, '.ui-button--critical{border-color:#FF1111;background:#FF1111;color:#fff}');
write('ui/buttons/buttons.css', buttons);
let listEntry = read('ui/lists/list-entry.css');
listEntry = listEntry.replace(/\.journal-list-record--deleted \.list-entry__content\{background:#FDD2D2;color:#EB4C42\}\.journal-list-record--deleted \.list-entry__main small,\.journal-list-record--deleted \.list-entry__right small\{color:#EB4C42\}/, '.journal-list-record--deleted .list-entry__content{background:#FF1111;color:#fff}.journal-list-record--deleted .list-entry__main small,.journal-list-record--deleted .list-entry__right small{color:#fff}');
write('ui/lists/list-entry.css', listEntry);

// Gradients are removed from Shared APP runtime while retaining stored appearance compatibility.
let entityJs = read('ui/cards/entity-card-constructor.js');
entityJs = entityJs.replace("    `--entity-visual-gradient:linear-gradient(${config.gradient.angle}deg,${config.gradient.from} 0%,${config.gradient.mid} 54%,${config.gradient.to} 100%)`,", "    `--entity-visual-surface:${config.gradient.mid}`," );
entityJs = entityJs.replace('Фото заполняет карту. Если фото нет, используется градиентный фон.', 'Фото заполняет карту. Если фото нет, используется выбранный цвет фона.');
entityJs = entityJs.replace(/    const g=state\.appearance\.gradient;\n    return `<div class="entity-card-editor__background">[\s\S]*?<\/div>`;\n  }/, `    const g=state.appearance.gradient;
    return \`<div class="entity-card-editor__background">
      <div data-card-surface-color>${'${colorPicker({name:\'entityCardSurfaceColor\',value:g.mid})}'}</div>
    </div>\`;
  }`);
entityJs = entityJs.replace(/    root\.querySelectorAll\('\[data-card-gradient-color\]'\)[\s\S]*?    root\.querySelector\('\[data-card-gradient-angle\]'\)\?\.addEventListener\('input',[\s\S]*?    \}\);\n/, `    root.querySelector('[data-card-surface-color] [data-color-value]')?.addEventListener('change',(event)=>{
      const value=String(event.target.value||'').toUpperCase();
      state.appearance.gradient={...state.appearance.gradient,from:value,mid:value,to:value};
      updatePreview();
      markDirty();
    });
`);
if (/(?:linear|radial)-gradient\s*\(/i.test(entityJs)) throw new Error('entity-card constructor gradient remains');
write('ui/cards/entity-card-constructor.js', entityJs);
let entityConstructorCss = read('ui/cards/entity-card-constructor.css');
entityConstructorCss = entityConstructorCss.replaceAll('var(--entity-visual-gradient)', 'var(--entity-visual-surface,#777A7D)');
entityConstructorCss = entityConstructorCss.replace(/background-image:linear-gradient\([^;]+\),var\(--entity-visual-image\)/, 'background-image:var(--entity-visual-image)');
entityConstructorCss = entityConstructorCss.replace('grid-template-columns:repeat(3,minmax(0,1fr));', 'grid-template-columns:1fr;');
entityConstructorCss = entityConstructorCss.replace('[data-card-gradient-color]', '[data-card-surface-color]');
write('ui/cards/entity-card-constructor.css', entityConstructorCss);

write('ui/cards/entity-card.css', `.entity-card{--entity-card-depth:#2C2A28;--entity-card-mid:#817A73;--entity-card-light:#D7D1CA;--entity-card-surface:var(--entity-card-mid)}\n.entity-card.has-image .entity-card__background{background-image:var(--entity-card-image)}\n.entity-card-stack{display:grid;grid-template-columns:minmax(0,1fr);gap:14px;width:100%;min-width:0;align-content:start}\n.entity-card-rail{display:flex;gap:10px;overflow-x:auto;overscroll-behavior-x:contain;scrollbar-width:none;padding:4px 0 12px}\n.entity-card-rail::-webkit-scrollbar{display:none}\n`);
let miniCss = read('ui/cards/mini-card.css');
miniCss = miniCss.replace(/\.mini-card--surface-photo\{[^}]*\}/, '.mini-card--surface-photo{position:relative;background:#D7D7D7;background-size:cover;background-position:var(--mini-card-image-position,50% 50%);isolation:isolate}');
miniCss = miniCss.replace(/\.mini-card--surface-photo\.has-image\{[^}]*\}/, '.mini-card--surface-photo.has-image{background-image:var(--mini-card-surface-image)}');
write('ui/cards/mini-card.css', miniCss);
let chatCss = read('ui/chat/chat.css');
chatCss = chatCss.replace(/background:linear-gradient\([^;]+\)/g, 'background:var(--app-bg)');
chatCss = chatCss.replace(/background:linear-gradient\([^;]+\)/g, 'background:#fff');
write('ui/chat/chat.css', chatCss);
let timeCss = read('ui/time/time.css');
timeCss = timeCss.replace(/\.time-wheel__viewport::before\{top:0;background:linear-gradient\([^}]+\)\}/, '.time-wheel__viewport::before{top:0;background:var(--white)}');
timeCss = timeCss.replace(/\.time-wheel__viewport::after\{bottom:0;background:linear-gradient\([^}]+\)\}/, '.time-wheel__viewport::after{bottom:0;background:var(--white)}');
write('ui/time/time.css', timeCss);

// Month occupancy keeps all three states using solid adjacent segments instead of a gradient.
let month = read('journal/месяц.js');
month = month.replace(/function usageGradient\([\s\S]*?\n}\n\nfunction dateContent\(data\) \{[\s\S]*?\n}\n/, `function usageSegments({ capacity, minutes }) {
  if (!(capacity > 0)) return [];
  return [
    { color: PAID_COLOR, minutes: minutes.paid },
    { color: RECORD_COLOR, minutes: minutes.active },
    { color: NO_SHOW_COLOR, minutes: minutes.noShow },
  ].filter((item) => item.minutes > 0).map((item) => ({
    color: item.color,
    width: Math.max(0, Math.min(100, (item.minutes / capacity) * 100)),
  }));
}

function dateContent(data) {
  const segments = usageSegments(data);
  const fill = segments.length ? \`<span class="calendar__date-fill" aria-hidden="true">${'${segments.map((item) => `<span style="width:${item.width.toFixed(2)}%;background:${item.color}"></span>`).join(\'\')}'}</span>\` : '';
  const count = data.count ? \`<span class="calendar__date-count">${'${data.count}'} зап.</span>\` : '';
  return \`${'${fill}${count}'}\`;
}
`);
if (/(?:linear|radial)-gradient\s*\(/i.test(month)) throw new Error('journal month gradient remains');
write('journal/месяц.js', month);
let calendarCss = read('ui/calendar/calendar.css');
calendarCss = calendarCss.replace('.calendar__date-fill{position:absolute;inset:0;z-index:0;pointer-events:none;background:var(--calendar-date-fill)}', '.calendar__date-fill{position:absolute;inset:0;z-index:0;pointer-events:none;display:flex;align-items:stretch;justify-content:flex-start;overflow:hidden}.calendar__date-fill>span{display:block;height:100%}');
write('ui/calendar/calendar.css', calendarCss);

// No responsive branch may redefine Shared Header/Z geometry. Q/Z action offsets remain shared.
let modalCss = read('ui/modals/modal.css');
modalCss = modalCss.replace(/@media \(max-width:360px\)\{\.modal-actions\{left:32px;right:32px\}\}\n?/, '');
write('ui/modals/modal.css', modalCss);

// Existing architecture guard must protect the new baseline instead of the retired viewport/Y model.
let architecture = read('scripts/check-ui-v2-architecture.mjs');
architecture = architecture.replace(/expect\(\/\\\.v2-app__stage[\s\S]*?'Shared Z must consume only the stage below A\/B\/C\/D and scroll excess content inside itself\.'\);/, `expect(/\\.v2-app\\{[\\s\\S]*?height:var\\(--app-stable-vh,100dvh\\)/.test(css) && /\\.v2-app__stage\\{[\\s\\S]*?flex:1 1 auto;min-height:0/.test(css) && /\\.v2-z\\{[\\s\\S]*?height:100%;min-height:0[\\s\\S]*?overflow:hidden/.test(css), 'Shared H must keep a stable viewport and Z must consume only the remaining space below Header/Y with scrolling inside Z Body.');`);
architecture = architecture.replace("ui.includes('mountV2ModalPortal(host)')", "ui.includes('mountV2ModalPortal(host, app = null)')");
architecture = architecture.replace("ui.includes('v2ModalPortalGeometry(host.getBoundingClientRect(), currentVisualViewport())')", "ui.includes('v2ModalPortalGeometry(host.getBoundingClientRect(), viewport)')");
write('scripts/check-ui-v2-architecture.mjs', architecture);

// Note/Y regression now asserts ownership by Shared Y rather than Journal-local host.
let noteTest = read('tests/note-y.test.mjs');
noteTest = noteTest.replace("assert.match(reels, /data-ui-y=\"note-reels\"/);\nassert.match(reels, /data-journal-y/);", "assert.doesNotMatch(reels, /data-ui-y|data-journal-y/);");
noteTest = noteTest.replace("assert.match(alphabet, /\\| Y \\|[^|]*Note Reels/);\nassert.match(alphabet, /Y не является Z/);\nassert.match(alphabet, /Y не является Timeline/);", "assert.match(alphabet, /Y = универсальная Shared H-zone/);\nassert.match(alphabet, /Note ≠ Y/);\nassert.match(alphabet, /Y не находится внутри Z/);");
noteTest = noteTest.replace("assert.match(day, /data-journal-y-host/);\nassert.match(day, /noteReels/);", "assert.doesNotMatch(day, /data-journal-y-host|data-journal-y/);\nassert.match(day, /setV2Y/);\nassert.match(day, /noteReels/);");
write('tests/note-y.test.mjs', noteTest);

// Cleanup prepared/temp implementation files and the one-shot application mechanism itself.
const cleanup = [
  'UI_ALPHABET.new.tmp','css/style.new.tmp','ui/header/index.new.tmp','ui/v2/header.new.tmp','ui/v2/shell.new.tmp','ui/v2/v2.new.tmp','ui/v2/v.new.tmp','ui/v2/index.new.tmp','ui/v2/v-host.new.tmp','ui/ui.new.tmp','journal/day.new.tmp','ui/note/index.new.tmp','ui/note/note.new.tmp','ui/v2/foundation-note.tmp',
  '.github/workflows/apply-shared-ui-task.yml','scripts/apply-shared-ui-task.mjs',
];
for (const file of cleanup) if (exists(file)) fs.rmSync(file);

console.log('Shared UI patch applied.');
