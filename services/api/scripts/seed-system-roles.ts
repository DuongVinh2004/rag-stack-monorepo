import { PrismaClient, SystemRole } from '@prisma/client';

async function main() {
  const prisma = new PrismaClient();
  const adminEmail = readFlag('--adminEmail');

  try {
    for (const roleName of Object.values(SystemRole)) {
      await prisma.role.upsert({
        where: { name: roleName },
        update: {},
        create: { name: roleName },
      });
    }

    if (adminEmail) {
      const user = await prisma.user.findUnique({
        where: { email: adminEmail },
      });
      if (!user) {
        throw new Error(`User not found for adminEmail=${adminEmail}`);
      }

      const superAdminRole = await prisma.role.findUniqueOrThrow({
        where: { name: SystemRole.SUPER_ADMIN },
      });

      await prisma.userRole.upsert({
        where: {
          userId_roleId: {
            userId: user.id,
            roleId: superAdminRole.id,
          },
        },
        update: {},
        create: {
          userId: user.id,
          roleId: superAdminRole.id,
        },
      });

      console.log(`Granted SUPER_ADMIN to ${adminEmail}`);
    }

    console.log('Seeded system roles successfully.');
  } finally {
    await prisma.$disconnect();
  }
}

function readFlag(flag: string) {
  const index = process.argv.findIndex((value) => value === flag);
  if (index === -1) {
    return undefined;
  }
  return process.argv[index + 1];
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
