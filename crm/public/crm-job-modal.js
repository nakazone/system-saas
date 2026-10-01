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

  const CSS_HREF = "crm-job-modal.css?v=20261001-lockbox2";
  const SECTIONS = ["details", "schedule", "services", "team", "notes"];
  const SECTION_TITLES = {
    details: "Cliente e endereço",
    schedule: "Quando",
    team: "Equipe & temporários",
    services: "Serviços do job",
    notes: "Notas",
  };
  const TYPE_LABEL = { builder: "Builder", contractor: "Contractor", loja: "Loja", particular: "Particular" };
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
      assigneeId: null,
      members: new Set(),
      lines: [],
      notes: "",
      temps: [],
      pickerOpen: true,
      pickerQuery: "",
      moreOpen: false,
      busy: false,
    };
  }

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
        type: String(c.customer_type || "particular").toLowerCase(),
        sub: [c.company && c.company !== c.name ? c.company : null, c.phone, c.email].filter(Boolean).join(" · "),
        address: c.address || "",
        custom: c.pricing_mode === "custom",
      };
    }
    const b = currentBuilder();
    if (b) {
      const person = [b.first_name, b.last_name].filter(Boolean).join(" ");
      return {
        name: builderName(b),
        type: String(b.type || "builder").toLowerCase(),
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
      .map((c) => ({
        kind: "customer",
        id: c.id,
        name: c.name || c.company || "Cliente",
        type: String(c.customer_type || "particular").toLowerCase(),
        sub: [c.address, c.phone].filter(Boolean)[0] || "",
      }));
    // Fixed-price accounts (builder / contractor / loja) first — that is the day-to-day job.
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
    if ($("jobModal")) return;
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
            <span class="jm-inwrap"><input type="text" id="jobAddress" class="jm-in" maxlength="500" autocomplete="off" placeholder="Local da obra (não o cadastro do cliente)" /><small class="jm-in__hint" id="jmAddrHint"></small></span>
          </label>
          <div class="jm-more" id="jmMore"></div>
        </section>

        <section class="jm-sec" data-job-section="schedule">
          <h3 class="jm-sec__t"><span class="jm-n">2</span>Quando</h3>
          <div class="jm-when">
            <label class="jm-field">Data<input type="date" id="jmDate" class="jm-in" /></label>
            <label class="jm-field">Início<input type="time" id="jmTime" class="jm-in" step="900" /></label>
          </div>
          <p class="jm-hint">Só data e hora de início — a duração fica aberta (obras são imprevisíveis).</p>
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

        <section class="jm-sec" data-job-section="notes">
          <h3 class="jm-sec__t"><span class="jm-n">5</span>Notas internas</h3>
          <textarea id="jobNotes" class="jm-in jm-ta" rows="3" maxlength="8000" placeholder="Ex.: /lockbox 4821 — código da caixa da casa"></textarea>
          <p class="jm-hint">Escreva <code>/lockbox</code> e o código para mostrar o cadeado no job.</p>
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
        <input type="search" id="jmClientQ" class="jm-in" placeholder="Buscar builder, contractor, loja ou cliente…" autocomplete="off" value="${esc(st.pickerQuery)}" /></span>
      <div class="jm-opts">
        ${fixed.length ? `<p class="jm-grp">Builders, contractors e lojas</p>${fixed.map(item).join("")}` : ""}
        ${part.length ? `<p class="jm-grp">Particulares</p>${part.map(item).join("")}` : ""}
        ${!list.length ? `<p class="jm-empty">${q ? "Ninguém com esse nome." : "Nenhum cliente cadastrado ainda."}</p>` : ""}
        ${
          q
            ? `<div class="jm-new"><span>Cadastrar <b>${esc(q)}</b> como</span>
                ${["builder", "contractor", "loja", "particular"].map((t) => `<button type="button" class="jm-chip jm-chip--sm" data-act="quick-client" data-type="${t}">${TYPE_LABEL[t]}</button>`).join("")}</div>`
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
    const from = { builder: "do builder", contractor: "do contractor", loja: "da loja" }[card?.type] || "do cliente";
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

  function renderWhen() {
    $("jmDate").value = st.date || "";
    $("jmTime").value = st.time || "";
  }

  function renderServices() {
    const box = $("jmSvc");
    const opts = (sel) =>
      ['<option value="">Serviço personalizado…</option>']
        .concat(
          pricing.map((p) => {
            const rate = priceFor(p);
            return `<option value="${esc(p.id)}"${p.id === sel ? " selected" : ""}>${esc(p.name)}${rate > 0 ? ` — ${money(rate)}/${esc(unitLabel(p.unit))}` : ""}</option>`;
          }),
        )
        .join("");
    const rows = st.lines
      .map((l, i) => {
        const item = l.pricingId ? pricing.find((p) => p.id === l.pricingId) : null;
        const unit = unitLabel(item?.unit || l.unit);
        return `<div class="jm-ln" data-i="${i}">
          <div class="jm-ln__svc">
            <select class="jm-in jm-in--sm" data-f="svc" aria-label="Serviço">${opts(l.pricingId)}</select>
            ${!l.pricingId ? `<input type="text" class="jm-in jm-in--sm" data-f="name" maxlength="200" placeholder="Descrição do serviço" value="${esc(l.name)}" />` : ""}
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
      <div class="jm-svc__foot"><button type="button" class="jm-link" data-act="add-line">+ Adicionar serviço</button><span id="jmSvcCount"></span></div>`;
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
    if (!st.id) {
      temps.innerHTML = `${leadPick}<p class="jm-hint">Toque para incluir ou tirar do job. Temporários (link por WhatsApp) entram depois de criar.</p>`;
      return;
    }
    temps.innerHTML = `${leadPick}<div class="jm-temps">
      <p class="jm-grp">Temporários (link por WhatsApp/SMS)</p>
      ${st.temps
        .map(
          (t) => `<div class="jm-temp"><span><b>${esc(t.name)}</b><small>${esc([t.phone, t.email].filter(Boolean).join(" · ") || "sem telefone")}</small></span>
            <span class="jm-temp__act">
              <button type="button" class="jm-chip jm-chip--sm" data-act="temp-wa" data-id="${esc(t.id)}">WhatsApp</button>
              <button type="button" class="jm-chip jm-chip--sm" data-act="temp-sms" data-id="${esc(t.id)}">SMS</button>
              <button type="button" class="jm-chip jm-chip--sm" data-act="temp-copy" data-id="${esc(t.id)}">Copiar link</button>
              <button type="button" class="jm-ln__del" data-act="temp-del" data-id="${esc(t.id)}" aria-label="Remover">×</button>
            </span></div>`,
        )
        .join("")}
      <div class="jm-temp-add">
        <input type="text" id="tempName" class="jm-in jm-in--sm" maxlength="200" placeholder="Nome *" />
        <input type="tel" id="tempPhone" class="jm-in jm-in--sm" maxlength="40" placeholder="Telefone (WhatsApp)" />
        <button type="button" class="jm-chip jm-chip--sm" data-act="temp-add">+ Adicionar</button>
      </div>
    </div>`;
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
      ${isEdit && !onDetail ? `<a class="jm-btn jm-btn--ghost jm-btn--open" href="job-detail.html?id=${encodeURIComponent(st.id)}">Abrir job</a>` : ""}
      <span class="jm-sp"></span>
      <button type="button" class="jm-btn jm-btn--ghost jm-btn--cancel" data-act="close">Cancelar</button>
      <button type="submit" class="jm-btn jm-btn--pri" id="btnSaveJob"${st.busy ? " disabled" : ""}>${st.busy ? "Salvando…" : isEdit ? "Salvar" : "Criar job"}</button>`;
  }

  function refreshNumbers() {
    updateSvcCount();
    renderSide();
  }

  function renderAll() {
    renderClient();
    $("jobAddress").value = st.address;
    renderAddrHint();
    renderMore();
    renderWhen();
    renderServices();
    renderTeam();
    $("jobNotes").value = st.notes;
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
      st.sourceType = TYPE_LABEL[t] ? t : "particular";
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
    renderAll();
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
    $("jobModal")?.classList.remove("is-open");
    $("jobModalBackdrop")?.classList.remove("is-open");
    document.body.classList.remove("jm-open");
    st = null;
  }

  async function openCreate(opts) {
    if (!canManage) {
      notify("Sem permissão para criar jobs.", "error");
      return;
    }
    await loadLookups();
    st = blankState();
    let start = opts && opts.start ? new Date(opts.start) : null;
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
    st.lines = [{ pricingId: null, name: "", qty: 0, price: 0, unit: null, priceTouched: false }];
    open();
  }

  async function openEdit(id, opts) {
    await loadLookups();
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
    st.lines = (wo.line_items || []).map((li) => ({
      pricingId: li.pricing_item_id || null,
      name: li.service_name || "",
      qty: li.quantity_sqft || 0,
      price: li.unit_price || 0,
      unit: li.unit || null,
      priceTouched: true,
    }));
    st.notes = wo.notes || "";
    st.temps = Array.isArray(wo.temp_workers) ? wo.temp_workers : [];
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
          };
        }),
      scheduled_start: start ? start.toISOString() : null,
      scheduled_end: end ? end.toISOString() : null,
      status: st.id ? st.status : start ? "scheduled" : "draft",
    };
    return body;
  }

  function sectionPayload(full) {
    if (st.section === "all") return full;
    const pick = {
      details: ["title", "source_type", "source_name", "customer_id", "builder_id", "address", "status"],
      schedule: ["scheduled_start", "scheduled_end"],
      services: ["line_items"],
      team: ["assigned_user_id", "member_user_ids"],
      notes: ["notes"],
    }[st.section];
    const out = {};
    pick.forEach((k) => {
      out[k] = full[k];
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
    st.busy = true;
    renderFoot();
    try {
      const isCreate = !st.id;
      const j = isCreate
        ? await api("/api/work-orders", { method: "POST", body: JSON.stringify(body) })
        : await api(`/api/work-orders/${st.id}`, { method: "PUT", body: JSON.stringify(body) });
      const n = j.data?.number != null ? `#${j.data.number}` : "";
      if (j.conflicts && j.conflicts.length) {
        notify(`Job ${n} salvo — atenção: conflito de agenda com a equipe.`, "warning");
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
      notify("Informe o nome do temporário.", "error");
      return;
    }
    try {
      const j = await api(`/api/work-orders/${st.id}/temp-workers`, {
        method: "POST",
        body: JSON.stringify({ name, phone: ($("tempPhone")?.value || "").trim() || null }),
      });
      st.temps = [...st.temps, j.data];
      renderTeam();
      notify("Temporário adicionado — envie o link por WhatsApp ou SMS.", "success");
    } catch (err) {
      notify(err.message || "Erro", "error");
    }
  }
  async function tempDel(id) {
    if (!confirm("Remover este temporário? O link dele deixa de funcionar.")) return;
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
    const btn = e.target.closest("[data-act]");
    if (!btn) return;
    const act = btn.getAttribute("data-act");
    e.preventDefault();
    switch (act) {
      case "close":
        close();
        break;
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
      case "add-line":
        st.lines.push({ pricingId: null, name: "", qty: 0, price: 0, unit: null, priceTouched: false });
        renderServices();
        refreshNumbers();
        setTimeout(() => {
          const sels = $("jmSvc").querySelectorAll('select[data-f="svc"]');
          sels[sels.length - 1]?.focus();
        }, 20);
        break;
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
    switch (t.id) {
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
        return;
      default:
        break;
    }
    const f = t.getAttribute && t.getAttribute("data-f");
    if (f === "qty" || f === "price" || f === "name") {
      const { row, line } = lineFromEl(t);
      if (!line) return;
      if (f === "qty") line.qty = t.value;
      if (f === "price") {
        line.price = t.value;
        line.priceTouched = true;
      }
      if (f === "name") line.name = t.value;
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
        if (TYPE_LABEL[ty]) st.sourceType = ty;
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
      const { line } = lineFromEl(t);
      if (!line) return;
      const item = pricing.find((p) => p.id === t.value) || null;
      line.pricingId = item ? item.id : null;
      line.unit = item?.unit || null;
      if (item) line.name = item.name;
      line.price = item ? priceFor(item) : line.price;
      line.priceTouched = false;
      const i = st.lines.indexOf(line);
      renderServices();
      refreshNumbers();
      // Quantity is what is left to type.
      setTimeout(() => $("jmSvc").querySelector(`.jm-ln[data-i="${i}"] [data-f="${item ? "qty" : "name"}"]`)?.focus(), 20);
    }
  }

  function onKey(e) {
    if (!st) return;
    if (e.key === "Enter" && e.target.id === "jmClientQ") {
      e.preventDefault();
      $("jmClient").querySelector('[data-act="pick"]')?.click();
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
    modal.addEventListener("keydown", onKey);
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && st && modal.classList.contains("is-open")) {
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
    close: () => close(),
    onSaved: (fn) => {
      if (typeof fn === "function") savedListeners.push(fn);
    },
    canManage: () => canManage,
  };
})();
