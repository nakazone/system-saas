import type { NextFunction, Response } from "express";
import { prisma } from "../prisma.js";
import { tenantStorage, withTenantTransaction } from "../tenant/prisma-tenant.js";
import type { AuthedRequest } from "../../middleware/auth.js";

/**
 * What each company can use: extra modules and usage limits, decided by
 *   global state of the module → company exception (if any, not expired) → plan.
 * A module turned "off" globally is off for everyone, even with an exception;
 * "beta" means only companies with an exception that turns it on.
 *
 * Defaults keep today's behavior: every plan includes every module and has no limits,
 * until the Master changes the matrix in Master › Recursos.
 *
 * The company's own on/off settings (e.g. field_quote in featureFlags) still apply on top.
 */

export type FeatureKey = "field_quote" | "job_media" | "ai" | "payroll" | "finance" | "chat" | "reports" | "campo" | "public_portfolio";
export type FeatureState = "off" | "beta" | "on";
export type LimitKey = "users" | "photos_month" | "ai_month" | "voice_chars_month";

export type FeatureDef = {
  key: FeatureKey;
  name: string;
  description: string;
  /** API path prefixes and pages turned off with the module. */
  paths: RegExp[];
  /** Permission keys removed from users when the module is off (hides menu items and blocks APIs that check them). */
  permissions: (p: string) => boolean;
  /** CRM pages whose links are hidden everywhere when the module is off. */
  pages?: string[];
};

export const CORE_MODULES = ["Leads", "Clientes", "Quotes", "Invoices", "Calendar", "Jobs"];

export const FEATURES: FeatureDef[] = [
  {
    key: "field_quote",
    pages: ["field-quote.html"],
    name: "Field Quote",
    description: "Medir e orçar na casa do cliente pelo celular",
    paths: [/^\/api\/field-quotes(\/|$)/, /^\/field-quote\.html$/],
    permissions: () => false,
  },
  {
    key: "job_media",
    pages: ["job-media-board.html"],
    name: "ObraCam",
    description: "Fotos dos jobs com GPS, antes/durante/depois",
    paths: [/^\/api\/job-media(\/|$)/, /^\/job-media-board\.html$/],
    permissions: () => false,
  },
  {
    key: "ai",
    name: "IA",
    description: "Leitura de recibos, relatório e checklist por foto, áudio para texto",
    paths: [],
    permissions: () => false,
  },
  {
    key: "payroll",
    pages: ["folha.html", "payroll-module.html"],
    name: "Folha de pagamento",
    description: "Diárias, horas, conferência e pagamento da equipe",
    paths: [/^\/api\/folha(\/|$)/, /^\/api\/payroll(\/|$)/, /^\/api\/finance\/payroll(\/|$)/, /^\/api\/campo\/folha(\/|$)/, /^\/(folha|payroll-module)\.html$/],
    permissions: (p) => p.startsWith("payroll."),
  },
  {
    key: "finance",
    pages: ["finance.html"],
    name: "Fluxo de caixa",
    description: "Entradas, custos, recibos e resultado do mês",
    paths: [/^\/api\/finance(\/|$)(?!payroll)/, /^\/finance\.html$/],
    permissions: (p) => p.startsWith("finance.") || p === "costs.view",
  },
  {
    key: "chat",
    pages: ["chat.html"],
    name: "ObraChat",
    description: "Conversas da equipe por obra, grupos e diretas",
    paths: [/^\/api\/chat(\/|$)/, /^\/chat\.html$/],
    permissions: (p) => p.startsWith("chat."),
  },
  {
    key: "reports",
    pages: ["relatorios.html"],
    name: "Relatórios",
    description: "Resultado, vendas, operação, dinheiro e equipe",
    paths: [/^\/api\/reports(\/|-|$)/, /^\/relatorios\.html$/],
    permissions: (p) => p === "reports.view",
  },
  {
    key: "campo",
    name: "App do instalador",
    description: "Meu dia, ponto, fotos e checklist para quem está na obra",
    paths: [/^\/api\/campo(\/|$)/, /^\/campo\//],
    permissions: () => false,
  },
  {
    key: "public_portfolio",
    name: "Portfólio público",
    description: "Página pública com as fotos escolhidas dos jobs",
    paths: [],
    permissions: () => false,
  },
];

export const FEATURE_KEYS = FEATURES.map((f) => f.key);

export const LIMITS: { key: LimitKey; name: string; unit: string }[] = [
  { key: "users", name: "Usuários", unit: "usuários" },
  { key: "photos_month", name: "Fotos por mês", unit: "fotos" },
  { key: "ai_month", name: "Usos de IA por mês", unit: "usos" },
  { key: "voice_chars_month", name: "Voz do Mate por mês", unit: "caracteres" },
];

export function featureDef(key: string): FeatureDef | undefined {
  return FEATURES.find((f) => f.key === key);
}

/* ───────────────────────── resolution ───────────────────────── */

export type FeatureSource = "plan" | "override" | "global_off" | "beta";
export type Entitlements = {
  plan: string;
  features: Record<FeatureKey, { on: boolean; source: FeatureSource; overrideEndsAt?: Date | null }>;
  limits: Record<LimitKey, number | null>;
};

type PlanShape = { key: string; features: unknown; limits: unknown };

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/** Pure decision (also used by the Master to preview changes). */
export function resolveEntitlements(input: {
  plan: PlanShape | null;
  planKey: string;
  globals: Partial<Record<string, FeatureState>>;
  overrides: { featureKey: string; enabled: boolean; endsAt: Date | null }[];
  now?: Date;
}): Entitlements {
  const now = input.now ?? new Date();
  const planFeatures = asRecord(input.plan?.features);
  const planLimits = asRecord(input.plan?.limits);
  const features = {} as Entitlements["features"];
  for (const f of FEATURES) {
    const global = input.globals[f.key] ?? "on";
    const ov = input.overrides.find((o) => o.featureKey === f.key && (!o.endsAt || o.endsAt.getTime() > now.getTime()));
    if (global === "off") features[f.key] = { on: false, source: "global_off" };
    else if (ov) features[f.key] = { on: ov.enabled, source: "override", overrideEndsAt: ov.endsAt };
    else if (global === "beta") features[f.key] = { on: false, source: "beta" };
    else features[f.key] = { on: planFeatures[f.key] !== false, source: "plan" };
  }
  const limits = {} as Entitlements["limits"];
  for (const l of LIMITS) {
    const v = planLimits[l.key];
    limits[l.key] = typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : null;
  }
  return { plan: input.planKey, features, limits };
}

const cache = new Map<string, { at: number; value: Entitlements }>();
let globalsCache: { at: number; value: Record<string, FeatureState> } | null = null;
const TTL_MS = 30_000;

/** Call after any change in Master › Recursos or a company's plan/exceptions. */
export function invalidateEntitlements(organizationId?: string): void {
  if (organizationId) cache.delete(organizationId);
  else cache.clear();
  if (!organizationId) globalsCache = null;
}

export async function featureGlobals(): Promise<Record<string, FeatureState>> {
  if (globalsCache && Date.now() - globalsCache.at < TTL_MS) return globalsCache.value;
  const rows = await prisma.platformFeature.findMany().catch(() => []);
  const value: Record<string, FeatureState> = {};
  for (const r of rows) value[r.key] = r.state === "off" || r.state === "beta" ? r.state : "on";
  globalsCache = { at: Date.now(), value };
  return value;
}

export async function getEntitlements(organizationId: string): Promise<Entitlements> {
  const hit = cache.get(organizationId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { plan: true } });
  const planKey = String(org?.plan || "starter").toLowerCase();
  const [plan, globals, overrides] = await Promise.all([
    prisma.plan.findUnique({ where: { key: planKey }, select: { key: true, features: true, limits: true } }).catch(() => null),
    featureGlobals(),
    prisma.orgFeatureOverride.findMany({ where: { organizationId }, select: { featureKey: true, enabled: true, endsAt: true } }).catch(() => []),
  ]);
  const value = resolveEntitlements({ plan, planKey, globals, overrides });
  cache.set(organizationId, { at: Date.now(), value });
  return value;
}

export async function hasFeature(organizationId: string, key: FeatureKey): Promise<boolean> {
  return (await getEntitlements(organizationId)).features[key]?.on !== false;
}

/** Removes permission keys of modules the company doesn't have (menu items disappear, permission checks fail). */
export async function applyFeaturePermissions(organizationId: string, permissions: string[]): Promise<string[]> {
  const ent = await getEntitlements(organizationId);
  const off = FEATURES.filter((f) => !ent.features[f.key].on);
  if (!off.length) return permissions;
  return permissions.filter((p) => !off.some((f) => f.permissions(p)));
}

/** Pages of modules this company doesn't have (the CRM hides links to them). */
export async function hiddenPages(organizationId: string): Promise<string[]> {
  const ent = await getEntitlements(organizationId);
  return FEATURES.filter((f) => !ent.features[f.key].on).flatMap((f) => f.pages ?? []);
}

/* ───────────────────────── usage and limits ───────────────────────── */

/** First day of the current month in America/Denver, and its YYYY-MM label. */
export function monthStart(now = new Date()): { start: Date; period: string } {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Denver", year: "numeric", month: "2-digit" }).formatToParts(now);
  const y = Number(parts.find((p) => p.type === "year")!.value);
  const m = Number(parts.find((p) => p.type === "month")!.value);
  // Midnight in Denver is 06:00 UTC (daylight time) or 07:00 UTC (standard time).
  const hourInDenver = (d: Date) => Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/Denver", hour: "numeric", hourCycle: "h23" }).format(d));
  const mdt = new Date(Date.UTC(y, m - 1, 1, 6, 0, 0));
  const start = hourInDenver(mdt) === 0 ? mdt : new Date(Date.UTC(y, m - 1, 1, 7, 0, 0));
  return { start, period: `${y}-${String(m).padStart(2, "0")}` };
}

export type Usage = Record<LimitKey, number>;

export async function getUsage(organizationId: string, now = new Date()): Promise<Usage> {
  const { start, period } = monthStart(now);
  // Company tables are counted inside the company's transaction (works with or without row-level security bypass).
  const [[users, invites, photos], ai] = await Promise.all([
    withTenantTransaction(organizationId, (tx) =>
      Promise.all([
        tx.user.count({ where: { organizationId, status: { in: ["active", "invited"] } } }),
        tx.invitation.count({ where: { organizationId, status: "pending", expiresAt: { gt: now } } }),
        tx.jobMedia.count({ where: { organizationId, createdAt: { gte: start } } }),
      ]),
    ),
    prisma.usageCounter.findMany({ where: { organizationId, period, metric: { in: ["ai_month", "voice_chars_month"] } } }),
  ]);
  const counted = (metric: string) => ai.find((r) => r.metric === metric)?.count ?? 0;
  return { users: users + invites, photos_month: photos, ai_month: counted("ai_month"), voice_chars_month: counted("voice_chars_month") };
}

export type LimitCheck = { ok: true; used: number; limit: number | null } | { ok: false; used: number; limit: number; message: string };

const LIMIT_MESSAGE: Record<LimitKey, (limit: number) => string> = {
  users: (n) => `Seu plano inclui até ${n} usuários. Para adicionar mais, mude de plano em Configurações › Plano e cobrança.`,
  photos_month: (n) => `Seu plano inclui ${n} fotos por mês e esse limite foi atingido. As fotos voltam no dia 1 — ou mude de plano em Configurações › Plano e cobrança.`,
  ai_month: (n) => `Seu plano inclui ${n} usos de IA por mês e esse limite foi atingido. Volta no dia 1 — ou mude de plano.`,
  voice_chars_month: (n) => `Seu plano inclui ${n.toLocaleString("pt-BR")} caracteres de voz do Mate por mês e esse limite foi atingido. O Mate segue falando com a voz do aparelho até o dia 1.`,
};

/** Checks whether `adding` more units fit in the plan limit. Only that resource is blocked, never the system. */
export async function checkLimit(organizationId: string, key: LimitKey, adding = 1): Promise<LimitCheck> {
  const ent = await getEntitlements(organizationId);
  const limit = ent.limits[key];
  if (limit == null) return { ok: true, used: 0, limit: null };
  const used = (await getUsage(organizationId))[key];
  if (used + adding > limit) return { ok: false, used, limit, message: LIMIT_MESSAGE[key](limit) };
  return { ok: true, used, limit };
}

/**
 * Called by the AI client before each call: the module must be on and the monthly limit not reached.
 * Counts the call. Returns an error message to show, or null when allowed.
 * Outside a company request (scripts, jobs) it always allows.
 */
export async function takeAiUse(): Promise<string | null> {
  const organizationId = tenantStorage.getStore()?.organizationId;
  if (!organizationId) return null;
  try {
    if (!(await hasFeature(organizationId, "ai"))) return "A IA não está incluída no plano da empresa.";
    const check = await checkLimit(organizationId, "ai_month", 1);
    if (!check.ok) return check.message;
    const { period } = monthStart();
    await prisma.usageCounter.upsert({
      where: { organizationId_metric_period: { organizationId, metric: "ai_month", period } },
      create: { organizationId, metric: "ai_month", period, count: 1 },
      update: { count: { increment: 1 } },
    });
    return null;
  } catch (error) {
    console.error("[features] ai usage check failed", error);
    return null;
  }
}

/**
 * Adds spoken characters (ElevenLabs) to the month counter. Cached phrases are not counted:
 * only audio that was actually generated costs money.
 */
export async function addVoiceChars(organizationId: string, chars: number): Promise<void> {
  if (!organizationId || chars <= 0) return;
  try {
    const { period } = monthStart();
    await prisma.usageCounter.upsert({
      where: { organizationId_metric_period: { organizationId, metric: "voice_chars_month", period } },
      create: { organizationId, metric: "voice_chars_month", period, count: Math.round(chars) },
      update: { count: { increment: Math.round(chars) } },
    });
  } catch (error) {
    console.error("[features] voice usage count failed", error);
  }
}

/* ───────────────────────── request guard ───────────────────────── */

function wantsJson(req: AuthedRequest): boolean {
  return req.path.startsWith("/api/") || String(req.headers.accept || "").includes("application/json") || req.xhr;
}

/** Mount after loadSessionUser: pages and APIs of modules the company doesn't have answer 403 FEATURE_OFF. */
export async function featureGuard(req: AuthedRequest, res: Response, next: NextFunction): Promise<void> {
  if (!req.organizationId) return next();
  const candidates = FEATURES.filter((f) => f.paths.some((r) => r.test(req.path)));
  if (!candidates.length) return next();
  try {
    const ent = await getEntitlements(req.organizationId);
    const off = candidates.find((f) => !ent.features[f.key].on);
    if (!off) return next();
    const message = `${off.name} não está incluído no plano da empresa.`;
    if (wantsJson(req)) return void res.status(403).json({ success: false, error: "FEATURE_OFF", feature: off.key, message });
    res.status(403).type("html").send(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${off.name}</title>
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#f7f8fa;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#221e1a;padding:16px}
.c{max-width:440px;background:#fff;border-radius:18px;padding:24px;box-shadow:0 20px 60px rgba(0,0,0,.08)}h1{font-size:20px;margin:0 0 8px}p{margin:0 0 16px;color:#667085;line-height:1.5}
a{display:inline-flex;height:40px;align-items:center;padding:0 16px;border-radius:10px;text-decoration:none;font-weight:700;margin-right:8px}.p{background:#221e1a;color:#fff}.s{background:#f1f3f5;color:#221e1a}</style></head>
<body><div class="c"><h1>${off.name} não está no seu plano</h1><p>${off.description}. Fale com o administrador da empresa para mudar de plano.</p><a class="p" href="/configuracoes.html#plano">Ver planos</a><a class="s" href="/">Voltar ao início</a></div></body></html>`);
  } catch (error) {
    next(error);
  }
}
