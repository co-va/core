import assert from 'node:assert/strict';
import fs from 'node:fs';

const affordance = fs.readFileSync('ui/v2/z-affordance.js', 'utf8');
const stack = fs.readFileSync('ui/v2/z-stack.js', 'utf8');
const workspaceNavigation = fs.readFileSync('ui/v2/workspace-navigation.js', 'utf8');
const accountShell = fs.readFileSync('online-booking/account-shell.js', 'utf8');

assert.match(
  affordance,
  /'margin:8px 0 4px 18px'/,
  'Shared Z/Q dismiss affordance must stay compact at the top of the stable Header without creating an empty header band.',
);
assert.match(
  affordance,
  /'color:#111'/,
  'Shared Z/Q dismiss affordance must keep full readable contrast.',
);
assert.match(
  affordance,
  /filter:drop-shadow\(0 2px 3px rgba\(0,0,0,\.45\)\)/,
  'Shared Z/Q dismiss affordance must retain its visible shadow.',
);
assert.match(
  stack,
  /if \(dismiss\) dismiss\.hidden = blocked \|\| surface\.dataset\.v2Dismissible === 'false';/,
  'Only the active dismissible Z layer may expose its dismiss affordance; obscured layers and non-dismissible mode roots must keep it hidden.',
);
assert.match(
  stack,
  /node\.style\.setProperty\('--v2-z-layer-shift', `\$\{depth \* 12\}px`\);/,
  'Each nested Z layer must retain its own physical layer shift so the active affordance moves with that layer.',
);
assert.match(
  workspaceNavigation,
  /import \{ bindV2StableZFrame \} from '\.\/z-stack\.js';/,
  'Shared workspace interaction must own the stable base Z frame lifecycle.',
);
assert.match(
  workspaceNavigation,
  /const z = app\.querySelector\('\[data-v2-front\] > \[data-v2-z\]'\);[\s\S]*?bindV2StableZFrame\(z\);/,
  'Every app shell using shared workspace interaction must bind the same stable base Z frame.',
);
assert.match(
  accountShell,
  /initV2WorkspaceInteraction\(root, \{/,
  'End-user account shell must stay on the shared workspace interaction contour.',
);
assert.doesNotMatch(
  accountShell,
  /bindV2ZDismissAffordance/,
  'End-user account shell must not own a separate Z dismiss implementation.',
);

console.log('z-dismiss-affordance-contract: PASS');
