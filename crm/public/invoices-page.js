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

  function initials(name) {
    const parts = String(name || "")
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    if (!parts.length) return "?";
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  function renderTable(rows) {
    const list = $("invoicesTableBody");
    const countEl = $("invoicesResultCount");
    const subEl = $("invoicesListSubtitle");
    if (countEl) {
      countEl.textContent =
        rows.length === 1 ? "1 resultado" : `${rows.length} resultados`;
    }
    if (subEl) {
      subEl.textContent =
        rows.length === 0
          ? "Nenhum invoice"
          : rows.length === 1
            ? "1 invoice nesta página"
            : `${rows.length} invoices nesta página`;
    }
    if (!rows.length) {
      list.innerHTML = '<p class="customers-list-empty">Nenhum invoice encontrado.</p>';
      return;
    }
    list.innerHTML = rows
      .map((inv, i) => {
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
            sentAt = new Date(raw).toLocaleDateString("pt-BR", {
              day: "2-digit",
              month: "short",
              year: "numeric",
            });
          } catch (_) {}
        }
        const quoteHref =
          inv.quote_id != null
            ? `quote-builder.html?id=${encodeURIComponent(String(inv.quote_id))}`
            : "";
        const av = escapeHtml(initials(inv.customer_name || inv.quote_title || "IN"));
        const openBtn = quoteHref
          ? `<button type="button" class="btn btn-sm btn-secondary" data-href="${escapeHtml(quoteHref)}">Quote</button>`
          : '<span class="customers-row__muted">—</span>';
        return `
        <article class="customers-row customers-row--invoice" role="listitem" ${quoteHref ? `data-href="${escapeHtml(quoteHref)}" tabindex="0"` : ""} style="--av-hue:${(i * 47) % 360}">
          <div class="customers-row__identity">
            <span class="customers-row__av" aria-hidden="true">${av}</span>
            <div class="customers-row__who">
              <div class="customers-row__name" title="${client}">${client}</div>
              <div class="customers-row__refs">
                <span class="customers-ref">${invNum}</span>
                <span class="customers-ref customers-ref--lead">Q · ${qNum}</span>
              </div>
            </div>
          </div>
          <div class="customers-row__amt tabular-nums">$${amt}</div>
          <div class="customers-row__status"><span class="mod-status is-${escapeHtml(slug)}">${escapeHtml(statusLabel(inv.status))}</span></div>
          <div class="customers-row__pdf"></div>
          <div class="customers-row__local">${escapeHtml(sentAt)}</div>
          <div class="customers-row__actions">${openBtn}</div>
        </article>`;
      })
      .join("");
    list.querySelectorAll("[data-href]").forEach((el) => {
      const go = () => {
        window.location.href = el.getAttribute("data-href");
      };
      if (el.tagName === "BUTTON") {
        el.addEventListener("click", (e) => {
          e.stopPropagation();
          go();
        });
        return;
      }
      el.addEventListener("click", (e) => {
        if (e.target.closest("button, a")) return;
        go();
      });
      el.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          go();
        }
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
    $("pageInfo").textContent = `Página ${page} de ${pages}`;
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
      $("sidebarUserName") && ($("sidebarUserName").textContent = s.user?.name || s.user?.email || "—");
      $("sidebarUserRole") && ($("sidebarUserRole").textContent = role || "");

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
        const list = $("invoicesTableBody");
        if (list) {
          list.innerHTML = `<p class="customers-list-empty">${escapeHtml(err.message || "Erro ao carregar invoices")}</p>`;
        }
      }
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
