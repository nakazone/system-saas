/** Canonical quote number prefix (e.g. SF-2026-0100). Legacy Q- URLs still resolve. */
export const QUOTE_NUMBER_PREFIX = 'SF';

/** First quote sequence number. Legacy numbers below this get +100 on startup. */
export const QUOTE_NUMBER_MIN = 100;

const QUOTE_NUMBER_RE = /^(?:SF|Q)-(\d{4})-(\d+)$/i;

export function parseQuoteNumber(quoteNumber) {
  const m = String(quoteNumber || '').trim().match(QUOTE_NUMBER_RE);
  if (!m) return null;
  return { year: parseInt(m[1], 10), seq: parseInt(m[2], 10) };
}

export function formatQuoteNumber(year, seq) {
  const n = Math.max(QUOTE_NUMBER_MIN, seq);
  return `${QUOTE_NUMBER_PREFIX}-${year}-${String(n).padStart(4, '0')}`;
}

export function canonicalQuoteNumber(quoteNumber) {
  const parsed = parseQuoteNumber(quoteNumber);
  if (!parsed) return null;
  return formatQuoteNumber(parsed.year, parsed.seq);
}

export async function generateNextQuoteNumber(pool) {
  const year = new Date().getFullYear();
  const [last] = await pool.query(
    'SELECT quote_number FROM quotes WHERE quote_number IS NOT NULL ORDER BY id DESC LIMIT 1'
  );
  if (!last.length || !last[0].quote_number) {
    return formatQuoteNumber(year, QUOTE_NUMBER_MIN);
  }
  const parsed = parseQuoteNumber(last[0].quote_number);
  if (!parsed) {
    return formatQuoteNumber(year, QUOTE_NUMBER_MIN);
  }
  return formatQuoteNumber(year, parsed.seq + 1);
}

/** Bump SF/Q-YYYY-0018 to SF-YYYY-0118 (only sequences below QUOTE_NUMBER_MIN). Idempotent. */
export async function bumpLegacyQuoteNumbers(pool) {
  if (!pool) return 0;
  const [rows] = await pool.query(
    `SELECT id, quote_number FROM quotes
     WHERE quote_number IS NOT NULL
       AND quote_number REGEXP '^(SF|Q)-[0-9]{4}-[0-9]+$'
     ORDER BY id ASC`
  );
  const toBump = [];
  for (const row of rows) {
    const parsed = parseQuoteNumber(row.quote_number);
    if (!parsed || parsed.seq >= QUOTE_NUMBER_MIN) continue;
    toBump.push({
      id: row.id,
      from: row.quote_number,
      to: formatQuoteNumber(parsed.year, parsed.seq + QUOTE_NUMBER_MIN),
    });
  }
  if (!toBump.length) return 0;
  for (const item of toBump) {
    await pool.execute('UPDATE quotes SET quote_number = ? WHERE id = ?', [item.to, item.id]);
  }
  console.log(
    `[db] Quote numbers bumped (+${QUOTE_NUMBER_MIN}): ${toBump.length} quote(s), e.g. ${toBump[0].from} -> ${toBump[0].to}`
  );
  return toBump.length;
}

/** Migrate legacy Q-YYYY-NNNN rows to SF-YYYY-NNNN. Idempotent. */
export async function migrateQuoteNumbersQToSf(pool) {
  if (!pool) return 0;
  const [rows] = await pool.query(
    `SELECT id, quote_number FROM quotes
     WHERE quote_number IS NOT NULL
       AND quote_number REGEXP '^Q-[0-9]{4}-[0-9]+$'
     ORDER BY id ASC`
  );
  let count = 0;
  for (const row of rows) {
    const parsed = parseQuoteNumber(row.quote_number);
    if (!parsed) continue;
    const to = formatQuoteNumber(parsed.year, parsed.seq);
    if (to !== row.quote_number) {
      await pool.execute('UPDATE quotes SET quote_number = ? WHERE id = ?', [to, row.id]);
      count++;
    }
  }
  if (count) {
    console.log(`[db] Quote prefix migrated Q -> ${QUOTE_NUMBER_PREFIX}: ${count} quote(s)`);
  }
  return count;
}
