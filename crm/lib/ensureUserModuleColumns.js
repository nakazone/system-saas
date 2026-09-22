/**
 * Garante colunas do módulo de utilizadores (phone, avatar, must_change_password).
 */
async function columnExists(pool, table, col) {
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, col]
  );
  return Number(rows[0]?.c) > 0;
}

async function tryAlter(pool, sql, label) {
  try {
    await pool.query(sql);
    console.log(`[db] Adicionada coluna users.${label}`);
  } catch (e) {
    if (e.code === 'ER_DUP_FIELDNAME') return;
    console.warn(`[db] users.${label}:`, e.code || e.message);
  }
}

export async function ensureUserModuleColumns(pool) {
  if (!pool) return;

  if (!(await columnExists(pool, 'users', 'phone'))) {
    await tryAlter(pool, 'ALTER TABLE `users` ADD COLUMN `phone` VARCHAR(50) NULL', 'phone');
  }
  if (!(await columnExists(pool, 'users', 'avatar'))) {
    await tryAlter(
      pool,
      'ALTER TABLE `users` ADD COLUMN `avatar` VARCHAR(500) NULL COMMENT \'URL da foto do perfil\'',
      'avatar'
    );
  }
  if (!(await columnExists(pool, 'users', 'must_change_password'))) {
    await tryAlter(
      pool,
      'ALTER TABLE `users` ADD COLUMN `must_change_password` TINYINT(1) NOT NULL DEFAULT 0 COMMENT \'1 = obrigar troca de senha no próximo login\'',
      'must_change_password'
    );
  }
}
