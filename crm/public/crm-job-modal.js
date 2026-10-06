/**
 * Jobs create/edit modal — shared by jobs.html, schedule.html and job-detail.html.
 *
 * Create (and "Editar tudo") is one screen: Para quem → Quando → Serviços → Equipe,
 * with a live summary/total. Edit from the job page can open a single section.
 *
 * window.__crmJobModal = { ready, openCreate(opts), openEdit(id, opts), openSection(id, section),
 *                          close(), onSaved(fn), canManage() }
 */
(function () {
  if (window.__crmJobModal) return;

  const CSS_HREF = "crm-job-modal.css?v=20261006-deliv2";
  const SECTIONS = ["details", "schedule", "services", "team", "campo", "notes"];
  const SECTION_TITLES = {
    details: "Cliente e endereço",
    schedule: "Quando",
    team: "Equipe & funcionário extra",
    services: "Serviços do job",
    campo: "Atenção e checklist do campo",
    notes: "Notas",
  };
  /** Quick-start lists the office can drop into a job's checklist (appended, duplicates skipped). */
  const CK_TEMPLATES = [
    { key: "pre", name: "Pré-instalação", items: [["Umidade medida e anotada", false], ["Contrapiso nivelado e limpo", true], ["Material aclimatado", false], ["Área livre de móveis", true]] },
    { key: "install", name: "Dia da instalação", items: [["Linhas de referência marcadas", false], ["Primeiras fileiras instaladas", true], ["Transições planejadas", false], ["Limpeza no fim do dia", true]] },
    { key: "final", name: "Vistoria final", items: [["Pendências revisadas", false], ["Fotos de depois completas", true], ["Vistoria com o cliente", false], ["Guia de cuidados entregue", false]] },
  ];
  const TYPE_LABEL = { builder: "Builder", contractor: "Builder", loja: "Loja", particular: "Particular" };
  const RATE_KEY = {
    builder: "price_builder",
    contractor: "price_contractor",
    loja: "price_loja",
    internal: "price_loja",
    particular: "price_particular",
    other: "price_particular",
  };

  let canManage = false;
  let meId = null;
  let lookupsReady = false;
  let users = [];
  let customers = [];
  let builders = [];
  let pricing = [];
  const savedListeners = [];

  /** Form state */
  let st = null;

  function blankState() {
    return {
      id: null,
      number: null,
      section: "all",
      status: "draft",
      customerId: null,
      builderId: null,
      sourceType: "particular",
      sourceName: "",
      sourceNameAuto: true,
      title: "",
      titleTouched: false,
      address: "",
      addressTouched: false,
      date: "",
      time: "07:30",
      /** null | installation | sand_finish */
      sector: null,
      relatedWorkOrderId: null,
      relatedWorkOrder: null,
      relatedChildren: [],
      /** Cached installation jobs for the related-job picker. */
      installOptions: [],
      assigneeId: null,
      members: new Set(),
      lines: [],
      notes: "",
      attention: "",
      needsDelivery: false,
      deliveryPickupAddress: "",
      deliveryNotes: "",
      deliveryAttachment: null,
      deliveryAttachmentPending: null,
      clearDeliveryAttachment: false,
      /** [{ id|null, text, photo, done }] — done is read-only here (the crew ticks it in Campo). */
      checklist: [],
      temps: [],
      /** Local-only temps queued while creating the job (flushed after POST). */
      pendingTemps: [],
      pickerOpen: true,
      pickerQuery: "",
      moreOpen: false,
      busy: false,
    };
  }

  const SECTOR_OPTS = [
    { id: "", label: "Geral" },
    { id: "installation", label: "Instalação" },
    { id: "sand_finish", label: "Lixa" },
  ];
  const sectorLabel = (s) => SECTOR_OPTS.find((o) => o.id === (s || ""))?.label || "Geral";

  // ---------------------------------------------------------------- utils
  const $ = (id) => document.getElementById(id);
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

  /** `/lockbox 4821` in internal notes → house lockbox code badge. */
  function parseJobLockbox(notes) {
    const m = String(notes || "").match(/\/lockbox\s*[#:]?\s*([0-9A-Za-z-]{2,24})\b/i);
    return m ? m[1] : null;
  }
  function jobLockboxBadgeHtml(notes) {
    const code = parseJobLockbox(notes);
    if (!code) return "";
    return (
      `<span class="job-lockbox-badge" title="Código da caixa (lockbox)">` +
      `<span class="job-lockbox-badge__icon" aria-hidden="true">` +
      `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">` +
      `<rect x="5" y="11" width="14" height="10" rx="2"/>` +
      `<path d="M8 11V8a4 4 0 018 0v3"/>` +
      `<circle cx="12" cy="16" r="1.2" fill="currentColor" stroke="none"/>` +
      `</svg></span>` +
      `<span class="job-lockbox-badge__code">${esc(code)}</span>` +
      `</span>`
    );
  }
  window.parseJobLockbox = parseJobLockbox;
  window.jobLockboxBadgeHtml = jobLockboxBadgeHtml;

  function money(n) {
    return (Number(n) || 0).toLocaleString("en-US", { style: "currency", currency: "USD" });
  }
  function initials(name) {
    const parts = String(name || "?").trim().split(/\s+/).filter(Boolean);
    return ((parts[0]?.[0] || "?") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
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
  const pad = (n) => String(n).padStart(2, "0");
  function ymd(d) {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
  function hm(d) {
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  function localInput(d) {
    return d ? `${ymd(d)}T${hm(d)}` : "";
  }
  function unitLabel(unit) {
    const raw = String(unit || "").trim().toLowerCase().replace(/\s+/g, "_");
    const map = {
      sq_ft: "sq ft", sqft: "sq ft", square_feet: "sq ft", linear_ft: "lin ft", linear_feet: "lin ft", lf: "lin ft",
      step: "steps", steps: "steps", unit: "un", units: "un", each: "un", piece: "pç", pieces: "pç",
      fixed: "fixo", hour: "h", hours: "h", day: "dias", days: "dias", inches: "in", inch: "in",
    };
    return map[raw] || (unit ? String(unit).replace(/_/g, " ") : "qtd");
  }

  // ---------------------------------------------------------------- client helpers
  function builderName(b) {
    return b ? b.company || b.name || [b.first_name, b.last_name].filter(Boolean).join(" ") || "Builder" : "";
  }
  function currentCustomer() {
    return st.customerId ? customers.find((c) => String(c.id) === String(st.customerId)) || null : null;
  }
  function currentBuilder() {
    return st.builderId ? builders.find((b) => String(b.id) === String(st.builderId)) || null : null;
  }
  /** The party the job is for (and billed to): customer first, else builder. */
  function clientCard() {
    const c = currentCustomer();
    if (c) {
      return {
        name: c.name || c.company || "Cliente",
        type: (() => {
          let t = String(c.customer_type || "particular").toLowerCase();
          if (t === "contractor") t = "builder";
          return t;
        })(),
        sub: [c.company && c.company !== c.name ? c.company : null, c.phone, c.email].filter(Boolean).join(" · "),
        address: c.address || "",
        custom: c.pricing_mode === "custom",
      };
    }
    const b = currentBuilder();
    if (b) {
      const person = [b.first_name, b.last_name].filter(Boolean).join(" ");
      let bType = String(b.type || "builder").toLowerCase();
      if (bType === "contractor") bType = "builder";
      return {
        name: builderName(b),
        type: bType,
        sub: [person && person !== builderName(b) ? person : null, b.phone, b.email].filter(Boolean).join(" · "),
        address: b.address || "",
        custom: false,
      };
    }
    return null;
  }
  function pickerEntries(query) {
    const q = String(query || "").trim().toLowerCase();
    const match = (s) => !q || String(s || "").toLowerCase().includes(q);
    const bRows = builders
      .filter((b) => match(builderName(b)) || match(b.email) || match([b.first_name, b.last_name].join(" ")))
      .map((b) => ({
        kind: "builder",
        id: b.id,
        name: builderName(b),
        type: String(b.type || "builder").toLowerCase(),
        sub: [b.first_name, b.last_name].filter(Boolean).join(" ") || b.email || "",
      }));
    const cRows = customers
      .filter((c) => match(c.name) || match(c.company) || match(c.email) || match(c.phone))
      .map((c) => {
        let type = String(c.customer_type || "particular").toLowerCase();
        if (type === "contractor") type = "builder";
        return {
          kind: "customer",
          id: c.id,
          name: c.name || c.company || "Cliente",
          type,
          sub: [c.address, c.phone].filter(Boolean)[0] || "",
        };
      });
    // Fixed-price accounts (builder / loja) first — that is the day-to-day job.
    const rank = (r) => (r.type === "particular" ? 1 : 0);
    return [...bRows, ...cRows].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  }

  // ---------------------------------------------------------------- pricing
  function rateKey() {
    return RATE_KEY[st.sourceType] || "price_particular";
  }
  function customRates() {
    const c = currentCustomer();
    return c && c.pricing_mode === "custom" && c.custom_pricing_rates ? c.custom_pricing_rates : null;
  }
  function priceFor(item) {
    if (!item) return 0;
    const custom = customRates();
    if (custom) {
      const n = Number(custom[item.id]);
      if (Number.isFinite(n) && n > 0) return n;
    }
    const order = [rateKey(), "price_builder", "price_contractor", "price_loja", "price_particular"];
    for (const k of order) {
      const n = Number(item[k]);
      if (Number.isFinite(n) && n > 0) return n;
    }
    return 0;
  }
  function pricingLabel() {
    if (customRates()) return "tabela personalizada do cliente";
    const nice = { builder: "Builder", contractor: "Contractor", loja: "Loja", internal: "Loja" }[st.sourceType] || "Particular";
    return `Tabela de Valores · ${nice}`;
  }
  function lineTotal(l) {
    return Math.round((Number(l.qty) || 0) * (Number(l.price) || 0) * 100) / 100;
  }
  function linesTotal() {
    return st.lines.reduce((s, l) => s + lineTotal(l), 0);
  }
  function repriceLines() {
    st.lines.forEach((l) => {
      if (!l.pricingId || l.priceTouched) return;
      const item = pricing.find((p) => p.id === l.pricingId);
      if (item) l.price = priceFor(item);
    });
  }

  function systemRateFor(item) {
    if (!item) return 0;
    const order = [rateKey(), "price_builder", "price_contractor", "price_loja", "price_particular"];
    for (const k of order) {
      const n = Number(item[k]);
      if (Number.isFinite(n) && n > 0) return n;
    }
    return 0;
  }

  function ratesNearlyEqual(a, b) {
    return Math.abs((Number(a) || 0) - (Number(b) || 0)) < 0.009;
  }

  function pricingTypeLabel() {
    return (
      { builder: "Builder", contractor: "Contractor", loja: "Loja", internal: "Loja" }[st && st.sourceType] || "Particular"
    );
  }

  let rateSavePending = null;
  let priceEditCtx = null;

  function closeSaveRateModal() {
    const root = $("jmSaveRateModal");
    if (root) root.classList.add("hidden");
    rateSavePending = null;
  }

  function openSaveRateModal(payload) {
    ensureRateModal();
    const root = $("jmSaveRateModal");
    if (!root) return;
    rateSavePending = payload;
    const typeLabel = payload.typeLabel || pricingTypeLabel();
    const customer = payload.customer || null;
    const customerName = customer && (customer.name || customer.company) ? String(customer.name || customer.company) : "";
    const nameEl = $("jmSaveRateServiceName");
    const oldEl = $("jmSaveRateOld");
    const newEl = $("jmSaveRateNew");
    const typeEl = $("jmSaveRateTypeLabel");
    const clientBtn = $("jmSaveRateClient");
    const tableBtn = $("jmSaveRateTable");
    const clientHint = $("jmSaveRateClientHint");
    if (nameEl) nameEl.textContent = payload.serviceName || "Serviço";
    if (oldEl) oldEl.textContent = money(Number(payload.tableRate) || 0);
    if (newEl) newEl.textContent = money(Number(payload.newRate) || 0);
    if (typeEl) typeEl.textContent = typeLabel;
    const noCustomer = !customer || customer.id == null;
    if (clientBtn) {
      clientBtn.disabled = noCustomer;
      clientBtn.classList.toggle("is-disabled", noCustomer);
      clientBtn.textContent = noCustomer
        ? "Só para este cliente"
        : `Só para ${customerName || "este cliente"}`;
    }
    if (tableBtn) tableBtn.textContent = `Atualizar Tabela · ${typeLabel}`;
    if (clientHint) clientHint.classList.toggle("hidden", !noCustomer);
    root.classList.remove("hidden");
  }

  function maybeOfferRatePersist(lineIdx) {
    ensureRateModal();
    const root = $("jmSaveRateModal");
    if (root && !root.classList.contains("hidden")) return;
    const line = st && st.lines[lineIdx];
    if (!line || !line.pricingId || line.manual) return;
    const item = pricing.find((p) => String(p.id) === String(line.pricingId));
    if (!item) return;
    const newRate = Number(line.price);
    if (!Number.isFinite(newRate) || newRate < 0) return;
    const tableRate = systemRateFor(item);
    if (ratesNearlyEqual(newRate, tableRate)) return;
    openSaveRateModal({
      lineIdx,
      serviceName: String(line.name || item.name || "Serviço").trim() || "Serviço",
      newRate,
      tableRate,
      typeLabel: pricingTypeLabel(),
      pricingItemId: String(item.id),
      customer: currentCustomer(),
    });
  }

  async function persistRateForCustomerOnly() {
    const p = rateSavePending;
    if (!p || !p.customer || p.customer.id == null) {
      notify("Selecione um cliente CRM para gravar preço personalizado.", "error");
      return;
    }
    const cid = String(p.customer.id);
    const prevRates =
      p.customer.custom_pricing_rates && typeof p.customer.custom_pricing_rates === "object"
        ? { ...p.customer.custom_pricing_rates }
        : {};
    prevRates[String(p.pricingItemId)] = p.newRate;
    const btn = $("jmSaveRateClient");
    if (btn) btn.disabled = true;
    try {
      const j = await api(`/api/customers/${encodeURIComponent(cid)}`, {
        method: "PUT",
        body: JSON.stringify({
          pricing_mode: "custom",
          custom_pricing_rates: prevRates,
        }),
      });
      const updated = j.data || j;
      const idx = customers.findIndex((c) => String(c.id) === cid);
      if (idx >= 0) customers[idx] = { ...customers[idx], ...updated };
      else if (updated && updated.id) customers.push(updated);
      notify("Preço gravado no cadastro deste cliente.", "success");
      closeSaveRateModal();
      renderServices();
    } catch (e) {
      notify(e.message || "Erro ao gravar preço do cliente.", "error");
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  async function persistRateToPricingTable() {
    const p = rateSavePending;
    if (!p || !p.pricingItemId) return;
    const field = rateKey();
    const label = pricingTypeLabel();
    const ok = confirm(
      `Atualizar a Tabela de Valores (${label}) para ${money(p.newRate)}?\n\n` +
        `Isto altera o preço do sistema para jobs e orçamentos futuros (exceto clientes com preço personalizado).`,
    );
    if (!ok) return;
    const btn = $("jmSaveRateTable");
    if (btn) btn.disabled = true;
    try {
      await api(`/api/pricing/${encodeURIComponent(p.pricingItemId)}`, {
        method: "PUT",
        body: JSON.stringify({ [field]: p.newRate }),
      });
      const item = pricing.find((x) => String(x.id) === String(p.pricingItemId));
      if (item) item[field] = p.newRate;
      notify("Tabela de Valores atualizada.", "success");
      closeSaveRateModal();
    } catch (e) {
      notify(e.message || "Erro ao atualizar a Tabela de Valores.", "error");
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  // ---------------------------------------------------------------- schedule (date + start only — duration stays open)
  function computeRange() {
    if (!st.date) return { start: null, end: null };
    const [y, m, d] = st.date.split("-").map(Number);
    const [hh, mm] = (st.time || "07:30").split(":").map(Number);
    const start = new Date(y, m - 1, d, hh || 0, mm || 0, 0, 0);
    return { start, end: null };
  }
  function whenLabel() {
    const { start } = computeRange();
    if (!start) return "Sem data";
    const day = start.toLocaleDateString("pt-BR", { weekday: "short", day: "numeric", month: "short" });
    const t = start.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    return `${day} · ${t}`;
  }

  // ---------------------------------------------------------------- auto title
  function autoTitle() {
    const card = clientCard();
    const street = String(st.address || "").split(",")[0].trim();
    if (card && street) return `${card.name} — ${street}`;
    if (card) return card.name;
    if (street) return street;
    return "";
  }

  // ---------------------------------------------------------------- DOM
  function ensureCss() {
    if ([...document.querySelectorAll('link[rel="stylesheet"]')].some((l) => (l.getAttribute("href") || "").includes("crm-job-modal.css"))) return;
    const l = document.createElement("link");
    l.rel = "stylesheet";
    l.href = CSS_HREF;
    document.head.appendChild(l);
  }

  function ensureDom() {
    if (!$("jobModal")) {
      const wrap = document.createElement("div");
      wrap.innerHTML = `
<div class="jm-backdrop" id="jobModalBackdrop"></div>
<div class="jm" id="jobModal" role="dialog" aria-modal="true" aria-labelledby="jobModalTitle">
  <div class="jm__grab" aria-hidden="true"></div>
  <header class="jm__head">
    <h2 id="jobModalTitle">Novo job</h2>
    <button type="button" class="jm__x" id="btnCloseJobModal" aria-label="Fechar">×</button>
  </header>
  <form class="jm__form" id="jobForm" novalidate>
    <div class="jm__body">
      <div class="jm__main" id="jobModalMain">
        <section class="jm-sec" data-job-section="details">
          <h3 class="jm-sec__t"><span class="jm-n">1</span>Para quem</h3>
          <div id="jmClient"></div>
          <label class="jm-field jm-field--addr">Endereço da obra
            <span class="jm-inwrap"><input type="text" id="jobAddress" class="jm-in" maxlength="500" autocomplete="off" placeholder="Local da obra" /><small class="jm-in__hint" id="jmAddrHint"></small></span>
          </label>
          <div class="jm-more" id="jmMore"></div>
        </section>

        <section class="jm-sec" data-job-section="schedule">
          <h3 class="jm-sec__t"><span class="jm-n">2</span>Quando</h3>
          <div class="jm-when">
            <label class="jm-field">Data<input type="date" id="jmDate" class="jm-in" /></label>
            <label class="jm-field">Início<input type="time" id="jmTime" class="jm-in" step="900" /></label>
          </div>
          <div class="jm-when" style="margin-top:10px">
            <label class="jm-field">Setor
              <select id="jmSector" class="jm-in">
                <option value="">Geral</option>
                <option value="installation">Instalação</option>
                <option value="sand_finish">Lixa</option>
              </select>
            </label>
            <label class="jm-field" id="jmRelatedWrap" hidden>Job de Instalação
              <select id="jmRelated" class="jm-in"><option value="">—</option></select>
            </label>
          </div>
          <p class="jm-hint">Só data e hora de início — a duração fica aberta (obras são imprevisíveis). Setor define em qual agenda de Jobs o evento aparece.</p>
        </section>

        <section class="jm-sec" data-job-section="services">
          <h3 class="jm-sec__t"><span class="jm-n">3</span>Serviços</h3>
          <div class="jm-svc" id="jmSvc"></div>
          <p class="jm-hint" id="jmPriceHint"></p>
        </section>

        <section class="jm-sec" data-job-section="team">
          <h3 class="jm-sec__t"><span class="jm-n">4</span>Equipe</h3>
          <div class="jm-chips" id="jmTeam"></div>
          <div id="jmTemps"></div>
        </section>

        <section class="jm-sec" data-job-section="campo">
          <h3 class="jm-sec__t"><span class="jm-n">5</span>Para o campo</h3>
          <label class="jm-field">Atenção
            <textarea id="jmAttention" class="jm-in jm-ta jm-ta--sm" rows="2" maxlength="2000" placeholder="Ex.: Proteger os degraus com papelão antes de começar."></textarea>
          </label>
          <p class="jm-hint">Aparece em destaque no ticket do funcionário e no Campo.</p>
          <label class="jm-check">
            <input type="checkbox" id="jmNeedsDelivery" />
            <span><strong>Delivery</strong> — retirar material da obra</span>
          </label>
          <div class="jm-delivery" id="jmDeliveryBox" hidden>
            <label class="jm-field">Endereço da retirada
              <input type="text" id="jmDeliveryPickup" class="jm-in" maxlength="500" placeholder="Onde pegar o material (pode ser diferente do job)" />
            </label>
            <label class="jm-field">Notas / nº do PO
              <textarea id="jmDeliveryNotes" class="jm-in jm-ta jm-ta--sm" rows="2" maxlength="4000" placeholder="Ex.: PO 45821 — retirar sobras de madeira"></textarea>
            </label>
            <div class="jm-delivery__file">
              <label class="jm-btn jm-btn--sm" for="jmDeliveryFile">Anexar arquivo</label>
              <input type="file" id="jmDeliveryFile" class="jm-sr" accept="image/*,application/pdf,.pdf,.png,.jpg,.jpeg,.webp" />
              <span class="jm-delivery__file-name" id="jmDeliveryFileName">Nenhum arquivo</span>
              <button type="button" class="jm-btn jm-btn--ghost jm-btn--sm" id="jmDeliveryFileClear" hidden>Remover</button>
            </div>
            <p class="jm-hint">PDF ou foto do PO / packing list. Aparece no ticket do Campo.</p>
          </div>
          <div class="jm-ck" id="jmCk"></div>
        </section>

        <section class="jm-sec" data-job-section="notes">
          <h3 class="jm-sec__t"><span class="jm-n">6</span>Notas internas <span id="jmLockbox" class="jm-lockbox-slot" hidden></span></h3>
          <textarea id="jobNotes" class="jm-in jm-ta" rows="3" maxlength="8000" placeholder="Ex.: /lockbox 4821 — código da caixa da casa"></textarea>
          <p class="jm-hint">Escreva <code>/lockbox</code> e o código para mostrar o cadeado aqui nas notas.</p>
        </section>
      </div>
      <aside class="jm__side" id="jmSide" aria-label="Resumo"></aside>
    </div>
    <p class="jm-err" id="jmErr" hidden></p>
    <footer class="jm__foot" id="jmFoot"></footer>
  </form>
</div>`;
      while (wrap.firstChild) document.body.appendChild(wrap.firstChild);
    }
    ensureRateModal();
  }

  let rateModalBound = false;

  function ensureRateModal() {
    let root = $("jmSaveRateModal");
    if (!root) {
      const wrap = document.createElement("div");
      wrap.innerHTML = `
<div class="jm-rate hidden" id="jmSaveRateModal" role="dialog" aria-modal="true" aria-labelledby="jmSaveRateTitle">
  <div class="jm-rate__panel">
    <button type="button" class="jm-rate__x" id="jmSaveRateClose" aria-label="Fechar">×</button>
    <h2 id="jmSaveRateTitle" class="jm-rate__title">Gravar novo preço?</h2>
    <p class="jm-rate__sub">O serviço <strong id="jmSaveRateServiceName">—</strong> está ligado à Tabela de Valores.</p>
    <div class="jm-rate__cmp">
      <div><span>Na tabela (<b id="jmSaveRateTypeLabel">—</b>)</span><strong id="jmSaveRateOld">—</strong></div>
      <div><span>Neste job</span><strong id="jmSaveRateNew">—</strong></div>
    </div>
    <p id="jmSaveRateClientHint" class="jm-rate__hint hidden">
      Para gravar no cadastro do cliente, selecione um cliente CRM neste job.
    </p>
    <div class="jm-rate__acts">
      <button type="button" id="jmSaveRateClient" class="jm-btn jm-btn--dark">Só para este cliente</button>
      <button type="button" id="jmSaveRateTable" class="jm-btn jm-btn--pri">Atualizar Tabela de Valores</button>
      <button type="button" id="jmSaveRateJobOnly" class="jm-btn">Só neste job</button>
      <button type="button" id="jmSaveRateCancel" class="jm-btn jm-btn--ghost">Cancelar</button>
    </div>
  </div>
</div>`;
      while (wrap.firstChild) document.body.appendChild(wrap.firstChild);
      root = $("jmSaveRateModal");
    } else if (!$("jmSaveRateClose")) {
      const panel = root.querySelector(".jm-rate__panel");
      if (panel) {
        const x = document.createElement("button");
        x.type = "button";
        x.className = "jm-rate__x";
        x.id = "jmSaveRateClose";
        x.setAttribute("aria-label", "Fechar");
        x.textContent = "×";
        panel.insertBefore(x, panel.firstChild);
      }
    }
    if (rateModalBound) return;
    rateModalBound = true;
    $("jmSaveRateClient")?.addEventListener("click", () => void persistRateForCustomerOnly());
    $("jmSaveRateTable")?.addEventListener("click", () => void persistRateToPricingTable());
    $("jmSaveRateJobOnly")?.addEventListener("click", () => closeSaveRateModal());
    $("jmSaveRateCancel")?.addEventListener("click", () => closeSaveRateModal());
    $("jmSaveRateClose")?.addEventListener("click", () => closeSaveRateModal());
    root?.addEventListener("click", (e) => {
      if (e.target === root) closeSaveRateModal();
    });
  }

  // ---------------------------------------------------------------- render
  function renderClient() {
    const box = $("jmClient");
    const card = clientCard();
    if (card && !st.pickerOpen) {
      box.innerHTML = `<div class="jm-picked">
        <span class="jm-av">${esc(initials(card.name))}</span>
        <span class="jm-picked__txt"><b>${esc(card.name)} <span class="jm-tag">${esc(TYPE_LABEL[card.type] || card.type)}</span></b>
        <small>${esc(card.sub || (card.custom ? "Tabela personalizada" : ""))}</small></span>
        <button type="button" class="jm-link" data-act="change-client">Trocar</button>
      </div>`;
      return;
    }
    const rows = pickerEntries(st.pickerQuery);
    const q = st.pickerQuery.trim();
    const list = rows.slice(0, q ? 12 : 6);
    const fixed = list.filter((r) => r.type !== "particular");
    const part = list.filter((r) => r.type === "particular");
    const item = (r) => `<button type="button" class="jm-opt" data-act="pick" data-kind="${r.kind}" data-id="${esc(r.id)}">
        <span class="jm-av jm-av--sm">${esc(initials(r.name))}</span>
        <span class="jm-opt__txt"><b>${esc(r.name)}</b><small>${esc(r.sub)}</small></span>
        <span class="jm-tag jm-tag--soft">${esc(TYPE_LABEL[r.type] || r.type)}</span>
      </button>`;
    box.innerHTML = `<div class="jm-picker">
      <span class="jm-search"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>
        <input type="search" id="jmClientQ" class="jm-in" placeholder="Buscar builder, loja ou cliente…" autocomplete="off" value="${esc(st.pickerQuery)}" /></span>
      <div class="jm-opts">
        ${fixed.length ? `<p class="jm-grp">Builders e lojas</p>${fixed.map(item).join("")}` : ""}
        ${part.length ? `<p class="jm-grp">Particulares</p>${part.map(item).join("")}` : ""}
        ${!list.length ? `<p class="jm-empty">${q ? "Ninguém com esse nome." : "Nenhum cliente cadastrado ainda."}</p>` : ""}
        ${
          q
            ? `<div class="jm-new"><span>Cadastrar <b>${esc(q)}</b> como</span>
                ${["builder", "loja", "particular"].map((t) => `<button type="button" class="jm-chip jm-chip--sm" data-act="quick-client" data-type="${t}">${TYPE_LABEL[t]}</button>`).join("")}</div>`
            : ""
        }
        ${card ? `<button type="button" class="jm-link jm-link--back" data-act="keep-client">Manter ${esc(card.name)}</button>` : ""}
      </div>
    </div>`;
  }

  function renderAddrHint() {
    const card = clientCard();
    const hint = $("jmAddrHint");
    if (!hint) return;
    const same = card && card.address && st.address.trim() === card.address.trim();
    const from = { builder: "do builder", contractor: "do builder", loja: "da loja" }[card?.type] || "do cliente";
    hint.textContent = same ? from : "";
  }

  const STATUS_OPTS = [
    ["draft", "Rascunho"],
    ["scheduled", "Agendado"],
    ["in_progress", "Em andamento"],
    ["completed", "Concluído"],
    ["canceled", "Cancelado"],
  ];
  const SRC_OPTS = [
    ["particular", "Particular"],
    ["builder", "Builder"],
    ["contractor", "Contractor"],
    ["loja", "Loja"],
    ["internal", "Interno"],
    ["other", "Outro"],
  ];

  function renderMore() {
    const box = $("jmMore");
    const isEdit = Boolean(st.id);
    const auto = autoTitle();
    const titleShown = st.titleTouched ? st.title : st.title || auto;
    if (!st.moreOpen) {
      const bits = [
        `<span><em>Título</em> ${esc(titleShown || "automático")}</span>`,
        `<span><em>Origem</em> ${esc(SRC_OPTS.find((o) => o[0] === st.sourceType)?.[1] || st.sourceType)}</span>`,
        isEdit ? `<span><em>Status</em> ${esc(STATUS_OPTS.find((o) => o[0] === st.status)?.[1] || st.status)}</span>` : "",
      ].join("");
      box.innerHTML = `<button type="button" class="jm-more__toggle" data-act="more">${bits}<b>Editar</b></button>`;
      return;
    }
    const custOpts = ['<option value="">—</option>']
      .concat(customers.map((c) => `<option value="${esc(c.id)}"${String(c.id) === String(st.customerId) ? " selected" : ""}>${esc(c.name || c.company)}</option>`))
      .join("");
    const bOpts = ['<option value="">—</option>']
      .concat(builders.map((b) => `<option value="${esc(b.id)}"${String(b.id) === String(st.builderId) ? " selected" : ""}>${esc(builderName(b))}</option>`))
      .join("");
    box.innerHTML = `<div class="jm-more__panel">
      <label class="jm-field jm-field--wide">Título do job
        <input type="text" id="jobTitle" class="jm-in" maxlength="200" value="${esc(titleShown)}" placeholder="${esc(auto || "Ex.: Summit — Lot 14")}" />
      </label>
      ${isEdit ? `<label class="jm-field">Status<select id="jobStatus" class="jm-in">${STATUS_OPTS.map(([v, l]) => `<option value="${v}"${v === st.status ? " selected" : ""}>${l}</option>`).join("")}</select></label>` : ""}
      <label class="jm-field">Origem (coluna de preço)<select id="jobSourceType" class="jm-in">${SRC_OPTS.map(([v, l]) => `<option value="${v}"${v === st.sourceType ? " selected" : ""}>${l}</option>`).join("")}</select></label>
      <label class="jm-field">Cliente<select id="jobCustomer" class="jm-in">${custOpts}</select></label>
      <label class="jm-field">Builder<select id="jobBuilder" class="jm-in">${bOpts}</select></label>
      <label class="jm-field jm-field--wide">Nome da origem<input type="text" id="jobSourceName" class="jm-in" maxlength="200" value="${esc(st.sourceName)}" placeholder="Empresa / contato" /></label>
      <button type="button" class="jm-link" data-act="more">Fechar opções</button>
    </div>`;
  }

  async function ensureInstallOptions() {
    if (!st || st.sector !== "sand_finish") return;
    if (st.installOptions && st.installOptions.length) return;
    try {
      const j = await api("/api/work-orders");
      st.installOptions = (j.data || [])
        .filter((w) => w.sector === "installation" && w.status !== "canceled" && String(w.id) !== String(st.id || ""))
        .map((w) => ({
          id: w.id,
          label: `#${w.number != null ? w.number : "—"} · ${w.title}${w.address ? " · " + w.address : ""}`,
        }));
    } catch (_) {
      st.installOptions = [];
    }
  }

  function renderWhen() {
    if ($("jmDate")) $("jmDate").value = st.date || "";
    if ($("jmTime")) $("jmTime").value = st.time || "";
    const sec = $("jmSector");
    if (sec) sec.value = st.sector || "";
    const wrap = $("jmRelatedWrap");
    const rel = $("jmRelated");
    if (wrap && rel) {
      const show = st.sector === "sand_finish";
      wrap.hidden = !show;
      if (show) {
        const opts = st.installOptions || [];
        const cur = st.relatedWorkOrderId || "";
        const hasCur = cur && opts.some((o) => String(o.id) === String(cur));
        const curLabel =
          st.relatedWorkOrder &&
          `#${st.relatedWorkOrder.number != null ? st.relatedWorkOrder.number : "—"} · ${st.relatedWorkOrder.title}`;
        rel.innerHTML =
          `<option value="">—</option>` +
          (!hasCur && cur
            ? `<option value="${esc(cur)}" selected>${esc(curLabel || "Job ligado")}</option>`
            : "") +
          opts
            .map((o) => `<option value="${esc(o.id)}" ${String(o.id) === String(cur) ? "selected" : ""}>${esc(o.label)}</option>`)
            .join("");
      }
    }
  }

  function blankLine(opts) {
    const o = opts || {};
    return {
      pricingId: o.pricingId || null,
      name: o.name || "",
      qty: o.qty != null ? o.qty : 0,
      price: o.price != null ? o.price : 0,
      unit: o.unit || null,
      priceTouched: Boolean(o.priceTouched),
      manual: Boolean(o.manual),
      note: o.note || "",
      svcQuery: o.svcQuery != null ? o.svcQuery : "",
      svcOpen: false,
    };
  }

  function closeSvcDropdowns(exceptI) {
    if (!st) return;
    let changed = false;
    st.lines.forEach((l, i) => {
      if (l.svcOpen && i !== exceptI) {
        l.svcOpen = false;
        changed = true;
      }
    });
    if (changed) renderServices();
  }

  function filterPricing(q) {
    const needle = String(q || "")
      .trim()
      .toLowerCase();
    if (!needle) return pricing.slice(0, 12);
    return pricing
      .filter((p) => {
        const hay = `${p.name || ""} ${p.unit || ""} ${p.category || ""}`.toLowerCase();
        return hay.includes(needle);
      })
      .slice(0, 12);
  }

  function renderServices() {
    const box = $("jmSvc");
    if (!box) return;
    const rows = st.lines
      .map((l, i) => {
        const item = l.pricingId ? pricing.find((p) => p.id === l.pricingId) : null;
        const unit = unitLabel(item?.unit || l.unit);
        const useManualUi = Boolean(l.manual);
        const displayQ =
          l.svcOpen || String(l.svcQuery || "").length
            ? l.svcQuery
            : item
              ? item.name
              : l.pricingId
                ? l.name
                : l.svcQuery || "";
        const matches = filterPricing(l.svcOpen ? l.svcQuery : displayQ);
        const dd = l.svcOpen
          ? `<div class="jm-svc-dd" role="listbox" aria-label="Serviços da tabela">
              ${
                matches.length
                  ? matches
                      .map((p) => {
                        const rate = priceFor(p);
                        return `<button type="button" class="jm-svc-dd__opt" role="option" data-act="pick-svc" data-id="${esc(p.id)}"><b>${esc(p.name)}</b><small>${rate > 0 ? `${money(rate)}/${esc(unitLabel(p.unit))}` : esc(unitLabel(p.unit))}</small></button>`;
                      })
                      .join("")
                  : `<p class="jm-svc-dd__empty">${pricing.length ? "Nenhum serviço com esse nome." : "Tabela de Valores vazia."}</p>`
              }
              <button type="button" class="jm-svc-dd__manual" data-act="manual-line">+ Serviço manual (fora da tabela)</button>
            </div>`
          : "";
        return `<div class="jm-ln" data-i="${i}">
          <div class="jm-ln__svc">
            ${
              useManualUi
                ? `<span class="jm-ln__manual-lbl">Serviço manual</span>
                   <input type="text" class="jm-in jm-in--sm" data-f="name" maxlength="200" placeholder="Descrição do serviço" value="${esc(l.name)}" aria-label="Nome do serviço" />
                   <button type="button" class="jm-link" data-act="to-catalog" style="justify-self:start">Buscar na tabela</button>`
                : `<div class="jm-svc-pick">
                    <span class="jm-search jm-search--svc${l.svcOpen ? " is-open" : ""}">
                      <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>
                      <input type="search" class="jm-in" data-f="svc-q" maxlength="200" placeholder="Buscar serviço na tabela…" autocomplete="off" aria-label="Buscar serviço" aria-expanded="${l.svcOpen ? "true" : "false"}" value="${esc(displayQ)}" />
                    </span>
                    ${dd}
                  </div>`
            }
            <label class="jm-ln__note"><span class="jm-sr">Nota do serviço</span><input type="text" class="jm-in jm-in--sm" data-f="note" maxlength="2000" placeholder="Nota / descrição deste serviço (opcional)" value="${esc(l.note || "")}" /></label>
          </div>
          <label class="jm-ln__qty"><input type="number" class="jm-in jm-in--sm" data-f="qty" min="0" step="0.01" inputmode="decimal" value="${Number(l.qty) ? esc(l.qty) : ""}" placeholder="0" aria-label="Quantidade" /><span>${esc(unit)}</span></label>
          <label class="jm-ln__price"><span>$</span><input type="number" class="jm-in jm-in--sm" data-f="price" min="0" step="0.01" inputmode="decimal" value="${Number(l.price) ? esc(Number(l.price).toFixed(2)) : ""}" placeholder="0.00" aria-label="Preço por ${esc(unit)}" /></label>
          <b class="jm-ln__tot" data-tot>${money(lineTotal(l))}</b>
          <button type="button" class="jm-ln__del" data-act="del-line" aria-label="Remover serviço">×</button>
        </div>`;
      })
      .join("");
    box.innerHTML = `${
      st.lines.length
        ? `<div class="jm-ln jm-ln--hdr" aria-hidden="true"><span>Serviço</span><span>Quantidade</span><span>Preço</span><span>Total</span><span></span></div>${rows}`
        : `<p class="jm-empty jm-empty--svc">Nenhum serviço ainda. Os serviços, com o preço da tabela, viram a fatura do job.</p>`
    }
      <div class="jm-svc__foot">
        <span class="jm-svc__foot-acts">
          <button type="button" class="jm-link" data-act="add-line">+ Adicionar serviço</button>
          <button type="button" class="jm-link" data-act="add-manual">+ Serviço manual</button>
        </span>
        <span id="jmSvcCount"></span>
      </div>`;
    const card = clientCard();
    $("jmPriceHint").innerHTML = `Preços da <b>${esc(pricingLabel())}</b>${card ? ` (${esc(card.name)})` : ""}. Dá para ajustar o preço em cada linha.`;
    updateSvcCount();
  }

  function updateSvcCount() {
    const cnt = $("jmSvcCount");
    if (cnt) cnt.innerHTML = st.lines.length ? `${st.lines.length} serviço${st.lines.length > 1 ? "s" : ""} · <b>${money(linesTotal())}</b>` : "";
  }

  function renderTeam() {
    const box = $("jmTeam");
    if (!users.length) {
      box.innerHTML = '<p class="jm-empty">Nenhum usuário disponível.</p>';
    } else {
      box.innerHTML = users
        .map((u) => {
          const lead = String(st.assigneeId) === String(u.id);
          const on = lead || st.members.has(String(u.id));
          return `<button type="button" class="jm-chip jm-chip--user${on ? " is-on" : ""}" data-act="user" data-id="${esc(u.id)}" aria-pressed="${on}">
            <span class="jm-dot">${esc(initials(u.name || u.email))}</span>${esc(u.name || u.email)}${lead ? '<small> · responsável</small>' : ""}</button>`;
        })
        .join("");
    }
    const team = users.filter((u) => st.members.has(String(u.id)) || String(st.assigneeId) === String(u.id));
    const leadPick =
      team.length > 1
        ? `<label class="jm-lead">Responsável <select id="jmLead" class="jm-in jm-in--sm">${team
            .map((u) => `<option value="${esc(u.id)}"${String(u.id) === String(st.assigneeId) ? " selected" : ""}>${esc(u.name || u.email)}</option>`)
            .join("")}</select></label>`
        : "";
    const temps = $("jmTemps");
    const pendingList = Array.isArray(st.pendingTemps) ? st.pendingTemps : [];
    const tempRows = st.id
      ? st.temps
          .map(
            (t) => `<div class="jm-temp"><span><b>${esc(t.name)}</b><small>${esc([(typeof window.sfFormatPhone === "function" ? window.sfFormatPhone(t.phone) : t.phone) || t.phone, t.email].filter(Boolean).join(" · ") || "sem telefone")}</small></span>
            <span class="jm-temp__act">
              <button type="button" class="jm-chip jm-chip--sm" data-act="temp-wa" data-id="${esc(t.id)}">WhatsApp</button>
              <button type="button" class="jm-chip jm-chip--sm" data-act="temp-sms" data-id="${esc(t.id)}">SMS</button>
              <button type="button" class="jm-chip jm-chip--sm" data-act="temp-copy" data-id="${esc(t.id)}">Copiar link</button>
              <button type="button" class="jm-ln__del" data-act="temp-del" data-id="${esc(t.id)}" aria-label="Remover">×</button>
            </span></div>`,
          )
          .join("")
      : pendingList
          .map(
            (t, i) => `<div class="jm-temp"><span><b>${esc(t.name)}</b><small>${esc((typeof window.sfFormatPhone === "function" ? window.sfFormatPhone(t.phone) : t.phone) || t.phone || "sem telefone")}</small></span>
            <span class="jm-temp__act">
              <button type="button" class="jm-ln__del" data-act="temp-pending-del" data-i="${i}" aria-label="Remover">×</button>
            </span></div>`,
          )
          .join("");
    temps.innerHTML = `${leadPick}<div class="jm-temps">
      <p class="jm-grp">Funcionário extra / temporário (link por WhatsApp/SMS)</p>
      ${tempRows}
      <div class="jm-temp-add">
        <input type="text" id="tempName" class="jm-in jm-in--sm" maxlength="200" placeholder="Nome *" />
        <input type="tel" id="tempPhone" class="jm-in jm-in--sm" maxlength="40" placeholder="Telefone (WhatsApp)" />
        <button type="button" class="jm-chip jm-chip--sm" data-act="temp-add">+ Cadastrar</button>
      </div>
      ${
        st.id
          ? ""
          : '<p class="jm-hint">Cadastre aqui na criação do job. O link de acesso é gerado ao salvar.</p>'
      }
    </div>`;
  }

  let checklistEnabled = true;
  let jobsSettingsLoaded = false;

  async function ensureJobsSettings() {
    if (jobsSettingsLoaded) return;
    try {
      const j = await api("/api/settings/jobs");
      checklistEnabled = j?.data?.checklist_enabled !== false;
    } catch (_) {
      checklistEnabled = true;
    }
    jobsSettingsLoaded = true;
  }

  function renderChecklist() {
    const box = $("jmCk");
    if (!box) return;
    if (!checklistEnabled) {
      box.hidden = true;
      box.innerHTML = "";
      return;
    }
    box.hidden = false;
    const items = st.checklist;
    const done = items.filter((c) => c.done).length;
    box.innerHTML = `
      <div class="jm-ck__head"><b>Checklist</b><span>${items.length ? `${items.length} ${items.length === 1 ? "item" : "itens"}${done ? ` · ${done} feito${done > 1 ? "s" : ""}` : ""}` : "Opcional"}</span></div>
      ${
        items.length
          ? `<ol class="jm-ck__list">${items
              .map(
                (c, i) => `<li class="jm-ck__it${c.done ? " is-done" : ""}">
                  <span class="jm-ck__n" aria-hidden="true">${c.done ? "✓" : i + 1}</span>
                  <input type="text" class="jm-in jm-in--sm" data-ck-text="${i}" value="${esc(c.text)}" maxlength="200" aria-label="Item ${i + 1}" />
                  <button type="button" class="jm-ck__ic${c.photo ? " is-on" : ""}" data-act="ck-photo" data-i="${i}" aria-pressed="${c.photo}" title="${c.photo ? "Foto obrigatória" : "Exigir foto"}">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 8.5A2.5 2.5 0 0 1 5.5 6h1.6l1.4-2h7l1.4 2h1.6A2.5 2.5 0 0 1 21 8.5v9A2.5 2.5 0 0 1 18.5 20h-13A2.5 2.5 0 0 1 3 17.5z"/><circle cx="12" cy="13" r="3.6"/></svg>
                    <span class="jm-sr">Foto</span>
                  </button>
                  <button type="button" class="jm-ck__ic" data-act="ck-up" data-i="${i}" title="Subir" ${i === 0 ? "disabled" : ""}>↑</button>
                  <button type="button" class="jm-ck__ic jm-ck__ic--x" data-act="ck-del" data-i="${i}" title="Remover">×</button>
                </li>`,
              )
              .join("")}</ol>`
          : ""
      }
      <div class="jm-ck__add">
        <input type="text" id="jmCkNew" class="jm-in jm-in--sm" maxlength="200" placeholder="${items.length ? "Mais um item…" : "Ex.: Fotos de antes de cada cômodo"}" />
        <button type="button" class="jm-btn jm-btn--sm" data-act="ck-add">Adicionar</button>
      </div>
      <div class="jm-ck__tpl"><small>Modelos:</small>${CK_TEMPLATES.map((t) => `<button type="button" class="jm-chip jm-chip--sm" data-act="ck-tpl" data-key="${t.key}">+ ${esc(t.name)}</button>`).join("")}</div>
      <p class="jm-hint">A câmera marca itens que exigem foto. A equipe marca os itens feitos no Campo ou no ticket.</p>`;
  }
  function ckAdd() {
    const inp = $("jmCkNew");
    const text = (inp?.value || "").trim();
    if (!text) {
      inp?.focus();
      return;
    }
    if (st.checklist.length >= 40) {
      notify("Máximo de 40 itens.", "error");
      return;
    }
    st.checklist.push({ id: null, text, photo: false, done: false });
    renderChecklist();
    setTimeout(() => $("jmCkNew")?.focus(), 10);
  }

  function renderSide() {
    const side = $("jmSide");
    const card = clientCard();
    const assignee = users.find((u) => String(u.id) === String(st.assigneeId));
    const others = [...st.members].filter((id) => String(id) !== String(st.assigneeId)).length;
    const total = linesTotal();
    const statusNow = st.id ? st.status : computeRange().start ? "scheduled" : "draft";
    const statusLbl = STATUS_OPTS.find((o) => o[0] === statusNow)?.[1] || statusNow;
    side.innerHTML = `<h4>Resumo</h4>
      <dl>
        <div><dt>Cliente</dt><dd>${esc(card?.name || "—")}</dd></div>
        <div><dt>Preços</dt><dd>${esc(customRates() ? "Personalizada" : TYPE_LABEL[st.sourceType] || "Particular")}</dd></div>
        <div><dt>Quando</dt><dd>${esc(whenLabel())}</dd></div>
        <div><dt>Setor</dt><dd>${esc(sectorLabel(st.sector))}</dd></div>
        <div><dt>Delivery</dt><dd>${st.needsDelivery ? esc(st.deliveryPickupAddress || "Retirar material") : "—"}</dd></div>
        <div><dt>Equipe</dt><dd>${esc(assignee ? `${assignee.name || assignee.email}${others ? ` +${others}` : ""}` : "—")}</dd></div>
        <div><dt>Status</dt><dd>${esc(statusLbl)}</dd></div>
      </dl>
      <div class="jm-total"><small>Total do job</small><strong>${money(total)}</strong>
      <p>${total > 0 ? "Vira a fatura quando o job terminar." : "Adicione serviços para ter o valor."}</p></div>`;
    const ft = $("jmFootTotal");
    if (ft) ft.textContent = money(total);
  }

  function renderFoot() {
    const foot = $("jmFoot");
    const isEdit = Boolean(st.id);
    const onDetail = /job-detail\.html/i.test(location.pathname);
    const showTotal = st.section === "all" || st.section === "services";
    foot.innerHTML = `
      ${showTotal ? `<span class="jm-foot__tot"><small>Total</small><b id="jmFootTotal">${money(linesTotal())}</b></span>` : ""}
      ${isEdit && st.section === "all" ? `<button type="button" class="jm-btn jm-btn--danger" data-act="cancel-job">Excluir</button>` : ""}
      ${
        isEdit && st.sector === "installation" && st.section === "all"
          ? `<button type="button" class="jm-btn jm-btn--ghost" data-act="schedule-lixa">Agendar Lixa</button>`
          : ""
      }
      ${isEdit && !onDetail ? `<a class="jm-btn jm-btn--ghost jm-btn--open" href="job-detail.html?id=${encodeURIComponent(st.id)}">Abrir job</a>` : ""}
      <span class="jm-sp"></span>
      <button type="button" class="jm-btn jm-btn--ghost jm-btn--cancel" data-act="close">Cancelar</button>
      <button type="submit" class="jm-btn jm-btn--pri" id="btnSaveJob"${st.busy ? " disabled" : ""}>${st.busy ? "Salvando…" : isEdit ? "Salvar" : "Criar job"}</button>`;
  }

  function refreshNumbers() {
    updateSvcCount();
    renderSide();
  }

  function renderLockbox() {
    const slot = $("jmLockbox");
    if (!slot) return;
    const html = jobLockboxBadgeHtml(st?.notes);
    if (html) {
      slot.innerHTML = html;
      slot.hidden = false;
    } else {
      slot.innerHTML = "";
      slot.hidden = true;
    }
  }

  function renderDeliveryBox() {
    const box = $("jmDeliveryBox");
    if (!box) return;
    const on = Boolean(st.needsDelivery);
    box.hidden = !on;
    ["jmDeliveryPickup", "jmDeliveryNotes", "jmDeliveryFile"].forEach((id) => {
      const el = $(id);
      if (el) el.disabled = !on;
    });
    if ($("jmDeliveryPickup")) $("jmDeliveryPickup").value = st.deliveryPickupAddress || "";
    if ($("jmDeliveryNotes")) $("jmDeliveryNotes").value = st.deliveryNotes || "";
    const nameEl = $("jmDeliveryFileName");
    const clearBtn = $("jmDeliveryFileClear");
    const pending = st.deliveryAttachmentPending;
    const existing = st.deliveryAttachment;
    if (pending) {
      if (nameEl) nameEl.textContent = pending.name || "Arquivo selecionado";
      if (clearBtn) clearBtn.hidden = !on;
    } else if (existing && existing.url && !st.clearDeliveryAttachment) {
      if (nameEl) {
        nameEl.innerHTML = `<a href="${esc(existing.url)}" target="_blank" rel="noopener">${esc(existing.name || "Anexo")}</a>`;
      }
      if (clearBtn) clearBtn.hidden = !on;
    } else {
      if (nameEl) nameEl.textContent = "Nenhum arquivo";
      if (clearBtn) clearBtn.hidden = true;
    }
  }

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(new Error("Falha ao ler arquivo"));
      reader.readAsDataURL(file);
    });
  }

  async function renderAll() {
    renderClient();
    $("jobAddress").value = st.address;
    renderAddrHint();
    renderMore();
    if (st.sector === "sand_finish") await ensureInstallOptions();
    renderWhen();
    renderServices();
    renderTeam();
    $("jobNotes").value = st.notes;
    $("jmAttention").value = st.attention;
    if ($("jmNeedsDelivery")) $("jmNeedsDelivery").checked = Boolean(st.needsDelivery);
    renderDeliveryBox();
    renderChecklist();
    renderLockbox();
    renderSide();
    renderFoot();
    applySection();
  }

  function applySection() {
    const modal = $("jobModal");
    const all = st.section === "all";
    modal.dataset.section = st.section;
    document.querySelectorAll("#jobModalMain [data-job-section]").forEach((el) => {
      el.hidden = !all && el.getAttribute("data-job-section") !== st.section;
    });
    $("jmSide").hidden = !all;
    $("jobModalTitle").textContent = all
      ? st.id
        ? st.number != null
          ? `Job #${st.number}`
          : "Editar job"
        : "Novo job"
      : SECTION_TITLES[st.section] || "Editar job";
    showErr("");
  }

  function showErr(msg) {
    const el = $("jmErr");
    if (!el) return;
    el.textContent = msg || "";
    el.hidden = !msg;
  }

  // ---------------------------------------------------------------- client selection
  function setClient(kind, id) {
    if (kind === "customer") {
      st.customerId = id;
      st.builderId = null;
      const c = currentCustomer();
      const t = String(c?.customer_type || "particular").toLowerCase();
      st.sourceType = t === "contractor" ? "builder" : TYPE_LABEL[t] ? t : "particular";
      if (st.sourceNameAuto) st.sourceName = c?.company || "";
      // Keep address blank for the job site — do not copy the customer mailing address.
    } else {
      st.builderId = id;
      st.customerId = null;
      const b = currentBuilder();
      const t = String(b?.type || "builder").toLowerCase();
      st.sourceType = ["builder", "contractor", "loja"].includes(t) ? t : "builder";
      if (st.sourceNameAuto) st.sourceName = builderName(b);
      // Do not copy builder mailing address into the job site field.
    }
    st.pickerOpen = false;
    st.pickerQuery = "";
    repriceLines();
    renderAll();
    setTimeout(() => {
      if (!st) return;
      if (!st.address.trim()) $("jobAddress")?.focus();
    }, 30);
  }

  async function quickCreateClient(type) {
    const name = st.pickerQuery.trim();
    if (!name) return;
    try {
      const j = await api("/api/customers", {
        method: "POST",
        body: JSON.stringify({ name, customer_type: type, address: st.address.trim() || null }),
      });
      customers = [j.data, ...customers];
      notify(`${name} cadastrado como ${TYPE_LABEL[type]}.`, "success");
      setClient("customer", j.data.id);
    } catch (e) {
      notify(e.message || "Não foi possível cadastrar", "error");
    }
  }

  let searchTimer = null;
  function remoteSearch(q) {
    clearTimeout(searchTimer);
    if (!q || q.length < 2) return;
    searchTimer = setTimeout(async () => {
      const [c, b] = await Promise.all([
        api(`/api/customers?limit=50&q=${encodeURIComponent(q)}`).catch(() => ({ data: [] })),
        api(`/api/builders?limit=50&search=${encodeURIComponent(q)}`).catch(() => ({ data: [] })),
      ]);
      let added = 0;
      const addUnique = (list, rows) => {
        const ids = new Set(list.map((x) => String(x.id)));
        rows.forEach((r) => {
          if (!ids.has(String(r.id))) {
            list.push(r);
            added += 1;
          }
        });
      };
      addUnique(customers, c.data || []);
      addUnique(builders, b.data || []);
      if (added && st && st.pickerOpen && st.pickerQuery.trim() === q) renderPickerKeepFocus();
    }, 250);
  }

  function renderPickerKeepFocus() {
    const old = $("jmClientQ");
    const pos = old ? old.selectionStart : null;
    renderClient();
    const inp = $("jmClientQ");
    if (inp) {
      inp.focus();
      try {
        if (pos != null) inp.setSelectionRange(pos, pos);
      } catch (_) {}
    }
  }

  // ---------------------------------------------------------------- lookups
  async function loadLookups() {
    if (lookupsReady) return;
    const [u, c, b, p] = await Promise.all([
      api("/api/users?limit=100").catch(() => ({ data: [] })),
      api("/api/customers?limit=200").catch(() => ({ data: [] })),
      api("/api/builders?limit=100").catch(() => api("/api/builders/select").catch(() => ({ data: [] }))),
      api("/api/work-orders/pricing-catalog").catch(() => ({ data: [] })),
    ]);
    users = (u.data || []).filter((x) => x.is_active !== 0 && x.status !== "disabled");
    customers = c.data || [];
    builders = (b.data || []).filter((x) => x.status !== "inactive");
    pricing = p.data || [];
    lookupsReady = true;
  }

  // ---------------------------------------------------------------- open / close
  function open() {
    $("jobModal").classList.add("is-open");
    $("jobModalBackdrop").classList.add("is-open");
    document.body.classList.add("jm-open");
    Promise.resolve(renderAll()).catch(() => {});
    if (window.sfAttachAddressAutocomplete) {
      try {
        window.sfAttachAddressAutocomplete($("jobAddress"), { map: { combined: $("jobAddress") } });
      } catch (_) {}
    }
    $("jobModalMain").scrollTop = 0;
    setTimeout(() => {
      if (st && !st.id && st.pickerOpen && window.matchMedia("(min-width: 901px)").matches) $("jmClientQ")?.focus();
    }, 60);
  }

  function close() {
    closeSaveRateModal();
    $("jobModal")?.classList.remove("is-open");
    $("jobModalBackdrop")?.classList.remove("is-open");
    document.body.classList.remove("jm-open");
    st = null;
  }

  function nextDayAfter(isoOrDate) {
    const d = isoOrDate ? new Date(isoOrDate) : new Date();
    if (Number.isNaN(d.getTime())) {
      const t = new Date();
      t.setDate(t.getDate() + 1);
      return t;
    }
    const n = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, d.getHours() || 7, d.getMinutes() || 30, 0, 0);
    return n;
  }

  async function openCreate(opts) {
    if (!canManage) {
      notify("Sem permissão para criar jobs.", "error");
      return;
    }
    await Promise.all([loadLookups(), ensureJobsSettings()]);
    st = blankState();
    const o = opts || {};
    let start = o.start ? new Date(o.start) : null;
    if (!start || Number.isNaN(start.getTime())) {
      const pref = sessionStorage.getItem("obramate_job_pref_start");
      if (pref) {
        sessionStorage.removeItem("obramate_job_pref_start");
        start = new Date(pref);
      }
    }
    if (start && !Number.isNaN(start.getTime())) {
      st.date = ymd(start);
      // A slot picked on the agenda at midnight means "that day", not 00:00.
      if (start.getHours() || start.getMinutes()) st.time = hm(start);
    } else {
      const t = new Date();
      t.setDate(t.getDate() + 1);
      st.date = ymd(t);
    }
    if (meId && users.some((x) => String(x.id) === String(meId))) {
      st.assigneeId = String(meId);
      st.members.add(String(meId));
    }
    if (o.sector === "installation" || o.sector === "sand_finish") st.sector = o.sector;
    if (o.relatedWorkOrderId) {
      st.relatedWorkOrderId = String(o.relatedWorkOrderId);
      st.relatedWorkOrder = o.relatedWorkOrder || { id: st.relatedWorkOrderId, title: o.relatedTitle || "Job ligado", number: o.relatedNumber ?? null };
    }
    if (o.customerId) {
      st.customerId = String(o.customerId);
      st.pickerOpen = false;
    }
    if (o.builderId) {
      st.builderId = String(o.builderId);
      st.pickerOpen = false;
    }
    if (o.sourceType) st.sourceType = o.sourceType;
    if (o.sourceName != null) {
      st.sourceName = o.sourceName;
      st.sourceNameAuto = false;
    }
    if (o.address != null) {
      st.address = o.address;
      st.addressTouched = true;
    }
    if (o.notes != null) st.notes = o.notes;
    if (o.title) {
      st.title = o.title;
      st.titleTouched = true;
    }
    st.lines = [blankLine()];
    open();
  }

  async function openScheduleLixaFrom(wo) {
    const base = wo || null;
    if (!base || !base.id) return;
    const start = nextDayAfter(base.scheduled_end || base.scheduled_start);
    await openCreate({
      start,
      sector: "sand_finish",
      relatedWorkOrderId: base.id,
      relatedWorkOrder: {
        id: base.id,
        number: base.number,
        title: base.title,
        sector: base.sector,
        status: base.status,
      },
      customerId: base.customer_id || null,
      builderId: base.builder_id || null,
      sourceType: base.source_type || "particular",
      sourceName: base.source_name || "",
      address: base.address || "",
      notes: base.notes || "",
      title: base.title ? `${base.title} — Lixa` : "Lixa",
    });
  }

  async function openEdit(id, opts) {
    await Promise.all([loadLookups(), ensureJobsSettings()]);
    const j = await api(`/api/work-orders/${id}`);
    const wo = j.data;
    // The job's own client may be older than the first page of the lists.
    if (wo.customer_id && !customers.some((c) => String(c.id) === String(wo.customer_id))) {
      const full = await api(`/api/customers/${wo.customer_id}`).catch(() => null);
      customers.push(full?.data || { id: wo.customer_id, name: wo.customer?.name || "Cliente", customer_type: "particular" });
    }
    if (wo.builder_id && !builders.some((b) => String(b.id) === String(wo.builder_id))) {
      builders.push({ id: wo.builder_id, company: wo.builder?.company, name: wo.builder?.name, type: "builder" });
    }
    st = blankState();
    const section = (opts && opts.section) || "all";
    st.section = SECTIONS.includes(section) ? section : "all";
    st.id = wo.id;
    st.number = wo.number;
    st.status = wo.status || "draft";
    st.customerId = wo.customer_id || null;
    st.builderId = wo.builder_id || null;
    st.sourceType = wo.source_type || "other";
    st.sourceName = wo.source_name || "";
    st.sourceNameAuto = !wo.source_name;
    st.title = wo.title || "";
    st.titleTouched = true;
    st.address = wo.address || "";
    st.addressTouched = true;
    const s = wo.scheduled_start ? new Date(wo.scheduled_start) : null;
    if (s) {
      st.date = ymd(s);
      st.time = hm(s);
    }
    st.assigneeId = wo.assigned_user_id ? String(wo.assigned_user_id) : null;
    (wo.members || []).forEach((m) => st.members.add(String(m.user_id)));
    st.lines = (wo.line_items || []).map((li) =>
      blankLine({
        pricingId: li.pricing_item_id || null,
        name: li.service_name || "",
        qty: li.quantity_sqft || 0,
        price: li.unit_price || 0,
        unit: li.unit || null,
        priceTouched: true,
        manual: !li.pricing_item_id,
        note: li.notes || "",
      }),
    );
    st.notes = wo.notes || "";
    st.attention = wo.campo_attention || "";
    st.needsDelivery = Boolean(wo.needs_delivery);
    st.deliveryPickupAddress = wo.delivery_pickup_address || "";
    st.deliveryNotes = wo.delivery_notes || "";
    st.deliveryAttachment = wo.delivery_attachment || null;
    st.deliveryAttachmentPending = null;
    st.clearDeliveryAttachment = false;
    st.checklist = Array.isArray(wo.campo_checklist)
      ? wo.campo_checklist.map((c) => ({ id: c.id, text: c.text, photo: Boolean(c.photo_required), done: Boolean(c.done) }))
      : [];
    st.temps = Array.isArray(wo.temp_workers) ? wo.temp_workers : [];
    st.sector = wo.sector === "installation" || wo.sector === "sand_finish" ? wo.sector : null;
    st.relatedWorkOrderId = wo.related_work_order_id || null;
    st.relatedWorkOrder = wo.related_work_order || null;
    st.relatedChildren = Array.isArray(wo.related_children) ? wo.related_children : [];
    st.pickerOpen = !(st.customerId || st.builderId);
    open();
  }

  // ---------------------------------------------------------------- save
  function payload() {
    const { start, end } = computeRange();
    let title = (st.titleTouched ? st.title : st.title || autoTitle()).trim() || "Novo job";
    if (title.length < 2) title = `Job ${title}`;
    const members = [...st.members];
    if (st.assigneeId && !members.includes(String(st.assigneeId))) members.push(String(st.assigneeId));
    const body = {
      title,
      source_type: st.sourceType,
      source_name: st.sourceName.trim() || null,
      customer_id: st.customerId || null,
      builder_id: st.builderId || null,
      address: st.address.trim() || null,
      notes: st.notes.trim() || null,
      campo_attention: st.attention.trim() || null,
      needs_delivery: Boolean(st.needsDelivery),
      delivery_pickup_address: st.needsDelivery ? st.deliveryPickupAddress.trim() || null : null,
      delivery_notes: st.needsDelivery ? st.deliveryNotes.trim() || null : null,
      clear_delivery_attachment: Boolean(st.clearDeliveryAttachment),
      assigned_user_id: st.assigneeId || null,
      member_user_ids: members,
      line_items: st.lines
        .filter((l) => l.pricingId || String(l.name || "").trim())
        .map((l) => {
          const item = l.pricingId ? pricing.find((p) => p.id === l.pricingId) : null;
          return {
            pricing_item_id: l.pricingId || null,
            service_name: (item?.name || l.name || "Serviço").trim(),
            quantity_sqft: Number(l.qty) || 0,
            unit_price: Number(l.price) || 0,
            notes: String(l.note || "").trim() || null,
          };
        }),
      scheduled_start: start ? start.toISOString() : null,
      scheduled_end: end ? end.toISOString() : null,
      status: st.id ? st.status : start ? "scheduled" : "draft",
      sector: st.sector || null,
      related_work_order_id: st.sector === "sand_finish" ? st.relatedWorkOrderId || null : null,
    };
    if (checklistEnabled) {
      body.campo_checklist = st.checklist
        .filter((c) => String(c.text || "").trim())
        .map((c) => ({ id: c.id || null, text: String(c.text).trim().slice(0, 200), photo_required: Boolean(c.photo) }));
    }
    return body;
  }

  function sectionPayload(full) {
    if (st.section === "all") return full;
    const pick = {
      details: ["title", "source_type", "source_name", "customer_id", "builder_id", "address", "status"],
      schedule: ["scheduled_start", "scheduled_end", "sector", "related_work_order_id"],
      services: ["line_items"],
      team: ["assigned_user_id", "member_user_ids"],
      campo: checklistEnabled
        ? ["campo_attention", "campo_checklist", "needs_delivery", "delivery_pickup_address", "delivery_notes", "clear_delivery_attachment"]
        : ["campo_attention", "needs_delivery", "delivery_pickup_address", "delivery_notes", "clear_delivery_attachment"],
      notes: ["notes"],
    }[st.section];
    const out = {};
    pick.forEach((k) => {
      if (full[k] !== undefined) out[k] = full[k];
    });
    // Scheduling a draft from the agenda section moves it to "scheduled".
    if (st.section === "schedule" && full.scheduled_start && st.status === "draft") out.status = "scheduled";
    return out;
  }

  function validate(body) {
    const all = st.section === "all";
    if ((all || st.section === "details") && !st.customerId && !st.builderId && !(st.titleTouched && st.title.trim())) {
      return "Escolha para quem é o job (ou escreva um título em Editar).";
    }
    if ((all || st.section === "schedule") && body.scheduled_start && body.scheduled_end) {
      if (new Date(body.scheduled_end) <= new Date(body.scheduled_start)) return "O fim precisa ser depois do início.";
    }
    if (all || st.section === "services") {
      const bad = st.lines.find((l) => (l.pricingId || String(l.name || "").trim()) && !(Number(l.qty) > 0));
      if (bad) return "Informe a quantidade de cada serviço.";
    }
    return null;
  }

  async function save(e) {
    e.preventDefault();
    if (!canManage || !st || st.busy) return;
    const full = payload();
    const err = validate(full);
    if (err) {
      showErr(err);
      return;
    }
    const body = sectionPayload(full);
    const pendingToFlush = !st.id && Array.isArray(st.pendingTemps) ? st.pendingTemps.slice() : [];
    st.busy = true;
    renderFoot();
    try {
      const isCreate = !st.id;
      const j = isCreate
        ? await api("/api/work-orders", { method: "POST", body: JSON.stringify(body) })
        : await api(`/api/work-orders/${st.id}`, { method: "PUT", body: JSON.stringify(body) });
      const createdId = j.data?.id;
      let tempsOk = 0;
      let tempsFail = 0;
      if (isCreate && createdId && pendingToFlush.length) {
        for (const t of pendingToFlush) {
          try {
            await api(`/api/work-orders/${createdId}/temp-workers`, {
              method: "POST",
              body: JSON.stringify({ name: t.name, phone: t.phone || null }),
            });
            tempsOk += 1;
          } catch (_) {
            tempsFail += 1;
          }
        }
      }
      const jobId = createdId || st.id;
      if (jobId && st.needsDelivery && st.deliveryAttachmentPending?.data_url) {
        try {
          const up = await api(`/api/work-orders/${jobId}/delivery-attachment`, {
            method: "POST",
            body: JSON.stringify({
              data_url: st.deliveryAttachmentPending.data_url,
              file_name: st.deliveryAttachmentPending.name || "anexo",
            }),
          });
          if (up.data) j.data = up.data;
        } catch (upErr) {
          notify(upErr.message || "Job salvo, mas o anexo do Delivery falhou.", "warning");
        }
      }
      const n = j.data?.number != null ? `#${j.data.number}` : "";
      // Agenda conflicts only matter when the edit touched when/who.
      const touchesAgenda = ["all", "schedule", "team"].includes(st.section);
      if (touchesAgenda && j.conflicts && j.conflicts.length) {
        notify(`Job ${n} salvo — atenção: conflito de agenda com a equipe.`, "warning");
      } else if (tempsFail) {
        notify(
          `Job ${n} criado, mas ${tempsFail} funcionário${tempsFail > 1 ? "s" : ""} extra não ${tempsFail > 1 ? "foram cadastrados" : "foi cadastrado"}. Abra o job e tente de novo.`,
          "warning",
        );
      } else if (tempsOk) {
        notify(
          `Job ${n} criado com ${tempsOk} funcionário${tempsOk > 1 ? "s" : ""} extra. Envie o link por WhatsApp/SMS na edição do job.`,
          "success",
        );
      } else {
        notify(isCreate ? `Job ${n} criado.` : "Job salvo.", "success");
      }
      close();
      savedListeners.forEach((fn) => {
        try {
          fn(j.data, { created: isCreate });
        } catch (_) {}
      });
    } catch (ex) {
      if (st) {
        st.busy = false;
        renderFoot();
      }
      showErr(ex.message || "Erro ao salvar");
    }
  }

  async function cancelJob() {
    if (!st?.id || !canManage) return;
    if (!confirm("Excluir este job? Ele será marcado como cancelado e sairá da agenda.")) return;
    try {
      await api(`/api/work-orders/${st.id}`, { method: "DELETE" });
      notify("Job excluído.", "success");
      close();
      savedListeners.forEach((fn) => {
        try {
          fn(null);
        } catch (_) {}
      });
    } catch (err) {
      showErr(err.message || "Erro");
    }
  }

  // ---------------------------------------------------------------- temps
  async function tempShare(id, channel) {
    try {
      const j = await api(`/api/work-orders/${st.id}/temp-workers/${id}/share-link`, { method: "POST" });
      const d = j.data || {};
      if (channel === "wa" && d.whatsapp_url) window.open(d.whatsapp_url, "_blank", "noopener");
      else if (channel === "sms" && d.sms_url) window.location.href = d.sms_url;
      else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(d.url);
        notify("Link copiado.", "success");
      } else window.prompt("Link do job:", d.url);
    } catch (err) {
      notify(err.message || "Erro ao gerar o link", "error");
    }
  }
  async function tempAdd() {
    const name = ($("tempName")?.value || "").trim();
    if (name.length < 2) {
      notify("Informe o nome do funcionário extra.", "error");
      return;
    }
    const phone = ($("tempPhone")?.value || "").trim() || null;
    // During create, queue locally — API needs the job id first.
    if (!st.id) {
      if (!Array.isArray(st.pendingTemps)) st.pendingTemps = [];
      st.pendingTemps.push({ name, phone });
      renderTeam();
      notify("Funcionário extra na fila — será cadastrado ao salvar o job.", "success");
      return;
    }
    try {
      const j = await api(`/api/work-orders/${st.id}/temp-workers`, {
        method: "POST",
        body: JSON.stringify({ name, phone }),
      });
      st.temps = [...st.temps, j.data];
      renderTeam();
      notify("Funcionário extra adicionado — envie o link por WhatsApp ou SMS.", "success");
    } catch (err) {
      notify(err.message || "Erro", "error");
    }
  }
  function tempPendingDel(index) {
    if (!Array.isArray(st.pendingTemps)) return;
    const i = Number(index);
    if (!Number.isInteger(i) || i < 0 || i >= st.pendingTemps.length) return;
    st.pendingTemps.splice(i, 1);
    renderTeam();
  }
  async function tempDel(id) {
    if (!confirm("Remover este funcionário extra? O link dele deixa de funcionar.")) return;
    try {
      await api(`/api/work-orders/${st.id}/temp-workers/${id}`, { method: "DELETE" });
      st.temps = st.temps.filter((t) => t.id !== id);
      renderTeam();
    } catch (err) {
      notify(err.message || "Erro", "error");
    }
  }

  // ---------------------------------------------------------------- events
  function lineFromEl(el) {
    const row = el.closest(".jm-ln");
    const i = row ? Number(row.getAttribute("data-i")) : -1;
    return { row, i, line: i >= 0 ? st.lines[i] : null };
  }

  function onClick(e) {
    if (!st) return;
    if (e.target.id === "jmDeliveryFileClear" || e.target.closest("#jmDeliveryFileClear")) {
      e.preventDefault();
      st.deliveryAttachmentPending = null;
      st.clearDeliveryAttachment = true;
      if ($("jmDeliveryFile")) $("jmDeliveryFile").value = "";
      renderDeliveryBox();
      return;
    }
    const btn = e.target.closest("[data-act]");
    if (!btn) return;
    const act = btn.getAttribute("data-act");
    e.preventDefault();
    switch (act) {
      case "close":
        close();
        break;
      case "ck-add":
        ckAdd();
        break;
      case "ck-del": {
        const i = Number(btn.getAttribute("data-i"));
        st.checklist.splice(i, 1);
        renderChecklist();
        break;
      }
      case "ck-up": {
        const i = Number(btn.getAttribute("data-i"));
        if (i > 0) [st.checklist[i - 1], st.checklist[i]] = [st.checklist[i], st.checklist[i - 1]];
        renderChecklist();
        break;
      }
      case "ck-photo": {
        const c = st.checklist[Number(btn.getAttribute("data-i"))];
        if (c) c.photo = !c.photo;
        renderChecklist();
        break;
      }
      case "ck-tpl": {
        const t = CK_TEMPLATES.find((x) => x.key === btn.getAttribute("data-key"));
        if (!t) break;
        const have = new Set(st.checklist.map((c) => c.text.trim().toLowerCase()));
        t.items.forEach(([text, photo]) => {
          if (!have.has(text.toLowerCase()) && st.checklist.length < 40) st.checklist.push({ id: null, text, photo, done: false });
        });
        renderChecklist();
        break;
      }
      case "pick":
        setClient(btn.getAttribute("data-kind"), btn.getAttribute("data-id"));
        break;
      case "change-client":
        st.pickerOpen = true;
        renderClient();
        setTimeout(() => $("jmClientQ")?.focus(), 20);
        break;
      case "keep-client":
        st.pickerOpen = false;
        st.pickerQuery = "";
        renderClient();
        break;
      case "quick-client":
        quickCreateClient(btn.getAttribute("data-type"));
        break;
      case "more":
        st.moreOpen = !st.moreOpen;
        renderMore();
        break;
      case "schedule-lixa": {
        if (!st?.id) break;
        const snap = {
          id: st.id,
          number: st.number,
          title: st.title || autoTitle(),
          sector: st.sector,
          status: st.status,
          customer_id: st.customerId,
          builder_id: st.builderId,
          source_type: st.sourceType,
          source_name: st.sourceName,
          address: st.address,
          notes: st.notes,
          scheduled_start: computeRange().start ? computeRange().start.toISOString() : null,
          scheduled_end: null,
        };
        close();
        openScheduleLixaFrom(snap);
        break;
      }
      case "add-line":
        st.lines.push(blankLine());
        renderServices();
        refreshNumbers();
        setTimeout(() => {
          const inputs = $("jmSvc").querySelectorAll('[data-f="svc-q"]');
          const last = inputs[inputs.length - 1];
          if (last) {
            last.focus();
            const { line } = lineFromEl(last);
            if (line) {
              line.svcOpen = true;
              line.svcQuery = "";
              renderServices();
              $("jmSvc").querySelector(`.jm-ln[data-i="${st.lines.length - 1}"] [data-f="svc-q"]`)?.focus();
            }
          }
        }, 20);
        break;
      case "add-manual":
        st.lines.push(blankLine({ manual: true }));
        renderServices();
        refreshNumbers();
        setTimeout(() => {
          const inputs = $("jmSvc").querySelectorAll('[data-f="name"]');
          inputs[inputs.length - 1]?.focus();
        }, 20);
        break;
      case "manual-line": {
        const { line, i } = lineFromEl(btn);
        if (!line) break;
        const q = String(line.svcQuery || "").trim();
        line.manual = true;
        line.pricingId = null;
        line.unit = null;
        line.svcOpen = false;
        line.svcQuery = "";
        if (!String(line.name || "").trim() && q) line.name = q;
        renderServices();
        refreshNumbers();
        setTimeout(() => $("jmSvc").querySelector(`.jm-ln[data-i="${i}"] [data-f="name"]`)?.focus(), 20);
        break;
      }
      case "to-catalog": {
        const { line, i } = lineFromEl(btn);
        if (!line) break;
        line.manual = false;
        line.svcOpen = true;
        line.svcQuery = "";
        renderServices();
        setTimeout(() => $("jmSvc").querySelector(`.jm-ln[data-i="${i}"] [data-f="svc-q"]`)?.focus(), 20);
        break;
      }
      case "pick-svc": {
        const { line, i } = lineFromEl(btn);
        if (!line) break;
        const item = pricing.find((p) => p.id === btn.getAttribute("data-id")) || null;
        line.manual = false;
        line.pricingId = item ? item.id : null;
        line.unit = item?.unit || null;
        if (item) line.name = item.name;
        line.price = item ? priceFor(item) : line.price;
        line.priceTouched = false;
        line.svcOpen = false;
        line.svcQuery = "";
        renderServices();
        refreshNumbers();
        setTimeout(() => $("jmSvc").querySelector(`.jm-ln[data-i="${i}"] [data-f="qty"]`)?.focus(), 20);
        break;
      }
      case "del-line": {
        const { i } = lineFromEl(btn);
        if (i >= 0) st.lines.splice(i, 1);
        renderServices();
        refreshNumbers();
        break;
      }
      case "user": {
        const id = String(btn.getAttribute("data-id"));
        if (st.members.has(id) || String(st.assigneeId) === id) {
          st.members.delete(id);
          if (String(st.assigneeId) === id) st.assigneeId = [...st.members][0] || null;
        } else {
          st.members.add(id);
          if (!st.assigneeId) st.assigneeId = id;
        }
        renderTeam();
        renderSide();
        break;
      }
      case "cancel-job":
        cancelJob();
        break;
      case "temp-add":
        tempAdd();
        break;
      case "temp-pending-del":
        tempPendingDel(btn.getAttribute("data-i"));
        break;
      case "temp-del":
        tempDel(btn.getAttribute("data-id"));
        break;
      case "temp-wa":
        tempShare(btn.getAttribute("data-id"), "wa");
        break;
      case "temp-sms":
        tempShare(btn.getAttribute("data-id"), "sms");
        break;
      case "temp-copy":
        tempShare(btn.getAttribute("data-id"), "copy");
        break;
      default:
        break;
    }
  }

  function onInput(e) {
    if (!st) return;
    const t = e.target;
    if (t.hasAttribute && t.hasAttribute("data-ck-text")) {
      const c = st.checklist[Number(t.getAttribute("data-ck-text"))];
      if (c) c.text = t.value;
      return;
    }
    switch (t.id) {
      case "jmAttention":
        st.attention = t.value;
        return;
      case "jmNeedsDelivery":
        st.needsDelivery = Boolean(t.checked);
        if (!st.needsDelivery) {
          st.clearDeliveryAttachment = true;
          st.deliveryAttachmentPending = null;
        }
        renderDeliveryBox();
        renderSide();
        return;
      case "jmDeliveryPickup":
        st.deliveryPickupAddress = t.value;
        renderSide();
        return;
      case "jmDeliveryNotes":
        st.deliveryNotes = t.value;
        return;
      case "jmClientQ":
        st.pickerQuery = t.value;
        renderPickerKeepFocus();
        remoteSearch(t.value.trim());
        return;
      case "jobAddress":
        st.address = t.value;
        st.addressTouched = true;
        renderAddrHint();
        if (!st.titleTouched && !st.moreOpen) renderMore();
        return;
      case "jobTitle":
        st.title = t.value;
        st.titleTouched = Boolean(t.value.trim());
        return;
      case "jobSourceName":
        st.sourceName = t.value;
        st.sourceNameAuto = false;
        return;
      case "jobNotes":
        st.notes = t.value;
        renderLockbox();
        return;
      default:
        break;
    }
    const f = t.getAttribute && t.getAttribute("data-f");
    if (f === "svc-q") {
      const { line, i } = lineFromEl(t);
      if (!line) return;
      line.svcQuery = t.value;
      line.svcOpen = true;
      line.manual = false;
      // Keep caret: re-render dropdown only via lightweight update
      const pick = t.closest(".jm-svc-pick");
      if (pick) {
        const matches = filterPricing(line.svcQuery);
        let dd = pick.querySelector(".jm-svc-dd");
        if (!dd) {
          dd = document.createElement("div");
          dd.className = "jm-svc-dd";
          dd.setAttribute("role", "listbox");
          dd.setAttribute("aria-label", "Serviços da tabela");
          pick.appendChild(dd);
        }
        dd.hidden = false;
        t.closest(".jm-search--svc")?.classList.add("is-open");
        t.setAttribute("aria-expanded", "true");
        dd.innerHTML =
          (matches.length
            ? matches
                .map((p) => {
                  const rate = priceFor(p);
                  return `<button type="button" class="jm-svc-dd__opt" role="option" data-act="pick-svc" data-id="${esc(p.id)}"><b>${esc(p.name)}</b><small>${rate > 0 ? `${money(rate)}/${esc(unitLabel(p.unit))}` : esc(unitLabel(p.unit))}</small></button>`;
                })
                .join("")
            : `<p class="jm-svc-dd__empty">${pricing.length ? "Nenhum serviço com esse nome." : "Tabela de Valores vazia."}</p>`) +
          `<button type="button" class="jm-svc-dd__manual" data-act="manual-line">+ Serviço manual (fora da tabela)</button>`;
        // Close other rows' dropdowns without full re-render
        st.lines.forEach((other, oi) => {
          if (oi !== i && other.svcOpen) other.svcOpen = false;
        });
        $("jmSvc")
          .querySelectorAll(".jm-ln")
          .forEach((row) => {
            const ri = Number(row.getAttribute("data-i"));
            if (ri === i) return;
            row.querySelector(".jm-svc-dd")?.remove();
            row.querySelector(".jm-search--svc")?.classList.remove("is-open");
            row.querySelector('[data-f="svc-q"]')?.setAttribute("aria-expanded", "false");
          });
      }
      return;
    }
    if (f === "qty" || f === "price" || f === "name" || f === "note") {
      const { row, line } = lineFromEl(t);
      if (!line) return;
      if (f === "qty") line.qty = t.value;
      if (f === "price") {
        line.price = t.value;
        line.priceTouched = true;
      }
      if (f === "name") line.name = t.value;
      if (f === "note") line.note = t.value;
      const tot = row.querySelector("[data-tot]");
      if (tot) tot.textContent = money(lineTotal(line));
      refreshNumbers();
    }
  }

  function onChange(e) {
    if (!st) return;
    const t = e.target;
    switch (t.id) {
      case "jmDate":
        st.date = t.value;
        renderSide();
        return;
      case "jmTime":
        st.time = t.value;
        renderSide();
        return;
      case "jmNeedsDelivery":
        st.needsDelivery = Boolean(t.checked);
        if (!st.needsDelivery) {
          st.clearDeliveryAttachment = true;
          st.deliveryAttachmentPending = null;
        }
        renderDeliveryBox();
        renderSide();
        return;
      case "jmDeliveryFile": {
        const file = t.files && t.files[0];
        if (!file) return;
        if (file.size > 12 * 1024 * 1024) {
          notify("Arquivo grande demais (máx. 12MB).", "error");
          t.value = "";
          return;
        }
        readFileAsDataUrl(file)
          .then((data_url) => {
            st.deliveryAttachmentPending = { name: file.name, data_url };
            st.clearDeliveryAttachment = false;
            st.needsDelivery = true;
            if ($("jmNeedsDelivery")) $("jmNeedsDelivery").checked = true;
            renderDeliveryBox();
            renderSide();
          })
          .catch((err) => notify(err.message || "Falha ao ler arquivo.", "error"));
        return;
      }
      case "jmSector":
        st.sector = t.value === "installation" || t.value === "sand_finish" ? t.value : null;
        if (st.sector !== "sand_finish") st.relatedWorkOrderId = null;
        ensureInstallOptions().then(() => {
          renderWhen();
          renderSide();
          renderFoot();
        });
        return;
      case "jmRelated":
        st.relatedWorkOrderId = t.value || null;
        renderSide();
        return;
      case "jobAddress":
        // Address autocomplete writes the value without an input event.
        st.address = t.value;
        st.addressTouched = true;
        renderAddrHint();
        if (!st.titleTouched && !st.moreOpen) renderMore();
        return;
      case "jmLead":
        st.assigneeId = t.value || null;
        renderTeam();
        renderSide();
        return;
      case "jobStatus":
        st.status = t.value;
        renderSide();
        return;
      case "jobSourceType":
        st.sourceType = t.value;
        repriceLines();
        renderServices();
        renderSide();
        return;
      case "jobCustomer": {
        st.customerId = t.value || null;
        const c = currentCustomer();
        const ty = String(c?.customer_type || "").toLowerCase();
        if (ty === "contractor") st.sourceType = "builder";
        else if (TYPE_LABEL[ty]) st.sourceType = ty;
        repriceLines();
        st.pickerOpen = !(st.customerId || st.builderId);
        renderAll();
        return;
      }
      case "jobBuilder":
        st.builderId = t.value || null;
        repriceLines();
        st.pickerOpen = !(st.customerId || st.builderId);
        renderAll();
        return;
      default:
        break;
    }
    if (t.getAttribute("data-f") === "svc") {
      // Legacy select removed — kept for safety if old HTML is cached.
      return;
    }
  }

  function onKey(e) {
    if (!st) return;
    if (e.key === "Enter" && e.target.id === "jmClientQ") {
      e.preventDefault();
      $("jmClient").querySelector('[data-act="pick"]')?.click();
    }
    if (e.key === "Enter" && e.target.id === "jmCkNew") {
      e.preventDefault();
      ckAdd();
      return;
    }
    if (e.key === "Enter" && e.target.hasAttribute && e.target.hasAttribute("data-ck-text")) {
      e.preventDefault();
      $("jmCkNew")?.focus();
      return;
    }
    if (e.key === "Enter" && (e.target.id === "tempName" || e.target.id === "tempPhone")) {
      e.preventDefault();
      tempAdd();
    }
  }

  function bindOnce() {
    const modal = $("jobModal");
    $("jobModalBackdrop").addEventListener("click", close);
    $("btnCloseJobModal").addEventListener("click", close);
    $("jobForm").addEventListener("submit", save);
    modal.addEventListener("click", onClick);
    modal.addEventListener("input", onInput);
    modal.addEventListener("change", onChange);
    modal.addEventListener("focusin", (e) => {
      if (!st) return;
      const t = e.target;
      if (t.getAttribute && t.getAttribute("data-f") === "price") {
        const { line, i } = lineFromEl(t);
        if (!line) return;
        const item = line.pricingId ? pricing.find((p) => String(p.id) === String(line.pricingId)) : null;
        priceEditCtx = {
          i,
          pricingId: line.pricingId || null,
          baseline: Number(line.price) || 0,
          tableRate: item ? systemRateFor(item) : 0,
        };
      }
      if (t.getAttribute && t.getAttribute("data-f") === "svc-q") {
        const { line, i } = lineFromEl(t);
        if (!line) return;
        const wasOpen = Boolean(line.svcOpen);
        st.lines.forEach((other, oi) => {
          other.svcOpen = oi === i;
        });
        if (!wasOpen) {
          line.svcQuery = "";
          renderServices();
          const again = $("jmSvc").querySelector(`.jm-ln[data-i="${i}"] [data-f="svc-q"]`);
          if (again) {
            again.focus();
            try {
              again.select();
            } catch (_) {}
          }
        }
      }
    });
    modal.addEventListener("focusout", (e) => {
      if (!st) return;
      const t = e.target;
      if (!(t.getAttribute && t.getAttribute("data-f") === "price")) return;
      const { line, i } = lineFromEl(t);
      const ctx = priceEditCtx;
      priceEditCtx = null;
      if (!line || !ctx || ctx.i !== i) return;
      const newRate = Number(line.price);
      if (!Number.isFinite(newRate)) return;
      if (ratesNearlyEqual(newRate, ctx.baseline)) return;
      setTimeout(() => maybeOfferRatePersist(i), 0);
    });
    modal.addEventListener("keydown", onKey);
    ensureRateModal();
    document.addEventListener("pointerdown", (e) => {
      if (!st || !modal.classList.contains("is-open")) return;
      if (e.target.closest(".jm-svc-pick")) return;
      if (!st.lines.some((l) => l.svcOpen)) return;
      st.lines.forEach((l) => {
        l.svcOpen = false;
        l.svcQuery = "";
      });
      renderServices();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && $("jmSaveRateModal") && !$("jmSaveRateModal").classList.contains("hidden")) {
        closeSaveRateModal();
        e.stopPropagation();
        return;
      }
      if (e.key === "Escape" && st && modal.classList.contains("is-open")) {
        if (st.lines.some((l) => l.svcOpen)) {
          st.lines.forEach((l) => {
            l.svcOpen = false;
            l.svcQuery = "";
          });
          renderServices();
          e.stopPropagation();
          return;
        }
        // Let the address suggestions close first.
        if (document.activeElement?.id === "jobAddress" && document.querySelector(".crm-photon-ac:not([hidden]), .pac-container[style*='block']")) return;
        close();
      }
    });
  }

  async function initSession() {
    try {
      const s = await api("/api/auth/session");
      const perms = s.user?.permissions || [];
      const role = s.user?.role || s.user?.roleKey || "";
      canManage = role === "admin" || perms.includes("work_orders.manage");
      meId = s.user?.id || null;
    } catch (_) {
      canManage = false;
    }
  }

  const ready = (async () => {
    ensureCss();
    ensureDom();
    await initSession();
    bindOnce();
  })();

  window.__crmJobModal = {
    ready,
    openCreate: (opts) => ready.then(() => openCreate(opts)),
    openEdit: (id, opts) => ready.then(() => openEdit(id, opts)),
    openSection: (id, section) => ready.then(() => openEdit(id, { section: section || "all" })),
    openScheduleLixa: (wo) => ready.then(() => openScheduleLixaFrom(wo)),
    close: () => close(),
    onSaved: (fn) => {
      if (typeof fn === "function") savedListeners.push(fn);
    },
    canManage: () => canManage,
  };
})();
