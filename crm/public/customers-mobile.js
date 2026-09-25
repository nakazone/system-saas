/**
 * Clientes mobile — list + detail (receivables merge).
 */
(function () {
  const AV = ["#ffe4e6", "#dcfce7", "#e0e7ff", "#fef3c7", "#e0f2fe", "#fce7f3", "#ffedd5"];
  const MONTHS_SHORT = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

  let customers = [];
  let recvByCustomer = new Map();
  let jobsByCustomer = new Map();
  let filter = "all";
  let q = "";
  let selectedId = null;
  let selected = null;
  let canCreate = false;

  const $ = (id) => document.getElementById(id);

  function money(n) {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: Math.abs(Number(n) || 0) >= 100 ? 0 : 2,
    }).format(Number(n) || 0);
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s)
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

  function typeLabel(c) {
    const t = String(c.customer_type || "").toLowerCase();
    if (t === "builder") return "Builder";
    if (t === "lead") return "Lead";
    return "Residencial";
  }

  function financeFor(id) {
    return recvByCustomer.get(String(id)) || { balance: 0, paid: 0, amount: 0, overdue: false, open: false };
  }

  function statusFor(fin) {
    if (fin.overdue && fin.balance > 0) return { label: "Vencido", cls: "jcm-badge--overdue" };
    if (fin.balance > 0) return { label: "Em aberto", cls: "jcm-badge--open" };
    return { label: "Em dia", cls: "jcm-badge--ok" };
  }

  async function api(path) {
    const r = await fetch(path, { credentials: "include" });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.success === false) throw new Error(j.error || `HTTP ${r.status}`);
    return j;
  }

  function filtered() {
    return customers.filter((c) => {
      const fin = financeFor(c.id);
      const t = String(c.customer_type || "").toLowerCase();
      if (filter === "balance" && !(fin.balance > 0)) return false;
      if (filter === "builder" && t !== "builder") return false;
      if (filter === "lead" && t !== "lead" && !c.lead_id) return false;
      if (q) {
        const hay = [c.name, c.phone, c.email, c.address, c.city, c.responsible_name]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }

  function renderChips() {
    const host = $("cliChips");
    if (!host) return;
    const all = customers.length;
    const withBal = customers.filter((c) => financeFor(c.id).balance > 0).length;
    const builders = customers.filter((c) => String(c.customer_type || "").toLowerCase() === "builder").length;
    const leads = customers.filter((c) => String(c.customer_type || "").toLowerCase() === "lead" || c.lead_id).length;
    const items = [
      { id: "all", label: "Todos", n: all },
      { id: "balance", label: "Com saldo", n: withBal },
      { id: "builder", label: "Builders", n: builders },
      { id: "lead", label: "Leads", n: leads },
    ];
    host.innerHTML = items
      .map(
        (it) => `<button type="button" class="jcm-chip${filter === it.id ? " is-active" : ""}" data-cli-filter="${it.id}">
        ${escapeHtml(it.label)}<span class="jcm-chip__n">${it.n}</span>
      </button>`,
      )
      .join("");
    host.querySelectorAll("[data-cli-filter]").forEach((btn) => {
      btn.addEventListener("click", () => {
        filter = btn.getAttribute("data-cli-filter") || "all";
        renderList();
        renderChips();
      });
    });
  }

  function renderList() {
    const rows = filtered();
    const openTotal = customers.reduce((s, c) => s + (financeFor(c.id).balance || 0), 0);
    const sum = $("cliSummary");
    if (sum) sum.textContent = `${customers.length} cliente${customers.length === 1 ? "" : "s"} · ${money(openTotal)} a receber`;

    const host = $("cliList");
    if (!host) return;
    if (!rows.length) {
      host.innerHTML = `<p class="jcm-empty">Nenhum cliente encontrado.</p>`;
      return;
    }
    host.innerHTML = rows
      .map((c, i) => {
        const fin = financeFor(c.id);
        const st = statusFor(fin);
        const jobs = jobsByCustomer.get(String(c.id)) || 0;
        const bg = AV[i % AV.length];
        return `<button type="button" class="jcm-cli" data-cli-id="${escapeHtml(c.id)}">
          <span class="jcm-cli__av" style="background:${bg}">${escapeHtml(initials(c.name))}</span>
          <span>
            <p class="jcm-cli__name">${escapeHtml(c.name || "—")}</p>
            <p class="jcm-cli__meta">${escapeHtml(typeLabel(c))} · ${jobs} job${jobs === 1 ? "" : "s"}</p>
          </span>
          <span style="text-align:right">
            <p class="jcm-cli__amt">${money(fin.balance)}</p>
            <span class="jcm-badge ${st.cls}">${st.label}</span>
          </span>
        </button>`;
      })
      .join("");
    host.querySelectorAll("[data-cli-id]").forEach((btn) => {
      btn.addEventListener("click", () => openDetail(btn.getAttribute("data-cli-id")));
    });
  }

  function showList() {
    selectedId = null;
    selected = null;
    $("cliListPane").hidden = false;
    $("cliDetailPane").hidden = true;
    $("cliFoot")?.classList.remove("is-visible");
    const u = new URL(location.href);
    u.searchParams.delete("id");
    history.replaceState({}, "", u.pathname + (u.search || ""));
  }

  async function openDetail(id) {
    selectedId = id;
    try {
      const [cust, insight] = await Promise.all([
        api(`/api/customers/${id}`),
        api(`/api/customers/${id}/insight`).catch(() => ({ data: null })),
      ]);
      selected = cust.data || null;
      if (!selected) throw new Error("Cliente não encontrado");
      renderDetail(insight.data || null);
      $("cliListPane").hidden = true;
      $("cliDetailPane").hidden = false;
      $("cliFoot")?.classList.add("is-visible");
      const u = new URL(location.href);
      u.searchParams.set("id", String(id));
      history.replaceState({}, "", u.pathname + "?" + u.searchParams.toString());
    } catch (e) {
      window.crmToast?.error?.(e.message || "Erro");
    }
  }

  function renderDetail(insight) {
    const c = selected;
    if (!c) return;
    const fin = financeFor(c.id);
    const bg = AV[Number(c.id) % AV.length];
    $("cliDetAv").textContent = initials(c.name);
    $("cliDetAv").style.background = bg;
    $("cliDetName").textContent = c.name || "—";
    $("cliDetType").textContent = typeLabel(c);
    const created = c.created_at ? new Date(c.created_at) : null;
    $("cliDetSince").textContent =
      created && !Number.isNaN(created.getTime())
        ? `Cliente desde ${MONTHS_SHORT[created.getMonth()]} ${created.getFullYear()}`
        : "";

    const phone = c.phone || "";
    const email = c.email || "";
    const addr = [c.address, c.city, c.state].filter(Boolean).join(", ");
    $("cliQuick").innerHTML = `
      <a class="jcm-quick__btn" href="${phone ? `tel:${escapeHtml(phone)}` : "#"}"${phone ? "" : ' aria-disabled="true"'}><svg viewBox="0 0 24 24"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.8 19.8 0 01-8.63-3.07 19.5 19.5 0 01-6-6A19.8 19.8 0 012.12 4.18 2 2 0 014.11 2h3a2 2 0 012 1.72c.13.97.35 1.92.67 2.83a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.91.32 1.86.54 2.83.67A2 2 0 0122 16.92z"/></svg>Ligar</a>
      <a class="jcm-quick__btn" href="${phone ? `sms:${escapeHtml(phone)}` : "#"}"><svg viewBox="0 0 24 24"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>Mensagem</a>
      <a class="jcm-quick__btn" href="${email ? `mailto:${escapeHtml(email)}` : "#"}"><svg viewBox="0 0 24 24"><path d="M4 4h16v16H4z"/><path d="M22 6l-10 7L2 6"/></svg>E-mail</a>
      <a class="jcm-quick__btn" href="${addr ? `https://maps.google.com/?q=${encodeURIComponent(addr)}` : "#"}" target="_blank" rel="noopener"><svg viewBox="0 0 24 24"><path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>Rota</a>`;

    const contracted =
      insight?.builder_insight?.aggregates?.total_revenue != null
        ? Number(insight.builder_insight.aggregates.total_revenue)
        : Number(fin.amount) || Number(fin.paid) + Number(fin.balance);
    $("cliKpiContracted").textContent = money(contracted);
    $("cliKpiPaid").textContent = money(fin.paid);
    $("cliKpiOpen").textContent = money(fin.balance);

    $("cliDetDl").innerHTML = `
      <div class="jcm-dl__row"><span class="jcm-dl__k">Telefone</span><span class="jcm-dl__v">${escapeHtml(phone || "—")}</span></div>
      <div class="jcm-dl__row"><span class="jcm-dl__k">E-mail</span><span class="jcm-dl__v">${escapeHtml(email || "—")}</span></div>
      <div class="jcm-dl__row"><span class="jcm-dl__k">Contato</span><span class="jcm-dl__v">${escapeHtml(c.responsible_name || "—")}</span></div>
      <div class="jcm-dl__row"><span class="jcm-dl__k">Cidade</span><span class="jcm-dl__v">${escapeHtml([c.city, c.state].filter(Boolean).join(", ") || "—")}</span></div>`;

    const notes = (c.notes || "").trim();
    $("cliDetNotesWrap").hidden = !notes;
    $("cliDetNotes").textContent = notes;

    const quoteHref = `quote-builder.html?customer_id=${encodeURIComponent(c.id)}`;
    $("cliFootQuote").href = quoteHref;
    $("cliFootExtrato").href = "finance.html";

    $("cliEditBtn").onclick = () => {
      location.href = `dashboard.html?page=customers&edit=${encodeURIComponent(c.id)}`;
    };
  }

  function setDetTab(tab) {
    document.querySelectorAll("[data-cli-tab]").forEach((b) => {
      b.classList.toggle("is-active", b.getAttribute("data-cli-tab") === tab);
    });
    $("cliDetResumo").hidden = tab !== "resumo";
    $("cliDetJobs").hidden = tab !== "jobs";
    $("cliDetExtrato").hidden = tab !== "extrato";
    if (tab === "jobs") {
      const n = jobsByCustomer.get(String(selectedId)) || 0;
      $("cliDetJobs").innerHTML = n
        ? `<p class="jcm-empty"><a href="jobs.html">Ver ${n} job${n === 1 ? "" : "s"} em Jobs</a></p>`
        : `<p class="jcm-empty">Sem jobs ligados.</p>`;
    }
    if (tab === "extrato") {
      $("cliDetExtrato").innerHTML = `<p class="jcm-empty"><a href="finance.html">Abrir Financeiro</a></p>`;
    }
  }

  async function load() {
    const [cust, recv, jobs] = await Promise.all([
      api("/api/customers?limit=200&status=active"),
      api("/api/finance/receivables").catch(() => ({ data: [] })),
      api("/api/work-orders").catch(() => ({ data: [] })),
    ]);
    customers = cust.data || [];
    recvByCustomer = new Map();
    (recv.data || []).forEach((r) => {
      const key = String(r.customer_id || "");
      if (!key) return;
      const cur = recvByCustomer.get(key) || { balance: 0, paid: 0, amount: 0, overdue: false };
      cur.balance += Number(r.balance) || 0;
      cur.paid += Number(r.paid) || 0;
      cur.amount += Number(r.amount) || 0;
      if (r.overdue) cur.overdue = true;
      if (cur.balance > 0) cur.open = true;
      recvByCustomer.set(key, cur);
    });
    jobsByCustomer = new Map();
    (jobs.data || []).forEach((wo) => {
      const key = String(wo.customer_id || wo.customer?.id || "");
      if (!key) return;
      jobsByCustomer.set(key, (jobsByCustomer.get(key) || 0) + 1);
    });
    renderChips();
    renderList();
  }

  async function boot() {
    try {
      const s = await api("/api/auth/session");
      if (!s.authenticated) {
        location.href = "/login.html";
        return;
      }
      const role = String(s.user?.role || "").toLowerCase();
      const perms = s.user?.permissions || [];
      canCreate = role === "admin" || perms.includes("customers.create") || perms.includes("customers.manage");
      $("sidebarUserName").textContent = s.user?.name || s.user?.email || "—";
      $("sidebarUserRole").textContent = role || "";
      if (!canCreate) $("cliAddBtn").style.display = "none";

      $("cliAddBtn")?.addEventListener("click", () => {
        location.href = "dashboard.html?page=customers&new=1";
      });
      $("cliDetailBack")?.addEventListener("click", showList);
      $("cliSearch")?.addEventListener("input", () => {
        q = ($("cliSearch").value || "").trim().toLowerCase();
        clearTimeout($("cliSearch")._t);
        $("cliSearch")._t = setTimeout(renderList, 200);
      });
      document.querySelectorAll("[data-cli-tab]").forEach((btn) => {
        btn.addEventListener("click", () => setDetTab(btn.getAttribute("data-cli-tab")));
      });

      await load();
      const id = new URLSearchParams(location.search).get("id");
      if (id) await openDetail(id);
    } catch (e) {
      window.crmToast?.error?.(e.message || "Erro");
      location.href = "/login.html";
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
