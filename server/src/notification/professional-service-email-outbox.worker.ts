import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { TransactionalEmailService } from '../transactional-email/transactional-email.service';
import {
  MAX_SERVICE_EMAIL_ATTEMPTS,
  SERVICE_EMAIL_BATCH_SIZE,
  SERVICE_EMAIL_LEASE_SECONDS,
  SERVICE_EMAIL_SCAN_INTERVAL_MS,
  serviceEmailErrorSummary,
  serviceEmailRetryDelayMs,
  serviceEmailShouldRetry,
} from './service-email-retry-policy';

type EmailOutboxJob = { noticeId: string; attempts: number };
type OwnerNoticeEmail = {
  id: string;
  title: string;
  body: string;
  email: string | null;
  emailVerifiedAt: Date | null;
  emailEnabled: boolean | null;
};

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;',
  })[character] || character);
}

@Injectable()
export class ProfessionalServiceEmailOutboxWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ProfessionalServiceEmailOutboxWorker.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private scanning = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: TransactionalEmailService,
  ) {}

  onModuleInit() {
    // A database-backed queue survives process restarts and runs across replicas.
    void this.scan().catch((error) => this.logger.error('Service Email scan failed: ' + serviceEmailErrorSummary(error)));
    this.timer = setInterval(() => {
      void this.scan().catch((error) => this.logger.error('Service Email scan failed: ' + serviceEmailErrorSummary(error)));
    }, SERVICE_EMAIL_SCAN_INTERVAL_MS);
    this.timer.unref?.();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async reclaimExhausted() {
    // A process can crash during the final attempt. A stale lease must not
    // remain PROCESSING forever or cause an extra uncontrolled SMTP attempt.
    await this.prisma.$executeRaw`
      UPDATE "ProfessionalServiceEmailOutbox"
      SET "status" = 'FAILED', "lockedUntil" = NULL,
          "lastError" = COALESCE("lastError", 'Worker interrupted after final attempt'),
          "updatedAt" = CURRENT_TIMESTAMP
      WHERE "status" = 'PROCESSING'
        AND "lockedUntil" <= CURRENT_TIMESTAMP
        AND "attempts" >= ${MAX_SERVICE_EMAIL_ATTEMPTS}
    `;
  }

  private async claim(): Promise<EmailOutboxJob | null> {
    // A single atomic claim, safe when multiple Core instances are running.
    const claimed = await this.prisma.$queryRaw<EmailOutboxJob[]>`
      WITH next AS (
        SELECT "noticeId"
        FROM "ProfessionalServiceEmailOutbox"
        WHERE "attempts" < ${MAX_SERVICE_EMAIL_ATTEMPTS}
          AND (
            ("status" IN ('PENDING', 'RETRY') AND "nextAttemptAt" <= CURRENT_TIMESTAMP)
            OR ("status" = 'PROCESSING' AND "lockedUntil" <= CURRENT_TIMESTAMP)
          )
        ORDER BY "nextAttemptAt" ASC, "createdAt" ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )
      UPDATE "ProfessionalServiceEmailOutbox" AS queue
      SET "status" = 'PROCESSING',
          "attempts" = queue."attempts" + 1,
          "lockedUntil" = CURRENT_TIMESTAMP + (${SERVICE_EMAIL_LEASE_SECONDS} * INTERVAL '1 second'),
          "updatedAt" = CURRENT_TIMESTAMP
      FROM next
      WHERE queue."noticeId" = next."noticeId"
      RETURNING queue."noticeId", queue."attempts"
    `;
    return claimed[0] || null;
  }

  private async notice(noticeId: string): Promise<OwnerNoticeEmail | null> {
    // Recheck verified current account email and preference for *every* attempt.
    // Additional profile contact addresses must not receive these notices.
    const rows = await this.prisma.$queryRaw<OwnerNoticeEmail[]>`
      SELECT notice."id", notice."title", notice."body",
             account."email", account."emailVerifiedAt",
             preference."emailEnabled"
      FROM "ProfessionalServiceNotice" AS notice
      JOIN "PlatformAccount" AS account ON account."id" = notice."platformAccountId"
      LEFT JOIN "PlatformNotificationPreference" AS preference
        ON preference."tenantId" = notice."tenantId"
       AND preference."platformAccountId" = notice."platformAccountId"
      WHERE notice."id" = ${noticeId}
      LIMIT 1
    `;
    return rows[0] || null;
  }

  private async complete(noticeId: string, attempt: number, status: 'SENT' | 'SKIPPED', messageId = '') {
    await this.prisma.$executeRaw`
      UPDATE "ProfessionalServiceEmailOutbox"
      SET "status" = ${status}, "lockedUntil" = NULL,
          "sentAt" = CASE WHEN ${status} = 'SENT' THEN CURRENT_TIMESTAMP ELSE NULL END,
          "providerMessageId" = NULLIF(${messageId}, ''),
          "lastError" = NULL,
          "updatedAt" = CURRENT_TIMESTAMP
      WHERE "noticeId" = ${noticeId} AND "attempts" = ${attempt}
        AND "status" = 'PROCESSING'
    `;
  }

  private async fail(job: EmailOutboxJob, error: unknown) {
    const reason = serviceEmailErrorSummary(error);
    const retry = serviceEmailShouldRetry(job.attempts);
    const nextAttemptAt = new Date(Date.now() + serviceEmailRetryDelayMs(job.attempts));
    await this.prisma.$executeRaw`
      UPDATE "ProfessionalServiceEmailOutbox"
      SET "status" = ${retry ? 'RETRY' : 'FAILED'},
          "lockedUntil" = NULL, "nextAttemptAt" = ${nextAttemptAt},
          "lastError" = ${reason}, "updatedAt" = CURRENT_TIMESTAMP
      WHERE "noticeId" = ${job.noticeId} AND "attempts" = ${job.attempts}
        AND "status" = 'PROCESSING'
    `;
    const severity = retry ? 'warn' : 'error';
    this.logger[severity](`Service Email ${retry ? 'queued for retry' : 'exhausted retries'}: notice=${job.noticeId} attempt=${job.attempts} reason=${reason}`);
  }

  private async deliver(job: EmailOutboxJob) {
    try {
      const ownerNotice = await this.notice(job.noticeId);
      const recipient = String(ownerNotice?.email || '').trim().toLowerCase();
      if (!ownerNotice?.emailVerifiedAt || !recipient || ownerNotice.emailEnabled === false) {
        await this.complete(job.noticeId, job.attempts, 'SKIPPED');
        return;
      }

      const title = String(ownerNotice.title || '').trim() || 'Уведомление';
      const body = String(ownerNotice.body || '').trim() || title;
      const result = await this.email.send({
        to: recipient,
        subject: title,
        text: body,
        html: `<div style="font-family:Arial,sans-serif;line-height:1.5;color:#111"><h2>${escapeHtml(title)}</h2><p style="white-space:pre-wrap">${escapeHtml(body)}</p></div>`,
        tag: 'professional-service-notice',
        // Stable MIME Message-ID helps clients suppress duplicates after crash
        // recovery; SMTP cannot guarantee exactly-once delivery.
        idempotencyKey: job.noticeId,
      });
      await this.complete(job.noticeId, job.attempts, 'SENT', result.messageId);
    } catch (error) {
      await this.fail(job, error);
    }
  }

  async scan() {
    if (this.scanning) return { processed: 0 };
    this.scanning = true;
    let processed = 0;
    try {
      await this.reclaimExhausted();
      for (let i = 0; i < SERVICE_EMAIL_BATCH_SIZE; i += 1) {
        const job = await this.claim();
        if (!job) break;
        await this.deliver(job);
        processed += 1;
      }
      return { processed };
    } finally {
      this.scanning = false;
    }
  }
}
