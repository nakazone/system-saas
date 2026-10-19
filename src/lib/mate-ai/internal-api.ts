/**
 * Mate AI executes confirmed actions through the SAME HTTP routes the screens use, as the
 * same user (session cookie + host forwarded to this process). Permissions, validation,
 * numbering, activity logs, notifications and side effects therefore stay identical to a
 * click in the UI — the agent never has a parallel write path for these actions.
 */
import type { Request } from "express";

export type InternalResponse<T = Record<string, unknown>> = {
  ok: boolean;
  status: number;
  json: T & { success?: boolean; error?: string };
};

function localPort(req: Request): number {
  const port = req.socket?.localPort;
  if (port) return port;
  return Number(process.env.PORT || 3000);
}

export async function callInternalApi<T = Record<string, unknown>>(
  req: Request,
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  path: string,
  body?: unknown,
): Promise<InternalResponse<T>> {
  if (!path.startsWith("/api/")) throw new Error("internal API path must start with /api/");
  const headers: Record<string, string> = {
    accept: "application/json",
    "x-mate-ai": "1",
  };
  const cookie = req.headers.cookie;
  if (cookie) headers.cookie = cookie;
  const host = req.headers.host;
  if (host) headers.host = host;
  // The session cookie is "secure" in production; tell the app the original request was https.
  const proto = req.get("x-forwarded-proto") || req.protocol;
  if (proto) headers["x-forwarded-proto"] = proto;
  const lang = req.headers["accept-language"];
  if (typeof lang === "string") headers["accept-language"] = lang;
  if (body !== undefined) headers["content-type"] = "application/json";

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45_000);
  try {
    const res = await fetch(`http://127.0.0.1:${localPort(req)}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
      redirect: "manual",
    });
    const json = (await res.json().catch(() => ({}))) as InternalResponse<T>["json"];
    return { ok: res.ok, status: res.status, json };
  } finally {
    clearTimeout(timer);
  }
}

/** Error text from a route's JSON, in the route's own words. */
export function internalError(res: InternalResponse, fallback: string): string {
  const err = res.json?.error;
  if (typeof err === "string" && err.trim()) return err;
  if (res.status === 403) return "Você não tem permissão para fazer isso.";
  if (res.status === 404) return "Registro não encontrado.";
  return fallback;
}
