import { HeadBucketCommand, S3Client } from "@aws-sdk/client-s3";
import { prisma } from "../prisma.js";
import { env } from "../../config/env.js";
import { getEmailTransportStatus } from "../email/index.js";
import { isAiConfigured } from "../ai/client.js";
import { getStripe, stripeEnabled } from "../billing/stripe.js";

/**
 * External services the platform depends on, checked every 15 minutes (and on demand):
 * ok = working · warn = working with a problem · down = failing · off = not configured.
 * Results are kept 30 days (ServiceCheck) for the 30-day strip in Master › Operação.
 */

export type ServiceStatus = "ok" | "warn" | "down" | "off";
export type CheckResult = { service: string; status: ServiceStatus; latencyMs: number | null; detail: string };

export const SERVICES: { key: string; name: string; what: string }[] = [
  { key: "app", name: "Aplicação", what: "Servidor no Railway" },
  { key: "db", name: "Banco de dados", what: "Postgres" },
  { key: "email", name: "E-mail", what: "Resend" },
  { key: "storage", name: "Arquivos", what: "Fotos e PDFs (S3)" },
  { key: "stripe", name: "Pagamentos", what: "Stripe" },
  { key: "ai", name: "IA", what: "OpenAI" },
  { key: "maps", name: "Mapas", what: "Google Maps" },
];

const TIMEOUT_MS = 6000;

async function timed<T>(fn: () => Promise<T>): Promise<{ value?: T; error?: string; ms: number }> {
  const t0 = Date.now();
  try {
    const value = await Promise.race([fn(), new Promise<never>((_, rej) => setTimeout(() => rej(new Error("sem resposta em 6 s")), TIMEOUT_MS))]);
    return { value, ms: Date.now() - t0 };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error), ms: Date.now() - t0 };
  }
}

async function getJson(url: string, headers: Record<string, string>): Promise<{ status: number; body: unknown }> {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
  return { status: res.status, body: await res.json().catch(() => null) };
}

function mapsKey(): string | null {
  const k = process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_MAPS_JS_KEY || process.env.GOOGLE_PLACES_JS_KEY || process.env.GOOGLE_MAPS_KEY || "";
  return k.trim() || null;
}

const checks: Record<string, () => Promise<CheckResult>> = {
  async app() {
    const mb = Math.round(process.memoryUsage().rss / 1048576);
    const up = Math.round(process.uptime() / 60);
    const version = process.env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 7);
    return { service: "app", status: mb > 900 ? "warn" : "ok", latencyMs: null, detail: `no ar há ${up < 120 ? up + " min" : Math.round(up / 60) + " h"} · ${mb} MB${version ? " · versão " + version : ""}` };
  },
  async db() {
    const r = await timed(() => prisma.$queryRaw`SELECT 1`);
    if (r.error) return { service: "db", status: "down", latencyMs: r.ms, detail: r.error };
    return { service: "db", status: r.ms > 1000 ? "warn" : "ok", latencyMs: r.ms, detail: r.ms > 1000 ? "respondendo devagar" : "respondendo" };
  },
  async email() {
    const st = getEmailTransportStatus();
    const key = process.env.RESEND_API_KEY?.trim();
    if (!st.resend || !key) return { service: "email", status: "off", latencyMs: null, detail: "Resend não configurado — e-mails só no log" };
    const domain = (st.from.match(/@([^>\s]+)/)?.[1] || "").toLowerCase();
    const r = await timed(() => getJson("https://api.resend.com/domains", { Authorization: `Bearer ${key}` }));
    if (r.error) return { service: "email", status: "down", latencyMs: r.ms, detail: r.error };
    const { status, body } = r.value!;
    if (status === 401 || status === 403) return { service: "email", status: "down", latencyMs: r.ms, detail: "chave do Resend recusada" };
    if (status >= 500) return { service: "email", status: "down", latencyMs: r.ms, detail: `Resend respondeu ${status}` };
    const list = ((body as { data?: { name: string; status: string }[] })?.data ?? []) as { name: string; status: string }[];
    const d = list.find((x) => x.name.toLowerCase() === domain);
    if (status >= 400) return { service: "email", status: "warn", latencyMs: r.ms, detail: `Resend respondeu ${status}` };
    if (!d) return { service: "email", status: "warn", latencyMs: r.ms, detail: `domínio ${domain || "do remetente"} não está no Resend` };
    if (d.status !== "verified") return { service: "email", status: "warn", latencyMs: r.ms, detail: `domínio ${domain} ${d.status}` };
    return { service: "email", status: "ok", latencyMs: r.ms, detail: `${domain} verificado` };
  },
  async storage() {
    if (!(env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY && env.S3_ENDPOINT)) {
      return { service: "storage", status: env.NODE_ENV === "production" ? "warn" : "off", latencyMs: null, detail: "S3 não configurado — arquivos no disco do servidor (somem a cada deploy)" };
    }
    const client = new S3Client({ region: env.S3_REGION, endpoint: env.S3_ENDPOINT, forcePathStyle: true, credentials: { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY } });
    const r = await timed(() => client.send(new HeadBucketCommand({ Bucket: env.S3_BUCKET })));
    if (r.error) return { service: "storage", status: "down", latencyMs: r.ms, detail: r.error.slice(0, 160) };
    return { service: "storage", status: "ok", latencyMs: r.ms, detail: `bucket ${env.S3_BUCKET}` };
  },
  async stripe() {
    if (!stripeEnabled()) return { service: "stripe", status: "off", latencyMs: null, detail: "STRIPE_SECRET_KEY não configurada" };
    const r = await timed(() => getStripe()!.balance.retrieve());
    if (r.error) return { service: "stripe", status: "down", latencyMs: r.ms, detail: r.error.slice(0, 160) };
    const live = !!(r.value as { livemode?: boolean })?.livemode;
    return { service: "stripe", status: live ? "ok" : "warn", latencyMs: r.ms, detail: live ? "modo produção" : "modo teste" };
  },
  async ai() {
    if (!isAiConfigured()) return { service: "ai", status: "off", latencyMs: null, detail: "OPENAI_API_KEY não configurada" };
    const key = (process.env.JOB_MEDIA_AI_API_KEY || process.env.OPENAI_API_KEY || process.env.FINANCE_OCR_API_KEY || "").trim();
    const base = (process.env.JOB_MEDIA_AI_BASE_URL || process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
    const r = await timed(() => getJson(`${base}/models`, { Authorization: `Bearer ${key}` }));
    if (r.error) return { service: "ai", status: "down", latencyMs: r.ms, detail: r.error };
    const { status } = r.value!;
    if (status === 401) return { service: "ai", status: "down", latencyMs: r.ms, detail: "chave recusada" };
    if (status === 429) return { service: "ai", status: "warn", latencyMs: r.ms, detail: "limite ou crédito da conta" };
    if (status >= 400) return { service: "ai", status: "warn", latencyMs: r.ms, detail: `respondeu ${status}` };
    return { service: "ai", status: "ok", latencyMs: r.ms, detail: "respondendo" };
  },
  async maps() {
    // A real Maps call costs money; only the key is checked here.
    return mapsKey()
      ? { service: "maps", status: "ok", latencyMs: null, detail: "chave configurada (sem chamada de teste)" }
      : { service: "maps", status: "off", latencyMs: null, detail: "chave do Google Maps não configurada" };
  },
};

/** Runs every check, saves the results and drops results older than 30 days. */
export async function runServiceChecks(): Promise<{ checked: number; down: string[]; results: CheckResult[] }> {
  const results = await Promise.all(
    SERVICES.map((s) => checks[s.key]().catch((e): CheckResult => ({ service: s.key, status: "down", latencyMs: null, detail: e instanceof Error ? e.message : String(e) }))),
  );
  await prisma.serviceCheck.createMany({ data: results.map((r) => ({ service: r.service, status: r.status, latencyMs: r.latencyMs, detail: r.detail.slice(0, 300) })) });
  await prisma.serviceCheck.deleteMany({ where: { checkedAt: { lt: new Date(Date.now() - 31 * 86400e3) } } }).catch(() => undefined);
  return { checked: results.length, down: results.filter((r) => r.status === "down").map((r) => r.service), results };
}

const RANK: Record<string, number> = { off: 0, ok: 1, warn: 2, down: 3 };

export type ServiceView = { key: string; name: string; what: string; status: ServiceStatus; detail: string; latencyMs: number | null; checkedAt: Date | null; days: { day: string; status: ServiceStatus | "none" }[]; uptimePct: number | null };

/** Latest status per service plus a 30-day strip (worst status of each day). */
export async function servicesOverview(now = new Date()): Promise<ServiceView[]> {
  const since = new Date(now.getTime() - 30 * 86400e3);
  const rows = await prisma.serviceCheck.findMany({ where: { checkedAt: { gte: since } }, orderBy: { checkedAt: "asc" } });
  const dayKey = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Denver", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  const days: string[] = [];
  for (let i = 29; i >= 0; i--) days.push(dayKey(new Date(now.getTime() - i * 86400e3)));
  return SERVICES.map((s) => {
    const mine = rows.filter((r) => r.service === s.key);
    const last = mine[mine.length - 1];
    const byDay = new Map<string, ServiceStatus>();
    for (const r of mine) {
      const k = dayKey(r.checkedAt);
      const prev = byDay.get(k);
      if (!prev || RANK[r.status] > RANK[prev]) byDay.set(k, r.status as ServiceStatus);
    }
    const counted = mine.filter((r) => r.status !== "off");
    const up = counted.filter((r) => r.status !== "down").length;
    return {
      key: s.key,
      name: s.name,
      what: s.what,
      status: (last?.status as ServiceStatus) ?? "off",
      detail: last?.detail ?? "ainda não verificado",
      latencyMs: last?.latencyMs ?? null,
      checkedAt: last?.checkedAt ?? null,
      days: days.map((d) => ({ day: d, status: byDay.get(d) ?? "none" })),
      uptimePct: counted.length ? Math.round((up / counted.length) * 1000) / 10 : null,
    };
  });
}
