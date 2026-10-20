import assert from 'node:assert/strict';
import fs from 'node:fs';

const workspaceNavigation = fs.readFileSync('ui/v2/workspace-navigation.js', 'utf8');
const accountShell = fs.readFileSync('online-booking/account-shell.js', 'utf8');

assert.match(
  workspaceNavigation,
  /import \{ bindV2StableZFrame \} from '\.\/z-stack\.js';/,
  'Shared workspace interaction must own the stable base Z frame lifecycle.',
);

assert.match(
  workspaceNavigation,
  /const z = app\.querySelector\('\[data-v2-front\] > \[data-v2-z\]'\);[\s\S]*?bindV2StableZFrame\(z\);/,
  'Every shell using shared workspace interaction must bind the same stable base Z frame.',
);

assert.match(
  accountShell,
  /initV2WorkspaceInteraction\(root, \{/,
  'End-user account shell must use the shared workspace interaction contour.',
);

assert.doesNotMatch(
  accountShell,
  /bindV2ZDismissAffordance/,
  'End-user account shell must not own a separate Z dismiss implementation.',
);

console.log('workspace-z-frame-contract: PASS');
