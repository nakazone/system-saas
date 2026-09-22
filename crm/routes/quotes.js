/**
 * Quotes API - Quotes/Orçamentos management
 */
import fs from 'fs';
import { getDBConnection, resetDbPool, isTransientMysqlError } from '../config/db.js';
import { mapItemRow, generatePdfAndStore } from '../modules/quotes/quoteBusiness.js';
import { summarizeQuoteProfit } from '../modules/pricing/marginPricing.js';
import { setLeadPipelineBySlug } from '../lib/pipelineAutomation.js';
import { QUOTE_PDF_SUBDIR, resolvedPdfAbsolutePath } from '../lib/quotePdfUpload.js';
import { ensureProjectForApprovedQuote } from '../modules/quotes/quoteProjectFromApproval.js';
import { generateNextQuoteNumber } from '../lib/quoteNumber.js';

/** Colunas de `quotes` para listagens sem trazer LONGBLOB; inclui has_invoice_pdf quando a coluna existe. */
async function getQuoteListSelectParts(pool) {
  const [colRows] = await pool.query(
    `SELECT COLUMN_NAME AS n FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'quotes'
     ORDER BY ORDINAL_POSITION`
  );
  const colNames = colRows.map((r) => r.n);
  const hasBlob = colNames.includes('invoice_pdf');
  const selectCols = colNames.filter((n) => n !== 'invoice_pdf');
  const simple = `${selectCols.map((n) => `\`${n}\``).join(', ')}${
    hasBlob
      ? ', (`invoice_pdf` IS NOT NULL AND LENGTH(`invoice_pdf`) > 0) AS `has_invoice_pdf`'
      : ''
  }`;
  const joined = `${selectCols.map((n) => `q.\`${n}\``).join(', ')}${
    hasBlob
      ? ', (q.`invoice_pdf` IS NOT NULL AND LENGTH(q.`invoice_pdf`) > 0) AS `has_invoice_pdf`'
      : ''
  }`;
  return { hasBlob, simple, joined };
}

async function quotesTableHasInvoicePdf(pool) {
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'quotes' AND COLUMN_NAME = 'invoice_pdf'`
  );
  return rows[0].c > 0;
}

function pdfBufferNonEmpty(buf) {
  if (buf == null) return false;
  if (Buffer.isBuffer(buf)) return buf.length > 0;
  return Buffer.byteLength(buf) > 0;
}

function escapeLikePattern(q) {
  return String(q).replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

async function listQuotesQuery_(pool, req) {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
  const offset = (page - 1) * limit;
  const status = req.query.status || null;
  const customerId = req.query.customer_id || null;
  const leadIdRaw = req.query.lead_id;
  const leadIdParsed =
    leadIdRaw !== undefined && leadIdRaw !== null && String(leadIdRaw).trim() !== ''
      ? parseInt(String(leadIdRaw).trim(), 10)
      : NaN;
  const leadId = Number.isFinite(leadIdParsed) ? leadIdParsed : null;

  const expiringDaysRaw = req.query.expiring_within_days;
  const expiringDays =
    expiringDaysRaw !== undefined && expiringDaysRaw !== null && String(expiringDaysRaw).trim() !== ''
      ? parseInt(String(expiringDaysRaw).trim(), 10)
      : NaN;
  const expiringWithin = Number.isFinite(expiringDays) && expiringDays > 0 && expiringDays <= 365 ? expiringDays : null;

  const searchQ = (req.query.q || req.query.search || '').trim();

  const params = [];
  const plainParts = ['1=1'];
  const joinParts = ['1=1'];

  if (status) {
    if (String(status).toLowerCase() === 'rejected') {
      plainParts.push("(status = 'rejected' OR status = 'declined')");
      joinParts.push("(q.status = 'rejected' OR q.status = 'declined')");
    } else {
      plainParts.push('status = ?');
      joinParts.push('q.status = ?');
      params.push(status);
    }
  }
  if (expiringWithin != null) {
    plainParts.push(
      'expiration_date IS NOT NULL AND expiration_date >= CURDATE() AND expiration_date <= DATE_ADD(CURDATE(), INTERVAL ? DAY)'
    );
    joinParts.push(
      'q.expiration_date IS NOT NULL AND q.expiration_date >= CURDATE() AND q.expiration_date <= DATE_ADD(CURDATE(), INTERVAL ? DAY)'
    );
    params.push(expiringWithin);
  }
  if (customerId) {
    plainParts.push('customer_id = ?');
    joinParts.push('q.customer_id = ?');
    params.push(customerId);
  }
  if (leadId != null) {
    plainParts.push('lead_id = ?');
    joinParts.push('q.lead_id = ?');
    params.push(leadId);
  }
  if (searchQ) {
    const like = `%${escapeLikePattern(searchQ)}%`;
    joinParts.push(
      "(q.quote_number LIKE ? OR CAST(q.id AS CHAR) LIKE ? OR COALESCE(c.name, '') LIKE ? OR COALESCE(l.name, '') LIKE ? OR COALESCE(c.email, '') LIKE ? OR COALESCE(l.email, '') LIKE ?)"
    );
    params.push(like, like, like, like, like, like);
  }

  const whereClausePlain = plainParts.join(' AND ');
  const whereClauseJoined = joinParts.join(' AND ');

  /** Página do lead só precisa de colunas de `quotes` — evita JOINs quando não há busca nem filtros extra. */
  let simpleLeadList =
    leadId != null && !status && !customerId && expiringWithin == null && !searchQ;

  const { simple: quoteSelectSimple, joined: quoteSelectJoined } = await getQuoteListSelectParts(pool);

  let rows;
  if (simpleLeadList) {
    [rows] = await pool.query(
      `SELECT ${quoteSelectSimple} FROM quotes WHERE lead_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [leadId, limit, offset]
    );
  } else {
    [rows] = await pool.query(
      `SELECT ${quoteSelectJoined},
              c.name as customer_name, c.email as customer_email,
              l.name as lead_name, l.email as lead_email
       FROM quotes q
       LEFT JOIN customers c ON q.customer_id = c.id
       LEFT JOIN leads l ON q.lead_id = l.id
       WHERE ${whereClauseJoined}
       ORDER BY q.created_at DESC 
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );
  }

  let total = 0;
  let totalAmount = 0;
  if (simpleLeadList) {
    const [[agg]] = await pool.query(
      `SELECT COUNT(*) AS total, COALESCE(SUM(total_amount), 0) AS total_amount FROM quotes WHERE lead_id = ?`,
      [leadId]
    );
    total = Number(agg.total) || 0;
    totalAmount = Number(agg.total_amount) || 0;
  } else {
    const [[agg]] = await pool.query(
      `SELECT COUNT(*) AS total, COALESCE(SUM(q.total_amount), 0) AS total_amount
       FROM quotes q
       LEFT JOIN customers c ON q.customer_id = c.id
       LEFT JOIN leads l ON q.lead_id = l.id
       WHERE ${whereClauseJoined}`,
      params
    );
    total = Number(agg.total) || 0;
    totalAmount = Number(agg.total_amount) || 0;
  }

  return { rows, total, total_amount: totalAmount, page, limit };
}

export async function listQuotes(req, res) {
  try {
    let pool = await getDBConnection();
    if (!pool) {
      return res.status(503).json({ success: false, error: 'Database not available' });
    }

    let out;
    try {
      out = await listQuotesQuery_(pool, req);
    } catch (err) {
      if (!isTransientMysqlError(err)) throw err;
      console.warn('[quotes] list transient DB error, recreating pool:', err.code || err.message);
      await resetDbPool();
      pool = await getDBConnection();
      if (!pool) {
        return res.status(503).json({ success: false, error: 'Database not available' });
      }
      out = await listQuotesQuery_(pool, req);
    }

    res.json({
      success: true,
      data: out.rows,
      total: out.total,
      total_amount: out.total_amount,
      page: out.page,
      limit: out.limit,
    });
  } catch (error) {
    console.error('List quotes error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
}

export async function listQuoteBuildersLookup(req, res) {
  try {
    const pool = await getDBConnection();
    if (!pool) return res.status(503).json({ success: false, error: 'Database not available' });
    const [exists] = await pool.query(
      `SELECT COUNT(*) AS c FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'builders'`
    );
    if (!Number(exists[0]?.c)) return res.json({ success: true, data: [] });
    const [rows] = await pool.query(
      `SELECT id, customer_id, first_name, last_name, company, email, phone, status
       FROM builders
       WHERE status IN ('active', 'pending')
       ORDER BY company ASC, first_name ASC, last_name ASC
       LIMIT 500`
    );
    res.json({
      success: true,
      data: rows.map((b) => {
        const person = [b.first_name, b.last_name].filter(Boolean).join(' ').trim();
        const label = [b.company, person].filter(Boolean).join(' · ') || b.email || `Builder #${b.id}`;
        return {
          id: b.id,
          customer_id: b.customer_id,
          company: b.company || '',
          name: person,
          email: b.email || '',
          phone: b.phone || '',
          label,
          status: b.status,
        };
      }),
    });
  } catch (e) {
    console.error('listQuoteBuildersLookup:', e);
    res.status(500).json({ success: false, error: e.message });
  }
}

export async function getQuote(req, res) {
  try {
    const pool = await getDBConnection();
    if (!pool) {
      return res.status(503).json({ success: false, error: 'Database not available' });
    }

    const [quotes] = await pool.query('SELECT * FROM quotes WHERE id = ?', [req.params.id]);
    if (quotes.length === 0) {
      return res.status(404).json({ success: false, error: 'Quote not found' });
    }

    const quoteRow = quotes[0];
    const blob = quoteRow.invoice_pdf;
    const hasStoredPdf = pdfBufferNonEmpty(blob);
    const quote = { ...quoteRow };
    delete quote.invoice_pdf;
    const hasClientSignature = !!(
      quote.client_signature_png &&
      (Buffer.isBuffer(quote.client_signature_png)
        ? quote.client_signature_png.length
        : quote.client_signature_png.length)
    );
    delete quote.client_signature_png;

    // Buscar items do quote
    const [items] = await pool.query('SELECT * FROM quote_items WHERE quote_id = ? ORDER BY id', [
      req.params.id,
    ]);

    const mappedItems = items.map(mapItemRow);
    const data = {
      ...quote,
      items: mappedItems,
      profit_summary: summarizeQuoteProfit(mappedItems),
    };
    if (quote.pdf_path || hasStoredPdf) {
      data.invoice_pdf_url = `/api/quotes/${quote.id}/invoice-pdf`;
    }
    data.has_client_signature = hasClientSignature;
    if (hasClientSignature) {
      data.client_signature_url = `/api/quotes/${quote.id}/client-signature`;
    }
    res.json({ success: true, data });
  } catch (error) {
    console.error('Get quote error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
}

export async function createQuote(req, res) {
  try {
    const pool = await getDBConnection();
    if (!pool) {
      return res.status(503).json({ success: false, error: 'Database not available' });
    }

    const { lead_id, customer_id, project_id, total_amount, labor_amount, materials_amount, 
            status, items, notes, expiration_date } = req.body;

    if (!total_amount) {
      return res.status(400).json({ success: false, error: 'Total amount is required' });
    }

    const quoteNumber = await generateNextQuoteNumber(pool);

    const [result] = await pool.execute(
      `INSERT INTO quotes (lead_id, customer_id, project_id, total_amount, labor_amount, materials_amount, 
                          status, quote_number, expiration_date, notes, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [lead_id || null, customer_id || null, project_id || null, total_amount, 
       labor_amount || 0, materials_amount || 0, status || 'draft', quoteNumber,
       expiration_date || null, notes || null, req.session.userId || null]
    );

    const quoteId = result.insertId;

    // Inserir items se fornecidos
    if (items && Array.isArray(items) && items.length > 0) {
      for (const item of items) {
        await pool.execute(
          `INSERT INTO quote_items (quote_id, description, quantity, unit_price, total_price)
           VALUES (?, ?, ?, ?, ?)`,
          [quoteId, item.description, item.quantity || 1, item.unit_price || 0, item.total_price || 0]
        );
      }
    }

    const st = String(status || 'draft').toLowerCase();
    if (lead_id && ['sent', 'approved', 'accepted'].includes(st)) {
      await setLeadPipelineBySlug(lead_id, 'quote_sent');
    }

    res.status(201).json({ success: true, data: { id: quoteId, quote_number: quoteNumber }, message: 'Quote created' });
  } catch (error) {
    console.error('Create quote error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
}

export async function updateQuote(req, res) {
  try {
    const pool = await getDBConnection();
    if (!pool) {
      return res.status(503).json({ success: false, error: 'Database not available' });
    }

    const [quoteRows] = await pool.query('SELECT lead_id, status FROM quotes WHERE id = ?', [req.params.id]);
    const existing = quoteRows[0];
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Quote not found' });
    }
    const prevStatus = String(existing.status || '').toLowerCase();

    const updates = [];
    const values = [];
    const allowedFields = ['status', 'total_amount', 'labor_amount', 'materials_amount', 
                          'notes', 'expiration_date', 'sent_at', 'viewed_at', 'approved_at'];

    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        updates.push(`${field} = ?`);
        values.push(req.body[field]);
      }
    }

    if (updates.length === 0) {
      return res.status(400).json({ success: false, error: 'No fields to update' });
    }

    values.push(req.params.id);
    await pool.execute(
      `UPDATE quotes SET ${updates.join(', ')} WHERE id = ?`,
      values
    );

    const newStatus = req.body.status != null ? String(req.body.status).toLowerCase() : prevStatus;
    const becameSent = ['sent', 'approved', 'accepted'].includes(newStatus) && !['sent', 'approved', 'accepted'].includes(prevStatus);
    if (becameSent && existing.lead_id) {
      await setLeadPipelineBySlug(existing.lead_id, 'quote_sent');
    }

    const becameApproved =
      ['approved', 'accepted'].includes(newStatus) && !['approved', 'accepted'].includes(prevStatus);
    if (becameApproved) {
      try {
        await ensureProjectForApprovedQuote(pool, req.params.id);
      } catch (e) {
        console.error('[quotes] updateQuote: project auto-create failed', e);
      }
    }

    res.json({ success: true, message: 'Quote updated' });
  } catch (error) {
    console.error('Update quote error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
}

export async function deleteQuote(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) {
      return res.status(400).json({ success: false, error: 'Invalid id' });
    }
    const leadIdRaw = req.query.lead_id;
    const leadIdParsed =
      leadIdRaw !== undefined && leadIdRaw !== null && String(leadIdRaw).trim() !== ''
        ? parseInt(String(leadIdRaw).trim(), 10)
        : NaN;
    const leadIdFilter = Number.isFinite(leadIdParsed) ? leadIdParsed : null;

    const pool = await getDBConnection();
    if (!pool) {
      return res.status(503).json({ success: false, error: 'Database not available' });
    }

    const [rows] = await pool.query('SELECT id, lead_id FROM quotes WHERE id = ?', [id]);
    if (!rows.length) {
      return res.status(404).json({ success: false, error: 'Quote not found' });
    }
    if (leadIdFilter != null && rows[0].lead_id != leadIdFilter) {
      return res.status(403).json({ success: false, error: 'Este quote não pertence a este lead.' });
    }

    try {
      await pool.execute('UPDATE contracts SET quote_id = NULL WHERE quote_id = ?', [id]);
    } catch (_) {
      /* tabela/coluna opcional */
    }
    try {
      await pool.execute('DELETE FROM quote_items WHERE quote_id = ?', [id]);
    } catch (_) {
      /* quote_items pode não existir */
    }
    await pool.execute('DELETE FROM quotes WHERE id = ?', [id]);
    res.setHeader('Content-Type', 'application/json; charset=UTF-8');
    res.json({ success: true, message: 'Quote eliminado.' });
  } catch (error) {
    console.error('Delete quote error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
}

/**
 * POST multipart: file (PDF), total_amount, lead_id opcional, notes opcional
 */
export async function createQuoteFromInvoicePdf(req, res) {
  if (!req.file) {
    return res.status(400).json({ success: false, error: 'Selecione um ficheiro PDF.' });
  }
  const totalRaw = req.body.total_amount;
  const total = parseFloat(String(totalRaw == null ? '' : totalRaw).replace(',', '.'), 10);
  if (!Number.isFinite(total) || total < 0) {
    try {
      fs.unlinkSync(req.file.path);
    } catch (e) {
      /* ignore */
    }
    return res.status(400).json({ success: false, error: 'Indique o valor final do orçamento (número válido).' });
  }
  const leadRaw = req.body.lead_id;
  let lead_id = null;
  if (leadRaw !== '' && leadRaw !== undefined && leadRaw !== null) {
    const n = parseInt(String(leadRaw).trim(), 10);
    if (Number.isFinite(n)) lead_id = n;
  }
  const extraNotes = req.body.notes != null ? String(req.body.notes).trim().slice(0, 2000) : '';
  const baseNote =
    'Orçamento importado via PDF (ex.: Invoice2Go). Valor final registado no CRM.';
  const notes = extraNotes ? `${baseNote}\n${extraNotes}` : baseNote;

  const relativePath = `${QUOTE_PDF_SUBDIR}/${req.file.filename}`;
  let pdfBuf;
  try {
    pdfBuf = fs.readFileSync(req.file.path);
  } catch (readErr) {
    console.error('createQuoteFromInvoicePdf read:', readErr);
    try {
      fs.unlinkSync(req.file.path);
    } catch (e) {
      /* ignore */
    }
    return res.status(400).json({ success: false, error: 'Não foi possível ler o PDF.' });
  }

  try {
    const pool = await getDBConnection();
    if (!pool) {
      try {
        fs.unlinkSync(req.file.path);
      } catch (e) {
        /* ignore */
      }
      return res.status(503).json({ success: false, error: 'Database not available' });
    }

    const quoteNumber = await generateNextQuoteNumber(pool);
    const hasBlobCol = await quotesTableHasInvoicePdf(pool);

    let result;
    if (hasBlobCol) {
      [result] = await pool.execute(
        `INSERT INTO quotes (lead_id, customer_id, project_id, total_amount, labor_amount, materials_amount,
                            status, quote_number, expiration_date, notes, created_by, pdf_path, invoice_pdf)
         VALUES (?, NULL, NULL, ?, 0, 0, 'draft', ?, NULL, ?, ?, NULL, ?)`,
        [lead_id, total, quoteNumber, notes, req.session.userId || null, pdfBuf]
      );
    } else {
      [result] = await pool.execute(
        `INSERT INTO quotes (lead_id, customer_id, project_id, total_amount, labor_amount, materials_amount,
                            status, quote_number, expiration_date, notes, created_by, pdf_path)
         VALUES (?, NULL, NULL, ?, 0, 0, 'draft', ?, NULL, ?, ?, ?)`,
        [lead_id, total, quoteNumber, notes, req.session.userId || null, relativePath]
      );
    }

    try {
      fs.unlinkSync(req.file.path);
    } catch (e) {
      /* ignore */
    }

    const quoteId = result.insertId;

    res.status(201).json({
      success: true,
      data: {
        id: quoteId,
        quote_number: quoteNumber,
        invoice_pdf_url: `/api/quotes/${quoteId}/invoice-pdf`,
      },
      message: 'Quote criado com PDF anexado.',
    });
  } catch (error) {
    console.error('createQuoteFromInvoicePdf error:', error);
    try {
      fs.unlinkSync(req.file.path);
    } catch (e) {
      /* ignore */
    }
    if (error.code === 'ER_BAD_FIELD_ERROR' && String(error.message || '').includes('pdf_path')) {
      return res.status(500).json({
        success: false,
        error:
          'Coluna pdf_path em falta na tabela quotes. Execute: ALTER TABLE quotes ADD COLUMN pdf_path VARCHAR(500) NULL;',
      });
    }
    if (error.code === 'ER_BAD_FIELD_ERROR' && String(error.message || '').includes('invoice_pdf')) {
      return res.status(500).json({
        success: false,
        error:
          'Coluna invoice_pdf em falta. No servidor rode: node database/migrate-quote-invoice-pdf-blob.js (ou npm run migrate:quote-pdf-blob).',
      });
    }
    res.status(500).json({ success: false, error: error.message });
  }
}

export async function streamQuoteInvoicePdf(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) {
      return res.status(400).json({ success: false, error: 'Invalid id' });
    }
    const pool = await getDBConnection();
    if (!pool) {
      return res.status(503).json({ success: false, error: 'Database not available' });
    }
    const gen = await generatePdfAndStore(pool, id);
    if (gen.ok && gen.buffer && gen.buffer.length) {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'inline; filename="orcamento.pdf"');
      return res.send(gen.buffer);
    }
    const hasBlob = await quotesTableHasInvoicePdf(pool);
    let rows;
    if (hasBlob) {
      [rows] = await pool.query('SELECT id, pdf_path, invoice_pdf FROM quotes WHERE id = ?', [id]);
    } else {
      [rows] = await pool.query('SELECT id, pdf_path FROM quotes WHERE id = ?', [id]);
    }
    if (!rows.length) {
      return res.status(404).json({ success: false, error: 'PDF não disponível para este quote.' });
    }
    const row = rows[0];
    if (hasBlob && pdfBufferNonEmpty(row.invoice_pdf)) {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'inline; filename="orcamento.pdf"');
      return res.send(Buffer.from(row.invoice_pdf));
    }
    if (!row.pdf_path) {
      return res.status(404).json({ success: false, error: 'PDF não disponível para este quote.' });
    }
    const abs = resolvedPdfAbsolutePath(row.pdf_path);
    if (!abs || !fs.existsSync(abs)) {
      return res.status(404).json({
        success: false,
        error:
          'O PDF deste orçamento já não existe no servidor (só havia cópia em disco, p.ex. após redeploy). Volte a importar o mesmo PDF: a app grava agora uma cópia na base de dados para não perder.',
        code: 'QUOTE_PDF_DISK_MISSING',
      });
    }
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="orcamento.pdf"');
    const stream = fs.createReadStream(abs);
    stream.on('error', () => {
      if (!res.headersSent) res.status(500).end();
    });
    stream.pipe(res);
  } catch (e) {
    console.error('streamQuoteInvoicePdf:', e);
    if (!res.headersSent) res.status(500).json({ success: false, error: e.message });
  }
}
