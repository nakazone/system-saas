import { Router, type Response, type NextFunction } from "express";
import QRCode from "qrcode";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma } from "../lib/prisma.js";
import { env } from "../config/env.js";
import { randomBytes } from "node:crypto";
import { hashPassword, verifyPassword } from "../lib/auth/password.js";
import { email as emailProvider, getEmailTransportStatus } from "../lib/email/index.js";
import {
  sendPlatformEmail,
  firstName,
  dateVar,
  TEMPLATES,
  LOCALES,
  templateDef,
  activeText,
  overrides,
  clearTemplateCache,
  render,
  sampleVars,
  unknownVars,
  missingRequired,
  getLocaleMode,
  setLocaleMode,
  type Locale,
  type TemplateDef,
} from "../lib/email/templates.js";
import { senderStatus, EMAIL_LOG_DAYS } from "../lib/email/delivery.js";
import { KINDS, reachOf, targetCount } from "../lib/announcements/index.js";
import { storage } from "../lib/storage/index.js";
import {
  UI_LOCALES,
  UI_LOCALE_LABEL,
  UI_LOCALE_SHORT,
  applyTerms,
  baseDictionary,
  baseText,
  buildBundle,
  bumpI18n,
  normKey,
  normalizeUiLocale,
  orgDefaultUiLocale,
  phraseOverrides,
  previewText,
  type UiLocale,
} from "../lib/i18n/index.js";
import {
  recordMasterFailure,
  recordMasterLogin,
  findAlert,
  lockFromAlert,
  loginHistory,
  masterSessions,
  endMasterSession,
  endOtherMasterSessions,
  LOGIN_HISTORY_DAYS,
} from "../lib/security/login-events.js";
import { applyCoupon, archiveCoupon, couponState, couponText, createCoupon, getRetentionCode, getBuilderReferralCode, removeCoupon, setBuilderReferralCode, setRetentionCode, type CouponState } from "../lib/billing/coupons.js";
import { cardExpiresAt, cardText, expiringCards, forecast, forecastBuckets, syncCard } from "../lib/billing/cards.js";
import { CANCEL_REASONS, REASON_LABEL, recordMasterCancel } from "../lib/billing/cancel.js";
import { EXPORT_DAYS, createDownloadLink, exportFileName, isDownloadable, requestExport, revokeDownloadLink } from "../lib/data/export.js";
import { findPerson, erasePerson, maskSubject, normalizeSubject, subjectHash } from "../lib/data/erase.js";
import { deleteCompany, deletionCheck, sumCounts } from "../lib/data/delete-company.js";
import { KIND_LABEL, OPEN_STATUSES, PRIVACY_DAYS, daysLeft, dueFrom, privacyAttention, type AttentionRow } from "../lib/data/privacy.js";
import {
  decryptSecret,
  encryptSecret,
  generateRecoveryCodes,
  generateTotpSecret,
  normalizeRecoveryCode,
  otpauthUrl,
  verifyTotp,
} from "../lib/auth/totp.js";
import {
  audit,
  clearFailures,
  clientIp,
  isFreshStepUp,
  issueActivation,
  noteFailure,
  requireCap,
  requireMaster,
  requireStepUp,
  sendActivationEmail,
  sha256,
  throttled,
  wantsJson,
  type MasterRequest,
  IDLE_MS,
  ABSOLUTE_MS,
} from "./auth.js";
import {
  endOrgSessions,
  endUserSessions,
  loadOrg,
  loadOrgs,
  loadPayments,
  loadUsers,
  startOfMonthInTz,
  METHOD_LABEL,
} from "./data.js";
import {
  CAPABILITIES,
  PLAN_LABEL,
  PLAN_MONTHLY_CENTS,
  PLAN_ANNUAL_CENTS,
  ROLE_HINT,
  ROLE_LABEL,
  addCycle,
  avatarBg,
  can,
  csvEscape,
  cyclePriceCents,
  dateTimeLabel,
  dayFromToday,
  dueDateOf,
  daysUntil,
  initials,
  makeTempPassword,
  money,
  normalizeRole,
  planLabel,
  shortDate,
  slugifyName,
  weekdayShort,
  ymdInTz,
  PLATFORM_ROLES,
  type PlatformRole,
  type Pill,
} from "./lib.js";
import { createOrganizationWithAdmin, validateSlug } from "../modules/organizations/service.js";
import { legalPromptEnabled, legalStatus, setLegalPrompt } from "../lib/legal/acceptance.js";
import { createSupportSession, endSupportSession, SUPPORT_DURATIONS } from "../lib/support/session.js";
import { healthOf, invalidateHealth, type OrgHealth } from "./health.js";
import { jobsOverview, runJobNow } from "../lib/ops/jobs.js";
import { servicesOverview } from "../lib/ops/checks.js";
import { getMaintenance, setMaintenance } from "../lib/ops/maintenance.js";
import { SERVICE_CHECKS_JOB } from "../lib/billing/jobs.js";
import { activeUsersDaily, activeUsersNow, ensureTodaySnapshot, moduleUsage, movementFrom, mrrByMonth, trialFunnel } from "./metrics.js";
import { US_TIMEZONES } from "../modules/organizations/signup.js";
import {
  CORE_MODULES,
  FEATURES,
  LIMITS,
  checkLimit,
  featureDef,
  featureGlobals,
  getEntitlements,
  getUsage,
  invalidateEntitlements,
  resolveEntitlements,
  type FeatureState,
} from "../lib/features/index.js";
import { currentLegalVersions, legalDocuments } from "../lib/legal/documents.js";
import { signupMode, setSignupMode, resendSignup } from "../modules/organizations/signup.js";
import { formatPersonName } from "../lib/name.js";
import { plans, refreshPlans, trialDaysFor } from "./plans.js";
import {
  BillingError,
  cancelSubscription,
  createCheckoutUrl,
  payOpenInvoice,
  refundCharge,
  stripeEnabled,
  stripeMode,
  syncSubscriptionPrice,
  workspacePage,
} from "../lib/billing/stripe.js";
import { DEFAULT_LADDER, ladderSteps, loadLadder, runBillingLadder, saveLadder } from "../lib/billing/dunning.js";
import { BACKUP_CHECK_JOB, BACKUP_CHECK_MAX_DAYS, BILLING_LADDER_JOB, runJob } from "../lib/billing/jobs.js";

export const masterRouter = Router();

/** A plan key that exists in the catalog. */
const planKey = z.string().trim().toLowerCase().refine((k) => k in PLAN_LABEL, "Plano inválido");

function planOptions() {
  return Object.entries(PLAN_LABEL).map(([key, label]) => ({
    key,
    label,
    monthly: money(PLAN_MONTHLY_CENTS[key] ?? 0),
    annual: money(PLAN_ANNUAL_CENTS[key] ?? (PLAN_MONTHLY_CENTS[key] ?? 0) * 10),
  }));
}

type Handler = (req: MasterRequest, res: Response, next: NextFunction) => Promise<void> | void;
const h = (fn: Handler): Handler => async (req, res, next) => {
  try {
    await fn(req, res, next);
  } catch (error) {
    next(error);
  }
};

function ok(res: Response, message: string, extra: Record<string, unknown> = {}): void {
  res.json({ ok: true, message, ...extra });
}
function fail(res: Response, status: number, message: string, error = "invalid"): void {
  res.status(status).json({ ok: false, error, message });
}

const actor = (req: MasterRequest) => ({ id: req.master?.id ?? null, name: req.master?.name ?? "—" });

// Security headers for every Master page.
masterRouter.use((_req, res, next) => {
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Cache-Control", "no-store");
  res.locals.money = money;
  res.locals.shortDate = shortDate;
  res.locals.dateTimeLabel = dateTimeLabel;
  next();
});

// =============================================================================
// Sign-in: password → 2FA (or first-time 2FA setup)
// =============================================================================

function authView(res: Response, view: string, data: Record<string, unknown> = {}, status = 200) {
  res.status(status).render(`master/${view}`, { title: "ObraMate Master", error: null, info: null, ...data });
}

masterRouter.get("/entrar", (req, res) => {
  if (req.session.master?.stage === "full") return res.redirect("/master");
  authView(res, "login", {
    email: "",
    info: req.query.expirou ? "Sua sessão expirou depois de 30 minutos sem uso. Entre de novo." : req.query.saiu ? "Você saiu com segurança." : null,
  });
});

masterRouter.post(
  "/entrar",
  h(async (req, res) => {
    const emailIn = String(req.body?.email || "").trim().toLowerCase();
    const password = String(req.body?.password || "");
    const ip = clientIp(req);
    const keys = [`ip:${ip}`, `email:${emailIn}`];
    const generic = "E-mail ou senha incorretos.";
    if (throttled(keys)) {
      return authView(res, "login", { email: emailIn, error: "Muitas tentativas. Espere 15 minutos e tente de novo." }, 429);
    }
    if (!emailIn || !password) return authView(res, "login", { email: emailIn, error: "Digite e-mail e senha." }, 400);
    const admin = await prisma.platformAdmin.findUnique({ where: { email: emailIn } });
    if (admin?.securityLockedAt) {
      await recordMasterFailure(admin, emailIn, "security_locked", req);
      return authView(res, "login", { email: emailIn, error: "Conta travada por segurança (alguém clicou em “não fui eu”). Peça ao Master um novo link de acesso — ou, se você é o Master, rode npm run master:link no Railway." }, 423);
    }
    if (admin?.lockedUntil && admin.lockedUntil > new Date()) {
      await recordMasterFailure(admin, emailIn, "locked", req);
      return authView(res, "login", { email: emailIn, error: "Conta bloqueada por tentativas erradas. Tente de novo em alguns minutos." }, 429);
    }
    const valid = !!admin && admin.status === "active" && !!admin.passwordHash && (await verifyPassword(password, admin.passwordHash));
    if (!valid) {
      noteFailure(keys);
      if (admin) {
        const n = admin.failedLoginCount + 1;
        await prisma.platformAdmin.update({
          where: { id: admin.id },
          data: { failedLoginCount: n, lockedUntil: n >= 10 ? new Date(Date.now() + 30 * 60_000) : null },
        });
        await audit(req, { id: admin.id, name: admin.name }, "auth.password_failed", { type: "admin", id: admin.id, label: admin.email });
        await recordMasterFailure(admin, emailIn, "wrong_password", req);
      }
      return authView(res, "login", { email: emailIn, error: generic }, 401);
    }
    clearFailures(keys);
    if (!admin!.totpEnabledAt) {
      // The first 2FA enrollment is tied to the account's inbox: a password alone
      // (e.g. a seeded default) must never be enough to take over the console.
      const link = await issueActivation(admin!.id);
      await sendActivationEmail(admin!.email, admin!.name, link, "reset");
      console.log(`[master] 2FA setup link for ${admin!.email} (48 h, one use): ${link}`);
      await audit(req, { id: admin!.id, name: admin!.name }, "auth.setup_link_sent", { type: "admin", id: admin!.id, label: admin!.email });
      const masked = admin!.email.replace(/^(.{2}).*(@.*)$/, "$1•••$2");
      return authView(res, "login", { email: emailIn, info: `Falta configurar o 2FA. Enviamos um link para ${masked}. Abra no computador ou no celular para continuar.` });
    }
    await new Promise<void>((resolve, reject) => req.session.regenerate((e) => (e ? reject(e) : resolve())));
    const now = Date.now();
    req.session.master = { adminId: admin!.id, stage: "password", loginAt: now, lastSeen: now };
    req.session.save(() => res.redirect("/master/2fa"));
  }),
);

masterRouter.get(
  "/2fa",
  h(async (req, res) => {
    const s = req.session.master;
    if (!s || s.stage !== "password") return res.redirect("/master/entrar");
    const admin = await prisma.platformAdmin.findUnique({ where: { id: s.adminId }, select: { email: true } });
    authView(res, "twofa", { email: admin?.email ?? "", mode: req.query.modo === "recuperacao" ? "recovery" : "totp" });
  }),
);

async function completeLogin(req: MasterRequest, res: Response, adminId: string, method: string) {
  const admin = await prisma.platformAdmin.update({
    where: { id: adminId },
    data: { lastLoginAt: new Date(), lastLoginIp: clientIp(req) || null, failedLoginCount: 0, lockedUntil: null },
  });
  const now = Date.now();
  const login = await recordMasterLogin(admin, method, req, res);
  req.session.master = { adminId, stage: "full", loginAt: now, lastSeen: now, stepUpAt: now, ip: clientIp(req).slice(0, 80), device: login.device };
  await audit(req, { id: admin.id, name: admin.name }, "auth.login", { type: "admin", id: admin.id, label: admin.email, meta: { method, newDevice: login.newDevice, device: login.device } });
  req.session.save(() => res.redirect("/master"));
}

masterRouter.post(
  "/2fa",
  h(async (req, res) => {
    const s = req.session.master;
    if (!s || s.stage !== "password") return res.redirect("/master/entrar");
    const admin = await prisma.platformAdmin.findUnique({ where: { id: s.adminId } });
    if (!admin || !admin.totpSecretEnc) return res.redirect("/master/entrar");
    const keys = [`2fa:${admin.id}`];
    const mode = req.body?.mode === "recovery" ? "recovery" : "totp";
    if (throttled(keys)) {
      return authView(res, "twofa", { email: admin.email, mode, error: "Muitas tentativas. Espere 15 minutos." }, 429);
    }
    if (mode === "recovery") {
      const code = normalizeRecoveryCode(String(req.body?.code || ""));
      const hashes = Array.isArray(admin.recoveryCodeHashes) ? (admin.recoveryCodeHashes as string[]) : [];
      let used = -1;
      for (let i = 0; i < hashes.length; i++) {
        if (await bcrypt.compare(code, hashes[i])) {
          used = i;
          break;
        }
      }
      if (used < 0) {
        noteFailure(keys);
        await recordMasterFailure(admin, admin.email, "wrong_recovery", req);
        return authView(res, "twofa", { email: admin.email, mode, error: "Código de recuperação inválido." }, 401);
      }
      const left = hashes.filter((_, i) => i !== used);
      await prisma.platformAdmin.update({ where: { id: admin.id }, data: { recoveryCodeHashes: left } });
      clearFailures(keys);
      await audit(req, { id: admin.id, name: admin.name }, "auth.recovery_code_used", { type: "admin", id: admin.id, label: admin.email, meta: { left: left.length } });
      return completeLogin(req, res, admin.id, "recovery");
    }
    const secret = decryptSecret(admin.totpSecretEnc, env.SESSION_SECRET);
    if (!verifyTotp(secret, String(req.body?.code || ""))) {
      noteFailure(keys);
      await audit(req, { id: admin.id, name: admin.name }, "auth.2fa_failed", { type: "admin", id: admin.id, label: admin.email });
      await recordMasterFailure(admin, admin.email, "wrong_2fa", req);
      return authView(res, "twofa", { email: admin.email, mode, error: "Código incorreto. Confira o horário do celular e tente de novo." }, 401);
    }
    clearFailures(keys);
    await completeLogin(req, res, admin.id, "totp");
  }),
);

masterRouter.get(
  "/2fa/configurar",
  h(async (req, res) => {
    const s = req.session.master;
    if (!s || s.stage !== "setup") return res.redirect("/master/entrar");
    const admin = await prisma.platformAdmin.findUnique({ where: { id: s.adminId }, select: { email: true } });
    if (!admin) return res.redirect("/master/entrar");
    if (!s.pendingTotp) s.pendingTotp = generateTotpSecret();
    const url = otpauthUrl(s.pendingTotp, admin.email);
    const qrSvg = await QRCode.toString(url, { type: "svg", margin: 1, color: { dark: "#211d1a", light: "#ffffff" } });
    req.session.save(() =>
      authView(res, "twofa-setup", { email: admin.email, qrSvg, secret: s.pendingTotp!.replace(/(.{4})/g, "$1 ").trim(), codes: null }),
    );
  }),
);

masterRouter.post(
  "/2fa/configurar",
  h(async (req, res) => {
    const s = req.session.master;
    if (!s || s.stage !== "setup" || !s.pendingTotp) return res.redirect("/master/entrar");
    const admin = await prisma.platformAdmin.findUnique({ where: { id: s.adminId } });
    if (!admin) return res.redirect("/master/entrar");
    if (!verifyTotp(s.pendingTotp, String(req.body?.code || ""))) {
      const url = otpauthUrl(s.pendingTotp, admin.email);
      const qrSvg = await QRCode.toString(url, { type: "svg", margin: 1, color: { dark: "#211d1a", light: "#ffffff" } });
      return authView(res, "twofa-setup", { email: admin.email, qrSvg, secret: s.pendingTotp.replace(/(.{4})/g, "$1 ").trim(), codes: null, error: "Código incorreto. Digite o número que aparece agora no app." }, 400);
    }
    const codes = generateRecoveryCodes();
    const hashes = await Promise.all(codes.map((c) => bcrypt.hash(c, 10)));
    await prisma.platformAdmin.update({
      where: { id: admin.id },
      data: { totpSecretEnc: encryptSecret(s.pendingTotp, env.SESSION_SECRET), totpEnabledAt: new Date(), recoveryCodeHashes: hashes },
    });
    await audit(req, { id: admin.id, name: admin.name }, "auth.2fa_enabled", { type: "admin", id: admin.id, label: admin.email });
    const now = Date.now();
    const login = await recordMasterLogin(admin, "setup", req, res);
    req.session.master = { adminId: admin.id, stage: "full", loginAt: now, lastSeen: now, stepUpAt: now, ip: clientIp(req).slice(0, 80), device: login.device };
    await prisma.platformAdmin.update({ where: { id: admin.id }, data: { lastLoginAt: new Date(), lastLoginIp: clientIp(req) || null } });
    req.session.save(() => authView(res, "twofa-setup", { email: admin.email, qrSvg: null, secret: null, codes }));
  }),
);

masterRouter.get(
  "/ativar/:token",
  h(async (req, res) => {
    const admin = await prisma.platformAdmin.findUnique({ where: { activationTokenHash: sha256(String(req.params.token)) } });
    if (!admin || !admin.activationExpiresAt || admin.activationExpiresAt < new Date()) {
      return authView(res, "activate", { invalid: true, admin: null }, 410);
    }
    authView(res, "activate", { invalid: false, admin: { name: admin.name, email: admin.email, role: ROLE_LABEL[normalizeRole(admin.role)] } });
  }),
);

masterRouter.post(
  "/ativar/:token",
  h(async (req, res) => {
    const admin = await prisma.platformAdmin.findUnique({ where: { activationTokenHash: sha256(String(req.params.token)) } });
    if (!admin || !admin.activationExpiresAt || admin.activationExpiresAt < new Date()) {
      return authView(res, "activate", { invalid: true, admin: null }, 410);
    }
    const name = String(req.body?.name || admin.name).trim().slice(0, 80) || admin.name;
    const password = String(req.body?.password || "");
    const confirm = String(req.body?.confirm || "");
    const view = { invalid: false, admin: { name, email: admin.email, role: ROLE_LABEL[normalizeRole(admin.role)] } };
    if (password.length < 12) return authView(res, "activate", { ...view, error: "A senha precisa ter pelo menos 12 caracteres." }, 400);
    if (password !== confirm) return authView(res, "activate", { ...view, error: "As duas senhas não são iguais." }, 400);
    await prisma.platformAdmin.update({
      where: { id: admin.id },
      data: {
        name,
        passwordHash: await hashPassword(password),
        status: "active",
        activationTokenHash: null,
        activationExpiresAt: null,
        totpSecretEnc: null,
        totpEnabledAt: null,
        recoveryCodeHashes: [],
        failedLoginCount: 0,
        lockedUntil: null,
        securityLockedAt: null,
      },
    });
    await audit(req, { id: admin.id, name }, "auth.activated", { type: "admin", id: admin.id, label: admin.email });
    await new Promise<void>((resolve, reject) => req.session.regenerate((e) => (e ? reject(e) : resolve())));
    const now = Date.now();
    req.session.master = { adminId: admin.id, stage: "setup", loginAt: now, lastSeen: now };
    req.session.save(() => res.redirect("/master/2fa/configurar"));
  }),
);

masterRouter.post(
  "/sair",
  h(async (req, res) => {
    const s = req.session.master;
    if (s) {
      const admin = await prisma.platformAdmin.findUnique({ where: { id: s.adminId }, select: { id: true, name: true, email: true } });
      if (admin) await audit(req, admin, "auth.logout", { type: "admin", id: admin.id, label: admin.email });
    }
    delete req.session.master;
    req.session.save(() => res.redirect("/master/entrar?saiu=1"));
  }),
);

// =============================================================================
// Everything below needs a full sign-in
// =============================================================================

// "Não fui eu" from the login alert e-mail (no login needed: the link is the proof).
masterRouter.get(
  "/nao-fui-eu/:token",
  h(async (req, res) => {
    const ev = await findAlert(String(req.params.token));
    if (!ev) return authView(res, "nao-fui-eu", { state: "invalid" }, 410);
    authView(res, "nao-fui-eu", {
      state: "confirm",
      token: String(req.params.token),
      email: ev.email,
      device: ev.device ?? "aparelho desconhecido",
      ip: ev.ip ?? "—",
      when: ev.createdAt.toLocaleString("pt-BR", { timeZone: "America/Denver", dateStyle: "short", timeStyle: "short" }),
    });
  }),
);

masterRouter.post(
  "/nao-fui-eu/:token",
  h(async (req, res) => {
    const ev = await findAlert(String(req.params.token));
    if (!ev) return authView(res, "nao-fui-eu", { state: "invalid" }, 410);
    const r = await lockFromAlert(ev.id);
    if (!r) return authView(res, "nao-fui-eu", { state: "invalid" }, 410);
    const admin = await prisma.platformAdmin.findUnique({ where: { id: r.adminId }, select: { id: true, name: true, email: true, role: true } });
    await audit(req, { id: admin?.id ?? null, name: admin?.name ?? "—" }, "auth.not_me", { type: "admin", id: r.adminId, label: admin?.email ?? ev.email, meta: { sessions: r.sessions, ip: ev.ip, device: ev.device } });
    // Tell the Master too when it was someone else's account.
    if (admin && admin.role !== "MASTER") {
      const master = await prisma.platformAdmin.findFirst({ where: { role: "MASTER", status: "active" }, select: { email: true } });
      if (master) {
        await emailProvider
          .send({ to: master.email, subject: `[ObraMate] ${admin.name} travou a conta (não fui eu)`, text: `${admin.name} (${admin.email}) disse que não reconhece um acesso de ${ev.device} (IP ${ev.ip}). As sessões foram encerradas e a conta travada. Para destravar: Equipe e segurança › Destravar.`, meta: { category: "internal", template: "master_login_alert", organizationId: null } })
          .catch(() => undefined);
      }
    }
    req.session.destroy(() => authView(res, "nao-fui-eu", { state: "done", sessions: r.sessions, email: admin?.email ?? ev.email, isMaster: admin?.role === "MASTER" }));
  }),
);

masterRouter.use(requireMaster);

// Plan catalog in memory for every signed-in page (refreshed at most once a minute).
masterRouter.use(async (_req, _res, next) => {
  await plans();
  next();
});

masterRouter.post(
  "/step-up",
  h(async (req, res) => {
    const admin = await prisma.platformAdmin.findUnique({ where: { id: req.master!.id } });
    const keys = [`stepup:${req.master!.id}`];
    if (throttled(keys)) return fail(res, 429, "Muitas tentativas. Espere 15 minutos.");
    if (!admin?.totpSecretEnc || !verifyTotp(decryptSecret(admin.totpSecretEnc, env.SESSION_SECRET), String(req.body?.code || ""))) {
      noteFailure(keys);
      await audit(req, actor(req), "auth.step_up_failed");
      return fail(res, 401, "Código incorreto.");
    }
    clearFailures(keys);
    req.session.master!.stepUpAt = Date.now();
    req.session.save(() => ok(res, "Confirmado."));
  }),
);

// ---------------------------------------------------------------------------
// Layout data shared by every page
// ---------------------------------------------------------------------------

async function shell(req: MasterRequest, active: string) {
  const orgs = await prisma.organization.findMany({
    where: { status: { not: "canceled" } },
    select: { status: true, trialEndsAt: true, currentPeriodEnd: true },
  });
  const overdue = orgs.filter((o) => {
    const d = daysUntil(dueDateOf(o));
    return d != null && d < 0;
  }).length;
  const openTickets = await prisma.supportTicket.count({ where: { status: "open" } });
  const opsIssues = await opsIssueCount();
  const emailProblems = await emailProblemCount();
  const dataProblems = await dataProblemCount();
  const signupPending = await prisma.signupRequest.count({ where: { verifiedAt: null, expiresAt: { gt: new Date() } } }).catch(() => 0);
  const nav = [
    { key: "central", label: "Central", href: "/master", icon: "M3 12l9-8 9 8M5 10v10h14V10" },
    { key: "clientes", label: "Clientes", href: "/master/clientes", icon: "M4 21V5l8-3 8 3v16M9 21v-4h6v4M8 8h.01M12 8h.01M16 8h.01M8 12h.01M12 12h.01M16 12h.01", group: "CLIENTES" },
    { key: "usuarios", label: "Usuários", href: "/master/usuarios", icon: "M16 20v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 20v-1a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" },
    { key: "cadastros", label: "Cadastros", href: "/master/cadastros", icon: "M15 19v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1M8.5 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM19 8v6M22 11h-6", badge: signupPending || null },
    { key: "suporte", label: "Suporte", href: "/master/suporte", icon: "M21 12a8 8 0 0 1-11.8 7L4 20l1.2-4.6A8 8 0 1 1 21 12zM9 10h6M9 14h4", badge: openTickets || null },
    { key: "contatos", label: "Contatos", href: "/master/contatos", icon: "M5 4h12a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5zM5 4v18M12 11a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM8.5 17a3.5 3.5 0 0 1 7 0" },
    { key: "metricas", label: "Métricas", href: "/master/metricas", icon: "M4 20V10M10 20V4M16 20v-7M22 20H2", group: "FINANCEIRO", hidden: !can(req.master!.role, "billing_full") },
    { key: "pagamentos", label: "Pagamentos", href: "/master/pagamentos", icon: "M2 7a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2zM2 10h20M6 15h4", hidden: !can(req.master!.role, "billing_full") },
    { key: "planos", label: "Planos e preços", href: "/master/planos", icon: "M4 4h7l9 9-7 7-9-9zM8 8h.01", hidden: !can(req.master!.role, "billing_full") },
    { key: "cupons", label: "Cupons", href: "/master/cupons", icon: "M20 12V8a2 2 0 0 0-2-2H4v4a2 2 0 0 1 0 4v4h14a2 2 0 0 0 2-2v-4a2 2 0 0 1 0-4zM9 9l6 6M9.5 14.5h.01M14.5 9.5h.01", hidden: !can(req.master!.role, "billing_full") },
    { key: "recursos", label: "Recursos por plano", href: "/master/recursos", icon: "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 17h6M17 14v6", hidden: !can(req.master!.role, "billing_full") },
    { key: "vencimentos", label: "Vencimentos", href: "/master/vencimentos", icon: "M8 2v4M16 2v4M3 9h18M5 4h14a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM12 13v3l2 1", badge: overdue || null, group: can(req.master!.role, "billing_full") ? undefined : "FINANCEIRO" },
    { key: "comunicacao", label: "Comunicação", href: "/master/comunicacao", icon: "M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1zM15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13", group: "SISTEMA", badge: emailProblems || null },
    { key: "idiomas", label: "Idiomas", href: "/master/idiomas", icon: "M4 5h9M8.5 3v2M6 5c.6 3.3 3 6 6 7.5M11 5c-.8 3.6-3.6 6.6-7 8M13 21l4.5-10L22 21M14.6 17.5h4.8" },
    { key: "operacao", label: "Operação", href: "/master/operacao", icon: "M22 12h-4l-3 9L9 3l-3 9H2", badge: opsIssues || null },
    { key: "privacidade", label: "Privacidade", href: "/master/privacidade", icon: "M12 3c4.4 0 8 1.3 8 3v12c0 1.7-3.6 3-8 3s-8-1.3-8-3V6c0-1.7 3.6-3 8-3zM4 6c0 1.7 3.6 3 8 3s8-1.3 8-3M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3", badge: dataProblems || null },
    { key: "equipe", label: "Equipe e segurança", href: "/master/equipe", icon: "M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6zM9 12l2 2 4-4" },
    { key: "auditoria", label: "Auditoria", href: "/master/auditoria", icon: "M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01" },
  ].filter((n) => !n.hidden);
  return {
    active,
    nav,
    me: req.master!,
    meRole: ROLE_LABEL[req.master!.role],
    meInitials: initials(req.master!.name),
    env: process.env.NODE_ENV === "production" ? "Produção" : "Teste",
  };
}

function page(res: Response, view: string, layout: Awaited<ReturnType<typeof shell>>, data: Record<string, unknown>) {
  res.render(`master/${view}`, { title: "ObraMate Master", ...layout, ...data });
}

// ---------------------------------------------------------------------------
// Central
// ---------------------------------------------------------------------------

masterRouter.get(
  "/",
  h(async (req, res) => {
    const [orgs, users, recent, monthPays, invitedTeam] = await Promise.all([
      loadOrgs(),
      loadUsers(),
      loadPayments({ status: "paid" }, 5),
      prisma.platformPayment.findMany({ where: { status: "paid", paidAt: { gte: startOfMonthInTz() } }, select: { amountCents: true } }),
      prisma.platformAdmin.count({ where: { status: "invited" } }),
    ]);
    const live = orgs.filter((o) => o.status !== "canceled");
    const paying = live.filter((o) => o.status === "active" || o.status === "past_due");
    const mrr = paying.reduce((a, o) => a + o.monthlyCents, 0);
    const received = monthPays.reduce((a, p) => a + p.amountCents, 0);
    const next7 = paying.filter((o) => o.days != null && o.days >= 0 && o.days <= 7);
    const overdue = live.filter((o) => o.overdue);
    const overduePaid = overdue.filter((o) => o.status !== "trial");
    const due30 = live.filter((o) => o.days != null && o.days >= 0 && o.days <= 30);
    const now = new Date();
    const monthName = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Denver", month: "long" }).format(now);

    const kpis = [
      { label: "MRR", value: money(mrr), note: `${paying.length} empresa(s) pagante(s)`, dark: true, href: "/master/clientes?filtro=ativas" },
      { label: `Recebido em ${monthName}`, value: money(received), note: `${monthPays.length} pagamento(s) registrado(s)`, href: "/master/pagamentos" },
      { label: "Renova nos próximos 7 dias", value: money(next7.reduce((a, o) => a + o.priceCents, 0)), note: `${next7.length} renovação(ões)`, href: "/master/vencimentos" },
      { label: "Em atraso", value: money(overduePaid.reduce((a, o) => a + o.priceCents, 0)), note: `${overdue.length} vencimento(s) passado(s)`, warn: overdue.length > 0, href: "/master/vencimentos" },
      { label: "Vencem em 30 dias", value: String(due30.length), note: `${due30.filter((o) => o.status === "trial").length} trial(s) · ${due30.filter((o) => o.status !== "trial").length} renovação(ões)`, href: "/master/vencimentos" },
    ];

    const strip = Array.from({ length: 14 }, (_, d) => {
      const day = dayFromToday(d, now);
      const items = live.filter((o) => o.days === d);
      return { d, wd: d === 0 ? "hoje" : weekdayShort(day), n: Number(ymdInTz(day).slice(8)), weekend: ["sáb", "dom"].includes(weekdayShort(day)), items };
    });

    type Q = { tone: string; title: string; sub: string; cta: string; href: string; primary?: boolean };
    const queue: Q[] = [];
    for (const o of overdue) {
      queue.push(
        o.status === "trial"
          ? { tone: "info", title: `${o.name}: trial expirou ${o.days === -1 ? "ontem" : `há ${-o.days!} dias`}`, sub: `${o.users} usuário(s) · dono ${o.ownerName}`, cta: "Prorrogar", href: `/master/clientes?ficha=${o.id}&abrir=prorrogar` }
          : { tone: "danger", title: `${o.name}: venceu há ${-o.days!} dia(s)`, sub: `${o.priceText} · ${o.pill.label}`, cta: "Registrar pagamento", href: `/master/clientes?ficha=${o.id}&abrir=pagamento`, primary: true },
      );
    }
    for (const o of live.filter((x) => x.status === "trial" && x.days != null && x.days >= 0 && x.days <= 3)) {
      queue.push({ tone: "info", title: `${o.name}: trial acaba ${o.days === 0 ? "hoje" : `em ${o.days} dia(s)`}`, sub: `${o.users} usuário(s) · dono ${o.ownerName}`, cta: "Abrir", href: `/master/clientes?ficha=${o.id}` });
    }
    const noDate = live.filter((o) => o.status !== "trial" && o.due == null);
    if (noDate.length) {
      queue.push({ tone: "warn", title: `${noDate.length} empresa(s) pagante(s) sem data de vencimento`, sub: noDate.slice(0, 3).map((o) => o.name).join(", ") + (noDate.length > 3 ? "…" : ""), cta: "Definir", href: `/master/clientes?ficha=${noDate[0].id}&abrir=prorrogar` });
    }
    const noTrialDate = live.filter((o) => o.status === "trial" && o.due == null);
    if (noTrialDate.length) {
      queue.push({ tone: "warn", title: `${noTrialDate.length} trial(s) sem data de fim`, sub: noTrialDate.slice(0, 3).map((o) => o.name).join(", ") + (noTrialDate.length > 3 ? "…" : ""), cta: "Definir", href: `/master/clientes?ficha=${noTrialDate[0].id}&abrir=prorrogar` });
    }
    if (invitedTeam) queue.push({ tone: "muted", title: `${invitedTeam} convite(s) da equipe sem resposta`, sub: "Equipe e segurança", cta: "Ver", href: "/master/equipe" });
    // Support tickets waiting for us, and the billing job.
    const [waitingTickets, oldestTicket, lastLadder] = await Promise.all([
      prisma.supportTicket.count({ where: { status: "open" } }),
      prisma.supportTicket.findFirst({ where: { status: "open" }, orderBy: [{ priority: "asc" }, { lastMessageAt: "asc" }], include: { organization: { select: { name: true } } } }),
      prisma.jobRun.findFirst({ where: { name: BILLING_LADDER_JOB }, orderBy: { startedAt: "desc" } }),
    ]);
    if (waitingTickets && oldestTicket) {
      queue.unshift({
        tone: oldestTicket.priority === "high" ? "danger" : "warn",
        title: waitingTickets === 1 ? `Ticket esperando resposta: ${oldestTicket.subject}` : `${waitingTickets} tickets esperando resposta`,
        sub: `${oldestTicket.organization.name} · ${ageLabel(oldestTicket.lastMessageAt ?? oldestTicket.createdAt)}`,
        cta: "Responder",
        href: waitingTickets === 1 ? `/master/suporte/${oldestTicket.id}` : "/master/suporte",
        primary: true,
      });
    }
    const lastBackup = await prisma.jobRun.findFirst({ where: { name: BACKUP_CHECK_JOB }, orderBy: { startedAt: "desc" } });
    if (!lastBackup) {
      queue.push({ tone: "warn", title: "Backup ainda não foi testado", sub: "Faça um teste de restauração antes de receber empresas de fora", cta: "Como fazer", href: "/master/equipe#backup" });
    } else if (lastBackup.ok === false) {
      queue.unshift({ tone: "danger", title: "O último teste de restauração do backup falhou", sub: (lastBackup.error || "").slice(0, 90), cta: "Ver", href: "/master/equipe#backup", primary: true });
    } else if (Date.now() - lastBackup.startedAt.getTime() > BACKUP_CHECK_MAX_DAYS * 86400e3) {
      queue.push({ tone: "muted", title: `Backup testado há mais de ${BACKUP_CHECK_MAX_DAYS} dias`, sub: `Último teste ${shortDate(lastBackup.startedAt)}`, cta: "Testar de novo", href: "/master/equipe#backup" });
    }
    // Ficha 360°: companies stuck at the start of onboarding, and companies at risk.
    const healthAll = await healthOf();
    const nameOf = new Map(orgs.map((o) => [o.id, o.name]));
    const stuck = [...healthAll.values()].filter((h) => {
      const o = orgs.find((x) => x.id === h.organizationId);
      return !!o && ["trial", "active"].includes(o.status) && h.stepsDone <= 1 && Date.now() - o.createdAt.getTime() > 3 * 86400e3;
    });
    if (stuck.length) {
      queue.push({ tone: "warn", title: stuck.length === 1 ? `${nameOf.get(stuck[0].organizationId)} parou no começo do onboarding` : `${stuck.length} empresas pararam no começo do onboarding`, sub: stuck.slice(0, 3).map((h) => nameOf.get(h.organizationId)).join(", ") + (stuck.length > 3 ? "…" : "") + " · 3+ dias sem passar do 1º passo", cta: "Abrir", href: `/master/clientes/${stuck[0].organizationId}` });
    }
    const risk = [...healthAll.values()].filter((h) => h.band === "risk");
    if (risk.length) {
      queue.push({ tone: "warn", title: `${risk.length} empresa(s) com saúde em risco`, sub: risk.slice(0, 3).map((h) => `${nameOf.get(h.organizationId)} (${h.score})`).join(", ") + (risk.length > 3 ? "…" : ""), cta: "Ver", href: "/master/clientes?filtro=risco" });
    }
    // Operação: services down, jobs late or failing, new errors, maintenance on.
    const ops = await opsProblems().catch(() => null);
    if (ops) {
      if (ops.maintenance.on) queue.unshift({ tone: "danger", title: "Modo manutenção LIGADO", sub: "As empresas estão vendo “Voltamos já”", cta: "Desligar", href: "/master/operacao#manutencao", primary: true });
      for (const sv of ops.down) queue.unshift({ tone: "danger", title: `${sv.name} fora do ar`, sub: sv.detail.slice(0, 90), cta: "Ver", href: "/master/operacao", primary: true });
      if (ops.lateJobs.length) queue.push({ tone: "warn", title: ops.lateJobs.length === 1 ? `Job com problema: ${ops.lateJobs[0].label}` : `${ops.lateJobs.length} jobs com problema`, sub: ops.lateJobs.map((j) => `${j.label} (${j.lastOk === false ? "falhou" : "atrasado"})`).slice(0, 3).join(", "), cta: "Ver", href: "/master/operacao#jobs" });
      if (ops.newErrors.length) queue.push({ tone: "warn", title: `${ops.newErrors.length} erro(s) novo(s) nas últimas 24 h`, sub: ops.newErrors[0].message.slice(0, 90), cta: "Ver", href: "/master/operacao#erros" });
    }
    // Segurança: wrong passwords / codes on the Master in the last 24 h.
    const masterFails = await prisma.loginEvent.count({ where: { kind: "master", success: false, createdAt: { gte: new Date(Date.now() - 86400e3) } } }).catch(() => 0);
    if (masterFails >= 5) queue.unshift({ tone: "danger", title: `${masterFails} tentativas erradas de entrar no Master em 24 h`, sub: "Confira o histórico de acessos da equipe", cta: "Ver", href: "/master/seguranca", primary: true });
    const locked = await prisma.platformAdmin.findMany({ where: { securityLockedAt: { not: null }, status: "active" }, select: { name: true } }).catch(() => []);
    if (locked.length) queue.unshift({ tone: "danger", title: `Conta travada por “não fui eu”: ${locked.map((l) => l.name).join(", ")}`, sub: "Destrave em Equipe e segurança (manda link novo de senha e 2FA)", cta: "Ver", href: "/master/equipe", primary: true });
    // Cobrança: disputes, companies that asked to cancel, cards expiring in 15 days.
    const openDisp = await prisma.platformDispute.findMany({ where: { status: { in: OPEN_DISPUTE } }, orderBy: { evidenceDueBy: "asc" }, take: 5 }).catch(() => []);
    if (openDisp.length) {
      const d0 = openDisp[0];
      queue.unshift({ tone: "danger", title: openDisp.length === 1 ? `Disputa de ${money(d0.amountCents)}${d0.orgName ? ` · ${d0.orgName}` : ""}` : `${openDisp.length} disputas abertas`, sub: d0.evidenceDueBy ? `Responder no Stripe até ${shortDate(d0.evidenceDueBy)}` : "Responder no Stripe", cta: "Ver", href: "/master/pagamentos?aba=disputas", primary: true });
    }
    const asked = await prisma.organization.findMany({ where: { cancelAtPeriodEnd: true, cancelRequestedAt: { gte: new Date(Date.now() - 14 * 86400e3) }, status: { not: "canceled" } }, select: { id: true, name: true, cancelReasonKey: true, currentPeriodEnd: true, trialEndsAt: true }, take: 5 }).catch(() => []);
    for (const a of asked) queue.push({ tone: "warn", title: `${a.name} pediu cancelamento`, sub: `${REASON_LABEL[a.cancelReasonKey ?? ""] ?? "sem motivo"} · acesso até ${shortDate(a.currentPeriodEnd ?? a.trialEndsAt)} — dá tempo de conversar`, cta: "Abrir", href: `/master/clientes/${a.id}` });
    const cardsSoon = (await expiringCards().catch(() => [])).filter((c) => c.daysToExp <= 15);
    if (cardsSoon.length) queue.push({ tone: "muted", title: `${cardsSoon.length} cartão(ões) vencem antes da próxima cobrança`, sub: cardsSoon.slice(0, 3).map((c) => c.name).join(", ") + " · a empresa recebe e-mail", cta: "Ver", href: "/master/pagamentos?aba=previsao" });
    // Dados e privacidade: requests near the deadline, failed exports.
    const due: AttentionRow[] = await privacyAttention().catch((): AttentionRow[] => []);
    const late = due.filter((r: AttentionRow) => r.days < 0);
    if (late.length) queue.unshift({ tone: "danger", title: late.length === 1 ? `Pedido de privacidade atrasado: ${late[0].requesterName}` : `${late.length} pedidos de privacidade atrasados`, sub: "O prazo é de 30 dias desde o recebimento", cta: "Ver", href: "/master/privacidade", primary: true });
    const soon = due.filter((r: AttentionRow) => r.days >= 0);
    if (soon.length) queue.push({ tone: "warn", title: soon.length === 1 ? `Pedido de privacidade vence em ${soon[0].days} dia(s)` : `${soon.length} pedidos de privacidade vencem em 7 dias`, sub: soon.slice(0, 3).map((r: AttentionRow) => `${r.requesterName}${r.orgName ? ` (${r.orgName})` : ""}`).join(", "), cta: "Ver", href: "/master/privacidade" });
    const failedExports = await prisma.dataExport.findMany({ where: { status: "failed", finishedAt: { gte: new Date(Date.now() - 86400e3) } }, select: { orgName: true, error: true }, take: 3 }).catch(() => []);
    if (failedExports.length) queue.push({ tone: "warn", title: `Exportação falhou: ${failedExports[0].orgName}`, sub: (failedExports[0].error || "").slice(0, 90), cta: "Ver", href: "/master/privacidade?aba=exportacoes" });
    // Comunicação: e-mails that bounced, e-mail not going out, urgent notice on the air.
    const comms = await commsProblems().catch(() => null);
    if (comms) {
      if (comms.consoleInProd) queue.unshift({ tone: "danger", title: "Os e-mails não estão saindo", sub: "E-mail em modo console: configure o Resend no Railway", cta: "Ver", href: "/master/comunicacao?aba=remetente", primary: true });
      if (comms.bounced) queue.push({ tone: "warn", title: `${comms.bounced} e-mail(s) voltaram ou viraram spam nos últimos 7 dias`, sub: "Os endereços ficam bloqueados até você liberar", cta: "Ver", href: "/master/comunicacao?aba=envios&status=problema" });
      if (comms.urgent) queue.push({ tone: "info", title: `Aviso urgente no ar: ${comms.urgent.title}`, sub: "As empresas não conseguem fechar esse aviso", cta: "Ver", href: "/master/comunicacao" });
    }
    if (lastLadder && lastLadder.ok === false) {
      queue.unshift({ tone: "danger", title: "A régua de cobrança falhou na última execução", sub: (lastLadder.error || "").slice(0, 90), cta: "Ver", href: "/master/vencimentos", primary: true });
    }

    const userStats = [
      { label: "Total na plataforma", v: users.length, href: "/master/usuarios" },
      { label: "Com sessão aberta agora", v: users.filter((u) => u.sessions > 0).length, href: "/master/usuarios?filtro=online" },
      { label: "Bloqueados", v: users.filter((u) => u.status === "suspended").length, href: "/master/usuarios?filtro=bloqueados", danger: true },
      { label: "Convites pendentes", v: users.filter((u) => u.status === "invited").length, href: "/master/usuarios?filtro=convidados" },
    ];

    const greetHour = Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/Denver", hour: "numeric", hourCycle: "h23" }).format(now));
    const greet = greetHour < 12 ? "Bom dia" : greetHour < 18 ? "Boa tarde" : "Boa noite";
    const dateLine = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Denver", weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(now);
    // The login before this one (the latest is the current session).
    const logins = await prisma.platformAuditLog.findMany({ where: { actorId: req.master!.id, action: "auth.login" }, orderBy: { at: "desc" }, take: 2, select: { at: true, ip: true } });
    const me = logins[1] ? { lastLoginAt: logins[1].at } : null;

    page(res, "central", await shell(req, "central"), {
      greet: `${greet}, ${req.master!.name.split(" ")[0]}`,
      dateLine: dateLine[0].toUpperCase() + dateLine.slice(1),
      lastLogin: me?.lastLoginAt ? dateTimeLabel(me.lastLoginAt) : null,
      kpis,
      strip,
      overdueCount: overdue.length,
      overdueTotal: money(overduePaid.reduce((a, o) => a + o.priceCents, 0)),
      queue: queue.slice(0, 7),
      queueCount: queue.length,
      recent,
      userStats,
      showMoney: can(req.master!.role, "billing_full"),
    });
  }),
);

// ---------------------------------------------------------------------------
// Clientes
// ---------------------------------------------------------------------------

const CLIENT_FILTERS: [string, string, (o: Awaited<ReturnType<typeof loadOrgs>>[number]) => boolean][] = [
  ["todas", "Todas", () => true],
  ["ativas", "Ativas", (o) => o.status === "active"],
  ["trial", "Trial", (o) => o.status === "trial"],
  ["atraso", "Em atraso", (o) => o.overdue || o.status === "past_due" || o.status === "read_only"],
  ["30dias", "Vencem em 30 dias", (o) => o.days != null && o.days >= 0 && o.days <= 30],
  ["risco", "Em risco", (o) => (o as { health?: OrgHealth }).health?.band === "risk"],
  ["suspensas", "Suspensas", (o) => o.status === "suspended"],
  ["canceladas", "Canceladas", (o) => o.status === "canceled"],
];

masterRouter.get(
  "/clientes",
  h(async (req, res) => {
    const health = await healthOf();
    const orgs = (await loadOrgs()).map((o) => ({ ...o, health: health.get(o.id) ?? null }));
    const filter = CLIENT_FILTERS.find((f) => f[0] === req.query.filtro) ?? CLIENT_FILTERS[0];
    const q = String(req.query.q || "").trim().toLowerCase();
    const sort = ["venc", "nome", "valor"].includes(String(req.query.ordem)) ? String(req.query.ordem) : "venc";
    let rows = orgs.filter(filter[2]).filter((o) => !q || `${o.name} ${o.slug} ${o.ownerName} ${o.ownerEmail} ${o.ownerPhone}`.toLowerCase().includes(q));
    rows = rows.sort((a, b) => {
      if (sort === "nome") return a.name.localeCompare(b.name);
      if (sort === "valor") return b.monthlyCents - a.monthlyCents;
      return (a.days ?? 99999) - (b.days ?? 99999);
    });
    const mrr = orgs.filter((o) => o.status === "active" || o.status === "past_due").reduce((a, o) => a + o.monthlyCents, 0);
    page(res, "clientes", await shell(req, "clientes"), {
      rows,
      q: String(req.query.q || ""),
      sort,
      filter: filter[0],
      filters: CLIENT_FILTERS.map((f) => ({ key: f[0], label: f[1], count: orgs.filter(f[2]).length })),
      sub: `${orgs.length} empresa(s) · ${money(mrr)} de MRR · ${orgs.filter((o) => o.overdue).length} com vencimento passado`,
      showMoney: can(req.master!.role, "billing_full"),
      canCreate: can(req.master!.role, "billing_manage"),
      plans: planOptions(),
      todayYmd: ymdInTz(new Date()),
    });
  }),
);

const createOrgSchema = z.object({
  name: z.string().trim().min(2).max(120),
  slug: z.string().trim().max(48).optional().or(z.literal("")),
  adminName: z.string().trim().min(2).max(120),
  adminEmail: z.string().trim().email().max(200),
  contactPhone: z.string().trim().max(40).optional().or(z.literal("")),
  status: z.enum(["trial", "active"]).default("trial"),
  plan: planKey.default("starter"),
  cycle: z.enum(["monthly", "annual"]).default("monthly"),
  price: z.union([z.literal(""), z.coerce.number().min(0).max(100000)]).optional(),
  trialDays: z.coerce.number().int().min(1).max(366).optional(),
  periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("")),
});

masterRouter.post(
  "/clientes",
  requireCap("billing_manage"),
  requireStepUp,
  h(async (req, res) => {
    const parsed = createOrgSchema.safeParse(req.body);
    if (!parsed.success) return fail(res, 400, "Confira os dados da empresa e do dono.");
    const slugRaw = (parsed.data.slug || slugifyName(parsed.data.name) || "empresa").slice(0, 48);
    const slugErr = validateSlug(slugRaw);
    if (slugErr) return fail(res, 400, slugErr);
    const email = parsed.data.adminEmail.toLowerCase();
    const temp = makeTempPassword();
    let created: Awaited<ReturnType<typeof createOrganizationWithAdmin>>;
    try {
      created = await createOrganizationWithAdmin({
        organizationName: parsed.data.name,
        slug: slugRaw,
        adminName: parsed.data.adminName,
        adminEmail: email,
        password: temp,
        contactEmail: email,
        contactPhone: parsed.data.contactPhone || undefined,
      });
    } catch (err) {
      return fail(res, 400, err instanceof Error ? err.message : "Não foi possível criar a empresa.");
    }
    const custom =
      parsed.data.price === "" || parsed.data.price == null ? null : Math.round(Number(parsed.data.price) * 100);
    const listPrice = cyclePriceCents({
      plan: parsed.data.plan,
      billingCycle: parsed.data.cycle,
      planPriceCents: null,
    });
    const planPriceCents = custom != null && custom !== listPrice ? custom : null;
    const billing: Record<string, unknown> = {
      plan: parsed.data.plan,
      billingCycle: parsed.data.cycle,
      planPriceCents,
    };
    if (parsed.data.status === "trial") {
      const days = parsed.data.trialDays ?? (await trialDaysFor(parsed.data.plan));
      billing.status = "trial";
      billing.trialEndsAt = dayFromToday(days);
      billing.currentPeriodEnd = null;
    } else {
      billing.status = "active";
      billing.trialEndsAt = null;
      billing.currentPeriodEnd = parsed.data.periodEnd
        ? new Date(`${parsed.data.periodEnd}T12:00:00Z`)
        : addCycle(dayFromToday(0), parsed.data.cycle);
    }
    await prisma.organization.update({ where: { id: created.organization.id }, data: billing });
    await prisma.user.update({
      where: { id: created.admin.id },
      data: { mustChangePassword: true },
    });
    await audit(
      req,
      actor(req),
      "tenant.create",
      {
        type: "organization",
        id: created.organization.id,
        label: created.organization.name,
        meta: {
          slug: slugRaw,
          status: billing.status,
          plan: parsed.data.plan,
          adminEmail: email,
        },
      },
      true,
    );
    ok(res, `${parsed.data.name} criada. Passe a senha temporária para ${email}.`, {
      redirect: `/master/clientes/${created.organization.id}`,
      reveal: {
        title: `Senha temporária · ${parsed.data.adminName}`,
        value: temp,
        note: `Empresa ${slugRaw} · ${email}. No primeiro acesso o sistema pede uma senha nova. A senha não aparece de novo.`,
      },
    });
  }),
);

masterRouter.get(
  "/clientes/:id",
  h(async (req, res) => {
    const org = await loadOrg(String(req.params.id));
    if (!org) return void res.status(404).render("master/error", { title: "Empresa não encontrada", message: "Essa empresa não existe." });
    const [users, payments, notes, contactLog, roles] = await Promise.all([
      loadUsers({ organizationId: org.id }),
      loadPayments({ organizationId: org.id }, 6),
      prisma.platformNote.findMany({ where: { organizationId: org.id }, orderBy: { createdAt: "desc" }, take: 20 }),
      prisma.platformContactLog.findMany({ where: { organizationId: org.id }, orderBy: { createdAt: "desc" }, take: 5 }),
      prisma.role.findMany({
        where: { organizationId: org.id },
        select: { id: true, key: true, name: true },
        orderBy: { name: "asc" },
      }),
    ]);
    const nextPeriodStart = org.currentPeriodEnd && org.currentPeriodEnd > new Date() ? org.currentPeriodEnd : dayFromToday(0);
    const data = {
      org,
      users,
      payments,
      notes,
      contactLog,
      roles,
      plans: planOptions(),
      methods: Object.entries(METHOD_LABEL),
      todayYmd: ymdInTz(new Date()),
      dueYmd: org.due ? ymdInTz(org.due) : "",
      trialYmd: org.trialEndsAt ? ymdInTz(org.trialEndsAt) : "",
      periodYmd: org.currentPeriodEnd ? ymdInTz(org.currentPeriodEnd) : "",
      priceDollars: (org.priceCents / 100).toFixed(2),
      nextPeriodLabel: `${shortDate(nextPeriodStart)} → ${shortDate(addCycle(nextPeriodStart, org.billingCycle))}`,
      canBilling: can(req.master!.role, "billing_manage"),
      canSuspend: can(req.master!.role, "tenants_suspend"),
      stripeOn: stripeEnabled(),
      canUsers: can(req.master!.role, "users_manage"),
      showMoney: can(req.master!.role, "billing_full"),
      legal: await legalStatus(org.id),
      canSupport: can(req.master!.role, "support_enter"),
      supportSessions: await supportSessionsFor({ organizationId: org.id }),
      rec: await featuresForRecord(org.id),
      health: (await healthOf(org.id)).get(org.id) ?? null,
      timeline: await timelineFor(org.id, req.query.linha === "tudo" ? 200 : 25),
      details: await companyDetails(org.id),
      timezones: US_TIMEZONES,
      supportUsers: await prisma.user.findMany({
        where: { organizationId: org.id, status: "active" },
        select: { id: true, name: true, role: { select: { key: true, name: true } } },
        orderBy: [{ createdAt: "asc" }],
        take: 100,
      }),
      signupOrigin: await prisma.signupRequest.findFirst({ where: { organizationId: org.id }, select: { createdAt: true, verifiedAt: true, ip: true, inviteId: true } }),
      dataRec: await dataForRecord(org.id),
      billx: await billingForRecord(org),
      canExport: can(req.master!.role, "export"),
      canDataDelete: can(req.master!.role, "data_delete"),
    };
    if (req.query.partial) return void res.render("master/_cliente", { ...data, partial: true });
    page(res, "cliente", await shell(req, "clientes"), { ...data, partial: false });
  }),
);

masterRouter.get(
  "/clientes/:id/papeis",
  requireCap("users_manage"),
  h(async (req, res) => {
    const org = await orgOr404(req, res);
    if (!org) return;
    const roles = await prisma.role.findMany({
      where: { organizationId: org.id },
      select: { id: true, key: true, name: true },
      orderBy: { name: "asc" },
    });
    res.json({ ok: true, roles });
  }),
);

// ---------------------------------------------------------------------------
// Entrar como suporte
// ---------------------------------------------------------------------------

/** Recent support sessions, shown on the company record, the user record and the ticket. */
async function supportSessionsFor(where: { organizationId?: string; userId?: string; ticketId?: string }, take = 6) {
  const rows = await prisma.supportSession.findMany({ where, orderBy: { createdAt: "desc" }, take });
  const now = Date.now();
  return rows.map((r) => {
    const live = !!r.startedAt && !r.endedAt && r.expiresAt.getTime() > now;
    const waiting = !r.startedAt && !r.endedAt && r.tokenExpiresAt.getTime() > now;
    const mins = r.startedAt ? Math.max(1, Math.round(((r.endedAt ?? (live ? new Date() : r.expiresAt)).getTime() - r.startedAt.getTime()) / 60e3)) : 0;
    return {
      id: r.id,
      live,
      waiting,
      admin: r.adminName,
      user: r.userName,
      reason: r.reason,
      when: dateTimeLabel(r.createdAt),
      status: live
        ? `ativa · termina ${dateTimeLabel(r.expiresAt)}`
        : waiting
          ? "link ainda não aberto"
          : !r.startedAt
            ? "link não usado"
            : `${mins} min · ${r.views} tela(s)${r.blocked ? ` · ${r.blocked} bloqueio(s)` : ""}${r.endedBy === "master" ? " · encerrada no Master" : r.endedBy === "user" ? " · saiu" : ""}`,
    };
  });
}

const supportSchema = z.object({
  userId: z.string().uuid().optional().or(z.literal("")),
  reason: z.string().trim().min(5).max(500),
  minutes: z.coerce.number().int(),
  ticketId: z.string().uuid().optional().or(z.literal("")),
});

masterRouter.post(
  "/clientes/:id/suporte",
  requireCap("support_enter"),
  h(async (req, res) => {
    const org = await orgOr404(req, res);
    if (!org) return;
    const parsed = supportSchema.safeParse(req.body);
    if (!parsed.success) return fail(res, 400, "Escreva o motivo (o admin da empresa recebe por e-mail).");
    const minutes = (SUPPORT_DURATIONS as readonly number[]).includes(parsed.data.minutes) ? parsed.data.minutes : 30;
    const r = await createSupportSession({
      admin: { id: req.master!.id, name: req.master!.name },
      organizationId: org.id,
      userId: parsed.data.userId || null,
      reason: parsed.data.reason,
      minutes,
      ticketId: parsed.data.ticketId || null,
    });
    if (!r.ok) return fail(res, 400, r.message);
    await audit(req, actor(req), "support.start", { type: "org", id: org.id, label: org.name, meta: { session: r.id, user: r.userName, minutes, reason: parsed.data.reason, mode: "read" } });
    ok(res, `Suporte aberto em outra aba como ${r.userName} (só leitura, ${minutes} min).`, { open: r.url });
  }),
);

masterRouter.post(
  "/suporte-sessoes/:id/encerrar",
  requireCap("support_enter"),
  h(async (req, res) => {
    const row = await prisma.supportSession.findUnique({ where: { id: String(req.params.id) }, include: { organization: { select: { id: true, name: true } } } });
    if (!row) return fail(res, 404, "Sessão não encontrada.");
    const ended = await endSupportSession(row.id, "master");
    if (ended) await audit(req, actor(req), "support.end", { type: "org", id: row.organization.id, label: row.organization.name, meta: { session: row.id } });
    ok(res, ended ? "Sessão de suporte encerrada. A aba sai na próxima tela." : "Essa sessão já tinha terminado.");
  }),
);

const assinaturaSchema = z.object({
  status: z.enum(["trial", "active", "past_due", "read_only", "suspended", "canceled"]),
  plan: planKey,
  cycle: z.enum(["monthly", "annual"]),
  price: z.union([z.literal(""), z.coerce.number().min(0).max(100000)]).optional(),
  trialEndsAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("")),
  currentPeriodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("")),
});

masterRouter.post(
  "/clientes/:id/assinatura",
  requireCap("billing_manage"),
  requireStepUp,
  h(async (req, res) => {
    const org = await orgOr404(req, res);
    if (!org) return;
    const parsed = assinaturaSchema.safeParse(req.body);
    if (!parsed.success) return fail(res, 400, "Confira status, plano e datas.");
    const custom =
      parsed.data.price === "" || parsed.data.price == null ? null : Math.round(Number(parsed.data.price) * 100);
    const listPrice = cyclePriceCents({
      plan: parsed.data.plan,
      billingCycle: parsed.data.cycle,
      planPriceCents: null,
    });
    const planPriceCents = custom != null && custom !== listPrice ? custom : null;
    const trialEndsAt = parsed.data.trialEndsAt
      ? new Date(`${parsed.data.trialEndsAt}T12:00:00Z`)
      : null;
    const currentPeriodEnd = parsed.data.currentPeriodEnd
      ? new Date(`${parsed.data.currentPeriodEnd}T12:00:00Z`)
      : null;
    const data: Record<string, unknown> = {
      status: parsed.data.status,
      plan: parsed.data.plan,
      billingCycle: parsed.data.cycle,
      planPriceCents,
      trialEndsAt: parsed.data.status === "trial" ? trialEndsAt || org.trialEndsAt : trialEndsAt,
      currentPeriodEnd:
        parsed.data.status === "trial" ? currentPeriodEnd : currentPeriodEnd || org.currentPeriodEnd,
    };
    if (parsed.data.status === "suspended" && org.status !== "suspended") {
      data.suspendedAt = new Date();
    }
    if (parsed.data.status !== "suspended") data.suspendedAt = null;
    if (parsed.data.status === "canceled" && org.status !== "canceled") {
      data.canceledAt = new Date();
    }
    if (parsed.data.status !== "canceled") {
      data.canceledAt = null;
      data.cancelReason = null;
    }
    data.readOnlySince = parsed.data.status === "read_only" ? org.readOnlySince ?? new Date() : null;
    await prisma.organization.update({ where: { id: org.id }, data });
    if (parsed.data.status === "suspended" || parsed.data.status === "canceled") {
      await endOrgSessions(org.id);
    }
    await audit(
      req,
      actor(req),
      "tenant.subscription",
      {
        type: "organization",
        id: org.id,
        label: org.name,
        meta: {
          from: {
            status: org.status,
            plan: org.plan,
            cycle: org.billingCycle,
            priceCents: org.planPriceCents,
            trialEndsAt: org.trialEndsAt?.toISOString() ?? null,
            currentPeriodEnd: org.currentPeriodEnd?.toISOString() ?? null,
          },
          to: {
            status: parsed.data.status,
            plan: parsed.data.plan,
            cycle: parsed.data.cycle,
            priceCents: planPriceCents,
            trialEndsAt: trialEndsAt?.toISOString() ?? null,
            currentPeriodEnd: currentPeriodEnd?.toISOString() ?? null,
          },
        },
      },
      true,
    );
    ok(res, `Assinatura de ${org.name} atualizada.`);
  }),
);

async function orgOr404(req: MasterRequest, res: Response) {
  const org = await prisma.organization.findUnique({ where: { id: String(req.params.id) } });
  if (!org) fail(res, 404, "Empresa não encontrada.", "not_found");
  return org;
}

const extendSchema = z.object({
  days: z.coerce.number().int().min(1).max(366).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("")),
  reason: z.string().trim().max(120).default(""),
  notify: z.union([z.literal("on"), z.literal("1"), z.literal("true")]).optional(),
});

masterRouter.post(
  "/clientes/:id/prorrogar",
  requireCap("billing_manage"),
  h(async (req, res) => {
    const org = await orgOr404(req, res);
    if (!org) return;
    const parsed = extendSchema.safeParse(req.body);
    if (!parsed.success || (!parsed.data.days && !parsed.data.date)) return fail(res, 400, "Escolha quantos dias ou uma data.");
    if (org.status === "canceled") return fail(res, 400, "Empresa cancelada não tem vencimento.");
    const field = org.status === "trial" ? "trialEndsAt" : "currentPeriodEnd";
    const current = org[field];
    let next: Date;
    if (parsed.data.date) next = new Date(`${parsed.data.date}T12:00:00Z`);
    else {
      const base = current && daysUntil(current)! > 0 ? current : dayFromToday(0);
      next = new Date(base.getTime() + parsed.data.days! * 86_400_000);
    }
    if (daysUntil(next)! < 0) return fail(res, 400, "A nova data não pode estar no passado.");
    const data: Record<string, unknown> = { [field]: next };
    if (org.status === "past_due") data.status = "active";
    await prisma.organization.update({ where: { id: org.id }, data });
    const reason = parsed.data.reason || "sem motivo";
    await audit(req, actor(req), current ? "tenant.extend" : "tenant.set_due_date", {
      type: "organization",
      id: org.id,
      label: org.name,
      meta: { field, from: current?.toISOString() ?? null, to: next.toISOString(), reason },
    });
    if (parsed.data.notify) {
      const owner = (await loadOrg(org.id))?.ownerEmail;
      if (owner) {
        const full = await loadOrg(org.id);
        await sendPlatformEmail(org.status === "trial" ? "trial_extended" : "due_date_changed", {
          to: owner,
          organizationId: org.id,
          vars: { name: firstName(full?.ownerName && full.ownerName !== "—" ? full.ownerName : "there"), company: org.name, date: dateVar(next) },
        }).catch(() => undefined);
      }
    }
    ok(res, `${org.name}: novo vencimento ${shortDate(next)}${parsed.data.notify ? ". Dono avisado por e-mail." : "."}`);
  }),
);

const paymentSchema = z.object({
  amount: z.coerce.number().positive().max(100000),
  method: z.enum(["card", "ach", "zelle", "check", "cash", "other"]).default("card"),
  paidAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  note: z.string().trim().max(300).optional(),
});

masterRouter.post(
  "/clientes/:id/pagamento",
  requireCap("billing_manage"),
  h(async (req, res) => {
    const org = await orgOr404(req, res);
    if (!org) return;
    const parsed = paymentSchema.safeParse(req.body);
    if (!parsed.success) return fail(res, 400, "Confira valor e data do pagamento.");
    if (org.status === "canceled") return fail(res, 400, "Reative a empresa antes de registrar pagamento.");
    const amountCents = Math.round(parsed.data.amount * 100);
    const periodStart = org.currentPeriodEnd && org.currentPeriodEnd > new Date() ? org.currentPeriodEnd : dayFromToday(0);
    const periodEnd = addCycle(periodStart, org.billingCycle);
    const wasSuspended = org.status === "suspended";
    await prisma.$transaction([
      prisma.platformPayment.create({
        data: {
          organizationId: org.id,
          amountCents,
          paidAt: new Date(`${parsed.data.paidAt}T12:00:00Z`),
          method: parsed.data.method,
          periodStart,
          periodEnd,
          note: parsed.data.note || null,
          recordedById: req.master!.id,
        },
      }),
      prisma.organization.update({
        where: { id: org.id },
        data: { status: "active", currentPeriodEnd: periodEnd, suspendedAt: null },
      }),
    ]);
    await audit(req, actor(req), "payment.record", {
      type: "organization",
      id: org.id,
      label: org.name,
      meta: { amountCents, method: parsed.data.method, periodEnd: periodEnd.toISOString(), reactivated: wasSuspended },
    });
    ok(res, `${money(amountCents)} registrado. ${org.name} renova em ${shortDate(periodEnd)}${wasSuspended ? " e voltou a ter acesso" : ""}.`);
  }),
);

const planSchema = z.object({
  plan: planKey,
  cycle: z.enum(["monthly", "annual"]),
  price: z.union([z.literal(""), z.coerce.number().min(0).max(100000)]).optional(),
});

masterRouter.post(
  "/clientes/:id/plano",
  requireCap("billing_manage"),
  h(async (req, res) => {
    const org = await orgOr404(req, res);
    if (!org) return;
    const parsed = planSchema.safeParse(req.body);
    if (!parsed.success) return fail(res, 400, "Escolha plano e ciclo.");
    const custom = parsed.data.price === "" || parsed.data.price == null ? null : Math.round(Number(parsed.data.price) * 100);
    const listPrice = cyclePriceCents({ plan: parsed.data.plan, billingCycle: parsed.data.cycle, planPriceCents: null });
    const planPriceCents = custom != null && custom !== listPrice ? custom : null;
    await prisma.organization.update({ where: { id: org.id }, data: { plan: parsed.data.plan, billingCycle: parsed.data.cycle, planPriceCents } });
    let stripeNote = "";
    if (org.stripeSubscriptionId && stripeEnabled()) {
      try {
        await syncSubscriptionPrice(org.id);
        stripeNote = " Assinatura no Stripe atualizada (diferença proporcional na próxima fatura).";
      } catch (error) {
        console.error("[master] stripe plan sync failed", error);
        stripeNote = " Atenção: o Stripe não aceitou a mudança; confira a assinatura lá.";
      }
    }
    await audit(req, actor(req), "tenant.plan", {
      type: "organization",
      id: org.id,
      label: org.name,
      meta: { from: { plan: org.plan, cycle: org.billingCycle, priceCents: org.planPriceCents }, to: { plan: parsed.data.plan, cycle: parsed.data.cycle, priceCents: planPriceCents } },
    });
    const price = planPriceCents ?? listPrice;
    ok(res, `${org.name}: ${planLabel(parsed.data.plan)} ${parsed.data.cycle === "annual" ? "anual" : "mensal"} · ${money(price)}.${stripeNote}`);
  }),
);

const billingContactSchema = z.object({
  name: z.string().trim().max(120).optional(),
  email: z.union([z.literal(""), z.string().trim().email()]).optional(),
  phone: z.string().trim().max(40).optional(),
});

masterRouter.post(
  "/clientes/:id/faturamento",
  requireCap("billing_manage"),
  h(async (req, res) => {
    const org = await orgOr404(req, res);
    if (!org) return;
    const parsed = billingContactSchema.safeParse(req.body);
    if (!parsed.success) return fail(res, 400, "Confira o e-mail.");
    await prisma.organization.update({
      where: { id: org.id },
      data: {
        billingContactName: parsed.data.name || null,
        billingContactEmail: parsed.data.email || null,
        billingContactPhone: parsed.data.phone || null,
      },
    });
    await audit(req, actor(req), "tenant.billing_contact", { type: "organization", id: org.id, label: org.name });
    ok(res, "Contato do financeiro salvo.");
  }),
);

masterRouter.post(
  "/clientes/:id/nota",
  h(async (req, res) => {
    const org = await orgOr404(req, res);
    if (!org) return;
    const body = String(req.body?.body || "").trim().slice(0, 4000);
    if (!body) return fail(res, 400, "Escreva a nota.");
    await prisma.platformNote.create({ data: { organizationId: org.id, body, authorId: req.master!.id, authorName: req.master!.name } });
    ok(res, "Nota salva.");
  }),
);

masterRouter.post(
  "/clientes/:id/lembrete",
  requireCap("billing_manage"),
  h(async (req, res) => {
    const org = await loadOrg(String(req.params.id));
    if (!org) return fail(res, 404, "Empresa não encontrada.");
    const n = await sendReminder(org);
    if (!n) return fail(res, 400, "Essa empresa não tem e-mail de dono nem do financeiro.");
    await audit(req, actor(req), "tenant.reminder", { type: "organization", id: org.id, label: org.name });
    ok(res, `Lembrete enviado para ${org.billingContactEmail || org.ownerEmail}.`);
  }),
);

async function sendReminder(org: NonNullable<Awaited<ReturnType<typeof loadOrg>>>): Promise<number> {
  const to = org.billingContactEmail || org.ownerEmail;
  if (!to) return 0;
  const late = org.days != null && org.days < 0;
  const key = org.status === "trial" ? (late ? "trial_ended" : "trial_ending") : late ? "payment_overdue" : "renewal_soon";
  const left = Math.max(0, org.days ?? 0);
  const cycle = org.billingCycle === "annual";
  const amount = money(org.priceCents);
  const out = await sendPlatformEmail(key, {
    to,
    organizationId: org.id,
    vars: {
      name: org.billingContactEmail ? { en: "there", pt: "equipe" } : firstName(org.ownerName),
      company: org.name,
      date: org.due ? dateVar(org.due) : { en: "soon", pt: "em breve" },
      ends_in: left <= 1 ? { en: "tomorrow", pt: "amanhã" } : { en: `in ${left} days`, pt: `em ${left} dias` },
      link: workspacePage(org.slug),
      plan: planLabel(org.plan),
      price: { en: `${amount}/${cycle ? "year" : "month"}`, pt: `${amount}/${cycle ? "ano" : "mês"}` },
    },
  }).catch(() => null);
  return out && !out.skipped ? 1 : 0;
}

masterRouter.post(
  "/clientes/:id/suspender",
  requireCap("tenants_suspend"),
  requireStepUp,
  h(async (req, res) => {
    const org = await orgOr404(req, res);
    if (!org) return;
    if (org.status === "suspended") return fail(res, 400, "Já está suspensa.");
    await prisma.organization.update({ where: { id: org.id }, data: { status: "suspended", suspendedAt: new Date() } });
    const killed = await endOrgSessions(org.id);
    await audit(req, actor(req), "tenant.suspend", { type: "organization", id: org.id, label: org.name, meta: { from: org.status, sessionsEnded: killed, reason: String(req.body?.reason || "").slice(0, 200) } }, true);
    ok(res, `${org.name} suspensa. Usuários saíram do sistema; os dados ficam guardados.`, { warn: true });
  }),
);

masterRouter.post(
  "/clientes/:id/reativar",
  requireCap("tenants_suspend"),
  requireStepUp,
  h(async (req, res) => {
    const org = await orgOr404(req, res);
    if (!org) return;
    if (org.status !== "suspended" && org.status !== "canceled") return fail(res, 400, "A empresa já está ativa.");
    const due = org.currentPeriodEnd;
    const status = due && daysUntil(due)! >= 0 ? "active" : org.trialEndsAt && !org.currentPeriodEnd ? "trial" : "past_due";
    await prisma.organization.update({ where: { id: org.id }, data: { status, suspendedAt: null, canceledAt: null, cancelReason: null } });
    await audit(req, actor(req), "tenant.reactivate", { type: "organization", id: org.id, label: org.name, meta: { from: org.status, to: status } }, true);
    ok(res, `${org.name} reativada${status === "past_due" ? " (pagamento continua pendente)" : ""}.`);
  }),
);

masterRouter.post(
  "/clientes/:id/link-pagamento",
  requireCap("billing_manage"),
  h(async (req, res) => {
    const org = await loadOrg(String(req.params.id));
    if (!org) return fail(res, 404, "Empresa não encontrada.");
    if (!stripeEnabled()) return fail(res, 503, "Stripe não configurado (falta STRIPE_SECRET_KEY no Railway).");
    let url: string;
    try {
      url = await createCheckoutUrl(org.id, { createdBy: `master:${req.master!.email}` });
    } catch (error) {
      if (error instanceof BillingError) return fail(res, 409, error.message);
      console.error("[master] checkout failed", error);
      return fail(res, 502, "O Stripe não respondeu. Tente de novo.");
    }
    const to = org.billingContactEmail || org.ownerEmail;
    if (to && req.body?.send !== "0") {
      const cycle = org.billingCycle === "annual";
      const amount = money(org.priceCents);
      await sendPlatformEmail("payment_link", {
        to,
        organizationId: org.id,
        vars: {
          name: org.billingContactEmail && to === org.billingContactEmail ? { en: "there", pt: "equipe" } : firstName(org.ownerName),
          company: org.name,
          plan: planLabel(org.plan),
          price: { en: `${amount}/${cycle ? "year" : "month"}`, pt: `${amount}/${cycle ? "ano" : "mês"}` },
          link: url,
        },
      }).catch(() => undefined);
    }
    await audit(req, actor(req), "billing.checkout_link", { type: "organization", id: org.id, label: org.name, meta: { emailedTo: to || null } });
    ok(res, to ? `Link de pagamento enviado para ${to}.` : "Link de pagamento criado.", {
      reveal: { title: "Link de pagamento (Stripe)", value: url, note: "Vale 24 horas. Ao pagar, a empresa fica ativa sozinha." },
    });
  }),
);

masterRouter.post(
  "/clientes/:id/cobrar",
  requireCap("billing_manage"),
  h(async (req, res) => {
    const org = await orgOr404(req, res);
    if (!org) return;
    if (!stripeEnabled()) return fail(res, 503, "Stripe não configurado.");
    try {
      const r = await payOpenInvoice(org.id);
      await audit(req, actor(req), "billing.charge_now", { type: "organization", id: org.id, label: org.name, meta: r });
      if (!r.paid) return fail(res, 402, r.message);
      ok(res, `${org.name}: ${r.message} A empresa volta a ficar ativa em instantes.`);
    } catch (error) {
      console.error("[master] charge failed", error);
      fail(res, 502, "O Stripe não respondeu. Tente de novo.");
    }
  }),
);

masterRouter.post(
  "/clientes/:id/somente-leitura",
  requireCap("tenants_suspend"),
  requireStepUp,
  h(async (req, res) => {
    const org = await orgOr404(req, res);
    if (!org) return;
    const on = req.body?.on !== "0";
    if (on) {
      if (["read_only", "suspended", "canceled"].includes(org.status)) return fail(res, 400, "A empresa já está sem acesso de escrita.");
      await prisma.organization.update({ where: { id: org.id }, data: { status: "read_only", readOnlySince: new Date() } });
    } else {
      if (org.status !== "read_only") return fail(res, 400, "A empresa não está em só leitura.");
      const back = org.currentPeriodEnd && daysUntil(org.currentPeriodEnd)! >= 0 ? "active" : !org.currentPeriodEnd && org.trialEndsAt ? "trial" : "past_due";
      await prisma.organization.update({ where: { id: org.id }, data: { status: back, readOnlySince: null } });
    }
    await audit(req, actor(req), on ? "tenant.read_only" : "tenant.read_only_off", { type: "organization", id: org.id, label: org.name, meta: { from: org.status } }, true);
    ok(res, on ? `${org.name} em só leitura: vê tudo, não cria nem edita.` : `${org.name} voltou a poder editar.`, { warn: on });
  }),
);

masterRouter.post(
  "/clientes/:id/pausar-regua",
  requireCap("billing_manage"),
  h(async (req, res) => {
    const org = await orgOr404(req, res);
    if (!org) return;
    const days = Math.min(30, Math.max(0, Number(req.body?.days ?? 14) || 0));
    const until = days ? dayFromToday(days) : null;
    await prisma.organization.update({ where: { id: org.id }, data: { dunningPausedUntil: until } });
    await audit(req, actor(req), days ? "ladder.pause" : "ladder.resume", { type: "organization", id: org.id, label: org.name, meta: { until: until?.toISOString() ?? null } });
    ok(res, days ? `Cobrança automática pausada para ${org.name} até ${shortDate(until)}.` : `Cobrança automática retomada para ${org.name}.`);
  }),
);

masterRouter.post(
  "/clientes/:id/cancelar",
  requireCap("tenants_suspend"),
  requireStepUp,
  h(async (req, res) => {
    const org = await orgOr404(req, res);
    if (!org) return;
    const reason = String(req.body?.reason || "").trim().slice(0, 200);
    if (String(req.body?.confirm || "").trim().toLowerCase() !== org.slug.toLowerCase()) {
      return fail(res, 400, `Digite ${org.slug} para confirmar.`);
    }
    let stripeNote = "";
    if (org.stripeSubscriptionId && stripeEnabled()) {
      try {
        await cancelSubscription(org.id, false);
        stripeNote = " A assinatura no Stripe também foi cancelada (sem novas cobranças).";
      } catch (error) {
        console.error("[master] stripe cancel failed", error);
        return fail(res, 502, "O Stripe não cancelou a assinatura. Nada foi alterado; tente de novo.");
      }
    }
    const reasonKey = REASON_LABEL[String(req.body?.reasonKey || "")] ? String(req.body.reasonKey) : "other";
    await prisma.organization.update({ where: { id: org.id }, data: { status: "canceled", canceledAt: new Date(), cancelReason: `${REASON_LABEL[reasonKey]}${reason ? `: ${reason}` : ""}`, cancelReasonKey: reasonKey, cancelAtPeriodEnd: false } });
    if (!org.cancelRequestedAt) await recordMasterCancel(org, reasonKey, reason || null, req.master!.name);
    const killed = await endOrgSessions(org.id);
    await audit(req, actor(req), "tenant.cancel", { type: "organization", id: org.id, label: org.name, meta: { from: org.status, reason, sessionsEnded: killed, stripe: !!stripeNote } }, true);
    ok(res, `${org.name} cancelada.${stripeNote}`, { warn: true });
  }),
);

// ---------------------------------------------------------------------------
// Usuários (todas as empresas)
// ---------------------------------------------------------------------------

const USER_FILTERS: [string, string, (u: Awaited<ReturnType<typeof loadUsers>>[number]) => boolean][] = [
  ["todos", "Todos", () => true],
  ["admins", "Admins", (u) => u.isAdmin],
  ["online", "Com sessão aberta", (u) => u.sessions > 0],
  ["convidados", "Convites pendentes", (u) => u.status === "invited"],
  ["bloqueados", "Bloqueados", (u) => u.status === "suspended"],
  ["senha", "Com senha temporária", (u) => u.mustChangePassword],
];

masterRouter.get(
  "/usuarios",
  h(async (req, res) => {
    const users = await loadUsers();
    const filter = USER_FILTERS.find((f) => f[0] === req.query.filtro) ?? USER_FILTERS[0];
    const q = String(req.query.q || "").trim().toLowerCase();
    const rows = users.filter(filter[2]).filter((u) => !q || `${u.name} ${u.email} ${u.orgName}`.toLowerCase().includes(q));
    const orgCount = new Set(users.map((u) => u.organizationId)).size;
    const orgsForCreate = can(req.master!.role, "users_manage")
      ? await prisma.organization.findMany({
          where: { status: { not: "canceled" } },
          select: { id: true, name: true, slug: true },
          orderBy: { name: "asc" },
          take: 500,
        })
      : [];
    page(res, "usuarios", await shell(req, "usuarios"), {
      rows,
      q: String(req.query.q || ""),
      filter: filter[0],
      filters: USER_FILTERS.map((f) => ({ key: f[0], label: f[1], count: users.filter(f[2]).length })),
      sub: `${users.length} usuário(s) em ${orgCount} empresa(s) · ${users.filter((u) => u.sessions > 0).length} com sessão aberta`,
      canManage: can(req.master!.role, "users_manage"),
      orgsForCreate,
    });
  }),
);

const createUserSchema = z.object({
  organizationId: z.string().uuid(),
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(200),
  roleId: z.string().uuid(),
  ignoreLimit: z.string().optional(),
});

masterRouter.post(
  "/usuarios",
  requireCap("users_manage"),
  requireStepUp,
  h(async (req, res) => {
    const parsed = createUserSchema.safeParse(req.body);
    if (!parsed.success) return fail(res, 400, "Confira empresa, nome, e-mail e papel.");
    const org = await prisma.organization.findUnique({
      where: { id: parsed.data.organizationId },
      select: { id: true, name: true, status: true },
    });
    if (!org) return fail(res, 404, "Empresa não encontrada.");
    if (org.status === "canceled") return fail(res, 400, "Reative a empresa antes de cadastrar usuários.");
    const role = await prisma.role.findFirst({
      where: { id: parsed.data.roleId, organizationId: org.id },
      select: { id: true, name: true, key: true },
    });
    if (!role) return fail(res, 400, "Papel inválido para essa empresa.");
    const email = parsed.data.email.toLowerCase();
    const taken = await prisma.user.findFirst({
      where: { email, organizationId: org.id },
      select: { id: true },
    });
    if (taken) return fail(res, 409, "Já existe um usuário com esse e-mail nesta empresa.");
    const userLimit = await checkLimit(org.id, "users", 1);
    const overLimit = !userLimit.ok;
    if (overLimit && parsed.data.ignoreLimit !== "1") {
      return fail(res, 409, `${org.name} já usa ${userLimit.used} de ${userLimit.limit} usuários do plano. Marque "Cadastrar mesmo passando do limite" para continuar.`);
    }
    const temp = makeTempPassword();
    const user = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_tenant_id', ${org.id}, true)`;
      return tx.user.create({
        data: {
          organizationId: org.id,
          email,
          name: formatPersonName(parsed.data.name),
          passwordHash: await hashPassword(temp),
          roleId: role.id,
          status: "active",
          mustChangePassword: true,
        },
      });
    });
    await audit(
      req,
      actor(req),
      "user.create",
      {
        type: "user",
        id: user.id,
        label: `${user.name} · ${org.name}`,
        meta: { email, role: role.key, organizationId: org.id, ...(overLimit ? { overLimit: `${userLimit.used}/${userLimit.limit}` } : {}) },
      },
      true,
    );
    ok(res, `${user.name} cadastrado em ${org.name}.`, {
      redirect: `/master/usuarios/${user.id}`,
      reveal: {
        title: `Senha temporária · ${user.name}`,
        value: temp,
        note: `Passe para ${email} por um canal seguro. No primeiro acesso o sistema pede uma senha nova. Ela não aparece de novo.`,
      },
    });
  }),
);

masterRouter.get(
  "/usuarios/:id",
  h(async (req, res) => {
    const [u] = await loadUsers({ id: String(req.params.id) });
    if (!u) return void res.status(404).render("master/error", { title: "Usuário não encontrado", message: "Esse usuário não existe." });
    const org = await loadOrg(u.organizationId);
    const lastAudit = await prisma.platformAuditLog.findMany({ where: { targetType: "user", targetId: u.id }, orderBy: { at: "desc" }, take: 5 });
    const data = {
      u,
      org,
      lastAudit,
      canManage: can(req.master!.role, "users_manage"),
      canSupport: can(req.master!.role, "support_enter") && !!org && org.status !== "suspended" && org.status !== "canceled",
      supportSessions: await supportSessionsFor({ userId: u.id }, 4),
      logins: (await loginHistory({ userId: u.id }, 50)).map((l) => ({ ...l, whenText: dateTimeLabel(l.when) })),
      loginFails: await prisma.loginEvent.count({ where: { userId: u.id, success: false, createdAt: { gte: new Date(Date.now() - 7 * 86400e3) } } }),
      showAllLogins: req.query.logins === "todos",
    };
    if (req.query.partial) return void res.render("master/_usuario", { ...data, partial: true });
    page(res, "usuario", await shell(req, "usuarios"), { ...data, partial: false });
  }),
);

async function userOr404(req: MasterRequest, res: Response) {
  const u = await prisma.user.findUnique({ where: { id: String(req.params.id) }, include: { organization: { select: { name: true } } } });
  if (!u) fail(res, 404, "Usuário não encontrado.", "not_found");
  return u;
}

masterRouter.post(
  "/usuarios/:id/bloquear",
  requireCap("users_manage"),
  requireStepUp,
  h(async (req, res) => {
    const u = await userOr404(req, res);
    if (!u) return;
    await prisma.user.update({ where: { id: u.id }, data: { status: "suspended" } });
    const ended = await endUserSessions([u.id]);
    await audit(req, actor(req), "user.block", { type: "user", id: u.id, label: `${u.name} · ${u.organization.name}`, meta: { sessionsEnded: ended } }, true);
    ok(res, `${u.name} bloqueado. Sessões encerradas.`, { warn: true });
  }),
);

masterRouter.post(
  "/usuarios/:id/desbloquear",
  requireCap("users_manage"),
  h(async (req, res) => {
    const u = await userOr404(req, res);
    if (!u) return;
    await prisma.user.update({ where: { id: u.id }, data: { status: "active" } });
    await audit(req, actor(req), "user.unblock", { type: "user", id: u.id, label: `${u.name} · ${u.organization.name}` });
    ok(res, `${u.name} desbloqueado.`);
  }),
);

masterRouter.post(
  "/usuarios/:id/encerrar-sessoes",
  requireCap("users_manage"),
  h(async (req, res) => {
    const u = await userOr404(req, res);
    if (!u) return;
    const ended = await endUserSessions([u.id]);
    await audit(req, actor(req), "user.end_sessions", { type: "user", id: u.id, label: `${u.name} · ${u.organization.name}`, meta: { sessionsEnded: ended } });
    ok(res, ended ? `${ended} sessão(ões) de ${u.name} encerrada(s).` : `${u.name} não tinha sessão aberta.`);
  }),
);

masterRouter.post(
  "/usuarios/:id/senha-temporaria",
  requireCap("users_manage"),
  requireStepUp,
  h(async (req, res) => {
    const u = await userOr404(req, res);
    if (!u) return;
    const temp = makeTempPassword();
    await prisma.user.update({ where: { id: u.id }, data: { passwordHash: await hashPassword(temp), mustChangePassword: true } });
    await endUserSessions([u.id]);
    await audit(req, actor(req), "user.temp_password", { type: "user", id: u.id, label: `${u.name} · ${u.organization.name}` }, true);
    ok(res, "Senha temporária criada.", {
      reveal: {
        title: `Senha temporária de ${u.name}`,
        value: temp,
        note: `Passe para ${u.email} por um canal seguro. No primeiro acesso o sistema pede uma senha nova. Ela não aparece de novo.`,
      },
    });
  }),
);

masterRouter.post(
  "/usuarios/lote",
  requireCap("users_manage"),
  h(async (req, res) => {
    const raw = req.body?.ids;
    const ids = (Array.isArray(raw) ? raw : String(raw || "").split(",")).map(String).filter((s) => /^[0-9a-f-]{36}$/i.test(s)).slice(0, 500);
    const action = String(req.body?.action || "");
    if (!ids.length) return fail(res, 400, "Selecione pelo menos um usuário.");
    if (action === "sessions") {
      const ended = await endUserSessions(ids);
      await audit(req, actor(req), "user.bulk_end_sessions", { type: "user", label: `${ids.length} usuário(s)`, meta: { ids, sessionsEnded: ended } });
      return ok(res, `Sessões encerradas para ${ids.length} usuário(s).`);
    }
    if (action === "block") {
      if (!isFreshStepUp(req)) return fail(res, 428, "Confirme com o código do autenticador.", "step_up_required");
      await prisma.user.updateMany({ where: { id: { in: ids } }, data: { status: "suspended" } });
      await endUserSessions(ids);
      await audit(req, actor(req), "user.bulk_block", { type: "user", label: `${ids.length} usuário(s)`, meta: { ids } }, true);
      return ok(res, `${ids.length} usuário(s) bloqueado(s).`, { warn: true });
    }
    if (action === "unblock") {
      await prisma.user.updateMany({ where: { id: { in: ids }, status: "suspended" }, data: { status: "active" } });
      await audit(req, actor(req), "user.bulk_unblock", { type: "user", label: `${ids.length} usuário(s)`, meta: { ids } });
      return ok(res, `${ids.length} usuário(s) desbloqueado(s).`);
    }
    fail(res, 400, "Ação desconhecida.");
  }),
);

// ---------------------------------------------------------------------------
// Contatos
// ---------------------------------------------------------------------------

masterRouter.get(
  "/contatos",
  h(async (req, res) => {
    const orgs = (await loadOrgs()).filter((o) => o.status !== "canceled" || req.query.filtro === "todos");
    const logs = await prisma.platformContactLog.findMany({ orderBy: { createdAt: "desc" }, take: 1000 });
    const byOrg = new Map<string, typeof logs>();
    for (const l of logs) {
      const arr = byOrg.get(l.organizationId) ?? [];
      arr.push(l);
      byOrg.set(l.organizationId, arr);
    }
    type Contact = { key: string; orgId: string; role: "owner" | "billing"; roleLabel: string; name: string; email: string; phone: string; org: (typeof orgs)[number]; last: Date | null; initials: string; avatarBg: string };
    const contacts: Contact[] = [];
    for (const o of orgs) {
      const lastOf = (role: string) => (byOrg.get(o.id) ?? []).find((l) => l.contactRole === role)?.createdAt ?? null;
      if (o.owner || o.ownerEmail) contacts.push({ key: `${o.id}:owner`, orgId: o.id, role: "owner", roleLabel: "Dono", name: o.ownerName, email: o.ownerEmail, phone: o.ownerPhone, org: o, last: lastOf("owner"), initials: initials(o.ownerName), avatarBg: avatarBg(o.id) });
      if (o.billingContactName || o.billingContactEmail) {
        const n = o.billingContactName || o.billingContactEmail || "Financeiro";
        contacts.push({ key: `${o.id}:billing`, orgId: o.id, role: "billing", roleLabel: "Financeiro", name: n, email: o.billingContactEmail || "", phone: o.billingContactPhone || "", org: o, last: lastOf("billing"), initials: initials(n), avatarBg: avatarBg(o.id + "b") });
      }
    }
    const filters: [string, string, (c: Contact) => boolean][] = [
      ["todos", "Todos", () => true],
      ["donos", "Donos", (c) => c.role === "owner"],
      ["financeiro", "Financeiro", (c) => c.role === "billing"],
      ["sem-conversa", "Sem conversa registrada", (c) => !c.last],
    ];
    const f = filters.find((x) => x[0] === req.query.filtro) ?? filters[0];
    const q = String(req.query.q || "").trim().toLowerCase();
    const rows = contacts.filter(f[2]).filter((c) => !q || `${c.name} ${c.email} ${c.phone} ${c.org.name}`.toLowerCase().includes(q));
    const selKey = String(req.query.c || rows[0]?.key || "");
    const sel = contacts.find((c) => c.key === selKey) ?? rows[0] ?? null;
    page(res, "contatos", await shell(req, "contatos"), {
      rows,
      sel,
      selLog: sel ? (byOrg.get(sel.orgId) ?? []).slice(0, 30) : [],
      q: String(req.query.q || ""),
      filter: f[0],
      filters: filters.map((x) => ({ key: x[0], label: x[1], count: contacts.filter(x[2]).length })),
    });
  }),
);

const contactLogSchema = z.object({
  role: z.enum(["owner", "billing"]).default("owner"),
  name: z.string().trim().min(1).max(120),
  kind: z.enum(["call", "email", "whatsapp", "meeting"]),
  summary: z.string().trim().min(1).max(4000),
});

masterRouter.post(
  "/contatos/:id/registro",
  h(async (req, res) => {
    const org = await orgOr404(req, res);
    if (!org) return;
    const parsed = contactLogSchema.safeParse(req.body);
    if (!parsed.success) return fail(res, 400, "Escreva um resumo da conversa.");
    await prisma.platformContactLog.create({
      data: { organizationId: org.id, contactRole: parsed.data.role, contactName: parsed.data.name, kind: parsed.data.kind, summary: parsed.data.summary, authorId: req.master!.id, authorName: req.master!.name },
    });
    await audit(req, actor(req), "contact.log", { type: "organization", id: org.id, label: `${parsed.data.name} · ${org.name}`, meta: { kind: parsed.data.kind } });
    ok(res, "Conversa registrada.");
  }),
);

// ---------------------------------------------------------------------------
// Planos e preços
// ---------------------------------------------------------------------------

masterRouter.get(
  "/planos",
  requireCap("billing_full"),
  h(async (req, res) => {
    const [catalog, orgs] = await Promise.all([refreshPlans(), loadOrgs()]);
    const rows = catalog.map((p) => {
      const mine = orgs.filter((o) => o.plan === p.key && o.status !== "canceled");
      const paying = mine.filter((o) => o.status === "active" || o.status === "past_due");
      return {
        ...p,
        monthlyText: money(p.monthlyCents),
        annualText: money(p.annualCents),
        annualSaving: p.monthlyCents * 12 - p.annualCents,
        usersText: p.includedUsers == null ? "Usuários ilimitados" : `Até ${p.includedUsers} usuários`,
        payingCount: paying.length,
        trialCount: mine.filter((o) => o.status === "trial").length,
        specialCount: paying.filter((o) => o.planPriceCents != null).length,
        mrr: money(paying.reduce((a, o) => a + o.monthlyCents, 0)),
        monthlyDollars: (p.monthlyCents / 100).toFixed(2),
        annualDollars: (p.annualCents / 100).toFixed(2),
      };
    });
    page(res, "planos", await shell(req, "planos"), {
      rows,
      canEdit: can(req.master!.role, "plans_manage"),
      stripeOn: stripeEnabled(),
    });
  }),
);

const planEditSchema = z.object({
  name: z.string().trim().min(2).max(40),
  description: z.string().trim().max(160).optional().default(""),
  monthly: z.coerce.number().min(0).max(100000),
  annual: z.coerce.number().min(0).max(1000000),
  includedUsers: z.union([z.literal(""), z.coerce.number().int().min(1).max(10000)]).optional(),
  trialDays: z.coerce.number().int().min(0).max(120),
  visible: z.string().optional(),
  active: z.string().optional(),
  grandfather: z.string().optional(),
});

masterRouter.post(
  "/planos/:key",
  requireCap("plans_manage"),
  requireStepUp,
  h(async (req, res) => {
    const isNew = String(req.params.key) === "novo";
    const key = String(isNew ? req.body?.key || "" : req.params.key).trim().toLowerCase();
    const parsed = planEditSchema.safeParse(req.body);
    if (!parsed.success) return fail(res, 400, "Confira nome, preços e dias de teste.");
    const d = parsed.data;
    const data = {
      name: d.name,
      description: d.description || null,
      monthlyCents: Math.round(d.monthly * 100),
      annualCents: Math.round(d.annual * 100),
      includedUsers: d.includedUsers === "" || d.includedUsers == null ? null : Number(d.includedUsers),
      trialDays: d.trialDays,
      visible: !!d.visible,
      active: !!d.active,
    };
    const existing = await prisma.plan.findUnique({ where: { key } });
    if (isNew && existing) return fail(res, 409, "Já existe um plano com esse código.");
    if (!existing) {
      if (!/^[a-z][a-z0-9-]{1,30}$/.test(key)) return fail(res, 400, "Código do plano: letras minúsculas, números e hífen.");
      const last = await prisma.plan.findFirst({ orderBy: { sortOrder: "desc" } });
      await prisma.plan.create({ data: { key, ...data, sortOrder: (last?.sortOrder ?? 0) + 1 } });
      await refreshPlans();
      await audit(req, actor(req), "plan.create", { type: "plan", id: key, label: data.name, meta: data }, true);
      return ok(res, `Plano ${data.name} criado.`);
    }
    const monthlyChanged = existing.monthlyCents !== data.monthlyCents;
    const annualChanged = existing.annualCents !== data.annualCents;
    let kept = 0;
    if ((monthlyChanged || annualChanged) && d.grandfather) {
      // Companies already paying keep what they pay today.
      const payers = await prisma.organization.findMany({
        where: { plan: key, planPriceCents: null, status: { in: ["active", "past_due", "read_only", "suspended"] } },
        select: { id: true, billingCycle: true },
      });
      for (const o of payers) {
        const old = o.billingCycle === "annual" ? existing.annualCents : existing.monthlyCents;
        const changed = o.billingCycle === "annual" ? annualChanged : monthlyChanged;
        if (!changed) continue;
        await prisma.organization.update({ where: { id: o.id }, data: { planPriceCents: old } });
        kept++;
      }
    }
    await prisma.plan.update({
      where: { key },
      data: {
        ...data,
        // A new price is a new Stripe price; the old one stays for current subscribers.
        stripeMonthlyPriceId: monthlyChanged ? null : existing.stripeMonthlyPriceId,
        stripeAnnualPriceId: annualChanged ? null : existing.stripeAnnualPriceId,
      },
    });
    await refreshPlans();
    await audit(req, actor(req), "plan.update", {
      type: "plan",
      id: key,
      label: data.name,
      meta: {
        from: { monthlyCents: existing.monthlyCents, annualCents: existing.annualCents, includedUsers: existing.includedUsers, trialDays: existing.trialDays, visible: existing.visible, active: existing.active },
        to: data,
        grandfathered: kept,
      },
    }, true);
    ok(res, `${data.name} salvo${kept ? `. ${kept} empresa(s) mantêm o preço antigo.` : "."}`);
  }),
);

// ---------------------------------------------------------------------------
// Pagamentos
// ---------------------------------------------------------------------------

masterRouter.get(
  "/pagamentos",
  requireCap("billing_full"),
  h(async (req, res) => {
    const tab = ["todos", "falhas", "estornados", "disputas", "previsao"].includes(String(req.query.aba)) ? String(req.query.aba) : "todos";
    const [all, orgs, disputes] = await Promise.all([loadPayments({}, 500), loadOrgs(), prisma.platformDispute.findMany({ orderBy: [{ closedAt: { sort: "desc", nulls: "first" } }, { evidenceDueBy: "asc" }], take: 100 })]);
    const openDisputes = disputes.filter((d) => OPEN_DISPUTE.includes(d.status));
    let previsao: Record<string, unknown> | null = null;
    if (tab === "previsao") {
      const rows = await forecast(90);
      const cards = await expiringCards();
      previsao = {
        buckets: forecastBuckets(rows).map((b) => ({ ...b, totalText: money(b.total), okText: money(b.ok), expiringText: money(b.expiring), noneText: money(b.none), okPct: b.total ? Math.round((b.ok / b.total) * 100) : 0, expPct: b.total ? Math.round((b.expiring / b.total) * 100) : 0 })),
        next: rows.filter((r) => r.date.getTime() <= Date.now() + 30 * 86400e3).map((r) => ({ ...r, dateText: shortDate(r.date), amountText: money(r.amountCents), kindText: r.kind === "first_charge" ? "1ª cobrança (fim do teste)" : "renovação" })),
        cards: cards.map((c) => ({ id: c.id, name: c.name, card: cardText(c), expText: shortDate(c.exp), nextText: c.next ? shortDate(c.next) : "—", amountText: money(c.amountCents), days: c.daysToExp })),
      };
    }
    const monthStart = startOfMonthInTz();
    const paidMonth = all.filter((p) => p.status === "paid" && p.paidAt >= monthStart);
    const failedOpen = all.filter((p) => p.status === "failed");
    const refunded30 = all.filter((p) => p.status === "refunded" && p.refundedAt && Date.now() - p.refundedAt.getTime() < 30 * 86_400_000);
    const late = orgs.filter((o) => o.overdue && o.status !== "trial");
    const mrr = orgs.filter((o) => o.status === "active" || o.status === "past_due").reduce((a, o) => a + o.monthlyCents, 0);
    page(res, "pagamentos", await shell(req, "pagamentos"), {
      rows: tab === "estornados" ? all.filter((p) => p.status === "refunded") : tab === "falhas" ? failedOpen : all,
      tab,
      previsao,
      disputes: disputes.map((d) => {
        const days = d.evidenceDueBy ? Math.ceil((d.evidenceDueBy.getTime() - Date.now()) / 86400e3) : null;
        return {
          id: d.id,
          org: d.organizationId ? { id: d.organizationId, name: d.orgName ?? "empresa" } : null,
          amountText: money(d.amountCents),
          reason: DISPUTE_REASON[d.reason] ?? d.reason,
          pill: DISPUTE_STATUS[d.status] ?? { label: d.status, tone: "muted" },
          open: OPEN_DISPUTE.includes(d.status),
          due: d.evidenceDueBy ? shortDate(d.evidenceDueBy) : "—",
          dueText: OPEN_DISPUTE.includes(d.status) && days != null ? (days < 0 ? "prazo passou" : days === 0 ? "prazo hoje" : `${days} dia(s) para responder`) : d.closedAt ? `encerrada ${shortDate(d.closedAt)}` : "",
          urgent: OPEN_DISPUTE.includes(d.status) && days != null && days <= 3,
          when: shortDate(d.createdAt),
          stripeUrl: `https://dashboard.stripe.com/${stripeMode() === "live" ? "" : "test/"}disputes/${d.id}`,
        };
      }),
      tabs: [
        { key: "todos", label: "Todos", count: all.length },
        { key: "falhas", label: "Cobranças recusadas", count: failedOpen.length },
        { key: "estornados", label: "Estornados", count: all.filter((p) => p.status === "refunded").length },
        { key: "disputas", label: "Disputas", count: openDisputes.length },
        { key: "previsao", label: "Previsão e cartões", count: null },
      ],
      stripe: { mode: stripeMode(), webhook: !!process.env.STRIPE_WEBHOOK_SECRET },
      canCharge: can(req.master!.role, "billing_manage"),
      kpis: [
        { label: "Recebido no mês", value: money(paidMonth.reduce((a, p) => a + p.amountCents, 0)), note: `${paidMonth.length} pagamento(s)` },
        { label: "MRR", value: money(mrr), note: "planos ativos" },
        { label: "Em atraso", value: money(late.reduce((a, o) => a + o.priceCents, 0)), note: `${late.length} empresa(s)`, danger: late.length > 0 },
        { label: "Estornado em 30 dias", value: money(refunded30.reduce((a, p) => a + p.amountCents, 0)), note: `${refunded30.length} pagamento(s)` },
      ],
      canRefund: can(req.master!.role, "refund"),
    });
  }),
);

masterRouter.post(
  "/pagamentos/:id/estornar",
  requireCap("refund"),
  requireStepUp,
  h(async (req, res) => {
    const p = await prisma.platformPayment.findUnique({ where: { id: String(req.params.id) }, include: { organization: { select: { name: true } } } });
    if (!p) return fail(res, 404, "Pagamento não encontrado.");
    if (p.status === "refunded") return fail(res, 400, "Já está estornado.");
    if (p.status !== "paid") return fail(res, 400, "Só pagamentos aprovados podem ser estornados.");
    const viaStripe = p.source === "stripe" && !!p.stripeChargeId;
    if (viaStripe) {
      if (!stripeEnabled()) return fail(res, 503, "Stripe não configurado neste servidor.");
      try {
        await refundCharge(p.stripeChargeId!);
      } catch (error) {
        console.error("[master] stripe refund failed", error);
        return fail(res, 502, `O Stripe recusou o estorno: ${error instanceof Error ? error.message : "erro"}`);
      }
    }
    await prisma.platformPayment.update({ where: { id: p.id }, data: { status: "refunded", refundedAt: new Date() } });
    await audit(req, actor(req), "payment.refund", { type: "organization", id: p.organizationId, label: p.organization.name, meta: { paymentId: p.id, amountCents: p.amountCents, viaStripe } }, true);
    ok(
      res,
      viaStripe
        ? `${money(p.amountCents)} estornado no cartão pelo Stripe. Cai em 5 a 10 dias.`
        : `${money(p.amountCents)} marcado como estornado. Devolva o valor no meio de pagamento usado (${METHOD_LABEL[p.method] ?? p.method}).`,
    );
  }),
);

// ---------------------------------------------------------------------------
// Vencimentos
// ---------------------------------------------------------------------------

masterRouter.get(
  "/vencimentos",
  h(async (req, res) => {
    const orgs = (await loadOrgs()).filter((o) => o.status !== "canceled");
    const dated = orgs.filter((o) => o.days != null && o.days <= 90).sort((a, b) => a.days! - b.days!);
    const buckets = [
      { key: "vencidos", title: "Vencidos", tone: "danger", list: dated.filter((o) => o.days! < 0) },
      { key: "7", title: "Próximos 7 dias", tone: "warn", list: dated.filter((o) => o.days! >= 0 && o.days! <= 7) },
      { key: "30", title: "8 a 30 dias", tone: "info", list: dated.filter((o) => o.days! > 7 && o.days! <= 30) },
      { key: "90", title: "31 a 90 dias", tone: "soft", list: dated.filter((o) => o.days! > 30) },
    ].map((b) => {
      const money$ = b.list.filter((o) => o.status !== "trial").reduce((a, o) => a + o.priceCents, 0);
      return { ...b, total: money$ ? `${money(money$)} em jogo` : b.list.length ? "só trials" : "nada previsto" };
    });
    const [ladder, lastRun, recentSteps] = await Promise.all([
      loadLadder(),
      prisma.jobRun.findFirst({ where: { name: BILLING_LADDER_JOB }, orderBy: { startedAt: "desc" } }),
      prisma.dunningStep.findMany({ where: { action: { not: "skipped" } }, orderBy: { sentAt: "desc" }, take: 8 }),
    ]);
    const orgName = new Map(orgs.map((o) => [o.id, o.name]));
    page(res, "vencimentos", await shell(req, "vencimentos"), {
      buckets,
      ladder,
      ladderSteps: ladderSteps(ladder),
      lastRun: lastRun
        ? { when: dateTimeLabel(lastRun.startedAt), ok: lastRun.ok, error: lastRun.error, detail: lastRun.detail as { emails?: number; changes?: { org: string; to: string }[] } | null }
        : null,
      recentSteps: recentSteps.map((st) => ({ when: dateTimeLabel(st.sentAt), org: orgName.get(st.organizationId) ?? "—", orgId: st.organizationId, action: st.action, detail: st.detail ?? st.step })),
      paused: orgs.filter((o) => o.dunningPausedUntil && o.dunningPausedUntil > new Date()).map((o) => ({ id: o.id, name: o.name, until: shortDate(o.dunningPausedUntil) })),
      canLadder: can(req.master!.role, "plans_manage"),
      noDate: orgs.filter((o) => o.days == null),
      canBilling: can(req.master!.role, "billing_manage"),
      showMoney: can(req.master!.role, "billing_full"),
    });
  }),
);

masterRouter.post(
  "/vencimentos/lembrar",
  requireCap("billing_manage"),
  h(async (req, res) => {
    const raw = req.body?.ids;
    const ids = (Array.isArray(raw) ? raw : String(raw || "").split(",")).map(String).filter(Boolean).slice(0, 200);
    let sent = 0;
    for (const id of ids) {
      const org = await loadOrg(id);
      if (org) sent += await sendReminder(org);
    }
    await audit(req, actor(req), "tenant.bulk_reminder", { type: "organization", label: `${sent} empresa(s)`, meta: { ids } });
    ok(res, `Lembrete enviado para ${sent} empresa(s).`);
  }),
);

masterRouter.post(
  "/vencimentos/regua/rodar",
  requireCap("plans_manage"),
  h(async (req, res) => {
    const r = await runJob(BILLING_LADDER_JOB, "manual", () => runBillingLadder());
    await audit(req, actor(req), "ladder.run", { type: "job", label: BILLING_LADDER_JOB, meta: r });
    ok(res, `Régua rodou: ${r.checked} empresa(s) conferida(s), ${r.emails} e-mail(s), ${r.changes.length} mudança(s) de estado.`);
  }),
);

const ladderSchema = z.object({
  enabled: z.string().optional(),
  trialReminders: z.string().default(""),
  renewReminders: z.string().default(""),
  pastDueAt: z.coerce.number().int().min(0).max(30),
  overdueReminders: z.string().default(""),
  readOnlyAt: z.coerce.number().int().min(1).max(60),
  suspendAt: z.coerce.number().int().min(1).max(120),
  cancelAt: z.coerce.number().int().min(7).max(365),
  stripeGraceDays: z.coerce.number().int().min(0).max(14),
});

const dayList = (v: string) =>
  Array.from(new Set(v.split(/[\s,;]+/).map((x) => Number(x)).filter((n) => Number.isInteger(n) && n > 0 && n <= 60))).sort((a, b) => b - a);

masterRouter.post(
  "/vencimentos/regua",
  requireCap("plans_manage"),
  h(async (req, res) => {
    const parsed = ladderSchema.safeParse(req.body);
    if (!parsed.success) return fail(res, 400, "Confira os dias da régua.");
    const d = parsed.data;
    if (!(d.pastDueAt < d.readOnlyAt && d.readOnlyAt < d.suspendAt && d.suspendAt < d.cancelAt)) {
      return fail(res, 400, "A ordem precisa ser: atrasado < só leitura < suspensa < cancelada.");
    }
    const before = await loadLadder();
    const next = {
      enabled: !!d.enabled,
      trialReminders: dayList(d.trialReminders),
      renewReminders: dayList(d.renewReminders),
      pastDueAt: d.pastDueAt,
      overdueReminders: dayList(d.overdueReminders).filter((x) => x > d.pastDueAt && x < d.suspendAt),
      readOnlyAt: d.readOnlyAt,
      suspendAt: d.suspendAt,
      cancelAt: d.cancelAt,
      stripeGraceDays: d.stripeGraceDays,
    };
    if (before.enabled && !next.enabled && !isFreshStepUp(req)) {
      return fail(res, 428, "Confirme com o código do autenticador.", "step_up_required");
    }
    await saveLadder(next);
    await audit(req, actor(req), "ladder.config", { type: "setting", label: "Régua de cobrança", meta: { from: before, to: next } }, before.enabled && !next.enabled);
    ok(res, next.enabled ? "Régua salva." : "Régua desligada: nenhum aviso ou mudança automática.", { warn: !next.enabled });
  }),
);

masterRouter.post(
  "/vencimentos/regua/padrao",
  requireCap("plans_manage"),
  h(async (req, res) => {
    await saveLadder({ ...DEFAULT_LADDER });
    await audit(req, actor(req), "ladder.config", { type: "setting", label: "Régua de cobrança", meta: { to: DEFAULT_LADDER } });
    ok(res, "Régua voltou ao padrão.");
  }),
);

// ---------------------------------------------------------------------------
// Suporte (tickets das empresas)
// ---------------------------------------------------------------------------

const TICKET_FILTERS: [string, string, string[] | null][] = [
  ["abertos", "Esperando a gente", ["open"]],
  ["aguardando", "Esperando a empresa", ["waiting"]],
  ["resolvidos", "Resolvidos", ["closed"]],
  ["todos", "Todos", null],
];
const TICKET_CAT: Record<string, string> = { question: "Dúvida", suggestion: "Sugestão", bug: "Problema", other: "Outro" };
const TICKET_STATUS: Record<string, Pill> = {
  open: { label: "Esperando a gente", tone: "danger" },
  waiting: { label: "Esperando a empresa", tone: "info" },
  closed: { label: "Resolvido", tone: "muted" },
};
const PRIORITY: Record<string, Pill> = {
  high: { label: "Alta", tone: "danger" },
  normal: { label: "Normal", tone: "soft" },
  low: { label: "Baixa", tone: "muted" },
};

function ageLabel(d: Date): string {
  const h = Math.floor((Date.now() - d.getTime()) / 3_600_000);
  if (h < 1) return "agora";
  if (h < 24) return `há ${h} h`;
  return `há ${Math.floor(h / 24)} d`;
}

masterRouter.get(
  "/suporte",
  h(async (req, res) => {
    const f = TICKET_FILTERS.find((x) => x[0] === req.query.filtro) ?? TICKET_FILTERS[0];
    const q = String(req.query.q || "").trim();
    const [rows, counts] = await Promise.all([
      prisma.supportTicket.findMany({
        where: {
          ...(f[2] ? { status: { in: f[2] } } : {}),
          ...(q ? { OR: [{ subject: { contains: q, mode: "insensitive" } }, { body: { contains: q, mode: "insensitive" } }, { organization: { name: { contains: q, mode: "insensitive" } } }] } : {}),
        },
        orderBy: [{ lastMessageAt: "desc" }, { createdAt: "desc" }],
        take: 200,
        include: {
          organization: { select: { id: true, name: true } },
          createdByUser: { select: { name: true, email: true } },
          _count: { select: { messages: true } },
        },
      }),
      prisma.supportTicket.groupBy({ by: ["status"], _count: { _all: true } }),
    ]);
    const countOf = (st: string[] | null) => counts.filter((c) => !st || st.includes(c.status)).reduce((a, c) => a + c._count._all, 0);
    const prioRank: Record<string, number> = { high: 0, normal: 1, low: 2 };
    const list = rows
      .map((t) => ({
        id: t.id,
        subject: t.subject,
        orgName: t.organization.name,
        orgId: t.organization.id,
        author: t.createdByUser?.name ?? "—",
        category: TICKET_CAT[t.category] ?? t.category,
        pill: TICKET_STATUS[t.status] ?? { label: t.status, tone: "muted" as const },
        priority: PRIORITY[t.priority] ?? PRIORITY.normal,
        prioKey: t.priority,
        age: ageLabel(t.lastMessageAt ?? t.createdAt),
        replies: t._count.messages,
        waitingUs: t.status === "open",
      }))
      .sort((a, b) => (f[0] === "abertos" ? (prioRank[a.prioKey] ?? 1) - (prioRank[b.prioKey] ?? 1) : 0));
    page(res, "suporte", await shell(req, "suporte"), {
      rows: list,
      filter: f[0],
      q,
      filters: TICKET_FILTERS.map((x) => ({ key: x[0], label: x[1], count: countOf(x[2]) })),
    });
  }),
);

masterRouter.get(
  "/suporte/:id",
  h(async (req, res) => {
    const t = await prisma.supportTicket.findUnique({
      where: { id: String(req.params.id) },
      include: {
        organization: { select: { id: true, name: true, slug: true, status: true } },
        createdByUser: { select: { id: true, name: true, email: true, status: true } },
        messages: { orderBy: { createdAt: "asc" } },
      },
    });
    if (!t) return void res.status(404).render("master/error", { title: "Ticket não encontrado", message: "Esse ticket não existe." });
    const thread = [
      { from: "company", author: t.createdByUser?.name ?? "Empresa", body: t.body, when: dateTimeLabel(t.createdAt) },
      ...t.messages.map((m) => ({ from: m.authorType, author: m.authorName, body: m.body, when: dateTimeLabel(m.createdAt) })),
    ];
    page(res, "ticket", await shell(req, "suporte"), {
      t: {
        id: t.id,
        subject: t.subject,
        category: TICKET_CAT[t.category] ?? t.category,
        status: t.status,
        pill: TICKET_STATUS[t.status] ?? { label: t.status, tone: "muted" },
        priority: t.priority,
        org: t.organization,
        author: t.createdByUser,
        opened: dateTimeLabel(t.createdAt),
        firstResponse: t.firstResponseAt ? dateTimeLabel(t.firstResponseAt) : null,
      },
      thread,
      canSupport: can(req.master!.role, "support_enter") && !["suspended", "canceled"].includes(String((t.organization as { status?: string }).status ?? "")),
      supportSessions: await supportSessionsFor({ ticketId: t.id }, 4),
      supportUser: t.createdByUser && (t.createdByUser as { status?: string }).status === "active" ? { id: t.createdByUser.id, name: t.createdByUser.name } : null,
    });
  }),
);

masterRouter.post(
  "/suporte/:id/responder",
  h(async (req, res) => {
    const body = String(req.body?.body || "").trim().slice(0, 8000);
    const close = req.body?.close === "1";
    const t = await prisma.supportTicket.findUnique({
      where: { id: String(req.params.id) },
      include: { createdByUser: { select: { name: true, email: true } }, organization: { select: { name: true, slug: true } } },
    });
    if (!t) return fail(res, 404, "Ticket não encontrado.");
    if (!body && !close) return fail(res, 400, "Escreva a resposta.");
    const now = new Date();
    if (body) {
      await prisma.supportTicketMessage.create({
        data: { ticketId: t.id, organizationId: t.organizationId, authorType: "platform", authorId: req.master!.id, authorName: `${req.master!.name.split(" ")[0]} · ObraMate`, body },
      });
    }
    await prisma.supportTicket.update({
      where: { id: t.id },
      data: {
        status: close ? "closed" : "waiting",
        closedAt: close ? now : null,
        lastMessageAt: body ? now : t.lastMessageAt,
        ...(body && !t.firstResponseAt ? { firstResponseAt: now } : {}),
      },
    });
    if (body && t.createdByUser?.email) {
      await sendPlatformEmail("support_reply", {
        to: t.createdByUser.email,
        organizationId: t.organizationId,
        vars: {
          name: firstName(t.createdByUser.name),
          subject: t.subject,
          message: body,
          status_note: close ? { en: "We marked the ticket as solved; replying opens it again.", pt: "Marcamos o ticket como resolvido; responder reabre." } : "",
        },
      }).catch(() => undefined);
    }
    await audit(req, actor(req), body ? "support.reply" : "support.close", { type: "ticket", id: t.id, label: `${t.subject} · ${t.organization.name}`, meta: { close } });
    ok(res, body ? (close ? "Resposta enviada e ticket resolvido." : "Resposta enviada. A empresa recebe por e-mail e vê no ObraMate.") : "Ticket resolvido.");
  }),
);

masterRouter.post(
  "/suporte/:id/status",
  h(async (req, res) => {
    const status = String(req.body?.status || "");
    const priority = String(req.body?.priority || "");
    const t = await prisma.supportTicket.findUnique({ where: { id: String(req.params.id) }, select: { id: true, subject: true, status: true, priority: true } });
    if (!t) return fail(res, 404, "Ticket não encontrado.");
    const data: Record<string, unknown> = {};
    if (status && ["open", "waiting", "closed"].includes(status)) {
      data.status = status;
      data.closedAt = status === "closed" ? new Date() : null;
    }
    if (priority && ["low", "normal", "high"].includes(priority)) data.priority = priority;
    if (!Object.keys(data).length) return fail(res, 400, "Nada para mudar.");
    await prisma.supportTicket.update({ where: { id: t.id }, data });
    await audit(req, actor(req), "support.update", { type: "ticket", id: t.id, label: t.subject, meta: { from: { status: t.status, priority: t.priority }, to: data } });
    ok(res, "Ticket atualizado.");
  }),
);

// ---------------------------------------------------------------------------
// Equipe e segurança
// ---------------------------------------------------------------------------

masterRouter.get(
  "/equipe",
  h(async (req, res) => {
    const team = await prisma.platformAdmin.findMany({ where: { status: { not: "disabled" } }, orderBy: [{ createdAt: "asc" }] });
    const members = team
      .map((m) => {
        const role = normalizeRole(m.role);
        return {
          id: m.id,
          name: m.name,
          email: m.email,
          role,
          roleLabel: ROLE_LABEL[role],
          you: m.id === req.master!.id,
          status: m.status,
          twofa: m.totpEnabledAt ? "App autenticador" : m.status === "invited" ? "Configura no 1º acesso" : "Pendente",
          last: m.status === "invited" ? `convite enviado ${shortDate(m.updatedAt)}` : m.lastLoginAt ? dateTimeLabel(m.lastLoginAt) : "nunca entrou",
          recovery: Array.isArray(m.recoveryCodeHashes) ? (m.recoveryCodeHashes as unknown[]).length : 0,
          locked: !!m.securityLockedAt,
          initials: initials(m.name),
          avatarBg: m.role === "MASTER" ? "#f3b98f" : avatarBg(m.id),
        };
      })
      .sort((a, b) => (a.role === "MASTER" ? -1 : b.role === "MASTER" ? 1 : 0));
    const roles = PLATFORM_ROLES;
    const backupRuns = await prisma.jobRun.findMany({ where: { name: BACKUP_CHECK_JOB }, orderBy: { startedAt: "desc" }, take: 5 });
    const backup = backupRuns.map((r) => {
      const d = (r.detail ?? {}) as { tables?: number; rows?: number; dumpBytes?: number; dumpSeconds?: number; restoreSeconds?: number; problems?: string[]; warnings?: string[] };
      const days = Math.floor((Date.now() - r.startedAt.getTime()) / 86400e3);
      return {
        ok: r.ok === true,
        when: dateTimeLabel(r.startedAt),
        age: days === 0 ? "hoje" : days === 1 ? "ontem" : `há ${days} dias`,
        stale: days > BACKUP_CHECK_MAX_DAYS,
        summary: `${d.tables ?? 0} tabelas · ${(d.rows ?? 0).toLocaleString("pt-BR")} linhas · ${((d.dumpBytes ?? 0) / 1048576).toFixed(1)} MB`,
        timing: `cópia ${(d.dumpSeconds ?? 0).toFixed(0)} s · restauração ${(d.restoreSeconds ?? 0).toFixed(0)} s`,
        problems: d.problems ?? (r.error ? [r.error] : []),
        warnings: (d.warnings ?? []).length,
      };
    });
    page(res, "equipe", await shell(req, "equipe"), {
      members,
      backup,
      backupMaxDays: BACKUP_CHECK_MAX_DAYS,
      roles: roles.map((r) => ({ key: r, label: ROLE_LABEL[r] })),
      matrix: CAPABILITIES.map((c) => ({ label: c.label, cells: roles.map((r) => can(r, c.key)) })),
      inviteRoles: (["ADMIN", "FINANCE", "SUPPORT", "READONLY"] as const).map((r) => ({ key: r, label: ROLE_LABEL[r], hint: ROLE_HINT[r] })),
      canTeam: can(req.master!.role, "team_manage"),
      myRecovery: members.find((m) => m.you)?.recovery ?? 0,
    });
  }),
);

const inviteSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  name: z.string().trim().max(80).optional(),
  role: z.enum(["ADMIN", "FINANCE", "SUPPORT", "READONLY"]),
});

masterRouter.post(
  "/equipe/convidar",
  requireCap("team_manage"),
  h(async (req, res) => {
    const parsed = inviteSchema.safeParse(req.body);
    if (!parsed.success) return fail(res, 400, "Digite um e-mail válido e escolha o papel.");
    const exists = await prisma.platformAdmin.findUnique({ where: { email: parsed.data.email } });
    if (exists && exists.status !== "disabled") return fail(res, 409, "Essa pessoa já está na equipe.");
    const name = parsed.data.name || parsed.data.email.split("@")[0].replace(/[._-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    const admin = exists
      ? await prisma.platformAdmin.update({ where: { id: exists.id }, data: { name, role: parsed.data.role, status: "invited", passwordHash: "", totpSecretEnc: null, totpEnabledAt: null, recoveryCodeHashes: [], invitedById: req.master!.id } })
      : await prisma.platformAdmin.create({ data: { email: parsed.data.email, name, passwordHash: "", role: parsed.data.role, status: "invited", invitedById: req.master!.id } });
    const link = await issueActivation(admin.id);
    await sendActivationEmail(admin.email, admin.name, link, "invite");
    await audit(req, actor(req), "team.invite", { type: "admin", id: admin.id, label: admin.email, meta: { role: parsed.data.role } });
    ok(res, `Convite enviado para ${admin.email}.`, { reveal: { title: "Link de convite", value: link, note: "Também foi por e-mail. Vale 48 horas e só funciona uma vez." } });
  }),
);

masterRouter.post(
  "/equipe/:id/reenviar",
  requireCap("team_manage"),
  h(async (req, res) => {
    const admin = await prisma.platformAdmin.findUnique({ where: { id: String(req.params.id) } });
    if (!admin || admin.status !== "invited") return fail(res, 400, "Esse convite não está pendente.");
    const link = await issueActivation(admin.id);
    await sendActivationEmail(admin.email, admin.name, link, admin.role === "MASTER" ? "master" : "invite");
    await audit(req, actor(req), "team.invite_resend", { type: "admin", id: admin.id, label: admin.email });
    ok(res, `Convite reenviado para ${admin.email}.`, { reveal: { title: "Link de convite", value: link, note: "Vale 48 horas e só funciona uma vez." } });
  }),
);

masterRouter.post(
  "/equipe/:id/papel",
  requireCap("team_manage"),
  requireStepUp,
  h(async (req, res) => {
    const role = String(req.body?.role || "").toUpperCase();
    if (!["ADMIN", "FINANCE", "SUPPORT", "READONLY"].includes(role)) return fail(res, 400, "Papel inválido.");
    const admin = await prisma.platformAdmin.findUnique({ where: { id: String(req.params.id) } });
    if (!admin || admin.role === "MASTER") return fail(res, 400, "O papel do Master não muda por aqui.");
    await prisma.platformAdmin.update({ where: { id: admin.id }, data: { role } });
    await audit(req, actor(req), "team.role", { type: "admin", id: admin.id, label: admin.email, meta: { from: admin.role, to: role } }, true);
    ok(res, `${admin.name} agora é ${ROLE_LABEL[role as PlatformRole]}.`);
  }),
);

masterRouter.post(
  "/equipe/:id/remover",
  requireCap("team_manage"),
  requireStepUp,
  h(async (req, res) => {
    const admin = await prisma.platformAdmin.findUnique({ where: { id: String(req.params.id) } });
    if (!admin) return fail(res, 404, "Membro não encontrado.");
    if (admin.role === "MASTER") return fail(res, 400, "O Master não pode ser removido.");
    await prisma.platformAdmin.update({ where: { id: admin.id }, data: { status: "disabled", activationTokenHash: null, activationExpiresAt: null } });
    await prisma.$executeRaw`DELETE FROM "session" WHERE sess->'master'->>'adminId' = ${admin.id}`.catch(() => 0);
    await audit(req, actor(req), "team.remove", { type: "admin", id: admin.id, label: admin.email }, true);
    ok(res, `${admin.name} removido. As sessões dele foram encerradas.`, { warn: true });
  }),
);

masterRouter.post(
  "/equipe/codigos-recuperacao",
  requireStepUp,
  h(async (req, res) => {
    const codes = generateRecoveryCodes();
    const hashes = await Promise.all(codes.map((c) => bcrypt.hash(c, 10)));
    await prisma.platformAdmin.update({ where: { id: req.master!.id }, data: { recoveryCodeHashes: hashes } });
    await audit(req, actor(req), "auth.recovery_codes_regenerated", { type: "admin", id: req.master!.id, label: req.master!.email }, true);
    ok(res, "Novos códigos criados. Os antigos pararam de funcionar.", {
      reveal: { title: "Códigos de recuperação", value: codes.join("\n"), note: "Imprima ou guarde num cofre de senhas. Cada código vale uma vez." },
    });
  }),
);

// ---------------------------------------------------------------------------
// Auditoria
// ---------------------------------------------------------------------------

const AUDIT_CATS: [string, string, string[]][] = [
  ["todas", "Todas", []],
  ["acesso", "Acesso", ["auth."]],
  ["financeiro", "Financeiro", ["payment.", "tenant.plan", "tenant.extend", "tenant.set_due_date", "tenant.reminder", "tenant.bulk_reminder"]],
  ["clientes", "Empresas", ["tenant.", "contact."]],
  ["usuarios", "Usuários", ["user."]],
  ["equipe", "Equipe", ["team."]],
  ["exportacoes", "Exportações", ["export."]],
  ["comunicacao", "Comunicação", ["comms."]],
  ["idiomas", "Idiomas", ["i18n."]],
  ["dados", "Dados e privacidade", ["data.", "privacy."]],
];

const AUDIT_TEXT: Record<string, string> = {
  "auth.login": "Entrou (senha + 2FA)",
  "auth.sessions_ended": "Encerrou sessões do Master",
  "auth.not_me": "Clicou em “não fui eu” e travou a conta",
  "auth.unlocked": "Destravou conta (link novo enviado)",
  "auth.logout": "Saiu",
  "auth.password_failed": "Senha errada",
  "auth.2fa_failed": "Código 2FA errado",
  "auth.step_up_failed": "Código errado em ação sensível",
  "auth.2fa_enabled": "Configurou o 2FA",
  "auth.activated": "Ativou o acesso",
  "auth.recovery_code_used": "Entrou com código de recuperação",
  "auth.recovery_codes_regenerated": "Gerou novos códigos de recuperação",
  "auth.setup_link_sent": "Recebeu link para configurar o 2FA",
  "tenant.extend": "Prorrogou vencimento",
  "tenant.set_due_date": "Definiu data de vencimento",
  "tenant.plan": "Mudou o plano",
  "tenant.billing_contact": "Editou contato do financeiro",
  "tenant.reminder": "Enviou lembrete de vencimento",
  "tenant.bulk_reminder": "Enviou lembretes em massa",
  "tenant.suspend": "Suspendeu a empresa",
  "support.start": "Entrou como suporte",
  "ops.job_run": "Rodou um job na mão",
  "coupon.create": "Criou cupom",
  "i18n.term_create": "Criou troca de palavra (Idiomas)",
  "i18n.term_update": "Editou troca de palavra (Idiomas)",
  "i18n.term_delete": "Excluiu troca de palavra (Idiomas)",
  "i18n.term_on": "Ligou troca de palavra (Idiomas)",
  "i18n.term_off": "Desligou troca de palavra (Idiomas)",
  "i18n.phrase_save": "Editou frase do sistema (Idiomas)",
  "i18n.phrase_reset": "Voltou frase ao padrão (Idiomas)",
  "coupon.archive": "Arquivou cupom",
  "coupon.apply": "Aplicou cupom na empresa",
  "coupon.remove": "Tirou cupom da empresa",
  "coupon.retention": "Mudou a oferta para quem vai cancelar",
  "coupon.builder_referral": "Mudou o cupom de indicação de builder",
  "tenant.cancel_requested": "Empresa pediu cancelamento",
  "tenant.cancel_undone": "Empresa desistiu de cancelar",
  "tenant.retention_accepted": "Empresa aceitou oferta para ficar",
  "tenant.cancel_effective": "Cancelamento agendado entrou em vigor",
  "billing.card_expiring_email": "Aviso de cartão vencendo enviado",
  "payment.dispute_closed": "Disputa encerrada",
  "data.export_requested": "Gerou exportação da empresa",
  "data.export_downloaded": "Baixou exportação da empresa",
  "data.export_link": "Criou link de download para a empresa",
  "data.export_link_revoked": "Cancelou link de download",
  "data.person_erased": "Excluiu dados de uma pessoa",
  "data.company_deleted": "Excluiu a empresa de vez",
  "privacy.request_created": "Registrou pedido de privacidade",
  "privacy.request_updated": "Atualizou pedido de privacidade",
  "comms.announcement_create": "Publicou aviso no app",
  "comms.announcement_update": "Editou aviso no app",
  "comms.announcement_end": "Tirou aviso do ar",
  "comms.template_save": "Editou modelo de e-mail",
  "comms.template_reset": "Restaurou modelo de e-mail",
  "comms.template_test": "Enviou e-mail de teste",
  "comms.locale": "Mudou o idioma dos e-mails",
  "comms.block": "Bloqueou endereço de e-mail",
  "comms.unblock": "Liberou endereço de e-mail",
  "ops.maintenance_on": "Ligou o modo manutenção",
  "ops.maintenance_off": "Desligou o modo manutenção",
  "ops.maintenance_schedule": "Programou manutenção",
  "ops.maintenance_unschedule": "Cancelou manutenção programada",
  "tenant.details": "Editou os dados da empresa",
  "feature.state": "Mudou um módulo para todas as empresas",
  "plan.features": "Mudou o que o plano inclui",
  "feature.override": "Criou exceção de módulo",
  "feature.override_remove": "Tirou exceção de módulo",
  "support.update": "Atualizou ticket de suporte",
  "billing.charge_now": "Cobrou agora no Stripe",
  "billing.checkout_link": "Gerou link de pagamento",
  "ladder.config": "Configurou a régua de cobrança",
  "ladder.run": "Rodou a régua de cobrança",
  "legal.prompt": "Mudou o pedido de aceite dos termos no app",
  "plan.create": "Criou plano",
  "plan.update": "Editou plano",
  "signup.invite": "Criou convite de cadastro",
  "signup.invite_revoke": "Cancelou convite de cadastro",
  "signup.mode": "Mudou o modo do cadastro",
  "signup.resend": "Reenviou link de cadastro",
  "support.end": "Encerrou sessão de suporte",
  "tenant.reactivate": "Reativou a empresa",
  "tenant.cancel": "Cancelou a empresa",
  "tenant.create": "Criou empresa",
  "tenant.subscription": "Editou assinatura",
  "payment.record": "Registrou pagamento",
  "payment.refund": "Estornou pagamento",
  "user.create": "Cadastrou usuário",
  "user.block": "Bloqueou usuário",
  "user.unblock": "Desbloqueou usuário",
  "user.end_sessions": "Encerrou sessões",
  "user.temp_password": "Criou senha temporária",
  "user.bulk_end_sessions": "Encerrou sessões em massa",
  "user.bulk_block": "Bloqueou usuários em massa",
  "user.bulk_unblock": "Desbloqueou usuários em massa",
  "contact.log": "Registrou conversa",
  "team.invite": "Convidou para a equipe",
  "team.invite_resend": "Reenviou convite",
  "team.role": "Mudou papel na equipe",
  "team.remove": "Removeu da equipe",
  "export.clientes": "Exportou clientes",
  "export.usuarios": "Exportou usuários",
  "export.pagamentos": "Exportou pagamentos",
};

function auditTone(action: string): string {
  if (/failed|block$|bulk_block|suspend|cancel|remove|refund/.test(action)) return "danger";
  if (/payment\.record|unblock|reactivate|2fa_enabled|activated/.test(action)) return "ink";
  if (action.startsWith("auth.")) return "muted";
  return "warn";
}

masterRouter.get(
  "/auditoria",
  h(async (req, res) => {
    const cat = AUDIT_CATS.find((c) => c[0] === req.query.filtro) ?? AUDIT_CATS[0];
    const empresaId = typeof req.query.empresa === "string" && /^[0-9a-f-]{36}$/i.test(req.query.empresa) ? req.query.empresa : null;
    const empresa = empresaId ? await prisma.organization.findUnique({ where: { id: empresaId }, select: { id: true, name: true } }) : null;
    const where = {
      ...(cat[2].length ? { OR: cat[2].map((p) => (p.endsWith(".") ? { action: { startsWith: p } } : { action: p })) } : {}),
      ...(empresa ? { targetId: empresa.id } : {}),
    };
    const rows = await prisma.platformAuditLog.findMany({ where, orderBy: { at: "desc" }, take: 300 });
    page(res, "auditoria", await shell(req, "auditoria"), {
      empresa,
      filter: cat[0],
      filters: AUDIT_CATS.map((c) => ({ key: c[0], label: c[1] })),
      rows: rows.map((r) => ({
        when: dateTimeLabel(r.at),
        who: r.actorName,
        text: AUDIT_TEXT[r.action] ?? r.action,
        detail: describeAudit(r.action, r.meta as Record<string, unknown> | null),
        target: r.targetLabel ?? "—",
        ip: r.ip ?? "—",
        stepUp: r.stepUp,
        tone: auditTone(r.action),
      })),
    });
  }),
);

function describeAudit(action: string, meta: Record<string, unknown> | null): string {
  if (!meta) return "";
  if (action === "payment.record" || action === "payment.refund") return money(Number(meta.amountCents || 0));
  if (action === "tenant.extend" || action === "tenant.set_due_date") return `até ${shortDate(new Date(String(meta.to)))} · ${meta.reason ?? ""}`;
  if (action === "auth.login") return meta.method === "recovery" ? "com código de recuperação" : "";
  if (action === "team.invite") return ROLE_LABEL[normalizeRole(String(meta.role))];
  // Edits that record what changed show "before → after".
  if (Array.isArray(meta.changes)) return (meta.changes as unknown[]).map(String).slice(0, 6).join(" · ");
  if (action === "feature.override") return `${String(meta.feature)} ${meta.enabled ? "ligado" : "desligado"} · ${meta.reason ?? ""}`;
  if (action === "feature.state") return `${meta.from} → ${meta.to}`;
  if (action === "support.start") return `${meta.user ?? ""} · ${meta.minutes ?? ""} min · ${meta.reason ?? ""}`;
  return "";
}

// ---------------------------------------------------------------------------
// Busca global (⌘K)
// ---------------------------------------------------------------------------

masterRouter.get(
  "/busca",
  h(async (req, res) => {
    const q = String(req.query.q || "").trim();
    if (q.length < 2) return void res.json({ ok: true, groups: [] });
    const like = { contains: q, mode: "insensitive" as const };
    const [orgs, users] = await Promise.all([
      prisma.organization.findMany({
        where: { OR: [{ name: like }, { slug: like }, { contactEmail: like }, { contactPhone: like }, { billingContactName: like }, { billingContactEmail: like }] },
        select: { id: true, name: true, slug: true, status: true },
        take: 6,
      }),
      prisma.user.findMany({
        where: { OR: [{ name: like }, { email: like }] },
        select: { id: true, name: true, email: true, organization: { select: { name: true } } },
        take: 6,
      }),
    ]);
    const groups = [];
    if (orgs.length) groups.push({ title: "EMPRESAS", items: orgs.map((o) => ({ label: o.name, sub: `${o.slug} · ${orgStatusText(o.status)}`, href: `/master/clientes?ficha=${o.id}`, kind: "Empresa" })) });
    if (users.length) groups.push({ title: "USUÁRIOS", items: users.map((u) => ({ label: u.name, sub: `${u.email} · ${u.organization.name}`, href: `/master/usuarios?usuario=${u.id}`, kind: "Usuário" })) });
    res.json({ ok: true, groups });
  }),
);

function orgStatusText(s: string) {
  return { active: "Ativa", trial: "Trial", past_due: "Pagamento atrasado", suspended: "Suspensa", canceled: "Cancelada" }[s] ?? s;
}

// ---------------------------------------------------------------------------
// Exportar (CSV) — sempre com 2FA recente
// ---------------------------------------------------------------------------

masterRouter.post(
  "/exportar/:kind",
  requireCap("export"),
  requireStepUp,
  h(async (req, res) => {
    const kind = String(req.params.kind);
    let header: string[] = [];
    let rows: unknown[][] = [];
    if (kind === "clientes") {
      const orgs = await loadOrgs();
      header = ["empresa", "slug", "status", "plano", "ciclo", "valor", "vencimento", "dono", "email_dono", "telefone", "financeiro", "email_financeiro", "usuarios", "criada_em"];
      rows = orgs.map((o) => [o.name, o.slug, o.status, o.plan, o.billingCycle, (o.priceCents / 100).toFixed(2), o.due ? ymdInTz(o.due) : "", o.ownerName, o.ownerEmail, o.ownerPhone, o.billingContactName ?? "", o.billingContactEmail ?? "", o.users, ymdInTz(o.createdAt)]);
    } else if (kind === "usuarios") {
      const users = await loadUsers();
      header = ["nome", "email", "empresa", "papel", "status", "sessoes_abertas", "criado_em"];
      rows = users.map((u) => [u.name, u.email, u.orgName, u.roleName, u.status, u.sessions, ymdInTz(u.createdAt)]);
    } else if (kind === "pagamentos") {
      const pays = await loadPayments({}, 5000);
      header = ["data", "empresa", "valor", "metodo", "status", "periodo_inicio", "periodo_fim", "observacao"];
      rows = pays.map((p) => [ymdInTz(p.paidAt), p.orgName, (p.amountCents / 100).toFixed(2), p.method, p.status, p.periodStart ? ymdInTz(p.periodStart) : "", p.periodEnd ? ymdInTz(p.periodEnd) : "", p.note ?? ""]);
    } else {
      return fail(res, 404, "Exportação desconhecida.");
    }
    await audit(req, actor(req), `export.${kind}`, { type: "export", label: `${rows.length} linha(s)` }, true);
    const csv = [header, ...rows].map((r) => r.map(csvEscape).join(",")).join("\n");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${kind}-${ymdInTz(new Date())}.csv"`);
    res.send("﻿" + csv);
  }),
);

// ---------------------------------------------------------------------------
// Cadastros (site sign-up: mode, invitations, recent sign-ups)
// ---------------------------------------------------------------------------

function inviteUrl(code: string): string {
  return `${env.APP_BASE_URL.replace(/\/$/, "")}/signup?invite=${encodeURIComponent(code)}`;
}

function inviteState(i: { usedAt: Date | null; revokedAt: Date | null; expiresAt: Date | null }): Pill {
  if (i.usedAt) return { label: "Usado", tone: "ink" };
  if (i.revokedAt) return { label: "Cancelado", tone: "muted" };
  if (i.expiresAt && i.expiresAt.getTime() < Date.now()) return { label: "Expirado", tone: "muted" };
  return { label: "Aguardando", tone: "warn" };
}

masterRouter.get(
  "/cadastros",
  requireCap("view"),
  h(async (req, res) => {
    const since = new Date(Date.now() - 30 * 86400e3);
    const [mode, invites, requests, activeOrgs] = await Promise.all([
      signupMode(),
      prisma.signupInvite.findMany({ orderBy: { createdAt: "desc" }, take: 60 }),
      prisma.signupRequest.findMany({ where: { createdAt: { gte: since } }, orderBy: { createdAt: "desc" }, take: 200 }),
      prisma.organization.findMany({ where: { status: { not: "canceled" } }, select: { id: true } }),
    ]);
    const current = currentLegalVersions();
    const accepted = await prisma.legalAcceptance.findMany({
      where: { document: "terms", version: current.terms },
      select: { organizationId: true },
      distinct: ["organizationId"],
    });
    const acceptedSet = new Set(accepted.map((a) => a.organizationId));
    const orgNames = new Map(
      (await prisma.organization.findMany({
        where: { id: { in: [...requests.map((r) => r.organizationId), ...invites.map((i) => i.organizationId)].filter((x): x is string => !!x) } },
        select: { id: true, name: true },
      })).map((o) => [o.id, o.name]),
    );
    const now = Date.now();
    const rows = requests.map((r) => ({
      id: r.id,
      company: r.organizationName,
      slug: r.slug,
      email: r.email,
      name: r.adminName,
      when: dateTimeLabel(r.createdAt),
      ip: r.ip,
      sends: r.sendCount,
      invite: !!r.inviteId,
      organizationId: r.organizationId,
      orgName: r.organizationId ? orgNames.get(r.organizationId) || r.organizationName : null,
      pill: r.verifiedAt
        ? ({ label: "Confirmado", tone: "ink" } as Pill)
        : r.expiresAt.getTime() < now
          ? ({ label: "Expirou", tone: "muted" } as Pill)
          : ({ label: "Aguardando e-mail", tone: "warn" } as Pill),
      pending: !r.verifiedAt && r.expiresAt.getTime() >= now,
    }));
    const started = requests.length;
    const confirmed = requests.filter((r) => r.verifiedAt).length;
    page(res, "cadastros", await shell(req, "cadastros"), {
      mode,
      legalPrompt: await legalPromptEnabled(),
      canMode: can(req.master!.role, "plans_manage"),
      canInvite: can(req.master!.role, "billing_manage"),
      canResend: can(req.master!.role, "users_manage"),
      invites: invites.map((i) => ({
        ...i,
        url: inviteUrl(i.code),
        pill: inviteState(i),
        created: dateTimeLabel(i.createdAt),
        expires: i.expiresAt ? shortDate(i.expiresAt) : "sem prazo",
        usable: !i.usedAt && !i.revokedAt && (!i.expiresAt || i.expiresAt.getTime() > now),
        orgName: i.organizationId ? orgNames.get(i.organizationId) || "empresa" : null,
        planName: planLabel(i.plan),
      })),
      rows,
      stats: {
        started,
        confirmed,
        pending: rows.filter((r) => r.pending).length,
        rate: started ? Math.round((confirmed / started) * 100) : null,
      },
      legal: legalDocuments().map((d) => ({ title: d.title, path: d.path, version: d.version })),
      legalMissing: activeOrgs.filter((o) => !acceptedSet.has(o.id)).length,
      legalTotal: activeOrgs.length,
      appBase: env.APP_BASE_URL.replace(/\/$/, ""),
      plans: planOptions(),
    });
  }),
);

masterRouter.post(
  "/cadastros/termos-no-app",
  requireCap("plans_manage"),
  h(async (req, res) => {
    const enabled = String(req.body?.enabled || "") === "1";
    const before = await legalPromptEnabled();
    await setLegalPrompt(enabled);
    await audit(req, actor(req), "legal.prompt", { type: "setting", label: "Pedir aceite dos termos no app", meta: { from: before, to: enabled } });
    ok(res, enabled ? "Os admins das empresas vão ver o pedido de aceite ao abrir o app." : "Pedido de aceite no app desligado.");
  }),
);

masterRouter.post(
  "/cadastros/modo",
  requireCap("plans_manage"),
  h(async (req, res) => {
    const mode = String(req.body?.mode || "");
    if (mode !== "open" && mode !== "invite" && mode !== "closed") return fail(res, 400, "Escolha uma opção.");
    const before = await signupMode();
    await setSignupMode(mode);
    const label = { open: "aberto", invite: "só com convite", closed: "fechado" }[mode];
    await audit(req, actor(req), "signup.mode", { type: "setting", label: "Cadastro pelo site", meta: { from: before, to: mode } });
    ok(res, `Cadastro pelo site: ${label}.`);
  }),
);

const signupInviteSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(200).optional().or(z.literal("")),
  companyName: z.string().trim().max(120).optional().default(""),
  plan: planKey,
  trialDays: z.coerce.number().int().min(0).max(120),
  validDays: z.coerce.number().int().min(0).max(365),
  note: z.string().trim().max(500).optional().default(""),
});

masterRouter.post(
  "/cadastros/convites",
  requireCap("billing_manage"),
  h(async (req, res) => {
    const parsed = signupInviteSchema.safeParse(req.body);
    if (!parsed.success) return fail(res, 400, "Confira e-mail, plano e dias.");
    const d = parsed.data;
    const code = randomBytes(9).toString("base64url");
    const inv = await prisma.signupInvite.create({
      data: {
        code,
        email: d.email || null,
        companyName: d.companyName || null,
        plan: d.plan,
        trialDays: d.trialDays,
        note: d.note || null,
        createdById: req.master!.id,
        expiresAt: d.validDays ? new Date(Date.now() + d.validDays * 86400e3) : null,
      },
    });
    await audit(req, actor(req), "signup.invite", { type: "invite", id: inv.id, label: d.companyName || d.email || code, meta: { plan: d.plan, trialDays: d.trialDays } });
    ok(res, "Convite criado.", {
      reveal: {
        title: "Link do convite",
        value: inviteUrl(code),
        note: `Mande este link para ${d.email || d.companyName || "a empresa"}. ${d.validDays ? `Vale ${d.validDays} dias` : "Não expira"} e só cria uma empresa.`,
      },
    });
  }),
);

masterRouter.post(
  "/cadastros/convites/:id/cancelar",
  requireCap("billing_manage"),
  h(async (req, res) => {
    const id = String(req.params.id);
    const inv = await prisma.signupInvite.findUnique({ where: { id } }).catch(() => null);
    if (!inv) return fail(res, 404, "Convite não encontrado.");
    if (inv.usedAt) return fail(res, 409, "Esse convite já foi usado.");
    await prisma.signupInvite.update({ where: { id }, data: { revokedAt: new Date() } });
    await audit(req, actor(req), "signup.invite_revoke", { type: "invite", id, label: inv.companyName || inv.email || inv.code });
    ok(res, "Convite cancelado. O link parou de funcionar.");
  }),
);

masterRouter.post(
  "/cadastros/:id/reenviar",
  requireCap("users_manage"),
  h(async (req, res) => {
    const id = String(req.params.id);
    const r = await resendSignup(id, { ip: `master:${req.master!.id}` });
    if (!r.ok) return fail(res, 409, r.message);
    const row = await prisma.signupRequest.findUnique({ where: { id }, select: { email: true, organizationName: true } });
    await audit(req, actor(req), "signup.resend", { type: "signup", id, label: row?.organizationName || id, meta: { email: row?.email } });
    ok(res, `Link de confirmação reenviado para ${row?.email}.`);
  }),
);

// ---------------------------------------------------------------------------
// Operação: serviços, jobs, erros, modo manutenção
// ---------------------------------------------------------------------------

const SERVICE_LABEL: Record<string, string> = { ok: "Funcionando", warn: "Atenção", down: "Fora do ar", off: "Não configurado", none: "Sem dado" };

/** Problems the Master should look at (menu badge and Central queue). */
async function opsProblems() {
  const [services, jobs, errors, maintenance] = await Promise.all([
    servicesOverview(),
    jobsOverview(),
    prisma.errorGroup.findMany({ where: { status: "open", lastSeen: { gte: new Date(Date.now() - 24 * 3600e3) } }, orderBy: { lastSeen: "desc" }, take: 50 }),
    getMaintenance(),
  ]);
  return {
    down: services.filter((s) => s.status === "down"),
    warn: services.filter((s) => s.status === "warn"),
    lateJobs: jobs.filter((j) => j.canRun && (j.late || j.lastOk === false)),
    newErrors: errors.filter((e) => Date.now() - e.firstSeen.getTime() < 24 * 3600e3),
    openErrors: errors,
    maintenance,
  };
}

let opsCountCache: { at: number; n: number } | null = null;
async function opsIssueCount(): Promise<number> {
  if (opsCountCache && Date.now() - opsCountCache.at < 60_000) return opsCountCache.n;
  const p = await opsProblems().catch(() => null);
  const n = p ? p.down.length + p.lateJobs.length + p.newErrors.length : 0;
  opsCountCache = { at: Date.now(), n };
  return n;
}

function durationText(ms: number | null): string {
  if (ms == null) return "—";
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}
function intervalText(sec: number): string {
  if (sec >= 86400) return "1× por dia";
  if (sec >= 3600) return `a cada ${Math.round(sec / 3600)} h`;
  return `a cada ${Math.round(sec / 60)} min`;
}
function ago(d: Date | null): string {
  if (!d) return "nunca";
  const s = Math.round((Date.now() - d.getTime()) / 1000);
  if (s < 90) return "agora";
  if (s < 3600) return `há ${Math.round(s / 60)} min`;
  if (s < 86400) return `há ${Math.round(s / 3600)} h`;
  return dateTimeLabel(d);
}

masterRouter.get(
  "/operacao",
  h(async (req, res) => {
    const [services, jobs, errors, maintenance] = await Promise.all([
      servicesOverview(),
      jobsOverview(),
      prisma.errorGroup.findMany({ orderBy: [{ status: "asc" }, { lastSeen: "desc" }], take: 60 }),
      getMaintenance(),
    ]);
    const orgIds = [...new Set(errors.map((e) => e.lastOrgId).filter(Boolean))] as string[];
    const orgNames = new Map((await prisma.organization.findMany({ where: { id: { in: orgIds } }, select: { id: true, name: true } })).map((o) => [o.id, o.name]));
    page(res, "operacao", await shell(req, "operacao"), {
      canOps: can(req.master!.role, "ops_manage"),
      services: services.map((s) => ({ ...s, statusLabel: SERVICE_LABEL[s.status], checked: ago(s.checkedAt), days: s.days.map((d) => ({ ...d, label: `${d.day.split("-").reverse().slice(0, 2).join("/")}: ${SERVICE_LABEL[d.status]}` })) })),
      jobs: jobs.map((j) => ({
        ...j,
        every: intervalText(j.intervalSec),
        last: ago(j.lastFinishedAt ?? j.lastStartedAt),
        duration: durationText(j.lastDurationMs),
        tone: j.running ? "soft" : j.lastOk === false ? "danger" : j.late ? "warn" : j.lastOk ? "ink" : "muted",
        state: j.running ? "Rodando" : j.lastOk === false ? "Falhou" : j.late ? "Atrasado" : j.lastOk ? "Em dia" : "Ainda não rodou",
      })),
      errors: errors.map((e) => ({
        fingerprint: e.fingerprint,
        source: e.source === "browser" ? "Navegador" : "Servidor",
        message: e.message,
        where: [e.method, e.path].filter(Boolean).join(" "),
        stackTop: e.stackTop,
        count: e.count,
        first: ago(e.firstSeen),
        last: ago(e.lastSeen),
        isNew: Date.now() - e.firstSeen.getTime() < 24 * 3600e3,
        status: e.status,
        org: e.lastOrgId ? { id: e.lastOrgId, name: orgNames.get(e.lastOrgId) ?? "empresa" } : null,
      })),
      maintenance: {
        ...maintenance,
        untilText: maintenance.until ? dateTimeLabel(new Date(maintenance.until)) : null,
        startedText: maintenance.startedAt ? dateTimeLabel(new Date(maintenance.startedAt)) : null,
        scheduledText: maintenance.scheduledAt ? dateTimeLabel(new Date(maintenance.scheduledAt)) : null,
      },
    });
  }),
);

masterRouter.post(
  "/operacao/checar",
  requireCap("ops_manage"),
  h(async (_req, res) => {
    const r = await runJobNow(SERVICE_CHECKS_JOB);
    opsCountCache = null;
    if (!r.ok) return fail(res, 400, r.message);
    ok(res, "Serviços verificados agora.");
  }),
);

masterRouter.post(
  "/operacao/jobs/:name/rodar",
  requireCap("ops_manage"),
  h(async (req, res) => {
    const name = String(req.params.name);
    const r = await runJobNow(name);
    opsCountCache = null;
    await audit(req, actor(req), "ops.job_run", { type: "job", label: name, meta: r.ok ? { processed: r.processed } : { error: r.message } });
    if (!r.ok) return fail(res, 400, `Não rodou: ${r.message}`);
    ok(res, `Rodou${r.processed != null ? ` · ${r.processed} item(ns)` : ""}.`);
  }),
);

masterRouter.post(
  "/operacao/erros/:fp/resolver",
  requireCap("ops_manage"),
  h(async (req, res) => {
    const reopen = String(req.body?.reopen || "") === "1";
    const r = await prisma.errorGroup.updateMany({ where: { fingerprint: String(req.params.fp) }, data: reopen ? { status: "open", resolvedAt: null } : { status: "resolved", resolvedAt: new Date() } });
    if (!r.count) return fail(res, 404, "Erro não encontrado.");
    opsCountCache = null;
    ok(res, reopen ? "Erro reaberto." : "Marcado como resolvido. Se acontecer de novo, ele reabre sozinho.");
  }),
);

const maintenanceSchema = z.object({
  action: z.enum(["on", "off", "schedule", "unschedule"]),
  message: z.string().trim().max(300).optional().default(""),
  until: z.string().optional().default(""),
  scheduledAt: z.string().optional().default(""),
  note: z.string().trim().max(200).optional().default(""),
});

/** datetime-local (Denver wall clock) → ISO. */
function denverLocalToIso(v: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v)) return null;
  for (const off of ["-06:00", "-07:00"]) {
    const d = new Date(`${v}:00${off}`);
    const back = new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Denver", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d).replace(" ", "T");
    if (back === v) return d.toISOString();
  }
  return null;
}

function stepUpWhenTurningOn(req: MasterRequest, res: Response, next: NextFunction) {
  if (String(req.body?.action || "") === "on") return requireStepUp(req, res, next);
  next();
}

masterRouter.post(
  "/operacao/manutencao",
  requireCap("ops_manage"),
  stepUpWhenTurningOn,
  h(async (req, res) => {
    const parsed = maintenanceSchema.safeParse(req.body);
    if (!parsed.success) return fail(res, 400, "Confira os campos.");
    const d = parsed.data;
    if (d.action === "on") {
      const until = d.until ? denverLocalToIso(d.until) : null;
      if (d.until && (!until || Date.parse(until) < Date.now())) return fail(res, 400, "A previsão de volta precisa ser no futuro.");
      await setMaintenance({ on: true, message: d.message, until, startedAt: new Date().toISOString(), scheduledAt: null, scheduledNote: "" });
      await audit(req, actor(req), "ops.maintenance_on", { type: "setting", label: "Modo manutenção", meta: { message: d.message, until } }, true);
      return ok(res, "Modo manutenção LIGADO. As empresas veem “Voltamos já”; o Master continua funcionando.");
    }
    if (d.action === "off") {
      const before = await getMaintenance();
      await setMaintenance({ on: false, message: "", until: null, startedAt: null });
      await audit(req, actor(req), "ops.maintenance_off", { type: "setting", label: "Modo manutenção", meta: { startedAt: before.startedAt } });
      return ok(res, "Modo manutenção desligado. O sistema voltou para todos.");
    }
    if (d.action === "schedule") {
      const at = denverLocalToIso(d.scheduledAt);
      if (!at || Date.parse(at) < Date.now()) return fail(res, 400, "Escolha data e hora no futuro.");
      await setMaintenance({ scheduledAt: at, scheduledNote: d.note });
      await audit(req, actor(req), "ops.maintenance_schedule", { type: "setting", label: "Manutenção programada", meta: { at, note: d.note } });
      return ok(res, "Manutenção programada. As empresas veem o aviso no app nas 24 h antes.");
    }
    await setMaintenance({ scheduledAt: null, scheduledNote: "" });
    await audit(req, actor(req), "ops.maintenance_unschedule", { type: "setting", label: "Manutenção programada" });
    ok(res, "Aviso de manutenção cancelado.");
  }),
);

// ---------------------------------------------------------------------------
// Métricas do negócio
// ---------------------------------------------------------------------------

const pctText = (v: number | null) => (v == null ? "—" : `${v.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`);

masterRouter.get(
  "/metricas",
  requireCap("billing_full"),
  h(async (req, res) => {
    const months = [6, 12, 24].includes(Number(req.query.meses)) ? Number(req.query.meses) : 12;
    await ensureTodaySnapshot();
    // One extra month at the start so the first month has a movement.
    const points = await mrrByMonth(months + 1);
    const shown = points.slice(1);
    const movement = movementFrom(points);
    const [funnel, usage, daily, users] = await Promise.all([trialFunnel(12), moduleUsage(), activeUsersDaily(30), activeUsersNow()]);
    const cur = shown[shown.length - 1];
    const prev = shown[shown.length - 2];
    const lastMove = movement[movement.length - 1];
    const prevMove = movement[movement.length - 2];
    // Same rule as the movement: compare like with like (snapshot vs snapshot, or both rebuilt from payments).
    const lastStart = lastMove ? lastMove.startMrr : 0;
    const delta = lastMove && lastStart ? Math.round((lastMove.netCents / lastStart) * 1000) / 10 : null;
    const estimatedMonths = shown.filter((p) => p.estimated).length;
    const cancels = await cancelReasons(12);
    page(res, "metricas", await shell(req, "metricas"), {
      months,
      cancels,
      tiles: [
        { label: "MRR", value: money(cur.mrrCents), note: delta == null ? "sem mês anterior" : `${delta >= 0 ? "+" : ""}${delta.toLocaleString("pt-BR")}% vs ${prev.label}`, hero: true, tone: delta == null ? "" : delta >= 0 ? "up" : "down" },
        { label: "ARR", value: money(cur.mrrCents * 12), note: "MRR × 12" },
        { label: "Empresas pagando", value: String(cur.paying), note: `${lastMove ? lastMove.churnedCompanies : 0} ${lastMove && lastMove.churnedCompanies === 1 ? "saiu" : "saíram"} em ${cur.label}` },
        { label: `Churn em ${cur.label}`, value: pctText(lastMove?.logoChurnPct ?? null), note: `receita ${pctText(lastMove?.revenueChurnPct ?? null)}${prevMove ? ` · ${prevMove.label}: ${pctText(prevMove.logoChurnPct)}` : ""}` },
        { label: "Usuários ativos (30 dias)", value: String(users.mau), note: `${users.wau} na semana · ${users.dau} hoje` },
      ],
      estimatedMonths,
      chart: {
        mrr: shown.map((p) => ({ label: p.label, ym: p.ym, value: p.mrrCents, estimated: p.estimated, paying: p.paying })),
        movement: movement.map((m) => ({ label: m.label, in: m.newCents + m.expansionCents + m.reactivationCents, out: m.contractionCents + m.churnCents, net: m.netCents, estimated: m.estimated })),
        modules: usage.modules.map((m) => ({ label: m.name, d30: m.pct30, d7: m.pct7, n30: m.d30, n7: m.d7 })),
        daily: daily.map((d) => ({ label: d.label, value: d.users })),
        funnel: funnel.totals,
      },
      // Months before the first payment carry no information; the table starts at the first month with revenue.
      movement: movement.slice(Math.max(0, movement.findIndex((m) => m.startMrr || m.endMrr || m.netCents))).map((m) => ({
        ...m,
        newText: money(m.newCents),
        expansionText: money(m.expansionCents),
        reactivationText: money(m.reactivationCents),
        contractionText: money(m.contractionCents),
        churnText: money(m.churnCents),
        netText: `${m.netCents >= 0 ? "+" : "−"}${money(Math.abs(m.netCents))}`,
        endText: money(m.endMrr),
        logoChurn: pctText(m.logoChurnPct),
        revenueChurn: pctText(m.revenueChurnPct),
      })).reverse(),
      funnel,
      usageBase: usage.base,
      usage: usage.modules,
      trackingSince: (await prisma.activeDay.findFirst({ orderBy: { day: "asc" }, select: { day: true } }))?.day ?? null,
    });
  }),
);

// ---------------------------------------------------------------------------
// Ficha 360°: linha do tempo, dados da empresa
// ---------------------------------------------------------------------------

type TimelineItem = { at: Date; when: string; kind: "product" | "money" | "support" | "master" | "billing" | "account"; title: string; sub?: string };

const DUNNING_TEXT: Record<string, string> = { email: "e-mail enviado", state: "status mudou", skipped: "pulado" };

/** Everything that happened to a company, newest first: product firsts, payments, tickets, support, ladder and Master actions. */
export async function timelineFor(organizationId: string, take = 25): Promise<{ items: TimelineItem[]; total: number; truncated: boolean }> {
  const [org, health, payments, tickets, sessions, dunning, legal, audits, signup] = await Promise.all([
    prisma.organization.findUnique({ where: { id: organizationId }, select: { createdAt: true } }),
    healthOf(organizationId).then((m) => m.get(organizationId) ?? null),
    prisma.platformPayment.findMany({ where: { organizationId }, orderBy: { paidAt: "desc" }, take: 60 }),
    prisma.supportTicket.findMany({ where: { organizationId }, orderBy: { createdAt: "desc" }, take: 40, select: { createdAt: true, subject: true, status: true } }),
    prisma.supportSession.findMany({ where: { organizationId, startedAt: { not: null } }, orderBy: { createdAt: "desc" }, take: 40 }),
    prisma.dunningStep.findMany({ where: { organizationId }, orderBy: { sentAt: "desc" }, take: 60 }),
    prisma.legalAcceptance.findMany({ where: { organizationId }, orderBy: { acceptedAt: "desc" }, take: 30 }),
    prisma.platformAuditLog.findMany({ where: { targetId: organizationId }, orderBy: { at: "desc" }, take: 150 }),
    prisma.signupRequest.findFirst({ where: { organizationId }, select: { verifiedAt: true } }),
  ]);
  const items: Omit<TimelineItem, "when">[] = [];
  if (org) items.push({ at: org.createdAt, kind: "account", title: signup ? "Conta criada pelo site" : "Conta criada", sub: signup ? "e-mail confirmado" : undefined });
  if (health?.firstActive) items.push({ at: health.firstActive, kind: "product", title: "Primeiro uso registrado", sub: "contagem de uso começou com a ficha 360°" });
  for (const st of health?.steps ?? []) if (st.done && st.at) items.push({ at: st.at, kind: "product", title: st.label });
  for (const p of payments) {
    const amount = money(p.amountCents);
    const title = p.status === "failed" ? `Pagamento recusado · ${amount}` : p.status === "refunded" ? `Pagamento estornado · ${amount}` : `Pagamento · ${amount}`;
    items.push({ at: p.paidAt, kind: "money", title, sub: [METHOD_LABEL[p.method] ?? p.method, p.failureReason].filter(Boolean).join(" · ") || undefined });
  }
  for (const t of tickets) items.push({ at: t.createdAt, kind: "support", title: `Ticket: ${t.subject}`, sub: t.status === "closed" ? "resolvido" : t.status === "waiting" ? "respondido" : "aberto" });
  for (const ss of sessions) items.push({ at: ss.startedAt!, kind: "support", title: `${ss.adminName} entrou como suporte`, sub: `como ${ss.userName} · ${ss.reason}` });
  for (const d of dunning) items.push({ at: d.sentAt, kind: "billing", title: `Régua: ${d.step}`, sub: [DUNNING_TEXT[d.action] ?? d.action, d.detail].filter(Boolean).join(" · ") });
  const legalSeen = new Set<string>();
  for (const l of legal) {
    const k = `${l.acceptedAt.toISOString().slice(0, 16)}`;
    if (legalSeen.has(k)) continue;
    legalSeen.add(k);
    items.push({ at: l.acceptedAt, kind: "account", title: "Aceitou Termos, Privacidade e DPA", sub: [l.userName || l.userEmail, l.source === "signup" ? "no cadastro" : "no app"].filter(Boolean).join(" · ") });
  }
  for (const a of audits) {
    if (a.action === "support.start") continue; // shown from the session itself
    items.push({ at: a.at, kind: "master", title: AUDIT_TEXT[a.action] ?? a.action, sub: a.actorName });
  }
  items.sort((x, y) => y.at.getTime() - x.at.getTime());
  return {
    items: items.slice(0, take).map((i) => ({ ...i, when: dateTimeLabel(i.at) })),
    total: items.length,
    truncated: items.length > take,
  };
}

const DETAIL_FIELDS = {
  name: "Nome",
  legalName: "Razão social",
  contactEmail: "E-mail da empresa",
  contactPhone: "Telefone",
  website: "Site",
  addressLine1: "Endereço",
  addressLine2: "Complemento",
  city: "Cidade",
  state: "Estado",
  postalCode: "ZIP",
  timezone: "Fuso",
  defaultLocale: "Idioma",
  licenseNumber: "Licença",
  licenseState: "Estado da licença",
  logoUrl: "Logo (URL)",
} as const;
type DetailKey = keyof typeof DETAIL_FIELDS;

async function companyDetails(organizationId: string) {
  const o = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: Object.fromEntries(Object.keys(DETAIL_FIELDS).map((k) => [k, true])) as Record<DetailKey, true>,
  });
  return (o ?? {}) as Record<DetailKey, string | null>;
}

const detailsSchema = z.object({
  name: z.string().trim().min(2).max(120),
  legalName: z.string().trim().max(160).optional().default(""),
  contactEmail: z.union([z.literal(""), z.string().trim().email().max(200)]).optional().default(""),
  contactPhone: z.string().trim().max(40).optional().default(""),
  website: z.string().trim().max(200).optional().default(""),
  addressLine1: z.string().trim().max(200).optional().default(""),
  addressLine2: z.string().trim().max(200).optional().default(""),
  city: z.string().trim().max(100).optional().default(""),
  state: z.string().trim().max(40).optional().default(""),
  postalCode: z.string().trim().max(20).optional().default(""),
  timezone: z.string().trim().max(60),
  defaultLocale: z.enum(["pt-BR", "en", "es"]),
  licenseNumber: z.string().trim().max(80).optional().default(""),
  licenseState: z.string().trim().max(40).optional().default(""),
  logoUrl: z.union([z.literal(""), z.string().trim().url().max(500).refine((u) => u.startsWith("https://"), "https")]).optional().default(""),
});

masterRouter.post(
  "/clientes/:id/dados",
  requireCap("billing_manage"),
  h(async (req, res) => {
    const org = await orgOr404(req, res);
    if (!org) return;
    const parsed = detailsSchema.safeParse(req.body);
    if (!parsed.success) {
      const f = String(parsed.error.issues[0]?.path[0] ?? "");
      return fail(res, 400, `Confira: ${DETAIL_FIELDS[f as DetailKey] ?? "os campos"}.`);
    }
    if (!US_TIMEZONES.some((t) => t.id === parsed.data.timezone)) return fail(res, 400, "Escolha um fuso da lista.");
    const before = await companyDetails(org.id);
    const next: Record<string, string | null> = {};
    const changes: string[] = [];
    for (const k of Object.keys(DETAIL_FIELDS) as DetailKey[]) {
      const v = (parsed.data as Record<string, string>)[k];
      const val = v === "" && k !== "name" ? null : v;
      if ((before[k] ?? null) !== val) {
        next[k] = val;
        changes.push(`${DETAIL_FIELDS[k]}: ${before[k] || "—"} → ${val || "—"}`);
      }
    }
    if (!changes.length) return ok(res, "Nada mudou.");
    await prisma.organization.update({ where: { id: org.id }, data: next });
    await audit(req, actor(req), "tenant.details", { type: "org", id: org.id, label: org.name, meta: { changes } });
    invalidateHealth();
    ok(res, `Dados de ${parsed.data.name} salvos (${changes.length} campo(s)).`);
  }),
);

// ---------------------------------------------------------------------------
// Recursos por plano: módulos extras, estado global, matriz plano × recurso, limites, exceções
// ---------------------------------------------------------------------------

const FEATURE_STATE_LABEL: Record<FeatureState, string> = { on: "Liberado", beta: "Beta", off: "Desligado" };

/** Everyone that isn't canceled, with what they can use today. */
async function entitlementsOfAll() {
  const orgs = await prisma.organization.findMany({ where: { status: { not: "canceled" } }, select: { id: true, name: true, plan: true } });
  const [planRows, globals, overrides] = await Promise.all([
    prisma.plan.findMany({ select: { key: true, features: true, limits: true } }),
    featureGlobals(),
    prisma.orgFeatureOverride.findMany({ select: { organizationId: true, featureKey: true, enabled: true, endsAt: true } }),
  ]);
  return orgs.map((o) => {
    const planKey = String(o.plan || "starter").toLowerCase();
    return {
      org: o,
      ent: resolveEntitlements({ plan: planRows.find((p) => p.key === planKey) ?? null, planKey, globals, overrides: overrides.filter((x) => x.organizationId === o.id) }),
      overrides: overrides.filter((x) => x.organizationId === o.id),
    };
  });
}

function asObj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

masterRouter.get(
  "/recursos",
  requireCap("billing_full"),
  h(async (req, res) => {
    const [catalog, globals, all] = await Promise.all([refreshPlans(), featureGlobals(), entitlementsOfAll()]);
    const now = Date.now();
    const features = FEATURES.map((f) => {
      const state = (globals[f.key] ?? "on") as FeatureState;
      const using = all.filter((x) => x.ent.features[f.key].on).length;
      const exceptions = all.filter((x) => x.overrides.some((o) => o.featureKey === f.key && (!o.endsAt || o.endsAt.getTime() > now))).length;
      return { key: f.key, name: f.name, description: f.description, state, stateLabel: FEATURE_STATE_LABEL[state], using, exceptions };
    });
    const plansView = catalog.map((p) => {
      const pf = asObj(p.features);
      const pl = asObj(p.limits);
      return {
        key: p.key,
        name: p.name,
        companies: all.filter((x) => x.ent.plan === p.key).length,
        features: Object.fromEntries(FEATURES.map((f) => [f.key, pf[f.key] !== false])),
        limits: Object.fromEntries(LIMITS.map((l) => [l.key, typeof pl[l.key] === "number" ? String(pl[l.key]) : ""])),
        includedUsers: p.includedUsers,
      };
    });
    page(res, "recursos", await shell(req, "recursos"), {
      features,
      plans: plansView,
      limits: LIMITS,
      core: CORE_MODULES,
      totalCompanies: all.length,
      canEdit: can(req.master!.role, "plans_manage"),
    });
  }),
);

/** Turning a module off for everyone needs the authenticator code again. */
function stepUpWhenOff(req: MasterRequest, res: Response, next: NextFunction) {
  if (String(req.body?.state || "") === "off") return requireStepUp(req, res, next);
  next();
}

masterRouter.post(
  "/recursos/:key/estado",
  requireCap("plans_manage"),
  stepUpWhenOff,
  h(async (req, res) => {
    const def = featureDef(String(req.params.key));
    if (!def) return fail(res, 404, "Recurso não encontrado.");
    const state = String(req.body?.state || "") as FeatureState;
    if (!["on", "beta", "off"].includes(state)) return fail(res, 400, "Escolha Liberado, Beta ou Desligado.");
    const before = (await featureGlobals())[def.key] ?? "on";
    if (before === state) return ok(res, `${def.name} já está ${FEATURE_STATE_LABEL[state].toLowerCase()}.`);
    const usingBefore = (await entitlementsOfAll()).filter((x) => x.ent.features[def.key].on).length;
    await prisma.platformFeature.upsert({
      where: { key: def.key },
      create: { key: def.key, state, updatedByName: req.master!.name },
      update: { state, updatedByName: req.master!.name },
    });
    invalidateEntitlements();
    const usingAfter = (await entitlementsOfAll()).filter((x) => x.ent.features[def.key].on).length;
    await audit(req, actor(req), "feature.state", { type: "feature", label: def.name, meta: { from: before, to: state, companiesBefore: usingBefore, companiesAfter: usingAfter } }, state === "off");
    const diff = usingAfter - usingBefore;
    ok(res, `${def.name}: ${FEATURE_STATE_LABEL[state]}.${diff ? ` ${Math.abs(diff)} empresa(s) ${diff > 0 ? "ganharam" : "perderam"} acesso.` : ""}`);
  }),
);

masterRouter.post(
  "/recursos/plano/:key",
  requireCap("plans_manage"),
  h(async (req, res) => {
    const plan = await prisma.plan.findUnique({ where: { key: String(req.params.key) } });
    if (!plan) return fail(res, 404, "Plano não encontrado.");
    const features: Record<string, boolean> = {};
    for (const f of FEATURES) features[f.key] = req.body?.[`f_${f.key}`] === "1";
    const limits: Record<string, number | null> = {};
    for (const l of LIMITS) {
      const raw = String(req.body?.[`l_${l.key}`] ?? "").trim();
      if (raw === "") limits[l.key] = null;
      else {
        const n = Number(raw);
        if (!Number.isInteger(n) || n < 0 || n > 1_000_000) return fail(res, 400, `${l.name}: use um número inteiro (ou deixe vazio para sem limite).`);
        limits[l.key] = n;
      }
    }
    const beforeAll = await entitlementsOfAll();
    const beforeFeatures = asObj(plan.features);
    const beforeLimits = asObj(plan.limits);
    await prisma.plan.update({ where: { id: plan.id }, data: { features, limits } });
    invalidateEntitlements();
    await refreshPlans();
    const afterAll = await entitlementsOfAll();
    // Who gained or lost a module with this change (only companies on this plan can change).
    let lost = 0;
    let gained = 0;
    for (const a of afterAll) {
      const b = beforeAll.find((x) => x.org.id === a.org.id);
      if (!b) continue;
      for (const f of FEATURES) {
        if (b.ent.features[f.key].on && !a.ent.features[f.key].on) lost++;
        if (!b.ent.features[f.key].on && a.ent.features[f.key].on) gained++;
      }
    }
    // Companies already above a new limit keep working; only adding more is blocked.
    const over: string[] = [];
    for (const l of LIMITS) {
      const lim = limits[l.key];
      if (lim == null) continue;
      for (const a of afterAll.filter((x) => x.ent.plan === plan.key)) {
        const u = await getUsage(a.org.id);
        if (u[l.key] > lim) over.push(`${a.org.name} (${l.name.toLowerCase()} ${u[l.key]}/${lim})`);
      }
    }
    const changes = [
      ...FEATURES.filter((f) => (beforeFeatures[f.key] !== false) !== features[f.key]).map((f) => `${f.name}: ${features[f.key] ? "incluído" : "fora do plano"}`),
      ...LIMITS.filter((l) => (beforeLimits[l.key] ?? null) !== limits[l.key]).map((l) => `${l.name}: ${beforeLimits[l.key] ?? "sem limite"} → ${limits[l.key] ?? "sem limite"}`),
    ];
    if (!changes.length) return ok(res, "Nada mudou.");
    await audit(req, actor(req), "plan.features", { type: "plan", label: plan.name, meta: { changes, lost, gained, over: over.slice(0, 20) } });
    const parts = [`${plan.name} atualizado.`];
    if (lost) parts.push(`${lost} acesso(s) a módulo(s) removido(s).`);
    if (gained) parts.push(`${gained} acesso(s) liberado(s).`);
    ok(res, parts.join(" "), over.length ? { warn: `Já passam do novo limite (continuam funcionando, só não adicionam mais): ${over.slice(0, 5).join(", ")}${over.length > 5 ? "…" : ""}` } : {});
  }),
);

const overrideSchema = z.object({
  featureKey: z.string(),
  enabled: z.enum(["1", "0"]),
  reason: z.string().trim().min(3).max(300),
  endsAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("")),
});

masterRouter.post(
  "/clientes/:id/recursos/excecao",
  requireCap("billing_manage"),
  h(async (req, res) => {
    const org = await orgOr404(req, res);
    if (!org) return;
    const parsed = overrideSchema.safeParse(req.body);
    if (!parsed.success) return fail(res, 400, "Escolha o recurso, ligar ou desligar, e escreva o motivo.");
    const def = featureDef(parsed.data.featureKey);
    if (!def) return fail(res, 400, "Recurso inválido.");
    // Valid through the whole chosen day in Denver.
    const endsAt = parsed.data.endsAt ? new Date(`${parsed.data.endsAt}T23:59:00-07:00`) : null;
    if (endsAt && endsAt.getTime() <= Date.now()) return fail(res, 400, "A data de fim precisa ser no futuro.");
    const enabled = parsed.data.enabled === "1";
    await prisma.orgFeatureOverride.upsert({
      where: { organizationId_featureKey: { organizationId: org.id, featureKey: def.key } },
      create: { organizationId: org.id, featureKey: def.key, enabled, reason: parsed.data.reason, endsAt, createdByName: req.master!.name },
      update: { enabled, reason: parsed.data.reason, endsAt, createdByName: req.master!.name, createdAt: new Date() },
    });
    invalidateEntitlements(org.id);
    await audit(req, actor(req), "feature.override", { type: "org", id: org.id, label: org.name, meta: { feature: def.key, enabled, reason: parsed.data.reason, endsAt: parsed.data.endsAt || null } });
    const globals = await featureGlobals();
    ok(res, `${def.name} ${enabled ? "ligado" : "desligado"} para ${org.name}${endsAt ? ` até ${shortDate(endsAt)}` : ""}.`, globals[def.key] === "off" && enabled ? { warn: `${def.name} está desligado para todos; a exceção só vale quando voltar a ficar liberado ou em beta.` } : {});
  }),
);

masterRouter.post(
  "/clientes/:id/recursos/excecao/:key/remover",
  requireCap("billing_manage"),
  h(async (req, res) => {
    const org = await orgOr404(req, res);
    if (!org) return;
    const def = featureDef(String(req.params.key));
    if (!def) return fail(res, 404, "Recurso não encontrado.");
    const r = await prisma.orgFeatureOverride.deleteMany({ where: { organizationId: org.id, featureKey: def.key } });
    invalidateEntitlements(org.id);
    if (r.count) await audit(req, actor(req), "feature.override_remove", { type: "org", id: org.id, label: org.name, meta: { feature: def.key } });
    ok(res, `${def.name} volta a seguir o plano.`);
  }),
);

/** "Recursos e uso" block of the company record. */
async function featuresForRecord(organizationId: string) {
  const [ent, usage, overrides] = await Promise.all([
    getEntitlements(organizationId),
    getUsage(organizationId),
    prisma.orgFeatureOverride.findMany({ where: { organizationId } }),
  ]);
  const now = Date.now();
  return {
    features: FEATURES.map((f) => {
      const e = ent.features[f.key];
      const ov = overrides.find((o) => o.featureKey === f.key);
      const ovActive = !!ov && (!ov.endsAt || ov.endsAt.getTime() > now);
      return {
        key: f.key,
        name: f.name,
        on: e.on,
        source:
          e.source === "global_off"
            ? "desligado para todos"
            : e.source === "beta"
              ? "beta · sem exceção"
              : e.source === "override"
                ? `exceção${ov?.endsAt ? ` até ${shortDate(ov.endsAt)}` : ""}`
                : "pelo plano",
        override: ovActive ? { enabled: ov!.enabled, reason: ov!.reason, by: ov!.createdByName, endsAt: ov!.endsAt ? shortDate(ov!.endsAt) : null } : null,
      };
    }),
    limits: LIMITS.map((l) => {
      const limit = ent.limits[l.key];
      const used = usage[l.key];
      const pct = limit ? Math.min(100, Math.round((used / limit) * 100)) : 0;
      return { key: l.key, name: l.name, used, limit, pct, tone: limit == null ? "none" : pct >= 100 ? "danger" : pct >= 80 ? "warn" : "ok" };
    }),
    featureOptions: FEATURES.map((f) => ({ key: f.key, name: f.name })),
  };
}


// ---------------------------------------------------------------------------
// Comunicação: avisos no app, modelos de e-mail, envios, remetente
// ---------------------------------------------------------------------------

const EMAIL_STATUS: Record<string, Pill & { hint: string }> = {
  console: { label: "Modo teste", tone: "muted", hint: "E-mail em modo console: só apareceu no log do servidor" },
  sent: { label: "Enviado", tone: "soft", hint: "O Resend aceitou; esperando o servidor do destinatário" },
  delayed: { label: "Atrasado", tone: "warn", hint: "O servidor do destinatário está demorando; o Resend tenta de novo" },
  delivered: { label: "Entregue", tone: "ink", hint: "Chegou na caixa do destinatário" },
  opened: { label: "Aberto", tone: "ink", hint: "O destinatário abriu" },
  clicked: { label: "Clicou", tone: "ink", hint: "O destinatário clicou num link" },
  bounced: { label: "Voltou", tone: "danger", hint: "Endereço não existe ou recusou. Fica bloqueado" },
  complained: { label: "Spam", tone: "danger", hint: "O destinatário marcou como spam. Fica bloqueado" },
  failed: { label: "Falhou", tone: "danger", hint: "Não saiu do sistema" },
  blocked: { label: "Bloqueado", tone: "warn", hint: "Não enviado: endereço na lista de bloqueados" },
};
const EMAIL_STATUS_FILTERS: [string, string, string[] | null][] = [
  ["todos", "Todos", null],
  ["entregues", "Entregues", ["delivered", "opened", "clicked"]],
  ["enviados", "A caminho", ["sent", "delayed"]],
  ["problema", "Com problema", ["bounced", "complained", "failed", "blocked"]],
];
const EMAIL_CATEGORY: Record<string, string> = { platform: "ObraMate → empresa", company: "Empresa → clientes", internal: "Equipe interna" };
const ANN_KIND: Record<string, Pill> = { info: { label: "Informação", tone: "soft" }, maintenance: { label: "Manutenção", tone: "warn" }, urgent: { label: "Urgente", tone: "danger" } };

let emailCountCache: { at: number; n: number } | null = null;
/** Bounces / spam complaints in the last 7 days (menu badge). */
async function emailProblemCount(): Promise<number> {
  if (emailCountCache && Date.now() - emailCountCache.at < 60_000) return emailCountCache.n;
  const n = await prisma.platformEmailLog.count({ where: { status: { in: ["bounced", "complained"] }, createdAt: { gte: new Date(Date.now() - 7 * 86400e3) } } }).catch(() => 0);
  emailCountCache = { at: Date.now(), n };
  return n;
}

async function commsProblems() {
  const now = new Date();
  const [bounced, urgent] = await Promise.all([
    emailProblemCount(),
    prisma.platformAnnouncement.findFirst({ where: { kind: "urgent", startsAt: { lte: now }, endedAt: null, OR: [{ endsAt: null }, { endsAt: { gt: now } }] }, select: { title: true } }),
  ]);
  const consoleInProd = process.env.NODE_ENV === "production" && !getEmailTransportStatus().ready;
  return { bounced, urgent, consoleInProd };
}

/** ISO → "YYYY-MM-DDTHH:mm" on the Denver wall clock (datetime-local value). */
function isoToDenverLocal(d: Date | null): string {
  if (!d) return "";
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Denver", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d).replace(" ", "T");
}

function annState(a: { startsAt: Date; endsAt: Date | null; endedAt: Date | null }, now = new Date()): { key: "live" | "scheduled" | "ended"; pill: Pill } {
  if (a.endedAt || (a.endsAt && a.endsAt <= now)) return { key: "ended", pill: { label: "Encerrado", tone: "muted" } };
  if (a.startsAt > now) return { key: "scheduled", pill: { label: "Programado", tone: "soft" } };
  return { key: "live", pill: { label: "No ar", tone: "ink" } };
}

masterRouter.get(
  "/comunicacao",
  h(async (req, res) => {
    const tab = ["avisos", "modelos", "envios", "remetente"].includes(String(req.query.aba)) ? String(req.query.aba) : "avisos";
    const data: Record<string, unknown> = { tab, canComms: can(req.master!.role, "comms_manage") };
    const now = new Date();

    if (tab === "avisos") {
      const [rows, orgs] = await Promise.all([
        prisma.platformAnnouncement.findMany({ orderBy: { startsAt: "desc" }, take: 60 }),
        prisma.organization.findMany({ where: { status: { not: "canceled" } }, select: { id: true, name: true, plan: true, status: true }, orderBy: { name: "asc" } }),
      ]);
      const reach = await reachOf(rows.map((r) => r.id));
      const orgName = new Map(orgs.map((o) => [o.id, o.name]));
      const items = await Promise.all(
        rows.map(async (a) => {
          const st = annState(a, now);
          const r = reach.get(a.id)!;
          const names = a.organizationIds.map((id) => orgName.get(id) ?? "empresa removida");
          return {
            id: a.id,
            title: a.title,
            body: a.body,
            kind: a.kind,
            kindPill: ANN_KIND[a.kind] ?? ANN_KIND.info,
            state: st.key,
            statePill: st.pill,
            audience: a.audience,
            plans: a.plans,
            organizationIds: a.organizationIds,
            audienceText:
              a.audience === "plans"
                ? `Planos: ${a.plans.map((p) => planLabel(p)).join(", ")}`
                : a.audience === "companies"
                  ? `${names.length} empresa(s): ${names.slice(0, 3).join(", ")}${names.length > 3 ? "…" : ""}`
                  : "Todas as empresas",
            target: st.key === "ended" ? null : await targetCount(a),
            period: `${dateTimeLabel(a.startsAt)} → ${a.endedAt ? `tirado do ar ${dateTimeLabel(a.endedAt)}` : a.endsAt ? dateTimeLabel(a.endsAt) : "até tirar do ar"}`,
            seen: r.seen,
            closed: r.closed,
            companies: r.companies,
            linkUrl: a.linkUrl,
            linkLabel: a.linkLabel,
            startsLocal: isoToDenverLocal(a.startsAt),
            endsLocal: isoToDenverLocal(a.endsAt),
            by: a.createdByName,
          };
        }),
      );
      data.live = items.filter((i) => i.state === "live");
      data.scheduled = items.filter((i) => i.state === "scheduled");
      data.ended = items.filter((i) => i.state === "ended").slice(0, 15);
      data.kinds = KINDS;
      data.planOpts = Object.keys(PLAN_LABEL).map((k) => ({ key: k, label: planLabel(k), count: orgs.filter((o) => o.plan === k && o.status !== "suspended").length }));
      data.orgOpts = orgs.filter((o) => o.status !== "suspended").map((o) => ({ id: o.id, name: o.name, plan: planLabel(o.plan) }));
      data.totalOrgs = await targetCount({ audience: "all", plans: [], organizationIds: [] });
    }

    if (tab === "modelos") {
      const ov = await overrides();
      const groups = ["Conta", "Cobrança", "Suporte", "Builders"].map((g) => ({
        name: g,
        items: TEMPLATES.filter((t) => t.group === g).map((t) => ({
          key: t.key,
          name: t.name,
          when: t.when,
          langs: LOCALES.map((l) => {
            const o = ov.get(`${t.key}:${l.key}`);
            return { key: l.key, label: l.label, edited: !!o, by: o?.updatedByName, at: o ? shortDate(o.updatedAt) : null };
          }),
        })),
      }));
      const sentByKey = await prisma.platformEmailLog.groupBy({ by: ["templateKey"], where: { category: "platform", createdAt: { gte: new Date(Date.now() - 30 * 86400e3) } }, _count: { _all: true } });
      data.groups = groups;
      data.sent30 = Object.fromEntries(sentByKey.map((r) => [r.templateKey ?? "", r._count._all]));
      data.localeMode = await getLocaleMode();
    }

    if (tab === "envios") {
      const fKey = EMAIL_STATUS_FILTERS.some(([k]) => k === req.query.status) ? String(req.query.status) : "todos";
      const statuses = EMAIL_STATUS_FILTERS.find(([k]) => k === fKey)![2];
      const cat = String(req.query.tipo || "");
      const q = String(req.query.q || "").trim().toLowerCase().slice(0, 120);
      const org = String(req.query.empresa || "");
      const where: Record<string, unknown> = {};
      if (statuses) where.status = { in: statuses };
      if (cat in EMAIL_CATEGORY) where.category = cat;
      if (/^[0-9a-f-]{36}$/i.test(org)) where.organizationId = org;
      if (q) where.OR = [{ toEmail: { contains: q, mode: "insensitive" } }, { subject: { contains: q, mode: "insensitive" } }];
      const since7 = new Date(Date.now() - 7 * 86400e3);
      const [rows, total7, counts7, blockedRows] = await Promise.all([
        prisma.platformEmailLog.findMany({ where, orderBy: { createdAt: "desc" }, take: 150 }),
        prisma.platformEmailLog.count({ where: { createdAt: { gte: since7 } } }),
        prisma.platformEmailLog.groupBy({ by: ["status"], where: { createdAt: { gte: since7 } }, _count: { _all: true } }),
        prisma.emailSuppression.findMany({ orderBy: { createdAt: "desc" }, take: 100 }),
      ]);
      const c = Object.fromEntries(counts7.map((r) => [r.status, r._count._all])) as Record<string, number>;
      const sum = (ks: string[]) => ks.reduce((n, k) => n + (c[k] ?? 0), 0);
      const real = total7 - sum(["console", "blocked"]);
      const orgIds = [...new Set(rows.map((r) => r.organizationId).filter(Boolean))] as string[];
      const orgNames = new Map((await prisma.organization.findMany({ where: { id: { in: orgIds } }, select: { id: true, name: true } })).map((o) => [o.id, o.name]));
      const tplName = new Map(TEMPLATES.map((t) => [t.key, t.name]));
      data.kpis = {
        total: total7,
        delivered: real ? Math.round((sum(["delivered", "opened", "clicked"]) / real) * 100) : null,
        opened: real ? Math.round((sum(["opened", "clicked"]) / real) * 100) : null,
        problems: sum(["bounced", "complained", "failed"]),
        blocked: c.blocked ?? 0,
        console: c.console ?? 0,
      };
      data.filters = EMAIL_STATUS_FILTERS.map(([k, label]) => ({ key: k, label, active: k === fKey }));
      data.cats = Object.entries(EMAIL_CATEGORY).map(([k, label]) => ({ key: k, label, active: k === cat }));
      data.q = q;
      data.cat = cat;
      data.statusKey = fKey;
      data.orgFilter = /^[0-9a-f-]{36}$/i.test(org) ? { id: org, name: orgNames.get(org) ?? (await prisma.organization.findUnique({ where: { id: org }, select: { name: true } }))?.name ?? "empresa" } : null;
      data.rows = rows.map((r) => {
        const st = EMAIL_STATUS[r.status] ?? { label: r.status, tone: "muted", hint: "" };
        const events = (Array.isArray(r.events) ? (r.events as { type: string; at: string }[]) : []).map((e) => `${EMAIL_STATUS[e.type]?.label ?? e.type} ${dateTimeLabel(new Date(e.at))}`);
        return {
          when: dateTimeLabel(r.createdAt),
          to: r.toEmail,
          subject: r.subject,
          kind: r.templateKey ? tplName.get(r.templateKey) ?? (r.templateKey === "master_access" ? "Acesso ao Master" : r.templateKey === "ops_alert" ? "Alerta de serviço" : r.templateKey) : EMAIL_CATEGORY[r.category] ?? r.category,
          category: EMAIL_CATEGORY[r.category] ?? r.category,
          org: r.organizationId ? { id: r.organizationId, name: orgNames.get(r.organizationId) ?? "empresa" } : null,
          status: st,
          error: r.error,
          trail: events.join(" · "),
        };
      });
      data.blocked = blockedRows.map((b) => ({ email: b.email, reason: b.reason === "complaint" ? "Marcou como spam" : b.reason === "manual" ? `Bloqueado à mão${b.createdByName ? ` por ${b.createdByName}` : ""}` : "Voltou (bounce)", detail: b.detail, when: shortDate(b.createdAt) }));
      data.days = EMAIL_LOG_DAYS;
    }

    if (tab === "remetente") {
      const st = await senderStatus(String(req.query.checar || "") === "1");
      data.sender = { ...st, lastEventText: st.webhook.lastEventAt ? dateTimeLabel(new Date(st.webhook.lastEventAt)) : null, checkedText: dateTimeLabel(new Date(st.checkedAt)) };
      data.webhookUrl = `${env.APP_BASE_URL.replace(/\/$/, "")}/webhooks/resend`;
      data.localeMode = await getLocaleMode();
    }

    page(res, "comunicacao", await shell(req, "comunicacao"), data);
  }),
);

const announcementSchema = z.object({
  kind: z.enum(["info", "maintenance", "urgent"]),
  title: z.string().trim().min(3, "Escreva um título.").max(80),
  body: z.string().trim().max(400).optional().default(""),
  audience: z.enum(["all", "plans", "companies"]),
  plans: z.union([z.string(), z.array(z.string())]).optional(),
  orgs: z.union([z.string(), z.array(z.string())]).optional(),
  linkUrl: z.string().trim().max(500).optional().default(""),
  linkLabel: z.string().trim().max(30).optional().default(""),
  startsAt: z.string().optional().default(""),
  endsAt: z.string().optional().default(""),
});
const asArray = (v: string | string[] | undefined) => (v == null ? [] : Array.isArray(v) ? v : [v]).map((x) => String(x).trim()).filter(Boolean);

/** Validates the form; returns data for Prisma or a message. */
async function announcementData(body: unknown, current?: { startsAt: Date }): Promise<{ data: Record<string, unknown> } | { error: string }> {
  const parsed = announcementSchema.safeParse(body);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message || "Confira os campos." };
  const d = parsed.data;
  const plans = asArray(d.plans).filter((p) => p in PLAN_LABEL);
  const orgIds = asArray(d.orgs).filter((id) => /^[0-9a-f-]{36}$/i.test(id));
  if (d.audience === "plans" && !plans.length) return { error: "Escolha pelo menos um plano." };
  if (d.audience === "companies" && !orgIds.length) return { error: "Escolha pelo menos uma empresa." };
  if (d.linkUrl && !/^(https:\/\/|\/)[^\s<>"]+$/.test(d.linkUrl)) return { error: "O link precisa começar com https:// (ou / para uma tela do ObraMate)." };
  const startsAt = d.startsAt ? denverLocalToIso(d.startsAt) : null;
  if (d.startsAt && !startsAt) return { error: "Data de início inválida." };
  const endsAt = d.endsAt ? denverLocalToIso(d.endsAt) : null;
  if (d.endsAt && !endsAt) return { error: "Data de fim inválida." };
  const start = startsAt ? new Date(startsAt) : current?.startsAt ?? new Date();
  if (endsAt && new Date(endsAt) <= start) return { error: "O fim precisa ser depois do início." };
  if (endsAt && new Date(endsAt) <= new Date()) return { error: "O fim precisa ser no futuro." };
  return {
    data: {
      kind: d.kind,
      title: d.title,
      body: d.body,
      audience: d.audience,
      plans: d.audience === "plans" ? plans : [],
      organizationIds: d.audience === "companies" ? orgIds : [],
      linkUrl: d.linkUrl || null,
      linkLabel: d.linkUrl ? d.linkLabel || "Saiba mais" : null,
      startsAt: start,
      endsAt: endsAt ? new Date(endsAt) : null,
    },
  };
}

function stepUpWhenWide(req: MasterRequest, res: Response, next: NextFunction) {
  // An urgent notice for every company is the loudest thing the Master can do: confirm with 2FA.
  if (String(req.body?.kind) === "urgent" && String(req.body?.audience) === "all") return requireStepUp(req, res, next);
  next();
}

masterRouter.post(
  "/comunicacao/avisos",
  requireCap("comms_manage"),
  stepUpWhenWide,
  h(async (req, res) => {
    const r = await announcementData(req.body);
    if ("error" in r) return fail(res, 400, r.error);
    const a = await prisma.platformAnnouncement.create({ data: { ...(r.data as never as object), createdById: req.master!.id, createdByName: req.master!.name } as never });
    const target = await targetCount(a);
    await audit(req, actor(req), "comms.announcement_create", { type: "announcement", id: a.id, label: a.title, meta: { kind: a.kind, audience: a.audience, target } }, a.kind === "urgent" && a.audience === "all");
    const scheduled = a.startsAt > new Date();
    ok(res, scheduled ? `Aviso programado para ${dateTimeLabel(a.startsAt)} · ${target} empresa(s).` : `Aviso no ar para ${target} empresa(s). Aparece na próxima tela que abrirem.`);
  }),
);

masterRouter.post(
  "/comunicacao/avisos/:id",
  requireCap("comms_manage"),
  stepUpWhenWide,
  h(async (req, res) => {
    const cur = await prisma.platformAnnouncement.findUnique({ where: { id: String(req.params.id) } }).catch(() => null);
    if (!cur) return fail(res, 404, "Aviso não encontrado.");
    if (annState(cur).key === "ended") return fail(res, 400, "Esse aviso já foi encerrado. Crie um novo.");
    const r = await announcementData(req.body, cur);
    if ("error" in r) return fail(res, 400, r.error);
    const a = await prisma.platformAnnouncement.update({ where: { id: cur.id }, data: r.data as never });
    await audit(req, actor(req), "comms.announcement_update", { type: "announcement", id: a.id, label: a.title, meta: { kind: a.kind, audience: a.audience } });
    ok(res, "Aviso atualizado.");
  }),
);

masterRouter.post(
  "/comunicacao/avisos/:id/encerrar",
  requireCap("comms_manage"),
  h(async (req, res) => {
    const cur = await prisma.platformAnnouncement.findUnique({ where: { id: String(req.params.id) } }).catch(() => null);
    if (!cur) return fail(res, 404, "Aviso não encontrado.");
    if (cur.endedAt) return ok(res, "Esse aviso já estava fora do ar.");
    await prisma.platformAnnouncement.update({ where: { id: cur.id }, data: { endedAt: new Date() } });
    await audit(req, actor(req), "comms.announcement_end", { type: "announcement", id: cur.id, label: cur.title });
    ok(res, "Aviso tirado do ar. Some da tela das empresas na próxima página.");
  }),
);

// ----- Modelos de e-mail -----

masterRouter.get(
  "/comunicacao/modelos/:key",
  h(async (req, res) => {
    const def = templateDef(String(req.params.key));
    if (!def) return void res.status(404).render("master/error", { title: "Modelo não encontrado", message: "Esse modelo de e-mail não existe." });
    const lang = (String(req.query.lang) === "pt" ? "pt" : "en") as Locale;
    const text = await activeText(def.key, lang);
    const other = await activeText(def.key, lang === "pt" ? "en" : "pt");
    const preview = render(text, sampleVars(def), lang);
    const last = await prisma.platformEmailLog.findFirst({ where: { templateKey: def.key }, orderBy: { createdAt: "desc" }, select: { createdAt: true } });
    const sent30 = await prisma.platformEmailLog.count({ where: { templateKey: def.key, createdAt: { gte: new Date(Date.now() - 30 * 86400e3) } } });
    page(res, "modelo-email", await shell(req, "comunicacao"), {
      def,
      lang,
      langs: LOCALES,
      text: { subject: text.subject, body: text.body, button: text.button ?? "" },
      edited: text.edited,
      editedBy: text.updatedByName ?? null,
      editedAt: text.updatedAt ? dateTimeLabel(text.updatedAt) : null,
      otherEdited: other.edited,
      defaults: def.defaults[lang],
      hasButton: def.vars.some((v) => v.key === "link"),
      previewHtml: preview.html,
      previewSubject: preview.subject,
      canComms: can(req.master!.role, "comms_manage"),
      me: req.master!,
      lastSent: last ? dateTimeLabel(last.createdAt) : null,
      sent30,
      localeMode: await getLocaleMode(),
    });
  }),
);

const templateSchema = z.object({
  lang: z.enum(["en", "pt"]),
  subject: z.string().trim().min(3, "Escreva o assunto.").max(160),
  body: z.string().trim().min(10, "Escreva o texto do e-mail.").max(4000),
  button: z.string().trim().max(40).optional().default(""),
});

function checkTemplate(def: TemplateDef, t: { subject: string; body: string; button?: string }): string | null {
  const unknown = unknownVars(def, t.subject, t.body);
  if (unknown.length) return `Variável que não existe neste e-mail: ${unknown.map((u) => `{{${u}}}`).join(", ")}.`;
  const missing = missingRequired(def, t);
  if (missing.length) {
    return missing.includes("link")
      ? "Este e-mail precisa do link: mantenha a linha {{button}} (com o texto do botão preenchido) ou escreva {{link}} no texto."
      : `Este e-mail precisa de ${missing.map((m) => `{{${m}}}`).join(", ")} no texto.`;
  }
  return null;
}

masterRouter.post(
  "/comunicacao/modelos/:key/previa",
  h(async (req, res) => {
    const def = templateDef(String(req.params.key));
    if (!def) return fail(res, 404, "Modelo não encontrado.");
    const lang = (String(req.body?.lang) === "pt" ? "pt" : "en") as Locale;
    const t = { subject: String(req.body?.subject || ""), body: String(req.body?.body || ""), button: String(req.body?.button || "") || undefined };
    const out = render(t, sampleVars(def), lang);
    res.json({ ok: true, subject: out.subject, html: out.html, problem: checkTemplate(def, t) });
  }),
);

masterRouter.post(
  "/comunicacao/modelos/:key",
  requireCap("comms_manage"),
  h(async (req, res) => {
    const def = templateDef(String(req.params.key));
    if (!def) return fail(res, 404, "Modelo não encontrado.");
    const parsed = templateSchema.safeParse(req.body);
    if (!parsed.success) return fail(res, 400, parsed.error.issues[0]?.message || "Confira os campos.");
    const d = parsed.data;
    const problem = checkTemplate(def, { subject: d.subject, body: d.body, button: d.button });
    if (problem) return fail(res, 400, problem);
    const dflt = def.defaults[d.lang];
    const same = dflt.subject === d.subject && dflt.body.replace(/\r\n/g, "\n") === d.body.replace(/\r\n/g, "\n") && (dflt.button ?? "") === d.button;
    if (same) {
      await prisma.platformEmailTemplate.deleteMany({ where: { key: def.key, locale: d.lang } });
    } else {
      const data = { subject: d.subject, body: d.body.replace(/\r\n/g, "\n"), buttonLabel: d.button || null, updatedById: req.master!.id, updatedByName: req.master!.name };
      await prisma.platformEmailTemplate.upsert({ where: { key_locale: { key: def.key, locale: d.lang } }, create: { key: def.key, locale: d.lang, ...data }, update: data });
    }
    clearTemplateCache();
    await audit(req, actor(req), "comms.template_save", { type: "email_template", label: `${def.name} (${d.lang === "pt" ? "português" : "inglês"})`, meta: { key: def.key, lang: d.lang, subject: d.subject } });
    ok(res, same ? "Igual ao padrão — voltou para o texto padrão." : "Modelo salvo. Os próximos e-mails já saem com o texto novo.");
  }),
);

masterRouter.post(
  "/comunicacao/modelos/:key/teste",
  requireCap("comms_manage"),
  h(async (req, res) => {
    const def = templateDef(String(req.params.key));
    if (!def) return fail(res, 404, "Modelo não encontrado.");
    const parsed = templateSchema.safeParse(req.body);
    if (!parsed.success) return fail(res, 400, parsed.error.issues[0]?.message || "Confira os campos.");
    const d = parsed.data;
    const out = render({ subject: d.subject, body: d.body, button: d.button || undefined }, sampleVars(def), d.lang);
    const sent = await emailProvider
      .send({ to: req.master!.email, subject: `[Teste] ${out.subject}`, text: out.text, html: out.html, meta: { category: "internal", template: def.key, organizationId: null } })
      .catch((e: unknown) => ({ error: e instanceof Error ? e.message : "Falha ao enviar" }));
    if ("error" in sent) return fail(res, 502, `Não enviou: ${sent.error}`);
    await audit(req, actor(req), "comms.template_test", { type: "email_template", label: def.name, meta: { key: def.key, lang: d.lang } });
    ok(res, sent.transport === "resend" ? `Teste enviado para ${req.master!.email} (texto da tela, mesmo sem salvar).` : `Modo console: o teste foi para o log do servidor, não para ${req.master!.email}.`, { warn: sent.transport !== "resend" });
  }),
);

masterRouter.post(
  "/comunicacao/modelos/:key/padrao",
  requireCap("comms_manage"),
  h(async (req, res) => {
    const def = templateDef(String(req.params.key));
    if (!def) return fail(res, 404, "Modelo não encontrado.");
    const lang = String(req.body?.lang) === "pt" ? "pt" : "en";
    const r = await prisma.platformEmailTemplate.deleteMany({ where: { key: def.key, locale: lang } });
    clearTemplateCache();
    if (r.count) await audit(req, actor(req), "comms.template_reset", { type: "email_template", label: `${def.name} (${lang === "pt" ? "português" : "inglês"})`, meta: { key: def.key, lang } });
    ok(res, r.count ? "Texto padrão restaurado." : "Já estava no texto padrão.");
  }),
);

masterRouter.post(
  "/comunicacao/idioma",
  requireCap("comms_manage"),
  h(async (req, res) => {
    const mode = String(req.body?.mode) === "company" ? "company" : "en";
    await setLocaleMode(mode);
    await audit(req, actor(req), "comms.locale", { type: "setting", label: "Idioma dos e-mails", meta: { mode } });
    ok(res, mode === "company" ? "E-mails saem no idioma de cada empresa (português ou inglês)." : "E-mails saem sempre em inglês.");
  }),
);

// ----- Bloqueados -----

masterRouter.post(
  "/comunicacao/bloqueados",
  requireCap("comms_manage"),
  h(async (req, res) => {
    const email = String(req.body?.email || "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail(res, 400, "E-mail inválido.");
    await prisma.emailSuppression.upsert({ where: { email }, create: { email, reason: "manual", detail: String(req.body?.note || "").trim().slice(0, 200) || null, createdByName: req.master!.name }, update: {} });
    await audit(req, actor(req), "comms.block", { type: "email", label: email });
    ok(res, `${email} bloqueado. O sistema não envia mais nada para esse endereço.`);
  }),
);

masterRouter.post(
  "/comunicacao/bloqueados/liberar",
  requireCap("comms_manage"),
  h(async (req, res) => {
    const email = String(req.body?.email || "").trim().toLowerCase();
    const r = await prisma.emailSuppression.deleteMany({ where: { email } });
    if (!r.count) return fail(res, 404, "Esse endereço não estava bloqueado.");
    emailCountCache = null;
    await audit(req, actor(req), "comms.unblock", { type: "email", label: email });
    ok(res, `${email} liberado. Se voltar de novo, é bloqueado de novo.`);
  }),
);

// ---------------------------------------------------------------------------
// Dados e privacidade: exportar empresa, pedidos de privacidade, excluir pessoa / empresa
// ---------------------------------------------------------------------------

const EXPORT_STATUS: Record<string, Pill> = {
  queued: { label: "Na fila", tone: "soft" },
  running: { label: "Gerando…", tone: "soft" },
  ready: { label: "Pronta", tone: "ink" },
  failed: { label: "Falhou", tone: "danger" },
  expired: { label: "Expirou", tone: "muted" },
};
const PRIVACY_STATUS: Record<string, Pill> = {
  received: { label: "Recebido", tone: "warn" },
  in_progress: { label: "Em andamento", tone: "soft" },
  done: { label: "Concluído", tone: "ink" },
  rejected: { label: "Recusado", tone: "muted" },
};

function sizeText(n: bigint | number | null): string {
  if (n == null) return "—";
  const b = Number(n);
  if (b < 1024 * 1024) return `${Math.max(1, Math.round(b / 1024))} KB`;
  if (b < 1024 ** 3) return `${(b / 1024 / 1024).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} MB`;
  return `${(b / 1024 ** 3).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} GB`;
}

function exportView(e: Awaited<ReturnType<typeof prisma.dataExport.findFirstOrThrow>>) {
  const now = new Date();
  const left = e.expiresAt ? Math.max(0, Math.ceil((e.expiresAt.getTime() - now.getTime()) / 86400e3)) : null;
  return {
    id: e.id,
    org: { id: e.organizationId, name: e.orgName, slug: e.orgSlug },
    status: e.status,
    pill: EXPORT_STATUS[e.status] ?? { label: e.status, tone: "muted" },
    when: dateTimeLabel(e.createdAt),
    by: e.requestedByName,
    reason: e.reason,
    size: sizeText(e.sizeBytes),
    summary: e.status === "ready" || e.status === "expired" ? `${e.tables} tabelas · ${e.rows.toLocaleString("pt-BR")} linhas · ${e.files} arquivo(s)${e.filesMissing ? ` · ${e.filesMissing} faltando no storage` : ""}` : e.error || "",
    expires: e.status === "ready" && left != null ? (left <= 1 ? "expira amanhã" : `expira em ${left} dias`) : null,
    downloadable: isDownloadable(e, now),
    hasLink: !!e.linkTokenHash && isDownloadable(e, now),
    downloads: e.downloads,
    lastDownload: e.lastDownloadAt ? dateTimeLabel(e.lastDownloadAt) : null,
  };
}

let privacyCountCache: { at: number; n: number } | null = null;
/** Requests due within 7 days or late + exports that failed in 24 h (menu badge). */
async function dataProblemCount(): Promise<number> {
  if (privacyCountCache && Date.now() - privacyCountCache.at < 60_000) return privacyCountCache.n;
  const [due, failed] = await Promise.all([
    privacyAttention().catch(() => []),
    prisma.dataExport.count({ where: { status: "failed", finishedAt: { gte: new Date(Date.now() - 86400e3) } } }).catch(() => 0),
  ]);
  privacyCountCache = { at: Date.now(), n: due.length + failed };
  return privacyCountCache.n;
}

/** Info for the company record (Dados e privacidade). */
async function dataForRecord(organizationId: string) {
  const [exports, check, requests] = await Promise.all([
    prisma.dataExport.findMany({ where: { organizationId }, orderBy: { createdAt: "desc" }, take: 3 }),
    deletionCheck(organizationId),
    prisma.privacyRequest.findMany({ where: { organizationId, status: { in: OPEN_STATUSES } }, orderBy: { dueAt: "asc" }, take: 5 }),
  ]);
  return {
    exports: exports.map(exportView),
    busy: exports.some((e) => e.status === "queued" || e.status === "running"),
    check: {
      ...check,
      exportText: check.exportReady ? `Exportação de ${shortDate(check.exportReady.createdAt)}` : null,
      requestText: check.request ? `Pedido formal recebido ${shortDate(check.request.receivedAt)}` : null,
    },
    requests: requests.map((r) => ({ id: r.id, kind: KIND_LABEL[r.kind] ?? r.kind, days: daysLeft(r.dueAt), requester: r.requesterName })),
  };
}

masterRouter.get(
  "/privacidade",
  h(async (req, res) => {
    const tab = ["pedidos", "exportacoes", "exclusoes"].includes(String(req.query.aba)) ? String(req.query.aba) : "pedidos";
    const data: Record<string, unknown> = {
      tab,
      canPrivacy: can(req.master!.role, "privacy_manage"),
      canExport: can(req.master!.role, "export"),
      canDelete: can(req.master!.role, "data_delete"),
      days: PRIVACY_DAYS,
      exportDays: EXPORT_DAYS,
    };
    if (tab === "pedidos") {
      const show = String(req.query.ver) === "fechados" ? "fechados" : "abertos";
      const rows = await prisma.privacyRequest.findMany({
        where: { status: show === "abertos" ? { in: OPEN_STATUSES } : { notIn: OPEN_STATUSES } },
        orderBy: show === "abertos" ? { dueAt: "asc" } : { closedAt: "desc" },
        take: 100,
      });
      const [openCount, closedCount, lastExports] = await Promise.all([
        prisma.privacyRequest.count({ where: { status: { in: OPEN_STATUSES } } }),
        prisma.privacyRequest.count({ where: { status: { notIn: OPEN_STATUSES } } }),
        prisma.dataExport.findMany({ where: { privacyRequestId: { in: rows.map((r) => r.id) } }, orderBy: { createdAt: "desc" } }),
      ]);
      const deletions = await prisma.dataDeletion.findMany({ where: { privacyRequestId: { in: rows.map((r) => r.id) } }, select: { id: true, privacyRequestId: true, kind: true, createdAt: true } });
      data.show = show;
      data.openCount = openCount;
      data.closedCount = closedCount;
      data.requests = rows.map((r) => {
        const d = daysLeft(r.dueAt);
        const exp = lastExports.find((e) => e.privacyRequestId === r.id);
        const del = deletions.find((x) => x.privacyRequestId === r.id);
        return {
          id: r.id,
          kind: r.kind,
          kindLabel: KIND_LABEL[r.kind] ?? r.kind,
          subjectType: r.subjectType,
          subjectText: r.subjectType === "company" ? "A empresa inteira" : [r.subjectEmail, r.subjectPhone].filter(Boolean).join(" · ") || "Pessoa (sem contato informado)",
          org: r.organizationId ? { id: r.organizationId, name: r.orgName ?? "empresa" } : null,
          requester: `${r.requesterName} · ${r.requesterEmail}`,
          details: r.details,
          status: r.status,
          pill: PRIVACY_STATUS[r.status] ?? { label: r.status, tone: "muted" },
          open: OPEN_STATUSES.includes(r.status),
          received: shortDate(r.receivedAt),
          due: shortDate(r.dueAt),
          dueText: !OPEN_STATUSES.includes(r.status) ? `fechado ${r.closedAt ? shortDate(r.closedAt) : ""}` : d < 0 ? `atrasado ${-d} dia(s)` : d === 0 ? "vence hoje" : `vence em ${d} dia(s)`,
          dueTone: !OPEN_STATUSES.includes(r.status) ? "muted" : d < 0 ? "danger" : d <= 7 ? "warn" : "soft",
          response: r.response,
          by: r.createdByName,
          handledBy: r.handledByName,
          export: exp ? exportView(exp) : null,
          deletion: del ? { id: del.id, when: shortDate(del.createdAt) } : null,
          personHref: r.organizationId && (r.subjectEmail || r.subjectPhone) ? `/master/privacidade/pessoa?empresa=${r.organizationId}${r.subjectEmail ? `&email=${encodeURIComponent(r.subjectEmail)}` : ""}${r.subjectPhone ? `&telefone=${encodeURIComponent(r.subjectPhone)}` : ""}&pedido=${r.id}` : null,
        };
      });
      data.orgOpts = await prisma.organization.findMany({ select: { id: true, name: true, status: true }, orderBy: { name: "asc" } });
    }
    if (tab === "exportacoes") {
      const rows = await prisma.dataExport.findMany({ orderBy: { createdAt: "desc" }, take: 60 });
      data.exports = rows.map(exportView);
      data.anyRunning = rows.some((r) => r.status === "queued" || r.status === "running");
    }
    if (tab === "exclusoes") {
      const rows = await prisma.dataDeletion.findMany({ orderBy: { createdAt: "desc" }, take: 60 });
      data.deletions = rows.map((d) => ({
        id: d.id,
        kind: d.kind,
        title: d.kind === "company" ? d.orgName : `${d.subjectMasked} · ${d.orgName}`,
        kindLabel: d.kind === "company" ? "Empresa inteira" : "Dados de uma pessoa",
        rows: sumCounts(d.counts as Record<string, number>),
        files: d.filesDeleted,
        when: dateTimeLabel(d.createdAt),
        by: d.performedByName,
        reason: d.reason,
      }));
    }
    page(res, "privacidade", await shell(req, "privacidade"), data);
  }),
);

const privacySchema = z.object({
  kind: z.enum(["access", "correction", "deletion", "other"]),
  subjectType: z.enum(["company", "person"]),
  organizationId: z.string().trim().optional().default(""),
  requesterName: z.string().trim().min(2, "Quem pediu?").max(120),
  requesterEmail: z.string().trim().toLowerCase().email("E-mail de quem pediu inválido."),
  subjectEmail: z.string().trim().toLowerCase().max(200).optional().default(""),
  subjectPhone: z.string().trim().max(40).optional().default(""),
  details: z.string().trim().max(4000).optional().default(""),
  receivedAt: z.string().optional().default(""),
});

masterRouter.post(
  "/privacidade/pedidos",
  requireCap("privacy_manage"),
  h(async (req, res) => {
    const parsed = privacySchema.safeParse(req.body);
    if (!parsed.success) return fail(res, 400, parsed.error.issues[0]?.message || "Confira os campos.");
    const d = parsed.data;
    const org = /^[0-9a-f-]{36}$/i.test(d.organizationId) ? await prisma.organization.findUnique({ where: { id: d.organizationId }, select: { id: true, name: true } }) : null;
    if (d.subjectType === "company" && !org) return fail(res, 400, "Escolha a empresa.");
    if (d.subjectEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.subjectEmail)) return fail(res, 400, "E-mail da pessoa inválido.");
    const received = /^\d{4}-\d{2}-\d{2}$/.test(d.receivedAt) ? new Date(`${d.receivedAt}T12:00:00-06:00`) : new Date();
    if (received > new Date(Date.now() + 86400e3)) return fail(res, 400, "A data do pedido não pode ser no futuro.");
    const r = await prisma.privacyRequest.create({
      data: {
        organizationId: org?.id ?? null,
        orgName: org?.name ?? null,
        kind: d.kind,
        subjectType: d.subjectType,
        requesterName: d.requesterName,
        requesterEmail: d.requesterEmail,
        subjectEmail: d.subjectType === "person" ? d.subjectEmail || null : null,
        subjectPhone: d.subjectType === "person" ? d.subjectPhone || null : null,
        details: d.details || null,
        receivedAt: received,
        dueAt: dueFrom(received),
        createdByName: req.master!.name,
      },
    });
    privacyCountCache = null;
    await audit(req, actor(req), "privacy.request_created", { type: "privacy_request", id: r.id, label: `${KIND_LABEL[r.kind]} · ${r.requesterName}`, meta: { organizationId: org?.id ?? null, subjectType: r.subjectType } });
    ok(res, `Pedido registrado. Prazo: ${shortDate(r.dueAt)} (${PRIVACY_DAYS} dias).`);
  }),
);

masterRouter.post(
  "/privacidade/pedidos/:id",
  requireCap("privacy_manage"),
  h(async (req, res) => {
    const r = await prisma.privacyRequest.findUnique({ where: { id: String(req.params.id) } }).catch(() => null);
    if (!r) return fail(res, 404, "Pedido não encontrado.");
    const status = String(req.body?.status || "");
    if (!["received", "in_progress", "done", "rejected"].includes(status)) return fail(res, 400, "Situação inválida.");
    const response = String(req.body?.response || "").trim().slice(0, 4000);
    if ((status === "done" || status === "rejected") && !response) return fail(res, 400, "Escreva a resposta dada (fica guardada como prova).");
    const closing = !OPEN_STATUSES.includes(status);
    await prisma.privacyRequest.update({
      where: { id: r.id },
      data: { status, response: response || r.response, handledByName: req.master!.name, closedAt: closing ? r.closedAt ?? new Date() : null },
    });
    privacyCountCache = null;
    await audit(req, actor(req), "privacy.request_updated", { type: "privacy_request", id: r.id, label: `${KIND_LABEL[r.kind]} · ${r.requesterName}`, meta: { from: r.status, to: status } });
    ok(res, closing ? "Pedido fechado. A resposta fica guardada." : "Pedido atualizado.");
  }),
);

// ----- Exportar empresa -----

masterRouter.post(
  "/clientes/:id/exportar",
  requireCap("export"),
  requireStepUp,
  h(async (req, res) => {
    const org = await prisma.organization.findUnique({ where: { id: String(req.params.id) }, select: { id: true, name: true } }).catch(() => null);
    if (!org) return fail(res, 404, "Empresa não encontrada.");
    const pedido = String(req.body?.pedido || "");
    const r = await requestExport({
      organizationId: org.id,
      requestedById: req.master!.id,
      requestedByName: req.master!.name,
      reason: String(req.body?.reason || "").trim().slice(0, 200) || null,
      privacyRequestId: /^[0-9a-f-]{36}$/i.test(pedido) ? pedido : null,
    });
    if (r.alreadyRunning) return ok(res, "Já tem uma exportação dessa empresa sendo gerada.", { warn: true });
    if (/^[0-9a-f-]{36}$/i.test(pedido)) await prisma.privacyRequest.updateMany({ where: { id: pedido, status: "received" }, data: { status: "in_progress", handledByName: req.master!.name } });
    await audit(req, actor(req), "data.export_requested", { type: "organization", id: org.id, label: org.name, meta: { exportId: r.export.id } }, true);
    ok(res, "Exportação começou. Leva de segundos a alguns minutos; aparece em Dados e privacidade › Exportações.");
  }),
);

async function exportOr404(req: MasterRequest, res: Response) {
  const e = await prisma.dataExport.findUnique({ where: { id: String(req.params.id) } }).catch(() => null);
  if (!e) fail(res, 404, "Exportação não encontrada.");
  return e;
}

masterRouter.get(
  "/privacidade/exportacoes/:id/baixar",
  requireCap("export"),
  h(async (req, res) => {
    const e = await prisma.dataExport.findUnique({ where: { id: String(req.params.id) } }).catch(() => null);
    if (!e || !isDownloadable(e)) return void res.status(404).render("master/error", { title: "Exportação indisponível", message: "Essa exportação não existe ou já expirou. Gere outra na ficha da empresa." });
    const stream = await storage.getStream(e.fileKey!);
    if (!stream) return void res.status(404).render("master/error", { title: "Arquivo não encontrado", message: "O arquivo não está mais no storage. Gere outra exportação." });
    await audit(req, actor(req), "data.export_downloaded", { type: "organization", id: e.organizationId, label: e.orgName, meta: { exportId: e.id, by: "master" } });
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${exportFileName(e)}"`);
    if (e.sizeBytes) res.setHeader("Content-Length", String(e.sizeBytes));
    stream.pipe(res);
  }),
);

masterRouter.post(
  "/privacidade/exportacoes/:id/link",
  requireCap("export"),
  requireStepUp,
  h(async (req, res) => {
    const e = await exportOr404(req, res);
    if (!e) return;
    if (!isDownloadable(e)) return fail(res, 400, "Essa exportação não está pronta ou já expirou.");
    const url = await createDownloadLink(e.id);
    await audit(req, actor(req), "data.export_link", { type: "organization", id: e.organizationId, label: e.orgName, meta: { exportId: e.id } }, true);
    ok(res, "Link criado.", {
      reveal: {
        title: `Link para ${e.orgName} baixar os dados`,
        value: url,
        note: `Qualquer pessoa com o link baixa o arquivo até ${dateTimeLabel(e.expiresAt)}. Mande só para o contato certo. Criar outro link cancela este.`,
      },
    });
  }),
);

masterRouter.post(
  "/privacidade/exportacoes/:id/link/cancelar",
  requireCap("export"),
  h(async (req, res) => {
    const e = await exportOr404(req, res);
    if (!e) return;
    await revokeDownloadLink(e.id);
    await audit(req, actor(req), "data.export_link_revoked", { type: "organization", id: e.organizationId, label: e.orgName, meta: { exportId: e.id } });
    ok(res, "Link cancelado. Quem tiver o link antigo não baixa mais.");
  }),
);

// ----- Excluir dados de uma pessoa -----

const ERASE_KEYS = ["leads", "customers", "field_quotes", "jobs", "builders", "employees", "temp_workers", "users", "messages"];

masterRouter.get(
  "/privacidade/pessoa",
  h(async (req, res) => {
    const orgId = String(req.query.empresa || "");
    const org = /^[0-9a-f-]{36}$/i.test(orgId) ? await prisma.organization.findUnique({ where: { id: orgId }, select: { id: true, name: true, slug: true } }) : null;
    const email = String(req.query.email || "").trim();
    const phone = String(req.query.telefone || "").trim();
    const pedido = /^[0-9a-f-]{36}$/i.test(String(req.query.pedido || "")) ? String(req.query.pedido) : "";
    let error: string | null = null;
    let categories: Awaited<ReturnType<typeof findPerson>> | null = null;
    let masked = "";
    if (org && (email || phone)) {
      const s = normalizeSubject(email, phone);
      if ("error" in s) error = s.error;
      else {
        categories = await findPerson(org.id, s);
        masked = maskSubject(s);
      }
    }
    page(res, "pessoa", await shell(req, "privacidade"), {
      org,
      email,
      phone,
      pedido,
      error,
      categories,
      masked,
      total: categories ? categories.reduce((n, c) => n + c.count, 0) : 0,
      orgOpts: await prisma.organization.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
      canDelete: can(req.master!.role, "data_delete"),
    });
  }),
);

masterRouter.post(
  "/privacidade/pessoa",
  requireCap("data_delete"),
  requireStepUp,
  h(async (req, res) => {
    const orgId = String(req.body?.organizationId || "");
    const org = /^[0-9a-f-]{36}$/i.test(orgId) ? await prisma.organization.findUnique({ where: { id: orgId }, select: { id: true, name: true, slug: true } }) : null;
    if (!org) return fail(res, 404, "Empresa não encontrada.");
    const s = normalizeSubject(String(req.body?.email || ""), String(req.body?.phone || ""));
    if ("error" in s) return fail(res, 400, s.error);
    if (String(req.body?.confirm || "").trim().toUpperCase() !== "EXCLUIR") return fail(res, 400, "Digite EXCLUIR para confirmar.");
    const reason = String(req.body?.reason || "").trim().slice(0, 300);
    if (!reason) return fail(res, 400, "Escreva o motivo (ex.: pedido do cliente por e-mail em 10/10).");
    const raw = req.body?.cats;
    const cats = (Array.isArray(raw) ? raw : raw ? [raw] : []).map(String).filter((c) => ERASE_KEYS.includes(c));
    if (!cats.length) {
      const found = (await findPerson(org.id, s)).reduce((n, c) => n + c.count, 0);
      if (found) return fail(res, 400, "Marque pelo menos um grupo.");
    }
    let counts: Record<string, number>;
    try {
      counts = await erasePerson(org.id, s, cats);
    } catch (error) {
      return fail(res, 400, error instanceof Error ? error.message : "Não deu certo.");
    }
    const pedido = /^[0-9a-f-]{36}$/i.test(String(req.body?.pedido || "")) ? String(req.body.pedido) : null;
    const receipt = await prisma.dataDeletion.create({
      data: {
        kind: "person",
        organizationId: org.id,
        orgName: org.name,
        orgSlug: org.slug,
        subjectMasked: maskSubject(s),
        subjectHash: subjectHash(s),
        counts,
        reason,
        privacyRequestId: pedido,
        performedById: req.master!.id,
        performedByName: req.master!.name,
      },
    });
    if (pedido) await prisma.privacyRequest.updateMany({ where: { id: pedido, status: "received" }, data: { status: "in_progress", handledByName: req.master!.name } });
    await audit(req, actor(req), "data.person_erased", { type: "organization", id: org.id, label: `${maskSubject(s)} · ${org.name}`, meta: { receiptId: receipt.id, counts } }, true);
    const total = sumCounts(counts);
    ok(res, total ? `Pronto: ${total} registro(s) anonimizados. Comprovante gerado.` : "Nada encontrado para apagar. Comprovante gerado mesmo assim.", { redirect: `/master/privacidade/exclusoes/${receipt.id}` });
  }),
);

// ----- Excluir empresa de vez -----

masterRouter.post(
  "/clientes/:id/excluir",
  requireCap("data_delete"),
  requireStepUp,
  h(async (req, res) => {
    const org = await prisma.organization.findUnique({ where: { id: String(req.params.id) }, select: { id: true, name: true } }).catch(() => null);
    if (!org) return fail(res, 404, "Empresa não encontrada.");
    try {
      const { receipt, filesError } = await deleteCompany({
        organizationId: org.id,
        confirmSlug: String(req.body?.confirm || ""),
        reason: String(req.body?.reason || "").slice(0, 300),
        exportSkippedWhy: String(req.body?.skipExport || "").slice(0, 300) || null,
        performedById: req.master!.id,
        performedByName: req.master!.name,
      });
      if (receipt.privacyRequestId) {
        await prisma.privacyRequest.updateMany({ where: { id: receipt.privacyRequestId, status: "received" }, data: { status: "in_progress", handledByName: req.master!.name } });
        privacyCountCache = null;
      }
      await audit(req, actor(req), "data.company_deleted", { type: "organization", id: org.id, label: org.name, meta: { receiptId: receipt.id, rows: sumCounts(receipt.counts as Record<string, number>), files: receipt.filesDeleted, filesError } }, true);
      ok(res, filesError ? `Dados apagados, mas os arquivos deram erro: ${filesError}` : `${org.name} foi excluída de vez. Comprovante gerado.`, { warn: !!filesError, redirect: `/master/privacidade/exclusoes/${receipt.id}` });
    } catch (error) {
      return fail(res, 400, error instanceof Error ? error.message : "Não deu certo.");
    }
  }),
);

masterRouter.get(
  "/privacidade/exclusoes/:id",
  h(async (req, res) => {
    const d = await prisma.dataDeletion.findUnique({ where: { id: String(req.params.id) } }).catch(() => null);
    if (!d) return void res.status(404).render("master/error", { title: "Comprovante não encontrado", message: "Esse comprovante não existe." });
    const counts = Object.entries(d.counts as Record<string, number>).sort((a, b) => b[1] - a[1]);
    const exp = d.exportId ? await prisma.dataExport.findUnique({ where: { id: d.exportId }, select: { createdAt: true } }) : null;
    res.render("master/comprovante", {
      title: "Deletion certificate",
      d,
      counts,
      total: sumCounts(d.counts as Record<string, number>),
      when: d.createdAt.toLocaleString("en-US", { timeZone: "America/Denver", dateStyle: "long", timeStyle: "short" }),
      exportWhen: exp ? exp.createdAt.toLocaleDateString("en-US", { timeZone: "America/Denver", dateStyle: "long" }) : null,
      product: env.PRODUCT_NAME,
    });
  }),
);

// ---------------------------------------------------------------------------
// Cobrança: cupons, cartões, disputas, previsão, cancelamentos
// ---------------------------------------------------------------------------

const COUPON_STATE: Record<CouponState, Pill> = {
  active: { label: "Ativo", tone: "ink" },
  expired: { label: "Expirou", tone: "muted" },
  used_up: { label: "Esgotado", tone: "muted" },
  archived: { label: "Arquivado", tone: "muted" },
};
const DISPUTE_STATUS: Record<string, Pill> = {
  warning_needs_response: { label: "Aviso · responder", tone: "danger" },
  needs_response: { label: "Responder", tone: "danger" },
  warning_under_review: { label: "Em análise", tone: "warn" },
  under_review: { label: "Em análise", tone: "warn" },
  won: { label: "Ganha", tone: "ink" },
  lost: { label: "Perdida", tone: "muted" },
  warning_closed: { label: "Encerrada", tone: "muted" },
  charge_refunded: { label: "Estornada", tone: "muted" },
};
const DISPUTE_REASON: Record<string, string> = {
  fraudulent: "Fraude (não reconhece)",
  product_not_received: "Não recebeu",
  product_unacceptable: "Insatisfeito",
  subscription_canceled: "Diz que cancelou",
  duplicate: "Cobrança duplicada",
  credit_not_processed: "Reembolso não feito",
  unrecognized: "Não reconhece",
  general: "Geral",
};
const OPEN_DISPUTE = ["warning_needs_response", "needs_response", "warning_under_review", "under_review"];

/** Card, coupon and cancel info for the company record. */
async function billingForRecord(o: Awaited<ReturnType<typeof loadOrg>>) {
  const coupons = (await prisma.coupon.findMany({ where: { active: true }, orderBy: { createdAt: "desc" } }))
    .filter((c) => couponState(c) === "active" && (!c.plans.length || c.plans.includes(o!.plan)))
    .map((c) => ({ code: c.code, name: c.name, text: couponText(c), plansText: c.plans.length ? c.plans.map((p) => planLabel(p)).join(", ") : "" }));
  const current = o!.couponCode ? await prisma.coupon.findUnique({ where: { code: o!.couponCode } }) : null;
  const exp = cardExpiresAt(o!);
  const next = o!.status === "trial" ? o!.trialEndsAt : o!.currentPeriodEnd;
  return {
    card: cardText(o!),
    cardWarn: !!(exp && next && exp < next && o!.stripeSubscriptionId),
    coupon: o!.couponCode ? { code: o!.couponCode, text: current ? couponText(current) : "" } : null,
    coupons,
    reasons: CANCEL_REASONS.map((r) => ({ key: r.key, label: r.pt })),
    cancelReason: o!.cancelReasonKey ? REASON_LABEL[o!.cancelReasonKey] ?? o!.cancelReasonKey : null,
  };
}

masterRouter.post(
  "/clientes/:id/cupom",
  requireCap("billing_manage"),
  h(async (req, res) => {
    const org = await orgOr404(req, res);
    if (!org) return;
    const code = String(req.body?.code || "").trim();
    try {
      if (!code) {
        const before = org.couponCode;
        const viaStripe = await removeCoupon(org.id);
        await audit(req, actor(req), "coupon.remove", { type: "organization", id: org.id, label: org.name, meta: { code: before, stripe: viaStripe } });
        return ok(res, `Cupom tirado de ${org.name}.`);
      }
      const r = await applyCoupon(org.id, code);
      await audit(req, actor(req), "coupon.apply", { type: "organization", id: org.id, label: org.name, meta: { code: r.coupon.code, stripe: r.viaStripe } });
      ok(res, r.viaStripe ? `${r.coupon.code} aplicado na assinatura de ${org.name} (${couponText(r.coupon)}).` : `${r.coupon.code} anotado para ${org.name}. Vale no Stripe quando a empresa assinar.`);
    } catch (error) {
      if (error instanceof BillingError) return fail(res, 400, error.message);
      console.error("[master] coupon failed", error);
      return fail(res, 502, "O Stripe não respondeu. Tente de novo.");
    }
  }),
);

masterRouter.post(
  "/clientes/:id/cartao",
  requireCap("billing_manage"),
  h(async (req, res) => {
    const org = await orgOr404(req, res);
    if (!org) return;
    try {
      const has = await syncCard(org.id);
      ok(res, has ? "Cartão atualizado a partir do Stripe." : "O Stripe não tem cartão padrão para essa empresa.", { warn: !has });
    } catch {
      fail(res, 502, "O Stripe não respondeu. Tente de novo.");
    }
  }),
);

// ----- Cupons -----

masterRouter.get(
  "/cupons",
  requireCap("billing_full"),
  h(async (req, res) => {
    const rows = await prisma.coupon.findMany({ orderBy: [{ active: "desc" }, { createdAt: "desc" }] });
    const using = await prisma.organization.groupBy({ by: ["couponCode"], where: { couponCode: { not: null }, status: { not: "canceled" } }, _count: { _all: true } });
    const usingMap = new Map(using.map((u) => [u.couponCode, u._count._all]));
    const retention = await getRetentionCode();
    const builderReferral = await getBuilderReferralCode();
    const events = await prisma.cancellationEvent.findMany({ where: { offerShown: true, requestedAt: { gte: new Date(Date.now() - 90 * 86400e3) } }, select: { offerAccepted: true } });
    page(res, "cupons", await shell(req, "cupons"), {
      canEdit: can(req.master!.role, "plans_manage"),
      stripeOn: stripeEnabled(),
      coupons: rows.map((c) => {
        const st = couponState(c);
        return {
          code: c.code,
          name: c.name,
          text: couponText(c),
          state: st,
          pill: COUPON_STATE[st],
          uses: `${c.timesRedeemed}${c.maxRedemptions ? ` de ${c.maxRedemptions}` : ""}`,
          inUse: usingMap.get(c.code) ?? 0,
          expires: c.expiresAt ? shortDate(c.expiresAt) : "sem validade",
          plans: c.plans.length ? c.plans.map((p) => planLabel(p)).join(", ") : "todos os planos",
          stripe: !!c.stripeCouponId,
          by: c.createdByName,
          when: shortDate(c.createdAt),
          retention: c.code === retention,
        };
      }),
      retention,
      builderReferral,
      retentionStats: { shown: events.length, accepted: events.filter((e) => e.offerAccepted).length },
      planOpts: planOptions(),
    });
  }),
);

const couponSchema = z.object({
  code: z.string().trim().min(3).max(30),
  name: z.string().trim().min(2, "Dê um nome.").max(60),
  kind: z.enum(["percent", "amount"]),
  value: z.coerce.number().positive("Valor do desconto?"),
  duration: z.enum(["once", "repeating", "forever"]),
  months: z.coerce.number().int().optional(),
  maxRedemptions: z.string().optional().default(""),
  expiresAt: z.string().optional().default(""),
  plans: z.union([z.string(), z.array(z.string())]).optional(),
});

masterRouter.post(
  "/cupons",
  requireCap("plans_manage"),
  requireStepUp,
  h(async (req, res) => {
    const parsed = couponSchema.safeParse(req.body);
    if (!parsed.success) return fail(res, 400, parsed.error.issues[0]?.message || "Confira os campos.");
    const d = parsed.data;
    const plans = (Array.isArray(d.plans) ? d.plans : d.plans ? [d.plans] : []).filter((p) => p in PLAN_LABEL);
    const expires = /^\d{4}-\d{2}-\d{2}$/.test(d.expiresAt) ? new Date(`${d.expiresAt}T23:59:59-06:00`) : null;
    try {
      const c = await createCoupon(
        {
          code: d.code,
          name: d.name,
          percentOff: d.kind === "percent" ? Math.round(d.value) : null,
          amountOffCents: d.kind === "amount" ? Math.round(d.value * 100) : null,
          duration: d.duration,
          durationMonths: d.duration === "repeating" ? d.months ?? null : null,
          maxRedemptions: d.maxRedemptions ? Number(d.maxRedemptions) : null,
          expiresAt: expires,
          plans: plans.length === Object.keys(PLAN_LABEL).length ? [] : plans,
        },
        req.master!.name,
      );
      await audit(req, actor(req), "coupon.create", { type: "coupon", id: c.id, label: c.code, meta: { text: couponText(c), stripe: !!c.stripeCouponId } }, true);
      ok(res, `Cupom ${c.code} criado${c.stripeCouponId ? " e espelhado no Stripe" : " (Stripe desligado: só vale aplicado pelo Master)"}.`);
    } catch (error) {
      if (error instanceof BillingError) return fail(res, 400, error.message);
      console.error("[master] coupon create failed", error);
      return fail(res, 502, "O Stripe recusou o cupom. Nada foi criado.");
    }
  }),
);

masterRouter.post(
  "/cupons/:code/arquivar",
  requireCap("plans_manage"),
  h(async (req, res) => {
    const code = String(req.params.code);
    try {
      await archiveCoupon(code);
      if ((await getRetentionCode()) === code) await setRetentionCode(null);
      await audit(req, actor(req), "coupon.archive", { type: "coupon", label: code });
      ok(res, `Cupom ${code} arquivado. Quem já tem o desconto continua com ele.`);
    } catch (error) {
      if (error instanceof BillingError) return fail(res, 400, error.message);
      return fail(res, 502, "O Stripe não respondeu. Tente de novo.");
    }
  }),
);

masterRouter.post(
  "/cupons/retencao",
  requireCap("plans_manage"),
  h(async (req, res) => {
    const code = String(req.body?.code || "").trim();
    if (code) {
      const c = await prisma.coupon.findUnique({ where: { code } });
      if (!c || couponState(c) !== "active") return fail(res, 400, "Escolha um cupom ativo.");
      if (!c.stripeCouponId) return fail(res, 400, "A oferta só funciona com cupom espelhado no Stripe.");
    }
    await setRetentionCode(code || null);
    await audit(req, actor(req), "coupon.retention", { type: "setting", label: "Oferta para quem vai cancelar", meta: { code: code || null } });
    ok(res, code ? `Quem for cancelar vê a oferta ${code} antes de confirmar.` : "Oferta desligada: o cancelamento vai direto para a confirmação.");
  }),
);

masterRouter.post(
  "/cupons/indicacao-builder",
  requireCap("plans_manage"),
  h(async (req, res) => {
    const code = String(req.body?.code || "").trim();
    if (code) {
      const c = await prisma.coupon.findUnique({ where: { code } });
      if (!c || couponState(c) !== "active") return fail(res, 400, "Escolha um cupom ativo.");
    }
    await setBuilderReferralCode(code || null);
    await audit(req, actor(req), "coupon.builder_referral", { type: "setting", label: "Cupom de indicação de builder", meta: { code: code || null } });
    ok(res, code ? `Empresas que entrarem por convite de builder ganham o cupom ${code}.` : "Sem cupom de indicação: empresas convidadas por builders pagam o preço normal.");
  }),
);

/** Cancellations of the last N months by reason (company, Master, Stripe, ladder). */
async function cancelReasons(months: number) {
  const since = new Date(Date.now() - months * 30.5 * 86400e3);
  const rows = await prisma.cancellationEvent.findMany({ where: { requestedAt: { gte: since } }, orderBy: { requestedAt: "desc" } });
  const real = rows.filter((r) => !r.offerAccepted && !r.undoneAt);
  const by = new Map<string, { count: number; mrr: number }>();
  for (const r of real) {
    const b = by.get(r.reasonKey) ?? { count: 0, mrr: 0 };
    b.count++;
    b.mrr += r.mrrCents;
    by.set(r.reasonKey, b);
  }
  const max = Math.max(1, ...[...by.values()].map((b) => b.count));
  const offered = rows.filter((r) => r.offerShown);
  return {
    total: real.length,
    mrrLost: money(real.reduce((a, r) => a + r.mrrCents, 0)),
    reasons: [...by.entries()].sort((a, b) => b[1].count - a[1].count).map(([k, b]) => ({ label: REASON_LABEL[k] ?? k, count: b.count, mrr: money(b.mrr), pct: Math.round((b.count / Math.max(1, real.length)) * 100), bar: Math.round((b.count / max) * 100) })),
    saved: offered.filter((r) => r.offerAccepted).length,
    offered: offered.length,
    undone: rows.filter((r) => r.undoneAt && !r.offerAccepted).length,
    recent: real.slice(0, 8).map((r) => ({ org: r.orgName, orgId: r.organizationId, reason: REASON_LABEL[r.reasonKey] ?? r.reasonKey, comment: r.comment, when: shortDate(r.requestedAt), source: r.source === "company" ? "pela empresa" : r.source === "master" ? "pelo Master" : r.source === "stripe" ? "no Stripe" : "régua" })),
  };
}

// ---------------------------------------------------------------------------
// Segurança: minhas sessões, histórico de login, destravar
// ---------------------------------------------------------------------------

async function securityData(adminId: string, currentSid: string | null) {
  const [sessions, history] = await Promise.all([masterSessions(adminId, currentSid, IDLE_MS, ABSOLUTE_MS), loginHistory({ adminId }, 50)]);
  return {
    sessions: sessions.map((s) => ({ ...s, loginText: dateTimeLabel(s.loginAt), lastText: s.current ? "agora" : dateTimeLabel(s.lastSeen) })),
    history: history.map((h) => ({ ...h, whenText: dateTimeLabel(h.when) })),
    days: LOGIN_HISTORY_DAYS,
  };
}

masterRouter.get(
  "/seguranca",
  h(async (req, res) => {
    const memberId = String(req.query.membro || "");
    const mine = !memberId || memberId === req.master!.id;
    if (!mine && !can(req.master!.role, "team_manage")) return void res.status(403).render("master/error", { title: "Sem permissão", message: "Só o Master vê os acessos da equipe." });
    const who = await prisma.platformAdmin.findUnique({ where: { id: mine ? req.master!.id : memberId } }).catch(() => null);
    if (!who) return void res.status(404).render("master/error", { title: "Pessoa não encontrada", message: "Essa pessoa não está na equipe." });
    page(res, "seguranca", await shell(req, "seguranca"), {
      mine,
      canTeam: can(req.master!.role, "team_manage"),
      who: { id: who.id, name: who.name, email: who.email, roleLabel: ROLE_LABEL[normalizeRole(who.role)], locked: who.securityLockedAt ? dateTimeLabel(who.securityLockedAt) : null },
      ...(await securityData(who.id, mine ? req.sessionID : null)),
    });
  }),
);

masterRouter.post(
  "/seguranca/sessoes/outras",
  h(async (req, res) => {
    const live = (await masterSessions(req.master!.id, req.sessionID, IDLE_MS, ABSOLUTE_MS)).filter((x) => !x.current).length;
    await endOtherMasterSessions(req.master!.id, req.sessionID);
    const n = live;
    await audit(req, actor(req), "auth.sessions_ended", { type: "admin", id: req.master!.id, label: req.master!.email, meta: { sessions: n, others: true } });
    ok(res, n ? `${n} sessão(ões) encerrada(s). Só este aparelho continua.` : "Não havia outras sessões.");
  }),
);

masterRouter.post(
  "/seguranca/sessoes/:sid/encerrar",
  h(async (req, res) => {
    const memberId = String(req.query.membro || "");
    const target = memberId && memberId !== req.master!.id ? memberId : req.master!.id;
    if (target !== req.master!.id && !can(req.master!.role, "team_manage")) return fail(res, 403, "Só o Master encerra sessões da equipe.");
    const sid = String(req.params.sid);
    if (sid === req.sessionID) return fail(res, 400, "Para sair deste aparelho, use o botão Sair.");
    const n = await endMasterSession(target, sid);
    if (!n) return fail(res, 404, "Essa sessão já tinha terminado.");
    await audit(req, actor(req), "auth.sessions_ended", { type: "admin", id: target, label: target === req.master!.id ? req.master!.email : "membro da equipe", meta: { sessions: 1 } });
    ok(res, "Sessão encerrada. O aparelho precisa entrar de novo.");
  }),
);

masterRouter.post(
  "/seguranca/membro/:id/sessoes",
  requireCap("team_manage"),
  requireStepUp,
  h(async (req, res) => {
    const m = await prisma.platformAdmin.findUnique({ where: { id: String(req.params.id) } }).catch(() => null);
    if (!m) return fail(res, 404, "Pessoa não encontrada.");
    const n = await prisma.$executeRaw`DELETE FROM "session" WHERE sess->'master'->>'adminId' = ${m.id} AND sid <> ${req.sessionID}`;
    await audit(req, actor(req), "auth.sessions_ended", { type: "admin", id: m.id, label: m.email, meta: { sessions: n } }, true);
    ok(res, `${n} sessão(ões) de ${m.name} encerrada(s).`);
  }),
);

masterRouter.post(
  "/equipe/:id/destravar",
  requireCap("team_manage"),
  requireStepUp,
  h(async (req, res) => {
    const m = await prisma.platformAdmin.findUnique({ where: { id: String(req.params.id) } }).catch(() => null);
    if (!m) return fail(res, 404, "Pessoa não encontrada.");
    if (!m.securityLockedAt) return fail(res, 400, "Essa conta não está travada.");
    const link = await issueActivation(m.id);
    await sendActivationEmail(m.email, m.name, link, "reset");
    await audit(req, actor(req), "auth.unlocked", { type: "admin", id: m.id, label: m.email }, true);
    ok(res, `Link novo enviado para ${m.email}. A conta destrava quando a pessoa criar senha e 2FA novos.`, {
      reveal: { title: `Link de acesso · ${m.name}`, value: link, note: "Vale 48 h, uma vez. Também foi por e-mail." },
    });
  }),
);

// ---------------------------------------------------------------------------
// Idiomas (interface languages: term swaps and phrase edits)
// ---------------------------------------------------------------------------

const I18N_PAGE_SIZE = 50;

function i18nLocaleParam(v: unknown): UiLocale {
  return normalizeUiLocale(v) ?? "pt";
}

masterRouter.get(
  "/idiomas",
  requireCap("view"),
  h(async (req, res) => {
    const tab = ["termos", "frases", "testar"].includes(String(req.query.aba)) ? String(req.query.aba) : "termos";
    const locale = i18nLocaleParam(req.query.idioma);
    const [terms, phrases, userLocales, orgLocales] = await Promise.all([
      prisma.i18nTerm.findMany({ orderBy: [{ locale: "asc" }, { find: "asc" }] }),
      phraseOverrides(),
      prisma.user.groupBy({ by: ["uiLocale"], where: { status: "active" }, _count: { _all: true } }).catch(() => []),
      prisma.organization.groupBy({ by: ["defaultLocale"], where: { status: { not: "canceled" } }, _count: { _all: true } }).catch(() => []),
    ]);
    const { entries } = baseDictionary();

    const perLocale = UI_LOCALES.map((loc) => {
      const users = userLocales.filter((u) => normalizeUiLocale(u.uiLocale) === loc).reduce((a, u) => a + u._count._all, 0);
      const companies = orgLocales.filter((o) => orgDefaultUiLocale(o.defaultLocale) === loc).reduce((a, o) => a + o._count._all, 0);
      return {
        key: loc,
        label: UI_LOCALE_LABEL[loc],
        short: UI_LOCALE_SHORT[loc],
        users,
        companies,
        terms: terms.filter((t) => t.locale === loc && t.active).length,
        phrases: phrases.filter((p) => p.locale === loc).length,
      };
    });
    const usersOnCompanyDefault = userLocales.filter((u) => !normalizeUiLocale(u.uiLocale)).reduce((a, u) => a + u._count._all, 0);

    const termRows = terms
      .filter((t) => t.locale === locale)
      .map((t) => ({
        id: t.id,
        find: t.find,
        replace: t.replace,
        findPlural: t.findPlural,
        replacePlural: t.replacePlural,
        matchCase: t.matchCase,
        active: t.active,
        note: t.note,
        by: t.updatedByName,
        when: dateTimeLabel(t.updatedAt),
      }));

    // Frases: dictionary texts (+ texts the Master added) with the value in each language.
    const q = String(req.query.q || "").trim();
    const onlyEdited = req.query.editadas === "1";
    const pageNo = Math.max(1, Number(req.query.p) || 1);
    const edits = new Map<string, Map<string, (typeof phrases)[number]>>();
    for (const p of phrases) {
      if (!edits.has(p.source)) edits.set(p.source, new Map());
      edits.get(p.source)!.set(p.locale, p);
    }
    let phraseRows: { source: string; values: Record<UiLocale, string>; base: Record<UiLocale, string>; edited: UiLocale[]; custom: boolean }[] = [];
    if (tab === "frases") {
      const seen = new Set<string>();
      const all: { k: string; entry?: (typeof entries)[number] }[] = [];
      for (const src of edits.keys()) if (!baseDictionary().byKey.has(src)) { all.push({ k: src }); seen.add(src); }
      for (const e of entries) all.push({ k: e.k, entry: e });
      const needle = q.toLocaleLowerCase("pt-BR");
      for (const row of all) {
        const ed = edits.get(row.k);
        if (onlyEdited && !ed) continue;
        const baseVals = {} as Record<UiLocale, string>;
        const values = {} as Record<UiLocale, string>;
        for (const loc of UI_LOCALES) {
          baseVals[loc] = baseText(row.entry, row.k, loc);
          values[loc] = ed?.get(loc)?.text ?? baseVals[loc];
        }
        if (needle && ![row.k, ...Object.values(values)].some((v) => v.toLocaleLowerCase("pt-BR").includes(needle))) continue;
        phraseRows.push({
          source: row.k,
          values,
          base: baseVals,
          edited: ed ? ([...ed.keys()] as UiLocale[]) : [],
          custom: !row.entry,
        });
      }
      // Edited first, then shorter texts (menus and buttons) before long sentences.
      phraseRows.sort((a, b) => (b.edited.length ? 1 : 0) - (a.edited.length ? 1 : 0) || a.source.length - b.source.length);
    }
    const totalPhrases = phraseRows.length;
    const pages = Math.max(1, Math.ceil(totalPhrases / I18N_PAGE_SIZE));
    phraseRows = phraseRows.slice((pageNo - 1) * I18N_PAGE_SIZE, pageNo * I18N_PAGE_SIZE);

    page(res, "idiomas", await shell(req, "idiomas"), {
      tab,
      locale,
      locales: perLocale,
      usersOnCompanyDefault,
      canEdit: can(req.master!.role, "i18n_manage"),
      terms: termRows,
      phrases: phraseRows,
      totalPhrases,
      dictionarySize: entries.length,
      q,
      onlyEdited,
      pageNo: Math.min(pageNo, pages),
      pages,
    });
  }),
);

const i18nTermSchema = z.object({
  locale: z.enum(UI_LOCALES),
  find: z.string().trim().min(1, "Escreva a palavra que aparece hoje.").max(80),
  replace: z.string().trim().min(1, "Escreva por qual palavra trocar.").max(80),
  findPlural: z.string().trim().max(80).optional().default(""),
  replacePlural: z.string().trim().max(80).optional().default(""),
  matchCase: z.union([z.literal("on"), z.literal("1"), z.literal("true"), z.literal("")]).optional(),
  note: z.string().trim().max(200).optional().default(""),
});

function termData(d: z.infer<typeof i18nTermSchema>) {
  const fp = d.findPlural || "";
  const rp = d.replacePlural || "";
  return {
    locale: d.locale,
    find: d.find,
    replace: d.replace,
    findPlural: fp && rp ? fp : null,
    replacePlural: fp && rp ? rp : null,
    matchCase: !!d.matchCase,
    note: d.note || null,
  };
}

masterRouter.post(
  "/idiomas/termos",
  requireCap("i18n_manage"),
  h(async (req, res) => {
    const parsed = i18nTermSchema.safeParse(req.body);
    if (!parsed.success) return fail(res, 400, parsed.error.issues[0]?.message || "Confira os campos.");
    const data = termData(parsed.data);
    if ((parsed.data.findPlural && !parsed.data.replacePlural) || (!parsed.data.findPlural && parsed.data.replacePlural)) {
      return fail(res, 400, "Preencha o plural dos dois lados (ou deixe os dois vazios).");
    }
    if (data.find.toLocaleLowerCase() === data.replace.toLocaleLowerCase() && !data.matchCase) return fail(res, 400, "A palavra nova é igual à de hoje.");
    const dup = await prisma.i18nTerm.findFirst({ where: { locale: data.locale, find: { equals: data.find, mode: "insensitive" } } });
    if (dup) return fail(res, 400, `Já existe uma troca para “${dup.find}” em ${UI_LOCALE_LABEL[data.locale as UiLocale]}. Edite a que existe.`);
    const t = await prisma.i18nTerm.create({ data: { ...data, updatedById: req.master!.id, updatedByName: req.master!.name } });
    await bumpI18n();
    await audit(req, actor(req), "i18n.term_create", { type: "i18n", id: t.id, label: `${UI_LOCALE_SHORT[t.locale as UiLocale]} · ${t.find} → ${t.replace}`, meta: data });
    ok(res, `Troca salva: “${t.find}” → “${t.replace}” em ${UI_LOCALE_LABEL[t.locale as UiLocale]}. Vale na próxima tela que cada pessoa abrir.`);
  }),
);

masterRouter.post(
  "/idiomas/termos/:id",
  requireCap("i18n_manage"),
  h(async (req, res) => {
    const t = await prisma.i18nTerm.findUnique({ where: { id: String(req.params.id) } }).catch(() => null);
    if (!t) return fail(res, 404, "Troca não encontrada.");
    const label = `${UI_LOCALE_SHORT[t.locale as UiLocale]} · ${t.find} → ${t.replace}`;
    const op = String(req.body?.op || "save");
    if (op === "delete") {
      await prisma.i18nTerm.delete({ where: { id: t.id } });
      await bumpI18n();
      await audit(req, actor(req), "i18n.term_delete", { type: "i18n", id: t.id, label });
      return ok(res, `Troca “${t.find}” excluída. O texto volta ao normal na próxima tela.`);
    }
    if (op === "toggle") {
      const u = await prisma.i18nTerm.update({ where: { id: t.id }, data: { active: !t.active, updatedById: req.master!.id, updatedByName: req.master!.name } });
      await bumpI18n();
      await audit(req, actor(req), u.active ? "i18n.term_on" : "i18n.term_off", { type: "i18n", id: t.id, label });
      return ok(res, u.active ? `Troca “${t.find}” ligada.` : `Troca “${t.find}” desligada.`);
    }
    const parsed = i18nTermSchema.safeParse({ ...req.body, locale: t.locale });
    if (!parsed.success) return fail(res, 400, parsed.error.issues[0]?.message || "Confira os campos.");
    if ((parsed.data.findPlural && !parsed.data.replacePlural) || (!parsed.data.findPlural && parsed.data.replacePlural)) {
      return fail(res, 400, "Preencha o plural dos dois lados (ou deixe os dois vazios).");
    }
    const data = termData(parsed.data);
    const dup = await prisma.i18nTerm.findFirst({ where: { locale: t.locale, id: { not: t.id }, find: { equals: data.find, mode: "insensitive" } } });
    if (dup) return fail(res, 400, `Já existe outra troca para “${dup.find}”.`);
    await prisma.i18nTerm.update({ where: { id: t.id }, data: { ...data, updatedById: req.master!.id, updatedByName: req.master!.name } });
    await bumpI18n();
    await audit(req, actor(req), "i18n.term_update", {
      type: "i18n",
      id: t.id,
      label,
      meta: { before: { find: t.find, replace: t.replace, findPlural: t.findPlural, replacePlural: t.replacePlural, matchCase: t.matchCase }, after: data },
    });
    ok(res, `Troca “${data.find}” → “${data.replace}” atualizada.`);
  }),
);

/** How many interface texts a term would change, with a few before → after examples. */
masterRouter.get(
  "/idiomas/termos/alcance",
  requireCap("view"),
  h(async (req, res) => {
    const locale = i18nLocaleParam(req.query.idioma);
    const find = String(req.query.find || "").trim().slice(0, 80);
    const replace = String(req.query.replace || "").trim().slice(0, 80);
    const findPlural = String(req.query.findPlural || "").trim().slice(0, 80);
    const replacePlural = String(req.query.replacePlural || "").trim().slice(0, 80);
    const matchCase = req.query.matchCase === "1";
    if (!find) return void res.json({ ok: true, count: 0, examples: [] });
    const { bundle } = await buildBundle(locale);
    const { entries } = baseDictionary();
    const rule = [{ f: find, r: replace || find, fp: findPlural || null, rp: replacePlural || null, c: matchCase }];
    const candidates: { before: string; after: string }[] = [];
    let count = 0;
    const seen = new Set<string>();
    for (const e of entries) {
      const shown = (bundle.exact[e.k] ?? e[locale] ?? e.k).replace(/\{\d+\}/g, "…");
      if (seen.has(shown)) continue;
      seen.add(shown);
      const after = applyTerms(shown, rule);
      if (after === shown) continue;
      count += 1;
      if (shown.length <= 70 && /^[A-Za-zÀ-ÿ]/.test(shown)) candidates.push({ before: shown, after });
    }
    // Menus and buttons first: short texts that start with a word.
    const examples = candidates.sort((a, b) => a.before.length - b.before.length).filter((_, i, all) => i % Math.max(1, Math.floor(all.length / 6)) === 0).slice(0, 6);
    res.json({ ok: true, count, examples });
  }),
);

const i18nPhraseSchema = z.object({
  source: z.string().max(400),
  pt: z.string().max(1000).optional(),
  en: z.string().max(1000).optional(),
  es: z.string().max(1000).optional(),
  custom: z.string().optional(),
});

masterRouter.post(
  "/idiomas/frases",
  requireCap("i18n_manage"),
  h(async (req, res) => {
    const parsed = i18nPhraseSchema.safeParse(req.body);
    if (!parsed.success) return fail(res, 400, "Confira os campos.");
    const source = normKey(parsed.data.source);
    if (!source) return fail(res, 400, "Escreva o texto como aparece hoje no sistema.");
    const entry = baseDictionary().byKey.get(source);
    const isNew = parsed.data.custom === "1";
    if (isNew && entry) return fail(res, 400, "Esse texto já está na lista de frases. Procure por ele e edite.");
    const srcPh = new Set(source.match(/\{\d+\}/g) || []);
    const changes: Record<string, { from: string; to: string }> = {};
    for (const loc of UI_LOCALES) {
      const raw = parsed.data[loc];
      if (raw === undefined) continue;
      const text = raw.replace(/\s+/g, " ").trim();
      const def = baseText(entry, source, loc);
      for (const ph of text.match(/\{\d+\}/g) || []) if (!srcPh.has(ph)) return fail(res, 400, `${UI_LOCALE_SHORT[loc]}: ${ph} não existe no texto original.`);
      const current = await prisma.i18nPhrase.findUnique({ where: { source_locale: { source, locale: loc } } });
      const before = current?.text ?? def;
      if (!text || (text === def && !isNew)) {
        if (current) {
          await prisma.i18nPhrase.delete({ where: { source_locale: { source, locale: loc } } });
          changes[loc] = { from: before, to: def };
        }
        continue;
      }
      if (text === before && current) continue;
      await prisma.i18nPhrase.upsert({
        where: { source_locale: { source, locale: loc } },
        create: { source, locale: loc, text, custom: !entry, updatedById: req.master!.id, updatedByName: req.master!.name },
        update: { text, custom: !entry, updatedById: req.master!.id, updatedByName: req.master!.name },
      });
      changes[loc] = { from: before, to: text };
    }
    if (!Object.keys(changes).length) return ok(res, "Nada mudou.");
    await bumpI18n();
    await audit(req, actor(req), "i18n.phrase_save", { type: "i18n", label: source.slice(0, 80), meta: changes });
    ok(res, `Frase salva em ${Object.keys(changes).map((l) => UI_LOCALE_SHORT[l as UiLocale]).join(", ")}. Vale na próxima tela que cada pessoa abrir.`);
  }),
);

masterRouter.post(
  "/idiomas/frases/padrao",
  requireCap("i18n_manage"),
  h(async (req, res) => {
    const source = normKey(String(req.body?.source || ""));
    const n = await prisma.i18nPhrase.deleteMany({ where: { source } });
    if (!n.count) return ok(res, "Essa frase já estava no padrão.");
    await bumpI18n();
    await audit(req, actor(req), "i18n.phrase_reset", { type: "i18n", label: source.slice(0, 80), meta: { languages: n.count } });
    ok(res, baseDictionary().byKey.has(source) ? "Frase de volta ao texto padrão nos três idiomas." : "Frase removida.");
  }),
);

masterRouter.post(
  "/idiomas/testar",
  requireCap("view"),
  h(async (req, res) => {
    const text = String(req.body?.text || "").slice(0, 2000);
    const lines = text.split(/\n/);
    const out: Record<string, string[]> = { pt: [], en: [], es: [] };
    for (const line of lines) {
      const r = await previewText(line);
      for (const loc of UI_LOCALES) out[loc]!.push(line.trim() ? r[loc] : "");
    }
    res.json({ ok: true, result: { pt: out.pt!.join("\n"), en: out.en!.join("\n"), es: out.es!.join("\n") } });
  }),
);

// Unknown paths inside /master
masterRouter.use((req, res) => {
  if (wantsJson(req)) return void res.status(404).json({ ok: false, error: "not_found" });
  res.status(404).render("master/error", { title: "Página não encontrada", message: "Esse endereço não existe no Master." });
});
