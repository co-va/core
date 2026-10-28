import fs from 'node:fs';

const runtime = fs.readFileSync('online-booking/account-runtime.js', 'utf8');
const telegramBot = fs.readFileSync('server/src/communication/telegram-bot.service.ts', 'utf8');
const failures = [];
const expect = (condition, message) => { if (!condition) failures.push(message); };

expect(
  !telegramBot.includes('web_app:')
    && !telegramBot.includes("text: 'Открыть приложение'"),
  'Telegram must remain a plain BotFather bot and must not restore Telegram Mini App launch buttons.',
);
expect(
  !telegramBot.includes('createTelegramEntry(')
    && !telegramBot.includes('ACCOUNT_APP_URL'),
  'Telegram bot identity linking must not use the retired browser ticket/app flow.',
);
expect(
  telegramBot.includes("text: 'Поделиться номером'")
    && telegramBot.includes('request_contact: true'),
  'Unlinked Telegram users must be identified by Telegram native phone sharing.',
);
expect(
  telegramBot.includes("String(message.contact.user_id || '') === telegramUserId"),
  'Telegram phone linking must only accept the sender own shared contact.',
);
expect(
  telegramBot.includes('bindVerifiedTelegramPhone')
    && telegramBot.includes('this.prisma.person.findMany')
    && telegramBot.includes('this.prisma.account.findMany'),
  'Telegram phone linking must resolve existing Person/Account before adding Telegram identity.',
);
expect(
  telegramBot.includes("text: 'Записаться'")
    && telegramBot.includes('url: bookingUrl'),
  'Telegram chat must expose ordinary Public Booking URL.',
);
expect(
  !runtime.includes("params.get('booking')")
    && !runtime.includes('continueTelegramEntryToBooking')
    && !runtime.includes("url.searchParams.set('booking'"),
  'Retired Telegram Mini App booking query route must stay removed.',
);
expect(
  telegramBot.includes('ready: credentialsKeyConfigured'),
  'BotFather token connection must depend only on Telegram credentials configuration.',
);

if (failures.length) {
  failures.forEach((message) => console.error(`telegram root entry: ${message}`));
  process.exit(1);
}
console.log('telegram root entry check: OK');
