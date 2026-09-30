/**
 * Dashboard overview — one server-side source of truth for the CRM home screens
 * (desktop `pipeline-lab.html`, mobile `home.html`).
 *
 * Replaces client-side math over `/api/leads?limit=5000` with:
 *  - KPIs computed on the server with explicit periods in the org timezone
 *  - the same lead→column rule as the Leads Kanban (`stages.ts`)
 *  - "needs attention" rules aligned with the Phase 2 action home (`lib/home/actions.ts`)
 *  - sections gated by the viewer's permissions
 */
import type { TenantPrisma } from "../tenant/prisma-tenant.js";
import {
  canonicalStagesFor,
  isOpenStage,
  resolveLeadStage,
  type CanonicalStage,
  type DashboardStage,
  type StageRow,
} from "./stages.js";
import { startOfZonedDay, startOfZonedMonth, zonedDateKey, zonedDayDiff } from "../time/zoned.js";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Response window for a brand-new lead (matches the Kanban "urgent" dot). */
export const NEW_LEAD_SLA_MS = 30 * MINUTE;
/** Uncontacted new leads stay "high" priority for this long, then drop to "medium". */
export const UNCONTACTED_HIGH_MS = 72 * HOUR;
/** Same thresholds as `staleQuoteWhere` / `expiringQuoteWhere` in lib/home/actions.ts. */
export const STALE_QUOTE_MS = 7 * DAY;
export const EXPIRING_QUOTE_MS = 3 * DAY;
export const BOARD_PREVIEW_SIZE = 5;
export const ATTENTION_LIMIT = 30;

/** Quote statuses that mean "closed / sold" (current + legacy names). */
export const WON_QUOTE_STATUSES = ["approved", "converted", "accepted", "invoiced"] as const;
const WON_QUOTE_SET = new Set<string>(WON_QUOTE_STATUSES);
/** Invoice statuses that never carry an open balance. */
const CLOSED_INVOICE_STATUSES = new Set(["draft", "paid", "void"]);

export type ViewerAccess = {
  leads: boolean;
  quotes: boolean;
  invoices: boolean;
  schedule: boolean;
  /** Quote totals (pricing.view) */
  pricing: boolean;
};

export function viewerAccess(user: { roleKey: string | null; permissions: string[] }): ViewerAccess {
  const admin = user.roleKey === "admin";
  const has = (k: string) => admin || user.permissions.includes(k);
  return {
    leads: has("leads.view"),
    quotes: has("quotes.view"),
    invoices: has("invoices.view") || has("finance.view"),
    schedule: has("schedule.view"),
    pricing: has("pricing.view"),
  };
}

// ---------------------------------------------------------------------------
// Input rows (what the loader selects)
// ---------------------------------------------------------------------------

export type LeadRow = {
  id: string;
  name: string;
  phone: string | null;
  source: string | null;
  status: string | null;
  notes: string | null;
  pipelineStageId: string | null;
  stageSlug: string | null;
  ownerName: string | null;
  estimatedValue: string | number | null;
  followups: unknown;
  lastContactedAt: Date | null;
  createdAt: Date;
};

export type QuoteRow = {
  id: string;
  number: number;
  quoteNumber: string | null;
  title: string;
  status: string;
  total: number;
  leadId: string | null;
  customerName: string | null;
  signedAt: Date | null;
  viewedAt: Date | null;
  validUntil: Date | null;
  updatedAt: Date;
  createdAt: Date;
};

export type InvoiceRow = {
  id: string;
  invoiceNumber: string | null;
  status: string;
  amount: number;
  paid: number;
  dueDate: Date | null;
  quoteId: string | null;
  customerName: string | null;
};

export type MeetingRow = {
  id: string;
  title: string;
  status: string;
  scheduledStart: Date;
  scheduledEnd: Date;
  location: string | null;
  customerName: string | null;
  assigneeName: string | null;
  leadId: string | null;
};

export type WorkOrderRow = {
  id: string;
  number: number | null;
  title: string;
  status: string;
  fieldStatus: string;
  scheduledStart: Date;
  scheduledEnd: Date;
  address: string | null;
  customerName: string | null;
  assigneeName: string | null;
  crewName: string | null;
  crewColor: string | null;
};

// ---------------------------------------------------------------------------
// Output shape (consumed by crm/public/om-dashboard.js)
// ---------------------------------------------------------------------------

export type AttentionKind =
  | "lead_sla"
  | "invoice_overdue"
  | "quote_changes"
  | "followup_overdue"
  | "lead_uncontacted"
  | "followup_today"
  | "quote_expiring"
  | "quote_stale";

export type AttentionItem = {
  key: string;
  kind: AttentionKind;
  priority: "high" | "medium";
  entity: { type: "lead" | "quote" | "invoice"; id: string; name: string };
  href: string;
  /** Reference instant (lead created, follow-up due, quote sent, invoice due). */
  at: string | null;
  /** Deadline for lead_sla countdowns / expiring quotes. */
  deadline?: string | null;
  days?: number;
  amount?: number | null;
  phone?: string | null;
  label?: string | null;
  source?: string | null;
  viewed?: boolean;
};

export type LeadPreview = {
  id: string;
  name: string;
  stage: CanonicalStage;
  value: number | null;
  source: string | null;
  summary: string | null;
  owner_name: string | null;
  created_at: string;
  last_contacted_at: string | null;
  uncontacted: boolean;
  phone: string | null;
};

export type BoardColumn = DashboardStage & {
  count: number;
  value: number;
  leads: LeadPreview[];
};

export type TodayEvent = {
  id: string;
  type: "visit" | "job";
  title: string;
  start: string;
  end: string;
  status: string;
  person: string | null;
  address: string | null;
  color: string | null;
  href: string;
  lead_id: string | null;
};

export type DashboardOverview = {
  generated_at: string;
  timezone: string;
  today: string;
  period: { month_start: string; previous_month_start: string; today_start: string; tomorrow_start: string };
  access: ViewerAccess;
  kpis: {
    pipeline_open: { value: number; count: number; without_value: number } | null;
    conversion: { rate: number | null; won: number; lost: number } | null;
    leads_month: { count: number; previous_count: number } | null;
    won_month: { value: number | null; count: number; previous_value: number | null; previous_count: number } | null;
    receivables: { open_value: number; open_count: number; overdue_value: number; overdue_count: number } | null;
  };
  board: BoardColumn[] | null;
  sources_30d: { source: string; count: number }[] | null;
  attention: { total: number; high: number; items: AttentionItem[] };
  today_events: TodayEvent[] | null;
};

// ---------------------------------------------------------------------------
// Pure builders
// ---------------------------------------------------------------------------

function num(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(String(value).replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function summaryLine(notes: string | null): string | null {
  const first = String(notes || "")
    .split(/\r?\n/)
    .map((s) => s.trim())
    .find((s) => s && !/^CEP:/i.test(s));
  if (!first) return null;
  return first.length > 90 ? `${first.slice(0, 89)}…` : first;
}

type PendingFollowup = { id: string; title: string; dueKey: string };

/** Pending follow-ups with a due date, keyed by calendar day in the org timezone. */
export function pendingFollowups(raw: unknown, tz: string): PendingFollowup[] {
  if (!Array.isArray(raw)) return [];
  const out: PendingFollowup[] = [];
  for (const f of raw) {
    if (!f || typeof f !== "object") continue;
    const row = f as Record<string, unknown>;
    const status = String(row.status || "pending").toLowerCase();
    if (status !== "pending" && status !== "open") continue;
    const due = String(row.due_date || "").trim();
    if (!due) continue;
    let dueKey: string | null = null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(due)) dueKey = due;
    else {
      const d = new Date(due);
      if (!Number.isNaN(d.getTime())) dueKey = zonedDateKey(d, tz);
    }
    if (!dueKey) continue;
    out.push({ id: String(row.id || dueKey), title: String(row.title || "Follow-up"), dueKey });
  }
  return out;
}

function daysBetweenKeys(fromKey: string, toKey: string): number {
  const a = Date.parse(`${fromKey}T00:00:00Z`);
  const b = Date.parse(`${toKey}T00:00:00Z`);
  return Math.round((b - a) / DAY);
}

export function buildLeadSection(
  leads: LeadRow[],
  stageRows: StageRow[],
  now: Date,
  tz: string,
): {
  board: BoardColumn[];
  pipeline_open: NonNullable<DashboardOverview["kpis"]["pipeline_open"]>;
  conversion: NonNullable<DashboardOverview["kpis"]["conversion"]>;
  leads_month: NonNullable<DashboardOverview["kpis"]["leads_month"]>;
  sources_30d: { source: string; count: number }[];
  attention: AttentionItem[];
} {
  const stages = canonicalStagesFor(stageRows);
  const columns = new Map<CanonicalStage, BoardColumn>(
    stages.map((s) => [s.slug, { ...s, count: 0, value: 0, leads: [] }]),
  );
  const todayKey = zonedDateKey(now, tz);
  const monthStart = startOfZonedMonth(now, tz).getTime();
  const prevMonthStart = startOfZonedMonth(now, tz, -1).getTime();
  const sourcesSince = now.getTime() - 30 * DAY;

  let openValue = 0;
  let openCount = 0;
  let withoutValue = 0;
  let won = 0;
  let lost = 0;
  let monthCount = 0;
  let prevMonthCount = 0;
  const sources = new Map<string, number>();
  const attention: AttentionItem[] = [];

  // Newest first — matches the previous dashboard preview order.
  const sorted = [...leads].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  for (const lead of sorted) {
    const stage = resolveLeadStage(
      { status: lead.status, pipelineStageId: lead.pipelineStageId, stageSlug: lead.stageSlug },
      stageRows,
    );
    const value = num(lead.estimatedValue);
    const created = lead.createdAt.getTime();
    const uncontacted = stage === "new_lead" && !lead.lastContactedAt;

    const col = columns.get(stage)!;
    col.count += 1;
    col.value += value ?? 0;
    if (col.leads.length < BOARD_PREVIEW_SIZE) {
      col.leads.push({
        id: lead.id,
        name: lead.name,
        stage,
        value,
        source: lead.source,
        summary: summaryLine(lead.notes),
        owner_name: lead.ownerName,
        created_at: lead.createdAt.toISOString(),
        last_contacted_at: lead.lastContactedAt ? lead.lastContactedAt.toISOString() : null,
        uncontacted,
        phone: lead.phone,
      });
    }

    if (stage === "won") won += 1;
    else if (stage === "lost") lost += 1;
    else {
      openCount += 1;
      if (value == null || value <= 0) withoutValue += 1;
      else openValue += value;
    }

    if (created >= monthStart) monthCount += 1;
    else if (created >= prevMonthStart) prevMonthCount += 1;

    if (created >= sourcesSince) {
      const src = String(lead.source || "").trim() || "Sem origem";
      sources.set(src, (sources.get(src) || 0) + 1);
    }

    const entity = { type: "lead" as const, id: lead.id, name: lead.name };
    const href = `lead-detail.html?id=${encodeURIComponent(lead.id)}`;

    if (uncontacted) {
      const age = now.getTime() - created;
      if (age < NEW_LEAD_SLA_MS) {
        attention.push({
          key: `lead_sla:${lead.id}`,
          kind: "lead_sla",
          priority: "high",
          entity,
          href,
          at: lead.createdAt.toISOString(),
          deadline: new Date(created + NEW_LEAD_SLA_MS).toISOString(),
          amount: value,
          phone: lead.phone,
          source: lead.source,
        });
      } else {
        attention.push({
          key: `lead_uncontacted:${lead.id}`,
          kind: "lead_uncontacted",
          priority: age <= UNCONTACTED_HIGH_MS ? "high" : "medium",
          entity,
          href,
          at: lead.createdAt.toISOString(),
          amount: value,
          phone: lead.phone,
          source: lead.source,
        });
      }
    }

    if (isOpenStage(stage)) {
      for (const f of pendingFollowups(lead.followups, tz)) {
        const diff = daysBetweenKeys(f.dueKey, todayKey);
        if (diff < 0) continue;
        attention.push({
          key: `followup:${lead.id}:${f.id}`,
          kind: diff > 0 ? "followup_overdue" : "followup_today",
          priority: diff > 0 ? "high" : "medium",
          entity,
          href,
          at: `${f.dueKey}T12:00:00.000Z`,
          days: diff,
          label: f.title,
          phone: lead.phone,
        });
      }
    }
  }

  for (const col of columns.values()) col.value = round2(col.value);

  const topSources = [...sources.entries()].sort((a, b) => b[1] - a[1]);
  const sources_30d = topSources.slice(0, 5).map(([source, count]) => ({ source, count }));
  const rest = topSources.slice(5).reduce((s, [, c]) => s + c, 0);
  if (rest > 0) sources_30d.push({ source: "Outras", count: rest });

  return {
    board: stages.filter((s) => s.slug !== "lost").map((s) => columns.get(s.slug)!),
    pipeline_open: { value: round2(openValue), count: openCount, without_value: withoutValue },
    conversion: {
      rate: won + lost > 0 ? Math.round((won / (won + lost)) * 1000) / 10 : null,
      won,
      lost,
    },
    leads_month: { count: monthCount, previous_count: prevMonthCount },
    sources_30d,
    attention,
  };
}

/** When a won quote was closed: signature date, else last update. */
function quoteClosedAt(q: QuoteRow): Date {
  return q.signedAt ?? q.updatedAt;
}

export function buildQuoteSection(
  quotes: QuoteRow[],
  now: Date,
  tz: string,
  showMoney: boolean,
): { won_month: NonNullable<DashboardOverview["kpis"]["won_month"]>; attention: AttentionItem[] } {
  const monthStart = startOfZonedMonth(now, tz).getTime();
  const prevMonthStart = startOfZonedMonth(now, tz, -1).getTime();
  let value = 0;
  let count = 0;
  let prevValue = 0;
  let prevCount = 0;
  const attention: AttentionItem[] = [];

  for (const q of quotes) {
    const status = String(q.status || "").toLowerCase();
    const name = q.customerName || q.title || `Quote #${q.number}`;
    const entity = { type: "quote" as const, id: q.id, name };
    const href = `quote-builder.html?id=${encodeURIComponent(q.id)}`;
    const label = q.quoteNumber || `#${q.number}`;
    const amount = showMoney ? q.total : null;

    if (WON_QUOTE_SET.has(status)) {
      const t = quoteClosedAt(q).getTime();
      if (t >= monthStart) {
        value += q.total;
        count += 1;
      } else if (t >= prevMonthStart) {
        prevValue += q.total;
        prevCount += 1;
      }
      continue;
    }

    if (status === "changes_requested") {
      attention.push({
        key: `quote_changes:${q.id}`,
        kind: "quote_changes",
        priority: "high",
        entity,
        href,
        at: q.updatedAt.toISOString(),
        amount,
        label,
      });
      continue;
    }

    if (status !== "sent") continue;
    const validUntil = q.validUntil ? q.validUntil.getTime() : null;
    if (validUntil != null && validUntil >= now.getTime() && validUntil - now.getTime() <= EXPIRING_QUOTE_MS) {
      attention.push({
        key: `quote_expiring:${q.id}`,
        kind: "quote_expiring",
        priority: "medium",
        entity,
        href,
        at: q.updatedAt.toISOString(),
        deadline: q.validUntil!.toISOString(),
        days: Math.max(0, zonedDayDiff(now, q.validUntil!, tz)),
        amount,
        label,
        viewed: !!q.viewedAt,
      });
      continue;
    }
    if (now.getTime() - q.updatedAt.getTime() >= STALE_QUOTE_MS) {
      attention.push({
        key: `quote_stale:${q.id}`,
        kind: "quote_stale",
        priority: "medium",
        entity,
        href,
        at: q.updatedAt.toISOString(),
        days: zonedDayDiff(q.updatedAt, now, tz),
        amount,
        label,
        viewed: !!q.viewedAt,
      });
    }
  }

  return {
    won_month: {
      value: showMoney ? round2(value) : null,
      count,
      previous_value: showMoney ? round2(prevValue) : null,
      previous_count: prevCount,
    },
    attention,
  };
}

export function buildInvoiceSection(
  invoices: InvoiceRow[],
  now: Date,
  tz: string,
): { receivables: NonNullable<DashboardOverview["kpis"]["receivables"]>; attention: AttentionItem[] } {
  const todayStart = startOfZonedDay(now, tz).getTime();
  let openValue = 0;
  let openCount = 0;
  let overdueValue = 0;
  let overdueCount = 0;
  const attention: AttentionItem[] = [];

  for (const inv of invoices) {
    if (CLOSED_INVOICE_STATUSES.has(String(inv.status || "").toLowerCase())) continue;
    const balance = Math.max(0, inv.amount - inv.paid);
    if (balance < 0.01) continue;
    openValue += balance;
    openCount += 1;
    if (inv.dueDate && inv.dueDate.getTime() < todayStart) {
      overdueValue += balance;
      overdueCount += 1;
      attention.push({
        key: `invoice_overdue:${inv.id}`,
        kind: "invoice_overdue",
        priority: "high",
        entity: { type: "invoice", id: inv.id, name: inv.customerName || inv.invoiceNumber || "Invoice" },
        href: `invoice.html?id=${encodeURIComponent(inv.id)}`,
        at: inv.dueDate.toISOString(),
        days: Math.max(1, zonedDayDiff(inv.dueDate, now, tz)),
        amount: round2(balance),
        label: inv.invoiceNumber,
      });
    }
  }

  return {
    receivables: {
      open_value: round2(openValue),
      open_count: openCount,
      overdue_value: round2(overdueValue),
      overdue_count: overdueCount,
    },
    attention,
  };
}

const KIND_RANK: Record<AttentionKind, number> = {
  lead_sla: 0,
  invoice_overdue: 1,
  quote_changes: 2,
  followup_overdue: 3,
  lead_uncontacted: 4,
  followup_today: 5,
  quote_expiring: 6,
  quote_stale: 7,
};

/** Priority first, then kind, then the most pressing item of each kind. */
export function rankAttention(items: AttentionItem[]): AttentionItem[] {
  const pressure = (it: AttentionItem): number => {
    const at = it.at ? Date.parse(it.at) : 0;
    switch (it.kind) {
      case "lead_sla":
        return at; // closest to the 30-min deadline first
      case "lead_uncontacted":
        return -at; // freshest first — speed-to-lead matters most while the lead is hot
      case "invoice_overdue":
      case "followup_overdue":
      case "quote_stale":
        return -(it.days ?? 0); // most overdue first
      case "quote_expiring":
        return it.deadline ? Date.parse(it.deadline) : at; // soonest first
      default:
        return at;
    }
  };
  const ranked = [...items].sort((a, b) => {
    if (a.priority !== b.priority) return a.priority === "high" ? -1 : 1;
    if (KIND_RANK[a.kind] !== KIND_RANK[b.kind]) return KIND_RANK[a.kind] - KIND_RANK[b.kind];
    return pressure(a) - pressure(b);
  });
  // One row per lead: its most pressing reason is enough to act on it.
  const seenLeads = new Set<string>();
  return ranked.filter((it) => {
    if (it.entity.type !== "lead") return true;
    if (seenLeads.has(it.entity.id)) return false;
    seenLeads.add(it.entity.id);
    return true;
  });
}

export function buildTodayEvents(meetings: MeetingRow[], workOrders: WorkOrderRow[]): TodayEvent[] {
  const events: TodayEvent[] = [
    ...workOrders.map((wo) => ({
      id: wo.id,
      type: "job" as const,
      title: wo.title,
      start: wo.scheduledStart.toISOString(),
      end: wo.scheduledEnd.toISOString(),
      status: wo.fieldStatus && wo.status === "in_progress" ? wo.fieldStatus : wo.status,
      person: wo.crewName || wo.assigneeName || null,
      address: wo.address,
      color: wo.crewColor,
      href: `job-detail.html?id=${encodeURIComponent(wo.id)}`,
      lead_id: null,
    })),
    ...meetings.map((m) => ({
      id: m.id,
      type: "visit" as const,
      title: m.title.replace(/^Visit\s+—\s+/i, "Visita — "),
      start: m.scheduledStart.toISOString(),
      end: m.scheduledEnd.toISOString(),
      status: m.status,
      person: m.assigneeName || null,
      address: m.location,
      color: null,
      href: m.leadId ? `lead-detail.html?id=${encodeURIComponent(m.leadId)}` : "schedule.html",
      lead_id: m.leadId,
    })),
  ];
  return events.sort((a, b) => a.start.localeCompare(b.start));
}

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

type RawLead = {
  id: string;
  name: string;
  phone: string | null;
  source: string | null;
  status: string | null;
  notes: string | null;
  pipelineStageId: string | null;
  stageSlug: string | null;
  ownerName: string | null;
  estimatedValue: string | null;
  followups: unknown;
  lastContactedAt: Date | null;
  createdAt: Date;
};

export async function loadDashboardOverview(
  tx: TenantPrisma,
  params: { organizationId: string; timezone: string; access: ViewerAccess; now?: Date },
): Promise<DashboardOverview> {
  const { organizationId, timezone: tz, access } = params;
  const now = params.now ?? new Date();
  const monthStart = startOfZonedMonth(now, tz);
  const prevMonthStart = startOfZonedMonth(now, tz, -1);
  const todayStart = startOfZonedDay(now, tz);
  const tomorrowStart = startOfZonedDay(now, tz, 1);

  const overview: DashboardOverview = {
    generated_at: now.toISOString(),
    timezone: tz,
    today: zonedDateKey(now, tz),
    period: {
      month_start: monthStart.toISOString(),
      previous_month_start: prevMonthStart.toISOString(),
      today_start: todayStart.toISOString(),
      tomorrow_start: tomorrowStart.toISOString(),
    },
    access,
    kpis: { pipeline_open: null, conversion: null, leads_month: null, won_month: null, receivables: null },
    board: null,
    sources_30d: null,
    attention: { total: 0, high: 0, items: [] },
    today_events: null,
  };
  const attention: AttentionItem[] = [];

  if (access.leads) {
    const stageRows = await tx.pipelineStage.findMany({
      where: { isActive: true },
      orderBy: { order: "asc" },
      select: { id: true, name: true, slug: true, order: true, color: true, isClosed: true },
    });
    // Only the columns the dashboard needs — avoids loading every lead's full metadata JSON.
    const leads = await tx.$queryRaw<RawLead[]>`
      SELECT l.id, l.name, l.phone, l.source, l.status, l.notes,
             l."pipelineStageId", ps.slug AS "stageSlug", u.name AS "ownerName",
             l.metadata->>'estimated_value' AS "estimatedValue",
             CASE WHEN jsonb_typeof(l.metadata->'followups') = 'array'
                  THEN l.metadata->'followups' ELSE NULL END AS "followups",
             l."lastContactedAt", l."createdAt"
        FROM "Lead" l
        LEFT JOIN "PipelineStage" ps ON ps.id = l."pipelineStageId"
        LEFT JOIN "User" u ON u.id = l."ownerId"
       WHERE l."organizationId" = ${organizationId}::uuid`;
    const section = buildLeadSection(leads, stageRows, now, tz);
    overview.board = section.board;
    overview.sources_30d = section.sources_30d;
    overview.kpis.pipeline_open = section.pipeline_open;
    overview.kpis.conversion = section.conversion;
    overview.kpis.leads_month = section.leads_month;
    attention.push(...section.attention);
  }

  if (access.quotes) {
    const quotes = await tx.quote.findMany({
      where: {
        OR: [
          { status: { in: ["sent", "changes_requested"] } },
          {
            status: { in: [...WON_QUOTE_STATUSES] },
            OR: [{ signedAt: { gte: prevMonthStart } }, { signedAt: null, updatedAt: { gte: prevMonthStart } }],
          },
        ],
      },
      select: {
        id: true,
        number: true,
        quoteNumber: true,
        title: true,
        status: true,
        total: true,
        leadId: true,
        signedAt: true,
        viewedAt: true,
        validUntil: true,
        updatedAt: true,
        createdAt: true,
        customer: { select: { name: true } },
      },
    });
    const section = buildQuoteSection(
      quotes.map((q) => ({ ...q, total: Number(q.total), customerName: q.customer?.name ?? null })),
      now,
      tz,
      access.pricing,
    );
    overview.kpis.won_month = section.won_month;
    attention.push(...section.attention);
  }

  if (access.invoices) {
    const invoices = await tx.quoteInvoice.findMany({
      where: { status: { notIn: ["draft", "paid", "void"] } },
      select: {
        id: true,
        invoiceNumber: true,
        status: true,
        amount: true,
        dueDate: true,
        quoteId: true,
        customer: { select: { name: true } },
        quote: { select: { customer: { select: { name: true } } } },
        workOrder: { select: { builder: { select: { company: true, firstName: true, lastName: true } } } },
        receipts: { select: { amount: true } },
      },
    });
    const section = buildInvoiceSection(
      invoices.map((inv) => ({
        id: inv.id,
        invoiceNumber: inv.invoiceNumber,
        status: inv.status,
        amount: Number(inv.amount),
        paid: inv.receipts.reduce((s, r) => s + Number(r.amount), 0),
        dueDate: inv.dueDate,
        quoteId: inv.quoteId,
        customerName:
          inv.customer?.name ??
          inv.quote?.customer?.name ??
          (inv.workOrder?.builder
            ? inv.workOrder.builder.company ||
              [inv.workOrder.builder.firstName, inv.workOrder.builder.lastName].filter(Boolean).join(" ").trim() ||
              null
            : null),
      })),
      now,
      tz,
    );
    overview.kpis.receivables = section.receivables;
    attention.push(...section.attention);
  }

  if (access.schedule) {
    const [meetings, workOrders] = await Promise.all([
      tx.meeting.findMany({
        where: {
          status: { not: "canceled" },
          scheduledStart: { lt: tomorrowStart },
          scheduledEnd: { gt: todayStart },
        },
        orderBy: { scheduledStart: "asc" },
        select: {
          id: true,
          title: true,
          status: true,
          scheduledStart: true,
          scheduledEnd: true,
          location: true,
          customer: { select: { name: true } },
          assignedUser: { select: { name: true } },
        },
      }),
      tx.workOrder.findMany({
        where: {
          status: { not: "canceled" },
          scheduledStart: { not: null, lt: tomorrowStart },
          scheduledEnd: { not: null, gt: todayStart },
        },
        orderBy: { scheduledStart: "asc" },
        select: {
          id: true,
          number: true,
          title: true,
          status: true,
          fieldStatus: true,
          scheduledStart: true,
          scheduledEnd: true,
          address: true,
          customer: { select: { name: true } },
          assignedUser: { select: { name: true } },
          crew: { select: { name: true, color: true } },
        },
      }),
    ]);

    // Lead visits keep their Meeting id in lead.metadata.visits[].meeting_id.
    const meetingLead = new Map<string, string>();
    if (meetings.length && access.leads) {
      const rows = await tx.$queryRaw<{ id: string; meeting_id: string }[]>`
        SELECT l.id, v->>'meeting_id' AS meeting_id
          FROM "Lead" l, jsonb_array_elements(
                 CASE WHEN jsonb_typeof(l.metadata->'visits') = 'array' THEN l.metadata->'visits' ELSE '[]'::jsonb END
               ) v
         WHERE l."organizationId" = ${organizationId}::uuid
           AND v->>'meeting_id' = ANY(${meetings.map((m) => m.id)}::text[])`;
      for (const r of rows) meetingLead.set(r.meeting_id, r.id);
    }

    overview.today_events = buildTodayEvents(
      meetings.map((m) => ({
        id: m.id,
        title: m.title,
        status: m.status,
        scheduledStart: m.scheduledStart,
        scheduledEnd: m.scheduledEnd,
        location: m.location,
        customerName: m.customer?.name ?? null,
        assigneeName: m.assignedUser?.name ?? null,
        leadId: meetingLead.get(m.id) ?? null,
      })),
      workOrders.map((wo) => ({
        id: wo.id,
        number: wo.number,
        title: wo.title,
        status: wo.status,
        fieldStatus: wo.fieldStatus,
        scheduledStart: wo.scheduledStart!,
        scheduledEnd: wo.scheduledEnd!,
        address: wo.address,
        customerName: wo.customer?.name ?? null,
        assigneeName: wo.assignedUser?.name ?? null,
        crewName: wo.crew?.name ?? null,
        crewColor: wo.crew?.color ?? null,
      })),
    );
  }

  const ranked = rankAttention(attention);
  overview.attention = {
    total: ranked.length,
    high: ranked.filter((i) => i.priority === "high").length,
    items: ranked.slice(0, ATTENTION_LIMIT),
  };
  return overview;
}
