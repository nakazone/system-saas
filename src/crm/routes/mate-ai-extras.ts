/**
 * Routes created for the Mate AI map (the screens can use them too):
 *
 *   GET/PUT /api/mate-ai/brief                  my daily brief preferences (+ ?preview=1)
 *   POST    /api/meetings/:id/send-invite       e-mail the customer/lead a calendar invite (.ics)
 *   POST    /api/chat/jobs/:workOrderId/summary what happened on a job on a day (AI summary)
 *   GET     /api/work-orders/:id/margin         revenue, labor, costs and margin of a job
 *   GET     /api/mate-ai/milestones             first approved quote / paid invoice / job done and round counts
 */
import { Router } from "express";
import { z } from "zod";
import { aiChatTurn, isAiConfigured } from "../../lib/ai/client.js";
import { sendCustomerEmail } from "../../lib/email/index.js";
import { computeInvoiceMoney } from "../../lib/invoices/core.js";
import { buildBrief, getBriefPrefs, setBriefPrefs } from "../../lib/mate-ai/daily-brief.js";
import { jobLabor } from "../../lib/mate-ai/job-economics.js";
import { dayRange, fmtDateTime, localDay, localTime } from "../../lib/mate-ai/actions/time.js";
import { prisma } from "../../lib/prisma.js";
import { buildSingleEventIcs } from "../../lib/schedule/ics.js";
import { withTenantTransaction } from "../../lib/tenant/prisma-tenant.js";
import type { AuthedRequest } from "../../middleware/auth.js";
import { requireCrmAuth, requireCrmPermission } from "../http.js";

export const mateAiExtrasRouter = Router();

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function orgOf(id: string) {
  return prisma.organization.findUniqueOrThrow({ where: { id }, select: { name: true, timezone: true, contactEmail: true, contactPhone: true } });
}

/* ───────────────────────── daily brief ───────────────────────── */

mateAiExtrasRouter.get("/api/mate-ai/brief", requireCrmAuth, async (req: AuthedRequest, res, next) => {
  try {
    const prefs = (await getBriefPrefs(req.organizationId!, req.user!.id)) || { enabled: false, hour: 7, channels: ["push"] as Array<"push" | "email">, last_sent: null };
    const out: Record<string, unknown> = { prefs };
    if (String(req.query.preview || "") === "1") {
      const org = await orgOf(req.organizationId!);
      out.preview = await buildBrief(req.organizationId!, org.timezone || "America/New_York");
    }
    res.json({ success: true, data: out });
  } catch (error) {
    next(error);
  }
});

const briefBody = z.object({ enabled: z.boolean(), hour: z.number().int().min(0).max(23).default(7), channels: z.array(z.enum(["push", "email"])).min(1).max(2).default(["push"]) });

mateAiExtrasRouter.put("/api/mate-ai/brief", requireCrmAuth, async (req: AuthedRequest, res, next) => {
  try {
    const b = briefBody.safeParse(req.body || {});
    if (!b.success) {
      res.status(400).json({ success: false, error: "Escolha a hora (0–23) e push e/ou e-mail." });
      return;
    }
    const before = await getBriefPrefs(req.organizationId!, req.user!.id);
    // Turning it on after today's hour starts tomorrow; changing the hour keeps today's state.
    await setBriefPrefs(req.organizationId!, req.user!.id, { ...b.data, last_sent: before?.last_sent ?? null });
    res.json({ success: true, data: { prefs: b.data } });
  } catch (error) {
    next(error);
  }
});

/* ───────────────────────── visit invite by e-mail ───────────────────────── */

mateAiExtrasRouter.post("/api/meetings/:id/send-invite", requireCrmAuth, requireCrmPermission("schedule.manage"), async (req: AuthedRequest, res, next) => {
  try {
    const id = String(req.params.id);
    if (!UUID.test(id)) {
      res.status(400).json({ success: false, error: "ID inválido" });
      return;
    }
    const org = await orgOf(req.organizationId!);
    const tz = org.timezone || "America/New_York";
    const row = await withTenantTransaction(req.organizationId!, (tx) =>
      tx.meeting.findFirst({ where: { id }, include: { lead: { select: { name: true, email: true } }, customer: { select: { name: true, email: true } } } }),
    );
    if (!row) {
      res.status(404).json({ success: false, error: "Compromisso não encontrado" });
      return;
    }
    if (row.status === "canceled") {
      res.status(409).json({ success: false, error: "Este compromisso foi cancelado." });
      return;
    }
    const person = row.lead || row.customer;
    const to = String(req.body?.to || person?.email || "").trim().toLowerCase();
    if (!EMAIL.test(to)) {
      res.status(422).json({ success: false, error: "Sem e-mail do cliente: informe um endereço." });
      return;
    }
    const first = (person?.name || "").split(" ")[0] || "there";
    const when = fmtDateTime(row.scheduledStart, tz, row.allDay);
    const summary = `${row.leadId ? "Visit" : "Appointment"} · ${org.name}`;
    // Customer-facing: only the time, place and contact — never internal notes or lead data.
    const ics = buildSingleEventIcs({ uid: `meeting-${row.id}@obramate.com`, summary, description: `${org.name}${org.contactPhone ? " · " + org.contactPhone : ""}`, location: row.location || undefined, start: row.scheduledStart, end: row.scheduledEnd, stamp: new Date(), status: "CONFIRMED" });
    const text = `Hi ${first},\n\nThis confirms our ${row.leadId ? "visit" : "appointment"} on ${when}${row.location ? " at " + row.location : ""}.\nThe calendar invite is attached.\n\n${org.name}${org.contactPhone ? "\n" + org.contactPhone : ""}`;
    const sent = await sendCustomerEmail({ to, subject: `${summary} — ${when}`, text, replyTo: org.contactEmail || undefined, attachments: [{ filename: "invite.ics", content: Buffer.from(ics, "utf8") }] });
    if (!sent.ok) {
      res.status(503).json({ success: false, error: sent.error });
      return;
    }
    res.json({ success: true, data: { to } });
  } catch (error) {
    next(error);
  }
});

/* ───────────────────────── job day summary (AI) ───────────────────────── */

mateAiExtrasRouter.post("/api/chat/jobs/:workOrderId/summary", requireCrmAuth, requireCrmPermission("work_orders.view"), async (req: AuthedRequest, res, next) => {
  try {
    const jobId = String(req.params.workOrderId);
    if (!UUID.test(jobId)) {
      res.status(400).json({ success: false, error: "ID inválido" });
      return;
    }
    const org = await orgOf(req.organizationId!);
    const tz = org.timezone || "America/New_York";
    const day = /^\d{4}-\d{2}-\d{2}$/.test(String(req.body?.day || "")) ? String(req.body.day) : localDay(new Date(), tz);
    const { start, end } = dayRange(day, day, tz);
    const data = await withTenantTransaction(req.organizationId!, async (tx) => {
      const job = await tx.workOrder.findFirst({ where: { id: jobId }, select: { number: true, title: true, status: true, fieldStatus: true, campoProblemNote: true, chatConversation: { select: { id: true } } } });
      if (!job) return null;
      const [messages, photos, shifts, checklist] = await Promise.all([
        job.chatConversation
          ? tx.chatMessage.findMany({ where: { conversationId: job.chatConversation.id, createdAt: { gte: start, lt: end }, hiddenAt: null }, select: { body: true, createdAt: true, author: { select: { name: true } } }, orderBy: { createdAt: "asc" }, take: 120 })
          : Promise.resolve([]),
        tx.jobMedia.findMany({ where: { workOrderId: jobId, deletedAt: null, createdAt: { gte: start, lt: end } }, select: { caption: true, stage: true, author: { select: { name: true } } }, take: 80 }),
        tx.campoShiftJob.findMany({ where: { workOrderId: jobId, shift: { workDate: { gte: new Date(day + "T00:00:00Z"), lt: new Date(day + "T23:59:59Z") } } }, select: { sqft: true, arrivedAt: true, shift: { select: { employee: { select: { name: true } }, user: { select: { name: true } } } } } }),
        tx.workOrder.findFirst({ where: { id: jobId }, select: { campoChecklist: true } }),
      ]);
      return { job, messages, photos, shifts, checklist };
    });
    if (!data) {
      res.status(404).json({ success: false, error: "Job não encontrado" });
      return;
    }
    const facts = [
      `Job ${data.job.number != null ? "#" + data.job.number + " " : ""}${data.job.title} — status ${data.job.status}, campo ${data.job.fieldStatus}.`,
      data.job.campoProblemNote ? `Problema registrado: ${data.job.campoProblemNote}` : "",
      ...data.shifts.map((s) => `Trabalhou: ${s.shift.employee?.name || s.shift.user?.name || "alguém"}${s.arrivedAt ? " (chegou " + localTime(s.arrivedAt, tz) + ")" : ""}${Number(s.sqft) ? ", " + Number(s.sqft) + " sq ft" : ""}`),
      `${data.photos.length} foto(s) no dia${data.photos.filter((p) => p.caption).length ? ": " + data.photos.filter((p) => p.caption).slice(0, 10).map((p) => p.caption).join("; ") : ""}`,
      ...data.messages.map((m) => `[${localTime(m.createdAt, tz)}] ${m.author?.name || "?"}: ${m.body.slice(0, 400)}`),
    ].filter(Boolean);
    const activity = data.messages.length + data.photos.length + data.shifts.length;
    let summary = activity ? "" : "Nada registrado neste dia: sem mensagens, fotos ou dias de trabalho.";
    let ai = false;
    if (activity && isAiConfigured()) {
      const r = await aiChatTurn({
        countUse: true,
        timeoutMs: 30_000,
        messages: [
          { role: "system", content: "You summarize a flooring job's day for the office manager, in Brazilian Portuguese, in 3–6 short bullet lines: what was done, who worked, problems or pending items, what needs the office. Use only the facts given; no greetings." },
          { role: "user", content: facts.join("\n").slice(0, 12000) },
        ],
      });
      if (r.ok && r.content?.trim()) {
        summary = r.content.trim();
        ai = true;
      }
    }
    if (!summary) summary = facts.slice(0, 12).map((f) => "• " + f).join("\n");
    res.json({ success: true, data: { day, summary, ai, counts: { messages: data.messages.length, photos: data.photos.length, workers: data.shifts.length } } });
  } catch (error) {
    next(error);
  }
});

/* ───────────────────────── job margin ───────────────────────── */

mateAiExtrasRouter.get("/api/work-orders/:id/margin", requireCrmAuth, requireCrmPermission("work_orders.view"), async (req: AuthedRequest, res, next) => {
  try {
    const id = String(req.params.id);
    if (!UUID.test(id)) {
      res.status(400).json({ success: false, error: "ID inválido" });
      return;
    }
    const canMoney = req.user!.roleKey === "admin" || ["finance.view", "payroll.view"].some((p) => req.user!.permissions.includes(p));
    if (!canMoney) {
      res.status(403).json({ success: false, error: "Sem permissão para ver custos." });
      return;
    }
    const data = await withTenantTransaction(req.organizationId!, async (tx) => {
      const job = await tx.workOrder.findFirst({ where: { id }, select: { number: true, title: true, status: true, lineItems: { select: { lineTotal: true } }, invoices: { where: { status: { not: "void" } }, select: { amount: true, status: true, dueDate: true, receipts: { select: { amount: true } } } } } });
      if (!job) return null;
      const [labor, costs, costRows] = await Promise.all([
        jobLabor(tx, id),
        tx.financeCost.aggregate({ where: { workOrderId: id, status: { not: "void" } }, _sum: { amount: true } }),
        tx.financeCost.findMany({ where: { workOrderId: id, status: { not: "void" } }, select: { description: true, amount: true, category: true }, orderBy: { amount: "desc" }, take: 10 }),
      ]);
      const sold = job.lineItems.reduce((s, l) => s + Number(l.lineTotal || 0), 0);
      const invoiced = job.invoices.reduce((s, i) => s + Number(i.amount || 0), 0);
      const received = job.invoices.reduce((s, i) => s + (computeInvoiceMoney(i).amount - computeInvoiceMoney(i).balance), 0);
      const material = Number(costs._sum.amount || 0);
      const revenue = sold || invoiced;
      const cost = labor.total + material;
      const r2 = (n: number) => Math.round(n * 100) / 100;
      return {
        job: { number: job.number, title: job.title, status: job.status },
        revenue: r2(revenue),
        invoiced: r2(invoiced),
        received: r2(received),
        labor: labor.total,
        labor_days: labor.days,
        labor_by_employee: labor.byEmployee,
        costs: r2(material),
        cost_lines: costRows.map((c) => ({ description: c.description, amount: Number(c.amount), category: c.category })),
        margin: r2(revenue - cost),
        margin_pct: revenue > 0 ? Math.round(((revenue - cost) / revenue) * 1000) / 10 : null,
      };
    });
    if (!data) {
      res.status(404).json({ success: false, error: "Job não encontrado" });
      return;
    }
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

/* ───────────────────────── milestones (the Mate celebrates once) ───────────────────────── */

const QUOTE_WON = ["approved", "converted"];
const MILESTONE_COUNTS = { jobs: [1, 10, 50, 100, 250], quotes: [1, 10, 50, 100], invoices: [1] } as const;

type Milestone = { key: string; at: string; count: number };

function can(req: AuthedRequest, perm: string) {
  return req.user!.roleKey === "admin" || req.user!.permissions.includes(perm);
}

/**
 * GET /api/mate-ai/milestones — first approved quote, first paid invoice, first job done and round counts
 * (10, 50, 100…), each with the date it was reached. The screen celebrates each one once, and only recent ones.
 * Only what the user can see: quotes.view, invoices.view, work_orders.view.
 */
mateAiExtrasRouter.get("/api/mate-ai/milestones", requireCrmAuth, async (req: AuthedRequest, res, next) => {
  try {
    const wantQuotes = can(req, "quotes.view");
    const wantInvoices = can(req, "invoices.view");
    const wantJobs = can(req, "work_orders.view");
    const out = await withTenantTransaction(req.organizationId!, async (tx) => {
      const list: Milestone[] = [];
      // the Nth row by date: one indexed query per threshold reached
      const nth = async (kind: "jobs" | "quotes" | "invoices", total: number, at: (skip: number) => Promise<Date | null>) => {
        for (const n of MILESTONE_COUNTS[kind]) {
          if (total < n) break;
          const when = await at(n - 1);
          if (when) list.push({ key: n === 1 ? `first_${kind === "jobs" ? "job_done" : kind === "quotes" ? "quote_approved" : "invoice_paid"}` : `${kind}_${n}`, at: when.toISOString(), count: n });
        }
      };
      if (wantQuotes) {
        const where = { status: { in: QUOTE_WON } };
        const total = await tx.quote.count({ where });
        await nth("quotes", total, async (skip) => {
          const q = await tx.quote.findFirst({ where, orderBy: [{ updatedAt: "asc" }, { id: "asc" }], skip, select: { signedAt: true, updatedAt: true } });
          return q ? q.signedAt || q.updatedAt : null;
        });
      }
      if (wantInvoices) {
        const where = { status: "paid", paidAt: { not: null } };
        const total = await tx.quoteInvoice.count({ where });
        await nth("invoices", total, async (skip) => {
          const i = await tx.quoteInvoice.findFirst({ where, orderBy: [{ paidAt: "asc" }, { id: "asc" }], skip, select: { paidAt: true } });
          return i?.paidAt ?? null;
        });
      }
      if (wantJobs) {
        const where = { status: "completed" };
        const total = await tx.workOrder.count({ where });
        await nth("jobs", total, async (skip) => {
          const j = await tx.workOrder.findFirst({ where, orderBy: [{ updatedAt: "asc" }, { id: "asc" }], skip, select: { updatedAt: true } });
          return j?.updatedAt ?? null;
        });
      }
      return list;
    });
    // first access: the Mate introduces himself to people who joined in the last 14 days
    const me = await prisma.user.findUnique({ where: { id: req.user!.id }, select: { createdAt: true } });
    const isAdmin = req.user!.roleKey === "admin";
    const welcome = me && Date.now() - me.createdAt.getTime() < 14 * 86_400_000 ? { since: me.createdAt.toISOString(), admin: isAdmin } : null;
    res.json({ success: true, data: { milestones: out, welcome } });
  } catch (error) {
    next(error);
  }
});
