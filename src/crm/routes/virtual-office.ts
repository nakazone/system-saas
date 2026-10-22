import { Router } from "express";
import { z } from "zod";
import { recordActivity, diffFields } from "../../lib/activity/record.js";
import { withTenantTransaction } from "../../lib/tenant/prisma-tenant.js";
import type { AuthedRequest } from "../../middleware/auth.js";
import { requireCrmAuth, requireCrmPermission } from "../http.js";

export const virtualOfficeRouter = Router();

const departments = ["central", "commercial", "operations", "finance"] as const;
const avatars = ["avatar-1", "avatar-2", "avatar-3", "avatar-4", "avatar-5", "avatar-6"] as const;
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
    title: "Coordenador virtual",
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
