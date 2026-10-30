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
const GATEWAYS = Object.freeze({
  createEventForPerson: 2,
  createEventForPersonKey: 2,
  createEventForTenantOwner: 1,
});

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

function escaped(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function balanced(source, openIndex, openChar = '(', closeChar = ')') {
  let depth = 0;
  let quote = '';
  let escapedChar = false;
  let lineComment = false;
  let blockComment = false;
  for (let index = openIndex; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1] || '';
    if (lineComment) {
      if (char === '\n') lineComment = false;
      continue;
    }
    if (blockComment) {
      if (char === '*' && next === '/') {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (escapedChar) escapedChar = false;
      else if (char === '\\') escapedChar = true;
      else if (char === quote) quote = '';
      continue;
    }
    if (char === '/' && next === '/') {
      lineComment = true;
      index += 1;
      continue;
    }
    if (char === '/' && next === '*') {
      blockComment = true;
      index += 1;
      continue;
    }
    if (char === '\'' || char === '"' || char === '`') {
      quote = char;
      continue;
    }
    if (char === openChar) depth += 1;
    if (char === closeChar) {
      depth -= 1;
      if (depth === 0) return { content: source.slice(openIndex + 1, index), end: index };
    }
  }
  return null;
}

function splitTopLevel(source) {
  const result = [];
  let start = 0;
  let paren = 0;
  let brace = 0;
  let bracket = 0;
  let quote = '';
  let escapedChar = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (escapedChar) escapedChar = false;
      else if (char === '\\') escapedChar = true;
      else if (char === quote) quote = '';
      continue;
    }
    if (char === '\'' || char === '"' || char === '`') {
      quote = char;
      continue;
    }
    if (char === '(') paren += 1;
    else if (char === ')') paren -= 1;
    else if (char === '{') brace += 1;
    else if (char === '}') brace -= 1;
    else if (char === '[') bracket += 1;
    else if (char === ']') bracket -= 1;
    else if (char === ',' && paren === 0 && brace === 0 && bracket === 0) {
      result.push(source.slice(start, index).trim());
      start = index + 1;
    }
  }
  result.push(source.slice(start).trim());
  return result;
}

function scanCalls(source, methodName) {
  const calls = [];
  const needle = `.${methodName}`;
  let cursor = 0;
  while (cursor < source.length) {
    const found = source.indexOf(needle, cursor);
    if (found < 0) break;
    const open = source.indexOf('(', found + needle.length);
    if (open < 0 || source.slice(found + needle.length, open).trim()) {
      cursor = found + needle.length;
      continue;
    }
    const parsed = balanced(source, open);
    if (!parsed) break;
    calls.push({ index: found, args: splitTopLevel(parsed.content), end: parsed.end });
    cursor = parsed.end + 1;
  }
  return calls;
}

function typeExpressionFromObject(source) {
  const match = /\btype\s*:\s*/g.exec(source);
  if (!match) {
    return /(?:^|[,{]\s*)type\s*(?=,|})/.test(source) ? 'type' : '';
  }
  const start = match.index + match[0].length;
  let paren = 0;
  let brace = 0;
  let bracket = 0;
  let quote = '';
  let escapedChar = false;
  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (escapedChar) escapedChar = false;
      else if (char === '\\') escapedChar = true;
      else if (char === quote) quote = '';
      continue;
    }
    if (char === '\'' || char === '"' || char === '`') {
      quote = char;
      continue;
    }
    if (char === '(') paren += 1;
    else if (char === ')') paren -= 1;
    else if (char === '{') brace += 1;
    else if (char === '}') {
      if (brace === 0 && paren === 0 && bracket === 0) return source.slice(start, index).trim();
      brace -= 1;
    } else if (char === '[') bracket += 1;
    else if (char === ']') bracket -= 1;
    else if (char === ',' && paren === 0 && brace === 0 && bracket === 0) return source.slice(start, index).trim();
  }
  return source.slice(start).trim();
}

function eventStringLiterals(source) {
  const result = [];
  const stringPattern = /(['"])([^'"\\]*(?:\\.[^'"\\]*)*)\1/g;
  for (const match of source.matchAll(stringPattern)) {
    const value = match[2].replace(/\\(['"\\])/g, '$1');
    if (value.includes('.')) result.push(value);
  }
  return result;
}

function methodDefinitions(source) {
  const result = [];
  const pattern = /(?:^|\n)\s*(?:private\s+|protected\s+|public\s+)?(?:async\s+)?([A-Za-z_$][\w$]*)\s*\(/g;
  for (const match of source.matchAll(pattern)) {
    const name = match[1];
    const open = source.indexOf('(', match.index + match[0].lastIndexOf('('));
    const params = balanced(source, open);
    if (!params) continue;
    let bodyOpen = params.end + 1;
    while (bodyOpen < source.length && /\s/.test(source[bodyOpen])) bodyOpen += 1;
    if (source[bodyOpen] !== '{') continue;
    const body = balanced(source, bodyOpen, '{', '}');
    if (!body) continue;
    const parameterNames = splitTopLevel(params.content).map((parameter) => {
      const parameterMatch = parameter.match(/^(?:\.\.\.)?([A-Za-z_$][\w$]*)/);
      return parameterMatch?.[1] || '';
    });
    result.push({ name, parameterNames, body: body.content, start: match.index, end: body.end });
  }
  return result;
}

function helperTypeParameters(source) {
  const helpers = new Map();
  for (const method of methodDefinitions(source)) {
    for (const [gateway, objectArgIndex] of Object.entries(GATEWAYS)) {
      for (const call of scanCalls(method.body, gateway)) {
        const expression = typeExpressionFromObject(call.args[objectArgIndex] || '');
        const identifier = expression.match(/^([A-Za-z_$][\w$]*)$/)?.[1] || '';
        const parameterIndex = method.parameterNames.indexOf(identifier);
        if (parameterIndex >= 0) helpers.set(method.name, parameterIndex);
      }
    }
  }
  return helpers;
}

function assignedEventTypes(source, identifier) {
  const types = new Set();
  const name = escaped(identifier);
  const declarations = new RegExp(`\\b(?:const|let|var)\\s+${name}\\b(?:\\s*:[^=;]+)?\\s*=\\s*([\\s\\S]*?);`, 'g');
  for (const match of source.matchAll(declarations)) {
    for (const value of eventStringLiterals(match[1])) types.add(value);
  }
  const assignments = new RegExp(`\\b${name}\\s*=\\s*([\\s\\S]*?);`, 'g');
  for (const match of source.matchAll(assignments)) {
    for (const value of eventStringLiterals(match[1])) types.add(value);
  }
  return [...types];
}

function resolveTypeExpression(expression, source) {
  const direct = eventStringLiterals(expression);
  if (direct.length) return direct;
  const identifier = expression.trim().match(/^([A-Za-z_$][\w$]*)$/)?.[1] || '';
  return identifier ? assignedEventTypes(source, identifier) : [];
}

function runtimeEventTypes(source) {
  const types = new Set();
  for (const [gateway, objectArgIndex] of Object.entries(GATEWAYS)) {
    for (const call of scanCalls(source, gateway)) {
      const expression = typeExpressionFromObject(call.args[objectArgIndex] || '');
      for (const value of resolveTypeExpression(expression, source)) types.add(value);
    }
  }
  for (const [helper, typeArgIndex] of helperTypeParameters(source)) {
    for (const call of scanCalls(source, helper)) {
      const expression = call.args[typeArgIndex] || '';
      for (const value of resolveTypeExpression(expression, source)) types.add(value);
    }
  }
  return [...types];
}

function deliveryServiceReceivers(source) {
  const receivers = new Set();
  const constructorProperty = /(?:private|protected|public)\s+readonly\s+([A-Za-z_$][\w$]*)\s*:\s*NotificationService\b/g;
  for (const match of source.matchAll(constructorProperty)) receivers.add(match[1]);
  const typedVariable = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*:\s*NotificationService\b/g;
  for (const match of source.matchAll(typedVariable)) receivers.add(match[1]);
  return [...receivers];
}

function bypassesSemanticGateway(source) {
  return deliveryServiceReceivers(source).some((receiver) => new RegExp(`\\b(?:this\\.)?${escaped(receiver)}\\.createEventForPerson\\s*\\(`).test(source));
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

  for (const eventType of runtimeEventTypes(source)) {
    if (!catalogSet.has(eventType)) {
      fail(`SERVICE event '${eventType}' is emitted by ${fileName} but is absent from the canonical catalog`);
      continue;
    }
    if (!emitters.has(eventType)) emitters.set(eventType, new Set());
    emitters.get(eventType).add(fileName);
  }

  if (bypassesSemanticGateway(source)) {
    fail(`${fileName} emits SERVICE through NotificationService; runtime events must go through NotificationEventService`);
  }

  if (fileName !== PLATFORM_NOTICE_PATH && /\.createForTenantOwner\s*\(/.test(source) && /\.pushToTenantOwner\s*\(/.test(source)) {
    fail(`${fileName} creates a tenant-owner notice and pushes it again; createForTenantOwner already dispatches Push`);
  }
}

for (const eventType of catalog) {
  if (!emitters.has(eventType)) fail(`SERVICE event '${eventType}' is visible in Settings but has no runtime trigger`);
}

const eventServiceSource = read(EVENT_SERVICE_PATH);
const deliveryServiceSource = read(DELIVERY_SERVICE_PATH);
const controllerSource = read(CONTROLLER_PATH);
const settingsSource = read(SETTINGS_PATH);
const routingUiSource = read(ROUTING_UI_PATH);
const canonicalSources = [eventServiceSource, deliveryServiceSource, controllerSource, settingsSource, routingUiSource].join('\n');

for (const retiredToken of ['__service__', 'SERVICE_POLICY_TYPE', 'getNotificationServiceRouting', 'setNotificationServiceEnabled']) {
  if (canonicalSources.includes(retiredToken)) fail(`retired duplicate SERVICE aggregate state is still present: ${retiredToken}`);
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
  if (literal.test(settingsSource)) fail(`Settings hard-codes SERVICE event '${eventType}'; rows must come only from the canonical catalog`);
}

if (failed) process.exit(1);
console.log(`notification-event-coverage: PASS (${catalog.length} canonical SERVICE events; real runtime triggers, settings, gateway and duplicate-send invariants verified)`);
