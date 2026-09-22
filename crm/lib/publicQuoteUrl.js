/**
 * URLs públicas de orçamento — https://app.senior-floors.com/SF-2026-001
 */
import { canonicalQuoteNumber, parseQuoteNumber } from './quoteNumber.js';

const QUOTE_NUMBER_PATH_RE = /^(?:SF|Q)-\d{4}-\d+$/i;

export function isPublicQuoteNumberPath(value) {
  return QUOTE_NUMBER_PATH_RE.test(String(value || '').trim());
}

export function normalizeQuoteNumberForUrl(quoteNumber) {
  const qn = String(quoteNumber || '').trim();
  if (!isPublicQuoteNumberPath(qn)) return '';
  return canonicalQuoteNumber(qn) || '';
}

export function getPublicCrmBaseUrl() {
  const raw =
    process.env.PUBLIC_CRM_URL ||
    (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : '') ||
    'https://app.senior-floors.com';
  return String(raw).replace(/\/$/, '');
}

/** @param {string|null|undefined} quoteNumber @param {string} [baseUrl] */
export function buildPublicQuoteUrl(quoteNumber, baseUrl) {
  const qn = normalizeQuoteNumberForUrl(quoteNumber);
  if (!qn) return '';
  const base = String(baseUrl || getPublicCrmBaseUrl()).replace(/\/$/, '');
  if (!base) return '';
  return `${base}/${encodeURIComponent(qn)}`;
}

export { parseQuoteNumber };
