import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';

export type HistoryActor = {
  platformAccountId: string;
  role?: string;
  reason?: string;
};

// The trigger and source mutation share an atomic, transaction-local context.
export async function withTenantHistoryActor<T>(
  prisma: PrismaService,
  actor: HistoryActor | undefined,
  operation: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  const actorId = String(actor?.platformAccountId || '').trim();
  const role = String(actor?.role || '').trim();
  const reason = String(actor?.reason || '').trim().slice(0, 500);
  const correlationId = randomUUID();
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`
      SELECT
        set_config('co_va.history_actor_id', ${actorId}, true) AS actor_id,
        set_config('co_va.history_actor_role', ${role}, true) AS actor_role,
        set_config('co_va.history_reason', ${reason}, true) AS reason,
        set_config('co_va.history_correlation_id', ${correlationId}, true) AS correlation_id
    `;
    return operation(tx);
  });
}
