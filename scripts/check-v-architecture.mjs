import fs from 'node:fs';

const shell = fs.readFileSync('ui/v2/shell.js', 'utf8');
const vHost = fs.readFileSync('ui/v2/v-host.js', 'utf8');
const vCss = fs.readFileSync('ui/v2/v.css', 'utf8');
const header = fs.readFileSync('ui/header/index.js', 'utf8');
const modalPortal = fs.readFileSync('ui/v2/modal-portal.js', 'utf8');

const failures = [];
const expect = (condition, message) => { if (!condition) failures.push(message); };

expect(
  shell.includes('<div class="v2-edge-swipe-zone" data-v2-edge-swipe aria-hidden="true"></div>\n    </div>\n    <div class="v2-v-host" data-v2-v-host'),
  'V host must remain a direct H/app child outside the Shared stage/Z tree.',
);
expect(
  vHost.includes("app?.querySelector?.(':scope > [data-v2-v-host]')"),
  'Shared V owner must address only the direct H/app V host.',
);
expect(
  vHost.includes("if (!app?.classList?.contains('has-v2-q-modal')) return null;")
    && vHost.includes("document.querySelectorAll('[data-v2-layer][data-v2-q=\"true\"]')"),
  'Shared V owner must explicitly resolve the active Q context.',
);
expect(
  vHost.includes('const qSurface = activeQSurface(app);\n  if (qSurface) return qSurface;'),
  'Active Q must own V context before any Z fallback; Q without V must not inherit Z V.',
);
expect(
  vHost.includes("window.addEventListener('book:v2-context-changed', schedule);")
    && vHost.includes("window.removeEventListener('book:v2-context-changed', schedule);"),
  'Shared V owner must resync when Q opens or closes.',
);
expect(
  vHost.includes('externalObserver.observe(externalSurface')
    && vHost.includes("attributeFilter: ['hidden', 'disabled', 'aria-label']"),
  'Shared V owner must observe the active external Q source without moving V into Q.',
);
expect(
  !vHost.includes('data-v2-x-role') && !vHost.includes('data-v2-layer-kind="top"'),
  'X/S must never become V context owners; they may not replace Q/Z as the source.',
);

const hostRule = vCss.match(/\.v2-v-host\{[\s\S]*?z-index:(\d+);[\s\S]*?\}/);
expect(Boolean(hostRule), 'Shared V host must own an explicit H-level z-index.');
expect(Number(hostRule?.[1] || 0) > 1201, 'Shared V host must stay physically above the standard Q portal while remaining in H.');
expect(
  vCss.includes('.v2-app.has-v2-modal:not(.has-v2-q-modal) .v2-v'),
  'Q must not hide Shared V; non-Q modal policy must remain explicit.',
);
expect(
  !vCss.includes('.v2-app.has-v2-modal .v2-v,'),
  'The old blanket modal rule that hides V on Q must not return.',
);
expect(
  header.includes('A is photo metadata only. V is the independent floating section action.')
    && header.includes('data-workspace-a-context')
    && header.includes('data-workspace-v-action'),
  'A and V ownership must remain separate: A is photo metadata, V is its own action context.',
);
expect(
  modalPortal.includes("app?.classList.add('has-v2-q-modal');")
    && modalPortal.includes("window.dispatchEvent(new CustomEvent('book:v2-context-changed'));")
    && modalPortal.includes("app?.classList.remove('has-v2-q-modal');"),
  'Q lifecycle must continue publishing context changes to the independent Shared V owner.',
);
expect(
  modalPortal.includes("const vHost = qLayer ? event.target.closest?.('[data-v2-v-host]') : null;")
    && modalPortal.includes('if (vHost && app && vHost.parentElement === app) return true;'),
  'Q veil must treat the direct H/app V host as owned interaction; X/S must not receive this exemption.',
);

if (failures.length) {
  console.error('V architecture check failed:');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log('V architecture check passed.');
