/**
 * Adiciona customers.responsible_name se faltar — idempotente, corre no arranque.
 * No Railway a app resolve mysql.railway.internal; não é preciso migrate local com URL pública.
 */
export async function ensureCustomersResponsibleNameColumn(pool) {
  if (!pool) return;
  try {
    const [rows] = await pool.query(
      `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'customers' AND COLUMN_NAME = 'responsible_name'`
    );
    if (rows[0].c > 0) return;
    await pool.query(`
      ALTER TABLE customers
      ADD COLUMN responsible_name VARCHAR(255) NULL DEFAULT NULL
        COMMENT 'Builder: contacto / responsável (empresa em name)'
        AFTER name
    `);
    console.log('[db] Adicionada coluna customers.responsible_name (Builder: empresa + responsável).');
  } catch (e) {
    console.warn('[db] Não foi possível garantir customers.responsible_name:', e.code || e.message);
  }
}
