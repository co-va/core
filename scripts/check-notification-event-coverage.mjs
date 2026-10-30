import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const SERVER_ROOT = path.join(ROOT, 'server', 'src');
const CATALOG_PATH = path.join(SERVER_ROOT, 'notification', 'notification-events.ts');
const EVENT_SERVICE_PATH = path.join(SERVER_ROOT, 'notification', 'notification-event.service.ts');
const DELIVERY_SERVICE_PATH = path.join(SERVER_ROOT, 'notification', 'notification.service.ts');
const CONTROLLER_PATH = path.join(SERVER_ROOT, 'notification', 'notification.controller.ts');
const SETTINGS_PATH = path.join(ROOT, 'settings', 'notifications', 'notifications.js');
const ROUTING_UI_PATH = path.join(ROOT, 'core', 'notifications', 'routing.js');
const PLATFORM_NOTICE_PATH = 'server/src/platform-notice/platform-notice.service.ts';

let failed = false;

function fail(message) {
  failed = true;
  console.error(`notification-event-coverage: ${message}`);
}

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

function walk(dir) {
  const result = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) result.push(...walk(full));
    else result.push(full);
  }
  return result;
}

function rel(file) {
  return path.relative(ROOT, file).split(path.sep).join('/');
}

function catalogTypes(source) {
  return [...source.matchAll(/serviceEvent\(\{[\s\S]*?\btype:\s*'([^']+)'/g)].map((match) => match[1]);
}

function literalGatewayTypes(source) {
  const types = [];
  const gateway = /(?:createEventForPerson|createEventForTenantOwner|createEventForPersonKey)\s*\([\s\S]{0,1800}?\btype:\s*'([^']+)'/g;
  for (const match of source.matchAll(gateway)) types.push(match[1]);
  return types;
}

function escaped(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

for (const file of [CATALOG_PATH, EVENT_SERVICE_PATH, DELIVERY_SERVICE_PATH, CONTROLLER_PATH, SETTINGS_PATH, ROUTING_UI_PATH]) {
  if (!fs.existsSync(file)) fail(`required notification file is missing: ${rel(file)}`);
}
if (failed) process.exit(1);

const catalogSource = read(CATALOG_PATH);
const catalog = catalogTypes(catalogSource);
const catalogSet = new Set(catalog);
if (!catalog.length) fail('canonical SERVICE catalog is empty or unreadable');
if (catalogSet.size !== catalog.length) fail('canonical SERVICE catalog contains duplicate event types');

const tsFiles = walk(SERVER_ROOT).filter((file) => file.endsWith('.ts'));
const emitters = new Map();
for (const file of tsFiles) {
  if (file === CATALOG_PATH || file === EVENT_SERVICE_PATH || file === DELIVERY_SERVICE_PATH) continue;
  const source = read(file);
  const fileName = rel(file);

  for (const eventType of literalGatewayTypes(source)) {
    if (!catalogSet.has(eventType)) {
      fail(`SERVICE event '${eventType}' is emitted by ${fileName} but is absent from the canonical catalog`);
      continue;
    }
    if (!emitters.has(eventType)) emitters.set(eventType, new Set());
    emitters.get(eventType).add(fileName);
  }

  const importsDeliveryService = /import\s*\{[^}]*\bNotificationService\b[^}]*\}\s*from\s*['"][^'"]*notification\.service['"]/.test(source);
  if (importsDeliveryService && /\.createEventForPerson\s*\(/.test(source)) {
    fail(`${fileName} emits SERVICE through NotificationService; runtime events must go through NotificationEventService`);
  }

  if (fileName !== PLATFORM_NOTICE_PATH && /\.createForTenantOwner\s*\(/.test(source) && /\.pushToTenantOwner\s*\(/.test(source)) {
    fail(`${fileName} creates a tenant-owner notice and pushes it again; createForTenantOwner already dispatches Push`);
  }
}

for (const eventType of catalog) {
  if (!emitters.has(eventType)) {
    fail(`SERVICE event '${eventType}' is visible in Settings but has no runtime trigger`);
  }
}

const eventServiceSource = read(EVENT_SERVICE_PATH);
const deliveryServiceSource = read(DELIVERY_SERVICE_PATH);
const controllerSource = read(CONTROLLER_PATH);
const settingsSource = read(SETTINGS_PATH);
const routingUiSource = read(ROUTING_UI_PATH);
const canonicalSources = [eventServiceSource, deliveryServiceSource, controllerSource, settingsSource, routingUiSource].join('\n');

for (const legacy of ['__service__', 'SERVICE_POLICY_TYPE', 'getNotificationServiceRouting', 'setNotificationServiceEnabled']) {
  if (canonicalSources.includes(legacy)) {
    fail(`legacy duplicate SERVICE master state is still present: ${legacy}`);
  }
}

if (/serviceEventEnabled\s*\(/.test(deliveryServiceSource)) {
  fail('NotificationService duplicates SERVICE enable/disable gating owned by NotificationEventService');
}
if (!/notificationEventDefinition\s*\(type\)/.test(deliveryServiceSource)) {
  fail('NotificationService does not validate SERVICE event types against the canonical catalog');
}
if (!/setAllEnabled\s*\(/.test(eventServiceSource) || !/@Put\('routing'\)/.test(controllerSource)) {
  fail('bulk SERVICE enable/disable is not implemented by the canonical notification endpoint');
}
if (!/getNotificationCatalog\s*\(/.test(settingsSource)) {
  fail('Settings → Notifications is not derived from the canonical notification catalog');
}
if (!/setAllNotificationsEnabled\s*\(/.test(settingsSource) || !/setNotificationEnabled\s*\(/.test(settingsSource)) {
  fail('Settings → Notifications must expose both bulk and per-event SERVICE switches');
}
for (const eventType of catalog) {
  const literal = new RegExp(`['\"]${escaped(eventType)}['\"]`);
  if (literal.test(settingsSource)) {
    fail(`Settings hard-codes SERVICE event '${eventType}'; rows must come only from the canonical catalog`);
  }
}

if (failed) process.exit(1);
console.log(`notification-event-coverage: PASS (${catalog.length} canonical SERVICE events; settings, triggers, gateway and duplicate-send invariants verified)`);
