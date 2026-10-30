import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync('core/platform-notices.js', 'utf8');
const offerPush = source.slice(
  source.indexOf('const offerPush = async () => {'),
  source.indexOf('const showNext = async () => {'),
);

assert.match(offerPush, /pushPromptOpening/, 'Push prompt must have an in-flight opening guard');
assert.match(offerPush, /pushPromptShown \|\| pushPromptOpening/, 'Concurrent Push prompt offers must be rejected before async work');
assert.match(offerPush, /pushPromptOpening = true;[\s\S]*await enablePlatformPush\(\)/, 'Opening guard must be acquired before async Push state repair');
assert.match(offerPush, /document\.querySelector\('\[data-platform-notice-modal\], \[data-platform-push-setup-modal\]'\)/, 'Push prompt must re-check existing notice/prompt layers');
assert.match(offerPush, /pushPromptShown = true;[\s\S]*mountModal/, 'Prompt must be marked shown before mounting');

console.log('Platform Push prompt race guard: OK');
