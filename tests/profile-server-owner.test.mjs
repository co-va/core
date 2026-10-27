import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const core = readFileSync(new URL('../core.js', import.meta.url), 'utf8');
const auth = readFileSync(new URL('../core/auth.js', import.meta.url), 'utf8');
const profileData = readFileSync(new URL('../core/profile/data.js', import.meta.url), 'utf8');
const workplaceData = readFileSync(new URL('../core/profile/workplaces/data.js', import.meta.url), 'utf8');
const runtime = readFileSync(new URL('../core/profile/runtime.js', import.meta.url), 'utf8');
const serverService = readFileSync(new URL('../server/src/profile/profile.service.ts', import.meta.url), 'utf8');
const schema = readFileSync(new URL('../server/prisma/schema.prisma', import.meta.url), 'utf8');
const workplaceTimeZoneMigration = readFileSync(new URL('../server/prisma/migrations/20260920113000_workplace_timezone/migration.sql', import.meta.url), 'utf8');
const workplaceSoftDeleteMigration = readFileSync(new URL('../server/prisma/migrations/20260927124500_workplace_soft_delete/migration.sql', import.meta.url), 'utf8');
const workplaceLimitGuard = readFileSync(new URL('../server/src/profile/workplace-limit.guard.ts', import.meta.url), 'utf8');
const profileUi = readFileSync(new URL('../core/profile/profile.js', import.meta.url), 'utf8');
const workplaceUi = readFileSync(new URL('../core/profile/workplaces/workplaces.js', import.meta.url), 'utf8');
const workplaceTimeOwner = readFileSync(new URL('../server/src/time/workplace-time-zone.ts', import.meta.url), 'utf8');
const professionCatalogMigration = readFileSync(new URL('../server/prisma/migrations/20260928203000_platform_profession_catalog/migration.sql', import.meta.url), 'utf8');
const workplaceBookingVisibilityMigration = readFileSync(new URL('../server/prisma/migrations/20260929115000_workplace_public_booking_visibility/migration.sql', import.meta.url), 'utf8');
const sharedProfileUi = readFileSync(new URL('../ui/profile/index.js', import.meta.url), 'utf8');
const listEntryUi = readFileSync(new URL('../ui/lists/list-entry.js', import.meta.url), 'utf8');

assert.doesNotMatch(auth, /prepareProductionWorkspace/);
assert.doesNotMatch(auth, /book\.(?:profile|workplaces|people|uei|records|recordEvents|procedures|dds|wallets|products)/, 'auth owner must never clear or own business datasets');
assert.doesNotMatch(core, /workspace-sync|syncWorkspaceBeforeRender|startWorkspaceSync/);
assert.match(core, /loadProfileState/);

assert.doesNotMatch(profileData, /localStorage|readLegacyProfileSnapshot/);
assert.match(profileData, /apiRequest\('\/profile'/);
assert.match(profileData, /hydrateProfileFromServer/);
assert.match(profileData, /id:\s*String\(profile\.id\s*\|\|\s*''\)/);
assert.match(profileData, /platformAccountId:\s*String\(profile\.platformAccountId\s*\|\|\s*''\)/);
assert.match(profileData, /toLocaleLowerCase\('ru-RU'\) === 'другая'/);

assert.doesNotMatch(workplaceData, /localStorage|readLegacyWorkplacesSnapshot/);
assert.match(workplaceData, /apiRequest\(`\/profile\/workplaces\//);
assert.match(workplaceData, /hydrateWorkplacesFromServer/);

assert.match(runtime, /apiRequest\('\/profile'\)/);
assert.match(runtime, /consumeJournalBootstrap\('profileContext'\)/);
assert.match(runtime, /hydrateProfileFromServer/);
assert.match(runtime, /hydrateWorkplacesFromServer/);
assert.doesNotMatch(runtime, /localStorage|readLegacy|\/migrate/);

assert.match(schema, /model Profile\s*\{/);
assert.match(schema, /model Workplace\s*\{/);
assert.match(schema, /timeZone\s+String\s+@default\("Europe\/Moscow"\)/);
assert.match(workplaceData, /timeZone:\s*String\(workplace\.timeZone/);
assert.match(serverService, /resolveWorkplaceTimeZone/);
assert.match(workplaceTimeZoneMigration, /Asia\/Yekaterinburg/);
assert.match(workplaceTimeZoneMigration, /Europe\/Kaliningrad/);
assert.doesNotMatch(schema, /migrationVerifiedAt/);
assert.doesNotMatch(serverService, /migrationVerifiedAt|verifyMigration|\bmigrate\(|bootstrap/);
assert.match(serverService, /id:\s*row\.id/);
assert.match(serverService, /platformAccountId:\s*row\.platformAccountId/);
assert.doesNotMatch(serverService, /Profile \+ Workplaces/);
assert.doesNotMatch(profileData, /Profile \+ Workplaces/);
assert.match(serverService, /platformProfession\.upsert/);
assert.match(serverService, /normalizedName === 'другая'/);
assert.match(serverService, /professionValue\.toLocaleLowerCase\('ru-RU'\) === 'другая'/);
assert.match(serverService, /professionCatalog/);
assert.match(schema, /model PlatformProfession\s*\{/);
assert.match(professionCatalogMigration, /CREATE TABLE "PlatformProfession"/);
assert.match(professionCatalogMigration, /"normalizedName" <> 'другая'/);
assert.match(schema, /deletedAt\s+DateTime\?/);
assert.match(schema, /visibleInPublicBooking\s+Boolean\s+@default\(true\)/);
assert.match(workplaceBookingVisibilityMigration, /"visibleInPublicBooking" BOOLEAN NOT NULL DEFAULT true/);
assert.match(workplaceData, /visibleInPublicBooking:\s*workplace\.visibleInPublicBooking !== false/);
assert.match(workplaceUi, /Показывать в общей онлайн-записи/);
assert.match(workplaceUi, /controls,\s*actions/);
assert.match(sharedProfileUi, /v2ListEntry/);
assert.match(sharedProfileUi, /controlsMarkup.*settingsPanel/s);
assert.match(listEntryUi, /toggleData/);
assert.match(listEntryUi, /app-setting-toggle__switch/);
assert.match(workplaceSoftDeleteMigration, /ADD COLUMN IF NOT EXISTS "deletedAt"/);
assert.match(serverService, /data: \{ deletedAt: new Date\(\) \}/);
assert.doesNotMatch(serverService, /prisma\.workplace\.delete\(/);
assert.match(serverService, /where: \{ deletedAt: null \}/);
assert.match(workplaceLimitGuard, /deletedAt: null/);

assert.match(profileUi, /getProfessionCatalog/);
assert.match(profileUi, /searchableSelect\(\{label:'Профессия'/);
assert.doesNotMatch(profileUi, /const PROFESSIONS=/);
assert.doesNotMatch(profileUi, /'Другая'/);

assert.match(workplaceData, /getWorkplaceReferenceData/);
assert.match(workplaceUi, /getWorkplaceReferenceData/);
assert.doesNotMatch(workplaceUi, /const CITIES=/);
assert.doesNotMatch(workplaceUi, /\|\|'RUB'/);
assert.doesNotMatch(workplaceUi, /\|\|'09:00'/);
assert.doesNotMatch(workplaceUi, /\|\|'18:00'/);
assert.match(workplaceTimeOwner, /WORKPLACE_CITY_DIRECTORY/);
assert.match(workplaceTimeOwner, /'Екатеринбург':?[^\n]*Asia\/Yekaterinburg|name: 'Екатеринбург'[^\n]*Asia\/Yekaterinburg/);
assert.match(workplaceTimeOwner, /resolveWorkplaceTimeZone/);
assert.match(workplaceTimeOwner, /CITY_BY_NAME\.get\(cityName\)\?\.timeZone/);
assert.match(workplaceTimeOwner, /workplaceReferenceData/);

console.log('profile server owner tests: OK');