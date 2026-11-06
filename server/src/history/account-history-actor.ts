import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';

export async function withAccountHistoryActor<T>(
  prisma: PrismaService,
  accountId: string,
  mutation: (tx: Prisma.TransactionClient) => Promise<T>,
  reason = '',
): Promise<T> {
  const actorId = String(accountId || '').trim();
  const correlationId = randomUUID();
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`
      SELECT
        set_config('co_va.account_history_actor_id', ${actorId}, true) AS actor_id,
        set_config('co_va.account_history_reason', ${String(reason || '').trim().slice(0,500)}, true) AS reason,
        set_config('co_va.account_history_correlation_id', ${correlationId}, true) AS correlation_id
    `;
    return mutation(tx);
  });
}
