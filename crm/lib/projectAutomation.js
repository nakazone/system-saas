/**
 * Automações do módulo Projetos: números, checklist, custos, P&L, payroll, portfólio, logs.
 */
import { createOrSyncProjectFromAcceptedEstimate } from '../modules/projects/fromEstimate.js';
import { nextProjectNumber } from '../modules/projects/projectHelpers.js';
import { CHECKLIST_TEMPLATE, insertChecklistTemplate } from '../database/seed-project-checklist-templates.js';

export const generateProjectNumber = nextProjectNumber;

export async function seedProjectChecklist(pool, projectId) {
  const pid = parseInt(String(projectId), 10);
  if (!Number.isFinite(pid) || pid <= 0) return;
  const [[{ c }]] = await pool.query(
    'SELECT COUNT(*) AS c FROM project_checklist WHERE project_id = ?',
    [pid]
  );
  if (Number(c) > 0) return;
  await insertChecklistTemplate(pool, pid);
}

async function sumProjectMaterialsStock(pool, projectId) {
  const [[tbl]] = await pool.query(
    `SELECT COUNT(*) AS c FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'project_materials'`
  );
  if (!Number(tbl?.c)) return { actual: 0, projected: 0 };
  const [[hasCol]] = await pool.query(
    `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'project_materials' AND COLUMN_NAME = 'is_projected'`
  );
  if (!Number(hasCol?.c)) {
    const [[r]] = await pool.query(
      'SELECT COALESCE(SUM(total_cost),0) AS s FROM project_materials WHERE project_id = ?',
      [projectId]
    );
    const s = Number(r?.s) || 0;
    return { actual: s, projected: 0 };
  }
  const [[r]] = await pool.query(
    `SELECT
      COALESCE(SUM(CASE WHEN IFNULL(is_projected,0)=0 THEN total_cost ELSE 0 END), 0) AS a,
      COALESCE(SUM(CASE WHEN IFNULL(is_projected,0)=1 THEN total_cost ELSE 0 END), 0) AS p
     FROM project_materials WHERE project_id = ?`,
    [projectId]
  );
  return { actual: Number(r?.a) || 0, projected: Number(r?.p) || 0 };
}

/** Atualiza colunas de custo real e projetado em `projects` a partir de `project_costs` e `project_materials`. */
export async function recalculateProjectCosts(pool, projectId) {
  const id = parseInt(String(projectId), 10);
  if (!Number.isFinite(id) || id <= 0) return;
  const stock = await sumProjectMaterialsStock(pool, id);
  const [[hasProj]] = await pool.query(
    `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'project_costs' AND COLUMN_NAME = 'is_projected'`
  );
  if (!Number(hasProj?.c)) {
    const [projColRows] = await pool.query(
      `SELECT COLUMN_NAME AS n FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'projects'`
    );
    const set = new Set((projColRows || []).map((x) => x.n));
    const matStockActual = set.has('material_cost_projected') ? stock.actual : stock.actual + stock.projected;
    const parts = [
      `labor_cost_actual = COALESCE((SELECT SUM(c.total_cost) FROM project_costs c WHERE c.project_id = p.id AND c.cost_type = 'labor'), 0)`,
      `material_cost_actual = COALESCE((SELECT SUM(c.total_cost) FROM project_costs c WHERE c.project_id = p.id AND c.cost_type = 'material'), 0) + ?`,
      `additional_cost_actual = COALESCE((SELECT SUM(c.total_cost) FROM project_costs c WHERE c.project_id = p.id AND c.cost_type = 'additional'), 0)`,
    ];
    const vals = [matStockActual];
    if (set.has('material_cost_projected')) {
      parts.push('material_cost_projected = ?');
      vals.push(stock.projected);
    }
    vals.push(id);
    await pool.execute(`UPDATE projects p SET ${parts.join(', ')} WHERE p.id = ?`, vals);
    return;
  }
  const [rows] = await pool.query(
    `SELECT
      COALESCE(SUM(CASE WHEN cost_type='labor'      AND IFNULL(is_projected,0)=0 THEN total_cost ELSE 0 END), 0) AS labor_actual,
      COALESCE(SUM(CASE WHEN cost_type='material'   AND IFNULL(is_projected,0)=0 THEN total_cost ELSE 0 END), 0) AS material_actual,
      COALESCE(SUM(CASE WHEN cost_type='additional' AND IFNULL(is_projected,0)=0 THEN total_cost ELSE 0 END), 0) AS additional_actual,
      COALESCE(SUM(CASE WHEN cost_type='labor'      AND IFNULL(is_projected,0)=1 THEN total_cost ELSE 0 END), 0) AS labor_projected,
      COALESCE(SUM(CASE WHEN cost_type='material'   AND IFNULL(is_projected,0)=1 THEN total_cost ELSE 0 END), 0) AS material_projected,
      COALESCE(SUM(CASE WHEN cost_type='additional' AND IFNULL(is_projected,0)=1 THEN total_cost ELSE 0 END), 0) AS additional_projected
    FROM project_costs WHERE project_id = ?`,
    [id]
  );
  const r = rows[0];
  r.material_actual = (Number(r.material_actual) || 0) + stock.actual;
  r.material_projected = (Number(r.material_projected) || 0) + stock.projected;
  const [projColRows] = await pool.query(
    `SELECT COLUMN_NAME AS n FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'projects'`
  );
  const set = new Set((projColRows || []).map((x) => x.n));
  const parts = [];
  const vals = [];
  if (set.has('labor_cost_actual')) {
    parts.push('labor_cost_actual = ?');
    vals.push(r.labor_actual);
  }
  if (set.has('material_cost_actual')) {
    parts.push('material_cost_actual = ?');
    vals.push(r.material_actual);
  }
  if (set.has('additional_cost_actual')) {
    parts.push('additional_cost_actual = ?');
    vals.push(r.additional_actual);
  }
  if (set.has('labor_cost_projected')) {
    parts.push('labor_cost_projected = ?');
    vals.push(r.labor_projected);
  }
  if (set.has('material_cost_projected')) {
    parts.push('material_cost_projected = ?');
    vals.push(r.material_projected);
  }
  if (set.has('additional_cost_projected')) {
    parts.push('additional_cost_projected = ?');
    vals.push(r.additional_projected);
  }
  if (!parts.length) return;
  vals.push(id);
  await pool.execute(`UPDATE projects SET ${parts.join(', ')} WHERE id = ?`, vals);
}

/**
 * Mesmo formato que calculateProfitability, mas com custos reais/projetados já agregados
 * (ex.: somas live de `project_costs`). Usado na Visão geral para não depender só das
 * colunas `labor_cost_actual` em `projects` quando o recalculate ainda não correu.
 */
export function profitabilityFromRollup(
  project,
  contractValue,
  laborA,
  materialA,
  additionalA,
  laborP,
  materialP,
  additionalP
) {
  const contract = parseFloat(String(contractValue)) || 0;
  const supply = parseFloat(project.supply_value) || 0;
  const install = parseFloat(project.installation_value) || 0;
  const sand = parseFloat(project.sand_finish_value) || 0;
  const totalActual = laborA + materialA + additionalA;
  const totalProjected = laborP + materialP + additionalP;
  const grossProfit = contract - totalActual;
  const margin = contract > 0 ? (grossProfit / contract) * 100 : 0;
  const projProfit = contract - totalProjected;
  const projMargin = contract > 0 ? (projProfit / contract) * 100 : 0;
  const costVariance = totalActual - totalProjected;
  const costVariancePct = totalProjected > 0 ? ((totalActual - totalProjected) / totalProjected) * 100 : 0;
  return {
    contract_value: contract,
    by_service: {
      supply: { revenue: supply, pct: contract > 0 ? (supply / contract) * 100 : 0 },
      installation: { revenue: install, pct: contract > 0 ? (install / contract) * 100 : 0 },
      sand_finish: { revenue: sand, pct: contract > 0 ? (sand / contract) * 100 : 0 },
    },
    projected: {
      labor: laborP,
      material: materialP,
      additional: additionalP,
      total: totalProjected,
      profit: projProfit,
      margin_pct: projMargin,
    },
    actual: {
      labor: laborA,
      material: materialA,
      additional: additionalA,
      total: totalActual,
      profit: grossProfit,
      margin_pct: margin,
    },
    variance: {
      cost_diff: costVariance,
      cost_diff_pct: costVariancePct,
      status:
        costVariance <= 0
          ? 'on_budget'
          : costVariance < totalProjected * 0.1
            ? 'slightly_over'
            : 'over_budget',
    },
    days_estimated: project.days_estimated || 0,
    days_actual: project.days_actual || 0,
    days_variance: (project.days_actual || 0) - (project.days_estimated || 0),
  };
}

export function calculateProfitability(project) {
  const contract = parseFloat(project.contract_value) || 0;
  const supply = parseFloat(project.supply_value) || 0;
  const install = parseFloat(project.installation_value) || 0;
  const sand = parseFloat(project.sand_finish_value) || 0;
  const laborA = parseFloat(project.labor_cost_actual) || 0;
  const materialA = parseFloat(project.material_cost_actual) || 0;
  const additionalA = parseFloat(project.additional_cost_actual) || 0;
  const totalActual = laborA + materialA + additionalA;
  const laborP = parseFloat(project.labor_cost_projected) || 0;
  const materialP = parseFloat(project.material_cost_projected) || 0;
  const additionalP = parseFloat(project.additional_cost_projected) || 0;
  const totalProjected = laborP + materialP + additionalP;
  const grossProfit = contract - totalActual;
  const margin = contract > 0 ? (grossProfit / contract) * 100 : 0;
  const projProfit = contract - totalProjected;
  const projMargin = contract > 0 ? (projProfit / contract) * 100 : 0;
  const costVariance = totalActual - totalProjected;
  const costVariancePct = totalProjected > 0 ? ((totalActual - totalProjected) / totalProjected) * 100 : 0;
  return {
    contract_value: contract,
    by_service: {
      supply: { revenue: supply, pct: contract > 0 ? (supply / contract) * 100 : 0 },
      installation: { revenue: install, pct: contract > 0 ? (install / contract) * 100 : 0 },
      sand_finish: { revenue: sand, pct: contract > 0 ? (sand / contract) * 100 : 0 },
    },
    projected: {
      labor: laborP,
      material: materialP,
      additional: additionalP,
      total: totalProjected,
      profit: projProfit,
      margin_pct: projMargin,
    },
    actual: {
      labor: laborA,
      material: materialA,
      additional: additionalA,
      total: totalActual,
      profit: grossProfit,
      margin_pct: margin,
    },
    variance: {
      cost_diff: costVariance,
      cost_diff_pct: costVariancePct,
      status:
        costVariance <= 0
          ? 'on_budget'
          : costVariance < totalProjected * 0.1
            ? 'slightly_over'
            : 'over_budget',
    },
    days_estimated: project.days_estimated || 0,
    days_actual: project.days_actual || 0,
    days_variance: (project.days_actual || 0) - (project.days_estimated || 0),
  };
}

export async function logAutomation(pool, row) {
  try {
    const [tbl] = await pool.query('SHOW TABLES LIKE ?', ['project_automation_logs']);
    if (!Array.isArray(tbl) || tbl.length === 0) return;
    await pool.execute(
      `INSERT INTO project_automation_logs (project_id, trigger_type, trigger_id, status, details, error_message)
       VALUES (?,?,?,?,?,?)`,
      [
        row.project_id ?? null,
        String(row.trigger_type || 'unknown'),
        row.trigger_id != null ? parseInt(String(row.trigger_id), 10) : null,
        row.status || 'pending',
        row.details != null ? JSON.stringify(row.details) : null,
        row.error_message != null ? String(row.error_message).slice(0, 2000) : null,
      ]
    );
  } catch (e) {
    console.warn('[project_automation_logs]', e.message);
  }
}

export async function autoCreateProjectFromEstimate(pool, estimateId, userId) {
  const eid = parseInt(String(estimateId), 10);
  const uid = userId != null ? parseInt(String(userId), 10) : null;
  try {
    const r = await createOrSyncProjectFromAcceptedEstimate(pool, eid, Number.isFinite(uid) ? uid : null);
    if (r.ok && r.data) {
      await logAutomation(pool, {
        project_id: r.data.id,
        trigger_type: 'estimate_accepted',
        trigger_id: eid,
        status: 'success',
        details: { project_number: r.data.project_number, lead_id: r.data.lead_id },
      });
      return { ok: true, project_id: r.data.id, project_number: r.data.project_number, data: r.data };
    }
    await logAutomation(pool, {
      project_id: null,
      trigger_type: 'estimate_accepted',
      trigger_id: eid,
      status: 'error',
      error_message: r.error || 'unknown',
    });
    return { ok: false, error: r.error };
  } catch (e) {
    await logAutomation(pool, {
      project_id: null,
      trigger_type: 'estimate_accepted',
      trigger_id: eid,
      status: 'error',
      error_message: e.message,
    });
    return { ok: false, error: e.message };
  }
}

export async function syncPayrollToProjectCosts(pool, projectId) {
  const id = parseInt(String(projectId), 10);
  if (!Number.isFinite(id) || id <= 0) throw new Error('Invalid project id');
  const [[tbl]] = await pool.query('SHOW TABLES LIKE ?', ['payroll_entries']);
  if (!tbl || !tbl.length) return { synced: 0 };
  const [[hasPeCol]] = await pool.query(
    `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'project_costs' AND COLUMN_NAME = 'payroll_entry_id'`
  );
  const usePayrollFk = Number(hasPeCol?.c) > 0;
  let entries;
  if (usePayrollFk) {
    const [e] = await pool.query(
      `SELECT pe.*, u.name AS employee_name
       FROM payroll_entries pe
       LEFT JOIN users u ON pe.employee_id = u.id
       WHERE pe.project_id = ?
         AND IFNULL(pe.approved,0) = 1
         AND pe.id NOT IN (
           SELECT payroll_entry_id FROM project_costs
           WHERE project_id = ? AND payroll_entry_id IS NOT NULL
         )`,
      [id, id]
    );
    entries = e;
  } else {
    const [e] = await pool.query(
      `SELECT pe.*, u.name AS employee_name
       FROM payroll_entries pe
       LEFT JOIN users u ON pe.employee_id = u.id
       WHERE pe.project_id = ? AND IFNULL(pe.approved,0) = 1`,
      [id]
    );
    entries = e;
  }
  if (!entries.length) return { synced: 0 };
  const uid = null;
  for (const entry of entries) {
    const totalCost = parseFloat(entry.total_cost) || 0;
    const desc = `${entry.employee_name || 'Funcionário'} — ${entry.hours_worked}h @ $${entry.hourly_rate}/h`;
    if (usePayrollFk) {
      await pool.execute(
        `INSERT INTO project_costs
          (project_id, cost_type, service_category, description, quantity, unit, unit_cost, total_cost, is_projected, payroll_entry_id, created_by)
         VALUES (?,?,?,?,?,?,?,?,0,?,?)`,
        [
          id,
          'labor',
          'general',
          desc.slice(0, 255),
          parseFloat(entry.hours_worked) || 0,
          'hours',
          parseFloat(entry.hourly_rate) || 0,
          totalCost,
          entry.id,
          uid,
        ]
      );
    } else {
      await pool.execute(
        `INSERT INTO project_costs
          (project_id, cost_type, service_category, description, quantity, unit, unit_cost, total_cost, created_by)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        [
          id,
          'labor',
          'general',
          desc.slice(0, 255),
          parseFloat(entry.hours_worked) || 0,
          'hours',
          parseFloat(entry.hourly_rate) || 0,
          totalCost,
          uid,
        ]
      );
    }
  }
  await recalculateProjectCosts(pool, id);
  return { synced: entries.length };
}

export async function publishToPortfolio(pool, projectId, photoIds, portfolioData) {
  const id = parseInt(String(projectId), 10);
  const ids = (photoIds || []).map((x) => parseInt(String(x), 10)).filter((n) => Number.isFinite(n) && n > 0);
  if (!ids.length) throw new Error('Nenhuma foto encontrada');
  const { title, description } = portfolioData || {};
  const placeholders = ids.map(() => '?').join(',');
  const [photos] = await pool.query(
    `SELECT * FROM project_photos WHERE id IN (${placeholders}) AND project_id = ?`,
    [...ids, id]
  );
  if (!photos.length) throw new Error('Nenhuma foto encontrada');
  const [[hasPort]] = await pool.query(
    `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'project_photos' AND COLUMN_NAME = 'is_portfolio'`
  );
  if (Number(hasPort?.c)) {
    await pool.query(`UPDATE project_photos SET is_portfolio = 1 WHERE id IN (${placeholders}) AND project_id = ?`, [
      ...ids,
      id,
    ]);
  }
  const siteWebhookUrl = process.env.PORTFOLIO_WEBHOOK_URL?.trim();
  let externalId = null;
  const publicBase = (process.env.PUBLIC_CRM_URL || '').replace(/\/$/, '');
  if (siteWebhookUrl) {
    try {
      const [[proj]] = await pool.query(
        `SELECT flooring_type, total_sqft, address FROM projects WHERE id = ?`,
        [id]
      );
      const payload = {
        project_id: id,
        title: title || `Project #${id}`,
        description: description || '',
        photos: photos.map((p) => {
          const fu = p.file_url != null ? String(p.file_url).trim() : '';
          let url;
          if (/^https?:\/\//i.test(fu)) url = fu;
          else if (fu.startsWith('/')) {
            url = publicBase ? `${publicBase.replace(/\/$/, '')}${fu}` : fu;
          } else {
            const fp = String(p.file_path || '').replace(/^\//, '');
            const rel = fu ? (fu.startsWith('uploads/') ? `/${fu}` : `/uploads/${fu}`) : `/uploads/${fp}`;
            url = publicBase ? `${publicBase.replace(/\/$/, '')}${rel}` : rel;
          }
          return {
            url,
            phase: p.phase,
            caption: p.caption,
            is_cover: !!p.is_cover,
          };
        }),
        flooring_type: proj?.flooring_type ?? null,
        sqft: proj?.total_sqft ?? null,
      };
      const res = await fetch(siteWebhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(process.env.PORTFOLIO_API_KEY ? { 'X-API-Key': process.env.PORTFOLIO_API_KEY } : {}),
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(8000),
      });
      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        externalId = data.id || data.post_id || null;
      }
    } catch (e) {
      console.error('[PORTFOLIO]', e.message);
    }
  }
  const coverId = photos.find((p) => p.is_cover)?.id || photos[0]?.id;
  const [[setPort]] = await pool.query(
    `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'projects' AND COLUMN_NAME = 'portfolio_published'`
  );
  if (Number(setPort?.c)) {
    await pool.execute(
      `UPDATE projects SET
        portfolio_published = 1,
        portfolio_published_at = NOW(),
        portfolio_title = ?,
        portfolio_description = ?,
        portfolio_external_id = ?,
        portfolio_cover_photo_id = COALESCE(?, portfolio_cover_photo_id)
       WHERE id = ?`,
      [title || null, description || null, externalId, coverId || null, id]
    );
  }
  await logAutomation(pool, {
    project_id: id,
    trigger_type: 'portfolio_sync',
    trigger_id: null,
    status: externalId ? 'success' : 'pending',
    details: {
      photos_count: photos.length,
      external_id: externalId,
      webhook_configured: !!siteWebhookUrl,
    },
  });
  return {
    published: true,
    external_id: externalId,
    photos_synced: photos.length,
    webhook_sent: !!siteWebhookUrl,
    manual_required: !siteWebhookUrl,
  };
}

export { CHECKLIST_TEMPLATE, insertChecklistTemplate };
