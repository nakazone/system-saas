/**
 * Invoice payment receipts (recibos) — partial or full, with PDF, email, and baixa.
 */
import { buildPaymentReceiptPdfBuffer } from './paymentReceiptPdf.js';
import { loadQuoteContext } from './quoteBusiness.js';
import { sendQuoteEmail } from './quoteMail.js';
import { markInvoicePaid } from './quoteInvoiceBusiness.js';

function roundMoney(n) {
  return Math.round(Number(n) * 100) / 100;
}

const METHODS = new Set(['cash', 'check', 'zelle', 'venmo', 'credit_card', 'bank_transfer', 'other']);

function normalizeMethod(raw) {
  const m = String(raw || 'check').trim().toLowerCase().replace(/\s+/g, '_');
  if (METHODS.has(m)) return m;
  if (m === 'card' || m === 'cc') return 'credit_card';
  if (m === 'wire' || m === 'ach' || m === 'transfer') return 'bank_transfer';
  return 'other';
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

export async function getInvoicePaymentTotals(pool, invoiceId) {
  const [invRows] = await pool.query(
    `SELECT id, invoice_number, amount, status FROM quote_invoices WHERE id = ? LIMIT 1`,
    [invoiceId]
  );
  if (!invRows.length) return null;
  const invoice_amount = roundMoney(invRows[0].amount);
  const [sumRows] = await pool.query(
    `SELECT COALESCE(SUM(amount), 0) AS paid
     FROM invoice_payment_receipts WHERE invoice_id = ?`,
    [invoiceId]
  );
  const paid_total = roundMoney(sumRows[0]?.paid || 0);
  const remaining = roundMoney(Math.max(0, invoice_amount - paid_total));
  return {
    invoice_id: invRows[0].id,
    invoice_number: invRows[0].invoice_number,
    invoice_amount,
    paid_total,
    remaining,
    status: invRows[0].status,
    is_fully_paid: remaining <= 0.009,
  };
}

async function nextReceiptNumber(pool, invoiceNumber) {
  const base = String(invoiceNumber || '').trim() || 'INV';
  const prefix = `${base}-R`;
  const [rows] = await pool.query(
    `SELECT receipt_number FROM invoice_payment_receipts
     WHERE receipt_number LIKE ?
     ORDER BY id DESC LIMIT 1`,
    [`${prefix}%`]
  );
  let seq = 1;
  if (rows.length) {
    const m = String(rows[0].receipt_number || '').match(/-R(\d+)$/i);
    if (m) seq = parseInt(m[1], 10) + 1;
  }
  return `${prefix}${String(seq).padStart(2, '0')}`;
}

function mapReceiptRow(r) {
  return {
    id: r.id,
    invoice_id: r.invoice_id,
    quote_id: r.quote_id,
    project_id: r.project_id,
    customer_id: r.customer_id,
    receipt_number: r.receipt_number,
    amount: Number(r.amount),
    payment_date: r.payment_date,
    payment_method: r.payment_method,
    reference_number: r.reference_number,
    notes: r.notes,
    email_sent_at: r.email_sent_at,
    financial_receipt_id: r.financial_receipt_id,
    created_at: r.created_at,
    has_pdf: !!(r.pdf_blob && (Buffer.isBuffer(r.pdf_blob) ? r.pdf_blob.length : r.pdf_blob.length)),
    pdf_url: `/api/invoice-receipts/${r.id}/pdf`,
  };
}

export async function listReceiptsForInvoice(pool, invoiceId) {
  const totals = await getInvoicePaymentTotals(pool, invoiceId);
  if (!totals) return { ok: false, error: 'Invoice not found' };
  const [rows] = await pool.query(
    `SELECT id, invoice_id, quote_id, project_id, customer_id, receipt_number, amount,
            payment_date, payment_method, reference_number, notes, email_sent_at,
            financial_receipt_id, created_at,
            (pdf_blob IS NOT NULL AND LENGTH(pdf_blob) > 0) AS has_pdf
     FROM invoice_payment_receipts
     WHERE invoice_id = ?
     ORDER BY payment_date DESC, id DESC`,
    [invoiceId]
  );
  const receipts = rows.map((r) => ({
    ...mapReceiptRow({ ...r, pdf_blob: r.has_pdf ? Buffer.from([1]) : null }),
    has_pdf: !!r.has_pdf,
  }));
  return { ok: true, data: receipts, balance: totals };
}

async function syncFinancialPaymentReceipt(pool, inv, receipt) {
  if (!inv.project_id) return null;
  if (!(await tableExists(pool, 'payment_receipts'))) return null;
  const hasInvoiceCol = await columnExists(pool, 'payment_receipts', 'invoice_id');
  const cols = hasInvoiceCol
    ? `project_id, invoice_id, payment_type, amount, payment_date, payment_method, reference_number, notes`
    : `project_id, payment_type, amount, payment_date, payment_method, reference_number, notes`;
  const vals = hasInvoiceCol
    ? [
        inv.project_id,
        inv.id,
        inv.invoice_type || 'other',
        receipt.amount,
        receipt.payment_date,
        receipt.payment_method,
        receipt.reference_number,
        receipt.notes
          ? `Invoice ${inv.invoice_number}: ${receipt.notes}`
          : `Invoice ${inv.invoice_number} — receipt ${receipt.receipt_number}`,
      ]
    : [
        inv.project_id,
        inv.invoice_type || 'other',
        receipt.amount,
        receipt.payment_date,
        receipt.payment_method,
        receipt.reference_number,
        receipt.notes
          ? `Invoice ${inv.invoice_number}: ${receipt.notes}`
          : `Invoice ${inv.invoice_number} — receipt ${receipt.receipt_number}`,
      ];
  const placeholders = vals.map(() => '?').join(',');
  const [ins] = await pool.execute(
    `INSERT INTO payment_receipts (${cols}) VALUES (${placeholders})`,
    vals
  );
  return ins.insertId || null;
}

export async function generateAndStoreReceiptPdf(pool, receiptId) {
  const [rows] = await pool.query(
    `SELECT r.*, qi.invoice_number, qi.amount AS invoice_amount, qi.invoice_type,
            qi.quote_id AS inv_quote_id, q.quote_number,
            c.name AS customer_name, c.email AS customer_email, c.phone AS customer_phone
     FROM invoice_payment_receipts r
     INNER JOIN quote_invoices qi ON qi.id = r.invoice_id
     LEFT JOIN quotes q ON q.id = r.quote_id
     LEFT JOIN customers c ON c.id = COALESCE(r.customer_id, qi.customer_id)
     WHERE r.id = ? LIMIT 1`,
    [receiptId]
  );
  if (!rows.length) return { ok: false, error: 'Receipt not found' };
  const row = rows[0];
  const totals = await getInvoicePaymentTotals(pool, row.invoice_id);
  let customerName = row.customer_name;
  let customerEmail = row.customer_email;
  let customerPhone = row.customer_phone;
  try {
    const ctx = await loadQuoteContext(pool, row.quote_id);
    if (ctx?.quote) {
      if (String(ctx.quote.quote_party || '') === 'builder' || ctx.quote.builder_id) {
        customerName =
          ctx.quote.builder_company ||
          [ctx.quote.builder_first_name, ctx.quote.builder_last_name].filter(Boolean).join(' ').trim() ||
          customerName;
        customerEmail = customerEmail || ctx.quote.builder_email;
        customerPhone = customerPhone || ctx.quote.builder_phone;
      } else {
        customerName = customerName || ctx.quote.customer_name;
        customerEmail = customerEmail || ctx.quote.customer_email;
        customerPhone = customerPhone || ctx.quote.customer_phone;
      }
    }
  } catch {
    /* keep fallbacks */
  }

  const pdfBuf = await buildPaymentReceiptPdfBuffer({
    receipt: row,
    invoice: {
      invoice_number: row.invoice_number,
      amount: row.invoice_amount,
      invoice_type: row.invoice_type,
      quote_number: row.quote_number,
    },
    quote: { quote_number: row.quote_number },
    customer: { name: customerName, email: customerEmail, phone: customerPhone },
    balance: {
      invoice_amount: totals?.invoice_amount ?? roundMoney(row.invoice_amount),
      paid_total: totals?.paid_total ?? roundMoney(row.amount),
      remaining: totals?.remaining ?? 0,
    },
  });
  await pool.execute('UPDATE invoice_payment_receipts SET pdf_blob = ? WHERE id = ?', [pdfBuf, receiptId]);
  return { ok: true, buffer: pdfBuf };
}

export async function getReceiptPdfBuffer(pool, receiptId) {
  const [rows] = await pool.query(
    'SELECT id, receipt_number, pdf_blob FROM invoice_payment_receipts WHERE id = ?',
    [receiptId]
  );
  if (!rows.length) return { ok: false, error: 'Receipt not found' };
  const blob = rows[0].pdf_blob;
  const hasBlob =
    blob &&
    (Buffer.isBuffer(blob) ? blob.length > 0 : typeof blob === 'string' ? blob.length > 0 : blob.length > 0);
  if (hasBlob) {
    return {
      ok: true,
      buffer: Buffer.isBuffer(blob) ? blob : Buffer.from(blob),
      receipt_number: rows[0].receipt_number,
    };
  }
  const gen = await generateAndStoreReceiptPdf(pool, receiptId);
  if (!gen.ok) return gen;
  return { ok: true, buffer: gen.buffer, receipt_number: rows[0].receipt_number };
}

/**
 * Create payment receipt (parcial ou total), PDF, optional email, auto-baixa.
 * @param {object} body — amount?, payment_date?, payment_method?, reference_number?, notes?, send_email?
 */
export async function createInvoicePaymentReceipt(pool, invoiceId, body = {}, userId) {
  const [invRows] = await pool.query('SELECT * FROM quote_invoices WHERE id = ? LIMIT 1', [invoiceId]);
  if (!invRows.length) return { ok: false, error: 'Invoice not found' };
  const inv = invRows[0];
  if (String(inv.status || '').toLowerCase() === 'void') {
    return { ok: false, error: 'Não é possível receber pagamento num invoice anulado.' };
  }

  const totals = await getInvoicePaymentTotals(pool, invoiceId);
  if (!totals) return { ok: false, error: 'Invoice not found' };
  if (totals.remaining <= 0.009) {
    return { ok: false, error: 'Este invoice já está totalmente pago.', balance: totals };
  }

  let amount =
    body.amount != null && String(body.amount).trim() !== ''
      ? roundMoney(body.amount)
      : totals.remaining;
  if (!(amount > 0)) return { ok: false, error: 'Indique um valor de pagamento válido.' };
  if (amount > totals.remaining + 0.009) {
    return {
      ok: false,
      error: `O valor ($${amount.toFixed(2)}) excede o saldo do invoice ($${totals.remaining.toFixed(2)}).`,
      balance: totals,
    };
  }

  const payment_date = body.payment_date
    ? String(body.payment_date).slice(0, 10)
    : new Date().toISOString().slice(0, 10);
  const payment_method = normalizeMethod(body.payment_method);
  const reference_number =
    body.reference_number != null && String(body.reference_number).trim()
      ? String(body.reference_number).trim().slice(0, 120)
      : null;
  const notes = body.notes != null && String(body.notes).trim() ? String(body.notes).trim() : null;

  let receipt_number;
  try {
    receipt_number = await nextReceiptNumber(pool, inv.invoice_number);
  } catch (e) {
    return { ok: false, error: e.message || 'Não foi possível gerar o número do recibo.' };
  }

  const [ins] = await pool.execute(
    `INSERT INTO invoice_payment_receipts
      (invoice_id, quote_id, project_id, customer_id, receipt_number, amount, payment_date,
       payment_method, reference_number, notes, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      inv.id,
      inv.quote_id,
      inv.project_id || null,
      inv.customer_id || null,
      receipt_number,
      amount,
      payment_date,
      payment_method,
      reference_number,
      notes,
      userId || null,
    ]
  );
  const receiptId = ins.insertId;

  let financialId = null;
  try {
    financialId = await syncFinancialPaymentReceipt(pool, inv, {
      amount,
      payment_date,
      payment_method,
      reference_number,
      notes,
      receipt_number,
    });
    if (financialId) {
      await pool.execute('UPDATE invoice_payment_receipts SET financial_receipt_id = ? WHERE id = ?', [
        financialId,
        receiptId,
      ]);
    }
  } catch (e) {
    console.warn('[invoice receipt] sync financial:', e.message);
  }

  const gen = await generateAndStoreReceiptPdf(pool, receiptId);
  if (!gen.ok) return gen;

  const nextTotals = await getInvoicePaymentTotals(pool, invoiceId);
  let invoice_paid = false;
  if (nextTotals && nextTotals.is_fully_paid) {
    invoice_paid = await markInvoicePaid(pool, invoiceId);
  }

  let emailResult = null;
  if (body.send_email === true || body.send_email === '1' || body.send_email === 1) {
    emailResult = await mailInvoicePaymentReceipt(pool, receiptId, {
      to: body.to,
      subject: body.subject,
      html: body.html,
    });
  }

  const [rows] = await pool.query('SELECT * FROM invoice_payment_receipts WHERE id = ? LIMIT 1', [
    receiptId,
  ]);
  return {
    ok: true,
    data: mapReceiptRow(rows[0]),
    balance: nextTotals,
    invoice_paid,
    email: emailResult,
  };
}

export async function mailInvoicePaymentReceipt(pool, receiptId, emailOpts = {}) {
  const [rows] = await pool.query(
    `SELECT r.*, qi.invoice_number, qi.amount AS invoice_amount, q.quote_number,
            c.email AS customer_email, c.name AS customer_name
     FROM invoice_payment_receipts r
     INNER JOIN quote_invoices qi ON qi.id = r.invoice_id
     LEFT JOIN quotes q ON q.id = r.quote_id
     LEFT JOIN customers c ON c.id = COALESCE(r.customer_id, qi.customer_id)
     WHERE r.id = ? LIMIT 1`,
    [receiptId]
  );
  if (!rows.length) return { ok: false, error: 'Receipt not found' };
  const row = rows[0];

  let builderEmail = '';
  try {
    const ctx = await loadQuoteContext(pool, row.quote_id);
    builderEmail = ctx?.quote?.builder_email ? String(ctx.quote.builder_email).trim() : '';
  } catch {
    builderEmail = '';
  }

  const email = String(emailOpts.to || row.customer_email || builderEmail || '').trim();
  if (!email) {
    return {
      ok: false,
      error: 'E-mail do cliente em falta. Associe um cliente com e-mail ou indique o destinatário.',
    };
  }

  const pdf = await getReceiptPdfBuffer(pool, receiptId);
  if (!pdf.ok) return pdf;

  const totals = await getInvoicePaymentTotals(pool, row.invoice_id);
  const rNum = row.receipt_number || `RCP-${receiptId}`;
  const amount = roundMoney(row.amount);
  const remaining = totals?.remaining ?? 0;
  const html =
    emailOpts.html ||
    `<p>Hello${row.customer_name ? ` ${row.customer_name}` : ''},</p>
<p>We have received your payment of <strong>$${amount.toFixed(2)}</strong>.</p>
<p>Receipt: <strong>${rNum}</strong> · Invoice: <strong>${row.invoice_number || ''}</strong>${
      row.quote_number ? ` · Quote: <strong>${row.quote_number}</strong>` : ''
    }.</p>
<p>${
      remaining <= 0.009
        ? 'This invoice is now paid in full. Thank you!'
        : `Remaining balance on this invoice: <strong>$${remaining.toFixed(2)}</strong>.`
    }</p>
<p>— Senior Floors</p>`;

  const sent = await sendQuoteEmail({
    to: email,
    subject: emailOpts.subject || `Payment receipt ${rNum} — Senior Floors`,
    html,
    pdfBuffer: pdf.buffer,
    filename: `Senior-Floors-${rNum}.pdf`,
  });
  if (!sent.ok) return sent;

  await pool.execute('UPDATE invoice_payment_receipts SET email_sent_at = NOW() WHERE id = ?', [
    receiptId,
  ]);
  return { ok: true, id: sent.id, to: email };
}

/**
 * Shortcut: dar baixa do saldo restante (recibo total do restante).
 */
export async function markInvoicePaidWithReceipt(pool, invoiceId, body = {}, userId) {
  const totals = await getInvoicePaymentTotals(pool, invoiceId);
  if (!totals) return { ok: false, error: 'Invoice not found' };
  if (totals.is_fully_paid) {
    await markInvoicePaid(pool, invoiceId);
    return { ok: true, already_paid: true, balance: totals };
  }
  return createInvoicePaymentReceipt(
    pool,
    invoiceId,
    {
      amount: totals.remaining,
      payment_date: body.payment_date,
      payment_method: body.payment_method || 'other',
      reference_number: body.reference_number,
      notes: body.notes || 'Full payment / baixa',
      send_email: body.send_email,
      to: body.to,
    },
    userId
  );
}
