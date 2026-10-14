import { Router, type NextFunction, type Response } from "express";
import { z } from "zod";
import { env } from "../../config/env.js";
import { legalPromptEnabled, pendingLegal, recordLegalAcceptance } from "../legal/acceptance.js";
import { legalDocuments } from "../legal/documents.js";
import { requestIp } from "../security/db-rate-limit.js";
import { supportBanner } from "../support/session.js";
import { FEATURES, LIMITS, getEntitlements, getUsage, hiddenPages } from "../features/index.js";
import { prisma } from "../prisma.js";
import type { AuthedRequest } from "../../middleware/auth.js";
import { daysUntil, money, planLabel, cyclePriceCents, shortDate } from "../../master/lib.js";
import { plans } from "../../master/plans.js";
import { BillingError, createCheckoutUrl, createPortalUrl, stripeEnabled } from "./stripe.js";

/**
 * What a company can do right now, from its billing state.
 *  - full: everything
 *  - read_only: sees everything, cannot create or change (trial ended / unpaid)
 * Suspended and canceled companies never get here (resolve-tenant blocks them).
 */
export type AccountMode = "full" | "read_only";

export type AccountBanner = {
  tone: "info" | "warn" | "danger";
  text: string;
  cta: string | null;
};

type OrgBilling = {
  id: string;
  status: string;
  plan: string;
  billingCycle: string;
  planPriceCents: number | null;
  trialEndsAt: Date | null;
  currentPeriodEnd: Date | null;
  stripeSubscriptionId: string | null;
  cancelAtPeriodEnd: boolean;
  readOnlySince: Date | null;
};

export function accountMode(status: string): AccountMode {
  return status === "read_only" ? "read_only" : "full";
}

export function accountBanner(org: OrgBilling, now = new Date()): AccountBanner | null {
  if (org.status === "read_only") {
    return {
      tone: "danger",
      // Never paid (no paid period) → the trial ended; otherwise a payment is late.
      text: !org.currentPeriodEnd
        ? "Seu teste grátis acabou. A conta está em modo só leitura até a assinatura — seus dados estão salvos."
        : "Conta em modo só leitura: o pagamento está em atraso. Seus dados estão salvos.",
      cta: "Assinar agora",
    };
  }
  if (org.status === "past_due") {
    return { tone: "warn", text: "Não conseguimos cobrar a sua assinatura. Atualize o cartão para não perder o acesso.", cta: "Atualizar pagamento" };
  }
  if (org.status === "trial" && org.trialEndsAt) {
    const d = daysUntil(org.trialEndsAt, now);
    if (d != null && d <= 7) {
      if (org.stripeSubscriptionId && !org.cancelAtPeriodEnd) return null; // card already on file
      const when = d <= 0 ? "hoje" : d === 1 ? "amanhã" : `em ${d} dias`;
      return { tone: d <= 2 ? "warn" : "info", text: `Seu teste grátis termina ${when} (${shortDate(org.trialEndsAt, now)}).`, cta: "Assinar agora" };
    }
  }
  if (org.status === "active" && org.cancelAtPeriodEnd && org.currentPeriodEnd) {
    return { tone: "info", text: `Sua assinatura termina em ${shortDate(org.currentPeriodEnd, now)}.`, cta: "Manter assinatura" };
  }
  return null;
}

/** Requests allowed even in read-only mode (sign in/out, paying, support, password). */
const READ_ONLY_ALLOWED = [
  /^\/api\/auth\//,
  /^\/api\/me$/,
  /^\/api\/billing\//,
  /^\/api\/support\//,
  /^\/api\/account\//,
  /^\/api\/push\//,
  /^\/logout$/,
  /^\/login$/,
  /^\/change-password/,
  /^\/meu-perfil/,
  /^\/api\/users\/me\/password$/,
];

function wantsJson(req: AuthedRequest): boolean {
  return req.path.startsWith("/api/") || String(req.headers.accept || "").includes("application/json") || req.xhr;
}

/** Blocks writes for companies in read-only mode. Mount after the session user is loaded. */
export function enforceAccountAccess(req: AuthedRequest, res: Response, next: NextFunction): void {
  const org = (req as AuthedRequest & { organization?: { status?: string } }).organization;
  if (!org || accountMode(String(org.status)) !== "read_only") return next();
  const m = req.method.toUpperCase();
  if (m === "GET" || m === "HEAD" || m === "OPTIONS") return next();
  if (READ_ONLY_ALLOWED.some((r) => r.test(req.path))) return next();
  const message = "Sua conta está em modo só leitura. Assine para voltar a criar e editar — seus dados continuam salvos.";
  if (wantsJson(req)) {
    res.status(402).json({ success: false, error: "ACCOUNT_READ_ONLY", message });
    return;
  }
  res.redirect(303, "/configuracoes.html#plano");
}

// ---------------------------------------------------------------------------
// Company-side billing API (Configurações › Plano e cobrança + banner)
// ---------------------------------------------------------------------------

export const accountBillingRouter = Router();

function canManageBilling(req: AuthedRequest): boolean {
  const u = req.user;
  return !!u && (u.roleKey === "admin" || u.permissions.includes("settings.manage"));
}

async function loadBillingOrg(id: string) {
  return prisma.organization.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      status: true,
      plan: true,
      billingCycle: true,
      planPriceCents: true,
      trialEndsAt: true,
      currentPeriodEnd: true,
      stripeSubscriptionId: true,
      stripeCustomerId: true,
      cancelAtPeriodEnd: true,
      readOnlySince: true,
      _count: { select: { users: true } },
    },
  });
}

accountBillingRouter.get("/api/account/status", async (req: AuthedRequest, res, next) => {
  try {
    if (!req.user || !req.organizationId) return void res.status(401).json({ success: false });
    const org = await loadBillingOrg(req.organizationId);
    if (!org) return void res.status(404).json({ success: false });
    res.json({
      success: true,
      data: {
        status: org.status,
        mode: accountMode(org.status),
        banner: accountBanner(org),
        can_manage_billing: canManageBilling(req) && !req.session?.support,
        legal: canManageBilling(req) && !req.session?.support ? await legalForApp(org.id) : null,
        support: supportBanner(req),
        hidden_pages: await hiddenPages(org.id),
      },
    });
  } catch (error) {
    next(error);
  }
});

/** Plan limits in use and modules left out of the plan (Configurações › Plano e cobrança). */
async function planUsageForApp(organizationId: string) {
  const [ent, usage] = await Promise.all([getEntitlements(organizationId), getUsage(organizationId)]);
  return {
    usage: LIMITS.filter((l) => ent.limits[l.key] != null).map((l) => {
      const limit = ent.limits[l.key]!;
      return { key: l.key, name: l.name, used: usage[l.key], limit, pct: limit ? Math.min(100, Math.round((usage[l.key] / limit) * 100)) : 100 };
    }),
    not_included: FEATURES.filter((f) => !ent.features[f.key].on).map((f) => f.name),
  };
}

/** Terms / Privacy / DPA the company admin still has to accept (links are absolute: tenant hosts have no /terms). */
async function legalForApp(organizationId: string) {
  if (!(await legalPromptEnabled())) return { pending: [] };
  const pending = await pendingLegal(organizationId);
  if (!pending.length) return { pending: [] };
  const base = env.APP_BASE_URL.replace(/\/$/, "");
  const firstTime = !(await prisma.legalAcceptance.findFirst({ where: { organizationId }, select: { id: true } }));
  return {
    pending,
    first_time: firstTime,
    docs: legalDocuments().map((d) => ({ key: d.key, title: d.title, url: base + d.path, version: d.version, pending: pending.includes(d.key) })),
  };
}

accountBillingRouter.post("/api/account/legal/accept", async (req: AuthedRequest, res, next) => {
  try {
    if (!req.user || !req.organizationId) return void res.status(401).json({ success: false });
    if (!canManageBilling(req)) return void res.status(403).json({ success: false, error: "Só o administrador da empresa pode aceitar." });
    await recordLegalAcceptance(
      req.organizationId,
      { id: req.user.id, name: req.user.name, email: req.user.email },
      { source: "in_app", ip: requestIp(req), userAgent: String(req.headers["user-agent"] || "") },
    );
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

accountBillingRouter.get("/api/billing/summary", async (req: AuthedRequest, res, next) => {
  try {
    if (!req.user || !req.organizationId) return void res.status(401).json({ success: false });
    const org = await loadBillingOrg(req.organizationId);
    if (!org) return void res.status(404).json({ success: false });
    const [catalog, payments] = await Promise.all([
      plans(),
      prisma.platformPayment.findMany({
        where: { organizationId: org.id, status: { in: ["paid", "refunded"] } },
        orderBy: { paidAt: "desc" },
        take: 12,
        select: { amountCents: true, paidAt: true, status: true, invoiceUrl: true, invoicePdfUrl: true, periodStart: true, periodEnd: true },
      }),
    ]);
    const price = cyclePriceCents(org);
    res.json({
      success: true,
      data: {
        status: org.status,
        mode: accountMode(org.status),
        banner: accountBanner(org),
        plan: { key: org.plan, name: planLabel(org.plan), cycle: org.billingCycle, price_text: money(price) + (org.billingCycle === "annual" ? "/ano" : "/mês"), special_price: org.planPriceCents != null },
        trial_ends_at: org.trialEndsAt?.toISOString() ?? null,
        current_period_end: org.currentPeriodEnd?.toISOString() ?? null,
        cancel_at_period_end: org.cancelAtPeriodEnd,
        has_subscription: !!org.stripeSubscriptionId,
        has_customer: !!org.stripeCustomerId,
        users: org._count.users,
        ...(await planUsageForApp(org.id)),
        can_manage_billing: canManageBilling(req),
        stripe_enabled: stripeEnabled(),
        plans: catalog
          .filter((p) => p.active && (p.visible || p.key === org.plan))
          .map((p) => ({
            key: p.key,
            name: p.name,
            description: p.description,
            monthly_text: money(p.monthlyCents),
            annual_text: money(p.annualCents),
            users_text: p.includedUsers == null ? "Usuários ilimitados" : `Até ${p.includedUsers} usuários`,
            current: p.key === org.plan,
          })),
        payments: payments.map((p) => ({
          amount_text: money(p.amountCents),
          paid_at: p.paidAt.toISOString(),
          status: p.status,
          invoice_url: p.invoiceUrl,
          invoice_pdf_url: p.invoicePdfUrl,
          period: p.periodStart && p.periodEnd ? `${shortDate(p.periodStart)} → ${shortDate(p.periodEnd)}` : null,
        })),
      },
    });
  } catch (error) {
    next(error);
  }
});

const checkoutSchema = z.object({
  plan: z.string().trim().toLowerCase().optional(),
  cycle: z.enum(["monthly", "annual"]).optional(),
});

function billingFail(res: Response, error: unknown) {
  if (error instanceof BillingError) {
    res.status(error.code === "stripe_off" ? 503 : 409).json({ success: false, error: error.code, message: error.message });
    return;
  }
  console.error("[billing] stripe call failed", error);
  res.status(502).json({ success: false, error: "stripe_error", message: "O Stripe não respondeu. Tente de novo em instantes." });
}

accountBillingRouter.post("/api/billing/checkout", async (req: AuthedRequest, res) => {
  if (!req.user || !req.organizationId) return void res.status(401).json({ success: false });
  if (!canManageBilling(req)) return void res.status(403).json({ success: false, message: "Só administradores mudam o plano." });
  const parsed = checkoutSchema.safeParse(req.body ?? {});
  if (!parsed.success) return void res.status(400).json({ success: false, message: "Plano inválido." });
  if (parsed.data.plan && !(await plans()).some((p) => p.key === parsed.data.plan && p.active)) {
    return void res.status(400).json({ success: false, message: "Plano indisponível." });
  }
  try {
    const url = await createCheckoutUrl(req.organizationId, { plan: parsed.data.plan, cycle: parsed.data.cycle, createdBy: req.user.email });
    res.json({ success: true, url });
  } catch (error) {
    billingFail(res, error);
  }
});

accountBillingRouter.post("/api/billing/portal", async (req: AuthedRequest, res) => {
  if (!req.user || !req.organizationId) return void res.status(401).json({ success: false });
  if (!canManageBilling(req)) return void res.status(403).json({ success: false, message: "Só administradores mexem no pagamento." });
  try {
    res.json({ success: true, url: await createPortalUrl(req.organizationId) });
  } catch (error) {
    billingFail(res, error);
  }
});
