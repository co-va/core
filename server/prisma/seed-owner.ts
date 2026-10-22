import { PrismaClient, MembershipRole } from '@prisma/client';
import { hash } from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const email = String(process.env.OWNER_EMAIL || '').trim().toLowerCase();
  const password = String(process.env.OWNER_PASSWORD || '');
  const tenantName = String(process.env.OWNER_TENANT_NAME || 'Book').trim() || 'Book';

  if (!email || password.length < 10) {
    throw new Error('OWNER_EMAIL and OWNER_PASSWORD (minimum 10 characters) are required');
  }

  const existing = await prisma.platformAccount.findUnique({
    where: { email },
    include: { memberships: { orderBy: { createdAt: 'asc' } } },
  });

  const passwordHash = await hash(password, 12);

  if (existing?.memberships?.[0]) {
    await prisma.$transaction(async (tx) => {
      await tx.platformAccount.update({
        where: { id: existing.id },
        data: { passwordHash },
      });
      await tx.tenantAccess.upsert({
        where: { tenantId: existing.memberships[0].tenantId },
        create: {
          tenantId: existing.memberships[0].tenantId,
          status: 'ACTIVE',
          isOwnerBook: true,
          commercialMode: 'LIVE',
        },
        update: {
          status: 'ACTIVE',
          isOwnerBook: true,
          commercialMode: 'LIVE',
        },
      });
      await tx.platformAdmin.upsert({
        where: { platformAccountId: existing.id },
        create: { platformAccountId: existing.id },
        update: {},
      });
    });
    return;
  }

  await prisma.$transaction(async (tx) => {
    const tenant = await tx.tenant.create({ data: { name: tenantName } });
    const account = await tx.platformAccount.create({
      data: { email, passwordHash },
    });
    await tx.membership.create({
      data: { tenantId: tenant.id, platformAccountId: account.id, role: MembershipRole.OWNER },
    });
    await tx.tenantAccess.create({
      data: {
        tenantId: tenant.id,
        status: 'ACTIVE',
        isOwnerBook: true,
        commercialMode: 'LIVE',
      },
    });
    await tx.platformAdmin.create({ data: { platformAccountId: account.id } });
  });
}

main()
  .finally(() => prisma.$disconnect());
