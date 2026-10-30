import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = process.cwd();
const SERVER_ROOT = path.join(ROOT, 'server', 'src');
const CATALOG_PATH = path.join(SERVER_ROOT, 'notification', 'notification-events.ts');
const SETTINGS_PATH = path.join(ROOT, 'settings', 'notifications', 'notifications.js');
const REVIEW_PATH = path.join(ROOT, 'notification-impact.jsonl');

function fail(message) {
  console.error(`notification-event-coverage: ${message}`);
  process.exitCode = 1;
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

function git(args, options = {}) {
  return execFileSync('git', args, {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  }).trim();
}

function gitOk(args) {
  try {
    execFileSync('git', args, { cwd: ROOT, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function ensureCommit(sha) {
  const value = String(sha || '').trim();
  if (!/^[0-9a-f]{40}$/i.test(value)) return false;
  if (gitOk(['cat-file', '-e', `${value}^{commit}`])) return true;
  try {
    execFileSync('git', ['fetch', '--no-tags', '--depth=1', 'origin', value], {
      cwd: ROOT,
      stdio: 'ignore',
    });
  } catch {
    return false;
  }
  return gitOk(['cat-file', '-e', `${value}^{commit}`]);
}

function githubEventBase() {
  const eventPath = String(process.env.GITHUB_EVENT_PATH || '').trim();
  if (!eventPath || !fs.existsSync(eventPath)) return '';
  try {
    const event = JSON.parse(read(eventPath));
    const eventName = String(process.env.GITHUB_EVENT_NAME || '').trim();
    if (eventName === 'push') {
      const before = String(event?.before || '').trim();
      if (before && !/^0{40}$/.test(before)) return before;
    }
    if (eventName === 'pull_request') {
      return String(event?.pull_request?.base?.sha || '').trim();
    }
  } catch (error) {
    fail(`cannot read GitHub event payload: ${error instanceof Error ? error.message : String(error)}`);
  }
  return '';
}

function catalogTypes(source) {
  return [...source.matchAll(/serviceEvent\(\{[\s\S]*?\btype:\s*'([^']+)'/g)].map((match) => match[1]);
}

function directGatewayTypes(source) {
  const types = [];
  const gateway = /(?:createEventForPerson|createEventForTenantOwner|createEventForPersonKey)\s*\([\s\S]{0,1800}?\btype:\s*'([^']+)'/g;
  for (const match of source.matchAll(gateway)) types.push(match[1]);
  return types;
}

function hasLiteral(source, value) {
  return source.includes(`'${value}'`) || source.includes(`\"${value}\"`);
}

const catalogSource = read(CATALOG_PATH);
const catalog = catalogTypes(catalogSource);
const catalogSet = new Set(catalog);
if (!catalog.length) fail('canonical SERVICE catalog is empty or unreadable');
if (catalogSet.size !== catalog.length) fail('canonical SERVICE catalog contains duplicate event types');

const tsFiles = walk(SERVER_ROOT).filter((file) => file.endsWith('.ts'));
const emitters = new Map();
function registerEmitter(eventType, file) {
  if (!emitters.has(eventType)) emitters.set(eventType, new Set());
  emitters.get(eventType).add(rel(file));
}

for (const file of tsFiles) {
  if (file === CATALOG_PATH) continue;
  const source = read(file);
  for (const eventType of directGatewayTypes(source)) {
    registerEmitter(eventType, file);
    if (!catalogSet.has(eventType)) {
      fail(`SERVICE event '${eventType}' is emitted by ${rel(file)} but is absent from notification-events.ts (there would be no Settings switch)`);
    }
  }

  const notificationAware = /NotificationEventService|createEventForPerson|createEventForTenantOwner|createEventForPersonKey|notifyRecordEvent/.test(source);
  if (!notificationAware) continue;
  for (const eventType of catalog) {
    if (hasLiteral(source, eventType)) registerEmitter(eventType, file);
  }
}
for (const eventType of catalog) {
  if (!emitters.has(eventType)) {
    fail(`SERVICE event '${eventType}' is present in Settings catalog but has no notification-aware runtime trigger`);
  }
}

const settingsSource = read(SETTINGS_PATH);
if (!/getNotificationCatalog\s*\(/.test(settingsSource)) {
  fail('Settings → Notifications is not derived from the canonical notification catalog');
}
for (const eventType of catalog) {
  const escaped = eventType.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (new RegExp(`['\"]${escaped}['\"]`).test(settingsSource)) {
    fail(`Settings contains hard-coded SERVICE event '${eventType}'; switches must be derived from the canonical catalog`);
  }
}

function chooseBase() {
  const requested = String(process.env.NOTIFICATION_GUARD_BASE || '').trim();
  if (requested) {
    if (ensureCommit(requested)) return requested;
    fail(`requested notification guard base '${requested}' is unavailable`);
    return '';
  }

  const eventBase = githubEventBase();
  if (eventBase) {
    if (ensureCommit(eventBase)) return eventBase;
    fail(`GitHub change base '${eventBase}' is unavailable`);
    return '';
  }

  if (gitOk(['rev-parse', '--verify', 'origin/main'])) {
    const head = git(['rev-parse', 'HEAD']);
    const main = git(['rev-parse', 'origin/main']);
    if (head !== main) return 'origin/main';
  }
  if (gitOk(['rev-parse', '--verify', 'HEAD^'])) return 'HEAD^';
  return '';
}

function addedLines(diff) {
  return diff
    .split('\n')
    .filter((line) => line.startsWith('+') && !line.startsWith('+++'))
    .map((line) => line.slice(1));
}

function changedServerFiles(base) {
  const names = git(['diff', '--name-only', base, 'HEAD', '--', 'server/src']);
  return names ? names.split('\n').filter(Boolean) : [];
}

function fileDiff(base, file) {
  try {
    return git(['diff', '--unified=0', base, 'HEAD', '--', file]);
  } catch {
    return '';
  }
}

function mutationCapable(source, diff) {
  const mutatingHttp = /@(Post|Put|Patch|Delete)\s*\(/;
  const prismaWrite = /(?:\bthis\.prisma\b|\btx\b|\bprisma\b)[\s\S]{0,180}?\.(?:create|createMany|update|updateMany|upsert|delete|deleteMany)\s*\(/;
  const rawWrite = /\$(?:executeRaw|executeRawUnsafe)\b|\b(?:INSERT\s+INTO|UPDATE\s+"|DELETE\s+FROM)\b/i;
  return mutatingHttp.test(source) || prismaWrite.test(source) || rawWrite.test(source) || mutatingHttp.test(diff) || prismaWrite.test(diff) || rawWrite.test(diff);
}

function parseReviews() {
  if (!fs.existsSync(REVIEW_PATH)) return new Map();
  const map = new Map();
  const lines = read(REVIEW_PATH).split('\n').map((line) => line.trim()).filter(Boolean);
  for (const [index, line] of lines.entries()) {
    let row;
    try {
      row = JSON.parse(line);
    } catch {
      fail(`notification-impact.jsonl line ${index + 1} is not valid JSON`);
      continue;
    }
    if (!row || typeof row.file !== 'string') {
      fail(`notification-impact.jsonl line ${index + 1} has no file`);
      continue;
    }
    if (row.decision !== 'SERVICE' && row.decision !== 'NO_NOTIFICATION') {
      fail(`notification-impact.jsonl entry for ${row.file} must be SERVICE or NO_NOTIFICATION`);
      continue;
    }
    if (row.decision === 'SERVICE') {
      const events = Array.isArray(row.events) ? row.events.filter((value) => typeof value === 'string' && value) : [];
      if (!events.length) fail(`SERVICE review for ${row.file} has no events`);
      for (const eventType of events) {
        if (!catalogSet.has(eventType)) fail(`SERVICE review for ${row.file} references unknown event '${eventType}'`);
      }
    } else if (typeof row.reason !== 'string' || row.reason.trim().length < 12) {
      fail(`NO_NOTIFICATION review for ${row.file} needs a concrete reason (12+ characters)`);
    }
    map.set(row.file, row);
  }
  return map;
}

function addedReviewFiles(diff) {
  const result = new Set();
  for (const line of addedLines(diff)) {
    try {
      const row = JSON.parse(line.trim());
      if (row && typeof row.file === 'string') result.add(row.file);
    } catch {
      // parseReviews reports invalid current ledger rows; unrelated added diff lines are ignored here.
    }
  }
  return result;
}

const base = chooseBase();
if (base) {
  const reviews = parseReviews();
  const reviewDiff = fs.existsSync(REVIEW_PATH) ? fileDiff(base, 'notification-impact.jsonl') : '';
  const reviewedInThisChange = addedReviewFiles(reviewDiff);
  for (const file of changedServerFiles(base)) {
    if (!file.endsWith('.ts')) continue;
    const absolute = path.join(ROOT, file);
    const source = fs.existsSync(absolute) ? read(absolute) : '';
    const diff = fileDiff(base, file);
    if (!mutationCapable(source, diff)) continue;

    const review = reviews.get(file);
    if (!review) {
      fail(`${file} changes mutation-capable code but has no SERVICE/NO_NOTIFICATION decision in notification-impact.jsonl`);
      continue;
    }
    if (!reviewedInThisChange.has(file)) {
      fail(`${file} changes mutation-capable code but its notification-impact review was not updated in this change`);
      continue;
    }

    if (review.decision === 'SERVICE') {
      const events = Array.isArray(review.events) ? review.events : [];
      for (const eventType of events) {
        if (!emitters.has(eventType)) fail(`${file} declares SERVICE '${eventType}', but no notification-aware runtime trigger exists`);
      }
    }
  }
} else {
  console.log('notification-event-coverage: git base unavailable; static catalog/emitter/settings checks only');
}

if (!process.exitCode) {
  console.log(`notification-event-coverage: PASS (${catalog.length} SERVICE events, bidirectional catalog/emitter/settings guard active)`);
}
