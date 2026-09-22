/**
 * Builder ? Senior Floors messaging.
 */
import { getDBConnection } from '../config/db.js';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { requireBuilderAuth } from '../middleware/builderAuth.js';
import path from 'path';
import { sendBuilderNotification, adminNotifyEmail } from '../lib/builderNotify.js';
import { builderWantsEmail } from '../lib/builderNotifyPrefs.js';
import { uploadBuilderMessageAttachment } from '../lib/builderMessageUpload.js';
import { notifyBuilder } from './builderNotifications.js';
import { logBuilderActivity } from '../lib/builderActivityLog.js';

function conversationIdForBuilder(builderId) {
  return Number(builderId);
}

export async function listConversationsAdmin(req, res) {
  try {
    const pool = await getDBConnection();
    const unreadOnly = req.query.unread === '1';
    const [rows] = await pool.query(
      `
      SELECT b.id AS builder_id, b.first_name, b.last_name, b.company, b.email, b.status,
        (SELECT m.message FROM builder_messages m
         WHERE m.builder_id = b.id AND m.is_internal_note = 0
         ORDER BY m.created_at DESC LIMIT 1) AS last_message,
        (SELECT m.created_at FROM builder_messages m
         WHERE m.builder_id = b.id AND m.is_internal_note = 0
         ORDER BY m.created_at DESC LIMIT 1) AS last_at,
        (SELECT COUNT(*) FROM builder_messages m
         WHERE m.builder_id = b.id AND m.sender_type = 'builder' AND m.is_read = 0 AND m.is_internal_note = 0) AS unread_count
      FROM builders b
      WHERE EXISTS (SELECT 1 FROM builder_messages m2 WHERE m2.builder_id = b.id)
      ${unreadOnly ? 'AND (SELECT COUNT(*) FROM builder_messages m3 WHERE m3.builder_id = b.id AND m3.sender_type = \'builder\' AND m3.is_read = 0 AND m3.is_internal_note = 0) > 0' : ''}
      ORDER BY last_at DESC
    `
    );
    res.json({ success: true, data: rows });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
}

export async function getThread(req, res) {
  try {
    const pool = await getDBConnection();
    let builderId;
    const includeInternal = req.query.include_internal === '1';
    if (req.builderAuth) {
      builderId = req.builderAuth.builderId;
    } else {
      builderId = parseInt(req.params.builderId, 10);
    }
    const projectId =
      req.query.project_id != null && req.query.project_id !== ''
        ? parseInt(req.query.project_id, 10)
        : null;

    let sql = `SELECT m.*, u.name AS admin_name
      FROM builder_messages m
      LEFT JOIN users u ON m.sender_type = 'admin' AND m.sender_id = u.id
      WHERE m.builder_id = ?`;
    const sqlParams = [builderId];
    if (req.builderAuth || !includeInternal) {
      sql += ' AND m.is_internal_note = 0';
    }
    if (Number.isFinite(projectId) && projectId > 0) {
      sql += ' AND m.project_id = ?';
      sqlParams.push(projectId);
    } else if (req.query.general === '1') {
      sql += ' AND m.project_id IS NULL';
    }
    sql += ' ORDER BY m.created_at ASC';
    const [rows] = await pool.query(sql, sqlParams);

    if (req.builderAuth) {
      await pool.execute(
        `UPDATE builder_messages SET is_read = 1
         WHERE builder_id = ? AND sender_type = 'admin' AND is_read = 0`,
        [builderId]
      );
    } else if (builderId) {
      await pool.execute(
        `UPDATE builder_messages SET is_read = 1
         WHERE builder_id = ? AND sender_type = 'builder' AND is_read = 0`,
        [builderId]
      );
    }

    const [builder] = await pool.query(
      'SELECT id, first_name, last_name, company, email, status FROM builders WHERE id = ?',
      [builderId]
    );
    res.json({
      success: true,
      data: { builder: builder[0] || null, messages: rows },
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
}

export async function postMessage(req, res) {
  try {
    const pool = await getDBConnection();
    const body = req.body || {};
    let builderId;
    let senderType;
    let senderId = null;

    if (req.builderAuth) {
      builderId = req.builderAuth.builderId;
      senderType = 'builder';
    } else {
      builderId = parseInt(body.builder_id, 10);
      senderType = 'admin';
      senderId = req.session?.userId || null;
      if (!Number.isFinite(builderId)) {
        return res.status(400).json({ success: false, error: 'builder_id required' });
      }
    }

    let attachmentUrl = body.attachment_url || null;
    if (req.file && req.builderAuth) {
      const rel = path
        .join('builder-messages', String(req.builderAuth.builderId), req.file.filename)
        .replace(/\\/g, '/');
      attachmentUrl = `/uploads/${rel}`;
    }
    const message = String(body.message || '').trim() || (attachmentUrl ? '(attachment)' : '');
    if (!message && !attachmentUrl) {
      return res.status(400).json({ success: false, error: 'message or attachment required' });
    }

    const isInternal = req.builderAuth ? false : !!body.is_internal_note;
    const projectId = body.project_id != null ? parseInt(body.project_id, 10) : null;
    const convId = conversationIdForBuilder(builderId);

    const [ins] = await pool.execute(
      `INSERT INTO builder_messages (
        conversation_id, builder_id, project_id, sender_type, sender_id, message, attachment_url, is_internal_note, is_read
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      [
        convId,
        builderId,
        Number.isFinite(projectId) ? projectId : null,
        senderType,
        senderId,
        message,
        attachmentUrl,
        isInternal ? 1 : 0,
      ]
    );

    const [rows] = await pool.query('SELECT * FROM builder_messages WHERE id = ?', [ins.insertId]);
    const row = rows[0];

    if (!isInternal) {
      let projectName = null;
      if (Number.isFinite(projectId)) {
        const [pr] = await pool.query('SELECT name FROM projects WHERE id = ?', [projectId]);
        projectName = pr[0]?.name || null;
      }
      const snippet = message.slice(0, 90);
      const onProj = projectName ? ` on ${projectName}` : '';
      if (senderType === 'admin') {
        logBuilderActivity(pool, {
          builderId,
          projectId: Number.isFinite(projectId) ? projectId : null,
          type: 'message_sf',
          text: `Senior Floors sent a message${onProj}: ${snippet}`,
          href: 'builder-messages.html',
        }).catch(() => {});
      } else {
        logBuilderActivity(pool, {
          builderId,
          projectId: Number.isFinite(projectId) ? projectId : null,
          type: 'message_builder',
          text: `You sent a message${onProj}: ${snippet}`,
          href: 'builder-messages.html',
        }).catch(() => {});
      }
    }

    if (!isInternal) {
      const [b] = await pool.query(
        'SELECT email, first_name, company, notification_prefs FROM builders WHERE id = ?',
        [builderId]
      );
      if (senderType === 'admin' && b[0]?.email && builderWantsEmail(b[0].notification_prefs, 'messages')) {
        const pub = process.env.PUBLIC_CRM_URL || '';
        sendBuilderNotification({
          to: b[0].email,
          subject: 'New message from Senior Floors',
          html: `<p>Hi ${b[0].first_name || 'there'},</p><p>You have a new message in your Builder Portal.</p><p><em>${message.slice(0, 500)}</em></p><p><a href="${pub}/builder-messages.html">Open messages</a></p>`,
        }).catch((e) => console.warn('[builderMessages] notify builder:', e));
        notifyBuilder(pool, builderId, {
          type: 'message',
          title: 'New message from Senior Floors',
          body: message.slice(0, 200),
          linkUrl: '/builder-messages.html',
        }).catch(() => {});
      } else if (senderType === 'builder') {
        const adminTo = adminNotifyEmail();
        if (adminTo) {
          const fromName = b[0]?.company || `${b[0]?.first_name || ''}`.trim() || 'Builder';
          sendBuilderNotification({
            to: adminTo,
            subject: `New builder message ù ${fromName}`,
            html: `<p>Message from partner:</p><p>${message.slice(0, 800)}</p><p><a href="${process.env.PUBLIC_CRM_URL || ''}/builder-messages-admin.html?builder_id=${builderId}">Reply in CRM</a></p>`,
          }).catch((e) => console.warn('[builderMessages] notify admin:', e));
        }
      }
    }

    res.status(201).json({ success: true, data: row });
  } catch (e) {
    console.error('postMessage:', e);
    res.status(500).json({ success: false, error: e.message });
  }
}

export function registerBuilderMessagesRoutes(app) {
  app.get(
    '/api/builder-messages/conversations',
    requireAuth,
    requirePermission('builders.view'),
    listConversationsAdmin
  );
  app.get(
    '/api/builder-messages/thread/:builderId',
    requireAuth,
    requirePermission('builders.view'),
    getThread
  );
  app.get('/api/builder-messages/partner/thread', requireBuilderAuth, getThread);
  app.get('/api/builder-messages/partner/unread-count', requireBuilderAuth, async (req, res) => {
    try {
      const pool = await getDBConnection();
      const [[row]] = await pool.query(
        `SELECT COUNT(*) AS c FROM builder_messages
         WHERE builder_id = ? AND sender_type = 'admin' AND is_read = 0 AND is_internal_note = 0`,
        [req.builderAuth.builderId]
      );
      res.json({ success: true, data: { count: Number(row?.c) || 0 } });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });
  app.post('/api/builder-messages', requireAuth, requirePermission('builders.edit'), postMessage);
  app.post(
    '/api/builder-messages/partner',
    requireBuilderAuth,
    (req, res, next) => {
      uploadBuilderMessageAttachment.single('attachment')(req, res, (err) => {
        if (err) return res.status(400).json({ success: false, error: err.message });
        next();
      });
    },
    postMessage
  );
}
