/**
 * Quote signatures: client on approval + company owner on PDF.
 */
async function tableExists(pool, name) {
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS c FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [name]
  );
  return Number(rows[0]?.c) > 0;
}

async function columnExists(pool, table, col) {
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, col]
  );
  return Number(rows[0]?.c) > 0;
}

export async function ensureQuoteSignatureSchema(pool) {
  if (!pool) return;
  try {
    if (!(await tableExists(pool, 'company_settings'))) {
      await pool.query(`
        CREATE TABLE company_settings (
          id INT NOT NULL AUTO_INCREMENT,
          setting_key VARCHAR(64) NOT NULL,
          blob_value MEDIUMBLOB NULL,
          text_value VARCHAR(255) NULL,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          PRIMARY KEY (id),
          UNIQUE KEY uk_company_settings_key (setting_key)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
      console.log('[db] Tabela company_settings criada.');
    }

    if ((await tableExists(pool, 'quotes')) && !(await columnExists(pool, 'quotes', 'client_signature_png'))) {
      await pool.query(
        'ALTER TABLE quotes ADD COLUMN client_signature_png MEDIUMBLOB NULL AFTER approved_at'
      );
      console.log('[db] Coluna quotes.client_signature_png adicionada.');
    }
    if ((await tableExists(pool, 'quotes')) && !(await columnExists(pool, 'quotes', 'client_signed_name'))) {
      await pool.query(
        'ALTER TABLE quotes ADD COLUMN client_signed_name VARCHAR(255) NULL AFTER client_signature_png'
      );
      console.log('[db] Coluna quotes.client_signed_name adicionada.');
    }
  } catch (e) {
    console.warn('[db] ensureQuoteSignatureSchema:', e.code || e.message);
  }
}
