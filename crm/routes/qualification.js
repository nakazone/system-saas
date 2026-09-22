/**
 * API Routes para Lead Qualification
 * GET, POST, PUT /api/leads/:leadId/qualification
 */

import { getDBConnection } from '../config/db.js';
import { ensureLeadsAddressColumn } from '../lib/leadColumns.js';

function rowHasQualAddress(row) {
  for (const k of ['address_street', 'address_line2', 'address_city', 'address_state', 'address_zip']) {
    if (String(row[k] ?? '').trim()) return true;
  }
  return false;
}

/** Colunas atuais de `lead_qualification` (evita ER_BAD_FIELD_ERROR em BD sem migração). */
async function leadQualificationColumnSet(pool) {
  const [rows] = await pool.query(
    `SELECT COLUMN_NAME AS n FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'lead_qualification'`
  );
  return new Set((rows || []).map((r) => r.n));
}

export async function getQualification(req, res) {
  const leadId = parseInt(req.params.leadId);
  
  if (!leadId || isNaN(leadId)) {
    return res.status(400).json({ success: false, error: 'Invalid lead ID' });
  }

  try {
    const pool = await getDBConnection();
    const [rows] = await pool.execute(
      `SELECT q.*, u.name as qualified_by_name 
       FROM lead_qualification q
       LEFT JOIN users u ON q.qualified_by = u.id
       WHERE q.lead_id = ?`,
      [leadId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Qualification not found' });
    }

    const data = { ...rows[0] };
    if (!rowHasQualAddress(data)) {
      const [lrows] = await pool.execute('SELECT address FROM leads WHERE id = ?', [leadId]);
      const la = lrows[0]?.address != null ? String(lrows[0].address).trim() : '';
      if (la) data.address_street = la;
    }

    return res.json({ success: true, data });
  } catch (error) {
    console.error('Error getting qualification:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
}

export async function createOrUpdateQualification(req, res) {
  const leadId = parseInt(req.params.leadId);
  const userId = req.session?.user?.id;
  
  if (!leadId || isNaN(leadId)) {
    return res.status(400).json({ success: false, error: 'Invalid lead ID' });
  }

  const body = req.body || {};
  const str = (v) => (v === undefined || v === null ? null : String(v));
  const trimStr = (v) => {
    if (v === undefined || v === null) return null;
    const s = String(v).trim();
    return s === '' ? null : s;
  };
  const num = (v) => (v === undefined || v === null || v === '' ? null : (parseFloat(v) || null));
  const int = (v) => (v === undefined || v === null || v === '' ? null : (parseInt(v, 10) || null));

  const property_type = str(body.property_type);
  const service_type = str(body.service_type);
  const estimated_area = num(body.estimated_area);
  const estimated_budget = num(body.estimated_budget);
  const urgency = str(body.urgency);
  const decision_maker = str(body.decision_maker);
  const decision_timeline = str(body.decision_timeline);
  const payment_type = str(body.payment_type);
  const score = int(body.score);
  const qualification_notes = str(body.qualification_notes);
  const address_street = trimStr(body.address_street);
  const address_line2 = trimStr(body.address_line2);
  const address_city = trimStr(body.address_city);
  const address_state = trimStr(body.address_state);
  const address_zip = trimStr(body.address_zip);
  const qualified_by = userId === undefined || userId === null ? null : userId;

  try {
    const pool = await getDBConnection();
    const cols = await leadQualificationColumnSet(pool);

    const fieldPairs = [
      ['property_type', property_type],
      ['service_type', service_type],
      ['estimated_area', estimated_area],
      ['estimated_budget', estimated_budget],
      ['urgency', urgency],
      ['decision_maker', decision_maker],
      ['decision_timeline', decision_timeline],
      ['payment_type', payment_type],
      ['score', score],
      ['qualification_notes', qualification_notes],
      ['address_street', address_street],
      ['address_line2', address_line2],
      ['address_city', address_city],
      ['address_state', address_state],
      ['address_zip', address_zip],
      ['qualified_by', qualified_by],
    ];

    // Verificar se já existe
    const [existing] = await pool.execute(
      'SELECT id FROM lead_qualification WHERE lead_id = ?',
      [leadId]
    );

    if (existing.length > 0) {
      const setParts = [];
      const vals = [];
      for (const [col, val] of fieldPairs) {
        if (!cols.has(col)) continue;
        setParts.push(`\`${col}\` = ?`);
        vals.push(val);
      }
      if (cols.has('qualified_at')) {
        setParts.push('`qualified_at` = NOW()');
      }
      if (setParts.length === 0) {
        return res.status(500).json({
          success: false,
          error: 'Tabela lead_qualification incompatível com esta versão da API',
        });
      }
      vals.push(leadId);
      await pool.execute(
        `UPDATE lead_qualification SET ${setParts.join(', ')} WHERE lead_id = ?`,
        vals
      );
    } else {
      const insertCols = ['lead_id'];
      const placeholders = ['?'];
      const insVals = [leadId];
      for (const [col, val] of fieldPairs) {
        if (!cols.has(col)) continue;
        insertCols.push(col);
        placeholders.push('?');
        insVals.push(val);
      }
      if (cols.has('qualified_at')) {
        insertCols.push('qualified_at');
        placeholders.push('NOW()');
      }
      if (insertCols.length < 2) {
        return res.status(500).json({
          success: false,
          error: 'Tabela lead_qualification incompatível com esta versão da API',
        });
      }
      await pool.execute(
        `INSERT INTO lead_qualification (${insertCols.map((c) => `\`${c}\``).join(', ')})
         VALUES (${placeholders.join(', ')})`,
        insVals
      );
    }

    const qualHasAddrCols = ['address_street', 'address_line2', 'address_city', 'address_state', 'address_zip'].some(
      (c) => cols.has(c)
    );
    const composedAddr = [
      address_street,
      address_line2,
      [address_city, address_state].filter(Boolean).join(', ') || null,
      address_zip,
    ]
      .filter((x) => x != null && String(x).trim() !== '')
      .join(', ');
    if (!qualHasAddrCols && composedAddr) {
      await ensureLeadsAddressColumn(pool);
      await pool.execute('UPDATE leads SET address = ? WHERE id = ?', [composedAddr.slice(0, 500), leadId]);
    }

    // Buscar atualizado
    const [updated] = await pool.execute(
      `SELECT q.*, u.name as qualified_by_name 
       FROM lead_qualification q
       LEFT JOIN users u ON q.qualified_by = u.id
       WHERE q.lead_id = ?`,
      [leadId]
    );

    let out = updated[0];
    if (!qualHasAddrCols) {
      out = {
        ...out,
        address_street,
        address_line2,
        address_city,
        address_state,
        address_zip,
      };
    }

    return res.json({ success: true, data: out });
  } catch (error) {
    console.error('Error saving qualification:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
}
