const MARKETING_KEYS = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_content',
  'utm_term',
  'utm_adset',
  'utm_ad',
  'marketing_platform',
  'landing_page',
];

function trimStr(v, max = 255) {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  return s.slice(0, max);
}

/** Normalize POST/body into marketing fields for DB. */
export function extractMarketingFromBody(post) {
  const landing =
    trimStr(post.landing_page || post.landingPage, 2000) ||
    trimStr(post.first_landing_url || post.firstLandingUrl, 2000);
  let platform = trimStr(post.marketing_platform || post.marketingPlatform, 64);
  const utmSource = trimStr(post.utm_source || post.utmSource, 255);
  if (!platform && utmSource) {
    const u = utmSource.toLowerCase();
    if (u.includes('facebook') || u.includes('fb') || u.includes('instagram') || u.includes('meta')) platform = 'Meta';
    else if (u.includes('google') || u === 'adwords' || u.includes('gclid')) platform = 'Google';
  }
  return {
    utm_source: utmSource,
    utm_medium: trimStr(post.utm_medium || post.utmMedium, 255),
    utm_campaign: trimStr(post.utm_campaign || post.utmCampaign, 255),
    utm_content: trimStr(post.utm_content || post.utmContent, 255),
    utm_term: trimStr(post.utm_term || post.utmTerm, 255),
    utm_adset: trimStr(post.utm_adset || post.utmAdset, 255),
    utm_ad: trimStr(post.utm_ad || post.utmAd, 255),
    marketing_platform: platform,
    landing_page: landing,
  };
}

export { MARKETING_KEYS };
