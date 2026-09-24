(function () {
  let page = 1;
  const LIMIT = 20;
  let canEdit = false;

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
      viewed: "Viewed",
      approved: "Approved",
      accepted: "Accepted",
      rejected: "Rejected",
      declined: "Declined",
      expired: "Expired",
    };
    const s = String(status || "draft").toLowerCase();
    return map[s] || status || "Draft";
  }

  function statusSlug(status) {
    const s = String(status || "draft").toLowerCase().replace(/[^a-z0-9_-]/g, "") || "draft";
    if (s === "approved") return "accepted";
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

  function renderOverview(rows, totalAmount, totalCount) {
    let draft = 0;
    let sent = 0;
    let viewed = 0;
    let accepted = 0;
    let expired = 0;
    let sent30 = 0;
    const now = Date.now();
    const dayMs = 86400000;

    rows.forEach((q) => {
      const st = statusSlug(q.status);
      if (st === "draft") draft += 1;
      else if (st === "sent") sent += 1;
      else if (st === "viewed") viewed += 1;
      else if (st === "accepted" || st === "approved") accepted += 1;
      else if (st === "expired") expired += 1;

      const sentAt = q.sent_at || q.email_sent_at || (st === "sent" || st === "viewed" ? q.updated_at || q.created_at : null);
      if (sentAt) {
        const t = new Date(sentAt).getTime();
        if (t >= now - 30 * dayMs && t <= now) sent30 += 1;
      }
    });

    $("ovDraft").textContent = String(draft);
    $("ovSent").textContent = String(sent);
    $("ovViewed").textContent = String(viewed);
    $("ovAccepted").textContent = String(accepted);
    $("ovExpired").textContent = String(expired);
    $("ovSent30").textContent = String(sent30);
    $("ovTotalAmount").textContent = fmtMoney(totalAmount);
    $("ovTotalCount").textContent =
      totalCount === 1 ? "1 quote" : `${totalCount} quotes`;
  }

  function renderTable(rows) {
    const tbody = $("quotesTableBody");
    $("quotesResultCount").textContent = `(${rows.length} result${rows.length === 1 ? "" : "s"})`;
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="5" class="mod-empty">Nenhum quote encontrado.</td></tr>';
      return;
    }
    tbody.innerHTML = rows
      .map((q) => {
        const client = escapeHtml(q.customer_name || q.lead_name || "—");
        const qnum = escapeHtml(q.quote_number != null ? String(q.quote_number) : "—");
        const amt = Number(q.total_amount || 0).toLocaleString(undefined, {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        });
        const slug = statusSlug(q.status);
        const created = q.created_at ? new Date(q.created_at).toLocaleDateString() : "—";
        return `<tr data-id="${q.id}">
          <td>${qnum}</td>
          <td class="mod-table__client">${client}</td>
          <td>$${amt}</td>
          <td><span class="mod-status is-${escapeHtml(slug)}">${escapeHtml(statusLabel(q.status))}</span></td>
          <td class="mod-table__muted">${escapeHtml(created)}</td>
        </tr>`;
      })
      .join("");
    tbody.querySelectorAll("tr[data-id]").forEach((tr) => {
      tr.addEventListener("click", () => {
        window.location.href = `quote-builder.html?id=${encodeURIComponent(tr.getAttribute("data-id"))}`;
      });
    });
  }

  async function loadOverviewStats(q) {
    const params = new URLSearchParams({ page: "1", limit: "100" });
    if (q) params.set("q", q);
    const j = await api(`/api/quotes?${params}`);
    const rows = j.data || [];
    const totalAmount =
      typeof j.total_amount === "number"
        ? j.total_amount
        : rows.reduce((s, r) => s + (Number(r.total_amount) || 0), 0);
    const totalCount = typeof j.total === "number" ? j.total : rows.length;
    renderOverview(rows, totalAmount, totalCount);
  }

  async function loadQuotes() {
    const q = $("filterQ").value.trim();
    const status = $("filterStatus").value;
    const params = new URLSearchParams({ page: String(page), limit: String(LIMIT) });
    if (q) params.set("q", q);
    if (status) params.set("status", status);

    const j = await api(`/api/quotes?${params}`);
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
      canEdit = role === "admin" || perms.includes("quotes.edit");
      window.__crmPermissionKeys = perms;
      window.__crmUserRole = role;
      $("sidebarUserName").textContent = s.user?.name || s.user?.email || "—";
      $("sidebarUserRole").textContent = role || "";

      $("btnReload").addEventListener("click", () => loadQuotes().catch((e) => notify(e.message, "error")));
      $("btnPrevPage").addEventListener("click", () => {
        if (page > 1) {
          page -= 1;
          loadQuotes().catch((e) => notify(e.message, "error"));
        }
      });
      $("btnNextPage").addEventListener("click", () => {
        page += 1;
        loadQuotes().catch((e) => notify(e.message, "error"));
      });
      $("filterStatus").addEventListener("change", () => {
        page = 1;
        loadQuotes().catch(() => {});
      });
      $("filterQ").addEventListener("input", () => {
        clearTimeout($("filterQ")._t);
        $("filterQ")._t = setTimeout(() => {
          page = 1;
          loadQuotes().catch(() => {});
        }, 280);
      });

      await loadQuotes();
    } catch (err) {
      notify(err.message || "Falha ao carregar", "error");
      location.href = "/login.html";
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
