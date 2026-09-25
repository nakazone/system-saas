/**
 * Shared Jobs create/edit modal — used by jobs.html and schedule.html.
 * window.__crmJobModal = { ready, openCreate, openEdit, close, onSaved }
 */
(function () {
  if (window.__crmJobModal) return;

  const CSS_HREF = "crm-job-modal.css?v=20260925-sections";
  let editingId = null;
  let editSection = "all";
  let canManage = false;
  let lookupsReady = false;
  let userOptions = [];
  let tempWorkersCache = [];
  let pricingCatalog = [];
  let serviceRows = [];
  const savedListeners = [];

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

  function toLocalInput(iso) {
    if (!iso) return "";
    const d = typeof iso === "string" || typeof iso === "number" ? new Date(iso) : iso;
    if (!(d instanceof Date) || Number.isNaN(d.getTime())) return "";
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function fromLocalInput(v) {
    if (!v) return null;
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return null;
    return d.toISOString();
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

  function ensureStylesheet() {
    if ([...document.querySelectorAll('link[rel="stylesheet"]')].some((l) => (l.getAttribute("href") || "").includes("crm-job-modal.css"))) {
      return;
    }
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = CSS_HREF;
    document.head.appendChild(link);
  }

  function ensureDom() {
    if ($("jobModal")) return;
    const wrap = document.createElement("div");
    wrap.innerHTML = `
<div class="jobs-modal-backdrop" id="jobModalBackdrop"></div>
<div class="jobs-modal" id="jobModal" role="dialog" aria-modal="true" aria-labelledby="jobModalTitle">
  <h2 id="jobModalTitle">Novo job</h2>
  <form class="jobs-form" id="jobForm">
    <input type="hidden" id="jobId" />
    <div class="jobs-section" data-job-section="details">
      <label>Título *
        <input type="text" id="jobTitle" required maxlength="200" />
      </label>
      <div class="jobs-form-row">
        <label>Status
          <select id="jobStatus">
            <option value="draft">Draft</option>
            <option value="scheduled">Scheduled</option>
            <option value="in_progress">In progress</option>
            <option value="completed">Completed</option>
            <option value="canceled">Canceled</option>
          </select>
        </label>
        <label>Origem
          <select id="jobSourceType">
            <option value="builder">Builder</option>
            <option value="contractor">Contractor</option>
            <option value="internal">Internal</option>
            <option value="other">Other</option>
          </select>
        </label>
      </div>
      <label>Nome da origem
        <input type="text" id="jobSourceName" maxlength="200" placeholder="Empresa / contato" />
      </label>
      <div class="jobs-form-row">
        <label>Cliente
          <select id="jobCustomer"><option value="">—</option></select>
        </label>
        <label>Builder
          <select id="jobBuilder"><option value="">—</option></select>
        </label>
      </div>
      <label>Endereço
        <input type="text" id="jobAddress" maxlength="500" autocomplete="street-address" />
      </label>
    </div>
    <div class="jobs-section" data-job-section="schedule">
      <div class="jobs-form-row">
        <label>Início
          <input type="datetime-local" id="jobStart" />
        </label>
        <label>Fim
          <input type="datetime-local" id="jobEnd" />
        </label>
      </div>
    </div>
    <div class="jobs-section" data-job-section="team">
      <label>Responsável
        <select id="jobAssignee"><option value="">—</option></select>
      </label>
      <fieldset class="jobs-team-fieldset">
        <legend>Equipe</legend>
        <p class="jobs-hint">Selecione vários funcionários para este job (além do responsável).</p>
        <div class="jobs-team-list" id="jobTeamList"></div>
      </fieldset>
      <div class="jobs-temp-block" id="jobTempBlock" hidden>
        <div class="jobs-temp-head">
          <strong>Funcionários temporários (avulsos)</strong>
          <span class="jobs-hint">Cadastre e envie o ticket por WhatsApp ou SMS. Informe o telefone com DDD.</span>
        </div>
        <div class="jobs-temp-form">
          <input type="text" id="tempName" maxlength="200" placeholder="Nome *" autocomplete="off" />
          <input type="tel" id="tempPhone" maxlength="40" placeholder="Telefone (WhatsApp)" autocomplete="tel" />
          <input type="email" id="tempEmail" maxlength="200" placeholder="E-mail" autocomplete="email" />
          <button type="button" class="btn btn-secondary btn-sm" id="btnAddTemp">Adicionar</button>
        </div>
        <ul class="jobs-temp-list" id="jobTempList"></ul>
      </div>
    </div>
    <div class="jobs-section" data-job-section="services">
      <fieldset class="jobs-services-fieldset">
        <legend>Serviços</legend>
        <p class="jobs-hint">Preço Loja do catálogo; se o job for Builder, usa preço partner quando existir.</p>
        <div id="jobServicesList" class="jobs-services-list"></div>
        <button type="button" class="btn btn-secondary btn-sm" id="btnAddService">+ Serviço</button>
        <p class="jobs-services-total" id="jobServicesTotal">Total: $0.00</p>
      </fieldset>
    </div>
    <div class="jobs-section" data-job-section="notes">
      <label>Notas
        <textarea id="jobNotes" rows="3" maxlength="8000"></textarea>
      </label>
    </div>
    <div class="jobs-modal-actions">
      <a class="btn btn-secondary" id="btnViewJob" href="jobs.html" hidden>Abrir job</a>
      <a class="btn btn-secondary" id="btnViewSchedule" href="schedule.html" hidden>Ver no Schedule</a>
      <button type="button" class="btn btn-secondary" id="btnCancelJob">Cancelar</button>
      <button type="button" class="btn btn-danger" id="btnCancelWo" hidden>Excluir job</button>
      <button type="submit" class="btn btn-primary" id="btnSaveJob">Salvar</button>
    </div>
  </form>
</div>`;
    while (wrap.firstChild) document.body.appendChild(wrap.firstChild);
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


  function money(n) {
    return (Number(n) || 0).toLocaleString(undefined, { style: "currency", currency: "USD" });
  }

  function usePartnerPrice() {
    const src = $("jobSourceType")?.value;
    const builderId = $("jobBuilder")?.value;
    return src === "builder" || Boolean(builderId);
  }

  function unitPriceForItem(item) {
    if (!item) return 0;
    if (usePartnerPrice() && item.partner_price != null && item.partner_price !== "") {
      return Number(item.partner_price) || 0;
    }
    return Number(item.price_loja != null ? item.price_loja : item.price_min) || 0;
  }

  function renderServices() {
    const box = $("jobServicesList");
    if (!box) return;
    if (!serviceRows.length) {
      box.innerHTML = '<p class="jobs-hint">Nenhum serviço. Clique em + Serviço.</p>';
      updateServicesTotal();
      return;
    }
    const opts = ['<option value="">— Personalizado —</option>']
      .concat(
        pricingCatalog.map(
          (p) =>
            `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)} (${escapeHtml(p.category || "")})</option>`,
        ),
      )
      .join("");
    box.innerHTML = serviceRows
      .map((row, idx) => {
        return `<div class="jobs-service-row" data-idx="${idx}">
          <select class="js-svc-pricing" data-idx="${idx}">${opts}</select>
          <input type="text" class="js-svc-name" data-idx="${idx}" maxlength="200" placeholder="Tipo de serviço" value="${escapeHtml(row.service_name || "")}" />
          <input type="number" class="js-svc-qty" data-idx="${idx}" min="0" step="0.01" placeholder="Sqft" value="${row.quantity_sqft != null ? escapeHtml(String(row.quantity_sqft)) : ""}" />
          <input type="number" class="js-svc-price" data-idx="${idx}" min="0" step="0.01" placeholder="Preço $" value="${row.unit_price != null ? escapeHtml(String(row.unit_price)) : ""}" />
          <button type="button" class="btn btn-danger btn-sm js-svc-del" data-idx="${idx}" title="Remover">×</button>
        </div>`;
      })
      .join("");
    serviceRows.forEach((row, idx) => {
      const sel = box.querySelector(`.js-svc-pricing[data-idx="${idx}"]`);
      if (sel && row.pricing_item_id) sel.value = row.pricing_item_id;
    });
    updateServicesTotal();
  }

  function updateServicesTotal() {
    const total = serviceRows.reduce((s, r) => s + (Number(r.quantity_sqft) || 0) * (Number(r.unit_price) || 0), 0);
    const el = $("jobServicesTotal");
    if (el) el.textContent = `Total: ${money(total)}`;
  }

  function collectServiceRowsFromDom() {
    const box = $("jobServicesList");
    if (!box) return serviceRows;
    const next = [];
    box.querySelectorAll(".jobs-service-row").forEach((rowEl) => {
      const idx = Number(rowEl.getAttribute("data-idx"));
      const pricing = rowEl.querySelector(".js-svc-pricing")?.value || null;
      const name = (rowEl.querySelector(".js-svc-name")?.value || "").trim();
      const qty = Number(rowEl.querySelector(".js-svc-qty")?.value) || 0;
      const price = Number(rowEl.querySelector(".js-svc-price")?.value) || 0;
      if (!name && !pricing && !qty && !price) return;
      next.push({
        pricing_item_id: pricing || null,
        service_name: name || pricingCatalog.find((p) => p.id === pricing)?.name || "Serviço",
        quantity_sqft: qty,
        unit_price: price,
      });
    });
    serviceRows = next;
    return serviceRows;
  }

  function addServiceRow(preset) {
    collectServiceRowsFromDom();
    serviceRows.push(
      preset || {
        pricing_item_id: null,
        service_name: "",
        quantity_sqft: 0,
        unit_price: 0,
      },
    );
    renderServices();
  }

  function applyPricingToRow(idx) {
    collectServiceRowsFromDom();
    const row = serviceRows[idx];
    if (!row) return;
    const item = pricingCatalog.find((p) => p.id === row.pricing_item_id);
    if (item) {
      row.service_name = item.name;
      row.unit_price = unitPriceForItem(item);
    }
    renderServices();
  }

  function refreshPricesFromCatalog() {
    collectServiceRowsFromDom();
    serviceRows.forEach((row) => {
      if (!row.pricing_item_id) return;
      const item = pricingCatalog.find((p) => p.id === row.pricing_item_id);
      if (item) row.unit_price = unitPriceForItem(item);
    });
    renderServices();
  }


  function renderTeamCheckboxes(selectedIds) {
    const box = $("jobTeamList");
    if (!box) return;
    const selected = new Set((selectedIds || []).map(String));
    if (!userOptions.length) {
      box.innerHTML = '<p class="jobs-hint">Nenhum utilizador disponível.</p>';
      return;
    }
    box.innerHTML = userOptions
      .map(
        (u) => `<label class="jobs-team-item">
          <input type="checkbox" class="job-team-cb" value="${escapeHtml(u.id)}" ${selected.has(String(u.id)) ? "checked" : ""} />
          <span>${escapeHtml(u.name || u.email)}</span>
        </label>`,
      )
      .join("");
  }

  function selectedMemberIds() {
    return [...document.querySelectorAll(".job-team-cb:checked")].map((el) => el.value);
  }

  function renderTempList() {
    const list = $("jobTempList");
    const block = $("jobTempBlock");
    if (!list || !block) return;
    block.hidden = !editingId || !canManage;
    if (!editingId) {
      list.innerHTML = "";
      return;
    }
    if (!tempWorkersCache.length) {
      list.innerHTML = '<li class="jobs-hint">Ainda sem temporários neste job.</li>';
      return;
    }
    list.innerHTML = tempWorkersCache
      .map((t) => {
        const share = t.share || {};
        const hasShare = Boolean(share.url);
        return `<li data-temp-id="${escapeHtml(t.id)}">
          <div class="jobs-temp-row">
            <div>
              <strong>${escapeHtml(t.name)}</strong>
              <span class="jobs-hint">${escapeHtml([t.phone, t.email].filter(Boolean).join(" · ") || "Sem telefone — adicione para WhatsApp direto")}</span>
            </div>
            <div class="jobs-temp-actions">
              <button type="button" class="btn btn-primary btn-sm job-temp-wa" data-id="${escapeHtml(t.id)}">WhatsApp</button>
              <button type="button" class="btn btn-secondary btn-sm job-temp-sms" data-id="${escapeHtml(t.id)}">SMS</button>
              <button type="button" class="btn btn-secondary btn-sm job-temp-copy" data-id="${escapeHtml(t.id)}">Copiar link</button>
              <button type="button" class="btn btn-danger btn-sm job-temp-del" data-id="${escapeHtml(t.id)}">Remover</button>
            </div>
          </div>
          <p class="jobs-temp-link-out" id="tempLinkOut-${escapeHtml(t.id)}" ${hasShare ? "" : "hidden"}>
            ${
              hasShare
                ? `<a href="${escapeHtml(share.url)}" target="_blank" rel="noopener">${escapeHtml(share.url)}</a>`
                : ""
            }
          </p>
        </li>`;
      })
      .join("");
  }

  function showShareOut(id, share) {
    const out = document.getElementById(`tempLinkOut-${id}`);
    if (!out || !share?.url) return;
    out.hidden = false;
    out.innerHTML = `<a href="${escapeHtml(share.url)}" target="_blank" rel="noopener">${escapeHtml(share.url)}</a>`;
  }

  async function ensureTempShare(id) {
    const cached = tempWorkersCache.find((t) => t.id === id);
    if (cached?.share?.url && cached.share.whatsapp_url) return cached.share;
    const j = await api(`/api/work-orders/${editingId}/temp-workers/${id}/share-link`, { method: "POST" });
    const share = {
      url: j.data?.url || "",
      whatsapp_url: j.data?.whatsapp_url || "",
      sms_url: j.data?.sms_url || "",
      expires_at: j.data?.expires_at || null,
    };
    tempWorkersCache = tempWorkersCache.map((t) => (t.id === id ? { ...t, share } : t));
    showShareOut(id, share);
    return share;
  }

  async function sendTempShare(id, channel) {
    if (!editingId || !canManage) return;
    try {
      const share = await ensureTempShare(id);
      if (!share?.url) throw new Error("Não foi possível gerar o link");
      if (channel === "whatsapp" && share.whatsapp_url) {
        window.open(share.whatsapp_url, "_blank", "noopener");
        notify("Abra o WhatsApp e envie a mensagem.", "success");
        return;
      }
      if (channel === "sms" && share.sms_url) {
        window.location.href = share.sms_url;
        notify("Abra o SMS e envie a mensagem.", "success");
        return;
      }
      if (channel === "copy") {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(share.url);
          notify("Link copiado. Cole no WhatsApp ou SMS.", "success");
        } else {
          window.prompt("Copie o link do ticket:", share.url);
        }
      }
    } catch (err) {
      notify(err.message || "Erro ao gerar/enviar o link", "error");
    }
  }

  async function loadLookups() {
    if (lookupsReady) return;
    const [users, customers, builders, pricing] = await Promise.all([
      api("/api/users?limit=100").catch(() => ({ data: [] })),
      api("/api/customers?limit=100").catch(() => ({ data: [] })),
      api("/api/builders?limit=100").catch(() => api("/api/builders/select").catch(() => ({ data: [] }))),
      api("/api/work-orders/pricing-catalog").catch(() => ({ data: [] })),
    ]);
    pricingCatalog = Array.isArray(pricing.data) ? pricing.data : [];

    const userList = Array.isArray(users.data) ? users.data : [];
    userOptions = userList.filter((u) => u.is_active !== 0 && u.status !== "disabled");
    fillSelect($("jobAssignee"), userOptions, (u) => ({
      value: u.id,
      label: u.name || u.email,
    }));
    renderTeamCheckboxes([]);

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

    lookupsReady = true;

    if (window.sfAttachAddressAutocomplete && $("jobAddress")) {
      try {
        window.sfAttachAddressAutocomplete($("jobAddress"), {
          map: { combined: $("jobAddress") },
        });
      } catch (_) {}
    }
  }


  const SECTION_TITLES = {
    all: null,
    details: "Editar detalhes",
    schedule: "Editar agenda",
    team: "Equipe & temporários",
    services: "Serviços do job",
    notes: "Notas",
  };

  function applySectionVisibility(section) {
    editSection = section || "all";
    const form = $("jobForm");
    if (!form) return;
    const showAll = !editSection || editSection === "all";
    form.querySelectorAll("[data-job-section]").forEach((el) => {
      const key = el.getAttribute("data-job-section");
      el.hidden = !(showAll || key === editSection);
    });
    const titleEl = $("jobTitle");
    if (titleEl) {
      // Hidden required fields block submit in some browsers
      titleEl.required = showAll || editSection === "details";
    }
    // Temps only when editing an existing job in team/all
    if ($("jobTempBlock")) {
      const teamVisible = showAll || editSection === "team";
      if (!teamVisible) $("jobTempBlock").hidden = true;
      else renderTempList();
    }
    $("btnCancelWo").hidden = !(showAll && editingId && canManage);
  }

  function openModal(title) {
    const sectionTitle = SECTION_TITLES[editSection];
    $("jobModalTitle").textContent = sectionTitle || title;
    $("jobModal").classList.add("is-open");
    $("jobModalBackdrop").classList.add("is-open");
    applySectionVisibility(editSection);
    renderTempList();
    const onDetail = /job-detail\.html/i.test(location.pathname);
    const viewJob = $("btnViewJob");
    if (viewJob) {
      if (editingId && !onDetail) {
        viewJob.hidden = false;
        viewJob.href = `job-detail.html?id=${encodeURIComponent(editingId)}`;
      } else {
        viewJob.hidden = true;
      }
    }
    const hasSchedule = Boolean($("jobStart").value);
    const viewBtn = $("btnViewSchedule");
    if (viewBtn) {
      const onSchedule = /schedule\.html/i.test(location.pathname);
      viewBtn.hidden = onSchedule || !hasSchedule;
    }
  }

  function close() {
    $("jobModal")?.classList.remove("is-open");
    $("jobModalBackdrop")?.classList.remove("is-open");
    editingId = null;
    editSection = "all";
    applySectionVisibility("all");
    tempWorkersCache = [];
    serviceRows = [];
    if ($("jobForm")) $("jobForm").reset();
    if ($("jobId")) $("jobId").value = "";
    renderTeamCheckboxes([]);
    renderServices();
    renderTempList();
    const viewBtn = $("btnViewSchedule");
    if (viewBtn) viewBtn.hidden = true;
    const viewJob = $("btnViewJob");
    if (viewJob) viewJob.hidden = true;
  }

  async function openCreate(opts) {
    if (!canManage) {
      notify("Sem permissão para criar jobs.", "error");
      return;
    }
    await loadLookups();
    editingId = null;
    editSection = "all";
    tempWorkersCache = [];
    serviceRows = [];
    $("jobForm").reset();
    $("jobId").value = "";
    $("jobStatus").value = "scheduled";
    $("jobSourceType").value = "builder";
    renderTeamCheckboxes([]);
    renderServices();

    let start = null;
    if (opts && opts.start) start = new Date(opts.start);
    if (!start || Number.isNaN(start.getTime())) {
      const pref = sessionStorage.getItem("obramate_job_pref_start");
      if (pref) {
        sessionStorage.removeItem("obramate_job_pref_start");
        start = new Date(pref);
      }
    }
    if (start && !Number.isNaN(start.getTime())) {
      $("jobStart").value = toLocalInput(start);
      const end = new Date(start);
      end.setHours(end.getHours() + 2);
      $("jobEnd").value = toLocalInput(end);
      $("jobStatus").value = "scheduled";
    }
    openModal("Novo job");
  }

  async function openEdit(id, opts) {
    await loadLookups();
    editSection = (opts && opts.section) || "all";
    const j = await api(`/api/work-orders/${id}`);
    const wo = j.data;
    editingId = wo.id;
    tempWorkersCache = Array.isArray(wo.temp_workers) ? wo.temp_workers : [];
    serviceRows = (Array.isArray(wo.line_items) ? wo.line_items : []).map((li) => ({
      pricing_item_id: li.pricing_item_id || null,
      service_name: li.service_name || "",
      quantity_sqft: li.quantity_sqft || 0,
      unit_price: li.unit_price || 0,
    }));
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
    renderTeamCheckboxes((wo.members || []).map((m) => m.user_id));
    renderServices();
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
      member_user_ids: selectedMemberIds(),
      line_items: collectServiceRowsFromDom().filter((r) => r.service_name),
      scheduled_start: fromLocalInput($("jobStart").value),
      scheduled_end: fromLocalInput($("jobEnd").value),
    };
    try {
      let j;
      const wasCreate = !editingId;
      if (editingId) {
        j = await api(`/api/work-orders/${editingId}`, { method: "PUT", body: JSON.stringify(payload) });
      } else {
        j = await api("/api/work-orders", { method: "POST", body: JSON.stringify(payload) });
      }
      if (j.conflicts && j.conflicts.length) {
        notify("Salvo com aviso de conflito de agenda.", "warning");
      } else {
        notify(wasCreate ? "Job criado. Pode adicionar temporários e enviar o ticket." : "Job salvo.", "success");
      }
      if (wasCreate && j.data?.id) {
        editingId = j.data.id;
        $("jobId").value = editingId;
        tempWorkersCache = Array.isArray(j.data.temp_workers) ? j.data.temp_workers : [];
        serviceRows = (Array.isArray(j.data.line_items) ? j.data.line_items : []).map((li) => ({
          pricing_item_id: li.pricing_item_id || null,
          service_name: li.service_name || "",
          quantity_sqft: li.quantity_sqft || 0,
          unit_price: li.unit_price || 0,
        }));
        renderTeamCheckboxes((j.data.members || []).map((m) => m.user_id));
        renderServices();
        openModal(j.data.number != null ? `Job #${j.data.number}` : "Editar job");
        savedListeners.forEach((fn) => {
          try {
            fn(j.data);
          } catch (_) {}
        });
        return;
      }
      // Keep modal open on edit so temps can be shared without reopening
      if (editingId && j.data) {
        tempWorkersCache = Array.isArray(j.data.temp_workers) ? j.data.temp_workers : tempWorkersCache;
        renderTempList();
        savedListeners.forEach((fn) => {
          try {
            fn(j.data);
          } catch (_) {}
        });
        return;
      }
      close();
      savedListeners.forEach((fn) => {
        try {
          fn(j.data);
        } catch (_) {}
      });
    } catch (err) {
      notify(err.message || "Erro ao salvar", "error");
    }
  }

  async function cancelJob() {
    if (!editingId || !canManage) return;
    if (!confirm("Excluir este job? Ele será marcado como cancelado e sairá da agenda.")) return;
    try {
      await api(`/api/work-orders/${editingId}`, { method: "DELETE" });
      notify("Job excluído.", "success");
      close();
      savedListeners.forEach((fn) => {
        try {
          fn(null);
        } catch (_) {}
      });
    } catch (err) {
      notify(err.message || "Erro", "error");
    }
  }

  async function addTempWorker() {
    if (!editingId || !canManage) return;
    const name = ($("tempName")?.value || "").trim();
    if (name.length < 2) {
      notify("Informe o nome do temporário.", "error");
      return;
    }
    try {
      const j = await api(`/api/work-orders/${editingId}/temp-workers`, {
        method: "POST",
        body: JSON.stringify({
          name,
          phone: ($("tempPhone")?.value || "").trim() || null,
          email: ($("tempEmail")?.value || "").trim() || null,
        }),
      });
      const row = { ...j.data, share: j.data?.share || null };
      tempWorkersCache = [...tempWorkersCache, row];
      if ($("tempName")) $("tempName").value = "";
      if ($("tempPhone")) $("tempPhone").value = "";
      if ($("tempEmail")) $("tempEmail").value = "";
      renderTempList();
      notify("Temporário adicionado. Use WhatsApp ou SMS para enviar o ticket.", "success");
      if (row.share?.url) showShareOut(row.id, row.share);
    } catch (err) {
      notify(err.message || "Erro ao adicionar temporário", "error");
    }
  }

  async function deleteTempWorker(id) {
    if (!editingId || !canManage) return;
    if (!confirm("Remover este funcionário temporário? O link dele deixa de funcionar.")) return;
    try {
      await api(`/api/work-orders/${editingId}/temp-workers/${id}`, { method: "DELETE" });
      tempWorkersCache = tempWorkersCache.filter((t) => t.id !== id);
      renderTempList();
      notify("Removido.", "success");
    } catch (err) {
      notify(err.message || "Erro", "error");
    }
  }

  function bindOnce() {
    if (document.body.dataset.crmJobModalBound === "1") return;
    document.body.dataset.crmJobModalBound = "1";
    $("btnCancelJob").addEventListener("click", close);
    $("jobModalBackdrop").addEventListener("click", close);
    $("btnCancelWo").addEventListener("click", cancelJob);
    $("jobForm").addEventListener("submit", saveJob);
    $("btnAddTemp")?.addEventListener("click", () => addTempWorker());
    ["tempName", "tempPhone", "tempEmail"].forEach((id) => {
      $(id)?.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          addTempWorker();
        }
      });
    });
    $("btnAddService")?.addEventListener("click", () => addServiceRow());
    $("jobSourceType")?.addEventListener("change", () => refreshPricesFromCatalog());
    $("jobBuilder")?.addEventListener("change", () => refreshPricesFromCatalog());
    $("jobServicesList")?.addEventListener("change", (e) => {
      const t = e.target;
      if (t.classList.contains("js-svc-pricing")) {
        const idx = Number(t.getAttribute("data-idx"));
        collectServiceRowsFromDom();
        if (serviceRows[idx]) serviceRows[idx].pricing_item_id = t.value || null;
        applyPricingToRow(idx);
      }
    });
    $("jobServicesList")?.addEventListener("input", (e) => {
      const t = e.target;
      if (t.classList.contains("js-svc-qty") || t.classList.contains("js-svc-price") || t.classList.contains("js-svc-name")) {
        collectServiceRowsFromDom();
        updateServicesTotal();
      }
    });
    $("jobServicesList")?.addEventListener("click", (e) => {
      const del = e.target.closest(".js-svc-del");
      if (!del) return;
      const idx = Number(del.getAttribute("data-idx"));
      collectServiceRowsFromDom();
      serviceRows.splice(idx, 1);
      renderServices();
    });
    $("jobTempList")?.addEventListener("click", (e) => {
      const wa = e.target.closest(".job-temp-wa");
      if (wa) {
        sendTempShare(wa.getAttribute("data-id"), "whatsapp");
        return;
      }
      const sms = e.target.closest(".job-temp-sms");
      if (sms) {
        sendTempShare(sms.getAttribute("data-id"), "sms");
        return;
      }
      const copyBtn = e.target.closest(".job-temp-copy");
      if (copyBtn) {
        sendTempShare(copyBtn.getAttribute("data-id"), "copy");
        return;
      }
      const delBtn = e.target.closest(".job-temp-del");
      if (delBtn) {
        deleteTempWorker(delBtn.getAttribute("data-id"));
      }
    });
  }

  async function initPermissions() {
    try {
      const s = await api("/api/auth/session");
      const perms = s.user?.permissions || [];
      const role = s.user?.role || "";
      canManage = role === "admin" || perms.includes("work_orders.manage");
    } catch (_) {
      canManage = false;
    }
  }

  const ready = (async () => {
    ensureStylesheet();
    ensureDom();
    await initPermissions();
    bindOnce();
  })();

  window.__crmJobModal = {
    ready,
    openCreate: (opts) => ready.then(() => openCreate(opts)),
    openEdit: (id, opts) => ready.then(() => openEdit(id, opts)),
    openSection: (id, section) => ready.then(() => openEdit(id, { section: section || "all" })),
    close: () => close(),
    onSaved: (fn) => {
      if (typeof fn === "function") savedListeners.push(fn);
    },
    canManage: () => canManage,
  };
})();
