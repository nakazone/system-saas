/**
 * Multiple Delivery stops on a WorkOrder.
 * Scalar delivery* columns mirror the first stop for calendar / Campo compatibility.
 */
export type DeliveryStop = {
  id: string;
  scheduled_start: string | null;
  pickup_address: string | null;
  location_id: string | null;
  location_name: string | null;
  hours: string | null;
  notes: string | null;
};

function asRecord(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  return null;
}

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `d_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function parseDeliveryStops(raw: unknown): DeliveryStop[] {
  if (!Array.isArray(raw)) return [];
  const out: DeliveryStop[] = [];
  for (const row of raw) {
    const r = asRecord(row);
    if (!r) continue;
    const id = String(r.id || "").trim() || newId();
    const scheduled =
      r.scheduled_start != null && String(r.scheduled_start).trim()
        ? String(r.scheduled_start)
        : r.scheduledStart != null && String(r.scheduledStart).trim()
          ? String(r.scheduledStart)
          : null;
    const pickup =
      r.pickup_address != null
        ? String(r.pickup_address).trim() || null
        : r.pickupAddress != null
          ? String(r.pickupAddress).trim() || null
          : null;
    out.push({
      id,
      scheduled_start: scheduled,
      pickup_address: pickup,
      location_id: r.location_id != null ? String(r.location_id).trim() || null : r.locationId != null ? String(r.locationId).trim() || null : null,
      location_name:
        r.location_name != null
          ? String(r.location_name).trim() || null
          : r.locationName != null
            ? String(r.locationName).trim() || null
            : null,
      hours: r.hours != null ? String(r.hours).trim() || null : null,
      notes: r.notes != null ? String(r.notes).trim() || null : null,
    });
  }
  return out.slice(0, 8);
}

/** Prefer JSON stops; fall back to legacy scalar delivery fields. */
export function resolveDeliveryStops(wo: {
  needsDelivery?: boolean | null;
  deliveryPickupAddress?: string | null;
  deliveryNotes?: string | null;
  deliveryScheduledStart?: Date | string | null;
  deliveries?: unknown;
}): DeliveryStop[] {
  const fromJson = parseDeliveryStops(wo.deliveries);
  if (fromJson.length) return fromJson;
  if (!wo.needsDelivery) return [];
  const start =
    wo.deliveryScheduledStart instanceof Date
      ? wo.deliveryScheduledStart.toISOString()
      : wo.deliveryScheduledStart
        ? String(wo.deliveryScheduledStart)
        : null;
  return [
    {
      id: "primary",
      scheduled_start: start,
      pickup_address: wo.deliveryPickupAddress?.trim() || null,
      location_id: null,
      location_name: null,
      hours: null,
      notes: wo.deliveryNotes?.trim() || null,
    },
  ];
}

export function mirrorPrimaryDelivery(stops: DeliveryStop[]): {
  needsDelivery: boolean;
  deliveryPickupAddress: string | null;
  deliveryNotes: string | null;
  deliveryScheduledStart: Date | null;
  deliveries: DeliveryStop[] | null;
} {
  const clean = stops
    .map((s) => ({
      id: s.id || newId(),
      scheduled_start: s.scheduled_start || null,
      pickup_address: s.pickup_address?.trim() || null,
      location_id: s.location_id || null,
      location_name: s.location_name?.trim() || null,
      hours: s.hours?.trim() || null,
      notes: s.notes?.trim() || null,
    }))
    .filter((s) => s.scheduled_start || s.pickup_address || s.notes || s.location_id);
  const primary = clean[0];
  if (!primary) {
    return {
      needsDelivery: false,
      deliveryPickupAddress: null,
      deliveryNotes: null,
      deliveryScheduledStart: null,
      deliveries: null,
    };
  }
  let start: Date | null = null;
  if (primary.scheduled_start) {
    const d = new Date(primary.scheduled_start);
    if (!Number.isNaN(d.getTime())) start = d;
  }
  return {
    needsDelivery: true,
    deliveryPickupAddress: primary.pickup_address,
    deliveryNotes: primary.notes,
    deliveryScheduledStart: start,
    deliveries: clean,
  };
}
