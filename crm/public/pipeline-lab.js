(function () {
  const HIDDEN = new Set(["lost"]);
  const AVATAR_COLORS = ["#ea580c", "#0284c7", "#059669", "#7c3aed", "#db2777", "#0f766e", "#b45309"];

  let stages = [];
  let leads = [];
  let stats = null;
  let userName = "";
  let mobileStageSlug = "";

  const SOFT_AVATARS = ["#e9d5ff", "#fce7f3", "#dbeafe", "#d1fae5", "#ffedd5", "#e0e7ff", "#fef3c7"];

  function $(id) {
    return document.getElementById(id);
  }

  function notify(msg, type) {
    if (typeof window.crmNotify === "function") window.crmNotify(msg, type || "info");
    else alert(msg);
  }

  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  async function api(url) {
    const r = await fetch(url, { credentials: "include" });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.success === false) throw new Error(j.error || `HTTP ${r.status}`);
    return j;
  }

  function money(n) {
    const v = Number(n) || 0;
    if (v >= 1000000) return "$" + (v / 1000000).toFixed(2).replace(/\.?0+$/, "") + "M";
    if (v >= 1000) return "$" + (v / 1000).toFixed(v >= 10000 ? 0 : 1).replace(/\.0$/, "") + "K";
    return (
      "$" +
      v.toLocaleString(undefined, { maximumFractionDigits: 0 })
    );
  }

  function moneyFull(n) {
    const v = Number(n) || 0;
    try {
      return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 0,
      }).format(v);
    } catch (_) {
      return "$" + Math.round(v).toLocaleString("en-US");
    }
  }

  function softColorFor(id) {
    const s = String(id || "0");
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return SOFT_AVATARS[h % SOFT_AVATARS.length];
  }

  function isMobileShell() {
    if (window.__omDevice && typeof window.__omDevice.isMobile === "function") {
      return window.__omDevice.isMobile();
    }
    return document.body.classList.contains("om-device-mobile");
  }

  function leadDetailLine(lead) {
    const msg = String(lead.message || "").trim();
    if (msg) return msg.length > 42 ? msg.slice(0, 42) + "…" : msg;
    if (lead.source) return String(lead.source);
    return "Lead";
  }

  function initials(name) {
    const parts = String(name || "")
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    if (!parts.length) return "?";
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  function colorFor(id) {
    const s = String(id || "0");
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return AVATAR_COLORS[h % AVATAR_COLORS.length];
  }

  function normalizeSlug(raw) {
    if (typeof window.normalizePipelineSlug === "function") {
      return window.normalizePipelineSlug(raw || "");
    }
    const s = String(raw || "").trim().toLowerCase().replace(/\s+/g, "_");
    const legacy = {
      new: "new_lead",
      lead_received: "new_lead",
      visit_scheduled: "meeting_scheduled",
      assessment_scheduled: "meeting_scheduled",
      proposal_sent: "quote_sent",
      closed_won: "won",
      closed_lost: "lost",
    };
    return legacy[s] || s;
  }

  function leadSlug(lead) {
    return normalizeSlug(lead.status || lead.pipeline_stage_slug || "");
  }

  function stageLabel(stage) {
    if (typeof window.pipelineStageDisplayName === "function") {
      return window.pipelineStageDisplayName(stage.slug, stage.name);
    }
    return stage.name || stage.slug || "—";
  }

  function relativeAgo(iso) {
    if (!iso) return "";
    const t = new Date(iso).getTime();
    if (!Number.isFinite(t)) return "";
    const diff = Date.now() - t;
    const m = Math.floor(diff / 60000);
    if (m < 60) return m <= 1 ? "agora" : m + "m atrás";
    const h = Math.floor(m / 60);
    if (h < 48) return h + "h atrás";
    const d = Math.floor(h / 24);
    return d + "d atrás";
  }

  function isUrgent(lead) {
    if (!lead.created_at) return false;
    const end = new Date(lead.created_at).getTime() + 30 * 60000;
    return end > Date.now() && leadSlug(lead) === "new_lead";
  }

  function greeting() {
    const h = new Date().getHours();
    if (h >= 18) return "Boa noite";
    if (h >= 12) return "Boa tarde";
    return "Bom dia";
  }

  function openLead(id) {
    if (!id) return;
    window.location.href = "lead-detail.html?id=" + encodeURIComponent(String(id));
  }

  function newLead() {
    if (window.__omNovoLeadSheet && window.__omNovoLeadSheet.openNewLead({
      onCreated: () => {
        load().catch(() => {});
      },
    })) {
      return;
    }
    window.location.href = "leads.html";
    try {
      sessionStorage.setItem("obramate_open_new_lead", "1");
    } catch (_) {}
  }

  function filteredLeads() {
    const qDesktop = ($("plabSearch") && $("plabSearch").value) || "";
    const qMobile = ($("mleadsSearch") && $("mleadsSearch").value) || "";
    const q = (isMobileShell() ? qMobile : qDesktop).trim().toLowerCase();
    if (!q) return leads;
    return leads.filter((l) => {
      const hay = [l.name, l.email, l.phone, l.message, l.source, l.id]
        .map((x) => String(x || "").toLowerCase())
        .join(" ");
      return hay.includes(q);
    });
  }

  function boardStages() {
    return stages.filter((s) => !HIDDEN.has(normalizeSlug(s.slug)));
  }

  function renderMobileKpis(rows) {
    if (!$("mleadsKpiPipeline")) return;
    const open = rows.filter((l) => {
      const s = leadSlug(l);
      return s && s !== "won" && s !== "lost";
    });
    const openValue = open.reduce((sum, l) => sum + (Number(l.estimated_value) || 0), 0);
    const pl = stats && stats.pipeline ? stats.pipeline : {};
    const conv = stats && stats.conversion ? stats.conversion : {};

    $("mleadsKpiPipeline").textContent = moneyFull(openValue || pl.open_pipeline_value || 0);
    $("mleadsKpiPipelineMeta").innerHTML =
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 17l5-5 5 5"/><path d="M7 10l5-5 5 5"/></svg>' +
      open.length +
      " lead" +
      (open.length === 1 ? "" : "s") +
      " ativo" +
      (open.length === 1 ? "" : "s");

    const rate =
      conv.proposal_win_rate != null
        ? conv.proposal_win_rate
        : conv.win_rate != null
          ? conv.win_rate
          : conv.close_rate != null
            ? conv.close_rate
            : null;
    $("mleadsKpiConversion").textContent = rate != null ? Math.round(rate) + "%" : "—";
    $("mleadsKpiConversionMeta").textContent =
      (pl.closed_won_count || 0) + " won · " + (pl.closed_lost_count || 0) + " lost";
  }

  function renderMobileChips(rows) {
    const host = $("mleadsChips");
    if (!host) return;
    const cols = boardStages();
    if (!mobileStageSlug && cols[0]) mobileStageSlug = normalizeSlug(cols[0].slug);

    host.innerHTML = cols
      .map((st) => {
        const slug = normalizeSlug(st.slug);
        const count = rows.filter((l) => leadSlug(l) === slug).length;
        const active = slug === mobileStageSlug;
        const color = st.color || "#a8a29e";
        return `<button type="button" class="mleads-chip${active ? " is-active" : ""}" data-stage="${escapeHtml(
          slug,
        )}" role="tab" aria-selected="${active ? "true" : "false"}">
          <span class="mleads-chip__dot" style="background:${escapeHtml(color)}"></span>
          <span>${escapeHtml(stageLabel(st))}</span>
          <span class="mleads-chip__count">${count}</span>
        </button>`;
      })
      .join("");

    host.querySelectorAll("[data-stage]").forEach((btn) => {
      btn.addEventListener("click", () => {
        mobileStageSlug = btn.getAttribute("data-stage") || "";
        renderMobileList(filteredLeads());
        renderMobileChips(filteredLeads());
      });
    });
  }

  function renderMobileList(rows) {
    const list = $("mleadsList");
    const empty = $("mleadsEmpty");
    const title = $("mleadsSectionTitle");
    const meta = $("mleadsSectionMeta");
    if (!list) return;

    const cols = boardStages();
    const stage = cols.find((s) => normalizeSlug(s.slug) === mobileStageSlug) || cols[0];
    const slug = stage ? normalizeSlug(stage.slug) : mobileStageSlug;
    const stageRows = rows.filter((l) => leadSlug(l) === slug);
    const stageValue = stageRows.reduce((s, l) => s + (Number(l.estimated_value) || 0), 0);
    const stageColor = (stage && stage.color) || "#a8a29e";
    const label = stage ? stageLabel(stage) : "Leads";

    if (title) title.textContent = label;
    if (meta) {
      meta.textContent =
        stageRows.length +
        " lead" +
        (stageRows.length === 1 ? "" : "s") +
        " · " +
        moneyFull(stageValue);
    }

    if (!stageRows.length) {
      list.innerHTML = "";
      if (empty) empty.hidden = false;
      return;
    }
    if (empty) empty.hidden = true;

    list.innerHTML = stageRows
      .map((lead) => {
        const val = Number(lead.estimated_value) || 0;
        const src = lead.source ? String(lead.source) : "";
        return `<li class="mleads-card" data-id="${escapeHtml(String(lead.id))}">
          <span class="mleads-card__avatar" style="background:${softColorFor(lead.id)}">${escapeHtml(
            initials(lead.name),
          )}</span>
          <div>
            <p class="mleads-card__name">${escapeHtml(lead.name || "Lead")}</p>
            <p class="mleads-card__sub">${escapeHtml(leadDetailLine(lead))}</p>
            <div class="mleads-card__tags">
              <span class="mleads-tag"><span class="mleads-tag__dot" style="background:${escapeHtml(
                stageColor,
              )}"></span>${escapeHtml(label)}</span>
              ${src ? `<span class="mleads-tag">${escapeHtml(src)}</span>` : ""}
            </div>
          </div>
          <div class="mleads-card__right">
            <p class="mleads-card__value">${escapeHtml(moneyFull(val))}</p>
            <p class="mleads-card__ago">${escapeHtml(relativeAgo(lead.created_at))}</p>
          </div>
        </li>`;
      })
      .join("");

    list.querySelectorAll(".mleads-card[data-id]").forEach((el) => {
      el.addEventListener("click", () => openLead(el.getAttribute("data-id")));
    });
  }

  function renderMobile(rows) {
    if (!isMobileShell() || !$("mleadsRoot")) return;
    renderMobileKpis(rows);
    renderMobileChips(rows);
    renderMobileList(rows);
  }

  function renderKpis(rows) {
    const open = rows.filter((l) => {
      const s = leadSlug(l);
      return s && s !== "won" && s !== "lost";
    });
    const openValue = open.reduce((sum, l) => sum + (Number(l.estimated_value) || 0), 0);
    const pl = stats && stats.pipeline ? stats.pipeline : {};
    const conv = stats && stats.conversion ? stats.conversion : {};

    $("kpiPipeline").textContent = money(openValue || pl.open_pipeline_value || 0);
    $("kpiPipelineDelta").textContent = open.length + " leads ativos";
    $("kpiPipelineDelta").classList.toggle("is-muted", !open.length);

    const rate =
      conv.win_rate != null
        ? conv.win_rate
        : conv.close_rate != null
          ? conv.close_rate
          : null;
    $("kpiConversion").textContent = rate != null ? rate + "%" : "—";
    $("kpiConversionDelta").textContent =
      (pl.closed_won_count || 0) + " won · " + (pl.closed_lost_count || 0) + " lost";

    $("kpiWon").textContent = money(pl.closed_won_value || 0);
    $("kpiWonDelta").textContent =
      (pl.closed_won_count || 0) === 1
        ? "1 negócio fechado"
        : (pl.closed_won_count || 0) + " negócios fechados";
  }

  function renderBoard(rows) {
    const board = $("plabBoard");
    const cols = boardStages();
    const total = rows.filter((l) => leadSlug(l) !== "lost").length;
    $("plabPipeMeta").textContent =
      total === 1 ? "Total 1 lead" : "Total " + total + " leads";

    if (!cols.length) {
      board.innerHTML = '<p class="plab-empty">Sem estágios de pipeline.</p>';
      return;
    }

    board.innerHTML = cols
      .map((stage) => {
        const slug = normalizeSlug(stage.slug);
        const colLeads = rows.filter((l) => leadSlug(l) === slug);
        const colValue = colLeads.reduce((s, l) => s + (Number(l.estimated_value) || 0), 0);
        const color = stage.color || "#a8a29e";
        const cards = colLeads.slice(0, 8)
          .map((lead) => {
            const name = lead.name || "Lead";
            const project =
              (lead.message && String(lead.message).slice(0, 48)) ||
              lead.source ||
              "Lead";
            const val = Number(lead.estimated_value) || 0;
            const urgent = isUrgent(lead);
            return `<button type="button" class="plab-card" data-id="${escapeHtml(String(lead.id))}">
              <div class="plab-card__top">
                <span class="plab-card__avatar" style="background:${colorFor(lead.id)}">${escapeHtml(initials(name))}</span>
                <p class="plab-card__name">${escapeHtml(name)}</p>
                ${urgent ? '<span class="plab-card__urgent" title="Novo — contactar já"></span>' : ""}
              </div>
              <p class="plab-card__project">${escapeHtml(project)}</p>
              <div class="plab-card__foot">
                <span class="plab-card__value">${val ? money(val) : "—"}</span>
                <span class="plab-card__ago">${escapeHtml(relativeAgo(lead.created_at || lead.updated_at))}</span>
              </div>
            </button>`;
          })
          .join("");

        return `<div class="plab-col" data-slug="${escapeHtml(slug)}">
          <div class="plab-col__head">
            <div>
              <p class="plab-col__title"><span class="plab-col__dot" style="background:${escapeHtml(color)}"></span>${escapeHtml(stageLabel(stage))}</p>
              <p class="plab-col__meta">${colLeads.length} · ${money(colValue)}</p>
            </div>
            <span class="plab-col__count">${colLeads.length}</span>
          </div>
          <div class="plab-col__cards">
            ${cards || '<p class="plab-empty">Sem leads</p>'}
          </div>
          <button type="button" class="plab-col__add" data-new-lead>+ Add deal</button>
        </div>`;
      })
      .join("");

    board.querySelectorAll(".plab-card[data-id]").forEach((btn) => {
      btn.addEventListener("click", () => openLead(btn.getAttribute("data-id")));
    });
    board.querySelectorAll("[data-new-lead]").forEach((btn) => {
      btn.addEventListener("click", newLead);
    });
  }

  function renderAttention(rows) {
    const items = [];
    rows.forEach((l) => {
      if (isUrgent(l)) {
        items.push({
          lead: l,
          title: "Contactar " + (l.name || "lead novo"),
          sub: "Lead novo — janela de 30 min",
          prio: "high",
        });
      }
    });
    rows
      .filter((l) => leadSlug(l) === "quote_sent" || leadSlug(l) === "follow_up_1")
      .slice(0, 4)
      .forEach((l) => {
        items.push({
          lead: l,
          title: "Follow-up · " + (l.name || "lead"),
          sub: "Quote / follow-up no pipeline",
          prio: "medium",
        });
      });

    const unique = [];
    const seen = new Set();
    items.forEach((it) => {
      const id = String(it.lead.id);
      if (seen.has(id)) return;
      seen.add(id);
      unique.push(it);
    });

    const list = unique.slice(0, 6);
    $("plabAttentionCount").textContent = String(list.length);
    $("plabAttention").innerHTML = list.length
      ? list
          .map(
            (it) => `<li role="button" tabindex="0" data-id="${escapeHtml(String(it.lead.id))}">
          <span class="plab-card__avatar" style="background:${colorFor(it.lead.id)}">${escapeHtml(initials(it.lead.name))}</span>
          <div class="plab-attention__body">
            <p class="plab-attention__title">${escapeHtml(it.title)}</p>
            <p class="plab-attention__sub">${escapeHtml(it.sub)}</p>
          </div>
          <span class="plab-prio is-${it.prio}">${it.prio === "high" ? "High" : "Medium"}</span>
        </li>`
          )
          .join("")
      : '<li><div class="plab-attention__body"><p class="plab-attention__title">Nada urgente</p><p class="plab-attention__sub">O pipeline está em dia.</p></div></li>';

    $("plabAttention").querySelectorAll("[data-id]").forEach((el) => {
      const go = () => openLead(el.getAttribute("data-id"));
      el.addEventListener("click", go);
      el.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          go();
        }
      });
    });
  }

  function renderAnalytics(rows) {
    const cols = boardStages();
    const values = cols.map((st) => {
      const slug = normalizeSlug(st.slug);
      const col = rows.filter((l) => leadSlug(l) === slug);
      return {
        label: stageLabel(st),
        color: st.color || "#a8a29e",
        count: col.length,
        value: col.reduce((s, l) => s + (Number(l.estimated_value) || 0), 0),
      };
    });
    const totalVal = values.reduce((s, v) => s + v.value, 0) || 1;
    const totalCount = values.reduce((s, v) => s + v.count, 0) || 1;

    let cursor = 0;
    const stops = values
      .map((v) => {
        const pct = (v.value / totalVal) * 100;
        const start = cursor;
        cursor += pct;
        return `${v.color} ${start}% ${cursor}%`;
      })
      .join(", ");
    $("plabDonut").style.background = values.some((v) => v.value > 0)
      ? `conic-gradient(${stops})`
      : "conic-gradient(#e7e5e4 0 100%)";

    $("plabLegend").innerHTML = values
      .slice(0, 6)
      .map(
        (v) => `<li>
        <span class="plab-legend__left"><span class="plab-col__dot" style="background:${escapeHtml(v.color)}"></span>${escapeHtml(v.label)}</span>
        <strong>${money(v.value)}</strong>
      </li>`
      )
      .join("");

    $("plabBars").innerHTML = values
      .map((v) => {
        const w = Math.max(4, Math.round((v.count / totalCount) * 100));
        return `<div class="plab-bar">
          <span title="${escapeHtml(v.label)}">${escapeHtml(v.label.slice(0, 10))}</span>
          <div class="plab-bar__track"><div class="plab-bar__fill" style="width:${w}%;background:${escapeHtml(v.color)}"></div></div>
          <strong>${v.count}</strong>
        </div>`;
      })
      .join("");
  }

  function renderInsights(rows) {
    const urgent = rows.filter(isUrgent).length;
    const meeting = rows.filter((l) => leadSlug(l) === "meeting_scheduled").length;
    const quotes = rows.filter((l) => leadSlug(l) === "quote_sent" || leadSlug(l) === "follow_up_1").length;
    const openHigh = rows
      .filter((l) => {
        const s = leadSlug(l);
        return s !== "won" && s !== "lost" && Number(l.estimated_value) >= 5000;
      })
      .slice(0, 3);

    const tips = [];
    if (urgent > 0) {
      tips.push({
        title: `Contactar ${urgent} lead${urgent > 1 ? "s" : ""} novo${urgent > 1 ? "s" : ""}`,
        body: "Leads na janela de 30 minutos convertem melhor com resposta rápida.",
      });
    }
    if (openHigh.length) {
      tips.push({
        title: `Focar em ${openHigh.length} deal${openHigh.length > 1 ? "s" : ""} de alto valor`,
        body: openHigh.map((l) => l.name || "Lead").join(", ") + " — valor estimado elevado no pipeline aberto.",
      });
    }
    if (meeting < Math.max(1, Math.floor(rows.length * 0.15))) {
      tips.push({
        title: "Agendar mais visitas",
        body: "Poucos leads em Meeting Scheduled. Visitas in-app aparecem no Schedule e avançam o estágio.",
      });
    }
    if (quotes > 0) {
      tips.push({
        title: `Follow-up em ${quotes} quote${quotes > 1 ? "s" : ""}`,
        body: "Leads em Quote Sent / Follow Up — um toque curto reduz o tempo até decisão.",
      });
    }
    if (!tips.length) {
      tips.push({
        title: "Pipeline saudável",
        body: "Sem alertas críticos. Mantém o ritmo de follow-ups e visitas esta semana.",
      });
    }

    $("plabInsights").innerHTML = tips
      .slice(0, 3)
      .map(
        (t) => `<li><strong>${escapeHtml(t.title)}</strong><p>${escapeHtml(t.body)}</p></li>`
      )
      .join("");
  }

  function renderAll() {
    const rows = filteredLeads();
    renderKpis(rows);
    renderBoard(rows);
    renderAttention(rows);
    renderAnalytics(rows);
    renderInsights(rows);
    renderMobile(rows);
  }

  async function load() {
    const [session, stagesRes, leadsRes, statsRes] = await Promise.all([
      api("/api/auth/session"),
      api("/api/pipeline-stages").catch(() => ({ success: true, data: [] })),
      api("/api/leads?limit=5000&page=1"),
      api("/api/dashboard/stats?period=month").catch(() => null),
    ]);

    if (!session.authenticated) {
      location.href = "/login.html";
      return;
    }

    userName = session.user?.name || session.user?.email || "";
    const first = String(userName).trim().split(/\s+/)[0] || "";
    $("plabGreeting").textContent = first ? `${greeting()}, ${first}` : greeting();
    $("plabHeroSub").textContent = "Aqui está o que está a acontecer no teu pipeline hoje.";
    $("plabAvatar").textContent = initials(userName);
    const sa = $("sidebarUserAvatar");
    if (sa) sa.textContent = initials(userName);
    const sn = $("sidebarUserName");
    if (sn) sn.textContent = userName || "—";
    const sr = $("sidebarUserRole");
    if (sr) sr.textContent = session.user?.role || "";

    let merged = Array.isArray(stagesRes.data) ? stagesRes.data.slice() : [];
    if (typeof window.mergePipelineStagesForKanban === "function") {
      merged = window.mergePipelineStagesForKanban(merged);
    }
    stages = merged.sort((a, b) => (a.order_num || 0) - (b.order_num || 0));
    leads = Array.isArray(leadsRes.data) ? leadsRes.data : [];
    stats = statsRes && statsRes.success ? statsRes : null;

    renderAll();
  }

  function boot() {
    ["plabNewLead", "plabDockNew", "mleadsAdd"].forEach((id) => {
      const el = $(id);
      if (el) el.addEventListener("click", newLead);
    });
    const railNew = $("plabRailNew");
    if (railNew) railNew.addEventListener("click", newLead);
    $("plabRefresh")?.addEventListener("click", () => {
      load().catch((e) => notify(e.message, "error"));
    });
    $("plabSearch")?.addEventListener("input", () => {
      clearTimeout($("plabSearch")._t);
      $("plabSearch")._t = setTimeout(renderAll, 180);
    });
    $("mleadsSearch")?.addEventListener("input", () => {
      clearTimeout($("mleadsSearch")._t);
      $("mleadsSearch")._t = setTimeout(renderAll, 180);
    });

    if (window.__omDevice && window.__omDevice.applyBodyClass) {
      window.__omDevice.applyBodyClass();
    }

    load().catch((e) => {
      notify(e.message || "Falha ao carregar", "error");
      if (/401|unauth|session/i.test(String(e.message || ""))) location.href = "/login.html";
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
