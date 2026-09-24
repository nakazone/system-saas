(function () {
  let canManage = false;
  let editingId = null;

  function $(id) {
    return document.getElementById(id);
  }

  function notify(msg, type) {
    if (typeof window.crmNotify === "function") window.crmNotify(msg, type || "info");
    else alert(msg);
  }

  function toLocalInput(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function fromLocalInput(v) {
    if (!v) return null;
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return null;
    return d.toISOString();
  }

  function fmtWhen(start, end) {
    if (!start) return "—";
    const s = new Date(start);
    const e = end ? new Date(end) : null;
    const opts = { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" };
    const a = s.toLocaleString(undefined, opts);
    if (!e) return a;
    return `${a} → ${e.toLocaleString(undefined, { hour: "2-digit", minute: "2-digit" })}`;
  }

  async function api(url, opts) {
    const r = await fetch(url, {
      credentials: "include",
      headers: { "Content-Type": "application/json", ...(opts && opts.headers) },
      ...opts,
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.success === false) {
      throw new Error(j.error || `HTTP ${r.status}`);
    }
    return j;
  }

  function fillSelect(el, items, mapFn) {
    const cur = el.value;
    el.innerHTML = '<option value="">—</option>';
    items.forEach((item) => {
      const opt = document.createElement("option");
      const mapped = mapFn(item);
      opt.value = mapped.value;
      opt.textContent = mapped.label;
      el.appendChild(opt);
    });
    if (cur) el.value = cur;
  }

  async function loadLookups() {
    const [users, customers, builders] = await Promise.all([
      api("/api/users?limit=100").catch(() => ({ data: [] })),
      api("/api/customers?limit=100").catch(() => ({ data: [] })),
      api("/api/builders?limit=100").catch(() => api("/api/builders/select").catch(() => ({ data: [] }))),
    ]);

    const userList = Array.isArray(users.data) ? users.data : [];
    fillSelect($("jobAssignee"), userList.filter((u) => u.is_active !== 0 && u.status !== "disabled"), (u) => ({
      value: u.id,
      label: u.name || u.email,
    }));

    const custList = Array.isArray(customers.data) ? customers.data : [];
    fillSelect($("jobCustomer"), custList, (c) => ({
      value: c.id,
      label: c.name || c.company || c.id,
    }));

    const bList = Array.isArray(builders.data) ? builders.data : [];
    fillSelect($("jobBuilder"), bList, (b) => ({
      value: b.id,
      label: b.company || b.name || [b.first_name, b.last_name].filter(Boolean).join(" ") || b.id,
    }));
  }

  async function loadJobs() {
    const q = $("filterQ").value.trim();
    const status = $("filterStatus").value;
    const source = $("filterSource").value;
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (status) params.set("status", status);
    if (source) params.set("source", source);
    const j = await api(`/api/work-orders?${params}`);
    const rows = j.data || [];
    const tbody = $("jobsTableBody");
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="jobs-empty">Nenhum job encontrado.</td></tr>';
      return;
    }
    tbody.innerHTML = rows
      .map((wo) => {
        const origin =
          wo.source_name ||
          wo.builder?.company ||
          wo.builder?.name ||
          wo.customer?.name ||
          wo.source_type;
        return `<tr data-id="${wo.id}">
          <td>${wo.number != null ? `#${wo.number}` : "—"}</td>
          <td><strong>${escapeHtml(wo.title)}</strong></td>
          <td>${escapeHtml(origin || "—")}</td>
          <td><span class="job-status is-${escapeHtml(wo.status)}">${escapeHtml(wo.status)}</span></td>
          <td>${fmtWhen(wo.scheduled_start, wo.scheduled_end)}</td>
          <td>${escapeHtml(wo.assigned_user?.name || "—")}</td>
        </tr>`;
      })
      .join("");
    tbody.querySelectorAll("tr[data-id]").forEach((tr) => {
      tr.addEventListener("click", () => openEdit(tr.getAttribute("data-id")));
    });
  }

  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function openModal(title) {
    $("jobModalTitle").textContent = title;
    $("jobModal").classList.add("is-open");
    $("jobModalBackdrop").classList.add("is-open");
    $("btnCancelWo").hidden = !editingId || !canManage;
    const hasSchedule = Boolean($("jobStart").value);
    const viewBtn = $("btnViewSchedule");
    if (viewBtn) viewBtn.hidden = !hasSchedule;
  }

  function closeModal() {
    $("jobModal").classList.remove("is-open");
    $("jobModalBackdrop").classList.remove("is-open");
    editingId = null;
    $("jobForm").reset();
    $("jobId").value = "";
    const viewBtn = $("btnViewSchedule");
    if (viewBtn) viewBtn.hidden = true;
  }

  function openCreate() {
    if (!canManage) return;
    editingId = null;
    $("jobForm").reset();
    $("jobId").value = "";
    $("jobStatus").value = "draft";
    $("jobSourceType").value = "builder";
    openModal("Novo job");
  }

  async function openEdit(id) {
    const j = await api(`/api/work-orders/${id}`);
    const wo = j.data;
    editingId = wo.id;
    $("jobId").value = wo.id;
    $("jobTitle").value = wo.title || "";
    $("jobStatus").value = wo.status || "draft";
    $("jobSourceType").value = wo.source_type || "other";
    $("jobSourceName").value = wo.source_name || "";
    $("jobCustomer").value = wo.customer_id || "";
    $("jobBuilder").value = wo.builder_id || "";
    $("jobAddress").value = wo.address || "";
    $("jobStart").value = toLocalInput(wo.scheduled_start);
    $("jobEnd").value = toLocalInput(wo.scheduled_end);
    $("jobAssignee").value = wo.assigned_user_id || "";
    $("jobNotes").value = wo.notes || "";
    openModal(wo.number != null ? `Job #${wo.number}` : "Editar job");
  }

  async function saveJob(e) {
    e.preventDefault();
    if (!canManage) return;
    const payload = {
      title: $("jobTitle").value.trim(),
      status: $("jobStatus").value,
      source_type: $("jobSourceType").value,
      source_name: $("jobSourceName").value.trim() || null,
      customer_id: $("jobCustomer").value || null,
      builder_id: $("jobBuilder").value || null,
      address: $("jobAddress").value.trim() || null,
      notes: $("jobNotes").value.trim() || null,
      assigned_user_id: $("jobAssignee").value || null,
      scheduled_start: fromLocalInput($("jobStart").value),
      scheduled_end: fromLocalInput($("jobEnd").value),
    };
    try {
      let j;
      if (editingId) {
        j = await api(`/api/work-orders/${editingId}`, { method: "PUT", body: JSON.stringify(payload) });
      } else {
        j = await api("/api/work-orders", { method: "POST", body: JSON.stringify(payload) });
      }
      if (j.conflicts && j.conflicts.length) {
        notify("Salvo com aviso de conflito de agenda.", "warning");
      } else {
        notify("Job salvo.", "success");
      }
      closeModal();
      await loadJobs();
    } catch (err) {
      notify(err.message || "Erro ao salvar", "error");
    }
  }

  async function cancelJob() {
    if (!editingId || !canManage) return;
    if (!confirm("Marcar este job como cancelado?")) return;
    try {
      await api(`/api/work-orders/${editingId}`, { method: "DELETE" });
      notify("Job cancelado.", "success");
      closeModal();
      await loadJobs();
    } catch (err) {
      notify(err.message || "Erro", "error");
    }
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
      canManage = role === "admin" || perms.includes("work_orders.manage");
      window.__crmPermissionKeys = perms;
      window.__crmUserRole = role;
      $("sidebarUserName").textContent = s.user?.name || s.user?.email || "—";
      $("sidebarUserRole").textContent = role || "";
      if (!canManage) $("btnNewJob").style.display = "none";

      $("btnNewJob").addEventListener("click", openCreate);
      $("btnCancelJob").addEventListener("click", closeModal);
      $("jobModalBackdrop").addEventListener("click", closeModal);
      $("btnCancelWo").addEventListener("click", cancelJob);
      $("jobForm").addEventListener("submit", saveJob);
      $("btnReload").addEventListener("click", () => loadJobs().catch((e) => notify(e.message, "error")));
      ["filterQ", "filterStatus", "filterSource"].forEach((id) => {
        $(id).addEventListener("change", () => loadJobs().catch(() => {}));
        $(id).addEventListener("input", () => {
          if (id === "filterQ") {
            clearTimeout($(id)._t);
            $(id)._t = setTimeout(() => loadJobs().catch(() => {}), 280);
          }
        });
      });

      await loadLookups();
      await loadJobs();

      const openId = sessionStorage.getItem("obramate_open_job");
      if (openId) {
        sessionStorage.removeItem("obramate_open_job");
        openEdit(openId).catch(() => {});
      }
    } catch (err) {
      notify(err.message || "Falha ao carregar", "error");
      location.href = "/login.html";
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
