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

  const WD_PT = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

  function renderJobsForecast() {
    const card = $("omdJobsCard");
    const daysEl = $("omdJobsDays");
    const list = $("omdJobsList");
    if (!card || !daysEl || !list) return;
    const days = overview.jobs_forecast;
    if (days == null) {
      card.hidden = true;
      return;
    }
    card.hidden = false;
    const todayKey = overview.today || "";
    daysEl.innerHTML = days
      .map((d) => {
        const dt = new Date(`${d.date}T12:00:00Z`);
        const wd = WD_PT[dt.getUTCDay()] || "";
        const n = Number(String(d.date).slice(-2));
        const isToday = d.date === todayKey;
        const busy = d.count > 0;
        return `<div class="omd-jobs__day${isToday ? " is-today" : ""}${busy ? " is-busy" : ""}" title="${esc(d.date)}: ${d.count}">
          <span class="omd-jobs__day-wd">${esc(wd)}</span>
          <span class="omd-jobs__day-n">${n}</span>
          <span class="omd-jobs__day-c">${d.count || "·"}</span>
        </div>`;
      })
      .join("");

    const upcoming = [];
    for (const d of days) {
      for (const j of d.jobs || []) upcoming.push({ ...j, date: d.date });
    }
    const show = upcoming.slice(0, 6);
    if (!show.length) {
      list.innerHTML = `<li class="omd-empty">
        <span class="omd-empty__icon"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg></span>
        <div><strong>Sem jobs nos próximos dias</strong><p>Nenhuma instalação agendada nesta semana. <a class="omd-link" href="schedule.html">Abrir agenda</a></p></div>
      </li>`;
      return;
    }
    list.innerHTML = show
      .map((j) => {
        const when = j.date === todayKey ? D.timeOf(j.start, overview) : String(j.date).slice(5).replace("-", "/");
        const sub = [j.person, j.address].filter(Boolean).join(" · ");
        return `<li class="omd-row omd-ev">
          <span class="omd-ev__time"><strong>${esc(when)}</strong><span>${j.date === todayKey ? "hoje" : esc(D.timeOf(j.start, overview))}</span></span>
          <div class="omd-row__body">
            <p class="omd-row__title"><a href="${esc(j.href)}">${esc(j.title)}</a></p>
            ${sub ? `<p class="omd-row__detail">${esc(sub)}</p>` : ""}
          </div>
        </li>`;
      })
      .join("");
  }

  let dayMap = null;
  let dayMapMarkers = [];

  function loadStylesheet(href) {
    if ([...document.querySelectorAll('link[rel="stylesheet"]')].some((l) => (l.getAttribute("href") || "").includes(href.split("?")[0]))) {
      return;
    }
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    document.head.appendChild(link);
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      if ([...document.querySelectorAll("script[src]")].some((s) => s.src === src || (s.getAttribute("src") || "") === src)) {
        resolve();
        return;
      }
      const el = document.createElement("script");
      el.src = src;
      el.async = true;
      el.onload = () => resolve();
      el.onerror = () => reject(new Error(`Falha ao carregar ${src}`));
      document.head.appendChild(el);
    });
  }

  async function ensureLeaflet() {
    loadStylesheet("https://unpkg.com/leaflet@1.9.4/dist/leaflet.css");
    if (!window.L) await loadScript("https://unpkg.com/leaflet@1.9.4/dist/leaflet.js");
    return window.L;
  }

  async function renderDayMap() {
    const card = $("omdMapCard");
    const canvas = $("omdMapCanvas");
    const empty = $("omdMapEmpty");
    const meta = $("omdMapMeta");
    if (!card || !canvas) return;
    const events = overview.today_events;
    if (events == null) {
      card.hidden = true;
      return;
    }
    card.hidden = false;
    const points = (events || []).filter(
      (e) => Number.isFinite(Number(e.lat)) && Number.isFinite(Number(e.lng)),
    );
    const missing = (events || []).filter(
      (e) => e.address && !(Number.isFinite(Number(e.lat)) && Number.isFinite(Number(e.lng))),
    ).length;

    if (!points.length) {
      if (dayMap) {
        try {
          dayMap.remove();
        } catch (_) {}
        dayMap = null;
        dayMapMarkers = [];
      }
      canvas.hidden = true;
      if (empty) {
        empty.hidden = false;
        empty.textContent = events.length
          ? "Jobs de hoje ainda sem coordenadas no mapa."
          : "Nenhum job ou visita na agenda de hoje.";
      }
      if (meta) meta.textContent = missing ? `${missing} sem localização` : "";
      return;
    }

    canvas.hidden = false;
    if (empty) empty.hidden = true;
    if (meta) {
      meta.textContent =
        D.plural(points.length, "ponto", "pontos") + (missing ? ` · ${missing} sem localização` : "");
    }

    try {
      const L = await ensureLeaflet();
      if (!dayMap) {
        dayMap = L.map(canvas, { zoomControl: false, attributionControl: false });
        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
          maxZoom: 19,
        }).addTo(dayMap);
        L.control.zoom({ position: "topright" }).addTo(dayMap);
      }
      dayMapMarkers.forEach((m) => dayMap.removeLayer(m));
      dayMapMarkers = [];
      const bounds = [];
      points.forEach((p, i) => {
        const lat = Number(p.lat);
        const lng = Number(p.lng);
        const icon = L.divIcon({
          className: "",
          html: `<div class="omd-map-pin is-${p.type === "job" ? "job" : "visit"}"><span>${i + 1}</span></div>`,
          iconSize: [28, 28],
          iconAnchor: [14, 28],
        });
        const marker = L.marker([lat, lng], { icon }).addTo(dayMap);
        marker.bindPopup(
          `<strong>${esc(p.title)}</strong><br>${esc(D.timeOf(p.start, overview))}${
            p.address ? `<br>${esc(p.address)}` : ""
          }`,
        );
        dayMapMarkers.push(marker);
        bounds.push([lat, lng]);
      });
      if (bounds.length === 1) dayMap.setView(bounds[0], 12);
      else dayMap.fitBounds(bounds, { padding: [28, 28], maxZoom: 13 });
      setTimeout(() => dayMap && dayMap.invalidateSize(), 80);
    } catch (_) {
      canvas.hidden = true;
      if (empty) {
        empty.hidden = false;
        empty.textContent = "Mapa indisponível no momento.";
      }
      if (meta) meta.textContent = "";
    }
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
    const canEdit = can("leads.edit") || can("pipeline.manage") || (session && session.user && session.user.role === "admin");
    return `<article class="omd-lead${canEdit ? " omd-lead--draggable" : ""}" data-lead-id="${esc(lead.id)}" data-href="lead-detail.html?id=${encodeURIComponent(lead.id)}" tabindex="0" role="link">
      ${flag}
      <p class="omd-lead__name">${esc(lead.name)}</p>
      ${summary ? `<p class="omd-lead__sum">${esc(summary)}</p>` : ""}
      <div class="omd-lead__foot">${value}<span class="omd-lead__ago">${esc(D.ago(lead.created_at))}</span></div>
    </article>`;
  }

  let omdSortables = [];
  let omdSuppressLeadClick = false;

  function destroyOmdSortables() {
    omdSortables.forEach((s) => {
      try {
        s.destroy();
      } catch (_) {}
    });
    omdSortables = [];
  }

  async function moveLeadToStage(leadId, stageSlug) {
    if (typeof window.updateLeadPipelineStage === "function") {
      return window.updateLeadPipelineStage(leadId, stageSlug);
    }
    const id = String(leadId || "").trim();
    const slug = normalizeSlug(stageSlug);
    if (!id || !slug) return false;
    try {
      const r = await fetch(`/api/leads/${encodeURIComponent(id)}`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: slug }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.success === false) {
        notify(j.error || "Não foi possível mover o lead.", "error");
        return false;
      }
      return true;
    } catch (e) {
      notify(e.message || "Não foi possível mover o lead.", "error");
      return false;
    }
  }

  function initOmdSortables() {
    destroyOmdSortables();
    if (typeof Sortable === "undefined") return;
    const board = $("omdBoard");
    if (!board) return;
    if (!can("leads.edit") && !can("pipeline.manage") && !(session && session.user && session.user.role === "admin")) {
      return;
    }

    if (!board.dataset.dndClickGuard) {
      board.dataset.dndClickGuard = "1";
      board.addEventListener(
        "click",
        (e) => {
          if (omdSuppressLeadClick) {
            e.preventDefault();
            e.stopPropagation();
            return;
          }
          const card = e.target.closest(".omd-lead[data-href]");
          if (!card || e.target.closest("button,a")) return;
          const href = card.getAttribute("data-href");
          if (href) location.href = href;
        },
        true,
      );
      board.addEventListener("keydown", (e) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        const card = e.target.closest(".omd-lead[data-href]");
        if (!card) return;
        e.preventDefault();
        const href = card.getAttribute("data-href");
        if (href) location.href = href;
      });
    }

    board.querySelectorAll(".omd-col__cards").forEach((el) => {
      omdSortables.push(
        Sortable.create(el, {
          group: "omd-pipeline",
          animation: 160,
          draggable: ".omd-lead[data-lead-id]",
          filter: "button, a, .omd-col__empty, .omd-col__more, .omd-col__add",
          preventOnFilter: false,
          forceFallback: true,
          fallbackOnBody: true,
          fallbackTolerance: 4,
          emptyInsertThreshold: 40,
          delay: 120,
          delayOnTouchOnly: true,
          touchStartThreshold: 6,
          ghostClass: "omd-lead--ghost",
          chosenClass: "omd-lead--chosen",
          dragClass: "omd-lead--drag",
          onStart() {
            omdSuppressLeadClick = true;
          },
          async onAdd(evt) {
            const card = evt.item;
            const leadId = card && card.getAttribute("data-lead-id");
            const toCol = evt.to && evt.to.closest(".omd-col");
            const fromCol = evt.from && evt.from.closest(".omd-col");
            const toSlug = toCol && toCol.dataset.stageSlug ? String(toCol.dataset.stageSlug) : "";
            const fromSlug = fromCol && fromCol.dataset.stageSlug ? String(fromCol.dataset.stageSlug) : "";
            if (!leadId || !toSlug || toSlug === fromSlug) {
              await refresh(true);
              return;
            }
            const ok = await moveLeadToStage(leadId, toSlug);
            if (!ok) {
              await refresh(true);
              return;
            }
            notify("Lead atualizado no pipeline.", "success");
            await refresh(true);
          },
          onEnd() {
            setTimeout(() => {
              omdSuppressLeadClick = false;
            }, 50);
          },
        }),
      );
    });
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
    destroyOmdSortables();
    $("omdBoard").innerHTML = board
      .map((col) => {
        const label = D.stageLabel(col.slug, col.name);
        const cards = col.leads.map((l) => leadCard(l, overview)).join("");
        const more =
          col.count > col.leads.length
            ? `<a class="omd-col__more" href="leads.html">Ver todos os ${col.count} →</a>`
            : "";
        const add = col.slug === "new_lead" && canCreate ? '<button type="button" class="omd-col__add" data-omd-new>+ Adicionar lead</button>' : "";
        return `<section class="omd-col${col.slug === "won" ? " is-closed" : ""}" data-stage-slug="${esc(col.slug)}" aria-label="${esc(label)}">
          <header class="omd-col__head">
            <span class="omd-col__dot" style="background:${esc(col.color)}"></span>
            <h3 class="omd-col__name">${esc(label)}</h3>
            <span class="omd-col__count">${col.count}</span>
          </header>
          <p class="omd-col__value">${esc(D.moneyCompact(col.value))}</p>
          <div class="omd-col__cards" data-stage-slug="${esc(col.slug)}">
            ${cards || '<p class="omd-col__empty">Nenhum lead</p>'}
          </div>
          ${more}${add}
        </section>`;
      })
      .join("");
    $("omdBoard")
      .querySelectorAll("[data-omd-new]")
      .forEach((btn) => btn.addEventListener("click", () => openNewLead(() => refresh(true))));
    initOmdSortables();
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
    renderJobsForecast();
    renderDayMap();
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
  let mleadsSwipeBound = false;
  const MLEADS_BTN_W = 76;

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

  function leadForStageMessages(lead, stage) {
    if (!lead || !stage || !stage.slug) return lead;
    const slug = normalizeSlug(stage.slug);
    return Object.assign({}, lead, {
      pipeline_stage_slug: slug,
      status: slug,
    });
  }

  function telHref(phone) {
    if (typeof window.sfBuildTelHref === "function") return window.sfBuildTelHref(phone) || "";
    const d = String(phone || "").replace(/\D/g, "");
    return d ? `tel:${d}` : "";
  }

  function canDeleteLead() {
    return can("leads.delete") || can("leads.edit") || (session && session.user && session.user.role === "admin");
  }

  function nextStageFor(lead) {
    const cols = mobileBoardStages();
    const cur = leadSlug(lead);
    const idx = cols.findIndex((s) => normalizeSlug(s.slug) === cur);
    if (idx < 0 || idx >= cols.length - 1) return null;
    return cols[idx + 1];
  }

  async function deleteLeadById(id) {
    if (!id) return;
    if (!confirm("Excluir este lead permanentemente? Esta ação não pode ser desfeita.")) return;
    try {
      const r = await fetch(`/api/leads/${encodeURIComponent(id)}`, {
        method: "DELETE",
        credentials: "include",
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.success === false) throw new Error(j.error || `HTTP ${r.status}`);
      notify("Lead excluído.", "success");
      leads = leads.filter((l) => String(l.id) !== String(id));
      renderMobileList();
    } catch (e) {
      notify(e.message || "Não foi possível excluir.", "error");
    }
  }

  async function advanceLeadById(id) {
    const lead = leads.find((l) => String(l.id) === String(id));
    if (!lead) return;
    const next = nextStageFor(lead);
    if (!next) {
      notify("Já está no último estágio do pipeline.", "info");
      return;
    }
    try {
      const r = await fetch(`/api/leads/${encodeURIComponent(id)}`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next.slug }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.success === false) throw new Error(j.error || `HTTP ${r.status}`);
      const updated = j.data || {};
      lead.status = updated.status || next.slug;
      lead.pipeline_stage_slug = updated.pipeline_stage_slug || next.slug;
      if (updated.pipeline_stage_id) lead.pipeline_stage_id = updated.pipeline_stage_id;
      mobileStageSlug = normalizeSlug(next.slug);
      notify(`Movido para ${stageLabel(next)}`, "success");
      renderMobileList();
    } catch (e) {
      notify(e.message || "Não foi possível avançar.", "error");
    }
  }

  function mleadsSwipeRight(card) {
    const n = card ? card.querySelectorAll(".mleads-swipe__slot--left .mleads-swipe__btn").length : 0;
    return Math.max(MLEADS_BTN_W, n * MLEADS_BTN_W);
  }
  function mleadsSwipeLeft(card) {
    const n = card ? card.querySelectorAll(".mleads-swipe__slot--right .mleads-swipe__btn").length : 0;
    return n ? -(n * MLEADS_BTN_W) : -MLEADS_BTN_W;
  }

  function bindMleadsSwipe(list) {
    if (!list) return;
    if (!mleadsSwipeBound) {
      mleadsSwipeBound = true;
      let active = null;
      let startX = 0;
      let startY = 0;
      let dragging = false;
      let axis = null;
      let skipClick = false;

      const bodyOf = (card) => card && card.querySelector(".mleads-swipe__body");
      const setOffset = (card, x) => {
        const body = bodyOf(card);
        if (!body) return;
        if (!x) {
          body.style.transform = "";
          card.classList.remove("mleads-swipe--open-left", "mleads-swipe--open-right");
          return;
        }
        body.style.transform = `translateX(${x}px)`;
        card.classList.toggle("mleads-swipe--open-right", x > 40);
        card.classList.toggle("mleads-swipe--open-left", x < -40);
      };
      const closeAll = (except) => {
        list.querySelectorAll(".mleads-swipe").forEach((c) => {
          if (c !== except) setOffset(c, 0);
        });
      };

      list.addEventListener(
        "pointerdown",
        (e) => {
          const card = e.target.closest(".mleads-swipe");
          if (!card || e.target.closest("button,a")) return;
          active = card;
          startX = e.clientX;
          startY = e.clientY;
          dragging = false;
          axis = null;
          skipClick = false;
          const body = bodyOf(card);
          if (body) body.style.transition = "none";
        },
        { passive: true },
      );

      list.addEventListener(
        "pointermove",
        (e) => {
          if (!active) return;
          const dx = e.clientX - startX;
          const dy = e.clientY - startY;
          if (!axis) {
            if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
            axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
          }
          if (axis !== "x") return;
          dragging = true;
          skipClick = true;
          let next = dx;
          const maxR = mleadsSwipeRight(active) + 20;
          const maxL = mleadsSwipeLeft(active) - 20;
          if (next > maxR) next = maxR;
          if (next < maxL) next = maxL;
          setOffset(active, next);
        },
        { passive: true },
      );

      const endDrag = () => {
        if (!active) return;
        const card = active;
        const body = bodyOf(card);
        active = null;
        if (body) body.style.transition = "";
        if (!dragging || axis !== "x") {
          dragging = false;
          axis = null;
          return;
        }
        dragging = false;
        axis = null;
        const style = body && body.style.transform ? body.style.transform : "";
        const m = /translateX\((-?\d+(?:\.\d+)?)px\)/.exec(style);
        const x = m ? parseFloat(m[1]) : 0;
        closeAll(card);
        if (x >= 56) setOffset(card, mleadsSwipeRight(card));
        else if (x <= -56) setOffset(card, mleadsSwipeLeft(card));
        else setOffset(card, 0);
        try {
          if (Math.abs(x) >= 56) navigator.vibrate(8);
        } catch (_) {}
      };

      list.addEventListener("pointerup", endDrag, { passive: true });
      list.addEventListener("pointercancel", endDrag, { passive: true });

      list.addEventListener("click", (e) => {
        const del = e.target.closest("[data-mleads-delete]");
        if (del) {
          e.preventDefault();
          e.stopPropagation();
          void deleteLeadById(del.getAttribute("data-mleads-delete"));
          return;
        }
        const sms = e.target.closest("[data-mleads-sms]");
        if (sms) {
          e.preventDefault();
          e.stopPropagation();
          if (sms.disabled) {
            notify("Este lead não tem telefone.", "error");
            return;
          }
          const id = sms.getAttribute("data-mleads-sms");
          const lead = leads.find((l) => String(l.id) === String(id));
          if (!lead) return;
          const card = sms.closest(".mleads-swipe");
          if (card) setOffset(card, 0);
          const stage = mobileBoardStages().find((s) => normalizeSlug(s.slug) === mobileStageSlug);
          const msgLead = leadForStageMessages(lead, stage);
          if (typeof window.sfOpenSmsChoiceMenu === "function") void window.sfOpenSmsChoiceMenu(sms, msgLead);
          else if (typeof window.sfBuildLeadSmsHref === "function") {
            const href = window.sfBuildLeadSmsHref(msgLead);
            if (href) location.href = href;
            else notify("Nenhuma mensagem SMS disponível.", "error");
          }
          return;
        }
        const email = e.target.closest("[data-mleads-email]");
        if (email) {
          e.preventDefault();
          e.stopPropagation();
          if (email.disabled) {
            notify("Este lead não tem e-mail.", "error");
            return;
          }
          const id = email.getAttribute("data-mleads-email");
          const lead = leads.find((l) => String(l.id) === String(id));
          if (!lead) return;
          const card = email.closest(".mleads-swipe");
          if (card) setOffset(card, 0);
          const stage = mobileBoardStages().find((s) => normalizeSlug(s.slug) === mobileStageSlug);
          const msgLead = leadForStageMessages(lead, stage);
          if (typeof window.sfOpenEmailChoiceMenu === "function") void window.sfOpenEmailChoiceMenu(email, msgLead);
          else if (typeof window.sfBuildLeadMailtoHref === "function") {
            const href = window.sfBuildLeadMailtoHref(msgLead);
            if (href) location.href = href;
            else notify("Nenhuma mensagem de e-mail disponível.", "error");
          }
          return;
        }
        const call = e.target.closest("[data-mleads-call]");
        if (call) {
          e.preventDefault();
          e.stopPropagation();
          const id = call.getAttribute("data-mleads-call");
          const lead = leads.find((l) => String(l.id) === String(id));
          const href = lead ? telHref(lead.phone) : "";
          if (href) location.href = href;
          else notify("Este lead não tem telefone.", "error");
          return;
        }
        const adv = e.target.closest("[data-mleads-advance]");
        if (adv) {
          e.preventDefault();
          e.stopPropagation();
          void advanceLeadById(adv.getAttribute("data-mleads-advance"));
          return;
        }
        if (skipClick) {
          skipClick = false;
          return;
        }
        const openEl = e.target.closest("[data-mleads-open]");
        if (!openEl) return;
        const card = openEl.closest(".mleads-swipe");
        if (card && (card.classList.contains("mleads-swipe--open-left") || card.classList.contains("mleads-swipe--open-right"))) {
          setOffset(card, 0);
          return;
        }
        const id = openEl.getAttribute("data-mleads-open");
        if (!id) return;
        location.href = "lead-detail.html?id=" + encodeURIComponent(id);
      });
    }
  }

  function isTabletShell() {
    if (window.__omDevice && typeof window.__omDevice.isTablet === "function") return window.__omDevice.isTablet();
    return document.body.classList.contains("om-device-tablet");
  }

  function urlLeadsView() {
    try {
      const v = new URLSearchParams(location.search).get("view");
      if (v === "list" || v === "kanban") return v;
    } catch (_) {}
    return null;
  }

  function preferredLeadsView() {
    const fromUrl = urlLeadsView();
    if (fromUrl) return fromUrl;
    try {
      const v = localStorage.getItem("obramate_leads_view");
      if (v === "kanban" || v === "list") return v;
    } catch (_) {}
    return isTabletShell() ? "kanban" : "list";
  }

  /** Phones always use the Leads list; tablets only with explicit ?view=list (Lista toggle). */
  function wantsLeadsListShell() {
    if (isMobileShell()) return true;
    if (!isTabletShell()) return false;
    // Do not use localStorage alone — pipeline-lab is also the tablet dashboard home.
    return urlLeadsView() === "list";
  }

  function setPreferredLeadsView(view) {
    try {
      localStorage.setItem("obramate_leads_view", view);
    } catch (_) {}
  }

  function syncMobileViewToggle() {
    const toggle = $("mleadsViewToggle");
    if (!toggle) return;
    // Show Lista/Kanban for tablets (and large touch devices classified as tablet).
    const show = isTabletShell();
    toggle.hidden = !show;
    if (!show) return;
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
      e.preventDefault();
      const view = btn.getAttribute("data-mleads-view") || "list";
      setPreferredLeadsView(view);
      syncMobileViewToggle();
      if (view === "kanban") {
        location.assign("leads.html?view=kanban");
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
    const board = (ov && ov.board) || [];
    const openCols = board.filter((c) => {
      const s = normalizeSlug(c.slug);
      return s !== "won" && s !== "lost";
    });
    const openValue = openCols.reduce((s, c) => s + (Number(c.value) || 0), 0);
    const openCount = openCols.reduce((s, c) => s + (Number(c.count) || 0), 0);
    const pipeEl = $("mleadsKpiPipeline");
    const pipeMeta = $("mleadsKpiPipelineMeta");
    if (pipeEl) pipeEl.textContent = D.money(openValue);
    if (pipeMeta) {
      pipeMeta.innerHTML =
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 17l5-5 5 5"/><path d="M7 10l5-5 5 5"/></svg>' +
        esc(D.plural(openCount, "lead aberto", "leads abertos"));
    }
    const c = ov && ov.kpis && ov.kpis.conversion;
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
    if (typeof window.sfLoadLeadMessageSettings === "function") {
      void window.sfLoadLeadMessageSettings();
    }
    const canDel = canDeleteLead();
    const deleteIcon =
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/></svg>';
    const smsIcon =
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
    const emailIcon =
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h16v16H4z"/><path d="M22 6l-10 7L2 6"/></svg>';
    const callIcon =
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.8 19.8 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.81.36 1.6.68 2.34a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.74-1.74a2 2 0 0 1 2.11-.45c.74.32 1.53.55 2.34.68A2 2 0 0 1 22 16.92z"/></svg>';
    const advanceIcon =
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14"/><path d="M13 5l7 7-7 7"/></svg>';

    list.innerHTML = stageRows
      .map((lead) => {
        const id = esc(lead.id);
        const val = Number(lead.estimated_value) || 0;
        const src = lead.source ? String(lead.source) : "";
        const note = noteSnippet(lead);
        const sub = note || src || "Lead";
        const hasPhone = Boolean(telHref(lead.phone));
        const hasEmail = Boolean(lead.email && String(lead.email).includes("@"));
        const hasNext = Boolean(nextStageFor(lead));
        const left = [];
        if (canDel) {
          left.push(
            `<button type="button" class="mleads-swipe__btn mleads-swipe__btn--delete" data-mleads-delete="${id}">${deleteIcon}<span>Excluir</span></button>`,
          );
        }
        left.push(
          `<button type="button" class="mleads-swipe__btn mleads-swipe__btn--sms" data-mleads-sms="${id}" data-sf-sms-picker-btn aria-haspopup="menu" ${hasPhone ? "" : "disabled"}>${smsIcon}<span>SMS</span></button>`,
        );
        if (hasEmail) {
          left.push(
            `<button type="button" class="mleads-swipe__btn mleads-swipe__btn--email" data-mleads-email="${id}" data-sf-email-picker-btn aria-haspopup="menu">${emailIcon}<span>Email</span></button>`,
          );
        }
        left.push(
          `<button type="button" class="mleads-swipe__btn mleads-swipe__btn--call" data-mleads-call="${id}" ${hasPhone ? "" : "disabled"}>${callIcon}<span>Ligar</span></button>`,
        );
        return `<li class="mleads-swipe" data-id="${id}">
          <div class="mleads-swipe__actions" aria-hidden="true">
            <div class="mleads-swipe__slot mleads-swipe__slot--left">${left.join("")}</div>
            <div class="mleads-swipe__slot mleads-swipe__slot--right">
              <button type="button" class="mleads-swipe__btn mleads-swipe__btn--advance" data-mleads-advance="${id}" ${hasNext ? "" : "disabled"}>${advanceIcon}<span>Avançar</span></button>
            </div>
          </div>
          <div class="mleads-swipe__body mleads-card" data-mleads-open="${id}" role="button" tabindex="0">
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
          </div>
        </li>`;
      })
      .join("");
    bindMleadsSwipe(list);
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
    document.body.classList.add("plab-leads-list");
    const title = $("plabHeaderTitle");
    if (title) title.textContent = "Leads";
    // Apply ?view= before any redirect so Lista ↔ Kanban does not bounce.
    try {
      const qView = urlLeadsView();
      if (qView) setPreferredLeadsView(qView);
    } catch (_) {}
    bindMobileViewToggle();
    syncMobileViewToggle();
    // Tablets that prefer Kanban go straight to the board.
    if (isTabletShell() && preferredLeadsView() === "kanban") {
      location.replace("leads.html?view=kanban");
      return;
    }
    $("mleadsAdd")?.addEventListener("click", () => openNewLead(() => loadMobile().catch(() => {})));
    $("mleadsSearch")?.addEventListener("input", () => {
      clearTimeout($("mleadsSearch")._t);
      $("mleadsSearch")._t = setTimeout(renderMobileList, 180);
    });
    // Hand-offs from other screens (Início search, "Criar → Novo lead" fallback).
    try {
      const params = new URLSearchParams(location.search);
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
    // Tablets with Lista preference must use the leads list shell — bootDesktop hid it.
    if (wantsLeadsListShell()) bootMobile();
    else bootDesktop();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
