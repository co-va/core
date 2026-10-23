import fs from 'node:fs';

const path = 'tests/modal-bottom-geometry.test.mjs';
let source = fs.readFileSync(path, 'utf8');

function replaceOnce(from, to, label) {
  const count = source.split(from).length - 1;
  if (count !== 1) throw new Error(`${path}: ${label}: expected one match, found ${count}`);
  source = source.replace(from, to);
}

replaceOnce(
`const restored=v2ModalPortalGeometry(
  {...baseHost,height:436,bottom:508},
  fullViewport,
);
assert.equal(restored.bottom,844);
assert.equal(restored.height,772);`,
`const restored=v2ModalPortalGeometry(
  {...baseHost,height:436,bottom:508},
  fullViewport,
);
assert.equal(restored.bottom,508);
assert.equal(restored.height,436);`,
  'generic X portal stale-host geometry',
);

replaceOnce(
`assert.match(v2,/lockModalHeader\\(app, \\{ allowContextActions: true \\}\\)/);
assert.match(v2,/v2QModalPortalGeometry/);
assert.match(v2,/mountV2ModalPortal\\(host\\)/);`,
`assert.match(v2,/lockModalHeader\\(app\\)/);
assert.doesNotMatch(v2,/allowContextActions|qHeaderAction/);
assert.match(v2,/v2QModalPortalGeometry/);
assert.match(v2,/mountV2ModalPortal\\(host, app\\)/);
assert.match(v2,/geometry = \\{ left: appRect\\.left, top: appRect\\.top, width: appRect\\.width, height: appRect\\.height/);`,
  'Q portal/header lock contract',
);

fs.writeFileSync(path, source);
console.log('modal bottom Shared geometry regression aligned');
