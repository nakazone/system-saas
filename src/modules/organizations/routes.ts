import { Router, type Request } from "express";
import { z } from "zod";
import type { AuthedRequest } from "../../middleware/auth.js";
import { validateSlug } from "./service.js";
import { requestSignup, resendSignup, confirmSignup, findSignupByToken, findInvite, signupMode, US_TIMEZONES, type SignupFormError } from "./signup.js";
import { trialDaysFor } from "../../master/plans.js";
import { requestIp } from "../../lib/security/db-rate-limit.js";
import { legalDocuments, legalEntity, versionDate } from "../../lib/legal/documents.js";
import { env } from "../../config/env.js";
import {
  subdomainTenantsSupported,
  workspaceHomeUrl,
  workspaceLoginUrl,
} from "../../lib/tenant/workspace-url.js";

export const organizationsRouter = Router();

function publicLocals(extra: Record<string, unknown> = {}) {
  return {
    organization: null,
    productName: env.PRODUCT_NAME,
    appRootDomain: env.APP_ROOT_DOMAIN,
    appBaseUrl: env.APP_BASE_URL,
    subdomainTenants: subdomainTenantsSupported(),
    ...extra,
  };
}

organizationsRouter.get("/pricing", (_req, res) => {
  res.render(
    "marketing/pricing",
    publicLocals({
      title: "Pricing",
    }),
  );
});

organizationsRouter.get("/find-workspace", (_req, res) => {
  res.render(
    "marketing/find-workspace",
    publicLocals({
      title: "Find your workspace",
      error: null,
      values: {},
    }),
  );
});

organizationsRouter.post("/find-workspace", (req, res) => {
  const schema = z.object({
    slug: z.string().min(2).max(48),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).render(
      "marketing/find-workspace",
      publicLocals({
        title: "Find your workspace",
        error: "Enter your organization subdomain slug.",
        values: req.body,
      }),
    );
    return;
  }

  const slug = parsed.data.slug.toLowerCase().trim();
  const slugError = validateSlug(slug);
  if (slugError) {
    res.status(400).render(
      "marketing/find-workspace",
      publicLocals({
        title: "Find your workspace",
        error: slugError,
        values: req.body,
      }),
    );
    return;
  }

  // Stay on the apex host when subdomain TLS is unavailable (Railway default).
  req.session.workspaceSlug = slug;
  res.redirect(workspaceLoginUrl(slug));
});

organizationsRouter.get("/signup", async (req, res, next) => {
  try {
    if ((req as AuthedRequest).organizationId) {
      res.redirect("/");
      return;
    }
    const inviteCode = typeof req.query.invite === "string" ? req.query.invite : "";
    const invite = inviteCode ? await findInvite(inviteCode) : null;
    res.render("organizations/signup", await signupLocals(req, { values: { invite: inviteCode, adminEmail: invite?.email || "", organizationName: invite?.companyName || "" }, invite, inviteInvalid: !!inviteCode && !invite }));
  } catch (error) {
    next(error);
  }
});

async function signupLocals(req: Request, extra: { values?: Record<string, unknown>; error?: SignupFormError | null; invite?: Awaited<ReturnType<typeof findInvite>>; inviteInvalid?: boolean }) {
  const mode = await signupMode();
  const values = extra.values || {};
  const invite = extra.invite !== undefined ? extra.invite : await findInvite(String(values.invite || ""));
  const trialDays = invite ? invite.trialDays : await trialDaysFor("starter");
  void req;
  return publicLocals({
    title: "Start your free trial",
    error: extra.error || null,
    values,
    mode,
    invite,
    inviteInvalid: !!extra.inviteInvalid,
    trialDays,
    timezones: US_TIMEZONES,
    legalDocs: legalDocuments(),
  });
}

organizationsRouter.post("/signup", async (req, res, next) => {
  try {
    const result = await requestSignup(req.body, { ip: requestIp(req), userAgent: String(req.headers["user-agent"] || "") });
    if (!result.ok) {
      const values = { ...req.body, password: "" };
      res.status(result.status).render("organizations/signup", await signupLocals(req, { values, error: result.error }));
      return;
    }
    req.session.signupRequestId = result.requestId;
    req.session.signupEmail = result.email;
    req.session.signupDevLink = result.devLink;
    req.session.save(() => res.redirect(303, "/signup/check"));
  } catch (error) {
    next(error);
  }
});

organizationsRouter.get("/signup/check", (req, res) => {
  const email = req.session.signupEmail;
  if (!email) {
    res.redirect("/signup");
    return;
  }
  const notice = typeof req.query.sent === "string" ? "We sent a new link." : null;
  const problem = typeof req.query.err === "string" ? req.query.err.slice(0, 200) : null;
  res.render("organizations/signup-check", publicLocals({ title: "Check your e-mail", email, devLink: req.session.signupDevLink || null, notice, problem, canResend: !!req.session.signupRequestId }));
});

organizationsRouter.post("/signup/resend", async (req, res, next) => {
  try {
    const id = req.session.signupRequestId;
    if (!id) {
      res.redirect("/signup");
      return;
    }
    const r = await resendSignup(id, { ip: requestIp(req) });
    if (r.ok) req.session.signupDevLink = r.devLink;
    req.session.save(() => res.redirect(303, r.ok ? "/signup/check?sent=1" : `/signup/check?err=${encodeURIComponent(r.message)}`));
  } catch (error) {
    next(error);
  }
});

/** The e-mail link opens a confirmation page; only the button (POST) creates the company, so link scanners cannot. */
organizationsRouter.get("/signup/verify", async (req, res, next) => {
  try {
    const token = typeof req.query.token === "string" ? req.query.token : "";
    const row = await findSignupByToken(token);
    let state: "confirm" | "invalid" | "expired" | "already" = "confirm";
    if (!row) state = "invalid";
    else if (row.verifiedAt) state = "already";
    else if (row.expiresAt.getTime() < Date.now()) state = "expired";
    res.status(state === "confirm" || state === "already" ? 200 : 410).render(
      "organizations/signup-verify",
      publicLocals({ title: "Confirm your e-mail", state, token, row: row ? { organizationName: row.organizationName, email: row.email, slug: row.slug } : null, loginUrl: row ? workspaceLoginUrl(row.slug) : "/login.html" }),
    );
  } catch (error) {
    next(error);
  }
});

organizationsRouter.post("/signup/verify", async (req, res, next) => {
  try {
    const token = String(req.body?.token || "");
    const r = await confirmSignup(token, { ip: requestIp(req), userAgent: String(req.headers["user-agent"] || "") });
    if (!r.ok) {
      const row = await findSignupByToken(token);
      res.status(r.reason === "already" ? 200 : 410).render(
        "organizations/signup-verify",
        publicLocals({ title: "Confirm your e-mail", state: r.reason, token, row: row ? { organizationName: row.organizationName, email: row.email, slug: row.slug } : null, loginUrl: workspaceLoginUrl(r.slug || row?.slug || "") }),
      );
      return;
    }
    const { organization, admin } = r;
    req.session.regenerate((err) => {
      if (err) return next(err);
      req.session.userId = admin.id;
      req.session.organizationId = organization.id;
      req.session.workspaceSlug = organization.slug;
      req.session.save(() =>
        res.render(
          "organizations/signup-success",
          publicLocals({
            title: "Workspace ready",
            organizationName: organization.name,
            slug: organization.slug,
            workspaceUrl: workspaceHomeUrl(organization.slug),
            loginUrl: workspaceLoginUrl(organization.slug),
            subdomainTenants: subdomainTenantsSupported(),
          }),
        ),
      );
    });
  } catch (error) {
    next(error);
  }
});

/* ───────── Terms, Privacy, DPA ───────── */
for (const doc of legalDocuments()) {
  organizationsRouter.get(doc.path, (_req, res) => {
    const current = legalDocuments().find((d) => d.key === doc.key)!;
    res.render("legal/document", publicLocals({ title: current.title, doc: current, docs: legalDocuments(), effective: versionDate(current.version), entity: legalEntity() }));
  });
}
