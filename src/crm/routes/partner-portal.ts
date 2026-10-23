import { Router, type NextFunction, type Response } from "express";
import { randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import type { TenantRequest } from "../../lib/tenant/resolve-tenant.js";
import { withTenantTransaction, type TenantPrisma } from "../../lib/tenant/prisma-tenant.js";
import { hashPassword, verifyPassword } from "../../lib/auth/password.js";
import { prisma } from "../../lib/prisma.js";
import { storage } from "../../lib/storage/index.js";
import { mapJobReport } from "../../lib/job-media/report.js";
import { buildJobReportPdf } from "../../lib/job-media/report-pdf.js";
import type { AuthedRequest } from "../../middleware/auth.js";
import { publicBaseUrl } from "../../lib/http/public-url.js";
import { requireCrmAuth, requireCrmPermission } from "../http.js";
import { env } from "../../config/env.js";
import { subdomainTenantsSupported, workspaceHomeUrl } from "../../lib/tenant/workspace-url.js";
import { ensureInvoicePublicToken, publicInvoiceUrl } from "../../lib/invoices/service.js";

type PartnerRequest = TenantRequest & {
  partnerUser?: {
    id: string;
    organizationId: string;
    builderId: string | null;
    customerId: string | null;
    email: string;
    name: string;
    companyName: string | null;
    mustChangePassword: boolean;
    builder: { id: string; status: string; type: string; company: string | null } | null;
    customer: { id: string; customerType: string; name: string; company: string | null } | null;
  };
};

export const partnerPortalRouter = Router();

function partnerJobScope(user: NonNullable<PartnerRequest["partnerUser"]>) {
  const OR: Array<{ builderId?: string; customerId?: string }> = [];
  if (user.builderId) OR.push({ builderId: user.builderId });
  if (user.customerId) OR.push({ customerId: user.customerId });
  return { OR };
}

function partnerCustomerIsActive(customer: NonNullable<PartnerRequest["partnerUser"]>["customer"]): boolean {
  return Boolean(customer && ["builder", "contractor"].includes(customer.customerType.toLowerCase()));
}

function partnerSwitchCookieOptions() {
  const root = env.APP_ROOT_DOMAIN.toLowerCase();
  return {
    ...(root.includes(".") ? { domain: `.${root}` } : {}),
    path: "/",
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "lax" as const,
    maxAge: 60_000,
  };
}

async function availablePartnerProviders(email: string) {
  const organizations = await prisma.organization.findMany({
    where: { status: { notIn: ["canceled", "suspended"] } },
    select: { id: true, slug: true, name: true },
    orderBy: { name: "asc" },
    take: 1000,
  });
  const memberships: Array<{
    id: string;
    slug: string;
    name: string;
    company_name: string;
    requires_password_change: boolean;
  }> = [];
  for (let start = 0; start < organizations.length; start += 12) {
    const batch = organizations.slice(start, start + 12);
    const membershipsInBatch = await Promise.all(batch.map(async (organization) => {
      const partner = await withTenantTransaction(organization.id, (tx) =>
        tx.partnerUser.findFirst({
          where: {
            email: { equals: email, mode: "insensitive" },
            status: "active",
            OR: [{ builderId: { not: null } }, { customerId: { not: null } }],
          },
          select: {
            mustChangePassword: true,
            builder: { select: { status: true, company: true } },
            customer: { select: { customerType: true, name: true, company: true } },
          },
        }),
      );
      if (!partner) return null;
      const builderIsActive = Boolean(partner.builder && partner.builder.status !== "inactive");
      const customerIsActive = Boolean(partner.customer && ["builder", "contractor"].includes(partner.customer.customerType.toLowerCase()));
      if (!builderIsActive && !customerIsActive) return null;
      return {
        id: organization.id,
        slug: organization.slug,
        name: organization.name,
        company_name: partner.builder?.company || partner.customer?.company || partner.customer?.name || organization.name,
        requires_password_change: partner.mustChangePassword,
      };
    }));
    memberships.push(...membershipsInBatch.filter((provider) => provider !== null));
  }
  return memberships;
}

async function saveSession(req: TenantRequest): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    req.session.save((error) => (error ? reject(error) : resolve()));
  });
}

async function requirePartnerAuth(
  req: PartnerRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const organizationId = req.organizationId;
    const partnerUserId = req.session.partnerUserId;
    if (
      !organizationId ||
      !partnerUserId ||
      req.session.partnerOrganizationId !== organizationId
    ) {
      res.status(401).json({ success: false, error: "Entre na sua conta de parceiro." });
      return;
    }

    const user = await withTenantTransaction(organizationId, (tx) =>
      tx.partnerUser.findFirst({
        where: {
          id: partnerUserId,
          organizationId,
          status: "active",
          OR: [{ builderId: { not: null } }, { customerId: { not: null } }],
        },
        select: {
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
        },
      }),
    );
    const builderIsActive = Boolean(user?.builder && user.builder.status !== "inactive");
    if (!user || (!builderIsActive && !partnerCustomerIsActive(user.customer))) {
      res.status(401).json({ success: false, error: "Acesso ao portal desativado." });
      return;
    }

    req.partnerUser = user;
    next();
  } catch (error) {
    next(error);
  }
}

partnerPortalRouter.post("/api/partner-auth/login", async (req: TenantRequest, res, next) => {
  try {
    const parsed = z
      .object({
        email: z.string().email().max(254),
        password: z.string().min(1).max(200),
        workspace: z.string().trim().max(80).optional(),
      })
      .safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: "Informe e-mail e senha válidos." });
      return;
    }

    let organizationId = req.organizationId;
    let workspaceSlug = req.organization?.slug || req.session.workspaceSlug;
    if (!organizationId && parsed.data.workspace) {
      const organization = await prisma.organization.findFirst({
        where: { slug: parsed.data.workspace.toLowerCase(), status: { notIn: ["canceled", "suspended"] } },
        select: { id: true, slug: true },
      });
      organizationId = organization?.id;
      workspaceSlug = organization?.slug;
    }
    if (!organizationId) {
      res.status(400).json({ success: false, error: "Informe o código da empresa para entrar." });
      return;
    }

    const email = parsed.data.email.toLowerCase().trim();
    const user = await withTenantTransaction(organizationId, (tx) =>
      tx.partnerUser.findFirst({
        where: { organizationId, email: { equals: email, mode: "insensitive" } },
        select: {
          id: true,
          email: true,
          name: true,
          passwordHash: true,
          status: true,
          builderId: true,
          customerId: true,
          companyName: true,
          mustChangePassword: true,
          builder: { select: { id: true, status: true, company: true } },
          customer: { select: { id: true, customerType: true, name: true, company: true } },
        },
      }),
    );
    const builderIsActive = Boolean(user?.builder && user.builder.status !== "inactive");
    const customerIsActive = partnerCustomerIsActive(user?.customer || null);
    if (
      !user ||
      user.status !== "active" ||
      (!builderIsActive && !customerIsActive) ||
      !(await verifyPassword(parsed.data.password, user.passwordHash))
    ) {
      res.status(401).json({ success: false, error: "E-mail ou senha incorretos." });
      return;
    }

    await withTenantTransaction(organizationId, (tx) =>
      tx.partnerUser.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } }),
    );

    // A partner sign-in gets a clean session without any staff permissions.
    await new Promise<void>((resolve, reject) => {
      req.session.regenerate((error) => (error ? reject(error) : resolve()));
    });
    req.session.organizationId = organizationId;
    req.session.workspaceSlug = workspaceSlug;
    req.session.partnerOrganizationId = organizationId;
    req.session.partnerUserId = user.id;
    await saveSession(req);

    res.json({
      success: true,
      data: {
        name: user.name,
        company_name: user.companyName || user.builder?.company || user.customer?.company || user.customer?.name || null,
        must_change_password: user.mustChangePassword,
      },
    });
  } catch (error) {
    next(error);
  }
});

partnerPortalRouter.post("/api/partner-auth/switch", requirePartnerAuth, async (req: PartnerRequest, res, next) => {
  try {
    const parsed = z.object({ workspace: z.string().trim().min(1).max(80) }).safeParse(req.body || {});
    if (!parsed.success) {
      res.status(400).json({ success: false, error: "Escolha uma empresa válida." });
      return;
    }
    const organization = await prisma.organization.findFirst({
      where: { slug: parsed.data.workspace.toLowerCase(), status: { notIn: ["canceled", "suspended"] } },
      select: { id: true, slug: true },
    });
    if (!organization) {
      res.status(404).json({ success: false, error: "Acesso a essa empresa não está disponível." });
      return;
    }
    const current = req.partnerUser!;
    const member = await withTenantTransaction(organization.id, (tx) =>
      tx.partnerUser.findFirst({
        where: {
          email: { equals: current.email, mode: "insensitive" },
          status: "active",
          OR: [{ builderId: { not: null } }, { customerId: { not: null } }],
        },
        select: {
          id: true,
          name: true,
          email: true,
          companyName: true,
          mustChangePassword: true,
          builder: { select: { id: true, status: true, type: true, company: true } },
          customer: { select: { id: true, customerType: true, name: true, company: true } },
        },
      }),
    );
    const builderIsActive = Boolean(member?.builder && member.builder.status !== "inactive");
    const customerIsActive = partnerCustomerIsActive(member?.customer || null);
    if (!member || (!builderIsActive && !customerIsActive)) {
      res.status(403).json({ success: false, error: "Essa empresa ainda não liberou acesso ao portal para este e-mail." });
      return;
    }
    if (subdomainTenantsSupported() && organization.id !== current.organizationId) {
      const host = String(req.get("host") || "").split(":")[0]!.toLowerCase();
      const root = env.APP_ROOT_DOMAIN.toLowerCase();
      if (host !== root && !host.endsWith(`.${root}`)) {
        res.status(409).json({ success: false, error: "Para trocar de fornecedor, abra o portal pelo domínio ObraMate." });
        return;
      }
      const token = jwt.sign(
        { purpose: "partner-portal-switch", organizationId: organization.id, partnerUserId: member.id, email: current.email },
        env.JWT_SECRET,
        { expiresIn: "60s" },
      );
      res.cookie("partner_portal_switch", token, partnerSwitchCookieOptions());
      res.json({ success: true, data: { redirect_url: `${workspaceHomeUrl(organization.slug)}partner-login.html?switch=1` } });
      return;
    }
    req.session.organizationId = organization.id;
    req.session.workspaceSlug = organization.slug;
    req.session.partnerOrganizationId = organization.id;
    req.session.partnerUserId = member.id;
    await saveSession(req);
    res.json({
      success: true,
      data: {
        name: member.name,
        email: member.email,
        company_name: member.companyName || member.builder?.company || member.customer?.company || member.customer?.name || null,
        partner_type: member.builder?.type || member.customer?.customerType || "builder",
        must_change_password: member.mustChangePassword,
        workspace: organization.slug,
      },
    });
  } catch (error) {
    next(error);
  }
});

partnerPortalRouter.post("/api/partner-auth/exchange", async (req: TenantRequest, res, next) => {
  try {
    const token = req.cookies?.partner_portal_switch;
    if (typeof token !== "string" || !req.organizationId) {
      res.status(401).json({ success: false, error: "A troca de fornecedor expirou. Entre novamente." });
      return;
    }
    let payload: jwt.JwtPayload;
    try {
      payload = jwt.verify(token, env.JWT_SECRET) as jwt.JwtPayload;
    } catch {
      res.clearCookie("partner_portal_switch", partnerSwitchCookieOptions());
      res.status(401).json({ success: false, error: "A troca de fornecedor expirou. Entre novamente." });
      return;
    }
    if (
      payload.purpose !== "partner-portal-switch" ||
      payload.organizationId !== req.organizationId ||
      typeof payload.partnerUserId !== "string" ||
      typeof payload.email !== "string"
    ) {
      res.clearCookie("partner_portal_switch", partnerSwitchCookieOptions());
      res.status(401).json({ success: false, error: "Acesso a esse fornecedor não está disponível." });
      return;
    }
    const user = await withTenantTransaction(req.organizationId, (tx) => tx.partnerUser.findFirst({
      where: { id: payload.partnerUserId as string, email: { equals: payload.email as string, mode: "insensitive" }, status: "active" },
      select: {
        id: true,
        email: true,
        builder: { select: { status: true } },
        customer: { select: { customerType: true } },
      },
    }));
    const builderIsActive = Boolean(user?.builder && user.builder.status !== "inactive");
    const customerIsActive = Boolean(user?.customer && ["builder", "contractor"].includes(user.customer.customerType.toLowerCase()));
    if (!user || (!builderIsActive && !customerIsActive)) {
      res.clearCookie("partner_portal_switch", partnerSwitchCookieOptions());
      res.status(401).json({ success: false, error: "Acesso a esse fornecedor não está disponível." });
      return;
    }
    await new Promise<void>((resolve, reject) => req.session.regenerate((error) => error ? reject(error) : resolve()));
    req.session.organizationId = req.organizationId;
    req.session.workspaceSlug = req.organization?.slug;
    req.session.partnerOrganizationId = req.organizationId;
    req.session.partnerUserId = user.id;
    await saveSession(req);
    res.clearCookie("partner_portal_switch", partnerSwitchCookieOptions());
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

partnerPortalRouter.get("/api/partner-auth/session", requirePartnerAuth, async (req: PartnerRequest, res, next) => {
  try {
    const user = req.partnerUser!;
    const providers = await availablePartnerProviders(user.email);
    res.json({
      success: true,
      authenticated: true,
      data: {
        name: user.name,
        email: user.email,
        company_name: user.companyName || user.builder?.company || user.customer?.company || user.customer?.name || null,
        partner_type: user.builder?.type || user.customer?.customerType || "builder",
        must_change_password: user.mustChangePassword,
        workspace: req.organization?.slug || req.session.workspaceSlug || null,
        providers,
      },
    });
  } catch (error) {
    next(error);
  }
});

partnerPortalRouter.post("/api/partner-auth/logout", (req, res, next) => {
  req.session.destroy((error) => {
    if (error) return next(error);
    res.clearCookie("connect.sid");
    res.json({ success: true });
  });
});

partnerPortalRouter.post("/api/partner-auth/change-password", requirePartnerAuth, async (req: PartnerRequest, res, next) => {
  try {
    const parsed = z.object({ password: z.string().min(10).max(200) }).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: "A nova senha deve ter pelo menos 10 caracteres." });
      return;
    }
    const user = req.partnerUser!;
    const passwordHash = await hashPassword(parsed.data.password);
    await withTenantTransaction(user.organizationId, (tx) =>
      tx.partnerUser.update({
        where: { id: user.id },
        data: { passwordHash, mustChangePassword: false },
      }),
    );
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

partnerPortalRouter.get("/api/partner-portal/overview", requirePartnerAuth, async (req: PartnerRequest, res, next) => {
  try {
    const user = req.partnerUser!;
    if (user.mustChangePassword) {
      res.status(403).json({ success: false, error: "Troque a senha temporária para acessar seus projetos.", code: "password_change_required" });
      return;
    }

    const data = await withTenantTransaction(user.organizationId, async (tx) => {
      const [projects, jobs] = await Promise.all([
        tx.project.findMany({
          where: { organizationId: user.organizationId, ...partnerJobScope(user), deletedAt: null },
          select: { id: true, number: true, name: true, status: true, address: true, updatedAt: true },
          orderBy: { updatedAt: "desc" },
          take: 100,
        }),
        tx.workOrder.findMany({
          where: {
            organizationId: user.organizationId,
            ...partnerJobScope(user),
            status: { not: "canceled" },
          },
          select: {
            id: true,
            number: true,
            title: true,
            status: true,
            address: true,
            scheduledStart: true,
            scheduledEnd: true,
            updatedAt: true,
          },
          orderBy: [{ scheduledStart: "desc" }, { updatedAt: "desc" }],
          take: 100,
        }),
      ]);
      return { projects, jobs };
    });

    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

async function partnerInvoiceScopes(tx: TenantPrisma, user: NonNullable<PartnerRequest["partnerUser"]>): Promise<Prisma.QuoteInvoiceWhereInput[]> {
  const jobs = await tx.workOrder.findMany({
    where: { organizationId: user.organizationId, ...partnerJobScope(user), status: { not: "canceled" } },
    select: { id: true },
  });
  const scopes: Prisma.QuoteInvoiceWhereInput[] = [];
  if (jobs.length) scopes.push({ workOrderId: { in: jobs.map((job) => job.id) } });
  if (user.customerId) {
    scopes.push({ customerId: user.customerId });
    scopes.push({ quote: { is: { customerId: user.customerId } } });
  }
  if (user.builderId) scopes.push({ quote: { is: { builderId: user.builderId } } });
  return scopes;
}

partnerPortalRouter.get("/api/partner-portal/invoices", requirePartnerAuth, async (req: PartnerRequest, res, next) => {
  try {
    const user = req.partnerUser!;
    if (!partnerDocsReady(user, res)) return;
    const data = await withTenantTransaction(user.organizationId, async (tx) => {
      const invoiceScopes = await partnerInvoiceScopes(tx, user);
      if (!invoiceScopes.length) return [];
      const rows = await tx.quoteInvoice.findMany({
        where: {
          organizationId: user.organizationId,
          status: { notIn: ["draft", "void"] },
          OR: invoiceScopes,
        },
        select: {
          id: true,
          invoiceNumber: true,
          invoiceType: true,
          status: true,
          amount: true,
          dueDate: true,
          issuedAt: true,
          paidAt: true,
          workOrder: { select: { id: true, number: true, title: true, address: true } },
          quote: { select: { id: true, title: true, quoteNumber: true, number: true } },
          receipts: { select: { amount: true } },
        },
        orderBy: [{ dueDate: "desc" }, { createdAt: "desc" }],
        take: 200,
      });
      return rows.map((invoice) => {
        const amount = Number(invoice.amount);
        const paidAmount = invoice.receipts.reduce((sum, receipt) => sum + Number(receipt.amount), 0);
        return {
          id: invoice.id,
          number: invoice.invoiceNumber,
          type: invoice.invoiceType,
          status: invoice.status,
          amount,
          paid_amount: paidAmount,
          balance: Math.max(0, amount - paidAmount),
          due_date: invoice.dueDate,
          issued_at: invoice.issuedAt,
          paid_at: invoice.paidAt,
          job: invoice.workOrder,
          quote: invoice.quote,
          invoice_url: `/api/partner-portal/invoices/${encodeURIComponent(invoice.id)}/open`,
        };
      });
    });
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

partnerPortalRouter.get("/api/partner-portal/invoices/:id/open", requirePartnerAuth, async (req: PartnerRequest, res, next) => {
  try {
    const user = req.partnerUser!;
    if (!partnerDocsReady(user, res)) return;
    const publicUrl = await withTenantTransaction(user.organizationId, async (tx) => {
      const scopes = await partnerInvoiceScopes(tx, user);
      if (!scopes.length) return null;
      const invoice = await tx.quoteInvoice.findFirst({
        where: {
          id: String(req.params.id),
          organizationId: user.organizationId,
          status: { notIn: ["draft", "void"] },
          OR: scopes,
        },
        select: { id: true },
      });
      if (!invoice) return null;
      const token = await ensureInvoicePublicToken(tx, user.organizationId, invoice.id);
      return publicInvoiceUrl(publicBaseUrl(req), token);
    });
    if (!publicUrl) {
      res.status(404).json({ success: false, error: "Invoice não encontrada." });
      return;
    }
    res.redirect(302, publicUrl);
  } catch (error) {
    next(error);
  }
});

type PartnerRequestFile = { key: string; name: string; contentType: string; size: number };

function requestFiles(value: unknown): PartnerRequestFile[] {
  if (!Array.isArray(value)) return [];
  return value.filter((file): file is PartnerRequestFile => Boolean(
    file && typeof file === "object" &&
    typeof (file as PartnerRequestFile).key === "string" &&
    typeof (file as PartnerRequestFile).name === "string" &&
    typeof (file as PartnerRequestFile).contentType === "string",
  ));
}

function validUploadSignature(contentType: string, body: Buffer): boolean {
  if (contentType === "application/pdf") return body.subarray(0, 5).toString("ascii") === "%PDF-";
  if (contentType === "image/jpeg") return body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff;
  if (contentType === "image/png") return body.subarray(0, 8).toString("hex") === "89504e470d0a1a0a";
  if (contentType === "image/webp") return body.subarray(0, 4).toString("ascii") === "RIFF" && body.subarray(8, 12).toString("ascii") === "WEBP";
  return false;
}

partnerPortalRouter.get("/api/partner-portal/requests", requirePartnerAuth, async (req: PartnerRequest, res, next) => {
  try {
    const user = req.partnerUser!;
    if (!partnerDocsReady(user, res)) return;
    const rows = await withTenantTransaction(user.organizationId, (tx) =>
      tx.partnerJobRequest.findMany({
        where: { organizationId: user.organizationId, partnerUserId: user.id },
        orderBy: { createdAt: "desc" },
        take: 100,
      }),
    );
    res.json({
      success: true,
      data: rows.map((row) => ({
        id: row.id,
        title: row.title,
        address: row.address,
        contact_name: row.contactName,
        contact_email: row.contactEmail,
        contact_phone: row.contactPhone,
        service_type: row.serviceType,
        preferred_date: row.preferredDate,
        notes: row.notes,
        status: row.status,
        review_note: row.reviewNote,
        created_at: row.createdAt,
        job_id: row.workOrderId,
        files: requestFiles(row.files).map((file, index) => ({
          name: file.name,
          size: file.size,
          content_type: file.contentType,
          file_url: `/api/partner-portal/requests/${encodeURIComponent(row.id)}/files/${index}`,
        })),
      })),
    });
  } catch (error) {
    next(error);
  }
});

partnerPortalRouter.post("/api/partner-portal/requests", requirePartnerAuth, async (req: PartnerRequest, res, next) => {
  try {
    const user = req.partnerUser!;
    if (!partnerDocsReady(user, res)) return;
    const parsed = z.object({
      title: z.string().trim().min(3).max(160),
      address: z.string().trim().min(4).max(300),
      contact_name: z.string().trim().max(120).optional().default(""),
      contact_email: z.union([z.string().email().max(254), z.literal("")]).optional().default(""),
      contact_phone: z.string().trim().max(40).optional().default(""),
      service_type: z.string().trim().max(100).optional().default(""),
      preferred_date: z.union([z.string().date(), z.literal("")]).optional().default(""),
      notes: z.string().trim().max(5000).optional().default(""),
      files: z.array(z.object({ name: z.string().trim().min(1).max(180), data_url: z.string().min(1).max(14_000_000) })).max(5).optional().default([]),
    }).safeParse(req.body || {});
    if (!parsed.success) {
      res.status(400).json({ success: false, error: "Confira os campos do pedido e tente novamente." });
      return;
    }
    const uploads: Array<{ name: string; dataUrl: string }> = parsed.data.files.map((file) => ({ name: file.name, dataUrl: file.data_url }));
    let totalBytes = 0;
    for (const file of uploads) {
      const match = /^data:([^;]+);base64,(.+)$/.exec(file.dataUrl);
      if (!match) {
        res.status(400).json({ success: false, error: `O arquivo ${file.name} está em um formato inválido.` });
        return;
      }
      const contentType = match[1]!.toLowerCase();
      const body = Buffer.from(match[2]!, "base64");
      totalBytes += body.length;
      if (!validUploadSignature(contentType, body)) {
        res.status(400).json({ success: false, error: `O tipo do arquivo ${file.name} não é aceito. Use JPG, PNG, WebP ou PDF.` });
        return;
      }
    }
    if (totalBytes > 10 * 1024 * 1024) {
      res.status(400).json({ success: false, error: "O total dos arquivos deve ser menor que 10 MB." });
      return;
    }

    const row = await withTenantTransaction(user.organizationId, (tx) =>
      tx.partnerJobRequest.create({
        data: {
          organizationId: user.organizationId,
          partnerUserId: user.id,
          customerId: user.customerId,
          builderId: user.builderId,
          title: parsed.data.title,
          address: parsed.data.address,
          contactName: parsed.data.contact_name || null,
          contactEmail: parsed.data.contact_email || null,
          contactPhone: parsed.data.contact_phone || null,
          serviceType: parsed.data.service_type || null,
          preferredDate: parsed.data.preferred_date ? new Date(`${parsed.data.preferred_date}T12:00:00.000Z`) : null,
          notes: parsed.data.notes || null,
          files: [] as Prisma.InputJsonValue,
        },
      }),
    );
    const savedFiles: PartnerRequestFile[] = [];
    try {
      for (const file of uploads) {
        const match = /^data:([^;]+);base64,(.+)$/.exec(file.dataUrl)!;
        const contentType = match[1]!.toLowerCase();
        const body = Buffer.from(match[2]!, "base64");
        const safeName = safeFileName(file.name, `arquivo-${savedFiles.length + 1}`);
        const key = `orgs/${user.organizationId}/partner-requests/${row.id}/${randomUUID()}`;
        const stored = await storage.upload({ key, body, contentType });
        savedFiles.push({ key: stored.key, name: safeName, contentType, size: stored.size });
      }
      await withTenantTransaction(user.organizationId, (tx) => tx.partnerJobRequest.update({
        where: { id: row.id },
        data: { files: savedFiles as unknown as Prisma.InputJsonValue },
      }));
    } catch (error) {
      await Promise.all(savedFiles.map((file) => storage.delete(file.key).catch(() => undefined)));
      await withTenantTransaction(user.organizationId, (tx) => tx.partnerJobRequest.delete({ where: { id: row.id } }).catch(() => undefined));
      throw error;
    }
    res.status(201).json({ success: true, data: { id: row.id, status: "pending" } });
  } catch (error) {
    next(error);
  }
});

partnerPortalRouter.get("/api/partner-portal/requests/:id/files/:index", requirePartnerAuth, async (req: PartnerRequest, res, next) => {
  try {
    const user = req.partnerUser!;
    if (!partnerDocsReady(user, res)) return;
    const index = Number(req.params.index);
    const row = await withTenantTransaction(user.organizationId, (tx) => tx.partnerJobRequest.findFirst({
      where: { id: String(req.params.id), organizationId: user.organizationId, partnerUserId: user.id },
      select: { files: true },
    }));
    const file = Number.isInteger(index) ? requestFiles(row?.files)[index] : undefined;
    if (!file) {
      res.status(404).json({ success: false, error: "Arquivo não encontrado." });
      return;
    }
    const stream = await storage.getStream(file.key);
    if (!stream) {
      res.status(404).json({ success: false, error: "Arquivo indisponível." });
      return;
    }
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Type", file.contentType);
    res.setHeader("Content-Disposition", `${req.query.download ? "attachment" : "inline"}; filename="${safeFileName(file.name, "arquivo")}"`);
    stream.on("error", next);
    stream.pipe(res);
  } catch (error) {
    next(error);
  }
});

partnerPortalRouter.get("/api/partner-requests", requireCrmAuth, requireCrmPermission("work_orders.manage"), async (req: AuthedRequest, res, next) => {
  try {
    const status = String(req.query.status || "pending");
    const rows = await withTenantTransaction(req.organizationId!, (tx) => tx.partnerJobRequest.findMany({
      where: {
        organizationId: req.organizationId!,
        ...(status === "all" ? {} : { status }),
      },
      include: {
        partnerUser: {
          select: {
            name: true,
            email: true,
            companyName: true,
            builder: { select: { company: true, type: true } },
            customer: { select: { name: true, company: true, customerType: true } },
          },
        },
        workOrder: { select: { id: true, number: true, title: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    }));
    res.json({
      success: true,
      data: rows.map((row) => ({
        id: row.id,
        title: row.title,
        address: row.address,
        contact_name: row.contactName,
        contact_email: row.contactEmail,
        contact_phone: row.contactPhone,
        service_type: row.serviceType,
        preferred_date: row.preferredDate,
        notes: row.notes,
        status: row.status,
        review_note: row.reviewNote,
        created_at: row.createdAt,
        partner_name: row.partnerUser.name,
        partner_email: row.partnerUser.email,
        partner_company: row.partnerUser.companyName || row.partnerUser.builder?.company || row.partnerUser.customer?.company || row.partnerUser.customer?.name || "Builder",
        work_order: row.workOrder,
        files: requestFiles(row.files).map((file, index) => ({
          name: file.name,
          size: file.size,
          file_url: `/api/partner-requests/${encodeURIComponent(row.id)}/files/${index}`,
        })),
      })),
    });
  } catch (error) {
    next(error);
  }
});

partnerPortalRouter.get("/api/partner-requests/:id/files/:index", requireCrmAuth, requireCrmPermission("work_orders.manage"), async (req: AuthedRequest, res, next) => {
  try {
    const index = Number(req.params.index);
    const row = await withTenantTransaction(req.organizationId!, (tx) => tx.partnerJobRequest.findFirst({
      where: { id: String(req.params.id), organizationId: req.organizationId! },
      select: { files: true },
    }));
    const file = Number.isInteger(index) ? requestFiles(row?.files)[index] : undefined;
    if (!file) {
      res.status(404).json({ success: false, error: "Arquivo não encontrado." });
      return;
    }
    const stream = await storage.getStream(file.key);
    if (!stream) {
      res.status(404).json({ success: false, error: "Arquivo indisponível." });
      return;
    }
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Type", file.contentType);
    res.setHeader("Content-Disposition", `attachment; filename="${safeFileName(file.name, "arquivo")}"`);
    stream.on("error", next);
    stream.pipe(res);
  } catch (error) {
    next(error);
  }
});

partnerPortalRouter.post("/api/partner-requests/:id/accept", requireCrmAuth, requireCrmPermission("work_orders.manage"), async (req: AuthedRequest, res, next) => {
  try {
    const parsed = z.object({ review_note: z.string().trim().max(2000).optional().default("") }).safeParse(req.body || {});
    if (!parsed.success) {
      res.status(400).json({ success: false, error: "Observação inválida." });
      return;
    }
    const result = await withTenantTransaction(req.organizationId!, async (tx) => {
      const request = await tx.partnerJobRequest.findFirst({
        where: { id: String(req.params.id), organizationId: req.organizationId! },
        include: { partnerUser: { select: { companyName: true, builder: { select: { company: true, type: true } }, customer: { select: { company: true, name: true, customerType: true } } } } },
      });
      if (!request) return { kind: "missing" as const };
      if (request.status === "accepted" && request.workOrderId) {
        return { kind: "accepted" as const, job_id: request.workOrderId };
      }
      if (request.status !== "pending") return { kind: "closed" as const };
      const partnerType = (request.partnerUser.builder?.type || request.partnerUser.customer?.customerType || "builder").toLowerCase();
      const sourceType = partnerType === "contractor" ? "contractor" : "builder";
      const sourceName = request.partnerUser.companyName || request.partnerUser.builder?.company || request.partnerUser.customer?.company || request.partnerUser.customer?.name || "Builder";
      const notes = [
        `Pedido enviado pelo portal do parceiro (${request.contactName || sourceName}).`,
        request.contactEmail ? `E-mail: ${request.contactEmail}` : "",
        request.contactPhone ? `Telefone: ${request.contactPhone}` : "",
        request.serviceType ? `Serviço: ${request.serviceType}` : "",
        request.preferredDate ? `Data solicitada: ${request.preferredDate.toISOString().slice(0, 10)}` : "",
        request.notes ? `Detalhes: ${request.notes}` : "",
      ].filter(Boolean).join("\n");
      await tx.$executeRaw`
        INSERT INTO "DocumentSequence" ("id", "organizationId", "kind", "nextValue")
        VALUES (gen_random_uuid(), ${req.organizationId!}::uuid, 'work_order', 1)
        ON CONFLICT ("organizationId", "kind") DO NOTHING
      `;
      const sequence = await tx.$queryRaw<{ nextValue: number }[]>`
        SELECT "nextValue" FROM "DocumentSequence"
        WHERE "organizationId" = ${req.organizationId!}::uuid AND "kind" = 'work_order'
        FOR UPDATE
      `;
      const number = sequence[0]?.nextValue ?? 1;
      await tx.$executeRaw`
        UPDATE "DocumentSequence"
        SET "nextValue" = ${number + 1}
        WHERE "organizationId" = ${req.organizationId!}::uuid AND "kind" = 'work_order'
      `;
      const workOrder = await tx.workOrder.create({
        data: {
          organizationId: req.organizationId!,
          number,
          title: request.title,
          status: "draft",
          sourceType,
          sourceName,
          customerId: request.customerId,
          builderId: request.builderId,
          address: request.address,
          notes,
        },
        select: { id: true },
      });
      await tx.partnerJobRequest.update({
        where: { id: request.id },
        data: { status: "accepted", workOrderId: workOrder.id, reviewedAt: new Date(), reviewNote: parsed.data.review_note || null },
      });
      return { kind: "accepted" as const, job_id: workOrder.id };
    });
    if (result.kind === "missing") {
      res.status(404).json({ success: false, error: "Pedido não encontrado." });
      return;
    }
    if (result.kind === "closed") {
      res.status(409).json({ success: false, error: "Este pedido já foi analisado." });
      return;
    }
    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
});

partnerPortalRouter.post("/api/partner-requests/:id/decline", requireCrmAuth, requireCrmPermission("work_orders.manage"), async (req: AuthedRequest, res, next) => {
  try {
    const parsed = z.object({ review_note: z.string().trim().max(2000).optional().default("") }).safeParse(req.body || {});
    if (!parsed.success) {
      res.status(400).json({ success: false, error: "Observação inválida." });
      return;
    }
    const row = await withTenantTransaction(req.organizationId!, (tx) => tx.partnerJobRequest.updateMany({
      where: { id: String(req.params.id), organizationId: req.organizationId!, status: "pending" },
      data: { status: "declined", reviewedAt: new Date(), reviewNote: parsed.data.review_note || null },
    }));
    if (!row.count) {
      res.status(404).json({ success: false, error: "Pedido pendente não encontrado." });
      return;
    }
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

function partnerDocsReady(user: NonNullable<PartnerRequest["partnerUser"]>, res: Response): boolean {
  if (!user.mustChangePassword) return true;
  res.status(403).json({
    success: false,
    error: "Troque a senha temporária para acessar o portal.",
    code: "password_change_required",
  });
  return false;
}

function safeFileName(value: string, fallback: string): string {
  const clean = value.replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 120);
  return clean || fallback;
}

function contentTypeForFileName(fileName: string): string {
  const ext = fileName.split(".").pop()?.toLowerCase();
  if (ext === "pdf") return "application/pdf";
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  return "application/octet-stream";
}

partnerPortalRouter.get(
  "/api/partner-portal/documents",
  requirePartnerAuth,
  async (req: PartnerRequest, res, next) => {
    try {
      const user = req.partnerUser!;
      if (!partnerDocsReady(user, res)) return;
      const data = await withTenantTransaction(user.organizationId, async (tx) => {
        const jobs = await tx.workOrder.findMany({
          where: {
            organizationId: user.organizationId,
            ...partnerJobScope(user),
            status: { not: "canceled" },
          },
          select: {
            id: true,
            number: true,
            title: true,
            address: true,
            deliveryAttachmentKey: true,
            deliveryAttachmentName: true,
            deliveryAttachmentSharedWithPartners: true,
          },
          orderBy: [{ updatedAt: "desc" }],
          take: 100,
        });
        const jobIds = jobs.map((job) => job.id);
        if (!jobIds.length) return [];
        const [mediaRows, reportRows] = await Promise.all([
          tx.jobMedia.findMany({
            where: { organizationId: user.organizationId, workOrderId: { in: jobIds }, sharedWithPartners: true, deletedAt: null },
            orderBy: { createdAt: "desc" },
            take: 500,
            select: { id: true, workOrderId: true, type: true, caption: true, stage: true, createdAt: true },
          }),
          tx.jobReport.findMany({
            where: { organizationId: user.organizationId, workOrderId: { in: jobIds }, sharedWithPartners: true, status: "published" },
            orderBy: [{ publishedAt: "desc" }, { updatedAt: "desc" }],
            take: 200,
            select: { id: true, workOrderId: true, title: true, summary: true, publishedAt: true, createdAt: true },
          }),
        ]);
        const jobById = new Map(jobs.map((job) => [job.id, job]));
        const jobRef = (id: string) => {
          const job = jobById.get(id)!;
          return { id: job.id, title: job.title, number: job.number, address: job.address };
        };
        const media = mediaRows.map((item) => ({
          id: item.id,
          type: item.type === "video" ? "video" : "photo",
          title: item.caption || (item.stage ? `Foto · ${item.stage}` : "Foto da obra"),
          created_at: item.createdAt.toISOString(),
          job: jobRef(item.workOrderId),
          file_url: `/api/partner-portal/documents/media/${encodeURIComponent(item.id)}/file`,
        }));
        const reports = reportRows.map((item) => ({
          id: item.id,
          type: "report",
          title: item.title || "Relatório da obra",
          summary: item.summary || "",
          created_at: (item.publishedAt || item.createdAt).toISOString(),
          job: jobRef(item.workOrderId),
          file_url: `/api/partner-portal/documents/report/${encodeURIComponent(item.id)}/file`,
        }));
        const attachments = jobs
          .filter((job) => job.deliveryAttachmentSharedWithPartners && job.deliveryAttachmentKey)
          .map((job) => ({
            id: job.id,
            type: "file",
            title: job.deliveryAttachmentName || "Arquivo da obra",
            created_at: "",
            job: jobRef(job.id),
            file_url: `/api/partner-portal/documents/attachment/${encodeURIComponent(job.id)}/file`,
          }));
        const documents = [...media, ...reports, ...attachments];
        documents.sort((a, b) => b.created_at.localeCompare(a.created_at));
        return documents;
      });
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },
);

partnerPortalRouter.get(
  "/api/partner-portal/documents/media/:id/file",
  requirePartnerAuth,
  async (req: PartnerRequest, res, next) => {
    try {
      const user = req.partnerUser!;
      if (!partnerDocsReady(user, res)) return;
      const row = await withTenantTransaction(user.organizationId, async (tx) => {
        const media = await tx.jobMedia.findFirst({
          where: {
            id: String(req.params.id),
            organizationId: user.organizationId,
            sharedWithPartners: true,
            deletedAt: null,
          },
          select: {
            id: true,
            type: true,
            storageKey: true,
            caption: true,
            workOrderId: true,
          },
        });
        if (!media) return null;
        const job = await tx.workOrder.findFirst({
          where: {
            id: media.workOrderId,
            organizationId: user.organizationId,
            ...partnerJobScope(user),
            status: { not: "canceled" },
          },
          select: { id: true, number: true },
        });
        return job ? { ...media, jobNumber: job.number } : null;
      });
      if (!row) {
        res.status(404).json({ success: false, error: "Documento não encontrado." });
        return;
      }
      const stream = await storage.getStream(row.storageKey);
      if (!stream) {
        res.status(404).json({ success: false, error: "Arquivo indisponível." });
        return;
      }
      const extension = row.type === "video" ? "mp4" : "jpg";
      const fileName = safeFileName(row.caption || `obra-${row.jobNumber ?? row.id}`, `obra-${row.id}`);
      res.setHeader("Cache-Control", "private, no-store");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Content-Type", row.type === "video" ? "video/mp4" : "image/jpeg");
      res.setHeader("Content-Disposition", `${req.query.download ? "attachment" : "inline"}; filename="${fileName}.${extension}"`);
      stream.on("error", next);
      stream.pipe(res);
    } catch (error) {
      next(error);
    }
  },
);

partnerPortalRouter.get(
  "/api/partner-portal/documents/attachment/:jobId/file",
  requirePartnerAuth,
  async (req: PartnerRequest, res, next) => {
    try {
      const user = req.partnerUser!;
      if (!partnerDocsReady(user, res)) return;
      const job = await withTenantTransaction(user.organizationId, (tx) =>
        tx.workOrder.findFirst({
          where: {
            id: String(req.params.jobId),
            organizationId: user.organizationId,
            ...partnerJobScope(user),
            deliveryAttachmentSharedWithPartners: true,
            status: { not: "canceled" },
          },
          select: { deliveryAttachmentKey: true, deliveryAttachmentName: true },
        }),
      );
      if (!job?.deliveryAttachmentKey) {
        res.status(404).json({ success: false, error: "Documento não encontrado." });
        return;
      }
      const stream = await storage.getStream(job.deliveryAttachmentKey);
      if (!stream) {
        res.status(404).json({ success: false, error: "Arquivo indisponível." });
        return;
      }
      const fileName = safeFileName(job.deliveryAttachmentName || "arquivo-da-obra", "arquivo-da-obra");
      res.setHeader("Cache-Control", "private, no-store");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Content-Type", contentTypeForFileName(fileName));
      res.setHeader("Content-Disposition", `${req.query.download ? "attachment" : "inline"}; filename="${fileName}"`);
      stream.on("error", next);
      stream.pipe(res);
    } catch (error) {
      next(error);
    }
  },
);

partnerPortalRouter.get(
  "/api/partner-portal/documents/report/:id/file",
  requirePartnerAuth,
  async (req: PartnerRequest, res, next) => {
    try {
      const user = req.partnerUser!;
      if (!partnerDocsReady(user, res)) return;
      const payload = await withTenantTransaction(user.organizationId, async (tx) => {
        const report = await tx.jobReport.findFirst({
          where: {
            id: String(req.params.id),
            organizationId: user.organizationId,
            sharedWithPartners: true,
            status: "published",
          },
          include: { author: { select: { name: true } } },
        });
        if (!report) return null;
        const job = await tx.workOrder.findFirst({
          where: {
            id: report.workOrderId,
            organizationId: user.organizationId,
            ...partnerJobScope(user),
            status: { not: "canceled" },
          },
          include: {
            customer: { select: { name: true } },
            builder: { select: { firstName: true, lastName: true, company: true } },
          },
        });
        if (!job) return null;
        const organization = await tx.organization.findFirst({
          where: { id: user.organizationId },
          select: { name: true },
        });
        const mapped = mapJobReport(report);
        return {
          report: mapped,
          job,
          organizationName: organization?.name || "ObraMate",
          client:
            job.customer?.name ||
            job.builder?.company ||
            [job.builder?.firstName, job.builder?.lastName].filter(Boolean).join(" ").trim() ||
            job.sourceName ||
            "Cliente",
        };
      });
      if (!payload) {
        res.status(404).json({ success: false, error: "Documento não encontrado." });
        return;
      }
      const report = payload.report;
      const pdf = await buildJobReportPdf({
        organizationName: payload.organizationName,
        jobTitle: payload.job.title,
        jobNumber: payload.job.number,
        client: payload.client,
        address: payload.job.address,
        templateKey: report.template_key,
        report: {
          title: report.title,
          summary: report.summary,
          observations: report.observations,
          issues: report.issues,
          recommendations: report.recommendations,
          next_steps: report.next_steps,
          status: report.status,
          created_at: report.created_at,
        },
        photoCount: report.photo_ids.length,
      });
      const fileName = safeFileName(`relatorio-obra-${payload.job.number ?? payload.job.id}`, "relatorio-obra");
      res.setHeader("Cache-Control", "private, no-store");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `${req.query.download ? "attachment" : "inline"}; filename="${fileName}.pdf"`);
      res.send(pdf);
    } catch (error) {
      next(error);
    }
  },
);
