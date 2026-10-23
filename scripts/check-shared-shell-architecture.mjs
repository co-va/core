import fs from 'node:fs';

// Regression guard for the canonical Shared H/Header/Y/Z/V/Q architecture.
function filesUnder(directory, extensions = new Set(['.js', '.css'])) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) return filesUnder(path, extensions);
    const extension = entry.name.slice(entry.name.lastIndexOf('.'));
    return entry.isFile() && extensions.has(extension) ? [path] : [];
  });
}

const runtimeFiles = [
  'core.js',
  'css/style.css',
  ...filesUnder('ui'),
  ...filesUnder('core/profile'),
  ...filesUnder('core/people'),
  ...filesUnder('core/finance'),
  ...filesUnder('core/service'),
  ...filesUnder('journal'),
  ...filesUnder('settings'),
  ...filesUnder('timetable'),
  ...filesUnder('online-booking'),
];
const failures = [];
const fail = (file, message) => failures.push(`${file}: ${message}`);

for (const file of runtimeFiles) {
  const source = fs.readFileSync(file, 'utf8');
  if (/settingsTag\b|data-workspace-context-action|v2-header__settings-tag/.test(source)) {
    fail(file, 'A must be photo-only; settingsTag/A settings handlers are forbidden.');
  }
  if (/(?:linear|radial)-gradient\s*\(|<\s*(?:linear|radial)Gradient\b/i.test(source)) {
    fail(file, 'Shared APP runtime gradients are forbidden.');
  }
  if (/#EB4C42\b|#FDD2D2\b/i.test(source)) {
    fail(file, 'Shared danger must be #FF1111 with white text.');
  }
}

const shell = fs.readFileSync('ui/v2/shell.js', 'utf8');
const header = fs.readFileSync('ui/v2/header.js', 'utf8');
const vOwner = fs.readFileSync('ui/v2/v.js', 'utf8');
const yOwner = fs.readFileSync('ui/v2/y.js', 'utf8');
const day = fs.readFileSync('journal/день.js', 'utf8');
const css = fs.readFileSync('ui/v2/v2.css', 'utf8');
const modalPortal = fs.readFileSync('ui/v2/modal-portal.js', 'utf8');
const alphabet = fs.readFileSync('UI_ALPHABET.md', 'utf8');

if (!(shell.includes('data-v2-y-host') && shell.indexOf('data-v2-y-host') < shell.indexOf('v2-app__stage'))) {
  fail('ui/v2/shell.js', 'Shared Y host must live between Header and Z stage.');
}
if (/vControl\s*\(|settingsTag/.test(header)) fail('ui/v2/header.js', 'Header must not create or own V/settings state.');
if (!vOwner.includes('export function v2V')) fail('ui/v2/v.js', 'V must have an independent Shared owner.');
if (!yOwner.includes('export function setV2Y') || !yOwner.includes('export function clearV2Y')) fail('ui/v2/y.js', 'Y must have an independent Shared owner.');
if (/data-journal-y-host|data-ui-y=|data-journal-y\b/.test(day)) fail('journal/день.js', 'Journal must not own a local Y host.');
if (!/\.v2-app\{[\s\S]*?height:var\(--app-stable-vh,100dvh\)/.test(css)) fail('ui/v2/v2.css', 'H must use the stable viewport height.');
if (!/\.v2-app__stage\{[\s\S]*?flex:1 1 auto;min-height:0/.test(css)) fail('ui/v2/v2.css', 'Z stage must consume remaining H height after Header/Y.');
if (/allowContextActions\s*:\s*true|qHeaderAction/.test(modalPortal)) fail('ui/v2/modal-portal.js', 'Q must not allow Header C/D tap-through.');
for (const phrase of ['A = только photo', 'A ≠ settings', 'A ≠ V', 'Y = универсальная Shared H-zone', 'Note ≠ Y', 'Q перекрывает Y']) {
  if (!alphabet.includes(phrase)) fail('UI_ALPHABET.md', `Missing Shared contract: ${phrase}`);
}

if (failures.length) {
  console.error('Shared shell architecture violations:\n' + failures.map((item) => `- ${item}`).join('\n'));
  process.exit(1);
}
console.log('Shared shell architecture check passed.');
