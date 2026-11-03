import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { v2CardDeck } from '../ui/v2/card-deck.js';
import './check-user-core-boundary.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const retiredProfileOwner = ['settings', 'profile'].join('/');
const retiredServiceOwner = ['settings', 'service'].join('/');

assert.equal(existsSync(resolve(root, 'core/profile/profile.js')), true, 'Profile must be owned by core/profile');
assert.equal(existsSync(resolve(root, 'core/profile/runtime.js')), true, 'Profile runtime must be owned by core/profile');
assert.equal(existsSync(resolve(root, 'core/service/service.js')), true, 'Service must be owned by core/service');
assert.equal(existsSync(resolve(root, 'core/service/procedures/data.js')), true, 'Service procedures must be owned by core/service');
assert.equal(existsSync(resolve(root, retiredProfileOwner)), false, 'Profile must not have a Settings owner');
assert.equal(existsSync(resolve(root, retiredServiceOwner)), false, 'Service must not have a Settings owner');

const core = readFileSync(resolve(root, 'core.js'), 'utf8');
const settings = readFileSync(resolve(root, 'settings/settings.js'), 'utf8');

assert.match(core, /from '\.\/core\/profile\/profile\.js'/);
assert.match(core, /from '\.\/core\/profile\/runtime\.js'/);
assert.match(core, /from '\.\/core\/service\/service\.js'/);
assert.match(core, /\{ id: 'profile', label: 'Профиль'/);
assert.match(core, /\{ id: 'service', label: 'Сервис', capability: 'services\.access' \}/);
assert.match(core, /if \(section === 'profile'\) return renderProfile/);
assert.match(core, /if \(section === 'service'\) return renderService/);
assert.doesNotMatch(settings, /['"]profile['"]|['"]service['"]|Профиль|Сервис/);

const rootSectionsStart = core.indexOf('const ROOT_SECTIONS = [');
const rootSectionsEnd = core.indexOf('];', rootSectionsStart);
assert.notEqual(rootSectionsStart, -1, 'ROOT_SECTIONS must exist');
assert.notEqual(rootSectionsEnd, -1, 'ROOT_SECTIONS must be closed');
const rootSections = core.slice(rootSectionsStart, rootSectionsEnd + 2);
assert.doesNotMatch(rootSections, /id:\s*'chat'/, 'D Chat must not become an F root section');
assert.match(core, /state\.activeSection === 'chat' \? state\.lastRootSection : state\.activeSection/);
assert.match(core, /book:record-chat-request/);
assert.match(core, /renderChat\(layer/);

const rootDeckProbe = v2CardDeck(
  ['people', 'finance', 'inventory', 'timetable', 'journal', 'profile', 'service', 'settings']
    .map((id) => ({ id, label: id })),
  { data: 'data-root-capacity-probe', level: 'f' },
);
assert.equal(
  (rootDeckProbe.match(/data-root-capacity-probe=/g) || []).length,
  8,
  'Shared F CardDeck must render every real root section and must not silently truncate the deck',
);
assert.match(rootDeckProbe, /data-root-capacity-probe="settings"/);

console.log('root feature ownership check: OK');
