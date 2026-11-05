/**
 * Gives existing job photos a real thumbnail. Until 2026-11 every photo stored thumbUrl = url,
 * so ObraCam lists downloaded the full 1280–1600px JPEG for every tile.
 * Idempotent: only photos whose thumbUrl is missing or equal to url are touched; the original is never changed.
 *
 *   npx tsx scripts/backfill-photo-thumbs.ts --dry-run
 *   npx tsx scripts/backfill-photo-thumbs.ts
 *   npx tsx scripts/backfill-photo-thumbs.ts --org <slug> --limit 500
 */

import "dotenv/config";
import type { Readable } from "node:stream";
import { prisma } from "../src/lib/prisma.js";
import { withTenantTransaction } from "../src/lib/tenant/prisma-tenant.js";
import { storage } from "../src/lib/storage/index.js";
import { uploadPhotoThumb } from "../src/lib/job-media/thumb.js";

const BATCH = 50;

async function readAll(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
  return Buffer.concat(chunks);
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const orgIdx = args.indexOf("--org");
  const orgSlug = orgIdx >= 0 ? args[orgIdx + 1] : undefined;
  const limIdx = args.indexOf("--limit");
  const limit = limIdx >= 0 ? Number(args[limIdx + 1]) || Infinity : Infinity;

  const orgs = await prisma.organization.findMany({
    where: orgSlug ? { slug: orgSlug } : undefined,
    select: { id: true, slug: true },
    orderBy: { slug: "asc" },
  });

  let done = 0;
  let skipped = 0;
  for (const org of orgs) {
    let cursor: string | undefined;
    let orgDone = 0;
    for (;;) {
      if (done >= limit) break;
      const rows = await withTenantTransaction(org.id, (tx) =>
        tx.jobMedia.findMany({
          where: {
            organizationId: org.id,
            type: "photo",
            deletedAt: null,
            OR: [{ thumbUrl: null }, { thumbUrl: { equals: prisma.jobMedia.fields.url } }],
            ...(cursor ? { id: { gt: cursor } } : {}),
          },
          select: { id: true, storageKey: true, url: true },
          orderBy: { id: "asc" },
          take: BATCH,
        }),
      );
      if (!rows.length) break;
      cursor = rows[rows.length - 1].id;
      for (const row of rows) {
        if (done >= limit) break;
        if (dryRun) {
          done += 1;
          continue;
        }
        const stream = await storage.getStream(row.storageKey).catch(() => null);
        if (!stream) {
          skipped += 1;
          continue;
        }
        const body = await readAll(stream);
        const thumbUrl = await uploadPhotoThumb(row.storageKey, body, row.url);
        if (thumbUrl === row.url) {
          skipped += 1;
          continue;
        }
        await withTenantTransaction(org.id, (tx) => tx.jobMedia.update({ where: { id: row.id }, data: { thumbUrl } }));
        done += 1;
        orgDone += 1;
      }
    }
    if (orgDone || dryRun) console.log(`[${org.slug}] ${dryRun ? "would update" : "updated"} so far: ${done}`);
  }
  console.log(`Done. ${dryRun ? "would update" : "updated"}=${done} skipped=${skipped}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
