import { Router } from "express";
import { z } from "zod";
import { recordActivity, diffFields } from "../../lib/activity/record.js";
import { aiListElevenLabsVoices, aiTextToSpeech } from "../../lib/ai/client.js";
import { storage } from "../../lib/storage/index.js";
import { withTenantTransaction } from "../../lib/tenant/prisma-tenant.js";
import { FOLLOW_UP_STYLES, listReminders, reminderOut } from "../../lib/virtual-office/reminders.js";
import type { AuthedRequest } from "../../middleware/auth.js";
import { requireCrmAuth, requireCrmPermission } from "../http.js";

export const virtualOfficeRouter = Router();

const voiceRequestSchema = z.object({
  text: z.string().trim().min(1).max(2000),
  voice_id: z.string().trim().min(1).max(128).optional(),
});

const departments = ["central", "commercial", "operations", "finance"] as const;
const avatars = Array.from({ length: 14 }, (_, index) => `avatar-${index + 1}`) as [string, ...string[]];
const capabilities = [
  "office.summary",
  "office.recommendations",
  "leads.search",
  "customers.search",
  "quotes.prepare",
  "quotes.send",
  "jobs.view",
  "jobs.manage",
  "schedule.view",
  "schedule.manage",
  "crews.view",
  "invoices.view",
  "invoices.manage",
  "payments.view",
  "payments.manage",
] as const;

const defaults = [
  {
    key: "mate",
    name: "Mate",
    title: "Gerente Geral",
    department: "central",
    avatarKey: "avatar-6",
    description: "Organiza as prioridades e conecta os setores da empresa.",
    capabilities: ["office.summary", "office.recommendations"],
  },
  {
    key: "lara",
    name: "Lara",
    title: "Assistente comercial",
    department: "commercial",
    avatarKey: "avatar-2",
    description: "Acompanha leads, prepara orçamentos e ajuda no retorno aos clientes.",
    capabilities: ["leads.search", "customers.search", "quotes.prepare", "quotes.send"],
  },
  {
    key: "rafael",
    name: "Rafael",
    title: "Gerente de operações",
    department: "operations",
    avatarKey: "avatar-1",
    description: "Agenda equipes, atualiza obras e acompanha a disponibilidade da operação.",
    capabilities: ["jobs.view", "jobs.manage", "schedule.view", "schedule.manage", "crews.view"],
  },
  {
    key: "marina",
    name: "Marina",
    title: "Assistente financeira",
    department: "finance",
    avatarKey: "avatar-5",
    description: "Acompanha invoices, registra recebimentos e cuida das pendências financeiras.",
    capabilities: ["invoices.view", "invoices.manage", "payments.view", "payments.manage"],
  },
] as const;

const updateSchema = z.object({
  name: z.string().trim().min(2).max(80),
  title: z.string().trim().min(2).max(100),
  department: z.enum(departments),
  avatarKey: z.enum(avatars),
  description: z.string().trim().min(5).max(500),
  capabilities: z.array(z.enum(capabilities)).max(capabilities.length)
    .refine((items) => new Set(items).size === items.length, "Não repita capacidades."),
  enabled: z.boolean(),
  voiceId: z.string().trim().max(128).nullable().optional(),
  personality: z.string().trim().max(600).nullable().optional(),
  followUpStyle: z.enum(FOLLOW_UP_STYLES).optional(),
  workStartHour: z.number().int().min(0).max(23).optional(),
  workEndHour: z.number().int().min(1).max(24).optional(),
}).refine((v) => v.workStartHour === undefined || v.workEndHour === undefined || v.workEndHour > v.workStartHour, {
  message: "O fim do expediente precisa ser depois do início.",
});

virtualOfficeRouter.get(
  "/api/virtual-office/agents",
  requireCrmAuth,
  async (req: AuthedRequest, res, next) => {
    try {
      const organizationId = req.organizationId!;
      const agents = await withTenantTransaction(organizationId, async (tx) => {
        for (const agent of defaults) {
          await tx.virtualAgent.upsert({
            where: { organizationId_key: { organizationId, key: agent.key } },
            create: { organizationId, ...agent, capabilities: [...agent.capabilities] },
            update: {},
          });
        }
        return tx.virtualAgent.findMany({
          where: { organizationId },
          orderBy: [{ department: "asc" }, { createdAt: "asc" }],
        });
      });
      res.json({ success: true, data: agents });
    } catch (error) {
      next(error);
    }
  },
);

virtualOfficeRouter.patch(
  "/api/virtual-office/agents/:key",
  requireCrmAuth,
  requireCrmPermission("settings.manage"),
  async (req: AuthedRequest, res, next) => {
    try {
      const parsed = updateSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({ success: false, error: parsed.error.issues.find((i) => i.code === "custom")?.message || "Revise os dados do funcionário virtual." });
        return;
      }

      const organizationId = req.organizationId!;
      const key = String(req.params.key || "");
      const agent = await withTenantTransaction(organizationId, async (tx) => {
        const current = await tx.virtualAgent.findFirst({ where: { organizationId, key } });
        if (!current) throw new Error("VIRTUAL_AGENT_NOT_FOUND");

        const data = { ...parsed.data, voiceId: parsed.data.voiceId || null, personality: parsed.data.personality || null };
        const updated = await tx.virtualAgent.update({
          where: { id: current.id },
          data,
        });
        await recordActivity(tx, {
          organizationId,
          entityType: "organization",
          entityId: organizationId,
          actorType: "user",
          actorId: req.user!.id,
          action: "virtual_office.agent_updated",
          changes: diffFields(
            current,
            updated,
            ["name", "title", "department", "avatarKey", "description", "capabilities", "enabled", "voiceId", "personality", "followUpStyle", "workStartHour", "workEndHour"],
          ),
        });
        return updated;
      });
      res.json({ success: true, data: agent });
    } catch (error) {
      if (error instanceof Error && error.message === "VIRTUAL_AGENT_NOT_FOUND") {
        res.status(404).json({ success: false, error: "Funcionário virtual não encontrado." });
        return;
      }
      next(error);
    }
  },
);

virtualOfficeRouter.get("/api/virtual-office/voices", requireCrmAuth, async (_req, res, next) => {
  try {
    const result = await aiListElevenLabsVoices();
    if (!result.ok) {
      res.status(result.status === 429 ? 429 : result.provider === "none" ? 503 : 502)
        .json({ success: false, error: result.error });
      return;
    }
    res.json({
      success: true,
      data: { voices: result.voices, default_voice_id: result.defaultVoiceId },
    });
  } catch (error) {
    next(error);
  }
});

virtualOfficeRouter.post("/api/virtual-office/speech", requireCrmAuth, async (req, res, next) => {
  try {
    const parsed = voiceRequestSchema.safeParse(req.body || {});
    if (!parsed.success) {
      res.status(400).json({ success: false, error: "A fala precisa ter até 2.000 caracteres." });
      return;
    }

    if (parsed.data.voice_id) {
      const voices = await aiListElevenLabsVoices();
      if (!voices.ok) {
        res.status(voices.status === 429 ? 429 : voices.provider === "none" ? 503 : 502)
          .json({ success: false, error: voices.error });
        return;
      }
      if (!voices.voices.some((voice) => voice.voiceId === parsed.data.voice_id)) {
        res.status(400).json({ success: false, error: "Essa voz não está disponível para esta conta." });
        return;
      }
    }

    const result = await aiTextToSpeech({ text: parsed.data.text, voiceId: parsed.data.voice_id });
    if (!result.ok) {
      res.status(result.status === 429 ? 429 : result.provider === "none" ? 503 : 502)
        .json({ success: false, error: result.error });
      return;
    }
    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.status(200).send(result.audio);
  } catch (error) {
    next(error);
  }
});

/* ───────── photo (only with the person's consent; the AI seal stays on) ───────── */

const photoSchema = z.object({ data_url: z.string().max(4_000_000).nullable() });

function parsePhoto(dataUrl: string): { contentType: string; body: Buffer; ext: string } | { error: string } {
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!match) return { error: "Envie uma foto JPG, PNG ou WebP." };
  const body = Buffer.from(match[2]!, "base64");
  if (body.length > 2.5 * 1024 * 1024) return { error: "A foto precisa ter menos de 2,5 MB." };
  const contentType = match[1]!;
  return { contentType, body, ext: contentType === "image/png" ? "png" : contentType === "image/webp" ? "webp" : "jpg" };
}

virtualOfficeRouter.put(
  "/api/virtual-office/agents/:key/photo",
  requireCrmAuth,
  requireCrmPermission("settings.manage"),
  async (req: AuthedRequest, res, next) => {
    try {
      const parsed = photoSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({ success: false, error: "Foto inválida." });
        return;
      }
      const organizationId = req.organizationId!;
      const key = String(req.params.key || "");
      if (key === "mate") {
        res.status(400).json({ success: false, error: "O rosto do Mate é fixo." });
        return;
      }
      let photoUrl: string | null = null;
      if (parsed.data.data_url) {
        const img = parsePhoto(parsed.data.data_url);
        if ("error" in img) {
          res.status(400).json({ success: false, error: img.error });
          return;
        }
        const stored = await storage.upload({ key: `virtual-office/${organizationId}/${key}-${Date.now()}.${img.ext}`, body: img.body, contentType: img.contentType });
        photoUrl = stored.url;
      }
      const agent = await withTenantTransaction(organizationId, async (tx) => {
        const current = await tx.virtualAgent.findFirst({ where: { organizationId, key } });
        if (!current) return null;
        const updated = await tx.virtualAgent.update({ where: { id: current.id }, data: { photoUrl } });
        await recordActivity(tx, {
          organizationId,
          entityType: "organization",
          entityId: organizationId,
          actorType: "user",
          actorId: req.user!.id,
          action: "virtual_office.agent_updated",
          changes: { photo: { from: current.photoUrl ? "foto enviada" : "rosto da galeria", to: photoUrl ? "foto enviada" : "rosto da galeria" } },
        });
        return updated;
      });
      if (!agent) {
        res.status(404).json({ success: false, error: "Funcionário virtual não encontrado." });
        return;
      }
      res.json({ success: true, data: agent });
    } catch (error) {
      next(error);
    }
  },
);

/* ───────── reminders the user asked an employee to keep ───────── */

const agentKeySchema = z.string().regex(/^[a-z0-9_-]{1,60}$/i);
const createReminderSchema = z.object({
  agent_key: agentKeySchema,
  text: z.string().trim().min(2).max(280),
  due_at: z.string().datetime({ offset: true }),
});
const updateReminderSchema = z.object({
  action: z.enum(["done", "reopen", "cancel", "snooze"]),
  minutes: z.number().int().min(5).max(7 * 24 * 60).optional(),
});

virtualOfficeRouter.get("/api/virtual-office/reminders", requireCrmAuth, async (req: AuthedRequest, res, next) => {
  try {
    const agent = typeof req.query.agent === "string" && agentKeySchema.safeParse(req.query.agent).success ? req.query.agent : null;
    const rows = await withTenantTransaction(req.organizationId!, (tx) => listReminders(tx, req.organizationId!, req.user!.id, agent));
    const now = new Date();
    res.json({ success: true, data: rows.map((r) => reminderOut(r, now)) });
  } catch (error) {
    next(error);
  }
});

virtualOfficeRouter.post("/api/virtual-office/reminders", requireCrmAuth, async (req: AuthedRequest, res, next) => {
  try {
    const parsed = createReminderSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ success: false, error: "Diga o que lembrar e quando." });
      return;
    }
    const organizationId = req.organizationId!;
    const row = await withTenantTransaction(organizationId, async (tx) => {
      const agent = await tx.virtualAgent.findFirst({ where: { organizationId, key: parsed.data.agent_key, enabled: true }, select: { key: true } });
      if (!agent) return null;
      return tx.officeReminder.create({
        data: { organizationId, userId: req.user!.id, agentKey: agent.key, text: parsed.data.text, dueAt: new Date(parsed.data.due_at) },
      });
    });
    if (!row) {
      res.status(404).json({ success: false, error: "Esse funcionário não está no escritório." });
      return;
    }
    res.status(201).json({ success: true, data: reminderOut(row) });
  } catch (error) {
    next(error);
  }
});

virtualOfficeRouter.patch("/api/virtual-office/reminders/:id", requireCrmAuth, async (req: AuthedRequest, res, next) => {
  try {
    const parsed = updateReminderSchema.safeParse(req.body ?? {});
    const id = String(req.params.id || "");
    if (!parsed.success || !/^[0-9a-f-]{36}$/i.test(id)) {
      res.status(400).json({ success: false, error: "Pedido inválido." });
      return;
    }
    const now = new Date();
    const row = await withTenantTransaction(req.organizationId!, async (tx) => {
      const current = await tx.officeReminder.findFirst({ where: { id, organizationId: req.organizationId!, userId: req.user!.id } });
      if (!current) return null;
      const { action, minutes } = parsed.data;
      const data =
        action === "done"
          ? { status: "done", completedAt: now }
          : action === "cancel"
            ? { status: "canceled", completedAt: now }
            : action === "reopen"
              ? { status: "open", completedAt: null, nudgeCount: 0, lastNudgedAt: null }
              : { status: "open", dueAt: new Date(now.getTime() + (minutes ?? 60) * 60_000), nudgeCount: 0, lastNudgedAt: null };
      return tx.officeReminder.update({ where: { id: current.id }, data });
    });
    if (!row) {
      res.status(404).json({ success: false, error: "Lembrete não encontrado." });
      return;
    }
    res.json({ success: true, data: reminderOut(row, now) });
  } catch (error) {
    next(error);
  }
});
