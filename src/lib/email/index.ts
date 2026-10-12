import { env } from "../../config/env.js";
import { prisma } from "../prisma.js";
import { tenantStorage } from "../tenant/prisma-tenant.js";

export type EmailMessage = {
  to: string | string[];
  cc?: string | string[];
  subject: string;
  text: string;
  html?: string;
  replyTo?: string;
  /** Base64 attachments (Resend). The console provider only logs the file names. */
  attachments?: { filename: string; content: Buffer }[];
  /** Send log only (Master › Comunicação › Envios); providers ignore it. */
  meta?: EmailMeta;
};

export type EmailMeta = {
  /** platform = ObraMate → company · company = company → its clients/team · internal = to the Master team */
  category?: "platform" | "company" | "internal";
  template?: string;
  organizationId?: string | null;
};

export type EmailSendResult = {
  ok: true;
  transport: "console" | "resend";
  id?: string;
  /** Every recipient is on the block list (bounced / marked as spam) — nothing was sent. */
  blocked?: string[];
  /** True when nothing went out because every recipient is blocked. */
  skipped?: boolean;
};

export type EmailTransportStatus = {
  ready: boolean;
  provider: "console" | "resend";
  from: string;
  resend: boolean;
  note: string;
};

export interface EmailProvider {
  send(message: EmailMessage): Promise<EmailSendResult>;
}

function asList(v: string | string[] | undefined): string[] {
  if (!v) return [];
  const arr = Array.isArray(v) ? v : [v];
  return arr
    .map((s) => String(s || "").trim().toLowerCase())
    .filter((s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s));
}

export class ConsoleEmailProvider implements EmailProvider {
  async send(message: EmailMessage): Promise<EmailSendResult> {
    const to = asList(message.to).join(", ");
    console.log("---- EMAIL (console provider) ----");
    console.log(`To: ${to}`);
    if (message.cc) console.log(`Cc: ${asList(message.cc).join(", ")}`);
    console.log(`Subject: ${message.subject}`);
    // In production the body often carries customer data and private links (quote/invoice/
    // invite). Keep it out of the logs unless explicitly asked for while debugging.
    if (process.env.NODE_ENV !== "production" || process.env.EMAIL_CONSOLE_LOG_BODY === "1") {
      console.log(message.text);
    } else {
      console.log("(body hidden in production — configure Resend to deliver, or set EMAIL_CONSOLE_LOG_BODY=1 temporarily)");
    }
    if (message.attachments?.length) {
      console.log(`Attachments: ${message.attachments.map((a) => a.filename).join(", ")}`);
    }
    console.log("----------------------------------");
    return { ok: true, transport: "console", id: `console-${Date.now()}` };
  }
}

export class ResendEmailProvider implements EmailProvider {
  constructor(
    private apiKey: string,
    private from: string,
  ) {}

  async send(message: EmailMessage): Promise<EmailSendResult> {
    const to = asList(message.to);
    if (!to.length) throw new Error("Recipient email required");
    const cc = asList(message.cc).filter((e) => !to.includes(e));

    const payload: Record<string, unknown> = {
      from: this.from,
      to,
      subject: message.subject,
      text: message.text,
    };
    if (message.html) payload.html = message.html;
    if (cc.length) payload.cc = cc;
    if (message.replyTo) payload.reply_to = message.replyTo;
    if (message.attachments?.length) {
      payload.attachments = message.attachments.map((a) => ({
        filename: a.filename,
        content: a.content.toString("base64"),
      }));
    }

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    const body = (await res.json().catch(() => ({}))) as {
      id?: string;
      message?: string;
      error?: { message?: string };
    };
    if (!res.ok) {
      const msg =
        body.error?.message ||
        body.message ||
        `Resend HTTP ${res.status}`;
      throw new Error(friendlyResendError(msg));
    }
    return { ok: true, transport: "resend", id: body.id };
  }
}

function friendlyResendError(raw: string): string {
  const s = String(raw || "");
  if (/domain is not verified|not verified/i.test(s)) {
    return (
      "O domínio em EMAIL_FROM / RESEND_FROM_EMAIL não está verificado no Resend. " +
      "Em resend.com/domains adicione e verifique o domínio, depois use um e-mail desse domínio."
    );
  }
  if (/from.*invalid|invalid.*from/i.test(s)) {
    return 'Remetente inválido. Use o formato "Nome <email@dominio-verificado.com>".';
  }
  if (/api key|unauthorized|invalid.*key/i.test(s)) {
    return "RESEND_API_KEY inválida ou revogada. Crie uma nova chave em resend.com/api-keys.";
  }
  return s;
}

export function getEmailTransportStatus(): EmailTransportStatus {
  const from =
    (process.env.RESEND_FROM_EMAIL || env.EMAIL_FROM || "").trim() || "noreply@localhost";
  const hasKey = Boolean(process.env.RESEND_API_KEY?.trim());
  const providerPref = env.EMAIL_PROVIDER;
  const useResend = providerPref === "resend" || (providerPref === "console" && hasKey);

  if (useResend && hasKey) {
    return {
      ready: true,
      provider: "resend",
      from,
      resend: true,
      note: "Resend configurado — e-mails serão enviados de verdade.",
    };
  }
  if (useResend && !hasKey) {
    return {
      ready: false,
      provider: "resend",
      from,
      resend: false,
      note: "EMAIL_PROVIDER=resend mas falta RESEND_API_KEY no Railway.",
    };
  }
  return {
    ready: false,
    provider: "console",
    from,
    resend: false,
    note:
      "E-mail em modo console (não envia ao cliente). Defina RESEND_API_KEY + EMAIL_FROM (domínio verificado) e EMAIL_PROVIDER=resend. Teste GET /api/health/email.",
  };
}

function rawProvider(): EmailProvider {
  const status = getEmailTransportStatus();
  if (status.provider === "resend" && status.resend) {
    const key = process.env.RESEND_API_KEY!.trim();
    const from =
      (process.env.RESEND_FROM_EMAIL || env.EMAIL_FROM || "").trim() ||
      "ObraMate <onboarding@resend.dev>";
    return new ResendEmailProvider(key, from);
  }
  return new ConsoleEmailProvider();
}

/**
 * Every e-mail goes through here: addresses on the block list are skipped and each
 * message is written to the send log (90 days). Logging never breaks a send.
 */
export class LoggedEmailProvider implements EmailProvider {
  constructor(private inner: EmailProvider) {}

  async send(message: EmailMessage): Promise<EmailSendResult> {
    const { meta, ...msg } = message;
    const to = asList(msg.to);
    const blocked = await blockedAmong(to);
    const allowed = to.filter((e) => !blocked.includes(e));
    if (to.length && !allowed.length) {
      await writeLog(message, { status: "blocked", provider: "none", error: `Bloqueado: ${blocked.join(", ")}` });
      return { ok: true, transport: "console", blocked, skipped: true };
    }
    const cc = asList(msg.cc).filter((e) => !blocked.includes(e));
    try {
      const out = await this.inner.send({ ...msg, to: allowed.length ? allowed : msg.to, cc: cc.length ? cc : undefined });
      await writeLog({ ...message, to: allowed }, { status: out.transport === "resend" ? "sent" : "console", provider: out.transport, providerId: out.id ?? null });
      return blocked.length ? { ...out, blocked } : out;
    } catch (error) {
      await writeLog(message, { status: "failed", provider: this.inner instanceof ResendEmailProvider ? "resend" : "console", error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }
}

async function blockedAmong(addresses: string[]): Promise<string[]> {
  if (!addresses.length) return [];
  try {
    const rows = await prisma.emailSuppression.findMany({ where: { email: { in: addresses } }, select: { email: true } });
    return rows.map((r) => r.email);
  } catch {
    return [];
  }
}

async function writeLog(message: EmailMessage, r: { status: string; provider: string; providerId?: string | null; error?: string }): Promise<void> {
  try {
    const meta = message.meta ?? {};
    const organizationId = meta.organizationId !== undefined ? meta.organizationId : (tenantStorage.getStore()?.organizationId ?? null);
    await prisma.platformEmailLog.create({
      data: {
        category: meta.category ?? "company",
        templateKey: meta.template ?? null,
        toEmail: asList(message.to).join(", ").slice(0, 500) || String(message.to).slice(0, 500),
        subject: String(message.subject || "").slice(0, 300),
        organizationId: organizationId || null,
        provider: r.provider,
        providerId: r.providerId ?? null,
        status: r.status,
        error: r.error ? r.error.slice(0, 500) : null,
        events: [{ type: r.status, at: new Date().toISOString() }],
      },
    });
  } catch (error) {
    console.error("[email] send log failed", error instanceof Error ? error.message : error);
  }
}

export function createEmailProvider(): EmailProvider {
  return new LoggedEmailProvider(rawProvider());
}

export const email = createEmailProvider();

/** Send only when a real transport is ready; otherwise return a clear error. */
export async function sendCustomerEmail(
  message: EmailMessage,
): Promise<{ ok: true; transport: string; id?: string } | { ok: false; error: string }> {
  const status = getEmailTransportStatus();
  if (!status.ready) {
    return {
      ok: false,
      error: status.note,
    };
  }
  try {
    // Recreate provider in case env changed at runtime (Railway restart still needed usually)
    const provider = createEmailProvider();
    const result = await provider.send(message);
    if (result.skipped && result.blocked) {
      return { ok: false, error: `Não enviamos: ${result.blocked.join(", ")} está bloqueado porque um e-mail anterior voltou ou foi marcado como spam. Confira o endereço.` };
    }
    return { ok: true, transport: result.transport, id: result.id };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Falha ao enviar e-mail",
    };
  }
}
