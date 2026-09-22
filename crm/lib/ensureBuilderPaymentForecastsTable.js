/**
 * Cria builder_payment_forecasts se não existir — idempotente no arranque.
 */
export async function ensureBuilderPaymentForecastsTable(pool) {
  if (!pool) return;
  try {
    const [t] = await pool.query(
      `SELECT COUNT(*) AS c FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'builder_payment_forecasts'`
    );
    if (t[0]?.c > 0) return;

    await pool.query(`
CREATE TABLE builder_payment_forecasts (
  id int(11) NOT NULL AUTO_INCREMENT,
  builder_id int(11) NOT NULL COMMENT 'customers.id (builder)',
  project_id int(11) NOT NULL COMMENT 'projects.id',
  expected_payment_date date NOT NULL,
  amount decimal(12,2) DEFAULT NULL COMMENT 'opcional — valor previsto',
  notes varchar(500) DEFAULT NULL,
  created_by int(11) DEFAULT NULL,
  created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_bpf_builder (builder_id),
  KEY idx_bpf_project (project_id),
  KEY idx_bpf_date (expected_payment_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='Previsão de pagamento de builders por projeto'`);
    console.log('[db] Tabela builder_payment_forecasts criada.');
  } catch (e) {
    console.warn('[db] ensure builder_payment_forecasts:', e.code || e.message);
  }
}
