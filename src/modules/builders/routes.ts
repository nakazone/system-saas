/**
 * Builder accounts — public pages (landing + free sign-up, confirm, password) and the
 * account API (company selection, companies, team, jobs kept for invited companies).
 * Mounted before tenant resolution: a builder account is not inside any company.
 */
import fs from "node:fs";
import path from "node:path";
import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { env } from "../../config/env.js";
import { prisma } from "../../lib/prisma.js";
import { takeRate, HOUR } from "../../lib/security/db-rate-limit.js";
import { CRM_PUBLIC_DIR } from "../../crm/mount.js";
import {
  BuilderError,
  addCompany,
  confirmBuilderEmail,
  inviteMember,
  keepPendingJob,
  linksFor,
  listMembers,
  removeMember,
  resendMemberInvite,
  updateOwnProfile,
  listPendingJobs,
  loadActiveMember,
  loginBuilderMember,
  memberForToken,
  removeLink,
  resendCompanyInvite,
  setBuilderPassword,
  signupBuilder,
  startBuilderPasswordReset,
  updateMember,
  type ActiveMember,
} from "../../lib/builders/accounts.js";
import { can, permissionsFor, ROLE_LABELS, BUILDER_ROLES, type BuilderPermission } from "../../lib/builders/roles.js";
import { deletePickup, listPickups, pickupForWorkOrder, savePickup } from "../../lib/builders/pickups.js";
import { voiceToActions } from "../../lib/builders/voice.js";
import { askMate } from "../../lib/builders/mate.js";
import { copyPrices, deletePrice, listPrices, savePrice } from "../../lib/builders/prices.js";
import { storage } from "../../lib/storage/index.js";
import { reverseGeocode } from "../../lib/payroll/geocode.js";

function accountView(a: {
  id: string; name: string; phone: string | null; website?: string | null; email?: string | null; billingEmail?: string | null;
  addressLine1?: string | null; addressLine2?: string | null; city?: string | null; state?: string | null; postalCode?: string | null;
  licenseNumber?: string | null; logoUrl?: string | null;
}) {
  return {
    id: a.id,
    name: a.name,
    phone: a.phone,
    website: a.website ?? null,
    email: a.email ?? null,
    billing_email: a.billingEmail ?? null,
    address_line1: a.addressLine1 ?? null,
    address_line2: a.addressLine2 ?? null,
    city: a.city ?? null,
    state: a.state ?? null,
    postal_code: a.postalCode ?? null,
    license_number: a.licenseNumber ?? null,
    logo_url: a.logoUrl ?? null,
  };
}
import {
  addPhoto,
  completeMeasurement,
  createMeasurement,
  deleteMeasurement,
  getMeasurement,
  listMeasurements,
  nearbyMeasurements,
  findMeasurementForAddress,
  measurementPack,
  photoStream,
  saveMeasurement,
} from "../../lib/builders/measurements.js";
import { builderReferralCoupon, couponTextEn } from "../../lib/billing/coupons.js";
import { intakeItemsSchema, isIntakeReaderConfigured, readWorkOrder, type IntakeFile } from "../../lib/partner-intake/extract.js";

export const builderAccountRouter = Router();

type BuilderReq = Request & { builderMember?: ActiveMember };

function clientIp(req: Request): string {
  return String(req.ip || req.socket.remoteAddress || "0.0.0.0");
}

function pageLocals(extra: Record<string, unknown> = {}) {
  return { productName: env.PRODUCT_NAME, ...extra };
}

async function saveSession(req: Request): Promise<void> {
  await new Promise<void>((resolve, reject) => req.session.save((e) => (e ? reject(e) : resolve())));
}

/** Signs the member in and opens the first company they can work with. */
async function startBuilderSession(req: Request, member: ActiveMember | { id: string; builderAccountId: string }): Promise<void> {
  await new Promise<void>((resolve, reject) => req.session.regenerate((e) => (e ? reject(e) : resolve())));
  req.session.builderMemberId = member.id;
  const links = await linksFor(member.builderAccountId);
  const first = links.find((l) => l.status === "active");
  if (first) {
    req.session.organizationId = first.organization_id!;
    req.session.workspaceSlug = first.slug!;
  }
  await saveSession(req);
}

function sendError(res: Response, error: unknown, next: NextFunction): void {
  if (error instanceof BuilderError) {
    res.status(error.status).json({ success: false, error: error.message, field: error.field });
    return;
  }
  next(error);
}

async function requireBuilder(req: BuilderReq, res: Response, next: NextFunction): Promise<void> {
  try {
    const member = await loadActiveMember(req.session?.builderMemberId);
    if (!member) {
      res.status(401).json({ success: false, error: "Sign in to your builder account." });
      return;
    }
    req.builderMember = member;
    next();
  } catch (error) {
    next(error);
  }
}

function needs(permission: BuilderPermission) {
  return (req: BuilderReq, res: Response, next: NextFunction): void => {
    if (!can(req.builderMember?.role, permission)) {
      res.status(403).json({ success: false, error: "Your role on the team does not allow this.", code: "forbidden" });
      return;
    }
    next();
  };
}

/* ───────────────────────── public pages ───────────────────────── */

builderAccountRouter.get(["/builders", "/builders/"], async (_req, res, next) => {
  try {
    const coupon = await builderReferralCoupon();
    res.render("builders/landing", pageLocals({ values: {}, error: null, offer: coupon ? couponTextEn(coupon) : null }));
  } catch (error) {
    next(error);
  }
});

builderAccountRouter.post("/builders/signup", async (req, res, next) => {
  try {
    const out = await signupBuilder(req.body, { ip: clientIp(req) });
    res.render("builders/check", pageLocals({ email: out.email, devLink: out.devLink || null }));
  } catch (error) {
    if (error instanceof BuilderError) {
      const coupon = await builderReferralCoupon().catch(() => null);
      const values = { ...(req.body || {}), password: "" };
      res.status(error.status).render("builders/landing", pageLocals({ values, error: { message: error.message, field: error.field }, offer: coupon ? couponTextEn(coupon) : null }));
      return;
    }
    next(error);
  }
});

builderAccountRouter.get("/builders/confirm", async (req, res, next) => {
  try {
    const member = await confirmBuilderEmail(String(req.query.token || ""));
    await startBuilderSession(req, member);
    res.redirect("/partner-portal.html#companies");
  } catch (error) {
    if (error instanceof BuilderError) {
      res.status(400).render("builders/message", pageLocals({ title: "Link expired", heading: "This link no longer works", text: error.message, action: { href: "/builders", label: "Sign up again" } }));
      return;
    }
    next(error);
  }
});

builderAccountRouter.get("/builders/password", async (req, res, next) => {
  try {
    const token = String(req.query.token || "");
    const member = await memberForToken(token);
    if (!member) {
      res.status(400).render("builders/message", pageLocals({ title: "Link expired", heading: "This link no longer works", text: "Ask your admin for a new invitation, or request a new password link.", action: { href: "/builders/forgot", label: "Get a new link" } }));
      return;
    }
    res.render("builders/password", pageLocals({ token, member: { name: member.name, email: member.email, invited: member.tokenPurpose === "invite" }, builder: member.account.name, error: null }));
  } catch (error) {
    next(error);
  }
});

builderAccountRouter.post("/builders/password", async (req, res, next) => {
  const token = String(req.body?.token || "");
  try {
    const member = await setBuilderPassword(token, String(req.body?.password || ""), String(req.body?.name || ""));
    await startBuilderSession(req, member);
    res.redirect("/partner-portal.html");
  } catch (error) {
    if (error instanceof BuilderError) {
      const member = await memberForToken(token).catch(() => null);
      if (!member) {
        res.status(400).render("builders/message", pageLocals({ title: "Link expired", heading: "This link no longer works", text: error.message, action: { href: "/builders/forgot", label: "Get a new link" } }));
        return;
      }
      res.status(400).render("builders/password", pageLocals({ token, member: { name: member.name, email: member.email, invited: member.tokenPurpose === "invite" }, builder: member.account.name, error: error.message }));
      return;
    }
    next(error);
  }
});

builderAccountRouter.get("/builders/forgot", (_req, res) => {
  res.render("builders/forgot", pageLocals({ sent: false, devLink: null }));
});

builderAccountRouter.post("/builders/forgot", async (req, res, next) => {
  try {
    const out = await startBuilderPasswordReset(String(req.body?.email || ""), { ip: clientIp(req) });
    res.render("builders/forgot", pageLocals({ sent: true, devLink: out.devLink || null }));
  } catch (error) {
    next(error);
  }
});

/* ───────────────────────── sign-in (shared portal login) ───────────────────────── */

/**
 * The portal login tries the builder account first; anyone else falls through to the
 * company-scoped partner login that already exists.
 */
builderAccountRouter.post("/api/partner-auth/login", async (req, res, next) => {
  try {
    const email = String(req.body?.email || "").trim().toLowerCase();
    if (!email || !(await prisma.builderMember.findUnique({ where: { email }, select: { id: true } }))) {
      next();
      return;
    }
    if (!(await takeRate([{ key: `builder-login:ip:${clientIp(req)}`, max: 20, windowMs: HOUR }, { key: `builder-login:email:${email}`, max: 10, windowMs: HOUR }]))) {
      res.status(429).json({ success: false, error: "Too many attempts. Wait a moment and try again." });
      return;
    }
    const result = await loginBuilderMember(email, String(req.body?.password || ""));
    if (!result.ok) {
      const messages = {
        bad: "E-mail ou senha incorretos.",
        unconfirmed: "Confirme seu e-mail pelo link que enviamos antes de entrar.",
        disabled: "Seu acesso foi desativado. Fale com o admin da sua equipe.",
      };
      // Not a builder password: an older portal access with the same e-mail may still work.
      if (result.reason === "bad") {
        next();
        return;
      }
      res.status(401).json({ success: false, error: messages[result.reason] });
      return;
    }
    await startBuilderSession(req, result.member);
    res.json({ success: true, data: { name: result.member.name, company_name: result.member.account.name, builder_account: true, must_change_password: false } });
  } catch (error) {
    next(error);
  }
});

/** Builder sessions are signed in even before any company is connected. */
builderAccountRouter.get("/api/partner-auth/session", async (req, res, next) => {
  try {
    const member = await loadActiveMember(req.session?.builderMemberId);
    if (!member) {
      next();
      return;
    }
    res.json({ success: true, authenticated: true, data: { name: member.name, email: member.email, company_name: member.account.name, builder_account: true, must_change_password: false } });
  } catch (error) {
    next(error);
  }
});

/** Builder sessions get the portal page even before any company is connected. */
builderAccountRouter.get("/partner-portal.html", async (req, res, next) => {
  try {
    if (!req.session?.builderMemberId) {
      next();
      return;
    }
    const member = await loadActiveMember(req.session.builderMemberId);
    if (!member) {
      next();
      return;
    }
    const html = fs.readFileSync(path.join(CRM_PUBLIC_DIR, "partner-portal.html"), "utf8");
    res.setHeader("Cache-Control", "no-store, max-age=0");
    res.type("html").send(html);
  } catch (error) {
    next(error);
  }
});

/* ───────────────────────── account API ───────────────────────── */

/**
 * Builders see every connected company at once, so each portal call names its company
 * (header X-Builder-Company, or ?bc= on file links) instead of relying on one session company.
 */
builderAccountRouter.use("/api/partner-portal", async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!req.session?.builderMemberId) {
      next();
      return;
    }
    const linkId = String(req.get("x-builder-company") || (typeof req.query.bc === "string" ? req.query.bc : "") || "").trim();
    if (!linkId) {
      next();
      return;
    }
    const member = await loadActiveMember(req.session.builderMemberId);
    if (!member) {
      res.status(401).json({ success: false, error: "Sign in to your builder account." });
      return;
    }
    const link = (await linksFor(member.builderAccountId)).find((l) => l.id === linkId && l.status === "active");
    if (!link || !link.organization_id) {
      res.status(404).json({ success: false, error: "Company not connected." });
      return;
    }
    (req as Request & { builderTenantId?: string; builderLinkId?: string }).builderTenantId = link.organization_id;
    (req as Request & { builderTenantId?: string; builderLinkId?: string }).builderLinkId = link.id;
    next();
  } catch (error) {
    next(error);
  }
});

/* ───────────────────────── measurements (stairs & vents) ───────────────────────── */

builderAccountRouter.get("/api/builder/measurements", requireBuilder, needs("measure"), async (req: BuilderReq, res, next) => {
  try {
    res.json({ success: true, data: await listMeasurements(req.builderMember!) });
  } catch (error) {
    sendError(res, error, next);
  }
});

/* ───────────────────────── pickup locations ───────────────────────── */

builderAccountRouter.get("/api/builder/pickups", requireBuilder, async (req: BuilderReq, res, next) => {
  try {
    res.json({ success: true, data: await listPickups(req.builderMember!.builderAccountId) });
  } catch (error) {
    sendError(res, error, next);
  }
});

builderAccountRouter.post("/api/builder/pickups", requireBuilder, needs("team.manage"), async (req: BuilderReq, res, next) => {
  try {
    res.status(201).json({ success: true, data: await savePickup(req.builderMember!, null, req.body || {}) });
  } catch (error) {
    sendError(res, error, next);
  }
});

builderAccountRouter.patch("/api/builder/pickups/:id", requireBuilder, needs("team.manage"), async (req: BuilderReq, res, next) => {
  try {
    res.json({ success: true, data: await savePickup(req.builderMember!, String(req.params.id), req.body || {}) });
  } catch (error) {
    sendError(res, error, next);
  }
});

builderAccountRouter.delete("/api/builder/pickups/:id", requireBuilder, needs("team.manage"), async (req: BuilderReq, res, next) => {
  try {
    await deletePickup(req.builderMember!, String(req.params.id));
    res.json({ success: true });
  } catch (error) {
    sendError(res, error, next);
  }
});

builderAccountRouter.get("/api/builder/measurements/match", requireBuilder, async (req: BuilderReq, res, next) => {
  try {
    res.json({ success: true, data: await findMeasurementForAddress(req.builderMember!.builderAccountId, String(req.query.address || "")) });
  } catch (error) {
    sendError(res, error, next);
  }
});

builderAccountRouter.post("/api/builder/measurements", requireBuilder, needs("measure"), async (req: BuilderReq, res, next) => {
  try {
    res.status(201).json({ success: true, data: await createMeasurement(req.builderMember!, req.body || {}) });
  } catch (error) {
    sendError(res, error, next);
  }
});

builderAccountRouter.get("/api/builder/measurements/:id", requireBuilder, needs("measure"), async (req: BuilderReq, res, next) => {
  try {
    res.json({ success: true, data: await getMeasurement(req.builderMember!, String(req.params.id)) });
  } catch (error) {
    sendError(res, error, next);
  }
});

builderAccountRouter.put("/api/builder/measurements/:id", requireBuilder, needs("measure"), async (req: BuilderReq, res, next) => {
  try {
    res.json({ success: true, data: await saveMeasurement(req.builderMember!, String(req.params.id), req.body || {}) });
  } catch (error) {
    sendError(res, error, next);
  }
});

builderAccountRouter.post("/api/builder/measurements/:id/complete", requireBuilder, needs("measure"), async (req: BuilderReq, res, next) => {
  try {
    res.json({ success: true, data: await completeMeasurement(req.builderMember!, String(req.params.id), req.body?.done !== false) });
  } catch (error) {
    sendError(res, error, next);
  }
});

builderAccountRouter.delete("/api/builder/measurements/:id", requireBuilder, needs("measure"), async (req: BuilderReq, res, next) => {
  try {
    await deleteMeasurement(req.builderMember!, String(req.params.id));
    res.json({ success: true });
  } catch (error) {
    sendError(res, error, next);
  }
});

builderAccountRouter.post("/api/builder/measurements/:id/photos", requireBuilder, needs("measure"), async (req: BuilderReq, res, next) => {
  try {
    res.status(201).json({ success: true, data: await addPhoto(req.builderMember!, String(req.params.id), String(req.body?.data_url || "")) });
  } catch (error) {
    sendError(res, error, next);
  }
});

/** Ask Mate: questions about the builder's own jobs, invoices and measurements (text or voice). */
builderAccountRouter.post("/api/builder/mate", requireBuilder, async (req: BuilderReq, res, next) => {
  try {
    if (!(await takeRate([{ key: `builder-mate:${req.builderMember!.id}`, max: 120, windowMs: HOUR }]))) {
      throw new BuilderError(429, "Mate needs a break. Try again in a bit.");
    }
    const snapshot = { ...(req.body?.snapshot || {}), money: can(req.builderMember!.role, "money.view") };
    res.json({ success: true, data: await askMate({ question: req.body?.question, audio: req.body?.audio, snapshot, history: req.body?.history }) });
  } catch (error) {
    sendError(res, error, next);
  }
});

/** Address at the phone's location (for a new measurement) and measurements already taken there. */
builderAccountRouter.post("/api/builder/geo", requireBuilder, needs("measure"), async (req: BuilderReq, res, next) => {
  try {
    const lat = Number(req.body?.lat);
    const lng = Number(req.body?.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) throw new BuilderError(400, "Location not available.");
    if (!(await takeRate([{ key: `builder-geo:${req.builderMember!.builderAccountId}`, max: 120, windowMs: HOUR }]))) {
      throw new BuilderError(429, "Too many location lookups. Type the address.");
    }
    const [place, nearby] = await Promise.all([reverseGeocode(lat, lng).catch(() => null), nearbyMeasurements(req.builderMember!, lat, lng).catch(() => [])]);
    res.json({ success: true, data: { place, nearby } });
  } catch (error) {
    sendError(res, error, next);
  }
});

builderAccountRouter.post("/api/builder/measurements/:id/voice", requireBuilder, needs("measure"), async (req: BuilderReq, res, next) => {
  try {
    const m = await getMeasurement(req.builderMember!, String(req.params.id));
    if (m.status === "used") throw new BuilderError(409, "This measurement was already sent with a job.");
    if (!(await takeRate([{ key: `builder-voice:${req.builderMember!.builderAccountId}`, max: 200, windowMs: HOUR }]))) {
      throw new BuilderError(429, "Too many voice notes this hour. Type the sizes or try again later.");
    }
    const out = await voiceToActions({
      dataUrl: String(req.body?.audio || ""),
      data: req.body?.data ?? m.data,
      stair: Math.max(0, Number(req.body?.stair) || 0),
      step: Math.max(0, Number(req.body?.step) || 0),
    });
    res.json({ success: true, data: out });
  } catch (error) {
    sendError(res, error, next);
  }
});

builderAccountRouter.get("/api/builder/measurements/:id/photo", requireBuilder, async (req: BuilderReq, res, next) => {
  try {
    const { stream, contentType } = await photoStream(req.builderMember!, String(req.params.id), String(req.query.key || ""));
    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "private, max-age=3600");
    stream.pipe(res);
  } catch (error) {
    sendError(res, error, next);
  }
});

builderAccountRouter.get("/api/builder/measurements/:id/pdf", requireBuilder, async (req: BuilderReq, res, next) => {
  try {
    const m = req.builderMember!;
    await getMeasurement(m, String(req.params.id));
    const pack = await measurementPack(m.builderAccountId, String(req.params.id));
    if (!pack) throw new BuilderError(404, "Measurement not found.");
    const pdf = pack.files[0]!;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(pdf.name)}"`);
    res.send(pdf.body);
  } catch (error) {
    sendError(res, error, next);
  }
});

builderAccountRouter.get("/api/builder/me", requireBuilder, async (req: BuilderReq, res, next) => {
  try {
    const m = req.builderMember!;
    const links = await linksFor(m.builderAccountId);
    const currentOrg = req.session.organizationId || null;
    const current = links.find((l) => l.status === "active" && l.organization_id === currentOrg)
      || links.find((l) => l.id === req.session.builderLinkId)
      || null;
    res.json({
      success: true,
      data: {
        member: { id: m.id, name: m.name, email: m.email, role: m.role, role_label: ROLE_LABELS[m.role as keyof typeof ROLE_LABELS]?.en || m.role },
        member_profile: { phone: m.phone, title: (m as { title?: string | null }).title ?? null },
        account: accountView(m.account),
        permissions: permissionsFor(m.role),
        companies: links,
        current_company_id: current?.id || null,
        roles: BUILDER_ROLES.map((r) => ({ key: r, label: ROLE_LABELS[r].en, hint: ROLE_LABELS[r].hint })),
        ai_reader: isIntakeReaderConfigured(),
      },
    });
  } catch (error) {
    next(error);
  }
});

builderAccountRouter.post("/api/builder/select", requireBuilder, async (req: BuilderReq, res, next) => {
  try {
    const id = String(req.body?.company_id || "");
    const links = await linksFor(req.builderMember!.builderAccountId);
    const link = links.find((l) => l.id === id);
    if (!link) {
      res.status(404).json({ success: false, error: "Company not found." });
      return;
    }
    req.session.builderLinkId = link.id;
    if (link.status === "active") {
      req.session.organizationId = link.organization_id!;
      req.session.workspaceSlug = link.slug!;
    } else {
      delete req.session.organizationId;
      delete req.session.workspaceSlug;
    }
    await saveSession(req);
    res.json({ success: true, data: { company: link } });
  } catch (error) {
    next(error);
  }
});

builderAccountRouter.post("/api/builder/logout", (req, res, next) => {
  req.session.destroy((error) => {
    if (error) return next(error);
    res.clearCookie("connect.sid");
    res.json({ success: true });
  });
});

/* Companies */

builderAccountRouter.get("/api/builder/companies", requireBuilder, async (req: BuilderReq, res, next) => {
  try {
    res.json({ success: true, data: await linksFor(req.builderMember!.builderAccountId) });
  } catch (error) {
    next(error);
  }
});

builderAccountRouter.post("/api/builder/companies", requireBuilder, needs("companies.manage"), async (req: BuilderReq, res, next) => {
  try {
    const result = await addCompany(req.builderMember!, req.body || {});
    res.status(201).json({ success: true, data: result });
  } catch (error) {
    sendError(res, error, next);
  }
});

builderAccountRouter.post("/api/builder/companies/:id/resend", requireBuilder, needs("companies.manage"), async (req: BuilderReq, res, next) => {
  try {
    res.json({ success: true, data: await resendCompanyInvite(req.builderMember!, String(req.params.id)) });
  } catch (error) {
    sendError(res, error, next);
  }
});

builderAccountRouter.delete("/api/builder/companies/:id", requireBuilder, needs("companies.manage"), async (req: BuilderReq, res, next) => {
  try {
    await removeLink(req.builderMember!, String(req.params.id));
    if (req.session.builderLinkId === req.params.id) delete req.session.builderLinkId;
    res.json({ success: true });
  } catch (error) {
    sendError(res, error, next);
  }
});

/* Jobs kept for a company that has not joined yet */

const pendingSchema = z.object({
  title: z.string().trim().min(3).max(160),
  address: z.string().trim().min(4).max(300),
  contact_name: z.string().trim().max(120).optional().default(""),
  contact_email: z.union([z.string().email().max(254), z.literal("")]).optional().default(""),
  contact_phone: z.string().trim().max(40).optional().default(""),
  service_type: z.string().trim().max(100).optional().default(""),
  preferred_date: z.union([z.string().date(), z.literal("")]).optional().default(""),
  notes: z.string().trim().max(5000).optional().default(""),
  external_ref: z.string().trim().max(60).optional().default(""),
  files: z.array(z.object({ name: z.string().trim().min(1).max(180), data_url: z.string().min(1).max(14_000_000) })).max(5).optional().default([]),
  items: intakeItemsSchema.optional().default([]),
  pickup: z.string().trim().max(200).optional().default(""),
  measurement_id: z.union([z.string().uuid(), z.literal("")]).optional().default(""),
});

function decodeUploads(files: Array<{ name: string; data_url: string }>): Array<{ name: string; contentType: string; body: Buffer }> {
  const out: Array<{ name: string; contentType: string; body: Buffer }> = [];
  let total = 0;
  for (const f of files) {
    const match = /^data:([^;]+);base64,(.+)$/.exec(f.data_url);
    if (!match) throw new BuilderError(400, `The file ${f.name} has an invalid format.`);
    const contentType = match[1]!.toLowerCase();
    const body = Buffer.from(match[2]!, "base64");
    const ok =
      (contentType === "application/pdf" && body.subarray(0, 5).toString("ascii") === "%PDF-") ||
      (contentType === "image/jpeg" && body[0] === 0xff && body[1] === 0xd8) ||
      (contentType === "image/png" && body.subarray(0, 8).toString("hex") === "89504e470d0a1a0a") ||
      (contentType === "image/webp" && body.subarray(8, 12).toString("ascii") === "WEBP");
    if (!ok) throw new BuilderError(400, `The file type of ${f.name} is not accepted. Use JPG, PNG, WebP or PDF.`);
    total += body.length;
    out.push({ name: f.name.replace(/[^\w.-]+/g, "-").slice(0, 120) || "arquivo", contentType, body });
  }
  if (total > 10 * 1024 * 1024) throw new BuilderError(400, "Files must add up to less than 10 MB.");
  return out;
}

builderAccountRouter.get("/api/builder/companies/:id/jobs", requireBuilder, async (req: BuilderReq, res, next) => {
  try {
    res.json({ success: true, data: await listPendingJobs(req.builderMember!, String(req.params.id)) });
  } catch (error) {
    sendError(res, error, next);
  }
});

builderAccountRouter.post("/api/builder/companies/:id/jobs", requireBuilder, needs("jobs.send"), async (req: BuilderReq, res, next) => {
  try {
    const parsed = pendingSchema.safeParse(req.body || {});
    if (!parsed.success) throw new BuilderError(400, "Check the request fields and try again.");
    const { files, ...payload } = parsed.data;
    if (payload.pickup) {
      const found = await pickupForWorkOrder(req.builderMember!.builderAccountId, payload.pickup).catch(() => null);
      if (found && !payload.pickup.toLowerCase().includes(found.location.address.toLowerCase())) payload.pickup = found.text;
    }
    const row = await keepPendingJob(req.builderMember!, String(req.params.id), payload, decodeUploads(files));
    res.status(201).json({ success: true, data: { id: row.id, kept: true } });
  } catch (error) {
    sendError(res, error, next);
  }
});

/** AI reading for a company that has not joined yet (no company quota to count against). */
builderAccountRouter.post("/api/builder/read", requireBuilder, needs("jobs.send"), async (req: BuilderReq, res, next) => {
  try {
    if (!(await takeRate([{ key: `builder-read:${req.builderMember!.builderAccountId}`, max: 30, windowMs: HOUR }]))) {
      throw new BuilderError(429, "Too many reads this hour. Fill it in by hand or try again later.");
    }
    const parsed = z.object({
      text: z.string().max(20_000).optional().default(""),
      files: z.array(z.object({ name: z.string().trim().min(1).max(180), data_url: z.string().min(1).max(14_000_000) })).max(5).optional().default([]),
    }).safeParse(req.body || {});
    if (!parsed.success) throw new BuilderError(400, "Send up to 5 files (JPG, PNG, WebP or PDF) or paste the text.");
    const uploads = decodeUploads(parsed.data.files);
    if (!isIntakeReaderConfigured()) {
      res.json({ success: true, data: { ai_available: false, fields: null, check: [], warnings: [], match: null } });
      return;
    }
    const files: IntakeFile[] = uploads.map((u, i) => ({ name: u.name, contentType: u.contentType, dataUrl: parsed.data.files[i]!.data_url }));
    const read = await readWorkOrder({ files, text: parsed.data.text });
    if (!read.ok) throw new BuilderError(422, read.error);
    res.json({ success: true, data: { ai_available: true, model: read.model, fields: read.result.fields, pickup_match: await pickupForWorkOrder(req.builderMember!.builderAccountId, read.result.fields.pickup).catch(() => null), measurement: await findMeasurementForAddress(req.builderMember!.builderAccountId, read.result.fields.address).catch(() => null), items: read.result.items, labor_total: read.result.labor_total, check: read.result.check, warnings: read.result.warnings, match: null } });
  } catch (error) {
    sendError(res, error, next);
  }
});

/* Team */

builderAccountRouter.get("/api/builder/team", requireBuilder, async (req: BuilderReq, res, next) => {
  try {
    res.json({ success: true, data: await listMembers(req.builderMember!.builderAccountId, req.query.all === "1" && can(req.builderMember!.role, "team.manage")) });
  } catch (error) {
    next(error);
  }
});

builderAccountRouter.post("/api/builder/team", requireBuilder, needs("team.manage"), async (req: BuilderReq, res, next) => {
  try {
    res.status(201).json({ success: true, data: await inviteMember(req.builderMember!, req.body || {}) });
  } catch (error) {
    sendError(res, error, next);
  }
});

builderAccountRouter.patch("/api/builder/team/:id", requireBuilder, needs("team.manage"), async (req: BuilderReq, res, next) => {
  try {
    if (req.params.id === req.builderMember!.id && (req.body?.disabled || (req.body?.role && req.body.role !== req.builderMember!.role))) {
      throw new BuilderError(409, "You can't change your own access. Ask another admin.");
    }
    await updateMember(req.builderMember!, String(req.params.id), req.body || {});
    res.json({ success: true });
  } catch (error) {
    sendError(res, error, next);
  }
});

builderAccountRouter.post("/api/builder/team/:id/resend", requireBuilder, needs("team.manage"), async (req: BuilderReq, res, next) => {
  try {
    res.json({ success: true, data: await resendMemberInvite(req.builderMember!, String(req.params.id)) });
  } catch (error) {
    sendError(res, error, next);
  }
});

builderAccountRouter.delete("/api/builder/team/:id", requireBuilder, needs("team.manage"), async (req: BuilderReq, res, next) => {
  try {
    res.json({ success: true, data: { result: await removeMember(req.builderMember!, String(req.params.id)) } });
  } catch (error) {
    sendError(res, error, next);
  }
});

builderAccountRouter.patch("/api/builder/me", requireBuilder, async (req: BuilderReq, res, next) => {
  try {
    await updateOwnProfile(req.builderMember!, req.body || {});
    res.json({ success: true });
  } catch (error) {
    sendError(res, error, next);
  }
});

builderAccountRouter.patch("/api/builder/account", requireBuilder, needs("team.manage"), async (req: BuilderReq, res, next) => {
  try {
    const opt = (max: number) => z.string().trim().max(max).optional().or(z.literal(""));
    const parsed = z.object({
      name: z.string().trim().min(2).max(120),
      phone: opt(40),
      website: opt(200),
      email: z.union([z.string().trim().toLowerCase().email().max(200), z.literal("")]).optional(),
      billing_email: z.union([z.string().trim().toLowerCase().email().max(200), z.literal("")]).optional(),
      address_line1: opt(200),
      address_line2: opt(120),
      city: opt(80),
      state: opt(40),
      postal_code: opt(20),
      license_number: opt(80),
    }).safeParse(req.body || {});
    if (!parsed.success) {
      const bad = parsed.error.issues[0]?.path[0];
      throw new BuilderError(400, bad === "name" ? "Enter the company name." : `Check the ${String(bad || "fields").replace(/_/g, " ")}.`);
    }
    const d = parsed.data;
    const v = (x: string | undefined) => (x === undefined ? undefined : x || null);
    await prisma.builderAccount.update({
      where: { id: req.builderMember!.builderAccountId },
      data: {
        name: d.name,
        phone: d.phone || null,
        website: v(d.website),
        email: v(d.email),
        billingEmail: v(d.billing_email),
        addressLine1: v(d.address_line1),
        addressLine2: v(d.address_line2),
        city: v(d.city),
        state: v(d.state),
        postalCode: v(d.postal_code),
        licenseNumber: v(d.license_number),
      },
    });
    res.json({ success: true });
  } catch (error) {
    sendError(res, error, next);
  }
});

const LOGO_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
builderAccountRouter.post("/api/builder/account/logo", requireBuilder, needs("team.manage"), async (req: BuilderReq, res, next) => {
  try {
    const raw = String(req.body?.data_url || "");
    if (!raw) {
      await prisma.builderAccount.update({ where: { id: req.builderMember!.builderAccountId }, data: { logoUrl: null } });
      res.json({ success: true, data: { logo_url: null } });
      return;
    }
    const m = /^data:([^;]+);base64,(.+)$/.exec(raw);
    if (!m || !LOGO_TYPES.has(m[1]!.toLowerCase())) throw new BuilderError(400, "Use a PNG, JPG or WebP logo.");
    const body = Buffer.from(m[2]!, "base64");
    if (body.length > 2 * 1024 * 1024) throw new BuilderError(400, "The logo must be under 2 MB.");
    const ok = (body[0] === 0xff && body[1] === 0xd8) || body.subarray(0, 8).toString("hex") === "89504e470d0a1a0a" || body.subarray(8, 12).toString("ascii") === "WEBP";
    if (!ok) throw new BuilderError(400, "That file doesn’t look like an image.");
    const stored = await storage.upload({ key: `builders/${req.builderMember!.builderAccountId}/logo-${Date.now()}`, body, contentType: m[1]!.toLowerCase() });
    await prisma.builderAccount.update({ where: { id: req.builderMember!.builderAccountId }, data: { logoUrl: stored.url } });
    res.json({ success: true, data: { logo_url: stored.url } });
  } catch (error) {
    sendError(res, error, next);
  }
});

/* ───────────────────────── agreed prices per company ───────────────────────── */

builderAccountRouter.get("/api/builder/prices", requireBuilder, needs("money.view"), async (req: BuilderReq, res, next) => {
  try {
    res.json({ success: true, data: await listPrices(req.builderMember!.builderAccountId, typeof req.query.company === "string" ? req.query.company : undefined) });
  } catch (error) {
    sendError(res, error, next);
  }
});
builderAccountRouter.post("/api/builder/prices", requireBuilder, needs("companies.manage"), async (req: BuilderReq, res, next) => {
  try {
    res.status(201).json({ success: true, data: await savePrice(req.builderMember!, null, req.body || {}) });
  } catch (error) {
    sendError(res, error, next);
  }
});
builderAccountRouter.post("/api/builder/prices/copy", requireBuilder, needs("companies.manage"), async (req: BuilderReq, res, next) => {
  try {
    res.json({ success: true, data: { copied: await copyPrices(req.builderMember!, String(req.body?.from || ""), String(req.body?.to || "")) } });
  } catch (error) {
    sendError(res, error, next);
  }
});
builderAccountRouter.patch("/api/builder/prices/:id", requireBuilder, needs("companies.manage"), async (req: BuilderReq, res, next) => {
  try {
    res.json({ success: true, data: await savePrice(req.builderMember!, String(req.params.id), req.body || {}) });
  } catch (error) {
    sendError(res, error, next);
  }
});
builderAccountRouter.delete("/api/builder/prices/:id", requireBuilder, needs("companies.manage"), async (req: BuilderReq, res, next) => {
  try {
    await deletePrice(req.builderMember!, String(req.params.id));
    res.json({ success: true });
  } catch (error) {
    sendError(res, error, next);
  }
});
