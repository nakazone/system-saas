export async function listProducts(pool, { supplierId, q, activeOnly = true, limit = 200 } = {}) {
  let sql = 'SELECT p.*, s.name AS supplier_name FROM products p JOIN suppliers s ON s.id = p.supplier_id WHERE 1=1';
  const params = [];
  if (activeOnly) {
    sql += ' AND p.active = 1 AND s.active = 1';
  }
  if (supplierId) {
    sql += ' AND p.supplier_id = ?';
    params.push(supplierId);
  }
  if (q && String(q).trim()) {
    sql += ' AND (p.name LIKE ? OR p.sku LIKE ? OR p.description LIKE ?)';
    const term = `%${String(q).trim()}%`;
    params.push(term, term, term);
  }
  sql += ' ORDER BY s.name, p.name LIMIT ?';
  params.push(Math.min(Number(limit) || 200, 500));
  const [rows] = await pool.query(sql, params);
  return rows;
}

export async function getProduct(pool, id) {
  const [rows] = await pool.query(
    `SELECT p.*, s.name AS supplier_name FROM products p
     JOIN suppliers s ON s.id = p.supplier_id WHERE p.id = ?`,
    [id]
  );
  return rows[0] || null;
}

export async function insertProduct(pool, row) {
  const [r] = await pool.execute(
    `INSERT INTO products (supplier_id, name, category, unit_type, cost_price, sku, description, stock_qty, active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      row.supplier_id,
      row.name,
      row.category,
      row.unit_type || 'sq_ft',
      row.cost_price,
      row.sku || null,
      row.description || null,
      row.stock_qty != null ? parseInt(row.stock_qty, 10) : null,
      row.active !== false ? 1 : 0,
    ]
  );
  return r.insertId;
}

export async function updateProduct(pool, id, row) {
  await pool.execute(
    `UPDATE products SET supplier_id = ?, name = ?, category = ?, unit_type = ?, cost_price = ?,
     sku = ?, description = ?, stock_qty = ?, active = ? WHERE id = ?`,
    [
      row.supplier_id,
      row.name,
      row.category,
      row.unit_type || 'sq_ft',
      row.cost_price,
      row.sku || null,
      row.description || null,
      row.stock_qty != null ? parseInt(row.stock_qty, 10) : null,
      row.active !== false ? 1 : 0,
      id,
    ]
  );
}

export async function softDeleteProduct(pool, id) {
  await pool.execute('UPDATE products SET active = 0 WHERE id = ?', [id]);
}
