/**
 * Clientes — números da carteira e página do cliente.
 * Junta o que já existe (jobs, quotes, faturas e recibos) por cliente; nada novo é gravado aqui.
 *
 *   GET /api/customers/overview        → lista com números por cliente + totais
 *   GET /api/customers/:id/overview    → página do cliente (jobs, quotes, faturas, endereços, atividade)
 */
import { Router } from "express";
import type { AuthedRequest } from "../../middleware/auth.js";
import { withTenantTransaction, type TenantPrisma } from "../../lib/tenant/prisma-tenant.js";
import { requireCrmAuth, dec } from "../http.js";
import { canViewPricing } from "../../lib/pricing/visibility.js";
import { formatUsPhone } from "../../lib/phone.js";

export const customersOverviewRouter = Router();

const DAY = 86400000;
const OPEN_QUOTE = new Set(["draft", "sent", "viewed", "changes_requested"]);
const WON_QUOTE = new Set(["approved", "accepted", "converted", "invoiced"]);
const ACTIVE_JOB = new Set(["scheduled", "in_progress"]);

function normType(raw: string | null | undefined): string {
  const v = String(raw || "particular").toLowerCase();
  if (v === "contractor") return "builder";
  if (v === "commercial") return "loja";
  if (v === "builder" || v === "loja" || v === "particular") return v;
  return "particular";
}

function round(n: number) {
  return Math.round(n * 100) / 100;
}

function todayStart() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function cityOf(address: string | null | undefined): string {
  // "1550 Wynkoop St, Denver, CO 80202" → "Denver"; "9 Summit Way, Louisville CO" → "Louisville"
  const parts = String(address || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length < 2) return "";
  const strip = (s: string) => s.replace(/\s+[A-Z]{2}(\s+\d{5}(-\d{4})?)?$/, "").trim();
  const last = parts[parts.length - 1];
  if (/^[A-Z]{2}(\s+\d{5}(-\d{4})?)?$/.test(last) && parts.length >= 3) return strip(parts[parts.length - 2]);
  const c = strip(last);
  return /\d/.test(c) ? "" : c;
}

type Row = {
  customerId: string;
  at: Date;
  label: string;
};

async function loadAll(tx: TenantPrisma, customerIds?: string[]) {
  const whereC = customerIds ? { id: { in: customerIds } } : {};
  const customers = await tx.customer.findMany({ where: whereC, orderBy: { createdAt: "desc" }, take: 2000 });
  const ids = customers.map((c) => c.id);
  const [jobs, quotes, invoices] = await Promise.all([
    tx.workOrder.findMany({
      where: { customerId: { in: ids } },
      select: {
        id: true,
        number: true,
        title: true,
        status: true,
        address: true,
        scheduledStart: true,
        scheduledEnd: true,
        customerId: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { createdAt: "desc" },
    }),
    tx.quote.findMany({
      where: { customerId: { in: ids } },
      select: {
        id: true,
        number: true,
        title: true,
        status: true,
        total: true,
        validUntil: true,
        viewedAt: true,
        signedAt: true,
        workOrderId: true,
        payload: true,
        customerId: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { createdAt: "desc" },
    }),
    tx.quoteInvoice.findMany({
      where: {
        OR: [
          { customerId: { in: ids } },
          { workOrder: { customerId: { in: ids } } },
          { quote: { customerId: { in: ids } } },
        ],
      },
      select: {
        id: true,
        invoiceNumber: true,
        status: true,
        amount: true,
        dueDate: true,
        issuedAt: true,
        paidAt: true,
        createdAt: true,
        updatedAt: true,
        customerId: true,
        workOrderId: true,
        quoteId: true,
        workOrder: { select: { number: true, customerId: true } },
        quote: { select: { number: true, customerId: true } },
        receipts: { select: { amount: true, paidAt: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
  ]);
  return { customers, jobs, quotes, invoices };
}

type Loaded = Awaited<ReturnType<typeof loadAll>>;

function invoiceCustomer(inv: Loaded["invoices"][number]) {
  return inv.customerId || inv.workOrder?.customerId || inv.quote?.customerId || null;
}

function invoiceMoney(inv: Loaded["invoices"][number]) {
  const amount = dec(inv.amount);
  const paid = inv.receipts.reduce((s, r) => s + dec(r.amount), 0);
  const st = String(inv.status || "draft");
  const counts = st !== "draft" && st !== "void";
  const balance = st === "paid" ? 0 : Math.max(0, amount - paid);
  const dueMs = inv.dueDate ? inv.dueDate.getTime() : null;
  const overdue = counts && balance > 0.004 && dueMs != null && dueMs < todayStart();
  const overdueDays = overdue && dueMs != null ? Math.max(1, Math.floor((todayStart() - dueMs) / DAY)) : 0;
  return { amount, paid, balance: counts ? balance : 0, counts, overdue, overdueDays };
}

function quoteLabel(q: { number: number }) {
  return `Q-${q.number}`;
}

function statsFor(data: Loaded, showMoney: boolean) {
  const byId = new Map<
    string,
    {
      jobs_total: number;
      jobs_active: number;
      quotes_total: number;
      quotes_open: number;
      quotes_open_value: number;
      quotes_won_value: number;
      invoiced: number;
      paid: number;
      open_balance: number;
      overdue_balance: number;
      overdue_days: number;
      last: Row | null;
    }
  >();
  const get = (id: string) => {
    let s = byId.get(id);
    if (!s) {
      s = {
        jobs_total: 0,
        jobs_active: 0,
        quotes_total: 0,
        quotes_open: 0,
        quotes_open_value: 0,
        quotes_won_value: 0,
        invoiced: 0,
        paid: 0,
        open_balance: 0,
        overdue_balance: 0,
        overdue_days: 0,
        last: null,
      };
      byId.set(id, s);
    }
    return s;
  };
  const touch = (id: string, at: Date | null | undefined, label: string) => {
    if (!at) return;
    const s = get(id);
    if (!s.last || at.getTime() > s.last.at.getTime()) s.last = { customerId: id, at, label };
  };
  for (const c of data.customers) touch(c.id, c.createdAt, "Cadastro");
  for (const j of data.jobs) {
    if (!j.customerId) continue;
    const s = get(j.customerId);
    s.jobs_total += 1;
    if (ACTIVE_JOB.has(j.status)) s.jobs_active += 1;
    touch(j.customerId, j.updatedAt, j.number != null ? `Job #${j.number}` : "Job");
  }
  for (const q of data.quotes) {
    if (!q.customerId) continue;
    const s = get(q.customerId);
    s.quotes_total += 1;
    const st = String(q.status || "draft");
    if (OPEN_QUOTE.has(st)) {
      s.quotes_open += 1;
      s.quotes_open_value += dec(q.total);
    }
    if (WON_QUOTE.has(st)) s.quotes_won_value += dec(q.total);
    touch(q.customerId, q.updatedAt, quoteLabel(q));
  }
  for (const inv of data.invoices) {
    const cid = invoiceCustomer(inv);
    if (!cid) continue;
    const s = get(cid);
    const m = invoiceMoney(inv);
    if (m.counts) {
      s.invoiced += m.amount;
      s.paid += m.paid;
      s.open_balance += m.balance;
      if (m.overdue) {
        s.overdue_balance += m.balance;
        s.overdue_days = Math.max(s.overdue_days, m.overdueDays);
      }
    }
    touch(cid, inv.updatedAt, inv.invoiceNumber || "Fatura");
    for (const r of inv.receipts) touch(cid, r.paidAt, `Pagamento ${inv.invoiceNumber || ""}`.trim());
  }
  const out = new Map<string, Record<string, unknown>>();
  for (const [id, s] of byId) {
    out.set(id, {
      jobs_total: s.jobs_total,
      jobs_active: s.jobs_active,
      quotes_total: s.quotes_total,
      quotes_open: s.quotes_open,
      quotes_open_value: showMoney ? round(s.quotes_open_value) : null,
      quotes_won_value: showMoney ? round(s.quotes_won_value) : null,
      invoiced: showMoney ? round(s.invoiced) : null,
      paid: showMoney ? round(s.paid) : null,
      open_balance: showMoney ? round(s.open_balance) : null,
      overdue_balance: showMoney ? round(s.overdue_balance) : null,
      overdue_days: s.overdue_days,
      last_activity_at: s.last?.at ?? null,
      last_activity_label: s.last?.label ?? null,
    });
  }
  return out;
}

function baseCustomer(c: Loaded["customers"][number]) {
  return {
    id: c.id,
    name: c.name,
    email: c.email,
    phone: formatUsPhone(c.phone),
    address: c.address,
    city: cityOf(c.address),
    customer_type: normType(c.customerType),
    pricing_mode: c.pricingMode === "custom" ? "custom" : "table",
    custom_pricing_count:
      c.customPricingRates && typeof c.customPricingRates === "object"
        ? Object.values(c.customPricingRates as Record<string, unknown>).filter((v) => Number(v) > 0).length
        : 0,
    company: c.company,
    responsible_name: c.contactName ?? null,
    notes: c.notes,
    lead_id: c.leadId,
    created_at: c.createdAt,
    updated_at: c.updatedAt,
  };
}

customersOverviewRouter.get("/api/customers/overview", requireCrmAuth, async (req: AuthedRequest, res, next) => {
  try {
    const showMoney = canViewPricing(req.user);
    const data = await withTenantTransaction(req.organizationId!, (tx) => loadAll(tx));
    const stats = statsFor(data, showMoney);
    const rows = data.customers.map((c) => ({ ...baseCustomer(c), stats: stats.get(c.id) || null }));
    const sum = (k: string) =>
      showMoney ? round(rows.reduce((s, r) => s + (Number((r.stats as Record<string, unknown> | null)?.[k]) || 0), 0)) : null;
    const byType: Record<string, { count: number; jobs_active: number; open_balance: number | null; quotes_open_value: number | null }> = {};
    for (const r of rows) {
      const t = r.customer_type;
      const st = (r.stats || {}) as Record<string, number>;
      const b = (byType[t] ||= { count: 0, jobs_active: 0, open_balance: showMoney ? 0 : null, quotes_open_value: showMoney ? 0 : null });
      b.count += 1;
      b.jobs_active += Number(st.jobs_active) || 0;
      if (showMoney) {
        b.open_balance = round((b.open_balance || 0) + (Number(st.open_balance) || 0));
        b.quotes_open_value = round((b.quotes_open_value || 0) + (Number(st.quotes_open_value) || 0));
      }
    }
    res.json({
      success: true,
      data: rows,
      summary: {
        count: rows.length,
        with_active_job: rows.filter((r) => Number((r.stats as Record<string, unknown> | null)?.jobs_active) > 0).length,
        with_balance: rows.filter((r) => Number((r.stats as Record<string, unknown> | null)?.open_balance) > 0.004).length,
        open_balance: sum("open_balance"),
        overdue_balance: sum("overdue_balance"),
        quotes_open_value: sum("quotes_open_value"),
        by_type: byType,
      },
      show_money: showMoney,
    });
  } catch (error) {
    next(error);
  }
});

const JOB_PT: Record<string, string> = {
  draft: "Rascunho",
  scheduled: "Agendado",
  in_progress: "Em andamento",
  completed: "Concluído",
  canceled: "Cancelado",
};

customersOverviewRouter.get("/api/customers/:id/overview", requireCrmAuth, async (req: AuthedRequest, res, next) => {
  try {
    const showMoney = canViewPricing(req.user);
    const id = String(req.params.id);
    const result = await withTenantTransaction(req.organizationId!, async (tx) => {
      const data = await loadAll(tx, [id]);
      const c = data.customers[0];
      if (!c) return null;
      const [properties, lead] = await Promise.all([
        tx.property.findMany({ where: { customerId: id }, orderBy: { createdAt: "asc" } }),
        c.leadId
          ? tx.lead.findFirst({
              where: { id: c.leadId },
              select: { id: true, name: true, status: true, pipelineStage: { select: { name: true } } },
            })
          : null,
      ]);
      return { data, c, properties, lead };
    });
    if (!result) {
      res.status(404).json({ success: false, error: "Cliente não encontrado" });
      return;
    }
    const { data, c, properties, lead } = result;
    const stats = statsFor(data, showMoney).get(c.id) || null;
    const m = (n: number) => (showMoney ? round(n) : null);

    const jobs = data.jobs
      .map((j) => ({
        id: j.id,
        number: j.number,
        title: j.title,
        status: j.status,
        status_label: JOB_PT[j.status] || j.status,
        address: j.address,
        scheduled_start: j.scheduledStart,
        scheduled_end: j.scheduledEnd,
        updated_at: j.updatedAt,
      }))
      .sort((a, b) => {
        const rank = (s: string) => (s === "in_progress" ? 0 : s === "scheduled" ? 1 : s === "draft" ? 2 : 3);
        return rank(a.status) - rank(b.status) || +new Date(b.updated_at) - +new Date(a.updated_at);
      });

    const quotes = data.quotes.map((q) => {
      const p = (q.payload && typeof q.payload === "object" ? q.payload : {}) as Record<string, unknown>;
      return {
        id: q.id,
        number: q.number,
        quote_number: quoteLabel(q),
        title: q.title,
        job_name: p.job_name ? String(p.job_name) : null,
        status: q.status,
        total: m(dec(q.total)),
        valid_until: q.validUntil,
        viewed_at: q.viewedAt,
        signed_at: q.signedAt,
        email_sent_at: (p.email_sent_at as string) || (p.sent_at as string) || null,
        work_order_id: q.workOrderId,
        created_at: q.createdAt,
        updated_at: q.updatedAt,
      };
    });

    const invoices = data.invoices.map((inv) => {
      const mm = invoiceMoney(inv);
      return {
        id: inv.id,
        invoice_number: inv.invoiceNumber,
        status: inv.status,
        amount: m(mm.amount),
        paid: m(mm.paid),
        balance: m(mm.balance),
        due_date: inv.dueDate,
        issued_at: inv.issuedAt,
        paid_at: inv.paidAt || (inv.receipts.length ? inv.receipts[inv.receipts.length - 1].paidAt : null),
        overdue: mm.overdue,
        overdue_days: mm.overdueDays,
        job_number: inv.workOrder?.number ?? null,
        work_order_id: inv.workOrderId,
        quote_number: inv.quote ? `Q-${inv.quote.number}` : null,
        created_at: inv.createdAt,
      };
    });

    // Endereços: cadastro + obras (jobs) + propriedades, sem repetir.
    const seen = new Set<string>();
    const addresses: Array<{ label: string; address: string; source: string }> = [];
    const add = (address: string | null | undefined, label: string, source: string) => {
      const a = String(address || "").trim();
      if (!a) return;
      const k = a.toLowerCase().replace(/[^a-z0-9]/g, "");
      if (seen.has(k)) return;
      seen.add(k);
      addresses.push({ label, address: a, source });
    };
    add(c.address, "Cadastro", "customer");
    for (const p of properties) add([p.line1, p.line2, p.city, p.state, p.postalCode].filter(Boolean).join(", "), p.label || "Endereço", "property");
    for (const j of data.jobs) add(j.address, j.number != null ? `Job #${j.number}` : j.title, "job");

    // Atividade derivada dos próprios registros (mais recentes primeiro).
    type Ev = { at: Date; kind: string; title: string; detail: string; href: string | null };
    const ev: Ev[] = [];
    ev.push({ at: c.createdAt, kind: "customer", title: "Cliente cadastrado", detail: lead ? `Veio do lead ${lead.name}` : "", href: null });
    for (const j of data.jobs) {
      const n = j.number != null ? `#${j.number}` : "";
      ev.push({ at: j.createdAt, kind: "job", title: `Job ${n} criado`.replace("  ", " "), detail: j.title, href: `job-detail.html?id=${j.id}` });
      if (j.status === "completed") ev.push({ at: j.updatedAt, kind: "job_done", title: `Job ${n} concluído`, detail: j.title, href: `job-detail.html?id=${j.id}` });
    }
    for (const q of quotes) {
      ev.push({ at: new Date(q.created_at), kind: "quote", title: `${q.quote_number} criado`, detail: q.job_name || "", href: `quote-builder.html?id=${q.id}` });
      if (q.email_sent_at) ev.push({ at: new Date(q.email_sent_at), kind: "quote_sent", title: `${q.quote_number} enviado`, detail: "", href: `quote-builder.html?id=${q.id}` });
      if (q.viewed_at) ev.push({ at: new Date(q.viewed_at), kind: "quote_viewed", title: `${q.quote_number} aberto pelo cliente`, detail: "", href: `quote-builder.html?id=${q.id}` });
      if (WON_QUOTE.has(String(q.status))) ev.push({ at: new Date(q.signed_at || q.updated_at), kind: "quote_won", title: `${q.quote_number} aprovado`, detail: q.signed_at ? "Assinado pelo cliente" : "", href: `quote-builder.html?id=${q.id}` });
    }
    for (const inv of data.invoices) {
      const n = inv.invoiceNumber || "Fatura";
      const mm = invoiceMoney(inv);
      if (inv.issuedAt) ev.push({ at: inv.issuedAt, kind: "invoice", title: `${n} enviada`, detail: showMoney ? `$${mm.amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "", href: `invoice.html?id=${inv.id}` });
      for (const r of inv.receipts) ev.push({ at: r.paidAt, kind: "payment", title: `Pagamento de ${n}`, detail: showMoney ? `$${dec(r.amount).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "", href: `invoice.html?id=${inv.id}` });
      if (mm.overdue && inv.dueDate) ev.push({ at: inv.dueDate, kind: "overdue", title: `${n} venceu`, detail: showMoney ? `$${mm.balance.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} em aberto` : "", href: `invoice.html?id=${inv.id}` });
    }
    ev.sort((a, b) => b.at.getTime() - a.at.getTime());

    res.json({
      success: true,
      data: {
        customer: baseCustomer(c),
        stats,
        lead: lead ? { id: lead.id, name: lead.name, status: lead.status, stage: lead.pipelineStage?.name ?? null } : null,
        jobs,
        quotes,
        invoices,
        addresses,
        activity: ev.slice(0, 40).map((e) => ({ ...e, at: e.at })),
        show_money: showMoney,
      },
    });
  } catch (error) {
    next(error);
  }
});
