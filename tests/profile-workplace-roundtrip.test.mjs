import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

class MemoryStorage {
  #values = new Map();
  getItem(key) { return this.#values.has(String(key)) ? this.#values.get(String(key)) : null; }
  setItem(key, value) { this.#values.set(String(key), String(value)); }
  removeItem(key) { this.#values.delete(String(key)); }
  clear() { this.#values.clear(); }
}

globalThis.localStorage = new MemoryStorage();
globalThis.sessionStorage = new MemoryStorage();
globalThis.window = new EventTarget();
if (typeof globalThis.CustomEvent !== 'function') {
  globalThis.CustomEvent = class CustomEvent extends Event {
    constructor(type, options = {}) { super(type, options); this.detail = options.detail; }
  };
}

const clone = (value) => JSON.parse(JSON.stringify(value));
const referenceData = {
  cities: ['Москва', 'Санкт-Петербург'],
  currencies: [{ value: 'RUB', label: '₽' }],
  defaults: { currency: 'RUB', from: '09:00', to: '18:00', timeZone: 'Europe/Moscow' },
};

let serverBundle = {
  profile: {
    id: 'profile-db', platformAccountId: 'owner-account', key: 'profile',
    name: 'Иван', surname: 'Проверка', phone: '+79990000000', phones: ['+79990000000'],
    telegrams: [], emails: ['owner@example.test'], about: 'Исходное описание', photo: '',
    photoCropX: 50, photoCropY: 50, profession: 'Стилист', experience: 'Более 20 лет',
    professionAbout: 'Профессия', cardAppearance: {},
  },
  customProfessions: [],
  professionCatalog: ['Стилист', 'Парикмахер'],
  workplaceReferenceData: referenceData,
  workplaces: [{
    key: 'studio-1', profileId: 'profile', photo: '', photoCropX: 50, photoCropY: 50,
    name: 'Студия 1', color: '#9AAE85', city: 'Москва', address: 'Старый адрес',
    phone: '+79990000001', currency: 'RUB', timeZone: 'Europe/Moscow', from: '09:00', to: '18:00',
    links: [], about: '', cardAppearance: {}, visibleInPublicBooking: true,
    createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z',
  }],
};

let profileGets = 0;
let profilePuts = 0;
let workplacePuts = 0;
const json = (body, status = 200) => Promise.resolve(new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json' },
}));

globalThis.fetch = async (input, init = {}) => {
  const path = String(input || '');
  const method = String(init.method || 'GET').toUpperCase();
  if (path === '/profile' && method === 'GET') {
    profileGets += 1;
    return json(clone(serverBundle));
  }
  if (path === '/profile' && method === 'PUT') {
    profilePuts += 1;
    const body = JSON.parse(String(init.body || '{}'));
    serverBundle.profile = { ...serverBundle.profile, ...(body.profile || {}) };
    serverBundle.customProfessions = Array.isArray(body.customProfessions)
      ? clone(body.customProfessions)
      : serverBundle.customProfessions;
    return json(clone(serverBundle));
  }
  const workplaceMatch = path.match(/^\/profile\/workplaces\/([^/]+)$/);
  if (workplaceMatch && method === 'PUT') {
    workplacePuts += 1;
    const key = decodeURIComponent(workplaceMatch[1]);
    const body = JSON.parse(String(init.body || '{}'));
    const index = serverBundle.workplaces.findIndex((item) => item.key === key);
    const next = { ...body, key, profileId: 'profile', updatedAt: '2026-10-27T08:00:00.000Z' };
    if (index >= 0) serverBundle.workplaces[index] = { ...serverBundle.workplaces[index], ...next };
    else serverBundle.workplaces.push(next);
    return json(clone(serverBundle));
  }
  return json({ message: `Unexpected ${method} ${path}` }, 404);
};

localStorage.setItem('book.auth.token', 'profile-roundtrip-token');

const [profileRuntime, profileData, workplaceData, profileViewSource] = await Promise.all([
  import('../core/profile/runtime.js'),
  import('../core/profile/data.js'),
  import('../core/profile/workplaces/data.js'),
  readFile(new URL('../core/profile/profile.js', import.meta.url), 'utf8'),
]);

assert.match(profileViewSource, /loadProfileState\(\{full:true\}\)/,
  'Opening Profile must request full Profile state');

await profileRuntime.loadProfileState({ full: true });
assert.equal(profileGets, 1, 'Full Profile must be read once when opened');
assert.equal(profileData.isProfileServerReady(), true);
assert.equal(workplaceData.isWorkplacesServerReady(), true);
assert.equal(profileData.getProfile().name, 'Иван');
assert.equal(workplaceData.getWorkplaces()[0]?.name, 'Студия 1');

await profileData.saveProfile({
  ...profileData.getProfile(),
  name: 'Иван Изменён',
  about: 'Сохранено на сервере',
});
assert.equal(profilePuts, 1, 'Profile must save through canonical PUT /profile');
assert.equal(serverBundle.profile.name, 'Иван Изменён');
assert.equal(serverBundle.workplaces[0]?.name, 'Студия 1', 'Profile save must not rewrite Workplace');
assert.equal(profileData.getProfile().name, 'Иван Изменён', 'Profile state must hydrate from server response');

await workplaceData.upsertWorkplace({
  ...workplaceData.getWorkplaces()[0],
  name: 'Студия Изменена',
  address: 'Новый адрес',
});
assert.equal(workplacePuts, 1, 'Workplace must save through its canonical endpoint');
assert.equal(serverBundle.workplaces[0]?.name, 'Студия Изменена');
assert.equal(serverBundle.profile.name, 'Иван Изменён', 'Workplace save must not rewrite Profile');
assert.equal(workplaceData.getWorkplaces()[0]?.name, 'Студия Изменена', 'Workplace state must hydrate from server response');

window.dispatchEvent(new CustomEvent('book:auth-logout'));
assert.equal(profileData.isProfileServerReady(), false, 'Session reset must invalidate full Profile readiness');
assert.equal(workplaceData.isWorkplacesServerReady(), false, 'Session reset must invalidate Workplace readiness');
localStorage.setItem('book.auth.token', 'profile-roundtrip-token');
await profileRuntime.loadProfileState({ full: true });

assert.equal(profileGets, 2, 'Fresh session must re-read full Profile from server');
assert.equal(profileData.getProfile().name, 'Иван Изменён', 'Profile edit must survive fresh server read');
assert.equal(workplaceData.getWorkplaces()[0]?.name, 'Студия Изменена', 'Workplace edit must survive fresh server read');
assert.equal(workplaceData.getWorkplaces()[0]?.address, 'Новый адрес', 'Workplace fields must survive fresh server read');

console.log('Profile + Workplace roundtrip: PASS');
