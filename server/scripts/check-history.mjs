import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
const require = createRequire(import.meta.url);
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const id = randomUUID();
const tenantId = `history-tenant-${id}`;
const accountId = `history-account-${id}`;
const rollback = new Error('history-smoke-rolled-back');
try {
  try {
    await prisma.$transaction(async tx => {
      await tx.tenant.create({ data: { id: tenantId, name: 'Isolated History smoke' } });
      await tx.account.create({ data: {
        id: accountId, email: `history-${id}@example.invalid`,
        passwordHash: 'never-store-this-secret-in-history',
      } });

      await tx.event.create({ data: {
        id: `tenant-event-${id}`, tenantId, ownerType: 'tenant', ownerId: tenantId,
        date: '2026-11-06', from: '12:00', to: '13:00', title: 'Tenant event',
      } });
      await tx.note.create({ data: {
        id: `tenant-note-${id}`, tenantId, ownerType: 'profile', ownerId: 'tenant-profile',
        date: '2026-11-06', title: 'Tenant note',
      } });
      await tx.event.create({ data: {
        id: `account-event-${id}`, tenantId: null, ownerType: 'account', ownerId: accountId,
        date: '2026-11-06', from: '14:00', to: '15:00', title: 'Account event',
      } });
      await tx.note.create({ data: {
        id: `account-note-${id}`, tenantId: null, ownerType: 'account', ownerId: accountId,
        date: '2026-11-06', title: 'Account note',
      } });

      // Technical login facts belong to PlatformActivityEvent only.
      await tx.platformActivityEvent.create({ data: {
        tenantId: null,
        subjectAccountId: accountId,
        platformAccountId: null,
        eventType: 'AUTH_LOGIN_SUCCEEDED',
        metadata: { scope: 'platform', entityType: 'authentication', result: 'success' },
      } });
      await tx.platformActivityEvent.create({ data: {
        tenantId: null,
        subjectAccountId: null,
        eventType: 'AUTH_LOGIN_DENIED',
        metadata: { scope: 'platform', entityType: 'authentication', result: 'denied' },
      } });
      const loginFacts = await tx.platformActivityEvent.findMany({
        where: { subjectAccountId: accountId },
      });
      assert.equal(loginFacts.length, 1, 'known User login has one platform-owned fact');

      const tenantEvents = await tx.$queryRaw`
        SELECT "entityType" FROM "BusinessHistoryEvent"
        WHERE "tenantId"=${tenantId} AND "entityType" IN ('event','note')
      `;
      const accountEvents = await tx.$queryRaw`
        SELECT "entityType" FROM "AccountHistoryEvent" WHERE "accountId"=${accountId}
      `;
      assert.equal(tenantEvents.length, 2, 'tenant events and notes stay in tenant History');
      assert.equal(accountEvents.length, 3, 'account signup, event and note stay in account History');
      assert.ok(tenantEvents.some(v => v.entityType === 'event'));
      assert.ok(tenantEvents.some(v => v.entityType === 'note'));
      assert.ok(accountEvents.some(v => v.entityType === 'account'));
      assert.ok(accountEvents.some(v => v.entityType === 'event'));
      assert.ok(accountEvents.some(v => v.entityType === 'note'));

      await tx.event.delete({ where: { id: `tenant-event-${id}` } });
      await tx.note.delete({ where: { id: `account-note-${id}` } });
      const deletedTenant = await tx.$queryRaw`
        SELECT "data" FROM "BusinessHistoryEvent"
        WHERE "tenantId"=${tenantId} AND "entityType"='event' AND "eventType"='delete'
      `;
      const deletedAccount = await tx.$queryRaw`
        SELECT "data" FROM "AccountHistoryEvent"
        WHERE "accountId"=${accountId} AND "entityType"='note' AND "eventType"='delete'
      `;
      assert.equal(deletedTenant.length, 1, 'tenant deleted event retains audit snapshot');
      assert.equal(deletedAccount.length, 1, 'account deleted note retains audit snapshot');
      assert.equal(deletedTenant[0].data.deleted.title, 'Tenant event');
      assert.equal(deletedAccount[0].data.deleted.title, 'Account note');

      const leak = await tx.$queryRaw`
        SELECT COUNT(*)::integer AS count FROM "AccountHistoryEvent"
        WHERE "accountId"=${accountId}
          AND ("data"::text LIKE '%never-store-this-secret-in-history%'
               OR "data"::text LIKE '%passwordHash%')
      `;
      assert.equal(leak[0].count, 0, 'credential values must never enter account History');
      throw rollback;
    }, {timeout:30000});
    assert.fail('History smoke transaction should always roll back');
  } catch (error) {
    if (error !== rollback) throw error;
  }
  assert.equal(await prisma.account.count({where:{id:accountId}}),0);
  assert.equal(await prisma.tenant.count({where:{id:tenantId}}),0);
  console.log('PASS: History owner separation, atomic deletion facts, credential minimization and rollback');
} finally {
  await prisma.$disconnect();
}
