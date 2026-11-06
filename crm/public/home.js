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

  // Mascot entrance only on the first Início of the session. Runs as soon as this script
  // executes (end of <body>), before the first frame of the CSS animation.
  (function markMateSeen() {
    const btn = document.getElementById("homeMate");
    if (!btn) return;
    try {
      if (sessionStorage.getItem("om_home_mate_seen")) btn.classList.add("home-mate--seen");
      else sessionStorage.setItem("om_home_mate_seen", "1");
    } catch (_) {}
  })();

  /** The Mate (fox mascot) next to the greeting: waves in the morning, tablet in the afternoon, laptop at night. */
  function renderMate() {
    const img = $("homeMateImg");
    if (!img || img.dataset.done) return;
    const h = new Date().getHours();
    const pose = h >= 18 || h < 4 ? "laptop" : h >= 12 ? "tablet" : "wave";
    img.src = `/assets/img/mascot/mate-${pose}.webp?v=20261027-m2`;
    img.dataset.done = "1";
    const btn = $("homeMate");
    btn.classList.add("home-mate--" + pose);

    btn.addEventListener("click", () => {
      if (window.MateAI && typeof window.MateAI.open === "function") window.MateAI.open();
    });
  }

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
    renderMate();
    $("homeDate").textContent = D.dateLabel(overview) || " ";
    const av = $("homeAvatar");
    if (av) {
      const avatarUrl = session.user && session.user.avatar_url;
      if (avatarUrl) {
        av.textContent = "";
        av.style.backgroundImage =
          'url("' + String(avatarUrl).replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '")';
        av.style.backgroundSize = "cover";
        av.style.backgroundPosition = "center";
      } else {
        av.style.backgroundImage = "";
        av.textContent = initials(name);
      }
      av.title = name || "Meu perfil";
      if (!av.getAttribute("href") || /configuracoes/i.test(av.getAttribute("href") || "")) {
        av.setAttribute("href", "configuracoes.html#mp-perfil");
      }
    }
  }

  // Remember how many KPI cards / whether "Hoje" showed last time, so the skeleton
  // matches the real layout (mobile grid: 1 wide card + up to 3 small) and nothing jumps.
  const LAYOUT_KEY = "om_home_layout_v1";
  function readLayout() {
    try {
      const v = JSON.parse(sessionStorage.getItem(LAYOUT_KEY) || "null");
      if (v && typeof v.kpis === "number") return v;
    } catch (_) {}
    return { kpis: 4, today: true };
  }
  function saveLayout(kpis, today) {
    try {
      sessionStorage.setItem(LAYOUT_KEY, JSON.stringify({ kpis, today }));
    } catch (_) {}
  }

  function renderSkeletons() {
    const layout = readLayout();
    const kpiHost = $("homeKpis");
    if (kpiHost) {
      const n = Math.max(0, Math.min(4, layout.kpis));
      kpiHost.hidden = n === 0;
      let html = "";
      for (let i = 0; i < n; i++) {
        html += `<div class="home-kpi ${i === 0 ? "home-kpi--dark" : "home-kpi--light"} is-skeleton" aria-hidden="true"></div>`;
      }
      kpiHost.innerHTML = html;
    }
    const todayCard = $("homeTodayCard");
    const todayList = $("homeTodayList");
    if (todayCard && todayList) {
      todayCard.hidden = !layout.today;
      $("homeTodayEmpty").hidden = true;
      todayList.innerHTML =
        window.crmSkeleton && layout.today ? `<li aria-hidden="true">${window.crmSkeleton.rows(2, { avatar: false })}</li>` : "";
    }
    const attnList = $("homeAttnList");
    if (attnList && !attnList.querySelector(".is-skeleton")) {
      attnList.innerHTML = '<li class="home-attn__item is-skeleton"></li><li class="home-attn__item is-skeleton"></li>';
      $("homeAttnEmpty").hidden = true;
    }
  }

  function renderKpis() {
    const host = $("homeKpis");
    const cards = D.kpiCards(overview);
    if (!cards.length) {
      host.hidden = true;
      host.innerHTML = "";
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

  function renderOps() {
    const card = $("homeOpsCard");
    const s = overview.jobs_status;
    if (!s) {
      card.hidden = true;
      return;
    }
    card.hidden = false;
    const v = D.jobsStatusView(s);
    $("homeOpsStats").innerHTML = v.stats
      .map(
        (st) => `<a class="home-stat${st.tone ? ` is-${esc(st.tone)}` : ""}${st.value ? "" : " is-zero"}" href="${esc(st.href)}">
          <span class="home-stat__value">${esc(String(st.value))}</span>
          <span class="home-stat__label">${esc(st.label)}</span>
        </a>`,
      )
      .join("");
    const bill = $("homeOpsBill");
    if (v.bill) {
      bill.hidden = false;
      bill.innerHTML = `<span>A faturar</span><b>${esc(v.bill.value)}</b><small>${esc(v.bill.meta)}</small>`;
    } else {
      bill.hidden = true;
    }
  }

  function renderQuotesWaiting() {
    const card = $("homeQuotesCard");
    const q = overview.quotes_waiting;
    if (!q) {
      card.hidden = true;
      return;
    }
    card.hidden = false;
    const list = $("homeQuotesList");
    $("homeQuotesEmpty").hidden = q.count > 0;
    list.innerHTML = q.items
      .slice(0, 5)
      .map((it) => {
        const v = D.quoteWaitView(it);
        return `<li>
          <a class="home-quote${v.stale ? " is-stale" : ""}" href="${esc(v.href)}">
            <div>
              <p class="home-quote__title">${esc(v.title)}</p>
              <p class="home-quote__sub">${esc(v.sub)}</p>
            </div>
            <div class="home-quote__aside">
              ${v.amount ? `<b>${esc(v.amount)}</b>` : ""}
              <span class="is-${esc(v.seenTone)}">${esc(v.seen)}</span>
            </div>
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
      renderOps();
      renderQuotesWaiting();
      saveLayout(D.kpiCards(overview).length, overview.today_events != null);
    } catch (err) {
      if (err && err.status === 401) {
        location.href = "/login.html";
        return;
      }
      if (err && err.status === 403) return; // field roles: crm-field-gate.js redirects them
      if (!overview) {
        // Nothing to show yet: replace the skeletons with one inline error + retry
        // instead of leaving blank cards.
        $("homeError").hidden = true;
        $("homeKpis").innerHTML = "";
        $("homeKpis").hidden = true;
        $("homeTodayCard").hidden = true;
        const list = $("homeAttnList");
        list.innerHTML = '<li class="home-load-error"></li>';
        if (window.crmSkeleton) {
          window.crmSkeleton.error(list.firstChild, "Não foi possível carregar o Início.", () => {
            renderSkeletons();
            load(true);
          });
        } else {
          list.innerHTML = "";
          $("homeError").hidden = false;
        }
      } else {
        $("homeError").hidden = false;
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
    // The bell lives in the shared mobile top bar (om-mobile-nav.js?v=20261105-mg1); on Início it jumps to the list.
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
    window.__omPullRefresh = () => load(true);
    renderSkeletons();
    load(true);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
