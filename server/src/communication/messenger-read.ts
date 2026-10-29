import { PrismaService } from '../prisma.service';

export type MessengerUnreadDirection = 'inbound' | 'outbound';

export async function markMessengerConversationRead(
  prisma: PrismaService,
  tenantId: string,
  conversationId: string,
  direction: MessengerUnreadDirection,
) {
  const readCount = await prisma.$executeRaw`
    UPDATE "CommunicationMessage"
    SET "readAt" = CURRENT_TIMESTAMP,
        "deliveredAt" = COALESCE("deliveredAt", CURRENT_TIMESTAMP),
        "status" = 'read'
    WHERE "tenantId" = ${tenantId}
      AND "conversationId" = ${conversationId}
      AND "purpose" = 'DIRECT'
      AND "channel" = 'IN_APP'
      AND "direction" = ${direction}
      AND "readAt" IS NULL
      AND "failedAt" IS NULL
  `;

  return { readCount: Math.max(0, Number(readCount || 0)) };
}
