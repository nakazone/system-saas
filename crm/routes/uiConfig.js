/**
 * Non-secret UI hints for authenticated clients (Maps JS key, feature flags).
 */
import { getPublicCrmBaseUrl } from '../lib/publicQuoteUrl.js';

/** Accept common Railway/env aliases (Linux env names are case-sensitive). */
export function resolveGoogleMapsJsKey() {
  const candidates = [
    process.env.GOOGLE_MAPS_JS_KEY,
    process.env.GOOGLE_MAPS_API_KEY,
    process.env.GOOGLE_PLACES_JS_KEY,
    process.env.Google_Maps_JS_Key,
    process.env.GOOGLE_MAPS_KEY,
  ];
  for (const raw of candidates) {
    const key = raw && String(raw).trim();
    if (key) return key;
  }
  return null;
}

export function getUiConfig(req, res) {
  const key = resolveGoogleMapsJsKey();
  res.json({
    success: true,
    data: {
      googleMapsJsKey: key,
      publicCrmUrl: getPublicCrmBaseUrl() || null,
    },
  });
}
