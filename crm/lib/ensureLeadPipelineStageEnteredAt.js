/**
 * Adiciona leads.pipeline_stage_entered_at se faltar — idempotente, corre no arranque.
 */
export async function ensureLeadPipelineStageEnteredAt(pool) {
  if (!pool) return;
  try {
    const [rows] = await pool.query(
      `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'leads' AND COLUMN_NAME = 'pipeline_stage_entered_at'`
    );
    if (rows[0].c > 0) return;
    await pool.query(`
      ALTER TABLE leads
      ADD COLUMN pipeline_stage_entered_at DATETIME NULL DEFAULT NULL
        COMMENT 'Quando o lead entrou no estágio atual do pipeline'
        AFTER pipeline_stage_id
    `);
    await pool.query(`
      UPDATE leads
      SET pipeline_stage_entered_at = COALESCE(updated_at, created_at)
      WHERE pipeline_stage_entered_at IS NULL
    `);
    console.log('[db] Adicionada coluna leads.pipeline_stage_entered_at.');
  } catch (e) {
    console.warn('[db] Não foi possível garantir leads.pipeline_stage_entered_at:', e.code || e.message);
  }
}
