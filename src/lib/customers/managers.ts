import { randomUUID } from "node:crypto";
import { formatUsPhone } from "../phone.js";

export type CustomerManager = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Managers of one builder company. Same company, different people on different jobs. */
export function cleanManagers(raw: unknown): CustomerManager[] {
  if (!Array.isArray(raw)) return [];
  const out: CustomerManager[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const name = String(row.name || "")
      .trim()
      .replace(/\s+/g, " ")
      .slice(0, 120);
    if (name.length < 2) continue;
    let id = String(row.id || "").trim();
    if (!UUID_RE.test(id) || seen.has(id)) id = randomUUID();
    seen.add(id);
    const email = String(row.email || "").trim().slice(0, 255) || null;
    const phone = formatUsPhone(String(row.phone || "").trim() || null);
    out.push({ id, name, email, phone });
    if (out.length >= 30) break;
  }
  return out;
}

export function managerName(raw: unknown, id: string | null | undefined): string | null {
  if (!id) return null;
  return cleanManagers(raw).find((m) => m.id === id)?.name || null;
}

/** Empty means no manager. An unknown id is rejected. */
export function managerIdOrNull(raw: unknown, id: string | null | undefined): string | null {
  if (id == null || id === "") return null;
  const wanted = String(id);
  if (!cleanManagers(raw).some((m) => m.id === wanted)) {
    const err = new Error("Escolha um manager desta empresa.") as Error & { status?: number };
    err.status = 400;
    throw err;
  }
  return wanted;
}
