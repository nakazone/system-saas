import { createHash } from "node:crypto";
import { Router, type Request, type Response } from "express";
import { prisma } from "../prisma.js";
import type { AuthedRequest } from "../../middleware/auth.js";

/**
 * Application errors grouped by fingerprint (same message shape + same place in the code):
 *  - server: every 5xx that reaches the error handler;
 *  - browser: uncaught errors from CRM pages (sent by crm-account-status.js, rate-limited).
 * Master › Operação lists them; a new group or a group that comes back after "resolvido" shows in the Central.
 */

const MAX_SAMPLES = 5;

/** Numbers, ids and quoted values vary between occurrences of the same error. */
export function normalizeMessage(message: string): string {
  return message
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<id>")
    .replace(/"[^"]{0,200}"|'[^']{0,200}'/g, "<v>")
    .replace(/\b\d+(\.\d+)?\b/g, "<n>")
    .slice(0, 300);
}

/** First stack frame that is our own code (not node_modules / node internals). */
export function stackTop(stack: string | undefined): string | null {
  if (!stack) return null;
  const line = stack
    .split("\n")
    .slice(1)
    .map((l) => l.trim())
    .find((l) => l.startsWith("at ") && !l.includes("node_modules") && !l.includes("node:"));
  if (!line) return null;
  return line.replace(/^at\s+/, "").replace(/\(?(?:file:\/\/)?\/[^)]*?(src|crm)\//, "$1/").replace(/\)$/, "").slice(0, 200);
}

export function fingerprintOf(source: string, message: string, top: string | null): string {
  return createHash("sha1").update(`${source}|${normalizeMessage(message)}|${top ?? ""}`).digest("hex").slice(0, 24);
}

export async function recordError(input: { source: "server" | "browser"; message: string; stack?: string; path?: string; method?: string; orgId?: string | null; userId?: string | null; ua?: string | null }): Promise<void> {
  const message = (input.message || "Erro sem mensagem").slice(0, 500);
  const top = input.source === "server" ? stackTop(input.stack) : (input.stack || "").split("\n")[0]?.slice(0, 200) || null;
  const fp = fingerprintOf(input.source, message, top);
  const sample = { at: new Date().toISOString(), path: input.path?.slice(0, 200) ?? null, method: input.method ?? null, orgId: input.orgId ?? null, userId: input.userId ?? null, ua: input.ua?.slice(0, 160) ?? null };
  const uuid = (v: string | null | undefined) => (v && /^[0-9a-f-]{36}$/i.test(v) ? v : null);
  try {
    const existing = await prisma.errorGroup.findUnique({ where: { fingerprint: fp }, select: { samples: true, status: true } });
    if (!existing) {
      await prisma.errorGroup.create({
        data: { fingerprint: fp, source: input.source, message, stackTop: top, path: sample.path, method: sample.method, lastOrgId: uuid(sample.orgId), lastUserId: uuid(sample.userId), samples: [sample] },
      });
      return;
    }
    const samples = [sample, ...((Array.isArray(existing.samples) ? existing.samples : []) as unknown[])].slice(0, MAX_SAMPLES);
    await prisma.errorGroup.update({
      where: { fingerprint: fp },
      data: {
        count: { increment: 1 },
        lastSeen: new Date(),
        path: sample.path,
        method: sample.method,
        lastOrgId: uuid(sample.orgId),
        lastUserId: uuid(sample.userId),
        samples: samples as never,
        // An error marked resolved that happens again opens again.
        ...(existing.status === "resolved" ? { status: "open", resolvedAt: null } : {}),
      },
    });
  } catch (error) {
    console.error("[errors] could not record", error);
  }
}

/** Called by the error handler for 5xx responses. */
export function recordServerError(err: unknown, req: Request): void {
  const e = err instanceof Error ? err : new Error(String(err));
  const r = req as AuthedRequest;
  void recordError({
    source: "server",
    message: e.message,
    stack: e.stack,
    path: req.path,
    method: req.method,
    orgId: r.organizationId ?? null,
    userId: r.user?.id ?? null,
    ua: String(req.headers["user-agent"] || ""),
  });
}

/* Browser errors from the CRM (at most 20 per session per hour). */
export const clientErrorsRouter = Router();

clientErrorsRouter.post("/api/client-errors", async (req: Request, res: Response) => {
  res.status(204).end();
  const r = req as AuthedRequest;
  if (!r.user || !r.organizationId) return;
  const s = req.session as unknown as { errBudget?: { hour: number; n: number } };
  const hour = Math.floor(Date.now() / 3600e3);
  if (!s.errBudget || s.errBudget.hour !== hour) s.errBudget = { hour, n: 0 };
  if (s.errBudget.n >= 20) return;
  s.errBudget.n++;
  const body = (req.body ?? {}) as Record<string, unknown>;
  const message = String(body.message || "").slice(0, 500);
  if (!message) return;
  void recordError({
    source: "browser",
    message,
    stack: `${String(body.source || "").slice(0, 160)}:${Number(body.line) || 0}`,
    path: String(body.page || "").slice(0, 200),
    method: "GET",
    orgId: r.organizationId,
    userId: r.user.id,
    ua: String(req.headers["user-agent"] || ""),
  });
});
