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
      draft: "Rascunho",
      sent: "Enviado",
      viewed: "Visualizado",
      approved: "Aprovado",
      accepted: "Aceite",
      rejected: "Rejeitado",
      declined: "Recusado",
      expired: "Expirado",
    };
    const s = String(status || "draft").toLowerCase();
    return map[s] || status || "Rascunho";
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
      totalCount === 1 ? "1 orçamento" : `${totalCount} orçamentos`;
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
    const list = $("quotesTableBody");
    const countEl = $("quotesResultCount");
    const subEl = $("quotesListSubtitle");
    if (countEl) {
      countEl.textContent =
        rows.length === 1 ? "1 resultado" : `${rows.length} resultados`;
    }
    if (subEl) {
      subEl.textContent =
        rows.length === 0
          ? "Nenhum orçamento"
          : rows.length === 1
            ? "1 orçamento nesta página"
            : `${rows.length} orçamentos nesta página`;
    }
    if (!rows.length) {
      list.innerHTML = '<p class="customers-list-empty">Nenhum orçamento encontrado.</p>';
      return;
    }
    list.innerHTML = rows
      .map((q, i) => {
        const client = escapeHtml(q.customer_name || q.lead_name || "—");
        const qnum = escapeHtml(q.quote_number != null ? String(q.quote_number) : "—");
        const amt = Number(q.total_amount || 0).toLocaleString(undefined, {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        });
        const slug = statusSlug(q.status);
        const created = q.created_at
          ? new Date(q.created_at).toLocaleDateString("pt-BR", {
              day: "2-digit",
              month: "short",
              year: "numeric",
            })
          : "—";
        const av = escapeHtml(initials(q.customer_name || q.lead_name || "OR"));
        return `
        <article class="customers-row customers-row--quote" role="listitem" tabindex="0" data-id="${escapeHtml(String(q.id))}" style="--av-hue:${(i * 47) % 360}">
          <div class="customers-row__identity">
            <span class="customers-row__av" aria-hidden="true">${av}</span>
            <div class="customers-row__who">
              <div class="customers-row__name" title="${client}">${client}</div>
              <div class="customers-row__refs"><span class="customers-ref">#${qnum}</span></div>
            </div>
          </div>
          <div class="customers-row__amt tabular-nums">$${amt}</div>
          <div class="customers-row__status"><span class="mod-status is-${escapeHtml(slug)}">${escapeHtml(statusLabel(q.status))}</span></div>
          <div class="customers-row__pdf"></div>
          <div class="customers-row__local">${escapeHtml(created)}</div>
          <div class="customers-row__actions">
            <button type="button" class="btn btn-sm btn-secondary" data-open-quote="${escapeHtml(String(q.id))}">Abrir</button>
          </div>
        </article>`;
      })
      .join("");
    list.querySelectorAll("[data-id]").forEach((row) => {
      const open = () => {
        window.location.href = `quote-builder.html?id=${encodeURIComponent(row.getAttribute("data-id"))}`;
      };
      row.addEventListener("click", (e) => {
        if (e.target.closest("button, a")) return;
        open();
      });
      row.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          open();
        }
      });
    });
    list.querySelectorAll("[data-open-quote]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        window.location.href = `quote-builder.html?id=${encodeURIComponent(btn.getAttribute("data-open-quote"))}`;
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
      canEdit = role === "admin" || perms.includes("quotes.edit");
      window.__crmPermissionKeys = perms;
      window.__crmUserRole = role;
      const sn = $("sidebarUserName");
      if (sn) sn.textContent = s.user?.name || s.user?.email || "—";
      const sr = $("sidebarUserRole");
      if (sr) sr.textContent = role || "";

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
