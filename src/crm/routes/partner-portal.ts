import { Router, type NextFunction, type Response } from "express";
import { z } from "zod";
import type { TenantRequest } from "../../lib/tenant/resolve-tenant.js";
import { withTenantTransaction } from "../../lib/tenant/prisma-tenant.js";
import { hashPassword, verifyPassword } from "../../lib/auth/password.js";
import { prisma } from "../../lib/prisma.js";
import { storage } from "../../lib/storage/index.js";
import { mapJobReport } from "../../lib/job-media/report.js";
import { buildJobReportPdf } from "../../lib/job-media/report-pdf.js";

type PartnerRequest = TenantRequest & {
  partnerUser?: {
    id: string;
    organizationId: string;
    builderId: string;
    email: string;
    name: string;
    companyName: string | null;
    mustChangePassword: boolean;
    builder: { id: string; status: string; type: string; company: string | null };
  };
};

export const partnerPortalRouter = Router();

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
        where: { id: partnerUserId, organizationId, status: "active", builderId: { not: null } },
        select: {
          id: true,
          organizationId: true,
          builderId: true,
          email: true,
          name: true,
          companyName: true,
          mustChangePassword: true,
          builder: { select: { id: true, status: true, type: true, company: true } },
        },
      }),
    );
    if (!user?.builder || user.builder.status === "inactive") {
      res.status(401).json({ success: false, error: "Acesso ao portal desativado." });
      return;
    }

    req.partnerUser = { ...user, builderId: user.builderId!, builder: user.builder! };
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
          companyName: true,
          mustChangePassword: true,
          builder: { select: { id: true, status: true, company: true } },
        },
      }),
    );
    if (
      !user ||
      user.status !== "active" ||
      !user.builderId ||
      !user.builder ||
      user.builder.status === "inactive" ||
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
        company_name: user.companyName,
        must_change_password: user.mustChangePassword,
      },
    });
  } catch (error) {
    next(error);
  }
});

partnerPortalRouter.get("/api/partner-auth/session", requirePartnerAuth, (req: PartnerRequest, res) => {
  const user = req.partnerUser!;
  res.json({
    success: true,
    authenticated: true,
    data: {
      name: user.name,
      email: user.email,
      company_name: user.companyName || user.builder.company,
      partner_type: user.builder.type,
      must_change_password: user.mustChangePassword,
    },
  });
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
          where: { organizationId: user.organizationId, builderId: user.builderId, deletedAt: null },
          select: { id: true, number: true, name: true, status: true, address: true, updatedAt: true },
          orderBy: { updatedAt: "desc" },
          take: 100,
        }),
        tx.workOrder.findMany({
          where: {
            organizationId: user.organizationId,
            builderId: user.builderId,
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

function partnerDocsReady(user: NonNullable<PartnerRequest["partnerUser"]>, res: Response): boolean {
  if (!user.mustChangePassword) return true;
  res.status(403).json({
    success: false,
    error: "Troque a senha temporária para acessar os documentos.",
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
            builderId: user.builderId,
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
            builderId: user.builderId,
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
            builderId: user.builderId,
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
            builderId: user.builderId,
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
