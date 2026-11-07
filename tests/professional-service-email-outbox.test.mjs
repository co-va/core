import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  MAX_SERVICE_EMAIL_ATTEMPTS,
  serviceEmailRetryDelayMs,
  serviceEmailShouldRetry,
  serviceEmailErrorSummary,
} from '../server/src/notification/service-email-retry-policy.ts';

assert.equal(MAX_SERVICE_EMAIL_ATTEMPTS, 12);
assert.equal(serviceEmailRetryDelayMs(1), 60_000);
assert.equal(serviceEmailRetryDelayMs(2), 120_000);
assert.equal(serviceEmailRetryDelayMs(7), 3_840_000);
assert.equal(serviceEmailRetryDelayMs(12), 21_600_000);
assert.equal(serviceEmailShouldRetry(1), true);
assert.equal(serviceEmailShouldRetry(11), true);
assert.equal(serviceEmailShouldRetry(12), false);
assert.equal(serviceEmailShouldRetry(NaN), false);
assert.doesNotMatch(serviceEmailErrorSummary(new Error('SMTP: test.owner@example.com')), /test\.owner@example\.com/);
assert.match(serviceEmailErrorSummary(new Error('SMTP: test.owner@example.com')), /\[email\]/);
assert.ok(serviceEmailErrorSummary('a'.repeat(2000)).length <= 500);

const notice = readFileSync('server/src/notification/professional-service-notice.service.ts', 'utf8');
const worker = readFileSync('server/src/notification/professional-service-email-outbox.worker.ts', 'utf8');
const provider = readFileSync('server/src/transactional-email/transactional-email.service.ts', 'utf8');
const migration = readFileSync('server/prisma/migrations/20261107190000_professional_service_email_outbox/migration.sql', 'utf8');
const notificationModule = readFileSync('server/src/notification/notification.module.ts', 'utf8');
assert.match(notice, /WITH notice AS \([\s\S]*INSERT INTO "ProfessionalServiceNotice"[\s\S]*queued AS \([\s\S]*INSERT INTO "ProfessionalServiceEmailOutbox"/, 'notice and outbox must be an atomic SQL statement');
assert.doesNotMatch(notice, /void this\.sendServiceEmail/, 'unreliable fire-and-forget path must be gone');
assert.match(notice, /await this\.push\.send/, 'existing Push path must survive');
assert.match(migration, /"noticeId" TEXT PRIMARY KEY/, 'deduplicate every notice');
assert.match(migration, /ON DELETE CASCADE/, 'no orphan jobs after notice is deleted');
assert.match(worker, /FOR UPDATE SKIP LOCKED/, 'safe concurrent claims across replicas');
assert.match(worker, /"lockedUntil" <= CURRENT_TIMESTAMP/, 'reclaim jobs after worker crash');
assert.match(worker, /"emailVerifiedAt"/, 'verified PlatformAccount Email required');
assert.match(worker, /"emailEnabled"/, 'explicit Email preference required');
assert.doesNotMatch(worker, /Profile\.emails|profile\.emails/, 'no Profile fallback recipient');
assert.match(worker, /serviceEmailShouldRetry\(job\.attempts\)/, 'bounded retry');
assert.match(worker, /serviceEmailErrorSummary\(error\)/, 'safe error persistence');
assert.match(worker, /idempotencyKey: job\.noticeId/, 'stable MIME Message-ID on retry');
assert.match(notificationModule, /ProfessionalServiceEmailOutboxWorker,/, 'queue worker must run within NotificationModule');
assert.match(provider, /messageId: input\.idempotencyKey/, 'reuse Postbox with deterministic Message-ID');
console.log('Professional service Email outbox policy, correctness and regressions: PASS');
