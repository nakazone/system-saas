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
          messages: { orderBy: { createdAt: "asc" }, select: { authorType: true, authorName: true, body: true, createdAt: true } },
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
        messages: t.messages.map((m) => ({
          from: m.authorType === "platform" ? "obramate" : "company",
          author: m.authorName,
          body: m.body,
          created_at: m.createdAt.toISOString(),
        })),
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
        const cat =
          categoryLabel[parsed.data.category as (typeof CATEGORIES)[number]] ??
          parsed.data.category;
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
            `Abrir no Master: ${env.APP_BASE_URL.replace(/\/$/, "")}/master/suporte/${ticket.id}`,
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

const replySchema = z.object({ body: z.string().trim().min(1).max(8000) });

/** The company answers the platform team inside the ticket (reopens it). */
supportRouter.post("/api/support/tickets/:id/messages", requireCrmAuth, async (req: AuthedRequest, res, next) => {
  try {
    const parsed = replySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: "Escreva a mensagem." });
      return;
    }
    const ticketId = String(req.params.id);
    const ticket = await withTenantTransaction(req.organizationId!, async (tx) => {
      const t = await tx.supportTicket.findFirst({ where: { id: ticketId }, select: { id: true, subject: true } });
      if (!t) return null;
      await tx.supportTicketMessage.create({
        data: { ticketId: t.id, organizationId: req.organizationId!, authorType: "company", authorId: req.user!.id, authorName: req.user!.name, body: parsed.data.body },
      });
      await tx.supportTicket.update({ where: { id: t.id }, data: { status: "open", closedAt: null, lastMessageAt: new Date() } });
      return t;
    });
    if (!ticket) {
      res.status(404).json({ success: false, error: "Ticket não encontrado." });
      return;
    }
    try {
      const inbox = await resolveSupportInbox();
      if (inbox) {
        await email.send({
          to: inbox,
          subject: `[Suporte] Resposta — ${ticket.subject}`,
          text: `${req.user!.name} <${req.user!.email}> respondeu:\n\n${parsed.data.body}\n\nAbrir no Master: ${env.APP_BASE_URL.replace(/\/$/, "")}/master/suporte/${ticket.id}`,
        });
      }
    } catch (notifyErr) {
      console.error("[support] notify failed", notifyErr);
    }
    res.status(201).json({ success: true });
  } catch (error) {
    next(error);
  }
});
