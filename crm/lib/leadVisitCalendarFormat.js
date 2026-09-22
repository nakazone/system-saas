/**
 * Formata titulo e descricao de visita para calendario (ICS / Google Calendar).
 * Usar apenas ASCII no separador para evitar "?" em apps de calendario.
 */

export function snapToNextHalfHour(fromDate = new Date()) {
  const d = new Date(fromDate);
  d.setSeconds(0, 0);
  const m = d.getMinutes();
  if (m === 0 || m === 30) return d;
  if (m < 30) d.setMinutes(30);
  else {
    d.setMinutes(0);
    d.setHours(d.getHours() + 1);
  }
  return d;
}

/** Separador ASCII (34 hifens) */
export const CALENDAR_DESC_SEPARATOR = '----------------------------------';

const SERVICE_FIELD_KEYS = new Set([
  'form_type',
  'service_type',
  'main_interest',
  'property_type',
]);

function norm(s) {
  return String(s || '')
    .trim()
    .toLowerCase();
}

export function isServiceSlugText(text) {
  const t = String(text || '').trim();
  if (!t || t.length < 4) return false;
  if (/\s/.test(t) && !t.includes('_')) return false;
  return /^[a-z0-9][a-z0-9_&-]*$/i.test(t) && (t.includes('_') || t.includes('&'));
}

export function resolveLeadCalendarOriginLabel(lead) {
  if (!lead || typeof lead !== 'object') return '';

  const platform = String(lead.marketing_platform || '').trim();
  if (/^meta$/i.test(platform)) return 'Meta';
  if (/^google$/i.test(platform)) return 'Google';

  if (String(lead.fbclid || '').trim()) return 'Meta';

  const utm = norm(lead.utm_source);
  const src = norm(lead.source);
  const medium = norm(lead.utm_medium);

  if (
    utm.includes('facebook') ||
    utm.includes('instagram') ||
    utm === 'fb' ||
    utm.includes('meta') ||
    medium.includes('facebook') ||
    src.includes('facebook') ||
    src.includes('instagram') ||
    src.includes('meta')
  ) {
    return 'Meta';
  }

  if (String(lead.gclid || '').trim()) return 'Google';

  if (
    utm.includes('google') ||
    utm === 'adwords' ||
    src.includes('google') ||
    /^google/i.test(platform)
  ) {
    return 'Google';
  }

  const landing = String(lead.landing_page || '').trim();
  const formType = norm(lead.form_type);
  if (landing) return 'Google';
  if (
    formType &&
    formType !== 'manual' &&
    !formType.includes('facebook') &&
    !formType.includes('meta')
  ) {
    return 'Google';
  }

  return '';
}

export function buildLeadVisitSummary(lead) {
  const name = (lead?.name ? String(lead.name) : 'Lead').trim() || 'Lead';
  const origin = resolveLeadCalendarOriginLabel(lead);
  return origin ? `${name} - ${origin}` : name;
}

export function buildLeadVisitLocation(lead) {
  if (!lead || typeof lead !== 'object') return '';
  const line1 = String(lead.address_line1 || lead.address || '').trim();
  const line2 = String(lead.address_line2 || '').trim();
  const city = String(lead.city || '').trim();
  const zip = String(lead.zipcode || lead.zip || '').trim();
  const parts = [line1, line2, city, zip].filter(Boolean);
  return parts.length ? parts.join(', ') : line1;
}

/**
 * Descricao do evento:
 * Cliente / Tel / Email / Address / Lead #
 * linha em branco
 * ----------------------------------
 * (notas extras abaixo, se houver)
 */
export function buildLeadVisitDescription(lead) {
  const lines = [];

  const name = lead?.name ? String(lead.name).trim() : '';
  if (name) lines.push('Cliente: ' + name);
  if (lead?.phone) lines.push('Tel: ' + String(lead.phone).trim());
  if (lead?.email) lines.push('Email: ' + String(lead.email).trim());
  const address = buildLeadVisitLocation(lead);
  if (address) lines.push('Address: ' + address);
  if (lead?.id != null && lead.id !== '') lines.push('Lead #' + String(lead.id));

  let out = lines.join('\n');
  out += '\n\n' + CALENDAR_DESC_SEPARATOR;

  const extra = [];
  const msg = lead?.message ? String(lead.message).trim() : '';
  if (msg && !isServiceSlugText(msg)) extra.push(msg);
  const notes = lead?.notes ? String(lead.notes).trim() : '';
  if (notes && notes !== msg) extra.push(notes);
  if (extra.length) {
    out += '\n\n' + extra.join('\n\n');
  }

  return out;
}
