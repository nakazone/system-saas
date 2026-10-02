/**
 * Configurações › Agenda — calendars livres (Jobs/Visitas/Meetings/Extra).
 * Jobs podem ter sector: all | installation | sand_finish.
 */
import { z } from "zod";
import { randomUUID } from "crypto";

export type ScheduleCalendarKind = "jobs" | "visits" | "meetings" | "custom";
export type ScheduleJobSector = "all" | "installation" | "sand_finish";

export type ScheduleCalendar = {
  id: string;
  name: string;
  color: string;
  kind: ScheduleCalendarKind;
  /** Only for kind=jobs. all = catches jobs without a specific sector match. */
  sector?: ScheduleJobSector;
};

export type ScheduleSettings = {
  calendars: ScheduleCalendar[];
};

const COLOR_RE = /^#[0-9A-Fa-f]{6}$/;
const UUID_RE = /^[0-9a-f-]{36}$/i;

export const DEFAULT_SCHEDULE_CALENDARS: ScheduleCalendar[] = [
  { id: "jobs", name: "Jobs", color: "#e8792c", kind: "jobs", sector: "all" },
  { id: "visits", name: "Visitas", color: "#7a5ea8", kind: "visits" },
  { id: "meetings", name: "Meetings", color: "#3b6ea5", kind: "meetings" },
];

export function defaultScheduleSettings(): ScheduleSettings {
  return {
    calendars: DEFAULT_SCHEDULE_CALENDARS.map((c) => ({ ...c })),
  };
}

function normalizeColor(raw: unknown, fallback: string): string {
  if (typeof raw !== "string") return fallback;
  const v = raw.trim();
  if (COLOR_RE.test(v)) return v.toLowerCase();
  return fallback;
}

function normalizeName(raw: unknown, fallback: string): string {
  if (typeof raw !== "string") return fallback;
  const v = raw.trim().slice(0, 80);
  return v || fallback;
}

function kindOf(r: Record<string, unknown>): ScheduleCalendarKind {
  if (r.kind === "jobs" || r.kind === "visits" || r.kind === "meetings" || r.kind === "custom") {
    return r.kind;
  }
  if (r.id === "jobs") return "jobs";
  if (r.id === "visits") return "visits";
  if (r.id === "meetings") return "meetings";
  return "custom";
}

function sectorOf(r: Record<string, unknown>, kind: ScheduleCalendarKind): ScheduleJobSector | undefined {
  if (kind !== "jobs") return undefined;
  if (r.sector === "installation" || r.sector === "sand_finish" || r.sector === "all") {
    return r.sector;
  }
  return "all";
}

function stableId(r: Record<string, unknown>, kind: ScheduleCalendarKind): string {
  if (typeof r.id === "string" && r.id.trim()) {
    const id = r.id.trim();
    // Keep legacy fixed ids and UUIDs.
    if (id === "jobs" || id === "visits" || id === "meetings" || UUID_RE.test(id)) return id;
  }
  if (kind === "visits") return randomUUID();
  if (kind === "meetings") return randomUUID();
  if (kind === "jobs") return randomUUID();
  return randomUUID();
}

/** Normalize stored JSON. Empty/missing → defaults. Otherwise trust the list as-is. */
export function parseScheduleSettings(raw: unknown): ScheduleSettings {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return defaultScheduleSettings();
  }
  const o = raw as Record<string, unknown>;
  const list = Array.isArray(o.calendars) ? o.calendars : [];
  if (!list.length) return defaultScheduleSettings();

  const out: ScheduleCalendar[] = [];
  const seen = new Set<string>();

  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const kind = kindOf(r);
    const id = stableId(r, kind);
    if (seen.has(id)) continue;
    seen.add(id);
    const fallbackName =
      kind === "jobs" ? "Jobs" : kind === "visits" ? "Visitas" : kind === "meetings" ? "Meetings" : "Agenda";
    const fallbackColor =
      kind === "jobs" ? "#e8792c" : kind === "visits" ? "#7a5ea8" : kind === "meetings" ? "#3b6ea5" : "#16a34a";
    const cal: ScheduleCalendar = {
      id,
      kind,
      name: normalizeName(r.name, fallbackName),
      color: normalizeColor(r.color, fallbackColor),
    };
    const sector = sectorOf(r, kind);
    if (sector) cal.sector = sector;
    out.push(cal);
  }

  return out.length ? { calendars: out } : defaultScheduleSettings();
}

export function serializeScheduleSettings(settings: ScheduleSettings) {
  return {
    calendars: settings.calendars.map((c) => ({
      id: c.id,
      name: c.name,
      color: c.color,
      kind: c.kind,
      ...(c.kind === "jobs" ? { sector: c.sector || "all" } : {}),
    })),
  };
}

const calendarSchema = z.object({
  id: z.string().min(1).max(64).optional(),
  name: z.string().trim().min(1, "Nome obrigatório").max(80),
  color: z.string().regex(COLOR_RE, "Cor inválida"),
  kind: z.enum(["jobs", "visits", "meetings", "custom"]).optional(),
  sector: z.enum(["all", "installation", "sand_finish"]).optional().nullable(),
});

export const scheduleSettingsPutSchema = z.object({
  calendars: z.array(calendarSchema).min(0).max(24),
});

export type ScheduleSettingsPut = z.infer<typeof scheduleSettingsPutSchema>;

/** Apply PUT body as the full calendar list (no forced built-ins). */
export function applyScheduleSettingsPut(body: ScheduleSettingsPut): ScheduleSettings {
  const out: ScheduleCalendar[] = [];
  const seen = new Set<string>();

  for (const row of body.calendars) {
    const kind =
      row.kind ||
      (row.id === "jobs"
        ? "jobs"
        : row.id === "visits"
          ? "visits"
          : row.id === "meetings"
            ? "meetings"
            : "custom");
    const id =
      row.id && (row.id === "jobs" || row.id === "visits" || row.id === "meetings" || UUID_RE.test(row.id))
        ? row.id
        : randomUUID();
    if (seen.has(id)) continue;
    seen.add(id);
    const cal: ScheduleCalendar = {
      id,
      kind,
      name: row.name.trim() || (kind === "jobs" ? "Jobs" : kind === "visits" ? "Visitas" : kind === "meetings" ? "Meetings" : "Agenda"),
      color: row.color.toLowerCase(),
    };
    if (kind === "jobs") {
      cal.sector =
        row.sector === "installation" || row.sector === "sand_finish" || row.sector === "all"
          ? row.sector
          : "all";
    }
    out.push(cal);
  }

  return { calendars: out };
}

/** Attach custom agendas found on meetings but missing from settings. */
export function mergeOrphanCalendars(
  settings: ScheduleSettings,
  orphanIds: Array<string | null | undefined>,
): { settings: ScheduleSettings; added: boolean } {
  const known = new Set(settings.calendars.map((c) => c.id));
  const extras: ScheduleCalendar[] = [];
  let added = false;
  for (const raw of orphanIds) {
    if (!raw || typeof raw !== "string") continue;
    if (!UUID_RE.test(raw)) continue;
    if (known.has(raw)) continue;
    extras.push({
      id: raw,
      kind: "custom",
      name: "Agenda",
      color: "#16a34a",
    });
    known.add(raw);
    added = true;
  }
  if (!added) return { settings, added: false };
  return { settings: { calendars: [...settings.calendars, ...extras] }, added: true };
}

export function resolveMeetingColor(
  settings: ScheduleSettings,
  calendarId: string | null | undefined,
): string {
  const id = calendarId || "meetings";
  const hit = settings.calendars.find((c) => c.id === id);
  if (hit) return hit.color;
  return settings.calendars.find((c) => c.kind === "meetings")?.color || "#3b6ea5";
}

export function resolveVisitColor(settings: ScheduleSettings): string {
  return settings.calendars.find((c) => c.kind === "visits")?.color || "#7a5ea8";
}

export function resolveVisitCalendarId(settings: ScheduleSettings): string {
  return settings.calendars.find((c) => c.kind === "visits")?.id || "visits";
}

/**
 * Pick which jobs calendar a work order belongs to.
 * Match: exact sector → jobs/all → first jobs → synthetic "jobs".
 */
export function resolveJobCalendar(
  settings: ScheduleSettings,
  sector: string | null | undefined,
): ScheduleCalendar {
  const jobs = settings.calendars.filter((c) => c.kind === "jobs");
  const sec =
    sector === "installation" || sector === "sand_finish" ? sector : null;
  if (sec) {
    const hit = jobs.find((c) => (c.sector || "all") === sec);
    if (hit) return hit;
  }
  const all = jobs.find((c) => (c.sector || "all") === "all");
  if (all) return all;
  if (jobs[0]) return jobs[0];
  return { id: "jobs", name: "Jobs", color: "#e8792c", kind: "jobs", sector: "all" };
}

export function resolveJobColor(
  settings: ScheduleSettings,
  crewColor: string | null | undefined,
  sector?: string | null,
): string {
  if (crewColor && COLOR_RE.test(crewColor)) return crewColor.toLowerCase();
  return resolveJobCalendar(settings, sector).color;
}
