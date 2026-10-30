import fs from 'node:fs';

const communicationService = fs.readFileSync('server/src/communication/communication.service.ts', 'utf8');
const communicationDispatch = fs.readFileSync('server/src/communication/communication-dispatch.service.ts', 'utf8');
const communicationController = fs.readFileSync('server/src/communication/communication.controller.ts', 'utf8');
const telegramBot = fs.readFileSync('server/src/communication/telegram-bot.service.ts', 'utf8');
const communicationHistory = fs.readFileSync('server/src/communication/communication-history.service.ts', 'utf8');
const communicationModule = fs.readFileSync('server/src/communication/communication.module.ts', 'utf8');
const platformNotice = fs.readFileSync('server/src/platform-notice/platform-notice.service.ts', 'utf8');
const chatApi = fs.readFileSync('core/communications/chat.js', 'utf8');
const chatUi = fs.readFileSync('chat/chat.js', 'utf8');

const failures = [];
const expect = (condition, message) => { if (!condition) failures.push(message); };

expect(
  communicationService.includes('async ensureTelegramThreadIdentity(')
    && communicationService.includes("'', '', 'TELEGRAM'")
    && communicationService.includes('ON CONFLICT ("tenantId", "channel", "externalUserId") DO UPDATE')
    && communicationService.includes('"display" = CASE WHEN EXCLUDED."display" <>'),
  'Telegram sender identity must be technical channel metadata only and must not create a Person/Account binding.',
);
expect(
  !communicationService.includes('AccountContactType')
    && !communicationService.includes('TelegramEntryTicket')
    && !communicationService.includes('bookingIdentityForAccount')
    && !communicationService.includes('accountContact.')
    && !communicationService.includes('async telegramIdentity('),
  'Communication Telegram routing must not depend on Account/Person lookup.',
);
expect(
  !telegramBot.includes('AccountContactType')
    && !telegramBot.includes('bindVerifiedTelegramPhone')
    && !telegramBot.includes('request_contact')
    && !telegramBot.includes('this.prisma.account')
    && !telegramBot.includes('this.prisma.person')
    && !telegramBot.includes('this.prisma.ueiState')
    && !telegramBot.includes('sendChatMessage(')
    && !telegramBot.includes('repairConnection('),
  'Telegram bot must own only plain bot transport and external-thread messaging.',
);
expect(
  !communicationDispatch.includes('telegramRecipient(')
    && !communicationDispatch.includes('telegramIdentity(')
    && !communicationDispatch.includes('sendChatMessage('),
  'Common dispatch must not restore person-based Telegram routing.',
);
expect(
  communicationService.includes('async telegramThreadIdentity(')
    && telegramBot.includes('async isExternalThreadAvailable(')
    && telegramBot.includes('async sendExternalThreadMessage(')
    && communicationDispatch.includes('sendExternalThreadMessage(tenantId')
    && communicationDispatch.includes("return await this.telegram.isExternalThreadAvailable(tenantId, externalThreadId) ? ['TELEGRAM'] : []"),
  'A professional must reply from D to the same Telegram external thread through the common dispatch layer.',
);
expect(
  telegramBot.includes("direction: 'inbound'")
    && telegramBot.includes("channel: 'TELEGRAM'")
    && telegramBot.includes('externalThreadId: chatId')
    && telegramBot.includes('ensureTelegramThreadIdentity'),
  'Incoming private Telegram text must persist as the same external Telegram conversation.',
);
expect(
  telegramBot.includes("direction: 'outbound'")
    && telegramBot.includes("channel: 'TELEGRAM'")
    && telegramBot.includes('externalThreadId,'),
  'Professional Telegram replies must persist as outbound Telegram history.',
);
expect(
  communicationService.includes("const telegramExternalThread = channel === 'TELEGRAM'")
    && communicationService.includes('!personPhone && !uei && !telegramExternalThread'),
  'Telegram external-thread messages may exist without fake Person identity.',
);
expect(
  communicationHistory.includes('externalThreadId?: unknown')
    && communicationHistory.includes("'telegram:' || \"externalThreadId\"")
    && communicationHistory.includes('AS "display"'),
  'Professional D history must expose Telegram-only conversations without creating a Person.',
);
expect(
  communicationController.includes("@Query('externalThreadId') externalThreadId = ''")
    && chatApi.includes("externalThreadId: String(externalThreadId || '')")
    && chatApi.includes('externalThreadId, body, attachments'),
  'Professional chat API must carry the Telegram external thread id through load, channel resolution and reply.',
);
expect(
  chatUi.includes('function threadTitle(thread = {})')
    && chatUi.includes("const externalThreadId = String(thread?.externalThreadId || '').trim();")
    && chatUi.includes('getCommunicationThread({ phone, uei, externalThreadId })')
    && chatUi.includes('sendCommunicationMessage({ channel: selectedChannel, phone, uei, externalThreadId, body, attachments })'),
  'Professional D UI must open Telegram external threads and reply through their external thread id.',
);
expect(
  communicationHistory.includes('FROM "CommunicationMessage" m')
    && !communicationHistory.match(/FROM "CommunicationMessage" m[\s\S]{0,400}m\."channel"\s*=\s*'IN_APP'/),
  'Professional D history must include Telegram messages, not only in-app messages.',
);
expect(
  communicationService.includes('PlatformNoticeService')
    && communicationService.includes("direction === 'inbound'")
    && communicationService.includes("purpose === 'DIRECT'")
    && communicationService.includes('pushToTenantOwner(tenantId'),
  'Every newly persisted inbound direct message must notify the professional owner.',
);
expect(
  platformNotice.includes('async pushToTenantOwner(')
    && communicationModule.includes('PlatformNoticeModule'),
  'Communication must use the existing platform push owner instead of parallel push logic.',
);

if (failures.length) {
  failures.forEach((message) => console.error(`telegram recipient identity: ${message}`));
  process.exit(1);
}
console.log('telegram recipient identity check: OK');
