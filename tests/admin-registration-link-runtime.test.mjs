import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../admin/admin.js', import.meta.url), 'utf8');
const controls = source.slice(source.indexOf('function syncRegistrationLinkAction('), source.indexOf('function openRegistrationToolDrawer()'));
const render = source.slice(source.indexOf('function renderTenants()'), source.indexOf('function tenantRow('));
assert.ok(controls.startsWith('function syncRegistrationLinkAction('));
assert.ok(render.startsWith('function renderTenants()'));

function element(props = {}) {
  const callbacks = new Map();
  return {
    dataset: {}, disabled: false, hidden: false, value: '', textContent: '',
    isConnected: true,
    classList: { add() {}, remove() {} },
    addEventListener(type, listener) { callbacks.set(type, listener); },
    emit(type, event = {}) {
      const callback = callbacks.get(type);
      assert.ok(callback, 'Expected an event handler for ' + type);
      return callback(event);
    },
    ...props,
  };
}
const create = element({ disabled: true });
const strip = element();
const message = element({ hidden: true });
const link = element({ hidden: true });
const linkInput = element();
const copy = element();
const nodes = new Map([
  ['[data-create-invite-link]', create],
  ['[data-invite-strip]', strip],
  ['[data-invite-message]', message],
  ['[data-invite-link]', link],
  ['[data-invite-link-value]', linkInput],
  ['[data-copy-invite-link]', copy],
]);
let markup = '';
const content = {
  set innerHTML(value) { markup = value; },
  get innerHTML() { return markup; },
  querySelector(selector) { return nodes.get(selector) || null; },
  querySelectorAll() { return []; },
};
const keys = new Set();
const calls = [];
let opened = 0;
const responseUrl = 'https://example.test/one-time-registration';
const context = {
  state: { tenants: [], capabilities: [] },
  selectedRegistrationToolKeys: keys,
  app: { querySelector: () => content },
  setActiveSection() {},
  tenantRow() { return ''; },
  escapeHtml: (value) => String(value),
  openRegistrationToolDrawer() { opened++; },
  adminRequest(path, options) {
    calls.push({ path, options });
    return Promise.resolve({ url: responseUrl });
  },
  refreshData: () => Promise.resolve(),
  navigator: {},
  window: { setTimeout() {} },
};
const app = runInNewContext(controls + '\n' + render +
  '\n({ renderTenants, syncRegistrationLinkAction })', context);

app.renderTenants();
assert.match(markup, /data-create-invite-link disabled/);
assert.equal(create.disabled, true, 'Create button starts disabled');
assert.equal(message.hidden, true, 'No red error displayed before selection');
await create.emit('click', { stopPropagation() {} });
assert.equal(opened, 0, 'Disabled create never opens the tools modal');
assert.equal(calls.length, 0, 'Disabled create never calls server');

strip.emit('click', { target: { closest: () => null } });
assert.equal(opened, 1, 'White registration strip opens existing tool modal');
strip.emit('click', { target: { closest: (selector) => selector === '[data-create-invite-link]' ? create : null } });
assert.equal(opened, 1, 'Create button area never opens the modal');

keys.add('cabinet.journal');
app.syncRegistrationLinkAction(content);
assert.equal(create.disabled, false, 'Applied tool selection enables Create');
await create.emit('click', { stopPropagation() {} });
assert.equal(calls.length, 1, 'Link is created with exactly one API request');
assert.equal(calls[0].path, '/invitations/link');
assert.equal(calls[0].options.method, 'POST');
assert.deepEqual(JSON.parse(calls[0].options.body), { tools: ['cabinet.journal'] });
assert.equal(opened, 1, 'Creating link never opens another modal');
assert.equal(link.hidden, false, 'Only successful creation displays the link');
assert.equal(linkInput.value, responseUrl);
assert.equal(message.hidden, true, 'No redundant success message');
assert.equal(create.disabled, false, 'Create is enabled after completion for next one-time link');

keys.clear();
app.syncRegistrationLinkAction(content);
assert.equal(create.disabled, true, 'Removing all tools disables Create');
await create.emit('click', { stopPropagation() {} });
assert.equal(calls.length, 1, 'Empty selection creates no link');
assert.equal(message.hidden, true, 'Empty selection does not show red error');
console.log('Admin registration: compact modal, direct guarded Create, and disabled-state behavior PASS');
