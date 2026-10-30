import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GUARD = path.join(ROOT, 'scripts', 'check-notification-event-coverage.mjs');

function write(root, relative, content) {
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, 'utf8');
}

function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function commit(root, message) {
  git(root, ['add', '.']);
  git(root, ['commit', '-m', message]);
  return git(root, ['rev-parse', 'HEAD']);
}

function runGuard(root, base = '') {
  const result = spawnSync(process.execPath, [GUARD], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      GITHUB_EVENT_PATH: '',
      GITHUB_EVENT_NAME: '',
      NOTIFICATION_GUARD_BASE: base,
    },
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
`);
  write(root, 'settings/notifications/notifications.js', `
export function render() { return getNotificationCatalog(); }
function getNotificationCatalog() { return []; }
`);
  write(root, 'server/src/thing.controller.ts', `
class NotificationEventService {}
export class ThingController {
  constructor(notifications) { this.notifications = notifications; }
  async notify(tenantId, person) {
    return this.notifications.createEventForPerson(tenantId, person, {
      type: 'thing.changed',
      entityType: 'thing',
    });
  }
}
`);
  write(root, 'notification-impact.jsonl', '\n');
}

const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'notification-coverage-'));
try {
  git(fixture, ['init']);
  git(fixture, ['config', 'user.email', 'guard@example.test']);
  git(fixture, ['config', 'user.name', 'Notification Guard Test']);
  baseline(fixture);
  const base = commit(fixture, 'baseline');

  let result = runGuard(fixture, base);
  assert.equal(result.status, 0, `baseline guard must pass:\n${result.output}`);

  write(fixture, 'server/src/thing.controller.ts', `
class NotificationEventService {}
export class ThingController {
  constructor(notifications) { this.notifications = notifications; }
  async notify(tenantId, person) {
    return this.notifications.createEventForPerson(tenantId, person, {
      type: 'thing.unknown',
      entityType: 'thing',
    });
  }
}
`);
  commit(fixture, 'unknown event');
  result = runGuard(fixture, base);
  assert.notEqual(result.status, 0, 'event emitted outside catalog must fail');
  assert.match(result.output, /absent from notification-events\.ts/);

  git(fixture, ['reset', '--hard', base]);
  write(fixture, 'server/src/thing.controller.ts', `
class NotificationEventService {}
export class ThingController {
  constructor(notifications) { this.notifications = notifications; }
}
`);
  commit(fixture, 'dead catalog row');
  result = runGuard(fixture, base);
  assert.notEqual(result.status, 0, 'catalog event without runtime trigger must fail');
  assert.match(result.output, /no notification-aware runtime trigger/);

  git(fixture, ['reset', '--hard', base]);
  write(fixture, 'settings/notifications/notifications.js', `
export function render() { return getNotificationCatalog().map(() => 'thing.changed'); }
function getNotificationCatalog() { return []; }
`);
  commit(fixture, 'hardcoded settings');
  result = runGuard(fixture, base);
  assert.notEqual(result.status, 0, 'hard-coded Settings event must fail');
  assert.match(result.output, /Settings contains hard-coded SERVICE event/);

  git(fixture, ['reset', '--hard', base]);
  write(fixture, 'server/src/new.controller.ts', `
export class NewController {
  @Post('items')
  create() { return true; }
}
`);
  commit(fixture, 'mutation without notification review');
  result = runGuard(fixture, base);
  assert.notEqual(result.status, 0, 'new mutation without notification decision must fail');
  assert.match(result.output, /has no SERVICE\/NO_NOTIFICATION decision/);

  write(fixture, 'notification-impact.jsonl', `{"file":"server/src/new.controller.ts","decision":"SERVICE","events":["thing.changed"]}\n`);
  commit(fixture, 'declare service impact');
  result = runGuard(fixture, base);
  assert.equal(result.status, 0, `SERVICE-reviewed mutation must pass:\n${result.output}`);

  git(fixture, ['reset', '--hard', base]);
  write(fixture, 'server/src/new.controller.ts', `
export class NewController {
  @Delete('cache')
  clearCache() { return true; }
}
`);
  write(fixture, 'notification-impact.jsonl', `{"file":"server/src/new.controller.ts","decision":"NO_NOTIFICATION","reason":"Technical cache cleanup has no user-facing event"}\n`);
  commit(fixture, 'explicit no notification');
  result = runGuard(fixture, base);
  assert.equal(result.status, 0, `NO_NOTIFICATION-reviewed mutation must pass:\n${result.output}`);

  console.log('notification event coverage guard tests passed');
} finally {
  fs.rmSync(fixture, { recursive: true, force: true });
}
