import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const prelaunchMigration = '20260922075500_prelaunch_hard_delete_clean_start';
const firstRunCleanupMigration = '20260930143000_remove_first_run_runtime';
const depositBenefitMigration = '20261008214500_deposit_benefit_balances';
const pricePercentGuardMigration = '20261009014500_loyalty_price_percent_guard';
const failedHistoryWriterMigration = '20261106235900_history_writer_preserve_transfer';

async function tableExists(name) {
  const rows = await prisma.$queryRawUnsafe(
    'SELECT to_regclass($1) IS NOT NULL AS "exists"',
    '"' + name + '"',
  );
  return rows[0]?.exists === true;
}

async function columnExists(table, column) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = $1
        AND column_name = $2
    ) AS "exists"`,
    table,
    column,
  );
  return rows[0]?.exists === true;
}

async function triggerExists(name) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT EXISTS (
      SELECT 1
      FROM pg_trigger
      WHERE tgname = $1
        AND NOT tgisinternal
    ) AS "exists"`,
    name,
  );
  return rows[0]?.exists === true;
}

async function constraintExists(name) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT EXISTS (
      SELECT 1
      FROM pg_constraint
      WHERE conname = $1
    ) AS "exists"`,
    name,
  );
  return rows[0]?.exists === true;
}

async function failedMigration(name) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT
       "id",
       "migration_name",
       "logs",
       "finished_at",
       "rolled_back_at",
       "started_at",
       "applied_steps_count"
     FROM "_prisma_migrations"
     WHERE "migration_name" = $1
     ORDER BY "started_at" DESC`,
    name,
  );
  return rows.find((row) => row.finished_at == null && row.rolled_back_at == null) || null;
}

async function main() {
  const failedPrelaunch = await failedMigration(prelaunchMigration);
  if (failedPrelaunch) {
    if (!String(failedPrelaunch.logs || '').trim()) {
      console.warn('[prelaunch-recovery] failed 07:55 row has no stored error log; validating database state instead');
    }

    const state = {
      liveRequestedAt: await columnExists('TenantAccess', 'liveRequestedAt'),
      liveRequestedByPlatformAccountId: await columnExists('TenantAccess', 'liveRequestedByPlatformAccountId'),
      liveApprovedAt: await columnExists('TenantAccess', 'liveApprovedAt'),
      liveApprovedByAdminId: await columnExists('TenantAccess', 'liveApprovedByAdminId'),
      platformConsentTrigger: await triggerExists('PlatformConsentEvent_append_only'),
      platformActivityTrigger: await triggerExists('PlatformActivityEvent_append_only'),
      platformConsentTenantFk: await constraintExists('PlatformConsentEvent_tenantId_fkey'),
      platformConsentAccountFk: await constraintExists('PlatformConsentEvent_platformAccountId_fkey'),
      workspaceTenantFk: await constraintExists('WorkspaceState_tenantId_fkey'),
      workspaceAccountFk: await constraintExists('WorkspaceState_platformAccountId_fkey'),
    };

    const expectedFullyRolledBack =
      !state.liveRequestedAt
      && !state.liveRequestedByPlatformAccountId
      && !state.liveApprovedAt
      && !state.liveApprovedByAdminId
      && state.platformConsentTrigger
      && state.platformActivityTrigger
      && !state.platformConsentTenantFk
      && !state.platformConsentAccountFk
      && !state.workspaceTenantFk
      && !state.workspaceAccountFk;

    if (!expectedFullyRolledBack) {
      console.error('[prelaunch-recovery] database is not in the expected pre-07:55 state');
      console.error('[prelaunch-recovery] refusing automatic resolve:', JSON.stringify(state));
      return 2;
    }

    console.warn('[prelaunch-recovery] failed 07:55 is fully rolled back and may be safely retried');
    return 42;
  }

  const failedCleanup = await failedMigration(firstRunCleanupMigration);
  if (failedCleanup) {
    const state = {
      firstRunScenario: await tableExists('FirstRunScenario'),
      firstRunScenarioVersion: await tableExists('FirstRunScenarioVersion'),
      firstRunStep: await tableExists('FirstRunStep'),
      firstRunProgress: await tableExists('FirstRunProgress'),
      firstRunStepProgress: await tableExists('FirstRunStepProgress'),
      platformSession: await tableExists('PlatformSession'),
      activitySessionId: await columnExists('PlatformActivityEvent', 'sessionId'),
      activityStepKey: await columnExists('PlatformActivityEvent', 'stepKey'),
      activityScenarioVersionId: await columnExists('PlatformActivityEvent', 'scenarioVersionId'),
      accountOnboardingStep: await columnExists('PlatformAccount', 'onboardingStep'),
      accountWorkspaceUnlocked: await columnExists('PlatformAccount', 'workspaceUnlocked'),
    };
    if (!Object.values(state).every(Boolean)) {
      console.error('[prelaunch-recovery] failed first-run cleanup is not fully rolled back');
      console.error('[prelaunch-recovery] refusing automatic resolve:', JSON.stringify(state));
      return 2;
    }
    console.warn('[prelaunch-recovery] failed first-run cleanup is fully rolled back and may be safely retried');
    return 43;
  }

  const failedDepositBenefit = await failedMigration(depositBenefitMigration);
  if (failedDepositBenefit) {
    console.warn('[prelaunch-recovery] failed Deposit benefit migration detected; migration is retry-safe and must be resolved as rolled back before retry');
    if (String(failedDepositBenefit.logs || '').trim()) {
      console.warn('[prelaunch-recovery] stored Deposit migration error:', String(failedDepositBenefit.logs).slice(0, 2000));
    }
    return 44;
  }

  const failedPriceGuard = await failedMigration(pricePercentGuardMigration);
  if (failedPriceGuard) {
    console.warn('[prelaunch-recovery] failed price-percent guard migration detected; migration is retry-safe and must be resolved as rolled back before retry');
    if (String(failedPriceGuard.logs || '').trim()) {
      console.warn('[prelaunch-recovery] stored price guard migration error:', String(failedPriceGuard.logs).slice(0, 2000));
    }
    return 45;
  }

  // Only the named, fully rolled-back SQL delimiter failure is recoverable.
  const failedWriter = await failedMigration(failedHistoryWriterMigration);
  if (failedWriter) {
    const rows = await prisma.$queryRawUnsafe(
      `SELECT pg_get_functiondef(p.oid) AS "definition"
       FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
       WHERE n.nspname='public' AND p.proname='professional_history_write'
       LIMIT 1`,
    );
    const definition = String(rows[0]?.definition || '');
    const logs = String(failedWriter.logs || '');
    const safeState = Number(failedWriter.applied_steps_count || 0) === 0
      && definition.includes('enriched')
      && !definition.includes('co_va.transfer_provenance')
      && (logs.includes('42601') || logs.includes('syntax error') || !logs.trim());
    if (!safeState) {
      console.error('[history-writer-recovery] unexpected DB state; refusing automatic recovery');
      return 2;
    }
    console.warn('[history-writer-recovery] failed migration fully rolled back; safe to retry');
    return 46;
  }

  console.log('[prelaunch-recovery] no active failed recoverable migration');
  return 0;
}

let status = 2;
try {
  status = await main();
} catch (error) {
  console.error('[prelaunch-recovery] verification failed:', error);
  status = 2;
} finally {
  await prisma.$disconnect().catch(() => {});
}

process.exitCode = status;
