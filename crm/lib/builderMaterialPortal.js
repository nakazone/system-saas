/**
 * Builder portal ù material display enrichment and SF notifications.
 */
import { adminNotifyEmail, sendBuilderNotification } from './builderNotify.js';

export async function columnExists(pool, table, col) {
  const [r] = await pool.query(
    `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, col]
  );
  return Number(r[0]?.c) > 0;
}

/** Enrich material rows for builder UI (color, spec, image from row or ERP). */
export async function enrichBuilderMaterials(pool, rows) {
  if (!rows?.length) return [];
  const hasErp = await columnExists(pool, 'project_materials', 'erp_product_id');
  const hasColor = await columnExists(pool, 'project_materials', 'material_color');
  const hasSpec = await columnExists(pool, 'project_materials', 'material_spec');
  const hasImg = await columnExists(pool, 'project_materials', 'material_image_url');

  const erpIds = hasErp
    ? [...new Set(rows.map((r) => r.erp_product_id).filter((id) => id > 0))]
    : [];
  const erpMap = new Map();
  if (erpIds.length && (await columnExists(pool, 'products', 'id'))) {
    const [prods] = await pool.query(
      `SELECT id, name, description, category FROM products WHERE id IN (${erpIds.map(() => '?').join(',')})`,
      erpIds
    );
    prods.forEach((p) => erpMap.set(p.id, p));
  }

  return rows.map((m) => {
    const erp = hasErp && m.erp_product_id ? erpMap.get(m.erp_product_id) : null;
    const spec =
      (hasSpec && m.material_spec) ||
      (m.notes && String(m.notes).trim()) ||
      (erp?.description && String(erp.description).trim()) ||
      null;
    const color = hasColor && m.material_color ? m.material_color : null;
    let imageUrl = hasImg && m.material_image_url ? String(m.material_image_url).trim() : '';
    if (!imageUrl && erp?.category) {
      imageUrl = '';
    }
    if (imageUrl && !/^https?:\/\//i.test(imageUrl) && !imageUrl.startsWith('/')) {
      imageUrl = `/${imageUrl.replace(/^\//, '')}`;
    }
    return {
      ...m,
      material_color: color,
      material_spec: spec,
      material_image_url: imageUrl || null,
      erp_category: erp?.category || null,
    };
  });
}

/** Apply CRM-editable display fields after material insert/update. */
export async function applyPortalMaterialDisplayFields(pool, materialId, b) {
  if (!materialId || !b) return;
  const updates = [];
  const vals = [];
  if (b.material_color !== undefined && (await columnExists(pool, 'project_materials', 'material_color'))) {
    updates.push('material_color = ?');
    vals.push(b.material_color == null ? null : String(b.material_color).slice(0, 100));
  }
  if (b.material_spec !== undefined && (await columnExists(pool, 'project_materials', 'material_spec'))) {
    updates.push('material_spec = ?');
    vals.push(b.material_spec == null ? null : String(b.material_spec).slice(0, 2000));
  }
  if (
    b.material_image_url !== undefined &&
    (await columnExists(pool, 'project_materials', 'material_image_url'))
  ) {
    updates.push('material_image_url = ?');
    vals.push(b.material_image_url == null ? null : String(b.material_image_url).slice(0, 500));
  }
  if (!updates.length) return;
  vals.push(materialId);
  await pool.execute(`UPDATE project_materials SET ${updates.join(', ')} WHERE id = ?`, vals);
}

export async function notifySfMaterialAction(pool, {
  projectId,
  projectName,
  builderId,
  action,
  productName,
  comment,
  count,
}) {
  const adminTo = adminNotifyEmail();
  if (!adminTo) return;

  const pub = process.env.PUBLIC_CRM_URL || 'https://app.senior-floors.com';
  const projLabel = projectName || `Project #${projectId}`;
  const crmLink = `${pub}/project-detail.html?id=${projectId}`;

  let subject;
  let bodyHtml;
  if (action === 'approve_all') {
    subject = `Builder approved all materials ù ${projLabel}`;
    bodyHtml = `<p>Partner approved <strong>${count || 0}</strong> pending material(s) on <strong>${projLabel}</strong>.</p>`;
  } else if (action === 'change_requested') {
    subject = `Builder requested material change ù ${projLabel}`;
    bodyHtml = `<p>Partner requested a change for material <strong>${productName || 'item'}</strong> on <strong>${projLabel}</strong>.</p>`;
  } else {
    subject = `Builder ${action} material ù ${projLabel}`;
    bodyHtml = `<p>Material <strong>${productName || 'item'}</strong> was <strong>${action}</strong> by the partner on <strong>${projLabel}</strong>.</p>`;
  }
  if (comment) {
    bodyHtml += `<p><strong>Comment:</strong> ${String(comment).replace(/</g, '&lt;')}</p>`;
  }
  bodyHtml += `<p><a href="${crmLink}">Open project in CRM</a></p>`;

  await sendBuilderNotification({ to: adminTo, subject, html: bodyHtml }).catch(() => {});

  try {
    const [builders] = await pool.query(
      'SELECT company, first_name, last_name FROM builders WHERE id = ?',
      [builderId]
    );
    const b = builders[0];
    const partner =
      b?.company || [b?.first_name, b?.last_name].filter(Boolean).join(' ') || `Builder #${builderId}`;
    console.info(`[materials] ${action} by ${partner} on project ${projectId}`);
  } catch (_) {}
}
