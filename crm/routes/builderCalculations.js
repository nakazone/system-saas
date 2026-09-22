/**
 * Saved calculator runs for builder portal.
 */
import crypto from 'crypto';
import { getDBConnection } from '../config/db.js';
import { requireBuilderAuth } from '../middleware/builderAuth.js';
import { getPartnerPricingForBuilder } from './builderPricing.js';
import {
  calculateLine,
  sumCalculationLines,
  shareExpiryDate,
  SHARE_LINK_EXPIRY_DAYS,
} from '../lib/builderPricingCalc.js';

function parseItems(val) {
  if (Array.isArray(val)) return val;
  try {
    return JSON.parse(val);
  } catch {
    return [];
  }
}

function mapCalculationRow(r) {
  return {
    id: r.id,
    label: r.label,
    items: parseItems(r.items_json),
    total_low: r.total_low,
    total_high: r.total_high,
    area_sqft_total: r.area_sqft_total,
    share_token: r.share_token,
    share_expires_at: r.share_expires_at,
    created_at: r.created_at,
  };
}

function isShareExpired(row) {
  if (!row?.share_expires_at) return false;
  return new Date(row.share_expires_at).getTime() < Date.now();
}

async function ensureShareToken(pool, rowId, builderId) {
  const [rows] = await pool.query(
    'SELECT id, share_token FROM builder_calculations WHERE id = ? AND builder_id = ? LIMIT 1',
    [rowId, builderId]
  );
  if (!rows.length) return null;
  let token = rows[0].share_token;
  if (!token) {
    token = crypto.randomBytes(16).toString('hex');
    await pool.execute('UPDATE builder_calculations SET share_token = ? WHERE id = ?', [token, rowId]);
  }
  const expires = shareExpiryDate();
  await pool.execute('UPDATE builder_calculations SET share_expires_at = ? WHERE id = ?', [expires, rowId]);
  return { token, expires };
}

export async function calculateMulti(req, res) {
  try {
    const pool = await getDBConnection();
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    if (!items.length) {
      return res.status(400).json({ success: false, error: 'items array required' });
    }
    const services = await getPartnerPricingForBuilder(pool, req.builderAuth.builderId);
    const lines = [];
    for (const it of items) {
      const serviceId = parseInt(it.service_id, 10);
      const area = parseInt(it.area_sqft, 10);
      const svc = services.find((s) => s.id === serviceId);
      if (!svc || svc.is_locked || !area) continue;
      lines.push(calculateLine(svc, area));
    }
    if (!lines.length) {
      return res.status(400).json({ success: false, error: 'No valid service lines' });
    }
    res.json({
      success: true,
      data: { lines, totals: sumCalculationLines(lines) },
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
}

export async function listCalculations(req, res) {
  try {
    const pool = await getDBConnection();
    const limit = Math.min(20, Math.max(1, parseInt(req.query.limit, 10) || 5));
    const [rows] = await pool.query(
      `SELECT id, label, items_json, total_low, total_high, area_sqft_total, share_token, share_expires_at, created_at
       FROM builder_calculations WHERE builder_id = ? ORDER BY created_at DESC LIMIT ?`,
      [req.builderAuth.builderId, limit]
    );
    res.json({
      success: true,
      data: rows.map(mapCalculationRow),
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
}

export async function getCalculation(req, res) {
  try {
    const pool = await getDBConnection();
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ success: false, error: 'Invalid id' });
    const [rows] = await pool.query(
      `SELECT id, label, items_json, total_low, total_high, area_sqft_total, share_token, share_expires_at, created_at
       FROM builder_calculations WHERE id = ? AND builder_id = ? LIMIT 1`,
      [id, req.builderAuth.builderId]
    );
    if (!rows.length) return res.status(404).json({ success: false, error: 'Not found' });
    res.json({ success: true, data: mapCalculationRow(rows[0]) });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
}

export async function saveCalculation(req, res) {
  try {
    const pool = await getDBConnection();
    const b = req.body || {};
    const items = Array.isArray(b.items) ? b.items : [];
    if (!items.length) {
      return res.status(400).json({ success: false, error: 'items required' });
    }
    const totals = b.totals || sumCalculationLines(items);
    const builderId = req.builderAuth.builderId;
    const updateId = parseInt(b.id, 10);

    if (updateId) {
      const [existing] = await pool.query(
        'SELECT id FROM builder_calculations WHERE id = ? AND builder_id = ? LIMIT 1',
        [updateId, builderId]
      );
      if (!existing.length) {
        return res.status(404).json({ success: false, error: 'Estimate not found' });
      }
      await pool.execute(
        `UPDATE builder_calculations SET label = ?, items_json = ?, total_low = ?, total_high = ?, area_sqft_total = ?
         WHERE id = ? AND builder_id = ?`,
        [
          b.label != null ? String(b.label).slice(0, 255) : null,
          JSON.stringify(items),
          totals.estimate_low_discounted || 0,
          totals.estimate_high_discounted || 0,
          totals.area_sqft || null,
          updateId,
          builderId,
        ]
      );
      return res.json({
        success: true,
        data: {
          id: updateId,
          share_path: null,
        },
      });
    }

    const shareToken = b.generate_share ? crypto.randomBytes(16).toString('hex') : null;
    const shareExpires = shareToken ? shareExpiryDate() : null;
    const [ins] = await pool.execute(
      `INSERT INTO builder_calculations (builder_id, label, items_json, total_low, total_high, area_sqft_total, share_token, share_expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        builderId,
        b.label != null ? String(b.label).slice(0, 255) : null,
        JSON.stringify(items),
        totals.estimate_low_discounted || 0,
        totals.estimate_high_discounted || 0,
        totals.area_sqft || null,
        shareToken,
        shareExpires,
      ]
    );
    const id = ins.insertId;
    res.status(201).json({
      success: true,
      data: {
        id,
        share_token: shareToken,
        share_path: shareToken ? `/builder-calculator-share.html?token=${shareToken}` : null,
        share_expires_at: shareExpires,
        share_expires_days: SHARE_LINK_EXPIRY_DAYS,
      },
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
}

export async function refreshCalculationShare(req, res) {
  try {
    const pool = await getDBConnection();
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ success: false, error: 'Invalid id' });
    const share = await ensureShareToken(pool, id, req.builderAuth.builderId);
    if (!share) return res.status(404).json({ success: false, error: 'Estimate not found' });
    res.json({
      success: true,
      data: {
        id,
        share_token: share.token,
        share_path: `/builder-calculator-share.html?token=${share.token}`,
        share_expires_at: share.expires,
        share_expires_days: SHARE_LINK_EXPIRY_DAYS,
      },
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
}

export async function getSharedCalculation(req, res) {
  try {
    const pool = await getDBConnection();
    const token = String(req.params.token || '').trim();
    if (!token) return res.status(400).json({ success: false, error: 'token required' });
    const [rows] = await pool.query(
      `SELECT c.id, c.label, c.items_json, c.total_low, c.total_high, c.area_sqft_total, c.created_at, c.share_expires_at,
              b.company, b.first_name, b.last_name
       FROM builder_calculations c
       JOIN builders b ON b.id = c.builder_id
       WHERE c.share_token = ? LIMIT 1`,
      [token]
    );
    if (!rows.length) return res.status(404).json({ success: false, error: 'Not found' });
    const r = rows[0];
    if (isShareExpired(r)) {
      return res.status(410).json({ success: false, error: 'Link expired', code: 'share_expired' });
    }
    res.json({
      success: true,
      data: {
        label: r.label,
        items: parseItems(r.items_json),
        total_low: r.total_low,
        total_high: r.total_high,
        area_sqft_total: r.area_sqft_total,
        created_at: r.created_at,
        share_expires_at: r.share_expires_at,
        builder_name: r.company || [r.first_name, r.last_name].filter(Boolean).join(' '),
      },
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
}

export function registerBuilderCalculationRoutes(app) {
  app.post('/api/pricing/calculate-multi', requireBuilderAuth, calculateMulti);
  app.get('/api/builder-calculations/share/:token', getSharedCalculation);
  app.get('/api/builder-calculations', requireBuilderAuth, listCalculations);
  app.get('/api/builder-calculations/:id', requireBuilderAuth, getCalculation);
  app.post('/api/builder-calculations', requireBuilderAuth, saveCalculation);
  app.post('/api/builder-calculations/:id/share', requireBuilderAuth, refreshCalculationShare);
}
