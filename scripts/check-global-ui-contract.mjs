import fs from 'node:fs';

const read = (path) => fs.readFileSync(path, 'utf8');
const alphabet = read('UI_ALPHABET.md');
const shell = read('ui/v2/shell.js');
const v2Css = read('ui/v2/v2.css');
const style = read('css/style.css');
const header = read('ui/v2/header.js');
const workspaceHeader = read('ui/header/index.js');
const menuHeader = read('ui/v2/header-state.js');
const v2Index = read('ui/v2/index.js');
const zLayout = read('ui/v2/z-layout.js');
const zStack = read('ui/v2/z-stack.js');
const zAffordance = read('ui/v2/z-affordance.js');
const surfaceHeaderCss = read('ui/v2/surface-header.css');
const horizontalAffordance = read('ui/v2/horizontal-affordance.js');
const horizontalAffordanceCss = read('ui/v2/horizontal-affordance.css');
const modalPortal = read('ui/v2/modal-portal.js');
const modals = read('ui/modals/index.js');
const modalCss = read('ui/modals/modal.css');
const appearanceQ = read('ui/cards/appearance-q.js');
const selectors = read('ui/selectors/selectors.css');
const info = read('ui/info/info.css');
const time = read('ui/time/index.js');
const accountShell = read('online-booking/account-shell.js');
const booking = read('online-booking/booking.js');
const professionalShell = read('core.js');
const recordRuntime = read('ui/record/runtime.js');
const indexHtml = read('index.html');
const chatRuntime = read('core/chat/runtime.js');
const messengerMode = read('core/chat/messenger-mode.js');

const failures = [];
const expect = (condition, message) => { if (!condition) failures.push(message); };

expect(alphabet.includes('Контракт одинаков для профессионального интерфейса и интерфейса конечного пользователя'), 'UI alphabet must state one global contract for both application interfaces.');
expect(alphabet.includes('B показывает только присвоенный текущему контексту заголовок'), 'UI alphabet must keep B contextual and allow an unassigned title to stay empty.');
expect(alphabet.includes('C') && alphabet.includes('`+`'), 'UI alphabet must document the add-only C contract.');
expect(alphabet.includes('В APP-состоянии D с иконкой чата всегда означает `включить Messenger`'), 'UI alphabet must make APP D the Messenger entry.');
expect(alphabet.includes('В корне Messenger Z1 D меняется на явный control `вернуться в приложение`'), 'UI alphabet must make Messenger Z1 D the only exit.');
expect(alphabet.includes('Для обычного диалога D — скрепка/вложения'), 'UI alphabet must reserve dialog D for attachment.');
expect(alphabet.includes('Информационный control `I`') && alphabet.includes('всегда находится в правой зоне `Z Header`'), 'UI alphabet must keep I on the right side of the surface header.');
expect(alphabet.includes('S — только информационное/техническое сообщение'), 'UI alphabet must keep S informational only.');
expect(alphabet.includes('Текущее выбранное значение в закрытом select всегда визуально центрировано'), 'UI alphabet must keep selector values centered.');

expect(!fs.existsSync('ui/header/c-action-policy.js'), 'C contract must not be implemented by a global DOM interceptor.');
expect(!indexHtml.includes('c-action-policy.js'), 'Application entry must not load a C DOM interceptor.');
expect(workspaceHeader.includes('function isAddAction(action)') && workspaceHeader.includes("data-v2-primary-label=\"+\""), 'Workspace Header context must expose only add actions through C.');
expect(professionalShell.includes('function isAddPrimarySource(source)') && !professionalShell.includes("surface.querySelector('form button[type=\"submit\"]')"), 'Professional shell must discover only add actions for C and never promote generic submits.');
expect(recordRuntime.includes('data-record-owner-primary-actions') && !recordRuntime.includes("source.dataset.v2PrimaryAction = ''"), 'Shared Record primary action must live in Z/Q bottom actions instead of C.');
expect(!booking.includes('c: action ?') && booking.includes('function actionMarkup(action = null)') && booking.includes('actionBlock(button(action.label'), 'End-user booking flow completion actions must be bottom actions, not Header C.');
expect(!accountShell.includes("label: 'Сохранить',\n      data: 'data-account-profile-save'") && !accountShell.includes("c: { kind: 'text', label: 'Записаться'") && !accountShell.includes("c: canRepeat ? { kind: 'text'"), 'End-user account shell must not place save/book/repeat actions in C.');
expect(accountShell.includes("actionBlock(button('Записаться'") && accountShell.includes("actionBlock(button('Повторить'"), 'End-user account booking/repeat actions must use the shared bottom action owner.');

expect(v2Css.includes('--v2-base:var(--surface-dark)') && style.includes('--surface-dark:#2F3338'), 'Shared H owner must use the canonical dark application surface token.');
expect(shell.includes('data-v2-horizontal-rail'), 'Shared horizontal rail must expose one canonical marker.');
expect(menuHeader.includes("state.title.textContent = 'Меню'"), 'Shared H owner must set B to Menu while the deck is open.');
expect(
  menuHeader.includes('state.cSlot.hidden = true')
    && menuHeader.includes("state.cSlot.style.display = 'none'")
    && menuHeader.includes("header.classList.remove('has-c')"),
  'Shared H owner must remove C from Menu visually and from layout geometry.',
);
expect(menuHeader.includes('state.cSlot.style.display = state.cDisplay'), 'Shared H owner must restore C display after leaving Menu.');
expect(!menuHeader.includes('aControl'), 'Shared H owner must leave photo-only A untouched in menu state.');
expect(menuHeader.includes('state.dControl.disabled = false'), 'Shared H owner must keep D interactive in menu state.');
expect(!menuHeader.includes("state.dControl.className = 'v2-header__control v2-header__control--mode'"), 'Menu state must not rewrite D into a different control; it preserves the owning screen D.');

expect(
  chatRuntime.includes("kind: 'mode'")
    && chatRuntime.includes('data-chat-mode-switch')
    && chatRuntime.includes("kind: 'attachment'")
    && chatRuntime.includes('data-chat-attachment'),
  'Messenger runtime must own Z1 exit D and Z2 attachment D as different states.',
);
expect(messengerMode.includes('dismissible: false') && messengerMode.includes("ROOT_CLASS = 'messenger-mode-z'"), 'Messenger Z1 must be a non-dismissible shared mode root.');

expect(header.includes("if (!slot || slot.hidden) return '';"), 'Shared Header must not render empty action placeholders.');
expect(!header.includes('settingsTag') && header.includes('function avatarControl'), 'Shared Header A must be photo-only and contain no settings badge contract.');
expect(header.includes("const kind = slot.kind || 'text'") && !header.includes("role === 'd' ? 'mode'"), 'Shared Header D must respect its current APP/Messenger depth role.');
expect(header.includes("actionControl(c, 'c')") && header.includes("if (!slot || slot.hidden) return '';"), 'Shared Header C must render only from a real visible contextual action.');
expect(!header.includes('v2-header__slot is-empty'), 'Shared Header must not reserve visual space with empty slots.');
expect(workspaceHeader.includes('data-workspace-a-context') && workspaceHeader.includes('data-workspace-v-action') && !workspaceHeader.includes('settingsTag'), 'Workspace Header must keep photo-only A metadata separate from independent V action metadata.');
expect(!workspaceHeader.includes('hideD'), 'Surface Header context must never expose a way to hide Header D.');
expect(!appearanceQ.includes('hideD'), 'Q surfaces must never request suppression of Header D.');

expect(zLayout.includes("return `${v2QHeader(header)}${v2QBody(content)}`;"), 'Every Q must keep the same Shared Header + Body frame as Z.');
expect(
  zLayout.includes("const Z_VIEWPORT_OVERSCAN = '24px';")
    && zLayout.includes("kind === 'z'")
    && zLayout.includes('margin-right:${Z_VIEWPORT_OVERSCAN}'),
  'Shared Z work content must compensate the 24px technical right overscan while Q remains unchanged.',
);
expect(zLayout.includes('bindV2ZHeaderOwner(root)') && zLayout.includes('root.replaceChildren = (...children) => {') && zLayout.includes('clearV2ZHeaderRows(root);'), 'Screen-scoped Z Header rows must be cleared when their owner surface is replaced.');
expect(
  surfaceHeaderCss.includes('[data-v2-z-header]:has(> [data-v2-z-header-content]:empty)')
    && surfaceHeaderCss.includes('[data-v2-q-header]:has(> [data-v2-q-header-content]:empty)')
    && (surfaceHeaderCss.match(/min-height:28px!important/g) || []).length >= 2
    && (surfaceHeaderCss.match(/padding-bottom:0!important/g) || []).length >= 2,
  'Empty Shared Z and Q Headers must use the same compact affordance-only geometry without extra white bands.',
);
expect(zAffordance.includes('drop-shadow('), 'Shared Z/Q dismiss affordance must remain visibly separated from the surface.');
expect(zAffordance.includes('[data-v2-q-header] > [data-v2-z-dismiss]'), 'Shared dismiss affordance must work in Q as well as Z.');
expect(zStack.includes('export function bindV2StableZFrame'), 'Shared Z owner must protect Header + Body geometry while body content changes.');
expect(zStack.includes("surface.dataset.v2Dismissible === 'false'"), 'Shared Z owner must be able to remove the dismiss affordance when no real back step exists.');
expect(v2Index.includes('bindV2StableZFrame') && !v2Index.includes('ensureRootZFrame'), 'Root Z must bind the stable Shared frame instead of repairing it after destruction.');
expect(v2Index.includes('bindV2HorizontalAffordances'), 'Shared V2 runtime must bind horizontal rail affordances.');
expect(horizontalAffordance.includes('rail.children.length > 1') && horizontalAffordance.includes("classList.toggle('has-v2-horizontal-rail'"), 'Horizontal rail cue must be based on real multiple-card layout.');
expect(horizontalAffordanceCss.includes('.v2-section.has-v2-horizontal-rail') && horizontalAffordanceCss.includes('content:"→"') && horizontalAffordanceCss.includes('opacity:.72'), 'Horizontal rail cue must be clearly visible and visually distinct from the Z dismiss chevron.');
expect(accountShell.includes('if (!canReuseScene) {') && accountShell.includes('root.innerHTML = v2Shell({'), 'End-user surfaces must keep the persistent Shared FEZ scene.');

expect(modalPortal.includes('function lockModalHeader(app)') && modalPortal.includes('header.inert = true') && !modalPortal.includes('qHeaderAction') && !modalPortal.includes('allowContextActions'), 'Q veil must keep Header C and D visible underneath but fully inert.');
expect(
  modalPortal.includes("const requestBack = () => qLayer && typeof node.v2Back === 'function' && node.v2Back() === true;")
    && modalPortal.includes("if (qLayer && event.target.closest('[data-v2-z-dismiss]') && !requestBack()) node.v2Close?.();"),
  'Q Shared dismiss affordance must use contextual back when available and close only the active Q layer when no prior step exists.',
);
expect(modals.includes('S_INTERACTIVE_CONTENT') && modals.includes('S modal is informational only'), 'Shared S owner must reject buttons/forms/editors/pickers.');
expect(modalCss.includes('.modal-sheet.modal--top > .document-tiles:has(+ .entity-details){display:none}'), 'Document S modal must show facts only and never duplicate the source document tile.');
expect(time.includes("variant:'x'") && time.includes("variant: 'x'"), 'Shared time pickers must be X work modals.');

expect(selectors.includes('.ui-select__control{') && selectors.includes('justify-content:center'), 'Closed Shared Select value must be centered.');
expect(selectors.includes('.ui-selector__option{justify-content:center'), 'Open Shared Selector values must be centered.');
expect(info.includes('[data-v2-z-header-content] [data-info-ui]') && info.includes('align-self:flex-end;margin-left:auto'), 'Shared I must stay on the right side of Z/Q Header.');

if (failures.length) {
  failures.forEach((message) => console.error(`global UI contract: ${message}`));
  process.exit(1);
}

console.log('global UI contract check: OK');
