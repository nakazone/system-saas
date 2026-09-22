/**
 * Builder portal ù referral tracker (estimates + leads, status timeline).
 */
(function () {
  const REFERRAL_CTA = 'builder-estimate-request.html?project_type=sf_referral';

  const STATUS_LABELS = {
    pending: 'Submitted',
    reviewing: 'Under review',
    in_review: 'Under review',
    quoted: 'Quote sent',
    won: 'Accepted',
    lost: 'Declined',
    closed: 'Declined',
    new_lead: 'Received',
    new: 'Received',
  };

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function normalizeStatus(s) {
    const k = String(s || 'pending').toLowerCase();
    if (k === 'in_review') return 'reviewing';
    if (k === 'closed') return 'lost';
    return k;
  }

  function statusLabel(s) {
    const n = normalizeStatus(s);
    return STATUS_LABELS[n] || STATUS_LABELS[s] || s || 'Unknown';
  }

  function fmtDate(iso) {
    if (!iso) return '\u2014';
    try {
      return new Date(iso).toLocaleDateString('en-US', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      });
    } catch {
      return String(iso).slice(0, 10);
    }
  }

  function fmtDateTime(iso) {
    if (!iso) return '';
    try {
      return new Date(iso).toLocaleString('en-US', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return String(iso).slice(0, 16).replace('T', ' ');
    }
  }

  function money(n) {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(
      Number(n) || 0
    );
  }

  function badgeClass(st) {
    if (st === 'won') return 'active';
    if (st === 'lost') return 'inactive';
    return 'pending';
  }

  function renderTimeline(events) {
    if (!events || !events.length) {
      return '<p class="bp-muted" style="font-size:12px;margin:0">No status history yet.</p>';
    }
    return `<ul class="bp-ref-timeline">${events
      .map((e, i, arr) => {
        const label = statusLabel(e.status);
        const when = fmtDateTime(e.created_at);
        const arrow = i < arr.length - 1 ? '<span class="bp-ref-timeline__arrow" aria-hidden="true">\u2192</span>' : '';
        return `<li>
            <span class="bp-ref-timeline__status">${escapeHtml(label)}</span>
            <span class="bp-muted">on ${escapeHtml(when)}</span>
            ${e.note ? `<span class="bp-ref-timeline__note">${escapeHtml(e.note)}</span>` : ''}
            ${arrow}
          </li>`;
      })
      .join('')}</ul>`;
  }

  function renderSummary(sum) {
    const el = document.getElementById('refSummary');
    if (!el) return;
    const commNote =
      sum.commission_pct != null
        ? `<p class="bp-muted" style="font-size:12px;margin:8px 0 0">${sum.commission_pct}% referral rate applied to accepted value.</p>`
        : sum.note
          ? `<p class="bp-muted" style="font-size:12px;margin:8px 0 0">${escapeHtml(sum.note)}</p>`
          : '';
    el.innerHTML = `
      <div class="bp-metrics">
        <div class="bp-card bp-metric"><div class="bp-metric__val">${sum.submitted ?? 0}</div><div class="bp-metric__lbl">Referrals submitted</div></div>
        <div class="bp-card bp-metric"><div class="bp-metric__val">${sum.converted ?? 0}</div><div class="bp-metric__lbl">Converted (accepted)</div></div>
        <div class="bp-card bp-metric"><div class="bp-metric__val">${money(sum.value_generated)}</div><div class="bp-metric__lbl">Value generated</div></div>
        <div class="bp-card bp-metric"><div class="bp-metric__val">${money(sum.commission_accrued)}</div><div class="bp-metric__lbl">Commission accrued</div></div>
      </div>${commNote}`;
  }

  function renderTable(items) {
    const host = document.getElementById('refList');
    if (!items.length) {
      host.innerHTML = `<p class="bp-card">No referrals yet. <a href="${REFERRAL_CTA}">Submit a new referral</a> to get started.</p>`;
      return;
    }

    const rows = items
      .map((it, idx) => {
        const ref = it.ref_number || it.title || `#${it.id}`;
        const st = normalizeStatus(it.status);
        const services = it.services_label || (it.services || []).join(', ') || '\u2014';
        const lastUp = fmtDate(it.updated_at || it.created_at);
        const submitted = fmtDate(it.created_at);
        const typeHint = it.type === 'estimate' ? 'Estimate' : 'Lead';
        return `<tr class="bp-ref-row" data-idx="${idx}">
          <td><button type="button" class="bp-ref-expand-btn" data-idx="${idx}" aria-expanded="false" title="Show status history">${escapeHtml(ref)}</button><span class="bp-muted" style="display:block;font-size:10px;margin-top:2px">${escapeHtml(typeHint)}</span></td>
          <td>${escapeHtml(submitted)}</td>
          <td>${escapeHtml(it.address || '\u2014')}</td>
          <td>${escapeHtml(services)}</td>
          <td><span class="bp-badge bp-badge--${badgeClass(st)}">${escapeHtml(statusLabel(it.status))}</span></td>
          <td>${escapeHtml(lastUp)}</td>
          <td>${it.value_amount > 0 ? escapeHtml(money(it.value_amount)) : '\u2014'}</td>
        </tr>
        <tr class="bp-ref-detail-row hidden" id="refDetailRow${idx}">
          <td colspan="7"><div class="bp-ref-detail-inner">
            <p class="bp-ref-detail-title"><strong>Status history</strong></p>
            ${renderTimeline(it.events || [])}
          </div></td>
        </tr>`;
      })
      .join('');

    host.innerHTML = `
      <div class="bp-table-wrap">
        <table class="bp-table bp-ref-table">
          <thead><tr>
            <th>Reference</th>
            <th>Submitted</th>
            <th>Address</th>
            <th>Services</th>
            <th>Status</th>
            <th>Last update</th>
            <th>Value</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;

    host.querySelectorAll('.bp-ref-expand-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = btn.dataset.idx;
        const detail = document.getElementById(`refDetailRow${idx}`);
        if (!detail) return;
        detail.classList.toggle('hidden');
        btn.setAttribute('aria-expanded', detail.classList.contains('hidden') ? 'false' : 'true');
      });
    });
  }

  async function load() {
    const r = await window.builderAuth.fetch('/api/builder-referrals');
    const j = await r.json();
    if (!j.success) throw new Error(j.error || 'Could not load referrals');
    renderSummary(j.summary || {});
    renderTable(j.data || []);
  }

  document.addEventListener('DOMContentLoaded', () => {
    const cta = document.getElementById('btnNewReferral');
    if (cta) cta.setAttribute('href', REFERRAL_CTA);

    const boot = window.builderPortalCommon?.whenPortalReady;
    if (typeof boot === 'function') {
      boot().then((ok) => {
        if (ok) load().catch((e) => alert(e.message || 'Load error'));
      });
    } else if (window.builderAuth?.getToken()) {
      load().catch((e) => alert(e.message || 'Load error'));
    }
  });
})();
