/**
 * Sanitize strings for pdf-lib StandardFonts (WinAnsi encoding).
 * Strips replacement chars and unsupported Unicode before drawText.
 */
export function sanitizePdfText(s, maxLen) {
  let t = String(s ?? '')
    .replace(/\uFFFD/g, '')
    .replace(/\uFFFE/g, '')
    .replace(/\uFFFF/g, '')
    .replace(/\u2192/g, '->')
    .replace(/\u2014/g, '-')
    .replace(/\u2013/g, '-')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\u00B7/g, '-')
    .replace(/\u00A0/g, ' ');
  t = t.replace(/[^\x20-\x7E\xA0-\xFF]/g, '');
  if (maxLen != null) t = t.slice(0, maxLen);
  return t;
}
