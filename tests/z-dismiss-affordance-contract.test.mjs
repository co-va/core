import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createServer } from 'node:http';
import { spawn, spawnSync } from 'node:child_process';

const affordance = fs.readFileSync('ui/v2/z-affordance.js', 'utf8');
const stack = fs.readFileSync('ui/v2/z-stack.js', 'utf8');
const workspaceNavigation = fs.readFileSync('ui/v2/workspace-navigation.js', 'utf8');
const shell = fs.readFileSync('ui/v2/shell.js', 'utf8');
const vOwner = fs.readFileSync('ui/v2/v.js', 'utf8');
const vCss = fs.readFileSync('ui/v2/v.css', 'utf8');
const noteOwner = fs.readFileSync('ui/note/index.js', 'utf8');
const noteCss = fs.readFileSync('ui/note/note.css', 'utf8');
const surfaceHeaderCss = fs.readFileSync('ui/v2/surface-header.css', 'utf8');
const accountShell = fs.readFileSync('online-booking/account-shell.js', 'utf8');

assert.match(
  affordance,
  /'margin:8px 0 4px 18px'/,
  'Shared Z/Q dismiss affordance must stay compact at the top of the stable Header without creating an empty header band.',
);
assert.match(affordance, /'color:#111'/, 'Shared Z/Q dismiss affordance must keep full readable contrast.');
assert.match(
  affordance,
  /filter:drop-shadow\(0 2px 3px rgba\(0,0,0,\.45\)\)/,
  'Shared Z/Q dismiss affordance must retain its visible shadow.',
);
assert.match(
  shell,
  /<main class="v2-z" \$\{zData\} data-v2-dismissible="false">[\s\S]*?\$\{v2ZFrame\(body\)\}/,
  'Root Z must expose the Shared affordance while keeping root dismiss semantics owned by workspace navigation.',
);
assert.match(
  shell,
  /data-v2-front style="width:calc\(100% \+ 24px\);height:calc\(100% \+ 24px\)"/,
  'Z front must continue beyond the visible viewport instead of ending inside H.',
);
assert.match(
  stack,
  /if \(dismiss\) dismiss\.hidden = blocked \|\| \(surface !== base && surface\.dataset\.v2Dismissible === 'false'\);/,
  'Root Z affordance must return after nested Z closes while non-dismissible nested mode roots stay hidden.',
);
assert.match(
  workspaceNavigation,
  /const dismissBaseZ = \(\) => \{[\s\S]*?setOpen\(true\);[\s\S]*?bindV2ZDismissAffordance\(z, \{[\s\S]*?onDismiss: dismissBaseZ/,
  'Root Z affordance must use the existing workspace-navigation path to FE.',
);
assert.match(
  vOwner,
  /id="v2-v-glass"[\s\S]*?id="v2-v-glow"[\s\S]*?id="v2-v-edge"/,
  'Standalone Shared V must use the actual pre-#732 glass/glow visual.',
);
assert.doesNotMatch(vOwner, /<circle\b/, 'The post-#732 black-triangle/yellow-dot V regression must not return.');
assert.match(vCss, /drop-shadow\(0 2px 7px rgba\(255,255,0,\.16\)\)/, 'Pre-#732 V glow must be restored.');
assert.match(vCss, /html\.keyboard-open \.v2-v/, 'Standalone V must retain the old keyboard visibility behavior.');
assert.doesNotMatch(noteOwner, /note-reels__label/, 'Shared Y must not render a separate “Заметки” label.');
assert.match(noteCss, /\.v2-y-host \.note-reel-card\{[\s\S]*?width:50px;[\s\S]*?height:60px;/, 'Shared Y Note card must be 50×60px.');
assert.match(noteCss, /\.v2-y-host \.note-reels__rail\{[\s\S]*?gap:15px;[\s\S]*?height:60px;/, 'Shared Y rail must stay within the 60px H budget.');
assert.match(surfaceHeaderCss, /\[data-v2-q-header\],[\s\S]*?background:transparent!important;[\s\S]*?border:0!important;[\s\S]*?box-shadow:none!important;/, 'Q fixed and scroll regions must read as one continuous visual surface.');
assert.match(accountShell, /initV2WorkspaceInteraction\(root, \{/, 'End-user account shell must stay on the shared workspace interaction contour.');
assert.doesNotMatch(accountShell, /bindV2ZDismissAffordance/, 'End-user account shell must not own a separate Z affordance implementation.');

function browserBinary() {
  for (const candidate of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']) {
    const found = spawnSync('which', [candidate], { encoding: 'utf8' });
    if (found.status === 0 && found.stdout.trim()) return found.stdout.trim();
  }
  return '';
}

function contentType(filePath) {
  if (filePath.endsWith('.html')) return 'text/html; charset=utf-8';
  if (filePath.endsWith('.js') || filePath.endsWith('.mjs')) return 'text/javascript; charset=utf-8';
  if (filePath.endsWith('.css')) return 'text/css; charset=utf-8';
  if (filePath.endsWith('.svg')) return 'image/svg+xml';
  return 'application/octet-stream';
}

const fixture = `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
  <style>:root{--surface-dark:#2f3338;--button-secondary:#d8d3cf;--text-muted:#817a73;--app-max-width:390px;--app-stable-vh:844px;--app-stable-vw:390px}html,body{margin:0;width:390px;height:844px}*{box-sizing:border-box}</style>
  <link rel="stylesheet" href="/css/style.css">
  <link rel="stylesheet" href="/ui/v2/v2.css">
  <link rel="stylesheet" href="/ui/v2/v.css">
  <link rel="stylesheet" href="/ui/v2/surface-header.css">
  <link rel="stylesheet" href="/ui/note/note.css">
</head>
<body>
<div id="host"></div><div id="result">pending</div>
<script type="module">
import { v2CardDeck, v2Header, v2Shell, v2V, v2ZLayer, mountV2ZLayer, initV2WorkspaceInteraction, setV2DeckOpen, setV2Y } from '/ui/v2/index.js';
import { noteReels } from '/ui/note/index.js';
import { modal, mountModal } from '/ui/modals/index.js';
const result=document.querySelector('#result');
const fail=(message)=>{throw new Error(message)};
const ok=(condition,message)=>{if(!condition)fail(message)};
const frame=()=>new Promise((resolve)=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
try{
  const host=document.querySelector('#host');
  host.innerHTML=v2Shell({
    header:v2Header({b:'Журнал'}),
    deck:v2CardDeck([{id:'journal',label:'Журнал'},{id:'profile',label:'Профиль'}],{axis:'x',active:'journal',level:'f'}),
    body:'<p>Корневой Z</p>',
    v:v2V(),
  });
  const app=host.querySelector('[data-v2-app]');
  const stage=app.querySelector('.v2-app__stage');
  const z=app.querySelector('[data-v2-front] > [data-v2-z]');
  const v=app.querySelector('[data-v2-v]');
  ok(v?.querySelector('#v2-v-glass') && v.querySelector('#v2-v-glow') && !v.querySelector('circle'),'V visual is not the pre-#732 visual');

  const dispose=initV2WorkspaceInteraction(app,{activeId:'journal',deckOpen:false});
  const rootAffordance=z.querySelector(':scope > [data-v2-z-header] > [data-v2-z-dismiss]');
  ok(rootAffordance && !rootAffordance.hidden,'Root Z affordance is not visible');
  rootAffordance.click();
  await frame();
  ok(app.classList.contains('is-deck-open'),'Root Z affordance did not open FE');
  setV2DeckOpen(app,false);
  await frame();

  const z2=mountV2ZLayer(app,v2ZLayer('<p>Z2</p>'),{stack:true});
  const nestedAffordance=z2?.querySelector(':scope > [data-v2-z-header] > [data-v2-z-dismiss]');
  ok(nestedAffordance && !nestedAffordance.hidden,'Nested Z affordance is not visible');
  nestedAffordance.click();
  await frame();
  ok(!z2.isConnected,'Nested Z affordance did not return to previous Z');
  ok(rootAffordance.isConnected && !rootAffordance.hidden,'Root Z affordance did not return after nested Z closed');

  const notes=Array.from({length:7},(_,index)=>({id:'n'+index,date:'2026-10-24',title:'N'+(index+1),text:'Текст',from:'',to:'',color:'#CFC3FF'}));
  setV2Y(app,noteReels(notes));
  await frame();
  const y=app.querySelector('[data-v2-y-host]');
  const yRect=y.getBoundingClientRect();
  const appRect=app.getBoundingClientRect();
  const zRect=z.getBoundingClientRect();
  const stageRect=stage.getBoundingClientRect();
  ok(!y.querySelector('.note-reels__label'),'Separate Note label is still present');
  ok(yRect.height<=60.5 && yRect.height>=59.5,'Shared Y is not 60px high');
  ok(Math.abs((zRect.top-appRect.top)-132)<=1.5,'Header + Y does not place Z at about 132px');
  ok((zRect.top-appRect.top)<=144,'H territory exceeds 144px');
  const cards=[...y.querySelectorAll('[data-note-reel]')];
  ok(cards.length===7,'Shared Y did not render Note cards');
  cards.slice(0,5).forEach((card,index)=>{
    const rect=card.getBoundingClientRect();
    ok(Math.abs(rect.width-50)<=0.5 && Math.abs(rect.height-60)<=0.5,'Note '+(index+1)+' is not 50×60px');
    ok(rect.right<=yRect.right+0.5,'One of the first five Notes is clipped');
  });
  const sixth=cards[5].getBoundingClientRect();
  ok(sixth.left<yRect.right && sixth.right>yRect.right,'Sixth Note does not remain partially visible');
  ok(zRect.right>=stageRect.right+20,'Z right edge is visible inside the viewport instead of continuing beyond it');
  ok(zRect.bottom>=stageRect.bottom+20,'Z bottom edge is visible inside the viewport instead of continuing beyond it');
  const zStyle=getComputedStyle(z);
  ok(zStyle.borderBottomLeftRadius==='0px' && zStyle.borderBottomRightRadius==='0px','Z has a visible rounded bottom edge');

  const q=mountModal(document.body,modal('<div style="min-height:300px">Q body</div>',{variant:'q',title:'Q title'}));
  await frame();
  const qHeader=q?.querySelector('[data-v2-q-header]');
  const qHeaderContent=q?.querySelector('[data-v2-q-header-content]');
  ok(qHeader && qHeaderContent,'Q fixed header/body structure disappeared');
  for(const node of [qHeader,qHeaderContent]){
    const style=getComputedStyle(node);
    ok(style.backgroundColor==='rgba(0, 0, 0, 0)','Q header has a separate background');
    ok(style.boxShadow==='none','Q header has a separate shadow');
    ok(parseFloat(style.borderTopWidth||'0')===0 && parseFloat(style.borderBottomWidth||'0')===0,'Q header has a separate border');
  }
  q?.v2Close?.();
  dispose?.();
  result.dataset.sharedVisualTailRuntime='pass';
  result.textContent='PASS';
}catch(error){result.dataset.sharedVisualTailRuntime='fail';result.textContent=String(error?.stack||error);}
</script>
</body></html>`;

async function runBrowserRegression() {
  const binary = browserBinary();
  if (!binary) {
    if (process.env.CI) assert.fail('Chromium-compatible browser is required for Shared visual tail regression');
    console.log('Shared visual tail browser regression skipped: Chromium-compatible browser not found.');
    return;
  }
  const root = process.cwd();
  const server = createServer((request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url || '/', 'http://127.0.0.1').pathname);
      if (pathname === '/visual-tail.html') {
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        response.end(fixture);
        return;
      }
      const relative = pathname.replace(/^\/+/, '');
      const resolved = path.resolve(root, relative);
      if (!relative || (!resolved.startsWith(`${path.resolve(root)}${path.sep}`) && resolved !== path.resolve(root))) {
        response.writeHead(403).end('Forbidden');
        return;
      }
      const body = fs.readFileSync(resolved);
      response.writeHead(200, { 'Content-Type': contentType(resolved), 'Cache-Control': 'no-store' });
      response.end(body);
    } catch {
      response.writeHead(404).end('Not found');
    }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  try {
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    assert.ok(port, 'Shared visual tail browser server did not start');
    const child = spawn(binary, [
      '--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage',
      '--window-size=390,844','--force-device-scale-factor=1','--touch-events=enabled',
      '--virtual-time-budget=10000','--dump-dom',`http://127.0.0.1:${port}/visual-tail.html`,
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    let errors = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.stderr.on('data', (chunk) => { errors += chunk; });
    const exitCode = await new Promise((resolve) => child.once('close', resolve));
    assert.equal(exitCode, 0, `Shared visual tail browser process failed:\n${errors.slice(-4000)}`);
    assert.match(output, /data-shared-visual-tail-runtime="pass"/, `Shared visual tail browser regression failed:\n${output.slice(-6000)}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

await runBrowserRegression();
console.log('z-dismiss-affordance-contract: PASS');
