import fs from 'node:fs';

const ui = [
  'ui/v2/index.js',
  'ui/v2/header.js',
  'ui/v2/card-deck.js',
  'ui/v2/shell.js',
  'ui/v2/sticker.js',
  'ui/v2/z-stack.js',
  'ui/v2/modal-portal.js',
  'ui/v2/swipe.js',
  'ui/v2/workspace-navigation.js',
  'ui/v2/lifecycle.js',
  'ui/v2/geometry.js',
].map((file) => fs.readFileSync(file, 'utf8')).join('\n');
const css = fs.readFileSync('ui/v2/v2.css', 'utf8');
const facade = fs.readFileSync('ui/ui.js', 'utf8');
const documentUi = fs.readFileSync('ui/documents/index.js', 'utf8');
const documentCss = fs.readFileSync('ui/documents/document.css', 'utf8');
const booking = fs.readFileSync('online-booking/booking.js', 'utf8');
const account = fs.readFileSync('online-booking/account-shell.js', 'utf8');
const chatRuntime = fs.readFileSync('core/chat/runtime.js', 'utf8');
const calendar = fs.readFileSync('ui/calendar/calendar.css', 'utf8');
const calendarUi = fs.readFileSync('ui/calendar/calendar.js', 'utf8');
const personalData = fs.readFileSync('online-booking/personal-data.js', 'utf8');
const passwordSettings = fs.readFileSync('online-booking/password-settings.js', 'utf8');
const consentSettings = fs.readFileSync('online-booking/consent-settings.js', 'utf8');
const inputs = fs.readFileSync('ui/inputs/index.js', 'utf8');
const modals = fs.readFileSync('ui/modals/index.js', 'utf8');
const headerUi = fs.readFileSync('ui/header/index.js', 'utf8');
const timeUi = fs.readFileSync('ui/time/index.js', 'utf8');
const colorUi = fs.readFileSync('ui/colors/index.js', 'utf8');
const workplacesUi = fs.readFileSync('core/profile/workplaces/workplaces.js', 'utf8');
const accountControlsUi = fs.readFileSync('core/profile/account-controls.js', 'utf8');
const accountMobileCss = fs.readFileSync('ui/booking/account-mobile.css', 'utf8');
const core = fs.readFileSync('core.js', 'utf8');
const people = fs.readFileSync('core/people/people.js', 'utf8');
const timetable = fs.readFileSync('timetable/timetable.js', 'utf8');
const finance = fs.readFileSync('core/finance/finance.js', 'utf8');
const financeDds = fs.readFileSync('core/finance/dds/index.js', 'utf8');
const financeCash = fs.readFileSync('core/finance/cash/cash.js', 'utf8');
const appearanceQ = fs.readFileSync('ui/cards/appearance-q.js', 'utf8');
const cardAppearanceTemplates = fs.readFileSync('core/card-appearance-templates.js', 'utf8');
const journal = fs.readFileSync('journal/journal.js', 'utf8');
const settings = fs.readFileSync('settings/settings.js', 'utf8');
const onlineBookingSettings = fs.readFileSync('settings/online-booking/online-booking.js', 'utf8');
const recordRuntime = fs.readFileSync('ui/record/runtime.js', 'utf8');
const recordCss = fs.readFileSync('ui/record/record.css', 'utf8');
const timeCss = fs.readFileSync('ui/time/time.css', 'utf8');
const journalList = fs.readFileSync('journal/список.js', 'utf8');
const profile = fs.readFileSync('core/profile/profile.js', 'utf8');
const sharedProfile = fs.readFileSync('ui/profile/index.js', 'utf8');
const style = fs.readFileSync('css/style.css', 'utf8');
const entityCardUi = fs.readFileSync('ui/cards/index.js', 'utf8');
const entityCardCss = fs.readFileSync('ui/cards/entity-card.css', 'utf8');
const buttonCss = fs.readFileSync('ui/buttons/buttons.css', 'utf8');
const segmentUi = fs.readFileSync('ui/selection/segment-control.js', 'utf8');
const viewNavigationUi = fs.readFileSync('ui/view-navigation/view-navigation.js', 'utf8');
const segmentCss = fs.readFileSync('ui/selection/segment-control.css', 'utf8');
const infoUi = fs.readFileSync('ui/info/index.js', 'utf8');
const infoCss = fs.readFileSync('ui/info/info.css', 'utf8');
const inputsCss = fs.readFileSync('ui/inputs/inputs.css', 'utf8');
const listCss = fs.readFileSync('ui/lists/list.css', 'utf8');
const listEntryCss = fs.readFileSync('ui/lists/list-entry.css', 'utf8');
const selectorsUi = fs.readFileSync('ui/selectors/index.js', 'utf8');
const selectorsCss = fs.readFileSync('ui/selectors/selectors.css', 'utf8');
const miniCardUi = fs.readFileSync('ui/cards/mini-card.js', 'utf8');
const miniCardCss = fs.readFileSync('ui/cards/mini-card.css', 'utf8');

function cssFilesUnder(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) return cssFilesUnder(path);
    return entry.isFile() && entry.name.endsWith('.css') ? [path] : [];
  });
}

function jsFilesUnder(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) return jsFilesUnder(path);
    return entry.isFile() && entry.name.endsWith('.js') ? [path] : [];
  });
}

const sharedCssFiles = ['css/style.css', ...cssFilesUnder('ui'), ...cssFilesUnder('core/profile')];
const runtimeJsFiles = [
  'core.js',
  ...jsFilesUnder('ui'),
  ...jsFilesUnder('online-booking'),
  ...jsFilesUnder('core/profile'),
  ...jsFilesUnder('core/service'),
  ...jsFilesUnder('settings'),
  ...jsFilesUnder('journal'),
  ...jsFilesUnder('timetable'),
];

const workspaceJsFiles = [
  ...jsFilesUnder('core/profile'),
  ...jsFilesUnder('core/service'),
  ...jsFilesUnder('settings'),
  ...jsFilesUnder('journal'),
  ...jsFilesUnder('timetable'),
];
const workspaceCssFiles = [
  ...cssFilesUnder('settings'),
  ...cssFilesUnder('journal'),
  ...cssFilesUnder('timetable'),
];

const legacySystemBrown = /#(?:3B302B|7A6F69|B8AEA8|E7E1DB|E8E1DC|D7CEC7|968982|E9E6E2|D8D0CA)\b|rgba\(59,48,43,[^)]+\)|rgba\(30,25,22,[^)]+\)/i;

const failures = [];
const expect = (condition, message) => { if (!condition) failures.push(message); };
for (const file of sharedCssFiles) {
  const source = fs.readFileSync(file, 'utf8');
  expect(!legacySystemBrown.test(source), `Legacy system brown must not remain in Shared UI CSS: ${file}.`);
  if (file !== 'ui/buttons/buttons.css') {
    expect(!/\.ui-button--(?:secondary|outline)\s*\{|\.ui-button:disabled\s*\{/.test(source), `Shared Button states must not be re-owned outside ui/buttons/buttons.css: ${file}.`);
  }
  if (file !== 'ui/selection/segment-control.css') {
    expect(!/(^|\})\.segment-control\s*\{|(^|\})\.segment-control button(?:\.is-active)?\s*\{/.test(source), `Segmented-control base styling must not be re-owned outside ui/selection/segment-control.css: ${file}.`);
  }
  if (file !== 'ui/cards/entity-card.css') {
    expect(!/--entity-card-(?:depth|mid|light|surface)\s*:/.test(source), `Entity Card surface tokens must stay owned by ui/cards/entity-card.css: ${file}.`);
  }
  if (file !== 'ui/info/info.css') {
    expect(!/\.ui-info__(?:trigger|panel)\s*\{/.test(source), `Info UI styling must stay owned by ui/info/info.css: ${file}.`);
  }
}
for (const file of runtimeJsFiles) {
  if (file === 'ui/v2/index.js' || file === 'ui/v2/modal-portal.js' || file === 'ui/modals/index.js') continue;
  const source = fs.readFileSync(file, 'utf8');
  expect(!/\b(?:v2Layer|mountV2Layer)\s*\(/.test(source), `Runtime code must use canonical modal()/mountModal() instead of parallel V2 modal primitives: ${file}.`);
}

for (const file of runtimeJsFiles) {
  if (file === 'ui/v2/index.js' || file === 'ui/ui.js') continue;
  const source = fs.readFileSync(file, 'utf8');
  expect(!/\binitV2DeckSwipe\s*\(/.test(source), `Runtime code must not bind the removed legacy deck swipe owner: ${file}.`);
}

for (const file of workspaceJsFiles) {
  const source = fs.readFileSync(file, 'utf8');
  expect(!/\b(?:appShell|appHeader)\s*\(/.test(source), `Workspace screens must render inside the single Shared Z shell instead of nesting a second app shell/header: ${file}.`);
  expect(!/app-content--book-shell/.test(source), `Workspace screens must not switch to a legacy full-screen shell class inside Z: ${file}.`);
}
for (const file of workspaceCssFiles) {
  const source = fs.readFileSync(file, 'utf8');
  expect(!/position\s*:\s*fixed/.test(source), `Workspace feature CSS must not create a local fixed layer above Shared Z: ${file}.`);
  expect(!/(?:min-|max-)?height\s*:\s*(?:var\(--visual-vh\s*,\s*)?100dvh/.test(source), `Workspace feature CSS must not create its own viewport-height screen inside Shared Z: ${file}.`);
  expect(!/touch-action\s*:/.test(source), `Workspace feature CSS must not re-own touch gesture policy inside Shared Z: ${file}.`);
}


for (const name of [
  'v2Header',
  'v2CardDeck',
  'v2Shell',
  'v2Sticker',
  'v2ZLayer',
  'mountV2ZLayer',
  'initV2Swipe',
  'initV2StickerSwipe',
  'initV2WorkspaceInteraction',
  'setV2DeckOpen',
]) {
  expect(ui.includes(`export function ${name}`), `Shared UI V2 owner must export ${name}().`);
  expect(facade.includes(name), `ui/ui.js must expose ${name}().`);
}

expect(ui.includes('const contextObserver = new MutationObserver')
  && ui.includes("'data-v2-primary-visible'")
  && ui.includes("'data-v2-primary-label'")
  && ui.includes("'data-v2-primary-variant'")
  && ui.includes('contextObserver.observe(node')
  && ui.includes('contextObserver.disconnect()'),
  'Shared Z-layer owner must resync Header C when dynamic primary-action state changes inside Z2/Z3.');

expect(css.includes('--v2-base:var(--surface-dark)') && style.includes('--surface-dark:#2F3338'), 'V2 BASE must resolve through the shared H dark-surface token #2F3338.');
expect(/\.v2-z\{[\s\S]*?border-radius:var\(--v2-z-radius\) 0 0 0/.test(css), 'Z may round only the upper-left corner.');
expect(/\.v2-app__stage\{[\s\S]*?height:calc\(var\(--visual-vh,100dvh\) - 72px\)/.test(css) && /\.v2-front\{[\s\S]*?height:calc\(var\(--visual-vh,100dvh\) - 72px\)/.test(css) && /\.v2-z\{[\s\S]*?box-sizing:border-box;[\s\S]*?height:calc\(var\(--visual-vh,100dvh\) - 72px\);[\s\S]*?overflow-y:auto/.test(css), 'Shared Z must consume only the stage below A/B/C/D and scroll excess content inside itself.');
expect(/\.v2-layer--top\{[\s\S]*?border-radius:var\(--v2-z-radius\) 0 0 0/.test(css), 'TOP modal must live inside Z and repeat only the Z upper-left radius.');
expect(/\.v2-layer--standard\{[\s\S]*?inset:0;[\s\S]*?border-radius:var\(--v2-z-radius\) 0 0 0/.test(css), 'STANDARD modal must be a full-height Z-contained sheet with only the upper-left radius.');
expect(/\.v2-layer--bottom\{[\s\S]*?bottom:0;[\s\S]*?border-radius:0/.test(css), 'BOTTOM modal must stay straight inside the lower part of Z.');
expect(/\.v2-layer--technical\{[\s\S]*?top:50%;[\s\S]*?border-radius:0;[\s\S]*?box-shadow:0 18px 46px/.test(css), 'TECHNICAL modal must float above the whole system with all straight edges and an all-side shadow.');
expect(css.includes('.v2-layer-portal--viewport{position:fixed') && css.includes('.v2-layer-portal>.v2-layer-backdrop--contained{position:absolute;inset:0') && css.includes('.v2-layer-backdrop--technical{position:fixed;inset:0') && !css.includes('.v2-z:not(.v2-z--layer).has-v2-layer{transform:translateZ(0)') && ui.includes('mountV2ModalPortal(host)') && ui.includes("portal.className = 'v2-layer-portal v2-layer-portal--viewport'") && ui.includes('document.body.appendChild(portal)') && ui.includes('v2ModalPortalGeometry(host.getBoundingClientRect(), currentVisualViewport())') && core.includes("if (target.closest('[data-v2-layer]')) return;"), 'Shared work modals must use one fixed viewport overlay aligned to the active Z, recalculate against the visible viewport, and never be moved by page-level focus scrolling; rare technical overlays may cover the whole system.');
expect(ui.includes('export function v2CardDeck') && !ui.includes('export function v2EList') && !ui.includes('export function v2FDeck'), 'F and E must use one Shared v2CardDeck owner; split F/E card renderers are forbidden.');
expect(css.includes('--v2-card-width:min(68vw,258px)') && css.includes('--v2-card-height:min(47vh,344px)'), 'F and E must share one canonical card width/height.');
expect(/\.v2-card-deck--x\{[\s\S]*?overflow-x:auto;overflow-y:hidden[\s\S]*?scroll-snap-type:x mandatory[\s\S]*?touch-action:pan-x/.test(css), 'F must use native horizontal inertial scroll with scroll-snap.');
expect(css.includes('.v2-card-deck--x::before,.v2-card-deck--x::after{') && css.includes('calc((100% - var(--v2-card-width))/2)') && css.includes('.v2-card-deck--y::before,.v2-card-deck--y::after{') && css.includes('calc((100% - var(--v2-card-height))/2)') && !css.includes('padding-inline:calc((100% - var(--v2-card-width))/2)') && !css.includes('padding-block:calc((100% - var(--v2-card-height))/2)'), 'F/E must use real flex edge spacers so first and last overlapping cards can physically reach the centre.');
expect(/\.v2-card-deck--y\{[\s\S]*?overflow-x:hidden;overflow-y:auto[\s\S]*?scroll-snap-type:y mandatory[\s\S]*?touch-action:pan-y/.test(css), 'E must use native vertical inertial scroll with scroll-snap.');
expect(/\.v2-card-deck__card\{[\s\S]*?width:var\(--v2-card-width\);height:var\(--v2-card-height\)/.test(css), 'F and E must render the exact same full-size CardDeck card geometry.');
expect(css.includes('.v2-card-deck--x .v2-card-deck__card{') && css.includes('rotateY(var(--v2-card-rotation))') && css.includes('.v2-card-deck--y .v2-card-deck__card{') && css.includes('rotateX(var(--v2-card-rotation))'), 'CardDeck depth must bend neighboring F/E cards along the correct 3D axis.');
expect(css.includes('translate3d(var(--v2-card-shift),0,var(--v2-card-depth))') && css.includes('translate3d(0,var(--v2-card-shift),var(--v2-card-depth))'), 'CardDeck cards must physically move in Z-depth instead of remaining flat 2D tiles.');
expect(css.includes('.v2-card-deck__card.is-active{') && css.includes('border:2px solid var(--v2-yellow)'), 'The centred active CardDeck card must use the canonical yellow outline.');
expect(!/\.v2-card-deck__card:nth-child/.test(css) && !css.includes('--v2-e-card-width') && !css.includes('--v2-e-card-height') && !css.includes('.v2-e-card{') && !css.includes('.v2-deck__card{'), 'Old index-colour depth, compact E geometry and split card CSS must be removed.');
expect(css.includes('.v2-app.is-e-open .v2-card-deck--x{') && css.includes('translateZ(-150px) scale(.86)') && css.includes('pointer-events:none'), 'Opening E must push the whole F layer deeper without changing F card type.');
expect(css.includes('.v2-app.is-e-open .v2-card-deck--y{opacity:1;pointer-events:auto}'), 'E must appear as the vertical instance of the same CardDeck above the deeper F layer.');
expect(ui.includes('function v2NavigationIcon') && ui.includes('function v2NestedMark'), 'Shared FEZ cards must own their navigation icons and nested-card cue centrally.');
expect(ui.includes('const updateDeckGeometry = (deck, cards, axis) =>') && ui.includes('card.offsetLeft') && ui.includes('deck.scrollLeft') && ui.includes('card.offsetTop') && ui.includes('deck.scrollTop') && ui.includes("card.style.setProperty('--v2-card-depth'") && ui.includes("card.style.setProperty('--v2-card-rotation'"), 'Card depth must be derived from stable layout geometry, never from its own transformed rectangle.');
expect(ui.includes("deck.addEventListener('scroll', refresh, { passive: true })") && ui.includes("deck.addEventListener('scroll', settle, { passive: true })"), 'F/E motion must observe native browser scroll instead of replacing it with a JS pager.');
expect(ui.includes("setActiveIndex(index)") && ui.includes("setActiveCard(cards, index)") && ui.includes("if (id) onSelect?.(id)") && !ui.includes("if (index !== activeIndex)"), 'Any clean CardDeck tap must select and navigate exactly once; only drag may suppress action.');
expect(ui.includes('Math.hypot(dx, dy) >= 9') && ui.includes('suppressClick = pointer.dragged'), 'CardDeck must distinguish tap from drag geometrically so a drag never opens a card.');
expect(!ui.includes('const projected = current.dx + velocity') && !ui.includes('const projected = current.dy + velocity') && !ui.includes('data-v2-e-step') && !ui.includes('--v2-e-active-offset') && !ui.includes('deck.scrollLeft = clampScroll'), 'Legacy transform-by-index, velocity projection and manual F carry must be absent.');
expect(ui.includes("const eDown = (event) =>") && ui.includes("if (!secondaryIsOpen() || !eDeck?.contains(event.target)) return;") && ui.includes("Math.abs(dy) >= Math.abs(dx) * 1.05 || dx <= 0"), 'E right-collapse must be determined by gesture geometry and may start anywhere on E.');
expect(ui.includes("const currentX = Math.max(0, current.dx)") && ui.includes("const exitX = Math.max(Number(stage.clientWidth || 0), currentX)") && ui.includes("eDeck.style.setProperty('--v2-e-dismiss-x', `${exitX}px`)") && ui.includes("eDismissTimer = window.setTimeout"), 'Committed E collapse must continue from the finger to the right edge instead of snapping back before closing.');
expect(ui.includes("const metrics = cards.map((card, index) =>") && ui.includes("metrics.forEach((metric) =>"), 'CardDeck live geometry must batch layout reads before visual writes to avoid per-card layout thrash.');
expect(!ui.includes('const ownerFrames = new Set()') && !ui.includes('const queueOwnerFrame = (callback) =>'), 'Opening F/E must not depend on deferred owner frames that can race with a user-started native scroll.');
expect(ui.includes('setActiveCard(fCards, fActiveIndex);') && ui.includes('setActiveCard(eCards, eActiveIndex);'), 'Semantic activeId/eActiveId must be applied immediately even while F/E are hidden.');
expect(ui.includes('onSelect, isEnabled = () => true') && ui.includes('if (!isEnabled()) return;') && ui.includes("() => deckIsOpen() && !secondaryIsOpen() && !app.classList.contains('has-v2-modal')") && ui.includes("() => secondaryIsOpen() && !app.classList.contains('has-v2-modal')"), 'Hidden F/E scroll events, background F under E, and modal-covered decks must never own interaction.');
const workspaceOwner = fs.readFileSync('ui/v2/workspace-navigation.js', 'utf8');
expect(workspaceOwner.includes("centerCard(fCards[fActiveIndex], 'x')") && workspaceOwner.includes("centerCard(eCards[eActiveIndex], 'y')") && !workspaceOwner.includes('scrollIntoView({'), 'F/E centering must be synchronous and scoped to the deck itself, never a delayed scrollIntoView race.');
expect(workspaceOwner.includes("const previousSnap = deck.style.scrollSnapType") && workspaceOwner.includes("deck.style.scrollSnapType = 'none'") && workspaceOwner.includes("deck.style.scrollSnapType = previousSnap"), 'Semantic F/E state restore must temporarily bypass native snap so the browser cannot redirect a programmatic centre jump to a neighbour.');
expect(ui.includes("const edgeHost = app.querySelector('[data-v2-edge-swipe]') || stage;") && ui.includes("if (edgeHost === stage)") && ui.includes("if (Number(event.clientX || 0) > rect.left + edgeWidth) return;"), 'Root Z->F must be owned by the dedicated shared left screen-edge zone with a stage-bound fallback only.');
expect(!ui.includes('inNavigationGutter') && !ui.includes('horizontalGestureContext') && !ui.includes('forceNavigation'), 'Middle-of-Z gesture arbitration and old special navigation-gutter owners must be removed.');
const sharedSwipe = fs.readFileSync('ui/v2/swipe.js', 'utf8');
expect(sharedSwipe.includes("const edgeHost = onRight ? app?.querySelector?.('[data-v2-edge-swipe]') : null") && sharedSwipe.includes('const gestureHost = edgeHost || stage || surface') && sharedSwipe.includes('const leftEdge = Number(stageRect?.left || 0) + Number(edgeWidth || 36)') && sharedSwipe.includes('const wantsRight = Boolean(onRight)') && !sharedSwipe.includes('nestedHorizontalScroller'), 'Z2/Z3 must share the same dedicated screen-edge owner and never inspect inner horizontal rails.');
expect(ui.includes("disposeSwipe = initV2Swipe(node, { onRight: close, revealDeck: false, threshold: 28, edgeWidth: 36 })"), 'Mounted Z2/Z3 must close one top layer with the same responsive shared edge swipe.');
expect(ui.includes('function syncV2ZStackInteraction(app, host)')
  && ui.includes('surface.inert = blocked')
  && ui.includes("surface.classList.toggle('is-v2-obscured', blocked)")
  && css.includes('.v2-z.is-v2-obscured{pointer-events:none}'),
  'Obscured Z surfaces must be inert and pointer-dead; only the top Z layer may own interaction.');
expect(ui.includes('function lockV2StageInteraction(app)')
  && ui.includes('stage.inert = true')
  && ui.includes("app.classList.add('has-v2-modal')")
  && ui.includes("if (app.classList.contains('has-v2-modal')) return;")
  && css.includes('.v2-app.has-v2-modal > .v2-app__stage{pointer-events:none}'),
  'Any open shared modal must hard-lock FEZ interaction until it closes.');
expect(css.includes('.v2-app.is-revealing-deck .v2-fe-deck{opacity:1}')
  && !/\.v2-app\.is-revealing-deck \.v2-fe-deck\{[^}]*pointer-events\s*:\s*auto/.test(css),
  'Partially revealed F may be visible during Z drag but must never become interactive before commit.');
expect(ui.includes("if (next) app.classList.remove('is-z-entering');"), 'Opening F after any selected Z must cancel the transient Z-entry class before applying the deck-open transform.');
expect(css.includes('.v2-app.is-z-entering > .v2-app__stage > .v2-front{animation:v2-z-enter-from-right .30s cubic-bezier(.16,1,.3,1)}') && !css.includes('v2-z-enter-from-right .30s cubic-bezier(.16,1,.3,1) both') && !css.includes('v2-z-enter-from-right .30s cubic-bezier(.16,1,.3,1) forwards'), 'Z entry animation must release transform ownership after it finishes.');
expect(!css.includes('--v2-z-nav-peek') && css.includes('.v2-app.is-deck-open > .v2-app__stage > .v2-front{transform:translate3d(100%,0,0)}'), 'Opening FE navigation must move the unchanged Z/front fully offscreen right.');
expect(/\.v2-z\{[\s\S]*?border-radius:var\(--v2-z-radius\) 0 0 0/.test(css), 'FEZ navigation must not change Z geometry: only the upper-left corner is rounded.');
expect(core.includes("navigationLevel: 'f'") && core.includes("state.navigationLevel = hasE ? 'e' : 'f'") && core.includes("eOpen: state.navigationOpen && state.navigationLevel === 'e'"), 'Professional workspace must route F-with-E into the shared E level instead of opening Z prematurely.');
expect(core.includes("let shell = app.querySelector(':scope > [data-v2-app].v2-app--workspace')") && core.includes('if (!shell) {') && core.includes('persistentSurface?.replaceChildren()'), 'Professional FEZ scene must stay mounted across F/E selections instead of rebuilding the whole shell.');
expect(core.includes('const nextFIds = rootItems.map') && core.includes('const currentFIds =') && core.includes('currentF.outerHTML = rootDeck'), 'Persistent professional FEZ must refresh F only when the allowed root set actually changes.');
expect(account.includes('const canReuseScene = Boolean(deck && shell?.querySelector') && account.includes('if (!canReuseScene) {') && account.includes('if (z) z.innerHTML = body;'), 'End-user FEZ scene must reuse the mounted F/Z stage across root selections.');
expect(account.includes('initV2WorkspaceInteraction(root') && account.includes('state.accountDeckOpen = false;'), 'End-user contour must use the same Shared FEZ owner.');
expect(account.includes('root.v2WorkspaceInteractionDispose?.();') && account.includes('root.v2WorkspaceInteractionDispose = dispose;'), 'Persistent end-user FEZ must dispose the previous Shared owner before binding the next one.');
expect(ui.includes("if (typeof layer.v2Dispose === 'function') layer.v2Dispose();") && ui.includes('node.v2Dispose = dispose;'), 'Replacing a non-stacked Z layer must dispose its observer and gesture owner instead of removing raw DOM.');
const stickerSwipe = ui.slice(ui.indexOf('export function initV2StickerSwipe'));
expect(stickerSwipe.includes('surface.setPointerCapture?.(event.pointerId)') && !stickerSwipe.includes('gestureHost.setPointerCapture?.(event.pointerId)'), 'Sticker swipe must capture on its own surface and may not reference the Z-only gestureHost.');
expect(!css.includes('scroll-snap-stop:always'), 'CardDeck native inertia must not be forced to stop at every card.');


expect(documentUi.includes('export function documentTile') && documentUi.includes('export function documentTiles') && documentUi.includes('export function openDocumentViewer'), 'Document UI must be owned only by ui/documents.');
expect(documentCss.includes('width:238px') && documentCss.includes('.document-tiles--rail') && documentCss.includes('.document-tile__toggle'), 'Document UI must keep one 238px geometry, horizontal rail and optional on-document toggle.');
expect(recordRuntime.includes('export function recordTimeRows') && timeCss.includes('.time-slots--hour-rows') && timeCss.includes('overflow-x:auto'), 'Booking time must use the Shared Time owner with hourly horizontal rows.');
expect(!/\.booking-account--account \.v2-app \.calendar__date\{[^}]*border-radius/.test(css), 'V2 must not redesign Calendar geometry.');
expect(calendar.includes('.calendar__grid') && calendar.includes('.calendar__month-button'), 'Canonical Calendar owner must remain intact.');

expect(booking.includes('recordWorkplaceCards(') && booking.includes('recordProcedureList(') && booking.includes('recordTimeRows(') && booking.includes('recordConfirmationMiniCard('), 'Online booking must consume the canonical Shared Record step owners.');
expect(!/bookingChoiceCards\(|bookingTimeGroups\(|v2ServiceStickers\(|v2-confirmation/.test(booking), 'Online booking must not restore parallel local visual owners for canonical booking steps.');
expect(inputs.includes('export function passwordField') && inputs.includes('export function initPasswordFields'), 'Password reveal control must belong to shared UI inputs.');
expect(booking.includes('passwordField({') && booking.includes('initPasswordFields(root)'), 'Auth and Registration must use the shared password reveal control.');
expect(booking.includes("step: 'workplaces'") && booking.includes("step: 'confirmation'"), 'Booking must remain a V2 Z-stack flow.');
expect(booking.includes('initV2Swipe(root'), 'Online booking must preserve the proven swipe controller while consuming Shared booking UI owners.');
expect(ui.includes("const horizontal = Math.abs(nextX) >= Math.abs(nextY) * .72") && ui.includes("const allowedDirection = (nextX > 0 && onRight) || (nextX < 0 && onLeft)"), 'Shared Z edge swipe must accept a natural rightward thumb diagonal after the edge start has established ownership.');
expect(ui.includes("app?.classList.add('is-revealing-deck')") && ui.includes("app?.classList.remove('is-revealing-deck')"), 'Z swipe must reveal and reset the F stack physically.');
expect(sharedSwipe.includes("const dragSurface = isBaseZ && front ? front : surface") && sharedSwipe.includes("const dragProperty = isBaseZ && front ? '--v2-front-drag-x' : '--v2-drag-x'") && sharedSwipe.includes("dragSurface.style.setProperty(dragProperty"), 'Shared edge swipe must move the whole front for Z1 and only the sheet for Z2/Z3.');
expect(ui.includes('let suppressNextClick = false;') && ui.includes("gestureHost.addEventListener('click', click, true)") && ui.includes('event.preventDefault();') && ui.includes('event.stopPropagation();'), 'Shared Z edge swipe must suppress the accidental interactive click generated after a horizontal drag.');
expect(ui.includes('data-v2-card-index="${index}"') && ui.includes('data-v2-deck-level="${text(level)}"'), 'Shared CardDeck must keep all real peer cards with explicit F/E level data and no visual F1/F2/F3 hierarchy.');
expect(ui.includes("edgeHost.addEventListener('pointerdown', zDown)") && ui.includes("edgeHost.addEventListener('pointermove', zMove") && ui.includes("deck.addEventListener('scroll', refresh, { passive: true })") && !ui.slice(ui.indexOf('export function initV2WorkspaceInteraction'), ui.indexOf('export function initV2StickerSwipe')).includes('initV2DeckSwipe('), 'Workspace must separate ownership cleanly: the dedicated edge host owns Z return while CardDeck owns native F/E scrolling.');
expect(!ui.includes('initV2DeckSwipe') && !facade.includes('initV2DeckSwipe'), 'Legacy deck swipe owner must not exist or be exported; workspace interaction is the only FEZ owner.');
expect(ui.includes('data-v2-front') && /\.v2-fe-deck\{[\s\S]*?position:absolute;z-index:2;inset:0/.test(css) && css.includes('.v2-app.is-deck-open > .v2-app__stage > .v2-front{transform:translate3d(100%,0,0)}') && !/\.v2-app\.is-deck-open[^\{]*\.v2-z[^\{]*\{[^}]*transform:/s.test(css), 'FE must stay on H while the unchanged shared front/Z moves fully offscreen right; Z may not own a separate navigation transform.');
expect(ui.includes("if (Number(event.clientX || 0) > rect.left + edgeWidth) return;") && !ui.includes('horizontalGestureContext'), 'Closed Z must leave all internal horizontal rails alone; only a left-edge start may return to FE.');
expect(core.includes('initV2WorkspaceInteraction(shell') && core.includes('eActiveId: childActive') && core.includes('onEOpenChange: (open)') && core.includes('onSecondarySelect: (id) => selectSecondary(id)'), 'Workspace must route F/E/Z interaction through the single Shared workspace owner.');
expect(css.includes('.v2-z .entity-card{transform:translateY(-2px)') && css.includes('.v2-rail-card{') && css.includes('transform:translateY(-2px)'), 'Shared Entity/Rail cards must float above the Z surface; retired legal-card shadows must not be required.');
expect(/\.v2-z\{[\s\S]*?touch-action:auto/.test(css) && /\.v2-edge-swipe-zone\{[\s\S]*?width:36px;[\s\S]*?pointer-events:none;[\s\S]*?touch-action:none/.test(css) && css.includes('.v2-edge-swipe-zone.is-active{pointer-events:auto}'), 'Z must keep native vertical/horizontal inner scrolling while only an actively retained 36px screen-edge owner may intercept return navigation.');
expect(ui.includes('function retainV2EdgeHost(host)') && ui.includes("host.dataset.v2EdgeOwners") && ui.includes("host.classList.add('is-active')") && ui.includes("host.classList.remove('is-active')"), 'Shared edge zone must be reference-counted so inactive screens never keep a dead touch strip.');
expect(ui.includes("retainV2EdgeHost(bindZ && edgeHost?.matches?.('[data-v2-edge-swipe]') ? edgeHost : null)"), 'Workspace edge zone must stay inactive whenever bindZ is false.');
expect(account.includes('GLOBAL_ACCOUNT_ROOTS') && account.includes("id: 'profile', label: 'Профиль'") && account.includes("id: 'home', label: 'Обзор'") && account.includes("id: 'contacts', label: 'Контакты'") && account.includes("id: 'history', label: 'История'") && account.includes('initV2WorkspaceInteraction(root') && account.includes('GLOBAL_ACCOUNT_ROOTS.some((item) => item.id === id)'), 'Changing the active end-user F folder must route through the Shared workspace owner and immediately change Z to the selected Profile / Overview / Contacts / History face.');
expect(accountMobileCss.includes('background:var(--v2-base)'), 'Public booking shell safe area must continue the H base.');
expect(core.includes("setThemeColor('#2F3338')") && core.includes("setThemeColor('#F5F5F3')"), 'Public booking must tint browser chrome to H and restore the workspace theme afterwards.');
expect(booking.includes('documentTile(') && booking.includes('documentTiles(') && booking.includes('openDocumentViewer(') && booking.includes('v2Sticker({') && !booking.includes('v2LegalCards(') && !booking.includes('v2Document('), 'Legal checkpoint may use the Shared U container but every document inside it must use the canonical Document UI and viewer.');
expect(
  booking.includes("closeData: 'data-booking-welcome-u-close'")
    && booking.includes("closeData: 'data-booking-u-close'")
    && booking.includes("closeData: 'data-booking-legal-u-close'")
    && core.includes("closeData: 'data-specialist-u-close'"),
  'Every U entry/information surface must expose the explicit Shared U close control.'
);
expect(
  !/auth-view|auth-card/.test(core)
    && core.includes("v2Sticker({")
    && core.includes("className: 'v2-sticker-screen--auth'"),
  'Specialist auth and technical entry states must use the Shared U owner, never the retired auth-card shell.'
);
expect(!booking.includes('data-booking-workplaces-back') && !booking.includes('data-booking-confirm-back'), 'V2 booking flow must not restore legacy back buttons.');

expect(core.includes("className: 'v2-app--workspace'") && core.includes("v2CardDeck(childItems, {") && core.includes("axis: 'y'") && core.includes("level: 'e'"), 'Professional workspace must render E with the same Shared CardDeck owner on the vertical axis.');
expect(core.includes('v2Shell({') && account.includes('v2Shell({'), 'Professional and end-user contours must both render through the Shared H/F/E/Z shell owner.');
expect(core.includes('v2Header({') && account.includes('v2Header({'), 'Professional and end-user contours must both render Header A/B/C/D through the Shared Header owner.');
expect(ui.includes('export function v2Shell') && ui.includes('data-v2-app') && ui.includes('data-v2-fe') && ui.includes('data-v2-z'), 'Shared shell owner must own H, FE and Z structural layers.');
expect(ui.includes('export function v2Header') && ui.includes("headerControl(a, 'a')") && ui.includes("headerControl(c, 'c')") && ui.includes("headerControl(d, 'd')") && ui.includes('v2-header__title'), 'Shared Header owner must own A, B, C and D.');
expect(css.includes('--v2-base:var(--surface-dark)') && css.includes('.v2-header{') && css.includes('.v2-app__stage{') && css.includes('.v2-fe-deck{') && css.includes('.v2-z{'), 'H/F/E/Z geometry and Header geometry must stay in the shared V2 stylesheet.');
expect(!account.includes('appHeader(') && !account.includes('appShell('), 'End-user account must not create a parallel local H/Header/Z shell.');
expect(!core.includes('appHeader(') && !core.includes('appShell('), 'Professional workspace must not create a parallel local H/Header/Z shell.');

for (const marker of ["{ id: 'people', label: 'Клиенты'", "{ id: 'finance', label: 'Финансы'", "{ id: 'timetable', label: 'График'", "{ id: 'journal', label: 'Журнал'", "{ id: 'profile', label: 'Профиль'", "{ id: 'service', label: 'Сервис'", "{ id: 'settings', label: 'Настройки'"]) {
  expect(core.includes(marker), `Workspace root F is missing ${marker}.`);
}
expect(!core.includes('bottomNavigation(') && !core.includes('renderMain'), 'Workspace V2 must not retain legacy bottom navigation or Main hub routing.');
expect(!fs.existsSync('main/main.js'), 'Legacy Main hub file must be physically removed.');
expect(core.includes("kind: 'chat'") && core.includes("data: 'data-v2-workspace-chat'"), 'Chat must live in Header D instead of root F.');
expect(core.includes("[data-workspace-context-action]") && core.includes("const sourceAKind = aSource?.dataset.workspaceAKind || ''") && core.includes('const aSlot = !aSource') && !core.includes('function syncWorkspaceBack(') && !core.includes("kind: backSource ? 'back' : 'settings'"), 'Workspace Header A must consume the canonical Header context, normalize it through the single photo/counter A contract, and keep no retired Back owner.');
expect(core.includes('function isAddPrimarySource(source)') && core.includes('return candidates.find(isAddPrimarySource) || null;') && core.includes("return source ? '+' : '';"), 'Workspace Header C must expose only the short add action; completion actions stay in Z/Q.');
expect(css.includes('.v2-workspace-source-hidden{display:none!important}') && !css.includes('.v2-workspace-back{') && !core.includes('v2-workspace-back') && !core.includes('syncWorkspaceBack'), 'Workspace V2 must contain no legacy Back control or Back owner.');
expect(css.includes('.v2-primary-source-only{display:none!important}'), 'Header C may proxy a single hidden source without duplicating the visible action in Z body.');
expect(ui.includes("eDeck = ''") && ui.includes('class="v2-fe-deck"') && ui.includes('data-v2-fe'), 'Shared V2 shell must own F and its nested E as one FE deck.');
expect(css.includes('.v2-card-deck--y{') && ui.includes('class="v2-fe-deck" data-v2-fe') && ui.includes('${deck}${eDeck}') && !css.includes('.v2-deck--secondary') && !css.includes('--v2-z-double-open-x:'), 'E must remain the vertical CardDeck inside the single FE hierarchy owner.');
expect(css.includes('.v2-app.is-deck-open > .v2-app__stage > .v2-front') && ui.includes('const isTopmost = () =>') && ui.includes('return layers.length === 0;') && ui.includes("event.target.closest?.('[data-v2-layer], [data-v2-z-layer]')") && ui.includes('revealDeck: false'), 'Deck-open state must move only the shared H+Z front while Z2 keeps independent topmost gesture ownership and never reveals FE.');
expect(finance.includes('export function financeNavigationItems()') && finance.includes('export function renderFinanceSection('), 'Finance E navigation must route to the existing Finance screens.');
for (const label of ['Касса', 'ДДС', 'Z-отчёт']) expect(finance.includes(`label: '${label}'`), `Finance E is missing ${label}.`);
for (const label of ['Доход / Расход', 'Статьи', 'Прочие операции']) expect(!finance.includes(`label: '${label}'`), `Finance must not expose ${label} as E navigation.`);
expect(!core.includes("if (section === 'journal') return journalNavigationItems();") && !core.includes('secondary.journal') && core.includes("journalView: 'day'") && core.includes('return renderJournal(surface, {') && journal.includes('viewNavigation({ views: availableViews, activeView })') && !journal.includes('export function journalNavigationItems()') && !journal.includes('export function renderJournalView('), 'Journal Day/Month/List must stay as one compact Shared View Navigation inside Z and must never return as E cards or secondary navigation state.');
expect(settings.includes('export function settingsNavigationItems()') && settings.includes('export async function renderSettingsSection(') && !settings.includes("'profile'") && !settings.includes("'service'"), 'Settings E must route only Settings-owned children while Profile and Service stay standalone root F folders.');
expect(onlineBookingSettings.includes('workspaceHeaderContext({') && !onlineBookingSettings.includes('data-online-booking-back') && onlineBookingSettings.includes('data-online-booking-welcome-save') && onlineBookingSettings.includes("variant: 'q'"), 'Online booking settings must feed Welcome Save through Shared Q Header C while return navigation remains gesture-owned.');
expect(!/\b(?:appShell|appHeader)\s*\(/.test(onlineBookingSettings) && !onlineBookingSettings.includes('app-content--book-shell'), 'Online booking settings must not recreate a full-screen shell inside Z.');
expect(!fs.existsSync('settings/online-booking/online-booking.css'), 'Online booking settings must not own a local stylesheet.');
expect(!core.includes("contextRoot.querySelector('[data-workspace-back-source]')"), 'Shared workspace must not consume retired local Back sources; navigation is gesture-owned.');
expect(!core.includes('.app-header__'), 'Legacy app-header compatibility selectors must not return.');
expect(!journalList.includes('getBoundingPersonRect') && journalList.includes('getBoundingClientRect()'), 'Journal List scroll must use the real DOM geometry API.');
expect(financeDds.includes('openFinanceOperation(root, movements, element.dataset.financeOperation)') && !financeDds.includes('navigateBack') && !financeDds.includes('onBack'), 'Finance DDS detail/cancel refresh must remain gesture-owned with no retired Back callback.');
expect(financeCash.includes('openCashAppearanceQ(root)') && financeCash.includes("{ value: 'wallet', label: 'Кошелёк' }") && financeCash.includes("{ value: 'loan', label: 'Займ' }") && financeCash.includes("{ value: 'investment', label: 'Инвестиция' }") && financeCash.includes("{ value: 'all', label: labels[type] || 'Все карты' }") && financeCash.includes("id: 'appearance', label: 'Вид', onSelect: () => openCashAppearanceQ(root)") && !financeCash.includes('openWalletAppearance(') && !financeCash.includes('openFinanceEntityAppearance(') && !financeCash.includes('mountEntityCardConstructor('), 'Cash must own one centralized Wallet/Loan/Investment View Q and individual finance cards must not own appearance editors.');
expect(cardAppearanceTemplates.includes("new Set(['person', 'workplace', 'wallet', 'loan', 'investment', 'procedure', 'product'])") && cardAppearanceTemplates.includes("queueAuxiliaryDataset('cardAppearanceTemplates'") && profile.includes("saveCardAppearanceTemplate('workplace'") && financeCash.includes('saveCardAppearanceTemplate(type'), 'All-card View must persist one reusable appearance template per card type for current and future cards.');
expect(modals.includes("MODAL_VARIANTS = new Set(['q', 'x', 's', 'technical'])") && modals.includes('data-v2-q="true"') && ui.includes("const qLayer = node.dataset.v2Q === 'true'") && ui.includes("kind === 'standard' && !qLayer") && core.includes("document.querySelectorAll('[data-v2-q=\"true\"] .v2-layer')") && appearanceQ.includes('workspaceHeaderContext({') && !appearanceQ.includes('hideD') && appearanceQ.includes('data-card-q-save') && appearanceQ.includes('controller?.save?.()'), 'Q must reuse Shared standard-modal geometry, cover active Z, keep global D available and keep Header C as the direct Save owner instead of becoming a Z2/Z3 layer.');

expect(profile.includes('workspaceHeaderContext({') && profile.includes("kind:'avatar'") && !profile.includes("hideD:true"), 'Professional Profile must feed A/B and keep Shared D=Chat enabled instead of hiding D.');
expect(profile.includes("function profileContext(p,title=fullName(p))"), 'Professional Profile root B must use the profile name while nested layers may use contextual titles.');
expect(profile.includes("v2Section('Рабочие пространства',workplaceRail())") && profile.includes('v2HorizontalRail('), 'Profile root Z must contain the profile card plus a horizontal workplace rail.');
expect(!profile.includes('accordion(') && !profile.includes('initAccordions('), 'Regular Profile UI must not retain the legacy accordion.');
expect(profile.includes('openSharedProfileSettingsMenu({') && profile.includes("id:'appearance',label:'Вид'") && profile.includes('openProfileAppearanceQ(') && profile.includes('openEntityCardAppearanceQ(root') && profile.includes("{value:'profile',label:'Профиль'}") && profile.includes("{value:'workplace',label:'Рабочее пространство'}") && profile.includes("{value:'all',label:'Все рабочие пространства'}") && profile.includes("id:'password',label:'Изменить пароль'") && profile.includes("id:'controls',label:'Согласия / Уведомления'") && profile.includes("id:'logout',label:'Выход'") && !profile.includes("label:'Удалить профиль'"), 'Professional Header A must expose one centralized Profile/Workplace View Q and never expose deletion of the main profile.');
expect(profile.includes('data-v2-primary-action') && profile.includes('data-add-workplace'), 'Profile root C must preserve the + add-workplace action.');

expect(profile.includes("data:'data-profile-card'") && profile.includes("openProfileData(root") && profile.includes("'Данные профиля'"), 'Profile Card must open a dedicated Profile Data Z2.');
expect(!profile.includes('mountEntityCardConstructor(') && appearanceQ.includes("variant: 'q'") && appearanceQ.includes('mountEntityCardConstructor(constructor') && appearanceQ.includes('targetOptions') && appearanceQ.includes('resolve(type, target)') && appearanceQ.includes('save({ type, target, appearance, photo, editor })'), 'Entity Card View must be orchestrated by one Shared Q owner while mountEntityCardConstructor() remains the sole visual editor.');
expect(profile.includes("openWorkplaceZ2(root") && profile.includes("workplaceForm(existing,{sourceOnly:true})") && profile.includes("openWorkplaceSettingsMenu(layer,existing"), 'Workplace cards and create action must use reusable Z2 data with A-owned settings.');
expect(profile.includes("entityVisualCard({") && profile.includes("workplaceCardAppearance(w)") && !profile.includes("entity-card--compact"), 'Workplaces in Profile must use the canonical fixed Entity Card UI, not compact substitutes.');
expect(profile.includes("actionBlock(button('Сохранить',{type:'submit',data:`data-save-profile") && profile.includes("const saveActions=saveButton?.closest('.modal-actions')") && !profile.includes('setSharedProfilePrimary(primary'), 'Profile Data Save must use one Shared bottom action in Z and must not return to Header C.');
expect(workplacesUi.includes("data-v2-primary-label=\"Сохранить\"") && !workplacesUi.includes("existing&&!dirty?'Удалить':'Сохранить'"), 'Workplace Z2 C must be Save-only; deletion belongs to A settings.');
expect(!workplacesUi.includes("id:'appearance'") && !workplacesUi.includes("label:'Вид'") && !workplacesUi.includes('mountEntityCardConstructor(') && workplacesUi.includes("id:'color'") && workplacesUi.includes("id:'schedule'") && workplacesUi.includes("id:'delete'") && workplacesUi.includes("label:'Удалить пространство'"), 'Individual Workplace A must not own View; centralized Profile Q owns appearance while Workplace A keeps Color, Work schedule and deletion.');
expect(workplacesUi.includes('openSharedProfileSettingsMenu({') && workplacesUi.includes('openColorPickerAction({') && workplacesUi.includes('openTimeRangeAction({') && workplacesUi.includes('setSharedProfilePrimary(primary') && !workplacesUi.includes('openWorkplaceAppearance('), 'Workplace must consume the Shared A-menu and contextual C owners without a local appearance editor.');
expect(!workplacesUi.includes('mountV2ZLayer(root,v2ZLayer(page([workspaceHeaderContext({title:\'Настройки пространства\''), 'Workplace settings must not create a separate settings Z; A always manifests through the Shared bottom menu.');
expect(workplacesUi.includes("workplaceForm(existing,{bodyActions:true})") && workplacesUi.includes("workplaceForm(existing=null,{sourceOnly=false,bodyActions=false}={})"), 'Workplace must keep one reusable form renderer; onboarding compatibility may retain inline initial settings.');
expect(sharedProfile.includes('export function openSharedProfileSettingsMenu') && sharedProfile.includes('export async function openSharedPhotoAction') && sharedProfile.includes('export function openSharedPasswordAction') && sharedProfile.includes('export function setSharedProfilePrimary') && !sharedProfile.includes('openSharedConsentDocument'), 'Professional and end-user profiles must share one Profile UI owner for A menu, photo, password and C; document rendering belongs only to ui/documents.');
expect(css.includes('--v2-z-layer-offset:12px') && css.includes('inset:0 0 0 calc(var(--v2-edge) + var(--v2-z-layer-offset))'), 'Shared Z2 must leave a single 12px Z1 edge through the shared token.');
expect(ui.includes("[data-v2-z], [data-v2-z-layer]") && ui.includes("revealDeck: false"), 'Shared swipe must own Z2 and close it without revealing F.');
expect(accountControlsUi.includes("data-service-email") && accountControlsUi.includes("data-service-push") && accountControlsUi.includes("data-service-telegram"), 'Profile Settings must expose Telegram, Email and Push service channels.');
expect(accountControlsUi.includes('documentTile(') && accountControlsUi.includes('documentTiles(') && accountControlsUi.includes('openDocumentViewer(') && !accountControlsUi.includes('openSharedConsentDocument') && !accountControlsUi.includes('v2LegalCards(') && !accountControlsUi.includes('v2Document('), 'Professional consent documents must use the single canonical Document UI owner.');
expect(!accountControlsUi.includes('История согласий') && !accountControlsUi.includes('historyMarkup') && !accountControlsUi.includes('openConsentHistory') && !accountControlsUi.includes('data-consent-history'), 'Profile Settings must not expose consent history.');

expect(style.includes('--text:#111111') && style.includes('--button-secondary:#D8D3CF') && style.includes('--text-secondary:#777A7D'), 'Shared palette must use the approved black and neutral tokens.');
expect(buttonCss.includes('border:1px solid var(--white)') && buttonCss.includes('.ui-button--secondary,.ui-button--outline{border-color:var(--text);background:var(--white);color:var(--text)}') && buttonCss.includes('.ui-button:disabled{'), 'Shared Button owner must keep primary black/white, secondary white/black, rounded, with a separate disabled state.');
expect(buttonCss.includes('.v2-app .ui-button{border-radius:14px}') && !buttonCss.includes('.v2-app .ui-button,.v2-app .icon-button'), 'V2 must not flatten the main Shared button geometry.');
expect(segmentUi.includes('filter(Boolean).map') && !segmentUi.includes('segment-control--two-equal') && !segmentUi.includes('--segment-count:') && !segmentUi.includes('.slice(0, 3)'), 'Shared segmented-control owner must use one full-width manifestation for 2, 3, and larger option sets without feature-specific width variants.');
expect(segmentCss.includes('display:flex') && segmentCss.includes('width:100%') && segmentCss.includes('flex:1 1 0') && segmentCss.includes('min-height:30px') && segmentCss.includes('padding:0 8px') && segmentCss.includes('white-space:nowrap') && segmentCss.includes('border:1px solid var(--text)') && segmentCss.includes('background:var(--white)') && segmentCss.includes('button.is-active{') && segmentCss.includes('background:var(--text)') && segmentCss.includes('color:var(--white)') && !/(^|})\.segment-control\s*\{/.test(style), 'Segmented control styling must stay compact, full-width, symmetric and single-line inside its single Shared owner.');
expect(viewNavigationUi.includes('class="segment-control"') && !viewNavigationUi.includes('className'), 'View Navigation may change behavior only; it must not accept a visual class/geometry variant outside the single Shared segment-control owner.');
expect(infoUi.includes('export function infoUI') && infoUi.includes('export function initInfoUI') && facade.includes('infoUI') && facade.includes('initInfoUI'), 'Shared Info UI owner must be exposed through ui/ui.js.');
expect(infoUi.includes("import { smallActionButton } from '../buttons/index.js';") && infoUi.includes("smallActionButton({") && buttonCss.includes('.small-action-button{box-sizing:border-box;width:24px') && buttonCss.includes('border:1px solid #111') && buttonCss.includes('background:#fff;color:#111') && !infoCss.includes('.ui-info__trigger{'), 'Info and copy must share the one approved 24px black/white small action UI owner instead of duplicating button geometry.');
expect(inputsCss.includes('.field input,.field select,.field textarea') && !inputsCss.includes('border-radius:12px') && listCss.includes('border-radius:0') && listEntryCss.includes('border-radius:0'), 'Shared working inputs, selects and list rows must remain straight.');
expect(!listCss.includes('border-radius:0 17px') && listCss.includes('.ui-list__item.is-first:not(.is-last){border-radius:0}'), 'Shared List must keep the approved fully straight row geometry without the legacy rounded first row.');
expect(selectorsUi.includes("import { modal, mountModal } from '../modals/index.js';") && selectorsUi.includes("variant: 'x'") && !selectorsUi.includes('document.body.appendChild(surface)'), 'Shared Select must manifest through canonical X instead of a fixed body overlay.');
expect(!/\.ui-selector\s*\{[^}]*position\s*:\s*fixed/s.test(selectorsCss), 'Shared Select must not own a parallel fixed overlay.');
expect(miniCardUi.includes('export function miniCardRail') && miniCardCss.includes('--mini-card-width:238px') && miniCardCss.includes('--mini-card-height:144px') && miniCardCss.includes('border:2px solid #111') && miniCardCss.includes('border-radius:16px') && miniCardCss.includes('padding:16px'), 'Shared Mini Card must keep one fixed 238x144 geometry with 2px black frame, 16px radius and 16px inner padding.');
expect(miniCardCss.includes('word-break:normal') && miniCardCss.includes('overflow-wrap:normal') && miniCardCss.includes('hyphens:none'), 'Shared Mini Card text must wrap only between whole words.');
expect(miniCardUi.includes("surface = 'default'") && miniCardUi.includes("surface === 'photo'") && miniCardUi.includes("actionLabel = ''") && miniCardCss.includes('.mini-card--surface-photo') && miniCardCss.includes('.mini-card__context-action'), 'Shared Mini Card must own contextual surfaces: white by default and photo/gradient with a framed contextual action when explicitly requested.');
expect(miniCardUi.includes('export function miniCardStack') && facade.includes('miniCardStack') && miniCardCss.includes('.mini-card-stack'), 'Shared Mini Card owner must also provide the canonical vertical stack composition.');
expect(entityCardCss.includes('--entity-card-depth:#2C2A28') && entityCardCss.includes('--entity-card-mid:#817A73') && entityCardCss.includes('--entity-card-light:#D7D1CA') && entityCardCss.includes('radial-gradient(circle at 78% 18%') && !entityCardCss.includes('--entity-card-neutral') && !entityCardCss.includes('var(--v2-disabled') && !entityCardCss.includes('var(--button-secondary)'), 'Photo-less Entity Card must own a warm Shared gradient and must never derive its surface from disabled/system gray.');
expect(entityCardCss.includes('.entity-card.has-image .entity-card__background') && entityCardCss.includes('var(--entity-card-image)'), 'Entity Card with photo must keep the photo as the base with only a soft readability veil.');
expect(entityCardUi.includes('export function entityCardStack') && facade.includes('entityCardStack') && entityCardCss.includes('.entity-card-stack{display:grid'), 'Shared Entity Card owner must provide the canonical vertical card stack.');
expect(inputs.includes('data-photo-crop-x-value') && inputs.includes('data-photo-crop-y-value') && inputs.includes('setOriginal(src)') && !inputs.includes('croppedSquare('), 'Shared photo owner must preserve the original image and store crop position metadata instead of replacing the original with a cropped blob.');
expect(headerUi.includes('export function workspaceHeaderContext') && facade.includes('workspaceHeaderContext'), 'Canonical Header owner must own workspace context metadata.');
expect(ui.includes("kind === 'logo'") && css.includes('.v2-header__slot--a .v2-header__control') && css.includes('width:48px') && css.includes('height:48px') && css.includes('border:2px solid var(--v2-yellow)') && css.includes('background:var(--v2-base)') && css.includes('.v2-header__slot--a .v2-header__avatar--initials{background:transparent;color:#fff}'), 'Shared Header A must keep one 48x48 H circle with the canonical yellow outline while section data alone changes its content.');
expect(ui.includes("role === 'a' && slot.settingsTag") && !ui.includes("kind === 'avatar' && slot.settingsTag") && css.includes('.v2-header__settings-tag{position:absolute;right:-2px;bottom:-2px') && headerUi.includes('data-workspace-a-settings-tag='), 'Shared Header A settings gear must be one lower-right overlay that works for photo or counter and never be tied only to avatar content.');
expect(core.includes('function workspaceProfileASlot(') && core.includes("a: workspaceProfileASlot()") && core.includes("sourceAKind === 'settings'") && core.includes('settingsTag: !aSource.disabled'), 'Professional Header A must never become empty or render a standalone settings icon: missing A falls back to profile photo/logo and legacy settings intent becomes photo/logo plus gear.');
expect(people.includes('settingsTag: true') && people.includes("button('Вид'") && people.includes('allowPhoto: false') && people.includes('entityVisualCard({') && !people.includes('openPersonPhotoEditor') && !people.includes('metricRail(') && timetable.includes('settingsTag: !inactiveA') && recordRuntime.includes('settingsTag: true'), 'Clickable counter/photo A contexts must expose the same Shared settings gear while inactive A contexts omit it.');
expect(css.includes('.v2-header__slot--d .v2-header__control--chat') && css.includes('background:transparent;color:#fff') && css.includes('.v2-header__icon--chat svg') && css.includes('fill:currentColor;stroke:none'), 'Shared Header D chat must be the white chat mark without a circular button surface.');
expect(css.includes('.v2-header__slot--c .v2-header__control{') && css.includes('border:1px solid #fff') && css.includes('background:#111;color:#fff') && css.includes('.v2-header__slot--c .v2-header__control--white{border-color:#111;background:#fff;color:#111}') && css.includes('.v2-header__slot--c .v2-header__control--danger'), 'Shared Header C must default to black with white outline/text and change colour only through an explicit special variant.');
expect(ui.includes("c && !c.hidden ? 'has-c' : ''") && ui.includes("d && !d.hidden ? 'has-d' : ''") && css.includes('.v2-header:not(.has-d).has-c .v2-header__slot--c{grid-column:3/5;justify-items:end}'), 'Shared Header must move C into the chat area when D is absent and keep C left of D when chat is present.');
expect(headerUi.includes("const actionDisabled = a?.disabled ? ' disabled' : ''") && core.includes('disabled: Boolean(aSource.disabled)'), 'Shared Header context must support a visible but inactive A control without feature-local handling.');
expect(!ui.includes('v2WorkspaceContext'), 'Shared V2 must not duplicate the canonical Header context owner.');
expect(ui.includes('export function v2ZLayer') && ui.includes('export function mountV2ZLayer'), 'Shared V2 must own stacked Z layers.');
expect(ui.includes('export function v2Layer') && ui.includes('export function mountV2Layer'), 'Shared V2 may keep modal geometry primitives internally for ui/modals.');
expect(!facade.includes('v2Layer') && !facade.includes('mountV2Layer'), 'ui/ui.js must not expose internal V2 modal primitives alongside the canonical modal owner.');
expect(core.includes('activeWorkspaceSurface(surface)') && core.includes("[data-workspace-context-action]") && !core.includes('workspaceHideD') && core.includes("d: sectionAllowed('chat') ? {"), 'Workspace Header must follow the top Z/Q surface while keeping global D=Chat available.');

expect(modals.includes("import { mountV2Layer, v2Layer } from '../v2/index.js';")
  && modals.includes('v2Layer(content')
  && modals.includes('mountV2Layer(html, { root })')
  && modals.includes("MODAL_VARIANTS = new Set(['q', 'x', 's', 'technical'])")
  && modals.includes("openNotice({ title = 'Внимание', message = '', surface = 'app'")
  && !modals.includes('<div class="modal-backdrop"'),
  'ui/modals must remain the sole public modal owner, expose only Q/X/S/technical, route user notices to swipe-only S, and reserve technical overlays for exceptional system cases.');
expect(timeUi.includes("variant:'x'") && timeUi.includes("className:'modal--time-picker-sheet'"), 'Time Picker must use Shared X; S/technical/native variants are forbidden for this ordinary picker.');
expect(ui.includes("const allowed = new Set(['top', 'standard', 'bottom', 'technical'])") && ui.includes("const technical = kind === 'technical'") && ui.includes('activeV2ModalSurface(root)'), 'Internal V2 modal geometry must expose exactly the approved top/standard/bottom/technical model.');
expect(ui.includes('function initV2LayerDismissGesture') && ui.includes("kind === 'top' ? Math.min(0, raw) : Math.max(0, raw)") && ui.includes('stopPointerPropagation') && ui.includes("resolved === 'technical'"), 'Shared Modal must own origin-directed dismissal, isolate pointer gestures from lower Z/F/E, and reserve technical overlays for exceptional system cases.');
expect(ui.includes("app.querySelector('[data-v2-z-layer]')") && ui.includes("if (!bindZ || deckIsOpen() || zGesture"), 'Shared workspace Z-edge owner must yield completely while any stacked Z2/Z3 is active.');
expect(ui.includes('const topLayer = layers.at(-1)') && ui.includes('if (topLayer) return topLayer') && ui.includes('if (explicit) return explicit'), 'Shared modal/Q owner must attach to the top active Z layer so dismissing Q returns to the exact source surface instead of exposing F/E.');
expect(ui.includes("const locksHeader = Boolean(app && kind === 'standard' && !qLayer)") && ui.includes("header.inert = true") && ui.includes("header.classList.add('is-modal-locked')"), 'Shared standard modal-Z must keep Header A-D visible but inactive, while Q is the explicit exception that leaves Header C interactive.');
expect(css.includes('.v2-header.is-modal-locked{pointer-events:none}'), 'Shared Header must expose one modal-lock visual interaction state.');

for (const [name, source] of [
  ['profile', profile],
  ['profile workplaces', workplacesUi],
  ['profile account controls', accountControlsUi],
  ['shared time', timeUi],
  ['shared colors', colorUi],
  ['end-user account shell', account],
  ['consent-settings', consentSettings],
]) {
  expect(source.includes('modal(') && source.includes('mountModal('), `${name} must consume the sole shared modal owner.`);
  expect(!source.includes('mountV2Layer(') && !source.includes('v2Layer('), `${name} must not bypass ui/modals with a parallel V2 modal path.`);
}
expect(personalData.includes('datePicker({label:\'Дата рождения\'') && personalData.includes('initDatePickers(layer)') && !personalData.includes('birthDateField') && !personalData.includes('openBirthDatePicker') && !personalData.includes('data-account-birth-') && !personalData.includes('ui-select__control') && !personalData.includes('mountModal(') && !personalData.includes('modal('), 'End-user Profile personal data must consume the Shared Date Picker owner and must not draw or mount a local date/select modal.');
expect(calendarUi.includes('export function datePicker') && calendarUi.includes('export function initDatePickers') && calendarUi.includes('initCalendar(calendarHost') && calendarUi.includes('select({') && calendarUi.includes('mountModal(document.body, modal'), 'Shared Calendar owner must own full-date field, year select, calendar and modal manifestation.');
const endUserProfileCard = account.slice(account.indexOf('function profileSummary'), account.indexOf('function bindGlobalRelationships'));
expect(endUserProfileCard.includes('entityVisualCard({') && endUserProfileCard.includes('ACCOUNT_PROFILE_CARD_APPEARANCE') && !endUserProfileCard.includes('entityCard({') && !endUserProfileCard.includes('entity-card--hero') && !/className\s*:\s*['\"][^'\"]*account-profile-card/.test(endUserProfileCard), 'End-user Profile root card must consume the canonical Entity Visual Card and must not retain the legacy hero/local card manifestation.');
expect(passwordSettings.includes('openSharedPasswordAction') && !passwordSettings.includes('modal(') && !passwordSettings.includes('mountModal('), 'End-user password settings must consume the Shared Profile password owner instead of owning a modal.');
expect(!inputs.includes('modal(') && !inputs.includes('mountModal('), 'Shared photo/input owner must keep crop inline and must not open a modal.');
expect(!inputs.includes('mountV2Layer(') && !inputs.includes('v2Layer('), 'Shared inputs must not bypass canonical owners with local V2 layers.');



expect(account.includes('v2CardDeck(GLOBAL_ACCOUNT_ROOTS') && account.includes("axis: 'x'") && account.includes("level: 'f'"), 'End-user root must use the shared horizontal CardDeck.');
expect(account.includes("id: 'profile', label: 'Профиль'")
  && account.includes("id: 'home', label: 'Обзор'")
  && account.includes("id: 'contacts', label: 'Контакты'")
  && account.includes("id: 'history', label: 'История'")
  && !account.includes("id: 'representatives'"),
  'End-user F owner must expose exactly Profile / Overview / Contacts / History and no legacy two-folder deck.');
expect(account.includes('initV2WorkspaceInteraction(root'), 'End-user F/E/Z interaction must use the single Shared workspace owner.');
expect(!account.includes('initV2DeckSwipe(root') && !account.includes('function bindRootSwipe') && !account.includes('function bindDeck('), 'End-user account must not re-own F/Z gesture binding beside the Shared workspace owner.');
expect(core.includes('initV2WorkspaceInteraction(shell') && !core.includes('initV2DeckSwipe(rootDeckNode') && !core.includes('initV2Swipe(z'), 'Professional workspace must consume the same Shared workspace interaction owner as the end-user account.');
expect(account.includes("selected ? 'v2-app--chat' : 'v2-app--chat-list'"), 'End-user Chat must share V2 H + Z geometry inside the single global account owner.');
expect(chatRuntime.includes("attachmentTrigger: 'external'") && chatRuntime.includes("kind: 'attachment'"), 'Chat attachment action must live in neutral Core Chat Header D.');
expect(!account.includes('accountBottomNavigation') && !account.includes('bindBottomNavigation'), 'End-user V2 must not contain bottom navigation.');
expect(!account.includes('<style>') && !booking.includes('<style>'), 'Feature code must not create local V2 style owners.');

const globalFeatureCss = /\.(?:bottom-nav|nav-item|entity-list|color-picker|cost-field|duration-picker|workplace-selector|journal-list-|record-status-controls|work-time-row|app-content)/;
expect(!globalFeatureCss.test(style), 'Global style.css must remain foundation-only; component styling belongs to Shared UI owners.');

if (failures.length) {
  failures.forEach((message) => console.error(`ui v2 architecture: ${message}`));
  process.exit(1);
}

console.log('ui v2 architecture check: OK');
