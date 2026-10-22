(function () {
  'use strict';

  const API_SUGGESTIONS = '/api/mate-ai/suggestions';
  const API_AGENTS = '/api/virtual-office/agents';
  const DEPARTMENTS = {
    all: { label: 'Central', icon: '✦', href: 'mate-ai.html', link: 'Abrir Mate AI' },
    commercial: { label: 'Comercial', icon: '↗', href: 'quotes.html', link: 'Ver quotes' },
    operations: { label: 'Operações', icon: '⌂', href: 'jobs.html', link: 'Ver jobs' },
    finance: { label: 'Financeiro', icon: '$', href: 'invoices.html', link: 'Ver invoices' },
  };
  const ACTION_DEPARTMENTS = {
    'quote.send': 'commercial',
    'quotes.followup': 'commercial',
    'job.create': 'operations',
    'invoices.overdue': 'finance',
    'jobs.uninvoiced': 'finance',
  };
  const TONE_LABELS = {
    critical: 'Revisão prioritária',
    warning: 'Precisa de atenção',
    accent: 'Oportunidade',
    neutral: 'Próximo passo',
  };
  const AGENT_DEPARTMENTS = {
    central: 'Coordenação',
    commercial: 'Comercial',
    operations: 'Operações',
    finance: 'Financeiro',
  };
  const CAPABILITY_OPTIONS = [
    { key: 'office.summary', label: 'Ver resumo da empresa' },
    { key: 'office.recommendations', label: 'Ver recomendações' },
    { key: 'leads.search', label: 'Consultar leads' },
    { key: 'customers.search', label: 'Consultar clientes' },
    { key: 'quotes.prepare', label: 'Preparar orçamentos' },
    { key: 'quotes.send', label: 'Enviar orçamentos após aprovação' },
    { key: 'jobs.view', label: 'Consultar obras' },
    { key: 'jobs.manage', label: 'Atualizar obras e registrar notas' },
    { key: 'schedule.view', label: 'Consultar agenda' },
    { key: 'schedule.manage', label: 'Agendar e reagendar' },
    { key: 'crews.view', label: 'Consultar equipes' },
    { key: 'invoices.view', label: 'Consultar invoices' },
    { key: 'invoices.manage', label: 'Gerenciar invoices e cobranças' },
    { key: 'payments.view', label: 'Consultar recebimentos' },
    { key: 'payments.manage', label: 'Registrar recebimentos e enviar comprovantes' },
  ];
  const FACE_IMAGES = {
    'avatar-1': '/assets/virtual-office/avatar-1.jpg',
    'avatar-2': '/assets/virtual-office/avatar-2.jpg',
    'avatar-3': '/assets/virtual-office/avatar-3.jpg',
    'avatar-4': '/assets/virtual-office/avatar-4.jpg',
    'avatar-5': '/assets/virtual-office/avatar-5.jpg',
    'avatar-6': '/assets/virtual-office/avatar-6.jpg',
  };
  const MATE_IMAGE = '/assets/img/mascot/mate-thumbs.png';
  const requestedAgent = new URLSearchParams(location.search).get('agent') || 'mate';
  const state = { suggestions: [], agents: [], filter: 'all', busy: false, canManage: false, activeAgentKey: /^[a-z0-9_-]{1,60}$/i.test(requestedAgent) ? requestedAgent.toLowerCase() : 'mate', contextRequest: 0 };
  const $ = (selector, root) => (root || document).querySelector(selector);
  const $$ = (selector, root) => Array.from((root || document).querySelectorAll(selector));

  function makeFace(avatarKey, agentKey) {
    const image = document.createElement('img');
    image.className = `office-avatar-image${agentKey === 'mate' ? ' office-avatar-image--mate' : ''}`;
    image.src = agentKey === 'mate' ? MATE_IMAGE : (FACE_IMAGES[avatarKey] || FACE_IMAGES['avatar-1']);
    image.alt = '';
    image.setAttribute('aria-hidden', 'true');
    image.loading = 'lazy';
    image.decoding = 'async';
    return image;
  }

  function setText(selector, value) {
    const el = $(selector);
    if (el) el.textContent = value;
  }

  function makeNode(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = String(text);
    return node;
  }

  function activeAgent() {
    return state.agents.find((agent) => agent.key === state.activeAgentKey && agent.enabled)
      || state.agents.find((agent) => agent.key === 'mate' && agent.enabled)
      || state.agents.find((agent) => agent.enabled)
      || null;
  }

  function renderActiveAgent() {
    const agent = activeAgent();
    if (!agent) return;
    if (agent.key !== state.activeAgentKey) {
      const url = new URL(location.href);
      url.searchParams.set('agent', agent.key);
      location.replace(url.pathname + url.search + url.hash);
      return;
    }
    state.activeAgentKey = agent.key;
    const avatar = $('#officeActiveAvatar');
    if (avatar) avatar.replaceChildren(makeFace(agent.avatarKey, agent.key));
    setText('#officeActiveName', agent.name);
    setText('#officeActiveTitle', agent.title || AGENT_DEPARTMENTS[agent.department] || 'Funcionário virtual');
    setText('#officeActiveDepartment', (AGENT_DEPARTMENTS[agent.department] || 'ESCRITÓRIO').toUpperCase());
    document.title = `${agent.name} · Escritório ObraMate`;
    $$('.office-agent-card').forEach((card) => {
      const selected = card.dataset.agentKey === agent.key;
      card.classList.toggle('office-agent-card--selected', selected);
      const link = $('.office-agent-card__select', card);
      if (link) {
        if (selected) link.setAttribute('aria-current', 'page');
        else link.removeAttribute('aria-current');
      }
    });
  }

  function setCurrentEmpty() {
    const host = $('#officeCurrentWork');
    if (!host) return;
    const empty = makeNode('div', 'office-current-empty');
    empty.append(
      makeNode('span', 'office-current-empty__icon', '✦'),
      makeNode('strong', '', 'Nenhuma tarefa ativa'),
      makeNode('p', '', 'Quando um funcionário criar ou atualizar algo, o registro aparecerá aqui para acompanhar a conversa.'),
    );
    host.replaceChildren(empty);
  }

  function money(value) {
    const amount = Number(value);
    return Number.isFinite(amount) ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount) : '—';
  }

  function formatDate(value, options) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat('pt-BR', options || { dateStyle: 'medium', timeStyle: 'short' }).format(date);
  }

  function addRecordLines(card, items, nameOf, amountOf, detailOf) {
    if (!Array.isArray(items) || !items.length) return;
    const list = makeNode('ul', 'office-current-lines');
    items.slice(0, 4).forEach((item) => {
      const row = makeNode('li');
      row.append(makeNode('span', '', nameOf(item)), makeNode('strong', '', amountOf(item)));
      const detail = detailOf(item);
      if (detail) row.appendChild(makeNode('small', '', detail));
      list.appendChild(row);
    });
    card.appendChild(list);
  }

  function addRecordTotal(card, label, amount) {
    const total = makeNode('div', 'office-current-total');
    total.append(makeNode('span', '', label), makeNode('strong', '', money(amount)));
    card.appendChild(total);
  }

  function addRecordLink(host, href, label) {
    if (!href) return;
    const link = makeNode('a', 'office-current-open', label || 'Abrir registro');
    link.href = href;
    link.target = '_blank';
    link.rel = 'noopener';
    host.appendChild(link);
  }

  function renderQuoteRecord(record, quoteId) {
    const host = $('#officeCurrentWork');
    if (!host) return;
    const card = makeNode('div', 'office-current-record');
    card.appendChild(makeNode('span', 'office-current-record__kind', 'Orçamento'));
    card.appendChild(makeNode('h3', '', record.quote_number ? `Quote ${record.quote_number}` : record.title || 'Quote ativo'));
    const statusLabels = { draft: 'Rascunho', sent: 'Enviado', approved: 'Aprovado', declined: 'Recusado', changes_requested: 'Alteração solicitada' };
    const status = statusLabels[String(record.status || '').toLowerCase()] || record.status || 'Em andamento';
    card.appendChild(makeNode('p', 'office-current-record__meta', [record.customer_name, status].filter(Boolean).join(' · ')));
    const items = Array.isArray(record.items) ? record.items : [];
    addRecordLines(card, items, (item) => item.name || item.description || 'Serviço', (item) => money(item.amount), (item) => `${Number(item.quantity || 0).toLocaleString('en-US')} ${item.unit || item.unit_type || 'un.'} × ${money(item.unit_price ?? item.rate)}`);
    addRecordTotal(card, 'Total', record.total ?? record.total_amount);
    addRecordLink(card, `quote-builder.html?id=${encodeURIComponent(quoteId)}`, 'Abrir quote');
    host.replaceChildren(card);
  }

  function renderJobRecord(record, jobId) {
    const host = $('#officeCurrentWork');
    if (!host) return;
    const card = makeNode('div', 'office-current-record');
    const statusLabels = { scheduled: 'Agendada', in_progress: 'Em andamento', completed: 'Concluída', canceled: 'Cancelada', on_hold: 'Em espera' };
    const status = statusLabels[String(record.status || '').toLowerCase()] || record.status || 'Em andamento';
    card.append(makeNode('span', 'office-current-record__kind', 'Obra'), makeNode('h3', '', record.number != null ? `Obra #${record.number} · ${record.title || 'Sem título'}` : record.title || 'Obra em andamento'));
    const contact = record.customer?.display_name || record.customer?.name || record.builder?.company || record.builder?.name;
    const meta = [contact, status, record.sector].filter(Boolean).join(' · ');
    card.appendChild(makeNode('p', 'office-current-record__meta', meta || 'Acompanhe as atualizações desta obra.'));
    const schedule = [formatDate(record.scheduled_start), record.crew?.name || record.assigned_user?.name].filter(Boolean).join(' · ');
    if (schedule) card.appendChild(makeNode('p', 'office-current-record__meta office-current-record__detail', schedule));
    if (record.address) card.appendChild(makeNode('p', 'office-current-record__meta office-current-record__detail', record.address));
    addRecordLines(card, record.line_items, (item) => item.service_name || item.name || 'Serviço', (item) => money(item.line_total ?? item.amount), (item) => `${Number(item.quantity_sqft ?? item.quantity ?? 0).toLocaleString('en-US')} ${item.unit || 'sq ft'} × ${money(item.unit_price)}`);
    if (record.services_total != null) addRecordTotal(card, 'Serviços', record.services_total);
    addRecordLink(card, `job-detail.html?id=${encodeURIComponent(jobId)}`, 'Abrir obra');
    host.replaceChildren(card);
  }

  function renderInvoiceRecord(record, invoiceId) {
    const host = $('#officeCurrentWork');
    if (!host) return;
    const card = makeNode('div', 'office-current-record');
    const statusLabels = { draft: 'Rascunho', sent: 'Enviada', viewed: 'Visualizada', paid: 'Paga', partially_paid: 'Parcialmente paga', overdue: 'Atrasada', void: 'Anulada' };
    const status = statusLabels[String(record.display_status || record.status || '').toLowerCase()] || record.display_status || record.status || 'Em andamento';
    const number = record.invoice_number || 'Invoice';
    card.append(makeNode('span', 'office-current-record__kind', 'Financeiro'), makeNode('h3', '', `${number}${record.invoice_type_label ? ` · ${record.invoice_type_label}` : ''}`));
    const meta = [record.client?.name, status, record.due_date ? `Vence ${formatDate(record.due_date, { dateStyle: 'medium' })}` : null].filter(Boolean).join(' · ');
    card.appendChild(makeNode('p', 'office-current-record__meta', meta || 'Acompanhe esta invoice.'));
    addRecordLines(card, record.line_items, (item) => item.description || 'Serviço', (item) => money(item.amount), (item) => `${Number(item.quantity || 0).toLocaleString('en-US')} × ${money(item.unit_price)}`);
    addRecordTotal(card, 'Valor', record.amount);
    if (Number(record.paid_amount || 0) > 0) addRecordTotal(card, 'Recebido', record.paid_amount);
    if (record.remaining_amount != null) addRecordTotal(card, 'Em aberto', record.remaining_amount);
    addRecordLink(card, `invoice.html?id=${encodeURIComponent(invoiceId)}`, 'Abrir invoice');
    host.replaceChildren(card);
  }

  function renderMeetingRecord(record) {
    const host = $('#officeCurrentWork');
    if (!host) return;
    const card = makeNode('div', 'office-current-record');
    const isVisit = Boolean(record.lead_id || record.lead);
    const statusLabels = { scheduled: 'Agendado', completed: 'Concluído', canceled: 'Cancelado' };
    const status = statusLabels[String(record.status || '').toLowerCase()] || record.status || 'Agendado';
    card.append(makeNode('span', 'office-current-record__kind', isVisit ? 'Visita' : 'Agenda'), makeNode('h3', '', record.title || 'Compromisso'));
    const person = record.lead?.name || record.customer?.name || record.assigned_user?.name;
    card.appendChild(makeNode('p', 'office-current-record__meta', [person, status].filter(Boolean).join(' · ') || 'Compromisso na agenda.'));
    const time = record.all_day ? `${formatDate(record.scheduled_start, { dateStyle: 'full' })} · Dia inteiro` : `${formatDate(record.scheduled_start)}${record.scheduled_end ? ` – ${formatDate(record.scheduled_end, { timeStyle: 'short' })}` : ''}`;
    if (time) card.appendChild(makeNode('p', 'office-current-record__meta office-current-record__detail', time));
    if (record.location || record.lead?.address) card.appendChild(makeNode('p', 'office-current-record__meta office-current-record__detail', record.location || record.lead.address));
    if (record.notes) card.appendChild(makeNode('p', 'office-current-record__meta office-current-record__detail', record.notes));
    addRecordLink(card, 'schedule.html', 'Abrir agenda');
    host.replaceChildren(card);
  }

  async function fetchContextRecord(request, path, render, fallbackLabel, entity) {
    const host = $('#officeCurrentWork');
    if (!host) return;
    host.replaceChildren(makeNode('div', 'office-current-loading', `Atualizando ${fallbackLabel.toLowerCase()}…`));
    try {
      const response = await fetch(path, { credentials: 'include', cache: 'no-store' });
      const data = await response.json().catch(() => ({}));
      if (request !== state.contextRequest) return;
      if (!response.ok || data.success === false || !data.data) throw new Error(data.error || `${fallbackLabel} indisponível`);
      render(data.data, entity.id);
    } catch (_) {
      if (request !== state.contextRequest) return;
      const fallback = makeNode('div', 'office-current-record');
      fallback.append(makeNode('span', 'office-current-record__kind', fallbackLabel), makeNode('h3', '', entity.title || `${fallbackLabel} em contexto`), makeNode('p', 'office-current-record__meta', 'Não consegui atualizar os detalhes agora.'));
      const href = entity.type === 'invoice' ? `invoice.html?id=${encodeURIComponent(entity.id)}` : entity.type === 'meeting' ? 'schedule.html' : entity.type === 'quote' ? `quote-builder.html?id=${encodeURIComponent(entity.id)}` : `job-detail.html?id=${encodeURIComponent(entity.id)}`;
      addRecordLink(fallback, href, `Abrir ${fallbackLabel.toLowerCase()}`);
      host.replaceChildren(fallback);
    }
  }

  async function showCurrentWork(entity) {
    const host = $('#officeCurrentWork');
    if (!host) return;
    const request = ++state.contextRequest;
    if (!entity || !entity.id) { setCurrentEmpty(); return; }
    const type = entity.type === 'work_order' ? 'job' : String(entity.type || '');
    if (type === 'quote') {
      fetchContextRecord(request, `/api/quotes/${encodeURIComponent(entity.id)}`, renderQuoteRecord, 'Orçamento', entity);
      return;
    }
    if (type === 'job') {
      fetchContextRecord(request, `/api/work-orders/${encodeURIComponent(entity.id)}`, renderJobRecord, 'Obra', entity);
      return;
    }
    if (type === 'invoice') {
      fetchContextRecord(request, `/api/quote-invoices/${encodeURIComponent(entity.id)}`, renderInvoiceRecord, 'Invoice', entity);
      return;
    }
    if (type === 'meeting') {
      fetchContextRecord(request, `/api/meetings/${encodeURIComponent(entity.id)}`, renderMeetingRecord, 'Agenda', entity);
      return;
    }
    const labels = { job: ['Obra', `job-detail.html?id=${encodeURIComponent(entity.id)}`], invoice: ['Invoice', `invoice.html?id=${encodeURIComponent(entity.id)}`], lead: ['Lead', `lead-detail.html?id=${encodeURIComponent(entity.id)}`], customer: ['Cliente', `customers.html?id=${encodeURIComponent(entity.id)}`] };
    const [label, href] = labels[type] || ['Registro', ''];
    const card = makeNode('div', 'office-current-record');
    card.append(makeNode('span', 'office-current-record__kind', label), makeNode('h3', '', entity.title || `${label} em andamento`), makeNode('p', 'office-current-record__meta', 'Acompanhe as atualizações nesta conversa.'));
    addRecordLink(card, href, `Abrir ${label.toLowerCase()}`);
    host.replaceChildren(card);
  }

  function onOfficeContext(event) {
    const entity = event?.detail?.entity || null;
    showCurrentWork(entity);
  }

  function departmentFor(suggestion) {
    return ACTION_DEPARTMENTS[suggestion?.run?.action] || 'all';
  }

  function taskLabel(suggestion) {
    const department = DEPARTMENTS[departmentFor(suggestion)];
    return department ? department.label : 'Central';
  }

  function updateTimestamp() {
    const now = new Date();
    const time = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(now);
    setText('#officeUpdated', `Atualizado às ${time}`);
  }

  function renderCounts() {
    const suggestions = state.suggestions;
    const urgent = suggestions.filter((item) => item.tone === 'critical' || item.tone === 'warning').length;
    setText('#officeSuggestionCount', String(suggestions.length));
    setText('#officeUrgentCount', String(urgent));
    setText('#officeAgentCount', String(state.agents.filter((agent) => agent.enabled).length));

    const counts = { all: suggestions.length, commercial: 0, operations: 0, finance: 0 };
    suggestions.forEach((item) => {
      const department = departmentFor(item);
      if (counts[department] !== undefined) counts[department] += 1;
    });
    $$('[data-office-count]').forEach((el) => {
      const key = el.getAttribute('data-office-count');
      el.textContent = String(counts[key] || 0);
      el.setAttribute('aria-label', `${counts[key] || 0} recomendações`);
    });
  }

  function renderSceneAgents() {
    $$('[data-office-filter]').forEach((station) => {
      const filter = station.getAttribute('data-office-filter') || 'all';
      const department = filter === 'all' ? 'central' : filter;
      const agent = state.agents.find((item) => item.department === department && item.enabled);
      const portrait = $('.office-station__avatar', station);
      const label = $('.office-station__label', station);
      if (portrait) {
        portrait.replaceChildren(makeFace(agent?.avatarKey || 'avatar-1', agent?.key));
        portrait.classList.toggle('office-station__avatar--unassigned', !agent);
      }
      if (label) {
        const name = $('strong', label);
        const title = $('small', label);
        if (name) name.textContent = agent?.name || 'Sem responsável';
        if (title) title.textContent = agent?.title || AGENT_DEPARTMENTS[department] || 'Setor';
      }
      station.setAttribute('aria-label', agent
        ? `${agent.name}, ${agent.title}, ${AGENT_DEPARTMENTS[department] || 'setor'}. Filtrar recomendações.`
        : `${AGENT_DEPARTMENTS[department] || 'Setor'} sem funcionário ativo. Filtrar recomendações.`);
      station.dataset.officeAgentKey = agent?.key || '';
    });
  }

  function makeAgentCard(agent) {
    const card = document.createElement('article');
    card.className = `office-agent-card${agent.enabled ? '' : ' office-agent-card--inactive'}${agent.key === state.activeAgentKey ? ' office-agent-card--selected' : ''}`;
    card.dataset.agentKey = agent.key;
    const portrait = document.createElement('div');
    portrait.className = 'office-agent-card__portrait';
    portrait.appendChild(makeFace(agent.avatarKey, agent.key));
    const identity = document.createElement('div');
    identity.className = 'office-agent-card__identity';
    const name = document.createElement('strong');
    name.className = 'office-agent-card__name';
    name.textContent = agent.name;
    const title = document.createElement('span');
    title.className = 'office-agent-card__title';
    title.textContent = agent.title;
    const status = document.createElement('span');
    status.className = 'office-agent-card__status';
    status.textContent = agent.enabled ? 'Ativo' : 'Inativo';
    identity.append(name, title, status);
    const capabilities = Array.isArray(agent.capabilities) ? agent.capabilities : [];
    const canChat = agent.enabled && capabilities.some((key) => key !== 'office.recommendations');
    const select = document.createElement(canChat ? 'a' : 'div');
    select.className = 'office-agent-card__select';
    if (canChat) select.href = `escritorio-ia.html?agent=${encodeURIComponent(agent.key)}`;
    select.append(portrait, identity);
    card.appendChild(select);
    if (canChat || state.canManage) {
      const footer = document.createElement('div');
      footer.className = 'office-agent-card__footer';
      if (state.canManage) {
        const edit = document.createElement('button');
        edit.className = 'office-agent-card__edit';
        edit.type = 'button';
        edit.dataset.agentEdit = agent.key;
        edit.textContent = 'Editar perfil';
        footer.appendChild(edit);
      }
      card.appendChild(footer);
    }
    return card;
  }

  function renderAgents() {
    const host = $('#officeAgents');
    if (!host) return;
    host.replaceChildren();
    host.setAttribute('aria-busy', 'false');
    if (!state.agents.length) {
      const empty = document.createElement('div');
      empty.className = 'office-empty';
      const copy = document.createElement('span');
      copy.textContent = 'Nenhum funcionário virtual configurado.';
      empty.appendChild(copy);
      host.appendChild(empty);
    } else {
      state.agents.forEach((agent) => host.appendChild(makeAgentCard(agent)));
    }
    renderSceneAgents();
    renderActiveAgent();
    setText('#officeAgentCount', String(state.agents.filter((agent) => agent.enabled).length));
  }

  function selectAvatar(avatarKey) {
    $$('.office-avatar-choice').forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.avatarKey === avatarKey));
    });
  }

  function buildEditorChoices(agent) {
    const avatars = $('#agentAvatarChoices');
    const capabilities = $('#agentCapabilities');
    if (avatars) {
      avatars.replaceChildren();
      if (agent.key === 'mate') {
        const mateImage = document.createElement('div');
        mateImage.className = 'office-avatar-choice office-avatar-choice--mate';
        mateImage.setAttribute('role', 'img');
        mateImage.setAttribute('aria-label', 'Mascote ObraMate');
        mateImage.appendChild(makeFace(agent.avatarKey, 'mate'));
        avatars.appendChild(mateImage);
      } else Object.keys(FACE_IMAGES).forEach((avatarKey, index) => {
        const button = document.createElement('button');
        button.className = 'office-avatar-choice';
        button.type = 'button';
        button.dataset.avatarKey = avatarKey;
        button.setAttribute('aria-label', `Rosto ${index + 1}`);
        button.setAttribute('aria-pressed', String(agent.avatarKey === avatarKey));
        button.appendChild(makeFace(avatarKey));
        avatars.appendChild(button);
      });
    }
    if (capabilities) {
      capabilities.replaceChildren();
      CAPABILITY_OPTIONS.forEach((option) => {
        const label = document.createElement('label');
        label.className = 'office-capability-option';
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.name = 'capabilities';
        input.value = option.key;
        input.checked = (agent.capabilities || []).includes(option.key);
        const text = document.createElement('span');
        text.textContent = option.label;
        label.append(input, text);
        capabilities.appendChild(label);
      });
    }
  }

  function openAgentEditor(key) {
    const agent = state.agents.find((item) => item.key === key);
    const dialog = $('#agentDialog');
    if (!agent || !dialog || !state.canManage) return;
    $('#agentKey').value = agent.key;
    $('#agentName').value = agent.name;
    $('#agentTitle').value = agent.title;
    $('#agentDepartment').value = agent.department;
    $('#agentDescription').value = agent.description;
    $('#agentEnabled').checked = Boolean(agent.enabled);
    setText('#agentDialogTitle', `Editar perfil · ${agent.name}`);
    const error = $('#agentFormError');
    if (error) { error.hidden = true; error.textContent = ''; }
    buildEditorChoices(agent);
    dialog.showModal();
    $('#agentName').focus();
  }

  async function saveAgent(event) {
    event.preventDefault();
    const key = $('#agentKey').value;
    const selectedAvatar = $('.office-avatar-choice[aria-pressed="true"]')?.dataset.avatarKey;
    const payload = {
      name: $('#agentName').value.trim(),
      title: $('#agentTitle').value.trim(),
      department: $('#agentDepartment').value,
      avatarKey: selectedAvatar || state.agents.find((agent) => agent.key === key)?.avatarKey || 'avatar-1',
      description: $('#agentDescription').value.trim(),
      capabilities: $$('input[name="capabilities"]:checked').map((input) => input.value),
      enabled: $('#agentEnabled').checked,
    };
    const save = $('#agentSave');
    const error = $('#agentFormError');
    if (error) { error.hidden = true; error.textContent = ''; }
    if (save) { save.disabled = true; save.textContent = 'Salvando…'; }
    try {
      const response = await fetch(`${API_AGENTS}/${encodeURIComponent(key)}`, {
        method: 'PATCH',
        credentials: 'include',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.success === false) throw new Error(data.error || 'Não foi possível salvar o perfil.');
      state.agents = state.agents.map((agent) => agent.key === key ? data.data : agent);
      renderAgents();
      $('#agentDialog').close();
      setText('#officeUpdated', 'Perfil salvo');
    } catch (err) {
      if (error) {
        error.hidden = false;
        error.textContent = String(err?.message || 'Não foi possível salvar o perfil.');
      }
    } finally {
      if (save) { save.disabled = false; save.textContent = 'Salvar perfil'; }
    }
  }

  function makeTask(item) {
    const department = departmentFor(item);
    const details = DEPARTMENTS[department] || DEPARTMENTS.all;
    const tone = ['critical', 'warning', 'accent', 'neutral'].includes(item.tone) ? item.tone : 'neutral';
    const article = document.createElement('article');
    article.className = `office-task office-task--${tone}`;
    article.dataset.department = department;

    const mark = document.createElement('span');
    mark.className = 'office-task__mark';
    mark.setAttribute('aria-hidden', 'true');
    mark.textContent = details.icon;

    const body = document.createElement('div');
    body.className = 'office-task__body';
    const meta = document.createElement('div');
    meta.className = 'office-task__meta';
    meta.textContent = `${taskLabel(item)} · ${TONE_LABELS[tone]}`;
    const title = document.createElement('h3');
    title.className = 'office-task__title';
    title.textContent = String(item.title || 'Recomendação do Mate');
    body.append(meta, title);

    if (item.detail) {
      const detail = document.createElement('p');
      detail.className = 'office-task__detail';
      detail.textContent = String(item.detail);
      body.appendChild(detail);
    }

    const link = document.createElement('a');
    link.className = 'office-task__link';
    link.href = details.href;
    link.textContent = details.link;

    article.append(mark, body, link);
    return article;
  }

  function renderTasks() {
    const host = $('#officeTasks');
    if (!host) return;
    host.replaceChildren();
    host.setAttribute('aria-busy', 'false');
    const filtered = state.filter === 'all'
      ? state.suggestions
      : state.suggestions.filter((item) => departmentFor(item) === state.filter);

    if (!filtered.length) {
      const empty = document.createElement('div');
      empty.className = 'office-empty';
      const title = document.createElement('strong');
      title.textContent = state.filter === 'all' ? 'Tudo em ordem por aqui' : 'Nenhuma recomendação neste setor';
      const copy = document.createElement('span');
      copy.textContent = state.filter === 'all'
        ? 'Quando o Mate encontrar um próximo passo, ele aparecerá neste painel.'
        : 'O Mate não encontrou itens que precisem de revisão agora.';
      empty.append(title, copy);
      host.appendChild(empty);
      return;
    }

    filtered.forEach((item) => host.appendChild(makeTask(item)));
  }

  function setFilter(filter) {
    if (!DEPARTMENTS[filter]) return;
    state.filter = filter;
    $$('[data-office-filter]').forEach((button) => {
      button.setAttribute('aria-pressed', String(button.getAttribute('data-office-filter') === filter));
    });
    const sectionTitle = filter === 'all' ? 'Recomendações do Mate' : `Recomendações · ${DEPARTMENTS[filter].label}`;
    setText('#officeTasksTitle', sectionTitle);
    renderTasks();
  }

  async function loadSession() {
    const response = await fetch('/api/auth/session', { credentials: 'include', cache: 'no-store' });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.message || 'Não foi possível confirmar sua sessão.');
    }
    if (!data.authenticated) {
      window.location.href = '/login.html';
      throw new Error('Sua sessão expirou. Entre novamente para abrir o escritório.');
    }
    if (data.user?.must_change_password) {
      window.location.href = '/change-password.html';
      throw new Error('Atualizando para a tela de troca de senha.');
    }

    const userName = String(data.user?.name || '').trim().split(/\s+/)[0];
    const permissions = Array.isArray(data.user?.permissions) ? data.user.permissions : [];
    state.canManage = data.user?.role === 'admin' || permissions.includes('settings.manage');
    setText('#officeWelcome', userName
      ? `Olá, ${userName}. Converse com a equipe e acompanhe as ações no contexto da sua empresa.`
      : 'Converse com a equipe e acompanhe as ações no contexto da sua empresa.');
    setText('#officeOrgName', data.organization?.name || 'Escritório ObraMate');
  }

  async function loadAgents() {
    try {
      const response = await fetch(API_AGENTS, { credentials: 'include', cache: 'no-store' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.success === false) {
        throw new Error(data.error || 'Não foi possível carregar os funcionários virtuais.');
      }
      state.agents = Array.isArray(data.data) ? data.data : [];
      renderAgents();
      renderCounts();
    } catch (error) {
      const host = $('#officeAgents');
      if (host) {
        host.setAttribute('aria-busy', 'false');
        const empty = document.createElement('div');
        empty.className = 'office-empty';
        const copy = document.createElement('span');
        copy.textContent = String(error?.message || 'Não foi possível carregar a equipe.');
        empty.appendChild(copy);
        host.replaceChildren(empty);
      }
      throw error;
    }
  }

  async function loadSuggestions() {
    const response = await fetch(API_SUGGESTIONS, { credentials: 'include', cache: 'no-store' });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.success === false) {
      throw new Error(data.error || 'Não foi possível carregar as recomendações do Mate.');
    }
    const priority = { critical: 0, warning: 1, accent: 2, neutral: 3 };
    state.suggestions = (Array.isArray(data.data) ? data.data : []).slice().sort((a, b) =>
      (priority[a.tone] ?? 4) - (priority[b.tone] ?? 4),
    );
    renderCounts();
    renderTasks();
  }

  async function refresh() {
    if (state.busy) return;
    state.busy = true;
    document.body.classList.add('is-loading');
    const refreshButton = $('#officeRefresh');
    if (refreshButton) refreshButton.disabled = true;
    const error = $('#officeError');
    if (error) {
      error.hidden = true;
      error.textContent = '';
    }
    try {
      await loadSession();
      await Promise.all([loadSuggestions(), loadAgents()]);
      updateTimestamp();
    } catch (err) {
      const message = String(err?.message || 'Erro ao carregar o escritório.');
      if (!message.includes('Entre novamente') && !message.includes('troca de senha')) {
        if (error) {
          error.hidden = false;
          error.textContent = message;
        }
        const host = $('#officeTasks');
        if (host && !state.suggestions.length) {
          host.replaceChildren();
          const empty = document.createElement('div');
          empty.className = 'office-empty';
          const title = document.createElement('strong');
          title.textContent = 'Não foi possível atualizar';
          const copy = document.createElement('span');
          copy.textContent = message;
          empty.append(title, copy);
          host.appendChild(empty);
        }
      }
    } finally {
      document.body.classList.remove('is-loading');
      if (refreshButton) refreshButton.disabled = false;
      state.busy = false;
    }
  }

  function bindControls() {
    window.addEventListener('mate:office-context', onOfficeContext);
    if (window.__mateAiOfficeContext) showCurrentWork(window.__mateAiOfficeContext.entity || null);
    $$('[data-office-filter]').forEach((button) => {
      button.addEventListener('click', () => setFilter(button.getAttribute('data-office-filter')));
    });
    const refreshButton = $('#officeRefresh');
    if (refreshButton) refreshButton.addEventListener('click', refresh);

    const agents = $('#officeAgents');
    if (agents) {
      agents.addEventListener('click', (event) => {
        const target = event.target;
        if (!(target instanceof Element)) return;
        const button = target.closest('[data-agent-edit]');
        if (button) openAgentEditor(button.dataset.agentEdit);
      });
    }
    const avatarChoices = $('#agentAvatarChoices');
    if (avatarChoices) {
      avatarChoices.addEventListener('click', (event) => {
        const target = event.target;
        if (!(target instanceof Element)) return;
        const button = target.closest('[data-avatar-key]');
        if (button) selectAvatar(button.dataset.avatarKey);
      });
    }
    const form = $('#agentForm');
    if (form) form.addEventListener('submit', saveAgent);
    const dialog = $('#agentDialog');
    const closeDialog = () => { if (dialog?.open) dialog.close(); };
    $('#agentDialogClose')?.addEventListener('click', closeDialog);
    $('#agentCancel')?.addEventListener('click', closeDialog);

    const toggle = $('#mobileMenuToggle');
    const sidebar = $('#officeSidebar');
    const overlay = $('#mobileOverlay');
    if (toggle && sidebar && overlay) {
      const close = () => {
        sidebar.classList.remove('mobile-open');
        overlay.classList.remove('active');
        toggle.setAttribute('aria-expanded', 'false');
      };
      toggle.addEventListener('click', () => {
        const open = sidebar.classList.toggle('mobile-open');
        overlay.classList.toggle('active', open);
        toggle.setAttribute('aria-expanded', String(open));
      });
      overlay.addEventListener('click', close);
    }
  }

  bindControls();
  refresh();
})();
