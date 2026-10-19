import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { Prisma } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { env } from "../../config/env.js";
import { recordActivity } from "../../lib/activity/record.js";
import { calculateQuoteTotals } from "../../lib/quotes/totals.js";
import { withTenantTransaction } from "../../lib/tenant/prisma-tenant.js";
import {
  computeNextQuoteNumber,
  defaultValidUntil,
  formatQuoteNumber,
  parseQuoteSettings,
} from "../../lib/settings/quotes.js";
import type { AuthedRequest } from "../../middleware/auth.js";
import { requireCrmAuth, requireCrmPermission } from "../http.js";
import {
  matchPricingService,
  mergeMateAiCatalog,
  normalizeMateAiText,
  normalizeMateAiUnit,
  parseMateAiCommand,
  resolveCustomerUnitPrice,
  type MateAiLineSpec,
} from "../../lib/mate-ai/command.js";

export const mateAiRouter = Router();

const PREVIEW_LIFETIME_MS = 10 * 60 * 1000;
const MAX_QUOTE_TOTAL = 9_999_999_999.99;

const previewRequestSchema = z.object({
  command: z.string().trim().min(5).max(500),
});

const createDraftRequestSchema = z.object({
  preview_token: z.string().min(30).max(32_768),
  confirmed_review: z.literal(true),
});

const tokenLineSchema = z.object({
  catalogItemId: z.string().uuid(),
  catalogSource: z.enum(["quote-catalog", "pricing"]),
  pricingItemId: z.string().uuid().nullable(),
  descriptionHash: z.string().regex(/^[0-9a-f]{64}$/),
  name: z.string().min(1).max(500),
  category: z.string().max(500),
  unit: z.string().min(1).max(100),
  quantity: z.number().positive().max(1_000_000),
  unitPrice: z.number().positive().max(MAX_QUOTE_TOTAL),
});

const previewTokenSchema = z.object({
  version: z.literal(1),
  organizationId: z.string().uuid(),
  userId: z.string().uuid(),
  previewId: z.string().uuid(),
  customerId: z.string().uuid(),
  customerName: z.string().min(1).max(500),
  taxRate: z.number().min(0).max(999.99),
  expiresAt: z.number().int().positive(),
  lines: z.array(tokenLineSchema).min(1).max(8),
});

type PreviewToken = z.infer<typeof previewTokenSchema>;

function descriptionHash(value: string | null): string {
  return createHash("sha256").update(value || "").digest("hex");
}

function issuePreviewToken(payload: PreviewToken): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", env.SESSION_SECRET).update(body).digest("base64url");
  return body + "." + signature;
}

export function verifyMateAiPreviewToken(token: string): PreviewToken | null {
  const parts = String(token || "").split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;

  const expected = createHmac("sha256", env.SESSION_SECRET).update(parts[0]).digest();
  let provided: Buffer;
  try {
    provided = Buffer.from(parts[1], "base64url");
  } catch {
    return null;
  }
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return null;

  try {
    const parsed = previewTokenSchema.safeParse(JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")));
    if (!parsed.success || parsed.data.expiresAt <= Date.now()) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

function customerCandidates<T extends { id: string; name: string; company: string | null }>(
  query: string,
  customers: T[],
) {
  const normalized = normalizeMateAiText(query);
  const exact = customers.filter(
    (customer) =>
      normalizeMateAiText(customer.name) === normalized ||
      (customer.company && normalizeMateAiText(customer.company) === normalized),
  );
  if (exact.length === 1) return { customer: exact[0]!, candidates: [] };
  if (exact.length > 1) return { customer: null, candidates: exact.slice(0, 8) };
  if (customers.length === 1) return { customer: customers[0]!, candidates: [] };
  return { customer: null, candidates: customers.slice(0, 8) };
}

function messageForParseError(error: unknown): string {
  const key = error instanceof Error ? error.message : "";
  const messages: Record<string, string> = {
    command_length: "Use um comando entre 5 e 500 caracteres.",
    customer_missing: "Inclua o cliente no comando, por exemplo: “Quote para Maria Silva com 500 sqft de Carpet Removal”.",
    items_missing: "Inclua pelo menos um serviço com quantidade e unidade, como 500 sqft.",
    service_missing: "Não consegui identificar um serviço em uma das medidas.",
    quantity_invalid: "A quantidade precisa ser maior que zero e menor que 1.000.000.",
    quantity_precision: "Use no máximo duas casas decimais para a quantidade.",
    unit_unsupported: "Unidade não suportada. Use sq ft, linear ft, fixed, each, box, step ou hour.",
    too_many_items: "O MVP aceita até 8 serviços por Quote.",
  };
  return messages[key] || "Não consegui entender o comando. Confira cliente, serviço, quantidade e unidade.";
}

function priceForPreview(
  rate: number | null,
  quantity: number,
): { unitPrice: number; amount: number } | null {
  if (rate == null || !Number.isFinite(rate) || rate <= 0) return null;
  const unitPrice = Math.round(rate * 100) / 100;
  const amount = Math.round(quantity * unitPrice * 100) / 100;
  if (!Number.isFinite(amount) || amount <= 0 || amount > MAX_QUOTE_TOTAL) return null;
  return { unitPrice, amount };
}

mateAiRouter.post(
  "/api/mate-ai/preview",
  requireCrmAuth,
  requireCrmPermission("quotes.create", "customers.view", "pricing.view"),
  async (req: AuthedRequest, res, next) => {
    try {
      const body = previewRequestSchema.safeParse(req.body || {});
      if (!body.success) {
        res.status(400).json({ success: false, error: "Comando inválido", details: body.error.flatten() });
        return;
      }

      let parsedCommand: ReturnType<typeof parseMateAiCommand>;
      try {
        parsedCommand = parseMateAiCommand(body.data.command);
      } catch (error) {
        res.status(422).json({ success: false, error: messageForParseError(error) });
        return;
      }

      const resolved = await withTenantTransaction(req.organizationId!, async (tx) => {
        const exactCustomerRows = await tx.customer.findMany({
          where: {
            organizationId: req.organizationId!,
            OR: [
              { name: { equals: parsedCommand.customerQuery, mode: "insensitive" } },
              { company: { equals: parsedCommand.customerQuery, mode: "insensitive" } },
            ],
          },
          select: {
            id: true,
            name: true,
            company: true,
            customerType: true,
            pricingMode: true,
            customPricingRates: true,
          },
          orderBy: { name: "asc" },
          take: 20,
        });
        const customerRows = exactCustomerRows.length
          ? exactCustomerRows
          : await tx.customer.findMany({
              where: {
                organizationId: req.organizationId!,
                OR: [
                  { name: { contains: parsedCommand.customerQuery, mode: "insensitive" } },
                  { company: { contains: parsedCommand.customerQuery, mode: "insensitive" } },
                ],
              },
              select: {
                id: true,
                name: true,
                company: true,
                customerType: true,
                pricingMode: true,
                customPricingRates: true,
              },
              orderBy: { name: "asc" },
              take: 20,
            });
        const matchedCustomer = customerCandidates(parsedCommand.customerQuery, customerRows);
        if (!matchedCustomer.customer) {
          return {
            status: customerRows.length ? "customer_ambiguous" as const : "customer_not_found" as const,
            candidates: matchedCustomer.candidates.map((customer) => ({
              id: customer.id,
              name: customer.name,
              company: customer.company,
            })),
          };
        }

        const customer = matchedCustomer.customer;
        const [quoteCatalogRows, pricingRows] = await Promise.all([
          tx.quoteCatalogItem.findMany({
            where: { organizationId: req.organizationId!, active: true },
            select: {
              id: true,
              name: true,
              serviceType: true,
              unitType: true,
              unitPrice: true,
              description: true,
              active: true,
            },
            orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
          }),
          tx.pricingItem.findMany({
            where: { organizationId: req.organizationId!, active: true, isVisible: true },
            select: {
              id: true,
              name: true,
              category: true,
              unit: true,
              price: true,
              priceMin: true,
              priceMax: true,
              partnerPrice: true,
              priceParticular: true,
              priceBuilder: true,
              priceContractor: true,
              priceLoja: true,
              notes: true,
              description: true,
              active: true,
              isVisible: true,
            },
            orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
          }),
        ]);
        const catalogItems = mergeMateAiCatalog(quoteCatalogRows, pricingRows);

        const lines: Array<{
          catalogItemId: string;
          catalogSource: "quote-catalog" | "pricing";
          pricingItemId: string | null;
          name: string;
          category: string;
          unit: string;
          description: string | null;
          quantity: number;
          unitPrice: number;
          amount: number;
        }> = [];
        const issues: Array<{ line: number; code: string; message: string; suggestions?: string[] }> = [];

        for (let index = 0; index < parsedCommand.items.length; index++) {
          const spec: MateAiLineSpec = parsedCommand.items[index]!;
          const match = matchPricingService(spec.serviceQuery, spec.unit, catalogItems);
          if (match.status === "not_found") {
            issues.push({
              line: index + 1,
              code: "service_not_found",
              message: "Não encontrei serviço ativo no catálogo para “" + spec.serviceQuery + "” com a unidade " + spec.unit + ".",
            });
            continue;
          }
          if (match.status === "ambiguous") {
            issues.push({
              line: index + 1,
              code: "service_ambiguous",
              message: "Há mais de um serviço compatível. Reescreva usando o nome exato do catálogo.",
              suggestions: match.items.map((item) => item.name),
            });
            continue;
          }

          const rate = resolveCustomerUnitPrice(match.item, customer);
          const price = priceForPreview(rate, spec.quantity);
          if (!price) {
            issues.push({
              line: index + 1,
              code: "price_missing",
              message: "Não há um preço positivo configurado para “" + match.item.name + "” neste cliente.",
            });
            continue;
          }
          lines.push({
            catalogItemId: match.item.id,
            catalogSource: match.item.source,
            pricingItemId: match.item.pricingItemId,
            name: match.item.name,
            category: match.item.category,
            unit: match.item.unit,
            description: match.item.description,
            quantity: spec.quantity,
            unitPrice: price.unitPrice,
            amount: price.amount,
          });
        }

        if (issues.length) return { status: "needs_clarification" as const, issues };

        const org = await tx.organization.findFirstOrThrow({
          where: { id: req.organizationId! },
          select: { quoteTaxRate: true },
        });
        const taxRate = Number(org.quoteTaxRate);
        const totals = calculateQuoteTotals({
          lines: lines.map((line) => ({
            quantity: line.quantity,
            unitPrice: line.unitPrice,
            amount: line.amount,
          })),
          taxRate,
        });
        if (totals.total > MAX_QUOTE_TOTAL) {
          return {
            status: "needs_clarification" as const,
            issues: [{ line: 0, code: "total_too_large", message: "O total excede o limite permitido para um Quote." }],
          };
        }

        const previewId = randomUUID();
        const tokenPayload: PreviewToken = {
          version: 1,
          organizationId: req.organizationId!,
          userId: req.user!.id,
          previewId,
          customerId: customer.id,
          customerName: customer.name,
          taxRate,
          expiresAt: Date.now() + PREVIEW_LIFETIME_MS,
          lines: lines.map((line) => ({
            catalogItemId: line.catalogItemId,
            catalogSource: line.catalogSource,
            pricingItemId: line.pricingItemId,
            descriptionHash: descriptionHash(line.description),
            name: line.name,
            category: line.category,
            unit: line.unit,
            quantity: line.quantity,
            unitPrice: line.unitPrice,
          })),
        };

        await recordActivity(tx, {
          organizationId: req.organizationId!,
          entityType: "customer",
          entityId: customer.id,
          actorType: "user",
          actorId: req.user!.id,
          action: "mate_ai.quote_previewed",
          changes: {
            source: { from: null, to: "mate_ai" },
            previewId: { from: null, to: previewId },
            itemCount: { from: null, to: lines.length },
          },
        });

        return {
          status: "ready" as const,
          previewId,
          previewToken: issuePreviewToken(tokenPayload),
          expiresAt: new Date(tokenPayload.expiresAt).toISOString(),
          customer: { id: customer.id, name: customer.name, company: customer.company },
          lines,
          totals,
          taxRate,
        };
      });

      if (resolved.status === "customer_not_found") {
        res.status(200).json({
          success: true,
          status: resolved.status,
          customer_query: parsedCommand.customerQuery,
          message: "Não encontrei esse cliente nesta empresa. Confira o nome ou cadastre o cliente antes de continuar.",
        });
        return;
      }
      if (resolved.status === "customer_ambiguous") {
        res.status(200).json({
          success: true,
          status: resolved.status,
          customer_query: parsedCommand.customerQuery,
          candidates: resolved.candidates,
          message: "Encontrei mais de um cliente. Refaça o comando com o nome completo.",
        });
        return;
      }
      if (resolved.status === "needs_clarification") {
        res.status(200).json({ success: true, status: resolved.status, issues: resolved.issues });
        return;
      }
      if (resolved.status !== "ready") {
        res.status(500).json({ success: false, error: "Não foi possível preparar a revisão do Quote." });
        return;
      }

      res.json({
        success: true,
        status: resolved.status,
        preview_id: resolved.previewId,
        preview_token: resolved.previewToken,
        expires_at: resolved.expiresAt,
        customer: resolved.customer,
        items: resolved.lines,
        subtotal: resolved.totals.subtotal,
        tax_rate: resolved.taxRate,
        tax_total: resolved.totals.taxTotal,
        total: resolved.totals.total,
      });
    } catch (error) {
      next(error);
    }
  },
);

mateAiRouter.post(
  "/api/mate-ai/quote-drafts",
  requireCrmAuth,
  requireCrmPermission("quotes.create", "customers.view", "pricing.view"),
  async (req: AuthedRequest, res, next) => {
    try {
      const body = createDraftRequestSchema.safeParse(req.body || {});
      if (!body.success) {
        res.status(400).json({ success: false, error: "Confirme a revisão do Quote antes de criar o rascunho." });
        return;
      }

      const preview = verifyMateAiPreviewToken(body.data.preview_token);
      if (
        !preview ||
        preview.organizationId !== req.organizationId ||
        preview.userId !== req.user!.id
      ) {
        res.status(400).json({ success: false, error: "A prévia expirou ou não pertence a esta sessão. Gere uma nova prévia." });
        return;
      }

      const result = await withTenantTransaction(req.organizationId!, async (tx) => {
        await tx.$queryRawUnsafe("SELECT pg_advisory_xact_lock(hashtext($1))", preview.previewId);
        const alreadyCreated = await tx.quote.findFirst({
          where: {
            organizationId: req.organizationId!,
            payload: { path: ["mate_ai_preview_id"], equals: preview.previewId },
          },
          select: { id: true, quoteNumber: true },
        });
        if (alreadyCreated) return { status: "already_created" as const, quote: alreadyCreated };

        const customer = await tx.customer.findFirst({
          where: { id: preview.customerId, organizationId: req.organizationId! },
          select: {
            id: true,
            name: true,
            customerType: true,
            pricingMode: true,
            customPricingRates: true,
          },
        });
        if (!customer || customer.name !== preview.customerName) {
          return { status: "stale" as const };
        }

        const [quoteCatalogRows, pricingRows] = await Promise.all([
          tx.quoteCatalogItem.findMany({
            where: { organizationId: req.organizationId!, active: true },
            select: {
              id: true,
              name: true,
              serviceType: true,
              unitType: true,
              unitPrice: true,
              description: true,
              active: true,
            },
            orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
          }),
          tx.pricingItem.findMany({
            where: { organizationId: req.organizationId!, active: true, isVisible: true },
            select: {
              id: true,
              name: true,
              category: true,
              unit: true,
              price: true,
              priceMin: true,
              priceMax: true,
              partnerPrice: true,
              priceParticular: true,
              priceBuilder: true,
              priceContractor: true,
              priceLoja: true,
              notes: true,
              description: true,
              active: true,
              isVisible: true,
            },
            orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
          }),
        ]);
        const catalogItems = mergeMateAiCatalog(quoteCatalogRows, pricingRows);
        const lines = [];
        for (const expected of preview.lines) {
          const item = catalogItems.find(
            (candidate) => candidate.id === expected.catalogItemId && candidate.source === expected.catalogSource,
          );
          if (
            !item ||
            item.name !== expected.name ||
            item.category !== expected.category ||
            item.unit !== expected.unit ||
            item.pricingItemId !== expected.pricingItemId ||
            descriptionHash(item.description) !== expected.descriptionHash
          ) {
            return { status: "stale" as const };
          }
          const currentPrice = resolveCustomerUnitPrice(item, customer);
          if (currentPrice == null || Math.round(currentPrice * 100) / 100 !== expected.unitPrice) {
            return { status: "stale" as const };
          }
          const amount = Math.round(expected.quantity * expected.unitPrice * 100) / 100;
          if (!Number.isFinite(amount) || amount <= 0 || amount > MAX_QUOTE_TOTAL) return { status: "stale" as const };
          lines.push({ item, expected, amount });
        }

        const org = await tx.organization.findFirstOrThrow({
          where: { id: req.organizationId! },
          select: {
            quoteNumberPrefix: true,
            quoteNextNumber: true,
            quoteValidityDays: true,
            defaultQuoteTerms: true,
            quoteTaxRate: true,
            quoteSettings: true,
          },
        });
        if (Math.round(Number(org.quoteTaxRate) * 100) / 100 !== preview.taxRate) return { status: "stale" as const };

        const totals = calculateQuoteTotals({
          lines: lines.map(({ expected, amount }) => ({
            quantity: expected.quantity,
            unitPrice: expected.unitPrice,
            amount,
          })),
          taxRate: preview.taxRate,
        });
        if (totals.total > MAX_QUOTE_TOTAL) return { status: "stale" as const };

        const lastQuote = await tx.quote.aggregate({
          where: { organizationId: req.organizationId! },
          _max: { number: true },
        });
        const number = computeNextQuoteNumber(lastQuote._max.number, org.quoteNextNumber);
        const areaSqft = lines.reduce(
          (sum, line) => sum + (normalizeMateAiUnit(line.expected.unit) === "sq_ft" ? line.expected.quantity : 0),
          0,
        );
        const quote = await tx.quote.create({
          data: {
            organizationId: req.organizationId!,
            customerId: customer.id,
            salespersonId: req.user!.id,
            number,
            quoteNumber: formatQuoteNumber(org.quoteNumberPrefix, number),
            title: "Quote for " + customer.name,
            status: "draft",
            flooringType: "hardwood",
            areaSqft: new Prisma.Decimal(areaSqft),
            taxRate: org.quoteTaxRate,
            subtotal: new Prisma.Decimal(totals.subtotal),
            taxTotal: new Prisma.Decimal(totals.taxTotal),
            total: new Prisma.Decimal(totals.total),
            validUntil: defaultValidUntil(org.quoteValidityDays),
            terms: org.defaultQuoteTerms || null,
            clientView: parseQuoteSettings(org.quoteSettings).client_view as Prisma.InputJsonValue,
            publicToken: null,
            payload: {
              source: "mate_ai",
              mate_ai_preview_id: preview.previewId,
              items: lines.map(({ item, expected }) => ({
                name: item.name,
                description: item.description || item.name,
                quantity: expected.quantity,
                unit: item.unit,
                unit_price: expected.unitPrice,
                amount: Math.round(expected.quantity * expected.unitPrice * 100) / 100,
                service_type: item.category,
                service_catalog_id: item.id,
                pricing_item_id: item.pricingItemId,
                catalog_source: item.source,
              })),
            } as Prisma.InputJsonValue,
            lineItems: {
              create: lines.map(({ item, expected, amount }, index) => ({
                organizationId: req.organizationId!,
                name: item.name,
                description: item.name + (item.description ? "\n" + item.description : ""),
                quantity: new Prisma.Decimal(expected.quantity),
                unit: item.unit,
                unitPrice: new Prisma.Decimal(expected.unitPrice),
                amount: new Prisma.Decimal(amount),
                itemType: "service",
                sortOrder: index,
                meta: {
                  service_type: item.category,
                  service_catalog_id: item.id,
                  pricing_item_id: item.pricingItemId,
                  catalog_source: item.source,
                  source: "mate_ai",
                } as Prisma.InputJsonValue,
              })),
            },
          },
          include: { customer: { select: { name: true } }, lineItems: true },
        });

        await recordActivity(tx, {
          organizationId: req.organizationId!,
          entityType: "quote",
          entityId: quote.id,
          actorType: "user",
          actorId: req.user!.id,
          action: "created",
          changes: {
            source: { from: null, to: "mate_ai" },
            status: { from: null, to: "draft" },
            previewId: { from: null, to: preview.previewId },
          },
        });

        return { status: "created" as const, quote };
      });

      if (result.status === "stale") {
        res.status(409).json({ success: false, error: "O catálogo, o cliente ou os preços mudaram. Gere e revise uma nova prévia." });
        return;
      }
      if (result.status === "already_created") {
        res.status(409).json({
          success: false,
          error: "Esta prévia já foi usada para criar um rascunho.",
          quote_id: result.quote.id,
          quote_number: result.quote.quoteNumber,
        });
        return;
      }

      res.status(201).json({
        success: true,
        data: {
          id: result.quote.id,
          quote_number: result.quote.quoteNumber,
          status: result.quote.status,
          customer_name: result.quote.customer?.name || preview.customerName,
          total: Number(result.quote.total),
          item_count: result.quote.lineItems.length,
        },
      });
    } catch (error) {
      next(error);
    }
  },
);
