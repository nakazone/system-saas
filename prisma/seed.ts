import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/lib/auth/password.js";
import { DEFAULT_PERMISSIONS } from "../src/lib/tenant/defaults.js";

const prisma = new PrismaClient();

async function main() {
  for (const permission of DEFAULT_PERMISSIONS) {
    await prisma.permission.upsert({
      where: { key: permission.key },
      create: {
        key: permission.key,
        group: permission.group,
        description: permission.description,
      },
      update: {
        group: permission.group,
        description: permission.description,
      },
    });
  }

  const platformEmail = process.env.PLATFORM_ADMIN_EMAIL ?? "platform@localhost";
  const platformPassword = process.env.PLATFORM_ADMIN_PASSWORD ?? "changeme-platform-admin";
  const passwordHash = await hashPassword(platformPassword);

  await prisma.platformAdmin.upsert({
    where: { email: platformEmail },
    create: {
      email: platformEmail,
      name: "Platform Admin",
      passwordHash,
      status: "active",
    },
    update: { passwordHash },
  });

  console.log(`Seeded ${DEFAULT_PERMISSIONS.length} permissions`);
  console.log(`Platform admin: ${platformEmail}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
