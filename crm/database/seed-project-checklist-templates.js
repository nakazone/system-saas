/**
 * Itens padrão do checklist de vistoria — inseridos em `project_checklist` na criação do projeto.
 */
export const CHECKLIST_TEMPLATE = [
  { category: 'Instalação', item: 'Subfloor preparado e nivelado', sort_order: 1 },
  { category: 'Instalação', item: 'Moisture barrier instalado (se aplicável)', sort_order: 2 },
  { category: 'Instalação', item: 'Direção das tábuas conforme projeto', sort_order: 3 },
  { category: 'Instalação', item: 'Expansão nas bordas respeitada (3/4")', sort_order: 4 },
  { category: 'Instalação', item: 'Transições instaladas corretamente', sort_order: 5 },
  { category: 'Instalação', item: 'Rodapés recolocados ou instalados', sort_order: 6 },
  { category: 'Acabamento', item: 'Superfície sem arranhões visíveis', sort_order: 7 },
  { category: 'Acabamento', item: 'Stain/finish uniforme (se hardwood)', sort_order: 8 },
  { category: 'Acabamento', item: 'Brilho/matte conforme especificado', sort_order: 9 },
  { category: 'Acabamento', item: 'Rejuntes preenchidos (se tile)', sort_order: 10 },
  { category: 'Nivelamento', item: 'Piso sem empenamentos visíveis', sort_order: 11 },
  { category: 'Nivelamento', item: 'Juntas sem gaps ou sobreposições', sort_order: 12 },
  { category: 'Limpeza', item: 'Sobras de material retiradas', sort_order: 13 },
  { category: 'Limpeza', item: 'Pó e resíduos removidos', sort_order: 14 },
  { category: 'Limpeza', item: 'Proteção removida das áreas não afetadas', sort_order: 15 },
  { category: 'Documentação', item: 'Fotos do antes e depois tiradas', sort_order: 16 },
  { category: 'Documentação', item: 'Quantidade de material extra registrada', sort_order: 17 },
  { category: 'Documentação', item: 'Notas de garantia entregues ao cliente', sort_order: 18 },
];

/**
 * @param {import('mysql2/promise').Pool|import('mysql2/promise').Connection} conn
 * @param {number} projectId
 */
export async function insertChecklistTemplate(conn, projectId) {
  const [[row]] = await conn.query(
    `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'project_checklist' AND COLUMN_NAME = 'sort_order'`
  );
  const hasSort = Number(row?.c) > 0;
  const vals = CHECKLIST_TEMPLATE.map((t) =>
    hasSort ? [projectId, t.category, t.item, t.sort_order] : [projectId, t.category, t.item]
  );
  if (!vals.length) return;
  if (hasSort) {
    await conn.query(
      `INSERT INTO project_checklist (project_id, category, item, sort_order) VALUES ?`,
      [vals]
    );
  } else {
    await conn.query(`INSERT INTO project_checklist (project_id, category, item) VALUES ?`, [vals]);
  }
}
