/**
 * Configurações › Orçamentos and Regras de estimativa.
 *
 *   GET    /api/settings/quotes                     settings.manage
 *   PATCH  /api/settings/quotes                     settings.manage
 *   GET    /api/quotes/settings/defaults            quotes.view   (quote builder, new quote)
 *   GET    /api/quotes/settings/owner-signature     quotes.view
 *   PUT    /api/quotes/settings/owner-signature     settings.manage
 *   DELETE /api/quotes/settings/owner-signature     settings.manage
 *   GET    /api/settings/estimate-rules             estimate_rules.manage
 *   PUT    /api/settings/estimate-rules             estimate_rules.manage
 *
 * Mounted before the quotes router so `/api/quotes/settings/*` is not taken
 * for `/api/quotes/:id`.
 */
import { Router } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { storage } from "../../lib/storage/index.js";
import { withTenantTransaction } from "../../lib/tenant/prisma-tenant.js";
import { recordActivity, type ActivityChanges } from "../../lib/activity/record.js";
import type { AuthedRequest } from "../../middleware/auth.js";
import { dec, requireCrmAuth, requireCrmPermission } from "../http.js";
import { fieldErrors } from "../../lib/settings/organization.js";
import {
  FLOORING_LABELS,
  FLOORING_TYPES,
  computeNextQuoteNumber,
  defaultEstimateRule,
  estimateRulesPutSchema,
  formatQuoteNumber,
  ownerSignaturePutSchema,
  parseQuoteSettings,
  quoteSettingsPatchSchema,
} from "../../lib/settings/quotes.js";
import { resolveQuoteInclusions } from "../../lib/quotes/client-document.js";

export const settingsQuotesRouter = Router();

const ORG_QUOTE_SELECT = {
  name: true,
  quoteNumberPrefix: true,
  quoteNextNumber: true,
  quoteValidityDays: true,
  quoteTaxRate: true,
  defaultQuoteTerms: true,
  quoteSettings: true,
} as const;

async function loadQuoteConfig(organizationId: string) {
  const [org, last] = await Promise.all([
    prisma.organization.findUniqueOrThrow({ where: { id: organizationId }, select: ORG_QUOTE_SELECT }),
    withTenantTransaction(organizationId, (tx) =>
      tx.quote.aggregate({ where: { organizationId }, _max: { number: true } }),
    ),
  ]);
  const lastNumber = last._max.number ?? null;
  const settings = parseQuoteSettings(org.quoteSettings);
  const next = computeNextQuoteNumber(lastNumber, org.quoteNextNumber);
  return {
    org,
    settings,
    data: {
      number_prefix: org.quoteNumberPrefix,
      next_number: next,
      next_label: formatQuoteNumber(org.quoteNumberPrefix, next),
      last_number: lastNumber,
      last_label: lastNumber != null ? formatQuoteNumber(org.quoteNumberPrefix, lastNumber) : null,
      validity_days: org.quoteValidityDays,
      tax_rate: dec(org.quoteTaxRate),
      terms: org.defaultQuoteTerms,
      client_view: settings.client_view,
      owner_signature: settings.owner_signature,
      share_messages: settings.share_messages,
      inclusions: settings.inclusions,
      company_name: org.name || null,
    },
  };
}

async function logChange(req: AuthedRequest, action: string, changes?: ActivityChanges | null) {
  const orgId = req.organizationId!;
  await withTenantTransaction(orgId, (tx) =>
    recordActivity(tx, {
      organizationId: orgId,
      entityType: "organization",
      entityId: orgId,
      actorType: "user",
      actorId: req.user!.id,
      action,
      changes: changes ?? null,
    }),
  );
}

settingsQuotesRouter.get(
  "/api/settings/quotes",
  requireCrmAuth,
  requireCrmPermission("settings.manage"),
  async (req: AuthedRequest, res, next) => {
    try {
      res.json({ success: true, data: (await loadQuoteConfig(req.organizationId!)).data });
    } catch (error) {
      next(error);
    }
  },
);

settingsQuotesRouter.patch(
  "/api/settings/quotes",
  requireCrmAuth,
  requireCrmPermission("settings.manage"),
  async (req: AuthedRequest, res, next) => {
    try {
      const parsed = quoteSettingsPatchSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({ success: false, error: "Revise os campos destacados.", fields: fieldErrors(parsed.error) });
        return;
      }
      const orgId = req.organizationId!;
      const before = await loadQuoteConfig(orgId);
      const p = parsed.data;

      if (p.next_number != null && before.data.last_number != null && p.next_number <= before.data.last_number) {
        res.status(400).json({
          success: false,
          error: "Revise os campos destacados.",
          fields: { next_number: `Precisa ser maior que o último usado (${before.data.last_label})` },
        });
        return;
      }

      const data: Prisma.OrganizationUpdateInput = {};
      const changes: ActivityChanges = {};
      const track = (key: string, from: unknown, to: unknown) => {
        if (JSON.stringify(from ?? null) !== JSON.stringify(to ?? null)) changes[key] = { from, to };
      };
      if (p.number_prefix !== undefined) {
        data.quoteNumberPrefix = p.number_prefix;
        track("quoteNumberPrefix", before.org.quoteNumberPrefix, p.number_prefix);
      }
      if (p.next_number !== undefined) {
        data.quoteNextNumber = p.next_number;
        track("quoteNextNumber", before.org.quoteNextNumber, p.next_number);
      }
      if (p.validity_days !== undefined) {
        data.quoteValidityDays = p.validity_days;
        track("quoteValidityDays", before.org.quoteValidityDays, p.validity_days);
      }
      if (p.tax_rate !== undefined) {
        data.quoteTaxRate = new Prisma.Decimal(p.tax_rate);
        track("quoteTaxRate", dec(before.org.quoteTaxRate), p.tax_rate);
      }
      if (p.terms !== undefined) {
        const t = p.terms && p.terms.trim() ? p.terms : null;
        data.defaultQuoteTerms = t;
        track("defaultQuoteTerms", before.org.defaultQuoteTerms ? "(texto)" : null, t ? "(texto alterado)" : null);
        if (t === before.org.defaultQuoteTerms) delete changes.defaultQuoteTerms;
      }
      if (p.client_view !== undefined || p.share_messages !== undefined || p.inclusions !== undefined) {
        const nextSettings = { ...before.settings };
        if (p.client_view !== undefined) {
          nextSettings.client_view = p.client_view;
          track("clientView", before.settings.client_view, p.client_view);
        }
        if (p.share_messages !== undefined) {
          nextSettings.share_messages = p.share_messages;
          track("shareMessages", before.settings.share_messages, p.share_messages);
        }
        if (p.inclusions !== undefined) {
          nextSettings.inclusions = resolveQuoteInclusions(p.inclusions);
          track("inclusions", before.settings.inclusions, nextSettings.inclusions);
        }
        data.quoteSettings = nextSettings as Prisma.InputJsonValue;
      }

      if (Object.keys(changes).length) {
        await prisma.organization.update({ where: { id: orgId }, data });
        await logChange(req, "settings.quotes_updated", changes);
      }
      res.json({
        success: true,
        data: (await loadQuoteConfig(orgId)).data,
        changed: Object.keys(changes),
      });
    } catch (error) {
      next(error);
    }
  },
);

settingsQuotesRouter.get(
  "/api/quotes/settings/defaults",
  requireCrmAuth,
  requireCrmPermission("quotes.view"),
  async (req: AuthedRequest, res, next) => {
    try {
      const { data } = await loadQuoteConfig(req.organizationId!);
      res.json({
        success: true,
        data: {
          number_prefix: data.number_prefix,
          next_label: data.next_label,
          validity_days: data.validity_days,
          tax_rate: data.tax_rate,
          terms: data.terms,
          client_view: data.client_view,
          share_messages: data.share_messages,
          company_name: data.company_name,
        },
      });
    } catch (error) {
      next(error);
    }
  },
);

function ownerSignaturePayload(settings: ReturnType<typeof parseQuoteSettings>) {
  const s = settings.owner_signature;
  return {
    name: s.name,
    title: s.title,
    use_auto_signature: s.use_auto,
    has_signature: Boolean(s.image_url),
    image_url: s.image_url,
    updated_at: s.updated_at,
  };
}

settingsQuotesRouter.get(
  "/api/quotes/settings/owner-signature",
  requireCrmAuth,
  requireCrmPermission("quotes.view"),
  async (req: AuthedRequest, res, next) => {
    try {
      const org = await prisma.organization.findUniqueOrThrow({
        where: { id: req.organizationId! },
        select: { quoteSettings: true },
      });
      res.json({ success: true, data: ownerSignaturePayload(parseQuoteSettings(org.quoteSettings)) });
    } catch (error) {
      next(error);
    }
  },
);

settingsQuotesRouter.put(
  "/api/quotes/settings/owner-signature",
  requireCrmAuth,
  requireCrmPermission("settings.manage"),
  async (req: AuthedRequest, res, next) => {
    try {
      const parsed = ownerSignaturePutSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        const fields = fieldErrors(parsed.error);
        res.status(400).json({ success: false, error: Object.values(fields)[0] || "Dados inválidos", fields });
        return;
      }
      const orgId = req.organizationId!;
      const org = await prisma.organization.findUniqueOrThrow({ where: { id: orgId }, select: { quoteSettings: true } });
      const settings = parseQuoteSettings(org.quoteSettings);
      let imageUrl = settings.owner_signature.image_url;
      if (parsed.data.signature_png) {
        const body = Buffer.from(parsed.data.signature_png.replace(/^data:image\/png;base64,/, ""), "base64");
        const stored = await storage.upload({
          key: `orgs/${orgId}/owner-signature-${Date.now()}.png`,
          body,
          contentType: "image/png",
        });
        imageUrl = stored.url;
      }
      const owner = {
        name: parsed.data.name,
        title: parsed.data.title,
        use_auto: parsed.data.use_auto_signature ?? settings.owner_signature.use_auto,
        image_url: imageUrl,
        updated_at: new Date().toISOString(),
      };
      const next = { ...settings, owner_signature: owner };
      await prisma.organization.update({
        where: { id: orgId },
        data: { quoteSettings: next as unknown as Prisma.InputJsonValue },
      });
      await logChange(req, "settings.owner_signature_updated", {
        ownerSignature: {
          from: settings.owner_signature.name,
          to: `${owner.name} · ${owner.title}`,
        },
      });
      res.json({ success: true, data: ownerSignaturePayload(next) });
    } catch (error) {
      next(error);
    }
  },
);

settingsQuotesRouter.delete(
  "/api/quotes/settings/owner-signature",
  requireCrmAuth,
  requireCrmPermission("settings.manage"),
  async (req: AuthedRequest, res, next) => {
    try {
      const orgId = req.organizationId!;
      const org = await prisma.organization.findUniqueOrThrow({ where: { id: orgId }, select: { quoteSettings: true } });
      const settings = parseQuoteSettings(org.quoteSettings);
      const next = {
        ...settings,
        owner_signature: { ...settings.owner_signature, image_url: null, updated_at: new Date().toISOString() },
      };
      await prisma.organization.update({
        where: { id: orgId },
        data: { quoteSettings: next as unknown as Prisma.InputJsonValue },
      });
      await logChange(req, "settings.owner_signature_removed");
      res.json({ success: true, data: ownerSignaturePayload(next) });
    } catch (error) {
      next(error);
    }
  },
);

// ---------------------------------------------------------------- estimate rules

function serializeRules(rows: Array<{
  flooringType: string;
  wastePercent: Prisma.Decimal;
  materialMarkup: Prisma.Decimal;
  laborMarkup: Prisma.Decimal;
  defaultPricePerSqft: Prisma.Decimal | null;
  defaultLaborPerSqft: Prisma.Decimal | null;
}>) {
  const byType = new Map(rows.map((r) => [r.flooringType, r]));
  return FLOORING_TYPES.map((type) => {
    const r = byType.get(type);
    const d = defaultEstimateRule(type)!;
    const row = {
      flooring_type: type,
      label: FLOORING_LABELS[type] ?? type,
      waste_percent: r ? dec(r.wastePercent) : d.wastePercent,
      material_markup: r ? dec(r.materialMarkup) : d.materialMarkup,
      labor_markup: r ? dec(r.laborMarkup) : d.laborMarkup,
      default_price_per_sqft: r ? dec(r.defaultPricePerSqft) : d.defaultPricePerSqft,
      default_labor_per_sqft: r ? dec(r.defaultLaborPerSqft) : d.defaultLaborPerSqft,
    };
    return {
      ...row,
      defaults: {
        waste_percent: d.wastePercent,
        material_markup: d.materialMarkup,
        labor_markup: d.laborMarkup,
        default_price_per_sqft: d.defaultPricePerSqft,
        default_labor_per_sqft: d.defaultLaborPerSqft,
      },
    };
  });
}

settingsQuotesRouter.get(
  "/api/settings/estimate-rules",
  requireCrmAuth,
  requireCrmPermission("estimate_rules.manage"),
  async (req: AuthedRequest, res, next) => {
    try {
      const rows = await withTenantTransaction(req.organizationId!, (tx) => tx.estimateRule.findMany());
      res.json({ success: true, data: serializeRules(rows) });
    } catch (error) {
      next(error);
    }
  },
);

settingsQuotesRouter.put(
  "/api/settings/estimate-rules",
  requireCrmAuth,
  requireCrmPermission("estimate_rules.manage"),
  async (req: AuthedRequest, res, next) => {
    try {
      const parsed = estimateRulesPutSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({ success: false, error: "Revise os valores destacados.", fields: fieldErrors(parsed.error) });
        return;
      }
      const orgId = req.organizationId!;
      const rows = await withTenantTransaction(orgId, async (tx) => {
        const before = await tx.estimateRule.findMany();
        const beforeMap = new Map(before.map((r) => [r.flooringType, r]));
        const changes: ActivityChanges = {};
        for (const r of parsed.data.rules) {
          const data = {
            wastePercent: new Prisma.Decimal(r.waste_percent),
            materialMarkup: new Prisma.Decimal(r.material_markup),
            laborMarkup: new Prisma.Decimal(r.labor_markup),
            defaultPricePerSqft: new Prisma.Decimal(r.default_price_per_sqft),
            defaultLaborPerSqft: new Prisma.Decimal(r.default_labor_per_sqft),
          };
          const prev = beforeMap.get(r.flooring_type);
          const prevVals = prev
            ? [prev.wastePercent, prev.materialMarkup, prev.laborMarkup, prev.defaultPricePerSqft, prev.defaultLaborPerSqft].map(dec)
            : null;
          const nextVals = [r.waste_percent, r.material_markup, r.labor_markup, r.default_price_per_sqft, r.default_labor_per_sqft];
          if (!prevVals || prevVals.some((v, i) => v !== nextVals[i])) {
            changes[r.flooring_type] = { from: prevVals, to: nextVals };
          }
          await tx.estimateRule.upsert({
            where: { organizationId_flooringType: { organizationId: orgId, flooringType: r.flooring_type } },
            create: { organizationId: orgId, flooringType: r.flooring_type, ...data },
            update: data,
          });
        }
        if (Object.keys(changes).length) {
          await recordActivity(tx, {
            organizationId: orgId,
            entityType: "organization",
            entityId: orgId,
            actorType: "user",
            actorId: req.user!.id,
            action: "settings.estimate_rules_updated",
            changes,
          });
        }
        return tx.estimateRule.findMany();
      });
      res.json({ success: true, data: serializeRules(rows) });
    } catch (error) {
      next(error);
    }
  },
);
