/**
 * Quando um orçamento fica aprovado/aceite, garante um registo em `projects` e liga `quotes.project_id`.
 * Se já existir projeto para o mesmo lead (ex.: ganho pelo módulo de leads), reutiliza-o em vez de duplicar.
 */
import { ensureClientFromLead } from '../clients/leadToClient.js';
import { nextProjectNumber, getProjectsTableColumnSet } from '../projects/projectHelpers.js';
import { applyQuoteLineRevenueToProject } from '../../lib/syncProjectRevenueFromQuote.js';
import { setLeadPipelineBySlug } from '../../lib/pipelineAutomation.js';

const APPROVED = new Set(['approved', 'accepted']);

/**
 * @param {import('mysql2/promise').Pool} pool
 * @param {number|string} quoteId
 * @returns {Promise<{ ok: boolean, skipped?: boolean, created?: boolean, projectId?: number, reason?: string }>}
 */
export async function ensureProjectForApprovedQuote(pool, quoteId) {
  const id = parseInt(String(quoteId), 10);
  if (!Number.isFinite(id) || id <= 0) return { ok: false, reason: 'invalid_id' };

  const [rows0] = await pool.query('SELECT * FROM quotes WHERE id = ?', [id]);
  const q0 = rows0[0];
  if (!q0) return { ok: false, reason: 'not_found' };

  const st0 = String(q0.status || '').toLowerCase();
  if (!APPROVED.has(st0)) return { ok: true, skipped: true, reason: 'not_approved' };

  const pid0 = q0.project_id != null ? parseInt(String(q0.project_id), 10) : null;
  if (pid0 && pid0 > 0) {
    const [ex] = await pool.query('SELECT id FROM projects WHERE id = ?', [pid0]);
    if (ex.length) {
      const lidEarly = q0.lead_id != null ? parseInt(String(q0.lead_id), 10) : null;
      if (lidEarly && lidEarly > 0) {
        try {
          await setLeadPipelineBySlug(lidEarly, 'closed_won');
        } catch (_) {
          /* best-effort */
        }
      }
      return { ok: true, projectId: pid0, created: false };
    }
  }

  let customerId = q0.customer_id != null ? parseInt(String(q0.customer_id), 10) : null;
  if (customerId && customerId > 0) {
    const [c] = await pool.query('SELECT id FROM customers WHERE id = ?', [customerId]);
    if (!c.length) customerId = null;
  } else {
    customerId = null;
  }

  if (!customerId) {
    const leadId = q0.lead_id != null ? parseInt(String(q0.lead_id), 10) : null;
    if (!leadId) {
      console.warn(`[quotes] ensureProjectForApprovedQuote: quote ${id} sem customer_id nem lead_id`);
      return { ok: false, reason: 'no_customer' };
    }
    const [leads] = await pool.query(
      `SELECT l.*, ps.slug AS pipeline_stage_slug
       FROM leads l
       LEFT JOIN pipeline_stages ps ON l.pipeline_stage_id = ps.id
       WHERE l.id = ?`,
      [leadId]
    );
    if (!leads.length) {
      console.warn(`[quotes] ensureProjectForApprovedQuote: lead ${leadId} não encontrado`);
      return { ok: false, reason: 'no_lead' };
    }
    const conv = await ensureClientFromLead(pool, leads[0], { force: true });
    if (!conv.customer_id) {
      console.warn(
        `[quotes] ensureProjectForApprovedQuote: sem cliente para quote ${id}: ${conv.reason || 'unknown'}`
      );
      return { ok: false, reason: conv.reason || 'no_customer' };
    }
    customerId = conv.customer_id;
    if (!q0.customer_id) {
      await pool.execute('UPDATE quotes SET customer_id = ? WHERE id = ?', [customerId, id]);
    }
  }

  const name =
    q0.quote_number != null && String(q0.quote_number).trim()
      ? `Orçamento ${String(q0.quote_number).trim()}`
      : `Orçamento #${id}`;
  const estimatedRaw = q0.total_amount != null ? Number(q0.total_amount) : null;
  const estimated =
    estimatedRaw != null && Number.isFinite(estimatedRaw) ? estimatedRaw : null;
  const leadIdIns = q0.lead_id != null ? parseInt(String(q0.lead_id), 10) : null;
  const ownerId = q0.created_by != null ? parseInt(String(q0.created_by), 10) : null;
  const notes = q0.notes != null ? String(q0.notes).trim().slice(0, 8000) || null : null;

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [qr] = await conn.query('SELECT id, project_id, status FROM quotes WHERE id = ? FOR UPDATE', [id]);
    const q = qr[0];
    if (!q) {
      await conn.rollback();
      return { ok: false, reason: 'not_found' };
    }
    if (!APPROVED.has(String(q.status || '').toLowerCase())) {
      await conn.rollback();
      return { ok: true, skipped: true, reason: 'not_approved' };
    }
    const pid = q.project_id != null ? parseInt(String(q.project_id), 10) : null;
    if (pid && pid > 0) {
      const [ex2] = await conn.query('SELECT id FROM projects WHERE id = ?', [pid]);
      if (ex2.length) {
        await conn.commit();
        if (leadIdIns && leadIdIns > 0) {
          try {
            await setLeadPipelineBySlug(leadIdIns, 'closed_won');
          } catch (_) {
            /* best-effort */
          }
        }
        return { ok: true, projectId: pid, created: false };
      }
    }

    const pcols = await getProjectsTableColumnSet(conn);

    /** Reutilizar projeto já criado pelo lead ganho (mesmo lead_id). */
    if (leadIdIns && leadIdIns > 0) {
      let existProjSql = 'SELECT id FROM projects WHERE lead_id = ?';
      if (pcols.has('deleted_at')) existProjSql += ' AND deleted_at IS NULL';
      existProjSql += ' ORDER BY id ASC LIMIT 1';
      const [exByLead] = await conn.query(existProjSql, [leadIdIns]);
      if (exByLead.length) {
        const mergeId = exByLead[0].id;
        await conn.execute('UPDATE quotes SET project_id = ? WHERE id = ?', [mergeId, id]);
        await conn.execute(
          `UPDATE quotes SET project_id = ?
           WHERE lead_id = ? AND LOWER(TRIM(status)) IN ('approved','accepted') AND project_id IS NULL`,
          [mergeId, leadIdIns]
        );
        try {
          await applyQuoteLineRevenueToProject(conn, mergeId, id);
        } catch (e) {
          console.warn('[quotes] applyQuoteLineRevenueToProject on merged project:', e.message);
        }
        if (contractVal > 0 && pcols.has('contract_value')) {
          await conn.execute(
            'UPDATE projects SET contract_value = GREATEST(COALESCE(contract_value,0), ?) WHERE id = ?',
            [contractVal, mergeId]
          );
        } else if (contractVal > 0 && pcols.has('estimated_cost') && !pcols.has('contract_value')) {
          await conn.execute(
            'UPDATE projects SET estimated_cost = GREATEST(COALESCE(estimated_cost,0), ?) WHERE id = ?',
            [contractVal, mergeId]
          );
        }
        await conn.commit();
        try {
          await setLeadPipelineBySlug(leadIdIns, 'closed_won');
        } catch (_) {
          /* best-effort */
        }
        return { ok: true, projectId: mergeId, created: false, mergedFromLead: true };
      }
    }
    const pn = await nextProjectNumber(conn);
    const contractVal = estimated != null && Number.isFinite(estimated) ? estimated : 0;
    const oid = ownerId && ownerId > 0 ? ownerId : null;
    const fields = [];
    const insVals = [];
    const addI = (col, val) => {
      if (!pcols.has(col)) return;
      fields.push(`\`${col}\``);
      insVals.push(val);
    };
    addI('customer_id', customerId);
    addI('lead_id', leadIdIns && leadIdIns > 0 ? leadIdIns : null);
    if (leadIdIns && leadIdIns > 0) {
      if (pcols.has('client_type')) addI('client_type', 'customer');
      if (pcols.has('builder_id')) addI('builder_id', null);
      if (pcols.has('builder_name')) addI('builder_name', null);
    }
    addI('name', name.slice(0, 255));
    if (pn) addI('project_number', pn);
    if (pcols.has('project_type')) addI('project_type', 'installation');
    if (pcols.has('status')) addI('status', 'scheduled');
    if (pcols.has('contract_value')) addI('contract_value', contractVal);
    else if (pcols.has('estimated_cost')) addI('estimated_cost', contractVal);
    addI('assigned_to', oid);
    addI('owner_id', oid);
    addI('notes', notes);
    if (fields.length < 3) {
      await conn.rollback();
      return { ok: false, reason: 'projects_schema_incompatible' };
    }
    const [ins] = await conn.execute(
      `INSERT INTO projects (${fields.join(', ')}) VALUES (${fields.map(() => '?').join(', ')})`,
      insVals
    );
    const newProjectId = ins.insertId;
    await conn.execute('UPDATE quotes SET project_id = ? WHERE id = ?', [newProjectId, id]);
    try {
      await applyQuoteLineRevenueToProject(conn, newProjectId, id);
    } catch (e) {
      console.warn('[quotes] applyQuoteLineRevenueToProject on new project:', e.message);
    }
    await conn.commit();
    if (leadIdIns && leadIdIns > 0) {
      try {
        await setLeadPipelineBySlug(leadIdIns, 'closed_won');
      } catch (_) {
        /* best-effort */
      }
    }
    return { ok: true, projectId: newProjectId, created: true };
  } catch (e) {
    await conn.rollback();
    console.error('[quotes] ensureProjectForApprovedQuote:', e);
    throw e;
  } finally {
    conn.release();
  }
}
