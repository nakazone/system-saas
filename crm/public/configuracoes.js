/**
 * Configurações — settings hub (etapa 1: Visão geral, Dados da empresa, Marca,
 * App e alertas, Ajuda e suporte). Sections are hash-routed: #empresa, #marca…
 */
(function () {
  "use strict";

  // ---------------------------------------------------------------- config
  const ICON = {
    ext: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6"/><path d="M20 4l-9 9"/><path d="M18 14v6H4V6h6"/></svg>',
    check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    chev: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>',
    warn: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18h.01"/></svg>',
    lock: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 018 0v3"/></svg>',
  };

  /**
   * perm: null = everyone; string = needs that key; array = needs any.
   * section = in-page; href = existing page elsewhere in the app.
   */
  const NAV = [
    {
      group: "Empresa",
      desc: "Dados, marca e aparência",
      items: [
        { id: "visao-geral", label: "Visão geral", perm: null, keywords: "início resumo progresso" },
        {
          id: "empresa",
          label: "Dados da empresa",
          perm: "settings.manage",
          keywords: "nome razão social telefone e-mail email site endereço rua cidade estado zip licença seguro apólice horário funcionamento fuso horário idioma unidade área semana avaliação google review",
        },
        { id: "marca", label: "Marca e aparência", perm: "settings.manage", keywords: "logo cores cor principal destaque tema" },
      ],
    },
    {
      group: "Vendas",
      desc: "Preços, catálogo e produtos",
      items: [
        { href: "builder-pricing-admin.html", label: "Serviços e preços", perm: ["builders.view", "quotes.edit"], keywords: "tabela de valor preço serviço builder desconto volume" },
        { href: "quote-catalog.html", label: "Catálogo de serviços", perm: ["quotes.edit"], keywords: "catálogo serviço orçamento" },
        { href: "products-erp.html", label: "Produtos e margens", perm: ["quotes.view"], keywords: "produto sku custo margem categoria" },
        { href: "suppliers.html", label: "Fornecedores", perm: ["quotes.view"], keywords: "fornecedor supplier distribuidor" },
      ],
    },
    {
      group: "Equipe e acesso",
      desc: "Usuários, cargos e permissões",
      items: [{ href: "equipe.html", label: "Usuários e cargos", perm: ["users.view"], keywords: "usuário equipe convidar cargo permissão senha" }],
    },
    {
      group: "Sistema",
      desc: "App, alertas e suporte",
      items: [
        { id: "app", label: "App e alertas", perm: null, keywords: "instalar app celular notificação push alerta dispositivo" },
        { id: "suporte", label: "Ajuda e suporte", perm: null, keywords: "suporte ajuda dúvida problema bug sugestão contato" },
      ],
    },
  ];

  const FIELD_INDEX = [
    ["Nome da empresa", "empresa", "f_name"],
    ["Razão social", "empresa", "f_legal_name"],
    ["Telefone da empresa", "empresa", "f_contact_phone"],
    ["E-mail da empresa", "empresa", "f_contact_email"],
    ["Site", "empresa", "f_website"],
    ["Endereço", "empresa", "f_address_line1"],
    ["Manter endereço privado", "empresa", "f_address_private"],
    ["Nº da licença", "empresa", "f_license_number"],
    ["Seguro e apólice", "empresa", "f_insurance_carrier"],
    ["Certificado de seguro", "empresa", "certPick"],
    ["Horário de funcionamento", "empresa", "hoursRows"],
    ["Fuso horário", "empresa", "f_timezone"],
    ["Idioma padrão", "empresa", "f_default_locale"],
    ["Unidade de área (sq ft / m²)", "empresa", "f_area_unit"],
    ["Link de avaliação no Google", "empresa", "f_google_review_url"],
    ["Logo", "marca", "logoDrop"],
    ["Cores da marca", "marca", "brandPresets"],
    ["Instalar app", "app", null],
    ["Alertas no celular", "app", null],
    ["Falar com o suporte", "suporte", "supportSubject"],
  ];

  const US_STATES = [
    ["AL", "Alabama"], ["AK", "Alaska"], ["AZ", "Arizona"], ["AR", "Arkansas"], ["CA", "California"], ["CO", "Colorado"],
    ["CT", "Connecticut"], ["DE", "Delaware"], ["DC", "District of Columbia"], ["FL", "Florida"], ["GA", "Georgia"],
    ["HI", "Hawaii"], ["ID", "Idaho"], ["IL", "Illinois"], ["IN", "Indiana"], ["IA", "Iowa"], ["KS", "Kansas"],
    ["KY", "Kentucky"], ["LA", "Louisiana"], ["ME", "Maine"], ["MD", "Maryland"], ["MA", "Massachusetts"],
    ["MI", "Michigan"], ["MN", "Minnesota"], ["MS", "Mississippi"], ["MO", "Missouri"], ["MT", "Montana"],
    ["NE", "Nebraska"], ["NV", "Nevada"], ["NH", "New Hampshire"], ["NJ", "New Jersey"], ["NM", "New Mexico"],
    ["NY", "New York"], ["NC", "North Carolina"], ["ND", "North Dakota"], ["OH", "Ohio"], ["OK", "Oklahoma"],
    ["OR", "Oregon"], ["PA", "Pennsylvania"], ["RI", "Rhode Island"], ["SC", "South Carolina"], ["SD", "South Dakota"],
    ["TN", "Tennessee"], ["TX", "Texas"], ["UT", "Utah"], ["VT", "Vermont"], ["VA", "Virginia"], ["WA", "Washington"],
    ["WV", "West Virginia"], ["WI", "Wisconsin"], ["WY", "Wyoming"],
  ];

  const TIMEZONES = [
    ["America/New_York", "Eastern (Nova York, Miami)"],
    ["America/Chicago", "Central (Chicago, Dallas)"],
    ["America/Denver", "Mountain (Denver)"],
    ["America/Phoenix", "Arizona (sem horário de verão)"],
    ["America/Los_Angeles", "Pacific (Los Angeles, Seattle)"],
    ["America/Anchorage", "Alaska"],
    ["Pacific/Honolulu", "Havaí"],
    ["America/Sao_Paulo", "Brasília"],
  ];

  const DAYS = [
    ["mon", "Segunda"], ["tue", "Terça"], ["wed", "Quarta"], ["thu", "Quinta"], ["fri", "Sexta"], ["sat", "Sábado"], ["sun", "Domingo"],
  ];

  const DEFAULT_COLORS = { primary: "#211d1a", accent: "#e8792c" };
  const PRESETS = [
    { name: "ObraMate", primary: "#211d1a", accent: "#e8792c" },
    { name: "Terracota", primary: "#2b1d16", accent: "#c1652f" },
    { name: "Grafite", primary: "#1f2933", accent: "#d97706" },
    { name: "Marinho", primary: "#1c2a44", accent: "#2f6fb0" },
    { name: "Vinho", primary: "#3a1f24", accent: "#b6475a" },
    { name: "Ardósia", primary: "#0f172a", accent: "#0e7490" },
  ];

  // ---------------------------------------------------------------- state
  const state = {
    user: null,
    perms: new Set(),
    isAdmin: false,
    current: null,
    pendingHash: null,
    company: { loaded: false, snapshot: null, data: null },
    brand: { loaded: false, snapshot: null, logoDataUrl: null, clearLogo: false, logoUrl: null, name: "" },
  };

  const $ = (id) => document.getElementById(id);
  const esc = (s) =>
    String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

  function notify(msg, type) {
    if (window.crmToast && typeof window.crmToast.show === "function") window.crmToast.show(msg, { type: type || "info" });
    else if (typeof window.crmNotify === "function") window.crmNotify(msg, type || "info");
  }

  async function api(path, opts) {
    const r = await fetch(path, {
      credentials: "include",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      ...(opts || {}),
    });
    let j = {};
    try {
      j = await r.json();
    } catch (_) {
      /* non-JSON */
    }
    if (!r.ok || j.success === false) {
      const err = new Error(j.error || `Erro ${r.status}`);
      err.status = r.status;
      err.fields = j.fields || null;
      throw err;
    }
    return j;
  }

  function can(perm) {
    if (!perm) return true;
    if (state.isAdmin) return true;
    const list = Array.isArray(perm) ? perm : [perm];
    return list.some((p) => state.perms.has(p));
  }

  function isDesktop() {
    return window.matchMedia("(min-width: 1024px)").matches;
  }

  // ---------------------------------------------------------------- navigation
  function sectionIds() {
    return NAV.flatMap((g) => g.items.filter((i) => i.id).map((i) => i.id));
  }

  function findItem(id) {
    for (const g of NAV) for (const i of g.items) if (i.id === id) return i;
    return null;
  }

  function renderNav() {
    const host = $("cfgNavGroups");
    host.innerHTML = NAV.map((g) => {
      const items = g.items.filter((i) => can(i.perm));
      if (!items.length) return "";
      return (
        `<div class="cfg-nav__group"><p class="cfg-nav__label">${esc(g.group)}</p>` +
        items
          .map((i) =>
            i.id
              ? `<a class="cfg-nav__item" href="#${i.id}" data-nav="${i.id}"><span>${esc(i.label)}</span><span class="cfg-nav__chev">${ICON.chev}</span></a>`
              : `<a class="cfg-nav__item" href="${i.href}"><span>${esc(i.label)}</span><span class="cfg-nav__ext" title="Abre em outra página">${ICON.ext}</span></a>`,
          )
          .join("") +
        `</div>`
      );
    }).join("");
  }

  function setActiveNav(id) {
    document.querySelectorAll(".cfg-nav__item[data-nav]").forEach((a) => {
      const on = a.getAttribute("data-nav") === id;
      a.classList.toggle("is-active", on);
      if (on) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    });
  }

  function dirtySection() {
    if (state.current === "empresa" && companyDirtyKeys().length) return "empresa";
    if (state.current === "marca" && brandDirty()) return "marca";
    return null;
  }

  function routeFromHash() {
    const raw = (location.hash || "").replace(/^#/, "");
    const legacy = { "instalar-app": "app", "alertas-push": "app" };
    let id = legacy[raw] || raw;
    const valid = sectionIds();
    if (!id) id = isDesktop() ? "visao-geral" : "";
    if (id && !valid.includes(id)) id = "visao-geral";
    return id;
  }

  function show(id) {
    const cfg = $("cfg");
    if (!id) {
      cfg.setAttribute("data-view", "index");
      state.current = null;
      setActiveNav(null);
      document.title = "Configurações — ObraMate";
      return;
    }
    const item = findItem(id);
    const allowed = item && can(item.perm);
    const target = allowed ? id : "sem-acesso";
    document.querySelectorAll(".cfg-section").forEach((s) => {
      s.hidden = s.getAttribute("data-section") !== target;
    });
    cfg.setAttribute("data-view", "section");
    state.current = allowed ? id : null;
    setActiveNav(id);
    document.title = `${item ? item.label : "Configurações"} — Configurações`;
    updateSavebar();
    if (allowed) loadSection(id);
    const main = $("cfgMain");
    if (main && !isDesktop()) window.scrollTo(0, 0);
  }

  function onHashChange() {
    const next = routeFromHash();
    const dirty = dirtySection();
    if (dirty && next !== dirty) {
      state.pendingHash = location.hash;
      history.replaceState(null, "", `#${dirty}`);
      openLeaveModal();
      return;
    }
    show(next);
  }

  function openLeaveModal() {
    const m = $("cfgLeaveModal");
    m.hidden = false;
    m.querySelector("[data-close].btn").focus();
  }
  function closeLeaveModal() {
    $("cfgLeaveModal").hidden = true;
    state.pendingHash = null;
  }

  // ---------------------------------------------------------------- search
  function searchEntries() {
    const out = [];
    for (const g of NAV) {
      for (const i of g.items) {
        if (!can(i.perm)) continue;
        out.push({ label: i.label, where: g.group, hay: `${i.label} ${i.keywords || ""}`, go: i.id ? `#${i.id}` : i.href });
      }
    }
    for (const [label, section, fieldId] of FIELD_INDEX) {
      const item = findItem(section);
      if (!item || !can(item.perm)) continue;
      out.push({ label, where: item.label, hay: label, go: `#${section}`, field: fieldId });
    }
    return out;
  }

  const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

  function runSearch(q) {
    const box = $("cfgSearchResults");
    const groups = $("cfgNavGroups");
    const nq = norm(q).trim();
    if (!nq) {
      box.hidden = true;
      groups.hidden = false;
      return;
    }
    const terms = nq.split(/\s+/);
    const seen = new Set();
    const hits = searchEntries()
      .filter((e) => terms.every((t) => norm(e.hay).includes(t)))
      .filter((e) => {
        const k = e.label + e.go;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      })
      .slice(0, 8);
    groups.hidden = true;
    box.hidden = false;
    box.innerHTML = hits.length
      ? hits
          .map(
            (h, idx) =>
              `<a class="cfg-search-hit${idx === 0 ? " is-first" : ""}" href="${esc(h.go)}" data-field="${esc(h.field || "")}"><span>${esc(h.label)}</span><small>${esc(h.where)}</small></a>`,
          )
          .join("")
      : `<p class="cfg-search-empty">Nada encontrado para “${esc(q)}”.</p>`;
  }

  function focusField(fieldId) {
    if (!fieldId) return;
    setTimeout(() => {
      const el = $(fieldId);
      if (!el) return;
      const wrap = el.closest(".cfg-field, .cfg-check, .cfg-card") || el;
      wrap.scrollIntoView({ behavior: "smooth", block: "center" });
      wrap.classList.remove("cfg-flash");
      void wrap.offsetWidth;
      wrap.classList.add("cfg-flash");
      if (typeof el.focus === "function" && /INPUT|SELECT|TEXTAREA/.test(el.tagName)) el.focus({ preventScroll: true });
    }, 250);
  }

  function bindSearch() {
    const input = $("cfgSearch");
    input.addEventListener("input", () => runSearch(input.value));
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        const first = $("cfgSearchResults").querySelector(".cfg-search-hit");
        if (first) {
          e.preventDefault();
          first.click();
        }
      } else if (e.key === "Escape") {
        input.value = "";
        runSearch("");
      }
    });
    $("cfgSearchResults").addEventListener("click", (e) => {
      const a = e.target.closest(".cfg-search-hit");
      if (!a) return;
      const field = a.getAttribute("data-field");
      const href = a.getAttribute("href") || "";
      input.value = "";
      runSearch("");
      if (href.startsWith("#")) {
        e.preventDefault();
        if (location.hash === href) show(routeFromHash());
        else location.hash = href;
        focusField(field);
      }
    });
    // "/" focuses search when not typing elsewhere
    document.addEventListener("keydown", (e) => {
      if (e.key !== "/" || e.metaKey || e.ctrlKey) return;
      const t = e.target;
      if (t && (t.isContentEditable || /INPUT|TEXTAREA|SELECT/.test(t.tagName))) return;
      e.preventDefault();
      input.focus();
    });
  }

  // ---------------------------------------------------------------- savebar
  function updateSavebar() {
    const bar = $("cfgSavebar");
    let count = 0;
    if (state.current === "empresa") count = companyDirtyKeys().length;
    else if (state.current === "marca") count = brandDirty() ? 1 : 0;
    bar.hidden = count === 0;
    document.body.classList.toggle("cfg-has-savebar", count > 0);
    if (count) {
      $("cfgSavebarText").textContent =
        state.current === "marca"
          ? "Você mudou a marca e ainda não salvou"
          : count === 1
            ? "Você tem 1 alteração não salva"
            : `Você tem ${count} alterações não salvas`;
    }
  }

  async function saveCurrent() {
    if (state.current === "empresa") return saveCompany();
    if (state.current === "marca") return saveBrand();
    return true;
  }

  function discardCurrent() {
    if (state.current === "empresa") fillCompany(state.company.snapshot);
    if (state.current === "marca") resetBrandToSnapshot();
    clearErrors();
    updateSavebar();
  }

  // ---------------------------------------------------------------- overview
  const GROUP_LINKS = [
    { title: "Dados da empresa", desc: "Contato, endereço, licença e horário", href: "#empresa", perm: "settings.manage" },
    { title: "Marca e aparência", desc: "Logo e cores", href: "#marca", perm: "settings.manage" },
    { title: "Serviços e preços", desc: "Tabela de valor por tipo de cliente", href: "builder-pricing-admin.html", perm: ["builders.view", "quotes.edit"] },
    { title: "Produtos e fornecedores", desc: "Custos, margens e SKUs", href: "products-erp.html", perm: ["quotes.view"] },
    { title: "Usuários e cargos", desc: "Quem acessa e o que pode fazer", href: "equipe.html", perm: ["users.view"] },
    { title: "App e alertas", desc: "Instalar e receber avisos", href: "#app", perm: null },
  ];

  async function loadOverview() {
    const cards = GROUP_LINKS.filter((g) => can(g.perm));
    $("cfgGroupCards").innerHTML = cards
      .map(
        (g) =>
          `<a class="cfg-card cfg-group" href="${g.href}"><span class="cfg-group__title">${esc(g.title)}<span class="cfg-group__chev">${ICON.chev}</span></span><span class="cfg-group__desc">${esc(g.desc)}</span></a>`,
      )
      .join("");
    try {
      const j = await api("/api/settings/overview");
      const d = j.data;
      const steps = d.setup || [];
      const done = steps.filter((s) => s.done).length;
      $("cfgSetupDone").textContent = String(done);
      $("cfgSetupTotal").textContent = String(steps.length);
      const pct = steps.length ? Math.round((done / steps.length) * 100) : 0;
      $("cfgSetupBar").style.width = `${pct}%`;
      $("cfgSetup").querySelector(".cfg-progress").setAttribute("aria-valuenow", String(pct));
      $("cfgSetupHint").textContent =
        done === steps.length
          ? "Tudo pronto. Você pode ajustar qualquer item quando quiser."
          : "Complete estes passos para mandar orçamentos com a cara da sua empresa.";
      $("cfgSetupSteps").innerHTML = steps
        .map((s) => {
          const mark = `<span class="cfg-stepmark${s.done ? " is-done" : ""}">${s.done ? ICON.check : ""}</span>`;
          const label = `<span class="cfg-step__label">${esc(s.label)}</span>`;
          if (s.done) return `<li class="cfg-step is-done">${mark}${label}</li>`;
          if (!s.can_open)
            return `<li class="cfg-step is-locked" title="Peça a um administrador">${mark}${label}<span class="cfg-step__lock">${ICON.lock}</span></li>`;
          return `<li class="cfg-step"><a href="${esc(s.href)}">${mark}${label}<span class="cfg-step__cta">Configurar</span></a></li>`;
        })
        .join("");
      const alerts = d.alerts || [];
      $("cfgAlerts").innerHTML = alerts
        .map((a) => {
          const when = new Date(`${a.expires_on}T12:00:00`).toLocaleDateString("pt-BR");
          const text =
            a.days_left < 0
              ? `${a.label} venceu em ${when}.`
              : a.days_left === 0
                ? `${a.label} vence hoje.`
                : `${a.label} vence em ${a.days_left} ${a.days_left === 1 ? "dia" : "dias"} (${when}).`;
          return `<div class="cfg-alert">${ICON.warn}<span>${esc(text)}</span><a href="#empresa" data-focus="f_${a.key === "license" ? "license_expires_on" : "insurance_expires_on"}">Atualizar</a></div>`;
        })
        .join("");
    } catch (err) {
      $("cfgSetupSteps").innerHTML = `<li class="cfg-step">Não foi possível carregar o progresso. <a href="#visao-geral" data-retry>Tentar de novo</a></li>`;
    }
  }

  // ---------------------------------------------------------------- company
  function buildSelects() {
    const stateOpts = `<option value="">Selecione</option>` + US_STATES.map(([c, n]) => `<option value="${c}">${n}</option>`).join("");
    $("f_state").innerHTML = stateOpts;
    $("f_license_state").innerHTML = stateOpts;
    $("f_timezone").innerHTML = TIMEZONES.map(([v, l]) => `<option value="${v}">${l}</option>`).join("");
    $("hoursRows").innerHTML = DAYS.map(
      ([k, label]) =>
        `<div class="cfg-hours__row" data-day="${k}">` +
        `<span class="cfg-hours__day">${label}</span>` +
        `<button type="button" class="cfg-switch" role="switch" aria-checked="true" aria-label="${label} aberto" data-day-toggle="${k}"><span></span></button>` +
        `<span class="cfg-hours__state" data-day-state="${k}">Aberto</span>` +
        `<input type="time" step="900" aria-label="${label}: abre" data-day-start="${k}" />` +
        `<span class="cfg-hours__sep">às</span>` +
        `<input type="time" step="900" aria-label="${label}: fecha" data-day-end="${k}" />` +
        `<span class="cfg-hours__err" data-day-err="${k}"></span>` +
        `</div>`,
    ).join("");
  }

  function ensureOption(select, value, label) {
    if (!value) return;
    if (![...select.options].some((o) => o.value === value)) {
      const o = document.createElement("option");
      o.value = value;
      o.textContent = label || value;
      select.appendChild(o);
    }
  }

  function readHours() {
    const out = {};
    for (const [k] of DAYS) {
      out[k] = {
        open: document.querySelector(`[data-day-toggle="${k}"]`).getAttribute("aria-checked") === "true",
        start: document.querySelector(`[data-day-start="${k}"]`).value || "07:00",
        end: document.querySelector(`[data-day-end="${k}"]`).value || "17:00",
      };
    }
    return out;
  }

  function setDayOpen(k, open) {
    const t = document.querySelector(`[data-day-toggle="${k}"]`);
    t.setAttribute("aria-checked", open ? "true" : "false");
    const row = t.closest(".cfg-hours__row");
    row.classList.toggle("is-closed", !open);
    document.querySelector(`[data-day-state="${k}"]`).textContent = open ? "Aberto" : "Fechado";
    row.querySelectorAll('input[type="time"]').forEach((i) => (i.disabled = !open));
  }

  function writeHours(h) {
    for (const [k] of DAYS) {
      const d = (h && h[k]) || { open: false, start: "08:00", end: "17:00" };
      document.querySelector(`[data-day-start="${k}"]`).value = d.start;
      document.querySelector(`[data-day-end="${k}"]`).value = d.end;
      setDayOpen(k, !!d.open);
    }
  }

  function readCompany() {
    const out = {};
    document.querySelectorAll("#companyForm [data-key]").forEach((el) => {
      const k = el.getAttribute("data-key");
      out[k] = el.type === "checkbox" ? el.checked : el.value.trim();
    });
    out.business_hours = readHours();
    return out;
  }

  function fillCompany(d) {
    if (!d) return;
    document.querySelectorAll("#companyForm [data-key]").forEach((el) => {
      const k = el.getAttribute("data-key");
      const v = d[k];
      if (el.type === "checkbox") el.checked = !!v;
      else {
        if (el.tagName === "SELECT") ensureOption(el, v || "", v || "");
        el.value = v == null ? "" : String(v);
      }
    });
    writeHours(d.business_hours);
    syncCompanyLinks();
  }

  const comparable = (v) => (v && typeof v === "object" ? JSON.stringify(v) : String(v == null ? "" : v));

  function companyDirtyKeys() {
    if (!state.company.loaded) return [];
    const now = readCompany();
    const snap = state.company.snapshot;
    return Object.keys(now).filter((k) => comparable(now[k]) !== comparable(snap[k] == null ? "" : snap[k]));
  }

  function syncCompanyLinks() {
    const addr = [$("f_address_line1").value, $("f_city").value, $("f_state").value, $("f_postal_code").value]
      .map((s) => s.trim())
      .filter(Boolean)
      .join(", ");
    const map = $("btnMap");
    if ($("f_address_line1").value.trim()) {
      map.href = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addr)}`;
      map.removeAttribute("aria-disabled");
    } else {
      map.href = "#";
      map.setAttribute("aria-disabled", "true");
    }
    const rev = $("f_google_review_url").value.trim();
    const test = $("btnTestReview");
    if (rev) {
      test.href = /^https?:\/\//i.test(rev) ? rev : `https://${rev}`;
      test.removeAttribute("aria-disabled");
    } else {
      test.href = "#";
      test.setAttribute("aria-disabled", "true");
    }
  }

  function syncCert(url) {
    const has = !!url;
    $("certLabel").textContent = has ? "Certificado de seguro anexado" : "Nenhum certificado anexado";
    $("certView").hidden = !has;
    if (has) $("certView").href = url;
    $("certRemove").hidden = !has;
    $("certPick").textContent = has ? "Trocar arquivo" : "Anexar certificado";
  }

  // --- validation (mirrors the server; the server remains the source of truth)
  const VALIDATORS = {
    name: (v) => (v.length < 2 ? "Digite o nome da empresa" : ""),
    contact_email: (v) => (v && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v) ? "Digite um e-mail completo, como nome@empresa.com" : ""),
    contact_phone: (v) => {
      const n = v.replace(/\D/g, "").length;
      return v && (n < 10 || n > 15) ? "Telefone precisa ter código de área e número" : "";
    },
    website: (v) => (v && !/^(https?:\/\/)?[^\s/]+\.[^\s]{2,}/i.test(v) ? "Endereço de site inválido" : ""),
    google_review_url: (v) => (v && !/^(https?:\/\/)?[^\s/]+\.[^\s]{2,}/i.test(v) ? "Link inválido" : ""),
    postal_code: (v) => (v && !/^[A-Za-z0-9 -]{3,10}$/.test(v) ? "ZIP inválido" : ""),
  };

  function setFieldError(key, msg) {
    const el = document.querySelector(`#companyForm [data-key="${key}"]`);
    if (!el) return false;
    const wrap = el.closest(".cfg-field") || el.parentElement;
    wrap.classList.toggle("has-error", !!msg);
    let e = wrap.querySelector(".cfg-err");
    if (msg) {
      if (!e) {
        e = document.createElement("p");
        e.className = "cfg-err";
        e.id = `${el.id}_err`;
        wrap.appendChild(e);
      }
      e.textContent = msg;
      el.setAttribute("aria-invalid", "true");
      el.setAttribute("aria-describedby", e.id);
    } else {
      if (e) e.remove();
      el.removeAttribute("aria-invalid");
      el.removeAttribute("aria-describedby");
    }
    return true;
  }

  function setDayError(day, msg) {
    const el = document.querySelector(`[data-day-err="${day}"]`);
    if (el) el.textContent = msg || "";
    const row = document.querySelector(`.cfg-hours__row[data-day="${day}"]`);
    if (row) row.classList.toggle("has-error", !!msg);
  }

  function clearErrors() {
    document.querySelectorAll("#companyForm .has-error").forEach((w) => w.classList.remove("has-error"));
    document.querySelectorAll("#companyForm .cfg-err").forEach((e) => e.remove());
    document.querySelectorAll("#companyForm [aria-invalid]").forEach((e) => e.removeAttribute("aria-invalid"));
    document.querySelectorAll("[data-day-err]").forEach((e) => (e.textContent = ""));
  }

  function validateCompany() {
    let first = null;
    const data = readCompany();
    for (const [k, fn] of Object.entries(VALIDATORS)) {
      const msg = fn(data[k] || "");
      setFieldError(k, msg);
      if (msg && !first) first = document.querySelector(`#companyForm [data-key="${k}"]`);
    }
    for (const [k] of DAYS) {
      const d = data.business_hours[k];
      const msg = d.open && d.start >= d.end ? "Fecha antes de abrir" : "";
      setDayError(k, msg);
      if (msg && !first) first = document.querySelector(`[data-day-end="${k}"]`);
    }
    return first;
  }

  async function loadCompany(force) {
    if (state.company.loaded && !force) return;
    const form = $("companyForm");
    form.classList.add("is-loading");
    try {
      const j = await api("/api/settings/organization");
      state.company.data = j.data;
      state.company.snapshot = { ...j.data, business_hours: j.data.business_hours };
      fillCompany(j.data);
      state.company.snapshot = readCompany();
      state.company.loaded = true;
      syncCert(j.data.insurance_certificate_url);
    } catch (err) {
      notify(err.status === 403 ? "Sem permissão para ver os dados da empresa." : "Não foi possível carregar os dados.", "error");
    } finally {
      form.classList.remove("is-loading");
      updateSavebar();
    }
  }

  async function saveCompany() {
    const firstBad = validateCompany();
    if (firstBad) {
      firstBad.focus();
      notify("Revise os campos destacados.", "error");
      return false;
    }
    const now = readCompany();
    const keys = companyDirtyKeys();
    const body = {};
    for (const k of keys) {
      const v = now[k];
      body[k] = typeof v === "string" && v === "" ? null : v;
    }
    if (body.name === null) delete body.name;
    setSaving(true);
    try {
      const j = await api("/api/settings/organization", { method: "PATCH", body: JSON.stringify(body) });
      state.company.data = j.data;
      fillCompany(j.data);
      state.company.snapshot = readCompany();
      clearErrors();
      notify("Dados da empresa salvos.", "success");
      if (body.name) {
        document.querySelectorAll(".sidebar-brand-name, #sidebarWorkspaceName").forEach((el) => (el.textContent = j.data.name));
        state.brand.name = j.data.name;
        paintPreview();
      }
      return true;
    } catch (err) {
      if (err.fields) {
        let focused = false;
        for (const [path, msg] of Object.entries(err.fields)) {
          const m = /^business_hours\.(\w+)/.exec(path);
          if (m) setDayError(m[1], msg);
          else if (setFieldError(path, msg) && !focused) {
            document.querySelector(`#companyForm [data-key="${path}"]`).focus();
            focused = true;
          }
        }
      }
      notify(err.message || "Não foi possível salvar.", "error");
      return false;
    } finally {
      setSaving(false);
      updateSavebar();
    }
  }

  function setSaving(on) {
    const b = $("cfgSave");
    b.disabled = on;
    b.textContent = on ? "Salvando…" : "Salvar alterações";
  }

  function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(new Error("Falha ao ler o arquivo"));
      reader.readAsDataURL(file);
    });
  }

  function bindCompany() {
    const form = $("companyForm");
    form.addEventListener("input", (e) => {
      const key = e.target.getAttribute && e.target.getAttribute("data-key");
      if (key && e.target.closest(".has-error")) setFieldError(key, (VALIDATORS[key] || (() => ""))(e.target.value.trim()));
      syncCompanyLinks();
      updateSavebar();
    });
    form.addEventListener("change", () => updateSavebar());
    form.addEventListener("focusout", (e) => {
      const key = e.target.getAttribute && e.target.getAttribute("data-key");
      if (key && VALIDATORS[key]) setFieldError(key, VALIDATORS[key](e.target.value.trim()));
    });
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      saveCompany();
    });
    $("hoursRows").addEventListener("click", (e) => {
      const t = e.target.closest("[data-day-toggle]");
      if (!t) return;
      const k = t.getAttribute("data-day-toggle");
      setDayOpen(k, t.getAttribute("aria-checked") !== "true");
      setDayError(k, "");
      updateSavebar();
    });
    $("hoursRows").addEventListener("input", () => updateSavebar());
    $("btnCopyMonday").addEventListener("click", () => {
      const h = readHours();
      const mon = h.mon;
      for (const [k] of DAYS) {
        if (k === "mon" || !h[k].open) continue;
        document.querySelector(`[data-day-start="${k}"]`).value = mon.start;
        document.querySelector(`[data-day-end="${k}"]`).value = mon.end;
      }
      updateSavebar();
      notify("Horário de segunda copiado para os dias abertos.", "info");
    });
    ["btnMap", "btnTestReview"].forEach((id) =>
      $(id).addEventListener("click", (e) => {
        if ($(id).getAttribute("aria-disabled") === "true") e.preventDefault();
      }),
    );
    $("certFile").addEventListener("change", async (e) => {
      const file = e.target.files && e.target.files[0];
      e.target.value = "";
      if (!file) return;
      if (file.size > 5 * 1024 * 1024) return notify("O arquivo deve ter no máximo 5 MB.", "error");
      $("certLabel").textContent = "Enviando…";
      try {
        const data_url = await fileToDataUrl(file);
        const j = await api("/api/settings/organization/insurance-certificate", { method: "PUT", body: JSON.stringify({ data_url }) });
        syncCert(j.data.insurance_certificate_url);
        notify("Certificado anexado.", "success");
      } catch (err) {
        syncCert(state.company.data && state.company.data.insurance_certificate_url);
        notify(err.message || "Não foi possível enviar.", "error");
      }
    });
    $("certRemove").addEventListener("click", async () => {
      try {
        const j = await api("/api/settings/organization/insurance-certificate", { method: "DELETE" });
        state.company.data = j.data;
        syncCert(null);
        notify("Certificado removido.", "success");
      } catch (err) {
        notify(err.message || "Não foi possível remover.", "error");
      }
    });
    // Address autocomplete (Google Places, falls back to Photon in the shared helper)
    if (typeof window.sfAttachAddressAutocomplete === "function") {
      window
        .sfAttachAddressAutocomplete($("f_address_line1"), {
          country: "us",
          map: { line1: "#f_address_line1", city: "#f_city", state: "#f_state", zip: "#f_postal_code" },
        })
        .catch(() => undefined);
    }
    // The helper may fill the state with the full name; map it to the code.
    $("f_state").addEventListener("change", () => updateSavebar());
    const stateInput = $("f_state");
    const origDescriptor = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value");
    Object.defineProperty(stateInput, "value", {
      get() {
        return origDescriptor.get.call(this);
      },
      set(v) {
        const s = String(v || "").trim();
        const hit = US_STATES.find(([c, n]) => c.toLowerCase() === s.toLowerCase() || n.toLowerCase() === s.toLowerCase());
        origDescriptor.set.call(this, hit ? hit[0] : s);
      },
    });
  }

  // ---------------------------------------------------------------- brand
  const HEX = /^#[0-9a-f]{6}$/i;

  function luminance(hex) {
    const n = parseInt(hex.slice(1), 16);
    const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
      const s = c / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
  }
  const contrastWithWhite = (hex) => 1.05 / (luminance(hex) + 0.05);

  function brandValues() {
    return {
      primary: $("primaryColor").value.trim().toLowerCase(),
      accent: $("accentColor").value.trim().toLowerCase(),
    };
  }

  function brandDirty() {
    if (!state.brand.loaded) return false;
    const v = brandValues();
    const s = state.brand.snapshot;
    return v.primary !== s.primary || v.accent !== s.accent || !!state.brand.logoDataUrl || state.brand.clearLogo;
  }

  function renderPresets() {
    $("brandPresets").innerHTML = PRESETS.map(
      (p, i) =>
        `<button type="button" class="cfg-preset" role="radio" aria-checked="false" data-preset="${i}">` +
        `<span class="cfg-preset__sw"><span style="background:${p.primary}"></span><span style="background:${p.accent}"></span></span>${esc(p.name)}</button>`,
    ).join("");
  }

  function syncPresetState() {
    const v = brandValues();
    document.querySelectorAll(".cfg-preset").forEach((b) => {
      const p = PRESETS[Number(b.getAttribute("data-preset"))];
      b.setAttribute("aria-checked", p.primary === v.primary && p.accent === v.accent ? "true" : "false");
    });
  }

  function paintPreview() {
    const v = brandValues();
    const root = document.querySelector(".cfg-preview");
    if (HEX.test(v.primary)) root.style.setProperty("--pv-primary", v.primary);
    if (HEX.test(v.accent)) root.style.setProperty("--pv-accent", v.accent);
    $("primaryColorPicker").value = HEX.test(v.primary) ? v.primary : DEFAULT_COLORS.primary;
    $("accentColorPicker").value = HEX.test(v.accent) ? v.accent : DEFAULT_COLORS.accent;
    $("contrastWarn").hidden = !(HEX.test(v.accent) && contrastWithWhite(v.accent) < 3);
    const logo = state.brand.clearLogo ? null : state.brand.logoDataUrl || state.brand.logoUrl;
    const img = $("logoImg");
    const pv = $("pvLogo");
    if (logo) {
      img.src = logo;
      pv.src = logo;
    }
    img.hidden = !logo;
    pv.hidden = !logo;
    $("logoEmpty").hidden = !!logo;
    $("btnClearLogo").hidden = !logo;
    $("pvName").textContent = state.brand.name || "Sua empresa";
    syncPresetState();
    ["primaryColor", "accentColor"].forEach((id) => {
      const el = $(id);
      const bad = el.value && !HEX.test(el.value.trim());
      el.closest(".cfg-field").classList.toggle("has-error", !!bad);
    });
    updateSavebar();
  }

  function isDefaultLogo(url) {
    return !url || /\/obramate-logo\.png$/.test(String(url));
  }

  async function loadBrand(force) {
    if (state.brand.loaded && !force) return;
    try {
      const j = await api("/api/branding");
      const d = j.data;
      state.brand.name = d.name || "";
      state.brand.logoUrl = isDefaultLogo(d.logo_url) ? null : d.logo_url;
      state.brand.logoDataUrl = null;
      state.brand.clearLogo = false;
      $("primaryColor").value = (d.primary_color || DEFAULT_COLORS.primary).toLowerCase();
      $("accentColor").value = (d.accent_color || DEFAULT_COLORS.accent).toLowerCase();
      state.brand.snapshot = brandValues();
      state.brand.loaded = true;
      paintPreview();
    } catch (err) {
      notify("Não foi possível carregar a marca.", "error");
    }
  }

  function resetBrandToSnapshot() {
    const s = state.brand.snapshot;
    if (!s) return;
    $("primaryColor").value = s.primary;
    $("accentColor").value = s.accent;
    state.brand.logoDataUrl = null;
    state.brand.clearLogo = false;
    paintPreview();
  }

  function applyCssVars(vars) {
    if (!vars) return;
    const root = document.documentElement;
    Object.keys(vars).forEach((k) => root.style.setProperty(k, vars[k]));
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta && vars["--sf-navy"]) meta.setAttribute("content", vars["--sf-navy"]);
  }

  async function saveBrand() {
    const v = brandValues();
    if (!HEX.test(v.primary) || !HEX.test(v.accent)) {
      notify("Use cores no formato #RRGGBB.", "error");
      return false;
    }
    const payload = { primary_color: v.primary, accent_color: v.accent };
    if (state.brand.clearLogo) payload.clear_logo = true;
    else if (state.brand.logoDataUrl) payload.logo_data_url = state.brand.logoDataUrl;
    setSaving(true);
    try {
      const j = await api("/api/branding", { method: "PUT", body: JSON.stringify(payload) });
      const d = j.data;
      state.brand.logoUrl = isDefaultLogo(d.logo_url) ? null : d.logo_url;
      state.brand.logoDataUrl = null;
      state.brand.clearLogo = false;
      state.brand.snapshot = brandValues();
      applyCssVars(d.css_vars);
      paintPreview();
      notify("Marca salva.", "success");
      return true;
    } catch (err) {
      notify(err.message || "Não foi possível salvar a marca.", "error");
      return false;
    } finally {
      setSaving(false);
      updateSavebar();
    }
  }

  async function takeLogo(file) {
    if (!file) return;
    if (!/^image\//.test(file.type)) return notify("Envie uma imagem (PNG, JPG ou WebP).", "error");
    if (file.size > 2.5 * 1024 * 1024) return notify("O logo deve ter no máximo 2,5 MB.", "error");
    state.brand.logoDataUrl = await fileToDataUrl(file);
    state.brand.clearLogo = false;
    paintPreview();
  }

  function bindBrand() {
    renderPresets();
    $("brandPresets").addEventListener("click", (e) => {
      const b = e.target.closest("[data-preset]");
      if (!b) return;
      const p = PRESETS[Number(b.getAttribute("data-preset"))];
      $("primaryColor").value = p.primary;
      $("accentColor").value = p.accent;
      paintPreview();
    });
    ["primaryColor", "accentColor"].forEach((id) => $(id).addEventListener("input", paintPreview));
    $("primaryColorPicker").addEventListener("input", (e) => {
      $("primaryColor").value = e.target.value;
      paintPreview();
    });
    $("accentColorPicker").addEventListener("input", (e) => {
      $("accentColor").value = e.target.value;
      paintPreview();
    });
    $("btnResetBrand").addEventListener("click", () => {
      $("primaryColor").value = DEFAULT_COLORS.primary;
      $("accentColor").value = DEFAULT_COLORS.accent;
      paintPreview();
    });
    $("logoFile").addEventListener("change", (e) => {
      const f = e.target.files && e.target.files[0];
      e.target.value = "";
      takeLogo(f).catch((err) => notify(err.message, "error"));
    });
    $("btnClearLogo").addEventListener("click", () => {
      state.brand.logoDataUrl = null;
      state.brand.clearLogo = !!state.brand.logoUrl;
      paintPreview();
    });
    const drop = $("logoDrop");
    ["dragenter", "dragover"].forEach((ev) =>
      drop.addEventListener(ev, (e) => {
        e.preventDefault();
        drop.classList.add("is-over");
      }),
    );
    ["dragleave", "drop"].forEach((ev) => drop.addEventListener(ev, () => drop.classList.remove("is-over")));
    drop.addEventListener("drop", (e) => {
      e.preventDefault();
      const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      takeLogo(f).catch((err) => notify(err.message, "error"));
    });
  }

  // ---------------------------------------------------------------- app / support
  function syncInstalledNote() {
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
    $("pwaInstalledNote").hidden = !standalone;
  }

  const CAT_LABEL = { question: "Dúvida", suggestion: "Sugestão", bug: "Problema", other: "Outro" };

  async function loadSupportHistory() {
    try {
      const j = await api("/api/support/tickets");
      const rows = Array.isArray(j.data) ? j.data : [];
      $("supportHistory").hidden = rows.length === 0;
      $("supportHistoryList").innerHTML = rows
        .map((t) => {
          const closed = t.status === "closed";
          const when = t.created_at ? new Date(t.created_at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "";
          return (
            `<article class="cfg-ticket"><div class="cfg-ticket__meta"><span class="cfg-badge${closed ? "" : " is-open"}">${closed ? "Resolvido" : "Aberto"}</span>` +
            `<span>${esc(CAT_LABEL[t.category] || t.category || "")}</span><span>${esc(when)}</span></div>` +
            `<p class="cfg-ticket__subject">${esc(t.subject)}</p><p class="cfg-ticket__body">${esc(t.body)}</p></article>`
          );
        })
        .join("");
    } catch (_) {
      /* history is optional */
    }
  }

  function bindSupport() {
    $("supportForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const subject = $("supportSubject").value.trim();
      const body = $("supportBody").value.trim();
      if (!subject || !body) {
        notify("Preencha assunto e mensagem.", "error");
        (subject ? $("supportBody") : $("supportSubject")).focus();
        return;
      }
      const btn = $("btnSendSupport");
      btn.disabled = true;
      btn.textContent = "Enviando…";
      try {
        await api("/api/support/tickets", {
          method: "POST",
          body: JSON.stringify({ category: $("supportCategory").value, subject, body }),
        });
        notify("Mensagem enviada. Respondemos pelo seu e-mail.", "success");
        $("supportSubject").value = "";
        $("supportBody").value = "";
        $("supportCategory").value = "question";
        loadSupportHistory();
      } catch (err) {
        notify(err.message || "Não foi possível enviar.", "error");
      } finally {
        btn.disabled = false;
        btn.textContent = "Enviar mensagem";
      }
    });
  }

  // ---------------------------------------------------------------- boot
  const loaded = new Set();
  function loadSection(id) {
    if (id === "visao-geral") return loadOverview();
    if (id === "empresa") return loadCompany();
    if (id === "marca") return loadBrand();
    if (id === "app") return syncInstalledNote();
    if (id === "suporte" && !loaded.has("suporte")) {
      loaded.add("suporte");
      return loadSupportHistory();
    }
  }

  async function loadSession() {
    const r = await fetch("/api/auth/session", { credentials: "include", cache: "no-store" });
    const j = await r.json();
    if (!j.authenticated) {
      location.href = "/login.html";
      return false;
    }
    state.user = j.user;
    state.perms = new Set(j.user.permissions || []);
    state.isAdmin = j.user.role === "admin";
    const nameEl = $("sidebarUserName");
    const roleEl = $("sidebarUserRole");
    if (nameEl) nameEl.textContent = j.user.name || j.user.email || "—";
    if (roleEl) roleEl.textContent = j.user.role || "";
    return true;
  }

  function bindShell() {
    $("cfgSave").addEventListener("click", () => saveCurrent());
    $("cfgDiscard").addEventListener("click", () => discardCurrent());
    $("cfgLeaveModal").addEventListener("click", (e) => {
      if (e.target.closest("[data-close]")) closeLeaveModal();
    });
    $("cfgLeaveConfirm").addEventListener("click", () => {
      const next = state.pendingHash;
      discardCurrent();
      closeLeaveModal();
      if (next != null) location.hash = next || "#";
      else show(routeFromHash());
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !$("cfgLeaveModal").hidden) closeLeaveModal();
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s" && dirtySection()) {
        e.preventDefault();
        saveCurrent();
      }
    });
    window.addEventListener("beforeunload", (e) => {
      if (dirtySection()) {
        e.preventDefault();
        e.returnValue = "";
      }
    });
    $("cfgBack").addEventListener("click", (e) => {
      e.preventDefault();
      if (dirtySection()) {
        state.pendingHash = "";
        openLeaveModal();
        return;
      }
      history.pushState(null, "", location.pathname + location.search);
      show("");
    });
    $("cfgAlerts").addEventListener("click", (e) => {
      const a = e.target.closest("[data-focus]");
      if (a) focusField(a.getAttribute("data-focus"));
    });
    $("cfgSetupSteps").addEventListener("click", (e) => {
      if (e.target.closest("[data-retry]")) {
        e.preventDefault();
        loadOverview();
      }
    });
    window.addEventListener("hashchange", onHashChange);
    window.matchMedia("(min-width: 1024px)").addEventListener("change", () => {
      if (!state.current && isDesktop()) show("visao-geral");
    });
  }

  async function boot() {
    buildSelects();
    bindShell();
    bindSearch();
    bindCompany();
    bindBrand();
    bindSupport();
    try {
      if (!(await loadSession())) return;
    } catch (_) {
      location.href = "/login.html";
      return;
    }
    renderNav();
    show(routeFromHash());
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
