/**
 * Ícones de estado do orçamento (e-mail, link, PDF) — Kanban e quick sheet.
 */
(function (global) {
  const SVG = {
    email:
      '<svg class="lead-quote-icon__main" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>',
    view:
      '<svg class="lead-quote-icon__main" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>',
    pdf:
      '<svg class="lead-quote-icon__main" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>',
  };

  const BADGE_OK =
    '<span class="lead-quote-icon__badge lead-quote-icon__badge--ok" aria-hidden="true">' +
    '<svg viewBox="0 0 12 12" fill="none"><circle cx="6" cy="6" r="6" fill="#22c55e"/>' +
    '<path d="M3.5 6.2L5.4 8.1L8.6 4.4" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></span>';

  const BADGE_PENDING =
    '<span class="lead-quote-icon__badge lead-quote-icon__badge--pending" aria-hidden="true">' +
    '<svg viewBox="0 0 12 12" fill="none"><circle cx="6" cy="6" r="6" fill="#ef4444"/>' +
    '<path d="M4.2 4.2l3.6 3.6M7.8 4.2l-3.6 3.6" stroke="#fff" stroke-width="1.5" stroke-linecap="round"/></svg></span>';

  function formatWhen(iso) {
    if (!iso) return '';
    try {
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return '';
      return d.toLocaleString('pt-PT', { dateStyle: 'short', timeStyle: 'short' });
    } catch {
      return '';
    }
  }

  function esc(text, escapeFn) {
    if (typeof escapeFn === 'function') return escapeFn(text);
    return String(text == null ? '' : text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /**
   * @param {object|null} e
   * @param {function} [escapeHtml]
   * @param {object} [opts] — { compact: boolean }
   */
  function renderLeadQuoteEngagementIconsHtml(e, escapeHtml, opts) {
    if (!e) return '';
    const count = Number(e.quote_count) || 0;
    const any =
      count > 0 || e.email_sent || e.viewed || e.pdf_viewed || e.email_sent_at || e.viewed_at || e.pdf_viewed_at;
    if (!any) return '';

    const compact = opts && opts.compact;
    const items = [
      {
        kind: 'email',
        on: !!(e.email_sent || e.email_sent_at),
        at: e.email_sent_at,
        labelOn: 'Orcamento enviado por e-mail',
        labelOff: 'E-mail do orcamento ainda nao enviado',
      },
      {
        kind: 'view',
        on: !!(e.viewed || e.viewed_at),
        at: e.viewed_at,
        labelOn: 'Cliente abriu o link do orcamento',
        labelOff: 'Link do orcamento ainda nao aberto',
      },
      {
        kind: 'pdf',
        on: !!(e.pdf_viewed || e.pdf_viewed_at),
        at: e.pdf_viewed_at,
        labelOn: 'Cliente descarregou o PDF',
        labelOff: 'PDF ainda nao descarregado',
      },
    ];

    const icons = items
      .map((it) => {
        const when = it.on ? formatWhen(it.at) : '';
        const tip = (it.on ? it.labelOn : it.labelOff) + (when ? ` — ${when}` : '');
        const stateCls = it.on ? 'is-on' : 'is-pending';
        const badge = it.on ? BADGE_OK : BADGE_PENDING;
        return `<span class="lead-quote-icon lead-quote-icon--${it.kind} ${stateCls}" title="${esc(tip, escapeHtml)}" aria-label="${esc(tip, escapeHtml)}">${SVG[it.kind]}${badge}</span>`;
      })
      .join('');

    const cls = compact ? 'lead-quote-icons lead-quote-icons--compact' : 'lead-quote-icons';
    return `<div class="${cls}" role="group" aria-label="Estado do orcamento">${icons}</div>`;
  }

  function engagementFromQuoteRow(q) {
    if (!q) return null;
    return {
      quote_count: 1,
      email_sent: !!q.email_sent_at,
      email_sent_at: q.email_sent_at || null,
      viewed: !!q.viewed_at,
      viewed_at: q.viewed_at || null,
      pdf_viewed: !!q.pdf_viewed_at,
      pdf_viewed_at: q.pdf_viewed_at || null,
    };
  }

  global.renderLeadQuoteEngagementIconsHtml = renderLeadQuoteEngagementIconsHtml;
  global.leadQuoteEngagementFromQuote = engagementFromQuoteRow;
})(typeof window !== 'undefined' ? window : globalThis);
