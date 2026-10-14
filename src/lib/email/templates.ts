import { prisma } from "../prisma.js";
import { env } from "../../config/env.js";
import { email as emailProvider, type EmailSendResult } from "./index.js";

/**
 * E-mails ObraMate sends to companies (Master › Comunicação › Modelos de e-mail).
 *
 * Each one has a default text in English and Portuguese, written here. The Master can
 * change subject, text and button label; the edit is stored in PlatformEmailTemplate and
 * "Restaurar padrão" deletes it. Text format:
 *   - {{variable}} is replaced (unknown names are flagged in the editor);
 *   - a blank line starts a new paragraph;
 *   - {{button}} on its own line is where the button goes (it opens {{link}});
 *   - a paragraph starting with "~ " is a small grey note.
 */

export type Locale = "en" | "pt";
export const LOCALES: { key: Locale; label: string }[] = [
  { key: "en", label: "Inglês" },
  { key: "pt", label: "Português" },
];

/** A value may differ by language (dates, "tomorrow" …). */
export type VarValue = string | number | { en: string; pt: string };
export type Vars = Record<string, VarValue>;

type Text = { subject: string; body: string; button?: string };
export type TemplateDef = {
  key: string;
  name: string;
  when: string;
  group: "Conta" | "Cobrança" | "Suporte";
  vars: { key: string; label: string; sample: VarValue }[];
  /** Must stay in the text (or the button) — e.g. the confirmation link. */
  required: string[];
  defaults: Record<Locale, Text>;
};

const NAME = { key: "name", label: "Primeiro nome", sample: "Maria" };
const COMPANY = { key: "company", label: "Empresa", sample: "Summit Floors LLC" };
const PRODUCT = { key: "product", label: "Nome do produto", sample: "ObraMate" };
const LINK = (label: string) => ({ key: "link", label, sample: "https://obramate.app/…" });
const DATE = { key: "date", label: "Data", sample: { en: "Oct 20, 2026", pt: "20 de out. de 2026" } };
const PLAN = { key: "plan", label: "Plano", sample: "Pro" };
const PRICE = { key: "price", label: "Valor", sample: { en: "$249.00/month", pt: "$249.00/mês" } };

export const TEMPLATES: TemplateDef[] = [
  {
    key: "signup_verify",
    name: "Confirmar e-mail do cadastro",
    when: "Logo depois que alguém se cadastra no site. Sem confirmar, a empresa não é criada.",
    group: "Conta",
    vars: [NAME, COMPANY, PRODUCT, LINK("Link de confirmação")],
    required: ["link"],
    defaults: {
      en: {
        subject: "Confirm your e-mail to create {{company}} on {{product}}",
        body: "Hi {{name}},\n\nConfirm your e-mail to finish creating the {{company}} workspace on {{product}}.\n\n{{button}}\n\n~ The link works for 48 hours. If you did not sign up, ignore this e-mail — nothing will be created.",
        button: "Confirm e-mail",
      },
      pt: {
        subject: "Confirme seu e-mail para criar {{company}} no {{product}}",
        body: "Olá, {{name}},\n\nConfirme seu e-mail para terminar de criar o espaço da {{company}} no {{product}}.\n\n{{button}}\n\n~ O link vale por 48 horas. Se você não se cadastrou, ignore este e-mail — nada será criado.",
        button: "Confirmar e-mail",
      },
    },
  },
  {
    key: "password_reset",
    name: "Redefinir senha",
    when: "Quando um usuário clica em “Esqueci a senha”.",
    group: "Conta",
    vars: [NAME, COMPANY, PRODUCT, LINK("Link para nova senha")],
    required: ["link"],
    defaults: {
      en: {
        subject: "Reset your {{product}} password",
        body: "Hi {{name}},\n\nWe received a request to reset your password for {{company}} on {{product}}.\n\n{{button}}\n\n~ The link works for 1 hour and only once. If you did not ask for this, ignore this e-mail — your password stays the same.",
        button: "Choose a new password",
      },
      pt: {
        subject: "Redefina sua senha do {{product}}",
        body: "Olá, {{name}},\n\nRecebemos um pedido para redefinir sua senha da {{company}} no {{product}}.\n\n{{button}}\n\n~ O link vale por 1 hora e uma única vez. Se não foi você, ignore este e-mail — sua senha continua a mesma.",
        button: "Escolher nova senha",
      },
    },
  },
  {
    key: "password_changed",
    name: "Senha alterada",
    when: "Depois que a senha muda pelo link. Avisa caso não tenha sido a pessoa.",
    group: "Conta",
    vars: [NAME, COMPANY, PRODUCT, { key: "when", label: "Data e hora", sample: { en: "Oct 14, 2026, 9:12 AM", pt: "14 de out. de 2026, 09:12" } }, { key: "ip", label: "IP", sample: "203.0.113.7" }],
    required: [],
    defaults: {
      en: {
        subject: "Your {{product}} password was changed",
        body: "Hi {{name}},\n\nThe password for your {{company}} account was changed on {{when}} (Mountain Time) from IP {{ip}}. You were signed out on all devices.\n\n~ If this was not you, reset your password right away and tell your company administrator.",
      },
      pt: {
        subject: "Sua senha do {{product}} foi alterada",
        body: "Olá, {{name}},\n\nA senha da sua conta na {{company}} foi alterada em {{when}} (horário de Denver) a partir do IP {{ip}}. Você saiu de todos os aparelhos.\n\n~ Se não foi você, redefina a senha agora e avise o administrador da empresa.",
      },
    },
  },
  {
    key: "support_access",
    name: "Suporte entrou na conta",
    when: "Para os administradores da empresa quando a equipe usa “Entrar como suporte”.",
    group: "Suporte",
    vars: [NAME, COMPANY, PRODUCT, { key: "staff", label: "Quem do suporte", sample: "Naka" }, { key: "when", label: "Data e hora", sample: { en: "Oct 14, 2026, 9:12 AM", pt: "14 de out. de 2026, 09:12" } }, { key: "reason", label: "Motivo", sample: "Ticket #12 — invoice total" }, { key: "minutes", label: "Minutos de acesso", sample: 30 }],
    required: [],
    defaults: {
      en: {
        subject: "{{product}} support accessed your workspace",
        body: "Hi {{name}},\n\n{{product}} support ({{staff}}) opened your {{company}} workspace on {{when}} (Mountain Time) to help you.\n\nReason: {{reason}}\nAccess: view only, up to {{minutes}} minutes. Payroll and employee pay are hidden from support.\n\n~ If you did not ask for help, reply to this e-mail and we will look into it right away.",
      },
      pt: {
        subject: "O suporte do {{product}} acessou sua conta",
        body: "Olá, {{name}},\n\nO suporte do {{product}} ({{staff}}) abriu a conta da {{company}} em {{when}} (horário de Denver) para ajudar você.\n\nMotivo: {{reason}}\nAcesso: só leitura, até {{minutes}} minutos. Folha e pagamentos dos funcionários ficam escondidos do suporte.\n\n~ Se você não pediu ajuda, responda este e-mail e vamos verificar na hora.",
      },
    },
  },
  {
    key: "trial_ending",
    name: "Teste grátis acabando",
    when: "Régua de cobrança: dias antes do fim do teste (dias em Planos e preços).",
    group: "Cobrança",
    vars: [NAME, COMPANY, DATE, { key: "ends_in", label: "Quando acaba", sample: { en: "in 3 days", pt: "em 3 dias" } }, LINK("Página de assinatura")],
    required: ["link"],
    defaults: {
      en: {
        subject: "Your ObraMate trial ends {{ends_in}}",
        body: "Hi {{name}},\n\nYour free trial for {{company}} ends on {{date}}. Subscribe to keep creating quotes, jobs and invoices.\n\n{{button}}\n\n~ After the trial your data stays safe and the account becomes read-only until you subscribe.",
        button: "Subscribe",
      },
      pt: {
        subject: "Seu teste do ObraMate acaba {{ends_in}}",
        body: "Olá, {{name}},\n\nO teste grátis da {{company}} acaba em {{date}}. Assine para continuar criando orçamentos, jobs e faturas.\n\n{{button}}\n\n~ Depois do teste seus dados ficam salvos e a conta fica só leitura até você assinar.",
        button: "Assinar",
      },
    },
  },
  {
    key: "trial_ended",
    name: "Teste grátis acabou",
    when: "Régua de cobrança: no dia em que o teste acaba e a conta fica só leitura.",
    group: "Cobrança",
    vars: [NAME, COMPANY, DATE, LINK("Página de assinatura")],
    required: ["link"],
    defaults: {
      en: {
        subject: "Your ObraMate trial has ended",
        body: "Hi {{name}},\n\nYour free trial for {{company}} ended on {{date}}. Your account is now read-only: you can see everything, but you can't create or edit until you subscribe.\n\n{{button}}",
        button: "Subscribe now",
      },
      pt: {
        subject: "Seu teste do ObraMate acabou",
        body: "Olá, {{name}},\n\nO teste grátis da {{company}} acabou em {{date}}. A conta agora está só leitura: dá para ver tudo, mas não criar nem editar até assinar.\n\n{{button}}",
        button: "Assinar agora",
      },
    },
  },
  {
    key: "renewal_soon",
    name: "Renovação chegando",
    when: "Régua de cobrança: antes da renovação, só para quem não tem cartão cadastrado.",
    group: "Cobrança",
    vars: [NAME, COMPANY, PLAN, PRICE, DATE],
    required: [],
    defaults: {
      en: {
        subject: "Your ObraMate plan renews soon",
        body: "Hi {{name}},\n\nYour ObraMate {{plan}} plan for {{company}} ({{price}}) renews on {{date}}. Reply to this e-mail if you need anything.",
      },
      pt: {
        subject: "Seu plano do ObraMate renova em breve",
        body: "Olá, {{name}},\n\nO plano {{plan}} do ObraMate da {{company}} ({{price}}) renova em {{date}}. Responda este e-mail se precisar de algo.",
      },
    },
  },
  {
    key: "payment_overdue",
    name: "Pagamento atrasado",
    when: "Régua de cobrança: quando o pagamento atrasa e nos lembretes seguintes.",
    group: "Cobrança",
    vars: [NAME, COMPANY, PLAN, PRICE, DATE, LINK("Página de pagamento")],
    required: ["link"],
    defaults: {
      en: {
        subject: "Your ObraMate payment is overdue",
        body: "Hi {{name}},\n\nWe couldn't collect the payment for {{company}} ({{plan}}, {{price}}), due on {{date}}. Please update your payment.\n\n{{button}}\n\n~ Your account becomes read-only if the payment is still open a few days from now.",
        button: "Update payment",
      },
      pt: {
        subject: "Seu pagamento do ObraMate está atrasado",
        body: "Olá, {{name}},\n\nNão conseguimos cobrar a {{company}} ({{plan}}, {{price}}), com vencimento em {{date}}. Atualize o pagamento, por favor.\n\n{{button}}\n\n~ A conta fica só leitura se o pagamento continuar em aberto nos próximos dias.",
        button: "Atualizar pagamento",
      },
    },
  },
  {
    key: "account_read_only",
    name: "Conta ficou só leitura",
    when: "Régua de cobrança: quando o pagamento continua em aberto e a conta trava edições.",
    group: "Cobrança",
    vars: [NAME, COMPANY, LINK("Página de pagamento")],
    required: ["link"],
    defaults: {
      en: {
        subject: "Your ObraMate account is now read-only",
        body: "Hi {{name}},\n\nThe payment for {{company}} is still open, so the account is now read-only. Your data is safe. Pay to unlock it right away.\n\n{{button}}",
        button: "Pay now",
      },
      pt: {
        subject: "Sua conta do ObraMate está só leitura",
        body: "Olá, {{name}},\n\nO pagamento da {{company}} continua em aberto, então a conta ficou só leitura. Seus dados estão salvos. Pague para liberar na hora.\n\n{{button}}",
        button: "Pagar agora",
      },
    },
  },
  {
    key: "account_suspended",
    name: "Conta suspensa",
    when: "Régua de cobrança: quando a conta é suspensa por falta de pagamento ou teste sem assinatura.",
    group: "Cobrança",
    vars: [NAME, COMPANY, { key: "reason", label: "Motivo", sample: { en: "the payment is still open", pt: "o pagamento continua em aberto" } }],
    required: [],
    defaults: {
      en: {
        subject: "Your ObraMate account was suspended",
        body: "Hi {{name}},\n\nAccess to {{company}} on ObraMate was suspended because {{reason}}. Your data is kept. Reply to this e-mail to restore access.",
      },
      pt: {
        subject: "Sua conta do ObraMate foi suspensa",
        body: "Olá, {{name}},\n\nO acesso da {{company}} ao ObraMate foi suspenso porque {{reason}}. Seus dados continuam guardados. Responda este e-mail para reativar.",
      },
    },
  },
];

TEMPLATES.push(
  {
    key: "trial_extended",
    name: "Teste estendido",
    when: "Quando o Master estende o teste e marca “avisar o dono por e-mail”.",
    group: "Cobrança",
    vars: [NAME, COMPANY, DATE],
    required: [],
    defaults: {
      en: { subject: "Your ObraMate trial was extended", body: "Hi {{name}},\n\nGood news: your ObraMate trial for {{company}} now runs until {{date}}.\n\n~ Reply to this e-mail if you need anything." },
      pt: { subject: "Seu teste do ObraMate foi estendido", body: "Olá, {{name}},\n\nBoa notícia: o teste do ObraMate da {{company}} agora vai até {{date}}.\n\n~ Responda este e-mail se precisar de algo." },
    },
  },
  {
    key: "due_date_changed",
    name: "Vencimento alterado",
    when: "Quando o Master muda o vencimento de uma empresa paga e marca “avisar o dono por e-mail”.",
    group: "Cobrança",
    vars: [NAME, COMPANY, DATE],
    required: [],
    defaults: {
      en: { subject: "Your ObraMate due date was updated", body: "Hi {{name}},\n\nYour ObraMate plan for {{company}} now runs until {{date}}.\n\n~ Reply to this e-mail if you need anything." },
      pt: { subject: "O vencimento do seu ObraMate mudou", body: "Olá, {{name}},\n\nO plano do ObraMate da {{company}} agora vai até {{date}}.\n\n~ Responda este e-mail se precisar de algo." },
    },
  },
  {
    key: "payment_link",
    name: "Link de pagamento",
    when: "Quando o Master gera o link de assinatura do Stripe na ficha da empresa.",
    group: "Cobrança",
    vars: [NAME, COMPANY, PLAN, PRICE, LINK("Link do Stripe")],
    required: ["link"],
    defaults: {
      en: {
        subject: "Subscribe to ObraMate — {{company}}",
        body: "Hi {{name}},\n\nHere is the secure link to subscribe to ObraMate ({{plan}}, {{price}}) for {{company}}.\n\n{{button}}\n\n~ The link expires in 24 hours. Reply to this e-mail if you have any questions.",
        button: "Subscribe securely",
      },
      pt: {
        subject: "Assine o ObraMate — {{company}}",
        body: "Olá, {{name}},\n\nAqui está o link seguro para assinar o ObraMate ({{plan}}, {{price}}) para a {{company}}.\n\n{{button}}\n\n~ O link vale por 24 horas. Responda este e-mail se tiver dúvidas.",
        button: "Assinar com segurança",
      },
    },
  },
  {
    key: "support_reply",
    name: "Resposta do suporte",
    when: "Quando alguém da equipe responde um ticket em Suporte.",
    group: "Suporte",
    vars: [NAME, { key: "subject", label: "Assunto do ticket", sample: "Invoice total looks wrong" }, { key: "message", label: "Resposta", sample: "We fixed the rounding — please check again." }, { key: "status_note", label: "Situação do ticket", sample: { en: "We marked the ticket as solved; replying opens it again.", pt: "Marcamos o ticket como resolvido; responder reabre." } }],
    required: ["message"],
    defaults: {
      en: { subject: "Re: {{subject}}", body: "Hi {{name}},\n\n{{message}}\n\n~ To reply, open Settings › Help & support in ObraMate. {{status_note}}" },
      pt: { subject: "Re: {{subject}}", body: "Olá, {{name}},\n\n{{message}}\n\n~ Para responder, abra Configurações › Ajuda e suporte no ObraMate. {{status_note}}" },
    },
  },
);

TEMPLATES.push(
  {
    key: "card_expiring",
    name: "Cartão vencendo",
    when: "15 dias antes de o cartão da assinatura vencer, quando ele vence antes da próxima cobrança.",
    group: "Cobrança",
    vars: [NAME, COMPANY, { key: "card", label: "Cartão", sample: "Visa •••• 4242" }, DATE, { key: "next_charge", label: "Próxima cobrança", sample: { en: "Nov 3, 2026", pt: "3 de nov. de 2026" } }, { key: "amount", label: "Valor", sample: "$299" }, LINK("Página do plano")],
    required: ["link"],
    defaults: {
      en: {
        subject: "Your card for ObraMate expires soon",
        body: "Hi {{name}},\n\nThe card on file for {{company}} ({{card}}) expires on {{date}}, before your next payment of {{amount}} on {{next_charge}}. Update it so your account keeps running without interruption.\n\n{{button}}\n\n~ In ObraMate, open Settings › Plan & billing and click \"Card, receipts and cancellation\".",
        button: "Update card",
      },
      pt: {
        subject: "O cartão do seu ObraMate vence em breve",
        body: "Olá, {{name}},\n\nO cartão cadastrado da {{company}} ({{card}}) vence em {{date}}, antes da próxima cobrança de {{amount}} em {{next_charge}}. Atualize para a conta continuar sem interrupção.\n\n{{button}}\n\n~ No ObraMate, abra Configurações › Plano e cobrança e clique em \"Cartão, recibos e cancelamento\".",
        button: "Atualizar cartão",
      },
    },
  },
  {
    key: "cancel_confirmed",
    name: "Cancelamento confirmado",
    when: "Para o administrador que cancelou a assinatura pelo ObraMate.",
    group: "Cobrança",
    vars: [NAME, COMPANY, DATE, LINK("Página do plano")],
    required: [],
    defaults: {
      en: {
        subject: "Your ObraMate subscription was canceled",
        body: "Hi {{name}},\n\nWe canceled the ObraMate subscription for {{company}}. You keep full access until {{date}} and you won't be charged again.\n\nChanged your mind? You can keep your subscription any time before that date.\n\n{{button}}\n\n~ After that date your data stays saved for 90 days in case you come back.",
        button: "Keep my subscription",
      },
      pt: {
        subject: "Sua assinatura do ObraMate foi cancelada",
        body: "Olá, {{name}},\n\nCancelamos a assinatura do ObraMate da {{company}}. Você continua com acesso completo até {{date}} e não será cobrado de novo.\n\nMudou de ideia? Dá para manter a assinatura a qualquer momento antes dessa data.\n\n{{button}}\n\n~ Depois dessa data seus dados ficam guardados por 90 dias, caso você volte.",
        button: "Manter minha assinatura",
      },
    },
  },
);

export const TEMPLATE_KEYS = TEMPLATES.map((t) => t.key);
export function templateDef(key: string): TemplateDef | undefined {
  return TEMPLATES.find((t) => t.key === key);
}

/* ───────────────────────── stored edits ───────────────────────── */

type Override = { subject: string; body: string; buttonLabel: string | null; updatedByName: string; updatedAt: Date };
let cache: { at: number; rows: Map<string, Override> } | null = null;

export async function overrides(): Promise<Map<string, Override>> {
  if (cache && Date.now() - cache.at < 30_000) return cache.rows;
  const rows = await prisma.platformEmailTemplate.findMany().catch(() => []);
  cache = { at: Date.now(), rows: new Map(rows.map((r) => [`${r.key}:${r.locale}`, r])) };
  return cache.rows;
}
export function clearTemplateCache(): void {
  cache = null;
}

/** Text in use for a template + language (edit or default). */
export async function activeText(key: string, locale: Locale): Promise<Text & { edited: boolean; updatedByName?: string; updatedAt?: Date }> {
  const def = templateDef(key);
  if (!def) throw new Error(`Unknown e-mail template ${key}`);
  const o = (await overrides()).get(`${key}:${locale}`);
  if (o) return { subject: o.subject, body: o.body, button: o.buttonLabel ?? undefined, edited: true, updatedByName: o.updatedByName, updatedAt: o.updatedAt };
  return { ...def.defaults[locale], edited: false };
}

/* ───────────────────────── language ───────────────────────── */

const LOCALE_KEY = "platform.email_locale";
export type LocaleMode = "en" | "company";

export async function getLocaleMode(): Promise<LocaleMode> {
  const row = await prisma.systemSetting.findUnique({ where: { key: LOCALE_KEY } }).catch(() => null);
  return row?.value === "company" ? "company" : "en";
}
export async function setLocaleMode(mode: LocaleMode): Promise<void> {
  await prisma.systemSetting.upsert({ where: { key: LOCALE_KEY }, create: { key: LOCALE_KEY, value: mode }, update: { value: mode } });
}

/** English by default; Portuguese only when the Master chose "language of the company" and the company uses pt. */
export async function localeFor(organizationId: string | null | undefined): Promise<Locale> {
  if (!organizationId || (await getLocaleMode()) !== "company") return "en";
  const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { defaultLocale: true } }).catch(() => null);
  return org?.defaultLocale?.toLowerCase().startsWith("pt") ? "pt" : "en";
}

/* ───────────────────────── rendering ───────────────────────── */

const VAR_RE = /\{\{\s*([a-z_]+)\s*\}\}/g;

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function valueOf(v: VarValue | undefined, locale: Locale): string | undefined {
  if (v == null) return undefined;
  if (typeof v === "object") return v[locale];
  return String(v);
}

/** Variable names used in a text that the template does not offer. */
export function unknownVars(def: TemplateDef, ...texts: (string | undefined)[]): string[] {
  const known = new Set([...def.vars.map((v) => v.key), "button"]);
  const out = new Set<string>();
  for (const t of texts) for (const m of String(t || "").matchAll(VAR_RE)) if (!known.has(m[1])) out.add(m[1]);
  return [...out];
}

/** Required variables (like the link) missing from the text — the e-mail would be useless without them. */
export function missingRequired(def: TemplateDef, text: Text): string[] {
  const all = `${text.subject}\n${text.body}`;
  return def.required.filter((r) => {
    if (new RegExp(`\\{\\{\\s*${r}\\s*\\}\\}`).test(all)) return false;
    // {{link}} is carried by the button.
    if (r === "link" && text.button?.trim() && /\{\{\s*button\s*\}\}/.test(text.body)) return false;
    return true;
  });
}

export type Rendered = { subject: string; text: string; html: string };

export function render(text: Text, vars: Vars, locale: Locale): Rendered {
  const sub = (s: string, html: boolean) =>
    s.replace(VAR_RE, (whole, name: string) => {
      if (name === "button") return whole;
      const v = valueOf(vars[name], locale);
      if (v == null) return whole;
      return html ? esc(v).replace(/\n/g, "<br>") : v;
    });
  const link = valueOf(vars.link, locale) || "";
  const button = text.button?.trim() || "";
  const paras = text.body.replace(/\r\n/g, "\n").split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);

  const textParts: string[] = [];
  const htmlParts: string[] = [];
  let buttonPlaced = false;
  for (const p of paras) {
    if (/^\{\{\s*button\s*\}\}$/.test(p)) {
      if (button && link) {
        buttonPlaced = true;
        textParts.push(`${button}: ${link}`);
        htmlParts.push(
          `<p style="margin:0 0 22px"><a href="${esc(link)}" style="display:inline-block;background:#211d1a;color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;padding:12px 20px;border-radius:10px">${esc(button)}</a></p>`,
        );
      }
      continue;
    }
    const note = p.startsWith("~ ");
    const raw = note ? p.slice(2) : p;
    textParts.push(sub(raw, false));
    // Escape the author's text first, then drop in the (escaped) values.
    const htmlText = raw
      .split("\n")
      .map((line) => sub(esc(line), true))
      .join("<br>");
    htmlParts.push(
      note
        ? `<p style="margin:0 0 12px;font-size:13px;line-height:1.55;color:#6e655c">${htmlText}</p>`
        : `<p style="margin:0 0 14px;font-size:16px;line-height:1.55;color:#211d1a">${htmlText}</p>`,
    );
  }
  // Link with no {{button}} line: still give the reader a way in.
  if (!buttonPlaced && button && link && !paras.some((p) => p.includes(link))) {
    textParts.push(`${button}: ${link}`);
    htmlParts.push(`<p style="margin:0 0 22px"><a href="${esc(link)}" style="display:inline-block;background:#211d1a;color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;padding:12px 20px;border-radius:10px">${esc(button)}</a></p>`);
  }
  textParts.push(`— ${env.PRODUCT_NAME}`);

  const html = `<!doctype html><html><body style="margin:0;padding:0;background:#f7f4ee">
<div style="background:#f7f4ee;padding:28px 12px;font-family:-apple-system,'Segoe UI',Helvetica,Arial,sans-serif">
  <div style="max-width:560px;margin:0 auto">
    <div style="padding:0 4px 14px;font-size:17px;font-weight:800;color:#211d1a;letter-spacing:-.01em"><span style="display:inline-block;width:22px;height:22px;border-radius:6px;background:#c1652f;vertical-align:-5px;margin-right:8px"></span>${esc(env.PRODUCT_NAME)}</div>
    <div style="background:#ffffff;border-radius:16px;padding:28px 26px 16px;box-shadow:0 1px 0 #e2d9cc">${htmlParts.join("\n")}</div>
    <div style="padding:14px 4px 0;font-size:12px;color:#8a8076">${esc(env.PRODUCT_NAME)} · ${locale === "pt" ? "sistema para empresas de pisos" : "software for flooring businesses"}</div>
  </div>
</div></body></html>`;
  return { subject: sub(text.subject, false).replace(/\s+/g, " ").trim(), text: textParts.join("\n\n"), html };
}

/** Sample values for the editor preview and test e-mails. */
export function sampleVars(def: TemplateDef): Vars {
  const out: Vars = { product: env.PRODUCT_NAME };
  for (const v of def.vars) out[v.key] = v.key === "product" ? env.PRODUCT_NAME : v.sample;
  out.link = `${env.APP_BASE_URL.replace(/\/$/, "")}/`;
  return out;
}

/* ───────────────────────── sending ───────────────────────── */

export async function sendPlatformEmail(
  key: string,
  opts: { to: string; organizationId?: string | null; locale?: Locale; vars: Vars; replyTo?: string },
): Promise<EmailSendResult> {
  const def = templateDef(key);
  if (!def) throw new Error(`Unknown e-mail template ${key}`);
  const locale = opts.locale ?? (await localeFor(opts.organizationId));
  const text = await activeText(key, locale);
  const out = render(text, { product: env.PRODUCT_NAME, ...opts.vars }, locale);
  return emailProvider.send({
    to: opts.to,
    subject: out.subject,
    text: out.text,
    html: out.html,
    replyTo: opts.replyTo,
    meta: { category: "platform", template: key, organizationId: opts.organizationId ?? null },
  });
}

/* ───────────────────────── helpers for callers ───────────────────────── */

const LOCALE_TAG: Record<Locale, string> = { en: "en-US", pt: "pt-BR" };

/** Date in both languages (platform time zone). */
export function dateVar(d: Date): { en: string; pt: string } {
  const f = (l: Locale) => d.toLocaleDateString(LOCALE_TAG[l], { timeZone: "America/Denver", day: "numeric", month: "short", year: "numeric" });
  return { en: f("en"), pt: f("pt") };
}
export function dateTimeVar(d: Date): { en: string; pt: string } {
  const f = (l: Locale) => d.toLocaleString(LOCALE_TAG[l], { timeZone: "America/Denver", dateStyle: "medium", timeStyle: "short" });
  return { en: f("en"), pt: f("pt") };
}
export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || name;
}
