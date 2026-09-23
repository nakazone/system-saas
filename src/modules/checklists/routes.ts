import { Router } from "express";
import { param } from "../../lib/http/params.js";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { requireAuth, requirePermission, type AuthedRequest } from "../../middleware/auth.js";
import { withTenantTransaction } from "../../lib/tenant/prisma-tenant.js";
import { seedDefaultChecklistTemplates } from "../../lib/checklists/engine.js";
import type { ChecklistField } from "../../lib/checklists/defaults.js";

export const checklistsRouter = Router();

checklistsRouter.use(requireAuth);

const fieldSchema = z.object({
  id: z.string().min(1).max(80),
  label: z.string().min(1).max(200),
  type: z.enum([
    "checkbox",
    "text",
    "long_text",
    "number",
    "select",
    "photo",
    "signature",
    "measurement_rooms",
  ]),
  options: z.array(z.string()).optional(),
  required: z.boolean().optional(),
});

checklistsRouter.get(
  "/",
  requirePermission("checklists.manage"),
  async (req: AuthedRequest, res, next) => {
    try {
      const templates = await withTenantTransaction(req.organizationId!, async (tx) => {
        await seedDefaultChecklistTemplates(tx, req.organizationId!);
        return tx.checklistTemplate.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }] });
      });
      res.render("settings/checklists", {
        title: "Checklists",
        organization: req.organization,
        user: req.user,
        templates,
        editing: null,
        error: null,
        success: typeof req.query.success === "string" ? req.query.success : null,
      });
    } catch (error) {
      next(error);
    }
  },
);

checklistsRouter.get(
  "/:id/edit",
  requirePermission("checklists.manage"),
  async (req: AuthedRequest, res, next) => {
    try {
      const result = await withTenantTransaction(req.organizationId!, async (tx) => {
        const editing = await tx.checklistTemplate.findFirst({ where: { id: param(req, "id") } });
        const templates = await tx.checklistTemplate.findMany({
          orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        });
        return { editing, templates };
      });
      if (!result.editing) {
        res.status(404).send("Not found");
        return;
      }
      res.render("settings/checklists", {
        title: "Edit checklist",
        organization: req.organization,
        user: req.user,
        templates: result.templates,
        editing: result.editing,
        error: null,
        success: null,
      });
    } catch (error) {
      next(error);
    }
  },
);

checklistsRouter.post(
  "/",
  requirePermission("checklists.manage"),
  async (req: AuthedRequest, res, next) => {
    try {
      const schema = z.object({
        name: z.string().min(1).max(120),
        appliesTo: z.enum(["site_assessment", "visit"]),
        visitPhase: z.string().max(40).optional().or(z.literal("")),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        res.redirect("/settings/checklists");
        return;
      }
      await withTenantTransaction(req.organizationId!, async (tx) => {
        const max = await tx.checklistTemplate.aggregate({ _max: { sortOrder: true } });
        await tx.checklistTemplate.create({
          data: {
            organizationId: req.organizationId!,
            name: parsed.data.name,
            appliesTo: parsed.data.appliesTo,
            visitPhase: parsed.data.visitPhase || null,
            fields: [] as Prisma.InputJsonValue,
            sortOrder: (max._max.sortOrder ?? 0) + 1,
          },
        });
      });
      res.redirect("/settings/checklists?success=created");
    } catch (error) {
      next(error);
    }
  },
);

checklistsRouter.post(
  "/:id",
  requirePermission("checklists.manage"),
  async (req: AuthedRequest, res, next) => {
    try {
      const fieldsRaw = String(req.body.fieldsJson || "[]");
      let fields: ChecklistField[] = [];
      try {
        const parsedFields = z.array(fieldSchema).safeParse(JSON.parse(fieldsRaw));
        if (!parsedFields.success) throw new Error("Invalid fields");
        fields = parsedFields.data;
      } catch {
        res.redirect(`/settings/checklists/${param(req, "id")}/edit?error=fields`);
        return;
      }

      const schema = z.object({
        name: z.string().min(1).max(120),
        appliesTo: z.enum(["site_assessment", "visit"]),
        visitPhase: z.string().max(40).optional().or(z.literal("")),
        active: z.string().optional(),
        sortOrder: z.coerce.number().int().min(0).optional(),
        move: z.enum(["up", "down"]).optional(),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        res.redirect(`/settings/checklists/${param(req, "id")}/edit`);
        return;
      }

      await withTenantTransaction(req.organizationId!, async (tx) => {
        const tpl = await tx.checklistTemplate.findFirst({ where: { id: param(req, "id") } });
        if (!tpl) throw new Error("Not found");

        let sortOrder = parsed.data.sortOrder ?? tpl.sortOrder;
        if (parsed.data.move === "up") sortOrder = Math.max(0, tpl.sortOrder - 1);
        if (parsed.data.move === "down") sortOrder = tpl.sortOrder + 1;

        await tx.checklistTemplate.update({
          where: { id: tpl.id },
          data: {
            name: parsed.data.name,
            appliesTo: parsed.data.appliesTo,
            visitPhase: parsed.data.visitPhase || null,
            active: parsed.data.active === "on" || parsed.data.active === "true",
            sortOrder,
            fields: fields as unknown as Prisma.InputJsonValue,
          },
        });
      });
      res.redirect("/settings/checklists?success=saved");
    } catch (error) {
      next(error);
    }
  },
);

/** Reorder a single field up/down within a template */
checklistsRouter.post(
  "/:id/fields/reorder",
  requirePermission("checklists.manage"),
  async (req: AuthedRequest, res, next) => {
    try {
      const fieldId = String(req.body.fieldId || "");
      const direction = String(req.body.direction || "");
      await withTenantTransaction(req.organizationId!, async (tx) => {
        const tpl = await tx.checklistTemplate.findFirst({ where: { id: param(req, "id") } });
        if (!tpl) throw new Error("Not found");
        const fields = Array.isArray(tpl.fields) ? [...(tpl.fields as ChecklistField[])] : [];
        const idx = fields.findIndex((f) => f.id === fieldId);
        if (idx < 0) return;
        const swapWith = direction === "up" ? idx - 1 : idx + 1;
        if (swapWith < 0 || swapWith >= fields.length) return;
        const tmp = fields[idx]!;
        fields[idx] = fields[swapWith]!;
        fields[swapWith] = tmp;
        await tx.checklistTemplate.update({
          where: { id: tpl.id },
          data: { fields: fields as unknown as Prisma.InputJsonValue },
        });
      });
      res.redirect(`/settings/checklists/${param(req, "id")}/edit`);
    } catch (error) {
      next(error);
    }
  },
);
