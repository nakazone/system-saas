/**
 * Garante tabelas/colunas do módulo financeiro completo (idempotente).
 * Usado no arranque da API (Railway) e por database/migrate-financial-complete.js.
 */
async function columnExists(conn, table, column) {
  const [rows] = await conn.query(
    `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  );
  return Number(rows[0].c) > 0;
}

async function tableExists(conn, name) {
  const [t] = await conn.query('SHOW TABLES LIKE ?', [name]);
  return t && t.length > 0;
}

async function tryQuery(conn, sql, label, verbose) {
  try {
    await conn.query(sql);
    if (verbose && label) console.log('  +', label);
  } catch (e) {
    if (verbose) console.warn('  ! skip:', label || sql.slice(0, 80), '-', e.message);
  }
}

/**
 * @param {import('mysql2/promise').Pool | import('mysql2/promise').Connection} conn
 * @param {{ verbose?: boolean }} [options]
 */
export async function ensureFinancialCompleteSchema(conn, options = {}) {
  const verbose = Boolean(options.verbose);
  if (!conn || typeof conn.query !== 'function') return;

  await conn.query(`
    CREATE TABLE IF NOT EXISTS vendors (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      category ENUM('flooring_supplier','equipment','tools','subcontractor','marketing','utilities','insurance','vehicle','office','other') NOT NULL,
      contact_name VARCHAR(255) NULL,
      contact_email VARCHAR(255) NULL,
      contact_phone VARCHAR(50) NULL,
      website VARCHAR(255) NULL,
      address TEXT NULL,
      payment_terms VARCHAR(100) NULL,
      tax_id VARCHAR(100) NULL,
      notes TEXT NULL,
      is_active TINYINT(1) DEFAULT 1,
      rating TINYINT(1) DEFAULT NULL,
      total_spent DECIMAL(12,2) DEFAULT 0.00,
      created_by INT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      KEY idx_vendors_active (is_active),
      KEY idx_vendors_category (category)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  if (verbose) console.log('  ✓ vendors');

  await conn.query(`
    CREATE TABLE IF NOT EXISTS vendor_attachments (
      id INT AUTO_INCREMENT PRIMARY KEY,
      vendor_id INT NOT NULL,
      file_path VARCHAR(500) NOT NULL,
      file_url VARCHAR(500) NOT NULL,
      original_name VARCHAR(255) NULL,
      memo VARCHAR(500) NULL,
      created_by INT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      KEY idx_vendor_attachments_vendor (vendor_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  if (verbose) console.log('  ✓ vendor_attachments');

  if (await tableExists(conn, 'vendors')) {
    const [[{ c: fkVa }]] = await conn.query(
      `SELECT COUNT(*) AS c FROM information_schema.TABLE_CONSTRAINTS
       WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'vendor_attachments' AND CONSTRAINT_NAME = 'fk_vendor_attachments_vendor'`
    );
    if (!Number(fkVa)) {
      await tryQuery(
        conn,
        `ALTER TABLE vendor_attachments
         ADD CONSTRAINT fk_vendor_attachments_vendor FOREIGN KEY (vendor_id) REFERENCES vendors(id) ON DELETE CASCADE`,
        'FK vendor_attachments.vendor_id → vendors',
        verbose
      );
    }
  }

  await conn.query(`
    CREATE TABLE IF NOT EXISTS operational_costs (
      id INT AUTO_INCREMENT PRIMARY KEY,
      category ENUM('vehicle','insurance','office','fuel','phone','software','tools','equipment','utilities','rent','other') NOT NULL,
      subcategory VARCHAR(100) NULL,
      vendor_id INT NULL,
      description VARCHAR(255) NOT NULL,
      amount DECIMAL(10,2) NOT NULL,
      tax_amount DECIMAL(10,2) DEFAULT 0.00,
      total_amount DECIMAL(10,2) NOT NULL,
      expense_date DATE NOT NULL,
      payment_method ENUM('cash','check','credit_card','bank_transfer','ach','other') DEFAULT 'credit_card',
      status ENUM('pending','paid','recurring') DEFAULT 'pending',
      is_recurring TINYINT(1) DEFAULT 0,
      recurrence_type ENUM('weekly','biweekly','monthly','quarterly','annual') NULL,
      recurrence_day INT NULL,
      recurrence_end_date DATE NULL,
      receipt_path VARCHAR(500) NULL,
      receipt_url VARCHAR(500) NULL,
      notes TEXT NULL,
      approved_by INT NULL,
      approved_at TIMESTAMP NULL,
      created_by INT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      deleted_at TIMESTAMP NULL,
      KEY idx_op_costs_date (expense_date),
      KEY idx_op_costs_vendor (vendor_id),
      KEY idx_op_costs_deleted (deleted_at),
      KEY idx_op_costs_status (status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  if (verbose) console.log('  ✓ operational_costs (base)');

  // Tabelas antigas: CREATE IF NOT EXISTS não acrescenta colunas — o GET lista falha sem deleted_at, etc.
  if (await tableExists(conn, 'operational_costs')) {
    const ocAdd = async (col, ddl) => {
      if (!(await columnExists(conn, 'operational_costs', col))) {
        await tryQuery(
          conn,
          `ALTER TABLE operational_costs ADD COLUMN ${col} ${ddl}`,
          `operational_costs.${col}`,
          verbose
        );
      }
    };
    await ocAdd('subcategory', 'VARCHAR(100) NULL');
    await ocAdd('vendor_id', 'INT NULL');
    await ocAdd('tax_amount', 'DECIMAL(10,2) DEFAULT 0.00');
    await ocAdd('total_amount', 'DECIMAL(10,2) NOT NULL DEFAULT 0.00');
    await ocAdd(
      'payment_method',
      "ENUM('cash','check','credit_card','bank_transfer','ach','other') DEFAULT 'credit_card'"
    );
    await ocAdd('status', "ENUM('pending','paid','recurring') DEFAULT 'pending'");
    await ocAdd('is_recurring', 'TINYINT(1) DEFAULT 0');
    await ocAdd(
      'recurrence_type',
      "ENUM('weekly','biweekly','monthly','quarterly','annual') NULL"
    );
    await ocAdd('recurrence_day', 'INT NULL');
    await ocAdd('recurrence_end_date', 'DATE NULL');
    await ocAdd('receipt_path', 'VARCHAR(500) NULL');
    await ocAdd('receipt_url', 'VARCHAR(500) NULL');
    await ocAdd('notes', 'TEXT NULL');
    await ocAdd('approved_by', 'INT NULL');
    await ocAdd('approved_at', 'TIMESTAMP NULL');
    await ocAdd('created_by', 'INT NULL');
    await ocAdd('deleted_at', 'TIMESTAMP NULL');
    if (verbose) console.log('  ✓ operational_costs (colunas verificadas)');
  }

  if ((await tableExists(conn, 'vendors')) && (await tableExists(conn, 'operational_costs'))) {
    const [[{ c }]] = await conn.query(
      `SELECT COUNT(*) AS c FROM information_schema.TABLE_CONSTRAINTS
       WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'operational_costs' AND CONSTRAINT_NAME = 'fk_op_costs_vendor'`
    );
    if (!Number(c)) {
      await tryQuery(
        conn,
        `ALTER TABLE operational_costs
         ADD CONSTRAINT fk_op_costs_vendor FOREIGN KEY (vendor_id) REFERENCES vendors(id) ON DELETE SET NULL`,
        'FK operational_costs.vendor_id → vendors',
        verbose
      );
    }
  }

  if (await tableExists(conn, 'projects')) {
    await conn.query(`
      CREATE TABLE IF NOT EXISTS payment_receipts (
        id INT AUTO_INCREMENT PRIMARY KEY,
        project_id INT NOT NULL,
        payment_type ENUM('deposit','progress','final','other') NOT NULL,
        amount DECIMAL(12,2) NOT NULL,
        payment_date DATE NOT NULL,
        payment_method ENUM('cash','check','zelle','venmo','credit_card','bank_transfer','other') DEFAULT 'check',
        reference_number VARCHAR(100) NULL,
        notes TEXT NULL,
        receipt_path VARCHAR(500) NULL,
        created_by INT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        KEY idx_payment_receipts_project (project_id),
        KEY idx_payment_receipts_date (payment_date),
        CONSTRAINT fk_payment_receipts_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    if (verbose) console.log('  ✓ payment_receipts');

    await conn.query(`
      CREATE TABLE IF NOT EXISTS project_payment_forecasts (
        id INT AUTO_INCREMENT PRIMARY KEY,
        project_id INT NOT NULL,
        expected_payment_date DATE NOT NULL,
        payment_type ENUM('deposit','progress','final','other') NOT NULL DEFAULT 'progress',
        payment_method ENUM('cash','check','zelle','venmo','credit_card','bank_transfer','other') NOT NULL DEFAULT 'check',
        amount DECIMAL(12,2) NULL,
        notes VARCHAR(500) NULL,
        payment_receipt_id INT NULL,
        created_by INT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        KEY idx_ppf_project (project_id),
        KEY idx_ppf_date (expected_payment_date),
        CONSTRAINT fk_ppf_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    if (verbose) console.log('  ✓ project_payment_forecasts');
  } else if (verbose) {
    console.warn('  ! projects ausente — payment_receipts não criada');
  }

  await conn.query(`
    CREATE TABLE IF NOT EXISTS weekly_forecast (
      id INT AUTO_INCREMENT PRIMARY KEY,
      week_start DATE NOT NULL,
      week_end DATE NOT NULL,
      forecast_type ENUM('payroll','operational','material','marketing') NOT NULL,
      reference_id INT NULL,
      reference_type VARCHAR(50) NULL,
      description VARCHAR(255) NULL,
      amount_projected DECIMAL(10,2) DEFAULT 0.00,
      amount_actual DECIMAL(10,2) DEFAULT 0.00,
      is_confirmed TINYINT(1) DEFAULT 0,
      notes TEXT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY unique_week_ref (week_start, forecast_type, reference_id, reference_type(50)),
      KEY idx_weekly_forecast_week (week_start, week_end)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  if (verbose) console.log('  ✓ weekly_forecast');

  if (await tableExists(conn, 'expenses')) {
    if (!(await columnExists(conn, 'expenses', 'vendor_id'))) {
      await tryQuery(conn, 'ALTER TABLE expenses ADD COLUMN vendor_id INT NULL', 'expenses.vendor_id', verbose);
    }
    if (!(await columnExists(conn, 'expenses', 'vendor_name'))) {
      await tryQuery(conn, 'ALTER TABLE expenses ADD COLUMN vendor_name VARCHAR(255) NULL', 'expenses.vendor_name', verbose);
    }
  }
}
