import bcrypt from 'bcryptjs';

async function columnExists(pool, table, col) {
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, col]
  );
  return Number(rows[0]?.c) > 0;
}

/** Admin-visible summary (never exposes bcrypt hash). */
export function builderPortalAuthSummary(row) {
  if (!row) return null;
  return {
    has_password: Boolean(row.portal_password_hash),
    portal_access: !!row.portal_access,
    portal_blocked: !!row.portal_blocked,
    admin_password: row.portal_admin_password || null,
    password_set_at: row.portal_password_set_at || null,
  };
}

/**
 * Set portal password (hash + optional admin-visible copy for CRM).
 * @returns {Promise<string>} plain password that was set
 */
export async function setBuilderPortalPassword(pool, builderId, plainPassword) {
  const plain = String(plainPassword || '').trim();
  if (plain.length < 8) {
    const err = new Error('Password must be at least 8 characters');
    err.status = 400;
    throw err;
  }
  const hash = await bcrypt.hash(plain, 10);
  const hasAdminPlain = await columnExists(pool, 'builders', 'portal_admin_password');
  const hasSetAt = await columnExists(pool, 'builders', 'portal_password_set_at');
  const hasMustChange = await columnExists(pool, 'builders', 'portal_password_must_change');
  const mustChangeSql = hasMustChange ? ', portal_password_must_change = 1' : '';

  if (hasAdminPlain && hasSetAt) {
    await pool.execute(
      `UPDATE builders SET
        portal_password_hash = ?,
        portal_admin_password = ?,
        portal_password_set_at = NOW(),
        portal_access = 1,
        portal_blocked = 0${mustChangeSql}
       WHERE id = ?`,
      [hash, plain, builderId]
    );
  } else if (hasAdminPlain) {
    await pool.execute(
      `UPDATE builders SET
        portal_password_hash = ?,
        portal_admin_password = ?,
        portal_access = 1,
        portal_blocked = 0
       WHERE id = ?`,
      [hash, plain, builderId]
    );
  } else {
    await pool.execute(
      `UPDATE builders SET portal_password_hash = ?, portal_access = 1, portal_blocked = 0 WHERE id = ?`,
      [hash, builderId]
    );
  }
  return plain;
}

/** Builder changed password in portal — admin copy is no longer valid. */
export async function clearBuilderAdminPasswordCopy(pool, builderId) {
  const hasAdminPlain = await columnExists(pool, 'builders', 'portal_admin_password');
  const hasSetAt = await columnExists(pool, 'builders', 'portal_password_set_at');
  if (!hasAdminPlain && !hasSetAt) return;
  const sets = ['portal_password_hash = portal_password_hash'];
  if (hasAdminPlain) sets.push('portal_admin_password = NULL');
  if (hasSetAt) sets.push('portal_password_set_at = NOW()');
  const hasMustChange = await columnExists(pool, 'builders', 'portal_password_must_change');
  if (hasMustChange) sets.push('portal_password_must_change = 0');
  await pool.execute(`UPDATE builders SET ${sets.join(', ')} WHERE id = ?`, [builderId]);
}
