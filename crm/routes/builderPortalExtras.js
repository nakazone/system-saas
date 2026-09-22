/**
 * Builder portal ù photos delete, materials approval, confirm access, activity.
 */
import path from 'path';
import fs from 'fs';
import { getDBConnection } from '../config/db.js';
import { requireBuilderAuth } from '../middleware/builderAuth.js';
import { assertBuilderOwnsProject } from '../lib/builderProjectAccess.js';
import { refreshChecklistCompletedFlag } from '../modules/projects/projectHelpers.js';
import { notifyBuilder } from './builderNotifications.js';
import { adminNotifyEmail, sendBuilderNotification } from '../lib/builderNotify.js';
import {
  backfillBuilderActivityIfEmpty,
  fetchBuilderActivityFeed,
  logBuilderActivity,
} from '../lib/builderActivityLog.js';
import { notifySfMaterialAction } from '../lib/builderMaterialPortal.js';

async function columnExists(pool, table, col) {
  const [r] = await pool.query(
    `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, col]
  );
  return Number(r[0]?.c) > 0;
}

async function tableExists(pool, name) {
  const [r] = await pool.query(
    `SELECT COUNT(*) AS c FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [name]
  );
  return Number(r[0]?.c) > 0;
}

export async function deleteBuilderProjectPhoto(req, res) {
  return res.status(403).json({
    success: false,
    error: 'Builders cannot delete site photos. Contact Senior Floors if a photo should be removed.',
  });
}

export async function putBuilderProjectMaterial(req, res) {
  try {
    const pool = await getDBConnection();
    if (!pool) return res.status(503).json({ success: false, error: 'Database not available' });
    const projectId = parseInt(req.params.id, 10);
    const mid = parseInt(req.params.materialId, 10);
    const bid = req.builderAuth.builderId;
    const project = await assertBuilderOwnsProject(pool, bid, projectId);
    if (!project) return res.status(404).json({ success: false, error: 'Project not found' });

    const status = String(req.body?.builder_approval_status || '').toLowerCase();
    if (!['approved', 'rejected', 'pending', 'change_requested'].includes(status)) {
      return res.status(400).json({ success: false, error: 'Invalid approval status' });
    }
    const hasVisible = await columnExists(pool, 'project_materials', 'visible_to_builder');
    const hasApproval = await columnExists(pool, 'project_materials', 'builder_approval_status');
    if (!hasApproval) {
      return res.status(503).json({ success: false, error: 'Materials approval not available yet' });
    }

    const where = hasVisible
      ? 'id = ? AND project_id = ? AND visible_to_builder = 1'
      : 'id = ? AND project_id = ?';
    const comment =
      req.body?.builder_comment != null ? String(req.body.builder_comment).slice(0, 2000) : null;

    await pool.execute(
      `UPDATE project_materials SET builder_approval_status = ?, builder_comment = ? WHERE ${where}`,
      [status, comment, mid, projectId]
    );

    if (['rejected', 'approved', 'change_requested'].includes(status)) {
      const [m] = await pool.query(
        'SELECT product_name FROM project_materials WHERE id = ?',
        [mid]
      );
      await notifySfMaterialAction(pool, {
        projectId,
        projectName: project.name,
        builderId: bid,
        action: status === 'change_requested' ? 'change_requested' : status,
        productName: m[0]?.product_name,
        comment,
      });
    }

    const [rows] = await pool.query('SELECT * FROM project_materials WHERE id = ?', [mid]);
    res.json({ success: true, data: rows[0] });
  } catch (e) {
    console.error('putBuilderProjectMaterial:', e);
    res.status(500).json({ success: false, error: e.message });
  }
}

export async function postBuilderMaterialsApproveAll(req, res) {
  try {
    const pool = await getDBConnection();
    const projectId = parseInt(req.params.id, 10);
    const bid = req.builderAuth.builderId;
    const project = await assertBuilderOwnsProject(pool, bid, projectId);
    if (!project) return res.status(404).json({ success: false, error: 'Project not found' });

    const hasVisible = await columnExists(pool, 'project_materials', 'visible_to_builder');
    const where = hasVisible
      ? 'project_id = ? AND visible_to_builder = 1 AND builder_approval_status = \'pending\''
      : 'project_id = ? AND builder_approval_status = \'pending\'';
    const [r] = await pool.execute(
      `UPDATE project_materials SET builder_approval_status = 'approved', builder_comment = NULL WHERE ${where}`,
      [projectId]
    );
    if (r.affectedRows > 0) {
      await notifySfMaterialAction(pool, {
        projectId,
        projectName: project.name,
        builderId: bid,
        action: 'approve_all',
        count: r.affectedRows,
      });
    }
    res.json({ success: true, updated: r.affectedRows });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
}

export async function postBuilderConfirmAccess(req, res) {
  try {
    const pool = await getDBConnection();
    const projectId = parseInt(req.params.id, 10);
    const bid = req.builderAuth.builderId;
    const project = await assertBuilderOwnsProject(pool, bid, projectId);
    if (!project) return res.status(404).json({ success: false, error: 'Project not found' });

    const [existing] = await pool.query(
      `SELECT id FROM project_checklist WHERE project_id = ? AND item = ? LIMIT 1`,
      [projectId, 'Property access confirmed by builder']
    );
    const hasVisible = await columnExists(pool, 'project_checklist', 'visible_to_builder');
    const hasAssigned = await columnExists(pool, 'project_checklist', 'assigned_to');

    if (existing.length) {
      await pool.execute(
        'UPDATE project_checklist SET checked = 1, checked_at = NOW() WHERE id = ?',
        [existing[0].id]
      );
    } else {
      const cols = ['project_id', 'category', 'item', 'checked', 'checked_at'];
      const vals = [projectId, 'Access', 'Property access confirmed by builder', 1, new Date()];
      if (hasVisible) {
        cols.push('visible_to_builder');
        vals.push(1);
      }
      if (hasAssigned) {
        cols.push('assigned_to');
        vals.push('builder');
      }
      await pool.execute(
        `INSERT INTO project_checklist (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
        vals
      );
    }
    await refreshChecklistCompletedFlag(pool, projectId);

    await logBuilderActivity(pool, {
      builderId: bid,
      projectId,
      type: 'checklist',
      text: `Property access confirmed for ${project.name || 'project'}`,
    });

    const adminTo = adminNotifyEmail();
    if (adminTo) {
      await sendBuilderNotification({
        to: adminTo,
        subject: `Builder confirmed property access ù ${project.name || projectId}`,
        html: `<p>Partner confirmed site access for project <strong>${project.name || projectId}</strong>.</p><p>${project.address || ''}</p>`,
      });
    }

    res.json({ success: true, message: 'Property access confirmed' });
  } catch (e) {
    console.error('postBuilderConfirmAccess:', e);
    res.status(500).json({ success: false, error: e.message });
  }
}

export async function buildBuilderActivityFeed(pool, builderId, limit = 10, since = null) {
  await backfillBuilderActivityIfEmpty(pool, builderId);
  return fetchBuilderActivityFeed(pool, builderId, { since, limit });
}

export function registerBuilderPortalExtraRoutes(app) {
  app.delete(
    '/api/builder-projects/:id/photos/:photoId',
    requireBuilderAuth,
    deleteBuilderProjectPhoto
  );
  app.put(
    '/api/builder-projects/:id/materials/:materialId',
    requireBuilderAuth,
    putBuilderProjectMaterial
  );
  app.post(
    '/api/builder-projects/:id/materials/approve-all',
    requireBuilderAuth,
    postBuilderMaterialsApproveAll
  );
  app.post('/api/builder-projects/:id/confirm-access', requireBuilderAuth, postBuilderConfirmAccess);
}
