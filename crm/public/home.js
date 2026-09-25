(function () {
  const $ = (id) => document.getElementById(id);

  function money(n) {
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

  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function initials(name) {
    const parts = String(name || "")
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    if (!parts.length) return "—";
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  function greeting() {
    const h = new Date().getHours();
    if (h >= 18) return "Boa noite";
    if (h >= 12) return "Boa tarde";
    return "Bom dia";
  }

  function formatDateLabel(d) {
    const days = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
    const months = [
      "janeiro",
      "fevereiro",
      "março",
      "abril",
      "maio",
      "junho",
      "julho",
      "agosto",
      "setembro",
      "outubro",
      "novembro",
      "dezembro",
    ];
    return `${days[d.getDay()]}, ${d.getDate()} de ${months[d.getMonth()]}`;
  }

  function normalizeSlug(s) {
    return String(s || "")
      .toLowerCase()
      .replace(/-/g, "_");
  }

  function leadSlug(l) {
    return normalizeSlug(l.pipeline_stage_slug || l.slug || l.pipelineStage?.slug || "");
  }

  function isUrgent(lead) {
    if (!lead.created_at) return false;
    const end = new Date(lead.created_at).getTime() + 30 * 60000;
    return end > Date.now() && leadSlug(lead) === "new_lead";
  }

  function colorFor(id) {
    const hues = [12, 28, 160, 200, 260, 320];
    let h = 0;
    const s = String(id || "");
    for (let i = 0; i < s.length; i++) h = (h + s.charCodeAt(i) * 17) % hues.length;
    return `hsl(${hues[h]} 42% 72%)`;
  }

  async function api(url) {
    const res = await fetch(url, { credentials: "include" });
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch (_) {
      throw new Error(res.ok ? "Resposta inválida" : `Erro ${res.status}`);
    }
    if (!res.ok) throw new Error((data && data.error) || `Erro ${res.status}`);
    return data;
  }

  function dayBounds(d) {
    const start = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const end = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
    return { start, end };
  }

  function fmtTime(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", hour12: false });
  }

  function fmtDuration(startIso, endIso) {
    const a = new Date(startIso).getTime();
    const b = new Date(endIso).getTime();
    if (!a || !b || b <= a) return "";
    const mins = Math.round((b - a) / 60000);
    if (mins < 60) return `${mins}min`;
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m ? `${h}h ${m}min` : `${h}h`;
  }

  function eventPerson(ev) {
    const m = ev.meta || {};
    if (m.assigned_user?.name) return m.assigned_user.name;
    if (m.crew?.name) return m.crew.name;
    if (m.customer?.name) return m.customer.name;
    if (Array.isArray(m.members) && m.members[0]?.user?.name) return m.members[0].user.name;
    return "";
  }

  function eventTag(ev) {
    if (ev.type === "meeting") return { label: "Visita", cls: "home-tag--visit" };
    return { label: "Instalação", cls: "home-tag--job" };
  }

  function openLead(id) {
    if (!id) return;
    location.href = "lead-detail.html?id=" + encodeURIComponent(String(id));
  }

  function openEvent(ev) {
    if (!ev) return;
    if (ev.type === "job" && ev.id) {
      location.href = "job-detail.html?id=" + encodeURIComponent(String(ev.id));
      return;
    }
    location.href = "schedule.html";
  }

  function newLead() {
    try {
      sessionStorage.setItem("obramate_open_new_lead", "1");
    } catch (_) {}
    if (window.__omNovoLeadSheet && window.__omNovoLeadSheet.openNewLead()) return;
    location.href = "leads.html";
  }

  function renderToday(events) {
    const list = $("homeTodayList");
    const empty = $("homeTodayEmpty");
    if (!list) return;
    if (!events.length) {
      list.innerHTML = "";
      if (empty) empty.hidden = false;
      return;
    }
    if (empty) empty.hidden = true;
    list.innerHTML = events
      .slice(0, 6)
      .map((ev) => {
        const tag = eventTag(ev);
        const person = eventPerson(ev);
        return `<li class="home-today__item" data-ev-id="${escapeHtml(String(ev.id))}" data-ev-type="${escapeHtml(
          String(ev.type || ""),
        )}">
          <div>
            <span class="home-today__time">${escapeHtml(fmtTime(ev.start))}</span>
            <span class="home-today__dur">${escapeHtml(fmtDuration(ev.start, ev.end))}</span>
          </div>
          <div>
            <p class="home-today__title">${escapeHtml(ev.title || "Evento")}</p>
            ${person ? `<p class="home-today__sub">${escapeHtml(person)}</p>` : ""}
          </div>
          <span class="home-tag ${tag.cls}">${escapeHtml(tag.label)}</span>
        </li>`;
      })
      .join("");

    list.querySelectorAll(".home-today__item").forEach((el) => {
      el.addEventListener("click", () => {
        openEvent({ id: el.getAttribute("data-ev-id"), type: el.getAttribute("data-ev-type") });
      });
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
      .filter((l) => {
        const s = leadSlug(l);
        return s === "quote_sent" || s === "follow_up_1";
      })
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

    const countEl = $("homeAttnCount");
    const listEl = $("homeAttnList");
    const emptyEl = $("homeAttnEmpty");
    const bell = $("homeBell");
    if (countEl) {
      countEl.textContent = String(list.length);
      countEl.hidden = list.length === 0;
    }
    if (bell) bell.classList.toggle("has-dot", list.length > 0);

    if (!listEl) return;
    if (!list.length) {
      listEl.innerHTML = "";
      if (emptyEl) emptyEl.hidden = false;
      return;
    }
    if (emptyEl) emptyEl.hidden = true;
    listEl.innerHTML = list
      .map(
        (it) => `<li class="home-attn__item" data-id="${escapeHtml(String(it.lead.id))}">
        <span class="home-attn__avatar" style="background:${colorFor(it.lead.id)}">${escapeHtml(
          initials(it.lead.name),
        )}</span>
        <div class="home-attn__body">
          <p class="home-attn__title">${escapeHtml(it.title)}</p>
          <p class="home-attn__sub">${escapeHtml(it.sub)}</p>
        </div>
        <span class="home-attn__prio${it.prio === "medium" ? " is-medium" : ""}">${
          it.prio === "high" ? "Alta" : "Média"
        }</span>
      </li>`,
      )
      .join("");

    listEl.querySelectorAll("[data-id]").forEach((el) => {
      el.addEventListener("click", () => openLead(el.getAttribute("data-id")));
    });
  }

  function renderKpis(leads, stats) {
    const open = leads.filter((l) => {
      const s = leadSlug(l);
      return s && s !== "won" && s !== "lost";
    });
    const openValue = open.reduce((sum, l) => sum + (Number(l.estimated_value) || 0), 0);
    const pl = stats && stats.pipeline ? stats.pipeline : {};
    const conv = stats && stats.conversion ? stats.conversion : {};

    const pipeVal = $("homeKpiPipeline");
    const pipeMeta = $("homeKpiPipelineMeta");
    const convVal = $("homeKpiConversion");
    const convMeta = $("homeKpiConversionMeta");

    if (pipeVal) pipeVal.textContent = money(openValue || pl.open_pipeline_value || 0);
    if (pipeMeta) {
      pipeMeta.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 17l5-5 5 5"/><path d="M7 10l5-5 5 5"/></svg>${
        open.length
      } lead${open.length === 1 ? "" : "s"} ativo${open.length === 1 ? "" : "s"}`;
    }

    const rate =
      conv.proposal_win_rate != null
        ? conv.proposal_win_rate
        : conv.win_rate != null
          ? conv.win_rate
          : null;
    if (convVal) convVal.textContent = rate != null ? `${Math.round(rate)}%` : "—";
    if (convMeta) {
      convMeta.textContent = `${pl.closed_won_count || 0} won · ${pl.closed_lost_count || 0} lost`;
    }
  }

  async function load() {
    const root = $("homeRoot");
    if (root) root.classList.add("home-loading");

    const today = new Date();
    $("homeDate").textContent = formatDateLabel(today);

    const { start, end } = dayBounds(today);
    const [session, leadsRes, statsRes, eventsRes] = await Promise.all([
      api("/api/auth/session"),
      api("/api/leads?limit=5000&page=1").catch(() => ({ data: [] })),
      api("/api/dashboard/stats?period=month").catch(() => null),
      api(
        `/api/schedule/events?from=${encodeURIComponent(start.toISOString())}&to=${encodeURIComponent(
          end.toISOString(),
        )}`,
      ).catch(() => ({ data: [] })),
    ]);

    if (!session.authenticated) {
      location.href = "/login.html";
      return;
    }

    const userName = session.user?.name || session.user?.email || "";
    const first = String(userName).trim().split(/\s+/)[0] || "";
    $("homeGreeting").textContent = first ? `${greeting()}, ${first}` : greeting();
    $("homeAvatar").textContent = initials(userName);
    $("homeAvatar").title = userName || "Conta";

    const sa = $("sidebarUserAvatar");
    if (sa) sa.textContent = initials(userName);
    const sn = $("sidebarUserName");
    if (sn) sn.textContent = userName || "—";
    const sr = $("sidebarUserRole");
    if (sr) sr.textContent = session.user?.role || "";

    const leads = Array.isArray(leadsRes.data) ? leadsRes.data : [];
    const stats = statsRes && statsRes.success ? statsRes : null;
    const events = Array.isArray(eventsRes.data) ? eventsRes.data : [];

    renderKpis(leads, stats);
    renderToday(events);
    renderAttention(leads);

    if (root) root.classList.remove("home-loading");
  }

  function boot() {
    $("homeBell")?.addEventListener("click", () => {
      $("homeAttnTitle")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    $("homeNewLead")?.addEventListener("click", (e) => {
      e.preventDefault();
      newLead();
    });
    $("homeSearch")?.addEventListener("focus", () => {
      if (typeof window.__crmShell?.openSearch === "function") {
        $("homeSearch").blur();
        window.__crmShell.openSearch();
      }
    });
    $("homeSearch")?.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      const q = (e.target.value || "").trim();
      if (!q) return;
      location.href = "pipeline-lab.html";
      try {
        sessionStorage.setItem("obramate_home_search", q);
      } catch (_) {}
    });

    load().catch((err) => {
      $("homeRoot")?.classList.remove("home-loading");
      if (window.crmToast?.show) window.crmToast.show(err.message || "Falha ao carregar", { type: "error" });
      if (/401|unauth|session/i.test(String(err.message || ""))) location.href = "/login.html";
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
