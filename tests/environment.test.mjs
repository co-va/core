import assert from 'node:assert/strict';
import {
  ADMIN_APP_ORIGIN,
  CODESPACES_STAGING_API_BASE,
  LOCAL_STAGING_API_BASE,
  PRODUCTION_API_BASE,
  resolveApiBase,
  resolveRuntimeEnvironment,
} from '../core/environment.js';

assert.equal(ADMIN_APP_ORIGIN, 'https://admin.va-tools.ru');
assert.equal(PRODUCTION_API_BASE, 'https://api.va-tools.ru');
assert.equal(resolveApiBase({ hostname: 'localhost' }), LOCAL_STAGING_API_BASE);
assert.equal(resolveApiBase({ hostname: '127.0.0.1' }), LOCAL_STAGING_API_BASE);
assert.equal(resolveApiBase({ hostname: 'admin.va-tools.ru' }), PRODUCTION_API_BASE);
assert.equal(resolveApiBase({ hostname: 'api.va-tools.ru' }), PRODUCTION_API_BASE);
assert.equal(resolveApiBase({ hostname: 'prof.va-tools.ru' }), '');
assert.equal(resolveApiBase({ hostname: 'user.va-tools.ru' }), '');
assert.equal(resolveApiBase({ hostname: 'app.va-tools.ru' }), '');
assert.equal(resolveApiBase({ hostname: 'example.test', override: 'https://staging-api.example.test/' }), 'https://staging-api.example.test');
assert.equal(resolveApiBase({ hostname: 'demo-8080.app.github.dev' }), CODESPACES_STAGING_API_BASE);
assert.equal(resolveRuntimeEnvironment({ hostname: 'admin.va-tools.ru' }), 'production');
assert.equal(resolveRuntimeEnvironment({ hostname: 'prof.va-tools.ru' }), 'staging');
console.log('Core Admin API environment: PASS');
