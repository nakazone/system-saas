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

let mapsUsableCache = { at: 0, ok: false, checked: false };

/** Places Web Service probe — false when billing/API missing. Cached 10 min. */
export async function probeGoogleMapsUsable(key) {
  if (!key) return false;
  const now = Date.now();
  if (mapsUsableCache.checked && now - mapsUsableCache.at < 10 * 60 * 1000) {
    return mapsUsableCache.ok;
  }
  let ok = false;
  try {
    const url =
      'https://maps.googleapis.com/maps/api/place/autocomplete/json?input=Austin&key=' +
      encodeURIComponent(key);
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 4000);
    const r = await fetch(url, { signal: ac.signal });
    clearTimeout(t);
    const j = await r.json().catch(() => ({}));
    ok = j.status === 'OK' || j.status === 'ZERO_RESULTS';
  } catch (_) {
    ok = false;
  }
  mapsUsableCache = { at: now, ok, checked: true };
  return ok;
}

export async function buildUiConfigData() {
  const key = resolveGoogleMapsJsKey();
  const usable = key ? await probeGoogleMapsUsable(key) : false;
  return {
    googleMapsJsKey: usable ? key : null,
    googleMapsConfigured: Boolean(key),
    googleMapsUsable: usable,
    publicCrmUrl: getPublicCrmBaseUrl() || null,
  };
}

export async function getUiConfig(req, res) {
  try {
    const data = await buildUiConfigData();
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message || 'UI config error' });
  }
}
