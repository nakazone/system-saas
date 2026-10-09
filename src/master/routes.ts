import { Router, type Response, type NextFunction } from "express";
import QRCode from "qrcode";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma } from "../lib/prisma.js";
import { env } from "../config/env.js";
import { hashPassword, verifyPassword } from "../lib/auth/password.js";
import { email as emailProvider } from "../lib/email/index.js";
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
  ROLE_HINT,
  ROLE_LABEL,
  addCycle,
  avatarBg,
  can,
  csvEscape,
  cyclePriceCents,
  dateTimeLabel,
  dayFromToday,
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
} from "./lib.js";
import { createOrganizationWithAdmin, validateSlug } from "../modules/organizations/service.js";
import { formatPersonName } from "../lib/name.js";

export const masterRouter = Router();

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
    if (admin?.lockedUntil && admin.lockedUntil > new Date()) {
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
  req.session.master = { adminId, stage: "full", loginAt: now, lastSeen: now, stepUpAt: now };
  await audit(req, { id: admin.id, name: admin.name }, "auth.login", { type: "admin", id: admin.id, label: admin.email, meta: { method } });
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
    req.session.master = { adminId: admin.id, stage: "full", loginAt: now, lastSeen: now, stepUpAt: now };
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

masterRouter.use(requireMaster);

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
    const due = o.status === "trial" ? o.trialEndsAt : o.currentPeriodEnd;
    const d = daysUntil(due);
    return d != null && d < 0;
  }).length;
  const nav = [
    { key: "central", label: "Central", href: "/master", icon: "M3 12l9-8 9 8M5 10v10h14V10" },
    { key: "clientes", label: "Clientes", href: "/master/clientes", icon: "M4 21V5l8-3 8 3v16M9 21v-4h6v4M8 8h.01M12 8h.01M16 8h.01M8 12h.01M12 12h.01M16 12h.01", group: "CLIENTES" },
    { key: "usuarios", label: "Usuários", href: "/master/usuarios", icon: "M16 20v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 20v-1a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" },
    { key: "contatos", label: "Contatos", href: "/master/contatos", icon: "M5 4h12a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5zM5 4v18M12 11a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM8.5 17a3.5 3.5 0 0 1 7 0" },
    { key: "pagamentos", label: "Pagamentos", href: "/master/pagamentos", icon: "M2 7a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2zM2 10h20M6 15h4", group: "FINANCEIRO", hidden: !can(req.master!.role, "billing_full") },
    { key: "vencimentos", label: "Vencimentos", href: "/master/vencimentos", icon: "M8 2v4M16 2v4M3 9h18M5 4h14a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM12 13v3l2 1", badge: overdue || null, group: can(req.master!.role, "billing_full") ? undefined : "FINANCEIRO" },
    { key: "equipe", label: "Equipe e segurança", href: "/master/equipe", icon: "M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6zM9 12l2 2 4-4", group: "SISTEMA" },
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
  ["atraso", "Em atraso", (o) => o.overdue || o.status === "past_due"],
  ["30dias", "Vencem em 30 dias", (o) => o.days != null && o.days >= 0 && o.days <= 30],
  ["suspensas", "Suspensas", (o) => o.status === "suspended"],
  ["canceladas", "Canceladas", (o) => o.status === "canceled"],
];

masterRouter.get(
  "/clientes",
  h(async (req, res) => {
    const orgs = await loadOrgs();
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
      plans: Object.entries(PLAN_LABEL).map(([key, label]) => ({
        key,
        label,
        monthly: money(PLAN_MONTHLY_CENTS[key]),
        annual: money(PLAN_MONTHLY_CENTS[key] * 10),
      })),
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
  plan: z.enum(["starter", "professional", "business"]).default("starter"),
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
      const days = parsed.data.trialDays ?? 30;
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
      plans: Object.entries(PLAN_LABEL).map(([key, label]) => ({ key, label, monthly: money(PLAN_MONTHLY_CENTS[key]), annual: money(PLAN_MONTHLY_CENTS[key] * 10) })),
      methods: Object.entries(METHOD_LABEL),
      todayYmd: ymdInTz(new Date()),
      dueYmd: org.due ? ymdInTz(org.due) : "",
      trialYmd: org.trialEndsAt ? ymdInTz(org.trialEndsAt) : "",
      periodYmd: org.currentPeriodEnd ? ymdInTz(org.currentPeriodEnd) : "",
      priceDollars: (org.priceCents / 100).toFixed(2),
      nextPeriodLabel: `${shortDate(nextPeriodStart)} → ${shortDate(addCycle(nextPeriodStart, org.billingCycle))}`,
      canBilling: can(req.master!.role, "billing_manage"),
      canSuspend: can(req.master!.role, "tenants_suspend"),
      canUsers: can(req.master!.role, "users_manage"),
      showMoney: can(req.master!.role, "billing_full"),
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

const assinaturaSchema = z.object({
  status: z.enum(["trial", "active", "past_due", "suspended", "canceled"]),
  plan: z.enum(["starter", "professional", "business"]),
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
        await emailProvider
          .send({
            to: owner,
            subject: org.status === "trial" ? "Your ObraMate trial was extended" : "Your ObraMate due date was updated",
            text: `Hi,\n\nYour ObraMate ${org.status === "trial" ? "trial" : "plan"} for ${org.name} now runs until ${new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }).format(next)}.\n\n— The ObraMate team`,
          })
          .catch(() => undefined);
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
  plan: z.enum(["starter", "professional", "business"]),
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
    await audit(req, actor(req), "tenant.plan", {
      type: "organization",
      id: org.id,
      label: org.name,
      meta: { from: { plan: org.plan, cycle: org.billingCycle, priceCents: org.planPriceCents }, to: { plan: parsed.data.plan, cycle: parsed.data.cycle, priceCents: planPriceCents } },
    });
    const price = planPriceCents ?? listPrice;
    ok(res, `${org.name}: ${planLabel(parsed.data.plan)} ${parsed.data.cycle === "annual" ? "anual" : "mensal"} · ${money(price)}.`);
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
  const when = org.due ? new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "America/Denver" }).format(org.due) : null;
  const subject =
    org.status === "trial"
      ? org.days != null && org.days < 0
        ? "Your ObraMate trial has ended"
        : "Your ObraMate trial is ending soon"
      : org.days != null && org.days < 0
        ? "Your ObraMate payment is overdue"
        : "Your ObraMate plan renews soon";
  const text =
    org.status === "trial"
      ? `Hi ${org.ownerName},\n\nYour ObraMate trial for ${org.name} ${org.days != null && org.days < 0 ? "ended" : "ends"}${when ? ` on ${when}` : ""}. Reply to this e-mail to keep your account active.\n\n— The ObraMate team`
      : `Hi ${org.ownerName},\n\nYour ObraMate ${planLabel(org.plan)} plan for ${org.name} (${org.priceText}) ${org.days != null && org.days < 0 ? "was due" : "renews"}${when ? ` on ${when}` : ""}. Reply to this e-mail if you need anything.\n\n— The ObraMate team`;
  await emailProvider.send({ to, subject, text }).catch(() => undefined);
  return 1;
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
    await prisma.organization.update({ where: { id: org.id }, data: { status: "canceled", canceledAt: new Date(), cancelReason: reason || null } });
    const killed = await endOrgSessions(org.id);
    await audit(req, actor(req), "tenant.cancel", { type: "organization", id: org.id, label: org.name, meta: { from: org.status, reason, sessionsEnded: killed } }, true);
    ok(res, `${org.name} cancelada.`, { warn: true });
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
        meta: { email, role: role.key, organizationId: org.id },
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
    const data = { u, org, lastAudit, canManage: can(req.master!.role, "users_manage") };
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
// Pagamentos
// ---------------------------------------------------------------------------

masterRouter.get(
  "/pagamentos",
  requireCap("billing_full"),
  h(async (req, res) => {
    const tab = ["todos", "estornados"].includes(String(req.query.aba)) ? String(req.query.aba) : "todos";
    const [all, orgs] = await Promise.all([loadPayments({}, 500), loadOrgs()]);
    const monthStart = startOfMonthInTz();
    const paidMonth = all.filter((p) => p.status === "paid" && p.paidAt >= monthStart);
    const refunded30 = all.filter((p) => p.status === "refunded" && p.refundedAt && Date.now() - p.refundedAt.getTime() < 30 * 86_400_000);
    const late = orgs.filter((o) => o.overdue && o.status !== "trial");
    const mrr = orgs.filter((o) => o.status === "active" || o.status === "past_due").reduce((a, o) => a + o.monthlyCents, 0);
    page(res, "pagamentos", await shell(req, "pagamentos"), {
      rows: tab === "estornados" ? all.filter((p) => p.status === "refunded") : all,
      tab,
      tabs: [
        { key: "todos", label: "Todos", count: all.length },
        { key: "estornados", label: "Estornados", count: all.filter((p) => p.status === "refunded").length },
      ],
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
    await prisma.platformPayment.update({ where: { id: p.id }, data: { status: "refunded", refundedAt: new Date() } });
    await audit(req, actor(req), "payment.refund", { type: "organization", id: p.organizationId, label: p.organization.name, meta: { paymentId: p.id, amountCents: p.amountCents } }, true);
    ok(res, `${money(p.amountCents)} marcado como estornado. Devolva o valor no meio de pagamento usado (${METHOD_LABEL[p.method] ?? p.method}).`);
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
    page(res, "vencimentos", await shell(req, "vencimentos"), {
      buckets,
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
          initials: initials(m.name),
          avatarBg: m.role === "MASTER" ? "#f3b98f" : avatarBg(m.id),
        };
      })
      .sort((a, b) => (a.role === "MASTER" ? -1 : b.role === "MASTER" ? 1 : 0));
    const roles = PLATFORM_ROLES;
    page(res, "equipe", await shell(req, "equipe"), {
      members,
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
];

const AUDIT_TEXT: Record<string, string> = {
  "auth.login": "Entrou (senha + 2FA)",
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
    const where = cat[2].length ? { OR: cat[2].map((p) => (p.endsWith(".") ? { action: { startsWith: p } } : { action: p })) } : {};
    const rows = await prisma.platformAuditLog.findMany({ where, orderBy: { at: "desc" }, take: 300 });
    page(res, "auditoria", await shell(req, "auditoria"), {
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

// Unknown paths inside /master
masterRouter.use((req, res) => {
  if (wantsJson(req)) return void res.status(404).json({ ok: false, error: "not_found" });
  res.status(404).render("master/error", { title: "Página não encontrada", message: "Esse endereço não existe no Master." });
});
