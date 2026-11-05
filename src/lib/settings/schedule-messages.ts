/**
 * Configurações › Agenda — templates de SMS ao cliente (job / visita / meeting / delivery).
 * Stored under organization.scheduleSettings.clientMessages.
 */
import { z } from "zod";

export type ScheduleMessageKind = "job" | "visit" | "meeting" | "delivery";

export const SCHEDULE_MESSAGE_KINDS: readonly ScheduleMessageKind[] = [
  "job",
  "visit",
  "meeting",
  "delivery",
] as const;

export const SCHEDULE_MESSAGE_KIND_LABELS_PT: Record<ScheduleMessageKind, string> = {
  job: "Job",
  visit: "Visita",
  meeting: "Meeting",
  delivery: "Delivery",
};

export type ScheduleMessageTemplate = {
  id: string;
  label: string;
  body: string;
};

export type ScheduleClientMessages = {
  company_name: string | null;
  kinds: Record<ScheduleMessageKind, { templates: ScheduleMessageTemplate[] }>;
};

const DEFAULT_TEMPLATES: Record<ScheduleMessageKind, ScheduleMessageTemplate[]> = {
  job: [
    {
      id: "job_reminder",
      label: "Lembrete do job",
      body: "Hi [name], this is [company]. Reminder that we are scheduled for [date] at [address]. See you then!",
    },
    {
      id: "job_on_the_way",
      label: "Equipe a caminho",
      body: "Hi [name], our crew is on the way to [address] for today's work. Thank you!",
    },
  ],
  visit: [
    {
      id: "visit_confirm",
      label: "Confirmar visita",
      body: "Hi [name], confirming our visit on [date]. Looking forward to seeing you!",
    },
    {
      id: "visit_reminder",
      label: "Lembrete de visita",
      body: "Hi [name], quick reminder about our visit tomorrow ([date]). Reply if you need to reschedule.",
    },
  ],
  meeting: [
    {
      id: "meeting_confirm",
      label: "Confirmar meeting",
      body: "Hi [name], confirming our meeting on [date]. See you soon!",
    },
  ],
  delivery: [
    {
      id: "delivery_reminder",
      label: "Lembrete de delivery",
      body: "Hi [name], delivery is scheduled for [date]. We will update you when we are on the way.",
    },
  ],
};

export function defaultScheduleClientMessages(): ScheduleClientMessages {
  const kinds = {} as ScheduleClientMessages["kinds"];
  for (const kind of SCHEDULE_MESSAGE_KINDS) {
    kinds[kind] = {
      templates: DEFAULT_TEMPLATES[kind].map((t) => ({ ...t })),
    };
  }
  return { company_name: null, kinds };
}

function cloneTemplates(list: ScheduleMessageTemplate[]): ScheduleMessageTemplate[] {
  return list.map((t) => ({ id: t.id, label: t.label, body: t.body }));
}

export function parseScheduleClientMessages(raw: unknown): ScheduleClientMessages {
  const base = defaultScheduleClientMessages();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return base;
  const o = raw as Record<string, unknown>;
  if (typeof o.company_name === "string") {
    base.company_name = o.company_name.trim().slice(0, 120) || null;
  } else if (o.company_name === null) {
    base.company_name = null;
  }
  const kindsRaw = o.kinds && typeof o.kinds === "object" && !Array.isArray(o.kinds) ? (o.kinds as Record<string, unknown>) : {};
  for (const kind of SCHEDULE_MESSAGE_KINDS) {
    const row = kindsRaw[kind];
    if (!row || typeof row !== "object" || Array.isArray(row)) continue;
    const templatesRaw = Array.isArray((row as { templates?: unknown }).templates)
      ? ((row as { templates: unknown[] }).templates)
      : null;
    if (!templatesRaw || !templatesRaw.length) continue;
    const templates: ScheduleMessageTemplate[] = [];
    for (const item of templatesRaw) {
      if (!item || typeof item !== "object") continue;
      const t = item as Record<string, unknown>;
      const id = typeof t.id === "string" && t.id.trim() ? t.id.trim().slice(0, 64) : "";
      const label = typeof t.label === "string" ? t.label.trim().slice(0, 120) : "";
      const body = typeof t.body === "string" ? t.body.trim().slice(0, 2000) : "";
      if (!id || !label || !body) continue;
      templates.push({ id, label, body });
    }
    if (templates.length) base.kinds[kind] = { templates };
  }
  return base;
}

export function serializeScheduleClientMessages(settings: ScheduleClientMessages) {
  return {
    company_name: settings.company_name,
    kinds: SCHEDULE_MESSAGE_KINDS.map((kind) => ({
      slug: kind,
      label: SCHEDULE_MESSAGE_KIND_LABELS_PT[kind],
      templates: cloneTemplates(settings.kinds[kind]?.templates || []),
    })),
    tokens: ["[name]", "[company]", "[date]", "[address]", "[job]", "[client_id]"],
  };
}

const templateSchema = z.object({
  id: z.string().trim().min(1).max(64),
  label: z.string().trim().min(1).max(120),
  body: z.string().trim().min(1).max(2000),
});

export const scheduleClientMessagesPutSchema = z.object({
  company_name: z.string().trim().max(120).nullable().optional(),
  kinds: z
    .record(
      z.enum(["job", "visit", "meeting", "delivery"]),
      z.object({
        templates: z.array(templateSchema).min(1).max(12),
      }),
    )
    .optional(),
});

export type ScheduleClientMessagesPut = z.infer<typeof scheduleClientMessagesPutSchema>;

export function applyScheduleClientMessagesPut(
  current: ScheduleClientMessages,
  body: ScheduleClientMessagesPut,
): ScheduleClientMessages {
  const next = parseScheduleClientMessages(current);
  if (body.company_name !== undefined) {
    next.company_name = body.company_name ? String(body.company_name).trim().slice(0, 120) || null : null;
  }
  if (body.kinds) {
    for (const kind of SCHEDULE_MESSAGE_KINDS) {
      const incoming = body.kinds[kind];
      if (!incoming?.templates?.length) continue;
      next.kinds[kind] = {
        templates: incoming.templates.map((t) => ({
          id: t.id,
          label: t.label,
          body: t.body,
        })),
      };
    }
  }
  return next;
}
