export async function generateEstimateRefNumber(pool) {
  const year = new Date().getFullYear();
  const prefix = `EST-${year}-`;
  const [last] = await pool.query(
    "SELECT ref_number FROM estimate_requests WHERE ref_number LIKE ? ORDER BY id DESC LIMIT 1",
    [`${prefix}%`]
  );
  let seq = 1;
  if (last.length && last[0].ref_number) {
    const m = String(last[0].ref_number).match(/EST-\d{4}-(\d+)/i);
    if (m) seq = parseInt(m[1], 10) + 1;
  }
  return `${prefix}${String(seq).padStart(4, '0')}`;
}
