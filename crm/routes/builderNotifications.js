/**
 * In-app notifications for builder portal.
 */
import { getDBConnection } from '../config/db.js';
import { requireBuilderAuth } from '../middleware/builderAuth.js';
import { ensureDocumentExpiryNotifications } from '../lib/builderPortalNotify.js';

export async function listBuilderNotifications(req, res) {
  try {
    const pool = await getDBConnection();
    if (!pool) return res.status(503).json({ success: false, error: 'Database not available' });
    const bid = req.builderAuth.builderId;
    await ensureDocumentExpiryNotifications(pool, bid).catch(() => {});
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const [rows] = await pool.query(
      `SELECT id, type, title, body, link_url, is_read, created_at
       FROM builder_notifications
       WHERE builder_id = ?
       ORDER BY created_at DESC
       LIMIT ?`,
      [req.builderAuth.builderId, limit]
    );
    const [[{ unread }]] = await pool.query(
      `SELECT COUNT(*) AS unread FROM builder_notifications
       WHERE builder_id = ? AND is_read = 0`,
      [req.builderAuth.builderId]
    );
    res.json({ success: true, data: rows, unread_count: Number(unread) || 0 });
  } catch (e) {
    console.error('listBuilderNotifications:', e);
    res.status(500).json({ success: false, error: e.message });
  }
}

export async function getBuilderUnreadCount(req, res) {
  try {
    const pool = await getDBConnection();
    if (!pool) return res.status(503).json({ success: false, error: 'Database not available' });
    const bid = req.builderAuth.builderId;
    await ensureDocumentExpiryNotifications(pool, bid).catch(() => {});

    const [[msgUnread]] = await pool.query(
      `SELECT COUNT(*) AS c FROM builder_messages
       WHERE builder_id = ? AND sender_type = 'admin' AND is_read = 0 AND is_internal_note = 0`,
      [bid]
    );
    const [[notifUnread]] = await pool.query(
      `SELECT COUNT(*) AS c FROM builder_notifications WHERE builder_id = ? AND is_read = 0`,
      [bid]
    );

    res.json({
      success: true,
      data: {
        messages: Number(msgUnread?.c) || 0,
        notifications: Number(notifUnread?.c) || 0,
        total: (Number(msgUnread?.c) || 0) + (Number(notifUnread?.c) || 0),
      },
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
}

export async function markNotificationsRead(req, res) {
  try {
    const pool = await getDBConnection();
    const bid = req.builderAuth.builderId;
    const all = req.body?.all === true || req.query.all === '1';
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map((x) => parseInt(x, 10)).filter(Boolean) : [];

    if (all) {
      await pool.execute(
        'UPDATE builder_notifications SET is_read = 1 WHERE builder_id = ? AND is_read = 0',
        [bid]
      );
      await pool.execute(
        `UPDATE builder_messages SET is_read = 1
         WHERE builder_id = ? AND sender_type = 'admin' AND is_read = 0 AND is_internal_note = 0`,
        [bid]
      );
    } else if (ids.length) {
      await pool.execute(
        `UPDATE builder_notifications SET is_read = 1 WHERE builder_id = ? AND id IN (${ids.map(() => '?').join(',')})`,
        [bid, ...ids]
      );
    }
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
}

/** Create notification (internal use from other modules). */
export async function notifyBuilder(pool, builderId, { type, title, body, linkUrl }) {
  if (!pool || !builderId) return;
  try {
    await pool.execute(
      `INSERT INTO builder_notifications (builder_id, type, title, body, link_url) VALUES (?, ?, ?, ?, ?)`,
      [builderId, type || 'info', title || 'Update', body || '', linkUrl || null]
    );
  } catch (e) {
    console.warn('[notifyBuilder]', e.message);
  }
}

export function registerBuilderNotificationRoutes(app) {
  app.get('/api/builder-notifications', requireBuilderAuth, listBuilderNotifications);
  app.get('/api/builder-notifications/unread-count', requireBuilderAuth, getBuilderUnreadCount);
  app.post('/api/builder-notifications/mark-read', requireBuilderAuth, markNotificationsRead);
  app.post('/api/builder-notifications/:id/read', requireBuilderAuth, async (req, res) => {
    try {
      const pool = await getDBConnection();
      const bid = req.builderAuth.builderId;
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) {
        return res.status(400).json({ success: false, error: 'Invalid id' });
      }
      await pool.execute(
        'UPDATE builder_notifications SET is_read = 1 WHERE builder_id = ? AND id = ?',
        [bid, id]
      );
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });
}
