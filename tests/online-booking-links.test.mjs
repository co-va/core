import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildBookingLink } from '../core/booking-link/index.js';

assert.equal(
  buildBookingLink({ origin: 'https://client.va-tools.ru', profileSlug: 'aleksandr' }),
  'https://client.va-tools.ru/aleksandr',
);
assert.equal(
  buildBookingLink({ origin: 'https://client.va-tools.ru', profileSlug: 'aleksandr', workplaceSlug: 'arbat' }),
  'https://client.va-tools.ru/aleksandr/arbat',
);
assert.equal(buildBookingLink({ origin: 'https://client.va-tools.ru' }), '');

const settingsSource = readFileSync(new URL('../settings/settings.js', import.meta.url), 'utf8');
const bookingSource = readFileSync(new URL('../settings/online-booking/online-booking.js', import.meta.url), 'utf8');
const notificationSource = readFileSync(new URL('../settings/notifications/notifications.js', import.meta.url), 'utf8');
const buttonsSource = readFileSync(new URL('../ui/buttons/index.js', import.meta.url), 'utf8');
const accountSource = readFileSync(new URL('../core/account/index.js', import.meta.url), 'utf8');
const coreSource = readFileSync(new URL('../core.js', import.meta.url), 'utf8');
const controllerSource = readFileSync(new URL('../server/src/online-booking/online-booking.controller.ts', import.meta.url), 'utf8');
const serviceSource = readFileSync(new URL('../server/src/online-booking/online-booking.service.ts', import.meta.url), 'utf8');
const profileServiceSource = readFileSync(new URL('../server/src/profile/profile.service.ts', import.meta.url), 'utf8');
const schemaSource = readFileSync(new URL('../server/prisma/schema.prisma', import.meta.url), 'utf8');

assert.match(settingsSource, /'online-booking', 'Онлайн-запись'/);
assert.doesNotMatch(bookingSource, /getWorkplaces/);
assert.match(bookingSource, /ACCOUNT_APP_ORIGIN/);
assert.match(bookingSource, /\/online-booking\/owner\/route/);
assert.match(bookingSource, /profileSlug/);
assert.match(bookingSource, /workplaceSlug/);
assert.match(bookingSource, /Общая ссылка/);
assert.match(bookingSource, /Ссылка рабочего пространства/);
assert.match(bookingSource, /copyIconButton/);
assert.match(bookingSource, /copyTextToClipboard/);
assert.match(bookingSource, /function selectedWorkplaceLink\(/);
assert.match(bookingSource, /copyButton\.closest\('\.input-action-row'\)/);
assert.doesNotMatch(bookingSource, /copyButton\.closest\('\.array-row'\)/);
assert.match(bookingSource, /const workplaces = publicRouteState\.workplaces\.filter\(\(item\) => item\.key && item\.slug\)/);
assert.match(bookingSource, /bookingLink\(publicRouteState\.profileSlug, selected\.slug\)/);
assert.doesNotMatch(bookingSource, /[?&]booking=/);
assert.doesNotMatch(bookingSource, /workplaces\.map\(\s*\(item\)\s*=>\s*copyLinkField/);

assert.match(accountSource, /export async function resolveBookingPublicRoute/);
assert.match(accountSource, /\/online-booking\/route\//);
assert.match(coreSource, /await bookingRoute\(\)/);
assert.match(coreSource, /resolveBookingPublicRoute/);
assert.doesNotMatch(coreSource, /params\.get\('booking'\)/, 'Retired query-string booking route must not return');
assert.match(controllerSource, /@Get\('owner\/route'\)/);
assert.match(controllerSource, /@Get\('route\/:profileSlug'\)/);
assert.match(serviceSource, /BookingPublicRouteType/);
assert.match(serviceSource, /PROFILE_ROUTE_SCOPE/);
assert.match(serviceSource, /ownerPublicRoute\(/);
assert.match(serviceSource, /resolvePublicRoute\(/);
assert.match(serviceSource, /sourceWorkplaces\.filter\(\(item\) => item\?\.visibleInPublicBooking !== false\)/);
assert.match(serviceSource, /const workplaces = selected \? \[selected\] : generalWorkplaces/);
assert.match(profileServiceSource, /publicBookingRouteSource\(/);
assert.match(profileServiceSource, /visibleInPublicBooking: workplace\.visibleInPublicBooking/);
assert.match(schemaSource, /model BookingPublicRoute/);
assert.match(schemaSource, /@@unique\(\[scopeKey, slug\]\)/);
assert.match(schemaSource, /@@unique\(\[entityType, entityId\]\)/);

assert.match(buttonsSource, /export function smallActionButton/);
assert.match(buttonsSource, /export function copyIconButton/);
assert.match(buttonsSource, /return smallActionButton\(\{ icon: 'copy'/);
assert.match(buttonsSource, /<svg viewBox="0 0 24 24"/);
assert.match(buttonsSource, /export async function copyTextToClipboard/);

console.log('online booking links tests: OK');

assert.match(bookingSource, /openSharedProfileSettingsMenu/);
assert.match(bookingSource, /label: 'Приветствие'/);
assert.doesNotMatch(bookingSource, /label: 'Настройки уведомлений'/);
assert.match(bookingSource, /variant: 'q'/);
assert.match(bookingSource, /data-online-booking-welcome-save/);
assert.doesNotMatch(bookingSource, /Шаг записи|data-online-booking-slot-step|data-online-booking-slot-info/);
assert.doesNotMatch(bookingSource, /smallActionButton\(\{[\s\S]*icon: 'info'/);
assert.doesNotMatch(bookingSource, /iconButton\(|v2ListEntry\(|v2ListEntries\(|twoColumnLayout\(/);
assert.doesNotMatch(bookingSource, /label: 'Порядок отправки'|label: 'Канал 1'|label: 'Канал 2'|label: 'Канал 3'|getNotificationRouting|saveNotificationRouting/);
assert.match(notificationSource, /data-notification-delivery-settings-open/);
assert.match(notificationSource, /label: 'Порядок отправки'/);
assert.match(notificationSource, /label: 'Канал 1'/);
assert.match(notificationSource, /label: 'Канал 2'/);
assert.doesNotMatch(notificationSource, /label: 'Канал 3'/);
assert.match(notificationSource, /Push — всегда/);
assert.match(notificationSource, /className: 'modal--form-sheet'/);
assert.doesNotMatch(notificationSource, /initV2ListReorder|data-notification-modes|data-notification-channels/);
assert.doesNotMatch(bookingSource, /Внешний вид|renderAppearance|BOOKING_SHAPES|BOOKING_CHOICE_STYLES|bookingThemePreview/);
assert.doesNotMatch(settingsSource, /'communications', 'Уведомления'/);

assert.doesNotMatch(bookingSource, /field-inline-label/);
assert.match(bookingSource, /input-action-row/);
