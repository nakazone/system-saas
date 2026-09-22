/**
 * Non-secret UI hints for authenticated clients (Maps JS key, feature flags).
 */
import { getPublicCrmBaseUrl } from '../lib/publicQuoteUrl.js';

export function getUiConfig(req, res) {
  const key =
    process.env.GOOGLE_MAPS_JS_KEY ||
    process.env.GOOGLE_MAPS_API_KEY ||
    process.env.GOOGLE_PLACES_JS_KEY ||
    null;
  res.json({
    success: true,
    data: {
      googleMapsJsKey: key && String(key).trim() ? String(key).trim() : null,
      publicCrmUrl: getPublicCrmBaseUrl() || null,
    },
  });
}
