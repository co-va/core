import fs from 'node:fs';

const profileChat = fs.readFileSync('chat/chat.js', 'utf8');
const chatApi = fs.readFileSync('core/communications/chat.js', 'utf8');
const controller = fs.readFileSync('server/src/communication/communication.controller.ts', 'utf8');
const dispatch = fs.readFileSync('server/src/communication/communication-dispatch.service.ts', 'utf8');
const chatUi = fs.readFileSync('ui/chat/index.js', 'utf8');
const chatRuntime = fs.readFileSync('core/chat/runtime.js', 'utf8');
const messengerMode = fs.readFileSync('core/chat/messenger-mode.js', 'utf8');
const internalChat = fs.readFileSync('core/chat/internal-chat.js', 'utf8');
const chatCss = fs.readFileSync('ui/chat/chat.css', 'utf8');
const v2Css = fs.readFileSync('ui/v2/v2.css', 'utf8');
const v2Ui = fs.readFileSync('ui/v2/index.js', 'utf8');
const headerUi = fs.readFileSync('ui/v2/header.js', 'utf8');
const zStack = fs.readFileSync('ui/v2/z-stack.js', 'utf8');
const indexHtml = fs.readFileSync('index.html', 'utf8');
const settingsSource = fs.readFileSync('settings/settings.js', 'utf8');

const failures = [];
const expect = (condition, message) => { if (!condition) failures.push(message); };

expect(!profileChat.includes('appShell') && !profileChat.includes('appHeader'), 'Professional Chat must not use the legacy appShell/appHeader.');
expect(profileChat.includes('workspaceHeaderContext({') && profileChat.includes('renderChatSurface('), 'Professional Chat must render inside the canonical V2 workspace.');
expect(profileChat.includes("a: { kind: 'settings'") || profileChat.includes("data-chat-settings"), 'Professional Chat Header A must own Chat settings.');
expect(profileChat.includes("kind: 'contacts'"), 'Professional Chat must use shared Header C contacts.');
expect(profileChat.includes("from '../core/chat/runtime.js'") && profileChat.includes('mountChatThread(') && profileChat.includes('mountChatList('), 'Professional Chat must use the neutral Core Chat runtime.');
expect(profileChat.includes('body, attachments'), 'Professional direct thread must send attachments through the neutral Chat runtime.');
expect(!profileChat.includes('function bindMessageAttachments') && !profileChat.includes('function fileAttachment'), 'Professional Chat must not duplicate Shared Chat attachment logic.');
expect(!profileChat.includes('<style>') && !profileChat.includes("document.createElement('style')"), 'Professional Chat must not own local styles.');
expect(!settingsSource.includes("['communications', 'Уведомления'") && !fs.existsSync('settings/communications/communications.js'), 'Duplicate Notifications E and its retired settings UI must stay removed.');


expect(chatRuntime.includes('export function mountChatList') && chatRuntime.includes('export function mountChatThread'), 'Core Chat runtime must own shared list/thread behavior.');
expect(chatRuntime.includes("kind: 'mode'") && chatRuntime.includes('data-chat-mode-switch'), 'Messenger Z1 D must exit Messenger mode.');
expect(chatRuntime.includes("kind: 'attachment'") && chatRuntime.includes('data-chat-attachment'), 'Messenger Z2 dialog D must own attachment.');
expect(chatRuntime.includes('bindMessageAttachments(form)') && chatRuntime.includes('messageComposer(') && chatRuntime.includes('messageThread('), 'Core Chat runtime must own composer, attachments, and thread rendering.');

expect(chatUi.includes('messageBubble') && chatUi.includes('messageThread') && chatUi.includes('messageComposer'), 'Shared ui/chat must own message bubbles, thread and composer.');
expect(chatUi.includes('bindMessageAttachments') && chatUi.includes('initMessageComposer'), 'Shared ui/chat must own attachments and growing composer behavior.');
expect(chatUi.includes("attachmentTrigger === 'external'") && chatUi.includes("externalAttachmentTrigger ? ' sr-only'"), 'Dialog attachment picker must be triggerable from Header D without duplicating a visible composer button.');
expect(chatUi.includes('Math.min(input.scrollHeight, 116)') && chatCss.includes('overflow-y:hidden'), 'Shared Chat composer must grow with text before internal scrolling.');
expect(chatCss.includes('.message-attachment--file'), 'Shared ui/chat CSS must render file/PDF attachments.');
expect(chatCss.includes('.message-composer__input:focus-visible') && chatCss.includes('outline:none'), 'Shared Chat must suppress native blue focus rings.');
expect(!fs.existsSync('ui/shell/index.js'), 'Legacy ui/shell owner must be physically removed.');
expect(!fs.existsSync('ui/shell/shell.css'), 'Legacy ui/shell CSS must be physically removed.');

expect(messengerMode.includes("from './internal-chat.js'"), 'Shared Messenger owner must depend on the internal Chat adapter only.');
expect(messengerMode.includes('getProfessionalChatThreads') && messengerMode.includes('getEndUserChatThreads'), 'One Shared Messenger owner must serve both professional and end-user runtimes.');
expect(!messengerMode.includes('TELEGRAM') && !messengerMode.includes('EMAIL') && !messengerMode.includes('getCommunicationChannels'), 'Messenger core must not know external integrations before internal Chat is complete.');
expect(messengerMode.includes("ROOT_CLASS = 'messenger-mode-z'") && messengerMode.includes('dismissible: false'), 'Messenger Z1 must be a non-dismissible mode root.');
expect(messengerMode.includes("THREAD_CLASS = 'messenger-thread-z'") && messengerMode.includes('stack: true'), 'Messenger dialogs must be Z2+ layers over Z1.');
expect(messengerMode.includes(".v2-header__control--chat") && messengerMode.includes('stopImmediatePropagation()'), 'APP D chat control must enter Shared Messenger before legacy D handlers run.');
expect(internalChat.includes("INTERNAL_CHAT_CHANNEL = 'CHAT'"), 'Internal Messenger channel must be CHAT.');
expect(internalChat.includes("from './messenger-api.js'"), 'Internal Chat adapter must use the Messenger API.');
expect(!internalChat.includes("'PUSH'"), 'Push must stay outside the internal Messenger correspondence channel.');
expect(!internalChat.includes('TELEGRAM') && !internalChat.includes('EMAIL'), 'Internal Chat adapter must not consume external integrations.');

expect(zStack.includes('dismissible = true') && zStack.includes("node.dataset.v2ModeRoot = 'true'"), 'Shared Z owner must support an independent non-dismissible Messenger root.');
expect(zStack.includes("surface.dataset.v2Dismissible === 'false'") && zStack.includes('if (dismissible) {'), 'Messenger Z1 must have neither swipe dismissal nor a live dismiss affordance.');
expect(headerUi.includes("const kind = slot.kind || 'text'"), 'Header D must respect its current Messenger depth role.');
expect(!headerUi.includes("role === 'd' ? 'mode'"), 'Header D must never be globally forced to mode.');
expect(headerUi.includes("kind === 'chat'") && headerUi.includes("kind === 'mode'") && headerUi.includes("kind === 'attachment'"), 'Header must visibly support APP entry, Messenger-root exit, and dialog attachment states.');
expect(indexHtml.includes('core/chat/messenger-mode.js'), 'Shared Messenger owner must load on both application domains.');

expect(chatApi.includes('attachments = []') && chatApi.includes('body, attachments'), 'Professional communication API must carry attachments.');
expect(controller.includes('attachments?: unknown'), 'Professional chat controller must accept attachments.');
expect(dispatch.includes('Array.isArray(input?.attachments)') && dispatch.includes("channel: 'IN_APP'") && dispatch.includes('attachments,'), 'Professional media messages must persist into the shared thread.');
expect(profileChat.includes("application/pdf") === false, 'Professional Chat feature file must not duplicate attachment MIME rules owned by ui/chat.');
expect(chatUi.includes("application/pdf"), 'Shared ui/chat must own PDF attachment acceptance.');

expect(v2Ui.includes('v2Header') && v2Ui.includes('v2Shell'), 'V2 H + Z geometry must be owned by shared ui/v2.');
expect(v2Css.includes('.v2-header'), 'Shared V2 must continue to own header geometry.');

if (failures.length) {
  failures.forEach((message) => console.error(`chat ui ownership: ${message}`));
  process.exit(1);
}

console.log('chat ui ownership check: OK');