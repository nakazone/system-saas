/**
 * Builder portal — partner document upload and management.
 */
import path from 'path';
import fs from 'fs';
import { getDBConnection } from '../config/db.js';
import { requireBuilderAuth } from '../middleware/builderAuth.js';
import { uploadBuilderDocument } from '../lib/builderDocumentUpload.js';
import { notifyBuilder } from './builderNotifications.js';
import { adminNotifyEmail, sendBuilderNotification } from '../lib/builderNotify.js';

const DOC_TYPES = ['insurance', 'license', 'w9', 'contract', 'other'];

function docPublicUrl(relPath) {
  const p = String(relPath || '').replace(/^\//, '');
  return p.startsWith('uploads/') ? `/${p}` : `/uploads/${p}`;
}

function isBuilderUploaded(row, builderId) {
  const u = String(row?.uploaded_by || '');
  return u === `builder:${builderId}` || u === 'builder' || u.startsWith(`builder:${builderId}`);
}

export async function listBuilderDocuments(req, res) {
  try {
    const pool = await getDBConnection();
    if (!pool) return res.status(503).json({ success: false, error: 'Database not available' });
    const bid = req.builderAuth.builderId;
    const [rows] = await pool.query(
      `SELECT id, name, type, url, expires_at, status, uploaded_by, created_at
       FROM builder_documents WHERE builder_id = ? ORDER BY created_at DESC`,
      [bid]
    );
    res.json({
      success: true,
      data: rows.map((d) => ({
        ...d,
        can_delete: isBuilderUploaded(d, bid),
        download_url: d.url,
      })),
    });
  } catch (e) {
    console.error('listBuilderDocuments:', e);
    res.status(500).json({ success: false, error: e.message });
  }
}

export async function postBuilderDocument(req, res) {
  try {
    const pool = await getDBConnection();
    if (!pool) return res.status(503).json({ success: false, error: 'Database not available' });
    if (!req.file) return res.status(400).json({ success: false, error: 'file required' });

    const bid = req.builderAuth.builderId;
    const name = String(req.body?.name || req.file.originalname || 'Document').slice(0, 255);
    let type = String(req.body?.type || 'other').toLowerCase();
    if (!DOC_TYPES.includes(type)) type = 'other';
    const expiresRaw = req.body?.expires_at;
    const expires_at =
      expiresRaw && /^\d{4}-\d{2}-\d{2}$/.test(String(expiresRaw).slice(0, 10))
        ? String(expiresRaw).slice(0, 10)
        : null;

    const rel = path
      .join('builder-documents', String(bid), req.file.filename)
      .replace(/\\/g, '/');
    const url = docPublicUrl(rel);
    const uploadedBy = `builder:${bid}`;

    const [ins] = await pool.execute(
      `INSERT INTO builder_documents (builder_id, name, type, url, expires_at, status, uploaded_by)
       VALUES (?, ?, ?, ?, ?, 'pending_review', ?)`,
      [bid, name, type, url, expires_at, uploadedBy]
    );

    const [rows] = await pool.query('SELECT * FROM builder_documents WHERE id = ?', [ins.insertId]);
    const doc = rows[0];

    await notifyBuilder(pool, bid, {
      type: 'document',
      title: 'Document uploaded',
      body: `${name} was submitted for review.`,
      linkUrl: '/builder-profile.html#documents',
    });

    const adminTo = adminNotifyEmail();
    if (adminTo) {
      const [b] = await pool.query(
        'SELECT first_name, last_name, company, email FROM builders WHERE id = ?',
        [bid]
      );
      const builder = b[0] || {};
      await sendBuilderNotification({
        to: adminTo,
        subject: `Builder document uploaded: ${name}`,
        html: `<p><strong>${builder.company || `${builder.first_name || ''} ${builder.last_name || ''}`.trim()}</strong> (${builder.email || ''}) uploaded <strong>${name}</strong> (${type}).</p><p>Review in CRM Builders module.</p>`,
      });
    }

    res.status(201).json({
      success: true,
      data: { ...doc, can_delete: true, download_url: doc.url },
    });
  } catch (e) {
    console.error('postBuilderDocument:', e);
    res.status(500).json({ success: false, error: e.message });
  }
}

export async function deleteBuilderDocument(req, res) {
  try {
    const pool = await getDBConnection();
    if (!pool) return res.status(503).json({ success: false, error: 'Database not available' });
    const bid = req.builderAuth.builderId;
    const docId = parseInt(req.params.id, 10);
    const [rows] = await pool.query(
      'SELECT * FROM builder_documents WHERE id = ? AND builder_id = ?',
      [docId, bid]
    );
    if (!rows.length) return res.status(404).json({ success: false, error: 'Document not found' });
    const doc = rows[0];
    if (!isBuilderUploaded(doc, bid)) {
      return res.status(403).json({
        success: false,
        error: 'Only documents you uploaded can be removed. Contact Senior Floors for others.',
      });
    }

    const urlPath = String(doc.url || '').replace(/^\//, '');
    if (urlPath.startsWith('uploads/')) {
      const abs = path.join(process.cwd(), urlPath);
      try {
        if (fs.existsSync(abs)) fs.unlinkSync(abs);
      } catch (_) {
        /* ignore file delete errors */
      }
    }

    await pool.execute('DELETE FROM builder_documents WHERE id = ? AND builder_id = ?', [docId, bid]);
    res.json({ success: true });
  } catch (e) {
    console.error('deleteBuilderDocument:', e);
    res.status(500).json({ success: false, error: e.message });
  }
}

export function registerBuilderDocumentRoutes(app) {
  app.get('/api/builder-documents', requireBuilderAuth, listBuilderDocuments);
  app.post(
    '/api/builder-documents',
    requireBuilderAuth,
    (req, res, next) => {
      uploadBuilderDocument.single('file')(req, res, (err) => {
        if (err) return res.status(400).json({ success: false, error: err.message });
        next();
      });
    },
    postBuilderDocument
  );
  app.delete('/api/builder-documents/:id', requireBuilderAuth, deleteBuilderDocument);
}
