import { bumpLegacyQuoteNumbers, migrateQuoteNumbersQToSf } from './quoteNumber.js';

/** No arranque: bump sequências antigas e migrar prefixo Q -> SF (idempotente). */
export async function ensureQuoteNumberOffset(pool) {
  if (!pool) return;
  try {
    await bumpLegacyQuoteNumbers(pool);
    await migrateQuoteNumbersQToSf(pool);
  } catch (e) {
    console.warn('[db] Não foi possível migrar números de orçamento:', e.code || e.message);
  }
}
