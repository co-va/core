import fs from 'node:fs';

const runtime = fs.readFileSync('online-booking/account-runtime.js', 'utf8');
const telegramBot = fs.readFileSync('server/src/communication/telegram-bot.service.ts', 'utf8');
const failures = [];
const expect = (condition, message) => { if (!condition) failures.push(message); };

expect(
  runtime.includes("params.get('tg_tenant')") && runtime.includes("params.get('tg_entry')"),
  'Telegram browser linking must read tenant and one-time ticket from dedicated Telegram parameters.',
);
expect(
  runtime.includes("if (path !== '/') return null;"),
  'Automatic Telegram browser linking must be restricted to the global account root.',
);
expect(
  runtime.includes('clearAccount(rootTelegramRoute.tenantId);'),
  'Telegram linking must not inherit an unrelated browser Account.',
);
expect(
  runtime.includes('await bindAccountTelegramEntry(tenant, entry);')
    && runtime.includes('completeTelegramEntry();'),
  'Explicit login must finish the same Telegram ticket after authentication.',
);
expect(
  !runtime.includes("params.get('booking')")
    && !runtime.includes('continueTelegramEntryToBooking')
    && !runtime.includes("url.searchParams.set('booking'"),
  'Retired Telegram Mini App booking query route must stay removed.',
);
expect(
  !telegramBot.includes('web_app:')
    && !telegramBot.includes("text: 'Открыть приложение'"),
  'Telegram must remain a plain BotFather bot and must not restore Telegram Mini App launch buttons.',
);
expect(
  telegramBot.includes("text: 'Подключить Telegram'")
    && telegramBot.includes("text: 'Записаться'")
    && telegramBot.includes('url: bookingUrl'),
  'Telegram /start must expose ordinary browser links for identity linking and Public Booking.',
);
expect(
  !telegramBot.includes("throw new ServiceUnavailableException('Не настроен ACCOUNT_APP_URL для Telegram-входа')")
    && telegramBot.includes('ready: credentialsKeyConfigured'),
  'BotFather token connection must not depend on the account application URL.',
);

if (failures.length) {
  failures.forEach((message) => console.error(`telegram root entry: ${message}`));
  process.exit(1);
}
console.log('telegram root entry check: OK');
