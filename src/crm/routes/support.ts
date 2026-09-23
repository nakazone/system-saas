import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { withTenantTransaction } from "../../lib/tenant/prisma-tenant.js";
import { email } from "../../lib/email/index.js";
import { env } from "../../config/env.js";
import type { AuthedRequest } from "../../middleware/auth.js";
import { requireCrmAuth } from "../http.js";

export const supportRouter = Router();

const CATEGORIES = ["question", "suggestion", "bug", "other"] as const;

const createSchema = z.object({
  category: z.enum(CATEGORIES).default("question"),
  subject: z.string().trim().min(3).max(160),
  body: z.string().trim().min(10).max(8000),
});

async function resolveSupportInbox(): Promise<string | null> {
  if (env.SUPPORT_INBOX_EMAIL) return env.SUPPORT_INBOX_EMAIL;
  const admin = await prisma.platformAdmin.findFirst({
    where: { status: "active" },
    orderBy: { createdAt: "asc" },
    select: { email: true },
  });
  return admin?.email ?? null;
}

supportRouter.get("/api/support/tickets", requireCrmAuth, async (req: AuthedRequest, res, next) => {
  try {
    const rows = await withTenantTransaction(req.organizationId!, async (tx) =>
      tx.supportTicket.findMany({
        orderBy: { createdAt: "desc" },
        take: 50,
        select: {
          id: true,
          category: true,
          subject: true,
          body: true,
          status: true,
          createdAt: true,
          closedAt: true,
          createdByUser: { select: { id: true, name: true, email: true } },
        },
      }),
    );
    res.json({
      success: true,
      data: rows.map((t) => ({
        id: t.id,
        category: t.category,
        subject: t.subject,
        body: t.body,
        status: t.status,
        created_at: t.createdAt.toISOString(),
        closed_at: t.closedAt?.toISOString() ?? null,
        author: t.createdByUser
          ? { id: t.createdByUser.id, name: t.createdByUser.name, email: t.createdByUser.email }
          : null,
      })),
    });
  } catch (error) {
    next(error);
  }
});

supportRouter.post("/api/support/tickets", requireCrmAuth, async (req: AuthedRequest, res, next) => {
  try {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        success: false,
        error: "Informe assunto (mín. 3) e mensagem (mín. 10 caracteres).",
      });
      return;
    }

    const ticket = await withTenantTransaction(req.organizationId!, async (tx) =>
      tx.supportTicket.create({
        data: {
          organizationId: req.organizationId!,
          category: parsed.data.category,
          subject: parsed.data.subject,
          body: parsed.data.body,
          createdByUserId: req.user!.id,
        },
        select: {
          id: true,
          category: true,
          subject: true,
          body: true,
          status: true,
          createdAt: true,
        },
      }),
    );

    const org = await prisma.organization.findUnique({
      where: { id: req.organizationId! },
      select: { name: true, slug: true },
    });

    try {
      const inbox = await resolveSupportInbox();
      if (inbox) {
        const categoryLabel: Record<(typeof CATEGORIES)[number], string> = {
          question: "Dúvida",
          suggestion: "Sugestão",
          bug: "Problema",
          other: "Outro",
        };
        const cat = categoryLabel[parsed.data.category] ?? parsed.data.category;
        await email.send({
          to: inbox,
          subject: `[Suporte] ${org?.name ?? "Org"} — ${parsed.data.subject}`,
          text: [
            `Nova mensagem de suporte`,
            ``,
            `Empresa: ${org?.name ?? "—"} (${org?.slug ?? "—"})`,
            `De: ${req.user!.name} <${req.user!.email}>`,
            `Tipo: ${cat}`,
            `Assunto: ${parsed.data.subject}`,
            ``,
            parsed.data.body,
            ``,
            `Ticket: ${ticket.id}`,
            `Admin: https://admin.${env.APP_ROOT_DOMAIN}/support/${ticket.id}`,
          ].join("\n"),
        });
      }
    } catch (notifyErr) {
      console.error("[support] notify failed", notifyErr);
    }

    res.status(201).json({
      success: true,
      data: {
        id: ticket.id,
        category: ticket.category,
        subject: ticket.subject,
        body: ticket.body,
        status: ticket.status,
        created_at: ticket.createdAt.toISOString(),
      },
    });
  } catch (error) {
    next(error);
  }
});
