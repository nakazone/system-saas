import { Router } from "express";
import { z } from "zod";
import { recordActivity, diffFields } from "../../lib/activity/record.js";
import { aiListElevenLabsVoices, aiTextToSpeech } from "../../lib/ai/client.js";
import { withTenantTransaction } from "../../lib/tenant/prisma-tenant.js";
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
        res.status(400).json({ success: false, error: "Revise os dados do funcionário virtual." });
        return;
      }

      const organizationId = req.organizationId!;
      const key = String(req.params.key || "");
      const agent = await withTenantTransaction(organizationId, async (tx) => {
        const current = await tx.virtualAgent.findFirst({ where: { organizationId, key } });
        if (!current) throw new Error("VIRTUAL_AGENT_NOT_FOUND");

        const updated = await tx.virtualAgent.update({
          where: { id: current.id },
          data: parsed.data,
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
            ["name", "title", "department", "avatarKey", "description", "capabilities", "enabled"],
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
