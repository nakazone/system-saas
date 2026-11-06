/**
 * Shared helpers for Campo field APIs (ponto, agenda, ticket).
 */
import type { AuthedRequest } from "../../middleware/auth.js";
import type { withTenantTransaction } from "../../lib/tenant/prisma-tenant.js";
import {
  DEFAULT_CAMPO_CHECKLIST,
  parseCampoChecklist,
} from "../../lib/job-media/checklist.js";
import { fieldAgendaAt, fieldPayrollSector, myFieldJobsWhere, type FieldPayrollSector } from "./field-sector.js";

export type Tx = Parameters<Parameters<typeof withTenantTransaction>[1]>[0];

export const FIELD_STATUSES = ["scheduled", "en_route", "on_site", "completed"] as const;
export type FieldStatus = (typeof FIELD_STATUSES)[number];

export type ChecklistItem = {
  id: string;
  text: string;
  done: boolean;
  photo_required?: boolean;
  photo_media_ids?: string[];
  note?: string | null;
  done_by?: string | null;
  done_at?: string | null;
};
export type PhotoItem = { id: string; url: string; createdAt: string };

export function canUseCampo(req: AuthedRequest): boolean {
  if (!req.user) return false;
  if (req.user.roleKey === "admin") return true;
  const p = req.user.permissions || [];
  return (
    p.includes("work_orders.view") ||
    p.includes("payroll.self") ||
    p.includes("schedule.view") ||
    p.includes("visits.view")
  );
}

export function pad(n: number) {
  return String(n).padStart(2, "0");
}

export function hhmm(d: Date) {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Date-only label for Campo job cards (no clock time). */
export function dayOnlyLabel(d: Date, today = new Date()) {
  const y = (x: Date) => `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
  if (y(d) === y(today)) return "Hoje";
  return d.toLocaleDateString("pt-BR", { day: "numeric", month: "short" });
}

export function dayBoundsLocal(d = new Date()) {
  const start = new Date(d);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
}

/** Field-facing client name: homeowner / customer full name — never builder nickname. */
export function clientLabel(wo: {
  homeownerName?: string | null;
  customer?: { name?: string | null; company?: string | null } | null;
  builder?: { company?: string | null; firstName?: string | null; lastName?: string | null; nickname?: string | null } | null;
  sourceName?: string | null;
}) {
  const homeowner = String(wo.homeownerName || "").trim();
  if (homeowner) return homeowner;
  const customer = String(wo.customer?.name || wo.customer?.company || "").trim();
  if (customer) return customer;
  const company = String(wo.builder?.company || "").trim();
  if (company) return company;
  if (wo.builder?.firstName) {
    return `${wo.builder.firstName}${wo.builder.lastName ? ` ${wo.builder.lastName}` : ""}`.trim();
  }
  return wo.sourceName || "—";
}

export function shortClient(name: string) {
  const p = String(name || "")
    .trim()
    .split(/\s+/)[0];
  return p || name || "—";
}

export const DEFAULT_CHECKLIST: ChecklistItem[] = DEFAULT_CAMPO_CHECKLIST;

export function parseChecklist(raw: unknown): ChecklistItem[] {
  return parseCampoChecklist(raw);
}

export function parsePhotos(raw: unknown): PhotoItem[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      const row = item as Record<string, unknown>;
      if (!row.url) return null;
      return {
        id: String(row.id || `p-${Date.now()}`),
        url: String(row.url),
        createdAt: String(row.createdAt || new Date().toISOString()),
      };
    })
    .filter(Boolean) as PhotoItem[];
}

export function fieldStatusLabel(status: string) {
  const map: Record<string, string> = {
    scheduled: "Agendada",
    en_route: "Em andamento",
    on_site: "Em andamento",
    completed: "Concluída",
    in_progress: "Em andamento",
  };
  return map[status] || status;
}

/**
 * ObraCrew production label from Jobs chronology only
 * (Scheduled → In the Field → Completed). Never billing.
 */
export function crewProductionLabel(wo: {
  status: string;
  sector?: string | null;
  installationDoneAt?: Date | string | null;
  sandDoneAt?: Date | string | null;
}) {
  const office = String(wo.status || "").toLowerCase();
  if (office === "canceled") return "Cancelado";
  if (office === "completed") return "Concluído";
  if (office === "in_progress") {
    const sector = String(wo.sector || "").toLowerCase();
    if (sector === "sand_finish") return "Sanding";
    if (sector === "both" && wo.installationDoneAt && !wo.sandDoneAt) return "Sanding";
    return "Installing";
  }
  return "Agendado";
}

/** Local calendar day YYYY-MM-DD (device/server local — list badges only). */
function ymdLocal(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Job is treated as started once its scheduled calendar day arrives (no en-route check-in). */
export function isStartedBySchedule(
  scheduledStart: Date | string | null | undefined,
  officeStatus: string,
  fieldStatus?: string | null,
) {
  if (officeStatus === "completed" || fieldStatus === "completed") return false;
  if (officeStatus === "canceled") return false;
  if (officeStatus === "in_progress" || fieldStatus === "on_site" || fieldStatus === "en_route") return true;
  if (!scheduledStart) return false;
  const d = scheduledStart instanceof Date ? scheduledStart : new Date(scheduledStart);
  if (Number.isNaN(d.getTime())) return false;
  return ymdLocal(d) <= ymdLocal(new Date());
}

/** UI status key used by Campo lists */
export function uiStatusFromField(
  fieldStatus: string | null | undefined,
  officeStatus: string,
  scheduledStart?: Date | string | null,
) {
  if (fieldStatus === "completed" || officeStatus === "completed") return "done";
  if (isStartedBySchedule(scheduledStart, officeStatus, fieldStatus)) return "in_progress";
  if (fieldStatus === "scheduled") return "scheduled";
  if (officeStatus === "scheduled" || officeStatus === "draft") return "scheduled";
  return officeStatus;
}

export function nextFieldStatus(current: string): FieldStatus | null {
  if (current === "scheduled") return "en_route";
  if (current === "en_route") return "on_site";
  if (current === "on_site") return "completed";
  return null;
}

/** Path CTAs removed — field opens the camera instead. */
export function ctaLabel(_fieldStatus: string) {
  return null;
}

export const woListInclude = {
  customer: { select: { id: true, name: true, company: true } },
  builder: { select: { id: true, firstName: true, lastName: true, company: true } },
  crew: { select: { id: true, name: true } },
  assignedUser: { select: { id: true, name: true } },
  members: { select: { userId: true, user: { select: { id: true, name: true } } } },
  lineItems: {
    orderBy: { sortOrder: "asc" as const },
    select: {
      id: true,
      serviceName: true,
      quantitySqft: true,
      unitPrice: true,
      lineTotal: true,
    },
  },
} as const;

export const woTicketInclude = {
  ...woListInclude,
  media: {
    where: { deletedAt: null },
    orderBy: [{ createdAt: "desc" as const }],
    take: 120,
    include: { author: { select: { id: true, name: true } } },
  },
};

export function myJobAccessWhere(userId: string) {
  return {
    OR: [
      { assignedUserId: userId },
      { members: { some: { userId } } },
      { crew: { members: { some: { userId } } } },
      // Jobs the employee put on one of their work days (helped on a job not assigned to them).
      { campoShiftJobs: { some: { shift: { userId } } } },
    ],
  };
}

export async function assertMyJob(tx: Tx, userId: string, jobId: string) {
  const sector = await fieldPayrollSector(tx, userId);
  const wo = await tx.workOrder.findFirst({
    where: {
      id: jobId,
      status: { not: "canceled" },
      ...myFieldJobsWhere(userId, sector),
    },
    include: woListInclude,
  });
  if (!wo) {
    throw Object.assign(new Error("Obra não encontrada ou sem acesso"), { status: 404 });
  }
  return wo;
}

export async function assertMyJobTicket(tx: Tx, userId: string, jobId: string) {
  const sector = await fieldPayrollSector(tx, userId);
  const wo = await tx.workOrder.findFirst({
    where: {
      id: jobId,
      status: { not: "canceled" },
      ...myFieldJobsWhere(userId, sector),
    },
    include: woTicketInclude,
  });
  if (!wo) {
    throw Object.assign(new Error("Obra não encontrada ou sem acesso"), { status: 404 });
  }
  return wo;
}

export function teamLabel(wo: {
  crew?: { name: string } | null;
  assignedUser?: { name: string } | null;
  members?: { user?: { name: string } | null }[];
}) {
  const teamNames = [
    wo.assignedUser?.name,
    ...(wo.members || []).map((m) => m.user?.name),
  ].filter(Boolean);
  const unique = [...new Set(teamNames)];
  const crew = wo.crew?.name || "";
  if (crew && unique.length) return `${crew} · ${unique.slice(0, 3).join(", ")}`;
  if (crew) return crew;
  if (unique.length) return unique.slice(0, 3).join(", ");
  return null;
}

export function mapJobCard(
  wo: {
    id: string;
    number: number | null;
    title: string;
    status: string;
    fieldStatus?: string | null;
    address: string | null;
    sector?: string | null;
    homeownerName?: string | null;
    scheduledStart: Date | null;
    scheduledEnd: Date | null;
    sandScheduledStart?: Date | null;
    installationDoneAt?: Date | null;
    sandDoneAt?: Date | null;
    sourceName?: string | null;
    customer?: { name?: string | null; company?: string | null } | null;
    builder?: { company?: string | null; firstName?: string | null; lastName?: string | null } | null;
    crew?: { name: string } | null;
    assignedUser?: { name: string } | null;
    members?: { user?: { name: string } | null }[];
  },
  opts?: { currentWoId?: string | null; fieldSector?: FieldPayrollSector },
) {
  const client = clientLabel(wo);
  const field = wo.fieldStatus || "scheduled";
  const at = fieldAgendaAt(wo, opts?.fieldSector ?? null) || wo.scheduledStart;
  // ObraCrew card status follows Jobs production only (not schedule-day heuristics / billing).
  let status: string =
    wo.status === "completed" || field === "completed"
      ? "done"
      : wo.status === "in_progress"
        ? "in_progress"
        : "scheduled";
  if (opts?.currentWoId === wo.id && status !== "done") {
    status = "in_progress";
  }
  const sandView = opts?.fieldSector === "sand_finish" && (wo.sector === "both" || wo.sector === "sand_finish");
  return {
    id: wo.id,
    number: wo.number,
    title: wo.title,
    client,
    client_short: shortClient(client),
    homeowner_name: wo.homeownerName || null,
    address: wo.address || "",
    start: at ? dayOnlyLabel(at) : null,
    end: null,
    scheduled_start: at?.toISOString() ?? null,
    scheduled_end: sandView ? null : wo.scheduledEnd?.toISOString() ?? null,
    sand_scheduled_start: wo.sandScheduledStart?.toISOString() ?? null,
    installation_done_at: wo.installationDoneAt?.toISOString() ?? null,
    sand_done_at: wo.sandDoneAt?.toISOString() ?? null,
    sector: wo.sector ?? null,
    phase: sandView ? "sand_finish" : wo.sector === "both" ? "installation" : wo.sector ?? null,
    status,
    field_status: field,
    field_status_label: crewProductionLabel(wo),
    raw_status: wo.status,
    team: teamLabel(wo),
    crew_name: wo.crew?.name || null,
  };
}

export function dec(n: { toNumber?: () => number } | number | null | undefined) {
  if (n == null) return 0;
  if (typeof n === "number") return n;
  if (typeof n.toNumber === "function") return n.toNumber();
  return Number(n) || 0;
}
