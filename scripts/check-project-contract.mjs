import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const failures = [];
const skip = new Set(['.git', 'node_modules']);
const runtimeRoots = new Set(['core', 'settings', 'journal', 'timetable', 'online-booking', 'chat', 'invite', 'ui', 'admin', 'server']);

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (skip.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

const rel = (file) => path.relative(root, file).replaceAll(path.sep, '/');
const standaloneCss = new Set(['admin/admin.css', 'invite/invite.css']);
const allFiles = walk(root);

for (const file of allFiles) {
  const r = rel(file);
  if (r.endsWith('.css') && !r.startsWith('ui/') && r !== 'css/style.css' && !standaloneCss.has(r)) {
    failures.push(`${r}: feature CSS outside Shared UI is forbidden`);
  }
}

const mainHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
for (const href of [...mainHtml.matchAll(/<link[^>]+rel=["']stylesheet["'][^>]+href=["']([^"']+)["']/g)].map((match) => match[1])) {
  if (href !== 'css/style.css' && !href.startsWith('ui/')) {
    failures.push(`index.html: main workspace may load only foundation and Shared UI CSS, found ${href}`);
  }
}

for (const file of allFiles) {
  const r = rel(file);
  const top = r.split('/')[0];
  if (!runtimeRoots.has(top)) continue;
  if (r.startsWith('server/prisma/migrations/') || r.startsWith('server/scripts/')) continue;
  if (!/\.(js|mjs|ts|css|html)$/.test(r)) continue;

  const base = path.basename(r).toLowerCase();
  if (/(?:^|[-_.])(legacy|bridge|compat|migration)(?:[-_.]|$)/.test(base)) {
    failures.push(`${r}: runtime filename contains a forbidden transition marker`);
  }

  const source = fs.readFileSync(file, 'utf8');
  if (/legacy|compat(?:ibility)?|\bmigration\b|\bbridge\b/i.test(source)
    || /migrationVerifiedAt|verifyMigration|\/migrate(?:\/|['"`])|readLegacy|legacyFormat/.test(source)) {
    failures.push(`${r}: runtime transition bridge/terminology is forbidden`);
  }

  if (/\b(?:business|operational|documents|auxiliary)\??\.verified\b|payload\??\.verified\b/.test(source)) {
    failures.push(`${r}: canonical state owner must not depend on retired verification flags`);
  }

  if (/BusinessStateMeta|businessStateMeta/.test(source)) {
    failures.push(`${r}: retired BusinessStateMeta storage is forbidden`);
  }

  if (/variant\s*:\s*['"](?:large|medium|compact|quick|standard|bottom|top)['"]/.test(source)) {
    failures.push(`${r}: deprecated modal variant is forbidden; use q/x/s/technical only`);
  }
  if (r !== 'ui/cards/folder-card.js' && /variant\s*:\s*['"]list['"]/.test(source)) {
    failures.push(`${r}: deprecated list alias is forbidden outside FolderCard`);
  }

  if (!r.startsWith('ui/') && (
    /addEventListener\(\s*['"](?:pointerdown|pointermove|pointerup|pointercancel|touchstart|touchmove|touchend)['"]/.test(source)
    || /\b(?:setPointerCapture|releasePointerCapture)\s*\(/.test(source)
    || (/\.css$/.test(r) && /touch-action\s*:/.test(source))
  )) {
    failures.push(`${r}: gesture ownership is forbidden outside Shared UI`);
  }
}

const buildPagesSource = fs.readFileSync(path.join(root, 'scripts/build-pages.mjs'), 'utf8');
const pwaRendererSource = fs.readFileSync(path.join(root, 'scripts/render-pwa-icons.mjs'), 'utf8');
const generatedHtmlAssets = new Map([
  ['/icon-192.png', buildPagesSource.includes('renderPwaIcons(out)') && pwaRendererSource.includes("output: 'icon-192.png'")],
]);

const htmlFiles = walk(root).filter((file) => file.endsWith('.html'));
const referencedCss = new Set();
for (const file of htmlFiles) {
  const source = fs.readFileSync(file, 'utf8');
  for (const match of source.matchAll(/<(?:link|script)\b[^>]*(?:href|src)=["']([^"']+)["'][^>]*>/gi)) {
    const reference = String(match[1] || '').trim();
    if (!reference || /^(?:https?:|data:|#)/i.test(reference) || reference === '/') continue;
    const clean = reference.split(/[?#]/)[0];
    const target = clean.startsWith('/')
      ? path.join(root, clean.replace(/^\/+/, ''))
      : path.resolve(path.dirname(file), clean);
    if (!fs.existsSync(target)) {
      if (generatedHtmlAssets.get(clean) === true) continue;
      failures.push(`${rel(file)}: HTML local asset reference is missing: ${reference}`);
    } else if (clean.endsWith('.css')) {
      referencedCss.add(rel(target));
    }
  }
}

for (const file of allFiles) {
  const r = rel(file);
  if (!r.endsWith('.css')) continue;
  if (!referencedCss.has(r)) {
    failures.push(`${r}: orphan CSS file is forbidden; every stylesheet must belong to an explicit HTML entry`);
  }
}

if (!fs.existsSync(path.join(root, 'PROJECT_STATE.md'))) failures.push('PROJECT_STATE.md is required');
if (!fs.existsSync(path.join(root, 'UI_ALPHABET.md'))) failures.push('UI_ALPHABET.md is required');

if (fs.existsSync(path.join(root, 'UI_ALPHABET.md'))) {
  const alphabet = fs.readFileSync(path.join(root, 'UI_ALPHABET.md'), 'utf8');
  const uiRoot = path.join(root, 'ui');
  for (const entry of fs.readdirSync(uiRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const owner = `ui/${entry.name}`;
    if (!alphabet.includes(`\`${owner}\``)) failures.push(`${owner}: UI owner directory is missing from UI_ALPHABET.md`);
  }
  if (!alphabet.includes('`ui/ui.js`')) failures.push('ui/ui.js: UI facade is missing from UI_ALPHABET.md');
}

const coreSource = fs.readFileSync(path.join(root, 'core.js'), 'utf8');
const businessStartupSource = fs.readFileSync(path.join(root, 'core/runtime/business-state.js'), 'utf8');
const journalBootstrapSource = fs.readFileSync(path.join(root, 'core/runtime/journal-bootstrap.js'), 'utf8');
const auxiliaryStartupSource = fs.readFileSync(path.join(root, 'core/runtime/auxiliary-state.js'), 'utf8');
const documentArchiveSource = fs.readFileSync(path.join(root, 'core/runtime/tenant-document-archive.js'), 'utf8');
const depositStartupSource = fs.readFileSync(path.join(root, 'core/loyalty/deposit/data.js'), 'utf8');
const userEntrySource = fs.readFileSync(path.join(root, 'online-booking/user-entry.js'), 'utf8');
const bookingAccessSource = fs.readFileSync(path.join(root, 'online-booking/access.js'), 'utf8');
const recordServiceSource = fs.readFileSync(path.join(root, 'core/record/service.js'), 'utf8');
const paymentSource = fs.readFileSync(path.join(root, 'core/payment/record-payment.js'), 'utf8');
const businessControllerSource = fs.readFileSync(path.join(root, 'server/src/business-state/business-state.controller.ts'), 'utf8');
const professionalAuthGuardSource = fs.readFileSync(path.join(root, 'server/src/auth/jwt-auth.guard.ts'), 'utf8');
const accountAuthGuardSource = fs.readFileSync(path.join(root, 'server/src/online-booking/account.guard.ts'), 'utf8');
const userHtml = fs.readFileSync(path.join(root, 'user.html'), 'utf8');

const authenticatedStart = coreSource.slice(
  coreSource.indexOf('async function renderAuthenticated'),
  coreSource.indexOf('function renderPasswordResetRequest'),
);
if (authenticatedStart.includes('loadTenantDocumentArchive()')
  || authenticatedStart.includes('loadAuxiliaryState()')
  || authenticatedStart.includes('scheduleRknGuideSync()')) {
  failures.push('core.js: first Journal render must not start documents, auxiliary state, or RKN document sync');
}
if (!authenticatedStart.includes('loadFinanceState()')) {
  failures.push('core.js: Journal startup must load finance without loading auxiliary state');
}
if (!coreSource.includes('async function ensureWorkspaceState(section)')
  || !coreSource.includes('await loadAuxiliaryState()')
  || !coreSource.includes('await loadTenantDocumentArchive()')) {
  failures.push('core.js: non-Journal data must load on demand from the existing workspace render path');
}
if (!/export\s+(?:async\s+)?function\s+loadFinanceState/.test(auxiliaryStartupSource)
  || !/export\s+(?:async\s+)?function\s+loadAuxiliaryState/.test(auxiliaryStartupSource)) {
  failures.push('core/runtime/auxiliary-state.js: finance and auxiliary state must remain separately loadable');
}
if (businessStartupSource.includes('loadAllDeposits(') || auxiliaryStartupSource.includes('loadAllDeposits(')) {
  failures.push('startup runtime: deposits must not load during authenticated startup');
}
if (!businessStartupSource.includes("consumeJournalBootstrap('journal')")
  || !journalBootstrapSource.includes("apiRequest('/business-state/journal-bootstrap')")
  || businessStartupSource.includes("apiRequest('/events')")
  || businessStartupSource.includes("apiRequest('/notes')")) {
  failures.push('core/runtime/business-state.js: Journal startup must consume the single canonical bootstrap request');
}
if (!businessControllerSource.includes("@Get('journal-bootstrap')")
  || !businessControllerSource.includes('private async journalBundle')
  || !businessControllerSource.includes('this.businessState.get(current.tenantId)')
  || !businessControllerSource.includes('this.events.list(current.tenantId)')
  || !businessControllerSource.includes('this.notes.listProfile(current.tenantId, current.platformAccountId)')
  || !businessControllerSource.includes('this.journalBundle(auth)')) {
  failures.push('server business-state controller: Journal bootstrap must compose canonical BusinessState, Event and Note owners');
}
if (!documentArchiveSource.includes('return initialArchiveLoad;')) {
  failures.push('tenant document archive: on-demand load must be awaitable by the section that requested it');
}

if (!/let\s+allDepositsRequest\s*=\s*null/.test(depositStartupSource)
  || !/if\s*\(\s*!allDepositsRequest\s*\)/.test(depositStartupSource)
  || !/return\s+allDepositsRequest/.test(depositStartupSource)) {
  failures.push('core/loyalty/deposit/data.js: duplicate deposit reads must share one in-flight request');
}

if (!userHtml.includes('data-startup-loading') || !userHtml.includes('v2-sticker-screen')) {
  failures.push('user.html: public Booking entry must render Shared loading state before async route resolution');
}
if (mainHtml.includes('data-startup-loading') || mainHtml.includes('>Загрузка…<')) {
  failures.push('index.html: application startup must not render a blocking loading card');
}

if (userEntrySource.includes('accountBookingRoute(')
  || userEntrySource.includes('publicBookingPath(')
  || userEntrySource.includes('bookingRoute(')
  || userEntrySource.includes('renderAccessRoute(')
  || userEntrySource.includes('startAccountRuntime(')) {
  failures.push('online-booking/user-entry.js: App entry must not own public Booking routing or Account runtime');
}
if (!userEntrySource.includes('await renderGlobalClientRoot();')) {
  failures.push('online-booking/user-entry.js: App entry must finish in the end-user application root');
}
if (!userEntrySource.includes("document.createElement('main')")
  || !userEntrySource.includes('await renderGlobalClient(nextRoot, initial)')
  || !userEntrySource.includes('app.replaceChildren(nextRoot)')
  || userEntrySource.includes('data-startup-loading')) {
  failures.push('online-booking/user-entry.js: end-user Journal must hydrate off-screen and replace the app root atomically without a blocking loading card');
}

if (!bookingAccessSource.includes("action.textContent = 'Записываем…'")
  || !bookingAccessSource.includes("action.dataset.bookingBusy = 'true'")
  || !bookingAccessSource.includes("action.setAttribute('aria-busy', 'true')")) {
  failures.push('online-booking/access.js: booking confirmation must react immediately and reject duplicate submission while the request is pending');
}

if (!recordServiceSource.includes("apiRequest('/business-state/records')")
  || recordServiceSource.includes("const response = await apiRequest('/business-state');")) {
  failures.push('core/record/service.js: record refresh must use the focused records endpoint, not the full business state');
}
if (!businessControllerSource.includes("@Get('records')")) {
  failures.push('server business-state controller: focused records endpoint is required');
}

if (!paymentSource.includes('paymentEntryOpeningRecords')
  || !paymentSource.includes("emptyState('Оплата', 'Загрузка…')")
  || !paymentSource.includes("submit.textContent = 'Проводим…'")) {
  failures.push('core/payment/record-payment.js: payment entry must respond immediately and prevent duplicate opening/submission');
}

const professionalGuardPrefix = professionalAuthGuardSource.slice(0, professionalAuthGuardSource.indexOf('if (chatThread || messengerThread)'));
const accountGuardPrefix = accountAuthGuardSource.slice(0, accountAuthGuardSource.indexOf('if (chatThread || messengerThread)'));
if (professionalGuardPrefix.includes('UPDATE "CommunicationMessage"')) {
  failures.push('professional auth guard: unrelated API requests must not write CommunicationMessage delivery state');
}
if (accountGuardPrefix.includes('UPDATE "CommunicationMessage"')) {
  failures.push('account auth guard: unrelated API requests must not write CommunicationMessage delivery state');
}

const branch = String(
  process.env.GITHUB_EVENT_NAME === 'pull_request'
    ? process.env.GITHUB_BASE_REF || ''
    : process.env.GITHUB_REF_NAME || '',
);
if (branch && branch !== 'main' && branch !== 'staging') failures.push(`branch ${branch}: only main/staging are allowed`);

if (failures.length) {
  console.error('project contract check: FAILED');
  failures.forEach((item) => console.error(`- ${item}`));
  process.exit(1);
}
console.log('project contract check: OK');