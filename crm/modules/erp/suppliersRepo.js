export async function listSuppliers(pool, { activeOnly = true } = {}) {
  const sql = activeOnly
    ? 'SELECT * FROM suppliers WHERE active = 1 ORDER BY name'
    : 'SELECT * FROM suppliers ORDER BY name';
  const [rows] = await pool.query(sql);
  return rows;
}

export async function getSupplier(pool, id) {
  const [rows] = await pool.query('SELECT * FROM suppliers WHERE id = ?', [id]);
  return rows[0] || null;
}

export async function insertSupplier(pool, row) {
  const [r] = await pool.execute(
    `INSERT INTO suppliers (name, contact_name, phone, email, address, notes, active)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      row.name,
      row.contact_name || null,
      row.phone || null,
      row.email || null,
      row.address || null,
      row.notes || null,
      row.active !== false ? 1 : 0,
    ]
  );
  return r.insertId;
}

export async function updateSupplier(pool, id, row) {
  await pool.execute(
    `UPDATE suppliers SET name = ?, contact_name = ?, phone = ?, email = ?, address = ?, notes = ?, active = ?
     WHERE id = ?`,
    [
      row.name,
      row.contact_name || null,
      row.phone || null,
      row.email || null,
      row.address || null,
      row.notes || null,
      row.active !== false ? 1 : 0,
      id,
    ]
  );
}

export async function softDeleteSupplier(pool, id) {
  await pool.execute('UPDATE suppliers SET active = 0 WHERE id = ?', [id]);
}
