export async function listCategoryMargins(pool) {
  const [rows] = await pool.query(
    'SELECT category, margin_percentage FROM category_margin_defaults ORDER BY category'
  );
  return rows;
}

export async function getCategoryMargin(pool, category) {
  const [rows] = await pool.query(
    'SELECT category, margin_percentage FROM category_margin_defaults WHERE category = ?',
    [category]
  );
  return rows[0] || null;
}

export async function upsertCategoryMargin(pool, category, marginPercentage) {
  await pool.execute(
    `INSERT INTO category_margin_defaults (category, margin_percentage) VALUES (?, ?)
     ON DUPLICATE KEY UPDATE margin_percentage = VALUES(margin_percentage)`,
    [category, marginPercentage]
  );
}
