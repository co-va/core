import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GUARD = path.join(ROOT, 'scripts', 'check-notification-event-coverage.mjs');

function write(root, relative, content) {
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, 'utf8');
}

function runGuard(root) {
  const result = spawnSync(process.execPath, [GUARD], {
    cwd: root,
    encoding: 'utf8',
  });
  return {
    status: result.status,
    output: `${result.stdout || ''}\n${result.stderr || ''}`,
  };
}

function baseline(root) {
  write(root, 'server/src/notification/notification-events.ts', `
function serviceEvent(value) { return value; }
export const NOTIFICATION_EVENT_CATALOG = [
  serviceEvent({ type: 'thing.changed', group: 'Fixture' }),
];
export function notificationEventDefinition(type) {
  return NOTIFICATION_EVENT_CATALOG.find((event) => event.type === type) || null;
}
`);
  write(root, 'server/src/notification/notification-event.service.ts', `
export class NotificationEventService {
  async setAllEnabled() { return []; }
  async createEventForPerson() {}
}
`);
  write(root, 'server/src/notification/notification.service.ts', `
import { notificationEventDefinition } from './notification-events';
export class NotificationService {
  async createEventForPerson(tenantId, person, input) {
    const type = String(input?.type || '');
    const definition = notificationEventDefinition(type);
    if (!definition) throw new Error('unknown');
    return definition;
  }
}
`);
  write(root, 'server/src/notification/notification.controller.ts', `
export class NotificationController {
  @Put('routing')
  setAllRouting() {}
}
`);
  write(root, 'core/notifications/routing.js', `
export async function getNotificationCatalog() { return []; }
export async function setAllNotificationsEnabled() { return []; }
export async function setNotificationEnabled() { return {}; }
`);
  write(root, 'settings/notifications/notifications.js', `
import { getNotificationCatalog, setAllNotificationsEnabled, setNotificationEnabled } from '../../core/notifications/routing.js';
export async function render() {
  const catalog = await getNotificationCatalog();
  await setAllNotificationsEnabled(false);
  return catalog.map((event) => setNotificationEnabled(event.type, false));
}
`);
  write(root, 'server/src/thing.controller.ts', `
import { NotificationEventService } from './notification/notification-event.service';
export class ThingController {
  constructor(notifications) { this.notifications = notifications; }
  async change(tenantId, person) {
    return this.notifications.createEventForPerson(tenantId, person, {
      type: 'thing.changed',
      entityType: 'thing',
    });
  }
}
`);
}

function expectFailure(fixture, message, pattern) {
  const result = runGuard(fixture);
  assert.notEqual(result.status, 0, message);
  assert.match(result.output, pattern);
}

const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'notification-coverage-'));
try {
  baseline(fixture);
  let result = runGuard(fixture);
  assert.equal(result.status, 0, `baseline guard must pass:\n${result.output}`);

  baseline(fixture);
  write(fixture, 'server/src/thing.controller.ts', `
import { NotificationEventService } from './notification/notification-event.service';
export class ThingController {
  private async notify(tenantId, person, type) {
    return this.notifications.createEventForPerson(tenantId, person, { type, entityType: 'thing' });
  }
  async change(tenantId, person, created) {
    const eventType = created ? 'thing.changed' : '';
    return this.notify(tenantId, person, eventType);
  }
}
`);
  result = runGuard(fixture);
  assert.equal(result.status, 0, `forwarded helper event must count as real wiring:\n${result.output}`);

  baseline(fixture);
  write(fixture, 'server/src/thing.controller.ts', `
import { NotificationEventService } from './notification/notification-event.service';
export class ThingController {
  async change(tenantId, person, changed) {
    return this.notifications.createEventForPerson(tenantId, person, {
      type: changed ? 'thing.changed' : '',
      entityType: 'thing',
    });
  }
}
`);
  result = runGuard(fixture);
  assert.equal(result.status, 0, `conditional gateway event must count as real wiring:\n${result.output}`);

  baseline(fixture);
  write(fixture, 'server/src/thing.controller.ts', `
export class ThingController {
  async change() {
    const decorativeText = 'thing.changed';
    return decorativeText;
  }
}
`);
  expectFailure(fixture, 'an event word without a gateway must not satisfy coverage', /has no runtime trigger/);

  baseline(fixture);
  write(fixture, 'server/src/thing.controller.ts', `
import { NotificationEventService } from './notification/notification-event.service';
export class ThingController {
  async change(tenantId, person) {
    return this.notifications.createEventForPerson(tenantId, person, { type: 'thing.unknown' });
  }
}
`);
  expectFailure(fixture, 'event emitted outside catalog must fail', /absent from the canonical catalog/);

  baseline(fixture);
  write(fixture, 'server/src/thing.controller.ts', `
export class ThingController {}
`);
  expectFailure(fixture, 'catalog event without runtime trigger must fail', /has no runtime trigger/);

  baseline(fixture);
  write(fixture, 'settings/notifications/notifications.js', `
import { getNotificationCatalog, setAllNotificationsEnabled, setNotificationEnabled } from '../../core/notifications/routing.js';
export function render() {
  getNotificationCatalog();
  setAllNotificationsEnabled(true);
  setNotificationEnabled('thing.changed', true);
}
`);
  expectFailure(fixture, 'hard-coded Settings event must fail', /Settings hard-codes SERVICE event/);

  baseline(fixture);
  write(fixture, 'server/src/thing.controller.ts', `
import { NotificationService } from './notification/notification.service';
export class ThingController {
  constructor(private readonly notifications: NotificationService) {}
  async change(tenantId, person) {
    return this.notifications.createEventForPerson(tenantId, person, { type: 'thing.changed' });
  }
}
`);
  expectFailure(fixture, 'direct NotificationService event emission must fail', /must go through NotificationEventService/);

  baseline(fixture);
  write(fixture, 'server/src/commercial.service.ts', `
export class CommercialService {
  async send() {
    await this.notices.createForTenantOwner('tenant', {});
    await this.notices.pushToTenantOwner('tenant', {});
  }
}
`);
  expectFailure(fixture, 'duplicate tenant-owner push must fail', /already dispatches Push/);

  baseline(fixture);
  write(fixture, 'core/notifications/routing.js', `
export const SERVICE_POLICY_TYPE = '__service__';
export async function getNotificationCatalog() { return []; }
export async function setAllNotificationsEnabled() { return []; }
export async function setNotificationEnabled() { return {}; }
`);
  expectFailure(fixture, 'retired SERVICE master state must fail', /retired duplicate SERVICE master state/);

  baseline(fixture);
  write(fixture, 'server/src/notification/notification-events.ts', `
function serviceEvent(value) { return value; }
export const NOTIFICATION_EVENT_CATALOG = [
  serviceEvent({ type: 'thing.changed', group: 'Fixture' }),
  serviceEvent({ type: 'thing.changed', group: 'Fixture' }),
];
`);
  expectFailure(fixture, 'duplicate catalog event must fail', /duplicate event types/);

  baseline(fixture);
  write(fixture, 'server/src/notification/notification.controller.ts', `
export class NotificationController {}
`);
  expectFailure(fixture, 'missing bulk endpoint must fail', /bulk SERVICE enable\/disable/);

  console.log('notification event coverage guard tests passed');
} finally {
  fs.rmSync(fixture, { recursive: true, force: true });
}
