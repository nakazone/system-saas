/**
 * Public quote view (token) — no session.
 */
import { getDBConnection } from '../config/db.js';
import * as business from '../modules/quotes/quoteBusiness.js';
import { normalizeQuoteNumberForUrl } from '../lib/publicQuoteUrl.js';
import { getOwnerSignature, ownerSignaturePublicMeta } from '../modules/quotes/quoteSignatureSettings.js';

function sanitizeQuote(q) {
  if (!q) return q;
  const out = { ...q };
  delete out.invoice_pdf;
  delete out.client_snapshot_json;
  delete out.internal_notes;
  delete out.created_by;
  delete out.client_signature_png;
  const st = String(out.status || '').toLowerCase();
  const signedName = String(q.client_signed_name || '').trim();
  const png = q.client_signature_png;
  const hasPng =
    !!png &&
    (Buffer.isBuffer(png) ? png.length > 0 : typeof png === 'string' ? png.length > 0 : png?.length > 0);
  out.has_client_signature = !!(signedName || hasPng);
  if (['approved', 'accepted'].includes(st) && out.has_client_signature) {
    out.client_signature_url = 'client-signature';
  }
  return out;
}

async function buildPublicQuotePayload(pool, ctx, apiBase) {
  const owner = await getOwnerSignature(pool);
  return {
    quote: sanitizeQuote(ctx.quote),
    items: sanitizePublicItems(ctx.items),
    owner_signature: ownerSignaturePublicMeta(owner, apiBase),
  };
}

function sanitizePublicItems(items) {
  return (items || []).map((it) => {
    const o = { ...it };
    delete o.cost_price;
    delete o.markup_percentage;
    delete o.product_id;
    return o;
  });
}

export async function getPublicQuoteByNumber(req, res) {
  try {
    const quoteNumber = normalizeQuoteNumberForUrl(req.params.quoteNumber);
    if (!quoteNumber) {
      return res.status(400).json({ success: false, error: 'Invalid quote number' });
    }
    const pool = await getDBConnection();
    if (!pool) return res.status(503).json({ success: false, error: 'Database not available' });

    const ctx = await business.markQuoteViewedByNumber(pool, quoteNumber);
    if (!ctx) return res.status(404).json({ success: false, error: 'Quote not found' });

    const apiBase = `/api/public/quotes/by-number/${encodeURIComponent(quoteNumber)}`;
    res.json({
      success: true,
      data: await buildPublicQuotePayload(pool, ctx, apiBase),
    });
  } catch (e) {
    console.error('getPublicQuoteByNumber:', e);
    res.status(500).json({ success: false, error: e.message });
  }
}

export async function getPublicQuotePdfByNumber(req, res) {
  try {
    const quoteNumber = normalizeQuoteNumberForUrl(req.params.quoteNumber);
    if (!quoteNumber) {
      return res.status(400).json({ success: false, error: 'Invalid quote number' });
    }
    const pool = await getDBConnection();
    if (!pool) return res.status(503).json({ success: false, error: 'Database not available' });

    const ctx = await business.getByQuoteNumber(pool, quoteNumber);
    if (!ctx) return res.status(404).json({ success: false, error: 'Quote not found' });

    await business.markQuotePdfDownloadedByNumber(pool, quoteNumber);

    const pdfBuf = await business.getQuotePdfBufferForPublic(pool, ctx.quote.id);
    if (!pdfBuf || !pdfBuf.length) {
      return res.status(404).json({ success: false, error: 'PDF not available' });
    }

    const qn = ctx.quote.quote_number || ctx.quote.id;
    const filename = `Senior-Floors-Quote-${qn}.pdf`.replace(/[^\w.-]+/g, '_');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    return res.send(pdfBuf);
  } catch (e) {
    console.error('getPublicQuotePdfByNumber:', e);
    if (!res.headersSent) res.status(500).json({ success: false, error: e.message });
  }
}

export async function postApproveQuoteByNumber(req, res) {
  try {
    const quoteNumber = normalizeQuoteNumberForUrl(req.params.quoteNumber);
    if (!quoteNumber) {
      return res.status(400).json({ success: false, error: 'Invalid quote number' });
    }
    const pool = await getDBConnection();
    if (!pool) return res.status(503).json({ success: false, error: 'Database not available' });
    const ctx = await business.approvePublicQuoteByNumber(pool, quoteNumber, req.body || {});
    if (!ctx) return res.status(404).json({ success: false, error: 'Quote not found' });
    const apiBase = `/api/public/quotes/by-number/${encodeURIComponent(quoteNumber)}`;
    res.json({
      success: true,
      data: await buildPublicQuotePayload(pool, ctx, apiBase),
    });
  } catch (e) {
    console.error('postApproveQuoteByNumber:', e);
    const status = e.statusCode || 500;
    res.status(status).json({ success: false, error: e.message || 'Could not approve quote' });
  }
}

export async function getPublicQuote(req, res) {
  try {
    const token = String(req.params.token || '').trim();
    if (!token || token.length < 16) {
      return res.status(400).json({ success: false, error: 'Invalid token' });
    }
    const pool = await getDBConnection();
    if (!pool) return res.status(503).json({ success: false, error: 'Database not available' });

    const ctx = await business.markQuoteViewed(pool, token);
    if (!ctx) return res.status(404).json({ success: false, error: 'Quote not found' });

    const apiBase = `/api/public/quotes/${encodeURIComponent(token)}`;
    res.json({
      success: true,
      data: await buildPublicQuotePayload(pool, ctx, apiBase),
    });
  } catch (e) {
    console.error('getPublicQuote:', e);
    res.status(500).json({ success: false, error: e.message });
  }
}

export async function getPublicQuotePdf(req, res) {
  try {
    const token = String(req.params.token || '').trim();
    if (!token || token.length < 16) {
      return res.status(400).json({ success: false, error: 'Invalid token' });
    }
    const pool = await getDBConnection();
    if (!pool) return res.status(503).json({ success: false, error: 'Database not available' });

    const ctx = await business.getByPublicToken(pool, token);
    if (!ctx) return res.status(404).json({ success: false, error: 'Quote not found' });

    await business.markQuotePdfDownloaded(pool, token);

    const pdfBuf = await business.getQuotePdfBufferForPublic(pool, ctx.quote.id);
    if (!pdfBuf || !pdfBuf.length) {
      return res.status(404).json({ success: false, error: 'PDF not available' });
    }

    const qn = ctx.quote.quote_number || ctx.quote.id;
    const filename = `Senior-Floors-Quote-${qn}.pdf`.replace(/[^\w.-]+/g, '_');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    return res.send(pdfBuf);
  } catch (e) {
    console.error('getPublicQuotePdf:', e);
    if (!res.headersSent) res.status(500).json({ success: false, error: e.message });
  }
}

export async function postApproveQuote(req, res) {
  try {
    const token = String(req.params.token || '').trim();
    if (!token || token.length < 16) {
      return res.status(400).json({ success: false, error: 'Invalid token' });
    }
    const pool = await getDBConnection();
    if (!pool) return res.status(503).json({ success: false, error: 'Database not available' });
    const ctx = await business.approvePublicQuote(pool, token, req.body || {});
    if (!ctx) return res.status(404).json({ success: false, error: 'Quote not found' });
    const apiBase = `/api/public/quotes/${encodeURIComponent(token)}`;
    res.json({
      success: true,
      data: await buildPublicQuotePayload(pool, ctx, apiBase),
    });
  } catch (e) {
    console.error('postApproveQuote:', e);
    const status = e.statusCode || 500;
    res.status(status).json({ success: false, error: e.message || 'Could not approve quote' });
  }
}

function streamPublicOwnerSignature(res, owner) {
  if (!owner?.png || !owner.png.length) {
    return res.status(404).json({ success: false, error: 'No signature' });
  }
  const png = Buffer.isBuffer(owner.png) ? owner.png : Buffer.from(owner.png);
  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Cache-Control', 'private, max-age=300');
  return res.send(png);
}

export async function getPublicQuoteOwnerSignatureByNumber(req, res) {
  try {
    const quoteNumber = normalizeQuoteNumberForUrl(req.params.quoteNumber);
    if (!quoteNumber) return res.status(400).json({ success: false, error: 'Invalid quote number' });
    const pool = await getDBConnection();
    if (!pool) return res.status(503).json({ success: false, error: 'Database not available' });
    const ctx = await business.getByQuoteNumber(pool, quoteNumber);
    if (!ctx) return res.status(404).json({ success: false, error: 'Quote not found' });
    const owner = await getOwnerSignature(pool);
    return streamPublicOwnerSignature(res, owner);
  } catch (e) {
    console.error('getPublicQuoteOwnerSignatureByNumber:', e);
    res.status(500).json({ success: false, error: e.message });
  }
}

export async function getPublicQuoteOwnerSignatureByToken(req, res) {
  try {
    const token = String(req.params.token || '').trim();
    if (!token || token.length < 16) {
      return res.status(400).json({ success: false, error: 'Invalid token' });
    }
    const pool = await getDBConnection();
    if (!pool) return res.status(503).json({ success: false, error: 'Database not available' });
    const ctx = await business.getByPublicToken(pool, token);
    if (!ctx) return res.status(404).json({ success: false, error: 'Quote not found' });
    const owner = await getOwnerSignature(pool);
    return streamPublicOwnerSignature(res, owner);
  } catch (e) {
    console.error('getPublicQuoteOwnerSignatureByToken:', e);
    res.status(500).json({ success: false, error: e.message });
  }
}

export async function getPublicQuoteClientSignatureByNumber(req, res) {
  try {
    const quoteNumber = normalizeQuoteNumberForUrl(req.params.quoteNumber);
    if (!quoteNumber) return res.status(400).json({ success: false, error: 'Invalid quote number' });
    const pool = await getDBConnection();
    if (!pool) return res.status(503).json({ success: false, error: 'Database not available' });
    const ctx = await business.getByQuoteNumber(pool, quoteNumber);
    if (!ctx) return res.status(404).json({ success: false, error: 'Quote not found' });
    return streamPublicClientSignature(res, ctx.quote);
  } catch (e) {
    console.error('getPublicQuoteClientSignatureByNumber:', e);
    res.status(500).json({ success: false, error: e.message });
  }
}

export async function getPublicQuoteClientSignatureByToken(req, res) {
  try {
    const token = String(req.params.token || '').trim();
    if (!token || token.length < 16) {
      return res.status(400).json({ success: false, error: 'Invalid token' });
    }
    const pool = await getDBConnection();
    if (!pool) return res.status(503).json({ success: false, error: 'Database not available' });
    const ctx = await business.getByPublicToken(pool, token);
    if (!ctx) return res.status(404).json({ success: false, error: 'Quote not found' });
    return streamPublicClientSignature(res, ctx.quote);
  } catch (e) {
    console.error('getPublicQuoteClientSignatureByToken:', e);
    res.status(500).json({ success: false, error: e.message });
  }
}

function streamPublicClientSignature(res, quote) {
  const st = String(quote.status || '').toLowerCase();
  if (!['approved', 'accepted'].includes(st)) {
    return res.status(404).json({ success: false, error: 'No signature' });
  }
  const buf = quote.client_signature_png;
  if (!buf || !buf.length) return res.status(404).json({ success: false, error: 'No signature' });
  const png = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Cache-Control', 'private, max-age=300');
  return res.send(png);
}
