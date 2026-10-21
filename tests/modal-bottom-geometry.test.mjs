import assert from 'node:assert/strict';
import fs from 'node:fs';
import { currentVisualViewport, v2ModalPortalGeometry, v2QModalPortalGeometry } from '../ui/v2/geometry.js';

const baseHost={left:16,top:72,right:390,width:374,height:772,bottom:844};
const fullViewport={offsetLeft:0,offsetTop:0,width:390,height:844};

const full=v2ModalPortalGeometry(baseHost,fullViewport);
assert.equal(full.left,16);
assert.equal(full.top,72);
assert.equal(full.width,374);
assert.equal(full.bottom,844);
assert.equal(full.height,772);

const keyboard=v2ModalPortalGeometry(baseHost,{offsetLeft:0,offsetTop:0,width:390,height:508});
assert.equal(keyboard.bottom,508);
assert.equal(keyboard.height,436);

const restored=v2ModalPortalGeometry(
  {...baseHost,height:436,bottom:508},
  fullViewport,
);
assert.equal(restored.bottom,844);
assert.equal(restored.height,772);

const shiftedViewport=v2ModalPortalGeometry(
  {left:28,top:82,right:390,width:362},
  {offsetLeft:0,offsetTop:12,width:390,height:832},
);
assert.equal(shiftedViewport.bottom,844);
assert.equal(shiftedViewport.left,28);

const qFallback=v2QModalPortalGeometry(
  {left:0,top:0,right:390,width:390,height:844,bottom:844},
  fullViewport,
);
assert.deepEqual(qFallback,{left:16,top:72,width:374,height:772,bottom:844});

const qExistingZ=v2QModalPortalGeometry(baseHost,fullViewport,{hostIsZ:true});
assert.deepEqual(qExistingZ,{left:16,top:72,width:374,height:772,bottom:844});

const qKeyboard=v2QModalPortalGeometry(
  {left:0,top:0,right:390,width:390,height:844,bottom:844},
  {offsetLeft:0,offsetTop:0,width:390,height:508},
);
assert.deepEqual(qKeyboard,{left:16,top:72,width:374,height:436,bottom:508});

const qAlreadyBelowHeader=v2QModalPortalGeometry(
  {left:0,top:72,right:390,width:390,height:772,bottom:844},
  fullViewport,
);
assert.deepEqual(qAlreadyBelowHeader,{left:16,top:72,width:374,height:772,bottom:844});

const originalWindow=globalThis.window;
const originalDocument=globalThis.document;
const originalGetComputedStyle=globalThis.getComputedStyle;
globalThis.window={
  visualViewport:{offsetLeft:0,offsetTop:0,width:390,height:508},
  innerWidth:390,
  innerHeight:844,
};
globalThis.document={documentElement:{}};
globalThis.getComputedStyle=()=>({
  getPropertyValue:(name)=>name==='--app-stable-vh'?'844px':name==='--app-stable-vw'?'390px':'',
});
const keyboardViewport=currentVisualViewport();
assert.equal(keyboardViewport.width,390);
assert.equal(keyboardViewport.height,508);
if (originalWindow===undefined) delete globalThis.window; else globalThis.window=originalWindow;
if (originalDocument===undefined) delete globalThis.document; else globalThis.document=originalDocument;
if (originalGetComputedStyle===undefined) delete globalThis.getComputedStyle; else globalThis.getComputedStyle=originalGetComputedStyle;

const core=fs.readFileSync(new URL('../core.js',import.meta.url),'utf8');
const selectors=fs.readFileSync(new URL('../ui/selectors/index.js',import.meta.url),'utf8');
const inputs=fs.readFileSync(new URL('../ui/inputs/index.js',import.meta.url),'utf8');
const sharedProfile=fs.readFileSync(new URL('../ui/profile/index.js',import.meta.url),'utf8');
const time=fs.readFileSync(new URL('../ui/time/index.js',import.meta.url),'utf8');
const dayControl=fs.readFileSync(new URL('../ui/workplaces/day-control.js',import.meta.url),'utf8');
const v2=['modal-portal.js','geometry.js'].map((file)=>fs.readFileSync(new URL(`../ui/v2/${file}`,import.meta.url),'utf8')).join('\n');
const css=fs.readFileSync(new URL('../ui/v2/v2.css',import.meta.url),'utf8');
const modals=fs.readFileSync(new URL('../ui/modals/index.js',import.meta.url),'utf8');
const modalCss=fs.readFileSync(new URL('../ui/modals/modal.css',import.meta.url),'utf8');
const recordCreation=fs.readFileSync(new URL('../ui/record/creation-flow.js',import.meta.url),'utf8');

assert.match(core,/if \(target\.closest\('\[data-v2-layer\]'\)\) return;/);
assert.match(selectors,/mountModal\(trigger, modal\(content, \{ variant: 'x', title: 'Выбор', xRole: 'picker' \}\)\)/);
assert.match(inputs,/searchable:\s*true/);
assert.match(sharedProfile,/xRole:\s*'action'/);
assert.match(sharedProfile,/xRole:\s*'editor'/);
assert.match(time,/xRole:'picker'/);
assert.match(time,/xRole:\s*'editor'/);
assert.match(dayControl,/xRole:\s*'editor'/);
assert.match(v2,/document\.body\.appendChild\(portal\)/);
assert.match(v2,/visualViewport\?\.addEventListener\('resize', settle\)/);
assert.match(v2,/document\.addEventListener\('focusout', settle, true\)/);
assert.match(v2,/function applicationLayerKey\(layer\)/);
assert.match(v2,/function xLayerRole\(layer\)/);
assert.match(v2,/function canOpenApplicationModal\(node\)/);
assert.match(v2,/function applyXTransitionPolicy\(node\)/);
assert.match(v2,/xLayerRole\(parent\) === 'action'/);
assert.match(v2,/!canOpenApplicationModal\(node\)/);
assert.match(v2,/!isTopApplicationLayer\(\)/);
assert.match(v2,/modalHeaderLocks/);
assert.doesNotMatch(v2,/closeApplicationLayer\(current\)/);
assert.match(v2,/document\.addEventListener\('click', handleOutsideClick, true\)/);
assert.match(v2,/event\.stopImmediatePropagation\(\)/);
assert.match(v2,/\.v2-header__slot--c \.v2-header__control/);
assert.match(v2,/\.v2-header__slot--d \.v2-header__control/);
assert.match(v2,/lockModalHeader\(app, \{ allowContextActions: true \}\)/);
assert.match(v2,/v2QModalPortalGeometry/);
assert.match(v2,/mountV2ModalPortal\(host\)/);
assert.match(v2,/setQLayer\?\.\(qLayer\)/);
assert.match(css,/\.v2-layer-portal--viewport\{position:fixed/);
assert.match(modals,/const X_ROLES = new Set\(\['action', 'editor', 'picker'\]\)/);
assert.match(modals,/data-v2-x-role/);
assert.match(modals,/openNotice\(\{ title = 'Внимание', message = '', surface = 'app'/);
assert.match(modals,/modal\(content, \{ variant: 's', surface, title \}\)/);
assert.doesNotMatch(modals,/data-notice-close|action = 'ОК'/);
assert.match(modals,/variant === 'x'\) return 'bottom'/);
assert.match(modals,/variant === 's'\) return 'top'/);
assert.match(modalCss,/modal--bottom\.modal--form-sheet/);
assert.match(recordCreation,/variant:\s*'q'/);
assert.doesNotMatch(recordCreation,/mountRecordZ|record-creation-q\s*\{/);

console.log('modal bottom geometry tests passed');
