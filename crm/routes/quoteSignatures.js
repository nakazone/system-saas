import { getDBConnection } from '../config/db.js';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import * as sig from '../modules/quotes/quoteSignatureSettings.js';

export async function getOwnerSignatureSettings(req, res) {
  try {
    const pool = await getDBConnection();
    if (!pool) return res.status(503).json({ success: false, error: 'Database not available' });
    const owner = await sig.getOwnerSignature(pool);
    res.json({
      success: true,
      data: {
        name: owner.name || '',
        title: owner.title || '',
        use_auto_signature: !!owner.use_auto_signature,
        has_signature: !!(owner.png && owner.png.length),
        image_url: owner.png && owner.png.length ? '/api/quotes/settings/owner-signature/image' : null,
      },
    });
  } catch (e) {
    console.error('getOwnerSignatureSettings:', e);
    res.status(500).json({ success: false, error: e.message });
  }
}

export async function getOwnerSignatureImage(req, res) {
  try {
    const pool = await getDBConnection();
    if (!pool) return res.status(503).json({ success: false, error: 'Database not available' });
    const owner = await sig.getOwnerSignature(pool);
    if (!owner.png || !owner.png.length) {
      return res.status(404).json({ success: false, error: 'Signature not found' });
    }
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.send(owner.png);
  } catch (e) {
    console.error('getOwnerSignatureImage:', e);
    res.status(500).json({ success: false, error: e.message });
  }
}

export async function putOwnerSignatureSettings(req, res) {
  try {
    const pool = await getDBConnection();
    if (!pool) return res.status(503).json({ success: false, error: 'Database not available' });
    const body = req.body || {};
    const r = await sig.setOwnerSignature(pool, {
      name: body.name,
      title: body.title,
      useAutoSignature: body.use_auto_signature ?? body.useAutoSignature,
      signaturePngBase64: body.signature_png || body.signaturePngBase64,
    });
    if (!r.ok) return res.status(400).json({ success: false, error: r.error });
    res.json({
      success: true,
      data: {
        name: r.name,
        title: r.title || '',
        use_auto_signature: !!r.use_auto_signature,
        has_signature: true,
      },
    });
  } catch (e) {
    console.error('putOwnerSignatureSettings:', e);
    res.status(500).json({ success: false, error: e.message });
  }
}

export async function getQuoteClientSignatureImage(req, res) {
  try {
    const quoteId = parseInt(req.params.id, 10);
    if (!quoteId) return res.status(400).json({ success: false, error: 'Invalid quote id' });
    const pool = await getDBConnection();
    if (!pool) return res.status(503).json({ success: false, error: 'Database not available' });
    const [rows] = await pool.query(
      'SELECT client_signature_png, status FROM quotes WHERE id = ? LIMIT 1',
      [quoteId]
    );
    if (!rows.length) return res.status(404).json({ success: false, error: 'Quote not found' });
    const buf = await sig.getClientSignatureBuffer(rows[0]);
    if (!buf) return res.status(404).json({ success: false, error: 'No client signature' });
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.send(buf);
  } catch (e) {
    console.error('getQuoteClientSignatureImage:', e);
    res.status(500).json({ success: false, error: e.message });
  }
}

export function registerQuoteSignatureRoutes(app) {
  app.get(
    '/api/quotes/settings/owner-signature',
    requireAuth,
    requirePermission('quotes.edit'),
    getOwnerSignatureSettings
  );
  app.get(
    '/api/quotes/settings/owner-signature/image',
    requireAuth,
    requirePermission('quotes.view'),
    getOwnerSignatureImage
  );
  app.put(
    '/api/quotes/settings/owner-signature',
    requireAuth,
    requirePermission('quotes.edit'),
    putOwnerSignatureSettings
  );
  app.get(
    '/api/quotes/:id/client-signature',
    requireAuth,
    requirePermission('quotes.view'),
    getQuoteClientSignatureImage
  );
}
