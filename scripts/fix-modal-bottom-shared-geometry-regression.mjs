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
`const shiftedViewport=v2ModalPortalGeometry(
  {left:28,top:82,right:390,width:362},
  {offsetLeft:0,offsetTop:12,width:390,height:832},
);`,
`const shiftedViewport=v2ModalPortalGeometry(
  {left:28,top:82,right:390,width:362,height:762,bottom:844},
  {offsetLeft:0,offsetTop:12,width:390,height:832},
);`,
  'complete shifted viewport DOMRect fixture',
);

replaceOnce(
`const qExistingZ=v2QModalPortalGeometry(baseHost,fullViewport,{hostIsZ:true});
assert.deepEqual(qExistingZ,{left:16,top:72,width:374,height:772,bottom:844});`,
`const qExplicitHeader=v2QModalPortalGeometry(
  {left:0,top:0,right:390,width:390,height:844,bottom:844},
  fullViewport,
  {headerBottom:72},
);
assert.deepEqual(qExplicitHeader,{left:16,top:72,width:374,height:772,bottom:844});`,
  'retired hostIsZ Q geometry case',
);

replaceOnce(
`const qKeyboard=v2QModalPortalGeometry(
  {left:0,top:0,right:390,width:390,height:844,bottom:844},
  {offsetLeft:0,offsetTop:0,width:390,height:508},
);
assert.deepEqual(qKeyboard,{left:16,top:72,width:374,height:436,bottom:508});`,
`const qKeyboardStable=v2QModalPortalGeometry(
  {left:0,top:0,right:390,width:390,height:844,bottom:844},
  fullViewport,
  {headerBottom:72},
);
assert.deepEqual(qKeyboardStable,{left:16,top:72,width:374,height:772,bottom:844});`,
  'Q keyboard must use stable app viewport',
);

replaceOnce(
`const qAlreadyBelowHeader=v2QModalPortalGeometry(
  {left:0,top:72,right:390,width:390,height:772,bottom:844},
  fullViewport,
);
assert.deepEqual(qAlreadyBelowHeader,{left:16,top:72,width:374,height:772,bottom:844});
`,
``,
  'retired pre-offset Z host Q case',
);

replaceOnce(
`assert.match(v2,/\\.v2-header__slot--c \\.v2-header__control/);
assert.match(v2,/\\.v2-header__slot--d \\.v2-header__control/);`,
`assert.doesNotMatch(v2,/v2-header__slot--[cd]/);
assert.match(v2,/header\\.inert = true/);`,
  'retired Q C/D portal exceptions',
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
