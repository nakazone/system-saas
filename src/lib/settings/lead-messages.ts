/**
 * Configurações › Mensagens padrão por fase do pipeline.
 * Used by lead email/SMS pickers (mailto / sms:) in the CRM.
 */
import { z } from "zod";
import { CANONICAL_STAGE_ORDER, type CanonicalStage } from "../dashboard/stages.js";

export type LeadMessageOnSendAction = {
  set_priority?: "low" | "medium" | "high";
};

export type LeadMessageTemplate = {
  id: string;
  label: string;
  body: string;
  on_send_action?: LeadMessageOnSendAction | null;
};

export type LeadStageMessages = {
  email_subject: string | null;
  templates: LeadMessageTemplate[];
};

export type LeadMessageSettings = {
  company_name: string | null;
  default_email_subject: string | null;
  /** Discount offer line for SMS/email via [coupon] token. */
  coupon_enabled: boolean;
  coupon_code: string | null;
  coupon_label: string | null;
  /** Supports [code] and [label] placeholders. */
  coupon_sms_line: string | null;
  stages: Record<CanonicalStage, LeadStageMessages>;
};

export const LEAD_STAGE_LABELS_PT: Record<CanonicalStage, string> = {
  new_lead: "Novo lead",
  meeting_scheduled: "Visita agendada",
  quote_sent: "Orçamento enviado",
  follow_up_1: "Follow-up",
  stand_by: "Em espera",
  won: "Ganho",
  lost: "Perdido",
};

export const DEFAULT_COUPON_SMS_LINE = "Special offer: use code [code] for [label].";

const FOLLOW_UP_TEMPLATES: LeadMessageTemplate[] = [
  {
    id: "follow_up_quote_reminder",
    label: "Follow-up — lembrete do orçamento",
    body:
      "Hello [name], I hope all is well. Just following up on the quote I sent a few days ago. If everything looks good, I'd be happy to help get your project scheduled and reserve a spot for you.\n\n[coupon]",
  },
  {
    id: "follow_up_last_check",
    label: "Follow-up — último contato",
    body:
      "Hello [name], just wanted to check in one last time regarding your flooring project. If timing is better later, no problem at all — I'd still be happy to help whenever you're ready.\n\n[coupon]",
    on_send_action: { set_priority: "low" },
  },
];

const NEW_LEAD_TEMPLATES: LeadMessageTemplate[] = [
  {
    id: "new_lead_intro",
    label: "Novo lead — introdução",
    body:
      "Hi [name], thanks for reaching out to [company]. I'd be happy to help. Can you tell me a little about the project?",
  },
  ...FOLLOW_UP_TEMPLATES,
];

const QUOTE_SENT_EXTRA: LeadMessageTemplate[] = [
  {
    id: "quote_sent_followup",
    label: "Orçamento enviado — agradecimento",
    body:
      "Hello [name], thank you for your time today. I've sent email and attached the quote PDF with the options we discussed. Thank you!",
  },
];

function templatesForStage(slug: CanonicalStage): LeadMessageTemplate[] {
  if (slug === "quote_sent") return [...QUOTE_SENT_EXTRA, ...NEW_LEAD_TEMPLATES.map((t) => ({ ...t, on_send_action: t.on_send_action ? { ...t.on_send_action } : null }))];
  return NEW_LEAD_TEMPLATES.map((t) => ({
    ...t,
    on_send_action: t.on_send_action ? { ...t.on_send_action } : null,
  }));
}

export function defaultLeadMessageSettings(): LeadMessageSettings {
  const stages = {} as Record<CanonicalStage, LeadStageMessages>;
  for (const slug of CANONICAL_STAGE_ORDER) {
    stages[slug] = {
      email_subject: null,
      templates: templatesForStage(slug),
    };
  }
  return {
    company_name: null,
    default_email_subject: "[company] — [name]",
    coupon_enabled: false,
    coupon_code: "SAVE10",
    coupon_label: "10% off your flooring project",
    coupon_sms_line: DEFAULT_COUPON_SMS_LINE,
    stages,
  };
}

function asStr(v: unknown, max = 500): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!s) return null;
  return s.slice(0, max);
}

function parseOnSendAction(raw: unknown): LeadMessageOnSendAction | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const p = String(o.set_priority || "").toLowerCase();
  if (p === "low" || p === "medium" || p === "high") return { set_priority: p };
  return null;
}

function parseTemplate(raw: unknown, idx: number, fallbackAction?: LeadMessageOnSendAction | null): LeadMessageTemplate | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const body = typeof o.body === "string" ? o.body : typeof o.template === "string" ? o.template : "";
  const label = asStr(o.label, 120) || `Mensagem ${idx + 1}`;
  const id = asStr(o.id, 64) || `tpl_${idx + 1}`;
  if (!String(body).trim()) return null;
  const action =
    o.on_send_action !== undefined ? parseOnSendAction(o.on_send_action) : fallbackAction ?? null;
  // Built-in last-check always marks ice unless explicitly cleared with null object without set_priority.
  const resolvedAction =
    id === "follow_up_last_check" && o.on_send_action === undefined
      ? { set_priority: "low" as const }
      : action;
  return {
    id,
    label,
    body: String(body).slice(0, 4000),
    on_send_action: resolvedAction,
  };
}

function parseStage(raw: unknown, fallback: LeadStageMessages): LeadStageMessages {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return fallback;
  const o = raw as Record<string, unknown>;
  const list = Array.isArray(o.templates) ? o.templates : [];
  const templates = list
    .map((t, i) => {
      const fb = fallback.templates.find(
        (x) => x.id === (t && typeof t === "object" && !Array.isArray(t) ? (t as { id?: string }).id : ""),
      );
      return parseTemplate(t, i, fb?.on_send_action ?? null);
    })
    .filter((t): t is LeadMessageTemplate => !!t)
    .slice(0, 12);
  return {
    email_subject: asStr(o.email_subject, 200),
    templates: templates.length ? templates : fallback.templates.map((t) => ({ ...t })),
  };
}

/** Resolve [coupon] replacement text (empty when coupon disabled). */
export function resolveCouponLine(settings: LeadMessageSettings): string {
  if (!settings.coupon_enabled) return "";
  const code = settings.coupon_code || "";
  const label = settings.coupon_label || "";
  const line = (settings.coupon_sms_line || DEFAULT_COUPON_SMS_LINE).trim();
  if (!line) return "";
  return line
    .replace(/\[code\]/gi, code)
    .replace(/\[label\]/gi, label)
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Merge persisted JSON with built-in defaults (missing stages keep defaults). */
export function parseLeadMessageSettings(raw: unknown): LeadMessageSettings {
  const defaults = defaultLeadMessageSettings();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return defaults;
  const o = raw as Record<string, unknown>;
  const stagesRaw =
    o.stages && typeof o.stages === "object" && !Array.isArray(o.stages)
      ? (o.stages as Record<string, unknown>)
      : {};
  const stages = {} as Record<CanonicalStage, LeadStageMessages>;
  for (const slug of CANONICAL_STAGE_ORDER) {
    stages[slug] = parseStage(stagesRaw[slug], defaults.stages[slug]!);
  }
  return {
    company_name: asStr(o.company_name, 120),
    default_email_subject: asStr(o.default_email_subject, 200) ?? defaults.default_email_subject,
    coupon_enabled: typeof o.coupon_enabled === "boolean" ? o.coupon_enabled : defaults.coupon_enabled,
    coupon_code: asStr(o.coupon_code, 40) ?? defaults.coupon_code,
    coupon_label: asStr(o.coupon_label, 120) ?? defaults.coupon_label,
    coupon_sms_line: asStr(o.coupon_sms_line, 500) ?? defaults.coupon_sms_line,
    stages,
  };
}

const onSendActionSchema = z
  .object({
    set_priority: z.enum(["low", "medium", "high"]).optional(),
  })
  .nullable()
  .optional();

const templateSchema = z.object({
  id: z.string().trim().min(1).max(64),
  label: z.string().trim().min(1).max(120),
  body: z.string().trim().min(1).max(4000),
  on_send_action: onSendActionSchema,
});

const stageSchema = z.object({
  email_subject: z.string().trim().max(200).nullable().optional(),
  templates: z.array(templateSchema).min(1).max(12),
});

const stagesObjectSchema = z.object({
  new_lead: stageSchema,
  meeting_scheduled: stageSchema,
  quote_sent: stageSchema,
  follow_up_1: stageSchema,
  stand_by: stageSchema,
  won: stageSchema,
  lost: stageSchema,
});

export const leadMessageSettingsPutSchema = z.object({
  company_name: z.string().trim().max(120).nullable().optional(),
  default_email_subject: z.string().trim().max(200).nullable().optional(),
  coupon_enabled: z.boolean().optional(),
  coupon_code: z.string().trim().max(40).nullable().optional(),
  coupon_label: z.string().trim().max(120).nullable().optional(),
  coupon_sms_line: z.string().trim().max(500).nullable().optional(),
  stages: stagesObjectSchema,
});

export function serializeLeadMessageSettings(settings: LeadMessageSettings) {
  return {
    company_name: settings.company_name,
    default_email_subject: settings.default_email_subject,
    coupon_enabled: settings.coupon_enabled,
    coupon_code: settings.coupon_code,
    coupon_label: settings.coupon_label,
    coupon_sms_line: settings.coupon_sms_line,
    stages: CANONICAL_STAGE_ORDER.map((slug) => ({
      slug,
      label: LEAD_STAGE_LABELS_PT[slug],
      email_subject: settings.stages[slug]?.email_subject ?? null,
      templates: (settings.stages[slug]?.templates || []).map((t) => ({
        id: t.id,
        label: t.label,
        body: t.body,
        on_send_action: t.on_send_action || null,
      })),
    })),
  };
}
