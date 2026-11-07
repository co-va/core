import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';

const require = createRequire(import.meta.url);
const { PrismaClient } = require('@prisma/client');
const { ProfessionalServiceNoticeService } = require('../dist/notification/professional-service-notice.service.js');
const { ProfessionalServiceEmailOutboxWorker } = require('../dist/notification/professional-service-email-outbox.worker.js');

const prisma = new PrismaClient();
const marker = randomUUID();
const tenantId = 'mail-smoke-' + marker;
const ownerId = 'mail-owner-' + marker;
const sent = [];
const pushSent = [];
let failOnce = true;
const transport = {
  async send(payload) {
    sent.push(payload);
    if (failOnce) {
      failOnce = false;
      throw new Error('temporary SMTP failure for private@example.invalid');
    }
    return { messageId: '<accepted-' + sent.length + '@example.invalid>' };
  },
};
const notices = new ProfessionalServiceNoticeService(prisma, {
  async send(_owner, item) {
    pushSent.push(item);
    return { sent: 1, failed: 0 };
  },
});
const worker = new ProfessionalServiceEmailOutboxWorker(prisma, transport);
const secondWorker = new ProfessionalServiceEmailOutboxWorker(prisma, transport);

async function makeNotice(title) {
  const notice = await notices.createForTenantOwner(tenantId, {
    type: 'booking.created', title, body: 'Confirmed record',
  });
  assert.ok(notice?.id, 'notice remains available to Push and owner UI');
  return notice.id;
}
async function state(id) {
  const rows = await prisma.$queryRaw`
    SELECT "status", "attempts", "providerMessageId", "lastError"
    FROM "ProfessionalServiceEmailOutbox" WHERE "noticeId" = ${id}
  `;
  assert.equal(rows.length, 1);
  return rows[0];
}

try {
  await prisma.tenant.create({ data: { id: tenantId, name: 'Isolated Service Email smoke' } });
  await prisma.platformAccount.create({ data: {
    id: ownerId, email: 'service-email-' + marker + '@example.invalid', passwordHash: 'fixture-only',
  } });
  await prisma.membership.create({ data: { tenantId, platformAccountId: ownerId, role: 'OWNER' } });
  await prisma.$executeRaw`
    UPDATE "PlatformAccount" SET "emailVerifiedAt" = CURRENT_TIMESTAMP WHERE "id" = ${ownerId}
  `;

  const first = await makeNotice('Initial booking');
  assert.equal((await state(first)).status, 'PENDING', 'outbox committed alongside notice');
  await worker.scan();
  assert.equal((await state(first)).status, 'RETRY', 'temporary Postbox error must persist');
  assert.match((await state(first)).lastError, /\[email\]/, 'PII in provider error redacted');
  assert.equal(sent.length, 1);
  await prisma.$executeRaw`
    UPDATE "ProfessionalServiceEmailOutbox"
    SET "nextAttemptAt" = CURRENT_TIMESTAMP - INTERVAL '1 minute'
    WHERE "noticeId" = ${first}
  `;
  await secondWorker.scan();
  assert.equal((await state(first)).status, 'SENT');
  assert.equal((await state(first)).attempts, 2);
  assert.equal(sent.length, 2);
  assert.equal(sent[0].idempotencyKey, first, 'MIME Message-ID is stable across retry');

  // An explicit opt-out wins even after the notice was queued.
  await prisma.platformNotificationPreference.create({ data: {
    tenantId, platformAccountId: ownerId, emailEnabled: false,
  } });
  const optOut = await makeNotice('Opted-out booking');
  await worker.scan();
  assert.equal((await state(optOut)).status, 'SKIPPED');
  assert.equal(sent.length, 2, 'opt-out cannot reach the SMTP provider');

  // Verification of the CURRENT account address, not Profile.emails.
  await prisma.platformNotificationPreference.delete({
    where: { tenantId_platformAccountId: { tenantId, platformAccountId: ownerId } },
  });
  await prisma.$executeRaw`
    UPDATE "PlatformAccount" SET "emailVerifiedAt" = NULL WHERE "id" = ${ownerId}
  `;
  const unverified = await makeNotice('Unverified account');
  await worker.scan();
  assert.equal((await state(unverified)).status, 'SKIPPED');
  assert.equal(sent.length, 2);

  // Missing preference is default-on, but only after verified account Email.
  await prisma.$executeRaw`
    UPDATE "PlatformAccount" SET "emailVerifiedAt" = CURRENT_TIMESTAMP WHERE "id" = ${ownerId}
  `;
  const defaultOn = await makeNotice('Default Email preference');
  await worker.scan();
  assert.equal((await state(defaultOn)).status, 'SENT');
  assert.equal(sent.length, 3);

  // Crash after a claim: an expired processing lease is reclaimed.
  const crashed = await makeNotice('Recovered after crash');
  await prisma.$executeRaw`
    UPDATE "ProfessionalServiceEmailOutbox"
    SET "status" = 'PROCESSING', "attempts" = 1,
        "lockedUntil" = CURRENT_TIMESTAMP - INTERVAL '1 minute'
    WHERE "noticeId" = ${crashed}
  `;
  await worker.scan();
  assert.equal((await state(crashed)).status, 'SENT');
  assert.equal((await state(crashed)).attempts, 2);

  // Multiple replicas cannot claim the same due jobs.
  const parallel = await Promise.all([makeNotice('Parallel 1'), makeNotice('Parallel 2')]);
  await Promise.all([worker.scan(), secondWorker.scan()]);
  assert.ok((await state(parallel[0])).status === 'SENT');
  assert.ok((await state(parallel[1])).status === 'SENT');
  for (const id of parallel) {
    assert.equal(sent.filter(x => x.idempotencyKey === id).length, 1, 'exactly one concurrent claim');
  }

  // A crash after the final attempt becomes FAILED without another SMTP send.
  const exhausted = await makeNotice('Exhausted after interrupted worker');
  await prisma.$executeRaw`
    UPDATE "ProfessionalServiceEmailOutbox"
    SET "status" = 'PROCESSING', "attempts" = 12,
        "lockedUntil" = CURRENT_TIMESTAMP - INTERVAL '1 minute'
    WHERE "noticeId" = ${exhausted}
  `;
  const countBeforeRecovery = sent.length;
  await worker.scan();
  assert.equal((await state(exhausted)).status, 'FAILED');
  assert.equal(sent.length, countBeforeRecovery);

  assert.equal(pushSent.length, 8, 'Push should remain independent of Email outcome');
  console.log('Professional Service Email outbox: atomic enqueue, Postbox retry, preferences, verification, crash recovery and multi-replica claim PASS');
} finally {
  await prisma.tenant.deleteMany({ where: { id: tenantId } }).catch(() => undefined);
  await prisma.platformAccount.deleteMany({ where: { id: ownerId } }).catch(() => undefined);
  await prisma.$disconnect();
}
