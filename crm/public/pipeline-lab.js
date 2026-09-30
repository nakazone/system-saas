/**
 * pipeline-lab.html
 *  - Desktop: the Dashboard (KPIs, "Precisa da sua atenção", "Hoje", pipeline preview)
 *    rendered from GET /api/dashboard/overview via om-dashboard.js.
 *  - Phones/tablets: the "Leads" tab (list by stage) — Início lives in home.html.
 */
(function () {
  const D = window.OMDash;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => (D ? D.esc(s) : String(s == null ? "" : s));

  const REFRESH_EVERY_MS = 5 * 60 * 1000;
  const STALE_AFTER_MS = 60 * 1000;
  const ATTENTION_COLLAPSED = 6;

  let session = null;
  let overview = null;
  let loadedAt = 0;
  let attentionExpanded = false;
  let tickTimer = null;

  function isMobileShell() {
    if (window.__omDevice && typeof window.__omDevice.isMobile === "function") return window.__omDevice.isMobile();
    return document.body.classList.contains("om-device-mobile");
  }

  function notify(msg, type) {
    if (typeof window.crmNotify === "function") window.crmNotify(msg, type || "info");
    else if (window.crmToast && typeof window.crmToast.show === "function") window.crmToast.show(msg, { type: type || "info" });
  }

  function can(perm) {
    return D.can(session, perm);
  }

  function openNewLead(onCreated) {
    const sheet = window.__omNovoLeadSheet;
    if (sheet && typeof sheet.open === "function") {
      sheet.open({ onCreated });
      return;
    }
    location.href = "leads.html";
  }

  function openSearch(q) {
    if (window.__crmCommandPalette) window.__crmCommandPalette.open(q || "");
    else if (window.__crmShell && typeof window.__crmShell.openSearch === "function") window.__crmShell.openSearch();
  }

  // ---------------------------------------------------------------------------
  // Desktop dashboard
  // ---------------------------------------------------------------------------

  function renderHeader() {
    const name = (session && session.user && (session.user.name || session.user.email)) || "";
    $("omdGreeting").textContent = D.greeting(overview, name);
    $("omdDate").textContent = D.dateLabel(overview) || " ";
    $("omdSummary").textContent = D.summary(overview) || "Tudo pronto.";
  }

  function renderUpdated() {
    const el = $("omdUpdated");
    if (!el || !loadedAt) return;
    const mins = Math.floor((Date.now() - loadedAt) / 60000);
    el.textContent = mins < 1 ? "Atualizado agora" : `Atualizado há ${mins} min`;
  }

  function renderKpis() {
    const host = $("omdKpis");
    const cards = D.kpiCards(overview);
    if (!cards.length) {
      host.hidden = true;
      return;
    }
    host.hidden = false;
    host.style.gridTemplateColumns = cards.length < 4 ? `repeat(${cards.length}, minmax(0, 1fr))` : "";
    host.innerHTML = cards
      .map((c) => {
        const delta = c.delta ? `<span class="omd-delta is-${esc(c.delta.tone)}">${esc(c.delta.text)}</span>` : "";
        return `<a class="omd-kpi${c.tone === "dark" ? " omd-kpi--dark" : ""}" href="${esc(c.href)}"${
          c.title ? ` title="${esc(c.title)}"` : ""
        }>
          <p class="omd-kpi__label">${esc(c.label)}</p>
          <p class="omd-kpi__value">${esc(c.value)}</p>
          <p class="omd-kpi__meta${c.metaTone ? ` is-${esc(c.metaTone)}` : ""}"><span>${esc(c.meta)}</span>${delta}</p>
        </a>`;
      })
      .join("");
  }

  function attentionRow(it) {
    const v = D.attentionView(it, overview);
    const badge = v.badge ? `<span class="omd-badge is-pulse">${esc(v.badge)}</span>` : "";
    const cta = v.tel
      ? `<a class="omd-btn omd-btn--ghost omd-btn--sm" href="${esc(v.tel)}" title="Ligar para ${esc(it.entity.name)}">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M22 16.9v3a2 2 0 01-2.2 2 19.8 19.8 0 01-8.6-3.1 19.5 19.5 0 01-6-6A19.8 19.8 0 012.1 4.2 2 2 0 014.1 2h3a2 2 0 012 1.7c.1.9.4 1.8.7 2.7a2 2 0 01-.5 2.1L8 9.8a16 16 0 006 6l1.3-1.3a2 2 0 012.1-.4c.9.3 1.8.6 2.7.7a2 2 0 011.7 2z"/></svg>
          Ligar</a>`
      : `<span class="omd-btn omd-btn--ghost omd-btn--sm" aria-hidden="true">${esc(v.cta)}</span>`;
    return `<li class="omd-row is-${esc(v.tone)}">
      <span class="omd-row__icon">${v.icon}</span>
      <div class="omd-row__body">
        <p class="omd-row__title"><a href="${esc(v.href)}">${esc(v.title)}</a></p>
        <p class="omd-row__detail">${esc(v.detail)}</p>
      </div>
      <div class="omd-row__aside">${badge}${cta}</div>
    </li>`;
  }

  function renderAttention() {
    const list = $("omdAttnList");
    const count = $("omdAttnCount");
    const more = $("omdAttnMore");
    const att = overview.attention || { total: 0, high: 0, items: [] };
    const items = att.items || [];

    if (att.total) {
      count.hidden = false;
      count.textContent = att.high ? `${att.high} urgente${att.high === 1 ? "" : "s"} · ${att.total}` : String(att.total);
      count.classList.toggle("is-hot", att.high > 0);
    } else {
      count.hidden = true;
    }

    if (!items.length) {
      list.innerHTML = `<li class="omd-empty">
        <span class="omd-empty__icon"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6L9 17l-5-5"/></svg></span>
        <div><strong>Tudo em dia</strong><p>Nenhum lead esperando contato, follow-up atrasado, quote parado ou invoice vencida.</p></div>
      </li>`;
      more.hidden = true;
      return;
    }

    const visible = attentionExpanded ? items : items.slice(0, ATTENTION_COLLAPSED);
    list.innerHTML = visible.map(attentionRow).join("");
    const hiddenCount = items.length - visible.length;
    if (items.length > ATTENTION_COLLAPSED) {
      more.hidden = false;
      more.textContent = attentionExpanded ? "Mostrar menos" : `Mostrar mais ${hiddenCount}`;
      more.setAttribute("aria-expanded", attentionExpanded ? "true" : "false");
    } else {
      more.hidden = true;
    }
  }

  function renderToday() {
    const card = $("omdTodayCard");
    const list = $("omdTodayList");
    const events = overview.today_events;
    if (events == null) {
      card.hidden = true;
      return;
    }
    card.hidden = false;
    if (!events.length) {
      list.innerHTML = `<li class="omd-empty">
        <span class="omd-empty__icon"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg></span>
        <div><strong>Agenda livre hoje</strong><p>Nenhuma visita ou instalação marcada. <a class="omd-link" href="schedule.html">Agendar visita</a></p></div>
      </li>`;
      return;
    }
    list.innerHTML = events
      .map((ev) => {
        const v = D.eventView(ev, overview);
        const right = v.live
          ? `<span class="omd-live">${esc(v.status || "Em andamento")}</span>`
          : `<span class="omd-tag is-${esc(v.tagTone)}">${esc(v.tag)}</span>`;
        return `<li class="omd-row omd-ev">
          <span class="omd-ev__time"><strong>${esc(v.time)}</strong><span>${esc(v.until)}</span></span>
          <div class="omd-row__body">
            <p class="omd-row__title"><a href="${esc(v.href)}">${esc(v.title)}</a></p>
            ${v.sub ? `<p class="omd-row__detail">${esc(v.sub)}</p>` : ""}
          </div>
          <div class="omd-row__aside">${right}</div>
        </li>`;
      })
      .join("");
  }

  function renderSources() {
    const card = $("omdSourcesCard");
    const list = $("omdSourcesList");
    const rows = overview.sources_30d;
    if (!rows) {
      card.hidden = true;
      return;
    }
    card.hidden = false;
    if (!rows.length) {
      list.innerHTML = '<li class="omd-muted">Nenhum lead nos últimos 30 dias.</li>';
      return;
    }
    const max = Math.max(...rows.map((r) => r.count), 1);
    const total = rows.reduce((s, r) => s + r.count, 0);
    list.innerHTML = rows
      .map((r, i) => {
        const w = Math.max(4, Math.round((r.count / max) * 100));
        const share = Math.round((r.count / total) * 100);
        const opacity = Math.max(0.35, 1 - i * 0.13);
        return `<li class="omd-src" title="${esc(r.source)}: ${r.count} (${share}%)">
          <span class="omd-src__name">${esc(r.source)}</span>
          <span class="omd-src__bar"><i style="width:${w}%;opacity:${opacity}"></i></span>
          <span class="omd-src__count">${r.count}</span>
        </li>`;
      })
      .join("");
  }

  function leadCard(lead, ov) {
    const flag = lead.uncontacted
      ? `<span class="omd-lead__flag${Date.now() - Date.parse(lead.created_at) < 30 * 60000 ? " is-sla" : ""}" title="Sem contato ainda"></span>`
      : "";
    const summary = lead.summary || lead.source || "";
    const value =
      lead.value != null && lead.value > 0
        ? `<span class="omd-lead__value">${esc(D.moneyCompact(lead.value))}</span>`
        : '<span class="omd-lead__value is-empty">Sem valor</span>';
    return `<a class="omd-lead" href="lead-detail.html?id=${encodeURIComponent(lead.id)}">
      ${flag}
      <p class="omd-lead__name">${esc(lead.name)}</p>
      ${summary ? `<p class="omd-lead__sum">${esc(summary)}</p>` : ""}
      <div class="omd-lead__foot">${value}<span class="omd-lead__ago">${esc(D.ago(lead.created_at))}</span></div>
    </a>`;
  }

  function renderPipeline() {
    const card = $("omdPipeCard");
    const board = overview.board;
    if (!board) {
      card.hidden = true;
      return;
    }
    card.hidden = false;
    const open = board.filter((c) => c.slug !== "won");
    const openCount = open.reduce((s, c) => s + c.count, 0);
    const openValue = open.reduce((s, c) => s + c.value, 0);
    $("omdPipeMeta").textContent = `${D.plural(openCount, "lead aberto", "leads abertos")} · ${D.money(openValue)} em negociação`;

    const funnel = $("omdFunnel");
    if (openValue > 0) {
      funnel.hidden = false;
      funnel.setAttribute("role", "img");
      funnel.setAttribute(
        "aria-label",
        "Valor por estágio: " +
          open.map((c) => `${D.stageLabel(c.slug, c.name)} ${D.moneyCompact(c.value)}`).join(", "),
      );
      funnel.innerHTML = open
        .filter((c) => c.value > 0)
        .map(
          (c) =>
            `<i style="flex:${c.value};background:${esc(c.color)}" title="${esc(D.stageLabel(c.slug, c.name))}: ${esc(
              D.money(c.value),
            )}"></i>`,
        )
        .join("");
    } else {
      funnel.hidden = true;
    }

    const canCreate = can("leads.create");
    $("omdBoard").innerHTML = board
      .map((col) => {
        const label = D.stageLabel(col.slug, col.name);
        const cards = col.leads.map((l) => leadCard(l, overview)).join("");
        const more =
          col.count > col.leads.length
            ? `<a class="omd-col__more" href="leads.html">Ver todos os ${col.count} →</a>`
            : "";
        const add = col.slug === "new_lead" && canCreate ? '<button type="button" class="omd-col__add" data-omd-new>+ Adicionar lead</button>' : "";
        return `<section class="omd-col${col.slug === "won" ? " is-closed" : ""}" aria-label="${esc(label)}">
          <header class="omd-col__head">
            <span class="omd-col__dot" style="background:${esc(col.color)}"></span>
            <h3 class="omd-col__name">${esc(label)}</h3>
            <span class="omd-col__count">${col.count}</span>
          </header>
          <p class="omd-col__value">${esc(D.moneyCompact(col.value))}</p>
          ${cards || '<p class="omd-col__empty">Nenhum lead</p>'}
          ${more}${add}
        </section>`;
      })
      .join("");
    $("omdBoard")
      .querySelectorAll("[data-omd-new]")
      .forEach((btn) => btn.addEventListener("click", () => openNewLead(() => refresh(true))));
    updateBoardOverflow();
  }

  /** Narrow windows: fade the clipped edge and show ‹ › so hidden stages are discoverable. */
  function updateBoardOverflow() {
    const wrap = $("omdBoardWrap");
    const nav = $("omdBoardNav");
    if (!wrap || !nav) return;
    const max = wrap.scrollWidth - wrap.clientWidth;
    const overflow = max > 4;
    nav.hidden = !overflow;
    wrap.classList.toggle("fade-left", overflow && wrap.scrollLeft > 4);
    wrap.classList.toggle("fade-right", overflow && wrap.scrollLeft < max - 4);
    const [prev, next] = nav.querySelectorAll("button");
    if (prev) prev.disabled = wrap.scrollLeft <= 4;
    if (next) next.disabled = wrap.scrollLeft >= max - 4;
  }

  function applyPermissions() {
    document.querySelectorAll("[data-omd-perm]").forEach((el) => {
      el.hidden = !can(el.getAttribute("data-omd-perm"));
    });
  }

  function renderAll() {
    renderHeader();
    renderKpis();
    renderAttention();
    renderToday();
    renderSources();
    renderPipeline();
    renderUpdated();
    $("omdRoot").setAttribute("aria-busy", "false");
  }

  function showError(err) {
    const box = $("omdError");
    box.hidden = false;
    $("omdErrorDetail").textContent = err && err.message && !/^HTTP/.test(err.message) ? err.message : "";
    if (!overview) {
      // Replace skeletons so nothing looks "stuck loading".
      $("omdKpis").innerHTML = "";
      $("omdAttnList").innerHTML = "";
      $("omdTodayList").innerHTML = "";
      $("omdSummary").textContent = "Sem conexão com os dados agora.";
      $("omdRoot").setAttribute("aria-busy", "false");
    }
  }

  async function refresh(force) {
    if (!force && Date.now() - loadedAt < STALE_AFTER_MS) return;
    const btn = $("omdRefresh");
    btn.classList.add("is-spinning");
    try {
      const [sess, ov] = await Promise.all([session ? Promise.resolve(session) : D.session(), D.load()]);
      if (!sess || !sess.authenticated) {
        location.href = "/login.html";
        return;
      }
      session = sess;
      overview = ov;
      loadedAt = Date.now();
      $("omdError").hidden = true;
      applyPermissions();
      renderAll();
    } catch (err) {
      if (err && err.status === 401) {
        location.href = "/login.html";
        return;
      }
      // Field roles get 403 here; crm-field-gate.js is already sending them to their own home.
      if (err && err.status === 403) return;
      showError(err);
    } finally {
      btn.classList.remove("is-spinning");
    }
  }

  function setupDock() {
    const dock = $("plabDock");
    const actions = $("omdActions");
    if (!dock || !actions || !("IntersectionObserver" in window)) return;
    dock.classList.add("is-tucked");
    new IntersectionObserver(
      (entries) => {
        const visible = entries.some((e) => e.isIntersecting);
        dock.classList.toggle("is-tucked", visible);
      },
      { rootMargin: "-56px 0px 0px 0px" },
    ).observe(actions);
  }

  function bootDesktop() {
    document.title = "Dashboard | ObraMate";
    $("omdNewLead").addEventListener("click", () => openNewLead(() => refresh(true)));
    $("plabDockNew").addEventListener("click", () => openNewLead(() => refresh(true)));
    $("plabDockSearch").addEventListener("click", () => openSearch());
    $("omdRefresh").addEventListener("click", () => refresh(true));
    $("omdRetry").addEventListener("click", () => refresh(true));
    $("omdAttnMore").addEventListener("click", () => {
      attentionExpanded = !attentionExpanded;
      renderAttention();
    });
    const wrap = $("omdBoardWrap");
    wrap.addEventListener("scroll", updateBoardOverflow, { passive: true });
    window.addEventListener("resize", updateBoardOverflow);
    $("omdBoardNav")
      .querySelectorAll("[data-omd-scroll]")
      .forEach((btn) =>
        btn.addEventListener("click", () => {
          const dir = Number(btn.getAttribute("data-omd-scroll")) || 1;
          wrap.scrollBy({ left: dir * Math.max(220, wrap.clientWidth * 0.7), behavior: "smooth" });
        }),
      );
    setupDock();

    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") refresh(false);
    });
    window.addEventListener("focus", () => refresh(false));
    setInterval(() => {
      if (document.visibilityState === "visible") refresh(true);
    }, REFRESH_EVERY_MS);
    // Keep countdowns ("12 min p/ responder") and "atualizado há" honest between refreshes.
    tickTimer = setInterval(() => {
      if (!overview) return;
      renderAttention();
      renderUpdated();
    }, 30 * 1000);

    refresh(true);
  }

  // ---------------------------------------------------------------------------
  // Mobile "Leads" tab (list by stage)
  // ---------------------------------------------------------------------------

  const SOFT_AVATARS = ["#e9d5ff", "#fce7f3", "#dbeafe", "#d1fae5", "#ffedd5", "#e0e7ff", "#fef3c7"];
  let stages = [];
  let leads = [];
  let mobileStageSlug = "";

  function initials(name) {
    const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return "?";
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  function softColorFor(id) {
    const s = String(id || "0");
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return SOFT_AVATARS[h % SOFT_AVATARS.length];
  }

  function normalizeSlug(raw) {
    if (typeof window.normalizePipelineSlug === "function") return window.normalizePipelineSlug(raw || "");
    return String(raw || "").trim().toLowerCase().replace(/\s+/g, "_");
  }

  function leadSlug(lead) {
    return normalizeSlug(lead.status || lead.pipeline_stage_slug || "");
  }

  function stageLabel(stage) {
    if (typeof window.pipelineStageDisplayName === "function") return window.pipelineStageDisplayName(stage.slug, stage.name);
    return stage.name || stage.slug || "—";
  }

  function summaryOf(lead) {
    const first = String(lead.notes || lead.message || "")
      .split(/\r?\n/)
      .map((s) => s.trim())
      .find((s) => s && !/^CEP:/i.test(s));
    if (first) return first.length > 90 ? first.slice(0, 89) + "…" : first;
    return "";
  }

  function noteSnippet(lead) {
    const note = String(lead.notes || "")
      .split(/\r?\n/)
      .map((s) => s.trim())
      .find((s) => s && !/^CEP:/i.test(s));
    if (!note) return "";
    return note.length > 100 ? note.slice(0, 99) + "…" : note;
  }

  function isTabletShell() {
    if (window.__omDevice && typeof window.__omDevice.isTablet === "function") return window.__omDevice.isTablet();
    return document.body.classList.contains("om-device-tablet");
  }

  function preferredLeadsView() {
    try {
      const v = localStorage.getItem("obramate_leads_view");
      if (v === "kanban" || v === "list") return v;
    } catch (_) {}
    return isTabletShell() ? "kanban" : "list";
  }

  function setPreferredLeadsView(view) {
    try {
      localStorage.setItem("obramate_leads_view", view);
    } catch (_) {}
  }

  function syncMobileViewToggle() {
    const toggle = $("mleadsViewToggle");
    if (!toggle) return;
    // Kanban option is for tablets; phones keep list-only.
    toggle.hidden = !isTabletShell();
    if (!isTabletShell()) return;
    const view = preferredLeadsView();
    toggle.querySelectorAll("[data-mleads-view]").forEach((btn) => {
      const on = btn.getAttribute("data-mleads-view") === view;
      btn.classList.toggle("is-active", on);
      btn.setAttribute("aria-pressed", on ? "true" : "false");
    });
  }

  function bindMobileViewToggle() {
    const toggle = $("mleadsViewToggle");
    if (!toggle || toggle.dataset.bound === "1") return;
    toggle.dataset.bound = "1";
    toggle.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-mleads-view]");
      if (!btn) return;
      const view = btn.getAttribute("data-mleads-view") || "list";
      setPreferredLeadsView(view);
      syncMobileViewToggle();
      if (view === "kanban") {
        location.href = "leads.html";
      }
    });
  }

  function mobileBoardStages() {
    return stages.filter((s) => normalizeSlug(s.slug) !== "lost");
  }

  function mobileFiltered() {
    const q = (($("mleadsSearch") && $("mleadsSearch").value) || "").trim().toLowerCase();
    if (!q) return leads;
    return leads.filter((l) =>
      [l.name, l.email, l.phone, l.notes, l.source].map((x) => String(x || "").toLowerCase()).join(" ").includes(q),
    );
  }

  function renderMobileKpis(ov) {
    const k = (ov && ov.kpis) || {};
    const p = k.pipeline_open;
    const c = k.conversion;
    if (p) {
      $("mleadsKpiPipeline").textContent = D.money(p.value);
      $("mleadsKpiPipelineMeta").innerHTML =
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 17l5-5 5 5"/><path d="M7 10l5-5 5 5"/></svg>' +
        esc(D.plural(p.count, "lead aberto", "leads abertos"));
    }
    if (c) {
      $("mleadsKpiConversion").textContent = c.rate == null ? "—" : `${String(c.rate).replace(".", ",")}%`;
      $("mleadsKpiConversionMeta").textContent = `${c.won} ganhos · ${c.lost} perdidos`;
    }
  }

  function renderMobileChips(rows) {
    const host = $("mleadsChips");
    if (!host) return;
    const cols = mobileBoardStages();
    if (!mobileStageSlug && cols[0]) mobileStageSlug = normalizeSlug(cols[0].slug);
    host.innerHTML = cols
      .map((st) => {
        const slug = normalizeSlug(st.slug);
        const count = rows.filter((l) => leadSlug(l) === slug).length;
        const active = slug === mobileStageSlug;
        return `<button type="button" class="mleads-chip${active ? " is-active" : ""}" data-stage="${esc(slug)}" role="tab" aria-selected="${
          active ? "true" : "false"
        }">
          <span class="mleads-chip__dot" style="background:${esc(st.color || "#a8a29e")}"></span>
          <span>${esc(stageLabel(st))}</span>
          <span class="mleads-chip__count">${count}</span>
        </button>`;
      })
      .join("");
    host.querySelectorAll("[data-stage]").forEach((btn) => {
      btn.addEventListener("click", () => {
        mobileStageSlug = btn.getAttribute("data-stage") || "";
        renderMobileList();
      });
    });
  }

  function renderMobileList() {
    const rows = mobileFiltered();
    renderMobileChips(rows);
    const list = $("mleadsList");
    const empty = $("mleadsEmpty");
    const cols = mobileBoardStages();
    const stage = cols.find((s) => normalizeSlug(s.slug) === mobileStageSlug) || cols[0];
    const slug = stage ? normalizeSlug(stage.slug) : mobileStageSlug;
    const stageRows = rows.filter((l) => leadSlug(l) === slug);
    const stageValue = stageRows.reduce((s, l) => s + (Number(l.estimated_value) || 0), 0);
    const stageColor = (stage && stage.color) || "#a8a29e";
    const label = stage ? stageLabel(stage) : "Leads";

    $("mleadsSectionTitle").textContent = label;
    $("mleadsSectionMeta").textContent = `${D.plural(stageRows.length, "lead", "leads")} · ${D.money(stageValue)}`;

    if (!stageRows.length) {
      list.innerHTML = "";
      empty.hidden = false;
      return;
    }
    empty.hidden = true;
    list.innerHTML = stageRows
      .map((lead) => {
        const val = Number(lead.estimated_value) || 0;
        const src = lead.source ? String(lead.source) : "";
        const note = noteSnippet(lead);
        const sub = note || src || "Lead";
        return `<li class="mleads-card" data-id="${esc(lead.id)}">
          <span class="mleads-card__avatar" style="background:${softColorFor(lead.id)}">${esc(initials(lead.name))}</span>
          <div>
            <p class="mleads-card__name">${esc(lead.name || "Lead")}</p>
            ${note ? `<p class="mleads-card__note">${esc(note)}</p>` : `<p class="mleads-card__sub">${esc(sub)}</p>`}
            <div class="mleads-card__tags">
              <span class="mleads-tag"><span class="mleads-tag__dot" style="background:${esc(stageColor)}"></span>${esc(label)}</span>
              ${src && note ? `<span class="mleads-tag">${esc(src)}</span>` : ""}
            </div>
          </div>
          <div class="mleads-card__right">
            <p class="mleads-card__value">${val > 0 ? esc(D.money(val)) : '<span class="mleads-card__novalue">Sem valor</span>'}</p>
            <p class="mleads-card__ago">${esc(D.ago(lead.created_at))}</p>
          </div>
        </li>`;
      })
      .join("");
    list.querySelectorAll(".mleads-card[data-id]").forEach((el) => {
      el.addEventListener("click", () => {
        location.href = "lead-detail.html?id=" + encodeURIComponent(el.getAttribute("data-id"));
      });
    });
  }

  async function loadMobile() {
    const api = async (url) => {
      const r = await fetch(url, { credentials: "include" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.success === false) {
        const e = new Error(j.error || `HTTP ${r.status}`);
        e.status = r.status;
        throw e;
      }
      return j;
    };
    const [sess, stagesRes, leadsRes, ov] = await Promise.all([
      D.session(),
      api("/api/pipeline-stages").catch(() => ({ data: [] })),
      api("/api/leads?limit=5000&page=1"),
      D.load().catch(() => null),
    ]);
    if (!sess || !sess.authenticated) {
      location.href = "/login.html";
      return;
    }
    session = sess;
    let merged = Array.isArray(stagesRes.data) ? stagesRes.data.slice() : [];
    if (typeof window.mergePipelineStagesForKanban === "function") merged = window.mergePipelineStagesForKanban(merged);
    stages = merged.sort((a, b) => (a.order_num || 0) - (b.order_num || 0));
    leads = Array.isArray(leadsRes.data) ? leadsRes.data : [];
    renderMobileKpis(ov);
    renderMobileList();
  }

  function bootMobile() {
    document.title = "Leads | ObraMate";
    const title = $("plabHeaderTitle");
    if (title) title.textContent = "Leads";
    bindMobileViewToggle();
    syncMobileViewToggle();
    // Tablets that prefer Kanban go straight to the board.
    if (isTabletShell() && preferredLeadsView() === "kanban") {
      location.replace("leads.html");
      return;
    }
    $("mleadsAdd")?.addEventListener("click", () => openNewLead(() => loadMobile().catch(() => {})));
    $("mleadsSearch")?.addEventListener("input", () => {
      clearTimeout($("mleadsSearch")._t);
      $("mleadsSearch")._t = setTimeout(renderMobileList, 180);
    });
    // Hand-offs from other screens (Início search, "Criar → Novo lead" fallback).
    try {
      const q = sessionStorage.getItem("obramate_home_search");
      if (q && $("mleadsSearch")) $("mleadsSearch").value = q;
      sessionStorage.removeItem("obramate_home_search");
      if (sessionStorage.getItem("obramate_open_new_lead") === "1") {
        sessionStorage.removeItem("obramate_open_new_lead");
        setTimeout(() => openNewLead(() => loadMobile().catch(() => {})), 300);
      }
    } catch (_) {}
    loadMobile().catch((e) => {
      if (e && e.status === 401) {
        location.href = "/login.html";
        return;
      }
      notify((e && e.message) || "Falha ao carregar", "error");
    });
  }

  function boot() {
    if (!D) return;
    if (window.__omDevice && window.__omDevice.applyBodyClass) window.__omDevice.applyBodyClass();
    if (isMobileShell()) bootMobile();
    else bootDesktop();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
