(function () {
  const listEl = document.getElementById('calendarList');
  const monthEl = document.getElementById('calendarMonth');
  const modal = document.getElementById('visitModal');
  let lastEvents = [];
  let calView = 'list';
  let calMonth = new Date();

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function fmtWhen(d) {
    if (!d) return '—';
    try {
      return new Date(String(d).replace(' ', 'T')).toLocaleString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      });
    } catch {
      return String(d).slice(0, 16);
    }
  }

  function statusBadge(kind, status) {
    const s = String(status || '').toLowerCase();
    if (kind === 'request') {
      const map = {
        pending: ['pending', 'Pending approval'],
        approved: ['active', 'Approved'],
        declined: ['cancelled', 'Declined'],
        cancelled: ['cancelled', 'Cancelled'],
      };
      const m = map[s] || ['pending', s];
      return `<span class="bp-badge bp-badge--${m[0]}">${escapeHtml(m[1])}</span>`;
    }
    const map = {
      scheduled: ['scheduled', 'Scheduled'],
      confirmed: ['active', 'Confirmed'],
      completed: ['completed', 'Completed'],
      cancelled: ['cancelled', 'Cancelled'],
      no_show: ['cancelled', 'No show'],
    };
    const m = map[s] || ['pending', s || 'Visit'];
    return `<span class="bp-badge bp-badge--${m[0]}">${escapeHtml(m[1])}</span>`;
  }

  function defaultDateRange() {
    const now = new Date();
    const from = new Date(now.getFullYear(), now.getMonth(), 1);
    const to = new Date(now.getFullYear(), now.getMonth() + 2, 0);
    const pad = (n) => String(n).padStart(2, '0');
    const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    return { from: ymd(from), to: ymd(to) };
  }

  async function loadProjectsSelect() {
    const sel = document.getElementById('visitProject');
    if (!sel) return;
    const r = await window.builderAuth.fetch('/api/builder-projects');
    const j = await r.json();
    if (!j.success) return;
    (j.data || []).forEach((p) => {
      const o = document.createElement('option');
      o.value = p.id;
      o.textContent = p.name || p.project_number || `Project #${p.id}`;
      if (p.address) o.textContent += ` — ${p.address}`;
      sel.appendChild(o);
    });
  }

  async function loadCalendar() {
    const from = document.getElementById('filterFrom')?.value;
    const to = document.getElementById('filterTo')?.value;
    const qs = new URLSearchParams();
    if (from) qs.set('date_from', from);
    if (to) qs.set('date_to', to);
    listEl.innerHTML = '<p class="bp-muted">Loading...</p>';
    const r = await window.builderAuth.fetch(`/api/builder-calendar?${qs}`);
    const j = await r.json();
    if (!j.success) {
      listEl.innerHTML = `<p class="bp-card">${escapeHtml(j.error || 'Could not load calendar')}</p>`;
      return;
    }
    const events = j.data || [];
    lastEvents = events;
    if (calView === 'month') renderMonth();
    if (!events.length) {
      listEl.innerHTML =
        '<div class="bp-card"><p class="bp-muted">No visits in this period. Request a visit to schedule with Senior Floors.</p></div>';
      return;
    }
    listEl.innerHTML = events
      .map((ev) => {
        const cancelBtn =
          ev.kind === 'request' && ev.status === 'pending'
            ? `<button type="button" class="bp-btn-ghost bp-cal-cancel" data-id="${ev.id}" style="margin-top:8px;font-size:12px">Cancel request</button>`
            : '';
        const projLink = ev.project_id
          ? `<a href="builder-project.html?id=${ev.project_id}" style="font-size:12px">View project</a>`
          : '';
        return `<article class="bp-card bp-cal-event bp-cal-event--${ev.kind}">
          <div class="bp-cal-event__head">
            <strong>${escapeHtml(ev.title || 'Visit')}</strong>
            ${statusBadge(ev.kind, ev.status)}
          </div>
          <p class="bp-cal-event__when">${escapeHtml(fmtWhen(ev.scheduled_at))}</p>
          <p class="bp-muted" style="margin:4px 0">${escapeHtml(ev.address || '')}</p>
          ${ev.notes ? `<p style="font-size:13px;margin:8px 0 0">${escapeHtml(ev.notes)}</p>` : ''}
          <div style="display:flex;gap:12px;align-items:center;margin-top:8px">${projLink}${cancelBtn}</div>
        </article>`;
      })
      .join('');

    listEl.querySelectorAll('.bp-cal-cancel').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm('Cancel this visit request?')) return;
        await window.builderAuth.fetch(`/api/builder-calendar/requests/${btn.dataset.id}`, {
          method: 'DELETE',
        });
        loadCalendar();
      });
    });
  }

  function renderMonth() {
    if (!monthEl) return;
    const y = calMonth.getFullYear();
    const m = calMonth.getMonth();
    const first = new Date(y, m, 1);
    const startPad = first.getDay();
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    const byDay = {};
    lastEvents.forEach((ev) => {
      const d = String(ev.scheduled_at).slice(0, 10);
      if (!byDay[d]) byDay[d] = [];
      byDay[d].push(ev);
    });
    let cells = '';
    for (let i = 0; i < startPad; i++) cells += '<div class="bp-cal-day bp-cal-day--empty"></div>';
    for (let d = 1; d <= daysInMonth; d++) {
      const ymd = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const evs = byDay[ymd] || [];
      cells += `<div class="bp-cal-day${evs.length ? ' bp-cal-day--has' : ''}"><span class="bp-cal-day__num">${d}</span>${evs
        .map((e) => `<span class="bp-cal-day__ev" title="${escapeHtml(e.title || '')}">${escapeHtml((e.title || 'Visit').slice(0, 12))}</span>`)
        .join('')}</div>`;
    }
    monthEl.innerHTML = `<div class="bp-cal-month-nav">
      <button type="button" class="bp-btn-ghost" id="calPrevMo">&larr;</button>
      <strong>${first.toLocaleString('en-US', { month: 'long', year: 'numeric' })}</strong>
      <button type="button" class="bp-btn-ghost" id="calNextMo">&rarr;</button>
    </div><div class="bp-cal-month-grid">${cells}</div>`;
    document.getElementById('calPrevMo')?.addEventListener('click', () => {
      calMonth = new Date(y, m - 1, 1);
      renderMonth();
    });
    document.getElementById('calNextMo')?.addEventListener('click', () => {
      calMonth = new Date(y, m + 1, 1);
      renderMonth();
    });
  }

  function setCalView(v) {
    calView = v;
    document.getElementById('viewListCal')?.classList.toggle('active', v === 'list');
    document.getElementById('viewMonthCal')?.classList.toggle('active', v === 'month');
    document.getElementById('viewListCal')?.classList.toggle('bp-btn-tan', v === 'list');
    document.getElementById('viewMonthCal')?.classList.toggle('bp-btn-tan', v === 'month');
    listEl?.classList.toggle('hidden', v !== 'list');
    monthEl?.classList.toggle('hidden', v !== 'month');
    if (v === 'month') renderMonth();
    else loadCalendar();
  }

  function openModal() {
    modal?.classList.add('open');
    document.getElementById('visitFormStatus').textContent = '';
  }

  function closeModal() {
    modal?.classList.remove('open');
  }

  document.getElementById('btnNewVisit')?.addEventListener('click', openModal);
  document.getElementById('visitCancel')?.addEventListener('click', closeModal);
  document.getElementById('btnApplyFilter')?.addEventListener('click', loadCalendar);
  document.getElementById('viewListCal')?.addEventListener('click', () => setCalView('list'));
  document.getElementById('viewMonthCal')?.addEventListener('click', () => setCalView('month'));
  document.getElementById('btnExportIcs')?.addEventListener('click', async (e) => {
    e.preventDefault();
    const r = await window.builderAuth.fetch('/api/builder-calendar/export.ics');
    const blob = await r.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'senior-floors-schedule.ics';
    a.click();
  });

  document.getElementById('visitForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const status = document.getElementById('visitFormStatus');
    status.textContent = 'Sending...';
    const projectId = document.getElementById('visitProject')?.value;
    const body = {
      scheduled_at: document.getElementById('visitWhen')?.value,
      address_line1: document.getElementById('visitLine1')?.value,
      city: document.getElementById('visitCity')?.value,
      zipcode: document.getElementById('visitZip')?.value,
      notes: document.getElementById('visitNotes')?.value,
      visit_type: document.getElementById('visitType')?.value,
    };
    if (projectId) body.project_id = parseInt(projectId, 10);
    const r = await window.builderAuth.fetch('/api/builder-calendar/requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const j = await r.json();
    if (!r.ok) {
      status.textContent = j.error || 'Could not submit';
      return;
    }
    closeModal();
    e.target.reset();
    loadCalendar();
  });

  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
      if (!window.builderAuth?.getToken()) {
        location.href = 'builder-login.html';
        return;
      }
      const range = defaultDateRange();
      document.getElementById('filterFrom').value = range.from;
      document.getElementById('filterTo').value = range.to;
      loadProjectsSelect();
      loadCalendar();
    }, 120);
  });
})();
