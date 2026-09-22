import crypto from 'crypto';

export function newPublicToken() {
  return crypto.randomBytes(32).toString('hex');
}

export async function quoteColumns(pool) {
  const [colRows] = await pool.query(
    `SELECT COLUMN_NAME AS n FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'quotes' ORDER BY ORDINAL_POSITION`
  );
  return new Set(colRows.map((r) => r.n));
}

export async function quoteItemColumns(pool) {
  const [colRows] = await pool.query(
    `SELECT COLUMN_NAME AS n FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'quote_items' ORDER BY ORDINAL_POSITION`
  );
  return new Set(colRows.map((r) => r.n));
}

/** ORDER BY seguro para schemas com ou sem sort_order (pré-migrate quotes-module). */
export function quoteItemsOrderByClause(colSet) {
  return colSet.has('sort_order') ? '`sort_order`, `id`' : '`id`';
}

const QUOTE_ITEM_INSERT_ORDER = [
  'quote_id',
  'floor_type',
  'area_sqft',
  'unit_price',
  'total_price',
  'notes',
  'type',
  'name',
  'description',
  'quantity',
  'service_catalog_id',
  'unit_type',
  'service_type',
  'catalog_customer_notes',
  'item_type',
  'product_id',
  'cost_price',
  'markup_percentage',
  'sell_price',
  'sort_order',
];

export async function insertQuoteSnapshot(pool, quoteId, payload, userId) {
  await pool.execute(
    `INSERT INTO quote_snapshots (quote_id, snapshot_json, created_by) VALUES (?, CAST(? AS CHAR CHARACTER SET utf8mb4), ?)`,
    [quoteId, JSON.stringify(payload), userId || null]
  );
}

export async function listSnapshots(pool, quoteId) {
  const [rows] = await pool.query(
    `SELECT id, quote_id, snapshot_json, created_by, created_at
     FROM quote_snapshots WHERE quote_id = ? ORDER BY id DESC LIMIT 50`,
    [quoteId]
  );
  return rows.map((r) => ({
    ...r,
    snapshot: safeJson(r.snapshot_json),
  }));
}

function safeJson(s) {
  try {
    return typeof s === 'string' ? JSON.parse(s) : s;
  } catch {
    return null;
  }
}

export async function replaceQuoteItems(pool, quoteId, items) {
  const colSet = await quoteItemColumns(pool);
  const fields = QUOTE_ITEM_INSERT_ORDER.filter((f) => colSet.has(f));
  if (!fields.length || !fields.includes('quote_id')) {
    throw new Error('quote_items: colunas insuficientes (esperado pelo menos quote_id)');
  }
  await pool.execute('DELETE FROM quote_items WHERE quote_id = ?', [quoteId]);
  let order = 0;
  for (const raw of items) {
    order += 1;
    const it = normalizeRow(raw, order);
    const rowMap = {
      quote_id: quoteId,
      floor_type: it.floor_type,
      area_sqft: it.area_sqft,
      unit_price: it.unit_price,
      total_price: it.total_price,
      notes: it.notes || null,
      type: it.type,
      name: it.name || null,
      description: it.description || null,
      quantity: it.quantity,
      service_catalog_id: it.service_catalog_id,
      unit_type: it.unit_type,
      service_type: it.service_type,
      catalog_customer_notes: it.catalog_customer_notes,
      item_type: it.item_type,
      product_id: it.product_id,
      cost_price: it.cost_price,
      markup_percentage: it.markup_percentage,
      sell_price: it.sell_price,
      sort_order: it.sort_order,
    };
    const vals = fields.map((f) => rowMap[f]);
    const ph = fields.map(() => '?').join(', ');
    await pool.execute(
      `INSERT INTO quote_items (${fields.map((f) => `\`${f}\``).join(', ')}) VALUES (${ph})`,
      vals
    );
  }
}

function normalizeRow(raw, sortOrder) {
  const quantity = Number(raw.quantity) || 0;
  const rate = Number(raw.rate ?? raw.unit_price ?? raw.sell_price) || 0;
  const total =
    raw.total_price != null && raw.total_price !== ''
      ? Number(raw.total_price)
      : Math.round(quantity * rate * 100) / 100;
  let name =
    raw.name != null && String(raw.name).trim() !== '' ? String(raw.name).trim().slice(0, 255) : null;
  let description =
    raw.description != null && String(raw.description).trim() !== ''
      ? String(raw.description).trim()
      : null;
  if (name && description && name === description.trim()) {
    description = null;
  }
  if (!name && description) {
    const parts = description.split(/\n/);
    const first = parts[0].trim().slice(0, 255);
    name = first || description.slice(0, 255);
    const rest = parts.slice(1).join('\n').trim();
    description = rest || null;
  }
  if (name && description && name === description.trim()) {
    description = null;
  }
  const isProduct = String(raw.item_type || '').toLowerCase() === 'product';
  const lineType = isProduct
    ? 'material'
    : raw.type && ['material', 'labor', 'service'].includes(raw.type)
      ? raw.type
      : 'service';
  const costNum =
    raw.cost_price != null && raw.cost_price !== '' ? Number(raw.cost_price) : null;
  const markupNum =
    raw.markup_percentage != null && raw.markup_percentage !== ''
      ? Number(raw.markup_percentage)
      : null;
  return {
    floor_type: String(raw.floor_type || 'General').slice(0, 100),
    area_sqft: quantity,
    unit_price: rate,
    total_price: total,
    notes: raw.notes || null,
    type: lineType,
    name,
    description,
    quantity,
    service_catalog_id: raw.service_catalog_id != null ? parseInt(raw.service_catalog_id, 10) || null : null,
    unit_type: normalizeUnitType(raw.unit_type),
    service_type: isProduct ? null : normalizeLineServiceType(raw.service_type),
    catalog_customer_notes:
      raw.catalog_customer_notes != null && String(raw.catalog_customer_notes).trim() !== ''
        ? String(raw.catalog_customer_notes).trim().slice(0, 4000)
        : null,
    item_type: isProduct ? 'product' : 'service',
    product_id: isProduct
      ? (() => {
          const p = parseInt(raw.product_id, 10);
          return Number.isFinite(p) && p > 0 ? p : null;
        })()
      : null,
    cost_price: isProduct && costNum != null && Number.isFinite(costNum) ? costNum : null,
    markup_percentage:
      isProduct && markupNum != null && Number.isFinite(markupNum) ? markupNum : null,
    sell_price: isProduct ? rate : null,
    sort_order: raw.sort_order != null ? parseInt(raw.sort_order, 10) : sortOrder,
  };
}

function normalizeLineServiceType(st) {
  if (st == null || st === '') return null;
  const s = String(st).trim().slice(0, 64);
  return s || null;
}

function normalizeUnitType(u) {
  const v = String(u || 'sq_ft').toLowerCase().replace(/\s/g, '_');
  const allowed = ['sq_ft', 'linear_ft', 'inches', 'fixed', 'box', 'piece'];
  if (allowed.includes(v)) return v;
  if (v === 'sqft') return 'sq_ft';
  return 'sq_ft';
}

export async function listCatalog(pool, activeOnly = true) {
  const sql = activeOnly
    ? 'SELECT * FROM quote_service_catalog WHERE active = 1 ORDER BY category, name'
    : 'SELECT * FROM quote_service_catalog ORDER BY category, name';
  const [rows] = await pool.query(sql);
  return rows;
}

export async function getCatalogItem(pool, id) {
  const [rows] = await pool.query('SELECT * FROM quote_service_catalog WHERE id = ?', [id]);
  return rows[0] || null;
}

export async function insertCatalogItem(pool, row) {
  const [r] = await pool.execute(
    `INSERT INTO quote_service_catalog (
      name, category, default_rate, rate_builder, rate_customer, unit_type,
      default_description, notes_builder, notes_customer, active
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      row.name,
      row.category,
      row.default_rate,
      row.rate_builder,
      row.rate_customer,
      normalizeUnitType(row.unit_type),
      row.default_description || null,
      row.notes_builder || null,
      row.notes_customer || null,
      row.active !== false ? 1 : 0,
    ]
  );
  return r.insertId;
}

export async function updateCatalogItem(pool, id, row) {
  await pool.execute(
    `UPDATE quote_service_catalog SET name = ?, category = ?, default_rate = ?, rate_builder = ?,
     rate_customer = ?, unit_type = ?, default_description = ?, notes_builder = ?, notes_customer = ?,
     active = ? WHERE id = ?`,
    [
      row.name,
      row.category,
      row.default_rate,
      row.rate_builder,
      row.rate_customer,
      normalizeUnitType(row.unit_type),
      row.default_description || null,
      row.notes_builder || null,
      row.notes_customer || null,
      row.active !== false ? 1 : 0,
      id,
    ]
  );
}

export async function deleteCatalogItem(pool, id) {
  await pool.execute('UPDATE quote_service_catalog SET active = 0 WHERE id = ?', [id]);
}

export async function listTemplates(pool) {
  const [rows] = await pool.query(
    'SELECT id, name, service_type, created_at, updated_at FROM quote_templates ORDER BY name'
  );
  return rows;
}

export async function getTemplateWithItems(pool, id) {
  const [tpl] = await pool.query('SELECT * FROM quote_templates WHERE id = ?', [id]);
  if (!tpl.length) return null;
  const [items] = await pool.query(
    'SELECT * FROM quote_template_items WHERE template_id = ? ORDER BY sort_order, id',
    [id]
  );
  return { ...tpl[0], items };
}

export async function insertTemplate(pool, { name, service_type, created_by, items }) {
  const [res] = await pool.execute(
    'INSERT INTO quote_templates (name, service_type, created_by) VALUES (?, ?, ?)',
    [name, service_type || null, created_by || null]
  );
  const tid = res.insertId;
  let o = 0;
  for (const raw of items || []) {
    o += 1;
    const q = Number(raw.quantity) || 1;
    const rate = Number(raw.rate ?? raw.default_rate) || 0;
    const isP = String(raw.item_type || '').toLowerCase() === 'product';
    const pid =
      isP && raw.product_id != null
        ? (() => {
            const p = parseInt(raw.product_id, 10);
            return Number.isFinite(p) && p > 0 ? p : null;
          })()
        : null;
    const costP =
      isP && raw.cost_price != null && raw.cost_price !== '' ? Number(raw.cost_price) : null;
    const markP =
      isP && raw.markup_percentage != null && raw.markup_percentage !== ''
        ? Number(raw.markup_percentage)
        : null;
    const sellP = isP ? rate : null;
    const tn = raw.name != null ? String(raw.name).trim() : '';
    const td = raw.description != null ? String(raw.description).trim() : '';
    const packedTemplateDesc = tn && td ? `${tn.slice(0, 500)}\n${td}` : tn || td || '';
    await pool.execute(
      `INSERT INTO quote_template_items (
        template_id, service_catalog_id, description, unit_type, quantity, rate, notes, sort_order,
        service_type, catalog_customer_notes, item_type, product_id, cost_price, markup_percentage, sell_price
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        tid,
        raw.service_catalog_id != null ? parseInt(raw.service_catalog_id, 10) || null : null,
        packedTemplateDesc,
        normalizeUnitType(raw.unit_type),
        q,
        rate,
        raw.notes || null,
        raw.sort_order != null ? raw.sort_order : o,
        isP ? null : normalizeLineServiceType(raw.service_type),
        raw.catalog_customer_notes != null && String(raw.catalog_customer_notes).trim() !== ''
          ? String(raw.catalog_customer_notes).trim().slice(0, 4000)
          : null,
        isP ? 'product' : 'service',
        pid,
        costP,
        markP,
        sellP,
      ]
    );
  }
  return tid;
}

export async function deleteTemplate(pool, id) {
  await pool.execute('DELETE FROM quote_template_items WHERE template_id = ?', [id]);
  await pool.execute('DELETE FROM quote_templates WHERE id = ?', [id]);
}
