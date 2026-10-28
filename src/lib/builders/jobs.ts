import type { TenantPrisma } from "../tenant/prisma-tenant.js";
import { intakeItemsSchema } from "../partner-intake/extract.js";
import { safeTimeZone, zonedWallTimeToUtc } from "../time/zoned.js";

type IntakeLine = {
  area: string;
  description: string;
  detail: string;
  quantity: number;
  uom: string;
  rate: number | null;
  total: number | null;
  pricing_item_id: string | null;
  service_name: string;
  create_service: boolean;
};

/** Order units → the unit names the company's price list uses. */
const UOM_TO_CATALOG: Record<string, string> = { SF: "sq ft", LF: "linear ft", EA: "unit", STEP: "step", SY: "sq yd", HR: "hour" };

function unitKey(unit: string | null | undefined): string {
  return String(unit || "sq_ft").trim().toLowerCase().replace(/\s+/g, "_");
}

/** Where the crew picks up the material (from the order), if the builder kept it. */
export function intakePickup(intake: unknown): string {
  if (!intake || typeof intake !== "object") return "";
  return String((intake as { pickup?: unknown }).pickup ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
}

type MeasuredLine = { kind: string; text: string; qty: number; uom: string };

/** The builder's measurement that came with the request (text for notes + grouped pieces). */
export function intakeMeasurement(intake: unknown): { text: string; lines: MeasuredLine[] } | null {
  if (!intake || typeof intake !== "object") return null;
  const i = intake as { measurement_text?: unknown; measurement_lines?: unknown };
  const text = String(i.measurement_text ?? "").trim();
  if (!text) return null;
  const lines = Array.isArray(i.measurement_lines)
    ? (i.measurement_lines as MeasuredLine[]).filter((l) => l && typeof l.text === "string").slice(0, 80)
    : [];
  return { text: text.slice(0, 4000), lines };
}

/** Measured sizes that belong to an order line (treads to the tread line, vents to the vent line…). */
export function measuredFor(line: { description: string; detail: string; service_name?: string }, lines: MeasuredLine[]): string {
  const t = `${line.description} ${line.detail} ${line.service_name || ""}`.toLowerCase();
  const kind = /\briser/.test(t) ? "riser" : /\btread|\bstair/.test(t) ? "tread" : /nos(e|ing)/.test(t) ? "nosing" : /\bvent/.test(t) ? "vent" : "";
  if (!kind) return "";
  let pick = lines.filter((l) => l.kind === kind);
  // A line that names its width ("48\" tread") only gets the pieces of that width.
  const width = /(\d{2,3}(?:\.\d+)?)\s*(?:"|”|''|in\b|inch)/i.exec(`${line.description} ${line.detail}`)?.[1];
  if (width && (kind === "tread" || kind === "riser")) {
    const same = pick.filter((l) => new RegExp(`(^|\\s)${width.replace(".", "\\.")}\\D?\\s*×`).test(l.text));
    if (same.length) pick = same;
  }
  if (!pick.length) return "";
  return `Measured: ${pick.map((l) => `${l.text.replace(/^.*? · (Tread|Riser|Nosing) /, "")} (${l.qty})`).join("; ")}`;
}

/** Lines the builder confirmed in the portal (stored on the request's intake). */
export function intakeLines(intake: unknown): IntakeLine[] {
  if (!intake || typeof intake !== "object") return [];
  const parsed = intakeItemsSchema.safeParse((intake as { items?: unknown }).items);
  return parsed.success ? parsed.data.filter((l) => l.description || l.detail) : [];
}

const UOM_UNITS: Record<string, string[]> = {
  SF: ["sq_ft", "sqft", "sf", "square_feet"],
  LF: ["linear_ft", "lf", "lin_ft", "linear_feet"],
  EA: ["each", "unit", "units", "ea", "piece", "fixed"],
  STEP: ["step", "stair", "tread"],
  SY: ["sq_yd", "sy"],
  HR: ["hour", "hr"],
};

function words(text: string): string[] {
  return String(text || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").split(" ").filter((w) => w.length > 1);
}

/** A price-list item whose name is fully inside the line text and whose unit matches. */
export function matchPricingItem(line: { description: string; detail: string; uom: string }, items: Array<{ id: string; name: string; unit: string }>) {
  const hay = new Set(words(`${line.description} ${line.detail}`));
  const units = UOM_UNITS[line.uom.toUpperCase()] || [line.uom.toLowerCase()];
  let best: { id: string; name: string; unit: string } | null = null;
  let bestLen = 0;
  for (const it of items) {
    const w = words(it.name);
    if (w.length < 2 || !w.every((x) => hay.has(x))) continue;
    if (!units.includes(unitKey(it.unit))) continue;
    if (w.length > bestLen) { best = it; bestLen = w.length; }
  }
  return best;
}

function lineName(l: IntakeLine): string {
  const desc = l.description.replace(/\s+/g, " ").trim();
  const detail = l.detail.replace(/\s+/g, " ").trim();
  return [desc, detail && detail.toLowerCase() !== desc.toLowerCase() ? detail : ""].filter(Boolean).join(" · ").slice(0, 160) || "Serviço";
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Creates the job's service lines from the work order lines (rates are the ones on the order). */
async function createJobLines(tx: TenantPrisma, organizationId: string, workOrderId: string, lines: IntakeLine[], source: string, measured: MeasuredLine[] = []): Promise<void> {
  if (!lines.length) return;
  const priceList = await tx.pricingItem.findMany({ where: { organizationId, active: true }, select: { id: true, name: true, unit: true } });
  let order = 0;
  for (const l of lines) {
    // The service the builder linked in the portal wins; then a name + unit match; then the
    // service is added to the company's price list so the job arrives fully filled in.
    let linked = l.pricing_item_id ? priceList.find((p) => p.id === l.pricing_item_id) || null : null;
    if (!linked) linked = matchPricingItem(l, priceList);
    if (!linked && l.create_service) {
      const name = (l.service_name || lineName(l)).replace(/\s+/g, " ").trim().slice(0, 120);
      linked = priceList.find((p) => p.name.trim().toLowerCase() === name.toLowerCase()) || null;
      if (!linked) {
        const rate = l.rate ?? (l.total != null && l.quantity ? round2(l.total / l.quantity) : 0);
        const created = await tx.pricingItem.create({
          data: {
            organizationId,
            name,
            category: "installation",
            unit: UOM_TO_CATALOG[l.uom.toUpperCase()] || "unit",
            price: rate,
            priceMin: 0,
            priceMax: 0,
            partnerPrice: rate,
            priceBuilder: rate,
            description: `Criado automaticamente pela ordem de serviço de ${source}.`,
            isVisible: true,
          },
          select: { id: true, name: true, unit: true },
        });
        priceList.push(created);
        linked = created;
      }
    }
    if (linked) {
      const total = l.total ?? (l.rate != null ? round2(l.rate * l.quantity) : 0);
      order += 1;
      await tx.workOrderLineItem.create({
        data: {
          organizationId,
          workOrderId,
          pricingItemId: linked.id,
          serviceName: linked.name,
          // The order's own wording stays with the line so the crew sees the product.
          notes: [lineName(l), l.area, measuredFor(l, measured)].filter(Boolean).join(" · ").slice(0, 500) || null,
          quantitySqft: l.quantity,
          unitPrice: l.rate ?? (l.quantity ? round2(total / l.quantity) : 0),
          lineTotal: round2(total),
          sortOrder: order,
        },
      });
      continue;
    }
    const item = null as { id: string } | null;
    const isSf = l.uom.toUpperCase() === "SF";
    // Without a matching price-list item the line has no unit of its own (it would read "sq ft"),
    // so non-SF lines keep their count in the note and carry the total as a fixed amount.
    const keepQty = Boolean(item) || isSf;
    const total = l.total ?? (l.rate != null ? round2(l.rate * l.quantity) : 0);
    const notes = [l.area, keepQty ? "" : `${l.quantity} ${l.uom}`, measuredFor(l, measured)].filter(Boolean).join(" · ").slice(0, 500) || null;
    order += 1;
    await tx.workOrderLineItem.create({
      data: {
        organizationId,
        workOrderId,
        pricingItemId: item?.id ?? null,
        serviceName: lineName(l),
        notes,
        quantitySqft: keepQty ? l.quantity : 0,
        unitPrice: keepQty ? (l.rate ?? (l.quantity ? round2(total / l.quantity) : 0)) : total,
        lineTotal: round2(total),
        sortOrder: order,
      },
    });
  }
}

function linesText(lines: IntakeLine[]): string {
  return lines.map((l) => `- ${lineName(l)}: ${l.quantity} ${l.uom}${l.rate != null ? ` × $${l.rate}` : ""}${l.total != null ? ` = $${l.total.toFixed(2)}` : ""}${l.area ? ` (${l.area})` : ""}`).join("\n");
}

export type ApplyResult =
  | { kind: "missing" }
  | { kind: "closed" }
  | { kind: "accepted"; job_id: string; updated?: boolean };

/**
 * Turns a portal request into a job: a new WorkOrder (status draft, "Recebido"),
 * or — when the builder asked to update a job — an update appended to that job.
 * Used by the office "Aceitar" button and, for builder accounts, right when the builder sends.
 */
export async function applyPartnerRequest(
  tx: TenantPrisma,
  organizationId: string,
  requestId: string,
  reviewNote: string | null | undefined,
): Promise<ApplyResult> {
  const request = await tx.partnerJobRequest.findFirst({
    where: { id: requestId, organizationId: organizationId },
    include: { partnerUser: { select: { companyName: true, builder: { select: { company: true, type: true } }, customer: { select: { company: true, name: true, customerType: true } } } } },
  });
  if (!request) return { kind: "missing" as const };
  if (request.status === "accepted" && request.workOrderId) {
    return { kind: "accepted" as const, job_id: request.workOrderId };
  }
  if (request.status !== "pending") return { kind: "closed" as const };
  if (request.targetWorkOrderId) {
    const target = await tx.workOrder.findFirst({
      where: { id: request.targetWorkOrderId, organizationId: organizationId, status: { not: "canceled" } },
      select: { id: true, notes: true },
    });
    if (target) {
      const stamp = new Date().toISOString().slice(0, 10);
      const update = [
        `Atualização do builder pelo portal (${stamp}): ${request.title}`,
        request.externalRef ? `Nº do builder: ${request.externalRef}` : "",
        request.serviceType ? `Serviço: ${request.serviceType}` : "",
        request.preferredDate ? `Data solicitada: ${request.preferredDate.toISOString().slice(0, 10)}` : "",
        request.notes ? `Detalhes: ${request.notes}` : "",
        intakePickup(request.intake) ? `Pickup do material: ${intakePickup(request.intake)}` : "",
        intakeMeasurement(request.intake) ? intakeMeasurement(request.intake)!.text : "",
        intakeLines(request.intake).length ? `Serviços na ordem:\n${linesText(intakeLines(request.intake))}` : "",
      ].filter(Boolean).join("\n");
      await tx.workOrder.update({
        where: { id: target.id },
        data: { notes: [target.notes, update].filter(Boolean).join("\n\n") },
      });
      await tx.partnerJobRequest.update({
        where: { id: request.id },
        data: { status: "accepted", workOrderId: target.id, reviewedAt: new Date(), reviewNote: reviewNote || null },
      });
      return { kind: "accepted" as const, job_id: target.id, updated: true };
    }
  }
  const partnerType = (request.partnerUser.builder?.type || request.partnerUser.customer?.customerType || "builder").toLowerCase();
  const sourceType = partnerType === "contractor" ? "contractor" : "builder";
  const sourceName = request.partnerUser.companyName || request.partnerUser.builder?.company || request.partnerUser.customer?.company || request.partnerUser.customer?.name || "Builder";
  const notes = [
    `Pedido enviado pelo portal do parceiro (${request.contactName || sourceName}).`,
    request.contactEmail ? `E-mail: ${request.contactEmail}` : "",
    request.contactPhone ? `Telefone: ${request.contactPhone}` : "",
    request.serviceType ? `Serviço: ${request.serviceType}` : "",
    request.preferredDate ? `Data solicitada: ${request.preferredDate.toISOString().slice(0, 10)}` : "",
    request.externalRef ? `Nº do builder: ${request.externalRef}` : "",
    request.notes ? `Detalhes: ${request.notes}` : "",
    intakePickup(request.intake) ? `Pickup do material: ${intakePickup(request.intake)}` : "",
    intakeMeasurement(request.intake) ? `\n${intakeMeasurement(request.intake)!.text}\n(Measurement PDF and photos are in the job documents.)` : "",
  ].filter(Boolean).join("\n");
  await tx.$executeRaw`
    INSERT INTO "DocumentSequence" ("id", "organizationId", "kind", "nextValue")
    VALUES (gen_random_uuid(), ${organizationId}::uuid, 'work_order', 1)
    ON CONFLICT ("organizationId", "kind") DO NOTHING
  `;
  const sequence = await tx.$queryRaw<{ nextValue: number }[]>`
    SELECT "nextValue" FROM "DocumentSequence"
    WHERE "organizationId" = ${organizationId}::uuid AND "kind" = 'work_order'
    FOR UPDATE
  `;
  const number = sequence[0]?.nextValue ?? 1;
  await tx.$executeRaw`
    UPDATE "DocumentSequence"
    SET "nextValue" = ${number + 1}
    WHERE "organizationId" = ${organizationId}::uuid AND "kind" = 'work_order'
  `;
  const pickup = intakePickup(request.intake);
  // The order's date becomes the job date (all day, in the company's time zone).
  let schedule: { scheduledStart: Date; scheduledEnd: Date; allDay: boolean; status: string } | null = null;
  if (request.preferredDate) {
    const org = await tx.organization.findUnique({ where: { id: organizationId }, select: { timezone: true } });
    const tz = safeTimeZone(org?.timezone);
    const d = request.preferredDate;
    const [y, m, day] = [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()];
    schedule = {
      scheduledStart: zonedWallTimeToUtc(tz, y, m, day, 8, 0),
      scheduledEnd: zonedWallTimeToUtc(tz, y, m, day, 16, 0),
      allDay: true,
      status: "scheduled",
    };
  }
  const workOrder = await tx.workOrder.create({
    data: {
      organizationId: organizationId,
      number,
      title: request.title,
      status: schedule ? schedule.status : "draft",
      ...(schedule ? { scheduledStart: schedule.scheduledStart, scheduledEnd: schedule.scheduledEnd, allDay: true } : {}),
      ...(pickup ? { campoAttention: `Pickup do material: ${pickup}` } : {}),
      sourceType,
      sourceName,
      customerId: request.customerId,
      builderId: request.builderId,
      address: request.address,
      notes,
    },
    select: { id: true },
  });
  await createJobLines(tx, organizationId, workOrder.id, intakeLines(request.intake), sourceName, intakeMeasurement(request.intake)?.lines || []);
  await tx.partnerJobRequest.update({
    where: { id: request.id },
    data: { status: "accepted", workOrderId: workOrder.id, reviewedAt: new Date(), reviewNote: reviewNote || null },
  });
  return { kind: "accepted" as const, job_id: workOrder.id };
}
