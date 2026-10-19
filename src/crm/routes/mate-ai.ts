import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { Prisma } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { env } from "../../config/env.js";
import { recordActivity } from "../../lib/activity/record.js";
import { aiTranscribeAudio, isAiConfigured } from "../../lib/ai/client.js";
import { hasFeature } from "../../lib/features/index.js";
import { computeNewInvoiceAmount, invoiceKindLabel } from "../../lib/invoices/core.js";
import { createJobInvoice, jobBilling, jobBillingLabel } from "../../lib/invoices/job.js";
import { calculateQuoteTotals } from "../../lib/quotes/totals.js";
import { runWithTenant, withTenantTransaction, type TenantPrisma } from "../../lib/tenant/prisma-tenant.js";
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
  normalizeMateAiUnit,
  resolveCustomerUnitPrice,
  type MateAiCatalogItem,
} from "../../lib/mate-ai/command.js";
import {
  interpretMateAiCommand,
  mateAiPlanSchema,
  todayInTimezone,
  validDueDate,
  type MateAiInvoicePlan,
  type MateAiPlan,
  type MateAiQuotePlan,
} from "../../lib/mate-ai/interpret.js";
import {
  jobNumberFromQuery,
  pickBest,
  rankCustomers,
  rankJobs,
  searchPrefixes,
  similarCatalogItems,
} from "../../lib/mate-ai/match.js";

export const mateAiRouter = Router();

const PREVIEW_LIFETIME_MS = 10 * 60 * 1000;
const MAX_QUOTE_TOTAL = 9_999_999_999.99;
const QUOTE_PERMISSIONS = ["quotes.create", "customers.view", "pricing.view"];
const INVOICE_PERMISSIONS = ["invoices.view", "invoices.manage"];

const previewRequestSchema = z
  .object({
    command: z.string().trim().min(3).max(500).optional(),
    /** A plan returned by a previous preview, edited by the user's picks (customer, service, job…). */
    plan: mateAiPlanSchema.optional(),
  })
  .refine((body) => Boolean(body.command || body.plan), { message: "command or plan required" });

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

const invoiceTokenSchema = z.object({
  version: z.literal(1),
  kind: z.literal("invoice"),
  organizationId: z.string().uuid(),
  userId: z.string().uuid(),
  previewId: z.string().uuid(),
  workOrderId: z.string().uuid(),
  invoiceType: z.enum(["full", "final", "deposit", "progress", "custom"]),
  depositPct: z.number().nullable(),
  customAmount: z.number().nullable(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  amount: z.number().positive().max(MAX_QUOTE_TOTAL),
  servicesTotal: z.number(),
  invoicedTotal: z.number(),
  expiresAt: z.number().int().positive(),
});

type PreviewToken = z.infer<typeof previewTokenSchema>;
type InvoiceToken = z.infer<typeof invoiceTokenSchema>;

function descriptionHash(value: string | null): string {
  return createHash("sha256").update(value || "").digest("hex");
}

function signToken(payload: PreviewToken | InvoiceToken): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", env.SESSION_SECRET).update(body).digest("base64url");
  return body + "." + signature;
}

function verifySigned<T>(token: string, schema: z.ZodType<T>): T | null {
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
    const parsed = schema.safeParse(JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")));
    if (!parsed.success) return null;
    const data = parsed.data as T & { expiresAt: number };
    if (data.expiresAt <= Date.now()) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

export function verifyMateAiPreviewToken(token: string): PreviewToken | null {
  return verifySigned(token, previewTokenSchema);
}

function hasPermissions(req: AuthedRequest, keys: string[]): boolean {
  if (!req.user) return false;
  if (req.user.roleKey === "admin") return true;
  return keys.every((key) => req.user!.permissions.includes(key));
}

function messageForParseError(error: unknown): string {
  const key = error instanceof Error ? error.message : String(error || "");
  const messages: Record<string, string> = {
    command_length: "Use um comando entre 5 e 500 caracteres.",
    customer_missing: "Inclua o cliente no comando, por exemplo: “Quote para Maria Silva com 500 sqft de Carpet Removal”.",
    items_missing: "Inclua pelo menos um serviço com quantidade e unidade, como 500 sqft.",
    service_missing: "Não consegui identificar um serviço em uma das medidas.",
    quantity_invalid: "A quantidade precisa ser maior que zero e menor que 1.000.000.",
    quantity_precision: "Use no máximo duas casas decimais para a quantidade.",
    unit_unsupported: "Unidade não suportada. Use sq ft, linear ft, fixed, each, box, step ou hour.",
    too_many_items: "O Mate AI aceita até 8 serviços por Quote.",
  };
  if (messages[key]) return messages[key]!;
  if (/^[a-z_]+$/.test(key)) return "Não consegui entender o comando. Confira cliente, serviço, quantidade e unidade.";
  return key || "Não consegui entender o comando.";
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

/* ───────────────────────── shared loaders ───────────────────────── */

async function loadCatalog(tx: TenantPrisma, organizationId: string): Promise<MateAiCatalogItem[]> {
  const [quoteCatalogRows, pricingRows] = await Promise.all([
    tx.quoteCatalogItem.findMany({
      where: { organizationId, active: true },
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
      where: { organizationId, active: true, isVisible: true },
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
  return mergeMateAiCatalog(quoteCatalogRows, pricingRows);
}

function catalogOption(item: MateAiCatalogItem) {
  return {
    id: item.id,
    source: item.source,
    name: item.name,
    unit: normalizeMateAiUnit(item.unit) || item.unit,
    category: item.category,
  };
}

const customerSelect = {
  id: true,
  name: true,
  company: true,
  customerType: true,
  pricingMode: true,
  customPricingRates: true,
} as const;

/* ───────────────────────── quote preview ───────────────────────── */

type Issue = {
  line: number;
  code: string;
  message: string;
  /** Legacy: names only. */
  suggestions?: string[];
  /** Tappable choices for the UI. */
  options?: ReturnType<typeof catalogOption>[];
};

async function previewQuote(req: AuthedRequest, tx: TenantPrisma, plan: MateAiQuotePlan, catalogItems: MateAiCatalogItem[]) {
  const organizationId = req.organizationId!;

  // 1) Customer — chosen id, or fuzzy match on what was said.
  let customer = plan.customer_id
    ? await tx.customer.findFirst({ where: { id: plan.customer_id, organizationId }, select: customerSelect })
    : null;
  if (!customer) {
    const query = plan.customer_query.trim();
    if (!query) {
      return { status: "customer_missing" as const, plan, candidates: [], message: "Para qual cliente é o Quote?" };
    }
    const prefixes = searchPrefixes(query);
    const rows = await tx.customer.findMany({
      where: {
        organizationId,
        OR: [
          { name: { contains: query, mode: "insensitive" } },
          { company: { contains: query, mode: "insensitive" } },
          ...prefixes.flatMap((prefix) => [
            { name: { contains: prefix, mode: "insensitive" as const } },
            { company: { contains: prefix, mode: "insensitive" as const } },
          ]),
        ],
      },
      select: customerSelect,
      orderBy: { updatedAt: "desc" },
      take: 300,
    });
    const pick = pickBest(rankCustomers(query, rows));
    if (pick.status !== "matched") {
      return {
        status: pick.status === "ambiguous" ? ("customer_ambiguous" as const) : ("customer_not_found" as const),
        plan,
        candidates: pick.candidates.map(({ item }) => ({ id: item.id, name: item.name, company: item.company })),
        message:
          pick.status === "ambiguous"
            ? "Encontrei mais de um cliente parecido com “" + query + "”. Qual deles?"
            : pick.candidates.length
              ? "Não achei exatamente “" + query + "”. É algum destes?"
              : "Não encontrei “" + query + "” nos clientes desta empresa. Confira o nome ou cadastre o cliente.",
      };
    }
    customer = pick.item;
  }

  const resolvedPlan: MateAiQuotePlan = { ...plan, customer_id: customer.id, customer_query: customer.name, items: [...plan.items] };

  // 2) Services — the AI's catalog pick, or lexical match on what was said.
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
    spoken: string;
  }> = [];
  const issues: Issue[] = [];

  for (let index = 0; index < plan.items.length; index++) {
    const spec = plan.items[index]!;
    const said = spec.service_text || "serviço " + (index + 1);
    let item: MateAiCatalogItem | undefined;

    if (spec.catalog_item_id) {
      item = catalogItems.find(
        (candidate) => candidate.id === spec.catalog_item_id && (!spec.catalog_source || candidate.source === spec.catalog_source),
      );
    }
    if (!item && spec.service_text) {
      const lexical = spec.unit ? matchPricingService(spec.service_text, spec.unit, catalogItems) : { status: "not_found" as const };
      if (lexical.status === "matched") item = lexical.item;
      else if (lexical.status === "ambiguous") {
        issues.push({
          line: index + 1,
          code: "service_ambiguous",
          message: "Qual serviço do catálogo é “" + said + "”?",
          suggestions: lexical.items.map((option) => option.name),
          options: lexical.items.map(catalogOption),
        });
        continue;
      }
    }
    if (!item) {
      const options = similarCatalogItems(spec.service_text, catalogItems);
      const sameUnit = spec.unit ? catalogItems.filter((c) => normalizeMateAiUnit(c.unit) === spec.unit) : [];
      const offered = options.length ? options : sameUnit.slice(0, 8);
      issues.push({
        line: index + 1,
        code: "service_not_found",
        message: "Não encontrei no catálogo um serviço para “" + said + "”" + (spec.unit ? " (" + spec.unit + ")" : "") + ". Escolha um:",
        suggestions: offered.map((option) => option.name),
        options: offered.map(catalogOption),
      });
      continue;
    }

    const itemUnit = normalizeMateAiUnit(item.unit) || item.unit;
    if (spec.unit && itemUnit !== spec.unit) {
      const sameUnit = similarCatalogItems(spec.service_text || item.name, catalogItems, 12).filter(
        (c) => normalizeMateAiUnit(c.unit) === spec.unit,
      );
      const offered = [item, ...sameUnit.filter((c) => c.id !== item!.id)].slice(0, 6);
      issues.push({
        line: index + 1,
        code: "unit_mismatch",
        message:
          "“" + item.name + "” é cobrado em " + itemUnit + ", mas você disse " + spec.quantity + " " + spec.unit +
          ". Confirme o serviço (a quantidade será usada na unidade do catálogo):",
        suggestions: offered.map((option) => option.name),
        options: offered.map(catalogOption),
      });
      continue;
    }

    resolvedPlan.items[index] = {
      ...spec,
      catalog_item_id: item.id,
      catalog_source: item.source,
      unit: (itemUnit as MateAiQuotePlan["items"][number]["unit"]) ?? null,
    };

    const rate = resolveCustomerUnitPrice(item, customer);
    const price = priceForPreview(rate, spec.quantity);
    if (!price) {
      issues.push({
        line: index + 1,
        code: "price_missing",
        message: "Não há um preço positivo configurado para “" + item.name + "” neste cliente.",
      });
      continue;
    }
    lines.push({
      catalogItemId: item.id,
      catalogSource: item.source,
      pricingItemId: item.pricingItemId,
      name: item.name,
      category: item.category,
      unit: item.unit,
      description: item.description,
      quantity: spec.quantity,
      unitPrice: price.unitPrice,
      amount: price.amount,
      spoken: said,
    });
  }

  const customerOut = { id: customer.id, name: customer.name, company: customer.company };
  if (issues.length) return { status: "needs_clarification" as const, plan: resolvedPlan, customer: customerOut, issues };

  const org = await tx.organization.findFirstOrThrow({
    where: { id: organizationId },
    select: { quoteTaxRate: true },
  });
  const taxRate = Number(org.quoteTaxRate);
  const totals = calculateQuoteTotals({
    lines: lines.map((line) => ({ quantity: line.quantity, unitPrice: line.unitPrice, amount: line.amount })),
    taxRate,
  });
  if (totals.total > MAX_QUOTE_TOTAL) {
    return {
      status: "needs_clarification" as const,
      plan: resolvedPlan,
      customer: customerOut,
      issues: [{ line: 0, code: "total_too_large", message: "O total excede o limite permitido para um Quote." }],
    };
  }

  const previewId = randomUUID();
  const tokenPayload: PreviewToken = {
    version: 1,
    organizationId,
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
    organizationId,
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
    plan: resolvedPlan,
    previewId,
    previewToken: signToken(tokenPayload),
    expiresAt: new Date(tokenPayload.expiresAt).toISOString(),
    customer: customerOut,
    lines,
    totals,
    taxRate,
  };
}

/* ───────────────────────── invoice preview ───────────────────────── */

const jobSelect = {
  id: true,
  number: true,
  title: true,
  address: true,
  status: true,
  sourceName: true,
  scheduledStart: true,
  updatedAt: true,
  customerId: true,
  builderId: true,
  customer: { select: { id: true, name: true, company: true } },
  builder: { select: { firstName: true, lastName: true, company: true } },
  lineItems: { select: { serviceName: true, quantitySqft: true, unitPrice: true, lineTotal: true }, orderBy: { sortOrder: "asc" as const } },
  invoices: { select: { amount: true, status: true, receipts: { select: { amount: true } } } },
} as const;

type JobRow = Prisma.WorkOrderGetPayload<{ select: typeof jobSelect }>;

function builderName(job: JobRow): string | null {
  if (!job.builder) return null;
  const person = [job.builder.firstName, job.builder.lastName].filter(Boolean).join(" ").trim();
  return job.builder.company ? (person ? person + " · " + job.builder.company : job.builder.company) : person || null;
}

function jobSummary(job: JobRow) {
  const servicesTotal = job.lineItems.reduce((sum, line) => sum + Number(line.lineTotal), 0);
  const billing = jobBilling(servicesTotal, job.invoices);
  return {
    id: job.id,
    number: job.number,
    title: job.title,
    address: job.address,
    status: job.status,
    customer_name: job.customer?.name || builderName(job) || job.sourceName || null,
    scheduled_start: job.scheduledStart,
    billing: { ...billing, billing_status_label: jobBillingLabel(billing.billing_status) },
  };
}

async function previewInvoice(req: AuthedRequest, tx: TenantPrisma, plan: MateAiInvoicePlan, today: string) {
  const organizationId = req.organizationId!;
  let job: JobRow | null = plan.job_id
    ? await tx.workOrder.findFirst({ where: { id: plan.job_id, organizationId }, select: jobSelect })
    : null;

  if (!job) {
    const number = jobNumberFromQuery(plan.job_query);
    if (number != null) {
      job = await tx.workOrder.findFirst({ where: { organizationId, number }, select: jobSelect });
    }
  }

  if (!job) {
    const rows = await tx.workOrder.findMany({
      where: { organizationId },
      select: jobSelect,
      orderBy: { updatedAt: "desc" },
      take: 400,
    });
    const ranked = rankJobs(
      plan.job_query,
      plan.customer_query || null,
      rows.map((row) => ({
        ...row,
        customerName: [row.customer?.name, row.customer?.company].filter(Boolean).join(" "),
        builderName: builderName(row),
      })),
    );
    let pick = pickBest(ranked, { min: 50, margin: 10 });
    // Several jobs for the same customer: prefer the only one that still has something to invoice.
    if (pick.status === "ambiguous") {
      const open = pick.candidates.filter(({ item }) => jobSummary(item).billing.remaining_to_invoice > 0);
      if (open.length === 1) pick = { status: "matched", item: open[0]!.item, score: open[0]!.score };
    }
    if (pick.status !== "matched") {
      const label = plan.job_query || plan.customer_query;
      return {
        status: pick.status === "ambiguous" ? ("job_ambiguous" as const) : ("job_not_found" as const),
        plan,
        candidates: pick.candidates.map(({ item }) => jobSummary(item)),
        message:
          pick.status === "ambiguous"
            ? "Encontrei mais de um job para “" + label + "”. Qual deles devo faturar?"
            : pick.candidates.length
              ? "Não achei exatamente “" + label + "”. É algum destes jobs?"
              : "Não encontrei um job para “" + label + "”. Diga o número do job (ex.: “job 1042”).",
      };
    }
    job = pick.item;
  }

  const summary = jobSummary(job);
  const resolvedPlan: MateAiInvoicePlan = { ...plan, job_id: job.id };
  const invoiceType =
    plan.invoice_type === "auto" ? (summary.billing.invoiced_total > 0 ? "final" : "full") : plan.invoice_type;
  const dueDate = plan.due_date ? validDueDate(plan.due_date, today) : null;
  if (plan.due_date && !dueDate) {
    return { status: "needs_clarification" as const, plan: resolvedPlan, job: summary, message: "A data de vencimento não é válida." };
  }

  if (job.status === "canceled") {
    return { status: "needs_clarification" as const, plan: resolvedPlan, job: summary, message: "Este job está cancelado e não pode ser faturado." };
  }
  if (!job.customerId && !job.builderId) {
    return {
      status: "needs_clarification" as const,
      plan: resolvedPlan,
      job: summary,
      message: "Escolha o cliente ou o builder do job antes de faturar.",
    };
  }

  const calc = computeNewInvoiceAmount({
    kind: invoiceType,
    quoteTotal: summary.billing.services_total,
    invoicedTotal: summary.billing.invoiced_total,
    depositPct: plan.deposit_pct ?? null,
    customAmount: plan.custom_amount ?? null,
    source: "job",
  });
  if (!calc.ok) {
    return { status: "needs_clarification" as const, plan: { ...resolvedPlan, invoice_type: invoiceType }, job: summary, message: calc.error };
  }

  const previewId = randomUUID();
  const token: InvoiceToken = {
    version: 1,
    kind: "invoice",
    organizationId,
    userId: req.user!.id,
    previewId,
    workOrderId: job.id,
    invoiceType,
    depositPct: plan.deposit_pct ?? null,
    customAmount: plan.custom_amount ?? null,
    dueDate,
    amount: calc.amount,
    servicesTotal: summary.billing.services_total,
    invoicedTotal: summary.billing.invoiced_total,
    expiresAt: Date.now() + PREVIEW_LIFETIME_MS,
  };

  return {
    status: "ready" as const,
    plan: { ...resolvedPlan, invoice_type: invoiceType, due_date: dueDate },
    job: summary,
    lines: job.lineItems.map((line) => ({
      name: line.serviceName,
      quantity: Number(line.quantitySqft),
      unit_price: Number(line.unitPrice),
      amount: Number(line.lineTotal),
    })),
    invoice: {
      type: calc.kind,
      type_label: invoiceKindLabel(calc.kind, "pt"),
      label: calc.label,
      amount: calc.amount,
      due_date: dueDate,
      due_date_is_default: !dueDate,
    },
    previewId,
    previewToken: signToken(token),
    expiresAt: new Date(token.expiresAt).toISOString(),
  };
}

/* ───────────────────────── routes ───────────────────────── */

mateAiRouter.post(
  "/api/mate-ai/preview",
  requireCrmAuth,
  async (req: AuthedRequest, res, next) => {
    try {
      const body = previewRequestSchema.safeParse(req.body || {});
      if (!body.success) {
        res.status(400).json({ success: false, error: "Comando inválido", details: body.error.flatten() });
        return;
      }
      const organizationId = req.organizationId!;

      const context = await withTenantTransaction(organizationId, async (tx) => {
        const org = await tx.organization.findFirstOrThrow({ where: { id: organizationId }, select: { timezone: true } });
        const catalog = await loadCatalog(tx, organizationId);
        return { timezone: org.timezone || "America/New_York", catalog };
      });
      const today = todayInTimezone(context.timezone).date;

      let plan: MateAiPlan;
      let interpretedBy: "ai" | "rules" | "plan" = "plan";
      let warning: string | undefined;
      if (body.data.plan) {
        plan = body.data.plan;
      } else {
        // Run the interpreter inside the tenant context so AI usage is counted for this company.
        const interpreted = await runWithTenant(organizationId, () =>
          interpretMateAiCommand(body.data.command!, { timezone: context.timezone, catalog: context.catalog }),
        );
        if (!interpreted.ok) {
          res.status(422).json({ success: false, error: messageForParseError(interpreted.error), interpreted_by: interpreted.source });
          return;
        }
        plan = interpreted.plan;
        interpretedBy = interpreted.source;
        warning = interpreted.warning;
      }

      const needed = plan.action === "quote" ? QUOTE_PERMISSIONS : INVOICE_PERMISSIONS;
      if (!hasPermissions(req, needed)) {
        res.status(403).json({
          success: false,
          error: plan.action === "quote" ? "Você não tem permissão para criar Quotes." : "Você não tem permissão para emitir invoices.",
          missing: needed.filter((key) => !req.user!.permissions.includes(key)),
        });
        return;
      }

      const base = { success: true, action: plan.action, interpreted_by: interpretedBy, ...(warning ? { warning } : {}) };

      if (plan.action === "invoice") {
        const invoicePlan = plan;
        const result = await withTenantTransaction(organizationId, (tx) => previewInvoice(req, tx, invoicePlan, today));
        if (result.status !== "ready") {
          res.json({ ...base, ...result });
          return;
        }
        res.json({
          ...base,
          status: "ready",
          plan: result.plan,
          job: result.job,
          lines: result.lines,
          invoice: result.invoice,
          preview_id: result.previewId,
          preview_token: result.previewToken,
          expires_at: result.expiresAt,
        });
        return;
      }

      const quotePlan = plan;
      const resolved = await withTenantTransaction(organizationId, (tx) => previewQuote(req, tx, quotePlan, context.catalog));
      if (resolved.status !== "ready") {
        res.json({
          ...base,
          ...resolved,
          customer_query: quotePlan.customer_query,
          catalog: resolved.status === "needs_clarification" ? context.catalog.map(catalogOption) : undefined,
        });
        return;
      }

      res.json({
        ...base,
        status: resolved.status,
        plan: resolved.plan,
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

/**
 * Audio data URLs from MediaRecorder carry codec parameters
 * ("data:audio/webm;codecs=opus;base64,…"), which the generic attachment parser rejects.
 */
export function parseAudioDataUrl(dataUrl: string): { contentType: string; body: Buffer } | null {
  const m = /^data:([a-z0-9.+-]+\/[a-z0-9.+-]+)((?:;[^;,]*)*?);base64,([A-Za-z0-9+/=_-]+)$/i.exec(String(dataUrl || "").trim());
  if (!m || !/^audio\//i.test(m[1]!)) return null;
  try {
    const body = Buffer.from(m[3]!, "base64");
    return body.length ? { contentType: m[1]!.toLowerCase(), body } : null;
  } catch {
    return null;
  }
}

async function serverVoiceStatus(organizationId: string): Promise<{ ok: boolean; reason?: string }> {
  if (!isAiConfigured()) return { ok: false, reason: "not_configured" };
  try {
    if (!(await hasFeature(organizationId, "ai"))) return { ok: false, reason: "plan" };
  } catch {
    // Feature lookup problems should not hide the voice button.
  }
  return { ok: true };
}

mateAiRouter.get("/api/mate-ai/status", requireCrmAuth, async (req: AuthedRequest, res, next) => {
  try {
    const voice = await serverVoiceStatus(req.organizationId!);
    res.json({ success: true, ai: isAiConfigured(), server_voice: voice.ok, reason: voice.reason || null });
  } catch (error) {
    next(error);
  }
});

/**
 * Server-side transcription. Biased with the company's service and customer names so
 * "Hardwood", "Sand & Finish" and customer names come out spelled like in the CRM.
 */
mateAiRouter.post(
  "/api/mate-ai/transcribe",
  requireCrmAuth,
  async (req: AuthedRequest, res, next) => {
    try {
      const voice = await serverVoiceStatus(req.organizationId!);
      if (!voice.ok) {
        res.status(503).json({ success: false, error: "Transcrição no servidor indisponível.", fallback: "browser", reason: voice.reason });
        return;
      }
      const raw = (req.body || {}) as Record<string, unknown>;
      const parsed = parseAudioDataUrl(String(raw.data_url || ""));
      if (!parsed) {
        res.status(400).json({ success: false, error: "Envie o áudio gravado." });
        return;
      }
      if (parsed.body.length > 8 * 1024 * 1024) {
        res.status(400).json({ success: false, error: "Áudio muito longo (máx. 8 MB)." });
        return;
      }
      const organizationId = req.organizationId!;
      const vocabulary = await withTenantTransaction(organizationId, async (tx) => {
        const [catalog, customers] = await Promise.all([
          loadCatalog(tx, organizationId),
          tx.customer.findMany({ where: { organizationId }, select: { name: true }, orderBy: { updatedAt: "desc" }, take: 40 }),
        ]);
        return [...new Set([...catalog.map((c) => c.name), ...customers.map((c) => c.name)])];
      });
      const prompt = ("ObraMate, Quote, invoice, sqft, " + vocabulary.join(", ")).slice(0, 900);
      const language = ["pt", "en", "es"].includes(String(raw.language)) ? String(raw.language) : undefined;

      const result = await runWithTenant(organizationId, () =>
        aiTranscribeAudio({ body: parsed.body, contentType: parsed.contentType, language, prompt }),
      );
      if (!result.ok) {
        res.status(502).json({ success: false, error: result.error, fallback: "browser" });
        return;
      }
      res.json({ success: true, text: result.text.slice(0, 500) });
    } catch (error) {
      next(error);
    }
  },
);

mateAiRouter.post(
  "/api/mate-ai/invoices",
  requireCrmAuth,
  requireCrmPermission(...INVOICE_PERMISSIONS),
  async (req: AuthedRequest, res, next) => {
    try {
      const body = createDraftRequestSchema.safeParse(req.body || {});
      if (!body.success) {
        res.status(400).json({ success: false, error: "Confirme a revisão antes de emitir a invoice." });
        return;
      }
      const preview = verifySigned(body.data.preview_token, invoiceTokenSchema);
      if (!preview || preview.organizationId !== req.organizationId || preview.userId !== req.user!.id) {
        res.status(400).json({ success: false, error: "A prévia expirou ou não pertence a esta sessão. Gere uma nova prévia." });
        return;
      }

      const result = await withTenantTransaction(req.organizationId!, async (tx) => {
        await tx.$queryRawUnsafe("SELECT pg_advisory_xact_lock(hashtext($1))::text AS locked", preview.previewId);
        const already = await tx.quoteInvoice.findFirst({
          where: { organizationId: req.organizationId!, payload: { path: ["mate_ai_preview_id"], equals: preview.previewId } },
          select: { id: true, invoiceNumber: true },
        });
        if (already) return { status: "already_created" as const, invoice: already };

        // Re-check the money position: if anything was invoiced or changed since the preview, start over.
        const job = await tx.workOrder.findFirst({
          where: { id: preview.workOrderId, organizationId: req.organizationId! },
          select: jobSelect,
        });
        if (!job) return { status: "stale" as const };
        const billing = jobSummary(job).billing;
        if (billing.services_total !== preview.servicesTotal || billing.invoiced_total !== preview.invoicedTotal) {
          return { status: "stale" as const };
        }

        const created = await createJobInvoice(tx, {
          organizationId: req.organizationId!,
          workOrderId: preview.workOrderId,
          actorId: req.user!.id,
          kind: preview.invoiceType,
          depositPct: preview.depositPct,
          customAmount: preview.customAmount,
          dueDate: preview.dueDate ? new Date(preview.dueDate + "T12:00:00.000Z") : null,
        });
        if (!created.ok) return { status: "failed" as const, httpStatus: created.status, error: created.error };
        if (Math.round(created.invoice.amount * 100) !== Math.round(preview.amount * 100)) {
          throw Object.assign(new Error("amount_changed"), { mateAiStale: true });
        }
        await tx.quoteInvoice.update({
          where: { id: created.invoice.id },
          data: { payload: { source: "mate_ai", mate_ai_preview_id: preview.previewId } as Prisma.InputJsonValue },
        });
        return { status: "created" as const, invoice: created.invoice, billing: created.billing };
      }).catch((error: unknown) => {
        if ((error as { mateAiStale?: boolean })?.mateAiStale) return { status: "stale" as const };
        throw error;
      });

      if (result.status === "stale") {
        res.status(409).json({ success: false, error: "Os valores do job mudaram. Gere e revise uma nova prévia." });
        return;
      }
      if (result.status === "already_created") {
        res.status(409).json({
          success: false,
          error: "Esta prévia já foi usada para emitir uma invoice.",
          invoice_id: result.invoice.id,
          invoice_number: result.invoice.invoiceNumber,
        });
        return;
      }
      if (result.status === "failed") {
        res.status(result.httpStatus).json({ success: false, error: result.error });
        return;
      }
      res.status(201).json({
        success: true,
        data: {
          id: result.invoice.id,
          invoice_number: result.invoice.invoiceNumber,
          invoice_type: result.invoice.invoiceType,
          status: result.invoice.status,
          amount: Number(result.invoice.amount),
          due_date: result.invoice.dueDate,
        },
        url: "invoice.html?id=" + encodeURIComponent(result.invoice.id),
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
        await tx.$queryRawUnsafe("SELECT pg_advisory_xact_lock(hashtext($1))::text AS locked", preview.previewId);
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
