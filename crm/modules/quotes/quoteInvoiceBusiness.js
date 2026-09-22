/**
 * Client invoices issued from approved quotes.
 */
import { buildInvoicePdfBuffer } from './invoicePdf.js';
import { loadQuoteContext } from './quoteBusiness.js';
import { sendQuoteEmail } from './quoteMail.js';
import { canonicalQuoteNumber } from '../../lib/quoteNumber.js';

function isQuoteApproved(status) {
  return ['approved', 'accepted'].includes(String(status || '').trim().toLowerCase());
}

function roundMoney(n) {
  return Math.round(Number(n) * 100) / 100;
}

function defaultDueDate(days = 14) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

async function nextInvoiceNumberForQuote(pool, quoteNumber) {
  const base = canonicalQuoteNumber(quoteNumber);
  if (!base) {
    throw new Error('Numero do orcamento invalido. O orcamento precisa de um numero SF-YYYY-NNNN.');
  }
  const prefix = `${base}-I`;
  const [rows] = await pool.query(
    `SELECT invoice_number FROM quote_invoices
     WHERE invoice_number LIKE ?
     ORDER BY id DESC LIMIT 1`,
    [`${prefix}%`]
  );
  let seq = 1;
  if (rows.length) {
    const m = String(rows[0].invoice_number || '').match(/-I(\d+)$/i);
    if (m) seq = parseInt(m[1], 10) + 1;
  }
  return `${prefix}${String(seq).padStart(2, '0')}`;
}

function mapInvoiceRow(r) {
  const amount = Number(r.amount) || 0;
  let paid_amount = r.paid_amount != null ? roundMoney(r.paid_amount) : 0;
  if (paid_amount <= 0 && String(r.status || '').toLowerCase() === 'paid') {
    paid_amount = amount;
  }
  const remaining_amount = roundMoney(Math.max(0, amount - paid_amount));
  return {
    id: r.id,
    quote_id: r.quote_id,
    project_id: r.project_id,
    customer_id: r.customer_id,
    invoice_number: r.invoice_number,
    invoice_type: r.invoice_type,
    amount,
    paid_amount,
    remaining_amount,
    quote_total: r.quote_total != null ? Number(r.quote_total) : null,
    due_date: r.due_date,
    status: r.status,
    payment_instructions: r.payment_instructions,
    notes: r.notes,
    email_sent_at: r.email_sent_at,
    paid_at: r.paid_at,
    created_at: r.created_at,
    has_pdf: !!(r.pdf_blob && r.pdf_blob.length),
    pdf_url: `/api/quote-invoices/${r.id}/pdf`,
  };
}

/**
 * Saldo a faturar = total do orçamento − soma dos invoices ativos (não void).
 * Ex.: quote $16000 + invoice $8000 → remaining $8000.
 */
export async function getQuoteInvoiceBalance(pool, quoteId, quoteTotal) {
  const [rows] = await pool.query(
    `SELECT COALESCE(SUM(amount), 0) AS invoiced
     FROM quote_invoices
     WHERE quote_id = ? AND LOWER(COALESCE(status, '')) != 'void'`,
    [quoteId]
  );
  const quote_total = roundMoney(quoteTotal);
  const invoiced_total = roundMoney(rows[0]?.invoiced || 0);
  const remaining_to_invoice = roundMoney(Math.max(0, quote_total - invoiced_total));
  return {
    quote_total,
    invoiced_total,
    remaining_to_invoice,
  };
}

export async function listInvoicesForQuote(pool, quoteId) {
  const [rows] = await pool.query(
    `SELECT qi.id, qi.quote_id, qi.project_id, qi.customer_id, qi.invoice_number, qi.invoice_type,
            qi.amount, qi.quote_total, qi.due_date, qi.status, qi.payment_instructions, qi.notes,
            qi.email_sent_at, qi.paid_at, qi.created_at,
            (qi.pdf_blob IS NOT NULL AND LENGTH(qi.pdf_blob) > 0) AS has_pdf,
            COALESCE((
              SELECT SUM(r.amount) FROM invoice_payment_receipts r WHERE r.invoice_id = qi.id
            ), 0) AS paid_amount
     FROM quote_invoices qi
     WHERE qi.quote_id = ?
     ORDER BY qi.created_at DESC, qi.id DESC`,
    [quoteId]
  );
  const invoices = rows.map((r) => ({
    ...mapInvoiceRow({ ...r, pdf_blob: r.has_pdf ? Buffer.from([1]) : null }),
    has_pdf: !!r.has_pdf,
  }));

  let quoteTotal = 0;
  if (invoices.length && invoices[0].quote_total != null) {
    quoteTotal = Number(invoices[0].quote_total) || 0;
  } else {
    const ctx = await loadQuoteContext(pool, quoteId);
    quoteTotal = Number(ctx?.quote?.total_amount) || 0;
  }
  const balance = await getQuoteInvoiceBalance(pool, quoteId, quoteTotal);
  return { invoices, balance };
}

/**
 * Lista global de invoices. Por omissão só enviados (status sent/paid ou email_sent_at).
 * @param {object} pool
 * @param {{ status?: string, q?: string, page?: number, limit?: number }} opts
 */
export async function listAllQuoteInvoices(pool, opts = {}) {
  const page = Math.max(1, parseInt(opts.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(opts.limit, 10) || 25));
  const offset = (page - 1) * limit;
  const statusRaw = String(opts.status || 'sent').trim().toLowerCase();
  const q = String(opts.q || '').trim();

  const where = ['1=1'];
  const params = [];

  if (statusRaw === 'sent') {
    where.push(
      `(LOWER(COALESCE(qi.status, '')) IN ('sent', 'paid') OR qi.email_sent_at IS NOT NULL)`
    );
  } else if (statusRaw === 'paid') {
    where.push(`LOWER(COALESCE(qi.status, '')) = 'paid'`);
  } else if (statusRaw === 'issued') {
    where.push(`LOWER(COALESCE(qi.status, '')) = 'issued'`);
  } else if (statusRaw === 'all') {
    where.push(`LOWER(COALESCE(qi.status, '')) != 'void'`);
  } else if (statusRaw) {
    where.push(`LOWER(COALESCE(qi.status, '')) = ?`);
    params.push(statusRaw);
  }

  if (q) {
    const like = `%${q.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_')}%`;
    where.push(
      `(qi.invoice_number LIKE ? OR q.quote_number LIKE ? OR c.name LIKE ? OR l.name LIKE ? OR c.email LIKE ?)`
    );
    params.push(like, like, like, like, like);
  }

  const whereSql = where.join(' AND ');

  const [[countRow]] = await pool.query(
    `SELECT COUNT(*) AS total, COALESCE(SUM(qi.amount), 0) AS total_amount
     FROM quote_invoices qi
     LEFT JOIN quotes q ON q.id = qi.quote_id
     LEFT JOIN customers c ON c.id = COALESCE(qi.customer_id, q.customer_id)
     LEFT JOIN leads l ON l.id = q.lead_id
     WHERE ${whereSql}`,
    params
  );

  const [rows] = await pool.query(
    `SELECT qi.id, qi.quote_id, qi.project_id, qi.customer_id, qi.invoice_number, qi.invoice_type,
            qi.amount, qi.quote_total, qi.due_date, qi.status, qi.payment_instructions, qi.notes,
            qi.email_sent_at, qi.paid_at, qi.created_at,
            (qi.pdf_blob IS NOT NULL AND LENGTH(qi.pdf_blob) > 0) AS has_pdf,
            COALESCE((
              SELECT SUM(r.amount) FROM invoice_payment_receipts r WHERE r.invoice_id = qi.id
            ), 0) AS paid_amount,
            q.quote_number,
            COALESCE(c.name, l.name) AS customer_name,
            COALESCE(c.email, l.email) AS customer_email
     FROM quote_invoices qi
     LEFT JOIN quotes q ON q.id = qi.quote_id
     LEFT JOIN customers c ON c.id = COALESCE(qi.customer_id, q.customer_id)
     LEFT JOIN leads l ON l.id = q.lead_id
     WHERE ${whereSql}
     ORDER BY COALESCE(qi.email_sent_at, qi.created_at) DESC, qi.id DESC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );

  const data = rows.map((r) => ({
    ...mapInvoiceRow({ ...r, pdf_blob: r.has_pdf ? Buffer.from([1]) : null }),
    has_pdf: !!r.has_pdf,
    quote_number: r.quote_number || null,
    customer_name: r.customer_name || null,
    customer_email: r.customer_email || null,
  }));

  return {
    data,
    total: Number(countRow?.total || 0),
    total_amount: Number(countRow?.total_amount || 0),
    page,
    limit,
  };
}

/**
 * @param {number} quoteTotal
 * @param {object} body
 * @param {number} remainingToInvoice
 */
function resolveInvoiceAmount(quoteTotal, body, remainingToInvoice) {
  const total = roundMoney(quoteTotal);
  const remaining =
    remainingToInvoice != null && Number.isFinite(Number(remainingToInvoice))
      ? roundMoney(remainingToInvoice)
      : total;
  const type = String(body.invoice_type || body.amount_type || 'deposit').toLowerCase();

  if (type === 'final' || type === 'remaining') {
    if (remaining <= 0) throw new Error('Não há saldo restante a faturar neste orçamento.');
    return { invoice_type: 'final', amount: remaining };
  }
  if (type === 'full') return { invoice_type: 'full', amount: total };
  if (type === 'progress') {
    const raw = body.custom_amount ?? body.amount;
    const hasCustom = raw != null && String(raw).trim() !== '';
    const amt = roundMoney(raw);
    if (hasCustom && amt > 0) return { invoice_type: 'progress', amount: amt };
    return { invoice_type: 'progress', amount: remaining > 0 ? remaining : total };
  }
  if (type === 'custom' || type === 'other') {
    const amt = roundMoney(body.custom_amount ?? body.amount);
    if (amt <= 0) throw new Error('Indique o valor do invoice.');
    return { invoice_type: type === 'other' ? 'other' : 'other', amount: amt };
  }
  const pct = Math.min(100, Math.max(1, parseInt(body.deposit_pct, 10) || 50));
  return { invoice_type: 'deposit', amount: roundMoney(total * (pct / 100)) };
}

export async function createQuoteInvoice(pool, quoteId, body, userId) {
  const ctx = await loadQuoteContext(pool, quoteId);
  if (!ctx) return { ok: false, error: 'Quote not found' };
  if (!isQuoteApproved(ctx.quote.status)) {
    return {
      ok: false,
      error:
        'Só é possível emitir invoice quando o orçamento está aprovado. Guarde o orçamento com status Aprovado.',
    };
  }

  const quoteTotal = Number(ctx.quote.total_amount) || 0;
  if (quoteTotal <= 0) return { ok: false, error: 'O orçamento não tem valor total.' };

  const balance = await getQuoteInvoiceBalance(pool, quoteId, quoteTotal);
  if (balance.remaining_to_invoice <= 0) {
    return {
      ok: false,
      error: 'Este orçamento já está totalmente faturado. Não há saldo restante.',
      balance,
    };
  }

  let resolved;
  try {
    resolved = resolveInvoiceAmount(quoteTotal, body, balance.remaining_to_invoice);
  } catch (e) {
    return { ok: false, error: e.message };
  }
  if (resolved.amount <= 0) return { ok: false, error: 'Valor do invoice inválido.' };

  if (resolved.amount > balance.remaining_to_invoice + 0.009) {
    return {
      ok: false,
      error: `O valor ($${resolved.amount.toFixed(2)}) excede o saldo restante ($${balance.remaining_to_invoice.toFixed(2)}).`,
      balance,
    };
  }

  const quoteNum = ctx.quote.quote_number;
  if (!quoteNum || !String(quoteNum).trim()) {
    return { ok: false, error: 'Orçamento sem número. Guarde o orçamento antes de emitir invoice.' };
  }

  let invoiceNumber;
  try {
    invoiceNumber = await nextInvoiceNumberForQuote(pool, quoteNum);
  } catch (e) {
    return { ok: false, error: e.message || 'Não foi possível gerar o número do invoice.' };
  }

  const dueDate = body.due_date ? String(body.due_date).slice(0, 10) : defaultDueDate(14);
  const paymentInstructions =
    body.payment_instructions != null && String(body.payment_instructions).trim()
      ? String(body.payment_instructions).trim()
      : null;
  const notes = body.notes != null && String(body.notes).trim() ? String(body.notes).trim() : null;

  const [ins] = await pool.execute(
    `INSERT INTO quote_invoices
      (quote_id, project_id, customer_id, invoice_number, invoice_type, amount, quote_total,
       due_date, status, payment_instructions, notes, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'issued', ?, ?, ?)`,
    [
      quoteId,
      ctx.quote.project_id || null,
      ctx.quote.customer_id || null,
      invoiceNumber,
      resolved.invoice_type,
      resolved.amount,
      quoteTotal,
      dueDate,
      paymentInstructions,
      notes,
      userId || null,
    ]
  );

  const invoiceId = ins.insertId;
  const gen = await generateAndStoreInvoicePdf(pool, invoiceId);
  if (!gen.ok) return gen;

  const [rows] = await pool.query('SELECT * FROM quote_invoices WHERE id = ? LIMIT 1', [invoiceId]);
  const nextBalance = await getQuoteInvoiceBalance(pool, quoteId, quoteTotal);
  return { ok: true, data: mapInvoiceRow(rows[0]), balance: nextBalance };
}

export async function generateAndStoreInvoicePdf(pool, invoiceId) {
  const [rows] = await pool.query(
    `SELECT qi.*, q.quote_number, q.total_amount, q.customer_id,
            c.name AS customer_name, c.email AS customer_email, c.phone AS customer_phone
     FROM quote_invoices qi
     INNER JOIN quotes q ON q.id = qi.quote_id
     LEFT JOIN customers c ON c.id = qi.customer_id
     WHERE qi.id = ? LIMIT 1`,
    [invoiceId]
  );
  if (!rows.length) return { ok: false, error: 'Invoice not found' };
  const inv = rows[0];
  const ctx = await loadQuoteContext(pool, inv.quote_id);
  if (!ctx) return { ok: false, error: 'Quote not found' };

  const [priorRows] = await pool.query(
    `SELECT COALESCE(SUM(amount), 0) AS prior
     FROM quote_invoices
     WHERE quote_id = ? AND id != ? AND LOWER(COALESCE(status, '')) != 'void'`,
    [inv.quote_id, invoiceId]
  );
  const previously_invoiced = roundMoney(priorRows[0]?.prior || 0);
  const quoteTotal = roundMoney(Number(ctx.quote.total_amount ?? inv.quote_total) || 0);
  const thisAmt = roundMoney(inv.amount);
  const remaining_after = roundMoney(Math.max(0, quoteTotal - previously_invoiced - thisAmt));

  const pdfBuf = await buildInvoicePdfBuffer({
    invoice: inv,
    quote: ctx.quote,
    items: ctx.items,
    customer: {
      name:
        String(ctx.quote.quote_party || '') === 'builder' || ctx.quote.builder_id
          ? ctx.quote.builder_company ||
            [ctx.quote.builder_first_name, ctx.quote.builder_last_name].filter(Boolean).join(' ').trim() ||
            inv.customer_name ||
            ctx.quote.customer_name
          : inv.customer_name || ctx.quote.customer_name,
      email: inv.customer_email || ctx.quote.customer_email || ctx.quote.builder_email,
      phone: inv.customer_phone || ctx.quote.customer_phone || ctx.quote.builder_phone,
    },
    balance: {
      previously_invoiced,
      remaining_after,
      quote_total: quoteTotal,
    },
  });
  await pool.execute('UPDATE quote_invoices SET pdf_blob = ? WHERE id = ?', [pdfBuf, invoiceId]);
  return { ok: true, buffer: pdfBuf };
}

export async function getInvoicePdfBuffer(pool, invoiceId) {
  const [rows] = await pool.query(
    'SELECT id, invoice_number, pdf_blob FROM quote_invoices WHERE id = ?',
    [invoiceId]
  );
  if (!rows.length) return { ok: false, error: 'Invoice not found' };
  const blob = rows[0].pdf_blob;
  const hasBlob =
    blob &&
    (Buffer.isBuffer(blob) ? blob.length > 0 : typeof blob === 'string' ? blob.length > 0 : blob.length > 0);
  if (hasBlob) {
    return {
      ok: true,
      buffer: Buffer.isBuffer(blob) ? blob : Buffer.from(blob),
      invoice_number: rows[0].invoice_number,
    };
  }
  const gen = await generateAndStoreInvoicePdf(pool, invoiceId);
  if (!gen.ok) return gen;
  return { ok: true, buffer: gen.buffer, invoice_number: rows[0].invoice_number };
}

export async function mailQuoteInvoice(pool, invoiceId, emailOpts = {}) {
  const [rows] = await pool.query(
    `SELECT qi.*, q.quote_number, c.email AS customer_email, c.name AS customer_name
     FROM quote_invoices qi
     INNER JOIN quotes q ON q.id = qi.quote_id
     LEFT JOIN customers c ON c.id = qi.customer_id
     WHERE qi.id = ? LIMIT 1`,
    [invoiceId]
  );
  if (!rows.length) return { ok: false, error: 'Invoice not found' };
  const inv = rows[0];
  let builderEmail = '';
  try {
    const ctx = await loadQuoteContext(pool, inv.quote_id);
    builderEmail = ctx?.quote?.builder_email ? String(ctx.quote.builder_email).trim() : '';
  } catch {
    builderEmail = '';
  }
  const email = String(emailOpts.to || inv.customer_email || builderEmail || '').trim();
  if (!email) {
    return {
      ok: false,
      error: 'E-mail do cliente em falta. Associe um cliente com e-mail ou indique o destinatário.',
    };
  }

  const pdf = await getInvoicePdfBuffer(pool, invoiceId);
  if (!pdf.ok) return pdf;

  const invNum = inv.invoice_number || `INV-${invoiceId}`;
  const amount = roundMoney(inv.amount);
  const due = inv.due_date ? String(inv.due_date).slice(0, 10) : '';
  const html =
    emailOpts.html ||
    `<p>Hello${inv.customer_name ? ` ${inv.customer_name}` : ''},</p>
<p>Please find attached invoice <strong>${invNum}</strong> for <strong>$${amount.toFixed(2)}</strong>${due ? ` due by ${due}` : ''}.</p>
<p>This invoice relates to your approved quote <strong>${inv.quote_number || ''}</strong>.</p>
<p>— Senior Floors</p>`;

  const sent = await sendQuoteEmail({
    to: email,
    subject: emailOpts.subject || `Invoice ${invNum} — Senior Floors`,
    html,
    pdfBuffer: pdf.buffer,
    filename: `Senior-Floors-${invNum}.pdf`,
  });
  if (!sent.ok) return sent;

  await pool.execute(
    `UPDATE quote_invoices SET status = IF(status = 'paid', 'paid', 'sent'), email_sent_at = NOW() WHERE id = ?`,
    [invoiceId]
  );
  return { ok: true, id: sent.id, to: email };
}

export async function markInvoicePaid(pool, invoiceId) {
  const [r] = await pool.execute(
    `UPDATE quote_invoices SET status = 'paid', paid_at = NOW() WHERE id = ? AND status != 'void'`,
    [invoiceId]
  );
  return r.affectedRows > 0;
}

async function tableExists(pool, name) {
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS c FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [name]
  );
  return Number(rows[0]?.c) > 0;
}

async function columnExists(pool, table, col) {
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, col]
  );
  return Number(rows[0]?.c) > 0;
}

export async function deleteQuoteInvoice(pool, invoiceId) {
  const id = parseInt(invoiceId, 10);
  if (!id) return { ok: false, error: 'Invalid invoice id' };

  const [rows] = await pool.query(
    'SELECT id, invoice_number, status FROM quote_invoices WHERE id = ? LIMIT 1',
    [id]
  );
  if (!rows.length) return { ok: false, error: 'Invoice not found' };

  const inv = rows[0];
  if (String(inv.status || '').toLowerCase() === 'paid') {
    return { ok: false, error: 'Não é possível apagar um invoice marcado como pago.' };
  }

  const [rcptCount] = await pool.query(
    `SELECT COUNT(*) AS c FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'invoice_payment_receipts'`
  );
  if (Number(rcptCount[0]?.c) > 0) {
    const [[n]] = await pool.query(
      'SELECT COUNT(*) AS c FROM invoice_payment_receipts WHERE invoice_id = ?',
      [id]
    );
    if (Number(n?.c) > 0) {
      return {
        ok: false,
        error: 'Não é possível apagar um invoice com recibos de pagamento. Anule ou ajuste os recibos primeiro.',
      };
    }
  }

  if (
    (await tableExists(pool, 'payment_receipts')) &&
    (await columnExists(pool, 'payment_receipts', 'invoice_id'))
  ) {
    await pool.execute('UPDATE payment_receipts SET invoice_id = NULL WHERE invoice_id = ?', [id]);
  }

  const [del] = await pool.execute('DELETE FROM quote_invoices WHERE id = ?', [id]);
  if (!del.affectedRows) return { ok: false, error: 'Invoice not found' };

  return { ok: true, invoice_number: inv.invoice_number };
}
