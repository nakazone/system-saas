/**
 * Builder accounts — free, platform-level accounts for home builders.
 *
 * A builder signs up on its own, invites its team (roles) and connects the flooring
 * companies it sends work to:
 *  - a company already on ObraMate is linked by its admin's e-mail (active right away);
 *  - a company that is not is invited by e-mail / SMS with the referral coupon, and the
 *    jobs sent meanwhile are kept and delivered when it signs up.
 * Inside each linked company the builder is a normal Builder row, and each member gets a
 * PartnerUser row there (builderMemberId) so every company-scoped portal route keeps working.
 */
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../prisma.js";
import { env } from "../../config/env.js";
import { hashPassword, verifyPassword } from "../auth/password.js";
import { newToken, hashToken, takeRate, HOUR, DAY } from "../security/db-rate-limit.js";
import { sendPlatformEmail, firstName } from "../email/templates.js";
import { withTenantTransaction, type TenantPrisma } from "../tenant/prisma-tenant.js";
import { storage } from "../storage/index.js";
import { publishAppNotification } from "../notifications/publish.js";
import { trialDaysFor } from "../../master/plans.js";
import { workspaceHomeUrl } from "../tenant/workspace-url.js";
import { applyCoupon, builderReferralCoupon, couponText, couponTextEn } from "../billing/coupons.js";
import { applyPartnerRequest } from "./jobs.js";
import { isBuilderRole, ROLE_LABELS, type BuilderRole } from "./roles.js";

export class BuilderError extends Error {
  constructor(public status: number, message: string, public field?: string) {
    super(message);
  }
}

const VERIFY_TTL = 48 * HOUR;
const INVITE_TTL = 7 * DAY;
const RESET_TTL = HOUR;

function baseUrl(): string {
  return env.APP_BASE_URL.replace(/\/$/, "");
}
function showDevLink(): boolean {
  return process.env.SIGNUP_SHOW_DEV_LINK === "1";
}
function normEmail(email: string): string {
  return String(email || "").trim().toLowerCase();
}

/* ───────────────────────── sign-up / confirm / login ───────────────────────── */

export const builderSignupSchema = z.object({
  company: z.string().trim().min(2).max(120),
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email().max(200),
  phone: z.string().trim().max(40).optional().or(z.literal("")),
  password: z.string().min(8).max(128),
  acceptLegal: z.string().optional(),
  /** Honeypot. */
  website: z.string().optional(),
});

export type SignupOutcome = { email: string; devLink?: string };

async function setMemberToken(memberId: string, purpose: "verify" | "invite" | "reset", ttl: number): Promise<string> {
  const { token, hash } = newToken();
  await prisma.builderMember.update({
    where: { id: memberId },
    data: { tokenHash: hash, tokenPurpose: purpose, tokenExpiresAt: new Date(Date.now() + ttl) },
  });
  return token;
}

export async function signupBuilder(raw: unknown, ctx: { ip: string }): Promise<SignupOutcome> {
  const parsed = builderSignupSchema.safeParse(raw);
  if (!parsed.success) {
    const f = String(parsed.error.issues[0]?.path[0] || "");
    const messages: Record<string, string> = {
      company: "Enter your company name.",
      name: "Enter your name.",
      email: "Enter a valid work e-mail.",
      password: "Use a password with at least 8 characters.",
    };
    throw new BuilderError(400, messages[f] || "Please check the form and try again.", f);
  }
  const d = parsed.data;
  if (d.website) return { email: d.email };
  if (!["on", "1", "true"].includes(String(d.acceptLegal || ""))) {
    throw new BuilderError(400, "Please accept the Terms of Service and Privacy Policy to continue.", "acceptLegal");
  }
  if (d.password.toLowerCase() === d.email) throw new BuilderError(400, "Choose a password that is not your e-mail.", "password");
  const allowed = await takeRate([
    { key: `builder-signup:ip:${ctx.ip}`, max: 5, windowMs: HOUR },
    { key: `builder-signup:ip-day:${ctx.ip}`, max: 20, windowMs: DAY },
    { key: `builder-signup:email:${d.email}`, max: 3, windowMs: HOUR },
  ]);
  if (!allowed) throw new BuilderError(429, "Too many attempts. Please wait a while and try again.");

  const existing = await prisma.builderMember.findUnique({ where: { email: d.email }, include: { account: true } });
  if (existing && existing.status !== "pending_email") {
    throw new BuilderError(409, "This e-mail already has a builder account. Sign in instead.", "email");
  }
  let memberId: string;
  let company = d.company;
  if (existing) {
    // Not confirmed yet: refresh the details and send a new link.
    await prisma.builderAccount.update({ where: { id: existing.builderAccountId }, data: { name: d.company, phone: d.phone || null } });
    await prisma.builderMember.update({
      where: { id: existing.id },
      data: { name: d.name, phone: d.phone || null, passwordHash: await hashPassword(d.password) },
    });
    memberId = existing.id;
  } else {
    const account = await prisma.builderAccount.create({
      data: {
        name: d.company,
        phone: d.phone || null,
        members: {
          create: {
            email: d.email,
            name: d.name,
            phone: d.phone || null,
            passwordHash: await hashPassword(d.password),
            role: "admin",
            status: "pending_email",
          },
        },
      },
      include: { members: true },
    });
    memberId = account.members[0]!.id;
    company = account.name;
  }
  const token = await setMemberToken(memberId, "verify", VERIFY_TTL);
  const link = `${baseUrl()}/builders/confirm?token=${encodeURIComponent(token)}`;
  await sendPlatformEmail("builder_verify", { to: d.email, locale: "en", vars: { name: firstName(d.name), builder: company, link } });
  return { email: d.email, devLink: showDevLink() ? link : undefined };
}

async function memberByToken(token: string, purpose: string) {
  if (!token || token.length > 200) return null;
  const m = await prisma.builderMember.findUnique({ where: { tokenHash: hashToken(token) }, include: { account: true } });
  if (!m || m.tokenPurpose !== purpose) return null;
  if (!m.tokenExpiresAt || m.tokenExpiresAt.getTime() < Date.now()) return null;
  return m;
}

/** Confirms the sign-up e-mail. Returns the member, now active. */
export async function confirmBuilderEmail(token: string) {
  const m = await memberByToken(token, "verify");
  if (!m) throw new BuilderError(400, "This link is invalid or expired. Sign up again to get a new one.");
  return prisma.builderMember.update({
    where: { id: m.id },
    data: { status: "active", tokenHash: null, tokenPurpose: null, tokenExpiresAt: null },
  });
}

export async function loginBuilderMember(email: string, password: string) {
  const m = await prisma.builderMember.findUnique({ where: { email: normEmail(email) }, include: { account: true } });
  if (!m || !m.passwordHash || !(await verifyPassword(password, m.passwordHash))) return { ok: false as const, reason: "bad" as const };
  if (m.status === "pending_email") return { ok: false as const, reason: "unconfirmed" as const };
  if (m.status !== "active" || m.account.status !== "active") return { ok: false as const, reason: "disabled" as const };
  await prisma.builderMember.update({ where: { id: m.id }, data: { lastLoginAt: new Date() } });
  return { ok: true as const, member: m };
}

export async function startBuilderPasswordReset(email: string, ctx: { ip: string }): Promise<{ devLink?: string }> {
  const e = normEmail(email);
  if (!(await takeRate([{ key: `builder-reset:ip:${ctx.ip}`, max: 10, windowMs: HOUR }, { key: `builder-reset:email:${e}`, max: 3, windowMs: HOUR }]))) return {};
  const m = await prisma.builderMember.findUnique({ where: { email: e }, include: { account: true } });
  if (!m || m.status !== "active") return {};
  const token = await setMemberToken(m.id, "reset", RESET_TTL);
  const link = `${baseUrl()}/builders/password?token=${encodeURIComponent(token)}`;
  await sendPlatformEmail("builder_password_reset", { to: m.email, locale: "en", vars: { name: firstName(m.name), builder: m.account.name, link } });
  return { devLink: showDevLink() ? link : undefined };
}

/** Sets the password from an invite or a reset link and activates the member. */
export async function setBuilderPassword(token: string, password: string, name?: string) {
  if (String(password || "").length < 8) throw new BuilderError(400, "Use a password with at least 8 characters.", "password");
  const m = (await memberByToken(token, "invite")) || (await memberByToken(token, "reset"));
  if (!m) throw new BuilderError(400, "This link is invalid or expired. Ask your admin for a new invitation.");
  return prisma.builderMember.update({
    where: { id: m.id },
    data: {
      passwordHash: await hashPassword(password),
      status: "active",
      ...(name && name.trim().length >= 2 ? { name: name.trim().slice(0, 120) } : {}),
      tokenHash: null,
      tokenPurpose: null,
      tokenExpiresAt: null,
    },
    include: { account: true },
  });
}

export async function memberForToken(token: string) {
  return (await memberByToken(token, "invite")) || (await memberByToken(token, "reset"));
}

/* ───────────────────────── session helpers ───────────────────────── */

export async function loadActiveMember(memberId: string | undefined | null) {
  if (!memberId) return null;
  const m = await prisma.builderMember.findUnique({ where: { id: memberId }, include: { account: true } });
  if (!m || m.status !== "active" || m.account.status !== "active") return null;
  return m;
}

export type ActiveMember = NonNullable<Awaited<ReturnType<typeof loadActiveMember>>>;

export async function linksFor(accountId: string) {
  const links = await prisma.builderLink.findMany({
    where: { builderAccountId: accountId, status: { in: ["active", "invited"] } },
    orderBy: [{ status: "asc" }, { companyName: "asc" }],
    include: { _count: { select: { pendingJobs: { where: { deliveredAt: null } } } } },
  });
  const orgIds = links.map((l) => l.organizationId).filter((id): id is string => Boolean(id));
  const orgs = orgIds.length
    ? await prisma.organization.findMany({ where: { id: { in: orgIds } }, select: { id: true, name: true, slug: true, status: true } })
    : [];
  const byId = new Map(orgs.map((o) => [o.id, o]));
  return links
    .map((l) => {
      const org = l.organizationId ? byId.get(l.organizationId) : undefined;
      const usable = l.status === "active" && org && !["canceled", "suspended"].includes(org.status);
      return {
        id: l.id,
        status: usable ? "active" : l.status === "active" ? "unavailable" : "invited",
        company_name: org?.name || l.companyName,
        slug: org?.slug || null,
        organization_id: l.organizationId,
        contact_name: l.contactName,
        contact_email: l.contactEmail,
        contact_phone: l.contactPhone,
        invited_at: l.invitedAt,
        activated_at: l.activatedAt,
        pending_jobs: l._count.pendingJobs,
      };
    });
}

/** The active link between this member's account and a company, if any. */
export async function activeLinkFor(member: ActiveMember, organizationId: string) {
  return prisma.builderLink.findFirst({
    where: { builderAccountId: member.builderAccountId, organizationId, status: "active" },
  });
}

/**
 * The PartnerUser row that stands for this member inside the company (created on first use).
 * An older portal user with the same e-mail is adopted, so its requests stay together.
 */
export async function ensureShadowPartnerUser(member: ActiveMember, link: { organizationId: string | null; tenantBuilderId: string | null }) {
  const organizationId = link.organizationId;
  if (!organizationId) throw new BuilderError(409, "Esta empresa ainda não entrou no ObraMate.");
  return withTenantTransaction(organizationId, async (tx) => {
    const select = {
      id: true,
      organizationId: true,
      builderId: true,
      customerId: true,
      email: true,
      name: true,
      companyName: true,
      mustChangePassword: true,
      builder: { select: { id: true, status: true, type: true, company: true } },
      customer: { select: { id: true, customerType: true, name: true, company: true } },
    } as const;
    let row = await tx.partnerUser.findFirst({ where: { organizationId, builderMemberId: member.id }, select });
    if (!row) {
      const legacy = await tx.partnerUser.findFirst({ where: { organizationId, email: { equals: member.email, mode: "insensitive" } }, select: { id: true } });
      if (legacy) {
        row = await tx.partnerUser.update({
          where: { id: legacy.id },
          data: { builderMemberId: member.id, builderId: link.tenantBuilderId, status: "active", mustChangePassword: false },
          select,
        });
      } else {
        row = await tx.partnerUser.create({
          data: {
            organizationId,
            builderMemberId: member.id,
            builderId: link.tenantBuilderId,
            email: member.email,
            name: member.name,
            companyName: member.account.name,
            // Never used to sign in: builder members sign in with their account.
            passwordHash: await hashPassword(randomBytes(24).toString("hex")),
            status: "active",
            mustChangePassword: false,
          },
          select,
        });
      }
    } else if (row.builderId !== link.tenantBuilderId || row.name !== member.name) {
      row = await tx.partnerUser.update({ where: { id: row.id }, data: { builderId: link.tenantBuilderId, name: member.name, companyName: member.account.name }, select });
    }
    return row;
  });
}

/* ───────────────────────── team ───────────────────────── */

export async function listMembers(accountId: string) {
  const rows = await prisma.builderMember.findMany({ where: { builderAccountId: accountId, status: { not: "disabled" } }, orderBy: [{ createdAt: "asc" }] });
  return rows.map((m) => ({ id: m.id, name: m.name, email: m.email, phone: m.phone, role: m.role, status: m.status, last_login_at: m.lastLoginAt }));
}

export async function inviteMember(actor: ActiveMember, raw: unknown): Promise<{ id: string; devLink?: string }> {
  const parsed = z.object({
    name: z.string().trim().min(2).max(120),
    email: z.string().trim().toLowerCase().email().max(200),
    phone: z.string().trim().max(40).optional().or(z.literal("")),
    role: z.string(),
  }).safeParse(raw);
  if (!parsed.success || !isBuilderRole(parsed.data.role)) throw new BuilderError(400, "Confira nome, e-mail e papel.");
  const d = parsed.data;
  if (!(await takeRate([{ key: `builder-member-invite:${actor.builderAccountId}`, max: 40, windowMs: DAY }]))) {
    throw new BuilderError(429, "Muitos convites hoje. Tente amanhã.");
  }
  const taken = await prisma.builderMember.findUnique({ where: { email: d.email } });
  if (taken && taken.builderAccountId !== actor.builderAccountId) throw new BuilderError(409, "Esse e-mail já está em outra conta de builder.", "email");
  if (taken && taken.status === "active") throw new BuilderError(409, "Essa pessoa já está na equipe.", "email");
  const member = taken
    ? await prisma.builderMember.update({ where: { id: taken.id }, data: { name: d.name, phone: d.phone || null, role: d.role, status: "invited", invitedById: actor.id } })
    : await prisma.builderMember.create({
      data: { builderAccountId: actor.builderAccountId, email: d.email, name: d.name, phone: d.phone || null, role: d.role, status: "invited", invitedById: actor.id },
    });
  const token = await setMemberToken(member.id, "invite", INVITE_TTL);
  const link = `${baseUrl()}/builders/password?token=${encodeURIComponent(token)}`;
  const role = ROLE_LABELS[d.role as BuilderRole];
  await sendPlatformEmail("builder_member_invite", {
    to: d.email,
    locale: "en",
    vars: { name: firstName(d.name), builder: actor.account.name, inviter: actor.name, role: { en: role.en, pt: role.pt }, link },
  });
  return { id: member.id, devLink: showDevLink() ? link : undefined };
}

export async function updateMember(actor: ActiveMember, memberId: string, raw: unknown) {
  const parsed = z.object({ role: z.string().optional(), disabled: z.boolean().optional() }).safeParse(raw);
  if (!parsed.success) throw new BuilderError(400, "Dados inválidos.");
  const m = await prisma.builderMember.findFirst({ where: { id: memberId, builderAccountId: actor.builderAccountId } });
  if (!m) throw new BuilderError(404, "Pessoa não encontrada.");
  const nextRole = parsed.data.role;
  if (nextRole !== undefined && !isBuilderRole(nextRole)) throw new BuilderError(400, "Papel inválido.");
  const losingAdmin = m.role === "admin" && ((nextRole && nextRole !== "admin") || parsed.data.disabled);
  if (losingAdmin) {
    const admins = await prisma.builderMember.count({ where: { builderAccountId: actor.builderAccountId, role: "admin", status: "active", id: { not: m.id } } });
    if (!admins) throw new BuilderError(409, "A conta precisa de pelo menos um admin ativo.");
  }
  return prisma.builderMember.update({
    where: { id: m.id },
    data: {
      ...(nextRole ? { role: nextRole } : {}),
      ...(parsed.data.disabled ? { status: "disabled", tokenHash: null, tokenPurpose: null, tokenExpiresAt: null } : {}),
    },
  });
}

/* ───────────────────────── companies ───────────────────────── */

export const companySchema = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  company_name: z.string().trim().max(120).optional().or(z.literal("")),
  contact_name: z.string().trim().max(120).optional().or(z.literal("")),
  phone: z.string().trim().max(40).optional().or(z.literal("")),
});

/** Admin of an ObraMate company with this e-mail (companies that can work). */
async function companyAdminByEmail(email: string) {
  const users = await prisma.user.findMany({
    where: { email: { equals: email, mode: "insensitive" }, status: "active", role: { key: "admin" } },
    select: { id: true, name: true, email: true, organization: { select: { id: true, name: true, slug: true, status: true } } },
    take: 5,
  });
  return users.find((u) => !["canceled", "suspended"].includes(u.organization.status)) || null;
}

export function inviteSmsText(builderName: string, url: string): string {
  return `${builderName} wants to send you jobs on ObraMate. Create your workspace here: ${url}`;
}

async function offerText(): Promise<{ en: string; pt: string } | null> {
  const c = await builderReferralCoupon();
  return c ? { en: couponTextEn(c), pt: couponText(c) } : null;
}

export type CompanyResult =
  | { kind: "linked"; link_id: string; company_name: string }
  | { kind: "invited"; link_id: string; company_name: string; invite_url: string; sms_text: string; offer: string | null };

/** Links a company already on ObraMate (by its admin's e-mail) or invites it. */
export async function addCompany(actor: ActiveMember, raw: unknown): Promise<CompanyResult> {
  const parsed = companySchema.safeParse(raw);
  if (!parsed.success) throw new BuilderError(400, "Informe o e-mail do responsável pela empresa.", "email");
  const d = parsed.data;
  if (!(await takeRate([{ key: `builder-company:${actor.builderAccountId}`, max: 30, windowMs: DAY }]))) {
    throw new BuilderError(429, "Muitas empresas adicionadas hoje. Tente amanhã.");
  }
  const admin = await companyAdminByEmail(d.email);
  if (admin) {
    const org = admin.organization;
    const existing = await prisma.builderLink.findFirst({ where: { builderAccountId: actor.builderAccountId, organizationId: org.id, status: { in: ["active", "invited"] } } });
    if (existing?.status === "active") throw new BuilderError(409, `Você já está conectado à ${org.name}.`);
    const link = existing
      ? await prisma.builderLink.update({ where: { id: existing.id }, data: { companyName: org.name, contactEmail: d.email } })
      : await prisma.builderLink.create({
        data: {
          builderAccountId: actor.builderAccountId,
          organizationId: org.id,
          status: "invited",
          companyName: org.name,
          contactName: d.contact_name || admin.name,
          contactEmail: d.email,
          contactPhone: d.phone || null,
          invitedById: actor.id,
        },
      });
    await activateLink(link.id, org.id);
    await sendPlatformEmail("builder_company_linked", {
      to: admin.email,
      organizationId: org.id,
      vars: { name: firstName(admin.name), company: org.name, builder: actor.account.name, link: `${workspaceHomeUrl(org.slug)}jobs.html` },
    }).catch(() => undefined);
    return { kind: "linked", link_id: link.id, company_name: org.name };
  }

  const anyUser = await prisma.user.findFirst({ where: { email: { equals: d.email, mode: "insensitive" }, status: "active" }, select: { organization: { select: { name: true } } } });
  if (anyUser) {
    throw new BuilderError(409, `Esse e-mail é de um usuário da ${anyUser.organization.name}, mas não do admin. Use o e-mail do admin da empresa.`, "email");
  }
  if (!d.company_name) throw new BuilderError(400, "Essa empresa ainda não usa o ObraMate. Informe o nome dela para enviar o convite.", "company_name");

  const already = await prisma.builderLink.findFirst({
    where: { builderAccountId: actor.builderAccountId, status: "invited", contactEmail: d.email, organizationId: null },
  });
  const plan = "starter";
  const invite = await prisma.signupInvite.create({
    data: {
      code: randomBytes(9).toString("base64url"),
      email: d.email,
      companyName: d.company_name,
      plan,
      trialDays: await trialDaysFor(plan),
      note: `Indicação do builder ${actor.account.name}`,
      expiresAt: new Date(Date.now() + 60 * DAY),
    },
  });
  const link = already
    ? await prisma.builderLink.update({
      where: { id: already.id },
      data: { companyName: d.company_name, contactName: d.contact_name || null, contactPhone: d.phone || null, signupInviteId: invite.id, invitedAt: new Date(), invitedById: actor.id },
    })
    : await prisma.builderLink.create({
      data: {
        builderAccountId: actor.builderAccountId,
        status: "invited",
        companyName: d.company_name,
        contactName: d.contact_name || null,
        contactEmail: d.email,
        contactPhone: d.phone || null,
        signupInviteId: invite.id,
        invitedById: actor.id,
      },
    });
  const url = `${baseUrl()}/signup?invite=${encodeURIComponent(invite.code)}`;
  const offer = await offerText();
  await sendPlatformEmail("builder_company_invite", {
    to: d.email,
    locale: "en",
    vars: {
      name: firstName(d.contact_name || d.company_name),
      company: d.company_name,
      builder: actor.account.name,
      offer: offer || { en: "special referral price", pt: "preço especial de indicação" },
      link: url,
    },
  });
  return { kind: "invited", link_id: link.id, company_name: d.company_name, invite_url: url, sms_text: inviteSmsText(actor.account.name, url), offer: offer?.pt || null };
}

/** New invitation link (and e-mail) for a company that has not joined yet. */
export async function resendCompanyInvite(actor: ActiveMember, linkId: string): Promise<CompanyResult> {
  const link = await prisma.builderLink.findFirst({ where: { id: linkId, builderAccountId: actor.builderAccountId, status: "invited", organizationId: null } });
  if (!link || !link.contactEmail) throw new BuilderError(404, "Convite não encontrado.");
  return addCompany(actor, { email: link.contactEmail, company_name: link.companyName, contact_name: link.contactName || "", phone: link.contactPhone || "" });
}

export async function removeLink(actor: ActiveMember, linkId: string): Promise<void> {
  const link = await prisma.builderLink.findFirst({ where: { id: linkId, builderAccountId: actor.builderAccountId, status: { in: ["active", "invited"] } } });
  if (!link) throw new BuilderError(404, "Empresa não encontrada.");
  await prisma.builderLink.update({ where: { id: link.id }, data: { status: "removed", removedAt: new Date() } });
  if (link.signupInviteId && !link.organizationId) {
    await prisma.signupInvite.updateMany({ where: { id: link.signupInviteId, usedAt: null }, data: { revokedAt: new Date() } });
  }
}

/** Finds or creates the Builder row inside the company and turns the link on; then delivers kept jobs. */
export async function activateLink(linkId: string, organizationId: string): Promise<void> {
  const link = await prisma.builderLink.findUnique({ where: { id: linkId }, include: { account: { include: { members: { where: { role: "admin" }, orderBy: { createdAt: "asc" }, take: 1 } } } } });
  if (!link) return;
  const admin = link.account.members[0];
  const tenantBuilderId = await withTenantTransaction(organizationId, async (tx) => {
    const name = link.account.name;
    // Only a confirmed e-mail adopts a builder the company already has; a matching company
    // name alone is not proof, and the adopted record exposes its old jobs and invoices.
    const found = admin
      ? await tx.builder.findFirst({
        where: { organizationId, email: { equals: admin.email, mode: "insensitive" } },
        select: { id: true },
      })
      : null;
    if (found) {
      await tx.builder.update({ where: { id: found.id }, data: { status: "active" } });
      return found.id;
    }
    const parts = String(admin?.name || name).trim().split(/\s+/);
    const created = await tx.builder.create({
      data: {
        organizationId,
        firstName: parts[0] || name,
        lastName: parts.slice(1).join(" "),
        company: name,
        email: admin?.email || null,
        phone: link.account.phone || admin?.phone || null,
        type: "builder",
        status: "active",
        notes: "Conta de builder no ObraMate (conectada pelo portal).",
      },
      select: { id: true },
    });
    return created.id;
  });
  await prisma.builderLink.update({
    where: { id: link.id },
    data: { status: "active", organizationId, tenantBuilderId, activatedAt: new Date() },
  });
  await publishAppNotification({
    organizationId,
    type: "builder_linked",
    title: `${link.account.name} se conectou como builder`,
    body: "Os jobs e alterações que ele enviar pelo portal entram direto em Jobs.",
    url: "jobs.html",
    dedupeKey: `builder-linked:${link.id}`,
  }).catch(() => undefined);
  await deliverPendingJobs(link.id).catch((error) => console.error("[builders] deliver pending jobs failed", error));
}

/** Called after a company is created from a sign-up invite. */
export async function onCompanySignup(signupInviteId: string, organizationId: string): Promise<void> {
  const links = await prisma.builderLink.findMany({ where: { signupInviteId, status: "invited", organizationId: null } });
  if (!links.length) return;
  const coupon = await builderReferralCoupon();
  if (coupon) await applyCoupon(organizationId, coupon.code).catch((error) => console.error("[builders] referral coupon failed", error));
  for (const link of links) {
    await prisma.builderLink.update({ where: { id: link.id }, data: { organizationId } });
    await activateLink(link.id, organizationId);
  }
}

/* ───────────────────────── jobs kept for invited companies ───────────────────────── */

export type PendingFile = { key: string; name: string; contentType: string; size: number };

export async function keepPendingJob(
  actor: ActiveMember,
  linkId: string,
  payload: Record<string, unknown>,
  uploads: Array<{ name: string; contentType: string; body: Buffer }>,
) {
  const link = await prisma.builderLink.findFirst({ where: { id: linkId, builderAccountId: actor.builderAccountId, status: "invited", organizationId: null } });
  if (!link) throw new BuilderError(404, "Empresa convidada não encontrada.");
  const row = await prisma.builderPendingJob.create({ data: { builderLinkId: link.id, memberId: actor.id, payload: payload as Prisma.InputJsonValue } });
  const files: PendingFile[] = [];
  for (const u of uploads) {
    const key = `builders/${actor.builderAccountId}/pending/${row.id}/${randomBytes(8).toString("hex")}`;
    const stored = await storage.upload({ key, body: u.body, contentType: u.contentType });
    files.push({ key: stored.key, name: u.name, contentType: u.contentType, size: stored.size });
  }
  if (files.length) await prisma.builderPendingJob.update({ where: { id: row.id }, data: { files: files as unknown as Prisma.InputJsonValue } });
  return row;
}

export async function listPendingJobs(actor: ActiveMember, linkId: string) {
  const rows = await prisma.builderPendingJob.findMany({
    where: { builderLinkId: linkId, link: { builderAccountId: actor.builderAccountId } },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return rows.map((r) => {
    const p = r.payload as Record<string, unknown>;
    return { id: r.id, title: String(p.title || ""), address: String(p.address || ""), preferred_date: p.preferred_date || null, created_at: r.createdAt, delivered_at: r.deliveredAt, files: (r.files as unknown as PendingFile[]).length };
  });
}

async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
  return Buffer.concat(chunks);
}

/** Creates the kept jobs inside the company (as builder requests applied right away). */
export async function deliverPendingJobs(linkId: string): Promise<number> {
  const link = await prisma.builderLink.findUnique({ where: { id: linkId } });
  if (!link?.organizationId || link.status !== "active") return 0;
  const rows = await prisma.builderPendingJob.findMany({ where: { builderLinkId: link.id, deliveredAt: null }, orderBy: { createdAt: "asc" } });
  let delivered = 0;
  for (const row of rows) {
    const member = await prisma.builderMember.findUnique({ where: { id: row.memberId }, include: { account: true } });
    const fallback = member || (await prisma.builderMember.findFirst({ where: { builderAccountId: link.builderAccountId, role: "admin" }, include: { account: true } }));
    if (!fallback) continue;
    const shadow = await ensureShadowPartnerUser(fallback as ActiveMember, link);
    const p = row.payload as Record<string, string>;
    const files: PendingFile[] = [];
    for (const f of (row.files as unknown as PendingFile[]) || []) {
      const stream = await storage.getStream(f.key);
      if (!stream) continue;
      const body = await streamToBuffer(stream);
      const key = `orgs/${link.organizationId}/partner-requests/${row.id}/${randomBytes(8).toString("hex")}`;
      const stored = await storage.upload({ key, body, contentType: f.contentType });
      files.push({ key: stored.key, name: f.name, contentType: f.contentType, size: stored.size });
    }
    const jobId = await withTenantTransaction(link.organizationId, async (tx) => {
      const req = await createRequestRow(tx, link.organizationId!, shadow, p, files, { source: "builder_pending", kept_at: row.createdAt.toISOString(), ...(Array.isArray(p.items) && p.items.length ? { items: p.items } : {}), ...(p.pickup ? { pickup: p.pickup } : {}) });
      const r = await applyPartnerRequest(tx, link.organizationId!, req.id, null);
      return r.kind === "accepted" ? r.job_id : null;
    });
    await prisma.builderPendingJob.update({ where: { id: row.id }, data: { deliveredAt: new Date(), workOrderId: jobId } });
    for (const f of (row.files as unknown as PendingFile[]) || []) await storage.delete(f.key).catch(() => undefined);
    delivered += 1;
  }
  if (delivered) {
    await publishAppNotification({
      organizationId: link.organizationId,
      type: "builder_jobs_delivered",
      title: `${delivered === 1 ? "1 job chegou" : `${delivered} jobs chegaram`} do builder`,
      body: "Jobs enviados enquanto a empresa ainda não estava no ObraMate. Estão em Jobs › Sem data.",
      url: "jobs.html",
      dedupeKey: `builder-delivered:${link.id}:${Date.now()}`,
    }).catch(() => undefined);
  }
  return delivered;
}

/** Inserts a portal request row (shared by kept jobs and live sends). */
export async function createRequestRow(
  tx: TenantPrisma,
  organizationId: string,
  partner: { id: string; builderId: string | null; customerId: string | null },
  p: Record<string, unknown>,
  files: PendingFile[],
  intake: Record<string, unknown> | null,
) {
  const str = (k: string, max: number) => String(p[k] ?? "").trim().slice(0, max);
  const date = str("preferred_date", 10);
  return tx.partnerJobRequest.create({
    data: {
      organizationId,
      partnerUserId: partner.id,
      customerId: partner.customerId,
      builderId: partner.builderId,
      title: str("title", 160) || "Job",
      address: str("address", 300) || "—",
      contactName: str("contact_name", 120) || null,
      contactEmail: str("contact_email", 254) || null,
      contactPhone: str("contact_phone", 40) || null,
      serviceType: str("service_type", 100) || null,
      preferredDate: /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(`${date}T12:00:00.000Z`) : null,
      notes: str("notes", 5000) || null,
      externalRef: str("external_ref", 60) || null,
      targetWorkOrderId: null,
      files: files as unknown as Prisma.InputJsonValue,
      ...(intake ? { intake: intake as Prisma.InputJsonValue } : {}),
    },
  });
}
