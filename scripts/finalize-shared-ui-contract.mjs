import fs from 'node:fs';

function read(path) {
  return fs.readFileSync(path, 'utf8');
}

function write(path, value) {
  fs.writeFileSync(path, value);
}

function replaceExactly(source, pattern, replacement, label) {
  const matches = [...source.matchAll(pattern)];
  if (matches.length !== 1) {
    throw new Error(`${label}: expected 1 match, found ${matches.length}`);
  }
  return source.replace(pattern, replacement);
}

function replaceExpect(source, message, expression, newMessage) {
  const marker = `, '${message}');`;
  const markerIndex = source.indexOf(marker);
  if (markerIndex < 0) throw new Error(`Missing old assertion: ${message}`);
  if (source.indexOf(marker, markerIndex + 1) >= 0) throw new Error(`Duplicate old assertion: ${message}`);
  const start = source.lastIndexOf('expect(', markerIndex);
  if (start < 0) throw new Error(`Cannot locate expect(): ${message}`);
  const end = markerIndex + marker.length;
  return `${source.slice(0, start)}expect(${expression}, '${newMessage}');${source.slice(end)}`;
}

{
  const path = 'online-booking/account-shell.js';
  const source = read(path);
  const pattern = /a:\s*\{\s*kind:\s*'avatar',\s*label:\s*accountName\(state\),\s*image:\s*accountPhoto\(state\),\s*data:\s*'data-account-profile-settings',\s*settingsTag:\s*true,\s*aria:\s*'Настройки профиля',\s*\},/gs;
  const replacement = `a: {\n      kind: 'avatar',\n      label: accountName(state),\n      image: accountPhoto(state),\n    },`;
  write(path, replaceExactly(source, pattern, replacement, 'final end-user A settings tail'));
}

{
  const path = 'UI_ALPHABET.md';
  let doc = read(path);
  if (!doc.includes('## Полный реестр Shared UI owners')) {
    const owners = [
      'ui/accordion', 'ui/auth', 'ui/booking', 'ui/buttons', 'ui/calendar', 'ui/cards', 'ui/chat', 'ui/colors',
      'ui/cost', 'ui/documents', 'ui/duration', 'ui/forms', 'ui/header', 'ui/info', 'ui/inputs', 'ui/layout',
      'ui/links', 'ui/lists', 'ui/modals', 'ui/note', 'ui/page', 'ui/payment', 'ui/profile', 'ui/receipt',
      'ui/record', 'ui/reference', 'ui/repeated-fields', 'ui/selection', 'ui/selectors', 'ui/settings', 'ui/states',
      'ui/tags', 'ui/time', 'ui/uei', 'ui/utils', 'ui/v2', 'ui/view-navigation', 'ui/workplaces',
    ];
    doc += `\n\n---\n\n## Полный реестр Shared UI owners\n\n\`ui/ui.js\` — единый Shared UI facade.\n\n${owners.map((owner) => `- \`${owner}\``).join('\n')}\n`;
  }
  if (!doc.includes('## Общие interaction-контракты')) {
    doc += [
      '', '', '---', '', '## Общие interaction-контракты', '',
      'Контракт одинаков для профессионального интерфейса и интерфейса конечного пользователя.', '',
      'B показывает только присвоенный текущему контексту заголовок; если заголовок контексту не присвоен, B может оставаться пустым.', '',
      'В APP-состоянии D с иконкой чата всегда означает `включить Messenger`.',
      'В корне Messenger Z1 D меняется на явный control `вернуться в приложение`.',
      'Для обычного диалога D — скрепка/вложения.', '',
      'Информационный control `I` всегда находится в правой зоне `Z Header`.', '',
      'S — только информационное/техническое сообщение; сложные формы и editors принадлежат X/Q.', '',
      'Текущее выбранное значение в закрытом select всегда визуально центрировано.', '',
    ].join('\n');
  }
  write(path, doc);
}

{
  const path = 'scripts/check-ui-v2-architecture.mjs';
  let source = read(path);
  const replacements = [
    [
      'Shared Header owner must own A, B, C and D.',
      `ui.includes('function avatarControl') && ui.includes('avatarControl(a)') && ui.includes("actionControl(c, 'c')") && ui.includes("actionControl(d, 'd')") && ui.includes('v2-header__title')`,
      'Shared Header owner must own photo-only A, B, contextual C and Messenger D.',
    ],
    [
      'Workspace Header A must consume the canonical Header context, normalize it through the single photo/counter A contract, and keep no retired Back owner.',
      `core.includes("const aContext = contextRoot.querySelector('[data-workspace-a-context]')") && core.includes('const aSlot = aContext') && !core.includes('data-workspace-context-action') && !core.includes('function syncWorkspaceBack(')`,
      'Workspace Header A must consume only canonical photo context metadata and keep no settings/back action owner.',
    ],
    [
      'Q must reuse Shared standard-modal geometry, cover active Z, keep global D available and keep Save as the direct Shared bottom action.',
      `modals.includes('v2QFrame(content, { header: title ?') && ui.includes('v2QModalPortalGeometry') && !ui.includes('qHeaderAction') && appearanceQ.includes("actionBlock(button('Сохранить'") && appearanceQ.includes('data-card-q-save') && appearanceQ.includes('controller?.save?.()')`,
      'Q must own its Header/title, overlay Shared H/Y without Header tap-through, and keep completion actions inside Q.',
    ],
    [
      'Photo-less Entity Card must own a warm Shared gradient and must never derive its surface from disabled/system gray.',
      `entityCardCss.includes('--entity-card-surface:var(--entity-card-mid)') && !/(?:linear|radial)-gradient/.test(entityCardCss) && !entityCardCss.includes('var(--v2-disabled') && !entityCardCss.includes('var(--button-secondary)')`,
      'Photo-less Entity Card must use a solid Shared surface and no forbidden gradient or disabled/system gray surface.',
    ],
    [
      'Shared Header A must keep one 48x48 H circle with the canonical yellow outline while section data alone changes its content.',
      `ui.includes('function avatarControl') && css.includes('.v2-header__slot--a .v2-header__control') && css.includes('width:48px') && css.includes('height:48px') && css.includes('border:2px solid var(--v2-yellow)') && css.includes('background:var(--v2-base)')`,
      'Shared Header A must remain one photo-only 48x48 H circle with the canonical yellow outline.',
    ],
    [
      'Shared Header A settings gear must be one lower-right overlay that works for photo or counter and never be tied only to avatar content.',
      `!ui.includes('settingsTag') && !css.includes('.v2-header__settings-tag') && headerUi.includes('data-workspace-v-action')`,
      'Shared Header A must contain no settings gear; section actions belong to independent Shared V.',
    ],
    [
      'Professional Header A must never become empty or render a standalone settings icon: missing A falls back to profile photo/logo and legacy settings intent becomes photo/logo plus gear.',
      `core.includes('function workspaceProfileASlot()') && core.includes('a: workspaceProfileASlot()') && core.includes("const aContext = contextRoot.querySelector('[data-workspace-a-context]')") && !core.includes('settingsTag')`,
      'Professional Header A must fall back to profile photo data and must never own settings state.',
    ],
    [
      'Clickable counter/photo A contexts must expose the same Shared settings gear while inactive A contexts omit it.',
      `people.includes("v: { data: 'data-person-settings'") && timetable.includes("data: 'data-timetable-settings-open'") && recordRuntime.includes("data: 'data-record-owner-settings'") && !people.includes('settingsTag') && !timetable.includes('settingsTag') && !recordRuntime.includes('settingsTag')`,
      'Professional section settings actions must use Shared V independently from photo-only A.',
    ],
    [
      'Shared Header must move C into the chat area when D is absent and keep C left of D when chat is present.',
      `ui.includes("actionControl(c, 'c')") && ui.includes("actionControl(d, 'd')") && !css.includes('.v2-header:not(.has-d).has-c')`,
      'Shared Header must keep one fixed A/B/C/D grid without a narrow or D-missing geometry fork.',
    ],
    [
      'Shared Header context must support a visible but inactive A control without feature-local handling.',
      `headerUi.includes('data-workspace-a-context') && !headerUi.includes('actionDisabled') && core.includes('const aSlot = aContext')`,
      'Shared Header context must expose A only as noninteractive photo metadata.',
    ],
    [
      'Workspace Header must follow the top Z/Q surface while keeping global D=Chat available.',
      `core.includes('activeWorkspaceSurface(surface)') && core.includes("[data-workspace-a-context]") && !core.includes('workspaceHideD') && core.includes("d: sectionAllowed('chat') ? {")`,
      'Workspace Header must follow the active Z surface for photo/context data while keeping Shared D=Chat.',
    ],
    [
      'Shared standard modal-Z must keep Header A-D visible but inactive, while Q is the explicit exception that leaves Header C interactive.',
      `ui.includes('function lockModalHeader(app)') && ui.includes('header.inert = true') && ui.includes('const releaseHeaderLock = technical ? () => {} : lockModalHeader(app)') && !ui.includes('allowContextActions') && !ui.includes('qHeaderAction')`,
      'Shared modal veil must keep Header A-D visible but inert for Q as well as other application modals.',
    ],
  ];
  for (const [message, expression, newMessage] of replacements) {
    source = replaceExpect(source, message, expression, newMessage);
  }
  write(path, source);
}

{
  const path = 'scripts/check-global-ui-contract.mjs';
  let source = read(path);
  if (!source.includes("const v2Css = read('ui/v2/v2.css');")) {
    const anchor = "const shell = read('ui/v2/shell.js');";
    if (!source.includes(anchor)) throw new Error('global UI guard shell anchor missing');
    source = source.replace(anchor, `${anchor}\nconst v2Css = read('ui/v2/v2.css');\nconst style = read('css/style.css');`);
  }
  const replacements = [
    [
      'Shared H owner must keep the application background black.',
      `v2Css.includes('--v2-base:var(--surface-dark)') && style.includes('--surface-dark:#2F3338')`,
      'Shared H owner must use the canonical dark application surface token.',
    ],
    [
      'Shared Header settings badge must follow the explicit settingsTag contract without guessing from disabled state.',
      `!header.includes('settingsTag') && header.includes('function avatarControl')`,
      'Shared Header A must be photo-only and contain no settings badge contract.',
    ],
    [
      'Shared Header must derive C geometry from a real visible action.',
      `header.includes("actionControl(c, 'c')") && header.includes("if (!slot || slot.hidden) return '';")`,
      'Shared Header C must render only from a real visible contextual action.',
    ],
    [
      'Workspace A settings badge must follow the explicit screen context and must not infer settings from labels.',
      `workspaceHeader.includes('data-workspace-a-context') && workspaceHeader.includes('data-workspace-v-action') && !workspaceHeader.includes('settingsTag')`,
      'Workspace Header must keep photo-only A metadata separate from independent V action metadata.',
    ],
    [
      'Q veil must leave both Header C and D interactive.',
      `modalPortal.includes('function lockModalHeader(app)') && modalPortal.includes('header.inert = true') && !modalPortal.includes('qHeaderAction') && !modalPortal.includes('allowContextActions')`,
      'Q veil must keep Header C and D visible underneath but fully inert.',
    ],
  ];
  for (const [message, expression, newMessage] of replacements) {
    source = replaceExpect(source, message, expression, newMessage);
  }
  write(path, source);
}

console.log('Shared UI finalizer applied.');
