import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { createOrganizationWithAdmin } from "../src/modules/organizations/service.js";
import { withTenantTransaction } from "../src/lib/tenant/prisma-tenant.js";
import { DEFAULT_PERMISSIONS } from "../src/lib/tenant/defaults.js";
import {
  canonicalStageSlug,
  resolveLeadStage,
  type StageRow,
} from "../src/lib/dashboard/stages.js";
import {
  buildInvoiceSection,
  buildJobsForecast,
  buildLeadSection,
  buildQuoteSection,
  loadDashboardOverview,
  rankAttention,
  viewerAccess,
  type AttentionItem,
  type LeadRow,
  type QuoteRow,
  type WorkOrderRow,
} from "../src/lib/dashboard/overview.js";

const TZ = "America/Denver";
const NOW = new Date("2026-09-29T16:00:00Z"); // 10:00 in Denver
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const ago = (ms: number) => new Date(NOW.getTime() - ms);

const STAGES: StageRow[] = [
  { id: "s-new", name: "New", slug: "new", order: 1, color: null, isClosed: false },
  { id: "s-contacted", name: "Contacted", slug: "contacted", order: 2, color: null, isClosed: false },
  { id: "s-assess", name: "Assessment scheduled", slug: "assessment_scheduled", order: 3, color: null, isClosed: false },
  { id: "s-quote", name: "Quote sent", slug: "quote_sent", order: 4, color: null, isClosed: false },
  { id: "s-fu", name: "Follow Up", slug: "follow_up_1", order: 5, color: null, isClosed: false },
  { id: "s-sb", name: "Stand By", slug: "stand_by", order: 6, color: null, isClosed: false },
  { id: "s-won", name: "Won", slug: "won", order: 7, color: null, isClosed: true },
  { id: "s-lost", name: "Lost", slug: "lost", order: 8, color: null, isClosed: true },
];

function lead(partial: Partial<LeadRow> & { id: string }): LeadRow {
  return {
    name: partial.id,
    phone: "(720) 555-0100",
    source: "Website",
    status: "new",
    notes: null,
    pipelineStageId: "s-new",
    stageSlug: "new",
    ownerName: null,
    estimatedValue: null,
    followups: null,
    lastContactedAt: null,
    createdAt: ago(3 * DAY),
    ...partial,
  };
}

describe("dashboard stages", () => {
  it("maps SaaS and legacy slugs to the Kanban columns", () => {
    expect(canonicalStageSlug("new")).toBe("new_lead");
    expect(canonicalStageSlug("assessment_scheduled")).toBe("meeting_scheduled");
    expect(canonicalStageSlug("closed_won")).toBe("won");
    expect(canonicalStageSlug("Quote Sent")).toBe("quote_sent");
    expect(canonicalStageSlug("custom_stage")).toBeNull();
  });

  it("prefers lead.status over a stale stage join, like the Kanban", () => {
    expect(resolveLeadStage({ status: "won", pipelineStageId: "s-quote", stageSlug: "quote_sent" }, STAGES)).toBe("won");
    expect(resolveLeadStage({ status: "weird", pipelineStageId: "s-quote", stageSlug: "quote_sent" }, STAGES)).toBe(
      "quote_sent",
    );
    expect(resolveLeadStage({ status: null, pipelineStageId: "s-fu", stageSlug: null }, STAGES)).toBe("follow_up_1");
    expect(resolveLeadStage({ status: null, pipelineStageId: null, stageSlug: null }, STAGES)).toBe("new_lead");
  });
});

describe("dashboard lead section", () => {
  const leads: LeadRow[] = [
    lead({ id: "fresh", createdAt: ago(10 * MIN), estimatedValue: "9800" }),
    lead({ id: "waiting", createdAt: ago(26 * HOUR), estimatedValue: "15500" }),
    lead({ id: "cold", createdAt: ago(5 * DAY) }),
    lead({ id: "called", createdAt: ago(2 * DAY), lastContactedAt: ago(DAY), estimatedValue: 7000 }),
    lead({
      id: "fu",
      status: "follow_up_1",
      stageSlug: "follow_up_1",
      estimatedValue: "$13,200",
      lastContactedAt: ago(6 * DAY),
      followups: [
        { id: "a", title: "Ligar", status: "pending", due_date: "2026-09-27" },
        { id: "b", title: "Amostras", status: "pending", due_date: "2026-09-29" },
        { id: "c", title: "Feito", status: "completed", due_date: "2026-09-01" },
        { id: "d", title: "Futuro", status: "pending", due_date: "2026-10-05" },
      ],
    }),
    lead({ id: "won1", status: "won", stageSlug: "won", estimatedValue: 14000, lastContactedAt: ago(DAY) }),
    lead({ id: "won2", status: "closed_won", stageSlug: "won", estimatedValue: 5000, lastContactedAt: ago(DAY) }),
    lead({ id: "lost1", status: "lost", stageSlug: "lost", estimatedValue: 9000, lastContactedAt: ago(DAY) }),
    lead({ id: "old", createdAt: new Date("2026-08-20T12:00:00Z"), lastContactedAt: ago(DAY), source: "" }),
  ];
  const section = buildLeadSection(leads, STAGES, NOW, TZ);

  it("computes open pipeline value without won/lost and counts leads without estimates", () => {
    expect(section.pipeline_open).toEqual({ value: 9800 + 15500 + 7000 + 13200, count: 6, without_value: 2 });
  });

  it("computes conversion from closed leads", () => {
    expect(section.conversion).toEqual({ rate: 66.7, won: 2, lost: 1 });
  });

  it("counts new leads per month in the org timezone", () => {
    expect(section.leads_month).toEqual({ count: 8, previous_count: 1 });
  });

  it("keeps new leads in 'attention' after the 30-minute window (was dropped before)", () => {
    const byId = new Map(section.attention.map((a) => [a.entity.id + ":" + a.kind, a]));
    expect(byId.get("fresh:lead_sla")?.priority).toBe("high");
    expect(byId.get("waiting:lead_uncontacted")?.priority).toBe("high");
    expect(byId.get("cold:lead_uncontacted")?.priority).toBe("medium");
    expect(byId.has("called:lead_uncontacted")).toBe(false);
  });

  it("flags overdue and due-today follow-ups only when pending", () => {
    const fu = section.attention.filter((a) => a.entity.id === "fu");
    expect(fu.map((a) => [a.kind, a.label, a.days])).toEqual([
      ["followup_overdue", "Ligar", 2],
      ["followup_today", "Amostras", 0],
    ]);
  });

  it("builds a board preview per Kanban column (lost hidden)", () => {
    expect(section.board.map((c) => c.slug)).toEqual([
      "new_lead",
      "contacted",
      "meeting_scheduled",
      "quote_sent",
      "follow_up_1",
      "stand_by",
      "won",
    ]);
    const newCol = section.board[0]!;
    expect(newCol.count).toBe(5);
    expect(newCol.leads[0]!.id).toBe("fresh");
    expect(newCol.leads[0]!.uncontacted).toBe(true);
  });

  it("groups lead sources for the last 30 days", () => {
    expect(section.sources_30d).toEqual([{ source: "Website", count: 8 }]);
  });
});

describe("dashboard quote + invoice sections", () => {
  const q = (partial: Partial<QuoteRow> & { id: string; status: string }): QuoteRow => ({
    number: 1,
    quoteNumber: null,
    title: "Quote",
    total: 1000,
    materialCost: 0,
    laborCost: 0,
    leadId: null,
    customerName: "Cliente",
    signedAt: null,
    viewedAt: null,
    validUntil: null,
    updatedAt: ago(DAY),
    createdAt: ago(10 * DAY),
    ...partial,
  });

  it("counts won quotes by signature month — approved/converted and legacy names; never 'sent'", () => {
    const { won_month } = buildQuoteSection(
      [
        q({ id: "a", status: "approved", total: 14600, signedAt: ago(6 * DAY) }),
        q({ id: "b", status: "converted", total: 8200, signedAt: ago(9 * DAY) }),
        q({ id: "c", status: "accepted", total: 1000, signedAt: null, updatedAt: ago(2 * DAY) }),
        q({ id: "d", status: "approved", total: 19800, signedAt: new Date("2026-08-24T12:00:00Z") }),
        q({ id: "e", status: "sent", total: 50000, updatedAt: ago(DAY) }),
      ],
      NOW,
      TZ,
      true,
    );
    expect(won_month).toEqual({ value: 23800, count: 3, previous_value: 19800, previous_count: 1 });
  });

  it("sums open sent quotes for pipeline (excludes won/lost/draft)", () => {
    const { pipeline_open } = buildQuoteSection(
      [
        q({ id: "s1", status: "sent", total: 12000 }),
        q({ id: "s2", status: "changes_requested", total: 4500 }),
        q({ id: "s3", status: "sent", total: 0 }),
        q({ id: "w", status: "approved", total: 9000, signedAt: ago(DAY) }),
        q({ id: "a", status: "archived", total: 3000 }),
        q({ id: "d", status: "draft", total: 8000 }),
      ],
      NOW,
      TZ,
      true,
    );
    expect(pipeline_open).toEqual({ value: 16500, count: 3, without_value: 1 });
  });

  it("computes gross profit from won quotes this month (total − material − labor)", () => {
    const { gross_profit } = buildQuoteSection(
      [
        q({
          id: "a",
          status: "approved",
          total: 10000,
          materialCost: 3000,
          laborCost: 2000,
          signedAt: ago(DAY),
        }),
        q({
          id: "b",
          status: "converted",
          total: 5000,
          materialCost: 1000,
          laborCost: 500,
          signedAt: ago(2 * DAY),
        }),
        q({
          id: "prev",
          status: "approved",
          total: 8000,
          materialCost: 2000,
          laborCost: 1000,
          signedAt: new Date("2026-08-20T12:00:00Z"),
        }),
        q({ id: "open", status: "sent", total: 20000, materialCost: 5000, laborCost: 1000 }),
      ],
      NOW,
      TZ,
      true,
    );
    expect(gross_profit).toEqual({
      value: 8500,
      count: 2,
      previous_value: 5000,
      previous_count: 1,
      revenue: 15000,
      cost: 6500,
    });
  });

  it("hides money without pricing permission", () => {
    const { won_month, pipeline_open, gross_profit, attention } = buildQuoteSection(
      [q({ id: "a", status: "approved", signedAt: ago(DAY) }), q({ id: "b", status: "changes_requested" })],
      NOW,
      TZ,
      false,
    );
    expect(won_month.value).toBeNull();
    expect(won_month.count).toBe(1);
    expect(pipeline_open.value).toBeNull();
    expect(pipeline_open.count).toBe(1);
    expect(gross_profit.value).toBeNull();
    expect(attention[0]!.amount).toBeNull();
  });

  it("flags changes requested, expiring and stale quotes", () => {
    const { attention } = buildQuoteSection(
      [
        q({ id: "chg", status: "changes_requested" }),
        q({ id: "exp", status: "sent", validUntil: new Date(NOW.getTime() + 2 * DAY), updatedAt: ago(20 * DAY) }),
        q({ id: "stale", status: "sent", updatedAt: ago(9 * DAY), viewedAt: ago(8 * DAY) }),
        q({ id: "fresh", status: "sent", updatedAt: ago(2 * DAY) }),
      ],
      NOW,
      TZ,
      true,
    );
    expect(attention.map((a) => [a.entity.id, a.kind])).toEqual([
      ["chg", "quote_changes"],
      ["exp", "quote_expiring"],
      ["stale", "quote_stale"],
    ]);
    expect(attention.find((a) => a.kind === "quote_stale")?.viewed).toBe(true);
  });

  it("buckets upcoming jobs into the next 7 org-local days", () => {
    const wo = (partial: Partial<WorkOrderRow> & { id: string; scheduledStart: Date }): WorkOrderRow => ({
      number: 1,
      title: "Job",
      status: "scheduled",
      fieldStatus: "scheduled",
      scheduledEnd: new Date(partial.scheduledStart.getTime() + 4 * HOUR),
      address: null,
      customerName: null,
      assigneeName: null,
      crewName: null,
      crewColor: null,
      geoLat: null,
      geoLng: null,
      ...partial,
    });
    const days = buildJobsForecast(
      [
        wo({ id: "t", title: "Hoje", scheduledStart: NOW }),
        wo({ id: "t2", title: "Hoje 2", scheduledStart: new Date(NOW.getTime() + HOUR) }),
        wo({ id: "tm", title: "Amanhã", scheduledStart: new Date(NOW.getTime() + DAY) }),
        wo({ id: "far", title: "Longe", scheduledStart: new Date(NOW.getTime() + 10 * DAY) }),
      ],
      NOW,
      TZ,
      7,
    );
    expect(days).toHaveLength(7);
    expect(days[0]!.date).toBe("2026-09-29");
    expect(days[0]!.count).toBe(2);
    expect(days[1]!.count).toBe(1);
    expect(days[1]!.jobs[0]!.id).toBe("tm");
    expect(days.every((d, i) => i < 2 || d.count === 0)).toBe(true);
  });

  it("uses the open balance (amount − receipts) and the org's today for overdue invoices", () => {
    const { receivables, attention } = buildInvoiceSection(
      [
        { id: "i1", invoiceNumber: "INV-1", status: "sent", amount: 9900, paid: 0, dueDate: ago(6 * DAY), quoteId: "q1", customerName: "A" },
        { id: "i2", invoiceNumber: "INV-2", status: "partially_paid", amount: 5000, paid: 2000, dueDate: ago(2 * DAY), quoteId: "q2", customerName: "B" },
        { id: "i3", invoiceNumber: "INV-3", status: "sent", amount: 7300, paid: 0, dueDate: new Date(NOW.getTime() + 4 * DAY), quoteId: "q3", customerName: "C" },
        { id: "i4", invoiceNumber: "INV-4", status: "paid", amount: 4000, paid: 4000, dueDate: ago(30 * DAY), quoteId: "q4", customerName: "D" },
        // Due "today" at 00:30 Denver — not overdue yet.
        { id: "i5", invoiceNumber: "INV-5", status: "sent", amount: 100, paid: 0, dueDate: new Date("2026-09-29T06:30:00Z"), quoteId: "q5", customerName: "E" },
      ],
      NOW,
      TZ,
    );
    expect(receivables).toEqual({ open_value: 9900 + 3000 + 7300 + 100, open_count: 4, overdue_value: 12900, overdue_count: 2 });
    expect(attention.map((a) => a.entity.id)).toEqual(["i1", "i2"]);
  });

  it("ranks high priority first and keeps one row per lead", () => {
    const item = (kind: AttentionItem["kind"], priority: AttentionItem["priority"], id: string, at: string, days?: number): AttentionItem => ({
      key: `${kind}:${id}`,
      kind,
      priority,
      entity: { type: kind.startsWith("quote") ? "quote" : kind.startsWith("invoice") ? "invoice" : "lead", id, name: id },
      href: "#",
      at,
      days,
    });
    const ranked = rankAttention([
      item("quote_stale", "medium", "q1", "2026-09-10T00:00:00Z", 19),
      item("lead_uncontacted", "high", "L1", "2026-09-28T10:00:00Z"),
      item("followup_overdue", "high", "L1", "2026-09-27T12:00:00Z", 2),
      item("invoice_overdue", "high", "i1", "2026-09-23T00:00:00Z", 6),
      item("lead_sla", "high", "L2", "2026-09-29T15:50:00Z"),
      item("lead_uncontacted", "high", "L3", "2026-09-29T12:00:00Z"),
    ]);
    expect(ranked.map((r) => `${r.kind}:${r.entity.id}`)).toEqual([
      "lead_sla:L2",
      "invoice_overdue:i1",
      "followup_overdue:L1",
      "lead_uncontacted:L3",
      "quote_stale:q1",
    ]);
  });
});

describe("dashboard overview (database, tenant isolation, permissions)", () => {
  const prisma = new PrismaClient();
  let orgA: string;
  let orgB: string;

  beforeAll(async () => {
    for (const permission of DEFAULT_PERMISSIONS) {
      await prisma.permission.upsert({
        where: { key: permission.key },
        create: { key: permission.key, group: permission.group, description: permission.description },
        update: {},
      });
    }
    const suffix = Date.now().toString(36);
    const a = await createOrganizationWithAdmin({
      organizationName: `Dash A ${suffix}`,
      slug: `dash-a-${suffix}`,
      adminName: "Admin A",
      adminEmail: `dash-a-${suffix}@example.com`,
      password: "password12345",
    });
    const b = await createOrganizationWithAdmin({
      organizationName: `Dash B ${suffix}`,
      slug: `dash-b-${suffix}`,
      adminName: "Admin B",
      adminEmail: `dash-b-${suffix}@example.com`,
      password: "password12345",
    });
    orgA = a.organization.id;
    orgB = b.organization.id;

    for (const [orgId, name, value] of [
      [orgA, "Lead A1", 1000],
      [orgA, "Lead A2", 2000],
      [orgB, "Lead B1", 50000],
    ] as const) {
      await withTenantTransaction(orgId, async (tx) => {
        const stage = await tx.pipelineStage.findFirstOrThrow({ where: { slug: "new" } });
        await tx.lead.create({
          data: {
            organizationId: orgId,
            name,
            status: "new",
            pipelineStageId: stage.id,
            metadata: { estimated_value: value },
          },
        });
      });
    }
    await withTenantTransaction(orgA, async (tx) => {
      await tx.quote.create({
        data: {
          organizationId: orgA,
          number: 1,
          title: "A open",
          status: "sent",
          total: 3000,
          materialCost: 800,
          laborCost: 200,
        },
      });
    });
    await withTenantTransaction(orgB, async (tx) => {
      await tx.quote.create({
        data: {
          organizationId: orgB,
          number: 1,
          title: "B quote",
          status: "approved",
          total: 7777,
          materialCost: 2000,
          laborCost: 777,
          signedAt: new Date(),
        },
      });
      await tx.quote.create({
        data: {
          organizationId: orgB,
          number: 2,
          title: "B open",
          status: "sent",
          total: 50000,
        },
      });
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("only sees its own tenant's leads and quotes", async () => {
    const access = viewerAccess({ roleKey: "admin", permissions: [] });
    const ov = await withTenantTransaction(orgA, (tx) =>
      loadDashboardOverview(tx, { organizationId: orgA, timezone: TZ, access }),
    );
    expect(ov.kpis.pipeline_open).toEqual({ value: 3000, count: 1, without_value: 0 });
    expect(ov.kpis.won_month?.count).toBe(0);
    expect(ov.kpis.gross_profit?.count).toBe(0);
    const names = ov.attention.items.map((i) => i.entity.name);
    expect(names).toContain("Lead A1");
    expect(names).not.toContain("Lead B1");
  });

  it("returns only the sections the viewer may see", async () => {
    const access = viewerAccess({ roleKey: "custom", permissions: ["leads.view"] });
    expect(access).toEqual({ leads: true, quotes: false, invoices: false, schedule: false, pricing: false });
    const ov = await withTenantTransaction(orgB, (tx) =>
      loadDashboardOverview(tx, { organizationId: orgB, timezone: TZ, access }),
    );
    expect(ov.kpis.pipeline_open).toBeNull();
    expect(ov.kpis.won_month).toBeNull();
    expect(ov.kpis.gross_profit).toBeNull();
    expect(ov.kpis.receivables).toBeNull();
    expect(ov.today_events).toBeNull();
    expect(ov.jobs_forecast).toBeNull();
    expect(ov.board).not.toBeNull();
  });
});
