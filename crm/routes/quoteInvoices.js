/**
 * Client invoices from approved quotes.
 */
import { getDBConnection } from '../config/db.js';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import * as inv from '../modules/quotes/quoteInvoiceBusiness.js';
import * as receipts from '../modules/quotes/invoiceReceiptBusiness.js';

export async function listQuoteInvoices(req, res) {
  try {
    const quoteId = parseInt(req.params.id, 10);
    if (!quoteId) return res.status(400).json({ success: false, error: 'Invalid quote id' });
    const pool = await getDBConnection();
    if (!pool) return res.status(503).json({ success: false, error: 'Database not available' });
    const { invoices, balance } = await inv.listInvoicesForQuote(pool, quoteId);
    res.json({ success: true, data: invoices, balance });
  } catch (e) {
    console.error('listQuoteInvoices:', e);
    res.status(500).json({ success: false, error: e.message });
  }
}

export async function listAllQuoteInvoicesHandler(req, res) {
  try {
    const pool = await getDBConnection();
    if (!pool) return res.status(503).json({ success: false, error: 'Database not available' });
    const result = await inv.listAllQuoteInvoices(pool, {
      status: req.query.status,
      q: req.query.q || req.query.search,
      page: req.query.page,
      limit: req.query.limit,
    });
    res.json({ success: true, ...result });
  } catch (e) {
    console.error('listAllQuoteInvoices:', e);
    res.status(500).json({ success: false, error: e.message });
  }
}

export async function postQuoteInvoice(req, res) {
  try {
    const quoteId = parseInt(req.params.id, 10);
    if (!quoteId) return res.status(400).json({ success: false, error: 'Invalid quote id' });
    const pool = await getDBConnection();
    if (!pool) return res.status(503).json({ success: false, error: 'Database not available' });
    const r = await inv.createQuoteInvoice(pool, quoteId, req.body || {}, req.session?.userId);
    if (!r.ok) return res.status(400).json({ success: false, error: r.error, balance: r.balance });
    res.status(201).json({ success: true, data: r.data, balance: r.balance });
  } catch (e) {
    console.error('postQuoteInvoice:', e);
    res.status(500).json({ success: false, error: e.message });
  }
}

export async function streamQuoteInvoicePdf(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ success: false, error: 'Invalid id' });
    const pool = await getDBConnection();
    if (!pool) return res.status(503).json({ success: false, error: 'Database not available' });
    const pdf = await inv.getInvoicePdfBuffer(pool, id);
    if (!pdf.ok) return res.status(404).json({ success: false, error: pdf.error || 'PDF not found' });
    const fname = `invoice-${pdf.invoice_number || id}.pdf`.replace(/[^\w.-]+/g, '-');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${fname}"`);
    res.send(pdf.buffer);
  } catch (e) {
    console.error('streamQuoteInvoicePdf:', e);
    if (!res.headersSent) res.status(500).json({ success: false, error: e.message });
  }
}

export async function postQuoteInvoiceSendEmail(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ success: false, error: 'Invalid id' });
    const pool = await getDBConnection();
    if (!pool) return res.status(503).json({ success: false, error: 'Database not available' });
    const r = await inv.mailQuoteInvoice(pool, id, {
      to: req.body?.to,
      subject: req.body?.subject,
      html: req.body?.html,
    });
    if (!r.ok) {
      const status = String(r.error || '').toLowerCase().includes('configurado') ? 503 : 400;
      return res.status(status).json({ success: false, error: r.error });
    }
    res.json({ success: true, message_id: r.id, to: r.to });
  } catch (e) {
    console.error('postQuoteInvoiceSendEmail:', e);
    res.status(500).json({ success: false, error: e.message });
  }
}

export async function postQuoteInvoiceMarkPaid(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ success: false, error: 'Invalid id' });
    const pool = await getDBConnection();
    if (!pool) return res.status(503).json({ success: false, error: 'Database not available' });
    // Preferir recibo + baixa (parcial/total). Fallback: só status se tabela ainda não existir.
    try {
      const r = await receipts.markInvoicePaidWithReceipt(pool, id, req.body || {}, req.session?.userId);
      if (!r.ok) return res.status(400).json({ success: false, error: r.error, balance: r.balance });
      return res.json({
        success: true,
        data: r.data || null,
        balance: r.balance,
        already_paid: !!r.already_paid,
        email: r.email || null,
      });
    } catch (inner) {
      if (!String(inner.message || '').includes("doesn't exist") && inner.code !== 'ER_NO_SUCH_TABLE') {
        throw inner;
      }
    }
    const ok = await inv.markInvoicePaid(pool, id);
    if (!ok) return res.status(404).json({ success: false, error: 'Invoice not found' });
    res.json({ success: true });
  } catch (e) {
    console.error('postQuoteInvoiceMarkPaid:', e);
    res.status(500).json({ success: false, error: e.message });
  }
}

export async function listInvoiceReceiptsHandler(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ success: false, error: 'Invalid id' });
    const pool = await getDBConnection();
    if (!pool) return res.status(503).json({ success: false, error: 'Database not available' });
    const r = await receipts.listReceiptsForInvoice(pool, id);
    if (!r.ok) return res.status(404).json({ success: false, error: r.error });
    res.json({ success: true, data: r.data, balance: r.balance });
  } catch (e) {
    console.error('listInvoiceReceipts:', e);
    res.status(500).json({ success: false, error: e.message });
  }
}

export async function postInvoiceReceiptHandler(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ success: false, error: 'Invalid id' });
    const pool = await getDBConnection();
    if (!pool) return res.status(503).json({ success: false, error: 'Database not available' });
    const r = await receipts.createInvoicePaymentReceipt(pool, id, req.body || {}, req.session?.userId);
    if (!r.ok) {
      const status = r.error === 'Invoice not found' ? 404 : 400;
      return res.status(status).json({ success: false, error: r.error, balance: r.balance });
    }
    res.status(201).json({
      success: true,
      data: r.data,
      balance: r.balance,
      invoice_paid: !!r.invoice_paid,
      email: r.email || null,
    });
  } catch (e) {
    console.error('postInvoiceReceipt:', e);
    res.status(500).json({ success: false, error: e.message });
  }
}

export async function streamInvoiceReceiptPdf(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ success: false, error: 'Invalid id' });
    const pool = await getDBConnection();
    if (!pool) return res.status(503).json({ success: false, error: 'Database not available' });
    const pdf = await receipts.getReceiptPdfBuffer(pool, id);
    if (!pdf.ok) return res.status(404).json({ success: false, error: pdf.error || 'PDF not found' });
    const fname = `receipt-${pdf.receipt_number || id}.pdf`.replace(/[^\w.-]+/g, '-');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${fname}"`);
    res.send(pdf.buffer);
  } catch (e) {
    console.error('streamInvoiceReceiptPdf:', e);
    if (!res.headersSent) res.status(500).json({ success: false, error: e.message });
  }
}

export async function postInvoiceReceiptSendEmail(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ success: false, error: 'Invalid id' });
    const pool = await getDBConnection();
    if (!pool) return res.status(503).json({ success: false, error: 'Database not available' });
    const r = await receipts.mailInvoicePaymentReceipt(pool, id, {
      to: req.body?.to,
      subject: req.body?.subject,
      html: req.body?.html,
    });
    if (!r.ok) {
      const status = String(r.error || '').toLowerCase().includes('configurado') ? 503 : 400;
      return res.status(status).json({ success: false, error: r.error });
    }
    res.json({ success: true, message_id: r.id, to: r.to });
  } catch (e) {
    console.error('postInvoiceReceiptSendEmail:', e);
    res.status(500).json({ success: false, error: e.message });
  }
}

export async function deleteQuoteInvoiceHandler(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ success: false, error: 'Invalid id' });
    const pool = await getDBConnection();
    if (!pool) return res.status(503).json({ success: false, error: 'Database not available' });
    const r = await inv.deleteQuoteInvoice(pool, id);
    if (!r.ok) {
      const status = r.error === 'Invoice not found' ? 404 : 400;
      return res.status(status).json({ success: false, error: r.error });
    }
    res.json({ success: true, invoice_number: r.invoice_number });
  } catch (e) {
    console.error('deleteQuoteInvoice:', e);
    res.status(500).json({ success: false, error: e.message });
  }
}

export function registerQuoteInvoiceRoutes(app) {
  app.get('/api/quote-invoices', requireAuth, requirePermission('quotes.view'), listAllQuoteInvoicesHandler);
  app.get('/api/quotes/:id/invoices', requireAuth, requirePermission('quotes.view'), listQuoteInvoices);
  app.post('/api/quotes/:id/invoices', requireAuth, requirePermission('quotes.edit'), postQuoteInvoice);
  app.get('/api/quote-invoices/:id/pdf', requireAuth, requirePermission('quotes.view'), streamQuoteInvoicePdf);
  app.post(
    '/api/quote-invoices/:id/send-email',
    requireAuth,
    requirePermission('quotes.edit'),
    postQuoteInvoiceSendEmail
  );
  app.post(
    '/api/quote-invoices/:id/mark-paid',
    requireAuth,
    requirePermission('quotes.edit'),
    postQuoteInvoiceMarkPaid
  );
  app.get(
    '/api/quote-invoices/:id/receipts',
    requireAuth,
    requirePermission('quotes.view'),
    listInvoiceReceiptsHandler
  );
  app.post(
    '/api/quote-invoices/:id/receipts',
    requireAuth,
    requirePermission('quotes.edit'),
    postInvoiceReceiptHandler
  );
  app.get(
    '/api/invoice-receipts/:id/pdf',
    requireAuth,
    requirePermission('quotes.view'),
    streamInvoiceReceiptPdf
  );
  app.post(
    '/api/invoice-receipts/:id/send-email',
    requireAuth,
    requirePermission('quotes.edit'),
    postInvoiceReceiptSendEmail
  );
  app.delete(
    '/api/quote-invoices/:id',
    requireAuth,
    requirePermission('quotes.edit'),
    deleteQuoteInvoiceHandler
  );
}
