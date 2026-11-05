import { describe, expect, it } from "vitest";
import { buildJobsStatus, buildQuoteSection, jobLateDays, type JobStatusRow, type QuoteRow } from "../src/lib/dashboard/overview.js";

const NOW = new Date("2026-11-05T17:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const ahead = (ms: number) => new Date(NOW.getTime() + ms);

const job = (p: Partial<JobStatusRow>): JobStatusRow => ({
  id: p.id || "j",
  number: 1,
  title: "Kitchen",
  status: "scheduled",
  sector: null,
  scheduledStart: null,
  scheduledEnd: null,
  sandScheduledStart: null,
  installationDoneAt: null,
  sandDoneAt: null,
  ...p,
});

describe("jobLateDays (same rule as the Jobs page)", () => {
  it("is null for jobs on time, without a date, or finished", () => {
    expect(jobLateDays(job({ scheduledStart: ahead(DAY) }), NOW)).toBeNull();
    expect(jobLateDays(job({ scheduledStart: null }), NOW)).toBeNull();
    expect(jobLateDays(job({ status: "completed", scheduledStart: ago(5 * DAY) }), NOW)).toBeNull();
    expect(jobLateDays(job({ status: "in_progress", scheduledStart: ago(DAY), scheduledEnd: ahead(DAY) }), NOW)).toBeNull();
  });

  it("counts days past the end for jobs that did not start or did not finish", () => {
    expect(jobLateDays(job({ scheduledStart: ago(3 * DAY), scheduledEnd: ago(3 * DAY) }), NOW)).toBe(3);
    expect(jobLateDays(job({ status: "in_progress", scheduledStart: ago(4 * DAY), scheduledEnd: ago(2 * DAY) }), NOW)).toBe(2);
  });

  it("uses the sand date once installation is done on a two-sector job", () => {
    const wo = job({ status: "in_progress", sector: "both", installationDoneAt: ago(5 * DAY), scheduledStart: ago(6 * DAY), scheduledEnd: ago(5 * DAY), sandScheduledStart: ahead(DAY) });
    expect(jobLateDays(wo, NOW)).toBeNull();
  });
});

describe("buildJobsStatus", () => {
  it("buckets active jobs and sums what is left to invoice", () => {
    const active = [
      job({ id: "field", status: "in_progress", scheduledStart: ago(DAY), scheduledEnd: ahead(DAY) }),
      job({ id: "late", scheduledStart: ago(2 * DAY), scheduledEnd: ago(2 * DAY) }),
      job({ id: "next", scheduledStart: ahead(2 * DAY) }),
      job({ id: "nodate", status: "draft" }),
    ];
    const completed = [
      job({ id: "c1", status: "completed", lineItems: [{ lineTotal: 4000 }, { lineTotal: 1000 }], invoices: [{ amount: 2000, status: "sent" }] }),
      job({ id: "c2", status: "completed", lineItems: [{ lineTotal: 900 }], invoices: [{ amount: 900, status: "paid" }] }),
      job({ id: "c3", status: "completed", lineItems: [{ lineTotal: 1200 }], invoices: [{ amount: 1200, status: "void" }] }),
    ];
    const s = buildJobsStatus(active, completed, NOW, true);
    expect(s).toMatchObject({ in_field: 1, late: 1, scheduled: 1, no_date: 1, to_invoice: { value: 4200, count: 2 } });
    expect(s.items.map((i) => [i.id, i.kind])).toEqual([
      ["late", "late"],
      ["c1", "to_invoice"],
      ["c3", "to_invoice"],
    ]);
  });

  it("hides money without invoice access", () => {
    const s = buildJobsStatus([], [job({ id: "c1", status: "completed", lineItems: [{ lineTotal: 500 }], invoices: [] })], NOW, false);
    expect(s.to_invoice).toBeNull();
    expect(s.items).toEqual([]);
  });
});

describe("quotes waiting", () => {
  const q = (p: Partial<QuoteRow>): QuoteRow => ({
    id: "q",
    number: 1,
    quoteNumber: null,
    title: "Quote",
    status: "sent",
    total: 1000,
    materialCost: 0,
    laborCost: 0,
    leadId: null,
    customerName: "Client",
    signedAt: null,
    viewedAt: null,
    validUntil: null,
    updatedAt: ago(DAY),
    createdAt: ago(DAY),
    ...p,
  });

  it("lists sent and viewed quotes oldest first, with the total in play", () => {
    const { quotes_waiting } = buildQuoteSection(
      [
        q({ id: "new", total: 3000, updatedAt: ago(1 * DAY) }),
        q({ id: "old", total: 5000, updatedAt: ago(9 * DAY), viewedAt: ago(8 * DAY) }),
        q({ id: "viewed", status: "viewed", total: 2000, updatedAt: ago(4 * DAY) }),
        q({ id: "changes", status: "changes_requested", total: 7000 }),
        q({ id: "won", status: "approved", total: 9000, signedAt: ago(DAY) }),
        q({ id: "lead-lost", total: 4000, leadId: "L", leadStatus: "lost" }),
      ],
      NOW,
      "America/Denver",
      true,
    );
    expect(quotes_waiting.count).toBe(3);
    expect(quotes_waiting.value).toBe(10000);
    expect(quotes_waiting.viewed).toBe(2);
    expect(quotes_waiting.items.map((i) => i.id)).toEqual(["old", "viewed", "new"]);
  });

  it("hides amounts without pricing access", () => {
    const { quotes_waiting } = buildQuoteSection([q({ total: 3000 })], NOW, "America/Denver", false);
    expect(quotes_waiting.value).toBeNull();
    expect(quotes_waiting.items[0].amount).toBeNull();
  });
});
