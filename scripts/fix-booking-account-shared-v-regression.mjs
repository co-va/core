import fs from 'node:fs';

const path = 'tests/booking-account-ui.test.mjs';
let source = fs.readFileSync(path, 'utf8');

function replaceOnce(from, to, label) {
  const count = source.split(from).length - 1;
  if (count !== 1) throw new Error(`${path}: ${label}: expected one match, found ${count}`);
  source = source.replace(from, to);
}

replaceOnce(
  'assert.match(headerUi, /actionData/);',
  "assert.match(headerUi, /data-workspace-a-context/);\nassert.match(headerUi, /data-workspace-v-action/);\nassert.doesNotMatch(headerUi, /actionData/);",
  'stale actionData assertion',
);

replaceOnce(
`assert.match(v2Css, /\\.v2-app__stage\\{[\\s\\S]*?height:calc\\(var\\(--visual-vh,100dvh\\) - 72px\\)/);
assert.match(v2Css, /\\.v2-front\\{[\\s\\S]*?height:calc\\(var\\(--visual-vh,100dvh\\) - 72px\\)/);
assert.match(v2Css, /\\.v2-z\\{[\\s\\S]*?box-sizing:border-box;[\\s\\S]*?height:calc\\(var\\(--visual-vh,100dvh\\) - 72px\\);[\\s\\S]*?overflow-y:auto/);`,
`assert.match(v2Css, /\\.v2-app\\{[\\s\\S]*?height:var\\(--app-stable-vh,100dvh\\);[\\s\\S]*?display:flex;[\\s\\S]*?flex-direction:column;[\\s\\S]*?overflow:hidden/);
assert.match(v2Css, /\\.v2-y-host\\{[\\s\\S]*?flex:0 0 auto/);
assert.match(v2Css, /\\.v2-app__stage\\{[\\s\\S]*?flex:1 1 auto;[\\s\\S]*?min-height:0;[\\s\\S]*?height:auto/);
assert.match(v2Css, /\\.v2-front\\{[\\s\\S]*?height:100%;[\\s\\S]*?min-height:0/);
assert.match(v2Css, /\\.v2-z\\{[\\s\\S]*?box-sizing:border-box;[\\s\\S]*?height:100%;[\\s\\S]*?overflow:hidden/);
assert.match(v2Css, /\\[data-v2-z-body\\],\\[data-v2-q-body\\]\\{[\\s\\S]*?overflow-y:auto/);`,
  'stale fixed-stage geometry assertions',
);

replaceOnce(
`assert.match(v2Ui, /mountV2ModalPortal\\(host\\)/);
assert.match(v2Ui, /document\\.body\\.appendChild\\(portal\\)/);
assert.match(v2Ui, /v2ModalPortalGeometry\\(host\\.getBoundingClientRect\\(\\), currentVisualViewport\\(\\)\\)/);`,
`assert.match(v2Ui, /mountV2ModalPortal\\(host, app\\)/);
assert.match(v2Ui, /document\\.body\\.appendChild\\(portal\\)/);
assert.match(v2Ui, /const viewport = currentVisualViewport\\(\\)/);
assert.match(v2Ui, /v2ModalPortalGeometry\\(host\\.getBoundingClientRect\\(\\), viewport\\)/);
assert.match(v2Ui, /v2QModalPortalGeometry\\(appRect,[\\s\\S]*?headerBottom/);`,
  'stale modal portal signature and geometry assertions',
);

fs.writeFileSync(path, source);
console.log('booking account Shared V/Y/Q regressions aligned');
