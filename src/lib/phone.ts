/**
 * US phone display / storage: (XXX) XXX-XXXX
 */

/** Digits only; strips leading country code 1 when 11 digits. */
export function phoneDigits(raw: string | null | undefined): string {
  let d = String(raw ?? "").replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("1")) d = d.slice(1);
  return d.slice(0, 10);
}

/** Progressive mask from digits (up to 10). */
export function maskUsPhoneDigits(rawDigits: string): string {
  const d = String(rawDigits || "").replace(/\D/g, "").slice(0, 10);
  if (!d.length) return "";
  if (d.length <= 3) return `(${d}`;
  if (d.length <= 6) return `(${d.slice(0, 3)}) ${d.slice(3)}`;
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

/**
 * Format for display/storage.
 * - 10 US digits (or 11 with leading 1) → (XXX) XXX-XXXX
 * - empty → null
 * - other lengths → trimmed original (keeps international)
 */
export function formatUsPhone(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s || s === "—" || s === "-" || /^n\/?a$/i.test(s)) return null;
  let d = s.replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("1")) d = d.slice(1);
  if (d.length === 10) return maskUsPhoneDigits(d);
  if (d.length > 10) return s;
  if (!d.length) return null;
  return maskUsPhoneDigits(d) || s;
}
