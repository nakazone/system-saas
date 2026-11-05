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

  let session = null;
  let overview = null;
  let loadedAt = 0;
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

  /** The Mate (fox mascot) next to the greeting: waves in the morning, tablet in the afternoon, laptop at night. */
  /**
   * The Mate's pose follows the day: pointing at the cards when something is urgent,
   * celebrating when nothing needs attention, otherwise by time of day.
   */
  const MATE_POSES = {
    point: "Tem coisa urgente para resolver",
    celebrate: "Tudo em dia",
    wave: "Bom dia",
    tablet: "Boa tarde",
    laptop: "Boa noite",
  };

  function matePose() {
    const att = overview && overview.attention;
    if (att && att.high > 0) return "point";
    if (att && att.total === 0) return "celebrate";
    const h = new Date().getHours();
    return h >= 18 || h < 4 ? "laptop" : h >= 12 ? "tablet" : "wave";
  }

  function renderMate() {
    const img = $("omdMateImg");
    const btn = $("omdMate");
    if (!img || !btn) return;
    const pose = matePose();
    if (btn.dataset.pose !== pose) {
      if (btn.dataset.pose) btn.classList.remove("omd-mate--" + btn.dataset.pose);
      btn.dataset.pose = pose;
      btn.classList.add("omd-mate--" + pose);
      img.src = `/assets/img/mascot/mate-${pose}.webp?v=20261027-m2`;
      btn.title = `${MATE_POSES[pose]} · Falar com o Mate`;
    }
    if (btn.dataset.bound) return;
    btn.dataset.bound = "1";
    btn.addEventListener("click", () => {
      btn.classList.remove("is-hop");
      void btn.offsetWidth;
      btn.classList.add("is-hop");
      if (window.MateAI && typeof window.MateAI.open === "function") window.MateAI.open();
    });
  }

  function renderHeader() {
    renderMate();
    const name = (session && session.user && (session.user.name || session.user.email)) || "";
    $("omdGreeting").textContent = D.greeting(overview, name);
    $("omdDate").textContent = D.dateLabel(overview) || " ";
    // Bold the facts ("2 visitas e 1 instalação", "2 itens urgentes") like the approved layout.
    const sum = D.summary(overview) || "Tudo pronto.";
    $("omdSummary").innerHTML = sum
      .split(" · ")
      .map((part) => {
        const m = /^(Hoje:\s*)(.+?)(\.?)$/.exec(part);
        if (m) return `${esc(m[1])}<b>${esc(m[2])}</b>${esc(m[3])}`;
        const n = /^(\d+\s.+?)(\.?)$/.exec(part);
        if (n) return `<b>${esc(n[1])}</b>${esc(n[2])}`;
        return esc(part);
      })
      .join(" · ");
  }

  function renderUpdated() {
    const el = $("omdUpdated");
    if (!el || !loadedAt) return;
    const mins = Math.floor((Date.now() - loadedAt) / 60000);
    el.textContent = mins < 1 ? "Atualizado agora" : `Atualizado há ${mins} min`;
  }

  /** Extra detail drawn only in the bento tiles (all from values the overview already returns). */
  function kpiExtra(key, k) {
    if (key === "pipeline" && k.pipeline_open) {
      // In the bento, conversion and new leads ride inside the pipeline block (their own tiles hide).
      const c = k.conversion;
      const l = k.leads_month;
      const boxes = [];
      if (c) boxes.push(`<span><b>${esc(c.rate == null ? "—" : `${Math.round(c.rate)}%`)}</b>conversão</span>`);
      if (l) boxes.push(`<span><b>${esc(String(l.count))}</b>${esc(l.count === 1 ? "lead novo" : "leads novos")}</span>`);
      const funnel = overview.board ? `<span class="omd-chart omd-chart--funnel" data-omd-chart="funnel"></span>` : "";
      return funnel + (boxes.length ? `<span class="omd-kpi__boxes" aria-hidden="true">${boxes.join("")}</span>` : "");
    }
    if (key === "gross_profit" && k.gross_profit && k.gross_profit.value != null) {
      const g = k.gross_profit;
      const revenue = Number(g.revenue) || 0;
      const margin = revenue > 0 ? Math.round((Number(g.value) / revenue) * 100) : null;
      const bar = margin != null ? Math.max(0, Math.min(100, margin)) : 0;
      return `<span class="omd-kpi__split" aria-hidden="true">
        ${margin != null ? `<span class="omd-kpi__bar"><i style="transform:scaleX(${bar / 100})"></i></span>` : ""}
        <span class="omd-kpi__line"><span>Receita</span><b>${esc(D.money(revenue))}</b></span>
        <span class="omd-kpi__line"><span>Custo</span><b>${esc(D.money(g.cost || 0))}</b></span>
      </span>`;
    }
    if (key === "won" && k.won_month && k.won_month.daily) {
      return `<span class="omd-chart omd-chart--won" data-omd-chart="won"></span>`;
    }
    if (key === "receivables" && k.receivables && Number(k.receivables.open_value) > 0) {
      const open = Number(k.receivables.open_value) || 0;
      const overdue = Math.max(0, Math.min(open, Number(k.receivables.overdue_value) || 0));
      return `<span class="omd-kpi__seg" aria-hidden="true"><i class="is-overdue" style="flex:${overdue}"></i><i style="flex:${open - overdue}"></i></span>`;
    }
    return "";
  }

  /** KPI tiles: a bento of big tiles on wide screens, a slim strip when folded or narrow. */
  function renderKpis() {
    const host = $("omdKpis");
    const tiles = D.kpiStrip(overview);
    const root = $("omdRoot");
    if (!tiles.length) {
      host.hidden = true;
      return;
    }
    host.hidden = false;
    host.style.setProperty("--omd-kpi-count", String(tiles.length));
    // The bento has a fixed slot for each of the six tiles; with fewer (permissions) use the strip.
    root.classList.toggle("omd--kpi-partial", tiles.length < 6);
    const k = (overview && overview.kpis) || {};
    host.innerHTML = tiles
      .map(
        (t, i) => `<a class="omd-kpi${t.group === "money" && tiles[i - 1] && tiles[i - 1].group !== "money" ? " is-group-start" : ""}" data-kpi="${esc(t.key)}" href="${esc(t.href)}" style="--i:${i}"${
          t.title ? ` title="${esc(t.title)}"` : ""
        }>
          <span class="omd-kpi__label">${esc(t.label)}</span>
          <span class="omd-kpi__value">${esc(t.value)}</span>
          <span class="omd-kpi__meta${t.metaTone ? ` is-${esc(t.metaTone)}` : ""}">${esc(t.meta)}</span>
          ${kpiExtra(t.key, k)}
        </a>`,
      )
      .join("");
  }

  /* ---------------------------------------------------------------------------
   * Folding: the KPI bento folds into a slim strip, and stacked cards fold into a
   * one-line summary so the card beside them gets the room. Per viewer, per browser.
   * ------------------------------------------------------------------------- */
  const FOLD_KEY = "omd_home_fold_v1";
  let folded = {};
  try {
    folded = JSON.parse(localStorage.getItem(FOLD_KEY) || "{}") || {};
  } catch (_) {
    folded = {};
  }

  function saveFolds() {
    try {
      localStorage.setItem(FOLD_KEY, JSON.stringify(folded));
    } catch (_) {}
  }

  function reducedMotion() {
    return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  /** Layout changes morph through a view transition (boxes glide to their new size); instant without support. */
  function morph(update) {
    if (!document.startViewTransition || reducedMotion()) {
      update();
      return;
    }
    document.documentElement.classList.add("omd-morphing");
    const vt = document.startViewTransition(update);
    vt.finished.finally(() => document.documentElement.classList.remove("omd-morphing"));
  }

  function applyFolds() {
    if (overview) requestAnimationFrame(drawCharts);
    const root = $("omdRoot");
    root.classList.toggle("omd--kpi-compact", !!folded.kpis);
    const kb = $("omdKpiFold");
    if (kb) {
      kb.setAttribute("aria-expanded", folded.kpis ? "false" : "true");
      kb.querySelector("span").textContent = folded.kpis ? "Abrir indicadores" : "Recolher indicadores";
    }
    document.querySelectorAll("[data-omd-card]").forEach((card) => {
      const key = card.getAttribute("data-omd-card");
      const isFolded = !!folded[key];
      card.classList.toggle("is-folded", isFolded);
      const btn = card.querySelector("[data-omd-fold]");
      if (btn) {
        btn.setAttribute("aria-expanded", isFolded ? "false" : "true");
        const title = card.querySelector("h2");
        btn.setAttribute("aria-label", `${isFolded ? "Abrir" : "Recolher"} ${title ? title.textContent : ""}`.trim());
      }
    });
  }

  function bindFolds() {
    const kb = $("omdKpiFold");
    if (kb && !kb.dataset.bound) {
      kb.dataset.bound = "1";
      kb.addEventListener("click", () => {
        folded.kpis = !folded.kpis;
        saveFolds();
        morph(applyFolds);
      });
    }
    document.querySelectorAll("[data-omd-fold]").forEach((btn) => {
      if (btn.dataset.bound) return;
      btn.dataset.bound = "1";
      btn.addEventListener("click", () => {
        const key = btn.getAttribute("data-omd-fold");
        folded[key] = !folded[key];
        saveFolds();
        morph(applyFolds);
      });
    });
  }

  function setSummary(key, text) {
    const el = document.querySelector(`[data-omd-summary="${key}"]`);
    if (el) el.textContent = text || "";
  }

  /** One-line summaries shown on a folded card. */
  function renderSummaries() {
    const ev = overview.today_events || [];
    const jobsToday = ev.filter((e) => e.type === "job").length;
    const visits = ev.length - jobsToday;
    setSummary(
      "today",
      ev.length
        ? [visits ? D.plural(visits, "visita", "visitas") : "", jobsToday ? D.plural(jobsToday, "instalação", "instalações") : ""].filter(Boolean).join(" · ")
        : "agenda livre",
    );
    const week = (overview.jobs_forecast || []).reduce((n, d) => n + (d.count || 0), 0);
    setSummary("week", week ? D.plural(week, "job na semana", "jobs na semana") : "sem jobs na semana");
    const s = overview.jobs_status;
    if (s) {
      setSummary(
        "ops",
        [
          s.late ? D.plural(s.late, "atrasado", "atrasados") : "",
          s.in_field ? `${s.in_field} em campo` : "",
          s.to_invoice && s.to_invoice.count ? `${D.moneyCompact(s.to_invoice.value)} a faturar` : "",
        ]
          .filter(Boolean)
          .join(" · ") || "tudo em dia",
      );
    }
    const q = overview.quotes_waiting;
    if (q) {
      const unopened = q.count - q.viewed;
      setSummary("quotes", q.count ? [D.plural(q.count, "enviado", "enviados"), unopened ? `${unopened} não ${unopened === 1 ? "aberto" : "abertos"}` : ""].filter(Boolean).join(" · ") : "nenhum aguardando");
    }
  }

  /** First visit of the session: tiles and cards rise in once; later loads appear instantly. */
  const ENTER_KEY = "omd_home_entered";
  function playEntranceOnce() {
    let seen = false;
    try {
      seen = sessionStorage.getItem(ENTER_KEY) === "1";
      sessionStorage.setItem(ENTER_KEY, "1");
    } catch (_) {}
    if (seen || reducedMotion()) return;
    const root = $("omdRoot");
    root.classList.add("omd--enter");
    setTimeout(() => root.classList.remove("omd--enter"), 1100);
  }

  /** Empty states carry the Mate in a pose that matches the message. */
  function mateEmpty(pose) {
    return `<span class="omd-empty__mate" aria-hidden="true"><img src="/assets/img/mascot/mate-${pose}.webp?v=20261027-m2" alt="" decoding="async" loading="lazy" /></span>`;
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

  /** Attention items grouped by what they are about; each group folds on its own. */
  const ATTN_GROUPS = [
    { key: "leads", label: "Leads", kinds: ["lead_sla", "lead_uncontacted"] },
    { key: "followups", label: "Follow-ups", kinds: ["followup_overdue", "followup_today"] },
    { key: "quotes", label: "Quotes", kinds: ["quote_changes", "quote_expiring", "quote_stale"] },
    { key: "invoices", label: "Faturas vencidas", kinds: ["invoice_overdue"] },
  ];
  const ATTN_GROUP_OF = ATTN_GROUPS.reduce((m, g) => {
    g.kinds.forEach((k) => (m[k] = g));
    return m;
  }, {});

  function renderAttention() {
    const list = $("omdAttnList");
    const count = $("omdAttnCount");
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
      list.innerHTML = `<li class="omd-empty omd-empty--mate">
        ${mateEmpty("celebrate")}
        <div><strong>Tudo em dia</strong><p>Nenhum lead esperando contato, follow-up atrasado, quote parado ou invoice vencida.</p></div>
      </li>`;
      return;
    }

    // Items arrive ranked by urgency; groups keep that order (the group holding the most urgent item first).
    const groups = [];
    const byKey = {};
    items.forEach((it) => {
      const g = ATTN_GROUP_OF[it.kind] || { key: "other", label: "Outros" };
      if (!byKey[g.key]) {
        byKey[g.key] = { ...g, items: [] };
        groups.push(byKey[g.key]);
      }
      byKey[g.key].items.push(it);
    });

    list.innerHTML = groups
      .map((g) => {
        const foldKey = `attn_${g.key}`;
        const isFolded = !!folded[foldKey];
        const hot = g.items.some((it) => it.priority === "high");
        const amount = g.items.reduce((sum, it) => sum + (Number(it.amount) > 0 ? Number(it.amount) : 0), 0);
        const bodyId = `omdAttnGrp-${g.key}`;
        return `<li class="omd-agrp${isFolded ? " is-folded" : ""}" data-attn-group="${esc(g.key)}">
          <button type="button" class="omd-agrp__head" data-attn-fold="${esc(foldKey)}" aria-expanded="${isFolded ? "false" : "true"}" aria-controls="${bodyId}">
            <span class="omd-agrp__name">${esc(g.label)}</span>
            <span class="omd-agrp__count${hot ? " is-hot" : ""}">${g.items.length}</span>
            ${amount > 0 ? `<span class="omd-agrp__amount">${esc(D.moneyCompact(amount))}</span>` : ""}
            <svg class="omd-fold__chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>
          </button>
          <div class="omd-agrp__body" id="${bodyId}">
            <ul class="omd-agrp__list">${g.items.map(attentionRow).join("")}</ul>
          </div>
        </li>`;
      })
      .join("");

    if (!list.dataset.foldBound) {
      list.dataset.foldBound = "1";
      list.addEventListener("click", (e) => {
        const head = e.target.closest("[data-attn-fold]");
        if (!head) return;
        const key = head.getAttribute("data-attn-fold");
        folded[key] = !folded[key];
        saveFolds();
        const grp = head.closest(".omd-agrp");
        grp.classList.toggle("is-folded", !!folded[key]);
        head.setAttribute("aria-expanded", folded[key] ? "false" : "true");
      });
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
      list.innerHTML = `<li class="omd-empty omd-empty--mate">
        ${mateEmpty("reading")}
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
        return `<li class="omd-row omd-ev${v.live ? " is-now" : ""}">
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
  let jobsForecastDayKey = null;

  function jobsForecastDays() {
    return (overview && overview.jobs_forecast) || [];
  }

  function pickJobsForecastDay(days, preferred) {
    if (!days.length) return null;
    if (preferred && days.some((d) => d.date === preferred)) return preferred;
    const todayKey = overview.today || "";
    if (todayKey && days.some((d) => d.date === todayKey)) return todayKey;
    const busy = days.find((d) => d.count > 0);
    return (busy || days[0]).date;
  }

  function shiftJobsForecastDay(delta) {
    const days = jobsForecastDays();
    if (!days.length) return;
    const cur = pickJobsForecastDay(days, jobsForecastDayKey);
    const idx = Math.max(0, days.findIndex((d) => d.date === cur));
    const next = days[idx + delta];
    if (!next) return;
    jobsForecastDayKey = next.date;
    renderJobsForecast();
  }

  function renderJobsForecast() {
    const card = $("omdJobsCard");
    const daysEl = $("omdJobsDays");
    const list = $("omdJobsList");
    const nav = $("omdJobsNav");
    if (!card || !daysEl || !list) return;
    const days = jobsForecastDays();
    if (overview.jobs_forecast == null) {
      card.hidden = true;
      return;
    }
    card.hidden = false;
    if (nav) nav.hidden = false;
    const todayKey = overview.today || "";
    jobsForecastDayKey = pickJobsForecastDay(days, jobsForecastDayKey);
    const selectedIdx = Math.max(0, days.findIndex((d) => d.date === jobsForecastDayKey));

    daysEl.innerHTML = days
      .map((d) => {
        const dt = new Date(`${d.date}T12:00:00Z`);
        const wd = WD_PT[dt.getUTCDay()] || "";
        const n = Number(String(d.date).slice(-2));
        const isToday = d.date === todayKey;
        const busy = d.count > 0;
        const selected = d.date === jobsForecastDayKey;
        return `<button type="button" class="omd-jobs__day${isToday ? " is-today" : ""}${busy ? " is-busy" : ""}${
          selected ? " is-selected" : ""
        }" data-jobs-day="${esc(d.date)}" role="tab" aria-selected="${selected ? "true" : "false"}" title="${esc(d.date)}: ${d.count}">
          <span class="omd-jobs__day-wd">${esc(wd)}</span>
          <span class="omd-jobs__day-n">${n}</span>
          <span class="omd-jobs__day-c">${d.count || "·"}</span>
        </button>`;
      })
      .join("");

    const prev = $("omdJobsPrev");
    const next = $("omdJobsNext");
    if (prev) prev.disabled = selectedIdx <= 0;
    if (next) next.disabled = selectedIdx >= days.length - 1;

    const day = days.find((d) => d.date === jobsForecastDayKey) || days[0];
    const show = (day && day.jobs) || [];
    if (!show.length) {
      const label =
        day && day.date === todayKey
          ? "hoje"
          : day
            ? `${WD_PT[new Date(`${day.date}T12:00:00Z`).getUTCDay()] || ""} ${Number(String(day.date).slice(-2))}`.trim()
            : "este dia";
      list.innerHTML = `<li class="omd-empty omd-empty--mate">
        ${mateEmpty("sleeping")}
        <div><strong>Sem jobs ${esc(label)}</strong><p>Nenhum job agendado. <a class="omd-link" href="schedule.html">Abrir agenda</a></p></div>
      </li>`;
      return;
    }
    list.innerHTML = show
      .map((j) => {
        const clock = D.timeOf(j.start, overview);
        const when = clock === "00:00" ? "All Day" : clock;
        const sub = [j.person, j.address].filter(Boolean).join(" · ");
        return `<li class="omd-row omd-ev">
          <span class="omd-ev__time"><strong>${esc(when)}</strong><span>${day.date === todayKey ? "hoje" : esc(String(day.date).slice(5).replace("-", "/"))}</span></span>
          <div class="omd-row__body">
            <p class="omd-row__title"><a href="${esc(j.href)}">${esc(j.title)}</a></p>
            ${sub ? `<p class="omd-row__detail">${esc(sub)}</p>` : ""}
          </div>
        </li>`;
      })
      .join("");
  }

  function bindJobsForecastNav() {
    const daysEl = $("omdJobsDays");
    if (daysEl && !daysEl.dataset.bound) {
      daysEl.dataset.bound = "1";
      daysEl.addEventListener("click", (e) => {
        const btn = e.target.closest("[data-jobs-day]");
        if (!btn) return;
        jobsForecastDayKey = btn.getAttribute("data-jobs-day");
        renderJobsForecast();
      });
    }
    const prev = $("omdJobsPrev");
    const next = $("omdJobsNext");
    if (prev && !prev.dataset.bound) {
      prev.dataset.bound = "1";
      prev.addEventListener("click", () => shiftJobsForecastDay(-1));
    }
    if (next && !next.dataset.bound) {
      next.dataset.bound = "1";
      next.addEventListener("click", () => shiftJobsForecastDay(1));
    }
  }

  function renderOps() {
    const card = $("omdOpsCard");
    const s = overview.jobs_status;
    if (!s) {
      card.hidden = true;
      return;
    }
    card.hidden = false;
    const v = D.jobsStatusView(s);
    $("omdOpsStats").innerHTML = v.stats
      .map(
        (st) => `<a class="omd-stat${st.tone ? ` is-${esc(st.tone)}` : ""}${st.value ? "" : " is-zero"}" href="${esc(st.href)}">
          <span class="omd-stat__value">${esc(String(st.value))}</span>
          <span class="omd-stat__label">${esc(st.label)}</span>
        </a>`,
      )
      .join("");
    const bill = $("omdOpsBill");
    if (v.bill) {
      bill.hidden = false;
      bill.innerHTML = `<span class="omd-ops__bill-label">A faturar</span>
        <span class="omd-ops__bill-value">${esc(v.bill.value)}</span>
        <span class="omd-ops__bill-meta">${esc(v.bill.meta)}</span>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18l6-6-6-6"/></svg>`;
    } else {
      bill.hidden = true;
    }
    const list = $("omdOpsList");
    list.innerHTML = v.rows.length
      ? v.rows
          .map(
            (r) => `<li class="omd-row omd-row--compact is-${esc(r.tone)}">
          <div class="omd-row__body">
            <p class="omd-row__title"><a href="${esc(r.href)}">${esc(r.title)}</a></p>
            <p class="omd-row__detail">${esc(r.sub)}</p>
          </div>
          ${r.aside ? `<span class="omd-row__amount">${esc(r.aside)}</span>` : ""}
        </li>`,
          )
          .join("")
      : `<li class="omd-empty omd-empty--inline"><p>Nenhum job atrasado ou esperando fatura.</p></li>`;
  }

  function renderQuotesWaiting() {
    const card = $("omdQuotesCard");
    const q = overview.quotes_waiting;
    if (!q) {
      card.hidden = true;
      return;
    }
    card.hidden = false;
    const sum = $("omdQuotesSum");
    if (!q.count) {
      sum.hidden = true;
      $("omdQuotesList").innerHTML = `<li class="omd-empty omd-empty--mate">
        ${mateEmpty("thumbs")}
        <div><strong>Nenhum quote esperando resposta</strong><p>Os quotes enviados aparecem aqui até o cliente aprovar. <a class="omd-link" href="quote-builder.html">Novo quote</a></p></div>
      </li>`;
      return;
    }
    sum.hidden = false;
    // The money in play is already the "Pipeline aberto" tile above; here: how many and who opened them.
    const unopened = q.count - q.viewed;
    sum.innerHTML = [
      `<b>${esc(String(q.count))}</b> ${q.count === 1 ? "enviado" : "enviados"}`,
      q.viewed ? `${esc(String(q.viewed))} ${q.viewed === 1 ? "visto" : "vistos"}` : "",
      unopened ? `${esc(String(unopened))} não ${unopened === 1 ? "aberto" : "abertos"}` : "",
    ]
      .filter(Boolean)
      .join(" · ");
    $("omdQuotesList").innerHTML = q.items
      .map((it) => {
        const v = D.quoteWaitView(it);
        return `<li class="omd-row omd-row--compact${v.stale ? " is-stale" : ""}">
          <div class="omd-row__body">
            <p class="omd-row__title"><a href="${esc(v.href)}">${esc(v.title)}</a></p>
            <p class="omd-row__detail">${esc(v.sub)}</p>
          </div>
          <div class="omd-row__aside">
            ${v.amount ? `<span class="omd-row__amount">${esc(v.amount)}</span>` : ""}
            <span class="omd-seen is-${esc(v.seenTone)}">${esc(v.seen)}</span>
          </div>
        </li>`;
      })
      .join("");
  }


  /* ---------------------------------------------------------------------------
   * Charts (inline SVG, drawn at the real size; redrawn on resize).
   * Palettes validated with the dataviz skill's validate_palette.js:
   *   dark tile #221E1A: this month #D96B20 · last month #1FA2C2   (all checks pass)
   *   white card:        installation #C25E17 · visit #0F7FA0       (all checks pass)
   * ------------------------------------------------------------------------- */
  const SVGNS = "http://www.w3.org/2000/svg";
  const CHART = {
    won: { now: "#D96B20", prev: "#1FA2C2", grid: "rgba(255,255,255,0.14)", surface: "#221E1A" },
    day: { job: "#C25E17", visit: "#0F7FA0" },
  };

  function svgEl(tag, attrs) {
    const el = document.createElementNS(SVGNS, tag);
    Object.keys(attrs || {}).forEach((k) => el.setAttribute(k, attrs[k]));
    return el;
  }

  /** One tooltip for the whole Home; text set with textContent (values come from tenant data). */
  function chartTip() {
    let tip = document.getElementById("omdChartTip");
    if (!tip) {
      tip = document.createElement("div");
      tip.id = "omdChartTip";
      tip.className = "omd-tip";
      tip.setAttribute("role", "status");
      tip.hidden = true;
      document.body.appendChild(tip);
    }
    return tip;
  }

  function showTip(x, y, title, rows) {
    const tip = chartTip();
    tip.textContent = "";
    const t = document.createElement("p");
    t.className = "omd-tip__title";
    t.textContent = title;
    tip.appendChild(t);
    rows.forEach((r) => {
      const row = document.createElement("p");
      row.className = "omd-tip__row";
      const key = document.createElement("i");
      key.style.background = r.color;
      const val = document.createElement("b");
      val.textContent = r.value;
      const name = document.createElement("span");
      name.textContent = r.name;
      row.append(key, val, name);
      tip.appendChild(row);
    });
    tip.hidden = false;
    const w = tip.offsetWidth;
    const h = tip.offsetHeight;
    const left = Math.min(window.innerWidth - w - 8, Math.max(8, x - w / 2));
    const top = y - h - 12 < 8 ? y + 16 : y - h - 12;
    tip.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
  }

  function hideTip() {
    const tip = document.getElementById("omdChartTip");
    if (tip) tip.hidden = true;
  }

  function monthShort(iso) {
    const d = iso ? new Date(iso) : new Date();
    try {
      return new Intl.DateTimeFormat("pt-BR", { month: "short", timeZone: overview.timezone || undefined }).format(d).replace(".", "");
    } catch (_) {
      return "";
    }
  }

  /**
   * "Fechado no mês": closed per week of the month (1–7, 8–14, 15–21, 22–28, 29+).
   * This month in orange; the same week of last month as a light shadow behind it.
   */
  function weekTotals(running, days) {
    const out = [];
    const at = (d) => (d <= 0 ? 0 : running[Math.min(running.length, d) - 1] || 0);
    for (let start = 1; start <= days; start += 7) {
      const end = Math.min(days, start + 6);
      out.push({ start, end, value: Math.max(0, at(end) - at(start - 1)), reached: start <= running.length });
    }
    return out;
  }

  function drawWonChart() {
    const host = document.querySelector('[data-omd-chart="won"]');
    const daily = overview && overview.kpis && overview.kpis.won_month && overview.kpis.won_month.daily;
    if (!host || !daily) return;
    const W = Math.round(host.clientWidth);
    const H = Math.round(host.clientHeight);
    host.textContent = "";
    if (W < 80 || H < 48) return;

    const today = overview.today || "";
    const y = Number(today.slice(0, 4)) || new Date().getFullYear();
    const m = Number(today.slice(5, 7)) || new Date().getMonth() + 1;
    const daysInMonth = new Date(y, m, 0).getDate();
    const cur = weekTotals(daily.current || [], daysInMonth);
    const prevWeeks = weekTotals(daily.previous || [], (daily.previous || []).length || 30);
    const n = cur.length;
    const prevOf = (i) => (prevWeeks[i] ? prevWeeks[i].value : 0);
    const maxVal = Math.max(1, ...cur.map((w) => w.value), ...cur.map((w, i) => prevOf(i)));
    const fmt = (v) => (daily.unit === "money" ? D.money(v) : D.plural(v, "quote", "quotes"));
    const fmtShort = (v) => (daily.unit === "money" ? D.moneyCompact(v) : String(v));
    const nowName = monthShort(overview.period && overview.period.month_start);
    const prevName = monthShort(overview.period && overview.period.previous_month_start);
    const curWeek = Math.max(0, Math.min(n - 1, Math.floor(((daily.current || []).length - 1) / 7)));

    const legendH = 16;
    const labelH = 14;
    const plotTop = legendH + 14;
    const plotH = Math.max(20, H - plotTop - labelH - 4);
    const base = plotTop + plotH;
    const slot = W / n;
    const barW = Math.min(24, Math.max(10, slot * 0.42));
    const shadowW = Math.min(30, barW + 8);

    const svg = svgEl("svg", { width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: "img" });
    svg.setAttribute(
      "aria-label",
      `Fechado por semana em ${nowName}: ` +
        cur.map((w, i) => `${w.start}–${w.end}: ${w.reached ? fmt(w.value) : "ainda não"}${prevOf(i) ? ` (${prevName} ${fmt(prevOf(i))})` : ""}`).join("; "),
    );

    const leg = svgEl("g", { class: "omd-chart__legend" });
    leg.appendChild(svgEl("rect", { x: 0, y: 3, width: 10, height: 8, rx: 2, fill: CHART.won.now }));
    const t1 = svgEl("text", { x: 15, y: 11 });
    t1.textContent = nowName;
    leg.appendChild(t1);
    leg.appendChild(svgEl("rect", { x: 52, y: 3, width: 10, height: 8, rx: 2, fill: "rgba(255,255,255,0.22)" }));
    const t2 = svgEl("text", { x: 67, y: 11 });
    t2.textContent = prevName;
    leg.appendChild(t2);
    svg.appendChild(leg);

    svg.appendChild(svgEl("line", { x1: 0, x2: W, y1: base + 0.5, y2: base + 0.5, stroke: CHART.won.grid, "stroke-width": 1 }));

    // Bar with a 4px rounded top, square on the baseline.
    const barPath = (cx, w, h) => {
      if (h <= 0) return "";
      const r = Math.min(4, w / 2, h);
      const x0 = cx - w / 2;
      const top = base - h;
      return `M${x0},${base} L${x0},${top + r} Q${x0},${top} ${x0 + r},${top} L${x0 + w - r},${top} Q${x0 + w},${top} ${x0 + w},${top + r} L${x0 + w},${base} Z`;
    };
    const hv = (v) => (v / maxVal) * plotH;

    cur.forEach((w, i) => {
      const cx = slot * i + slot / 2;
      const g = svgEl("g", { class: `omd-wk${i === curWeek ? " is-now" : ""}${w.reached ? "" : " is-future"}`, style: `--i:${i}` });
      const shadow = barPath(cx, shadowW, hv(prevOf(i)));
      if (shadow) g.appendChild(svgEl("path", { d: shadow, fill: "rgba(255,255,255,0.14)", class: "omd-wk__shadow" }));
      const bar = barPath(cx, barW, hv(w.value));
      if (bar && w.reached) g.appendChild(svgEl("path", { d: bar, fill: CHART.won.now, class: "omd-wk__bar" }));
      // Only the current week is labelled on the chart; the rest live in the tooltip.
      if (i === curWeek && w.value > 0) {
        const lab = svgEl("text", { x: cx, y: base - hv(w.value) - 5, "text-anchor": "middle", class: "omd-wk__value" });
        lab.textContent = fmtShort(w.value);
        g.appendChild(lab);
      }
      const day = svgEl("text", { x: cx, y: base + labelH, "text-anchor": "middle", class: "omd-wk__label" });
      // Narrow tile: only the first day of each week ("1", "8", "15"…); the tooltip has the range.
      day.textContent = slot >= 38 ? `${w.start}–${w.end}` : String(w.start);
      g.appendChild(day);
      // Hit area: the whole column, not just the bar.
      const hit = svgEl("rect", { x: slot * i, y: legendH, width: slot, height: H - legendH, fill: "transparent" });
      const show = () => {
        const r = hit.getBoundingClientRect();
        const rows = [{ color: CHART.won.now, value: w.reached ? fmt(w.value) : "ainda não chegou", name: nowName }];
        rows.push({ color: "rgba(255,255,255,0.5)", value: fmt(prevOf(i)), name: prevName });
        showTip(r.left + r.width / 2, r.top + 8, `Dias ${w.start}–${w.end}`, rows);
        g.classList.add("is-hover");
      };
      hit.addEventListener("pointerenter", show);
      hit.addEventListener("pointerleave", () => {
        hideTip();
        g.classList.remove("is-hover");
      });
      g.appendChild(hit);
      svg.appendChild(g);
    });
    host.appendChild(svg);
  }

  /**
   * "Pipeline aberto": the open stages as a funnel (bar width = leads in the stage),
   * with dots flowing from each stage into the next.
   */
  const FUNNEL_STAGES = ["new_lead", "contacted", "meeting_scheduled", "quote_sent", "follow_up_1"];

  function drawFunnel() {
    const host = document.querySelector('[data-omd-chart="funnel"]');
    const board = overview && overview.board;
    if (!host || !board) return;
    const W = Math.round(host.clientWidth);
    const H = Math.round(host.clientHeight);
    host.textContent = "";
    if (W < 80 || H < 44) return;
    const stages = FUNNEL_STAGES.map((slug) => board.find((c) => c.slug === slug)).filter(Boolean);
    if (!stages.length) return;
    const n = stages.length;
    const gap = Math.max(5, Math.min(9, (H - n * 10) / Math.max(1, n - 1)));
    const barH = Math.max(8, Math.min(18, (H - gap * (n - 1)) / n));
    const labelW = Math.min(118, Math.round(W * 0.42));
    const countW = 28;
    const trackW = Math.max(30, W - labelW - countW - 8);
    const maxCount = Math.max(1, ...stages.map((c) => c.count || 0));
    const total = stages.reduce((sum, c) => sum + (c.count || 0), 0);

    const svg = svgEl("svg", { width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: "img" });
    svg.setAttribute("aria-label", "Leads por etapa: " + stages.map((c) => `${D.stageLabel(c.slug, c.name)} ${c.count || 0}`).join(", "));
    stages.forEach((c, i) => {
      const yTop = i * (barH + gap);
      const w = c.count ? Math.max(barH, (c.count / maxCount) * trackW) : 3;
      const cx = labelW + trackW / 2;
      const g = svgEl("g", { class: "omd-fn__stage", style: `--i:${i}` });
      const name = svgEl("text", { x: 0, y: yTop + barH / 2 + 4, class: "omd-fn__name" });
      name.textContent = D.stageLabel(c.slug, c.name);
      g.appendChild(name);
      g.appendChild(svgEl("rect", { x: labelW, y: yTop, width: trackW, height: barH, rx: barH / 2, class: "omd-fn__track" }));
      g.appendChild(svgEl("rect", { x: cx - w / 2, y: yTop, width: w, height: barH, rx: barH / 2, class: "omd-fn__bar" }));
      const num = svgEl("text", { x: W, y: yTop + barH / 2 + 4, "text-anchor": "end", class: "omd-fn__count" });
      num.textContent = String(c.count || 0);
      g.appendChild(num);
      // Dots drop from this stage into the next: the pipeline moving.
      if (i < n - 1 && c.count) {
        for (let k = 0; k < 3; k++) {
          const dot = svgEl("circle", {
            cx: cx + (k - 1) * Math.min(14, w / 4),
            cy: yTop + barH,
            r: 2,
            class: "omd-fn__dot",
            style: `--fall:${gap + barH / 2}px; --d:${(i * 0.35 + k * 0.6).toFixed(2)}s`,
          });
          g.appendChild(dot);
        }
      }
      const hit = svgEl("rect", { x: 0, y: yTop - gap / 2, width: W, height: barH + gap, fill: "transparent" });
      hit.addEventListener("pointerenter", () => {
        const r = hit.getBoundingClientRect();
        const share = total ? Math.round(((c.count || 0) / total) * 100) : 0;
        const rows = [{ color: "#fff", value: D.plural(c.count || 0, "lead", "leads"), name: `${share}% do funil` }];
        if (c.value) rows.push({ color: "rgba(255,255,255,0.6)", value: D.money(c.value), name: "estimado" });
        showTip(r.left + r.width / 2, r.top, D.stageLabel(c.slug, c.name), rows);
        g.classList.add("is-hover");
      });
      hit.addEventListener("pointerleave", () => {
        hideTip();
        g.classList.remove("is-hover");
      });
      g.appendChild(hit);
      svg.appendChild(g);
    });
    host.appendChild(svg);
  }

  /** "Hoje": the day as a timeline — visits and installations as blocks, with a "now" marker. */
  function drawDayTimeline() {
    const host = $("omdTodayTimeline");
    if (!host) return;
    const events = (overview && overview.today_events) || [];
    host.textContent = "";
    host.hidden = false;
    const tz = overview.timezone || undefined;
    const hourOf = (iso) => {
      try {
        const parts = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "numeric", hourCycle: "h23", timeZone: tz }).formatToParts(new Date(iso));
        const h = Number(parts.find((p) => p.type === "hour").value);
        const mi = Number(parts.find((p) => p.type === "minute").value);
        return h + mi / 60;
      } catch (_) {
        const d = new Date(iso);
        return d.getHours() + d.getMinutes() / 60;
      }
    };
    const todayKey = overview.today || "";
    const dayKey = (iso) => {
      try {
        return new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date(iso));
      } catch (_) {
        return "";
      }
    };
    // Clamp multi-day events to today.
    const spans = events.map((ev) => {
      const s = dayKey(ev.start) < todayKey ? 0 : hourOf(ev.start);
      const e = dayKey(ev.end) > todayKey ? 24 : Math.max(s + 0.25, hourOf(ev.end));
      return { ev, s, e };
    });
    const nowH = hourOf(new Date().toISOString());
    let from = 7;
    let to = 19;
    spans.forEach((sp) => {
      from = Math.min(from, Math.floor(sp.s));
      to = Math.max(to, Math.ceil(sp.e));
    });
    from = Math.max(0, Math.min(from, Math.floor(nowH)));
    to = Math.min(24, Math.max(to, Math.ceil(nowH)));
    const pct = (h) => `${(((h - from) / (to - from)) * 100).toFixed(2)}%`;

    // Lanes: an event goes in the first lane where it does not overlap.
    const lanes = [];
    spans
      .slice()
      .sort((a, b) => a.s - b.s)
      .forEach((sp) => {
        let lane = lanes.findIndex((end) => end <= sp.s);
        if (lane < 0) {
          lane = lanes.length;
          lanes.push(0);
        }
        lanes[lane] = sp.e;
        sp.lane = Math.min(lane, 2);
      });

    const track = document.createElement("div");
    track.className = "omd-tl__track";
    track.style.setProperty("--lanes", String(Math.max(1, Math.min(3, lanes.length))));
    // Ticks every 2h on a normal day, every 4h when an all-day job stretches the scale.
    const step = to - from > 14 ? 4 : 2;
    for (let h = Math.ceil(from / step) * step; h <= to; h += step) {
      const tick = document.createElement("span");
      tick.className = "omd-tl__tick";
      tick.style.left = pct(h);
      tick.textContent = `${h}h`;
      track.appendChild(tick);
    }
    spans.forEach((sp, i) => {
      const a = document.createElement("a");
      const isJob = sp.ev.type === "job";
      a.className = `omd-tl__block is-${isJob ? "job" : "visit"}`;
      a.href = sp.ev.href;
      a.style.left = pct(Math.max(from, sp.s));
      a.style.width = `calc(${pct(Math.min(to, sp.e))} - ${pct(Math.max(from, sp.s))})`;
      a.style.setProperty("--lane", String(sp.lane));
      a.style.setProperty("--i", String(i));
      const v = D.eventView(sp.ev, overview);
      a.setAttribute("aria-label", `${v.tag}: ${sp.ev.title}, ${v.time}${v.until ? ` (${v.until})` : ""}`);
      const tipFor = () => {
        const r = a.getBoundingClientRect();
        showTip(r.left + r.width / 2, r.top, `${v.time} · ${v.until || ""}`.replace(/ · $/, ""), [
          { color: isJob ? CHART.day.job : CHART.day.visit, value: sp.ev.title, name: v.tag },
        ]);
      };
      a.addEventListener("pointerenter", tipFor);
      a.addEventListener("focus", tipFor);
      a.addEventListener("pointerleave", hideTip);
      a.addEventListener("blur", hideTip);
      track.appendChild(a);
    });
    if (nowH >= from && nowH <= to) {
      const now = document.createElement("span");
      now.className = "omd-tl__now";
      now.style.left = pct(nowH);
      now.setAttribute("aria-hidden", "true");
      track.appendChild(now);
    }
    host.appendChild(track);

    const hasJob = spans.some((sp) => sp.ev.type === "job");
    const hasVisit = spans.some((sp) => sp.ev.type !== "job");
    const legend = document.createElement("p");
    legend.className = "omd-tl__legend";
    [
      ["Instalação", "job", hasJob],
      ["Visita", "visit", hasVisit],
      ["Agora", "now", nowH >= from && nowH <= to],
    ].forEach(([label, kind, show]) => {
      if (!show) return;
      const span = document.createElement("span");
      span.className = `is-${kind}`;
      span.textContent = label;
      legend.appendChild(span);
    });
    host.appendChild(legend);
  }

  function drawCharts() {
    drawWonChart();
    drawFunnel();
    drawDayTimeline();
  }

  let chartResizeTimer = null;
  window.addEventListener("resize", () => {
    clearTimeout(chartResizeTimer);
    chartResizeTimer = setTimeout(() => {
      if (!overview) return;
      drawWonChart();
      drawFunnel();
    }, 120);
  });

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
    renderOps();
    renderQuotesWaiting();
    renderSummaries();
    // Charts measure their boxes: draw after layout.
    requestAnimationFrame(drawCharts);
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
      const firstPaint = !overview || !$("omdRoot").dataset.painted;
      renderAll();
      if (firstPaint) {
        $("omdRoot").dataset.painted = "1";
        playEntranceOnce();
      }
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
    document.title = "Início | ObraMate";
    bindJobsForecastNav();
    applyFolds();
    bindFolds();
    $("omdNewLead").addEventListener("click", () => openNewLead(() => refresh(true)));
    $("plabDockNew").addEventListener("click", () => openNewLead(() => refresh(true)));
    $("plabDockSearch").addEventListener("click", () => openSearch());
    $("omdRefresh").addEventListener("click", () => refresh(true));
    $("omdRetry").addEventListener("click", () => refresh(true));
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
  let mobileStageSlug = "all";
  let quoteByLead = {};
  const STAGE_PT = {
    new_lead: "Novo lead",
    contacted: "Contactado",
    meeting_scheduled: "Visita agendada",
    quote_sent: "Orçamento enviado",
    follow_up_1: "Follow-up",
    stand_by: "Stand-by",
    won: "Ganho",
    lost: "Perdido",
  };
  function leadAmount(lead) {
    const sig = window.omLeadSignals;
    if (!sig) return Number(lead.estimated_value) || 0;
    return sig.value(lead, quoteByLead[lead.id] || null).amount || 0;
  }
  function daysInStage(lead) {
    const raw = lead.pipeline_stage_entered_at || lead.updated_at || lead.created_at;
    const sig = window.omLeadSignals;
    return sig ? sig.daysSince(raw) : null;
  }
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
    const pt = stage && STAGE_PT[normalizeSlug(stage.slug)];
    if (pt) return pt;
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
    if (window.omLeadSignals && typeof window.omLeadSignals.noteText === "function") {
      return window.omLeadSignals.noteText(lead, 100);
    }
    const note = String(lead.notes || lead.message || lead.followup_notes || "")
      .split(/\r?\n/)
      .map((s) => s.trim())
      .find((s) => s && !/^CEP:/i.test(s) && !/^Endereço:/i.test(s));
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
    const ok = await window.crmConfirm({
      title: "Excluir este lead?",
      text: "O lead e o histórico dele são apagados. Isso não pode ser desfeito.",
      ok: "Excluir lead",
      danger: true,
    });
    if (!ok) return;
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

  function renderMobileKpis() {
    const open = leads.filter((l) => {
      const c = leadSlug(l);
      return c !== "won" && c !== "lost";
    });
    const openValue = open.reduce((sum, l) => sum + leadAmount(l), 0);
    const stale = open.filter((l) => {
      const d = daysInStage(l);
      return d != null && d >= 5;
    }).length;
    const set = (id, v) => {
      const el = $(id);
      if (el) el.textContent = v;
    };
    set("mleadsKpiPipeline", D.money(openValue));
    set("mleadsKpiOpen", String(open.length));
    set("mleadsKpiStale", String(stale));
    const st = $("mleadsKpiStale");
    if (st) st.classList.toggle("is-hot", stale > 0);
  }

  function renderMobileChips(rows) {
    const host = $("mleadsChips");
    if (!host) return;
    const cols = mobileBoardStages();
    if (!mobileStageSlug) mobileStageSlug = "all";
    const openCount = rows.filter((l) => !["won", "lost"].includes(leadSlug(l))).length;
    host.innerHTML =
      `<button type="button" class="mleads-chip${mobileStageSlug === "all" ? " is-active" : ""}" data-stage="all" role="tab" aria-selected="${
        mobileStageSlug === "all" ? "true" : "false"
      }"><span>Todos</span><span class="mleads-chip__count">${openCount}</span></button>` +
      cols
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
    const isAll = mobileStageSlug === "all";
    const stage = isAll ? null : cols.find((s) => normalizeSlug(s.slug) === mobileStageSlug) || cols[0];
    const slug = stage ? normalizeSlug(stage.slug) : mobileStageSlug;
    const order = cols.map((c) => normalizeSlug(c.slug));
    const stageRows = isAll
      ? rows
          .filter((l) => !["won", "lost"].includes(leadSlug(l)))
          .sort((a, b) => order.indexOf(leadSlug(a)) - order.indexOf(leadSlug(b)))
      : rows.filter((l) => leadSlug(l) === slug);
    const stageValue = stageRows.reduce((s, l) => s + leadAmount(l), 0);
    const stageOf = (l) => cols.find((c) => normalizeSlug(c.slug) === leadSlug(l));
    const label = stage ? stageLabel(stage) : "Leads abertos";

    $("mleadsSectionTitle").textContent = label;
    $("mleadsSectionMeta").textContent = `${D.plural(stageRows.length, "lead", "leads")} · ${D.money(stageValue)}`;

    const panel = $("mleadsStagePanel");
    if (panel) {
      if (!isAll && stage) {
        panel.style.setProperty("--stage-color", stage.color || "#98A2B3");
        panel.classList.add("has-stage");
      } else {
        panel.style.removeProperty("--stage-color");
        panel.classList.remove("has-stage");
      }
    }

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
        const sig = window.omLeadSignals;
        const q = quoteByLead[lead.id] || null;
        const v = sig ? sig.value(lead, q) : { amount: Number(lead.estimated_value) || 0, sub: "" };
        const amount = v.amount || 0;
        const amountSub = v.sub === "estimado" ? "estimado" : v.sub;
        const sigHtml = sig ? sig.html(sig.nextStep(lead, q, daysInStage(lead))) : "";
        const note = noteSnippet(lead);
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
        const leadStage = stageOf(lead);
        const tone = (leadStage && leadStage.color) || (stage && stage.color) || "#98A2B3";
        return `<li class="mleads-swipe" data-id="${id}" style="--stage-color:${esc(tone)}">
          <div class="mleads-swipe__actions" aria-hidden="true">
            <div class="mleads-swipe__slot mleads-swipe__slot--left">${left.join("")}</div>
            <div class="mleads-swipe__slot mleads-swipe__slot--right">
              <button type="button" class="mleads-swipe__btn mleads-swipe__btn--advance" data-mleads-advance="${id}" ${hasNext ? "" : "disabled"}>${advanceIcon}<span>Avançar</span></button>
            </div>
          </div>
          <div class="mleads-swipe__body mleads-card" data-mleads-open="${id}" role="button" tabindex="0" style="--stage-color:${esc(tone)}">
            ${
              window.OmLeadOrigin && typeof window.OmLeadOrigin.logoHtml === "function"
                ? window.OmLeadOrigin.logoHtml(lead)
                : `<span class="mleads-card__avatar">${esc(initials(lead.name))}</span>`
            }
            <div class="mleads-card__main">
              <p class="mleads-card__name"><span>${esc(lead.name || "Lead")}</span>${
                String(lead.priority || "") === "high" ? '<i class="mleads-card__pri" aria-label="Alta prioridade"></i>' : ""
              }</p>
              ${sigHtml ? `<p class="mleads-card__next">${sigHtml}</p>` : ""}
              ${note ? `<p class="mleads-card__note">${esc(note)}</p>` : ""}
              ${
                isAll && leadStage
                  ? `<p class="mleads-card__stage"><span class="mleads-tag__dot" style="background:${esc(leadStage.color || "#98A2B3")}"></span>${esc(stageLabel(leadStage))}</p>`
                  : ""
              }
            </div>
            <div class="mleads-card__right">
              <p class="mleads-card__value">${amount > 0 ? esc(D.money(amount)) : '<span class="mleads-card__novalue">Sem valor</span>'}</p>
              ${amountSub ? `<p class="mleads-card__ago">${esc(amountSub)}</p>` : ""}
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
    const [sess, stagesRes, leadsRes, qRes] = await Promise.all([
      D.session(),
      api("/api/pipeline-stages").catch(() => ({ data: [] })),
      api("/api/leads?limit=5000&page=1"),
      api("/api/leads/quote-engagement-summary").catch(() => ({ data: {} })),
    ]);
    quoteByLead = (qRes && qRes.data) || {};
    if (!sess || !sess.authenticated) {
      location.href = "/login.html";
      return;
    }
    session = sess;
    let merged = Array.isArray(stagesRes.data) ? stagesRes.data.slice() : [];
    if (typeof window.mergePipelineStagesForKanban === "function") merged = window.mergePipelineStagesForKanban(merged);
    stages = merged.sort((a, b) => (a.order_num || 0) - (b.order_num || 0));
    leads = Array.isArray(leadsRes.data) ? leadsRes.data : [];
    renderMobileKpis();
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
