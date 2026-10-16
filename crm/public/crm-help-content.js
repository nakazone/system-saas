/**
 * Structured Help Center content (problems, tutorials, modules).
 * Locale packs: pt (default), en. ES falls back to pt.
 */
(function () {
  var MODULES = [
    {
      id: "home",
      href: "home.html",
      icon: "home",
      title: { pt: "Início", en: "Home" },
      blurb: {
        pt: "Visão geral do dia e atalhos para o que importa agora.",
        en: "Daily overview and shortcuts to what matters now.",
      },
    },
    {
      id: "schedule",
      href: "schedule.html",
      icon: "cal",
      title: { pt: "Agenda", en: "Calendar" },
      blurb: {
        pt: "Visitas, compromissos e o calendário da equipe.",
        en: "Visits, appointments, and your team calendar.",
      },
    },
    {
      id: "leads",
      href: "leads.html",
      icon: "leads",
      title: { pt: "Leads", en: "Leads" },
      blurb: {
        pt: "Pipeline de oportunidades, follow-ups e novos contatos.",
        en: "Opportunity pipeline, follow-ups, and new contacts.",
      },
    },
    {
      id: "customers",
      href: "customers.html",
      icon: "clients",
      title: { pt: "Clientes", en: "Clients" },
      blurb: {
        pt: "Cadastro de particulares e builders com histórico.",
        en: "Homeowners and builders with full history.",
      },
    },
    {
      id: "quotes",
      href: "quotes.html",
      icon: "quotes",
      title: { pt: "Orçamentos", en: "Quotes" },
      blurb: {
        pt: "Montar, enviar e acompanhar propostas e assinaturas.",
        en: "Build, send, and track proposals and signatures.",
      },
    },
    {
      id: "jobs",
      href: "jobs.html",
      icon: "jobs",
      title: { pt: "Obras", en: "Jobs" },
      blurb: {
        pt: "Obras em andamento, equipes, custos e status.",
        en: "Active jobs, crews, costs, and status.",
      },
    },
    {
      id: "invoices",
      href: "invoices.html",
      icon: "invoice",
      title: { pt: "Faturas", en: "Invoices" },
      blurb: {
        pt: "Cobranças, pagamentos e histórico financeiro por obra.",
        en: "Billing, payments, and job financial history.",
      },
    },
    {
      id: "obracam",
      href: "job-media-board.html",
      icon: "cam",
      title: { pt: "ObraCam", en: "ObraCam" },
      blurb: {
        pt: "Fotos e mídia das obras em um só lugar.",
        en: "Job photos and media in one place.",
      },
    },
    {
      id: "chat",
      href: "chat.html",
      icon: "chat",
      title: { pt: "ObraChat", en: "ObraChat" },
      blurb: {
        pt: "Conversas internas da equipe sobre obras e leads.",
        en: "Internal team chat about jobs and leads.",
      },
    },
    {
      id: "payroll",
      href: "folha.html",
      icon: "pay",
      title: { pt: "Folha", en: "Payroll" },
      blurb: {
        pt: "Horas, conferência e pagamento da equipe de campo.",
        en: "Hours, review, and field crew pay.",
      },
    },
    {
      id: "finance",
      href: "finance.html",
      icon: "finance",
      title: { pt: "Financeiro", en: "Finance" },
      blurb: {
        pt: "Fluxo de caixa, entradas e saídas da empresa.",
        en: "Cash flow, income, and expenses.",
      },
    },
    {
      id: "pricing",
      href: "builder-pricing-admin.html",
      icon: "price",
      title: { pt: "Tabela de Valor", en: "Price table" },
      blurb: {
        pt: "Preços e serviços usados nos orçamentos.",
        en: "Prices and services used in quotes.",
      },
    },
    {
      id: "reports",
      href: "relatorios.html",
      icon: "report",
      title: { pt: "Relatórios", en: "Reports" },
      blurb: {
        pt: "Indicadores de vendas, obras e financeiro.",
        en: "Sales, jobs, and finance indicators.",
      },
    },
    {
      id: "team",
      href: "equipe.html",
      icon: "team",
      title: { pt: "Equipe", en: "Team" },
      blurb: {
        pt: "Convites, papéis e acesso dos colaboradores.",
        en: "Invites, roles, and teammate access.",
      },
    },
    {
      id: "settings",
      href: "configuracoes.html",
      icon: "gear",
      title: { pt: "Configurações", en: "Settings" },
      blurb: {
        pt: "Empresa, marca, mensagens e preferências.",
        en: "Company, branding, messages, and preferences.",
      },
    },
  ];

  var PROBLEMS = [
    {
      id: "new-lead",
      tags: ["lead", "pipeline", "contato", "oportunidade", "novo"],
      title: { pt: "Quero cadastrar ou acompanhar um lead", en: "I need to add or track a lead" },
      moduleId: "leads",
      steps: {
        pt: [
          "Abra Leads no menu lateral.",
          "Use Novo lead (ou o atalho de criação) e preencha o contato.",
          "Arraste o card no pipeline conforme o status avança.",
          "Agende visitas e follow-ups pela Agenda ou pelo próprio lead.",
        ],
        en: [
          "Open Leads in the sidebar.",
          "Use New lead (or the create shortcut) and fill in the contact.",
          "Move the card on the pipeline as status changes.",
          "Schedule visits and follow-ups from Calendar or the lead itself.",
        ],
      },
    },
    {
      id: "send-quote",
      tags: ["orçamento", "quote", "proposta", "pdf", "enviar", "assinatura"],
      title: { pt: "Preciso montar ou enviar um orçamento", en: "I need to build or send a quote" },
      moduleId: "quotes",
      steps: {
        pt: [
          "Em Orçamentos, abra um rascunho ou crie a partir do lead.",
          "Adicione itens pela Tabela de Valor e ajuste quantidades.",
          "Revise o PDF e envie o link seguro ao cliente.",
          "Acompanhe visualização e assinatura na lista de orçamentos.",
        ],
        en: [
          "In Quotes, open a draft or create one from the lead.",
          "Add line items from the Price table and adjust quantities.",
          "Review the PDF and send the secure link to the client.",
          "Track views and signatures on the quotes list.",
        ],
      },
    },
    {
      id: "quote-not-received",
      tags: ["email", "sms", "não recebeu", "link", "orçamento"],
      title: { pt: "O cliente não recebeu o orçamento", en: "The client did not get the quote" },
      moduleId: "quotes",
      href: "quotes.html",
      steps: {
        pt: [
          "Confirme o e-mail ou telefone no cadastro do cliente.",
          "Reabra o orçamento e reenvie o link (ou copie o link manualmente).",
          "Verifique mensagens e remetente em Configurações › Mensagens.",
          "Se o problema continuar, abra um ticket em Ajuda e suporte.",
        ],
        en: [
          "Confirm the email or phone on the client record.",
          "Reopen the quote and resend the link (or copy it manually).",
          "Check message templates in Settings › Messages.",
          "If it still fails, open a ticket under Help & support.",
        ],
      },
      extraLinks: [
        { href: "configuracoes.html#mensagens-orcamento", label: { pt: "Mensagens de orçamento", en: "Quote messages" } },
        { href: "#help-support", label: { pt: "Abrir ticket", en: "Open ticket" }, helpTab: "support" },
      ],
    },
    {
      id: "schedule-visit",
      tags: ["agenda", "visita", "calendário", "compromisso"],
      title: { pt: "Quero agendar uma visita ou compromisso", en: "I need to schedule a visit" },
      moduleId: "schedule",
      steps: {
        pt: [
          "Abra a Agenda no menu.",
          "Crie o evento ou agende a partir do lead/obra.",
          "Confirme data, horário e responsável.",
          "Acompanhe o dia em Início ou na própria Agenda.",
        ],
        en: [
          "Open Calendar in the menu.",
          "Create the event or schedule from the lead/job.",
          "Confirm date, time, and owner.",
          "Track the day on Home or in Calendar.",
        ],
      },
    },
    {
      id: "start-job",
      tags: ["obra", "job", "projeto", "iniciar", "produção"],
      title: { pt: "Preciso criar ou acompanhar uma obra", en: "I need to create or manage a job" },
      moduleId: "jobs",
      steps: {
        pt: [
          "Em Obras, veja a lista ou abra a partir de um orçamento aprovado.",
          "Defina equipe, datas e status.",
          "Use ObraCam para fotos e Folha para horas da equipe.",
          "Quando for cobrar, use Faturar na obra ou em Faturas.",
        ],
        en: [
          "In Jobs, open the list or create from an approved quote.",
          "Set crew, dates, and status.",
          "Use ObraCam for photos and Payroll for crew hours.",
          "When billing, use Invoice on the job or in Invoices.",
        ],
      },
    },
    {
      id: "invoice-job",
      tags: ["fatura", "invoice", "cobrar", "pagamento", "faturar"],
      title: { pt: "Quero faturar uma obra ou ver pagamentos", en: "I need to invoice a job or see payments" },
      moduleId: "invoices",
      steps: {
        pt: [
          "Abra a obra e use Faturar, ou vá em Faturas.",
          "Confira itens, valores e período.",
          "Envie a fatura e registre pagamentos recebidos.",
          "Use Financeiro para o fluxo consolidado da empresa.",
        ],
        en: [
          "Open the job and use Invoice, or go to Invoices.",
          "Check line items, amounts, and period.",
          "Send the invoice and record payments.",
          "Use Finance for company-wide cash flow.",
        ],
      },
      extraLinks: [{ href: "finance.html", label: { pt: "Financeiro", en: "Finance" } }],
    },
    {
      id: "payroll",
      tags: ["folha", "horas", "pagamento", "equipe", "campo"],
      title: { pt: "Preciso lançar horas ou fechar a folha", en: "I need hours or payroll" },
      moduleId: "payroll",
      steps: {
        pt: [
          "Abra Folha no menu.",
          "Conferencie horas lançadas pela equipe de campo.",
          "Ajuste valores e feche o período.",
          "Em caso de dúvida do processo, use o guia dentro do módulo.",
        ],
        en: [
          "Open Payroll in the menu.",
          "Review hours logged by the field crew.",
          "Adjust amounts and close the period.",
          "For process details, use the in-module guide.",
        ],
      },
    },
    {
      id: "finance-cash",
      tags: ["financeiro", "caixa", "despesa", "receita", "fluxo"],
      title: { pt: "Quero ver fluxo de caixa ou lançar despesas", en: "I need cash flow or expenses" },
      moduleId: "finance",
      steps: {
        pt: [
          "Abra Financeiro.",
          "Filtre o período e revise entradas e saídas.",
          "Lance despesas manuais quando necessário.",
          "Cruze com Faturas e Relatórios para o panorama completo.",
        ],
        en: [
          "Open Finance.",
          "Filter the period and review income and expenses.",
          "Add manual expenses when needed.",
          "Cross-check Invoices and Reports for the full picture.",
        ],
      },
    },
    {
      id: "price-table",
      tags: ["tabela", "preço", "serviço", "valor", "pricing"],
      title: { pt: "Preciso atualizar preços ou serviços", en: "I need to update prices or services" },
      moduleId: "pricing",
      steps: {
        pt: [
          "Abra Tabela de Valor.",
          "Edite categorias e itens usados nos orçamentos.",
          "Salve e use os itens ao montar a próxima proposta.",
        ],
        en: [
          "Open the Price table.",
          "Edit categories and items used in quotes.",
          "Save and use them on the next proposal.",
        ],
      },
    },
    {
      id: "invite-team",
      tags: ["equipe", "convidar", "usuário", "acesso", "permissão"],
      title: { pt: "Quero convidar alguém da equipe", en: "I need to invite a teammate" },
      moduleId: "team",
      steps: {
        pt: [
          "Abra Equipe (ou Configurações › Equipe).",
          "Envie o convite com o papel correto (escritório ou campo).",
          "Peça para a pessoa aceitar o e-mail e entrar no app.",
        ],
        en: [
          "Open Team (or Settings › Team).",
          "Send the invite with the right role (office or field).",
          "Ask them to accept the email and sign in.",
        ],
      },
      extraLinks: [{ href: "configuracoes.html", label: { pt: "Configurações", en: "Settings" } }],
    },
    {
      id: "branding",
      tags: ["marca", "logo", "pdf", "assinatura", "branding"],
      title: { pt: "Quero ajustar logo, marca ou PDF", en: "I need logo, branding, or PDF setup" },
      moduleId: "settings",
      href: "configuracoes.html#marca",
      steps: {
        pt: [
          "Vá em Configurações › Marca.",
          "Envie o logo e ajuste as cores da empresa.",
          "Revise um orçamento em PDF para validar o resultado.",
        ],
        en: [
          "Go to Settings › Branding.",
          "Upload the logo and set company colors.",
          "Preview a quote PDF to confirm the look.",
        ],
      },
    },
    {
      id: "photos",
      tags: ["foto", "mídia", "obracam", "galeria"],
      title: { pt: "Onde vejo ou envio fotos da obra?", en: "Where do I view or upload job photos?" },
      moduleId: "obracam",
      steps: {
        pt: [
          "Abra ObraCam ou a aba de mídia na obra.",
          "Envie fotos do campo ou do escritório.",
          "Organize por obra para o cliente e a equipe.",
        ],
        en: [
          "Open ObraCam or the media tab on the job.",
          "Upload photos from field or office.",
          "Keep them organized per job for client and team.",
        ],
      },
    },
    {
      id: "reports",
      tags: ["relatório", "indicador", "dashboard", "métrica"],
      title: { pt: "Quero ver relatórios e indicadores", en: "I need reports and metrics" },
      moduleId: "reports",
      steps: {
        pt: [
          "Abra Relatórios no menu.",
          "Escolha o período e o tipo de visão (vendas, obras, financeiro).",
          "Exporte ou compartilhe com a gestão quando precisar.",
        ],
        en: [
          "Open Reports in the menu.",
          "Pick the period and view (sales, jobs, finance).",
          "Export or share with leadership when needed.",
        ],
      },
    },
    {
      id: "bug",
      tags: ["erro", "bug", "travou", "suporte", "ticket"],
      title: { pt: "Algo não está funcionando / preciso de suporte", en: "Something is broken / I need support" },
      moduleId: "settings",
      helpTab: "support",
      steps: {
        pt: [
          "Anote a tela e o que tentou fazer.",
          "Na aba Suporte desta Central, envie um ticket (categoria Bug).",
          "Inclua o máximo de detalhe — a tela atual já entra no ticket.",
          "Ou escreva para support@obramate.com.",
        ],
        en: [
          "Note the screen and what you tried.",
          "In this Help Center’s Support tab, send a Bug ticket.",
          "Include details — the current page is added automatically.",
          "Or email support@obramate.com.",
        ],
      },
    },
  ];

  /** Map current page filename → contextual help */
  var PAGE_CONTEXT = {
    "home.html": { moduleId: "home", problems: ["new-lead", "send-quote"], tutorials: ["getting-started"] },
    "dashboard.html": { moduleId: "home", problems: ["new-lead", "send-quote"], tutorials: ["getting-started"] },
    "leads.html": { moduleId: "leads", problems: ["new-lead", "schedule-visit", "send-quote"], tutorials: ["lead-to-quote"] },
    "lead-detail.html": { moduleId: "leads", problems: ["new-lead", "send-quote", "schedule-visit"], tutorials: ["lead-to-quote"] },
    "schedule.html": { moduleId: "schedule", problems: ["schedule-visit", "new-lead"], tutorials: ["lead-to-quote"] },
    "customers.html": { moduleId: "customers", problems: ["new-lead", "send-quote"], tutorials: ["lead-to-quote"] },
    "quotes.html": { moduleId: "quotes", problems: ["send-quote", "quote-not-received", "start-job"], tutorials: ["lead-to-quote", "quote-to-job"] },
    "quote-builder.html": { moduleId: "quotes", problems: ["send-quote", "price-table", "quote-not-received"], tutorials: ["lead-to-quote", "brand-setup"] },
    "jobs.html": { moduleId: "jobs", problems: ["start-job", "invoice-job", "photos"], tutorials: ["quote-to-job", "billing"] },
    "job-detail.html": { moduleId: "jobs", problems: ["start-job", "invoice-job", "photos", "payroll"], tutorials: ["quote-to-job", "billing"] },
    "invoices.html": { moduleId: "invoices", problems: ["invoice-job", "finance-cash"], tutorials: ["billing"] },
    "invoice.html": { moduleId: "invoices", problems: ["invoice-job", "finance-cash"], tutorials: ["billing"] },
    "finance.html": { moduleId: "finance", problems: ["finance-cash", "invoice-job"], tutorials: ["billing"] },
    "financial.html": { moduleId: "finance", problems: ["finance-cash", "invoice-job"], tutorials: ["billing"] },
    "folha.html": { moduleId: "payroll", problems: ["payroll"], tutorials: ["field-hours"] },
    "payroll-module.html": { moduleId: "payroll", problems: ["payroll"], tutorials: ["field-hours"] },
    "job-media-board.html": { moduleId: "obracam", problems: ["photos", "start-job"], tutorials: ["quote-to-job"] },
    "chat.html": { moduleId: "chat", problems: ["start-job", "new-lead"], tutorials: ["getting-started"] },
    "builder-pricing-admin.html": { moduleId: "pricing", problems: ["price-table", "send-quote"], tutorials: ["brand-setup", "lead-to-quote"] },
    "relatorios.html": { moduleId: "reports", problems: ["reports", "finance-cash"], tutorials: ["billing"] },
    "equipe.html": { moduleId: "team", problems: ["invite-team"], tutorials: ["getting-started"] },
    "configuracoes.html": { moduleId: "settings", problems: ["branding", "invite-team", "bug"], tutorials: ["brand-setup", "getting-started"] },
  };

  var CHECKLIST = [
    { id: "team", href: "equipe.html", label: { pt: "Convidar a equipe", en: "Invite the team" } },
    { id: "pricing", href: "builder-pricing-admin.html", label: { pt: "Montar Tabela de Valor", en: "Set up Price table" } },
    { id: "lead", href: "leads.html?new=1", label: { pt: "Cadastrar o primeiro lead", en: "Add the first lead" } },
    { id: "quote", href: "quotes.html", label: { pt: "Enviar um orçamento", en: "Send a quote" } },
    { id: "job", href: "jobs.html", label: { pt: "Abrir uma obra", en: "Open a job" } },
    { id: "invoice", href: "invoices.html", label: { pt: "Emitir uma fatura", en: "Send an invoice" } },
  ];

  var TUTORIALS = [
    {
      id: "getting-started",
      level: "start",
      duration: { pt: "10 min", en: "10 min" },
      title: { pt: "Primeiros passos no ObraMate", en: "Getting started with ObraMate" },
      summary: {
        pt: "Checklist para deixar a empresa pronta: equipe, preços, lead, orçamento, obra e fatura.",
        en: "Checklist to get ready: team, pricing, lead, quote, job, and invoice.",
      },
      steps: {
        pt: [
          { text: "Convide a equipe e defina papéis.", href: "equipe.html" },
          { text: "Monte a Tabela de Valor com seus serviços.", href: "builder-pricing-admin.html" },
          { text: "Cadastre o primeiro lead.", href: "leads.html?new=1" },
          { text: "Crie e envie um orçamento.", href: "quotes.html" },
          { text: "Abra a obra a partir do orçamento aprovado.", href: "jobs.html" },
          { text: "Emita a primeira fatura.", href: "invoices.html" },
        ],
        en: [
          { text: "Invite the team and set roles.", href: "equipe.html" },
          { text: "Build your Price table with services.", href: "builder-pricing-admin.html" },
          { text: "Add your first lead.", href: "leads.html?new=1" },
          { text: "Create and send a quote.", href: "quotes.html" },
          { text: "Open a job from the approved quote.", href: "jobs.html" },
          { text: "Send your first invoice.", href: "invoices.html" },
        ],
      },
    },
    {
      id: "lead-to-quote",
      level: "core",
      duration: { pt: "5 min", en: "5 min" },
      title: { pt: "Do lead ao orçamento enviado", en: "From lead to sent quote" },
      summary: {
        pt: "Fluxo comercial completo: captar, qualificar e propor.",
        en: "Full sales flow: capture, qualify, and propose.",
      },
      steps: {
        pt: [
          { text: "Crie o lead com origem e contato.", href: "leads.html?new=1" },
          { text: "Agende a visita de medição se precisar.", href: "schedule.html" },
          { text: "Monte o orçamento com itens da Tabela de Valor.", href: "quotes.html" },
          { text: "Envie o link e acompanhe a assinatura.", href: "quotes.html" },
        ],
        en: [
          { text: "Create the lead with source and contact.", href: "leads.html?new=1" },
          { text: "Schedule a measure visit if needed.", href: "schedule.html" },
          { text: "Build the quote from the Price table.", href: "quotes.html" },
          { text: "Send the link and track the signature.", href: "quotes.html" },
        ],
      },
    },
    {
      id: "quote-to-job",
      level: "core",
      duration: { pt: "5 min", en: "5 min" },
      title: { pt: "Do orçamento aprovado à obra", en: "From approved quote to job" },
      summary: {
        pt: "Transforme a venda em produção com equipe e status claros.",
        en: "Turn a win into production with clear crew and status.",
      },
      steps: {
        pt: [
          { text: "Abra o orçamento aprovado e gere a obra.", href: "quotes.html" },
          { text: "Confira datas, endereço e escopo em Obras.", href: "jobs.html" },
          { text: "Atribua a equipe de campo.", href: "jobs.html" },
          { text: "Registre fotos e progresso no ObraCam.", href: "job-media-board.html" },
        ],
        en: [
          { text: "Open the approved quote and create the job.", href: "quotes.html" },
          { text: "Confirm dates, address, and scope in Jobs.", href: "jobs.html" },
          { text: "Assign the field crew.", href: "jobs.html" },
          { text: "Log photos and progress in ObraCam.", href: "job-media-board.html" },
        ],
      },
    },
    {
      id: "billing",
      level: "core",
      duration: { pt: "4 min", en: "4 min" },
      title: { pt: "Como faturar e receber", en: "How to invoice and get paid" },
      summary: {
        pt: "Do fechamento da obra à cobrança e ao fluxo de caixa.",
        en: "From job wrap-up to billing and cash flow.",
      },
      steps: {
        pt: [
          { text: "Na obra, use Faturar (ou abra Faturas).", href: "jobs.html" },
          { text: "Revise valores e envie ao cliente.", href: "invoices.html" },
          { text: "Registre o pagamento quando entrar.", href: "invoices.html" },
          { text: "Veja o impacto no Financeiro.", href: "finance.html" },
        ],
        en: [
          { text: "On the job, use Invoice (or open Invoices).", href: "jobs.html" },
          { text: "Review amounts and send to the client.", href: "invoices.html" },
          { text: "Record the payment when it lands.", href: "invoices.html" },
          { text: "See the impact in Finance.", href: "finance.html" },
        ],
      },
    },
    {
      id: "field-hours",
      level: "ops",
      duration: { pt: "6 min", en: "6 min" },
      title: { pt: "Horas de campo e folha", en: "Field hours and payroll" },
      summary: {
        pt: "Como a equipe lança horas e como o escritório confere.",
        en: "How the crew logs hours and office reviews them.",
      },
      steps: {
        pt: [
          { text: "A equipe de campo registra horas no app Campo.", href: "/campo/horas.html" },
          { text: "No escritório, abra Folha e confira o período.", href: "folha.html" },
          { text: "Ajuste exceções e feche o pagamento.", href: "folha.html" },
        ],
        en: [
          { text: "Field crew logs hours in the Field app.", href: "/campo/horas.html" },
          { text: "In the office, open Payroll and review the period.", href: "folha.html" },
          { text: "Fix exceptions and close pay.", href: "folha.html" },
        ],
      },
    },
    {
      id: "brand-setup",
      level: "setup",
      duration: { pt: "3 min", en: "3 min" },
      title: { pt: "Marca e aparência dos PDFs", en: "Brand and PDF look" },
      summary: {
        pt: "Logo, cores e mensagens para orçamentos profissionais.",
        en: "Logo, colors, and messages for professional quotes.",
      },
      steps: {
        pt: [
          { text: "Envie o logo em Configurações › Marca.", href: "configuracoes.html#marca" },
          { text: "Ajuste textos padrão de orçamento.", href: "configuracoes.html#mensagens-orcamento" },
          { text: "Gere um PDF de teste em Orçamentos.", href: "quotes.html" },
        ],
        en: [
          { text: "Upload the logo in Settings › Branding.", href: "configuracoes.html#marca" },
          { text: "Tune default quote messages.", href: "configuracoes.html#mensagens-orcamento" },
          { text: "Generate a test PDF in Quotes.", href: "quotes.html" },
        ],
      },
    },
  ];

  var UI = {
    pt: {
      title: "Central de Ajuda",
      lead: "Pergunte, siga um tutorial ou fale com o suporte — sem sair da tela.",
      close: "Fechar ajuda",
      searchPh: "O que você precisa? Ex.: enviar orçamento…",
      tabHome: "Início",
      tabSolve: "Resolver",
      tabTutorials: "Tutoriais",
      tabModules: "Módulos",
      tabSupport: "Suporte",
      hereNow: "Nesta tela",
      hereHint: "Sugestões para onde você está agora.",
      checklistTitle: "Primeiros passos",
      checklistDone: "Concluído",
      checklistProgress: "de",
      quickTitle: "Atalhos",
      solveHint: "Escolha o que descreve melhor o seu caso.",
      tutorialsHint: "Guias curtos, passo a passo.",
      modulesHint: "Para onde ir em um toque.",
      supportHint: "Conte o que aconteceu — já incluímos a tela atual.",
      goModule: "Ir para o módulo",
      openSteps: "Ver passos",
      markDone: "Marcar como feito",
      markUndo: "Desfazer",
      back: "Voltar",
      stepsLabel: "Passos",
      related: "Também útil",
      empty: "Nada encontrado. Tente outras palavras ou fale com o suporte.",
      supportTitle: "Enviar mensagem",
      supportBody: "Respondemos no e-mail da sua conta.",
      supportTicket: "Enviar",
      supportEmail: "E-mail",
      supportCat: "Tipo",
      supportSubject: "Assunto",
      supportMessage: "Mensagem",
      supportSending: "Enviando…",
      supportOk: "Mensagem enviada. Respondemos pelo seu e-mail.",
      supportErr: "Não foi possível enviar. Tente de novo.",
      supportHistory: "Suas mensagens",
      supportEmptyHist: "Nenhum ticket ainda.",
      catQuestion: "Dúvida",
      catSuggestion: "Sugestão",
      catBug: "Problema / bug",
      catOther: "Outro",
      levelStart: "Começar",
      levelCore: "Fluxo principal",
      levelOps: "Operação",
      levelSetup: "Configuração",
      results: "Resultados",
      seeAll: "Ver tudo",
      openPage: "Abrir módulo",
    },
    en: {
      title: "Help Center",
      lead: "Ask, follow a tutorial, or contact support — without leaving the page.",
      close: "Close help",
      searchPh: "What do you need? e.g. send a quote…",
      tabHome: "Home",
      tabSolve: "Solve",
      tabTutorials: "Tutorials",
      tabModules: "Modules",
      tabSupport: "Support",
      hereNow: "On this screen",
      hereHint: "Suggestions for where you are now.",
      checklistTitle: "Getting started",
      checklistDone: "Done",
      checklistProgress: "of",
      quickTitle: "Shortcuts",
      solveHint: "Pick what best matches your case.",
      tutorialsHint: "Short step-by-step guides.",
      modulesHint: "Jump to the right place.",
      supportHint: "Tell us what happened — we include the current page.",
      goModule: "Go to module",
      openSteps: "See steps",
      markDone: "Mark as done",
      markUndo: "Undo",
      back: "Back",
      stepsLabel: "Steps",
      related: "Also useful",
      empty: "Nothing found. Try other words or contact support.",
      supportTitle: "Send a message",
      supportBody: "We reply to your account email.",
      supportTicket: "Send",
      supportEmail: "Email",
      supportCat: "Type",
      supportSubject: "Subject",
      supportMessage: "Message",
      supportSending: "Sending…",
      supportOk: "Message sent. We’ll reply by email.",
      supportErr: "Couldn’t send. Please try again.",
      supportHistory: "Your messages",
      supportEmptyHist: "No tickets yet.",
      catQuestion: "Question",
      catSuggestion: "Suggestion",
      catBug: "Bug / issue",
      catOther: "Other",
      levelStart: "Getting started",
      levelCore: "Core flow",
      levelOps: "Operations",
      levelSetup: "Setup",
      results: "Results",
      seeAll: "See all",
      openPage: "Open module",
    },
  };

  function locale() {
    try {
      if (window.CrmI18n && typeof window.CrmI18n.getLocale === "function") {
        var code = window.CrmI18n.getLocale();
        return code === "en" ? "en" : "pt";
      }
    } catch (_) {}
    return "pt";
  }

  function pick(obj, loc) {
    if (!obj) return "";
    if (typeof obj === "string") return obj;
    return obj[loc] || obj.pt || obj.en || "";
  }

  function moduleById(id) {
    for (var i = 0; i < MODULES.length; i++) {
      if (MODULES[i].id === id) return MODULES[i];
    }
    return null;
  }

  function normalize(s) {
    return String(s || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
  }

  function matchesQuery(hay, q) {
    if (!q) return true;
    var nq = normalize(q);
    var parts = nq.split(/\s+/).filter(Boolean);
    var nh = normalize(hay);
    for (var i = 0; i < parts.length; i++) {
      if (nh.indexOf(parts[i]) < 0) return false;
    }
    return true;
  }

  function searchAll(q, loc) {
    loc = loc || locale();
    var problems = PROBLEMS.filter(function (p) {
      var blob = [pick(p.title, loc), (p.tags || []).join(" ")].join(" ");
      return matchesQuery(blob, q);
    });
    var tutorials = TUTORIALS.filter(function (t) {
      var blob = [pick(t.title, loc), pick(t.summary, loc)].join(" ");
      return matchesQuery(blob, q);
    });
    var modules = MODULES.filter(function (m) {
      var blob = [pick(m.title, loc), pick(m.blurb, loc), m.id].join(" ");
      return matchesQuery(blob, q);
    });
    return { problems: problems, tutorials: tutorials, modules: modules };
  }

  function currentPageFile() {
    try {
      var parts = (location.pathname || "").split("/");
      return parts[parts.length - 1] || "";
    } catch (_) {
      return "";
    }
  }

  function pageContext() {
    var file = currentPageFile();
    return PAGE_CONTEXT[file] || null;
  }

  function problemById(id) {
    for (var i = 0; i < PROBLEMS.length; i++) {
      if (PROBLEMS[i].id === id) return PROBLEMS[i];
    }
    return null;
  }

  function tutorialById(id) {
    for (var i = 0; i < TUTORIALS.length; i++) {
      if (TUTORIALS[i].id === id) return TUTORIALS[i];
    }
    return null;
  }

  function contextualItems() {
    var ctx = pageContext();
    if (!ctx) return { module: null, problems: [], tutorials: [] };
    return {
      module: moduleById(ctx.moduleId),
      problems: (ctx.problems || []).map(problemById).filter(Boolean),
      tutorials: (ctx.tutorials || []).map(tutorialById).filter(Boolean),
    };
  }

  var CHECK_KEY = "crm_help_checklist_v1";

  function loadChecklistState() {
    try {
      return JSON.parse(localStorage.getItem(CHECK_KEY) || "{}") || {};
    } catch (_) {
      return {};
    }
  }

  function saveChecklistState(map) {
    try {
      localStorage.setItem(CHECK_KEY, JSON.stringify(map || {}));
    } catch (_) {}
  }

  function toggleChecklistItem(id) {
    var map = loadChecklistState();
    map[id] = !map[id];
    saveChecklistState(map);
    return !!map[id];
  }

  window.CrmHelpContent = {
    MODULES: MODULES,
    PROBLEMS: PROBLEMS,
    TUTORIALS: TUTORIALS,
    CHECKLIST: CHECKLIST,
    UI: UI,
    locale: locale,
    pick: pick,
    moduleById: moduleById,
    problemById: problemById,
    tutorialById: tutorialById,
    searchAll: searchAll,
    pageContext: pageContext,
    contextualItems: contextualItems,
    currentPageFile: currentPageFile,
    loadChecklistState: loadChecklistState,
    toggleChecklistItem: toggleChecklistItem,
  };
})();
