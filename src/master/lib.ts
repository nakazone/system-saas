/**
 * Master area (platform owner) — shared constants and pure helpers.
 * UI copy is pt-BR; identifiers stay in English.
 */

import crypto from "node:crypto";

export const PLATFORM_ROLES = ["MASTER", "ADMIN", "FINANCE", "SUPPORT", "READONLY"] as const;
export type PlatformRole = (typeof PLATFORM_ROLES)[number];

export const ROLE_LABEL: Record<PlatformRole, string> = {
  MASTER: "Master",
  ADMIN: "Admin",
  FINANCE: "Financeiro",
  SUPPORT: "Suporte",
  READONLY: "Leitura",
};

export const ROLE_HINT: Record<Exclude<PlatformRole, "MASTER">, string> = {
  ADMIN: "Quase tudo, sem mexer na equipe",
  FINANCE: "Pagamentos, planos e vencimentos",
  SUPPORT: "Ajuda as empresas e os usuários delas",
  READONLY: "Só vê. Bom para contador ou sócio",
};

export type Capability =
  | "view"
  | "billing_full"
  | "billing_manage"
  | "refund"
  | "users_manage"
  | "tenants_suspend"
  | "export"
  | "team_manage";

export const CAPABILITIES: { key: Capability; label: string }[] = [
  { key: "view", label: "Ver empresas, usuários e contatos" },
  { key: "billing_full", label: "Ver pagamentos e valores" },
  { key: "billing_manage", label: "Criar empresa, editar assinatura, pagamento, plano e prazo" },
  { key: "refund", label: "Estornar pagamento" },
  { key: "users_manage", label: "Cadastrar usuários, bloquear, sessões e senha temporária" },
  { key: "tenants_suspend", label: "Suspender, reativar e cancelar empresas" },
  { key: "export", label: "Exportar dados (CSV)" },
  { key: "team_manage", label: "Equipe da plataforma" },
];

const MATRIX: Record<PlatformRole, Capability[]> = {
  MASTER: ["view", "billing_full", "billing_manage", "refund", "users_manage", "tenants_suspend", "export", "team_manage"],
  ADMIN: ["view", "billing_full", "billing_manage", "users_manage", "tenants_suspend"],
  FINANCE: ["view", "billing_full", "billing_manage"],
  SUPPORT: ["view", "users_manage"],
  READONLY: ["view"],
};

export function normalizeRole(role: string | null | undefined): PlatformRole {
  const r = String(role || "").toUpperCase();
  return (PLATFORM_ROLES as readonly string[]).includes(r) ? (r as PlatformRole) : "READONLY";
}

export function can(role: string | null | undefined, cap: Capability): boolean {
  return MATRIX[normalizeRole(role)].includes(cap);
}

// ---------------------------------------------------------------------------
// Plans and platform billing
// ---------------------------------------------------------------------------

/** List prices (cents per month). Annual = 10 months. */
export const PLAN_MONTHLY_CENTS: Record<string, number> = {
  starter: 12900,
  professional: 29900,
  business: 59900,
};

export const PLAN_LABEL: Record<string, string> = {
  starter: "Starter",
  professional: "Professional",
  business: "Business",
};

export function planLabel(plan: string | null | undefined): string {
  const p = String(plan || "").toLowerCase();
  return PLAN_LABEL[p] ?? (p ? p[0].toUpperCase() + p.slice(1) : "—");
}

/** One-time password shown once in the Master UI (user must change on first login). */
export function makeTempPassword(len = 12): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  return Array.from(crypto.randomBytes(len), (b) => alphabet[b % alphabet.length]).join("");
}

/** Lowercase slug from a company name (letters, numbers, hyphens). */
export function slugifyName(name: string): string {
  return String(name || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

export function cyclePriceCents(org: { plan: string; billingCycle: string; planPriceCents: number | null }): number {
  if (org.planPriceCents != null) return org.planPriceCents;
  const monthly = PLAN_MONTHLY_CENTS[String(org.plan || "").toLowerCase()] ?? 0;
  return org.billingCycle === "annual" ? monthly * 10 : monthly;
}

export function monthlyCents(org: { plan: string; billingCycle: string; planPriceCents: number | null }): number {
  const c = cyclePriceCents(org);
  return org.billingCycle === "annual" ? Math.round(c / 12) : c;
}

export function money(cents: number): string {
  const v = cents / 100;
  return "$" + v.toLocaleString("en-US", { minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 });
}

export const PLATFORM_TZ = "America/Denver";

/** Calendar date (YYYY-MM-DD) of an instant in the platform time zone. */
export function ymdInTz(d: Date, tz = PLATFORM_TZ): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

/** Whole calendar days from today (platform TZ) to `d`. Negative = past. */
export function daysUntil(d: Date | null | undefined, now = new Date()): number | null {
  if (!d) return null;
  const a = Date.parse(ymdInTz(now) + "T00:00:00Z");
  const b = Date.parse(ymdInTz(d) + "T00:00:00Z");
  return Math.round((b - a) / 86_400_000);
}

/** Noon UTC of the calendar day `days` from today (platform TZ) — stable date-only storage. */
export function dayFromToday(days: number, now = new Date()): Date {
  const base = Date.parse(ymdInTz(now) + "T12:00:00Z");
  return new Date(base + days * 86_400_000);
}

const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const WEEKDAYS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

export function shortDate(d: Date | null | undefined, now = new Date()): string {
  if (!d) return "—";
  const [y, m, day] = ymdInTz(d).split("-").map(Number);
  const yNow = Number(ymdInTz(now).slice(0, 4));
  return `${day} ${MONTHS[m - 1]}${y !== yNow ? " " + String(y).slice(2) : ""}`;
}

export function weekdayShort(d: Date): string {
  const [y, m, day] = ymdInTz(d).split("-").map(Number);
  return WEEKDAYS[new Date(Date.UTC(y, m - 1, day)).getUTCDay()];
}

export function dateTimeLabel(d: Date | null | undefined, now = new Date()): string {
  if (!d) return "—";
  const today = ymdInTz(now);
  const ymd = ymdInTz(d);
  const time = new Intl.DateTimeFormat("en-US", { timeZone: PLATFORM_TZ, hour: "numeric", minute: "2-digit" })
    .format(d)
    .replace(" ", "")
    .toLowerCase();
  if (ymd === today) return `hoje ${time}`;
  if (daysUntil(d, now) === -1) return `ontem ${time}`;
  return `${shortDate(d, now)} ${time}`;
}

export type Pill = { label: string; tone: "ink" | "soft" | "warn" | "danger" | "info" | "muted" | "dark" };

export function orgStatusPill(status: string, days: number | null): Pill {
  switch (status) {
    case "active":
      return { label: "Ativa", tone: "ink" };
    case "trial":
      return days != null && days < 0 ? { label: "Trial expirado", tone: "danger" } : { label: "Trial", tone: "info" };
    case "past_due":
      return { label: "Pagamento atrasado", tone: "danger" };
    case "suspended":
      return { label: "Suspensa", tone: "dark" };
    case "canceled":
      return { label: "Cancelada", tone: "muted" };
    default:
      return { label: status, tone: "muted" };
  }
}

export function dueChip(days: number | null): Pill {
  if (days == null) return { label: "Sem data", tone: "muted" };
  if (days < 0) return { label: `Venceu há ${-days}d`, tone: "danger" };
  if (days === 0) return { label: "Vence hoje", tone: "danger" };
  if (days <= 7) return { label: `Em ${days} dia${days > 1 ? "s" : ""}`, tone: "warn" };
  if (days <= 30) return { label: `Em ${days} dias`, tone: "info" };
  return { label: `Em ${days} dias`, tone: "soft" };
}

/** The date that matters for an organization: trial end or paid period end. */
export function dueDateOf(org: { status: string; trialEndsAt: Date | null; currentPeriodEnd: Date | null }): Date | null {
  if (org.status === "canceled") return null;
  if (org.status === "trial") return org.trialEndsAt;
  return org.currentPeriodEnd;
}

export function initials(name: string): string {
  return String(name || "?")
    .replace(/[^\p{L} ]/gu, "")
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase() || "?";
}

const AVATAR = ["#f6d9c6", "#e4dcf2", "#f4e4b5", "#d5e5ee", "#f1d5dc", "#e7e0d3", "#eadfd2"];
export function avatarBg(seed: string): string {
  let h = 0;
  for (const ch of String(seed)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR[h % AVATAR.length];
}

export function addCycle(from: Date, cycle: string): Date {
  const d = new Date(from);
  if (cycle === "annual") d.setUTCFullYear(d.getUTCFullYear() + 1);
  else d.setUTCMonth(d.getUTCMonth() + 1);
  return d;
}

export function csvEscape(v: unknown): string {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
