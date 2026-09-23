import { Router } from "express";
import { z } from "zod";
import { requireAuth, requirePermission, type AuthedRequest } from "../../middleware/auth.js";
import { withTenantTransaction } from "../../lib/tenant/prisma-tenant.js";
import {
  MAX_CSV_ROWS,
  mapRows,
  parseCsv,
  suggestMapping,
  type ImportEntityType,
} from "../../lib/imports/csv.js";
import { recordActivity } from "../../lib/activity/record.js";

export const importRouter = Router();

importRouter.use(requireAuth);

importRouter.get(
  "/",
  requirePermission("imports.manage"),
  (req: AuthedRequest, res) => {
    res.render("settings/import", {
      title: "Import data",
      organization: req.organization,
      user: req.user,
      step: "upload",
      entity: "customers",
      headers: [],
      preview: [],
      mapping: {},
      result: null,
      error: null,
      totalRows: 0,
    });
  },
);

importRouter.post(
  "/preview",
  requirePermission("imports.manage"),
  (req: AuthedRequest, res) => {
    const schema = z.object({
      entity: z.enum(["customers", "leads"]),
      csvText: z.string().min(1),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.redirect("/settings/import");
      return;
    }
    const { headers, rows } = parseCsv(parsed.data.csvText);
    if (rows.length > MAX_CSV_ROWS) {
      res.render("settings/import", {
        title: "Import data",
        organization: req.organization,
        user: req.user,
        step: "upload",
        entity: parsed.data.entity,
        headers: [],
        preview: [],
        mapping: {},
        result: null,
        error: `File has ${rows.length} rows; maximum is ${MAX_CSV_ROWS}.`,
        totalRows: 0,
      });
      return;
    }
    req.session.importDraft = {
      entity: parsed.data.entity,
      csvText: parsed.data.csvText,
      headers,
    };
    const mapping = suggestMapping(headers, parsed.data.entity);
    const mapped = mapRows(headers, rows.slice(0, 10), mapping, parsed.data.entity);
    res.render("settings/import", {
      title: "Import data",
      organization: req.organization,
      user: req.user,
      step: "map",
      entity: parsed.data.entity,
      headers,
      preview: mapped,
      mapping,
      result: null,
      error: null,
      totalRows: rows.length,
    });
  },
);

importRouter.post(
  "/commit",
  requirePermission("imports.manage"),
  async (req: AuthedRequest, res, next) => {
    try {
      const draft = req.session.importDraft;
      if (!draft) {
        res.redirect("/settings/import");
        return;
      }

      const schema = z.object({
        duplicateMode: z.enum(["skip", "update"]).default("skip"),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        res.redirect("/settings/import");
        return;
      }

      const entity = draft.entity as ImportEntityType;
      const { headers, rows } = parseCsv(draft.csvText);
      if (rows.length > MAX_CSV_ROWS) {
        res.status(400).send(`Too many rows (max ${MAX_CSV_ROWS})`);
        return;
      }

      const mapping: Record<string, string> = {};
      for (const [key, value] of Object.entries(req.body)) {
        if (key.startsWith("map_") && typeof value === "string" && value) {
          mapping[key.slice(4)] = value;
        }
      }

      const mapped = mapRows(headers, rows, mapping, entity);
      let imported = 0;
      let updated = 0;
      let skipped = 0;
      const ignored: { line: number; reason: string }[] = [];

      await withTenantTransaction(req.organizationId!, async (tx) => {
        for (const row of mapped) {
          if (row.errors.length) {
            skipped++;
            ignored.push({ line: row.line, reason: row.errors.join("; ") });
            continue;
          }

          const email = row.data.email?.toLowerCase() || null;
          const phone = row.data.phone || null;

          if (entity === "customers") {
            const existing =
              (email
                ? await tx.customer.findFirst({ where: { email } })
                : null) ||
              (phone
                ? await tx.customer.findFirst({ where: { phone } })
                : null);

            if (existing) {
              if (parsed.data.duplicateMode === "skip") {
                skipped++;
                ignored.push({ line: row.line, reason: "duplicate email/phone" });
                continue;
              }
              await tx.customer.update({
                where: { id: existing.id },
                data: {
                  name: row.data.name,
                  email: email || existing.email,
                  phone: phone || existing.phone,
                  company: row.data.company || existing.company,
                  notes: row.data.notes || existing.notes,
                },
              });
              if (row.data.line1) {
                const props = await tx.property.findMany({
                  where: { customerId: existing.id },
                  take: 1,
                });
                if (props[0]) {
                  await tx.property.update({
                    where: { id: props[0].id },
                    data: {
                      line1: row.data.line1,
                      line2: row.data.line2 || null,
                      city: row.data.city || "",
                      state: row.data.state || "",
                      postalCode: row.data.postalCode || "",
                      country: row.data.country || "US",
                      label: row.data.label || props[0].label,
                    },
                  });
                } else {
                  await tx.property.create({
                    data: {
                      organizationId: req.organizationId!,
                      customerId: existing.id,
                      label: row.data.label || "Primary",
                      line1: row.data.line1,
                      line2: row.data.line2 || null,
                      city: row.data.city || "",
                      state: row.data.state || "",
                      postalCode: row.data.postalCode || "",
                      country: row.data.country || "US",
                    },
                  });
                }
              }
              await recordActivity(tx, {
                organizationId: req.organizationId!,
                entityType: "customer",
                entityId: existing.id,
                actorType: "user",
                actorId: req.user!.id,
                action: "updated",
                changes: { import: { from: null, to: "csv" } },
              });
              updated++;
              continue;
            }

            const created = await tx.customer.create({
              data: {
                organizationId: req.organizationId!,
                name: row.data.name,
                email,
                phone,
                company: row.data.company || null,
                notes: row.data.notes || null,
                address: row.data.line1 || null,
              },
            });
            if (row.data.line1) {
              await tx.property.create({
                data: {
                  organizationId: req.organizationId!,
                  customerId: created.id,
                  label: row.data.label || "Primary",
                  line1: row.data.line1,
                  line2: row.data.line2 || null,
                  city: row.data.city || "",
                  state: row.data.state || "",
                  postalCode: row.data.postalCode || "",
                  country: row.data.country || "US",
                },
              });
            }
            await recordActivity(tx, {
              organizationId: req.organizationId!,
              entityType: "customer",
              entityId: created.id,
              actorType: "user",
              actorId: req.user!.id,
              action: "created",
              changes: { import: { from: null, to: "csv" } },
            });
            imported++;
          } else {
            const existing =
              (email ? await tx.lead.findFirst({ where: { email } }) : null) ||
              (phone ? await tx.lead.findFirst({ where: { phone } }) : null);

            if (existing) {
              if (parsed.data.duplicateMode === "skip") {
                skipped++;
                ignored.push({ line: row.line, reason: "duplicate email/phone" });
                continue;
              }
              await tx.lead.update({
                where: { id: existing.id },
                data: {
                  name: row.data.name,
                  email: email || existing.email,
                  phone: phone || existing.phone,
                  source: row.data.source || existing.source,
                  notes: row.data.notes || existing.notes,
                },
              });
              await recordActivity(tx, {
                organizationId: req.organizationId!,
                entityType: "lead",
                entityId: existing.id,
                actorType: "user",
                actorId: req.user!.id,
                action: "updated",
                changes: { import: { from: null, to: "csv" } },
              });
              updated++;
              continue;
            }

            const created = await tx.lead.create({
              data: {
                organizationId: req.organizationId!,
                name: row.data.name,
                email,
                phone,
                source: row.data.source || null,
                notes: row.data.notes || null,
                status: "new",
                ownerId: req.user!.id,
              },
            });
            await recordActivity(tx, {
              organizationId: req.organizationId!,
              entityType: "lead",
              entityId: created.id,
              actorType: "user",
              actorId: req.user!.id,
              action: "created",
              changes: { import: { from: null, to: "csv" } },
            });
            imported++;
          }
        }
      });

      delete req.session.importDraft;

      res.render("settings/import", {
        title: "Import data",
        organization: req.organization,
        user: req.user,
        step: "done",
        entity,
        headers: [],
        preview: [],
        mapping: {},
        result: { imported, updated, skipped, ignored: ignored.slice(0, 100) },
        error: null,
        totalRows: rows.length,
      });
    } catch (error) {
      next(error);
    }
  },
);
