/**
 * Mate tours — step-by-step tutorials of each module, with the Mate as the guide.
 * A coach card walks the user through the real screen and highlights each part.
 * Survives page loads (sessionStorage), so a tour can open the module it teaches.
 *
 *   window.MateTour.start("leads")   window.MateTour.list()   window.MateTour.stop()
 */
(function () {
  "use strict";

  var KEY = "om_mate_tour_v1";
  var DONE_KEY = "om_mate_tour_done_v1";
  var FACE = "/assets/img/mascot/mate-head-neutral.webp?v=20261027-m2";
  var CHEER = "/assets/img/mascot/mate-celebrate.webp?v=20261027-m2";

  // step: [selector | null, pt title, pt text, en title, en text]
  var TOURS = [
    {
      id: "home", href: "/dashboard", match: ["dashboard", "pipeline-lab.html"], minutes: 2,
      title: { pt: "Início", en: "Home" },
      blurb: { pt: "O resumo do dia e o que precisa de você.", en: "Your day at a glance and what needs you." },
      steps: [
        [null, "Oi! Eu sou o Mate", "Vou te mostrar o Início em 1 minuto. Aqui você vê o dia inteiro sem abrir nada.", "Hi! I'm Mate", "Let me show you Home in a minute. You see your whole day without opening anything."],
        ["#omdKpis", "Os números do mês", "Pipeline aberto, fechado no mês, a receber e lucro. Toque em um bloco para ver os detalhes.", "This month's numbers", "Open pipeline, closed this month, receivables and profit. Tap a tile for details."],
        ["#omdAttnCard", "Precisa da sua atenção", "Leads sem contato, follow-ups, orçamentos e faturas vencidas. Resolva daqui mesmo.", "Needs your attention", "Leads with no contact, follow-ups, quotes and overdue invoices. Act right here."],
        ["#omdTodayCard", "Hoje", "As visitas e instalações do dia, na linha do tempo.", "Today", "Today's visits and installs on a timeline."],
        ["#omdActions", "Atalhos", "Novo lead, agendar visita e novo orçamento em um toque.", "Shortcuts", "New lead, schedule a visit and new quote in one tap."],
      ],
    },
    {
      id: "leads", href: "leads.html", match: ["leads.html"], minutes: 2,
      title: { pt: "Leads", en: "Leads" },
      blurb: { pt: "Cadastrar, acompanhar e mover oportunidades.", en: "Add, track and move opportunities." },
      steps: [
        [null, "Leads", "Todo cliente começa aqui. Vou te mostrar como cadastrar e acompanhar.", "Leads", "Every customer starts here. I'll show you how to add and track them."],
        ["#btnNewLead", "Novo lead", "Cadastre nome, telefone e de onde veio. Leva 20 segundos.", "New lead", "Add name, phone and source. Takes 20 seconds."],
        ["#lbStages", "Etapas do funil", "Cada coluna é uma etapa: novo, contatado, visita, orçamento… Arraste o lead conforme avança.", "Pipeline stages", "Each column is a stage: new, contacted, visit, quote… Drag the lead as it moves."],
        ["#leadsListSearchInput", "Buscar", "Ache qualquer lead por nome, telefone ou e-mail.", "Search", "Find any lead by name, phone or email."],
        ["#leadsKanbanViewToggle", "Lista ou quadro", "Troque entre a lista e o quadro do funil.", "List or board", "Switch between the list and the pipeline board."],
      ],
    },
    {
      id: "schedule", href: "schedule.html", match: ["schedule.html"], minutes: 2,
      title: { pt: "Agenda", en: "Calendar" },
      blurb: { pt: "Visitas, instalações e compromissos da equipe.", en: "Visits, installs and team appointments." },
      steps: [
        [null, "Agenda", "Aqui fica tudo que tem hora marcada: visitas de medição, instalações e reuniões.", "Calendar", "Everything with a time lives here: measure visits, installs and meetings."],
        [".ag-new", "Novo compromisso", "Marque uma visita ou instalação. O cliente pode receber confirmação automática.", "New appointment", "Book a visit or install. The client can get an automatic confirmation."],
        [".ag-seg", "Dia, semana, mês", "Escolha como quer ver a agenda.", "Day, week, month", "Pick how you want to see the calendar."],
        ["#agStage", "O calendário", "Toque em um horário vazio para marcar, ou em um evento para abrir.", "The calendar", "Tap an empty slot to book, or an event to open it."],
        ["#agRailRight", "Painel do dia", "O resumo do dia escolhido, com endereços e horários.", "Day panel", "The chosen day's summary with addresses and times."],
      ],
    },
    {
      id: "customers", href: "customers.html", match: ["customers.html"], minutes: 1,
      title: { pt: "Clientes", en: "Clients" },
      blurb: { pt: "Particulares e builders, com todo o histórico.", en: "Homeowners and builders with full history." },
      steps: [
        [null, "Clientes", "Cada cliente guarda orçamentos, jobs, faturas e conversas num lugar só.", "Clients", "Each client keeps quotes, jobs, invoices and messages in one place."],
        ["#cxNewBtn", "Novo cliente", "Cadastre um particular ou um builder.", "New client", "Add a homeowner or a builder."],
        ["#cxSearch", "Buscar", "Nome, telefone, e-mail ou endereço.", "Search", "Name, phone, email or address."],
        ["#cxChips", "Tipo de cliente", "Filtre por particulares ou builders.", "Client type", "Filter homeowners or builders."],
        ["#cxRows", "A lista", "Abra um cliente para ver o histórico completo ao lado.", "The list", "Open a client to see the full history beside it."],
      ],
    },
    {
      id: "quotes", href: "quotes.html", match: ["quotes.html"], minutes: 2,
      title: { pt: "Orçamentos", en: "Quotes" },
      blurb: { pt: "Montar, enviar e acompanhar assinaturas.", en: "Build, send and track signatures." },
      steps: [
        [null, "Orçamentos", "Aqui você monta a proposta, envia o link e vê quando o cliente abre e assina.", "Quotes", "Build the proposal, send the link and see when the client opens and signs."],
        [".qs-btn--pri", "Novo orçamento", "Monte com os serviços da sua Tabela de Valor.", "New quote", "Build it from your Price table services."],
        ["#qsTiles", "Por status", "Rascunho, enviado, visto, aprovado. Toque para filtrar.", "By status", "Draft, sent, viewed, approved. Tap to filter."],
        ["#filterQ", "Buscar", "Cliente, número ou endereço.", "Search", "Client, number or address."],
        ["#qsRows", "Acompanhe", "Abra um orçamento para reenviar, ver quem abriu ou criar o job.", "Follow up", "Open a quote to resend, see views or create the job."],
      ],
    },
    {
      id: "jobs", href: "jobs.html", match: ["jobs.html"], minutes: 2,
      title: { pt: "Jobs", en: "Jobs" },
      blurb: { pt: "Obras, equipes, datas e custos.", en: "Jobs, crews, dates and costs." },
      steps: [
        [null, "Jobs", "Depois do orçamento aprovado, a obra vira um job. Aqui você acompanha tudo.", "Jobs", "Once a quote is approved it becomes a job. Track everything here."],
        ["#btnNewJob", "Novo job", "Crie direto ou a partir do orçamento aprovado.", "New job", "Create it directly or from the approved quote."],
        ["#jxTiles", "Por etapa", "Agendado, em campo, concluído… Toque para filtrar.", "By stage", "Scheduled, in the field, done… Tap to filter."],
        ["#jxWeekStrip", "Por semana", "Use as setas para ver outra semana.", "By week", "Use the arrows to see another week."],
        ["#jxRows", "Detalhes", "Abra um job para escolher a equipe, ver fotos e faturar.", "Details", "Open a job to pick the crew, see photos and invoice."],
      ],
    },
    {
      id: "invoices", href: "invoices.html", match: ["invoices.html"], minutes: 1,
      title: { pt: "Faturas", en: "Invoices" },
      blurb: { pt: "Cobrar e receber.", en: "Bill and get paid." },
      steps: [
        [null, "Faturas", "Cobre o cliente com um link de pagamento e acompanhe o que está em aberto.", "Invoices", "Bill with a payment link and track what's open."],
        ["#ixTiles", "Por status", "Em aberto, vencidas, pagas. Toque para filtrar.", "By status", "Open, overdue, paid. Tap to filter."],
        ["#filterQ", "Buscar", "Fatura, cliente ou job.", "Search", "Invoice, client or job."],
        ["#invRows", "A lista", "Abra uma fatura para reenviar, registrar pagamento ou baixar o PDF.", "The list", "Open an invoice to resend, record a payment or download the PDF."],
      ],
    },
    {
      id: "obracam", href: "job-media-board.html", match: ["job-media-board.html"], minutes: 1,
      title: { pt: "ObraCam", en: "ObraCam" },
      blurb: { pt: "Fotos de antes, durante e depois.", en: "Before, during and after photos." },
      steps: [
        [null, "ObraCam", "As fotos que a equipe tira na obra chegam aqui, organizadas por job.", "ObraCam", "Photos the crew takes on site land here, organized by job."],
        ["#camViews", "Jobs ou fotos", "Veja por job ou todas as fotos juntas.", "Jobs or photos", "View by job or all photos together."],
        ["#camQ", "Buscar", "Job, endereço ou quem tirou a foto.", "Search", "Job, address or who took the photo."],
        ["#camMode", "Ativos ou concluídos", "Alterne entre obras em andamento e entregues.", "Active or done", "Switch between ongoing and delivered jobs."],
        ["#camRows", "Abrir um job", "Toque para ver as fotos e compartilhar com o cliente.", "Open a job", "Tap to see photos and share with the client."],
      ],
    },
    {
      id: "chat", href: "chat.html", match: ["chat.html"], minutes: 1,
      title: { pt: "ObraChat", en: "ObraChat" },
      blurb: { pt: "Conversas da equipe, por job ou diretas.", en: "Team chat by job or direct." },
      steps: [
        [null, "ObraChat", "O chat da equipe. Cada job tem sua conversa, e você pode falar direto com alguém.", "ObraChat", "Team chat. Each job has its own thread, and you can message anyone directly."],
        [".chat-list-tabs", "Filtros", "Todas, não lidas, jobs, grupos e diretas.", "Filters", "All, unread, jobs, groups and direct."],
        ["#chatNewDmBtn", "Nova conversa", "Fale direto com alguém da equipe.", "New chat", "Message a teammate directly."],
        ["#chatNewGroupBtn", "Novo grupo", "Junte várias pessoas numa conversa.", "New group", "Put several people in one thread."],
        ["#chatMentionsBtn", "Menções", "Onde alguém te marcou com @.", "Mentions", "Where someone tagged you with @."],
      ],
    },
    {
      id: "payroll", href: "folha.html", match: ["folha.html"], minutes: 2,
      title: { pt: "Folha", en: "Payroll" },
      blurb: { pt: "Horas da equipe, conferência e pagamentos.", en: "Crew hours, review and payments." },
      steps: [
        [null, "Folha", "As horas que a equipe registra no app de campo viram a folha da semana.", "Payroll", "Hours the crew logs in the field app become the week's payroll."],
        ['[data-tab="semana"]', "Semana", "O resumo da semana: horas e valor por pessoa.", "Week", "The week's summary: hours and amount per person."],
        ['[data-tab="conferir"]', "Conferir", "Revise e aprove as horas antes de pagar.", "Review", "Review and approve hours before paying."],
        ['[data-tab="pagamentos"]', "Pagamentos", "Registre o pagamento e a equipe recebe o aviso.", "Payments", "Record the payment and the crew gets notified."],
        ['[data-tab="funcionarios"]', "Funcionários", "Valor por hora e dados de cada pessoa.", "Workers", "Hourly rate and details for each person."],
      ],
    },
    {
      id: "finance", href: "finance.html", match: ["finance.html"], minutes: 2,
      title: { pt: "Fluxo", en: "Cash flow" },
      blurb: { pt: "Entradas, saídas e recibos.", en: "Money in, money out and receipts." },
      steps: [
        [null, "Fluxo de caixa", "Tudo que entra e sai da empresa, com os recibos.", "Cash flow", "Everything coming in and going out, with receipts."],
        ["#fxScanBtn", "Escanear recibo", "Tire foto do recibo e eu preencho o custo pra você.", "Scan a receipt", "Snap the receipt and I'll fill in the cost for you."],
        ["#fxNewBtn", "Novo custo", "Lance um custo à mão.", "New cost", "Add a cost by hand."],
        ["#fxRange", "Período", "Mês, 30 dias, ano ou datas.", "Period", "Month, 30 days, year or dates."],
        ["#fxSeg", "Filtro", "Entradas, saídas ou o que precisa revisar.", "Filter", "In, out or what needs review."],
      ],
    },
    {
      id: "pricing", href: "builder-pricing-admin.html", match: ["builder-pricing-admin.html"], minutes: 2,
      title: { pt: "Tabela de Valor", en: "Price table" },
      blurb: { pt: "Seus serviços e preços para orçar rápido.", en: "Your services and prices for fast quotes." },
      steps: [
        [null, "Tabela de Valor", "Cadastre seus serviços uma vez e monte orçamentos em segundos.", "Price table", "Set up your services once and build quotes in seconds."],
        ["#tvSeedBtn", "Catálogo", "Comece com um catálogo pronto de serviços de piso.", "Catalog", "Start from a ready-made flooring catalog."],
        ["#tvNewBtn", "Novo serviço", "Adicione um serviço com unidade e preço.", "New service", "Add a service with unit and price."],
        ["#tvSeg", "Categorias", "Filtre por tipo de serviço.", "Categories", "Filter by service type."],
        ["#tvRows", "Editar", "Toque em um serviço para mudar o preço.", "Edit", "Tap a service to change the price."],
      ],
    },
    {
      id: "reports", href: "relatorios.html", match: ["relatorios.html"], minutes: 1,
      title: { pt: "Relatórios", en: "Reports" },
      blurb: { pt: "Vendas, operação, dinheiro e lucro.", en: "Sales, operations, money and profit." },
      steps: [
        [null, "Relatórios", "Os números da empresa em gráficos simples.", "Reports", "Your company's numbers in simple charts."],
        ["#rxPresets", "Período", "30 dias, 90 dias, mês ou ano.", "Period", "30 days, 90 days, month or year."],
        ["#rptTabs", "Assuntos", "Resumo, vendas, operação, dinheiro, equipe e lucro.", "Topics", "Summary, sales, operations, money, team and profit."],
        ["#rxExport", "Exportar", "Baixe em planilha ou PDF.", "Export", "Download as a spreadsheet or PDF."],
      ],
    },
    {
      id: "team", href: "configuracoes.html#usuarios", match: ["configuracoes.html"], minutes: 1,
      title: { pt: "Equipe", en: "Team" },
      blurb: { pt: "Convidar pessoas e definir acessos.", en: "Invite people and set access." },
      steps: [
        [null, "Sua equipe", "Convide o escritório e a equipe de campo, cada um com o acesso certo.", "Your team", "Invite the office and field crew, each with the right access."],
        ["#cfgUserAddBtn", "Novo usuário", "Mande o convite por e-mail ou telefone.", "New user", "Send the invite by email or phone."],
        ["#cfgUsersSearch", "Buscar", "Ache alguém por nome, e-mail ou telefone.", "Search", "Find someone by name, email or phone."],
        ["#cfgUsersTable", "Acessos", "Abra uma pessoa para mudar o cargo ou desativar.", "Access", "Open someone to change their role or deactivate."],
      ],
    },
    {
      id: "settings", href: "configuracoes.html", match: ["configuracoes.html"], minutes: 1,
      title: { pt: "Configurações", en: "Settings" },
      blurb: { pt: "Empresa, marca, mensagens e integrações.", en: "Company, brand, messages and integrations." },
      steps: [
        [null, "Configurações", "Deixe o ObraMate com a cara da sua empresa.", "Settings", "Make ObraMate look like your company."],
        ["#cfgSetup", "Primeiros passos", "O que falta para deixar tudo pronto.", "Setup", "What's left to get fully set up."],
        ["#cfgSearch", "Buscar", "Ache qualquer configuração pelo nome.", "Search", "Find any setting by name."],
        ["#cfgNavGroups", "Seções", "Empresa, marca, orçamentos, faturas, agenda, equipe…", "Sections", "Company, brand, quotes, invoices, calendar, team…"],
      ],
    },
  ];

  function locale() {
    var c = window.CrmHelpContent;
    var l = c && typeof c.locale === "function" ? c.locale() : document.documentElement.lang || "pt";
    return String(l).slice(0, 2) === "en" ? "en" : "pt";
  }

  function pickText(obj) {
    return obj[locale()] || obj.pt;
  }

  function byId(id) {
    for (var i = 0; i < TOURS.length; i++) if (TOURS[i].id === id) return TOURS[i];
    return null;
  }

  function stepText(step) {
    var en = locale() === "en";
    return { title: en ? step[3] : step[1], text: en ? step[4] : step[2], target: step[0] };
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function reduced() {
    return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  function onTourPage(tour) {
    var path = location.pathname.replace(/^\//, "") || "dashboard";
    return tour.match.some(function (m) {
      return path === m || path.endsWith("/" + m);
    });
  }

  function save(st) {
    try {
      if (st) sessionStorage.setItem(KEY, JSON.stringify(st));
      else sessionStorage.removeItem(KEY);
    } catch (_) {}
  }

  function load() {
    try {
      return JSON.parse(sessionStorage.getItem(KEY) || "null");
    } catch (_) {
      return null;
    }
  }

  function doneMap() {
    try {
      return JSON.parse(localStorage.getItem(DONE_KEY) || "{}") || {};
    } catch (_) {
      return {};
    }
  }

  function markDone(id) {
    var m = doneMap();
    m[id] = Date.now();
    try {
      localStorage.setItem(DONE_KEY, JSON.stringify(m));
    } catch (_) {}
  }

  /* ---------- DOM ---------- */

  var root, spot, card, cur, raf, pollTimer, targetEl;

  function ensureDom() {
    if (root) return;
    root = document.createElement("div");
    root.className = "om-tour";
    root.innerHTML =
      '<div class="om-tour__spot" aria-hidden="true"></div>' +
      '<section class="om-tour__card" role="dialog" aria-live="polite" aria-labelledby="omTourTitle"></section>';
    document.body.appendChild(root);
    spot = root.querySelector(".om-tour__spot");
    card = root.querySelector(".om-tour__card");
    card.addEventListener("click", function (e) {
      var b = e.target.closest("[data-tour]");
      if (!b) return;
      var act = b.getAttribute("data-tour");
      if (act === "next") next();
      else if (act === "back") back();
      else if (act === "close") stop();
      else if (act === "more") {
        stop();
        if (window.__crmHelpPanel) window.__crmHelpPanel.open({ tab: "tutorials" });
      }
    });
  }

  function visible(el) {
    if (!el || !el.isConnected) return false;
    var r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) return false;
    var cs = getComputedStyle(el);
    return cs.visibility !== "hidden" && cs.display !== "none";
  }

  function findTarget(sel, cb) {
    clearInterval(pollTimer);
    if (!sel) return cb(null);
    var tries = 0;
    var el = document.querySelector(sel);
    if (visible(el)) return cb(el);
    // Lists and tiles are drawn after data loads: wait a little before giving up.
    pollTimer = setInterval(function () {
      tries++;
      el = document.querySelector(sel);
      if (visible(el) || tries > 26) {
        clearInterval(pollTimer);
        cb(visible(el) ? el : null);
      }
    }, 150);
  }

  function place() {
    if (!root || !cur) return;
    var vw = window.innerWidth;
    var vh = window.innerHeight;
    var cw = card.offsetWidth;
    var ch = card.offsetHeight;
    if (!targetEl || !targetEl.isConnected) {
      root.classList.remove("has-target");
      card.style.left = Math.max(12, (vw - cw) / 2) + "px";
      card.style.top = Math.max(12, (vh - ch) / 2) + "px";
      return;
    }
    root.classList.add("has-target");
    var r = targetEl.getBoundingClientRect();
    var pad = 6;
    var x = Math.max(4, r.left - pad);
    var y = Math.max(4, r.top - pad);
    var w = Math.min(vw - 8, r.width + pad * 2);
    var h = Math.min(vh - 8, r.height + pad * 2);
    spot.style.transform = "translate(" + x + "px," + y + "px)";
    spot.style.width = w + "px";
    spot.style.height = h + "px";
    // Card below the target if it fits, else above, else beside; always inside the screen.
    var gap = 14;
    var top = y + h + gap;
    if (top + ch > vh - 12) top = y - ch - gap;
    if (top < 12) top = Math.min(vh - ch - 12, Math.max(12, y + h / 2 - ch / 2));
    var left = Math.min(vw - cw - 12, Math.max(12, x + w / 2 - cw / 2));
    if (top < y + h && top + ch > y && w < vw - cw - 40) {
      left = x + w + gap + cw < vw - 12 ? x + w + gap : Math.max(12, x - cw - gap);
    }
    card.style.left = left + "px";
    card.style.top = top + "px";
  }

  function loop() {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(function () {
      place();
    });
  }

  function renderCard(tour, i) {
    var s = stepText(tour.steps[i]);
    var n = tour.steps.length;
    var last = i === n - 1;
    var en = locale() === "en";
    var dots = "";
    for (var k = 0; k < n; k++) dots += '<i class="' + (k === i ? "is-on" : k < i ? "is-past" : "") + '"></i>';
    card.innerHTML =
      '<header class="om-tour__head">' +
      '<span class="om-tour__face" aria-hidden="true"><img src="' + FACE + '" alt="" width="36" height="36"></span>' +
      '<span class="om-tour__kicker">' + esc(pickText(tour.title)) + " · " + (en ? "Step " : "Passo ") + (i + 1) + (en ? " of " : " de ") + n + "</span>" +
      '<button type="button" class="om-tour__x" data-tour="close" aria-label="' + (en ? "Close tour" : "Fechar tutorial") + '"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12"/></svg></button>' +
      "</header>" +
      '<h3 class="om-tour__title" id="omTourTitle">' + esc(s.title) + "</h3>" +
      '<p class="om-tour__text">' + esc(s.text) + "</p>" +
      '<footer class="om-tour__foot">' +
      '<span class="om-tour__dots" aria-hidden="true">' + dots + "</span>" +
      (i > 0 ? '<button type="button" class="om-tour__btn om-tour__btn--ghost" data-tour="back">' + (en ? "Back" : "Voltar") + "</button>" : "") +
      '<button type="button" class="om-tour__btn" data-tour="next">' + (last ? (en ? "Done" : "Concluir") : en ? "Next" : "Próximo") + "</button>" +
      "</footer>";
    card.classList.remove("is-in");
    void card.offsetWidth;
    card.classList.add("is-in");
  }

  function renderDone(tour) {
    var en = locale() === "en";
    root.classList.remove("has-target");
    targetEl = null;
    card.innerHTML =
      '<div class="om-tour__done">' +
      '<img src="' + CHEER + '" alt="" width="96" height="88">' +
      '<h3 class="om-tour__title" id="omTourTitle">' + (en ? "You've got it!" : "Pronto, você já sabe!") + "</h3>" +
      '<p class="om-tour__text">' + esc((en ? "That's " : "Esse foi o ") + pickText(tour.title) + (en ? ". Want to learn another module?" : ". Quer aprender outro módulo?")) + "</p>" +
      '<footer class="om-tour__foot om-tour__foot--center">' +
      '<button type="button" class="om-tour__btn om-tour__btn--ghost" data-tour="close">' + (en ? "Close" : "Fechar") + "</button>" +
      '<button type="button" class="om-tour__btn" data-tour="more">' + (en ? "More tutorials" : "Outros tutoriais") + "</button>" +
      "</footer></div>";
    card.classList.remove("is-in");
    void card.offsetWidth;
    card.classList.add("is-in");
    place();
  }

  function show(i) {
    var tour = byId(cur.id);
    if (!tour) return stop();
    cur.step = i;
    save(cur);
    if (!onTourPage(tour)) {
      location.href = tour.href;
      return;
    }
    var hash = tour.href.indexOf("#") >= 0 ? tour.href.slice(tour.href.indexOf("#")) : "";
    if (hash && location.hash !== hash) location.hash = hash;
    ensureDom();
    root.hidden = false;
    document.body.classList.add("om-tour-on");
    renderCard(tour, i);
    targetEl = null;
    place();
    findTarget(stepText(tour.steps[i]).target, function (el) {
      if (!cur || cur.step !== i) return;
      targetEl = el;
      if (el) {
        var r = el.getBoundingClientRect();
        if (r.top < 70 || r.bottom > window.innerHeight - 90) {
          el.scrollIntoView({ block: "center", behavior: reduced() ? "auto" : "smooth" });
        }
      }
      place();
      var btn = card.querySelector('[data-tour="next"]');
      if (btn) btn.focus({ preventScroll: true });
    });
  }

  function next() {
    var tour = cur && byId(cur.id);
    if (!tour) return stop();
    if (cur.step >= tour.steps.length - 1) {
      markDone(tour.id);
      save(null);
      cur = { id: tour.id, step: tour.steps.length, done: true };
      renderDone(tour);
      return;
    }
    show(cur.step + 1);
  }

  function back() {
    if (cur && cur.step > 0) show(cur.step - 1);
  }

  function stop() {
    clearInterval(pollTimer);
    save(null);
    cur = null;
    targetEl = null;
    if (root) root.hidden = true;
    document.body.classList.remove("om-tour-on");
  }

  function start(id) {
    var tour = byId(id);
    if (!tour) return false;
    if (window.__crmHelpPanel && window.__crmHelpPanel.isOpen && window.__crmHelpPanel.isOpen()) window.__crmHelpPanel.close();
    cur = { id: id, step: 0 };
    show(0);
    return true;
  }

  window.addEventListener("resize", loop);
  window.addEventListener("scroll", loop, true);
  document.addEventListener("keydown", function (e) {
    if (!cur || !root || root.hidden) return;
    if (e.key === "Escape") stop();
    else if (e.key === "ArrowRight" && !cur.done) next();
    else if (e.key === "ArrowLeft" && !cur.done) back();
  });

  function resume() {
    var st = load();
    if (!st || !byId(st.id)) return;
    cur = st;
    // Let the page draw its lists before pointing at them.
    setTimeout(function () {
      show(st.step || 0);
    }, 350);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", resume);
  else resume();

  window.MateTour = {
    start: start,
    stop: stop,
    list: function () {
      var done = doneMap();
      return TOURS.map(function (t) {
        return { id: t.id, href: t.href, minutes: t.minutes, steps: t.steps.length, title: pickText(t.title), blurb: pickText(t.blurb), done: !!done[t.id] };
      });
    },
    byId: function (id) {
      var t = byId(id);
      return t ? { id: t.id, title: pickText(t.title), blurb: pickText(t.blurb), minutes: t.minutes, steps: t.steps.length } : null;
    },
    forPage: function () {
      var hit = TOURS.filter(onTourPage);
      if (!hit.length) return null;
      // Same page, several tours (Configurações / Equipe): the one whose #hash is open wins.
      var withHash = hit.filter(function (t) {
        return location.hash && t.href.indexOf(location.hash) >= 0;
      });
      return (withHash[0] || hit.filter(function (t) { return t.href.indexOf("#") < 0; })[0] || hit[0]).id;
    },
  };
})();
