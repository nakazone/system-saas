/**
 * Adiciona construction_payroll_timesheets.daily_rate_override se faltar — idempotente, no arranque.
 * CREATE TABLE IF NOT EXISTS não atualiza tabelas antigas; evita erro em payroll sem migrate manual.
 */
export async function ensurePayrollTimesheetDailyOverrideColumn(pool) {
  if (!pool) return;
  try {
    const [tables] = await pool.query(
      `SELECT COUNT(*) AS c FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'construction_payroll_timesheets'`
    );
    if (!tables[0]?.c) return;

    const [cols] = await pool.query(
      `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'construction_payroll_timesheets'
         AND COLUMN_NAME = 'daily_rate_override'`
    );
    if (cols[0].c > 0) return;

    await pool.query(
      `ALTER TABLE construction_payroll_timesheets
       ADD COLUMN daily_rate_override decimal(12,2) DEFAULT NULL
       COMMENT 'Diária só nesta linha; NULL = usar cadastro do funcionário'`
    );
    console.log(
      '[db] Adicionada coluna construction_payroll_timesheets.daily_rate_override (folha de obra / quadro).'
    );
  } catch (e) {
    console.warn('[db] Não foi possível garantir daily_rate_override em timesheets:', e.code || e.message);
  }
}
