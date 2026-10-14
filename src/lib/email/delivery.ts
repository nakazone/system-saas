import crypto from "node:crypto";
import express, { Router, type Request, type Response } from "express";
import { prisma } from "../prisma.js";
import { env } from "../../config/env.js";
import { getEmailTransportStatus } from "./index.js";

/**
 * What happened after an e-mail left (Master › Comunicação › Envios):
 *  - POST /webhooks/resend: delivery events signed by Resend (Svix). Mounted before express.json().
 *  - Hard bounces and spam complaints put the address on the block list (EmailSuppression).
 *  - The log keeps 90 days.
 */

export const EMAIL_LOG_DAYS = 90;
export const EMAIL_LOG_CLEANUP_JOB = "email-log-cleanup";

/** Higher rank wins; a bounce or complaint is final. */
const RANK: Record<string, number> = { console: 0, blocked: 0, failed: 0, sent: 1, delayed: 2, delivered: 3, opened: 4, clicked: 5, bounced: 9, complained: 9 };

const EVENT_STATUS: Record<string, string> = {
  "email.sent": "sent",
  "email.delivered": "delivered",
  "email.delivery_delayed": "delayed",
  "email.opened": "opened",
  "email.clicked": "clicked",
  "email.bounced": "bounced",
  "email.complained": "complained",
  "email.failed": "failed",
};

/** Svix signature: base64(HMAC-SHA256(secret, `${id}.${timestamp}.${body}`)), header "v1,<sig> v1,<sig2>". */
export function verifySvix(secret: string, headers: { id: string; timestamp: string; signature: string }, body: string, now = Date.now()): boolean {
  if (!secret || !headers.id || !headers.timestamp || !headers.signature) return false;
  const ts = Number(headers.timestamp);
  if (!Number.isFinite(ts) || Math.abs(now / 1000 - ts) > 5 * 60) return false;
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const expected = crypto.createHmac("sha256", key).update(`${headers.id}.${headers.timestamp}.${body}`).digest("base64");
  return headers.signature.split(" ").some((part) => {
    const sig = part.split(",")[1] || "";
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  });
}

type ResendEvent = {
  type?: string;
  created_at?: string;
  data?: { email_id?: string; to?: string[] | string; bounce?: { type?: string; subType?: string; message?: string } };
};

/** Applies one Resend event to the log. Returns false when the e-mail is not in the log (sent by something else). */
export async function applyResendEvent(ev: ResendEvent): Promise<boolean> {
  const status = EVENT_STATUS[String(ev.type)];
  const id = ev.data?.email_id;
  if (!status || !id) return false;
  const at = ev.created_at ? new Date(ev.created_at) : new Date();
  const row = await prisma.platformEmailLog.findFirst({ where: { providerId: id }, orderBy: { createdAt: "desc" } });
  const to = (Array.isArray(ev.data?.to) ? ev.data!.to : [ev.data?.to]).filter(Boolean).map((e) => String(e).toLowerCase());

  // Hard bounce or spam complaint: never e-mail that address again until someone releases it.
  const hardBounce = status === "bounced" && String(ev.data?.bounce?.type || "Permanent").toLowerCase() !== "transient";
  if (hardBounce || status === "complained") {
    const detail = status === "complained" ? "Marcou como spam" : ev.data?.bounce?.message || ev.data?.bounce?.subType || "Endereço não existe ou recusou";
    for (const email of to) {
      await prisma.emailSuppression
        .upsert({ where: { email }, create: { email, reason: status === "complained" ? "complaint" : "bounce", detail: detail.slice(0, 300) }, update: {} })
        .catch(() => undefined);
    }
  }
  if (!row) return false;
  const events = (Array.isArray(row.events) ? (row.events as { type: string; at: string }[]) : []).concat({ type: status, at: at.toISOString() }).slice(-20);
  const keep = (RANK[row.status] ?? 0) > (RANK[status] ?? 0) || (status === "failed" && (RANK[row.status] ?? 0) > 0);
  await prisma.platformEmailLog.update({
    where: { id: row.id },
    data: {
      status: keep ? row.status : status,
      lastEventAt: at,
      events,
      ...(status === "opened" && !row.openedAt ? { openedAt: at } : {}),
      ...(status === "bounced" || status === "complained" ? { error: (ev.data?.bounce?.message || (status === "complained" ? "Marcado como spam" : "Voltou")).slice(0, 500) } : {}),
    },
  });
  return true;
}

export const resendWebhookRouter = Router();

resendWebhookRouter.post("/webhooks/resend", express.raw({ type: "*/*", limit: "512kb" }), async (req: Request, res: Response) => {
  const secret = process.env.RESEND_WEBHOOK_SECRET?.trim();
  if (!secret) return void res.status(503).json({ ok: false, error: "webhook_not_configured" });
  const body = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : "";
  const okSig = verifySvix(secret, {
    id: String(req.headers["svix-id"] || ""),
    timestamp: String(req.headers["svix-timestamp"] || ""),
    signature: String(req.headers["svix-signature"] || ""),
  }, body);
  if (!okSig) return void res.status(400).json({ ok: false, error: "bad_signature" });
  try {
    const known = await applyResendEvent(JSON.parse(body) as ResendEvent);
    await markWebhookSeen();
    res.json({ ok: true, known });
  } catch (error) {
    console.error("[email] resend webhook failed", error);
    res.status(500).json({ ok: false });
  }
});

const WEBHOOK_SEEN_KEY = "email.webhook_last_event";
async function markWebhookSeen(): Promise<void> {
  const value = new Date().toISOString();
  await prisma.systemSetting.upsert({ where: { key: WEBHOOK_SEEN_KEY }, create: { key: WEBHOOK_SEEN_KEY, value }, update: { value } }).catch(() => undefined);
}

/** Deletes log rows older than 90 days. */
export async function cleanupEmailLog(now = new Date()): Promise<{ processed: number }> {
  const cutoff = new Date(now.getTime() - EMAIL_LOG_DAYS * 86400e3);
  const r = await prisma.platformEmailLog.deleteMany({ where: { createdAt: { lt: cutoff } } });
  return { processed: r.count };
}

/* ───────────────────────── sender / domain ───────────────────────── */

export type SenderStatus = {
  provider: "resend" | "console";
  ready: boolean;
  from: string;
  domain: string | null;
  /** verified | pending | failed | not_found | unknown | n/a */
  domainStatus: string;
  domainDetail: string;
  webhook: { configured: boolean; lastEventAt: string | null };
  checkedAt: string;
};

let senderCache: { at: number; value: SenderStatus } | null = null;

function domainOf(from: string): string | null {
  const m = from.match(/@([^>\s]+)>?\s*$/);
  return m ? m[1].toLowerCase() : null;
}

export async function senderStatus(force = false): Promise<SenderStatus> {
  if (!force && senderCache && Date.now() - senderCache.at < 10 * 60e3) return senderCache.value;
  const t = getEmailTransportStatus();
  const from = (process.env.RESEND_FROM_EMAIL || env.EMAIL_FROM || "").trim() || t.from;
  const domain = domainOf(from);
  let domainStatus = "n/a";
  let domainDetail = t.note;
  const key = process.env.RESEND_API_KEY?.trim();
  if (t.provider === "resend" && key && domain) {
    try {
      const r = await fetch("https://api.resend.com/domains", { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(6000) });
      if (r.ok) {
        const j = (await r.json()) as { data?: { name: string; status: string }[] };
        const d = (j.data || []).find((x) => x.name.toLowerCase() === domain || domain.endsWith(`.${x.name.toLowerCase()}`));
        domainStatus = d ? (d.status === "verified" ? "verified" : d.status === "failed" ? "failed" : "pending") : "not_found";
        domainDetail =
          domainStatus === "verified"
            ? "Domínio verificado no Resend (SPF e DKIM ok)."
            : domainStatus === "not_found"
              ? `O domínio ${domain} não está cadastrado no Resend. Adicione em resend.com/domains.`
              : domainStatus === "failed"
                ? "A verificação do domínio falhou. Confira os registros DNS em resend.com/domains."
                : "Domínio aguardando verificação dos registros DNS.";
      } else {
        domainStatus = "unknown";
        domainDetail = r.status === 401 || r.status === 403 ? "A chave do Resend não pode ler domínios (use uma chave com acesso total para ver o status)." : `Resend respondeu ${r.status}.`;
      }
    } catch {
      domainStatus = "unknown";
      domainDetail = "Não foi possível consultar o Resend agora.";
    }
  }
  const seen = await prisma.systemSetting.findUnique({ where: { key: WEBHOOK_SEEN_KEY } }).catch(() => null);
  const value: SenderStatus = {
    provider: t.provider,
    ready: t.ready,
    from,
    domain,
    domainStatus,
    domainDetail,
    webhook: { configured: !!process.env.RESEND_WEBHOOK_SECRET?.trim(), lastEventAt: seen?.value ?? null },
    checkedAt: new Date().toISOString(),
  };
  senderCache = { at: Date.now(), value };
  return value;
}
