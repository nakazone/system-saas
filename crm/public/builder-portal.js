(function () {
  const COMPLETED = new Set(['completed', 'closed', 'cancelled']);

  const ACTIVITY_TAGS = {
    project_step: 'Progress',
    project_completed: 'Completed',
    project_status: 'Status',
    checklist: 'Checklist',
    estimate: 'Estimate',
    visit: 'Visit',
    message_sf: 'Message',
    message_builder: 'You',
    photo: 'Photo',
  };

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function fmt$(n) {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(
      Number(n) || 0
    );
  }

  function fmtDate(d) {
    if (!d) return '\u2014';
    try {
      return new Date(`${String(d).slice(0, 10)}T12:00:00`).toLocaleDateString('en-US', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      });
    } catch {
      return String(d).slice(0, 10);
    }
  }

  function managerInitials(name) {
    const parts = String(name || '')
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    if (!parts.length) return 'SF';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  function avatarSrc(url) {
    if (!url) return null;
    const u = String(url).trim();
    if (/^https?:\/\//i.test(u)) return u;
    if (u.startsWith('/')) return u;
    return `/${u.replace(/^\//, '')}`;
  }

  function resolveAccountManager(dashData) {
    if (dashData?.account_manager) return dashData.account_manager;
    return window.builderPortalUser?.account_manager || null;
  }

  function showDashboardError(msg) {
    let el = document.getElementById('dashboardLoadError');
    if (!el) {
      el = document.createElement('div');
      el.id = 'dashboardLoadError';
      el.className = 'bp-alert bp-alert--warn';
      el.style.marginBottom = '1rem';
      const anchor = document.getElementById('docAlert') || document.getElementById('bpPortalHeader');
      anchor?.insertAdjacentElement('afterend', el);
    }
    el.classList.remove('hidden');
    el.innerHTML = `<strong>Could not refresh dashboard.</strong> ${escapeHtml(msg || 'Please reload the page.')}`;
  }

  function renderWelcomeManager(mgr) {
    const wrap = document.getElementById('welcomeManager');
    if (!wrap || !mgr) return;
    wrap.classList.remove('hidden');
    const src = avatarSrc(mgr.avatar_url);
    const initials = escapeHtml(managerInitials(mgr.name));
    const badge =
      window.builderPortalCommon?.sfContactBadgeHtml?.('Senior Floors manager') ||
      '<span class="bp-sf-contact-badge" title="Senior Floors"><img src="/assets/SeniorFloors.png?v=20260529" alt="Senior Floors" width="26" height="26" /></span>';
    const avatarHtml = src
      ? `<img class="bp-welcome__avatar" src="${escapeHtml(src)}" alt="" onerror="this.classList.add('hidden');this.nextElementSibling?.classList.remove('hidden');" /><div class="bp-welcome__avatar bp-welcome__avatar--init hidden" aria-hidden="true">${initials}</div>`
      : `<div class="bp-welcome__avatar bp-welcome__avatar--init" aria-hidden="true">${initials}</div>`;
    wrap.innerHTML = `
      <p class="bp-welcome__manager-head">Your Senior Floors manager</p>
      <div class="bp-welcome__manager-row">
        <div class="bp-welcome__avatar-wrap">${avatarHtml}${badge}</div>
        <div>
          <p class="bp-welcome__mgr-name">${escapeHtml(mgr.name || '')}</p>
          ${mgr.phone ? `<p class="bp-welcome__mgr-meta bp-manager-phone">Tel: <a class="bp-welcome__contact-link" href="tel:${escapeHtml(String(mgr.phone).replace(/\D/g, ''))}">${escapeHtml(mgr.phone)}</a></p>` : ''}
          ${mgr.email ? `<p class="bp-welcome__mgr-meta"><a class="bp-welcome__contact-link" href="mailto:${escapeHtml(mgr.email)}">${escapeHtml(mgr.email)}</a></p>` : ''}
        </div>
      </div>
      <div class="bp-welcome__mgr-actions">
        <a href="builder-messages.html" class="bp-btn-tan" style="text-decoration:none">Send message</a>
      </div>`;
  }

  function renderFirstVisitBanner(isFirst, mgr) {
    const el = document.getElementById('firstVisitBanner');
    if (!el || !isFirst) return;
    el.classList.remove('hidden');
    const mgrLine = mgr?.name
      ? `<strong>${escapeHtml(mgr.name)}</strong> is your dedicated contact.`
      : 'Your dedicated Senior Floors team is ready to help.';
    el.innerHTML = `
      <p><strong>Welcome to your Builder Portal.</strong> Track projects, confirm site access, upload documents, and message us in one place. ${mgrLine}</p>
      <div class="bp-first-visit__actions">
        <button type="button" class="bp-btn-tan" id="btnDismissWelcome">Got it</button>
        <a href="builder-profile.html" class="bp-btn-ghost" style="text-decoration:none">Complete your profile</a>
      </div>`;
    document.getElementById('btnDismissWelcome')?.addEventListener('click', async () => {
      try {
        await window.builderAuth.fetch('/api/builder-dashboard/dismiss-welcome', { method: 'POST' });
      } catch (_) {}
      el.classList.add('hidden');
    });
  }

  async function load() {
    const [dashR, prR] = await Promise.all([
      window.builderAuth.fetch('/api/builder-dashboard'),
      window.builderAuth.fetch('/api/builder-projects'),
    ]);
    const dash = await dashR.json().catch(() => ({}));
    const pj = await prR.json().catch(() => ({}));

    if (!dashR.ok || !dash.success) {
      showDashboardError(dash.error || `Server error (${dashR.status})`);
    } else {
      document.getElementById('dashboardLoadError')?.classList.add('hidden');
    }

    if (dash.success && dash.data) {
      const d = dash.data;
      const mgr = resolveAccountManager(d);
      const m = d.metrics || {};
      document.getElementById('metricActive').textContent = String(m.active_projects ?? 0);
      document.getElementById('metricTotal').textContent = String(m.total_projects ?? 0);
      document.getElementById('metricSqft').textContent = String(Math.round(m.total_sqft_completed || 0));
      document.getElementById('metricValue').textContent = fmt$(m.total_value_completed);
      document.getElementById('metricYear').textContent = String(m.completed_this_year ?? 0);
      const mc = document.getElementById('metricCompleted');
      if (mc) mc.textContent = String(m.completed_projects ?? 0);

      try {
        const ur = await window.builderAuth.fetch('/api/builder-notifications/unread-count');
        const uj = await ur.json();
        if (uj.success) document.getElementById('metricUnread').textContent = String(uj.data.total || 0);
      } catch (_) {}

      const u = window.builderPortalUser || {};
      const name = [u.first_name, u.last_name].filter(Boolean).join(' ');
      const first = u.first_name || name || 'Partner';
      document.getElementById('welcomeTitle').textContent = `Hello, ${first}`;
      const sub = document.getElementById('welcomeSub');
      if (sub) {
        sub.textContent = u.company
          ? `${u.company} \u2014 overview of your projects with Senior Floors.`
          : 'Here is an overview of your projects with Senior Floors.';
      }

      if (mgr) renderWelcomeManager(mgr);
      if (d.is_first_visit) renderFirstVisitBanner(true, mgr);

      if (d.pending_documents > 0) {
        const al = document.getElementById('docAlert');
        al.classList.remove('hidden');
        al.className = 'bp-alert bp-alert--warn';
        al.innerHTML = `<strong>You have ${d.pending_documents} document(s) pending.</strong> <a href="builder-profile.html#documents">Update documents</a>`;
      }

      if (d.next_visit) {
        const nv = document.getElementById('nextVisitCard');
        nv.classList.remove('hidden');
        nv.className = 'bp-card bp-next-visit';
        const kind =
          d.next_visit.kind === 'visit'
            ? 'Confirmed site visit'
            : d.next_visit.kind === 'request'
              ? 'Visit request (pending approval)'
              : 'Upcoming project start';
        const when = d.next_visit.scheduled_at || d.next_visit.start_date;
        nv.innerHTML = `
          <div class="bp-next-visit__label">${escapeHtml(kind)}</div>
          <div class="bp-next-visit__date">${fmtDate(when)}</div>
          <p style="margin:6px 0 0"><strong>${escapeHtml(d.next_visit.project_name || '')}</strong></p>
          <p class="bp-muted" style="margin:4px 0 0">${escapeHtml(d.next_visit.address || '')}</p>
          <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:10px">
            ${d.next_visit.project_id ? `<a href="builder-project.html?id=${d.next_visit.project_id}" class="bp-btn-tan" style="text-decoration:none;font-size:13px">View project</a>` : ''}
            ${d.next_visit.project_id ? `<button type="button" class="bp-btn-ghost" id="btnConfirmAccess" data-pid="${d.next_visit.project_id}" style="font-size:13px">Confirm property access</button>` : ''}
            <a href="builder-calendar.html" class="bp-btn-ghost" style="text-decoration:none;font-size:13px">Calendar</a>
          </div>`;
        document.getElementById('btnConfirmAccess')?.addEventListener('click', async () => {
          const pid = document.getElementById('btnConfirmAccess')?.dataset.pid;
          const r = await window.builderAuth.fetch(`/api/builder-projects/${pid}/confirm-access`, {
            method: 'POST',
          });
          const j = await r.json();
          alert(j.success ? j.message || 'Property access confirmed' : j.error || 'Error');
        });
      }

      const sinceHint = document.getElementById('activitySinceHint');
      if (sinceHint) {
        sinceHint.textContent = d.since_last_seen ? '(since your last visit)' : '';
      }

      const feed = document.getElementById('activityFeed');
      const acts = d.activity || [];
      feed.innerHTML = acts.length
        ? acts
            .map((a) => {
              const tag = ACTIVITY_TAGS[a.type] || 'Update';
              const link = a.href
                ? `<a href="${escapeHtml(a.href)}">${escapeHtml(a.project_name || 'View')}</a>`
                : a.project_id
                  ? `<a href="builder-project.html?id=${a.project_id}">${escapeHtml(a.project_name || 'Project')}</a>`
                  : '';
              return `<div class="bp-activity-item">
            <span class="bp-activity-item__tag">${escapeHtml(tag)}</span>
            <span class="bp-activity-item__time">${fmtDate(a.created_at)}</span>
            <p>${escapeHtml(a.text)}</p>
            ${link}
          </div>`;
            })
            .join('')
        : `<p class="bp-muted">${d.since_last_seen ? 'No new activity since your last visit.' : 'No recent activity yet.'}</p>`;
    } else if (window.builderPortalUser?.account_manager) {
      renderWelcomeManager(window.builderPortalUser.account_manager);
    }

    const el = document.getElementById('projectCards');
    if (!prR.ok || !pj.success) {
      el.innerHTML = `<p class="bp-card">${escapeHtml(pj.error || 'Could not load projects')}</p>`;
      return;
    }

    const all = pj.data || [];
    const projects = all.filter((p) => !COMPLETED.has(String(p.status || '').toLowerCase()));

    if (!projects.length) {
      el.innerHTML =
        '<p class="bp-card">No active projects yet. <a href="builder-estimate-request.html">Request an estimate</a>.</p>';
      return;
    }
    el.innerHTML = projects
      .slice(0, 6)
      .map(
        (p) => `<div class="bp-card bp-proj-card">
          <div>
            <strong>${escapeHtml(p.name || p.project_number || 'Project')}</strong>
            <p class="bp-muted" style="margin:4px 0 0">${escapeHtml(p.address || '')}</p>
            <p class="bp-muted" style="font-size:11px;margin:4px 0 0">Start: ${fmtDate(p.start_date)} \u2014 ${p.total_sqft ? p.total_sqft + ' sqft' : ''}</p>
            <div class="bp-progress-bar" style="margin-top:8px;max-width:220px"><div class="bp-progress-fill" style="width:${Math.min(100, p.completion_percentage || 0)}%"></div></div>
          </div>
          <a href="builder-project.html?id=${p.id}" class="bp-btn-tan" style="text-decoration:none;align-self:center">View details</a>
        </div>`
      )
      .join('');
  }

  document.addEventListener('DOMContentLoaded', () => {
    const boot = window.builderPortalCommon?.whenPortalReady;
    if (typeof boot === 'function') {
      boot()
        .then((ok) => {
          if (ok) return load();
        })
        .catch(console.error);
      return;
    }
    if (window.builderAuth?.getToken()) load().catch(console.error);
  });
})();
