/**
 * Client invoices from approved quotes — idempotent on startup.
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

export async function ensureQuoteInvoicesSchema(pool) {
  if (!pool) return;
  try {
    if (!(await tableExists(pool, 'quote_invoices'))) {
      await pool.query(`
        CREATE TABLE quote_invoices (
          id INT NOT NULL AUTO_INCREMENT,
          quote_id INT NOT NULL,
          project_id INT NULL,
          customer_id INT NULL,
          invoice_number VARCHAR(32) NOT NULL,
          invoice_type ENUM('deposit','progress','final','full','other') NOT NULL DEFAULT 'deposit',
          amount DECIMAL(12,2) NOT NULL,
          quote_total DECIMAL(12,2) NULL,
          due_date DATE NULL,
          status ENUM('issued','sent','paid','void') NOT NULL DEFAULT 'issued',
          payment_instructions TEXT NULL,
          notes TEXT NULL,
          pdf_blob LONGBLOB NULL,
          email_sent_at DATETIME NULL,
          paid_at DATETIME NULL,
          created_by INT NULL,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          PRIMARY KEY (id),
          UNIQUE KEY uk_quote_invoices_number (invoice_number),
          KEY idx_quote_invoices_quote (quote_id),
          KEY idx_quote_invoices_customer (customer_id),
          KEY idx_quote_invoices_status (status)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
      console.log('[db] Tabela quote_invoices criada.');
    }

    if (!(await tableExists(pool, 'invoice_payment_receipts'))) {
      await pool.query(`
        CREATE TABLE invoice_payment_receipts (
          id INT NOT NULL AUTO_INCREMENT,
          invoice_id INT NOT NULL,
          quote_id INT NOT NULL,
          project_id INT NULL,
          customer_id INT NULL,
          receipt_number VARCHAR(40) NOT NULL,
          amount DECIMAL(12,2) NOT NULL,
          payment_date DATE NOT NULL,
          payment_method ENUM('cash','check','zelle','venmo','credit_card','bank_transfer','other') NOT NULL DEFAULT 'check',
          reference_number VARCHAR(120) NULL,
          notes TEXT NULL,
          pdf_blob LONGBLOB NULL,
          email_sent_at DATETIME NULL,
          financial_receipt_id INT NULL,
          created_by INT NULL,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          PRIMARY KEY (id),
          UNIQUE KEY uk_invoice_receipt_number (receipt_number),
          KEY idx_invoice_receipts_invoice (invoice_id),
          KEY idx_invoice_receipts_quote (quote_id),
          KEY idx_invoice_receipts_project (project_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
      console.log('[db] Tabela invoice_payment_receipts criada.');
    }

    if ((await tableExists(pool, 'payment_receipts')) && !(await columnExists(pool, 'payment_receipts', 'invoice_id'))) {
      await pool.query(
        'ALTER TABLE payment_receipts ADD COLUMN invoice_id INT NULL AFTER project_id, ADD KEY idx_payment_receipts_invoice (invoice_id)'
      );
      console.log('[db] Coluna payment_receipts.invoice_id adicionada.');
    }
  } catch (e) {
    console.warn('[db] ensureQuoteInvoicesSchema:', e.code || e.message);
  }
}
