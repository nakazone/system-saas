/**
 * Public lead intake (LP + Meta Sheets sync) — no session required.
 *
 * POST /api/receive-lead
 * POST /api/receive-lead-batch
 *
 * Tenant resolution (first match):
 * 1. Subdomain (senior-floors.obramate.com)
 * 2. Header X-Tenant-Slug / query tenant / body tenant|organization_slug
 * 3. Env LEAD_INTAKE_DEFAULT_SLUG
 *
 * Optional shared secret (LEAD_INTAKE_SECRET or SHEETS_SYNC_SECRET):
 * - Always required for /api/receive-lead-batch
 * - Required for single lead when X-Sheets-Sync: 1
 * - If LEAD_INTAKE_REQUIRE_SECRET=1, required for all intakes
 */
import { Router, type Request, type Response } from "express";
import crypto from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { withTenantTransaction } from "../../lib/tenant/prisma-tenant.js";
import { notifyNewLeadPush } from "../../lib/push/notify.js";
import type { TenantRequest } from "../../lib/tenant/resolve-tenant.js";
import { formatUsPhone } from "../../lib/phone.js";

export const publicReceiveLeadRouter = Router();

const UTM_KEYS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
  "utm_adset",
  "utm_ad",
  "marketing_platform",
  "landing_page",
] as const;

function intakeSecret(): string {
  return (
    process.env.LEAD_INTAKE_SECRET?.trim() ||
    process.env.SHEETS_SYNC_SECRET?.trim() ||
    ""
  );
}

function requireSecretAlways(): boolean {
  return process.env.LEAD_INTAKE_REQUIRE_SECRET === "1";
}

function parseBody(req: Request): Record<string, unknown> {
  const ct = String(req.headers["content-type"] || "").toLowerCase();
  if (req.body && typeof req.body === "object" && !Array.isArray(req.body) && Object.keys(req.body).length) {
    return req.body as Record<string, unknown>;
  }
  if (ct.includes("application/json") && typeof req.body === "string") {
    try {
      return JSON.parse(req.body || "{}") as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  if (typeof req.body === "string" && req.body.length) {
    const params = new URLSearchParams(req.body);
    const result: Record<string, unknown> = {};
    for (const [key, value] of params.entries()) result[key] = value;
    return result;
  }
  return {};
}

function normalizePost(post: Record<string, unknown>): Record<string, unknown> {
  const merged = { ...post };
  for (const k of Object.keys(post)) {
    const t = k.trim();
    if (t && t !== k && merged[t] === undefined) merged[t] = post[k];
  }
  return merged;
}

function firstString(post: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const v = post[k];
    if (v === undefined || v === null) continue;
    const s = String(v).trim();
    if (s) return s;
  }
  const byLower = new Map<string, unknown>();
  for (const k of Object.keys(post)) {
    const lk = k.trim().toLowerCase();
    if (!byLower.has(lk)) byLower.set(lk, post[k]);
  }
  for (const want of keys) {
    const v = byLower.get(want.trim().toLowerCase());
    if (v === undefined || v === null) continue;
    const s = String(v).trim();
    if (s) return s;
  }
  return "";
}

function normalizeUsPhone(raw: string): string {
  let s = String(raw || "").trim();
  if (!s) return "";
  s = s.replace(/^p:\s*/i, "").replace(/^tel:\s*/i, "").replace(/^whatsapp:\s*/i, "");
  let digits = s.replace(/\D/g, "");
  if (digits.length === 11 && digits.charAt(0) === "1") digits = digits.slice(1);
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return s.length > 50 ? s.slice(0, 50) : s;
}

function mapSource(formName: string): string {
  if (formName === "hero-form") return "LP-Hero";
  if (/meta/i.test(formName) || formName === "meta-instant-form") return "Meta-Instant";
  return "LP-Contact";
}

function isSheetsSync(req: Request): boolean {
  return String(req.headers["x-sheets-sync"] || "").trim() === "1";
}

function checkSecret(req: Request, post: Record<string, unknown>, required: boolean): string | null {
  const secret = intakeSecret();
  if (!required) return null;
  if (!secret) {
    return "Lead intake secret is not configured on the server";
  }
  const fromHeader = String(
    req.headers["x-sheets-sync-secret"] ||
      req.headers["x-lead-intake-secret"] ||
      "",
  ).trim();
  const fromBody = String(post["sync-secret"] || post.sync_secret || "").trim();
  if ((fromHeader || fromBody) !== secret) {
    return "Unauthorized";
  }
  return null;
}

async function resolveOrganizationId(req: TenantRequest, post: Record<string, unknown>): Promise<string | null> {
  if (req.organizationId) return req.organizationId;

  const slug = String(
    req.headers["x-tenant-slug"] ||
      req.query.tenant ||
      post.tenant ||
      post.organization_slug ||
      process.env.LEAD_INTAKE_DEFAULT_SLUG ||
      "",
  )
    .trim()
    .toLowerCase();

  if (!slug) return null;
  const org = await prisma.organization.findUnique({
    where: { slug },
    select: { id: true, status: true },
  });
  if (!org || org.status === "canceled") return null;
  return org.id;
}

function pickFields(post: Record<string, unknown>) {
  const name =
    firstString(post, [
      "name",
      "full_name",
      "full name",
      "Full Name",
      "Nome",
      "nome",
      "Name",
      "first_name",
      "firstname",
      "First Name",
    ]) ||
    [post.first_name, post.last_name, post.firstName, post.lastName]
      .filter((x) => x != null && String(x).trim())
      .map((x) => String(x).trim())
      .join(" ")
      .trim();

  const email = firstString(post, [
    "email",
    "email_address",
    "Email",
    "Email Address",
    "e-mail",
    "E-mail",
    "work_email",
    "Work Email",
  ]);
  const phone = firstString(post, [
    "phone",
    "phone_number",
    "Phone",
    "Phone Number",
    "mobile",
    "Mobile",
    "tel",
    "Telefone",
    "work_phone_number",
  ]);
  const zipcode = firstString(post, [
    "zipcode",
    "zip",
    "zip_code",
    "Zip",
    "Zip code",
    "Postal Code",
    "postal_code",
    "CEP",
  ]);
  const message = firstString(post, ["message", "Message", "notes", "Comments", "questions"]);
  return { name, email, phone, zipcode, message };
}

function phoneDigits(phone: string): string {
  return phone.replace(/\D/g, "");
}

export async function ingestPublicLead(
  req: TenantRequest,
  rawPost: Record<string, unknown>,
  sheetsSync: boolean,
): Promise<{ status: number; json: Record<string, unknown> }> {
  const post = normalizePost(rawPost);
  const formName = String(post["form-name"] || post.formName || "contact-form").trim();
  const isMeta = /meta/i.test(formName) || formName === "meta-instant-form";
  const relax = sheetsSync || isMeta;

  let { name, email, phone, zipcode, message } = pickFields(post);
  if (relax && phone) phone = normalizeUsPhone(phone);

  const digits = phoneDigits(phone);
  const emailOk = Boolean(email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email));
  if (!emailOk && relax && digits.length >= 10) {
    email = `meta-import-${digits.slice(-10)}-${crypto.randomBytes(4).toString("hex")}@invalid.invalid`;
  }

  const errors: string[] = [];
  if (!name || name.length < 2) errors.push("Name is required");
  if (!phone) errors.push("Phone is required");
  if (relax && digits.length > 0 && digits.length < 10) errors.push("Valid phone is required");
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push("Valid email is required");

  let zipClean = (zipcode || "").replace(/\D/g, "");
  if (!zipClean || zipClean.length < 5) {
    if (relax) zipClean = "00000";
    else errors.push("Valid 5-digit US zip code is required");
  } else {
    zipClean = zipClean.slice(0, 5);
  }

  if (errors.length) {
    return {
      status: 400,
      json: { success: false, errors, api_version: "receive-lead-saas" },
    };
  }

  const organizationId = await resolveOrganizationId(req, post);
  if (!organizationId) {
    return {
      status: 400,
      json: {
        success: false,
        errors: ["Organization required"],
        hint: "Send X-Tenant-Slug, ?tenant=, body tenant, or use the org subdomain. Or set LEAD_INTAKE_DEFAULT_SLUG.",
        api_version: "receive-lead-saas",
      },
    };
  }

  name = name.slice(0, 255);
  phone = phone.slice(0, 50);
  email = email.slice(0, 255);
  message = message.slice(0, 65535);
  const source = mapSource(formName);

  const marketing: Record<string, string> = {};
  for (const key of UTM_KEYS) {
    const v = post[key];
    if (v != null && String(v).trim()) marketing[key] = String(v).trim();
  }

  const metadata: Record<string, unknown> = {
    zipcode: zipClean,
    form_type: formName,
    message: message || null,
    project_type: post.project_type || post.projectType || null,
    ip_address: req.ip || req.headers["x-forwarded-for"] || null,
    ...marketing,
  };

  const noteParts = [message || null, zipClean !== "00000" ? `CEP: ${zipClean}` : null]
    .filter(Boolean)
    .map(String);

  const result = await withTenantTransaction(organizationId, async (tx) => {
    const existing = await tx.lead.findFirst({
      where: {
        OR: [
          { email: { equals: email, mode: "insensitive" } },
          ...(digits.length >= 10
            ? [{ phone: { contains: digits.slice(-10) } }]
            : []),
        ],
      },
      orderBy: { createdAt: "desc" },
    });

    if (existing) {
      return {
        lead_id: existing.id,
        database_saved: true,
        inserted_new: false,
        duplicate_skipped: true,
      };
    }

    const stage =
      (await tx.pipelineStage.findFirst({
        where: { slug: "new", isActive: true },
        orderBy: { order: "asc" },
      })) ||
      (await tx.pipelineStage.findFirst({
        where: { isActive: true },
        orderBy: { order: "asc" },
      }));

    const lead = await tx.lead.create({
      data: {
        organizationId,
        name,
        email,
        phone: formatUsPhone(phone) || phone,
        source,
        status: "new",
        notes: noteParts.length ? noteParts.join("\n") : null,
        metadata: metadata as Prisma.InputJsonValue,
        pipelineStageId: stage?.id ?? null,
      },
    });

    return {
      lead_id: lead.id,
      database_saved: true,
      inserted_new: true,
      duplicate_skipped: false,
      leadName: lead.name,
    };
  });

  if (result.inserted_new && result.lead_id) {
    notifyNewLeadPush(organizationId, {
      id: result.lead_id,
      name: result.leadName || name,
    });
  }

  const json: Record<string, unknown> = {
    success: true,
    message: result.duplicate_skipped
      ? "Lead already existed (email or phone); no new row inserted."
      : "Thank you! We'll contact you within 24 hours.",
    timestamp: new Date().toISOString().slice(0, 19).replace("T", " "),
    lead_id: result.lead_id,
    database_saved: result.database_saved,
    inserted_new: result.inserted_new,
    duplicate_skipped: result.duplicate_skipped,
    api_version: "receive-lead-saas",
    data: { form_type: formName, name, email, phone, zipcode: zipClean, source },
  };

  return { status: 200, json };
}

function setCors(res: Response) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Accept, X-Tenant-Slug, X-Sheets-Sync, X-Sheets-Sync-Secret, X-Lead-Intake-Secret",
  );
}

publicReceiveLeadRouter.options("/api/receive-lead", (_req, res) => {
  setCors(res);
  res.status(204).end();
});

publicReceiveLeadRouter.options("/api/receive-lead-batch", (_req, res) => {
  setCors(res);
  res.status(204).end();
});

publicReceiveLeadRouter.post("/api/receive-lead", async (req: TenantRequest, res, next) => {
  try {
    setCors(res);
    const post = normalizePost(parseBody(req));
    const sheets = isSheetsSync(req);
    const secretErr = checkSecret(req, post, sheets || requireSecretAlways());
    if (secretErr) {
      res.status(secretErr === "Unauthorized" ? 401 : 503).json({
        success: false,
        errors: [secretErr],
        api_version: "receive-lead-saas",
      });
      return;
    }
    const out = await ingestPublicLead(req, post, sheets);
    res.status(out.status).json(out.json);
  } catch (error) {
    next(error);
  }
});

publicReceiveLeadRouter.post("/api/receive-lead-batch", async (req: TenantRequest, res, next) => {
  try {
    setCors(res);
    const root = normalizePost(parseBody(req));
    const secretErr = checkSecret(req, root, true);
    if (secretErr) {
      res.status(secretErr === "Unauthorized" ? 401 : 503).json({
        success: false,
        errors: [secretErr],
        api_version: "receive-lead-batch-saas",
      });
      return;
    }

    const leadsRaw = root.leads;
    if (!Array.isArray(leadsRaw) || leadsRaw.length === 0) {
      res.status(400).json({
        success: false,
        error: 'Body must include "leads": [ { name, email, phone, ... }, ... ]',
        api_version: "receive-lead-batch-saas",
      });
      return;
    }

    const max = Math.min(
      200,
      Math.max(1, parseInt(process.env.RECEIVE_LEAD_BATCH_MAX || "150", 10) || 150),
    );
    const defaultForm = String(root["form-name"] || "meta-instant-form").trim();
    const results = [];
    for (let i = 0; i < Math.min(leadsRaw.length, max); i++) {
      const item = leadsRaw[i];
      const obj =
        typeof item === "object" && item !== null && !Array.isArray(item)
          ? (item as Record<string, unknown>)
          : {};
      const post = {
        ...obj,
        "form-name": obj["form-name"] || defaultForm,
        tenant: root.tenant || root.organization_slug || obj.tenant,
      };
      const out = await ingestPublicLead(req, post, true);
      results.push({ index: i, status: out.status, ...out.json });
    }

    res.status(200).json({
      success: true,
      api_version: "receive-lead-batch-saas",
      count: results.length,
      results,
    });
  } catch (error) {
    next(error);
  }
});
