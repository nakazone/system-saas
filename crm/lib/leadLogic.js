/**
 * Lead logic: duplicate check, round-robin owner
 */
export async function checkDuplicateLead(pool, email, phone, excludeLeadId = null) {
  const em = (email || '').trim().toLowerCase();
  const ph = (phone || '').replace(/\D/g, '');
  const phoneNormSql = `TRIM(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(phone,' ',''),'-',''),'(',''),')',''),'+',''))`;
  const parts = [];
  const params = [];
  if (em) {
    parts.push('LOWER(TRIM(email)) = ?');
    params.push(em);
  }
  if (ph.length >= 8) {
    parts.push(`${phoneNormSql} = ?`);
    params.push(ph);
  }
  if (parts.length === 0) return { is_duplicate: false, existing_id: null };
  let sql = `SELECT id FROM leads WHERE (${parts.join(' OR ')})`;
  if (excludeLeadId) {
    sql += ' AND id != ?';
    params.push(excludeLeadId);
  }
  sql += ' LIMIT 1';
  const [rows] = await pool.execute(sql, params);
  const row = rows[0];
  return { is_duplicate: !!row, existing_id: row ? row.id : null };
}

export async function getNextOwnerRoundRobin(pool) {
  try {
    const [users] = await pool.query(
      `SELECT id FROM users WHERE is_active = 1 AND role IN ('admin', 'sales_rep', 'project_manager') ORDER BY id`
    );
    const userIds = users.map((u) => u.id);
    if (userIds.length === 0) return null;
    const [cols] = await pool.query("SHOW COLUMNS FROM leads LIKE 'owner_id'");
    if (!cols || cols.length === 0) return userIds[0];
    const [last] = await pool.query(
      'SELECT owner_id FROM leads WHERE owner_id IS NOT NULL ORDER BY created_at DESC LIMIT 1'
    );
    const lastId = last[0] ? last[0].owner_id : null;
    const idx = lastId ? userIds.indexOf(lastId) : -1;
    const nextIdx = (idx + 1) % userIds.length;
    return userIds[nextIdx];
  } catch {
    return null;
  }
}
