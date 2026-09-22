/**
 * Builder portal  project tracking, photos, checklist (scoped to logged-in partner).
 */
import path from 'path';
import { getDBConnection } from '../config/db.js';
import { requireBuilderAuth } from '../middleware/builderAuth.js';
import { uploadProjectPhoto } from '../lib/projectPhotoUpload.js';
import {
  assertBuilderOwnsProject,
  buildProjectBuilderMatch,
  buildProjectOrderSql,
  buildProjectSelectSql,
  getBuilderCustomerId,
  getProjectBuilderLinkMeta,
  normalizeProjectRow,
  photoPublicUrl,
  projectNotDeletedClause,
} from '../lib/builderProjectAccess.js';
import { refreshChecklistCompletedFlag } from '../modules/projects/projectHelpers.js';
import { enrichBuilderMaterials } from '../lib/builderMaterialPortal.js';
import { fetchNextBuilderVisit } from '../lib/builderVisitScope.js';
import { buildBuilderActivityFeed } from './builderPortalExtras.js';
import { resolveProjectTeamForBuilder } from '../lib/builderProjectTeam.js';
import { logBuilderActivity } from '../lib/builderActivityLog.js';
import { resolveBuilderAccountManager } from '../lib/builderAccountManager.js';

async function tableExists(pool, name) {
  const [r] = await pool.query(
    `SELECT COUNT(*) AS c FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [name]
  );
  return Number(r[0]?.c) > 0;
}

async function columnExists(pool, table, col) {
  const [r] = await pool.query(
    `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, col]
  );
  return Number(r[0]?.c) > 0;
}

async function fetchBuilderProjectPhotos(pool, projectId) {
  const cols = ['id', 'phase', 'file_path', 'caption', 'created_at'];
  if (await columnExists(pool, 'project_photos', 'file_url')) cols.push('file_url');
  if (await columnExists(pool, 'project_photos', 'partner_upload')) cols.push('partner_upload');
  if (await columnExists(pool, 'project_photos', 'uploaded_by_builder_id')) {
    cols.push('uploaded_by_builder_id');
  }
  const hasPartner = cols.includes('partner_upload');
  const where = hasPartner
    ? 'project_id = ? AND (partner_upload = 0 OR partner_upload IS NULL)'
    : 'project_id = ?';
  const [rows] = await pool.query(
    `SELECT ${cols.join(', ')} FROM project_photos WHERE ${where} ORDER BY created_at DESC`,
    [projectId]
  );
  return rows.map((ph) => ({
    ...ph,
    partner_upload: 0,
  }));
}

async function fetchBuilderProjectChecklist(pool, projectId) {
  const hasChkVisible = await columnExists(pool, 'project_checklist', 'visible_to_builder');
  const hasAssigned = await columnExists(pool, 'project_checklist', 'assigned_to');
  const hasDue = await columnExists(pool, 'project_checklist', 'due_date');
  const hasApprovalChk = await columnExists(pool, 'project_checklist', 'approval_status');
  const hasSort = await columnExists(pool, 'project_checklist', 'sort_order');
  const cols = ['id', 'category', 'item', 'checked', 'notes'];
  if (hasAssigned) cols.push('assigned_to');
  if (hasChkVisible) cols.push('visible_to_builder');
  if (hasDue) cols.push('due_date');
  if (hasApprovalChk) cols.push('approval_status');
  const where = hasChkVisible ? 'project_id = ? AND visible_to_builder = 1' : 'project_id = ?';
  const order = hasSort ? 'sort_order ASC, id ASC' : 'id ASC';
  const [rows] = await pool.query(
    `SELECT ${cols.join(', ')} FROM project_checklist WHERE ${where} ORDER BY ${order}`,
    [projectId]
  );
  return rows;
}

const TIMELINE_STEPS = [
  { key: 'scheduled', label: 'Scheduled', minPct: 0 },
  { key: 'material', label: 'Material confirmed', minPct: 10 },
  { key: 'start', label: 'Work started', minPct: 25 },
  { key: 'installation', label: 'Installation', minPct: 45 },
  { key: 'finishing', label: 'Finishing', minPct: 70 },
  { key: 'inspection', label: 'Final inspection', minPct: 90 },
  { key: 'completed', label: 'Completed', minPct: 100 },
];

function toYmd(d) {
  if (!d) return null;
  const s = String(d).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

function addDaysYmd(ymd, days) {
  if (!ymd) return null;
  const d = new Date(`${ymd}T12:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function daysBetweenYmd(a, b) {
  if (!a || !b) return null;
  const d0 = new Date(`${a}T12:00:00`);
  const d1 = new Date(`${b}T12:00:00`);
  return Math.max(0, Math.round((d1 - d0) / 86400000));
}

function buildTimeline(project) {
  const pct = Number(project.completion_percentage) || 0;
  const st = String(project.status || '').toLowerCase();
  const forceDone = st === 'completed' || pct >= 100;
  const startYmd = toYmd(project.start_date);
  const endEstYmd = toYmd(project.end_date_estimated);
  const endActYmd = toYmd(project.end_date_actual);
  const spanDays = startYmd && endEstYmd ? daysBetweenYmd(startYmd, endEstYmd) : null;

  return TIMELINE_STEPS.map((step, idx) => {
    const next = TIMELINE_STEPS[idx + 1];
    const done = forceDone || pct >= (next ? next.minPct : 100);
    const active = !done && pct >= step.minPct && (!next || pct < next.minPct);
    let date_planned = null;
    let date_actual = null;
    if (startYmd && spanDays != null) {
      date_planned = addDaysYmd(startYmd, Math.round((spanDays * step.minPct) / 100));
    }
    if (done && forceDone && endActYmd && idx === TIMELINE_STEPS.length - 1) {
      date_actual = endActYmd;
    } else if (done && startYmd && next) {
      date_actual = addDaysYmd(startYmd, Math.round((spanDays * next.minPct) / 100));
    }
    return {
      ...step,
      status: done ? 'done' : active ? 'active' : 'pending',
      date_planned,
      date_actual,
    };
  });
}

export async function getBuilderPortalProject(req, res) {
  try {
    const pool = await getDBConnection();
    if (!pool) return res.status(503).json({ success: false, error: 'Database not available' });
    const projectId = parseInt(req.params.id, 10);
    const project = normalizeProjectRow(
      await assertBuilderOwnsProject(pool, req.builderAuth.builderId, projectId)
    );
    if (!project) return res.status(404).json({ success: false, error: 'Project not found' });

    const checklist = await fetchBuilderProjectChecklist(pool, projectId);
    const photos = await fetchBuilderProjectPhotos(pool, projectId);

    let materials = [];
    const hasMatVisible = await columnExists(pool, 'project_materials', 'visible_to_builder');
    const matWhere = hasMatVisible
      ? 'project_id = ? AND visible_to_builder = 1'
      : 'project_id = ?';
    const hasApproval = await columnExists(pool, 'project_materials', 'builder_approval_status');
    const hasColor = await columnExists(pool, 'project_materials', 'material_color');
    const hasSpec = await columnExists(pool, 'project_materials', 'material_spec');
    const hasImg = await columnExists(pool, 'project_materials', 'material_image_url');
    const hasErp = await columnExists(pool, 'project_materials', 'erp_product_id');
    const matCols = `id, product_name, sku, supplier, unit, qty_ordered, qty_received, qty_used,
              status, order_date, received_date, service_category, notes${
                hasApproval ? ', builder_approval_status, builder_comment' : ''
              }${hasColor ? ', material_color' : ''}${hasSpec ? ', material_spec' : ''}${
                hasImg ? ', material_image_url' : ''
              }${hasErp ? ', erp_product_id' : ''}`;
    const [matRows] = await pool.query(
      `SELECT ${matCols} FROM project_materials WHERE ${matWhere} ORDER BY id`,
      [projectId]
    );
    materials = await enrichBuilderMaterials(pool, matRows);

    let documents = [];
    if (await tableExists(pool, 'project_documents')) {
      const hasDocVis = await columnExists(pool, 'project_documents', 'visible_to_builder');
      const hasDocName = await columnExists(pool, 'project_documents', 'display_name');
      const docWhere = hasDocVis ? 'project_id = ? AND visible_to_builder = 1' : 'project_id = ?';
      const [docs] = await pool.query(
        `SELECT id, file_path, doc_type, created_at${hasDocName ? ', display_name' : ''}
         FROM project_documents WHERE ${docWhere} ORDER BY created_at DESC`,
        [projectId]
      );
      documents = docs.map((d) => {
        const fp = String(d.file_path || '').replace(/^\//, '');
        const url = fp.startsWith('uploads/') ? `/${fp}` : `/uploads/${fp}`;
        return {
          id: d.id,
          name: d.display_name || d.doc_type || 'Document',
          doc_type: d.doc_type,
          url,
          created_at: d.created_at,
        };
      });
    }

    const builderItems = checklist.filter(
      (it) => String(it.assigned_to || 'sf').toLowerCase() === 'builder'
    );
    const checklist_progress = {
      total: builderItems.length,
      done: builderItems.filter((it) => it.checked === 1 || it.checked === true).length,
    };

    const project_team = await resolveProjectTeamForBuilder(pool, project);
    const manager =
      project_team.find((m) => m.role === 'general_manager' && m.name) || project_team[0] || null;

    const safeProject = {
      id: project.id,
      name: project.name,
      address: project.address,
      status: project.status,
      completion_percentage: project.completion_percentage,
      start_date: project.start_date,
      end_date_estimated: project.end_date_estimated,
      end_date_actual: project.end_date_actual,
      flooring_type: project.flooring_type,
      total_sqft: project.total_sqft,
      service_type: project.service_type,
      project_number: project.project_number,
      client_notes: project.notes,
      internal_notes_for_builder: project.internal_notes || null,
    };

    res.json({
      success: true,
      data: {
        project: safeProject,
        timeline: buildTimeline(project),
        checklist,
        checklist_progress,
        checklist_groups: {
          builder: checklist.filter(
            (it) =>
              String(it.assigned_to || 'sf').toLowerCase() === 'builder' &&
              String(it.approval_status || '') !== 'pending_sf'
          ),
          sf: checklist.filter(
            (it) =>
              String(it.assigned_to || 'sf').toLowerCase() !== 'builder' &&
              String(it.approval_status || '') !== 'pending_sf'
          ),
          awaiting: checklist.filter((it) => String(it.approval_status || '') === 'pending_sf'),
        },
        documents,
        photos: photos.map((ph) => ({
          ...ph,
          url: photoPublicUrl(ph),
          partner_label: null,
        })),
        materials,
        manager,
        project_team,
      },
    });
  } catch (e) {
    console.error('getBuilderPortalProject:', e);
    res.status(500).json({ success: false, error: e.message });
  }
}

export async function postBuilderProjectPhotos(req, res) {
  return res.status(403).json({
    success: false,
    error:
      'Builders cannot upload site photos. Senior Floors adds photos from the CRM; use this tab to view them.',
  });
}

export async function putBuilderProjectChecklist(req, res) {
  try {
    const pool = await getDBConnection();
    if (!pool) return res.status(503).json({ success: false, error: 'Database not available' });
    const projectId = parseInt(req.params.id, 10);
    const itemId = parseInt(req.params.itemId, 10);
    const project = await assertBuilderOwnsProject(pool, req.builderAuth.builderId, projectId);
    if (!project) return res.status(404).json({ success: false, error: 'Project not found' });

    const hasChkVisible = await columnExists(pool, 'project_checklist', 'visible_to_builder');
    const chkWhere = hasChkVisible
      ? 'id = ? AND project_id = ? AND visible_to_builder = 1'
      : 'id = ? AND project_id = ?';
    const [items] = await pool.query(`SELECT * FROM project_checklist WHERE ${chkWhere}`, [
      itemId,
      projectId,
    ]);
    if (!items.length) return res.status(404).json({ success: false, error: 'Checklist item not found' });
    const item = items[0];
    if (String(item.assigned_to || 'sf').toLowerCase() !== 'builder') {
      return res.status(403).json({
        success: false,
        error: 'This item can only be completed by Senior Floors',
      });
    }

    const checked = !!req.body?.checked;
    const hasApprovalChk = await columnExists(pool, 'project_checklist', 'approval_status');
    const approvalSet = hasApprovalChk && checked ? ", approval_status = 'pending_sf'" : hasApprovalChk && !checked ? ", approval_status = NULL" : '';
    await pool.execute(
      `UPDATE project_checklist SET checked = ?, checked_at = IF(? = 1, NOW(), NULL), checked_by = NULL${approvalSet}
       WHERE id = ? AND project_id = ?`,
      [checked ? 1 : 0, checked ? 1 : 0, itemId, projectId]
    );
    await refreshChecklistCompletedFlag(pool, projectId);
    const [rows] = await pool.query('SELECT * FROM project_checklist WHERE id = ?', [itemId]);
    res.json({ success: true, data: rows[0] });
  } catch (e) {
    console.error('putBuilderProjectChecklist:', e);
    res.status(500).json({ success: false, error: e.message });
  }
}

export async function listBuilderPortalProjects(req, res) {
  try {
    const pool = await getDBConnection();
    if (!pool) return res.status(503).json({ success: false, error: 'Database not available' });
    const auth = req.builderAuth;
    const cid = await getBuilderCustomerId(pool, auth.builderId);
    if (!cid) {
      return res.json({
        success: true,
        data: [],
        hint: 'Builder account is not linked to a CRM customer. Contact Senior Floors.',
      });
    }
    const linkMeta = await getProjectBuilderLinkMeta(pool);
    const match = buildProjectBuilderMatch('p', auth.builderId, cid, linkMeta);
    const selectSql = await buildProjectSelectSql(
      pool,
      [
        'id',
        'name',
        'address',
        'status',
        'completion_percentage',
        'start_date',
        'end_date_estimated',
        'end_date_actual',
        'flooring_type',
        'total_sqft',
        'project_number',
        'service_type',
        'updated_at',
        'contract_value',
      ],
      'p'
    );
    const orderSql = await buildProjectOrderSql(pool, 'updated_at', 'p');
    const [rows] = await pool.query(
      `SELECT ${selectSql}
       FROM projects p
       WHERE ${match.sql}${projectNotDeletedClause('p', linkMeta)}
       ORDER BY ${orderSql} DESC`,
      match.params
    );

    const enriched = [];
    for (const row of rows.map(normalizeProjectRow)) {
      const pid = row.id;
      const [[{ photo_count }]] = await pool.query(
        'SELECT COUNT(*) AS photo_count FROM project_photos WHERE project_id = ?',
        [pid]
      );
      let manager_name = null;
      if (row.assigned_to) {
        const [u] = await pool.query('SELECT name FROM users WHERE id = ? LIMIT 1', [row.assigned_to]);
        manager_name = u[0]?.name || null;
      }
      const pct = Number(row.completion_percentage) || 0;
      let next_step = TIMELINE_STEPS[0].label;
      for (let i = TIMELINE_STEPS.length - 1; i >= 0; i--) {
        if (pct >= TIMELINE_STEPS[i].minPct) {
          next_step = TIMELINE_STEPS[i].label;
          break;
        }
      }
      let cover_url = null;
      const [cov] = await pool.query(
        `SELECT file_path, file_url FROM project_photos WHERE project_id = ? ORDER BY created_at DESC LIMIT 1`,
        [pid]
      );
      if (cov.length) cover_url = photoPublicUrl(cov[0]);

      enriched.push({
        ...row,
        photo_count: Number(photo_count) || 0,
        manager_name,
        next_step,
        cover_url,
        updated_at: row.updated_at,
      });
    }
    res.json({ success: true, data: enriched });
  } catch (e) {
    console.error('listBuilderPortalProjects:', e);
    res.status(500).json({ success: false, error: e.message });
  }
}

export async function getBuilderDashboard(req, res) {
  try {
    const pool = await getDBConnection();
    if (!pool) return res.status(503).json({ success: false, error: 'Database not available' });
    const auth = req.builderAuth;
    const bid = auth.builderId;
    const cid = await getBuilderCustomerId(pool, bid);

    const [builder] = await pool.query(
      `SELECT first_name, last_name, company, account_manager_user_id, portal_last_seen_at, portal_welcome_dismissed_at
       FROM builders WHERE id = ?`,
      [bid]
    );
    const bRow = builder[0] || {};
    const account_manager = await resolveBuilderAccountManager(pool, bRow.account_manager_user_id);
    const sinceActivity = bRow.portal_last_seen_at || null;
    const is_first_visit = !bRow.portal_welcome_dismissed_at;

    const hasExpires = await columnExists(pool, 'builder_documents', 'expires_at');
    const [docs] = await pool.query(
      `SELECT COUNT(*) AS c FROM builder_documents WHERE builder_id = ? AND (
        status != 'valid'${hasExpires ? ' OR (expires_at IS NOT NULL AND expires_at < CURDATE())' : ''}
      )`,
      [bid]
    );
    const pending_documents = Number(docs[0]?.c) || 0;

    let projects = [];
    if (cid) {
      const linkMeta = await getProjectBuilderLinkMeta(pool);
      const match = buildProjectBuilderMatch('p', bid, cid, linkMeta);
      const selectSql = await buildProjectSelectSql(
        pool,
        [
          'id',
          'name',
          'address',
          'status',
          'completion_percentage',
          'start_date',
          'end_date_estimated',
          'total_sqft',
          'contract_value',
        ],
        'p'
      );
      const [rows] = await pool.query(
        `SELECT ${selectSql} FROM projects p WHERE ${match.sql}${projectNotDeletedClause('p', linkMeta)}`,
        match.params
      );
      projects = rows.map(normalizeProjectRow);
    }

    const active = projects.filter(
      (p) => !['completed', 'cancelled', 'closed'].includes(String(p.status || '').toLowerCase())
    );
    const completed = projects.filter((p) => String(p.status || '').toLowerCase() === 'completed');
    const totalSqft = completed.reduce((s, p) => s + (Number(p.total_sqft) || 0), 0);
    const totalValue = completed.reduce((s, p) => s + (Number(p.contract_value) || 0), 0);
    const year = new Date().getFullYear();
    const completedThisYear = completed.filter((p) => {
      const d = toYmd(p.end_date_actual) || toYmd(p.end_date_estimated);
      return d && d.startsWith(String(year));
    }).length;

    let next_visit = null;
    try {
      next_visit = await fetchNextBuilderVisit(pool, bid);
    } catch (visitErr) {
      console.warn('getBuilderDashboard next_visit:', visitErr.message);
    }
    if (!next_visit) {
      const upcoming = active
        .filter((p) => toYmd(p.start_date))
        .sort((a, b) => String(a.start_date).localeCompare(String(b.start_date)));
      if (upcoming[0]) {
        next_visit = {
          kind: 'project_start',
          project_id: upcoming[0].id,
          project_name: upcoming[0].name,
          address: upcoming[0].address,
          start_date: upcoming[0].start_date,
          scheduled_at: upcoming[0].start_date,
        };
      }
    }

    let activity = [];
    try {
      activity = await buildBuilderActivityFeed(pool, bid, 10, sinceActivity);
    } catch (actErr) {
      console.warn('getBuilderDashboard activity:', actErr.message);
    }

    if (await columnExists(pool, 'builders', 'portal_last_seen_at')) {
      await pool.execute('UPDATE builders SET portal_last_seen_at = NOW() WHERE id = ?', [bid]);
    }

    res.json({
      success: true,
      data: {
        is_first_visit,
        since_last_seen: sinceActivity,
        metrics: {
          active_projects: active.length,
          total_projects: projects.length,
          completed_projects: completed.length,
          completed_this_year: completedThisYear,
          total_sqft_completed: totalSqft,
          total_value_completed: totalValue,
        },
        next_visit,
        pending_documents,
        account_manager,
        activity,
      },
    });
  } catch (e) {
    console.error('getBuilderDashboard:', e);
    res.status(500).json({ success: false, error: e.message });
  }
}

export async function postBuilderDismissWelcome(req, res) {
  try {
    const pool = await getDBConnection();
    if (!pool) return res.status(503).json({ success: false, error: 'Database not available' });
    const bid = req.builderAuth.builderId;
    if (await columnExists(pool, 'builders', 'portal_welcome_dismissed_at')) {
      await pool.execute('UPDATE builders SET portal_welcome_dismissed_at = NOW() WHERE id = ?', [bid]);
    }
    res.json({ success: true });
  } catch (e) {
    console.error('postBuilderDismissWelcome:', e);
    res.status(500).json({ success: false, error: e.message });
  }
}

export function registerBuilderPortalProjectRoutes(app) {
  app.get('/api/builder-dashboard', requireBuilderAuth, getBuilderDashboard);
  app.post('/api/builder-dashboard/dismiss-welcome', requireBuilderAuth, postBuilderDismissWelcome);
  app.get('/api/builder-projects', requireBuilderAuth, listBuilderPortalProjects);
  app.get('/api/builder-projects/:id', requireBuilderAuth, getBuilderPortalProject);
  app.post(
    '/api/builder-projects/:id/photos',
    requireBuilderAuth,
    (req, res, next) => {
      uploadProjectPhoto.single('file')(req, res, (err) => {
        if (err) return res.status(400).json({ success: false, error: err.message });
        next();
      });
    },
    postBuilderProjectPhotos
  );
  app.put(
    '/api/builder-projects/:id/checklist/:itemId',
    requireBuilderAuth,
    putBuilderProjectChecklist
  );
}
