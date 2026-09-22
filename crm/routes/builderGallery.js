/**
 * Inspiration gallery for builder portal.
 */
import path from 'path';
import { getDBConnection } from '../config/db.js';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { requireBuilderAuth } from '../middleware/builderAuth.js';
import { uploadGalleryPhoto } from '../lib/galleryPhotoUpload.js';

function parseMaterials(val) {
  if (val == null) return [];
  if (Array.isArray(val)) return val;
  try {
    return JSON.parse(val);
  } catch {
    return [];
  }
}

function galleryPhotoUrl(row) {
  const u = String(row.url || '').trim();
  if (u.startsWith('http') || u.startsWith('/')) return u;
  return `/uploads/${u.replace(/^\//, '')}`;
}

export async function listGallery(req, res) {
  try {
    const pool = await getDBConnection();
    const isBuilder = !!req.builderAuth;
    const status = req.query.status;
    const floorType = req.query.floor_type;
    const region = req.query.region;
    const phase = req.query.phase;
    const q = req.query.q ? String(req.query.q).trim() : '';

    let where = '1=1';
    const params = [];
    if (isBuilder) {
      where += " AND g.status IN ('published', 'featured')";
    } else if (status) {
      where += ' AND g.status = ?';
      params.push(status);
    }
    if (floorType) {
      where += ' AND g.floor_type = ?';
      params.push(floorType);
    }
    if (region) {
      where += ' AND g.region = ?';
      params.push(region);
    }
    if (q) {
      where += ' AND (g.title LIKE ? OR g.description LIKE ? OR g.floor_type LIKE ? OR g.region LIKE ?)';
      const like = `%${q}%`;
      params.push(like, like, like, like);
    }
    if (phase && ['before', 'during', 'after'].includes(String(phase))) {
      where += ' AND EXISTS (SELECT 1 FROM gallery_photos gp2 WHERE gp2.gallery_project_id = g.id AND gp2.phase = ?)';
      params.push(phase);
    }

    const [rows] = await pool.query(
      `SELECT g.*,
        (SELECT url FROM gallery_photos gp WHERE gp.gallery_project_id = g.id AND gp.phase = 'after' ORDER BY gp.sort_order ASC, gp.id ASC LIMIT 1) AS cover_after,
        (SELECT url FROM gallery_photos gp WHERE gp.gallery_project_id = g.id AND gp.phase = 'before' ORDER BY gp.sort_order ASC, gp.id ASC LIMIT 1) AS cover_before,
        (SELECT url FROM gallery_photos gp WHERE gp.gallery_project_id = g.id AND gp.phase = 'during' ORDER BY gp.sort_order ASC, gp.id ASC LIMIT 1) AS cover_during,
        (SELECT url FROM gallery_photos gp WHERE gp.gallery_project_id = g.id ORDER BY gp.sort_order ASC, gp.id ASC LIMIT 1) AS cover_url,
        EXISTS (SELECT 1 FROM gallery_photos gp WHERE gp.gallery_project_id = g.id AND gp.phase = 'before') AS has_before,
        EXISTS (SELECT 1 FROM gallery_photos gp WHERE gp.gallery_project_id = g.id AND gp.phase = 'during') AS has_during,
        EXISTS (SELECT 1 FROM gallery_photos gp WHERE gp.gallery_project_id = g.id AND gp.phase = 'after') AS has_after
       FROM gallery_projects g
       WHERE ${where}
       ORDER BY g.status = 'featured' DESC, g.year DESC, g.id DESC`,
      params
    );

    res.json({
      success: true,
      data: rows.map((r) => ({
        ...r,
        materials: parseMaterials(r.materials),
        cover_url: r.cover_url ? galleryPhotoUrl({ url: r.cover_url }) : null,
        cover_before: r.cover_before ? galleryPhotoUrl({ url: r.cover_before }) : null,
        cover_during: r.cover_during ? galleryPhotoUrl({ url: r.cover_during }) : null,
        cover_after: r.cover_after ? galleryPhotoUrl({ url: r.cover_after }) : null,
        has_before: !!r.has_before,
        has_during: !!r.has_during,
        has_after: !!r.has_after,
      })),
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
}

export async function getGalleryProject(req, res) {
  try {
    const pool = await getDBConnection();
    const id = parseInt(req.params.id, 10);
    const [rows] = await pool.query('SELECT * FROM gallery_projects WHERE id = ?', [id]);
    if (!rows.length) return res.status(404).json({ success: false, error: 'Not found' });
    const g = rows[0];
    if (req.builderAuth && !['published', 'featured'].includes(g.status)) {
      return res.status(404).json({ success: false, error: 'Not found' });
    }
    const [photos] = await pool.query(
      'SELECT * FROM gallery_photos WHERE gallery_project_id = ? ORDER BY sort_order ASC, id ASC',
      [id]
    );
    res.json({
      success: true,
      data: {
        project: { ...g, materials: parseMaterials(g.materials) },
        photos: photos.map((p) => ({ ...p, url: galleryPhotoUrl(p) })),
      },
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
}

export async function createGalleryProject(req, res) {
  try {
    const pool = await getDBConnection();
    const b = req.body || {};
    const materials = b.materials ? JSON.stringify(b.materials) : null;
    const [ins] = await pool.execute(
      `INSERT INTO gallery_projects (title, description, floor_type, area_sqft, region, year, materials, status, project_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        b.title || 'Untitled',
        b.description || null,
        b.floor_type || null,
        b.area_sqft != null ? Number(b.area_sqft) : null,
        b.region || null,
        b.year != null ? Number(b.year) : new Date().getFullYear(),
        materials,
        b.status || 'draft',
        b.project_id || null,
      ]
    );
    const [rows] = await pool.query('SELECT * FROM gallery_projects WHERE id = ?', [ins.insertId]);
    res.status(201).json({ success: true, data: rows[0] });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
}

export async function updateGalleryProject(req, res) {
  try {
    const pool = await getDBConnection();
    const id = parseInt(req.params.id, 10);
    const b = req.body || {};
    const materials = b.materials !== undefined ? JSON.stringify(b.materials) : undefined;
    await pool.execute(
      `UPDATE gallery_projects SET
        title = COALESCE(?, title),
        description = COALESCE(?, description),
        floor_type = COALESCE(?, floor_type),
        area_sqft = COALESCE(?, area_sqft),
        region = COALESCE(?, region),
        year = COALESCE(?, year),
        materials = COALESCE(?, materials),
        status = COALESCE(?, status)
       WHERE id = ?`,
      [
        b.title,
        b.description,
        b.floor_type,
        b.area_sqft,
        b.region,
        b.year,
        materials,
        b.status,
        id,
      ]
    );
    const [rows] = await pool.query('SELECT * FROM gallery_projects WHERE id = ?', [id]);
    res.json({ success: true, data: rows[0] });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
}

export async function deleteGalleryProject(req, res) {
  try {
    const pool = await getDBConnection();
    const id = parseInt(req.params.id, 10);
    await pool.execute('DELETE FROM gallery_photos WHERE gallery_project_id = ?', [id]);
    await pool.execute('DELETE FROM gallery_projects WHERE id = ?', [id]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
}

export async function uploadGalleryPhotoRoute(req, res) {
  try {
    const pool = await getDBConnection();
    const id = parseInt(req.params.id, 10);
    if (!req.file) return res.status(400).json({ success: false, error: 'file required' });
    const rel = path.join('gallery', String(id), req.file.filename).replace(/\\/g, '/');
    const url = `/uploads/${rel}`;
    const phase = ['before', 'during', 'after'].includes(req.body?.phase) ? req.body.phase : 'after';
    const [ins] = await pool.execute(
      `INSERT INTO gallery_photos (gallery_project_id, url, caption, phase, sort_order, uploaded_by)
       VALUES (?, ?, ?, ?, ?, 'admin')`,
      [id, rel, req.body?.caption || null, phase, parseInt(req.body?.sort_order, 10) || 0]
    );
    const [rows] = await pool.query('SELECT * FROM gallery_photos WHERE id = ?', [ins.insertId]);
    res.status(201).json({ success: true, data: { ...rows[0], url: galleryPhotoUrl(rows[0]) } });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
}

export function registerBuilderGalleryRoutes(app) {
  app.get('/api/gallery/partner', requireBuilderAuth, listGallery);
  app.get('/api/gallery/partner/:id', requireBuilderAuth, getGalleryProject);

  app.get('/api/gallery', requireAuth, requirePermission('builders.view'), listGallery);
  app.get('/api/gallery/:id', requireAuth, requirePermission('builders.view'), getGalleryProject);
  app.post('/api/gallery', requireAuth, requirePermission('builders.edit'), createGalleryProject);
  app.put('/api/gallery/:id', requireAuth, requirePermission('builders.edit'), updateGalleryProject);
  app.delete('/api/gallery/:id', requireAuth, requirePermission('builders.edit'), deleteGalleryProject);
  app.post(
    '/api/gallery/:id/photos',
    requireAuth,
    requirePermission('builders.edit'),
    (req, res, next) => {
      uploadGalleryPhoto.single('file')(req, res, (err) => {
        if (err) return res.status(400).json({ success: false, error: err.message });
        next();
      });
    },
    uploadGalleryPhotoRoute
  );
}
