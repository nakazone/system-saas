import { Router } from "express";
import type { AuthedRequest } from "../../middleware/auth.js";
import { withTenantTransaction } from "../../lib/tenant/prisma-tenant.js";
import { requireCrmAuth } from "../http.js";
import { loadDashboardOverview, viewerAccess } from "../../lib/dashboard/overview.js";
import { resolveLeadStage } from "../../lib/dashboard/stages.js";
import { safeTimeZone } from "../../lib/time/zoned.js";

export const dashboardOverviewRouter = Router();

const FIELD_ROLES = new Set(["installer", "crew_lead", "subcontractor"]);

function isFieldRole(req: AuthedRequest): boolean {
  return FIELD_ROLES.has(String(req.user?.roleKey || "").toLowerCase());
}

/**
 * GET /api/dashboard/overview — everything the CRM home screens need in one call.
 * Sections the viewer cannot access come back as `null` (see `access`).
 */
dashboardOverviewRouter.get("/api/dashboard/overview", requireCrmAuth, async (req: AuthedRequest, res, next) => {
  try {
    if (isFieldRole(req)) {
      res.status(403).json({ success: false, error: "Permission denied" });
      return;
    }
    const access = viewerAccess(req.user!);
    const timezone = safeTimeZone(req.organization?.timezone);
    const data = await withTenantTransaction(req.organizationId!, (tx) =>
      loadDashboardOverview(tx, { organizationId: req.organizationId!, timezone, access }),
    );
    res.setHeader("Cache-Control", "no-store");
    res.json({ success: true, ...data });
  } catch (error) {
    next(error);
  }
});

const QUOTE_STATUS_PT: Record<string, string> = {
  draft: "Rascunho",
  sent: "Enviado",
  changes_requested: "Alterações pedidas",
  approved: "Aprovado",
  accepted: "Aprovado",
  converted: "Convertido em job",
  invoiced: "Faturado",
  archived: "Arquivado",
  rejected: "Arquivado",
  expired: "Expirado",
};

function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

type SearchHit = {
  type: "lead" | "customer" | "quote" | "job";
  id: string;
  title: string;
  subtitle: string | null;
  href: string;
  mobile_href?: string;
  stage?: string;
};

/**
 * GET /api/search?q= — global record search for the ⌘K palette and the mobile Home.
 * Leads, customers, quotes and jobs, each gated by its own view permission.
 */
dashboardOverviewRouter.get("/api/search", requireCrmAuth, async (req: AuthedRequest, res, next) => {
  try {
    const q = String(req.query.q || "").trim().slice(0, 80);
    if (q.length < 2 || isFieldRole(req)) {
      res.json({ success: true, q, results: [] });
      return;
    }
    const user = req.user!;
    const can = (k: string) => user.roleKey === "admin" || user.permissions.includes(k);
    const like = likePattern(q);
    const digits = q.replace(/\D/g, "");
    const digitsLike = digits.length >= 4 ? `%${digits}%` : null;
    const asNumber = /^#?\d{1,9}$/.test(q) ? Number(q.replace("#", "")) : null;
    const orgId = req.organizationId!;
    const take = Math.min(8, Math.max(1, Number(req.query.limit) || 5));

    const results = await withTenantTransaction(orgId, async (tx) => {
      const hits: SearchHit[] = [];

      if (can("leads.view")) {
        const leads = await tx.$queryRaw<
          {
            id: string;
            name: string;
            phone: string | null;
            email: string | null;
            source: string | null;
            status: string | null;
            pipelineStageId: string | null;
            stageSlug: string | null;
          }[]
        >`
          SELECT l.id, l.name, l.phone, l.email, l.source, l.status, l."pipelineStageId", ps.slug AS "stageSlug"
            FROM "Lead" l
            LEFT JOIN "PipelineStage" ps ON ps.id = l."pipelineStageId"
           WHERE l."organizationId" = ${orgId}::uuid
             AND (l.name ILIKE ${like} OR l.email ILIKE ${like}
                  OR (${digitsLike}::text IS NOT NULL
                      AND regexp_replace(coalesce(l.phone, ''), '\\D', '', 'g') LIKE ${digitsLike}::text))
           ORDER BY l."updatedAt" DESC
           LIMIT ${take}`;
        for (const l of leads) {
          const stage = resolveLeadStage(
            { status: l.status, pipelineStageId: l.pipelineStageId, stageSlug: l.stageSlug },
            [],
          );
          hits.push({
            type: "lead",
            id: l.id,
            title: l.name,
            subtitle: [l.phone || l.email, l.source].filter(Boolean).join(" · ") || null,
            href: `lead-detail.html?id=${encodeURIComponent(l.id)}`,
            stage,
          });
        }
      }

      if (can("customers.view")) {
        const customers = await tx.$queryRaw<
          { id: string; name: string; phone: string | null; email: string | null; company: string | null }[]
        >`
          SELECT c.id, c.name, c.phone, c.email, c.company
            FROM "Customer" c
           WHERE c."organizationId" = ${orgId}::uuid
             AND (c.name ILIKE ${like} OR c.email ILIKE ${like} OR c.company ILIKE ${like}
                  OR (${digitsLike}::text IS NOT NULL
                      AND regexp_replace(coalesce(c.phone, ''), '\\D', '', 'g') LIKE ${digitsLike}::text))
           ORDER BY c."updatedAt" DESC
           LIMIT ${take}`;
        for (const c of customers) {
          hits.push({
            type: "customer",
            id: c.id,
            title: c.name,
            subtitle: [c.company, c.phone || c.email].filter(Boolean).join(" · ") || null,
            href: `dashboard.html?page=customers&id=${encodeURIComponent(c.id)}&q=${encodeURIComponent(c.name)}`,
            mobile_href: `customers.html?id=${encodeURIComponent(c.id)}`,
          });
        }
      }

      if (can("quotes.view")) {
        const quotes = await tx.quote.findMany({
          where: {
            OR: [
              { title: { contains: q, mode: "insensitive" } },
              { quoteNumber: { contains: q, mode: "insensitive" } },
              { customer: { name: { contains: q, mode: "insensitive" } } },
              ...(asNumber != null ? [{ number: asNumber }] : []),
            ],
          },
          orderBy: { updatedAt: "desc" },
          take,
          select: {
            id: true,
            number: true,
            quoteNumber: true,
            title: true,
            status: true,
            customer: { select: { name: true } },
          },
        });
        for (const qt of quotes) {
          hits.push({
            type: "quote",
            id: qt.id,
            title: qt.customer?.name || qt.title,
            subtitle: [
              qt.quoteNumber || `#${qt.number}`,
              qt.title !== qt.customer?.name ? qt.title : null,
              QUOTE_STATUS_PT[qt.status] || qt.status,
            ]
              .filter(Boolean)
              .join(" · "),
            href: `quote-builder.html?id=${encodeURIComponent(qt.id)}`,
          });
        }
      }

      if (can("work_orders.view")) {
        const jobs = await tx.workOrder.findMany({
          where: {
            OR: [
              { title: { contains: q, mode: "insensitive" } },
              { address: { contains: q, mode: "insensitive" } },
              { customer: { name: { contains: q, mode: "insensitive" } } },
              ...(asNumber != null ? [{ number: asNumber }] : []),
            ],
          },
          orderBy: { updatedAt: "desc" },
          take,
          select: { id: true, number: true, title: true, status: true, address: true },
        });
        for (const j of jobs) {
          hits.push({
            type: "job",
            id: j.id,
            title: j.title,
            subtitle: [j.number != null ? `Job #${j.number}` : null, j.address].filter(Boolean).join(" · ") || null,
            href: `job-detail.html?id=${encodeURIComponent(j.id)}`,
          });
        }
      }

      return hits;
    });

    res.setHeader("Cache-Control", "no-store");
    res.json({ success: true, q, results });
  } catch (error) {
    next(error);
  }
});
