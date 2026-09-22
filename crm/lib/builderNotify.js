import { sendQuoteEmail } from '../modules/quotes/quoteMail.js';

/** Notificação simples (sem PDF) para builders ou equipa SF. */
export async function sendBuilderNotification({ to, subject, html }) {
  if (!to) return { ok: false, skipped: true };
  return sendQuoteEmail({
    to,
    subject,
    html,
    pdfBuffer: undefined,
  });
}

export function adminNotifyEmail() {
  return (
    process.env.BUILDER_NOTIFY_EMAIL?.trim() ||
    process.env.CRM_FROM_EMAIL?.trim() ||
    process.env.RESEND_FROM_EMAIL?.trim() ||
    ''
  );
}
