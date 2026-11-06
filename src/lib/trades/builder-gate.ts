/**
 * What the builder sees of a job's phases in ObraBuilder, and the step the builder confirms
 * (Countertops: "kitchen ready for template"). The confirmation is evidence on the company's
 * phase, so the office closes it without sending someone to check — and without a wasted trip.
 *
 * Pure helpers plus one write that runs inside the caller's tenant transaction.
 */
import type { Prisma } from "@prisma/client";
import type { TenantPrisma } from "../tenant/prisma-tenant.js";
import { asEvidence, type JobPhaseRow } from "./job-phases.js";
import type { TradePack } from "./types.js";

type Tx = TenantPrisma;

export type BuilderGateView = {
  phase: string;
  title: string;
  question: string;
  done_label: string;
  /** Builder's confirmation (or the company's own check), when there is one. */
  confirmed: { at: string; by: string | null; by_builder: boolean } | null;
  /** The company already closed the phase (nothing left for the builder). */
  phase_done: boolean;
  /** The builder can take back their own confirmation while the phase is open. */
  can_undo: boolean;
};

export type BuilderPhaseStep = { key: string; label: string; status: "done" | "current" | "next" };

const BUILDER = "builder";

function rowsByKey(rows: readonly JobPhaseRow[]) {
  return new Map(rows.map((r) => [r.phaseKey, r]));
}

/** The pack's phases as the builder reads them: done, the current one, and the ones after. */
export function builderPhaseSteps(pack: TradePack, rows: readonly JobPhaseRow[]): BuilderPhaseStep[] {
  if (pack.phaseStorage !== "table" || !rows.length) return [];
  const by = rowsByKey(rows);
  const live = pack.phases.filter((d) => by.has(d.key) && by.get(d.key)!.status !== "skipped");
  let current = false;
  return live.map((d) => {
    const done = by.get(d.key)!.status === "done";
    if (done) return { key: d.key, label: d.label["en-US"], status: "done" as const };
    if (!current) { current = true; return { key: d.key, label: d.label["en-US"], status: "current" as const }; }
    return { key: d.key, label: d.label["en-US"], status: "next" as const };
  });
}

export function builderGateView(pack: TradePack, rows: readonly JobPhaseRow[]): BuilderGateView | null {
  const g = pack.builderGate;
  if (!g || pack.phaseStorage !== "table") return null;
  const row = rows.find((r) => r.phaseKey === g.phase);
  if (!row || row.status === "skipped") return null;
  const e = asEvidence(row.evidence)[g.requirement];
  const byBuilder = Boolean(e && e.value && typeof e.value === "object" && (e.value as { source?: unknown }).source === BUILDER);
  const done = row.status === "done";
  return {
    phase: g.phase,
    title: g.title,
    question: g.question,
    done_label: g.done,
    confirmed: e ? { at: e.at, by: e.by ?? null, by_builder: byBuilder } : null,
    phase_done: done,
    can_undo: byBuilder && !done,
  };
}

export type GateResult =
  | { ok: true; view: BuilderGateView; changed: boolean }
  | { ok: false; error: "no_gate" | "phase_done" | "not_yours" };

/**
 * The builder confirms (ready = true) or takes back (ready = false) the gate. Taking back only
 * removes the builder's own confirmation, and never after the company closed the phase.
 */
export async function setBuilderGate(
  tx: Tx,
  pack: TradePack,
  workOrderId: string,
  ready: boolean,
  who: { name: string; company: string },
): Promise<GateResult> {
  const g = pack.builderGate;
  if (!g || pack.phaseStorage !== "table") return { ok: false, error: "no_gate" };
  const row = await tx.jobPhase.findUnique({ where: { workOrderId_phaseKey: { workOrderId, phaseKey: g.phase } } });
  if (!row || row.status === "skipped") return { ok: false, error: "no_gate" };
  if (row.status === "done") return { ok: false, error: "phase_done" };
  const ev = asEvidence(row.evidence);
  const cur = ev[g.requirement];
  const curByBuilder = Boolean(cur && cur.value && typeof cur.value === "object" && (cur.value as { source?: unknown }).source === BUILDER);
  let changed = false;
  if (ready && !cur) {
    ev[g.requirement] = { at: new Date().toISOString(), by: `${who.name} · ${who.company}`.slice(0, 160), value: { source: BUILDER } };
    changed = true;
  } else if (!ready && cur) {
    if (!curByBuilder) return { ok: false, error: "not_yours" };
    delete ev[g.requirement];
    changed = true;
  }
  if (changed) await tx.jobPhase.update({ where: { id: row.id }, data: { evidence: ev as Prisma.InputJsonValue } });
  const rows = await tx.jobPhase.findMany({ where: { workOrderId }, orderBy: { sortOrder: "asc" } });
  return { ok: true, view: builderGateView(pack, rows)!, changed };
}

export type NotReadyResult =
  | { ok: true; cleared: { by: string | null; at: string } | null; charged: { name: string; amount: number } | null }
  | { ok: false; error: "no_gate" | "phase_done" };

/**
 * The crew found the site not ready (cabinets not set…): the confirmation is cleared so the
 * builder has to confirm again, and — when the office records it — the trade's return-trip
 * service is added to the job at the company's builder price.
 */
export async function siteNotReady(
  tx: Tx,
  pack: TradePack,
  organizationId: string,
  workOrderId: string,
  opts: { charge: boolean },
): Promise<NotReadyResult> {
  const g = pack.builderGate;
  if (!g || pack.phaseStorage !== "table") return { ok: false, error: "no_gate" };
  const row = await tx.jobPhase.findUnique({ where: { workOrderId_phaseKey: { workOrderId, phaseKey: g.phase } } });
  if (!row || row.status === "skipped") return { ok: false, error: "no_gate" };
  if (row.status === "done") return { ok: false, error: "phase_done" };
  const ev = asEvidence(row.evidence);
  const cur = ev[g.requirement];
  let cleared: { by: string | null; at: string } | null = null;
  if (cur) {
    cleared = { by: cur.by ?? null, at: cur.at };
    delete ev[g.requirement];
    await tx.jobPhase.update({ where: { id: row.id }, data: { evidence: ev as Prisma.InputJsonValue } });
  }
  let charged: { name: string; amount: number } | null = null;
  if (opts.charge && g.tripService) {
    let item = await tx.pricingItem.findFirst({ where: { organizationId, name: { equals: g.tripService, mode: "insensitive" } }, orderBy: { active: "desc" }, select: { id: true, name: true, price: true, priceBuilder: true, active: true } });
    // The office turned the service off in the Tabela de Valores: no trip charge.
    if (item && !item.active) return { ok: true, cleared, charged: null };
    if (!item) {
      // A company set up before the trade had this service: add it unpriced, once, so the office
      // sets the value in the Tabela de Valores instead of on every job.
      const def = pack.services.find((x) => x.name.toLowerCase() === g.tripService!.toLowerCase());
      item = await tx.pricingItem.create({
        data: { organizationId, name: g.tripService, category: def?.category ?? "custom", unit: def?.unit ?? "unit", description: def?.description || null, notes: def?.description || null, price: 0, priceBuilder: 0, sortOrder: def?.sortOrder ?? 0 },
        select: { id: true, name: true, price: true, priceBuilder: true, active: true },
      });
    }
    const amount = Number(item.priceBuilder) || Number(item.price) || 0;
    const last = await tx.workOrderLineItem.findFirst({ where: { workOrderId }, orderBy: { sortOrder: "desc" }, select: { sortOrder: true } });
    await tx.workOrderLineItem.create({
      data: {
        organizationId,
        workOrderId,
        pricingItemId: item.id,
        serviceName: item.name,
        notes: `Site not ready for ${g.visit} · ${new Date().toISOString().slice(0, 10)}`,
        quantitySqft: 1,
        unitPrice: amount,
        lineTotal: amount,
        sortOrder: (last?.sortOrder ?? 0) + 1,
      },
    });
    charged = { name: item.name, amount };
  }
  return { ok: true, cleared, charged };
}

export type JobPhaseSummary = {
  /** The first open phase (pt-BR label for the CRM), or null when every phase is done. */
  key: string | null;
  label: string | null;
  /** 1-based position of the open phase among the job's live phases. */
  index: number;
  total: number;
  done: number;
  /** The builder confirmed the site for the open phase (ready to schedule the visit). */
  builder_ready: boolean;
};

/** One line for the jobs list: where the job is and whether the builder said the site is ready. */
export function jobPhaseSummary(pack: TradePack, rows: readonly JobPhaseRow[]): JobPhaseSummary | null {
  if (pack.phaseStorage !== "table" || !rows.length) return null;
  const by = rowsByKey(rows);
  const live = pack.phases.filter((d) => by.has(d.key) && by.get(d.key)!.status !== "skipped");
  if (!live.length) return null;
  const done = live.filter((d) => by.get(d.key)!.status === "done").length;
  const i = live.findIndex((d) => by.get(d.key)!.status !== "done");
  const cur = i >= 0 ? live[i]! : null;
  const gate = builderGateView(pack, rows);
  return {
    key: cur?.key ?? null,
    label: cur ? cur.label["pt-BR"] : null,
    index: i >= 0 ? i + 1 : live.length,
    total: live.length,
    done,
    builder_ready: Boolean(cur && gate && gate.phase === cur.key && gate.confirmed?.by_builder && !gate.phase_done),
  };
}
