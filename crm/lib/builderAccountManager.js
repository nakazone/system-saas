/**
 * Resolve Senior Floors account manager for a builder (with CRM fallbacks).
 */

async function columnExists(pool, table, col) {
  const [r] = await pool.query(
    `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, col]
  );
  return Number(r[0]?.c) > 0;
}

/** @returns {Promise<{ id: number, name: string, email: string, phone: string|null, avatar_url: string|null }|null>} */
export async function resolveUserContact(pool, userId) {
  const uid = userId ? parseInt(String(userId), 10) : null;
  if (!uid || !Number.isFinite(uid)) return null;

  const hasPhone = await columnExists(pool, 'users', 'phone');
  const hasAvatar = await columnExists(pool, 'users', 'avatar');
  const [u] = await pool.query(
    `SELECT id, name, email${hasPhone ? ', phone' : ''}${hasAvatar ? ', avatar' : ''}
     FROM users WHERE id = ? LIMIT 1`,
    [uid]
  );
  if (!u.length) return null;
  const row = u[0];
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone || null,
    avatar_url: row.avatar || null,
  };
}

export async function resolveBuilderAccountManager(pool, accountManagerUserId) {
  const hasPhone = await columnExists(pool, 'users', 'phone');
  const hasAvatar = await columnExists(pool, 'users', 'avatar');

  let userId = accountManagerUserId ? parseInt(String(accountManagerUserId), 10) : null;

  if (!userId || !Number.isFinite(userId)) {
    const [fallback] = await pool.query('SELECT id FROM users ORDER BY id ASC LIMIT 1');
    userId = fallback[0]?.id || null;
  }
  if (!userId) {
    const [any] = await pool.query('SELECT id FROM users ORDER BY id ASC LIMIT 1');
    userId = any[0]?.id || null;
  }
  if (!userId) return null;
  return resolveUserContact(pool, userId);
}
