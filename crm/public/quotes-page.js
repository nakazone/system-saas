/**
 * Lista de quotes: números do topo, cartões de status (com quantidade e valor) e linhas com próximo passo.
 * Dados: /api/quotes/summary e /api/quotes?group=…
 */
(function () {
  const LIMIT = 20;
  let page = 1;
  let group = "all";
  let canDelete = false;
  let lastSummary = null;

  const S = window.omLeadSignals;
  const DAY = 86400000;
  const MO = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

  const GROUPS = [
    ["all", "Todos", "#221E1A"],
    ["draft", "Rascunho", "#98A2B3"],
    ["sent", "Enviado", "#221E1A"],
    ["viewed", "Visto", "#E7792C"],
    ["approved", "Aprovado", "#536249"],
    ["expired", "Expirado", "#B4561A"],
  ];

  function $(id) {
    return document.getElementById(id);
  }
  function notify(msg, type) {
    if (typeof window.crmNotify === "function") window.crmNotify(msg, type || "info");
    else alert(msg);
  }
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
  async function api(url, opts) {
    const r = await fetch(url, {
      credentials: "include",
      headers: { "Content-Type": "application/json", ...(opts && opts.headers) },
      ...opts,
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.success === false) throw new Error(j.error || `HTTP ${r.status}`);
    return j;
  }
  function money(n) {
    return "$" + Math.round(Number(n) || 0).toLocaleString("en-US");
  }
  function shortMoney(n) {
    const v = Number(n) || 0;
    if (v >= 100000) return "$" + Math.round(v / 1000) + "k";
    if (v >= 10000) return "$" + (v / 1000).toFixed(1).replace(/\.0$/, "") + "k";
    return money(v);
  }
  function dayDiff(iso) {
    const d = new Date(iso);
    if (!iso || Number.isNaN(d.getTime())) return null;
    const a = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const n = new Date();
    const b = new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime();
    return Math.round((a - b) / DAY);
  }
  function dm(iso) {
    const d = new Date(iso);
    return `${d.getDate()} ${MO[d.getMonth()]}`;
  }
  function plural(n, one, many) {
    return `${n} ${n === 1 ? one : many}`;
  }

  /** Grupo de exibição (mesma regra do servidor). */
  function groupOf(q) {
    const st = String(q.status || "draft").toLowerCase();
    if (st === "approved" || st === "accepted" || st === "converted" || st === "invoiced") return "approved";
    if (st === "archived" || st === "rejected") return "archived";
    if (st === "draft") return "draft";
    const exp = q.expiration_date ? new Date(q.expiration_date).getTime() : null;
    if (st === "expired" || (exp != null && exp < Date.now())) return "expired";
    if (st === "viewed" || q.viewed_at) return "viewed";
    return "sent";
  }

  function pill(q, g) {
    const st = String(q.status || "").toLowerCase();
    if (st === "changes_requested") return '<span class="qx-pill qx-pill--late"><i></i>Pediu alterações</span>';
    const map = {
      draft: ["mu", "Rascunho"],
      sent: ["dk", "Enviado"],
      viewed: ["or", "Visto"],
      approved: ["ol", "Aprovado"],
      expired: ["mu", "Expirado"],
      archived: ["mu", "Arquivado"],
    };
    const [c, l] = map[g] || map.draft;
    return `<span class="qx-pill qx-pill--${c}"><i></i>${l}</span>`;
  }

  function nextStep(q, g) {
    const st = String(q.status || "").toLowerCase();
    if (st === "changes_requested") return { tone: "hot", icon: "doc", text: "Ajustar e reenviar" };
    if (g === "draft") return { tone: "", icon: "send", text: "Enviar ao cliente" };
    if (g === "approved") {
      return q.work_order_id
        ? { tone: "ok", icon: "check", text: "Job criado" }
        : { tone: "ok", icon: "check", text: q.signed_at ? "Assinado · criar o job" : "Criar o job" };
    }
    if (g === "expired") {
      const d = q.expiration_date ? -dayDiff(q.expiration_date) : null;
      return { tone: "hot", icon: "flag", text: d && d > 0 ? `Venceu há ${plural(d, "dia", "dias")}` : "Venceu" };
    }
    if (g === "archived") return { tone: "", icon: "pause", text: "Arquivado" };
    if (g === "viewed") {
      const at = q.viewed_at || q.pdf_viewed_at;
      return { tone: "", icon: "eye", text: at ? "Visto " + S.when(at, false) : "Visto pelo cliente" };
    }
    const sentAt = q.email_sent_at;
    const d = sentAt ? S.daysSince(sentAt) : null;
    if (d != null && d >= 3) return { tone: "hot", icon: "clock", text: `Não abriu · ${d} dias` };
    return { tone: "", icon: "send", text: sentAt ? "Enviado " + S.when(sentAt, false) : "Aguardando o cliente" };
  }

  function validity(q, g) {
    if (g === "approved") {
      if (q.signed_at) return { text: "assinado " + dm(q.signed_at), hot: false };
      return { text: "aprovado", hot: false };
    }
    if (g === "draft") {
      const c = q.created_at ? -dayDiff(q.created_at) : null;
      if (c == null) return { text: "", hot: false };
      return { text: c === 0 ? "criado hoje" : c === 1 ? "criado ontem" : `criado há ${c} dias`, hot: false };
    }
    if (!q.expiration_date) return { text: "sem validade", hot: false };
    const d = dayDiff(q.expiration_date);
    if (d < 0) return { text: "venceu " + dm(q.expiration_date), hot: true };
    if (d === 0) return { text: "vence hoje", hot: true };
    return { text: "vence " + dm(q.expiration_date), hot: d <= 7 && g !== "archived" };
  }

  function clientOf(q) {
    return q.builder_name || q.builder_company || q.customer_name || q.customer_company || q.lead_name || q.title || "Sem cliente";
  }

  const ICO = {
    pdf: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5M10 13h6M10 17h4"/></svg>',
    open: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>',
    del: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>',
  };

  function rowHtml(q) {
    const g = groupOf(q);
    const id = esc(q.id);
    const name = clientOf(q);
    const qn = q.quote_number || (q.number ? "Q-" + q.number : "");
    const ref = String(q.job_address || q.property_label || q.job_name || "").trim();
    const refShow = ref && ref !== name ? ref : "";
    const sub = [qn, refShow].filter(Boolean).join(" · ");
    const v = validity(q, g);
    const label = esc(qn || q.id);
    const del = canDelete
      ? `<button type="button" class="qx-ic qx-ic--del" data-delete-quote="${id}" data-delete-label="${label}" title="Apagar" aria-label="Apagar ${label}">${ICO.del}</button>`
      : "";
    const pdf = q.has_invoice_pdf && q.invoice_pdf_url
      ? `<a class="qx-ic" href="${esc(q.invoice_pdf_url)}" target="_blank" rel="noopener" title="PDF" aria-label="PDF">${ICO.pdf}</a>`
      : "";
    return `
      <article class="qx-item om-swipe" role="listitem" tabindex="0" data-id="${id}">
        <div class="om-swipe__actions" aria-hidden="true">
          <button type="button" class="om-swipe__act--edit" data-open-quote="${id}">Abrir</button>
          ${canDelete ? `<button type="button" class="om-swipe__act--delete" data-delete-quote="${id}" data-delete-label="${label}">Apagar</button>` : ""}
        </div>
        <div class="qx-row om-swipe__body">
          <div class="qx-who"><span class="qx-av" aria-hidden="true">${esc(S.initials(name))}</span><div><b title="${esc(name)}">${esc(name)}</b><small>${esc(sub)}</small></div></div>
          <div>${pill(q, g)}</div>
          <div class="qx-val">${money(q.total_amount ?? q.total)}</div>
          <div>${S.html(nextStep(q, g))}</div>
          <div class="qx-date${v.hot ? " is-hot" : ""}">${esc(v.text)}</div>
          <div class="qx-acts">${pdf}${del}<button type="button" class="qx-ic" data-open-quote="${id}" title="Abrir" aria-label="Abrir ${label}">${ICO.open}</button></div>
        </div>
      </article>`;
  }

  function renderGroups(sum) {
    const nav = $("qxGroups");
    if (!nav) return;
    const gs = (sum && sum.groups) || {};
    nav.innerHTML = GROUPS.map(([key, label, color]) => {
      const x = gs[key] || { count: 0, value: 0 };
      const on = group === key;
      return `<button type="button" class="qx-group${on ? " is-on" : ""}" data-group="${key}" aria-pressed="${on}">
        <span class="qx-group__n"><i style="--dot:${color}"${color === "#221E1A" ? " data-dark" : ""}></i>${label}</span>
        <b>${x.count}</b><small>${money(x.value)}</small></button>`;
    }).join("");
  }

  function renderSummary(sum) {
    if (!sum) return;
    const phone = window.matchMedia("(max-width: 760px)").matches;
    if (phone) {
      const dts = document.querySelectorAll(".qx-sum dt");
      if (dts[1]) dts[1].textContent = "Aprovação";
      if (dts[3]) dts[3].textContent = "Vencem em 7d";
    }
    $("qxSumOpen").textContent = phone ? shortMoney(sum.open_value) : money(sum.open_value);
    $("qxSumRate").textContent = sum.approval_rate_90 == null ? "—" : Math.round(sum.approval_rate_90) + "%";
    $("qxSumTicket").textContent = sum.avg_ticket_90 == null ? "—" : money(sum.avg_ticket_90);
    const ex = $("qxSumExpiring");
    ex.textContent = String(sum.expiring_7 || 0);
    ex.classList.toggle("is-hot", (sum.expiring_7 || 0) > 0);
  }

  async function loadSummary() {
    try {
      const j = await api("/api/quotes/summary");
      lastSummary = j.data;
      renderSummary(lastSummary);
    } catch (_) {
      /* números do topo são opcionais */
    }
    renderGroups(lastSummary);
  }

  async function loadQuotes() {
    const q = $("filterQ").value.trim();
    const params = new URLSearchParams({ page: String(page), limit: String(LIMIT) });
    if (q) params.set("q", q);
    if (group !== "all") params.set("group", group);
    const list = $("quotesTableBody");
    const j = await api(`/api/quotes?${params}`);
    const rows = j.data || [];
    const total = typeof j.total === "number" ? j.total : rows.length;
    $("quotesResultCount").textContent = plural(total, "quote", "quotes");
    if (!rows.length) {
      const msg = q
        ? "Nenhum quote encontrado para essa busca."
        : group === "all"
          ? "Nenhum quote ainda. Crie o primeiro em “Novo quote”."
          : "Nenhum quote neste status.";
      list.innerHTML = `<p class="qx-empty">${msg}</p>`;
    } else {
      list.innerHTML = rows.map(rowHtml).join("");
    }
    const pages = Math.max(1, Math.ceil(total / LIMIT));
    $("qxPages").hidden = pages <= 1;
    $("pageInfo").textContent = `Página ${page} de ${pages}`;
    $("btnPrevPage").disabled = page <= 1;
    $("btnNextPage").disabled = page >= pages;
    if (window.OmGestures && window.matchMedia("(max-width: 900px), (pointer: coarse)").matches) {
      window.OmGestures.bindSwipeRow(list);
    }
  }

  function reload() {
    return Promise.all([loadQuotes(), loadSummary()]).catch((e) => notify(e.message, "error"));
  }

  function openQuote(id) {
    if (id) location.href = `quote-builder.html?id=${encodeURIComponent(id)}`;
  }

  async function deleteQuote(id, label, btn) {
    if (!id || !canDelete) return;
    if (!confirm(`Apagar o quote ${label || ""}?\n\nEsta ação não pode ser desfeita.`)) return;
    if (btn) btn.disabled = true;
    try {
      await api(`/api/quotes/${encodeURIComponent(id)}`, { method: "DELETE" });
      notify(`Quote ${label || ""} apagado.`, "success");
      await reload();
    } catch (err) {
      notify(err.message || "Não foi possível apagar o quote.", "error");
      if (btn) btn.disabled = false;
    }
  }

  function bind() {
    const list = $("quotesTableBody");
    list.addEventListener("click", (e) => {
      const del = e.target.closest("[data-delete-quote]");
      if (del) {
        e.stopPropagation();
        void deleteQuote(del.getAttribute("data-delete-quote"), del.getAttribute("data-delete-label"), del);
        return;
      }
      const op = e.target.closest("[data-open-quote]");
      if (op) {
        e.stopPropagation();
        openQuote(op.getAttribute("data-open-quote"));
        return;
      }
      if (e.target.closest("a")) return;
      const row = e.target.closest(".qx-item");
      if (row) openQuote(row.getAttribute("data-id"));
    });
    list.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      const row = e.target.closest(".qx-item");
      if (!row || e.target !== row) return;
      e.preventDefault();
      openQuote(row.getAttribute("data-id"));
    });
    $("qxGroups").addEventListener("click", (e) => {
      const b = e.target.closest("[data-group]");
      if (!b) return;
      group = b.getAttribute("data-group");
      $("qxArchived").setAttribute("aria-pressed", "false");
      page = 1;
      renderGroups(lastSummary);
      loadQuotes().catch((err) => notify(err.message, "error"));
    });
    $("qxArchived").addEventListener("click", () => {
      const on = group !== "archived";
      group = on ? "archived" : "all";
      $("qxArchived").setAttribute("aria-pressed", String(on));
      page = 1;
      renderGroups(lastSummary);
      loadQuotes().catch((err) => notify(err.message, "error"));
    });
    $("btnPrevPage").addEventListener("click", () => {
      if (page > 1) {
        page -= 1;
        loadQuotes().catch((err) => notify(err.message, "error"));
      }
    });
    $("btnNextPage").addEventListener("click", () => {
      page += 1;
      loadQuotes().catch((err) => notify(err.message, "error"));
    });
    let t = null;
    $("filterQ").addEventListener("input", () => {
      clearTimeout(t);
      t = setTimeout(() => {
        page = 1;
        loadQuotes().catch(() => {});
      }, 280);
    });
  }

  async function boot() {
    let s;
    try {
      s = await api("/api/auth/session");
    } catch (_) {
      location.href = "/login.html";
      return;
    }
    if (!s.authenticated) {
      location.href = "/login.html";
      return;
    }
    const perms = s.user?.permissions || [];
    const role = s.user?.role || "";
    canDelete = role === "admin" || perms.includes("quotes.delete");
    window.__crmPermissionKeys = perms;
    window.__crmUserRole = role;
    const sn = $("sidebarUserName");
    if (sn) sn.textContent = s.user?.name || s.user?.email || "—";
    const sr = $("sidebarUserRole");
    if (sr) sr.textContent = role || "";
    try {
      const g = new URLSearchParams(location.search).get("group");
      if (g && GROUPS.some(([k]) => k === g)) group = g;
    } catch (_) {}
    bind();
    renderGroups(null);
    await reload();
    if (window.OmGestures) {
      window.OmGestures.initPullToRefresh({ key: "quotes", indicator: "#quotesPtr", refresh: () => reload() });
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
