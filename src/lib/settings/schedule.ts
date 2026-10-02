/**
 * Configurações › Agenda — Jobs/Meetings colors + custom calendars.
 */
import { z } from "zod";
import { randomUUID } from "crypto";

export type ScheduleCalendarKind = "jobs" | "meetings" | "custom";

export type ScheduleCalendar = {
  id: string;
  name: string;
  color: string;
  kind: ScheduleCalendarKind;
};

export type ScheduleSettings = {
  calendars: ScheduleCalendar[];
};

const COLOR_RE = /^#[0-9A-Fa-f]{6}$/;

export const DEFAULT_SCHEDULE_CALENDARS: ScheduleCalendar[] = [
  { id: "jobs", name: "Jobs", color: "#e8792c", kind: "jobs" },
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

/** Normalize stored JSON into Jobs + Meetings + optional customs. */
export function parseScheduleSettings(raw: unknown): ScheduleSettings {
  const base = defaultScheduleSettings();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return base;
  const o = raw as Record<string, unknown>;
  const list = Array.isArray(o.calendars) ? o.calendars : [];

  let jobs = { ...base.calendars[0]! };
  let meetings = { ...base.calendars[1]! };
  const customs: ScheduleCalendar[] = [];

  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const kind =
      r.kind === "jobs" || r.kind === "meetings" || r.kind === "custom"
        ? r.kind
        : r.id === "jobs"
          ? "jobs"
          : r.id === "meetings"
            ? "meetings"
            : "custom";
    if (kind === "jobs") {
      jobs = {
        id: "jobs",
        kind: "jobs",
        name: normalizeName(r.name, "Jobs"),
        color: normalizeColor(r.color, jobs.color),
      };
      continue;
    }
    if (kind === "meetings") {
      meetings = {
        id: "meetings",
        kind: "meetings",
        name: normalizeName(r.name, "Meetings"),
        color: normalizeColor(r.color, meetings.color),
      };
      continue;
    }
    const id =
      typeof r.id === "string" && /^[0-9a-f-]{36}$/i.test(r.id) ? r.id : randomUUID();
    customs.push({
      id,
      kind: "custom",
      name: normalizeName(r.name, "Agenda"),
      color: normalizeColor(r.color, "#16a34a"),
    });
  }

  return { calendars: [jobs, meetings, ...customs] };
}

export function serializeScheduleSettings(settings: ScheduleSettings) {
  return {
    calendars: settings.calendars.map((c) => ({
      id: c.id,
      name: c.name,
      color: c.color,
      kind: c.kind,
    })),
  };
}

const calendarSchema = z.object({
  id: z.string().min(1).max(64).optional(),
  name: z.string().trim().min(1, "Nome obrigatório").max(80),
  color: z.string().regex(COLOR_RE, "Cor inválida"),
  kind: z.enum(["jobs", "meetings", "custom"]).optional(),
});

export const scheduleSettingsPutSchema = z.object({
  calendars: z.array(calendarSchema).min(2).max(24),
});

export type ScheduleSettingsPut = z.infer<typeof scheduleSettingsPutSchema>;

/** Merge PUT body into a full settings object (always keeps Jobs + Meetings). */
export function applyScheduleSettingsPut(body: ScheduleSettingsPut): ScheduleSettings {
  const current = defaultScheduleSettings();
  let jobs = { ...current.calendars[0]! };
  let meetings = { ...current.calendars[1]! };
  const customs: ScheduleCalendar[] = [];

  for (const row of body.calendars) {
    const kind =
      row.kind ||
      (row.id === "jobs" ? "jobs" : row.id === "meetings" ? "meetings" : "custom");
    if (kind === "jobs") {
      jobs = {
        id: "jobs",
        kind: "jobs",
        name: row.name.trim() || "Jobs",
        color: row.color.toLowerCase(),
      };
      continue;
    }
    if (kind === "meetings") {
      meetings = {
        id: "meetings",
        kind: "meetings",
        name: row.name.trim() || "Meetings",
        color: row.color.toLowerCase(),
      };
      continue;
    }
    const id =
      row.id && /^[0-9a-f-]{36}$/i.test(row.id) ? row.id : randomUUID();
    customs.push({
      id,
      kind: "custom",
      name: row.name.trim(),
      color: row.color.toLowerCase(),
    });
  }

  return { calendars: [jobs, meetings, ...customs] };
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

export function resolveJobColor(
  settings: ScheduleSettings,
  crewColor: string | null | undefined,
): string {
  if (crewColor && COLOR_RE.test(crewColor)) return crewColor.toLowerCase();
  return settings.calendars.find((c) => c.kind === "jobs")?.color || "#e8792c";
}
