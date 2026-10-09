/**
 * Próximo passo de um lead em uma linha (cartões do funil no computador, iPad e iPhone).
 * Usa só dados que a lista já traz: visita marcada, follow-up, último orçamento, etapa e tempo parado.
 */
(function (global) {
  'use strict';

  const ICONS = {
    cal: '<rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    flag: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
    eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    send: '<path d="M21 3 10 14M21 3l-7 18-4-7-7-4z"/>',
    doc: '<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5M10 13h6M10 17h4"/>',
    check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
    phone:
      '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.8.4 1.6.7 2.3a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.7-1.7a2 2 0 0 1 2.1-.5c.7.3 1.5.6 2.3.7a2 2 0 0 1 1.7 2z"/>',
    sms: '<path d="M4 5h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9l-5 4V6a1 1 0 0 1 1-1z"/>',
    pause: '<path d="M9 5v14M15 5v14"/>',
  };
  function icon(name, size) {
    return `<svg viewBox="0 0 24 24" width="${size || 13}" height="${size || 13}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;
  }

  const DAY = 86400000;
  const WD = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
  const MO = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

  function dayDiff(d) {
    const a = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const n = new Date();
    const b = new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime();
    return Math.round((a - b) / DAY);
  }
  function hhmm(d) {
    const h = d.getHours();
    const m = d.getMinutes();
    return m ? `${h}:${String(m).padStart(2, '0')}` : `${h}h`;
  }
  /** "hoje 14:30", "amanhã 9h", "qui 9h", "12 out" */
  function when(iso, withTime) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const diff = dayDiff(d);
    const t = withTime ? ' ' + hhmm(d) : '';
    if (diff === 0) return 'hoje' + t;
    if (diff === 1) return 'amanhã' + t;
    if (diff === -1) return 'ontem' + t;
    if (diff > 1 && diff < 7) return WD[d.getDay()] + t;
    return `${d.getDate()} ${MO[d.getMonth()]}` + t;
  }
  function daysSince(iso) {
    const d = new Date(iso);
    if (!iso || Number.isNaN(d.getTime())) return null;
    return Math.max(0, -dayDiff(d));
  }
  function slugOf(lead) {
    const raw = lead.status || lead.pipeline_stage_slug || '';
    return typeof global.normalizePipelineSlug === 'function' ? global.normalizePipelineSlug(raw) : String(raw);
  }
  function quoteLabel(q) {
    return q && q.quote_number ? 'Q-' + String(q.quote_number).replace(/^Q-?/i, '') : 'Orçamento';
  }

  /**
   * @param {object} lead  linha de /api/leads
   * @param {object|null} quote  resumo de /api/leads/quote-engagement-summary
   * @param {number|null} daysInStage
   * @returns {{tone:''|'hot'|'ok', icon:string, text:string}}
   */
  function nextStep(lead, quote, daysInStage) {
    const slug = slugOf(lead);
    const now = Date.now();
    if (slug === 'won') return { tone: 'ok', icon: 'check', text: 'Ganho' + (quote ? ' · ' + quoteLabel(quote) : '') };
    if (slug === 'lost') return { tone: '', icon: 'pause', text: lead.loss_reason_name ? 'Perdido · ' + lead.loss_reason_name : 'Perdido' };

    const fuAt = lead.followup_due_at ? new Date(lead.followup_due_at).getTime() : NaN;
    if (!Number.isNaN(fuAt) && fuAt < now) {
      const d = daysSince(lead.followup_due_at);
      return { tone: 'hot', icon: 'flag', text: 'Follow-up atrasado' + (d ? ` · ${d} ${d === 1 ? 'dia' : 'dias'}` : '') };
    }
    if (lead.next_visit_at) return { tone: 'ok', icon: 'cal', text: 'Visita ' + when(lead.next_visit_at, true) };

    if (quote) {
      const st = String(quote.status || 'draft');
      if (st === 'approved' || st === 'accepted' || st === 'converted') return { tone: 'ok', icon: 'check', text: quoteLabel(quote) + ' aprovado' };
      if (st === 'changes_requested') return { tone: 'hot', icon: 'doc', text: 'Pediu alterações no ' + quoteLabel(quote) };
      if (quote.viewed_at) return { tone: '', icon: 'eye', text: 'Visto ' + when(quote.viewed_at, false) };
      if (st === 'sent' || quote.email_sent_at) {
        const d = daysSince(quote.email_sent_at || quote.created_at);
        if (d != null && d >= 3) return { tone: 'hot', icon: 'clock', text: `Não abriu · ${d} dias` };
        return { tone: '', icon: 'send', text: 'Enviado ' + (quote.email_sent_at ? when(quote.email_sent_at, false) : '') };
      }
      if (st === 'draft') return { tone: '', icon: 'doc', text: quoteLabel(quote) + ' em rascunho' };
    }
    if (!Number.isNaN(fuAt)) return { tone: '', icon: 'flag', text: 'Follow-up ' + when(lead.followup_due_at, true) };

    if (slug === 'new_lead') {
      const d = daysSince(lead.created_at);
      if (!lead.last_contacted_at && d != null && d >= 1) return { tone: 'hot', icon: 'clock', text: `Sem contato há ${d} ${d === 1 ? 'dia' : 'dias'}` };
      return { tone: '', icon: 'phone', text: lead.phone ? 'Fazer o primeiro contato' : 'Primeiro contato por e-mail' };
    }
    if (daysInStage != null && daysInStage >= 5) return { tone: 'hot', icon: 'clock', text: `Parado há ${daysInStage} dias` };
    if (slug === 'contacted') return { tone: '', icon: 'cal', text: 'Marcar visita' };
    if (slug === 'meeting_scheduled') return { tone: 'hot', icon: 'cal', text: 'Sem visita marcada' };
    if (slug === 'stand_by') return { tone: '', icon: 'pause', text: 'Em espera' };
    if (slug === 'quote_sent' || slug === 'follow_up_1') return { tone: '', icon: 'flag', text: 'Agendar follow-up' };
    return { tone: '', icon: 'clock', text: daysInStage != null ? `${daysInStage} ${daysInStage === 1 ? 'dia' : 'dias'} na etapa` : '' };
  }

  /** Valor mostrado no cartão: orçamento mais recente, senão o estimado. */
  function value(lead, quote) {
    const q = quote && Number(quote.total);
    if (q && Number.isFinite(q) && q > 0) return { amount: q, sub: quoteLabel(quote) };
    const e = parseFloat(lead.estimated_value);
    if (Number.isFinite(e) && e > 0) return { amount: e, sub: 'estimado' };
    return { amount: null, sub: '' };
  }

  function money(n) {
    if (n == null || !Number.isFinite(Number(n))) return '';
    return '$' + Math.round(Number(n)).toLocaleString('en-US');
  }

  function initials(name) {
    const p = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!p.length) return '?';
    return (p[0][0] + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase();
  }

  function html(sig) {
    if (!sig || !sig.text) return '';
    return `<span class="om-sig${sig.tone ? ' om-sig--' + sig.tone : ''}">${icon(sig.icon)}<span>${String(sig.text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')}</span></span>`;
  }

  global.omLeadSignals = { nextStep, value, money, initials, html, icon, when, daysSince };
})(window);
