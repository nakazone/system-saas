/**
 * Idempotent backfill of job chat channels for active WorkOrders.
 * Migration SQL already backfills on deploy; use this to re-sync members later:
 *
 *   npx tsx scripts/backfill-chat-job-channels.ts
 *   npx tsx scripts/backfill-chat-job-channels.ts --include-completed
 *   npx tsx scripts/backfill-chat-job-channels.ts --org <slug>
 */

import "dotenv/config";
import { prisma } from "../src/lib/prisma.js";
import { withTenantTransaction } from "../src/lib/tenant/prisma-tenant.js";
import { backfillJobChatChannelsForOrg } from "../src/lib/chat/job-channel.js";

async function main() {
  const args = process.argv.slice(2);
  const includeCompleted = args.includes("--include-completed");
  const orgIdx = args.indexOf("--org");
  const orgSlug = orgIdx >= 0 ? args[orgIdx + 1] : undefined;

  const orgs = await prisma.organization.findMany({
    where: orgSlug ? { slug: orgSlug } : undefined,
    select: { id: true, slug: true, name: true },
    orderBy: { slug: "asc" },
  });

  if (orgs.length === 0) {
    console.log(orgSlug ? `No organization with slug "${orgSlug}"` : "No organizations found");
    return;
  }

  let totalCreated = 0;
  let totalUpdated = 0;

  for (const org of orgs) {
    const result = await withTenantTransaction(org.id, async (tx) =>
      backfillJobChatChannelsForOrg(tx, org.id, { includeCompleted }),
    );
    totalCreated += result.created;
    totalUpdated += result.updated;
    console.log(
      `[${org.slug}] created=${result.created} updated=${result.updated}`,
    );
  }

  console.log(`Done. created=${totalCreated} updated=${totalUpdated}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
