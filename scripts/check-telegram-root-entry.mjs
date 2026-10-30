import fs from 'node:fs';

const files = {
  bot: fs.readFileSync('server/src/communication/telegram-bot.service.ts', 'utf8'),
  communication: fs.readFileSync('server/src/communication/communication.service.ts', 'utf8'),
  controller: fs.readFileSync('server/src/communication/communication.controller.ts', 'utf8'),
  accountRuntime: fs.readFileSync('online-booking/account-runtime.js', 'utf8'),
  accountApi: fs.readFileSync('core/account/index.js', 'utf8'),
  bookingController: fs.readFileSync('server/src/online-booking/online-booking.controller.ts', 'utf8'),
  integrationUi: fs.readFileSync('settings/integrations/integrations.js', 'utf8'),
};
const activeTelegramRuntime = Object.values(files).join('\n');
const failures = [];
const expect = (condition, message) => { if (!condition) failures.push(message); };

expect(
  !activeTelegramRuntime.includes('web_app:')
    && !activeTelegramRuntime.includes('Mini App')
    && !activeTelegramRuntime.includes('tg_entry'),
  'Telegram must not restore Mini App or browser-entry runtime.',
);
expect(
  !activeTelegramRuntime.includes('TelegramEntryTicket')
    && !activeTelegramRuntime.includes('telegram-entry')
    && !activeTelegramRuntime.includes('resolveAccountTelegramEntry')
    && !activeTelegramRuntime.includes('bindAccountTelegramEntry'),
  'Telegram must not own Account entry or Account binding.',
);
expect(
  !files.bot.includes('request_contact')
    && !files.bot.includes('bindVerifiedTelegramPhone')
    && !files.bot.includes('AccountContactType')
    && !files.bot.includes('this.prisma.account')
    && !files.bot.includes('this.prisma.person')
    && !files.bot.includes('this.prisma.ueiState'),
  'Telegram bot must remain a transport and must not identify users through Account/Person/UEI.',
);
expect(
  !files.controller.includes('telegram/webhook')
    && !files.bot.includes('handleWebhook(')
    && !files.bot.includes('webhookKey')
    && !files.bot.includes('webhookSecretHash')
    && !files.integrationUi.includes('webhook')
    && !files.integrationUi.includes('PUBLIC_API_URL'),
  'Telegram must have one inbound transport only; webhook runtime and diagnostics must not coexist with polling.',
);
expect(
  files.bot.includes("text: 'Записаться'")
    && files.bot.includes('url: bookingUrl')
    && files.bot.includes('publicBookingUrl'),
  'Telegram bot must expose the existing Public Booking URL.',
);
expect(
  files.bot.includes("allowed_updates: ['message']")
    && files.bot.includes("WHERE \"status\" = 'polling'")
    && files.bot.includes('ready: credentialsKeyConfigured'),
  'Each professional bot must use the canonical token + polling channel.',
);
expect(
  files.communication.includes('async ensureTelegramThreadIdentity(')
    && files.communication.includes("'', '', 'TELEGRAM'")
    && files.communication.includes('externalUserId'),
  'Telegram conversations must be represented only by technical channel identity, without forced business identity.',
);

if (failures.length) {
  failures.forEach((message) => console.error(`telegram root entry: ${message}`));
  process.exit(1);
}
console.log('telegram root entry check: OK');
