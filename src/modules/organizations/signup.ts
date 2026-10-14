import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { env } from "../../config/env.js";
import { hashPassword } from "../../lib/auth/password.js";
import { sendPlatformEmail, firstName } from "../../lib/email/templates.js";
import { newToken, hashToken, takeRate, HOUR, DAY } from "../../lib/security/db-rate-limit.js";
import { currentLegalVersions, type LegalKey } from "../../lib/legal/documents.js";
import { recordLegalAcceptance } from "../../lib/legal/acceptance.js";
import { createOrganizationWithAdmin, validateSlug } from "./service.js";
import { trialDaysFor } from "../../master/plans.js";

/* ───────────────────────── settings ───────────────────────── */

export type SignupMode = "open" | "invite" | "closed";
const SETTING_KEY = "platform.signup";

export async function signupMode(): Promise<SignupMode> {
  const row = await prisma.systemSetting.findUnique({ where: { key: SETTING_KEY } }).catch(() => null);
  try {
    const m = row ? (JSON.parse(row.value) as { mode?: string }).mode : null;
    return m === "invite" || m === "closed" ? m : "open";
  } catch {
    return "open";
  }
}

export async function setSignupMode(mode: SignupMode): Promise<void> {
  const value = JSON.stringify({ mode });
  await prisma.systemSetting.upsert({ where: { key: SETTING_KEY }, create: { key: SETTING_KEY, value }, update: { value } });
}

/* ───────────────────────── limits ───────────────────────── */

export const SIGNUP_TTL_MS = 48 * HOUR;
const RESEND_GAP_MS = 60e3;
const MAX_SENDS = 5;

export const US_TIMEZONES: { id: string; label: string }[] = [
  { id: "America/New_York", label: "Eastern (New York)" },
  { id: "America/Chicago", label: "Central (Chicago)" },
  { id: "America/Denver", label: "Mountain (Denver)" },
  { id: "America/Phoenix", label: "Mountain, no DST (Phoenix)" },
  { id: "America/Los_Angeles", label: "Pacific (Los Angeles)" },
  { id: "America/Anchorage", label: "Alaska" },
  { id: "Pacific/Honolulu", label: "Hawaii" },
];

/* ───────────────────────── invites ───────────────────────── */

export async function findInvite(code: string | null | undefined) {
  const c = String(code || "").trim();
  if (!c || c.length > 64) return null;
  const inv = await prisma.signupInvite.findUnique({ where: { code: c } });
  if (!inv || inv.revokedAt || inv.usedAt) return null;
  if (inv.expiresAt && inv.expiresAt.getTime() < Date.now()) return null;
  return inv;
}

/* ───────────────────────── request ───────────────────────── */

export const signupSchema = z.object({
  organizationName: z.string().trim().min(2).max(120),
  slug: z.string().trim().toLowerCase().min(2).max(48),
  adminName: z.string().trim().min(2).max(120),
  adminEmail: z.string().trim().toLowerCase().email().max(200),
  password: z.string().min(8).max(128),
  contactPhone: z.string().trim().max(40).optional().or(z.literal("")),
  timezone: z.string().optional(),
  acceptLegal: z.string().optional(),
  invite: z.string().max(64).optional().or(z.literal("")),
  /** Honeypot: real people never fill it. */
  website: z.string().optional(),
});

export type SignupFormError = { field?: string; message: string };

export type RequestResult =
  | { ok: true; requestId: string; email: string; devLink?: string }
  | { ok: false; status: number; error: SignupFormError };

function verifyUrl(token: string): string {
  return `${env.APP_BASE_URL.replace(/\/$/, "")}/signup/verify?token=${encodeURIComponent(token)}`;
}

async function sendVerifyEmail(to: string, name: string, company: string, token: string): Promise<void> {
  await sendPlatformEmail("signup_verify", { to, organizationId: null, vars: { name: firstName(name), company, link: verifyUrl(token) } });
}

/**
 * Validates the form, applies the limits and e-mails a confirmation link.
 * Nothing is created in the company tables until the link is confirmed.
 */
export async function requestSignup(raw: unknown, ctx: { ip: string; userAgent?: string }): Promise<RequestResult> {
  const parsed = signupSchema.safeParse(raw);
  if (!parsed.success) {
    const f = parsed.error.issues[0]?.path[0];
    const messages: Record<string, string> = {
      organizationName: "Enter your company name.",
      slug: "Choose a workspace address (2–48 letters, numbers or hyphens).",
      adminName: "Enter your name.",
      adminEmail: "Enter a valid work e-mail.",
      password: "Use a password with at least 8 characters.",
    };
    return { ok: false, status: 400, error: { field: String(f || ""), message: messages[String(f)] || "Please check the form and try again." } };
  }
  const d = parsed.data;

  const mode = await signupMode();
  const invite = d.invite ? await findInvite(d.invite) : null;
  if (mode === "closed") return { ok: false, status: 403, error: { message: "New sign-ups are paused right now. Please contact us." } };
  if (mode === "invite" && !invite) {
    return { ok: false, status: 403, error: { field: "invite", message: "Sign-up is by invitation right now. Use the link from your invitation e-mail." } };
  }
  if (invite?.email && invite.email.toLowerCase() !== d.adminEmail) {
    return { ok: false, status: 400, error: { field: "adminEmail", message: `This invitation is for ${invite.email}.` } };
  }

  if (d.website) {
    // Bot: pretend it worked, store nothing.
    return { ok: true, requestId: "", email: d.adminEmail };
  }
  if (d.acceptLegal !== "on" && d.acceptLegal !== "1" && d.acceptLegal !== "true") {
    return { ok: false, status: 400, error: { field: "acceptLegal", message: "Please accept the Terms of Service, Privacy Policy and DPA to continue." } };
  }
  const slugError = validateSlug(d.slug);
  if (slugError) return { ok: false, status: 400, error: { field: "slug", message: slugError.replace(/^Slug/, "The workspace address") } };
  if (d.password.toLowerCase() === d.adminEmail || d.password.toLowerCase().includes(d.slug)) {
    return { ok: false, status: 400, error: { field: "password", message: "Choose a password that is not your e-mail or company name." } };
  }
  if (await prisma.organization.findUnique({ where: { slug: d.slug }, select: { id: true } })) {
    return { ok: false, status: 400, error: { field: "slug", message: "This workspace address is already taken. Try another one." } };
  }

  const allowed = await takeRate([
    { key: `signup:ip:${ctx.ip}`, max: 5, windowMs: HOUR },
    { key: `signup:ip-day:${ctx.ip}`, max: 20, windowMs: DAY },
    { key: `signup:email:${d.adminEmail}`, max: 3, windowMs: HOUR },
  ]);
  if (!allowed) return { ok: false, status: 429, error: { message: "Too many sign-up attempts. Please wait a while and try again." } };

  const timezone = US_TIMEZONES.some((t) => t.id === d.timezone) ? d.timezone! : "America/Denver";
  const { token, hash } = newToken();
  const data = {
    tokenHash: hash,
    email: d.adminEmail,
    organizationName: d.organizationName,
    slug: d.slug,
    adminName: d.adminName,
    passwordHash: await hashPassword(d.password),
    contactPhone: d.contactPhone || null,
    timezone,
    inviteId: invite?.id || null,
    ip: ctx.ip.slice(0, 80),
    userAgent: ctx.userAgent ? ctx.userAgent.slice(0, 300) : null,
    legalVersions: currentLegalVersions(),
    expiresAt: new Date(Date.now() + SIGNUP_TTL_MS),
  };
  // Same e-mail + address still pending: replace it instead of piling up requests.
  const pending = await prisma.signupRequest.findFirst({
    where: { email: d.adminEmail, slug: d.slug, verifiedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
  });
  const row = pending
    ? await prisma.signupRequest.update({ where: { id: pending.id }, data: { ...data, sendCount: { increment: 1 }, lastSentAt: new Date() } })
    : await prisma.signupRequest.create({ data });

  await sendVerifyEmail(d.adminEmail, d.adminName, d.organizationName, token);
  return { ok: true, requestId: row.id, email: d.adminEmail, devLink: showDevLink() ? verifyUrl(token) : undefined };
}

/** Sends the confirmation e-mail again (new link; the old one stops working). */
export async function resendSignup(requestId: string, ctx: { ip: string }): Promise<{ ok: true; devLink?: string } | { ok: false; message: string }> {
  const row = await prisma.signupRequest.findUnique({ where: { id: requestId } }).catch(() => null);
  if (!row || row.verifiedAt) return { ok: false, message: "This sign-up was already confirmed or no longer exists. Try signing in." };
  if (row.expiresAt.getTime() < Date.now()) return { ok: false, message: "This sign-up expired. Please start again." };
  if (row.sendCount >= MAX_SENDS) return { ok: false, message: "We already sent several e-mails. Check your spam folder or contact us." };
  if (Date.now() - row.lastSentAt.getTime() < RESEND_GAP_MS) return { ok: false, message: "We just sent it. Wait a minute before asking again." };
  if (!(await takeRate([{ key: `signup-resend:ip:${ctx.ip}`, max: 10, windowMs: HOUR }]))) return { ok: false, message: "Too many attempts. Please wait a while." };
  const { token, hash } = newToken();
  await prisma.signupRequest.update({ where: { id: row.id }, data: { tokenHash: hash, sendCount: { increment: 1 }, lastSentAt: new Date() } });
  await sendVerifyEmail(row.email, row.adminName, row.organizationName, token);
  return { ok: true, devLink: showDevLink() ? verifyUrl(token) : undefined };
}

/* ───────────────────────── confirm ───────────────────────── */

export async function findSignupByToken(token: string) {
  if (!token || token.length > 200) return null;
  return prisma.signupRequest.findUnique({ where: { tokenHash: hashToken(token) } });
}

export type VerifyResult =
  | { ok: true; organization: { id: string; name: string; slug: string }; admin: { id: string } }
  | { ok: false; reason: "invalid" | "expired" | "already" | "slug_taken" | "closed"; slug?: string };

/** Creates the company from a confirmed sign-up. Safe to call twice (second call reports "already"). */
export async function confirmSignup(token: string, ctx: { ip: string; userAgent?: string }): Promise<VerifyResult> {
  const row = await findSignupByToken(token);
  if (!row) return { ok: false, reason: "invalid" };
  if (row.verifiedAt) return { ok: false, reason: "already", slug: row.slug };
  if (row.expiresAt.getTime() < Date.now()) return { ok: false, reason: "expired" };

  const invite = row.inviteId ? await prisma.signupInvite.findUnique({ where: { id: row.inviteId } }) : null;
  const inviteUsable = !!invite && !invite.revokedAt && !invite.usedAt && (!invite.expiresAt || invite.expiresAt.getTime() > Date.now());
  const mode = await signupMode();
  if (mode === "closed" || (mode === "invite" && !inviteUsable)) return { ok: false, reason: "closed" };

  // Claim the request first so a double click cannot create two companies.
  const claimed = await prisma.signupRequest.updateMany({ where: { id: row.id, verifiedAt: null }, data: { verifiedAt: new Date() } });
  if (claimed.count === 0) return { ok: false, reason: "already", slug: row.slug };

  if (await prisma.organization.findUnique({ where: { slug: row.slug }, select: { id: true } })) {
    await prisma.signupRequest.update({ where: { id: row.id }, data: { verifiedAt: null } });
    return { ok: false, reason: "slug_taken", slug: row.slug };
  }

  const plan = inviteUsable ? invite!.plan : "starter";
  const trialDays = inviteUsable ? invite!.trialDays : await trialDaysFor(plan);
  let created: Awaited<ReturnType<typeof createOrganizationWithAdmin>>;
  try {
    created = await createOrganizationWithAdmin({
      organizationName: row.organizationName,
      slug: row.slug,
      adminName: row.adminName,
      adminEmail: row.email,
      password: "",
      passwordHash: row.passwordHash,
      contactPhone: row.contactPhone || undefined,
      timezone: row.timezone,
      plan,
      trialDays,
    });
  } catch (error) {
    await prisma.signupRequest.update({ where: { id: row.id }, data: { verifiedAt: null } });
    if (error instanceof Error && /taken|unique/i.test(error.message)) return { ok: false, reason: "slug_taken", slug: row.slug };
    throw error;
  }
  const { organization, admin } = created;

  await prisma.signupRequest.update({ where: { id: row.id }, data: { organizationId: organization.id } });
  await recordLegalAcceptance(
    organization.id,
    { id: admin.id, name: row.adminName, email: row.email },
    { source: "signup", ip: row.ip, userAgent: row.userAgent, versions: row.legalVersions as Partial<Record<LegalKey, string>> },
  );
  if (inviteUsable) {
    await prisma.signupInvite.update({ where: { id: invite!.id }, data: { usedAt: new Date(), organizationId: organization.id } });
  }
  void ctx;
  return { ok: true, organization: { id: organization.id, name: organization.name, slug: organization.slug }, admin: { id: admin.id } };
}

/** Local testing only: show the confirmation link on screen (never set in production). */
function showDevLink(): boolean {
  return process.env.SIGNUP_SHOW_DEV_LINK === "1";
}
