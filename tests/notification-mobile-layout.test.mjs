import assert from 'node:assert/strict';
import fs from 'node:fs';

const chat = fs.readFileSync('ui/chat/chat.css', 'utf8');
const v2 = fs.readFileSync('ui/v2/v2.css', 'utf8');
const chatRuntime = fs.readFileSync('core/chat/runtime.js', 'utf8');
assert.equal(fs.existsSync('ui/shell/shell.css'), false);

assert.match(chat, /\.message-composer\{[^}]*position:fixed[^}]*grid-template-columns:minmax\(0,1fr\) 46px/s);
assert.match(chat, /\.message-composer--with-attachments\{[^}]*grid-template-columns:44px minmax\(0,1fr\) 46px/s);
assert.match(chat, /\.message-composer__attach\{[^}]*width:44px[^}]*height:44px/s);
assert.match(chat, /\.message-bubble\{[^}]*max-width:82%/s);
assert.match(chat, /\.v2-app--chat \.v2-z[^}]*padding-bottom:92px/s);
assert.match(v2, /\.v2-z\{/s);
assert.match(chatRuntime, /kind: 'attachment'/);
assert.match(chatRuntime, /messageComposer\(\{ attachments: true, attachmentTrigger: 'external' \}\)/);
assert.equal(fs.existsSync('online-booking/notifications.js'), false, 'Legacy notification bridge must stay removed');

console.log('mobile notification and messages layout regression test passed');
