/**
 * Builder portal ù post-project evaluations (NPS-style).
 */
import { getDBConnection } from '../config/db.js';
import { requireBuilderAuth } from '../middleware/builderAuth.js';
import { assertBuilderOwnsProject, normalizeProjectRow } from '../lib/builderProjectAccess.js';
import { sendBuilderNotification, adminNotifyEmail } from '../lib/builderNotify.js';

const COMPLETED_STATUSES = new Set(['completed', 'closed']);

export function googleReviewUrl() {
  return (
    process.env.BUILDER_GOOGLE_REVIEW_URL?.trim() ||
    process.env.GOOGLE_REVIEW_URL?.trim() ||
    'https://g.page/r/seniorfloors/review'
  );
}

export async function getBuilderProjectEvaluation(req, res) {
  try {
    const pool = await getDBConnection();
    if (!pool) return res.status(503).json({ success: false, error: 'Database not available' });
    const projectId = parseInt(req.params.id, 10);
    const bid = req.builderAuth.builderId;
    const project = await assertBuilderOwnsProject(pool, bid, projectId);
    if (!project) return res.status(404).json({ success: false, error: 'Project not found' });

    const status = String(project.status || '').toLowerCase();
    const [rows] = await pool.query(
      'SELECT id, rating, comment, created_at FROM builder_project_evaluations WHERE builder_id = ? AND project_id = ?',
      [bid, projectId]
    );

    res.json({
      success: true,
      data: {
        eligible: COMPLETED_STATUSES.has(status),
        submitted: !!rows.length,
        evaluation: rows[0] || null,
        google_review_url: googleReviewUrl(),
      },
    });
  } catch (e) {
    console.error('getBuilderProjectEvaluation:', e);
    res.status(500).json({ success: false, error: e.message });
  }
}

export async function postBuilderProjectEvaluation(req, res) {
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
        error: 'Evaluation is only available for completed projects.',
      });
    }

    const rating = parseInt(req.body?.rating, 10);
    if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
      return res.status(400).json({ success: false, error: 'Rating must be 1ù5' });
    }
    const comment =
      req.body?.comment != null ? String(req.body.comment).slice(0, 2000).trim() : '';

    const [existing] = await pool.query(
      'SELECT id FROM builder_project_evaluations WHERE builder_id = ? AND project_id = ?',
      [bid, projectId]
    );
    if (existing.length) {
      return res.status(409).json({ success: false, error: 'You already submitted feedback for this project.' });
    }

    await pool.execute(
      `INSERT INTO builder_project_evaluations (builder_id, project_id, rating, comment) VALUES (?, ?, ?, ?)`,
      [bid, projectId, rating, comment || null]
    );

    const [builders] = await pool.query(
      'SELECT email, first_name, last_name, company FROM builders WHERE id = ?',
      [bid]
    );
    const b = builders[0] || {};
    const partnerLabel =
      b.company || [b.first_name, b.last_name].filter(Boolean).join(' ') || `Builder #${bid}`;
    const projLabel = project.name || project.project_number || `Project #${projectId}`;
    const reviewUrl = googleReviewUrl();

    const adminTo = adminNotifyEmail();
    if (adminTo) {
      const stars = '?'.repeat(rating) + '?'.repeat(5 - rating);
      await sendBuilderNotification({
        to: adminTo,
        subject: `Builder feedback (${rating}/5) ù ${projLabel}`,
        html: `<p><strong>${partnerLabel}</strong> rated Senior Floors <strong>${rating}/5</strong> (${stars}) on <strong>${projLabel}</strong>.</p>
${comment ? `<p><em>${comment.replace(/</g, '&lt;')}</em></p>` : ''}`,
      }).catch(() => {});
    }

    if (b.email) {
      const pub = process.env.PUBLIC_CRM_URL || 'https://app.senior-floors.com';
      await sendBuilderNotification({
        to: b.email,
        subject: 'Thank you ù share your experience on Google',
        html: `<p>Hi ${b.first_name || 'there'},</p>
<p>Thank you for your feedback on <strong>${projLabel}</strong>. We appreciate partnering with you.</p>
<p>If you had a great experience with Senior Floors, we would be grateful for a quick review on Google:</p>
<p><a href="${reviewUrl}">Leave a Google review</a></p>
<p><a href="${pub}/builder-portal.html">Return to your portal</a></p>`,
      }).catch(() => {});
    }

    res.json({
      success: true,
      data: { rating, comment, google_review_url: reviewUrl },
    });
  } catch (e) {
    console.error('postBuilderProjectEvaluation:', e);
    res.status(500).json({ success: false, error: e.message });
  }
}

export function registerBuilderEvaluationRoutes(app) {
  app.get(
    '/api/builder-projects/:id/evaluation',
    requireBuilderAuth,
    getBuilderProjectEvaluation
  );
  app.post(
    '/api/builder-projects/:id/evaluation',
    requireBuilderAuth,
    postBuilderProjectEvaluation
  );
}
