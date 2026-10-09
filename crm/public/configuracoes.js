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
  /*
   * 7 áreas › subgrupos. Cada subgrupo mostra uma seção antiga inteira ou só alguns cartões dela
   * (cartões marcados com data-sub no HTML). section = seção antiga (carrega/salva como antes);
   * href = página fora daqui.
   */
  const AREAS = [
    {
      id: "empresa",
      label: "Empresa",
      icon: "home",
      desc: "Perfil, marca, licença e horário",
      subs: [
        { id: "perfil", label: "Perfil e endereço", section: "empresa", perm: "settings.manage", desc: "Aparecem nos orçamentos, faturas, PDFs e no link que o cliente abre.", keywords: "nome razão social telefone e-mail email site endereço rua cidade estado zip avaliação google review" },
        { id: "marca", label: "Marca no documento", section: "marca", perm: "settings.manage", desc: "Logo e cores dos documentos do cliente (orçamento, fatura, PDF e e-mails). Os menus do ObraMate não mudam.", keywords: "logo cores cor principal destaque tema" },
        { id: "licenca", label: "Licença e seguro", section: "empresa", perm: "settings.manage", desc: "Muitos clientes e builders pedem antes de fechar. Avisamos no Início 30 dias antes de vencer.", keywords: "licença seguro apólice certificado validade" },
        { id: "horario", label: "Horário e região", section: "empresa", perm: "settings.manage", desc: "Horário de funcionamento, fuso, idioma e unidade de área.", keywords: "horário funcionamento fuso horário idioma unidade área semana" },
      ],
    },
    {
      id: "documentos",
      label: "Orçamentos e faturas",
      icon: "doc",
      desc: "Numeração, documento do cliente e estimativa",
      subs: [
        { id: "numeracao", label: "Numeração e padrões", section: "orcamentos", perm: "settings.manage", desc: "Valores de cada orçamento novo e a assinatura da empresa. Dá para mudar em cada orçamento.", keywords: "numeração prefixo próximo número validade imposto assinatura" },
        { id: "cliente", label: "O que o cliente vê", section: "orcamentos", perm: "settings.manage", desc: "What's Included, termos e as colunas que aparecem no PDF e no link do cliente.", keywords: "what's included inclusos termos condições colunas quantidade preço unitário cômodo prévia" },
        { id: "regras", label: "Regras de estimativa", section: "regras-estimativa", perm: "estimate_rules.manage", desc: "Desperdício e margens por tipo de piso, usados na estimativa rápida e na medição.", keywords: "desperdício waste markup margem tipo de piso madeira hardwood lvp laminado cerâmica carpete" },
      ],
    },
    {
      id: "mensagens",
      label: "Mensagens e automações",
      icon: "chat",
      desc: "Textos de SMS, e-mail e follow-up",
      subs: [
        { id: "msg-leads", label: "Leads por fase", section: "mensagens-fase", perm: "settings.manage", desc: "E-mails e SMS de cada fase do pipeline, com o cupom.", keywords: "mensagem email e-mail sms template fase pipeline lead novo visita follow-up cupom coupon gelo" },
        { id: "msg-orcamento", label: "Envio do orçamento", section: "mensagens-orcamento", perm: "settings.manage", desc: "SMS e WhatsApp ao enviar o orçamento e o follow-up depois que o cliente abriu.", keywords: "sms whatsapp mensagem orçamento quote enviar link follow-up" },
        { id: "msg-fatura", label: "Envio da fatura", section: "mensagens-faturas", perm: "settings.manage", desc: "SMS ao enviar o link da fatura.", keywords: "sms mensagem invoice fatura enviar link" },
        { id: "automacoes", label: "Automações", section: "automacoes-leads", perm: "settings.manage", desc: "Mover leads automaticamente no pipeline.", keywords: "automação follow-up quote sent estágio dias pipeline lead" },
      ],
    },
    {
      id: "precos",
      label: "Serviços e preços",
      icon: "tag",
      desc: "Tabela de Valor, catálogo e cadastros",
      subs: [
        { id: "tabela", label: "Tabela de Valor", href: "builder-pricing-admin.html", perm: ["builders.view", "quotes.edit"], desc: "Preço por tipo de cliente", keywords: "tabela de valor preço serviço builder desconto volume" },
        { id: "catalogo", label: "Catálogo de serviços", href: "quote-catalog.html", perm: ["quotes.edit"], desc: "Itens do orçamento", keywords: "catálogo serviço orçamento" },
        { id: "produtos", label: "Produtos e margens", href: "products-erp.html", perm: ["quotes.view"], desc: "SKU, custo e margem", keywords: "produto sku custo margem" },
        { id: "fornecedores", label: "Fornecedores", href: "suppliers.html", perm: ["quotes.view"], desc: "Distribuidores", keywords: "fornecedor supplier distribuidor" },
        { id: "categorias", label: "Categorias de serviço", section: "categorias-servico", perm: "settings.manage", desc: "Usadas no catálogo, nos orçamentos e no Field Quote.", keywords: "categoria serviço supply installation sand finishing geral" },
        { id: "unidades", label: "Unidades", section: "unidades", perm: "settings.manage", desc: "Medidas dos itens do orçamento e do catálogo.", keywords: "unidade sq ft linear inches fixed box piece medida" },
        { id: "tipos-cliente", label: "Tipos de cliente", section: "tipos-cliente", perm: "settings.manage", desc: "Particular, Builder, Loja e os tipos que você criar.", keywords: "tipo cliente builder particular loja contractor cadastro" },
      ],
    },
    {
      id: "operacao",
      label: "Operação",
      icon: "job",
      desc: "Agenda, Jobs e Folha",
      subs: [
        { id: "agenda", label: "Agenda e calendários", section: "agenda", perm: "settings.manage", desc: "Calendários da agenda e o link para o Calendário do iPhone.", keywords: "agenda calendário schedule meeting job cor cores visita apple ics assinatura iphone sync" },
        { id: "jobs", label: "Jobs e Campo", section: "jobs", perm: "settings.manage", desc: "Opções do job no escritório e no Campo.", keywords: "job checklist campo ticket lista exibir desativar" },
        { id: "folha", label: "Folha de pagamento", section: "folha", perm: "settings.manage", desc: "Quando o período fecha, em que dia a empresa paga e onde cai o reembolso.", keywords: "folha pagamento ciclo semana quinzena mes sabado domingo fechamento reembolso" },
        { id: "formas", label: "Formas de pagamento", section: "folha", perm: "settings.manage", desc: "Como o dinheiro chega ao funcionário (Zelle, cheque, dinheiro…).", keywords: "zelle pix forma pagamento cheque dinheiro ach" },
      ],
    },
    {
      id: "equipe",
      label: "Equipe e acesso",
      icon: "users",
      desc: "Usuários, cargos e permissões",
      subs: [
        { id: "usuarios", label: "Usuários", href: "equipe.html", perm: ["users.view"], desc: "Quem acessa o workspace", keywords: "usuário equipe convidar senha" },
        { id: "cargos", label: "Cargos e permissões", section: "cargos", perm: ["roles.manage", "users.view"], desc: "Cargos da equipe e as permissões padrão de cada um.", keywords: "cargo role permissão função acesso" },
      ],
    },
    {
      id: "sistema",
      label: "App e suporte",
      icon: "bell",
      desc: "Instalar, alertas e ajuda",
      subs: [
        { id: "app", label: "App e alertas", section: "app", perm: null, desc: "Use o ObraMate como aplicativo e receba avisos neste dispositivo.", keywords: "instalar app celular notificação push alerta dispositivo" },
        { id: "suporte", label: "Ajuda e suporte", section: "suporte", perm: null, desc: "Dúvidas, sugestões ou problemas direto para a equipe ObraMate.", keywords: "suporte ajuda dúvida problema bug sugestão contato" },
      ],
    },
  ];
  /** Hashes antigos (links de outras telas, passos do Início, e-mails) → subgrupo novo. */
  const LEGACY_HASH = {
    "visao-geral": "inicio",
    empresa: "perfil",
    orcamentos: "numeracao",
    "mensagens-orcamento": "msg-orcamento",
    "mensagens-faturas": "msg-fatura",
    "mensagens-fase": "msg-leads",
    "automacoes-leads": "automacoes",
    "regras-estimativa": "regras",
    "categorias-servico": "categorias",
    "instalar-app": "app",
    "alertas-push": "app",
  };
  /** Passo do progresso (Início) → subgrupo. */
  const STEP_SUB = { logo: "marca", contact: "perfil", address: "perfil", license: "licenca", terms: "cliente", pricing: "tabela", team: "usuarios", push: "app" };
  const AREA_ICONS = {
    home: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 11l9-7 9 7v9a1 1 0 01-1 1h-5v-6H9v6H4a1 1 0 01-1-1z"/></svg>',
    doc: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 3H6v18h12V7z"/><path d="M14 3v4h4M9 13h6M9 17h4"/></svg>',
    chat: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12a8 8 0 01-11.6 7.1L4 20l1-4.4A8 8 0 1121 12z"/></svg>',
    tag: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.6 13.4l-7.2 7.2a2 2 0 01-2.8 0L3 13V3h10l7.6 7.6a2 2 0 010 2.8z"/><circle cx="8" cy="8" r="1.5"/></svg>',
    job: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 012-2h4a2 2 0 012 2v2M3 13h18"/></svg>',
    users: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0113 0M16 4.5a3.5 3.5 0 010 7M18 14.5a6.5 6.5 0 013.5 5.5"/></svg>',
    bell: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 01-3.4 0"/></svg>',
    grid: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/></svg>',
  };
  /** Compatibilidade: lista plana (busca e permissões usam). */
  const NAV = AREAS.map((a) => ({ group: a.label, desc: a.desc, items: a.subs.map((x) => ({ ...x, id: x.section ? x.id : undefined })) }));

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
    ["Cores da agenda Jobs", "agenda", "schedCalList"],
    ["Cores da agenda Meetings", "agenda", "schedCalList"],
    ["Criar agenda personalizada", "agenda", "btnAddSchedCal"],
    ["Numeração dos orçamentos", "orcamentos", "q_number_prefix"],
    ["Validade do orçamento", "orcamentos", "q_validity_days"],
    ["Imposto padrão", "orcamentos", "q_tax_rate"],
    ["Termos e condições", "orcamentos", "q_terms"],
    ["What's Included", "orcamentos", "q_inclusions"],
    ["O que o cliente vê no orçamento", "orcamentos", null],
    ["Assinatura do responsável", "orcamentos", "s_name"],
    ["SMS ao enviar o orçamento", "mensagens-orcamento", "q_sms_body"],
    ["Follow-up WhatsApp do orçamento", "mensagens-orcamento", "q_followup_body"],
    ["SMS ao enviar a fatura", "mensagens-faturas", "inv_sms_body"],
    ["Mensagens para Leads", "mensagens-fase", "lm_company"],
    ["Assunto padrão do e-mail", "mensagens-fase", "lm_subject"],
    ["Cupom / oferta", "mensagens-fase", "lm_coupon_code"],
    ["Automações de Leads", "automacoes-leads", "la_auto_stage"],
    ["Dias Quote Sent → Follow-up", "automacoes-leads", "la_days"],
    ["Exibir checklist", "jobs", "jobs_checklist_enabled"],
    ["Ciclo da folha", "folha", "folhaCycleForm"],
    ["Formas de pagamento da folha", "folha", "cfgPayMethodsBody"],
    ["Desperdício por tipo de piso", "regras-estimativa", "rulesTable"],
    ["Markup de material e mão de obra", "regras-estimativa", "rulesTable"],
    ["Cargos", "cargos", "cfgRolesBody"],
    ["Categorias de serviço", "categorias-servico", "cfgCatsBody"],
    ["Unidades", "unidades", "cfgUnitsBody"],
    ["Tipos de cliente", "tipos-cliente", "cfgCustTypesBody"],
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

  const COUNTRIES = [
    ["US", "Estados Unidos"],
    ["CA", "Canadá"],
    ["BR", "Brasil"],
    ["MX", "México"],
    ["PT", "Portugal"],
    ["GB", "Reino Unido"],
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
    quotes: { loaded: false, snapshot: null, data: null },
    invoices: { loaded: false, snapshot: null, data: null },
    leadMsg: { loaded: false, snapshot: null, draft: null, activeSlug: "new_lead" },
    leadAuto: { loaded: false, snapshot: null },
    jobs: { loaded: false, snapshot: null },
    folha: { loaded: false, snapshot: null, draft: null },
    sig: { loaded: false, snapshot: null, drawn: false, removed: false, data: null },
    rules: { loaded: false, snapshot: null },
    brand: { loaded: false, snapshot: null, logoDataUrl: null, clearLogo: false, logoUrl: null, name: "" },
    schedule: { loaded: false, snapshot: null, draft: null },
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
  function allSubs() {
    return AREAS.flatMap((a) => a.subs.map((x) => ({ ...x, area: a })));
  }
  function findSub(id) {
    return allSubs().find((x) => x.id === id) || null;
  }
  function findArea(id) {
    return AREAS.find((a) => a.id === id) || null;
  }
  function sectionIds() {
    return [...new Set(allSubs().filter((x) => x.section).map((x) => x.section))];
  }
  /** Permissão de uma seção antiga (usada pelo carregamento das seções). */
  function findItem(id) {
    const x = allSubs().find((y) => y.section === id || y.id === id);
    return x ? { ...x, id: x.section } : null;
  }
  function visibleSubs(area) {
    return area.subs.filter((x) => can(x.perm));
  }
  /** Subgrupo onde um campo mora (busca): o cartão com data-sub, senão o primeiro subgrupo da seção. */
  function subFor(section, fieldId) {
    const el = fieldId ? $(fieldId) : null;
    const tagged = el && el.closest("[data-sub]");
    if (tagged) return tagged.getAttribute("data-sub");
    const x = allSubs().find((y) => y.section === section);
    return x ? x.id : "inicio";
  }

  function renderNav() {
    const host = $("cfgNavGroups");
    const cur = state.sub ? findSub(state.sub) : null;
    const openArea = state.areaView || (cur ? cur.area.id : null);
    const home = `<a class="cfg-home${state.sub === "inicio" ? " is-active" : ""}" href="#inicio" data-nav="inicio"><span class="cfg-ico">${AREA_ICONS.grid}</span><span>Início</span><em id="cfgNavSetup"></em></a>`;
    host.innerHTML =
      home +
      AREAS.map((a) => {
        const subs = visibleSubs(a);
        if (!subs.length) return "";
        const open = a.id === openArea;
        return `<div class="cfg-area${open ? " is-open" : ""}">
          <a class="cfg-area__hd" href="#a-${a.id}" data-area="${a.id}"><span class="cfg-ico">${AREA_ICONS[a.icon] || ""}</span><span class="cfg-area__t"><b>${esc(a.label)}</b><small>${esc(a.desc)}</small></span><em>${subs.length}</em><span class="cfg-nav__chev">${ICON.chev}</span></a>
          <div class="cfg-area__subs">${subs
            .map((x) =>
              x.section
                ? `<a class="cfg-nav__item" href="#${x.id}" data-nav="${x.id}"><span>${esc(x.label)}</span><i class="cfg-dot" data-dot="${x.id}" hidden></i></a>`
                : `<a class="cfg-nav__item is-ext" href="${x.href}"><span>${esc(x.label)}</span><span class="cfg-nav__ext" title="Abre em outra página">${ICON.ext}</span></a>`,
            )
            .join("")}</div></div>`;
      }).join("");
    paintDots();
  }

  /** Pontos laranja nos subgrupos que ainda faltam (vem do progresso do Início). */
  function paintDots() {
    const miss = state.missing || new Set();
    document.querySelectorAll("[data-dot]").forEach((d) => (d.hidden = !miss.has(d.getAttribute("data-dot"))));
    const el = $("cfgNavSetup");
    if (el && state.setup) el.textContent = `${state.setup.done}/${state.setup.total}`;
  }

  function setActiveNav(id) {
    document.querySelectorAll("#cfgNavGroups [data-nav]").forEach((a) => {
      const on = a.getAttribute("data-nav") === id;
      a.classList.toggle("is-active", on);
      if (on) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    });
  }

  function renderAreaHead(area, sub) {
    const hd = $("cfgAreaHd");
    if (!area) {
      hd.hidden = true;
      hd.innerHTML = "";
      return;
    }
    const subs = visibleSubs(area);
    const tabs = subs
      .map((x) =>
        x.section
          ? `<a class="cfg-tab${sub && x.id === sub.id ? " is-on" : ""}" href="#${x.id}">${esc(x.label)}<i class="cfg-dot" data-dot="${x.id}" hidden></i></a>`
          : `<a class="cfg-tab is-ext" href="${x.href}">${esc(x.label)}<span class="cfg-nav__ext">${ICON.ext}</span></a>`,
      )
      .join("");
    const list = subs
      .map(
        (x) =>
          `<a class="cfg-sublink" href="${x.section ? `#${x.id}` : x.href}"><span><b>${esc(x.label)}</b><small>${esc(x.desc || "")}</small></span><i class="cfg-dot" data-dot="${x.id}" hidden></i>${x.section ? ICON.chev : `<span class="cfg-nav__ext">${ICON.ext}</span>`}</a>`,
      )
      .join("");
    hd.innerHTML = `<div class="cfg-areahd__t"><span class="cfg-ico cfg-ico--lg">${AREA_ICONS[area.icon] || ""}</span><div><p class="cfg-crumb">${esc(area.label)}</p><h2>${esc(sub ? sub.label : area.label)}</h2><p class="cfg-areahd__d">${esc(sub ? sub.desc || "" : area.desc)}</p></div></div>
      ${sub ? `<nav class="cfg-tabs" aria-label="${esc(area.label)}">${tabs}</nav>` : `<div class="cfg-sublist">${list}</div>`}`;
    hd.hidden = false;
    paintDots();
  }

  function dirtyCount(id) {
    if (id === "empresa") return companyDirtyKeys().length;
    if (id === "agenda") return scheduleDirty() ? 1 : 0;
    if (id === "marca") return brandDirty() ? 1 : 0;
    if (id === "orcamentos") return quotesDirtyKeys().length + (sigDirty() ? 1 : 0);
    if (id === "mensagens-orcamento") return shareMessagesDirty() ? 1 : 0;
    if (id === "mensagens-faturas") return invoiceShareMessagesDirty() ? 1 : 0;
    if (id === "mensagens-fase") return leadMsgDirty() ? 1 : 0;
    if (id === "automacoes-leads") return leadAutoDirty() ? 1 : 0;
    if (id === "jobs") return jobsDirty() ? 1 : 0;
    if (id === "folha") return folhaDirty() ? 1 : 0;
    if (id === "regras-estimativa") return rulesDirtyTypes().length;
    return 0;
  }

  function dirtySection() {
    return state.current && dirtyCount(state.current) ? state.current : null;
  }

  function routeFromHash() {
    const raw = decodeURIComponent((location.hash || "").replace(/^#/, ""));
    let id = LEGACY_HASH[raw] || raw;
    if (!id) return isDesktop() ? "inicio" : "";
    if (id === "inicio") return id;
    if (id.startsWith("a-")) {
      const area = findArea(id.slice(2));
      if (!area) return "inicio";
      if (isDesktop()) {
        const first = visibleSubs(area).find((x) => x.section);
        return first ? first.id : "inicio";
      }
      return id;
    }
    const sub = findSub(id);
    if (!sub || !sub.section) return "inicio";
    return id;
  }
  /** Seção antiga que um destino usa (para o aviso de alterações não salvas). */
  function sectionOfRoute(route) {
    if (!route || route === "inicio" || route.startsWith("a-")) return null;
    const sub = findSub(route);
    return sub ? sub.section : null;
  }

  function show(route) {
    const cfg = $("cfg");
    const prevSection = state.current;
    if (!route) {
      cfg.setAttribute("data-view", "index");
      state.current = null;
      state.sub = null;
      state.areaView = null;
      renderNav();
      renderAreaHead(null);
      document.title = "Configurações — ObraMate";
      updateSavebar();
      return;
    }
    if (route.startsWith("a-")) {
      const area = findArea(route.slice(2));
      cfg.setAttribute("data-view", "section");
      state.current = null;
      state.sub = null;
      state.areaView = area.id;
      document.querySelectorAll(".cfg-section").forEach((s) => (s.hidden = true));
      renderNav();
      renderAreaHead(area, null);
      document.title = `${area.label} — Configurações`;
      updateSavebar();
      window.scrollTo(0, 0);
      return;
    }
    let target;
    let sub = null;
    if (route === "inicio") {
      target = "visao-geral";
      state.sub = "inicio";
      state.areaView = null;
    } else {
      sub = findSub(route);
      const allowed = sub && can(sub.perm);
      target = allowed ? sub.section : "sem-acesso";
      state.sub = sub ? sub.id : null;
      state.areaView = null;
    }
    document.querySelectorAll(".cfg-section").forEach((s) => {
      const on = s.getAttribute("data-section") === target;
      s.hidden = !on;
      if (!on) return;
      const tagged = s.querySelectorAll("[data-sub]");
      tagged.forEach((el) => (el.hidden = Boolean(sub) && el.getAttribute("data-sub") !== sub.id));
    });
    cfg.setAttribute("data-view", "section");
    cfg.setAttribute("data-sub", state.sub || "");
    state.current = target === "visao-geral" || target === "sem-acesso" ? null : target;
    renderNav();
    setActiveNav(state.sub);
    renderAreaHead(sub ? sub.area : null, sub);
    document.title = `${sub ? sub.label : "Configurações"} — Configurações`;
    updateSavebar();
    if (target === "visao-geral") loadOverview();
    else if (state.current && state.current !== prevSection) loadSection(state.current);
    if (!isDesktop()) window.scrollTo(0, 0);
  }

  function onHashChange() {
    const next = routeFromHash();
    const dirty = dirtySection();
    if (dirty && sectionOfRoute(next) !== dirty) {
      state.pendingHash = location.hash;
      history.replaceState(null, "", `#${state.sub || ""}`);
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
    for (const area of AREAS) {
      for (const x of area.subs) {
        if (!can(x.perm)) continue;
        out.push({ label: x.label, where: area.label, hay: `${x.label} ${area.label} ${x.keywords || ""}`, go: x.section ? `#${x.id}` : x.href });
      }
    }
    for (const [label, section, fieldId] of FIELD_INDEX) {
      const item = findItem(section);
      if (!item || !can(item.perm)) continue;
      const subId = subFor(section, fieldId);
      const sub = findSub(subId);
      out.push({ label, where: sub ? `${sub.area.label} › ${sub.label}` : item.label, hay: label, go: `#${subId}`, field: fieldId });
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
    const count = state.current ? dirtyCount(state.current) : 0;
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
    if (state.current === "agenda") return saveSchedule();
    if (state.current === "marca") return saveBrand();
    if (state.current === "orcamentos") return saveQuotes();
    if (state.current === "mensagens-orcamento") return saveQuoteShareMessages();
    if (state.current === "mensagens-faturas") return saveInvoiceShareMessages();
    if (state.current === "mensagens-fase") return saveLeadMessages();
    if (state.current === "automacoes-leads") return saveLeadAutomations();
    if (state.current === "jobs") return saveJobsSettings();
    if (state.current === "folha") return saveFolhaSettings();
    if (state.current === "regras-estimativa") return saveRules();
    return true;
  }

  function discardCurrent() {
    if (state.current === "empresa") fillCompany(state.company.snapshot);
    if (state.current === "agenda") discardSchedule();
    if (state.current === "marca") resetBrandToSnapshot();
    if (state.current === "orcamentos") discardQuotes();
    if (state.current === "mensagens-orcamento") discardQuoteShareMessages();
    if (state.current === "mensagens-faturas") discardInvoiceShareMessages();
    if (state.current === "mensagens-fase") discardLeadMessages();
    if (state.current === "automacoes-leads") discardLeadAutomations();
    if (state.current === "jobs") discardJobsSettings();
    if (state.current === "folha") discardFolhaSettings();
    if (state.current === "regras-estimativa") renderRules(state.rules.snapshot);
    clearErrors();
    clearFormErrors("quotesForm");
    clearFormErrors("rulesTable");
    updateSavebar();
  }

  // ---------------------------------------------------------------- overview
  const GROUP_LINKS = [
    { title: "Dados da empresa", desc: "Contato, endereço, licença e horário", href: "#empresa", perm: "settings.manage" },
    { title: "Agenda e calendários", desc: "Cores e agendas extras no Schedule", href: "#agenda", perm: "settings.manage" },
    { title: "Marca e aparência", desc: "Logo e cores", href: "#marca", perm: "settings.manage" },
    { title: "Orçamentos", desc: "Numeração, validade, termos e assinatura", href: "#orcamentos", perm: "settings.manage" },
    { title: "Mensagens do Orçamento", desc: "SMS e WhatsApp ao enviar o orçamento", href: "#mensagens-orcamento", perm: "settings.manage" },
    { title: "Mensagens das Faturas", desc: "SMS ao enviar o link da fatura", href: "#mensagens-faturas", perm: "settings.manage" },
    { title: "Mensagens para Leads", desc: "E-mails padrão em cada etapa do pipeline", href: "#mensagens-fase", perm: "settings.manage" },
    { title: "Automações de Leads", desc: "Mover Quote Sent → Follow-up automaticamente", href: "#automacoes-leads", perm: "settings.manage" },
    { title: "Jobs", desc: "Checklist e opções do Campo", href: "#jobs", perm: "settings.manage" },
    { title: "Folha de pagamento", desc: "Ciclo de fechamento e formas de pagar", href: "#folha", perm: "settings.manage" },
    { title: "Categorias e unidades", desc: "Tipos de serviço e medidas do catálogo", href: "#categorias-servico", perm: "settings.manage" },
    { title: "Tipos de cliente", desc: "Particular, Builder, Loja e tipos personalizados", href: "#tipos-cliente", perm: "settings.manage" },
    { title: "Serviços e preços", desc: "Tabela de valor por tipo de cliente", href: "builder-pricing-admin.html", perm: ["builders.view", "quotes.edit"] },
    { title: "Produtos e fornecedores", desc: "Custos, margens e SKUs", href: "products-erp.html", perm: ["quotes.view"] },
    { title: "Cargos", desc: "Funções e permissões da equipe", href: "#cargos", perm: ["roles.manage", "users.view"] },
    { title: "Usuários", desc: "Quem acessa o workspace", href: "equipe.html", perm: ["users.view"] },
    { title: "App e alertas", desc: "Instalar e receber avisos", href: "#app", perm: null },
  ];

  function renderAreaCards() {
    const miss = state.missing || new Set();
    const notes = state.subNotes || {};
    $("cfgGroupCards").innerHTML = AREAS.map((a) => {
      const subs = visibleSubs(a);
      if (!subs.length) return "";
      const first = subs.find((x) => x.section) || subs[0];
      return `<article class="cfg-card cfg-acard"><a class="cfg-acard__hd" href="${first.section ? `#${first.id}` : first.href}"><span class="cfg-ico">${AREA_ICONS[a.icon] || ""}</span><span><b>${esc(a.label)}</b><small>${esc(a.desc)}</small></span></a>
        <ul>${subs
          .map((x) => {
            const note = notes[x.id] || (miss.has(x.id) ? "falta configurar" : "");
            return `<li><a href="${x.section ? `#${x.id}` : x.href}"><span>${esc(x.label)}</span>${note ? `<em class="is-hot">${esc(note)}</em>` : x.section ? ICON.chev : `<span class="cfg-nav__ext">${ICON.ext}</span>`}</a></li>`;
          })
          .join("")}</ul></article>`;
    }).join("");
  }

  async function loadOverview() {
    renderAreaCards();
    try {
      const j = await api("/api/settings/overview");
      const d = j.data;
      const steps = d.setup || [];
      const done = steps.filter((s) => s.done).length;
      state.setup = { done, total: steps.length };
      state.missing = new Set(
        steps
          .filter((s) => !s.done && s.href)
          .map((s) => STEP_SUB[s.key] || (String(s.href).split("#")[1] || ""))
          .filter(Boolean),
      );
      state.subNotes = {};
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
          const go = STEP_SUB[s.key] && findSub(STEP_SUB[s.key]) && findSub(STEP_SUB[s.key]).section ? `#${STEP_SUB[s.key]}` : s.href;
          return `<li class="cfg-step"><a href="${esc(go)}">${mark}${label}<span class="cfg-step__cta">Configurar</span></a></li>`;
        })
        .join("");
      const alerts = d.alerts || [];
      alerts.forEach((a) => {
        state.subNotes.licenca = a.days_left < 0 ? "vencida" : `vence em ${a.days_left} d`;
      });
      renderAreaCards();
      paintDots();
      $("cfgAlerts").innerHTML = alerts
        .map((a) => {
          const when = new Date(`${a.expires_on}T12:00:00`).toLocaleDateString("pt-BR");
          const text =
            a.days_left < 0
              ? `${a.label} venceu em ${when}.`
              : a.days_left === 0
                ? `${a.label} vence hoje.`
                : `${a.label} vence em ${a.days_left} ${a.days_left === 1 ? "dia" : "dias"} (${when}).`;
          return `<div class="cfg-alert">${ICON.warn}<span>${esc(text)}</span><a href="#licenca" data-focus="f_${a.key === "license" ? "license_expires_on" : "insurance_expires_on"}">Atualizar</a></div>`;
        })
        .join("");
    } catch (err) {
      $("cfgSetupSteps").innerHTML = `<li class="cfg-step">Não foi possível carregar o progresso. <a href="#inicio" data-retry>Tentar de novo</a></li>`;
    }
  }

  // ---------------------------------------------------------------- company
  function buildSelects() {
    const stateOpts = `<option value="">Selecione</option>` + US_STATES.map(([c, n]) => `<option value="${c}">${n}</option>`).join("");
    $("f_state").innerHTML = stateOpts;
    $("f_license_state").innerHTML = stateOpts;
    $("f_country").innerHTML = COUNTRIES.map(([c, n]) => `<option value="${c}">${n}</option>`).join("");
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
      const country = String(($("f_country") && $("f_country").value) || "US").toLowerCase();
      window
        .sfAttachAddressAutocomplete($("f_address_line1"), {
          country,
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

  // ---------------------------------------------------------------- schedule / agendas
  const SCHED_KINDS = [
    { id: "jobs", label: "Jobs" },
    { id: "visits", label: "Visitas" },
    { id: "meetings", label: "Meetings" },
    { id: "custom", label: "Extra" },
  ];
  const SCHED_SECTORS = [
    { id: "all", label: "Todos" },
    { id: "installation", label: "Instalação" },
    { id: "sand_finish", label: "Lixa" },
  ];
  const SCHED_KIND_DEFAULTS = {
    jobs: { name: "Jobs", color: "#e8792c", sector: "all" },
    visits: { name: "Visitas", color: "#7a5ea8" },
    meetings: { name: "Meetings", color: "#3b6ea5" },
    custom: { name: "Nova agenda", color: "#16a34a" },
  };

  function cloneSched(cals) {
    return (cals || []).map((c) => ({
      id: c.id,
      name: c.name,
      color: c.color,
      kind: c.kind || "custom",
      sector: c.kind === "jobs" ? c.sector || "all" : undefined,
    }));
  }

  function scheduleDirty() {
    if (!state.schedule.loaded || !state.schedule.snapshot || !state.schedule.draft) return false;
    return JSON.stringify(state.schedule.draft) !== JSON.stringify(state.schedule.snapshot);
  }

  function schedNewId() {
    return typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx`.replace(/[xy]/g, (ch) => {
          const r = (Math.random() * 16) | 0;
          const v = ch === "x" ? r : (r & 0x3) | 0x8;
          return v.toString(16);
        });
  }

  function renderScheduleCals() {
    const host = $("schedCalList");
    if (!host || !state.schedule.draft) return;
    host.innerHTML = state.schedule.draft
      .map((c, i) => {
        const kind = c.kind || "custom";
        const sector = c.sector || "all";
        return `<div class="cfg-sched-row" data-sched-i="${i}">
          <div class="cfg-field">
            <label class="cfg-sr-only" for="schedKind_${i}">Tipo</label>
            <select id="schedKind_${i}" data-sched-kind="${i}">
              ${SCHED_KINDS.map((k) => `<option value="${k.id}" ${k.id === kind ? "selected" : ""}>${esc(k.label)}</option>`).join("")}
            </select>
          </div>
          <div class="cfg-field cfg-grow">
            <label class="cfg-sr-only" for="schedName_${i}">Nome</label>
            <input id="schedName_${i}" data-sched-name="${i}" maxlength="80" value="${esc(c.name)}" />
          </div>
          ${
            kind === "jobs"
              ? `<div class="cfg-field">
                  <label class="cfg-sr-only" for="schedSector_${i}">Setor</label>
                  <select id="schedSector_${i}" data-sched-sector="${i}">
                    ${SCHED_SECTORS.map((s) => `<option value="${s.id}" ${s.id === sector ? "selected" : ""}>${esc(s.label)}</option>`).join("")}
                  </select>
                </div>`
              : `<span class="cfg-sched-row__lock" aria-hidden="true"></span>`
          }
          <div class="cfg-field cfg-color">
            <label class="cfg-sr-only" for="schedColor_${i}">Cor</label>
            <div class="cfg-color__row">
              <input type="color" id="schedColorPicker_${i}" data-sched-color-picker="${i}" value="${esc(c.color)}" aria-label="Cor" />
              <input id="schedColor_${i}" data-sched-color="${i}" maxlength="7" spellcheck="false" value="${esc(c.color)}" />
            </div>
          </div>
          <button type="button" class="btn cfg-btn-sm cfg-btn-ghost" data-sched-del="${i}" aria-label="Remover agenda">Remover</button>
        </div>`;
      })
      .join("");
  }

  function bindScheduleCalsOnce() {
    const host = $("schedCalList");
    if (!host || host.dataset.bound === "1") return;
    host.dataset.bound = "1";
    host.addEventListener("input", (e) => {
      const t = e.target;
      if (!state.schedule.draft) return;
      const ni = t.getAttribute("data-sched-name");
      if (ni != null) {
        const i = Number(ni);
        if (state.schedule.draft[i]) state.schedule.draft[i].name = t.value;
        updateSavebar();
        return;
      }
      const ci = t.getAttribute("data-sched-color");
      if (ci != null) {
        const i = Number(ci);
        let v = String(t.value || "").trim();
        if (v && v[0] !== "#") v = `#${v}`;
        if (/^#[0-9A-Fa-f]{6}$/.test(v) && state.schedule.draft[i]) {
          state.schedule.draft[i].color = v.toLowerCase();
          const picker = host.querySelector(`[data-sched-color-picker="${i}"]`);
          if (picker) picker.value = v.toLowerCase();
        }
        updateSavebar();
        return;
      }
      const pi = t.getAttribute("data-sched-color-picker");
      if (pi != null) {
        const i = Number(pi);
        const v = String(t.value || "").toLowerCase();
        if (state.schedule.draft[i]) state.schedule.draft[i].color = v;
        const text = host.querySelector(`[data-sched-color="${i}"]`);
        if (text) text.value = v;
        updateSavebar();
      }
    });
    host.addEventListener("change", (e) => {
      const t = e.target;
      if (!state.schedule.draft) return;
      const ki = t.getAttribute("data-sched-kind");
      if (ki != null) {
        const i = Number(ki);
        const row = state.schedule.draft[i];
        if (!row) return;
        const kind = String(t.value || "custom");
        row.kind = kind;
        if (kind === "jobs") {
          if (!row.sector) row.sector = "all";
        } else {
          delete row.sector;
        }
        renderScheduleCals();
        updateSavebar();
        return;
      }
      const si = t.getAttribute("data-sched-sector");
      if (si != null) {
        const i = Number(si);
        if (state.schedule.draft[i]) state.schedule.draft[i].sector = String(t.value || "all");
        updateSavebar();
      }
    });
    host.addEventListener("click", (e) => {
      const btn = e.target.closest?.("[data-sched-del]");
      if (!btn || !state.schedule.draft) return;
      const i = Number(btn.getAttribute("data-sched-del"));
      if (!state.schedule.draft[i]) return;
      state.schedule.draft.splice(i, 1);
      renderScheduleCals();
      updateSavebar();
    });
    $("btnAddSchedCal")?.addEventListener("click", () => {
      if (!state.schedule.draft) return;
      if (state.schedule.draft.length >= 24) {
        notify("Limite de agendas atingido.", "error");
        return;
      }
      const def = SCHED_KIND_DEFAULTS.custom;
      state.schedule.draft.push({
        id: schedNewId(),
        name: def.name,
        color: def.color,
        kind: "custom",
      });
      renderScheduleCals();
      updateSavebar();
    });
  }

  async function loadSchedule(force) {
    if (state.schedule.loaded && !force) {
      renderScheduleCals();
      bindScheduleCalsOnce();
      bindCalFeedOnce();
      void loadCalFeed();
      return;
    }
    try {
      const j = await api("/api/settings/schedule");
      const cals = (j.data && j.data.calendars) || [];
      state.schedule.snapshot = cloneSched(cals);
      state.schedule.draft = cloneSched(cals);
      state.schedule.loaded = true;
      renderScheduleCals();
      bindScheduleCalsOnce();
      bindCalFeedOnce();
      void loadCalFeed();
      updateSavebar();
    } catch (err) {
      notify(err.status === 403 ? "Sem permissão para gerir agendas." : "Não foi possível carregar as agendas.", "error");
    }
  }

  // ---------------------------------------------------------------- calendar feed (ICS / Apple Calendar)
  const calFeedState = { bound: false, active: false, feeds: null, all: null };

  function renderCalFeed() {
    const status = $("cfgCalFeedStatus");
    const createBtn = $("btnCalFeedCreate");
    const revokeBtn = $("btnCalFeedRevoke");
    const list = $("cfgCalFeedList");
    if (!status) return;

    const feeds = Array.isArray(calFeedState.feeds) ? calFeedState.feeds : [];
    if (feeds.length) {
      status.textContent =
        "Links prontos — assine cada agenda no Calendário da Apple (Adicionar → Assinar calendário). Guarde-os agora; ao sair desta tela só reaparecem se gerar de novo.";
      if (createBtn) createBtn.textContent = "Gerar novos links";
      if (revokeBtn) revokeBtn.hidden = false;
      if (list) {
        list.hidden = false;
        list.innerHTML = feeds
          .map((f) => {
            const url = f.webcal_url || f.url || "";
            return (
              `<div class="cfg-calfeed-row">` +
              `<span class="cfg-calfeed-dot" style="background:${esc(f.color || "#8a8074")}"></span>` +
              `<div class="cfg-calfeed-meta"><b>${esc(f.name || "Agenda")}</b>` +
              `<small>${esc(f.label || f.name || "")}</small></div>` +
              `<button type="button" class="btn btn-secondary cfg-btn-sm" data-calfeed-copy="${esc(url)}">Copiar</button>` +
              `</div>`
            );
          })
          .join("");
      }
    } else if (calFeedState.active) {
      status.textContent =
        "Assinatura ativa, mas os links só aparecem na geração. Gere de novo para copiar (os anteriores deixam de funcionar).";
      if (createBtn) createBtn.textContent = "Gerar novos links";
      if (revokeBtn) revokeBtn.hidden = false;
      if (list) {
        list.hidden = true;
        list.innerHTML = "";
      }
    } else {
      status.textContent =
        "Nenhuma assinatura. Gere um link por agenda do Schedule (Jobs, Visitas, Meetings…) para o iPhone.";
      if (createBtn) createBtn.textContent = "Gerar links de assinatura";
      if (revokeBtn) revokeBtn.hidden = true;
      if (list) {
        list.hidden = true;
        list.innerHTML = "";
      }
    }
  }

  async function loadCalFeed() {
    const status = $("cfgCalFeedStatus");
    if (!status) return;
    try {
      const j = await api("/api/settings/schedule/calendar-feed");
      const d = j.data || {};
      calFeedState.active = !!d.active;
      if (!calFeedState.feeds) {
        calFeedState.feeds = d.feeds || null;
        calFeedState.all = d.all || null;
      }
      renderCalFeed();
    } catch (err) {
      status.textContent =
        err.status === 403
          ? "Sem permissão para ver o link de calendário."
          : "Não foi possível carregar o status do calendário.";
    }
  }

  async function copyCalFeedUrl(url) {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      notify("Link copiado.", "success");
    } catch (_) {
      notify("Não foi possível copiar. Segure o botão e copie manualmente.", "info");
    }
  }

  function bindCalFeedOnce() {
    if (calFeedState.bound) return;
    calFeedState.bound = true;
    $("btnCalFeedCreate")?.addEventListener("click", async () => {
      const btn = $("btnCalFeedCreate");
      if (btn) btn.disabled = true;
      try {
        if (calFeedState.active || (calFeedState.feeds && calFeedState.feeds.length)) {
          const ok = window.confirm(
            "Gerar novos links invalida os anteriores. Calendários já assinados no iPhone param de atualizar. Continuar?",
          );
          if (!ok) return;
        }
        const j = await api("/api/settings/schedule/calendar-feed", { method: "POST", body: "{}" });
        const d = j.data || {};
        calFeedState.active = true;
        calFeedState.feeds = Array.isArray(d.feeds) ? d.feeds : [];
        calFeedState.all = d.all || null;
        renderCalFeed();
        notify("Links gerados. Copie e assine cada agenda no iPhone.", "success");
      } catch (err) {
        notify(err.message || "Não foi possível gerar os links.", "error");
      } finally {
        if (btn) btn.disabled = false;
      }
    });
    $("cfgCalFeedList")?.addEventListener("click", (e) => {
      const btn = e.target.closest?.("[data-calfeed-copy]");
      if (!btn) return;
      void copyCalFeedUrl(btn.getAttribute("data-calfeed-copy"));
    });
    $("btnCalFeedRevoke")?.addEventListener("click", async () => {
      if (!window.confirm("Revogar todos os links? As assinaturas no iPhone/Google deixam de atualizar.")) return;
      try {
        await api("/api/settings/schedule/calendar-feed", { method: "DELETE" });
        calFeedState.active = false;
        calFeedState.feeds = null;
        calFeedState.all = null;
        renderCalFeed();
        notify("Links revogados.", "success");
      } catch (err) {
        notify(err.message || "Não foi possível revogar.", "error");
      }
    });
  }

  function discardSchedule() {
    if (!state.schedule.snapshot) return;
    state.schedule.draft = cloneSched(state.schedule.snapshot);
    renderScheduleCals();
  }

  async function saveSchedule() {
    if (!state.schedule.draft) return false;
    try {
      const j = await api("/api/settings/schedule", {
        method: "PUT",
        body: JSON.stringify({ calendars: state.schedule.draft }),
      });
      const cals = (j.data && j.data.calendars) || state.schedule.draft;
      state.schedule.snapshot = cloneSched(cals);
      state.schedule.draft = cloneSched(cals);
      renderScheduleCals();
      updateSavebar();
      notify("Agendas salvas.", "success");
      return true;
    } catch (err) {
      notify(err.message || "Não foi possível salvar as agendas.", "error");
      return false;
    }
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
      paintPreview();
      notify("Marca salva. As cores valem para orçamentos, faturas e e-mails ao cliente.", "success");
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


  // ---------------------------------------------------------------- quotes (Orçamentos)
  const TERMS_SAMPLE = [
    "Pagamento: 50% na aprovação e 50% na conclusão do serviço.",
    "Móveis e objetos devem ser retirados dos cômodos antes do início, salvo combinado.",
    "Umidade do contrapiso acima do limite do fabricante exige barreira de umidade, cobrada à parte.",
    "Variações de cor e veio são naturais no material e não caracterizam defeito.",
    "Garantia de mão de obra de 1 ano a partir da conclusão.",
    "Este orçamento vale até a data indicada.",
  ].join("\n");

  const INCLUSIONS_SAMPLE = [
    "Hardwood sanding of all floors in scope",
    "Select hardwood / LVP installation as listed",
    "Baseboard remove & reinstall where noted",
    "Dust containment during sanding & finishing",
  ].join("\n");

  function clearFormErrors(containerId) {
    const root = $(containerId);
    if (!root) return;
    root.querySelectorAll(".has-error").forEach((w) => w.classList.remove("has-error"));
    root.querySelectorAll(".cfg-err").forEach((e) => e.remove());
    root.querySelectorAll("[aria-invalid]").forEach((e) => e.removeAttribute("aria-invalid"));
  }

  function setErrorOn(el, msg) {
    if (!el) return;
    const wrap = el.closest(".cfg-field") || el.closest("td") || el.parentElement;
    wrap.classList.toggle("has-error", !!msg);
    let e = wrap.querySelector(".cfg-err");
    if (msg) {
      if (!e) {
        e = document.createElement("p");
        e.className = "cfg-err";
        e.id = `${el.id || "f" + Math.random().toString(36).slice(2)}_err`;
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
  }

  function readClientView() {
    const out = {};
    document.querySelectorAll("[data-cv]").forEach((b) => {
      out[b.getAttribute("data-cv")] = b.getAttribute("aria-checked") === "true";
    });
    return out;
  }

  function paintClientView() {
    const cv = readClientView();
    document.querySelectorAll('[data-cvp="qty"]').forEach((e) => (e.hidden = !cv.showQuantities));
    document.querySelectorAll('[data-cvp="unit"]').forEach((e) => (e.hidden = !cv.showUnitPrices));
    document.querySelectorAll('[data-cvp="total"]').forEach((e) => (e.hidden = !cv.showLineTotals));
    document.querySelectorAll('[data-cvp="room"]').forEach((e) => (e.hidden = !cv.showRoomBreakdown));
  }

  const SHARE_MSG_DEFAULTS = {
    sms_body:
      "Hi [name], your quote [quote_number] is ready.\n\nView your quote here:\n[link]\n\nThank you!",
    followup_body:
      "Hi [name]! Did you get a chance to review the quote? Happy to answer any questions. [link]",
  };

  function readShareMessages() {
    return {
      sms_body: String($("q_sms_body")?.value || "").trim(),
      followup_body: String($("q_followup_body")?.value || "").trim(),
    };
  }

  function fillShareMessages(d) {
    const sm = (d && d.share_messages) || {};
    if ($("q_sms_body")) $("q_sms_body").value = sm.sms_body || SHARE_MSG_DEFAULTS.sms_body;
    if ($("q_followup_body")) $("q_followup_body").value = sm.followup_body || SHARE_MSG_DEFAULTS.followup_body;
    syncShareMsgCounts();
  }

  function syncShareMsgCounts() {
    const sms = $("qSmsBodyCount");
    const fu = $("qFollowupBodyCount");
    if (sms) sms.textContent = String(($("q_sms_body")?.value || "").length);
    if (fu) fu.textContent = String(($("q_followup_body")?.value || "").length);
  }

  function shareMessagesDirty() {
    if (!state.quotes.loaded || !state.quotes.snapshot) return false;
    return comparable(readShareMessages()) !== comparable(state.quotes.snapshot.share_messages || {});
  }

  async function saveQuoteShareMessages() {
    const sms = String($("q_sms_body")?.value || "").trim();
    const followup = String($("q_followup_body")?.value || "").trim();
    setErrorOn($("q_sms_body"), sms ? "" : "Indique o texto do SMS");
    setErrorOn($("q_followup_body"), followup ? "" : "Indique o texto de follow-up");
    if (!sms || !followup) {
      ($("q_sms_body")?.value.trim() ? $("q_followup_body") : $("q_sms_body"))?.focus();
      notify("Revise os campos destacados.", "error");
      return false;
    }
    setSaving(true);
    try {
      const body = { share_messages: { sms_body: sms, followup_body: followup } };
      const j = await api("/api/settings/quotes", { method: "PATCH", body: JSON.stringify(body) });
      state.quotes.data = j.data;
      fillQuotes(j.data);
      state.quotes.snapshot = readQuotes();
      notify("Mensagens do orçamento salvas.", "success");
      return true;
    } catch (err) {
      notify(err.message || "Não foi possível salvar.", "error");
      return false;
    } finally {
      setSaving(false);
      updateSavebar();
    }
  }

  function discardQuoteShareMessages() {
    if (state.quotes.data) fillShareMessages(state.quotes.data);
    else if (state.quotes.snapshot) fillShareMessages({ share_messages: state.quotes.snapshot.share_messages });
  }

  const INV_SHARE_MSG_DEFAULTS = {
    sms_body:
      "Hi [name], your invoice [invoice_number] is ready.\n\nBalance due: [balance]\nDue: [due_date]\n\nView & pay here:\n[link]\n\nThank you!",
  };

  function readInvoiceShareMessages() {
    return { sms_body: String($("inv_sms_body")?.value || "").trim() };
  }

  function fillInvoiceShareMessages(d) {
    const sm = (d && d.share_messages) || {};
    if ($("inv_sms_body")) $("inv_sms_body").value = sm.sms_body || INV_SHARE_MSG_DEFAULTS.sms_body;
    syncInvoiceShareMsgCounts();
  }

  function syncInvoiceShareMsgCounts() {
    const sms = $("invSmsBodyCount");
    if (sms) sms.textContent = String(($("inv_sms_body")?.value || "").length);
  }

  function invoiceShareMessagesDirty() {
    if (!state.invoices.loaded || !state.invoices.snapshot) return false;
    return comparable(readInvoiceShareMessages()) !== comparable(state.invoices.snapshot.share_messages || {});
  }

  async function loadInvoiceShareMessages(force) {
    if (state.invoices.loaded && !force) {
      fillInvoiceShareMessages(state.invoices.data);
      return;
    }
    try {
      const j = await api("/api/settings/invoices");
      state.invoices.data = j.data;
      fillInvoiceShareMessages(j.data);
      state.invoices.snapshot = { share_messages: readInvoiceShareMessages() };
      state.invoices.loaded = true;
      updateSavebar();
    } catch (err) {
      notify(err.message || "Não foi possível carregar as mensagens das faturas.", "error");
    }
  }

  async function saveInvoiceShareMessages() {
    const sms = String($("inv_sms_body")?.value || "").trim();
    setErrorOn($("inv_sms_body"), sms ? "" : "Indique o texto do SMS");
    if (!sms) {
      $("inv_sms_body")?.focus();
      notify("Revise os campos destacados.", "error");
      return false;
    }
    setSaving(true);
    try {
      const j = await api("/api/settings/invoices", {
        method: "PATCH",
        body: JSON.stringify({ share_messages: { sms_body: sms } }),
      });
      state.invoices.data = j.data;
      fillInvoiceShareMessages(j.data);
      state.invoices.snapshot = { share_messages: readInvoiceShareMessages() };
      state.invoices.loaded = true;
      notify("Mensagem de SMS das faturas salva.", "success");
      return true;
    } catch (err) {
      notify(err.message || "Não foi possível salvar.", "error");
      return false;
    } finally {
      setSaving(false);
      updateSavebar();
    }
  }

  function discardInvoiceShareMessages() {
    if (state.invoices.data) fillInvoiceShareMessages(state.invoices.data);
    else if (state.invoices.snapshot) {
      fillInvoiceShareMessages({ share_messages: state.invoices.snapshot.share_messages });
    }
  }

  function bindInvoiceShareMessagesUi() {
    const form = $("invoiceShareForm");
    if (!form) return;
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      saveInvoiceShareMessages();
    });
    form.addEventListener("input", (e) => {
      if (e.target.closest(".has-error")) setErrorOn(e.target, "");
      syncInvoiceShareMsgCounts();
      updateSavebar();
    });
    $("btnInvShareMsgDefaults")?.addEventListener("click", () => {
      const sms = $("inv_sms_body");
      const hasCustom = sms && sms.value.trim() && sms.value.trim() !== INV_SHARE_MSG_DEFAULTS.sms_body;
      if (hasCustom && !window.confirm("Restaurar o texto padrão em inglês?")) return;
      if (sms) sms.value = INV_SHARE_MSG_DEFAULTS.sms_body;
      syncInvoiceShareMsgCounts();
      updateSavebar();
    });
  }

  function readQuotes() {
    const v = (id) => $(id).value.trim();
    return {
      number_prefix: v("q_number_prefix"),
      next_number: v("q_next_number"),
      validity_days: v("q_validity_days"),
      tax_rate: v("q_tax_rate"),
      terms: $("q_terms").value,
      inclusions: ($("q_inclusions")?.value || "")
        .split(/\n+/)
        .map((s) => s.replace(/^[-•*\d.)\s]+/, "").trim())
        .filter(Boolean)
        .slice(0, 24),
      client_view: readClientView(),
      share_messages: readShareMessages(),
    };
  }

  function fillQuotes(d) {
    $("q_number_prefix").value = d.number_prefix || "";
    $("q_next_number").value = d.next_number != null ? String(d.next_number) : "";
    $("q_validity_days").value = d.validity_days != null ? String(d.validity_days) : "";
    $("q_tax_rate").value = d.tax_rate != null ? String(d.tax_rate) : "0";
    $("q_terms").value = d.terms || "";
    if ($("q_inclusions")) {
      const inc = Array.isArray(d.inclusions) ? d.inclusions : [];
      $("q_inclusions").value = inc.length ? inc.join("\n") : "";
    }
    const cv = d.client_view || {};
    document.querySelectorAll("[data-cv]").forEach((b) => {
      b.setAttribute("aria-checked", cv[b.getAttribute("data-cv")] === false ? "false" : "true");
    });
    fillShareMessages(d);
    $("qLastHint").textContent = d.last_label
      ? `Último orçamento criado: ${d.last_label}. O próximo número só pode aumentar.`
      : "Nenhum orçamento criado ainda.";
    syncQuotesPreview();
  }

  function syncQuotesPreview() {
    const prefix = $("q_number_prefix").value.trim();
    const n = $("q_next_number").value.trim();
    $("qNextLabel").textContent = n ? `${prefix}${n}` : "—";
    $("qTermsCount").textContent = String($("q_terms").value.length);
    if ($("qInclusionsCount") && $("q_inclusions")) {
      const nItems = ($("q_inclusions").value || "")
        .split(/\n+/)
        .map((s) => s.trim())
        .filter(Boolean).length;
      $("qInclusionsCount").textContent = String(nItems);
    }
    syncShareMsgCounts();
    paintClientView();
  }

  function quotesDirtyKeys() {
    if (!state.quotes.loaded) return [];
    const now = readQuotes();
    const snap = state.quotes.snapshot;
    // share_messages has its own settings section — don't mix into Orçamentos dirty count
    return Object.keys(now).filter((k) => {
      if (k === "share_messages") return false;
      return comparable(now[k]) !== comparable(snap[k]);
    });
  }

  // --- owner signature
  let sigPad = null;

  function makeSigPad() {
    const canvas = $("sigCanvas");
    const ctx = canvas.getContext("2d");
    let down = false;
    const pos = (e) => {
      const r = canvas.getBoundingClientRect();
      const pt = e.touches ? e.touches[0] : e;
      return { x: ((pt.clientX - r.left) * canvas.width) / r.width, y: ((pt.clientY - r.top) * canvas.height) / r.height };
    };
    const start = (e) => {
      down = true;
      const p = pos(e);
      ctx.strokeStyle = "#1a2036";
      ctx.lineWidth = 2.4;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      showCanvas();
      e.preventDefault();
    };
    const move = (e) => {
      if (!down) return;
      const p = pos(e);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      if (!state.sig.drawn) {
        state.sig.drawn = true;
        $("s_auto").checked = false;
        updateSavebar();
      }
      e.preventDefault();
    };
    const end = () => (down = false);
    canvas.addEventListener("mousedown", start);
    canvas.addEventListener("mousemove", move);
    window.addEventListener("mouseup", end);
    canvas.addEventListener("touchstart", start, { passive: false });
    canvas.addEventListener("touchmove", move, { passive: false });
    canvas.addEventListener("touchend", end);
    return {
      clear() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      },
      fromName(name) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        if (window.QuoteSignatureAuto && name.length >= 2) {
          return !!window.QuoteSignatureAuto.renderAutoSignatureOnCanvas(canvas, name);
        }
        return false;
      },
      toDataURL() {
        return canvas.toDataURL("image/png");
      },
    };
  }

  function showCanvas() {
    $("sigSaved").hidden = true;
    $("sigCanvas").hidden = false;
    $("sigEmpty").hidden = true;
  }

  function showSaved(url) {
    const has = !!url;
    $("sigSaved").hidden = !has;
    if (has) $("sigSaved").src = url;
    $("sigCanvas").hidden = has;
    $("sigEmpty").hidden = has;
    $("btnSigRemove").hidden = !has;
  }

  function readSig() {
    return { name: $("s_name").value.trim(), title: $("s_title").value.trim(), auto: $("s_auto").checked };
  }

  function sigDirty() {
    if (!state.sig.loaded) return false;
    const now = readSig();
    const s = state.sig.snapshot;
    return state.sig.drawn || state.sig.removed || now.name !== s.name || now.title !== s.title || now.auto !== s.auto;
  }

  function autoSignFromName() {
    if (!$("s_auto").checked) return;
    const name = $("s_name").value.trim();
    showCanvas();
    if (sigPad.fromName(name)) state.sig.drawn = true;
    else {
      sigPad.clear();
      $("sigEmpty").hidden = false;
    }
  }

  function fillSig(d) {
    $("s_name").value = d.name || "";
    $("s_title").value = d.title || "";
    $("s_auto").checked = d.use_auto_signature !== false;
    state.sig.drawn = false;
    state.sig.removed = false;
    sigPad.clear();
    showSaved(d.has_signature ? d.image_url : null);
    $("sigMeta").textContent = d.has_signature && d.updated_at
      ? `Assinatura salva em ${new Date(d.updated_at).toLocaleDateString("pt-BR")}.`
      : "Nenhuma assinatura salva ainda.";
    state.sig.snapshot = readSig();
  }

  async function loadQuotes(force) {
    if (state.quotes.loaded && !force) return;
    const form = $("quotesForm");
    form.classList.add("is-loading");
    try {
      const [q, sig] = await Promise.all([api("/api/settings/quotes"), api("/api/quotes/settings/owner-signature")]);
      state.quotes.data = q.data;
      fillQuotes(q.data);
      state.quotes.snapshot = readQuotes();
      state.quotes.loaded = true;
      state.sig.data = sig.data;
      fillSig(sig.data);
      state.sig.loaded = true;
    } catch (err) {
      notify("Não foi possível carregar as configurações de orçamento.", "error");
    } finally {
      form.classList.remove("is-loading");
      updateSavebar();
    }
  }

  function discardQuotes() {
    if (state.quotes.data) fillQuotes(state.quotes.data);
    if (state.sig.data) fillSig(state.sig.data);
  }

  // ---------------------------------------------------------------- lead messages (pipeline stages)
  function cloneLeadMsg(data) {
    return JSON.parse(JSON.stringify(data || null));
  }

  function leadMsgDirty() {
    if (!state.leadMsg.snapshot) return false;
    try {
      const body = leadMsgPutBody();
      const snapStages = {};
      (state.leadMsg.snapshot.stages || []).forEach((st) => {
        snapStages[st.slug] = {
          email_subject: st.email_subject || null,
          templates: (st.templates || []).map((t) => ({
            id: t.id,
            label: t.label,
            body: t.body,
            on_send_action: t.on_send_action || null,
          })),
        };
      });
      const snap = {
        company_name: state.leadMsg.snapshot.company_name || null,
        default_email_subject: state.leadMsg.snapshot.default_email_subject || null,
        coupon_enabled: !!state.leadMsg.snapshot.coupon_enabled,
        coupon_code: state.leadMsg.snapshot.coupon_code || null,
        coupon_label: state.leadMsg.snapshot.coupon_label || null,
        coupon_sms_line: state.leadMsg.snapshot.coupon_sms_line || null,
        stages: snapStages,
      };
      return JSON.stringify(snap) !== JSON.stringify(body);
    } catch (_) {
      return false;
    }
  }

  function leadMsgPutBody() {
    const company_name = String($("lm_company")?.value || "").trim() || null;
    const default_email_subject = String($("lm_subject")?.value || "").trim() || null;
    const coupon_enabled = !!$("lm_coupon_enabled")?.checked;
    const coupon_code = String($("lm_coupon_code")?.value || "").trim() || null;
    const coupon_label = String($("lm_coupon_label")?.value || "").trim() || null;
    const coupon_sms_line = String($("lm_coupon_line")?.value || "").trim() || null;
    const stages = {};
    const list = state.leadMsg.draft?.stages || state.leadMsg.snapshot?.stages || [];
    list.forEach((st) => {
      const slug = st.slug;
      const subjectEl = document.querySelector(`[data-lm-subject="${slug}"]`);
      const cards = document.querySelectorAll(`[data-lm-stage="${slug}"] .cfg-lm-tpl`);
      const templates = [];
      cards.forEach((card, idx) => {
        const id = card.getAttribute("data-lm-id") || `tpl_${idx + 1}`;
        const label = String(card.querySelector("[data-lm-label]")?.value || "").trim();
        const body = String(card.querySelector("[data-lm-body]")?.value || "").trim();
        if (!label && !body) return;
        const draftTpl = (st.templates || []).find((t) => t.id === id);
        const on_send_action =
          draftTpl?.on_send_action ||
          (id === "follow_up_last_check" ? { set_priority: "low" } : null);
        templates.push({
          id,
          label: label || `Mensagem ${idx + 1}`,
          body,
          on_send_action,
        });
      });
      stages[slug] = {
        email_subject: subjectEl ? String(subjectEl.value || "").trim() || null : st.email_subject || null,
        templates: templates.length
          ? templates
          : (st.templates || []).map((t) => ({
              id: t.id,
              label: t.label,
              body: t.body,
              on_send_action: t.on_send_action || null,
            })),
      };
    });
    return {
      company_name,
      default_email_subject,
      coupon_enabled,
      coupon_code,
      coupon_label,
      coupon_sms_line,
      stages,
    };
  }

  function renderLeadMsgStage(stage, active) {
    const templates = stage.templates || [];
    const list = templates
      .map((t, idx) => {
        const ice =
          t.id === "follow_up_last_check" || (t.on_send_action && t.on_send_action.set_priority === "low")
            ? ' <span class="cfg-badge" title="Ao enviar, marca o lead como gelo">🧊 gelo</span>'
            : "";
        return `<div class="cfg-lm-tpl" data-lm-id="${esc(t.id)}">
            <div class="cfg-lm-tpl__head">
              <div class="cfg-field cfg-grow"><label>Título${ice}</label><input data-lm-label maxlength="120" value="${esc(t.label)}" /></div>
              <button type="button" class="btn cfg-btn-sm cfg-btn-ghost" data-lm-del-tpl title="Remover">Remover</button>
            </div>
            <div class="cfg-field"><label>Texto da mensagem ${idx + 1}</label><textarea data-lm-body rows="5" maxlength="4000">${esc(t.body)}</textarea></div>
          </div>`;
      })
      .join("");
    return `<div class="cfg-lm-panel" data-lm-stage="${esc(stage.slug)}" ${active ? "" : "hidden"}>
      <div class="cfg-field">
        <label>Assunto do e-mail nesta fase <span class="font-normal">(opcional)</span></label>
        <input data-lm-subject="${esc(stage.slug)}" maxlength="200" value="${esc(stage.email_subject || "")}" placeholder="Usa o assunto padrão se vazio" />
      </div>
      <div class="cfg-lm-tpls">${list}</div>
      <button type="button" class="btn btn-secondary cfg-btn-sm" data-lm-add-tpl>Adicionar mensagem</button>
    </div>`;
  }

  function renderLeadMessages(data) {
    const stages = data.stages || [];
    if (!stages.length) return;
    let active = state.leadMsg.activeSlug;
    if (!stages.some((s) => s.slug === active)) active = stages[0].slug;
    state.leadMsg.activeSlug = active;
    if ($("lm_company")) $("lm_company").value = data.company_name || "";
    if ($("lm_subject")) $("lm_subject").value = data.default_email_subject || "";
    if ($("lm_coupon_enabled")) $("lm_coupon_enabled").checked = !!data.coupon_enabled;
    if ($("lm_coupon_code")) $("lm_coupon_code").value = data.coupon_code || "";
    if ($("lm_coupon_label")) $("lm_coupon_label").value = data.coupon_label || "";
    if ($("lm_coupon_line")) $("lm_coupon_line").value = data.coupon_sms_line || "";
    $("lmStageTabs").innerHTML = stages
      .map(
        (s) =>
          `<button type="button" class="cfg-lm-tab${s.slug === active ? " is-active" : ""}" role="tab" aria-selected="${
            s.slug === active ? "true" : "false"
          }" data-lm-tab="${esc(s.slug)}">${esc(s.label)}</button>`,
      )
      .join("");
    $("lmStagePanels").innerHTML = stages.map((s) => renderLeadMsgStage(s, s.slug === active)).join("");
  }

  function syncLeadMsgDraftFromDom() {
    const body = leadMsgPutBody();
    const stagesArr = (state.leadMsg.draft?.stages || []).map((st) => ({
      slug: st.slug,
      label: st.label,
      email_subject: body.stages[st.slug]?.email_subject ?? null,
      templates: body.stages[st.slug]?.templates || st.templates,
    }));
    state.leadMsg.draft = {
      company_name: body.company_name,
      default_email_subject: body.default_email_subject,
      coupon_enabled: body.coupon_enabled,
      coupon_code: body.coupon_code,
      coupon_label: body.coupon_label,
      coupon_sms_line: body.coupon_sms_line,
      stages: stagesArr,
      tokens: state.leadMsg.draft?.tokens || ["[name]", "[company]", "[coupon]"],
    };
  }

  function discardLeadMessages() {
    if (!state.leadMsg.snapshot) return;
    state.leadMsg.draft = cloneLeadMsg(state.leadMsg.snapshot);
    renderLeadMessages(state.leadMsg.draft);
  }

  async function loadLeadMessages(force) {
    if (state.leadMsg.loaded && !force) {
      renderLeadMessages(state.leadMsg.draft || state.leadMsg.snapshot);
      return;
    }
    const j = await api("/api/settings/lead-messages");
    state.leadMsg.snapshot = cloneLeadMsg(j.data);
    state.leadMsg.draft = cloneLeadMsg(j.data);
    state.leadMsg.loaded = true;
    renderLeadMessages(state.leadMsg.draft);
  }

  async function saveLeadMessages() {
    syncLeadMsgDraftFromDom();
    const body = leadMsgPutBody();
    for (const [slug, st] of Object.entries(body.stages || {})) {
      if (!st.templates || !st.templates.length) {
        const label =
          (state.leadMsg.draft?.stages || []).find((s) => s.slug === slug)?.label || slug;
        notify(`Adicione ao menos uma mensagem em “${label}”.`, "error");
        return false;
      }
      for (const t of st.templates) {
        if (!String(t.body || "").trim()) {
          notify("Preencha o texto de todas as mensagens.", "error");
          return false;
        }
      }
    }
    setSaving(true);
    try {
      const j = await api("/api/settings/lead-messages", { method: "PUT", body: JSON.stringify(body) });
      state.leadMsg.snapshot = cloneLeadMsg(j.data);
      state.leadMsg.draft = cloneLeadMsg(j.data);
      renderLeadMessages(state.leadMsg.draft);
      notify("Mensagens salvas.", "success");
      updateSavebar();
      return true;
    } catch (err) {
      notify(err.message || "Não foi possível salvar.", "error");
      return false;
    } finally {
      setSaving(false);
    }
  }

  function bindLeadMessagesUi() {
    const form = $("leadMsgForm");
    if (!form || form.dataset.bound === "1") return;
    form.dataset.bound = "1";
    form.addEventListener("input", () => updateSavebar());
    form.addEventListener("change", () => updateSavebar());
    form.addEventListener("click", (e) => {
      const tab = e.target.closest?.("[data-lm-tab]");
      if (tab) {
        e.preventDefault();
        syncLeadMsgDraftFromDom();
        state.leadMsg.activeSlug = tab.getAttribute("data-lm-tab");
        renderLeadMessages(state.leadMsg.draft);
        updateSavebar();
        return;
      }
      const add = e.target.closest?.("[data-lm-add-tpl]");
      if (add) {
        e.preventDefault();
        syncLeadMsgDraftFromDom();
        const slug = state.leadMsg.activeSlug;
        const st = (state.leadMsg.draft.stages || []).find((s) => s.slug === slug);
        if (!st) return;
        if ((st.templates || []).length >= 12) {
          notify("Máximo de 12 mensagens por fase.", "error");
          return;
        }
        st.templates.push({
          id: `custom_${Date.now()}`,
          label: `Mensagem ${(st.templates.length || 0) + 1}`,
          body: "Hi [name], …",
        });
        renderLeadMessages(state.leadMsg.draft);
        updateSavebar();
        return;
      }
      const del = e.target.closest?.("[data-lm-del-tpl]");
      if (del) {
        e.preventDefault();
        const card = del.closest(".cfg-lm-tpl");
        const id = card?.getAttribute("data-lm-id");
        syncLeadMsgDraftFromDom();
        const slug = state.leadMsg.activeSlug;
        const st = (state.leadMsg.draft.stages || []).find((s) => s.slug === slug);
        if (!st || !id) return;
        if ((st.templates || []).length <= 1) {
          notify("Mantenha ao menos uma mensagem por fase.", "error");
          return;
        }
        st.templates = st.templates.filter((t) => t.id !== id);
        renderLeadMessages(state.leadMsg.draft);
        updateSavebar();
      }
    });
  }

  function readLeadAutomations() {
    const daysRaw = String($("la_days")?.value || "").trim();
    const days = Number(daysRaw);
    return {
      quoteSentAutoFollowUpStageEnabled: !!$("la_auto_stage")?.checked,
      quoteFollowUpDays: Number.isFinite(days) ? Math.min(90, Math.max(0, Math.floor(days))) : 3,
    };
  }

  function fillLeadAutomations(data) {
    if ($("la_auto_stage")) $("la_auto_stage").checked = !!data?.quoteSentAutoFollowUpStageEnabled;
    if ($("la_days")) $("la_days").value = String(data?.quoteFollowUpDays ?? 3);
  }

  function leadAutoDirty() {
    if (!state.leadAuto.snapshot) return false;
    const cur = readLeadAutomations();
    const snap = state.leadAuto.snapshot;
    return (
      !!cur.quoteSentAutoFollowUpStageEnabled !== !!snap.quoteSentAutoFollowUpStageEnabled ||
      Number(cur.quoteFollowUpDays) !== Number(snap.quoteFollowUpDays)
    );
  }

  function discardLeadAutomations() {
    if (!state.leadAuto.snapshot) return;
    fillLeadAutomations(state.leadAuto.snapshot);
  }

  async function loadLeadAutomations(force) {
    if (state.leadAuto.loaded && !force) {
      fillLeadAutomations(state.leadAuto.snapshot);
      return;
    }
    const j = await api("/api/settings/lead-automations");
    state.leadAuto.snapshot = {
      quoteSentAutoFollowUpStageEnabled: !!j.data?.quoteSentAutoFollowUpStageEnabled,
      quoteFollowUpDays: Number(j.data?.quoteFollowUpDays ?? 3),
    };
    state.leadAuto.loaded = true;
    fillLeadAutomations(state.leadAuto.snapshot);
  }

  async function saveLeadAutomations() {
    const body = readLeadAutomations();
    setSaving(true);
    try {
      const j = await api("/api/settings/lead-automations", {
        method: "PUT",
        body: JSON.stringify(body),
      });
      state.leadAuto.snapshot = {
        quoteSentAutoFollowUpStageEnabled: !!j.data?.quoteSentAutoFollowUpStageEnabled,
        quoteFollowUpDays: Number(j.data?.quoteFollowUpDays ?? body.quoteFollowUpDays),
      };
      fillLeadAutomations(state.leadAuto.snapshot);
      notify("Automações salvas.", "success");
      updateSavebar();
      return true;
    } catch (err) {
      notify(err.message || "Não foi possível salvar.", "error");
      return false;
    } finally {
      setSaving(false);
    }
  }

  function bindLeadAutomationsUi() {
    const form = $("leadAutoForm");
    if (!form || form.dataset.bound === "1") return;
    form.dataset.bound = "1";
    form.addEventListener("input", () => updateSavebar());
    form.addEventListener("change", () => updateSavebar());
  }

  // ---------------------------------------------------------------- jobs settings
  function fillJobsSettings(d) {
    const el = $("jobs_checklist_enabled");
    if (el) el.checked = d?.checklist_enabled !== false;
  }

  function readJobsSettings() {
    return { checklist_enabled: !!$("jobs_checklist_enabled")?.checked };
  }

  function jobsDirty() {
    if (!state.jobs.snapshot) return false;
    return (
      !!readJobsSettings().checklist_enabled !== !!state.jobs.snapshot.checklist_enabled
    );
  }

  function discardJobsSettings() {
    if (!state.jobs.snapshot) return;
    fillJobsSettings(state.jobs.snapshot);
  }

  async function loadJobsSettings(force) {
    if (state.jobs.loaded && !force) {
      fillJobsSettings(state.jobs.snapshot);
      return;
    }
    const j = await api("/api/settings/jobs");
    state.jobs.snapshot = { checklist_enabled: j.data?.checklist_enabled !== false };
    state.jobs.loaded = true;
    fillJobsSettings(state.jobs.snapshot);
  }

  async function saveJobsSettings() {
    const body = readJobsSettings();
    setSaving(true);
    try {
      const j = await api("/api/settings/jobs", {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      state.jobs.snapshot = { checklist_enabled: j.data?.checklist_enabled !== false };
      fillJobsSettings(state.jobs.snapshot);
      notify("Configurações de Jobs salvas.", "success");
      updateSavebar();
      return true;
    } catch (err) {
      notify(err.message || "Não foi possível salvar.", "error");
      return false;
    } finally {
      setSaving(false);
    }
  }

  function bindJobsSettingsUi() {
    const form = $("jobsSettingsForm");
    if (!form || form.dataset.bound === "1") return;
    form.dataset.bound = "1";
    form.addEventListener("change", () => updateSavebar());
  }

  // ---------------------------------------------------------------- folha cycle
  const FOLHA_WD = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];

  function lengthFromWeekdays(start, end) {
    return ((Number(end) - Number(start) + 7) % 7) + 1;
  }

  function endFromLength(start, len) {
    return (Number(start) + Math.max(1, Number(len)) - 1) % 7;
  }

  function fillWeekdaySelect(sel, value) {
    if (!sel) return;
    sel.innerHTML = FOLHA_WD.map((label, i) => `<option value="${i}">${label}</option>`).join("");
    sel.value = String(value ?? 0);
  }

  function readFolhaCycle() {
    const frequency = $("folha_frequency")?.value || "weekly";
    const start = Number($("folha_start_weekday")?.value || 1);
    const end = Number($("folha_end_weekday")?.value || 0);
    const pay_timing = $("folha_pay_timing")?.value || "on_period_end";
    let period_length_days = 7;
    if (frequency === "biweekly") period_length_days = 14;
    else if (frequency === "weekly") period_length_days = lengthFromWeekdays(start, end);
    return {
      frequency,
      period_start_weekday: start,
      period_length_days,
      pay_timing,
      pay_weekday: Number($("folha_pay_weekday")?.value || 5),
      pay_offset_days: Number($("folha_pay_offset")?.value || 0),
      pay_day_of_month: Number($("folha_pay_dom")?.value || 15),
      biweekly_anchor_ymd: $("folha_biweekly_anchor")?.value || null,
      reimbursement_timing: $("folha_reimbursement_timing")?.value === "open_period" ? "open_period" : "with_day",
    };
  }

  function syncFolhaFieldVisibility() {
    const frequency = $("folha_frequency")?.value || "weekly";
    const timing = $("folha_pay_timing")?.value || "on_period_end";
    const showStart = frequency === "weekly" || frequency === "biweekly";
    const showEnd = frequency === "weekly";
    document.querySelectorAll("[data-folha-weekly]").forEach((el) => {
      el.hidden = !showStart;
    });
    document.querySelectorAll("[data-folha-weekly-end]").forEach((el) => {
      el.hidden = !showEnd;
    });
    document.querySelectorAll("[data-folha-biweekly]").forEach((el) => {
      el.hidden = frequency !== "biweekly";
    });
    document.querySelectorAll("[data-folha-pay-weekday]").forEach((el) => {
      el.hidden = !(timing === "same_week" || timing === "next_weekday");
    });
    document.querySelectorAll("[data-folha-pay-offset]").forEach((el) => {
      el.hidden = timing !== "days_after";
    });
    document.querySelectorAll("[data-folha-pay-dom]").forEach((el) => {
      el.hidden = timing !== "day_of_month";
    });
  }

  function renderFolhaPreview(preview) {
    const box = $("folhaCyclePreview");
    if (!box) return;
    const rows = preview?.upcoming || [];
    if (!rows.length) {
      box.innerHTML = '<p class="cfg-hint">Sem pré-visualização.</p>';
      return;
    }
    const short = ["D", "S", "T", "Q", "Q", "S", "S"];
    box.innerHTML = rows
      .map((p) => {
        const start = new Date(`${p.start}T12:00:00Z`);
        const end = new Date(`${p.end}T12:00:00Z`);
        const days = [];
        for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
          const ymd = d.toISOString().slice(0, 10);
          const cls = ymd === p.pay_on ? "is-pay" : "is-work";
          days.push(`<span class="cfg-cycle-day ${cls}" title="${ymd}">${short[d.getUTCDay()]}</span>`);
        }
        if (p.pay_on > p.end || p.pay_on < p.start) {
          const pay = new Date(`${p.pay_on}T12:00:00Z`);
          days.push(`<span class="cfg-cycle-day is-pay" title="Paga ${p.pay_on}">${short[pay.getUTCDay()]}</span>`);
        }
        return `<div class="cfg-cycle-row">
          <div>
            <span class="cfg-cycle-row__label">${esc(p.label)}</span>
            <span class="cfg-cycle-row__range">${esc(p.start)} → ${esc(p.end)}</span>
            <div class="cfg-cycle-strip">${days.join("")}</div>
          </div>
          <span class="cfg-cycle-row__pay">Paga ${esc(p.pay_on.slice(8, 10))}/${esc(p.pay_on.slice(5, 7))}</span>
        </div>`;
      })
      .join("");
  }

  function fillFolhaSettings(data) {
    const cycle = data?.cycle || {};
    fillWeekdaySelect($("folha_start_weekday"), cycle.period_start_weekday ?? 1);
    fillWeekdaySelect($("folha_end_weekday"), endFromLength(cycle.period_start_weekday ?? 1, cycle.period_length_days ?? 7));
    fillWeekdaySelect($("folha_pay_weekday"), cycle.pay_weekday ?? 5);
    if ($("folha_frequency")) $("folha_frequency").value = cycle.frequency || "weekly";
    if ($("folha_pay_timing")) $("folha_pay_timing").value = cycle.pay_timing || "on_period_end";
    if ($("folha_pay_offset")) $("folha_pay_offset").value = String(cycle.pay_offset_days ?? 0);
    if ($("folha_pay_dom")) $("folha_pay_dom").value = String(cycle.pay_day_of_month ?? 15);
    if ($("folha_biweekly_anchor")) $("folha_biweekly_anchor").value = cycle.biweekly_anchor_ymd || "";
    const reimbTiming = data?.reimbursement_timing || cycle.reimbursement_timing || "with_day";
    if ($("folha_reimbursement_timing")) $("folha_reimbursement_timing").value = reimbTiming;
    if ($("folhaCycleSummary")) $("folhaCycleSummary").textContent = data?.summary || "—";
    renderFolhaPreview(data?.preview);
    syncFolhaFieldVisibility();
  }

  function folhaDirty() {
    if (!state.folha.snapshot?.cycle) return false;
    return JSON.stringify(readFolhaCycle()) !== JSON.stringify(state.folha.snapshot.cycle);
  }

  function discardFolhaSettings() {
    if (!state.folha.snapshot) return;
    fillFolhaSettings(state.folha.snapshot);
  }

  async function loadFolhaSettings(force) {
    if (state.folha.loaded && !force) {
      fillFolhaSettings(state.folha.snapshot);
      await loadCatalogKind("payroll_payment_method", "cfgPayMethodsBody", "cfgPayMethodAddBtn");
      return;
    }
    const j = await api("/api/settings/folha");
    state.folha.snapshot = j.data;
    state.folha.loaded = true;
    fillFolhaSettings(j.data);
    await loadCatalogKind("payroll_payment_method", "cfgPayMethodsBody", "cfgPayMethodAddBtn");
  }

  async function saveFolhaSettings() {
    const body = readFolhaCycle();
    setSaving(true);
    try {
      const j = await api("/api/settings/folha", {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      state.folha.snapshot = j.data;
      fillFolhaSettings(j.data);
      notify("Ciclo da Folha salvo.", "success");
      updateSavebar();
      return true;
    } catch (err) {
      notify(err.message || "Não foi possível salvar.", "error");
      return false;
    } finally {
      setSaving(false);
    }
  }

  function bindFolhaSettingsUi() {
    const form = $("folhaCycleForm");
    if (!form || form.dataset.bound === "1") return;
    form.dataset.bound = "1";
    form.addEventListener("change", async () => {
      syncFolhaFieldVisibility();
      updateSavebar();
      try {
        const j = await api("/api/settings/folha/preview", {
          method: "POST",
          body: JSON.stringify(readFolhaCycle()),
        });
        if ($("folhaCycleSummary")) $("folhaCycleSummary").textContent = j.data?.summary || "—";
        renderFolhaPreview(j.data?.preview);
      } catch (_) {
        /* keep last preview */
      }
    });
  }

  function validateQuotes() {
    const d = readQuotes();
    const checks = [
      ["q_number_prefix", /^[A-Za-z0-9#/._-]{0,8}$/.test(d.number_prefix) ? "" : "Use até 8 letras, números ou - _ / . #"],
      ["q_next_number", !d.next_number || (/^\d+$/.test(d.next_number) && Number(d.next_number) >= 1) ? "" : "Número inválido"],
      ["q_validity_days", /^\d+$/.test(d.validity_days) && +d.validity_days >= 1 && +d.validity_days <= 365 ? "" : "Entre 1 e 365 dias"],
      ["q_tax_rate", d.tax_rate !== "" && +d.tax_rate >= 0 && +d.tax_rate <= 30 ? "" : "Entre 0 e 30%"],
    ];
    const last = state.quotes.data && state.quotes.data.last_number;
    if (!checks[1][1] && d.next_number && last != null && +d.next_number <= last) {
      checks[1][1] = `Precisa ser maior que ${state.quotes.data.last_label}`;
    }
    let first = null;
    for (const [id, msg] of checks) {
      setErrorOn($(id), msg);
      if (msg && !first) first = $(id);
    }
    if (sigDirty()) {
      const s = readSig();
      const nameMsg = s.name.length < 2 ? "Indique o nome" : "";
      const titleMsg = s.title.length < 2 ? "Indique o cargo" : "";
      setErrorOn($("s_name"), nameMsg);
      setErrorOn($("s_title"), titleMsg);
      if (!first && nameMsg) first = $("s_name");
      if (!first && titleMsg) first = $("s_title");
    }
    return first;
  }

  async function saveQuotes() {
    const bad = validateQuotes();
    if (bad) {
      bad.focus();
      notify("Revise os campos destacados.", "error");
      return false;
    }
    setSaving(true);
    try {
      const keys = quotesDirtyKeys();
      if (keys.length) {
        const now = readQuotes();
        const body = {};
        for (const k of keys) {
          if (k === "next_number") body[k] = now[k] ? Number(now[k]) : null;
          else if (k === "validity_days" || k === "tax_rate") body[k] = Number(now[k]);
          else body[k] = now[k];
        }
        try {
          const j = await api("/api/settings/quotes", { method: "PATCH", body: JSON.stringify(body) });
          state.quotes.data = j.data;
          fillQuotes(j.data);
          state.quotes.snapshot = readQuotes();
        } catch (err) {
          if (err.fields) {
            for (const [k, msg] of Object.entries(err.fields)) setErrorOn($(`q_${k}`), msg);
          }
          throw err;
        }
      }
      if (sigDirty()) {
        if (state.sig.removed && !state.sig.drawn) {
          const j = await api("/api/quotes/settings/owner-signature", { method: "DELETE" });
          state.sig.data = { ...j.data };
        }
        const s = readSig();
        if (s.auto && !state.sig.drawn && !state.sig.data?.has_signature) autoSignFromName();
        const payload = { name: s.name, title: s.title, use_auto_signature: s.auto };
        if (state.sig.drawn) payload.signature_png = sigPad.toDataURL();
        const j = await api("/api/quotes/settings/owner-signature", { method: "PUT", body: JSON.stringify(payload) });
        state.sig.data = j.data;
        fillSig(j.data);
      }
      clearFormErrors("quotesForm");
      notify("Configurações de orçamento salvas.", "success");
      return true;
    } catch (err) {
      notify(err.message || "Não foi possível salvar.", "error");
      return false;
    } finally {
      setSaving(false);
      updateSavebar();
    }
  }

  function bindQuotes() {
    sigPad = makeSigPad();
    const form = $("quotesForm");
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      saveQuotes();
    });
    form.addEventListener("input", (e) => {
      if (e.target.id === "s_name" && $("s_auto").checked) autoSignFromName();
      if (e.target.closest(".has-error")) setErrorOn(e.target, "");
      syncQuotesPreview();
      updateSavebar();
    });
    form.addEventListener("change", () => updateSavebar());
    form.addEventListener("click", (e) => {
      const b = e.target.closest("[data-cv]");
      if (!b) return;
      b.setAttribute("aria-checked", b.getAttribute("aria-checked") === "true" ? "false" : "true");
      paintClientView();
      updateSavebar();
    });
    $("btnTermsSample").addEventListener("click", () => {
      const t = $("q_terms");
      if (t.value.trim() && !window.confirm("Substituir o texto atual pelo exemplo?")) return;
      t.value = TERMS_SAMPLE;
      syncQuotesPreview();
      updateSavebar();
      t.focus();
    });
    $("btnInclusionsSample")?.addEventListener("click", () => {
      const t = $("q_inclusions");
      if (!t) return;
      if (t.value.trim() && !window.confirm("Substituir a lista atual pelo exemplo?")) return;
      t.value = INCLUSIONS_SAMPLE;
      syncQuotesPreview();
      updateSavebar();
      t.focus();
    });
    $("btnShareMsgDefaults")?.addEventListener("click", () => {
      const sms = $("q_sms_body");
      const fu = $("q_followup_body");
      const hasCustom =
        (sms && sms.value.trim() && sms.value.trim() !== SHARE_MSG_DEFAULTS.sms_body) ||
        (fu && fu.value.trim() && fu.value.trim() !== SHARE_MSG_DEFAULTS.followup_body);
      if (hasCustom && !window.confirm("Restaurar os textos padrão em inglês?")) return;
      if (sms) sms.value = SHARE_MSG_DEFAULTS.sms_body;
      if (fu) fu.value = SHARE_MSG_DEFAULTS.followup_body;
      syncShareMsgCounts();
      updateSavebar();
    });
    const shareForm = $("quoteShareForm");
    if (shareForm) {
      shareForm.addEventListener("submit", (e) => {
        e.preventDefault();
        saveQuoteShareMessages();
      });
      shareForm.addEventListener("input", (e) => {
        if (e.target.closest(".has-error")) setErrorOn(e.target, "");
        syncShareMsgCounts();
        updateSavebar();
      });
    }
    $("s_auto").addEventListener("change", () => {
      if ($("s_auto").checked) autoSignFromName();
      updateSavebar();
    });
    $("btnSigRedraw").addEventListener("click", () => {
      sigPad.clear();
      showCanvas();
      $("sigEmpty").hidden = false;
      $("s_auto").checked = false;
      state.sig.drawn = false;
      state.sig.removed = !!(state.sig.data && state.sig.data.has_signature);
      updateSavebar();
    });
    $("btnSigRemove").addEventListener("click", () => {
      sigPad.clear();
      showCanvas();
      $("sigEmpty").hidden = false;
      $("btnSigRemove").hidden = true;
      state.sig.drawn = false;
      state.sig.removed = true;
      updateSavebar();
    });
  }

  // ---------------------------------------------------------------- estimate rules
  const RULE_FIELDS = [
    ["waste_percent", "Desperdício %", 100, "0.5"],
    ["material_markup", "Markup material %", 500, "1"],
    ["labor_markup", "Markup mão de obra %", 500, "1"],
    ["default_price_per_sqft", "Material $/sq ft", 10000, "0.01"],
    ["default_labor_per_sqft", "Mão de obra $/sq ft", 10000, "0.01"],
  ];

  function renderRules(rows) {
    if (!rows) return;
    $("rulesBody").innerHTML = rows
      .map((r) => {
        const cells = RULE_FIELDS.map(([k, label, max, step]) => {
          const isDefault = Number(r[k]) === Number(r.defaults[k]);
          return (
            `<td><input class="cfg-num${isDefault ? "" : " is-custom"}" type="number" min="0" max="${max}" step="${step}" inputmode="decimal" ` +
            `data-rule="${r.flooring_type}" data-rk="${k}" data-default="${r.defaults[k]}" value="${esc(r[k])}" ` +
            `aria-label="${esc(r.label)}: ${label}" title="Padrão: ${r.defaults[k]}" /></td>`
          );
        }).join("");
        return (
          `<tr data-row="${r.flooring_type}"><th scope="row">${esc(r.label)}</th>${cells}` +
          `<td><button type="button" class="btn cfg-btn-sm cfg-btn-ghost" data-reset="${r.flooring_type}">Padrão</button></td></tr>`
        );
      })
      .join("");
    syncRuleMarks();
  }

  function readRules() {
    const out = {};
    document.querySelectorAll("#rulesBody input[data-rule]").forEach((i) => {
      const t = i.getAttribute("data-rule");
      out[t] = out[t] || { flooring_type: t };
      out[t][i.getAttribute("data-rk")] = i.value.trim();
    });
    return Object.values(out);
  }

  function rulesDirtyTypes() {
    if (!state.rules.loaded) return [];
    const snap = new Map(state.rules.snapshot.map((r) => [r.flooring_type, r]));
    return readRules()
      .filter((r) => {
        const s = snap.get(r.flooring_type);
        return RULE_FIELDS.some(([k]) => Number(r[k]) !== Number(s[k]) || r[k] === "");
      })
      .map((r) => r.flooring_type);
  }

  function syncRuleMarks() {
    document.querySelectorAll("#rulesBody input[data-rule]").forEach((i) => {
      i.classList.toggle("is-custom", i.value !== "" && Number(i.value) !== Number(i.getAttribute("data-default")));
    });
    document.querySelectorAll("#rulesBody tr[data-row]").forEach((tr) => {
      const custom = tr.querySelector("input.is-custom");
      tr.querySelector("[data-reset]").disabled = !custom;
    });
  }

  async function loadRules(force) {
    if (state.rules.loaded && !force) return;
    try {
      const j = await api("/api/settings/estimate-rules");
      state.rules.snapshot = j.data;
      renderRules(j.data);
      state.rules.loaded = true;
    } catch (err) {
      $("rulesBody").innerHTML = `<tr><td colspan="7" class="cfg-hint">Não foi possível carregar as regras.</td></tr>`;
    } finally {
      updateSavebar();
    }
  }

  async function saveRules() {
    let first = null;
    const rows = readRules();
    document.querySelectorAll("#rulesBody input[data-rule]").forEach((i) => {
      const v = i.value.trim();
      const max = Number(i.getAttribute("max"));
      const msg = v === "" || Number.isNaN(+v) ? "Obrigatório" : +v < 0 ? "Não pode ser negativo" : +v > max ? `Máximo ${max}` : "";
      setErrorOn(i, msg);
      if (msg && !first) first = i;
    });
    if (first) {
      first.focus();
      notify("Revise os valores destacados.", "error");
      return false;
    }
    setSaving(true);
    try {
      const body = { rules: rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, k === "flooring_type" ? v : Number(v)]))) };
      const j = await api("/api/settings/estimate-rules", { method: "PUT", body: JSON.stringify(body) });
      state.rules.snapshot = j.data;
      renderRules(j.data);
      notify("Regras de estimativa salvas.", "success");
      return true;
    } catch (err) {
      notify(err.message || "Não foi possível salvar.", "error");
      return false;
    } finally {
      setSaving(false);
      updateSavebar();
    }
  }

  function bindRules() {
    const body = $("rulesBody");
    body.addEventListener("input", (e) => {
      if (e.target.matches("input[data-rule]")) {
        if (e.target.closest(".has-error")) setErrorOn(e.target, "");
        syncRuleMarks();
        updateSavebar();
      }
    });
    body.addEventListener("click", (e) => {
      const b = e.target.closest("[data-reset]");
      if (!b) return;
      const t = b.getAttribute("data-reset");
      body.querySelectorAll(`input[data-rule="${t}"]`).forEach((i) => {
        i.value = i.getAttribute("data-default");
        setErrorOn(i, "");
      });
      syncRuleMarks();
      updateSavebar();
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

  // ---------------------------------------------------------------- cargos + catalog
  const catalogState = {
    roles: null,
    permsByGroup: null,
    service_category: null,
    unit: null,
    customer_type: null,
    payroll_payment_method: null,
  };

  function openCfgModal(id) {
    const m = $(id);
    if (m) m.hidden = false;
  }
  function closeCfgModal(id) {
    const m = $(id);
    if (m) m.hidden = true;
  }

  function canManageRolesLocal() {
    return state.isAdmin || state.perms.has("roles.manage");
  }
  function canManageCatalogLocal() {
    return state.isAdmin || state.perms.has("settings.manage");
  }

  function renderPermGroups(byGroup, selectedIds) {
    const selected = new Set(selectedIds || []);
    const groups = Object.keys(byGroup || {}).sort();
    if (!groups.length) return '<p class="cfg-hint">Nenhuma permissão disponível.</p>';
    return groups
      .map((g) => {
        const items = byGroup[g] || [];
        const checks = items
          .map((p) => {
            const id = p.id || p.permission_id;
            const key = p.permission_key || p.key || "";
            const name = p.permission_name || p.description || key;
            const checked = selected.has(id) ? " checked" : "";
            return `<label class="cfg-perm"><input type="checkbox" value="${esc(id)}" data-perm-id="${esc(id)}"${checked} /> <span>${esc(name)}</span><small>${esc(key)}</small></label>`;
          })
          .join("");
        return `<div class="cfg-perm-group"><h4>${esc(g)}</h4>${checks}</div>`;
      })
      .join("");
  }

  function collectCfgPermIds() {
    return [...document.querySelectorAll("#cfgRolePermsGroups input[type=checkbox]:checked")].map((el) => el.value).filter(Boolean);
  }

  async function ensurePermRegistry() {
    if (catalogState.permsByGroup) return catalogState.permsByGroup;
    const j = await api("/api/permissions");
    catalogState.permsByGroup = j.by_group || {};
    return catalogState.permsByGroup;
  }

  async function loadRolesSection() {
    const body = $("cfgRolesBody");
    if (!body) return;
    body.innerHTML = `<tr><td colspan="5"><div class="cfg-skeleton"></div></td></tr>`;
    try {
      const j = await api("/api/roles");
      catalogState.roles = j.data || [];
      const manage = canManageRolesLocal();
      if ($("cfgRoleAddBtn")) $("cfgRoleAddBtn").hidden = !manage;
      if (!catalogState.roles.length) {
        body.innerHTML = `<tr><td colspan="5" class="cfg-hint">Nenhum cargo ainda.</td></tr>`;
        return;
      }
      body.innerHTML = catalogState.roles
        .map((r) => {
          const perms = (r.permission_keys || []).length;
          const badge = r.is_system ? '<span class="cfg-badge">Sistema</span>' : "";
          const actions = manage
            ? `<button type="button" class="btn cfg-btn-ghost cfg-btn-sm" data-role-edit="${esc(r.id)}">Editar</button>` +
              (!r.is_system && !(r.user_count > 0)
                ? ` <button type="button" class="btn cfg-btn-ghost cfg-btn-sm" data-role-del="${esc(r.id)}">Remover</button>`
                : "")
            : "—";
          return `<tr>
            <td><strong>${esc(r.name)}</strong> ${badge}<div class="cfg-hint">${esc(r.description || "")}</div></td>
            <td><code>${esc(r.key)}</code></td>
            <td>${Number(r.user_count || 0)}</td>
            <td>${perms}</td>
            <td class="cfg-actions">${actions}</td>
          </tr>`;
        })
        .join("");
    } catch (err) {
      body.innerHTML = `<tr><td colspan="5" class="cfg-err">${esc(err.message || "Erro ao carregar cargos")}</td></tr>`;
    }
  }

  async function openRoleEditor(roleId) {
    if (!canManageRolesLocal()) {
      notify("Sem permissão para gerir cargos", "error");
      return;
    }
    const byGroup = await ensurePermRegistry();
    const role = roleId ? (catalogState.roles || []).find((r) => r.id === roleId) : null;
    $("cfgRoleId").value = role ? role.id : "";
    $("cfgRoleName").value = role ? role.name : "";
    $("cfgRoleKey").value = role ? role.key : "";
    $("cfgRoleKey").disabled = !!role;
    $("cfgRoleDescription").value = role ? role.description || "" : "";
    $("cfgRoleModalTitle").textContent = role ? "Editar cargo" : "Novo cargo";
    $("cfgRoleFormSubmit").textContent = role ? "Guardar" : "Criar cargo";
    $("cfgRoleFormError").hidden = true;
    $("cfgRolePermsGroups").innerHTML = renderPermGroups(byGroup, role ? role.permission_ids || [] : []);
    openCfgModal("cfgRoleModal");
  }

  async function submitRoleForm(e) {
    e.preventDefault();
    const err = $("cfgRoleFormError");
    err.hidden = true;
    const id = $("cfgRoleId").value.trim();
    const name = $("cfgRoleName").value.trim();
    const key = $("cfgRoleKey").value.trim();
    const description = $("cfgRoleDescription").value.trim();
    const permission_ids = collectCfgPermIds();
    if (!name) {
      err.textContent = "Indique o nome do cargo.";
      err.hidden = false;
      return;
    }
    const btn = $("cfgRoleFormSubmit");
    btn.disabled = true;
    try {
      if (id) {
        await api(`/api/roles/${id}`, {
          method: "PUT",
          body: JSON.stringify({ name, description: description || null, permission_ids }),
        });
        notify("Cargo atualizado", "success");
      } else {
        const body = { name, permission_ids };
        if (key) body.key = key;
        if (description) body.description = description;
        await api("/api/roles", { method: "POST", body: JSON.stringify(body) });
        notify("Cargo criado", "success");
      }
      closeCfgModal("cfgRoleModal");
      await loadRolesSection();
    } catch (ex) {
      err.textContent = ex.message || "Erro ao guardar.";
      err.hidden = false;
    } finally {
      btn.disabled = false;
    }
  }

  async function deleteRole(id) {
    if (!canManageRolesLocal()) return;
    const role = (catalogState.roles || []).find((r) => r.id === id);
    if (!role || role.is_system) return;
    if (!window.confirm(`Remover o cargo “${role.name}”?`)) return;
    try {
      await api(`/api/roles/${id}`, { method: "DELETE" });
      notify("Cargo removido", "success");
      await loadRolesSection();
    } catch (ex) {
      notify(ex.message || "Não foi possível remover", "error");
    }
  }

  async function loadCatalogKind(kind, bodyId, addBtnId) {
    const body = $(bodyId);
    if (!body) return;
    body.innerHTML = `<tr><td colspan="5"><div class="cfg-skeleton"></div></td></tr>`;
    try {
      const j = await api(`/api/settings/catalog/${kind}`);
      catalogState[kind] = j.data || [];
      const manage = canManageCatalogLocal();
      if ($(addBtnId)) $(addBtnId).hidden = !manage;
      if (!catalogState[kind].length) {
        body.innerHTML = `<tr><td colspan="5" class="cfg-hint">Nenhum item ainda.</td></tr>`;
        return;
      }
      body.innerHTML = catalogState[kind]
        .map((it) => {
          const status = it.active ? '<span class="cfg-badge cfg-badge--ok">Ativo</span>' : '<span class="cfg-badge">Inativo</span>';
          const sys = it.is_system && kind !== "payroll_payment_method" ? ' <span class="cfg-badge">Padrão</span>' : "";
          const canHardDelete = !it.is_system || kind === "payroll_payment_method";
          const actions = manage
            ? `<button type="button" class="btn cfg-btn-ghost cfg-btn-sm" data-cat-edit="${esc(it.id)}" data-cat-kind="${esc(kind)}">Editar</button>
               <button type="button" class="btn cfg-btn-ghost cfg-btn-sm" data-cat-del="${esc(it.id)}" data-cat-kind="${esc(kind)}">${canHardDelete ? "Remover" : "Desativar"}</button>`
            : "—";
          return `<tr>
            <td><strong>${esc(it.label)}</strong>${sys}</td>
            <td><code>${esc(it.key)}</code></td>
            <td>${esc(it.description || "—")}</td>
            <td>${status}</td>
            <td class="cfg-actions">${actions}</td>
          </tr>`;
        })
        .join("");
    } catch (err) {
      body.innerHTML = `<tr><td colspan="5" class="cfg-err">${esc(err.message || "Erro ao carregar")}</td></tr>`;
    }
  }

  function openCatalogEditor(kind, itemId) {
    if (!canManageCatalogLocal()) {
      notify("Sem permissão para editar", "error");
      return;
    }
    const list = catalogState[kind] || [];
    const item = itemId ? list.find((x) => x.id === itemId) : null;
    $("cfgCatalogKind").value = kind;
    $("cfgCatalogId").value = item ? item.id : "";
    $("cfgCatalogLabel").value = item ? item.label : "";
    $("cfgCatalogKey").value = item ? item.key : "";
    $("cfgCatalogKey").disabled = !!(item && item.is_system && kind !== "payroll_payment_method");
    $("cfgCatalogDescription").value = item ? item.description || "" : "";
    $("cfgCatalogActive").checked = item ? !!item.active : true;
    const titles = {
      service_category: item ? "Editar categoria" : "Nova categoria",
      unit: item ? "Editar unidade" : "Nova unidade",
      customer_type: item ? "Editar tipo de cliente" : "Novo tipo de cliente",
      payroll_payment_method: item ? "Editar forma de pagamento" : "Nova forma de pagamento",
    };
    $("cfgCatalogModalTitle").textContent = titles[kind] || (item ? "Editar" : "Novo");
    $("cfgCatalogFormSubmit").textContent = "Guardar";
    $("cfgCatalogFormError").hidden = true;
    openCfgModal("cfgCatalogModal");
  }

  async function submitCatalogForm(e) {
    e.preventDefault();
    const err = $("cfgCatalogFormError");
    err.hidden = true;
    const kind = $("cfgCatalogKind").value;
    const id = $("cfgCatalogId").value.trim();
    const label = $("cfgCatalogLabel").value.trim();
    const key = $("cfgCatalogKey").value.trim();
    const description = $("cfgCatalogDescription").value.trim();
    const active = $("cfgCatalogActive").checked;
    if (!label) {
      err.textContent = "Indique o nome.";
      err.hidden = false;
      return;
    }
    const btn = $("cfgCatalogFormSubmit");
    btn.disabled = true;
    try {
      const body = { label, description: description || null, active };
      if (key && !$("cfgCatalogKey").disabled) body.key = key;
      if (id) {
        await api(`/api/settings/catalog/${kind}/${id}`, { method: "PUT", body: JSON.stringify(body) });
        notify("Item atualizado", "success");
      } else {
        await api(`/api/settings/catalog/${kind}`, { method: "POST", body: JSON.stringify(body) });
        notify("Item criado", "success");
      }
      closeCfgModal("cfgCatalogModal");
      if (kind === "service_category") await loadCatalogKind("service_category", "cfgCatsBody", "cfgCatAddBtn");
      else if (kind === "customer_type") await loadCatalogKind("customer_type", "cfgCustTypesBody", "cfgCustTypeAddBtn");
      else if (kind === "payroll_payment_method") await loadCatalogKind("payroll_payment_method", "cfgPayMethodsBody", "cfgPayMethodAddBtn");
      else await loadCatalogKind("unit", "cfgUnitsBody", "cfgUnitAddBtn");
    } catch (ex) {
      err.textContent = ex.message || "Erro ao guardar.";
      err.hidden = false;
    } finally {
      btn.disabled = false;
    }
  }

  async function deleteCatalogItem(kind, id) {
    if (!canManageCatalogLocal()) return;
    const item = (catalogState[kind] || []).find((x) => x.id === id);
    if (!item) return;
    const hardDelete = !item.is_system || kind === "payroll_payment_method";
    const msg = hardDelete
      ? `Remover “${item.label}”?`
      : `Desativar “${item.label}”? (itens padrão não são apagados)`;
    if (!window.confirm(msg)) return;
    try {
      await api(`/api/settings/catalog/${kind}/${id}`, { method: "DELETE" });
      notify(hardDelete ? "Item removido" : "Item desativado", "success");
      if (kind === "service_category") await loadCatalogKind("service_category", "cfgCatsBody", "cfgCatAddBtn");
      else if (kind === "customer_type") await loadCatalogKind("customer_type", "cfgCustTypesBody", "cfgCustTypeAddBtn");
      else if (kind === "payroll_payment_method") await loadCatalogKind("payroll_payment_method", "cfgPayMethodsBody", "cfgPayMethodAddBtn");
      else await loadCatalogKind("unit", "cfgUnitsBody", "cfgUnitAddBtn");
    } catch (ex) {
      notify(ex.message || "Não foi possível remover", "error");
    }
  }

  function bindCatalogUi() {
    $("cfgRoleAddBtn")?.addEventListener("click", () => openRoleEditor(null));
    $("cfgRoleForm")?.addEventListener("submit", submitRoleForm);
    $("cfgCatAddBtn")?.addEventListener("click", () => openCatalogEditor("service_category", null));
    $("cfgUnitAddBtn")?.addEventListener("click", () => openCatalogEditor("unit", null));
    $("cfgCustTypeAddBtn")?.addEventListener("click", () => openCatalogEditor("customer_type", null));
    $("cfgPayMethodAddBtn")?.addEventListener("click", () => openCatalogEditor("payroll_payment_method", null));
    $("cfgCatalogForm")?.addEventListener("submit", submitCatalogForm);

    document.addEventListener("click", (e) => {
      const closeId = e.target.closest?.("[data-close]")?.getAttribute("data-close");
      if (closeId === "cfgRoleModal" || closeId === "cfgCatalogModal") {
        closeCfgModal(closeId);
        return;
      }
      const editRole = e.target.closest?.("[data-role-edit]");
      if (editRole) {
        openRoleEditor(editRole.getAttribute("data-role-edit"));
        return;
      }
      const delRole = e.target.closest?.("[data-role-del]");
      if (delRole) {
        deleteRole(delRole.getAttribute("data-role-del"));
        return;
      }
      const editCat = e.target.closest?.("[data-cat-edit]");
      if (editCat) {
        openCatalogEditor(editCat.getAttribute("data-cat-kind"), editCat.getAttribute("data-cat-edit"));
        return;
      }
      const delCat = e.target.closest?.("[data-cat-del]");
      if (delCat) {
        deleteCatalogItem(delCat.getAttribute("data-cat-kind"), delCat.getAttribute("data-cat-del"));
      }
    });
  }

  // ---------------------------------------------------------------- boot
  const loaded = new Set();
  function loadSection(id) {
    if (id === "visao-geral") return loadOverview();
    if (id === "empresa") return loadCompany();
    if (id === "agenda") return loadSchedule();
    if (id === "marca") return loadBrand();
    if (id === "orcamentos") return loadQuotes();
    if (id === "mensagens-orcamento") return loadQuotes();
    if (id === "mensagens-faturas") return loadInvoiceShareMessages();
    if (id === "mensagens-fase") return loadLeadMessages();
    if (id === "automacoes-leads") return loadLeadAutomations();
    if (id === "jobs") return loadJobsSettings();
    if (id === "regras-estimativa") return loadRules();
    if (id === "cargos") return loadRolesSection();
    if (id === "categorias-servico") return loadCatalogKind("service_category", "cfgCatsBody", "cfgCatAddBtn");
    if (id === "unidades") return loadCatalogKind("unit", "cfgUnitsBody", "cfgUnitAddBtn");
    if (id === "tipos-cliente") return loadCatalogKind("customer_type", "cfgCustTypesBody", "cfgCustTypeAddBtn");
    if (id === "folha") return loadFolhaSettings();
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
    bindLeadMessagesUi();
    bindLeadAutomationsUi();
    bindJobsSettingsUi();
    bindFolhaSettingsUi();
    bindInvoiceShareMessagesUi();
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
      if (e.key === "Escape") {
        if (!$("cfgLeaveModal").hidden) closeLeaveModal();
        else if ($("cfgRoleModal") && !$("cfgRoleModal").hidden) closeCfgModal("cfgRoleModal");
        else if ($("cfgCatalogModal") && !$("cfgCatalogModal").hidden) closeCfgModal("cfgCatalogModal");
      }
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
      const sub = state.sub && state.sub !== "inicio" ? findSub(state.sub) : null;
      const target = sub ? `#a-${sub.area.id}` : "";
      if (dirtySection()) {
        state.pendingHash = target;
        openLeaveModal();
        return;
      }
      if (target) location.hash = target;
      else {
        history.pushState(null, "", location.pathname + location.search);
        show("");
      }
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
      if (!state.sub && isDesktop()) show("inicio");
    });
  }

  async function boot() {
    buildSelects();
    bindShell();
    bindCatalogUi();
    bindSearch();
    bindCompany();
    bindBrand();
    bindSupport();
    bindQuotes();
    bindRules();
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
