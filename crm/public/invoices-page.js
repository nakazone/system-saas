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
      void: "Void",
    };
    const s = String(status || "").toLowerCase();
    return map[s] || status || "—";
  }

  function statusSlug(status) {
    return String(status || "").toLowerCase().replace(/[^a-z0-9_-]/g, "") || "sent";
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
    const paid = Number(inv.paid_amount || 0);
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
        const client = escapeHtml(inv.customer_name || "—");
        const amt = Number(inv.amount || 0).toLocaleString(undefined, {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        });
        const slug = statusSlug(inv.status);
        let sentAt = "—";
        const raw = inv.email_sent_at || inv.created_at;
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

  async function loadOverviewStats(q) {
    const params = new URLSearchParams({ page: "1", limit: "100", status: "all" });
    if (q) params.set("q", q);
    const j = await api(`/api/quote-invoices?${params}`);
    renderOverview(j.data || []);
  }

  async function loadInvoices() {
    const q = $("filterQ").value.trim();
    const status = $("filterStatus").value || "sent";
    const params = new URLSearchParams({
      page: String(page),
      limit: String(LIMIT),
      status,
    });
    if (q) params.set("q", q);

    const j = await api(`/api/quote-invoices?${params}`);
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
        loadInvoices().catch(() => {});
      });
      $("filterQ").addEventListener("input", () => {
        clearTimeout($("filterQ")._t);
        $("filterQ")._t = setTimeout(() => {
          page = 1;
          loadInvoices().catch(() => {});
        }, 280);
      });

      await loadInvoices();
    } catch (err) {
      notify(err.message || "Falha ao carregar", "error");
      location.href = "/login.html";
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
