/**
 * Senior Floors — consolidate Lojas into Builders and merge
 * "Company - ProjectId" customers into the parent company.
 *
 * Examples:
 *   Simply Floors  ← keep
 *   Simply - Naka  → jobs/notes → Simply Floors, project id "Naka"
 *   Simply - O'Hara → same
 *
 * Usage (dry-run default):
 *   railway ssh -s system-saas -- npx tsx scripts/consolidate-senior-floors-builders.ts
 *   railway ssh -s system-saas -- npx tsx scripts/consolidate-senior-floors-builders.ts --apply
 *
 * Local:
 *   npx tsx scripts/consolidate-senior-floors-builders.ts --org senior-floors
 *   npx tsx scripts/consolidate-senior-floors-builders.ts --org senior-floors --apply
 */
import "dotenv/config";
import { Prisma } from "@prisma/client";
import { prisma } from "../src/lib/prisma.js";
import { withTenantTransaction } from "../src/lib/tenant/prisma-tenant.js";

const APPLY = process.argv.includes("--apply");
const orgIdx = process.argv.indexOf("--org");
const ORG_SLUG = orgIdx >= 0 ? String(process.argv[orgIdx + 1] || "").trim() : "senior-floors";

type Cust = {
  id: string;
  name: string;
  customerType: string;
  notes: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  company: string | null;
  contactName: string | null;
  clientCode: string | null;
  dumpsterStatus: string | null;
  dumpsterNotes: string | null;
  storageStatus: string | null;
  storageNotes: string | null;
  jobCount: number;
};

function norm(s: string): string {
  return String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** "Simply - Naka" → { companyHint: "Simply", projectId: "Naka" } */
function parseCompanyProject(name: string): { companyHint: string; projectId: string | null } {
  const raw = String(name || "").trim().replace(/\s+/g, " ");
  const m = raw.match(/^(.+?)\s*[-–—]\s+(.+)$/);
  if (!m) return { companyHint: raw, projectId: null };
  const companyHint = m[1].trim();
  const projectId = m[2].trim();
  if (!companyHint || !projectId) return { companyHint: raw, projectId: null };
  // Avoid treating "Smith - Jones LLC" style as project when left side is a full company with Floors/Inc/etc
  // and right side looks like a legal suffix — still treat as project id (user request).
  return { companyHint, projectId };
}

function findKeepForHint(hint: string, candidates: Cust[]): Cust | null {
  const nHint = norm(hint);
  if (!nHint) return null;
  const scored = candidates
    .map((c) => {
      const n = norm(c.name);
      let score = 0;
      if (n === nHint) score = 100;
      else if (n.startsWith(nHint + " ")) score = 80 + Math.min(20, n.length - nHint.length);
      else if (nHint.startsWith(n + " ")) score = 40;
      else if (n.includes(nHint) || nHint.includes(n)) score = 20;
      else return null;
      score += Math.min(15, c.jobCount);
      return { c, score };
    })
    .filter(Boolean) as Array<{ c: Cust; score: number }>;
  scored.sort((a, b) => b.score - a.score || b.c.jobCount - a.c.jobCount || a.c.name.localeCompare(b.c.name));
  return scored[0]?.c || null;
}

function appendNotes(keep: string | null, projectId: string | null, mergeNotes: string | null, mergeName: string): string | null {
  const parts: string[] = [];
  if (keep && keep.trim()) parts.push(keep.trim());
  const block: string[] = [];
  if (projectId) block.push(`Projeto: ${projectId} (antes: ${mergeName})`);
  else block.push(`Mesclado de: ${mergeName}`);
  if (mergeNotes && mergeNotes.trim()) block.push(mergeNotes.trim());
  if (block.length) parts.push(block.join("\n"));
  const out = parts.join("\n\n----------------------------------\n\n").trim();
  return out || null;
}

async function loadCustomers(organizationId: string): Promise<Cust[]> {
  const rows = await prisma.customer.findMany({
    where: {
      organizationId,
      customerType: { in: ["builder", "loja", "contractor"] },
    },
    select: {
      id: true,
      name: true,
      customerType: true,
      notes: true,
      email: true,
      phone: true,
      address: true,
      company: true,
      contactName: true,
      clientCode: true,
      dumpsterStatus: true,
      dumpsterNotes: true,
      storageStatus: true,
      storageNotes: true,
      _count: { select: { workOrders: true } },
    },
    orderBy: { name: "asc" },
  });
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    customerType: r.customerType,
    notes: r.notes,
    email: r.email,
    phone: r.phone,
    address: r.address,
    company: r.company,
    contactName: r.contactName,
    clientCode: r.clientCode,
    dumpsterStatus: r.dumpsterStatus,
    dumpsterNotes: r.dumpsterNotes,
    storageStatus: r.storageStatus,
    storageNotes: r.storageNotes,
    jobCount: r._count.workOrders,
  }));
}

async function mergeIntoKeep(
  tx: Prisma.TransactionClient,
  organizationId: string,
  keep: Cust,
  merge: Cust,
  projectId: string | null,
): Promise<{ jobs: number; projects: number }> {
  const jobs = await tx.workOrder.findMany({
    where: { organizationId, customerId: merge.id },
    select: { id: true, title: true, notes: true, sourceName: true, sourceType: true },
  });

  for (const wo of jobs) {
    const title = String(wo.title || "").trim();
    const notes = String(wo.notes || "").trim();
    const tag = projectId ? `Projeto: ${projectId}` : null;
    let nextTitle = title;
    let nextNotes = notes;

    if (projectId) {
      const nTitle = norm(title);
      const nKeep = norm(keep.name);
      const nMerge = norm(merge.name);
      if (!title || nTitle === nMerge || nTitle === nKeep) {
        nextTitle = `${keep.name} - ${projectId}`;
      } else if (!nTitle.includes(norm(projectId))) {
        // Keep descriptive titles; project id goes in notes.
      }
      if (tag && !notes.toLowerCase().includes(tag.toLowerCase())) {
        nextNotes = notes ? `${tag}\n${notes}` : tag;
      }
    }

    await tx.workOrder.update({
      where: { id: wo.id },
      data: {
        customerId: keep.id,
        sourceType: "builder",
        sourceName: keep.name,
        title: nextTitle || wo.title,
        notes: nextNotes || null,
      },
    });
  }

  await tx.quote.updateMany({ where: { organizationId, customerId: merge.id }, data: { customerId: keep.id } });
  await tx.quoteInvoice.updateMany({ where: { organizationId, customerId: merge.id }, data: { customerId: keep.id } });
  await tx.project.updateMany({ where: { organizationId, customerId: merge.id }, data: { customerId: keep.id } });
  await tx.meeting.updateMany({ where: { organizationId, customerId: merge.id }, data: { customerId: keep.id } });
  await tx.siteAssessment.updateMany({ where: { organizationId, customerId: merge.id }, data: { customerId: keep.id } });
  await tx.scheduledMessage.updateMany({ where: { organizationId, customerId: merge.id }, data: { customerId: keep.id } });
  await tx.property.updateMany({ where: { organizationId, customerId: merge.id }, data: { customerId: keep.id } });
  await tx.communicationLog.updateMany({ where: { organizationId, customerId: merge.id }, data: { customerId: keep.id } });

  let projectsCreated = 0;
  if (projectId) {
    const existing = await tx.project.findFirst({
      where: {
        organizationId,
        customerId: keep.id,
        name: { equals: projectId, mode: "insensitive" },
        deletedAt: null,
      },
      select: { id: true },
    });
    if (!existing) {
      await tx.project.create({
        data: {
          organizationId,
          customerId: keep.id,
          name: projectId,
          status: "planning",
          notes: merge.notes || `Projeto consolidado de ${merge.name}`,
          address: merge.address || null,
        },
      });
      projectsCreated = 1;
    }
  }

  await tx.customer.update({
    where: { id: keep.id },
    data: {
      customerType: "builder",
      email: keep.email || merge.email,
      phone: keep.phone || merge.phone,
      address: keep.address || merge.address,
      company: keep.company || merge.company || keep.name,
      contactName: keep.contactName || merge.contactName,
      notes: appendNotes(keep.notes, projectId, merge.notes, merge.name),
      dumpsterStatus: keep.dumpsterStatus || merge.dumpsterStatus,
      dumpsterNotes: keep.dumpsterNotes || merge.dumpsterNotes,
      storageStatus: keep.storageStatus || merge.storageStatus,
      storageNotes: keep.storageNotes || merge.storageNotes,
    },
  });

  // Refresh keep in-memory notes for chained merges
  keep.notes = appendNotes(keep.notes, projectId, merge.notes, merge.name);
  keep.email = keep.email || merge.email;
  keep.phone = keep.phone || merge.phone;
  keep.address = keep.address || merge.address;
  keep.company = keep.company || merge.company || keep.name;
  keep.contactName = keep.contactName || merge.contactName;
  keep.jobCount += merge.jobCount;
  keep.customerType = "builder";

  await tx.customer.delete({ where: { id: merge.id } });
  return { jobs: jobs.length, projects: projectsCreated };
}

async function main() {
  const org = await prisma.organization.findFirst({
    where: { slug: ORG_SLUG },
    select: { id: true, name: true, slug: true },
  });
  if (!org) {
    console.error(`Organization slug "${ORG_SLUG}" not found.`);
    process.exitCode = 1;
    return;
  }
  console.log(`[${org.slug}] ${org.name} (${org.id})`);
  console.log(APPLY ? "MODE: APPLY" : "MODE: dry-run (pass --apply to write)");

  const all = await loadCustomers(org.id);
  console.log(`Builders/Lojas: ${all.length}`);

  const lojas = all.filter((c) => c.customerType === "loja" || c.customerType === "contractor");
  console.log(`→ type remap to builder: ${lojas.length}`);

  // Group project-style names onto a keep company.
  const withProject: Array<{ cust: Cust; companyHint: string; projectId: string }> = [];
  const plain: Cust[] = [];
  for (const c of all) {
    const { companyHint, projectId } = parseCompanyProject(c.name);
    if (projectId) withProject.push({ cust: c, companyHint, projectId });
    else plain.push(c);
  }

  type Plan = {
    keep: Cust;
    merges: Array<{ cust: Cust; projectId: string | null }>;
    renameKeepTo?: string;
  };
  const plans: Plan[] = [];
  const claimed = new Set<string>();

  function relatedProjectRows(seedHint: string, keepName?: string) {
    return withProject.filter((x) => {
      if (claimed.has(x.cust.id)) return false;
      const nHint = norm(x.companyHint);
      const nSeed = norm(seedHint);
      if (nHint === nSeed) return true;
      if (nHint.startsWith(nSeed + " ") || nSeed.startsWith(nHint + " ")) return true;
      if (keepName) {
        const nKeep = norm(keepName);
        if (nKeep === nHint || nKeep.startsWith(nHint + " ") || nHint.startsWith(nKeep + " ")) return true;
      }
      return false;
    });
  }

  for (const row of withProject) {
    if (claimed.has(row.cust.id)) continue;
    let keep = findKeepForHint(row.companyHint, plain.filter((p) => !claimed.has(p.id)));
    // Prefer a plain company whose name shares a Floors-style expansion (Simply → Simply Floors).
    if (!keep) {
      keep =
        plain
          .filter((p) => !claimed.has(p.id))
          .find((p) => {
            const n = norm(p.name);
            const h = norm(row.companyHint);
            return n.startsWith(h + " ") || h.startsWith(n + " ");
          }) || null;
    }

    if (!keep) {
      const siblings = relatedProjectRows(row.companyHint);
      siblings.sort((a, b) => b.cust.jobCount - a.cust.jobCount);
      const primary = siblings[0];
      if (!primary) continue;
      keep = { ...primary.cust };
      const merges = siblings.map((s) => ({ cust: s.cust, projectId: s.projectId }));
      plans.push({
        keep,
        merges,
        renameKeepTo: preferCompanyName(
          row.companyHint,
          plain,
          siblings.map((s) => s.cust),
        ),
      });
      for (const s of siblings) claimed.add(s.cust.id);
      continue;
    }

    const siblings = relatedProjectRows(row.companyHint, keep.name);
    const merges = siblings.map((s) => ({ cust: s.cust, projectId: s.projectId }));
    if (!merges.length) {
      claimed.add(keep.id);
      continue;
    }
    plans.push({ keep, merges });
    claimed.add(keep.id);
    for (const m of merges) claimed.add(m.cust.id);
  }

  console.log("\nMerge plans:");
  if (!plans.length) console.log("  (none)");
  for (const p of plans) {
    const keepLabel = p.renameKeepTo ? `${p.keep.name} → "${p.renameKeepTo}"` : p.keep.name;
    console.log(`  KEEP ${keepLabel} [${p.keep.id.slice(0, 8)}] jobs=${p.keep.jobCount}`);
    for (const m of p.merges) {
      if (m.cust.id === p.keep.id) {
        console.log(`    · self-tag project "${m.projectId}" (rename keep, keep jobs)`);
      } else {
        console.log(
          `    ← ${m.cust.name} [${m.cust.id.slice(0, 8)}] jobs=${m.cust.jobCount} project="${m.projectId}"`,
        );
      }
    }
  }

  if (!APPLY) {
    console.log("\nDry-run only. Re-run with --apply to execute.");
    return;
  }

  const result = await withTenantTransaction(org.id, async (tx) => {
    let remapped = 0;
    let merged = 0;
    let jobsMoved = 0;
    let projectsCreated = 0;

    // 1) Remap every loja/contractor → builder (including keep targets).
    const typeUp = await tx.customer.updateMany({
      where: { organizationId: org.id, customerType: { in: ["loja", "contractor"] } },
      data: { customerType: "builder" },
    });
    remapped += typeUp.count;

    await tx.workOrder.updateMany({
      where: { organizationId: org.id, sourceType: { in: ["loja", "contractor"] } },
      data: { sourceType: "builder" },
    });

    // Hide Loja in this org's catalog (customer type + pricing column).
    await tx.orgCatalogItem.updateMany({
      where: { organizationId: org.id, kind: "customer_type", key: "loja", active: true },
      data: { active: false },
    });
    await tx.orgCatalogItem.updateMany({
      where: { organizationId: org.id, kind: "pricing_column", key: "loja", active: true },
      data: { active: false },
    });

    // Copy priceLoja → priceBuilder when builder rate is empty.
    const pricing = await tx.pricingItem.findMany({
      where: { organizationId: org.id },
      select: { id: true, priceBuilder: true, priceLoja: true },
    });
    for (const p of pricing) {
      const b = Number(p.priceBuilder || 0);
      const l = Number(p.priceLoja || 0);
      if (l > 0 && !(b > 0)) {
        await tx.pricingItem.update({
          where: { id: p.id },
          data: { priceBuilder: p.priceLoja },
        });
      }
    }

    // 2) Execute merge plans
    for (const plan of plans) {
      let keepId = plan.keep.id;
      if (plan.renameKeepTo && plan.renameKeepTo !== plan.keep.name) {
        // Keep row is a project-named customer — rename to company, then tag its own jobs.
        await tx.customer.update({
          where: { id: keepId },
          data: { name: plan.renameKeepTo, customerType: "builder", company: plan.renameKeepTo },
        });
        plan.keep.name = plan.renameKeepTo;
        plan.keep.company = plan.renameKeepTo;
      }

      const keepRow = await tx.customer.findFirst({ where: { id: keepId } });
      if (!keepRow) continue;
      const keepMem: Cust = {
        ...plan.keep,
        name: keepRow.name,
        notes: keepRow.notes,
        email: keepRow.email,
        phone: keepRow.phone,
        address: keepRow.address,
        company: keepRow.company,
        contactName: keepRow.contactName,
        clientCode: keepRow.clientCode,
        dumpsterStatus: keepRow.dumpsterStatus,
        dumpsterNotes: keepRow.dumpsterNotes,
        storageStatus: keepRow.storageStatus,
        storageNotes: keepRow.storageNotes,
        customerType: "builder",
      };

      for (const m of plan.merges) {
        if (m.cust.id === keepId) {
          // Tag this keep's own jobs with project id (came from "Simply - Naka" renamed to company).
          const ownJobs = await tx.workOrder.findMany({
            where: { organizationId: org.id, customerId: keepId },
            select: { id: true, title: true, notes: true },
          });
          for (const wo of ownJobs) {
            const tag = m.projectId ? `Projeto: ${m.projectId}` : null;
            const notes = String(wo.notes || "").trim();
            const title = String(wo.title || "").trim();
            const data: Prisma.WorkOrderUpdateInput = { sourceType: "builder", sourceName: keepMem.name };
            if (m.projectId && (!title || norm(title) === norm(m.cust.name))) {
              data.title = `${keepMem.name} - ${m.projectId}`;
            }
            if (tag && !notes.toLowerCase().includes(tag.toLowerCase())) {
              data.notes = notes ? `${tag}\n${notes}` : tag;
            }
            await tx.workOrder.update({ where: { id: wo.id }, data });
          }
          if (m.projectId) {
            const existing = await tx.project.findFirst({
              where: {
                organizationId: org.id,
                customerId: keepId,
                name: { equals: m.projectId, mode: "insensitive" },
                deletedAt: null,
              },
            });
            if (!existing) {
              await tx.project.create({
                data: {
                  organizationId: org.id,
                  customerId: keepId,
                  name: m.projectId,
                  status: "planning",
                  notes: `Projeto consolidado de ${m.cust.name}`,
                },
              });
              projectsCreated += 1;
            }
          }
          continue;
        }
        const still = await tx.customer.findFirst({ where: { id: m.cust.id } });
        if (!still) continue;
        const r = await mergeIntoKeep(tx, org.id, keepMem, { ...m.cust, ...still, jobCount: m.cust.jobCount }, m.projectId);
        merged += 1;
        jobsMoved += r.jobs;
        projectsCreated += r.projects;
      }
    }

    return { remapped, merged, jobsMoved, projectsCreated };
  });

  console.log("\nDone:", result);
}

/** Prefer an existing plain company name; else expand single-word hints to "Hint Floors". */
function preferCompanyName(hint: string, plain: Cust[], siblings: Cust[]): string {
  const hit = findKeepForHint(hint, plain);
  if (hit) return hit.name;
  const nHint = norm(hint);
  for (const s of siblings) {
    const parsed = parseCompanyProject(s.name);
    const company = parsed.companyHint || s.name;
    const n = norm(company);
    if (n.startsWith(nHint + " ") || nHint.startsWith(n + " ")) {
      if (/\bfloors\b/i.test(company)) return company;
    }
  }
  for (const s of siblings) {
    const parsed = parseCompanyProject(s.name);
    if (/\bfloors\b/i.test(parsed.companyHint || s.name)) {
      return parsed.projectId ? parsed.companyHint : s.name;
    }
  }
  if (/\bfloors\b/i.test(hint)) return hint;
  // "Simply - Naka" with no parent row → Simply Floors (Senior Floors naming pattern).
  if (!/\s/.test(hint)) return `${hint} Floors`;
  return hint;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
