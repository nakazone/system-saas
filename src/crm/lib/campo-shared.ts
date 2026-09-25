/**
 * Shared helpers for Campo field APIs (ponto, agenda, ticket).
 */
import type { AuthedRequest } from "../../middleware/auth.js";
import type { withTenantTransaction } from "../../lib/tenant/prisma-tenant.js";

export type Tx = Parameters<Parameters<typeof withTenantTransaction>[1]>[0];

export const FIELD_STATUSES = ["scheduled", "en_route", "on_site", "completed"] as const;
export type FieldStatus = (typeof FIELD_STATUSES)[number];

export type ChecklistItem = { id: string; text: string; done: boolean };
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

export function dayBoundsLocal(d = new Date()) {
  const start = new Date(d);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
}

export function clientLabel(wo: {
  customer?: { name: string } | null;
  builder?: { company?: string | null; firstName?: string | null; lastName?: string | null } | null;
  sourceName?: string | null;
}) {
  if (wo.customer?.name) return wo.customer.name;
  if (wo.builder?.company) return wo.builder.company;
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

export const DEFAULT_CHECKLIST: ChecklistItem[] = [
  { id: "c1", text: "Móveis fora da sala e do corredor", done: false },
  { id: "c2", text: "Rodapés protegidos com fita", done: false },
  { id: "c3", text: "Lixa grão 36 → 60 → 100", done: false },
  { id: "c4", text: "Aspiração completa entre passadas", done: false },
  { id: "c5", text: "Foto de depois de cada cômodo", done: false },
];

export function parseChecklist(raw: unknown): ChecklistItem[] {
  if (!Array.isArray(raw) || !raw.length) {
    return DEFAULT_CHECKLIST.map((x) => ({ ...x }));
  }
  return raw.map((item, i) => {
    const row = item as Record<string, unknown>;
    return {
      id: String(row.id || `c${i + 1}`),
      text: String(row.text || "Item"),
      done: Boolean(row.done),
    };
  });
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
    en_route: "A caminho",
    on_site: "No local",
    completed: "Concluída",
  };
  return map[status] || status;
}

/** UI status key used by Campo lists */
export function uiStatusFromField(fieldStatus: string | null | undefined, officeStatus: string) {
  if (fieldStatus === "completed" || officeStatus === "completed") return "done";
  if (fieldStatus === "on_site") return "on_site";
  if (fieldStatus === "en_route") return "en_route";
  if (fieldStatus === "scheduled") return "scheduled";
  if (officeStatus === "in_progress") return "in_progress";
  if (officeStatus === "scheduled" || officeStatus === "draft") return "scheduled";
  return officeStatus;
}

export function nextFieldStatus(current: string): FieldStatus | null {
  if (current === "scheduled") return "en_route";
  if (current === "en_route") return "on_site";
  if (current === "on_site") return "completed";
  return null;
}

export function ctaLabel(fieldStatus: string) {
  if (fieldStatus === "scheduled") return "Estou a caminho";
  if (fieldStatus === "en_route") return "Cheguei no local";
  if (fieldStatus === "on_site") return "Concluir visita";
  return null;
}

export const woListInclude = {
  customer: { select: { id: true, name: true } },
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

export function myJobAccessWhere(userId: string) {
  return {
    OR: [
      { assignedUserId: userId },
      { members: { some: { userId } } },
      { crew: { members: { some: { userId } } } },
    ],
  };
}

export async function assertMyJob(tx: Tx, userId: string, jobId: string) {
  const wo = await tx.workOrder.findFirst({
    where: {
      id: jobId,
      status: { not: "canceled" },
      ...myJobAccessWhere(userId),
    },
    include: woListInclude,
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
    scheduledStart: Date | null;
    scheduledEnd: Date | null;
    sourceName?: string | null;
    customer?: { name: string } | null;
    builder?: { company?: string | null; firstName?: string | null; lastName?: string | null } | null;
    crew?: { name: string } | null;
    assignedUser?: { name: string } | null;
    members?: { user?: { name: string } | null }[];
  },
  opts?: { currentWoId?: string | null },
) {
  const client = clientLabel(wo);
  const field = wo.fieldStatus || "scheduled";
  let status = uiStatusFromField(field, wo.status);
  if (opts?.currentWoId === wo.id && field !== "completed") {
    status = "on_site";
  }
  return {
    id: wo.id,
    number: wo.number,
    title: wo.title,
    client,
    client_short: shortClient(client),
    address: wo.address || "",
    start: wo.scheduledStart ? hhmm(wo.scheduledStart) : null,
    end: wo.scheduledEnd ? hhmm(wo.scheduledEnd) : null,
    scheduled_start: wo.scheduledStart?.toISOString() ?? null,
    scheduled_end: wo.scheduledEnd?.toISOString() ?? null,
    status,
    field_status: field,
    field_status_label: fieldStatusLabel(field),
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
