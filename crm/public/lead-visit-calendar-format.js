/**
 * Formato de evento de visita (browser) - manter alinhado com lib/leadVisitCalendarFormat.js
 */
(function (global) {
  'use strict';

  var CALENDAR_DESC_SEPARATOR = '----------------------------------';

  function norm(s) {
    return String(s || '')
      .trim()
      .toLowerCase();
  }

  function isServiceSlugText(text) {
    var t = String(text || '').trim();
    if (!t || t.length < 4) return false;
    if (/\s/.test(t) && t.indexOf('_') === -1) return false;
    return /^[a-z0-9][a-z0-9_&-]*$/i.test(t) && (t.indexOf('_') !== -1 || t.indexOf('&') !== -1);
  }

  function resolveLeadCalendarOriginLabel(lead) {
    if (!lead || typeof lead !== 'object') return '';
    var platform = String(lead.marketing_platform || '').trim();
    if (/^meta$/i.test(platform)) return 'Meta';
    if (/^google$/i.test(platform)) return 'Google';
    if (String(lead.fbclid || '').trim()) return 'Meta';
    var utm = norm(lead.utm_source);
    var src = norm(lead.source);
    var medium = norm(lead.utm_medium);
    if (
      utm.indexOf('facebook') !== -1 ||
      utm.indexOf('instagram') !== -1 ||
      utm === 'fb' ||
      utm.indexOf('meta') !== -1 ||
      medium.indexOf('facebook') !== -1 ||
      src.indexOf('facebook') !== -1 ||
      src.indexOf('instagram') !== -1 ||
      src.indexOf('meta') !== -1
    ) {
      return 'Meta';
    }
    if (String(lead.gclid || '').trim()) return 'Google';
    if (
      utm.indexOf('google') !== -1 ||
      utm === 'adwords' ||
      src.indexOf('google') !== -1 ||
      /^google/i.test(platform)
    ) {
      return 'Google';
    }
    var landing = String(lead.landing_page || '').trim();
    var formType = norm(lead.form_type);
    if (landing) return 'Google';
    if (formType && formType !== 'manual' && formType.indexOf('facebook') === -1 && formType.indexOf('meta') === -1) {
      return 'Google';
    }
    return '';
  }

  function buildLeadVisitSummary(lead) {
    var name = (lead && lead.name ? String(lead.name) : 'Lead').trim() || 'Lead';
    var origin = resolveLeadCalendarOriginLabel(lead);
    return origin ? name + ' - ' + origin : name;
  }

  function buildLeadVisitLocation(lead) {
    if (!lead || typeof lead !== 'object') return '';
    var line1 = String(lead.address_line1 || lead.address || '').trim();
    var line2 = String(lead.address_line2 || '').trim();
    var city = String(lead.city || '').trim();
    var zip = String(lead.zipcode || lead.zip || '').trim();
    var parts = [line1, line2, city, zip].filter(Boolean);
    return parts.length ? parts.join(', ') : line1;
  }

  function buildLeadVisitDescription(lead) {
    var lines = [];
    var name = lead && lead.name ? String(lead.name).trim() : '';
    if (name) lines.push('Cliente: ' + name);
    if (lead && lead.phone) lines.push('Tel: ' + String(lead.phone).trim());
    if (lead && lead.email) lines.push('Email: ' + String(lead.email).trim());
    var address = buildLeadVisitLocation(lead);
    if (address) lines.push('Address: ' + address);
    if (lead && lead.id != null && lead.id !== '') lines.push('Lead #' + String(lead.id));

    var out = lines.join('\n');
    out += '\n\n' + CALENDAR_DESC_SEPARATOR;

    var extra = [];
    var msg = lead && lead.message ? String(lead.message).trim() : '';
    if (msg && !isServiceSlugText(msg)) extra.push(msg);
    var notes = lead && lead.notes ? String(lead.notes).trim() : '';
    if (notes && notes !== msg) extra.push(notes);
    if (extra.length) {
      out += '\n\n' + extra.join('\n\n');
    }

    return out;
  }

  global.sfLeadVisitCalendarFormat = {
    resolveLeadCalendarOriginLabel: resolveLeadCalendarOriginLabel,
    buildLeadVisitSummary: buildLeadVisitSummary,
    buildLeadVisitDescription: buildLeadVisitDescription,
    buildLeadVisitLocation: buildLeadVisitLocation,
    isServiceSlugText: isServiceSlugText,
  };
})(typeof window !== 'undefined' ? window : globalThis);
