/**
 * Quote e-mail: Resend (API) ou SMTP (fallback).
 *
 * Resend: RESEND_API_KEY + RESEND_FROM_EMAIL (ou CRM_FROM_EMAIL como remetente).
 * SMTP: SMTP_HOST, SMTP_USER, SMTP_PASS, opcional SMTP_PORT (587), SMTP_SECURE, SMTP_FROM.
 */
import nodemailer from 'nodemailer';

function normalizeRecipient(to) {
  if (to == null) return '';
  const s = String(to).trim();
  if (!s) return '';
  if (s.includes(',')) return s.split(',')[0].trim();
  return s;
}

/** Lista de e-mails válidos (to/cc), sem duplicados. */
export function normalizeEmailList(raw) {
  if (raw == null || raw === '') return [];
  const parts = Array.isArray(raw)
    ? raw
    : String(raw)
        .split(/[,;\s]+/)
        .map((s) => s.trim())
        .filter(Boolean);
  const out = [];
  const seen = new Set();
  for (const p of parts) {
    const e = String(p).trim().toLowerCase();
    if (!e || !e.includes('@') || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) continue;
    if (seen.has(e)) continue;
    seen.add(e);
    out.push(e);
  }
  return out;
}

function isSmtpFallbackEnabled() {
  const v = (process.env.EMAIL_SMTP_FALLBACK || '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

/** Diagnóstico sem segredos (healthcheck / CRM). */
export function getEmailTransportStatus() {
  const hasResendKey = !!process.env.RESEND_API_KEY?.trim();
  const hasResendFrom = !!(process.env.RESEND_FROM_EMAIL || process.env.CRM_FROM_EMAIL)?.trim();
  const resend = hasResendKey && hasResendFrom;
  const smtp = !!(
    process.env.SMTP_HOST?.trim() &&
    process.env.SMTP_USER?.trim() &&
    process.env.SMTP_PASS?.trim()
  );
  const smtpFallback = isSmtpFallbackEnabled();
  const primary = resend ? 'resend' : smtp ? 'smtp' : null;
  let note;
  if (resend && smtp && !smtpFallback) {
    note =
      'Resend é o transporte principal. SMTP no Railway é ignorado (remova SMTP_* ou defina EMAIL_SMTP_FALLBACK=true para backup).';
  } else if (resend && smtp && smtpFallback) {
    note = 'Resend primeiro; se falhar, tenta SMTP (EMAIL_SMTP_FALLBACK=true).';
  }
  return {
    resend,
    smtp,
    ready: resend || smtp,
    primary,
    smtp_fallback: smtpFallback,
    note,
  };
}

async function sendViaResend({
  to,
  cc,
  from,
  subject,
  html,
  pdfBuffer,
  filename = 'Senior-Floors-Quote.pdf',
}) {
  const key = process.env.RESEND_API_KEY?.trim();
  const fromAddr = (process.env.RESEND_FROM_EMAIL || process.env.CRM_FROM_EMAIL || '').trim();
  if (!key || !fromAddr) {
    return { ok: false, error: 'RESEND_API_KEY and RESEND_FROM_EMAIL (or CRM_FROM_EMAIL) required' };
  }

  const attachments = pdfBuffer
    ? [
        {
          filename,
          content: Buffer.isBuffer(pdfBuffer) ? pdfBuffer.toString('base64') : String(pdfBuffer),
        },
      ]
    : [];

  const toList = normalizeEmailList(to);
  if (!toList.length) {
    return { ok: false, error: 'Recipient email required' };
  }
  const primary = toList[0];
  const ccList = normalizeEmailList(cc).filter((e) => e !== primary);

  const body = {
    from: from || fromAddr,
    to: toList,
    subject: subject || 'Your flooring quote from Senior Floors',
    html:
      html ||
      `<p>Hello,</p><p>Please find your quote attached.</p><p>— Senior Floors</p>`,
    attachments: attachments.length ? attachments : undefined,
  };
  if (ccList.length) body.cc = ccList;

  const replyTo = process.env.RESEND_REPLY_TO?.trim() || process.env.CRM_REPLY_TO?.trim();
  if (replyTo) body.reply_to = replyTo;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const raw = json.message || json.name || res.statusText || 'Resend error';
    return {
      ok: false,
      error: formatEmailSendError(raw),
      details: json,
      transport: 'resend',
    };
  }
  return { ok: true, id: json.id, transport: 'resend' };
}

/** Mensagem legível para o utilizador (sem jargão SMTP bruto). */
export function formatEmailSendError(raw) {
  const msg = String(raw || '').trim();
  const lower = msg.toLowerCase();
  if (
    lower.includes('badcredentials') ||
    lower.includes('username and password not accepted') ||
    lower.includes('535') ||
    lower.includes('invalid login')
  ) {
    return (
      'O Gmail recusou o utilizador ou a palavra-passe SMTP. No Railway, use uma App Password do Google ' +
      '(não a palavra-passe normal da conta): Conta Google → Segurança → Verificação em 2 passos → Palavras-passe de app. ' +
      'Defina SMTP_USER=com o e-mail completo e SMTP_PASS=só a app password (16 caracteres, sem espaços). ' +
      'Alternativa: configure RESEND_API_KEY + RESEND_FROM_EMAIL (ver env.example).'
    );
  }
  if (lower.includes('e-mail não configurado') || lower.includes('not configured')) {
    return msg;
  }
  if (
    lower.includes('only send testing emails') ||
    lower.includes('testing emails to your own') ||
    lower.includes('onboarding@resend.dev')
  ) {
    return (
      'Conta Resend em modo de testes: só pode enviar para o e-mail da sua conta Resend, ou use remetente ' +
      'onboarding@resend.dev até verificar o domínio em resend.com/domains. Depois use RESEND_FROM_EMAIL com um e-mail desse domínio.'
    );
  }
  if (
    lower.includes('domain') &&
    (lower.includes('verify') || lower.includes('verified') || lower.includes('not found'))
  ) {
    return (
      'O domínio em RESEND_FROM_EMAIL não está verificado no Resend. Em resend.com/domains adicione o domínio, ' +
      'configure DNS e use um remetente desse domínio (ex.: quotes@seudominio.com).'
    );
  }
  if (lower.includes('invalid') && lower.includes('from')) {
    return (
      'Remetente inválido em RESEND_FROM_EMAIL. Use o formato "Nome <email@dominio-verificado.com>" com domínio já verificado no Resend.'
    );
  }
  if (lower.includes('api key') || lower.includes('unauthorized') || lower.includes('invalid key')) {
    return 'RESEND_API_KEY inválida ou revogada. Crie uma nova chave em resend.com/api-keys e atualize no Railway.';
  }
  return msg.length > 320 ? `${msg.slice(0, 317)}…` : msg;
}

async function sendViaSmtp({
  to,
  cc,
  subject,
  html,
  pdfBuffer,
  filename = 'Senior-Floors-Quote.pdf',
}) {
  const host = process.env.SMTP_HOST?.trim();
  const user = process.env.SMTP_USER?.trim();
  const passRaw = process.env.SMTP_PASS?.trim();
  const pass = passRaw ? passRaw.replace(/\s+/g, '') : '';
  if (!host || !user || !pass) {
    return { ok: false, error: 'SMTP_HOST, SMTP_USER and SMTP_PASS required' };
  }

  const port = parseInt(process.env.SMTP_PORT || '587', 10) || 587;
  const secure =
    process.env.SMTP_SECURE === '1' ||
    process.env.SMTP_SECURE === 'true' ||
    String(port) === '465';

  const from =
    process.env.SMTP_FROM?.trim() ||
    process.env.CRM_FROM_EMAIL?.trim() ||
    `"Senior Floors" <${user}>`;

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
    tls: { rejectUnauthorized: process.env.SMTP_TLS_REJECT_UNAUTHORIZED !== 'false' },
  });

  const attachments = pdfBuffer
    ? [
        {
          filename,
          content: Buffer.isBuffer(pdfBuffer) ? pdfBuffer : Buffer.from(pdfBuffer),
          contentType: 'application/pdf',
        },
      ]
    : [];

  const toList = normalizeEmailList(to);
  if (!toList.length) {
    return { ok: false, error: 'Recipient email required' };
  }
  const primary = toList[0];
  const ccList = normalizeEmailList(cc).filter((e) => e !== primary);

  try {
    const info = await transporter.sendMail({
      from,
      to: toList.join(', '),
      cc: ccList.length ? ccList.join(', ') : undefined,
      subject: subject || 'Your flooring quote from Senior Floors',
      html:
        html ||
        `<p>Hello,</p><p>Please find your quote attached.</p><p>— Senior Floors</p>`,
      attachments,
    });

    return {
      ok: true,
      id: info.messageId || `smtp-${Date.now()}`,
      transport: 'smtp',
    };
  } catch (e) {
    const raw = e && e.message ? e.message : String(e);
    console.error('[quoteMail] SMTP send failed:', raw);
    return { ok: false, error: formatEmailSendError(raw), details: { code: e.code, response: e.response } };
  }
}

/**
 * @param {object} opts
 * @param {string} opts.to
 * @param {string} [opts.subject]
 * @param {string} [opts.html]
 * @param {Buffer} [opts.pdfBuffer]
 * @param {string} [opts.filename]
 * @param {string} [opts.publicUrl] — incluído no HTML quando html não é passado (legado)
 */
export async function sendQuoteEmail({
  to,
  cc,
  subject,
  html,
  pdfBuffer,
  filename = 'Senior-Floors-Quote.pdf',
  publicUrl,
}) {
  const recipient = normalizeRecipient(to);
  if (!recipient) {
    return { ok: false, error: 'Recipient email required' };
  }
  const ccList = normalizeEmailList(cc).filter((e) => e !== recipient.toLowerCase());

  const defaultHtml = publicUrl
    ? `<p>Hello,</p><p>Your quote is ready. <a href="${publicUrl}">View your quote online</a> (full details and PDF are only available on this secure link).</p><p>— Senior Floors</p>`
    : `<p>Hello,</p><p>Your quote is ready. Please contact Senior Floors for your secure link.</p><p>— Senior Floors</p>`;

  const finalHtml = html != null && String(html).trim() !== '' ? html : defaultHtml;

  const { resend, smtp, ready } = getEmailTransportStatus();
  if (!ready) {
    return {
      ok: false,
      error:
        'E-mail não configurado no servidor. Defina RESEND_API_KEY + RESEND_FROM_EMAIL, ou SMTP_HOST + SMTP_USER + SMTP_PASS (ver env.example). Teste GET /api/health/email.',
    };
  }

  const smtpPayload = {
    to: recipient,
    cc: ccList,
    subject,
    html: finalHtml,
    pdfBuffer,
    filename,
  };

  if (resend) {
    const out = await sendViaResend({
      to: recipient,
      cc: ccList,
      from: undefined,
      subject,
      html: finalHtml,
      pdfBuffer,
      filename,
    });
    if (out.ok) return out;
    const allowSmtpFallback = smtp && isSmtpFallbackEnabled();
    if (!allowSmtpFallback) {
      return out;
    }
    console.warn('[quoteMail] Resend falhou, EMAIL_SMTP_FALLBACK ativo — a tentar SMTP:', out.error);
  }

  return sendViaSmtp(smtpPayload);
}
