/**
 * Quote module v2 — full save, catalog, templates, PDF, email, duplicate, snapshots.
 */
import { getDBConnection } from '../config/db.js';
import * as business from '../modules/quotes/quoteBusiness.js';
import * as repo from '../modules/quotes/quoteRepository.js';

function mysqlText(e) {
  return String(e?.sqlMessage || e?.message || '');
}

/** Tabela ausente ou mensagem típica do MySQL (sqlMessage nem sempre repete o nome). */
function isMissingTableOrUnknown(e, nameFragment) {
  if (!e) return false;
  if (e.code === 'ER_NO_SUCH_TABLE') return nameFragment ? mysqlText(e).includes(nameFragment) : true;
  return nameFragment ? mysqlText(e).includes(nameFragment) : false;
}

export async function postQuoteCreateFull(req, res) {
  try {
    const pool = await getDBConnection();
    if (!pool) return res.status(503).json({ success: false, error: 'Database not available' });
    const created = await business.createQuoteFull(pool, req.body, req.session.userId);
    const ctx = await business.loadQuoteContext(pool, created.id);
    res.status(201).json({ success: true, data: ctx });
  } catch (e) {
    console.error('postQuoteCreateFull:', e);
    res.status(500).json({ success: false, error: e.message });
  }
}

export async function putQuoteSaveFull(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ success: false, error: 'Invalid id' });
    const pool = await getDBConnection();
    if (!pool) return res.status(503).json({ success: false, error: 'Database not available' });
    const ctx = await business.saveQuoteFull(pool, id, req.body, req.session.userId, {
      snapshotPrevious: req.body.save_snapshot !== false,
    });
    if (!ctx) return res.status(404).json({ success: false, error: 'Quote not found' });
    res.json({ success: true, data: ctx });
  } catch (e) {
    console.error('putQuoteSaveFull:', e);
    res.status(500).json({ success: false, error: e.message });
  }
}

export async function postQuoteDuplicate(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ success: false, error: 'Invalid id' });
    const pool = await getDBConnection();
    if (!pool) return res.status(503).json({ success: false, error: 'Database not available' });
    const ctx = await business.duplicateQuote(pool, id, req.session.userId);
    if (!ctx) return res.status(404).json({ success: false, error: 'Quote not found' });
    res.status(201).json({ success: true, data: ctx });
  } catch (e) {
    console.error('postQuoteDuplicate:', e);
    res.status(500).json({ success: false, error: e.message });
  }
}

export async function postQuoteGeneratePdf(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ success: false, error: 'Invalid id' });
    const pool = await getDBConnection();
    if (!pool) return res.status(503).json({ success: false, error: 'Database not available' });
    const r = await business.generatePdfAndStore(pool, id);
    if (!r.ok) return res.status(404).json(r);
    res.json({
      success: true,
      invoice_pdf_url: `/api/quotes/${id}/invoice-pdf`,
    });
  } catch (e) {
    console.error('postQuoteGeneratePdf:', e);
    res.status(500).json({ success: false, error: e.message });
  }
}

/** Estado leve para polling (e-mail enviado / link aberto). */
export async function getQuoteEngagement(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ success: false, error: 'Invalid id' });
    const pool = await getDBConnection();
    if (!pool) return res.status(503).json({ success: false, error: 'Database not available' });
    const cols = await repo.quoteColumns(pool);
    const fields = ['id', 'status', 'viewed_at'];
    if (cols.has('email_sent_at')) fields.push('email_sent_at');
    if (cols.has('pdf_viewed_at')) fields.push('pdf_viewed_at');
    const [rows] = await pool.query(`SELECT ${fields.join(', ')} FROM quotes WHERE id = ? LIMIT 1`, [id]);
    if (!rows.length) return res.status(404).json({ success: false, error: 'Quote not found' });
    res.json({ success: true, data: rows[0] });
  } catch (e) {
    console.error('getQuoteEngagement:', e);
    res.status(500).json({ success: false, error: e.message });
  }
}

export async function postQuoteSendEmail(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ success: false, error: 'Invalid id' });
    const pool = await getDBConnection();
    if (!pool) return res.status(503).json({ success: false, error: 'Database not available' });
    const r = await business.mailQuote(pool, id, {
      to: req.body.to,
      cc: req.body.cc || req.body.extra_emails || req.body.extraEmails,
      subject: req.body.subject,
      html: req.body.html,
      lead_id: req.body.lead_id ?? req.body.leadId ?? null,
    });
    if (!r.ok) {
      const status = String(r.error || '').toLowerCase().includes('não configurado') ? 503 : 400;
      return res.status(status).json({ success: false, error: r.error, details: r.details });
    }
    res.json({
      success: true,
      message_id: r.id,
      resend_id: r.id,
      transport: r.transport || 'unknown',
      email_sent_at: r.email_sent_at || null,
      lead_moved: !!r.lead_moved,
      lead_id: r.lead_id || null,
      lead_move_reason: r.lead_move_reason || null,
    });
  } catch (e) {
    console.error('postQuoteSendEmail:', e);
    res.status(500).json({ success: false, error: e.message });
  }
}

export async function postQuotePublishClient(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ success: false, error: 'Invalid id' });
    const pool = await getDBConnection();
    if (!pool) return res.status(503).json({ success: false, error: 'Database not available' });
    await business.ensureQuotePublicToken(pool, id);
    const r = await business.publishQuoteForClient(pool, id);
    if (!r.ok) {
      return res.status(r.error === 'Quote not found' ? 404 : 400).json({
        success: false,
        error: r.error === 'schema' ? 'Não foi possível gravar a cópia do cliente.' : r.error,
      });
    }
    const markSent =
      req.body?.mark_sent === true ||
      req.body?.mark_sent === 1 ||
      req.body?.mark_sent === '1' ||
      req.query?.mark_sent === '1';
    let lead = null;
    if (markSent) {
      const marked = await business.markQuoteSent(pool, id, {
        leadId: req.body?.lead_id ?? req.body?.leadId ?? null,
      });
      lead = marked;
    }
    res.json({
      success: true,
      lead_moved: !!(lead && lead.lead_moved),
      lead_id: lead?.lead_id || null,
      lead_move_reason: lead?.lead_move_reason || null,
    });
  } catch (e) {
    console.error('postQuotePublishClient:', e);
    res.status(500).json({ success: false, error: e.message });
  }
}

export async function postQuoteMarkSent(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ success: false, error: 'Invalid id' });
    const pool = await getDBConnection();
    if (!pool) return res.status(503).json({ success: false, error: 'Database not available' });
    const r = await business.markQuoteSent(pool, id, {
      leadId: req.body?.lead_id ?? req.body?.leadId ?? null,
    });
    if (!r.ok) return res.status(400).json({ success: false, error: r.error });
    res.json({
      success: true,
      lead_moved: !!r.lead_moved,
      lead_id: r.lead_id || null,
      lead_move_reason: r.lead_move_reason || null,
    });
  } catch (e) {
    console.error('postQuoteMarkSent:', e);
    res.status(500).json({ success: false, error: e.message });
  }
}

export async function getQuoteSnapshots(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ success: false, error: 'Invalid id' });
    const pool = await getDBConnection();
    if (!pool) return res.status(503).json({ success: false, error: 'Database not available' });
    let rows = [];
    try {
      rows = await repo.listSnapshots(pool, id);
    } catch (err) {
      if (isMissingTableOrUnknown(err, 'quote_snapshots')) {
        return res.json({ success: true, data: [], message: 'Run migrate-quotes-module-complete.js' });
      }
      throw err;
    }
    res.json({ success: true, data: rows });
  } catch (e) {
    console.error('getQuoteSnapshots:', e);
    res.status(500).json({ success: false, error: e.message });
  }
}

export async function getQuoteCatalog(req, res) {
  try {
    const pool = await getDBConnection();
    if (!pool) return res.status(503).json({ success: false, error: 'Database not available' });
    const activeOnly = req.query.all !== '1';
    let rows;
    try {
      rows = await repo.listCatalog(pool, activeOnly);
    } catch (e) {
      if (isMissingTableOrUnknown(e, 'quote_service_catalog')) {
        return res.json({ success: true, data: [], message: 'Run migrate-quotes-module-complete.js' });
      }
      throw e;
    }
    res.json({ success: true, data: rows });
  } catch (e) {
    console.error('getQuoteCatalog:', e);
    res.status(500).json({ success: false, error: e.message });
  }
}

function parseNonNegRate(v) {
  const n = parseFloat(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function normalizeCatalogBody(body) {
  const name = body.name != null ? String(body.name).trim() : '';
  const category = body.category != null ? String(body.category).trim() : '';
  if (!name) return { error: 'Nome do serviço é obrigatório.' };
  if (!category) return { error: 'Categoria é obrigatória.' };
  let rateBuilder = parseNonNegRate(body.rate_builder ?? body.rateBuilder);
  let rateCustomer = parseNonNegRate(body.rate_customer ?? body.rateCustomer);
  const legacyDefault = parseNonNegRate(body.default_rate ?? body.defaultRate);
  if (rateBuilder == null && rateCustomer == null && legacyDefault != null) {
    rateBuilder = legacyDefault;
    rateCustomer = legacyDefault;
  }
  if (rateBuilder == null || rateCustomer == null) {
    return {
      error:
        'Preços Builder e cliente final são obrigatórios (números ≥ 0). Pode enviar só default_rate para preencher os dois.',
    };
  }
  const default_rate = rateCustomer;
  const notesBuilder =
    body.notes_builder != null ? String(body.notes_builder).trim().slice(0, 4000) || null : null;
  const notesCustomer =
    body.notes_customer != null ? String(body.notes_customer).trim().slice(0, 4000) || null : null;
  return {
    row: {
      name: name.slice(0, 255),
      category: category.slice(0, 64),
      default_rate,
      rate_builder: rateBuilder,
      rate_customer: rateCustomer,
      unit_type: body.unit_type || body.unitType || 'sq_ft',
      default_description:
        body.default_description != null
          ? String(body.default_description).trim().slice(0, 4000) || null
          : null,
      notes_builder: notesBuilder,
      notes_customer: notesCustomer,
      active: body.active !== false && body.active !== 0 && body.active !== '0',
    },
  };
}

export async function postQuoteCatalog(req, res) {
  try {
    const norm = normalizeCatalogBody(req.body);
    if (norm.error) {
      return res.status(400).json({ success: false, error: norm.error });
    }
    const pool = await getDBConnection();
    if (!pool) return res.status(503).json({ success: false, error: 'Database not available' });
    const id = await repo.insertCatalogItem(pool, norm.row);
    res.status(201).json({ success: true, data: { id } });
  } catch (e) {
    console.error('postQuoteCatalog:', e);
    if (isMissingTableOrUnknown(e, 'quote_service_catalog')) {
      return res.status(503).json({
        success: false,
        error: 'Migração pendente: npm run migrate:quotes-module (quote_service_catalog).',
      });
    }
    if (mysqlText(e).includes('rate_builder') || mysqlText(e).includes('rate_customer')) {
      return res.status(503).json({
        success: false,
        error: 'Migração pendente: npm run migrate:quote-enhancements-v2 (preços Builder / cliente final).',
      });
    }
    res.status(500).json({ success: false, error: e.message });
  }
}

export async function putQuoteCatalog(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ success: false, error: 'Invalid id' });
    const norm = normalizeCatalogBody(req.body);
    if (norm.error) {
      return res.status(400).json({ success: false, error: norm.error });
    }
    const pool = await getDBConnection();
    if (!pool) return res.status(503).json({ success: false, error: 'Database not available' });
    await repo.updateCatalogItem(pool, id, norm.row);
    res.json({ success: true });
  } catch (e) {
    console.error('putQuoteCatalog:', e);
    if (isMissingTableOrUnknown(e, 'quote_service_catalog')) {
      return res.status(503).json({
        success: false,
        error: 'Migração pendente: npm run migrate:quotes-module (quote_service_catalog).',
      });
    }
    if (mysqlText(e).includes('rate_builder') || mysqlText(e).includes('rate_customer')) {
      return res.status(503).json({
        success: false,
        error: 'Migração pendente: npm run migrate:quote-enhancements-v2 (preços Builder / cliente final).',
      });
    }
    res.status(500).json({ success: false, error: e.message });
  }
}

export async function deleteQuoteCatalog(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ success: false, error: 'Invalid id' });
    const pool = await getDBConnection();
    if (!pool) return res.status(503).json({ success: false, error: 'Database not available' });
    await repo.deleteCatalogItem(pool, id);
    res.json({ success: true });
  } catch (e) {
    console.error('deleteQuoteCatalog:', e);
    if (isMissingTableOrUnknown(e, 'quote_service_catalog')) {
      return res.status(503).json({
        success: false,
        error: 'Migração pendente: npm run migrate:quotes-module (quote_service_catalog).',
      });
    }
    res.status(500).json({ success: false, error: e.message });
  }
}

export async function getQuoteTemplates(req, res) {
  try {
    const pool = await getDBConnection();
    if (!pool) return res.status(503).json({ success: false, error: 'Database not available' });
    let rows;
    try {
      rows = await repo.listTemplates(pool);
    } catch (e) {
      if (isMissingTableOrUnknown(e, 'quote_templates')) {
        return res.json({ success: true, data: [] });
      }
      throw e;
    }
    res.json({ success: true, data: rows });
  } catch (e) {
    console.error('getQuoteTemplates:', e);
    res.status(500).json({ success: false, error: e.message });
  }
}

export async function getQuoteTemplate(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ success: false, error: 'Invalid id' });
    const pool = await getDBConnection();
    if (!pool) return res.status(503).json({ success: false, error: 'Database not available' });
    let tpl;
    try {
      tpl = await repo.getTemplateWithItems(pool, id);
    } catch (e) {
      if (isMissingTableOrUnknown(e, 'quote_template_items') || isMissingTableOrUnknown(e, 'quote_templates')) {
        return res.status(404).json({ success: false, error: 'Not found' });
      }
      throw e;
    }
    if (!tpl) return res.status(404).json({ success: false, error: 'Not found' });
    res.json({ success: true, data: tpl });
  } catch (e) {
    console.error('getQuoteTemplate:', e);
    res.status(500).json({ success: false, error: e.message });
  }
}

export async function postQuoteTemplate(req, res) {
  try {
    const pool = await getDBConnection();
    if (!pool) return res.status(503).json({ success: false, error: 'Database not available' });
    const items = Array.isArray(req.body.items) ? req.body.items : [];
    const tid = await repo.insertTemplate(pool, {
      name: req.body.name,
      service_type: business.deriveQuoteServiceSummary(items) ?? req.body.service_type ?? null,
      created_by: req.session.userId,
      items,
    });
    const tpl = await repo.getTemplateWithItems(pool, tid);
    res.status(201).json({ success: true, data: tpl });
  } catch (e) {
    console.error('postQuoteTemplate:', e);
    if (mysqlText(e).includes('service_type') && mysqlText(e).toLowerCase().includes('unknown column')) {
      return res.status(503).json({
        success: false,
        error: 'Migração pendente: npm run migrate:quote-enhancements-v2',
      });
    }
    res.status(500).json({ success: false, error: e.message });
  }
}

export async function deleteQuoteTemplate(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ success: false, error: 'Invalid id' });
    const pool = await getDBConnection();
    if (!pool) return res.status(503).json({ success: false, error: 'Database not available' });
    await repo.deleteTemplate(pool, id);
    res.json({ success: true });
  } catch (e) {
    console.error('deleteQuoteTemplate:', e);
    res.status(500).json({ success: false, error: e.message });
  }
}

export async function postQuoteFromTemplate(req, res) {
  try {
    const pool = await getDBConnection();
    if (!pool) return res.status(503).json({ success: false, error: 'Database not available' });
    const templateId = parseInt(req.body.template_id, 10);
    if (!templateId) return res.status(400).json({ success: false, error: 'template_id required' });
    const tpl = await repo.getTemplateWithItems(pool, templateId);
    if (!tpl) return res.status(404).json({ success: false, error: 'Template not found' });
    const items = (tpl.items || []).map((t) => {
      let name = t.name != null && String(t.name).trim() ? String(t.name).trim() : '';
      let description = String(t.description || '').trim();
      if (!name && description) {
        const ix = description.indexOf('\n');
        if (ix >= 0) {
          name = description.slice(0, ix).trim();
          description = description.slice(ix + 1).trim();
        } else {
          name = description;
          description = '';
        }
      }
      return {
        name: name || null,
        description: description || null,
        quantity: t.quantity,
        rate: t.rate,
        unit_type: t.unit_type,
        notes: t.notes,
        service_catalog_id: t.service_catalog_id,
        service_type: t.service_type,
        catalog_customer_notes: t.catalog_customer_notes,
      };
    });
    const created = await business.createQuoteFull(
      pool,
      {
        customer_id: req.body.customer_id,
        lead_id: req.body.lead_id,
        service_type: business.deriveQuoteServiceSummary(items) ?? tpl.service_type,
        items,
        status: 'draft',
        notes: req.body.notes,
        terms_conditions: req.body.terms_conditions,
      },
      req.session.userId
    );
    const ctx = await business.loadQuoteContext(pool, created.id);
    res.status(201).json({ success: true, data: ctx });
  } catch (e) {
    console.error('postQuoteFromTemplate:', e);
    res.status(500).json({ success: false, error: e.message });
  }
}
