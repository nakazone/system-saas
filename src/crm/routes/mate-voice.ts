import { createHash } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { env } from "../../config/env.js";
import { withTenantTransaction } from "../../lib/tenant/prisma-tenant.js";
import { createConversationSchema, transcriptMessageSchema } from "../../lib/mate-voice/contracts.js";
import { createRealtimeClientSecret, type MateVoiceCrmContext } from "../../lib/mate-voice/realtime.js";
import { isMateVoiceEnabled } from "../../lib/mate-voice/staging.js";
import type { AuthedRequest } from "../../middleware/auth.js";
import { requireCrmAuth, requireCrmPermission } from "../http.js";

export const mateVoiceRouter = Router();

const conversationIdSchema = z.string().uuid();
const finishSchema = z.object({ status: z.enum(["completed", "failed"]).default("completed") });

mateVoiceRouter.use((_req, res, next) => {
  if (!isMateVoiceEnabled()) {
    res.status(404).json({ success: false, error: "Not found" });
    return;
  }
  next();
});

mateVoiceRouter.get("/api/mate-voice/crm/leads", requireCrmAuth, requireCrmPermission("leads.view"), async (req: AuthedRequest, res, next) => {
  try {
    const query = String(req.query.q || "").trim().slice(0, 100);
    if (query.length < 2) {
      res.json({ success: true, results: [] });
      return;
    }
    const results = await withTenantTransaction(req.organizationId!, (tx) => tx.lead.findMany({
      where: { organizationId: req.organizationId!, name: { contains: query, mode: "insensitive" } },
      select: { id: true, name: true, status: true },
      orderBy: { updatedAt: "desc" },
      take: 8,
    }));
    res.json({ success: true, results: results.map((row) => ({ ...row, kind: "lead" })) });
  } catch (error) {
    next(error);
  }
});

mateVoiceRouter.get("/api/mate-voice/crm/customers", requireCrmAuth, requireCrmPermission("customers.view"), async (req: AuthedRequest, res, next) => {
  try {
    const query = String(req.query.q || "").trim().slice(0, 100);
    if (query.length < 2) {
      res.json({ success: true, results: [] });
      return;
    }
    const results = await withTenantTransaction(req.organizationId!, (tx) => tx.customer.findMany({
      where: {
        organizationId: req.organizationId!,
        OR: [
          { name: { contains: query, mode: "insensitive" } },
          { company: { contains: query, mode: "insensitive" } },
        ],
      },
      select: { id: true, name: true, company: true },
      orderBy: { updatedAt: "desc" },
      take: 8,
    }));
    res.json({ success: true, results: results.map((row) => ({ ...row, kind: "customer" })) });
  } catch (error) {
    next(error);
  }
});

mateVoiceRouter.get("/api/mate-voice/conversations", requireCrmAuth, async (req: AuthedRequest, res, next) => {
  try {
    const conversations = await withTenantTransaction(req.organizationId!, (tx) => tx.mateVoiceConversation.findMany({
      where: { organizationId: req.organizationId!, createdById: req.user!.id },
      select: {
        id: true, title: true, status: true, createdAt: true, endedAt: true,
        lead: { select: { name: true } }, customer: { select: { name: true, company: true } },
        _count: { select: { messages: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 30,
    }));
    res.json({ success: true, conversations });
  } catch (error) {
    next(error);
  }
});

mateVoiceRouter.get("/api/mate-voice/conversations/:id", requireCrmAuth, async (req: AuthedRequest, res, next) => {
  try {
    const parsedId = conversationIdSchema.safeParse(req.params.id);
    if (!parsedId.success) {
      res.status(400).json({ success: false, error: "Conversa inválida." });
      return;
    }
    const conversation = await withTenantTransaction(req.organizationId!, (tx) => tx.mateVoiceConversation.findFirst({
      where: { id: parsedId.data, createdById: req.user!.id },
      include: {
        messages: { orderBy: { createdAt: "asc" }, take: 400 },
        lead: { select: { id: true, name: true, status: true } },
        customer: { select: { id: true, name: true, company: true } },
      },
    }));
    if (!conversation) {
      res.status(404).json({ success: false, error: "Conversa não encontrada." });
      return;
    }
    res.json({ success: true, conversation });
  } catch (error) {
    next(error);
  }
});

mateVoiceRouter.post("/api/mate-voice/conversations", requireCrmAuth, async (req: AuthedRequest, res, next) => {
  try {
    const body = createConversationSchema.safeParse(req.body || {});
    if (!body.success) {
      res.status(400).json({ success: false, error: "Vínculo do CRM inválido." });
      return;
    }

    const conversation = await withTenantTransaction(req.organizationId!, async (tx) => {
      let title = "Conversa por voz";
      let leadId: string | null = null;
      let customerId: string | null = null;
      if (body.data.crmType === "lead" && body.data.crmId) {
        const lead = await tx.lead.findFirst({
          where: { id: body.data.crmId, organizationId: req.organizationId! },
          select: { id: true, name: true },
        });
        if (!lead) return null;
        title = `Lead · ${lead.name.slice(0, 110)}`;
        leadId = lead.id;
      } else if (body.data.crmType === "customer" && body.data.crmId) {
        const customer = await tx.customer.findFirst({
          where: { id: body.data.crmId, organizationId: req.organizationId! },
          select: { id: true, name: true, company: true },
        });
        if (!customer) return null;
        title = `Cliente · ${customer.company || customer.name}`.slice(0, 140);
        customerId = customer.id;
      }
      return tx.mateVoiceConversation.create({
        data: {
          organizationId: req.organizationId!,
          createdById: req.user!.id,
          leadId,
          customerId,
          title,
        },
        select: { id: true, title: true, status: true, createdAt: true, leadId: true, customerId: true },
      });
    });

    if (!conversation) {
      res.status(404).json({ success: false, error: "Registro do CRM não encontrado nesta empresa." });
      return;
    }
    res.status(201).json({ success: true, conversation });
  } catch (error) {
    next(error);
  }
});

mateVoiceRouter.post("/api/mate-voice/conversations/:id/token", requireCrmAuth, async (req: AuthedRequest, res, next) => {
  try {
    if (!env.OPENAI_API_KEY) {
      res.status(503).json({ success: false, error: "OPENAI_API_KEY não está configurada neste ambiente." });
      return;
    }
    const parsedId = conversationIdSchema.safeParse(req.params.id);
    if (!parsedId.success) {
      res.status(400).json({ success: false, error: "Conversa inválida." });
      return;
    }

    const context = await withTenantTransaction(req.organizationId!, async (tx): Promise<MateVoiceCrmContext | null | false> => {
      const conversation = await tx.mateVoiceConversation.findFirst({
        where: { id: parsedId.data, createdById: req.user!.id },
        select: { id: true, leadId: true, customerId: true },
      });
      if (!conversation) return false;
      if (conversation.leadId) {
        const lead = await tx.lead.findFirst({
          where: { id: conversation.leadId, organizationId: req.organizationId! },
          select: { name: true, status: true },
        });
        return lead ? { kind: "lead", name: lead.name, status: lead.status } : null;
      }
      if (conversation.customerId) {
        const customer = await tx.customer.findFirst({
          where: { id: conversation.customerId, organizationId: req.organizationId! },
          select: { name: true, company: true },
        });
        return customer ? { kind: "customer", name: customer.name, company: customer.company } : null;
      }
      return null;
    });
    if (context === false) {
      res.status(404).json({ success: false, error: "Conversa não encontrada." });
      return;
    }

    const safetyIdentifier = createHash("sha256")
      .update(`${req.organizationId}:${req.user!.id}`)
      .digest("hex");
    const secret = await createRealtimeClientSecret({
      apiKey: env.OPENAI_API_KEY,
      safetyIdentifier,
      context,
    });
    res.setHeader("Cache-Control", "no-store");
    res.json({ success: true, value: secret.value, expires_at: secret.expires_at });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("realtime_secret_")) {
      res.status(502).json({ success: false, error: "Não foi possível iniciar a sessão de voz." });
      return;
    }
    next(error);
  }
});

mateVoiceRouter.post("/api/mate-voice/conversations/:id/messages", requireCrmAuth, async (req: AuthedRequest, res, next) => {
  try {
    const parsedId = conversationIdSchema.safeParse(req.params.id);
    const body = transcriptMessageSchema.safeParse(req.body || {});
    if (!parsedId.success || !body.success) {
      res.status(400).json({ success: false, error: "Transcrição inválida." });
      return;
    }
    const message = await withTenantTransaction(req.organizationId!, async (tx) => {
      const conversation = await tx.mateVoiceConversation.findFirst({
        where: { id: parsedId.data, createdById: req.user!.id, status: "active" },
        select: { id: true },
      });
      if (!conversation) return null;
      return tx.mateVoiceMessage.create({
        data: {
          organizationId: req.organizationId!,
          conversationId: conversation.id,
          role: body.data.role,
          content: body.data.content,
        },
        select: { id: true, role: true, content: true, createdAt: true },
      });
    });
    if (!message) {
      res.status(404).json({ success: false, error: "Conversa ativa não encontrada." });
      return;
    }
    res.status(201).json({ success: true, message });
  } catch (error) {
    next(error);
  }
});

mateVoiceRouter.post("/api/mate-voice/conversations/:id/finish", requireCrmAuth, async (req: AuthedRequest, res, next) => {
  try {
    const parsedId = conversationIdSchema.safeParse(req.params.id);
    const body = finishSchema.safeParse(req.body || {});
    if (!parsedId.success || !body.success) {
      res.status(400).json({ success: false, error: "Conversa inválida." });
      return;
    }
    const conversation = await withTenantTransaction(req.organizationId!, async (tx) => {
      const owned = await tx.mateVoiceConversation.findFirst({
        where: { id: parsedId.data, createdById: req.user!.id },
        select: { id: true },
      });
      if (!owned) return null;
      return tx.mateVoiceConversation.update({
        where: { id: owned.id },
        data: { status: body.data.status, endedAt: new Date() },
        select: { id: true, status: true, endedAt: true },
      });
    });
    if (!conversation) {
      res.status(404).json({ success: false, error: "Conversa não encontrada." });
      return;
    }
    res.json({ success: true, conversation });
  } catch (error) {
    next(error);
  }
});
