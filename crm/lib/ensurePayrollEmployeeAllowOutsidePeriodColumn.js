/**
 * Adiciona construction_payroll_employees.allow_work_date_outside_period se faltar — idempotente, no arranque.
 * Permite lançar diárias com data de trabalho fora do intervalo Seg–Dom do período (pagamento neste fechamento).
 */
export async function ensurePayrollEmployeeAllowOutsidePeriodColumn(pool) {
  if (!pool) return;
  try {
    const [tables] = await pool.query(
      `SELECT COUNT(*) AS c FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'construction_payroll_employees'`
    );
    if (!tables[0]?.c) return;

    const [cols] = await pool.query(
      `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'construction_payroll_employees'
         AND COLUMN_NAME = 'allow_work_date_outside_period'`
    );
    if (cols[0].c > 0) return;

    await pool.query(
      `ALTER TABLE construction_payroll_employees
       ADD COLUMN allow_work_date_outside_period tinyint(1) NOT NULL DEFAULT 0
       COMMENT '1 = permitir work_date fora do período; paga neste fechamento'`
    );
    console.log(
      '[db] Adicionada coluna construction_payroll_employees.allow_work_date_outside_period (folha).'
    );
  } catch (e) {
    console.warn('[db] Não foi possível garantir allow_work_date_outside_period em employees:', e.code || e.message);
  }
}
