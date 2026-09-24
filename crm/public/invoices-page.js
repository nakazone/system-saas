(function () {
  let page = 1;
  const LIMIT = 25;

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

  function statusLabel(status) {
    const map = {
      draft: "Draft",
      sent: "Sent",
      paid: "Paid",
      overdue: "Overdue",
      issued: "Issued",
      partially_paid: "Partial",
      void: "Void",
    };
    const s = String(status || "").toLowerCase();
    return map[s] || status || "—";
  }

  function statusSlug(status) {
    const s = String(status || "").toLowerCase().replace(/[^a-z0-9_-]/g, "") || "sent";
    if (s === "partially_paid") return "sent";
    return s;
  }

  function fmtMoney(n) {
    return (
      "$" +
      Number(n || 0).toLocaleString(undefined, {
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
      })
    );
  }

  function remainingOf(inv) {
    const amt = Number(inv.amount || 0);
    const paid = Number(inv.paid_amount != null ? inv.paid_amount : inv.paid_total || 0);
    if (inv.remaining_amount != null) return Math.max(0, Number(inv.remaining_amount));
    return Math.max(0, amt - paid);
  }

  function renderOverview(rows) {
    let draft = 0;
    let sent = 0;
    let paid = 0;
    let overdue = 0;
    let outstanding = 0;
    let paid30 = 0;
    const now = Date.now();
    const dayMs = 86400000;

    rows.forEach((inv) => {
      const st = statusSlug(inv.status);
      if (st === "draft") draft += 1;
      else if (st === "paid") paid += 1;
      else if (st === "overdue") overdue += 1;
      else if (st === "sent" || st === "issued") sent += 1;

      if (st !== "paid" && st !== "void") {
        outstanding += remainingOf(inv);
        if (st !== "overdue" && inv.due_date) {
          const due = new Date(inv.due_date).getTime();
          if (due < now) overdue += 1;
        }
      }

      if (st === "paid") {
        const paidAt = inv.paid_at || inv.updated_at || inv.email_sent_at || inv.created_at;
        if (paidAt) {
          const t = new Date(paidAt).getTime();
          if (t >= now - 30 * dayMs && t <= now) {
            paid30 += Number(inv.amount || 0);
          }
        }
      }
    });

    $("ovDraft").textContent = String(draft);
    $("ovSent").textContent = String(sent);
    $("ovPaid").textContent = String(paid);
    $("ovOverdue").textContent = String(overdue);
    $("ovOutstanding").textContent = fmtMoney(outstanding);
    $("ovPaid30").textContent = fmtMoney(paid30);
  }

  function renderTable(rows) {
    const tbody = $("invoicesTableBody");
    $("invoicesResultCount").textContent = `(${rows.length} result${rows.length === 1 ? "" : "s"})`;
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="mod-empty">Nenhum invoice encontrado.</td></tr>';
      return;
    }
    tbody.innerHTML = rows
      .map((inv) => {
        const invNum = escapeHtml(inv.invoice_number || String(inv.id));
        const qNum = escapeHtml(inv.quote_number || "—");
        const client = escapeHtml(inv.customer_name || inv.quote_title || "—");
        const amt = Number(inv.amount || 0).toLocaleString(undefined, {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        });
        const slug = statusSlug(inv.status);
        let sentAt = "—";
        const raw = inv.email_sent_at || inv.issued_at || inv.created_at;
        if (raw) {
          try {
            sentAt = new Date(raw).toLocaleDateString();
          } catch (_) {}
        }
        const quoteHref =
          inv.quote_id != null
            ? `quote-builder.html?id=${encodeURIComponent(String(inv.quote_id))}`
            : "";
        return `<tr data-quote-id="${inv.quote_id != null ? escapeHtml(String(inv.quote_id)) : ""}" ${quoteHref ? `data-href="${quoteHref}"` : ""}>
          <td>${invNum}</td>
          <td>${qNum}</td>
          <td class="mod-table__client">${client}</td>
          <td>$${amt}</td>
          <td><span class="mod-status is-${escapeHtml(slug)}">${escapeHtml(statusLabel(inv.status))}</span></td>
          <td class="mod-table__muted">${escapeHtml(sentAt)}</td>
        </tr>`;
      })
      .join("");
    tbody.querySelectorAll("tr[data-href]").forEach((tr) => {
      tr.addEventListener("click", () => {
        window.location.href = tr.getAttribute("data-href");
      });
    });
  }

  function buildListParams(status, q, pageNum, limit) {
    const params = new URLSearchParams({
      page: String(pageNum),
      limit: String(limit),
    });
    if (status && status !== "all") params.set("status", status);
    else params.set("status", "all");
    if (q) params.set("q", q);
    return params;
  }

  async function fetchInvoiceList(params) {
    // Prefer SF-compatible path; fall back to SaaS /api/invoices
    try {
      return await api(`/api/quote-invoices?${params}`);
    } catch (e1) {
      try {
        return await api(`/api/invoices?${params}`);
      } catch (e2) {
        throw e1;
      }
    }
  }

  async function loadOverviewStats(q) {
    const params = buildListParams("all", q, 1, 100);
    const j = await fetchInvoiceList(params);
    renderOverview(j.data || []);
  }

  async function loadInvoices() {
    const q = $("filterQ").value.trim();
    const status = $("filterStatus").value || "all";
    const params = buildListParams(status, q, page, LIMIT);

    const j = await fetchInvoiceList(params);
    const rows = j.data || [];
    const total = typeof j.total === "number" ? j.total : rows.length;
    renderTable(rows);

    const pages = Math.max(1, Math.ceil(total / LIMIT));
    $("pageInfo").textContent = `Page ${page} / ${pages}`;
    $("btnPrevPage").disabled = page <= 1;
    $("btnNextPage").disabled = page >= pages;

    await loadOverviewStats(q).catch(() => {});
  }

  async function boot() {
    try {
      const s = await api("/api/auth/session");
      if (!s.authenticated) {
        location.href = "/login.html";
        return;
      }
      const perms = s.user?.permissions || [];
      const role = s.user?.role || "";
      window.__crmPermissionKeys = perms;
      window.__crmUserRole = role;
      $("sidebarUserName").textContent = s.user?.name || s.user?.email || "—";
      $("sidebarUserRole").textContent = role || "";

      $("btnReload").addEventListener("click", () => loadInvoices().catch((e) => notify(e.message, "error")));
      $("btnPrevPage").addEventListener("click", () => {
        if (page > 1) {
          page -= 1;
          loadInvoices().catch((e) => notify(e.message, "error"));
        }
      });
      $("btnNextPage").addEventListener("click", () => {
        page += 1;
        loadInvoices().catch((e) => notify(e.message, "error"));
      });
      $("filterStatus").addEventListener("change", () => {
        page = 1;
        loadInvoices().catch((e) => notify(e.message, "error"));
      });
      $("filterQ").addEventListener("input", () => {
        clearTimeout($("filterQ")._t);
        $("filterQ")._t = setTimeout(() => {
          page = 1;
          loadInvoices().catch((e) => notify(e.message, "error"));
        }, 280);
      });

      await loadInvoices();
    } catch (err) {
      notify(err.message || "Falha ao carregar", "error");
      // Only bounce to login when session check failed
      if (/HTTP 401|não autenticado|unauth|session/i.test(String(err.message || ""))) {
        location.href = "/login.html";
      } else {
        const tbody = $("invoicesTableBody");
        if (tbody) {
          tbody.innerHTML = `<tr><td colspan="6" class="mod-empty">${escapeHtml(err.message || "Erro ao carregar invoices")}</td></tr>`;
        }
      }
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
