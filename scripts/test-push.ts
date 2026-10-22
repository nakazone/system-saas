/**
 * Send a test Web Push to a tenant (default: senior-floors).
 *
 *   railway run npx tsx scripts/test-push.ts
 *   railway run npx tsx scripts/test-push.ts --org senior-floors
 *   railway run npx tsx scripts/test-push.ts --org senior-floors --email leads@senior-floors.com
 */
import "dotenv/config";
import { prisma } from "../src/lib/prisma.js";
import { notifyOrganizationPush, notifyUsersPush } from "../src/lib/push/notify.js";

function arg(name: string, fallback = ""): string {
  const i = process.argv.indexOf(name);
  if (i >= 0 && process.argv[i + 1]) return String(process.argv[i + 1]);
  return fallback;
}

async function main() {
  const slug = arg("--org", "senior-floors");
  const email = arg("--email", "");

  const org = await prisma.organization.findFirst({
    where: { OR: [{ slug }, { name: { contains: "Senior Floors", mode: "insensitive" } }] },
    select: { id: true, slug: true, name: true },
  });
  if (!org) {
    console.error(`Organization not found for slug/name: ${slug}`);
    process.exit(1);
  }

  const totalSubs = await prisma.pushSubscription.count({ where: { organizationId: org.id } });
  console.log(`Org: ${org.name} (${org.slug}) id=${org.id}`);
  console.log(`Push subscriptions: ${totalSubs}`);

  if (totalSubs === 0) {
    console.error("Nenhuma subscription neste tenant. Ative alertas em Configurações › App neste dispositivo.");
    process.exit(2);
  }

  const payload = {
    title: "ObraMate — teste",
    body: `Notificação de teste · ${org.name} · ${new Date().toLocaleString("pt-BR")}`,
    url: "/home.html",
    tag: `test-${Date.now()}`,
  };

  let result;
  if (email) {
    const user = await prisma.user.findFirst({
      where: { organizationId: org.id, email: { equals: email, mode: "insensitive" } },
      select: { id: true, email: true, name: true },
    });
    if (!user) {
      console.error(`User not found: ${email}`);
      process.exit(1);
    }
    console.log(`Target user: ${user.name || user.email} (${user.id})`);
    result = await notifyUsersPush(org.id, [user.id], payload);
  } else {
    console.log("Target: all devices in organization");
    result = await notifyOrganizationPush(org.id, payload);
  }

  console.log(`Done. sent=${result.sent} pruned=${result.pruned}`);
  if (result.sent === 0) {
    console.error("Nenhum dispositivo recebeu. Verifique permissão de notificação / app instalado.");
    process.exit(3);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
