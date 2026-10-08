/**
 * Person-name casing: capitalize the first letter of each word.
 * Ex.: "douglas nakazone teotonio" → "Douglas Nakazone Teotonio"
 * Also handles hyphens and apostrophes: "jean-pierre", "o'brien".
 */

/** Title-case a person name. Empty / whitespace → "". */
export function formatPersonName(raw: string | null | undefined): string {
  if (raw == null) return "";
  const s = String(raw).trim().replace(/\s+/g, " ");
  if (!s) return "";
  return s.replace(/[^\s'-]+/gu, (word) => {
    if (!word) return word;
    const first = word.charAt(0).toLocaleUpperCase("en-US");
    const rest = word.slice(1).toLocaleLowerCase("en-US");
    return first + rest;
  });
}

/** Like formatPersonName, but empty → null (optional DB columns). */
export function formatPersonNameNullable(raw: string | null | undefined): string | null {
  const s = formatPersonName(raw);
  return s || null;
}
