/**
 * home.html — Início (mobile). Same data and wording as the desktop Dashboard:
 * GET /api/dashboard/overview via om-dashboard.js.
 */
(function () {
  const D = window.OMDash;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => D.esc(s);

  const ATTN_COLLAPSED = 5;
  let session = null;
  let overview = null;
  let loadedAt = 0;
  let expanded = false;

  function can(perm) {
    return D.can(session, perm);
  }

  function initials(name) {
    const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return "—";
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  function newLead() {
    const sheet = window.__omNovoLeadSheet;
    if (sheet && typeof sheet.open === "function") {
      sheet.open({ onCreated: () => load(true) });
      return;
    }
    // Sheet not available (script failed) — let the Leads tab open it.
    try {
      sessionStorage.setItem("obramate_open_new_lead", "1");
    } catch (_) {}
    location.href = "pipeline-lab.html";
  }

  function openSearch() {
    if (window.__crmCommandPalette) window.__crmCommandPalette.open("");
    else if (window.__crmShell && typeof window.__crmShell.openSearch === "function") window.__crmShell.openSearch();
    else location.href = "pipeline-lab.html";
  }

  function renderHeader() {
    const name = (session.user && (session.user.name || session.user.email)) || "";
    $("homeGreeting").textContent = D.greeting(overview, name);
    $("homeDate").textContent = D.dateLabel(overview) || " ";
    const av = $("homeAvatar");
    if (av) {
      av.textContent = initials(name);
      av.title = name || "Conta";
    }
  }

  function renderKpis() {
    const host = $("homeKpis");
    const cards = D.kpiCards(overview);
    if (!cards.length) {
      host.hidden = true;
      return;
    }
    host.hidden = false;
    host.innerHTML = cards
      .map((c, i) => {
        const dark = i === 0;
        const metaTone = c.metaTone === "danger" ? " is-danger" : "";
        return `<a class="home-kpi ${dark ? "home-kpi--dark" : "home-kpi--light"}" href="${esc(c.href)}">
          <p class="home-kpi__label">${esc(c.label)}</p>
          <p class="home-kpi__value">${esc(c.value)}</p>
          <p class="home-kpi__meta${metaTone}">${esc(c.short || c.meta)}</p>
        </a>`;
      })
      .join("");
  }

  function renderAttention() {
    const att = overview.attention || { total: 0, high: 0, items: [] };
    const items = att.items || [];
    const list = $("homeAttnList");
    const empty = $("homeAttnEmpty");
    const count = $("homeAttnCount");
    const more = $("homeAttnMore");
    const bell = $("homeBell");

    count.hidden = !att.total;
    count.textContent = String(att.total);
    count.classList.toggle("is-calm", !att.high);
    if (bell) {
      bell.classList.toggle("has-dot", att.high > 0);
      bell.setAttribute(
        "aria-label",
        att.high ? `${att.high} ${att.high === 1 ? "item urgente" : "itens urgentes"}` : "Precisa da sua atenção",
      );
    }

    if (!items.length) {
      list.innerHTML = "";
      empty.hidden = false;
      more.hidden = true;
      return;
    }
    empty.hidden = true;
    const visible = expanded ? items : items.slice(0, ATTN_COLLAPSED);
    list.innerHTML = visible
      .map((it) => {
        const v = D.attentionView(it, overview);
        const call = v.tel
          ? `<a class="home-attn__call" href="${esc(v.tel)}" aria-label="Ligar para ${esc(it.entity.name)}">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M22 16.9v3a2 2 0 01-2.2 2 19.8 19.8 0 01-8.6-3.1 19.5 19.5 0 01-6-6A19.8 19.8 0 012.1 4.2 2 2 0 014.1 2h3a2 2 0 012 1.7c.1.9.4 1.8.7 2.7a2 2 0 01-.5 2.1L8 9.8a16 16 0 006 6l1.3-1.3a2 2 0 012.1-.4c.9.3 1.8.6 2.7.7a2 2 0 011.7 2z"/></svg>
            </a>`
          : "";
        return `<li class="home-attn__item is-${esc(v.tone)}">
          <span class="home-attn__icon">${v.icon}</span>
          <a class="home-attn__body" href="${esc(v.href)}">
            <p class="home-attn__title">${esc(v.title)}</p>
            <p class="home-attn__sub">${esc(
              v.badge
                ? [v.badge, it.source, it.amount > 0 ? D.moneyCompact(it.amount) : ""].filter(Boolean).join(" · ")
                : v.detail,
            )}</p>
          </a>
          ${call}
        </li>`;
      })
      .join("");
    if (items.length > ATTN_COLLAPSED) {
      more.hidden = false;
      more.textContent = expanded ? "Mostrar menos" : `Ver mais ${items.length - ATTN_COLLAPSED}`;
    } else {
      more.hidden = true;
    }
  }

  function renderToday() {
    const card = $("homeTodayCard");
    const events = overview.today_events;
    if (events == null) {
      card.hidden = true;
      return;
    }
    card.hidden = false;
    const list = $("homeTodayList");
    const empty = $("homeTodayEmpty");
    if (!events.length) {
      list.innerHTML = "";
      empty.hidden = false;
      return;
    }
    empty.hidden = true;
    list.innerHTML = events
      .slice(0, 8)
      .map((ev) => {
        const v = D.eventView(ev, overview);
        return `<li>
          <a class="home-today__item" href="${esc(v.href)}">
            <div>
              <span class="home-today__time">${esc(v.time)}</span>
              <span class="home-today__dur">${esc(v.until)}</span>
            </div>
            <div>
              <p class="home-today__title">${esc(v.title)}</p>
              ${v.sub ? `<p class="home-today__sub">${esc(v.sub)}</p>` : ""}
            </div>
            <span class="home-tag home-tag--${esc(v.tagTone)}">${esc(v.live ? v.status || v.tag : v.tag)}</span>
          </a>
        </li>`;
      })
      .join("");
  }

  function applyPermissions() {
    document.querySelectorAll("[data-home-perm]").forEach((el) => {
      el.hidden = !can(el.getAttribute("data-home-perm"));
    });
  }

  async function load(force) {
    if (!force && Date.now() - loadedAt < 60 * 1000) return;
    const root = $("homeRoot");
    try {
      const [sess, ov] = await Promise.all([session ? Promise.resolve(session) : D.session(), D.load()]);
      if (!sess || !sess.authenticated) {
        location.href = "/login.html";
        return;
      }
      const role = String((sess.user && sess.user.role) || "").toLowerCase();
      if (role === "installer" || role === "crew_lead" || role === "subcontractor") {
        location.replace("/campo/hoje.html");
        return;
      }
      session = sess;
      overview = ov;
      loadedAt = Date.now();
      $("homeError").hidden = true;
      applyPermissions();
      renderHeader();
      renderKpis();
      renderAttention();
      renderToday();
    } catch (err) {
      if (err && err.status === 401) {
        location.href = "/login.html";
        return;
      }
      if (err && err.status === 403) return; // field roles: crm-field-gate.js redirects them
      $("homeError").hidden = false;
      if (!overview) {
        $("homeKpis").innerHTML = "";
        $("homeAttnList").innerHTML = "";
      }
    } finally {
      root.setAttribute("aria-busy", "false");
    }
  }

  function boot() {
    if (!D) return;
    $("homeSearchBtn").addEventListener("click", openSearch);
    $("homeNewLead").addEventListener("click", (e) => {
      e.preventDefault();
      newLead();
    });
    $("homeRetry").addEventListener("click", () => load(true));
    $("homeAttnMore").addEventListener("click", () => {
      expanded = !expanded;
      renderAttention();
    });
    // The bell lives in the shared mobile top bar (om-mobile-nav.js); on Início it jumps to the list.
    document.addEventListener("click", (e) => {
      const bell = e.target && e.target.closest ? e.target.closest("#homeBell") : null;
      if (!bell) return;
      e.preventDefault();
      $("homeAttnCard").scrollIntoView({ behavior: "smooth", block: "start" });
    });
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") load(false);
    });
    setInterval(() => {
      if (overview) renderAttention();
    }, 30 * 1000);
    load(true);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
