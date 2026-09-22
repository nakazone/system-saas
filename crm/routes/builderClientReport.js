/**
 * Builder portal — per-project client handoff PDF.
 */
import { getDBConnection } from '../config/db.js';
import { requireBuilderAuth } from '../middleware/builderAuth.js';
import {
  assertBuilderOwnsProject,
  normalizeProjectRow,
  photoPublicUrl,
} from '../lib/builderProjectAccess.js';
import { enrichBuilderMaterials, columnExists } from '../lib/builderMaterialPortal.js';
import { buildBuilderClientReportPdfBuffer } from '../modules/builder/builderClientReportPdf.js';

const COMPLETED_STATUSES = new Set(['completed', 'closed']);

export async function getBuilderClientReportPdf(req, res) {
  try {
    const pool = await getDBConnection();
    if (!pool) return res.status(503).json({ success: false, error: 'Database not available' });
    const projectId = parseInt(req.params.id, 10);
    const bid = req.builderAuth.builderId;
    const project = normalizeProjectRow(
      await assertBuilderOwnsProject(pool, bid, projectId)
    );
    if (!project) return res.status(404).json({ success: false, error: 'Project not found' });

    const status = String(project.status || '').toLowerCase();
    if (!COMPLETED_STATUSES.has(status)) {
      return res.status(400).json({
        success: false,
        error: 'Client report is available only for completed projects.',
      });
    }

    const hasMatVisible = await columnExists(pool, 'project_materials', 'visible_to_builder');
    const matWhere = hasMatVisible
      ? 'project_id = ? AND visible_to_builder = 1'
      : 'project_id = ?';
    const [matRows] = await pool.query(
      `SELECT * FROM project_materials WHERE ${matWhere} ORDER BY id`,
      [projectId]
    );
    const materials = await enrichBuilderMaterials(pool, matRows);

    const [photoRows] = await pool.query(
      `SELECT id, phase, file_path, file_url, caption FROM project_photos
       WHERE project_id = ? AND (partner_upload IS NULL OR partner_upload = 0)
       ORDER BY phase, created_at`,
      [projectId]
    );
    const photos = photoRows.map((ph) => ({
      phase: ph.phase,
      caption: ph.caption,
      url: photoPublicUrl(ph),
    }));

    const [builders] = await pool.query(
      'SELECT company, first_name, last_name, company_logo_url FROM builders WHERE id = ?',
      [bid]
    );
    const b = builders[0] || {};
    const builderName =
      b.company || [b.first_name, b.last_name].filter(Boolean).join(' ') || 'Partner';
    const hasLogoCol = await columnExists(pool, 'builders', 'company_logo_url');
    const builderLogoUrl = hasLogoCol && b.company_logo_url ? String(b.company_logo_url).trim() : '';

    const pdfBuf = await buildBuilderClientReportPdfBuffer({
      project: {
        id: project.id,
        name: project.name,
        address: project.address,
        project_number: project.project_number,
        flooring_type: project.flooring_type,
        total_sqft: project.total_sqft,
        service_type: project.service_type,
        end_date_actual: project.end_date_actual,
        end_date_estimated: project.end_date_estimated,
      },
      materials,
      photos,
      builderName,
      builderLogoUrl,
    });

    const slug = (project.project_number || project.name || `project-${projectId}`)
      .replace(/[^a-zA-Z0-9-_]+/g, '-')
      .slice(0, 40);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="client-report-${slug}.pdf"`);
    res.send(pdfBuf);
  } catch (e) {
    console.error('getBuilderClientReportPdf:', e);
    res.status(500).json({ success: false, error: e.message });
  }
}

export function registerBuilderClientReportRoutes(app) {
  app.get(
    '/api/builder-projects/:id/client-report.pdf',
    requireBuilderAuth,
    getBuilderClientReportPdf
  );
}
