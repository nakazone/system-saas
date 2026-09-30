import { env } from "../../config/env.js";

export type EmailMessage = {
  to: string | string[];
  cc?: string | string[];
  subject: string;
  text: string;
  html?: string;
};

export type EmailSendResult = {
  ok: true;
  transport: "console" | "resend";
  id?: string;
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
    console.log(message.text);
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

export function createEmailProvider(): EmailProvider {
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
    return { ok: true, transport: result.transport, id: result.id };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Falha ao enviar e-mail",
    };
  }
}
