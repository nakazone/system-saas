/** Short-lived signed payloads for Mate AI: what a confirmation will execute, and undo windows. */
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { env } from "../../config/env.js";

export type ActionToken = {
  v: 1;
  /** exec = run a confirmed action; undo = revert it (30 s). */
  k: "exec" | "undo";
  /** Action name. */
  a: string;
  /** Organization and user it was prepared for. */
  o: string;
  u: string;
  /** Optional virtual-office profile that prepared this action. */
  agentKey?: string;
  /** Unique id (replay protection). */
  id: string;
  /** Expiry, epoch ms. */
  x: number;
  /** Payload for execute()/undo(). */
  e: Record<string, unknown>;
};

const SALT = "mate-ai-action:";

function mac(body: string): Buffer {
  return createHmac("sha256", SALT + env.SESSION_SECRET).update(body).digest();
}

export function signActionToken(t: Omit<ActionToken, "v" | "id" | "x"> & { ttlMs: number }): { token: string; id: string; expiresAt: number } {
  const id = randomUUID();
  const payload: ActionToken = { v: 1, k: t.k, a: t.a, o: t.o, u: t.u, ...(t.agentKey ? { agentKey: t.agentKey } : {}), id, x: Date.now() + t.ttlMs, e: t.e };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return { token: body + "." + mac(body).toString("base64url"), id, expiresAt: payload.x };
}

export function verifyActionToken(token: string, kind: ActionToken["k"]): ActionToken | null {
  const [body, sig] = String(token || "").split(".");
  if (!body || !sig || String(token).split(".").length !== 2) return null;
  let provided: Buffer;
  try {
    provided = Buffer.from(sig, "base64url");
  } catch {
    return null;
  }
  const expected = mac(body);
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return null;
  try {
    const t = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as ActionToken;
    if (t.v !== 1 || t.k !== kind || typeof t.a !== "string" || typeof t.id !== "string") return null;
    if (t.agentKey !== undefined && (typeof t.agentKey !== "string" || !/^[a-z0-9_-]{1,60}$/i.test(t.agentKey))) return null;
    if (!t.e || typeof t.e !== "object" || typeof t.x !== "number" || t.x <= Date.now()) return null;
    return t;
  } catch {
    return null;
  }
}
