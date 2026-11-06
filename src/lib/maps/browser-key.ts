/** The Google Maps JavaScript key the browser uses for address suggestions (null when not set). */
export function googleMapsBrowserKey(): string | null {
  const mapsKey =
    process.env.GOOGLE_MAPS_JS_KEY ||
    process.env.GOOGLE_MAPS_API_KEY ||
    process.env.GOOGLE_PLACES_JS_KEY ||
    process.env.Google_Maps_JS_Key ||
    process.env.GOOGLE_MAPS_KEY ||
    null;
  return mapsKey && String(mapsKey).trim() ? String(mapsKey).trim() : null;
}
