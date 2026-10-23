(function () {
  'use strict';

  const API_SUGGESTIONS = '/api/mate-ai/suggestions';
  const API_AGENTS = '/api/virtual-office/agents';
  const VOICE_PREFS_KEY = 'om.office.voice.v1';
  const DEPARTMENTS = {
    all: { label: 'Coordenação', icon: '✦', href: 'mate-ai.html', link: 'Abrir Mate AI' },
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
  const FACE_IMAGES = {};
  for (let index = 1; index <= 14; index += 1) FACE_IMAGES[`avatar-${index}`] = `/assets/virtual-office/avatar-${index}.jpg`;
  const MATE_IMAGE = '/assets/img/mascot/mate-thumbs.png';
  /** Floor plan in plan pixels: two rows of rooms with a corridor between them. */
  const PLAN = { w: 960, h: 540 };
  const ROOMS = [
    { id: 'commercial', label: 'Comercial', x: 16, y: 16, w: 300, h: 250, row: 'top' },
    { id: 'operations', label: 'Operações', x: 330, y: 16, w: 300, h: 250, row: 'top' },
    { id: 'finance', label: 'Financeiro', x: 644, y: 16, w: 300, h: 250, row: 'top' },
    { id: 'central', label: 'Sala do Mate', x: 16, y: 300, w: 300, h: 224, row: 'bottom', glass: true },
    { id: 'approvals', label: 'Mesa de aprovações', x: 330, y: 300, w: 300, h: 224, row: 'bottom', glass: true },
    { id: 'owner', label: 'Sua sala', x: 644, y: 300, w: 300, h: 224, row: 'bottom' },
  ];
  const ENTRANCE_POINT = { x: 36, y: 283 };
  const ENTRANCE_KEY = 'om.office.entrance';
  const query = new URLSearchParams(location.search);
  const requestedAgent = query.get('agent') || 'mate';
  const requestedSuggestion = query.get('sugestao') || '';
  const state = {
    suggestions: [], agents: [], busy: false, canManage: false, userName: '', userInitial: '', orgName: '',
    activeAgentKey: /^[a-z0-9_-]{1,60}$/i.test(requestedAgent) ? requestedAgent.toLowerCase() : 'mate',
    contextRequest: 0, entityShown: false, meetingShown: 0, meetingTimer: 0, bubbleTick: 0, suggestionRun: false,
    chatKey: '', chatTyping: false, planScale: 1, pedidoRun: false,
    organizationId: '', userId: '', voicePrefs: { speakPending: false, voices: {} }, voiceOptions: [], defaultVoiceId: '',
    voiceLoading: false, voiceLoaded: false, voiceLoadPromise: null, voiceError: '', speechAudio: null, speechUrl: '', suggestionsLoaded: false, alertTimer: 0,
  };
  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
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

  function voicePrefsStorageKey() {
    return `${VOICE_PREFS_KEY}:${state.organizationId || location.host}:${state.userId || 'user'}`;
  }

  function loadVoicePrefs() {
    try {
      const saved = JSON.parse(localStorage.getItem(voicePrefsStorageKey()) || '{}');
      state.voicePrefs = {
        speakPending: saved.speakPending === true,
        voices: saved.voices && typeof saved.voices === 'object' ? saved.voices : {},
      };
    } catch {
      state.voicePrefs = { speakPending: false, voices: {} };
    }
    updateVoiceStatus();
  }

  function saveVoicePrefs() {
    try { localStorage.setItem(voicePrefsStorageKey(), JSON.stringify(state.voicePrefs)); } catch (_) {}
    updateVoiceStatus();
  }

  function updateVoiceStatus() {
    const button = $('#officeVoiceSettings');
    const status = $('#officeVoiceStatus');
    const enabled = state.voicePrefs.speakPending === true;
    if (button) button.dataset.enabled = String(enabled);
    if (status) status.textContent = enabled ? 'Avisos ativos' : 'Sob demanda';
  }

  function portugueseVoices() {
    return state.voiceOptions.filter((voice) => [...(voice.languages || []), voice.labels?.language].filter(Boolean)
      .some((language) => /(^pt\b|portuguese)/i.test(language)));
  }

  function preferredVoiceId(agent) {
    const saved = state.voicePrefs.voices?.[agent.key];
    if (saved === 'browser') return '';
    if (saved) return saved;
    if (agent.key === 'mate' && state.defaultVoiceId) return state.defaultVoiceId;
    const portuguese = portugueseVoices();
    const otherAgents = state.agents.filter((item) => item.key !== 'mate');
    const index = agent.key === 'mate' ? 0 : Math.max(0, otherAgents.findIndex((item) => item.key === agent.key)) + (state.defaultVoiceId ? 0 : 1);
    const distinctPortuguese = portuguese.filter((voice) => voice.voiceId !== state.defaultVoiceId);
    const voicePool = agent.key === 'mate' || !distinctPortuguese.length ? portuguese : distinctPortuguese;
    if (voicePool.length) return voicePool[index % voicePool.length]?.voiceId || '';
    return state.voiceOptions.length ? state.voiceOptions[index % state.voiceOptions.length]?.voiceId || '' : '';
  }

  function setVoiceMessage(message, isError) {
    const status = $('#officeVoiceMessage');
    if (!status) return;
    status.textContent = message || '';
    if (isError) status.dataset.error = 'true';
    else delete status.dataset.error;
  }

  function loadVoiceOptions() {
    if (state.voiceLoaded) return Promise.resolve();
    if (state.voiceLoadPromise) return state.voiceLoadPromise;
    state.voiceLoading = true;
    setVoiceMessage('Buscando as vozes disponíveis…');
    state.voiceLoadPromise = (async () => {
      try {
        const response = await fetch('/api/virtual-office/voices', { credentials: 'include', cache: 'no-store' });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || data.success === false) throw new Error(data.error || 'Não consegui carregar as vozes agora.');
        state.voiceOptions = Array.isArray(data.data?.voices) ? data.data.voices : [];
        state.defaultVoiceId = String(data.data?.default_voice_id || '');
        state.voiceError = '';
        setVoiceMessage(state.voiceOptions.length
          ? 'ElevenLabs está pronto. Você também pode escolher a voz do navegador.'
          : 'Nenhuma voz ElevenLabs foi encontrada. A voz do navegador continua disponível.');
      } catch (error) {
        state.voiceOptions = [];
        state.defaultVoiceId = '';
        state.voiceError = String(error?.message || 'ElevenLabs está indisponível.');
        setVoiceMessage(`${state.voiceError} Você ainda pode usar a voz do navegador.`, true);
      } finally {
        state.voiceLoaded = true;
        state.voiceLoading = false;
        state.voiceLoadPromise = null;
        renderVoiceRows();
      }
    })();
    return state.voiceLoadPromise;
  }

  function renderVoiceRows() {
    const host = $('#officeVoiceRows');
    if (!host) return;
    const agents = enabledAgents();
    if (!agents.length) {
      host.replaceChildren(makeNode('p', '', 'Não há funcionários ativos para configurar.'));
      return;
    }
    host.replaceChildren(...agents.map((agent) => {
      const row = makeNode('div', 'office-voice-row');
      const identity = makeNode('div', 'office-voice-row__identity');
      const face = makeNode('span', 'office-voice-row__face');
      face.appendChild(makeFace(agent.avatarKey, agent.key));
      face.setAttribute('aria-hidden', 'true');
      const identityCopy = makeNode('span');
      identityCopy.append(makeNode('strong', '', agent.name), makeNode('small', '', agent.title || AGENT_DEPARTMENTS[agent.department] || 'Equipe'));
      identity.append(face, identityCopy);

      const label = makeNode('label', 'office-voice-row__select');
      const selectId = `officeVoice-${agent.key.replace(/[^a-z0-9_-]/gi, '')}`;
      const caption = makeNode('span', '', `Voz de ${agent.name}`);
      const select = makeNode('select');
      select.id = selectId;
      select.dataset.officeVoiceAgent = agent.key;
      select.setAttribute('aria-label', `Voz de ${agent.name}`);
      select.appendChild(new Option('Voz do navegador', 'browser'));
      state.voiceOptions.forEach((voice) => {
        const language = (voice.languages || []).find((item) => /^pt/i.test(item));
        select.appendChild(new Option(`${voice.name}${language ? ` · ${language}` : ''}`, voice.voiceId));
      });
      label.htmlFor = selectId;
      label.append(caption, select);

      const test = makeNode('button', 'office-voice-row__test', 'Ouvir');
      test.type = 'button';
      test.dataset.officeVoiceTest = agent.key;
      test.setAttribute('aria-label', `Testar a voz de ${agent.name}`);
      row.append(identity, label, test);

      const chosen = state.voicePrefs.voices?.[agent.key]
        || preferredVoiceId(agent)
        || 'browser';
      select.value = chosen;
      if (!Array.from(select.options).some((option) => option.value === chosen)) select.value = 'browser';
      return row;
    }));
  }

  function stopAgentSpeech() {
    if (state.speechAudio) {
      state.speechAudio.pause();
      state.speechAudio.src = '';
      state.speechAudio = null;
    }
    if (state.speechUrl) {
      URL.revokeObjectURL(state.speechUrl);
      state.speechUrl = '';
    }
    if (window.speechSynthesis) window.speechSynthesis.cancel();
  }

  function speakWithBrowser(text) {
    if (!window.speechSynthesis || typeof window.SpeechSynthesisUtterance !== 'function') return false;
    stopAgentSpeech();
    const utterance = new window.SpeechSynthesisUtterance(text);
    utterance.lang = 'pt-BR';
    utterance.rate = 0.98;
    const voices = window.speechSynthesis.getVoices();
    utterance.voice = voices.find((voice) => /^pt(-|_)?br$/i.test(voice.lang))
      || voices.find((voice) => /^pt/i.test(voice.lang))
      || null;
    window.speechSynthesis.speak(utterance);
    return true;
  }

  async function speakAgent(agent, text) {
    const cleanText = String(text || '').trim().slice(0, 2000);
    if (!agent || !cleanText) return false;
    stopAgentSpeech();
    if (!state.voiceLoaded) await loadVoiceOptions();
    const voiceId = preferredVoiceId(agent);
    if (!voiceId) return speakWithBrowser(cleanText);
    try {
      const response = await fetch('/api/virtual-office/speech', {
        method: 'POST',
        credentials: 'include',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: cleanText, voice_id: voiceId }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || 'ElevenLabs não conseguiu gerar este áudio.');
      }
      const blob = await response.blob();
      if (!blob.size) throw new Error('O áudio retornou vazio.');
      state.speechUrl = URL.createObjectURL(blob);
      state.speechAudio = new Audio(state.speechUrl);
      state.speechAudio.addEventListener('ended', stopAgentSpeech, { once: true });
      await state.speechAudio.play();
      return true;
    } catch (_) {
      stopAgentSpeech();
      return speakWithBrowser(cleanText);
    }
  }

  function showOfficeAlert(suggestions) {
    const first = suggestions[0];
    const owner = ownerFor(first);
    if (!first || !owner) return;
    const toast = $('#officeAlertToast');
    if (!toast) return;
    const title = suggestions.length > 1
      ? `${suggestions.length} ações aguardam sua revisão`
      : `Uma atualização da ${owner.name}`;
    const greeting = state.userName ? `Oi, ${state.userName}!` : 'Oi!';
    const area = ({ central: 'da Coordenação', commercial: 'do Comercial', operations: 'de Operações', finance: 'do Financeiro' })[owner.department] || 'da equipe';
    const detail = `${greeting} Aqui é ${owner.name}, ${area}. ${first.title}${first.detail ? ` — ${first.detail}` : ''}. O próximo passo é ${first.run?.label || 'revisar com a equipe'}.`;
    setText('#officeAlertTitle', title);
    setText('#officeAlertMessage', suggestions.length > 1 ? `${detail} Também há outras ações esperando sua revisão.` : detail);
    toast.hidden = false;
    if (state.alertTimer) window.clearTimeout(state.alertTimer);
    state.alertTimer = window.setTimeout(() => { toast.hidden = true; }, 14_000);

    if (state.voicePrefs.speakPending) {
      const intro = `${greeting} Aqui é ${owner.name}, ${area}.`;
      const spoken = `${intro} ${first.title}. ${first.detail ? `${first.detail}. ` : ''}O próximo passo é ${first.run?.label || 'revisar isso comigo'}.${suggestions.length > 1 ? ` Também há mais ${suggestions.length - 1} ${suggestions.length === 2 ? 'ação' : 'ações'} esperando.` : ''}`;
      void speakAgent(owner, spoken);
    }
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

  function enabledAgents() {
    return state.agents.filter((agent) => agent.enabled);
  }

  function activeAgent() {
    return state.agents.find((agent) => agent.key === state.activeAgentKey && agent.enabled)
      || state.agents.find((agent) => agent.key === 'mate' && agent.enabled)
      || state.agents.find((agent) => agent.enabled)
      || null;
  }

  function deskTitle(agent) {
    return agent.key === 'mate' ? `Sala do ${agent.name}` : `Mesa de ${agent.name}`;
  }

  function agentHref(agent, extra) {
    const url = new URL('escritorio-ia.html', location.href);
    url.searchParams.set('agent', agent.key);
    Object.entries(extra || {}).forEach(([key, value]) => url.searchParams.set(key, value));
    return `${url.pathname}${url.search}#officeDesk`;
  }

  function renderActiveAgent() {
    const agent = activeAgent();
    if (!agent) return;
    if (agent.key !== state.activeAgentKey) {
      location.replace(agentHref(agent));
      return;
    }
    const avatar = $('#officeActiveAvatar');
    if (avatar) avatar.replaceChildren(makeFace(agent.avatarKey, agent.key));
    setText('#officeActiveName', deskTitle(agent));
    setText('#officeActiveTitle', agent.title || AGENT_DEPARTMENTS[agent.department] || 'Funcionário virtual');
    setText('#officeActiveDepartment', `${agent.key === 'mate' ? 'GERÊNCIA' : 'MESA'} · ${(AGENT_DEPARTMENTS[agent.department] || 'ESCRITÓRIO').toUpperCase()}`);
    const badge = $('#officeActiveBadge');
    if (badge) badge.hidden = agent.key === 'mate';
    const edit = $('#officeEditActive');
    if (edit) edit.hidden = !state.canManage;
    document.title = `${deskTitle(agent)} · Escritório ObraMate`;
  }

  function setCurrentEmpty() {
    const host = $('#officeCurrentWork');
    if (!host) return;
    if (renderMeeting()) return;
    setCurrentHeading(false);
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

  function addRecordContact(card, label, value, href) {
    if (!value) return;
    const row = makeNode('p', 'office-current-record__meta office-current-record__detail');
    row.append(makeNode('span', '', `${label}: `));
    if (href) {
      const link = makeNode('a', 'office-current-contact', value);
      link.href = href;
      row.appendChild(link);
    } else row.appendChild(document.createTextNode(value));
    card.appendChild(row);
  }

  function addRelatedRecord(card, label, title, detail, href) {
    const row = makeNode('div', 'office-current-related');
    const copy = makeNode('div', 'office-current-related__copy');
    copy.append(makeNode('span', '', label), makeNode('strong', '', title || label));
    if (detail) copy.appendChild(makeNode('small', '', detail));
    row.appendChild(copy);
    if (href) {
      const link = makeNode('a', 'office-current-related__link', 'Abrir');
      link.href = href;
      link.setAttribute('aria-label', `Abrir ${title || label}`);
      row.appendChild(link);
    }
    card.appendChild(row);
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

  function renderLeadRecord(record, leadId) {
    const host = $('#officeCurrentWork');
    if (!host) return;
    const card = makeNode('div', 'office-current-record');
    const stage = record.pipeline_stage_name || record.status || 'Novo lead';
    card.append(makeNode('span', 'office-current-record__kind', 'Comercial'), makeNode('h3', '', record.name || 'Lead'));
    card.appendChild(makeNode('p', 'office-current-record__meta', [stage, record.owner_name ? `Responsável: ${record.owner_name}` : null, record.source ? `Origem: ${record.source}` : null].filter(Boolean).join(' · ')));
    addRecordContact(card, 'Telefone', record.phone, record.phone ? `tel:${String(record.phone).replace(/[^+\d]/g, '')}` : null);
    addRecordContact(card, 'E-mail', record.email, record.email ? `mailto:${encodeURIComponent(record.email)}` : null);
    if (record.address) card.appendChild(makeNode('p', 'office-current-record__meta office-current-record__detail', record.address));
    if (record.next_visit_at) addRelatedRecord(card, 'Próxima visita', formatDate(record.next_visit_at), record.next_visit_address || '', 'schedule.html');
    if (record.followup_title || record.followup_due_at) {
      const due = record.followup_due_at ? `Para ${formatDate(record.followup_due_at, { dateStyle: 'medium' })}` : 'Sem data definida';
      addRelatedRecord(card, 'Follow-up', record.followup_title || 'Retorno pendente', [due, record.followup_notes].filter(Boolean).join(' · '), `lead-detail.html?id=${encodeURIComponent(leadId)}&tab=communication`);
    }
    if (record.notes) card.appendChild(makeNode('p', 'office-current-record__note', String(record.notes).slice(0, 260)));
    addRecordLink(card, `lead-detail.html?id=${encodeURIComponent(leadId)}`, 'Abrir lead');
    addRecordLink(card, `quote-builder.html?lead_id=${encodeURIComponent(leadId)}`, 'Preparar quote');
    host.replaceChildren(card);
  }

  function renderCustomerRecord(record, customerId) {
    const host = $('#officeCurrentWork');
    if (!host) return;
    const customer = record.customer || {};
    const stats = record.stats || {};
    const card = makeNode('div', 'office-current-record');
    const typeLabels = { particular: 'Residencial', builder: 'Builder', contractor: 'Contractor', loja: 'Loja' };
    const company = customer.company || customer.responsible_name;
    card.append(makeNode('span', 'office-current-record__kind', 'Cliente'), makeNode('h3', '', customer.name || 'Cliente'));
    card.appendChild(makeNode('p', 'office-current-record__meta', [typeLabels[customer.customer_type] || customer.customer_type, company ? `Contato: ${company}` : null, record.lead?.name ? `Origem: ${record.lead.name}` : null].filter(Boolean).join(' · ')));
    addRecordContact(card, 'Telefone', customer.phone, customer.phone ? `tel:${String(customer.phone).replace(/[^+\d]/g, '')}` : null);
    addRecordContact(card, 'E-mail', customer.email, customer.email ? `mailto:${encodeURIComponent(customer.email)}` : null);
    if (customer.address) card.appendChild(makeNode('p', 'office-current-record__meta office-current-record__detail', customer.address));

    const counts = [
      Number(stats.jobs_active) ? `${stats.jobs_active} obra${Number(stats.jobs_active) === 1 ? '' : 's'} ativa${Number(stats.jobs_active) === 1 ? '' : 's'}` : null,
      Number(stats.quotes_open) ? `${stats.quotes_open} quote${Number(stats.quotes_open) === 1 ? '' : 's'} em aberto` : null,
    ].filter(Boolean);
    if (counts.length) card.appendChild(makeNode('p', 'office-current-record__meta office-current-record__detail', counts.join(' · ')));
    if (record.show_money && stats.open_balance != null) addRecordTotal(card, 'Saldo em aberto', stats.open_balance);

    const activity = Array.isArray(record.activity) ? record.activity.slice(0, 3) : [];
    if (activity.length) {
      card.appendChild(makeNode('h4', 'office-current-related-heading', 'Atividade recente'));
      activity.forEach((item) => addRelatedRecord(card, formatDate(item.at, { dateStyle: 'medium' }), item.title, item.detail || '', item.href || null));
    }
    addRecordLink(card, `customers.html?id=${encodeURIComponent(customerId)}`, 'Abrir cliente');
    addRecordLink(card, `quote-builder.html?customer_id=${encodeURIComponent(customerId)}`, 'Novo quote');
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
    setCurrentHeading(false);
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
    if (type === 'lead') {
      fetchContextRecord(request, `/api/leads/${encodeURIComponent(entity.id)}`, renderLeadRecord, 'Lead', entity);
      return;
    }
    if (type === 'customer') {
      fetchContextRecord(request, `/api/customers/${encodeURIComponent(entity.id)}/overview`, renderCustomerRecord, 'Cliente', entity);
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
    state.entityShown = Boolean(entity && entity.id);
    showCurrentWork(entity);
  }

  function setCurrentHeading(meeting) {
    setText('#officeCurrentKicker', meeting ? 'REUNIÃO DO DIA' : 'CONTEXTO ATIVO');
    setText('#officeCurrentTitle', meeting ? 'O que a equipe trouxe' : 'Trabalho em andamento');
  }

  /* ───────── who owns what ───────── */

  function departmentFor(suggestion) {
    return ACTION_DEPARTMENTS[suggestion?.run?.action] || 'all';
  }

  function ownerFor(suggestion) {
    const department = departmentFor(suggestion);
    const wanted = department === 'all' ? 'central' : department;
    return enabledAgents().find((agent) => agent.department === wanted)
      || enabledAgents().find((agent) => agent.key === 'mate')
      || null;
  }

  function itemsFor(agent) {
    const wanted = agent.department === 'central' ? 'all' : agent.department;
    return state.suggestions.filter((item) => departmentFor(item) === wanted);
  }

  function needsYou(items) {
    return items.some((item) => item.tone === 'critical' || item.tone === 'warning');
  }

  function shortText(text, max) {
    const value = String(text || '').trim();
    return value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value;
  }

  function plural(count, one, many) {
    return `${count} ${count === 1 ? one : many}`;
  }

  function bubbleLines(agent) {
    if (agent.key === 'mate') {
      const total = state.suggestions.length;
      return total ? [plural(total, 'papel na mesa', 'papéis na mesa'), 'Coordenando a equipe'] : ['Equipe em dia'];
    }
    const items = itemsFor(agent);
    if (!items.length) return ['Em dia'];
    const first = shortText(items[0].title, 30);
    if (needsYou(items)) return ['Precisa de você', first];
    return [plural(items.length, 'próximo passo', 'próximos passos'), first];
  }

  function seatTone(agent) {
    if (agent.key === 'mate') return state.suggestions.length ? 'busy' : 'idle';
    const items = itemsFor(agent);
    if (needsYou(items)) return 'waiting';
    return items.length ? 'busy' : 'idle';
  }

  function joinNames(names) {
    if (names.length <= 1) return names.join('');
    return `${names.slice(0, -1).join(', ')} e ${names[names.length - 1]}`;
  }

  /* ───────── summary ───────── */

  function updateTimestamp() {
    const now = new Date();
    const time = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(now);
    setText('#officeUpdated', `Atualizado às ${time}`);
  }

  function renderCounts() {
    const urgent = state.suggestions.filter((item) => item.tone === 'critical' || item.tone === 'warning').length;
    const agents = enabledAgents();
    setText('#officeSuggestionCount', String(state.suggestions.length));
    setText('#officeUrgentCount', String(urgent));
    setText('#officeAgentCount', String(agents.length));
    const faces = $('#officeAgentFaces');
    if (faces) faces.replaceChildren(...agents.slice(0, 4).map((agent) => makeFace(agent.avatarKey, agent.key)));
  }

  /* ───────── floor plan ───────── */

  function roomById(id) {
    return ROOMS.find((room) => room.id === id) || null;
  }

  /** Doors open onto the corridor between the two rows. */
  function doorPoint(room) {
    if (!room) return ENTRANCE_POINT;
    return room.row === 'top'
      ? { x: room.x + room.w / 2, y: room.y + room.h + 17 }
      : { x: room.x + room.w / 2, y: room.y - 17 };
  }

  function placeMe(point) {
    const me = $('#officeMe');
    if (!me) return;
    me.style.left = `${point.x}px`;
    me.style.top = `${point.y}px`;
  }

  function walkTo(room, href) {
    placeMe(doorPoint(room));
    if (!href) return;
    if (reduceMotion) { location.href = href; return; }
    window.setTimeout(() => { location.href = href; }, 650);
  }

  function decor(className, x, y, extra) {
    const node = makeNode('span', `office-decor ${className}`);
    node.setAttribute('aria-hidden', 'true');
    node.style.left = `${x}px`;
    node.style.top = `${y}px`;
    if (extra) Object.entries(extra).forEach(([key, value]) => { node.style[key] = value; });
    return node;
  }

  function hello() {
    const hour = new Date().getHours();
    return hour < 12 ? 'Bom dia' : hour < 18 ? 'Boa tarde' : 'Boa noite';
  }

  function makeSeat(agent, x, y) {
    const tone = seatTone(agent);
    const seat = makeNode('div', `office-seat office-seat--${tone}${agent.key === state.activeAgentKey ? ' office-seat--active' : ''}`);
    seat.dataset.agentKey = agent.key;
    seat.style.left = `${x}px`;
    seat.style.top = `${y}px`;
    const lines = bubbleLines(agent);
    const bubble = makeNode('span', 'office-seat__bubble', lines[0]);
    bubble.dataset.lines = lines.join('|');
    const chair = makeNode('span', 'office-seat__chair');
    chair.setAttribute('aria-hidden', 'true');
    const face = makeNode('button', 'office-seat__face');
    face.type = 'button';
    face.dataset.chat = agent.key;
    face.setAttribute('aria-label', `Conversar com ${agent.name}, ${agent.title}. ${lines[0]}.`);
    face.appendChild(makeFace(agent.avatarKey, agent.key));
    if (agent.key !== 'mate') face.appendChild(makeNode('span', 'office-seat__ai', 'IA'));
    const desk = makeNode('span', `office-seat__desk${agent.key === 'mate' ? ' office-seat__desk--wide' : ''}`);
    desk.setAttribute('aria-hidden', 'true');
    desk.append(makeNode('span', 'office-seat__monitor'), makeNode('span', 'office-seat__mug'));
    const plate = makeNode('span', 'office-seat__plate');
    plate.append(makeNode('strong', '', agent.name), makeNode('small', '', agent.title));
    seat.append(bubble, chair, face, desk, plate);
    seat.addEventListener('mouseenter', () => {
      if (seat.classList.contains('is-talking')) return;
      bubble.dataset.saved = bubble.textContent;
      bubble.textContent = `Oi${state.userName ? `, ${state.userName}` : ''}!`;
      seat.classList.add('is-greeting');
    });
    seat.addEventListener('mouseleave', () => {
      if (bubble.dataset.saved) bubble.textContent = bubble.dataset.saved;
      delete bubble.dataset.saved;
      seat.classList.remove('is-greeting');
    });
    return seat;
  }

  function emptyDesk(x, y) {
    const desk = makeNode('div', 'office-seat office-seat--empty');
    desk.setAttribute('aria-hidden', 'true');
    desk.style.left = `${x}px`;
    desk.style.top = `${y}px`;
    const chair = makeNode('span', 'office-seat__chair');
    const surface = makeNode('span', 'office-seat__desk');
    surface.appendChild(makeNode('span', 'office-seat__monitor'));
    desk.append(chair, surface, makeNode('span', 'office-seat__plate office-seat__plate--empty', 'Mesa livre'));
    return desk;
  }

  function roomCount(room) {
    if (room.id === 'approvals' || room.id === 'owner') return null;
    const seated = enabledAgents().filter((agent) => agent.department === room.id);
    const items = room.id === 'central' ? state.suggestions : seated.flatMap((agent) => itemsFor(agent));
    if (!items.length) return null;
    return { count: items.length, waiting: room.id !== 'central' && needsYou(items) };
  }

  function makeRoom(room) {
    const el = makeNode('div', `office-room office-room--${room.id} office-room--${room.row}${room.glass ? ' office-room--glass' : ''}`);
    el.style.left = `${room.x}px`;
    el.style.top = `${room.y}px`;
    el.style.width = `${room.w}px`;
    el.style.height = `${room.h}px`;
    const active = activeAgent();
    if (active && active.department === room.id) el.classList.add('office-room--here');
    const hit = makeNode('button', 'office-room__hit');
    hit.type = 'button';
    hit.dataset.room = room.id;
    hit.setAttribute('aria-label', room.id === 'approvals' ? 'Ir para a mesa de aprovações' : `Ir para ${room.label}`);
    const head = makeNode('span', 'office-room__head');
    head.appendChild(makeNode('span', 'office-room__label', room.label));
    const count = roomCount(room);
    if (count) head.appendChild(makeNode('span', `office-room__count${count.waiting ? ' office-room__count--waiting' : ''}`, String(count.count)));
    const door = makeNode('span', 'office-room__door');
    door.setAttribute('aria-hidden', 'true');
    el.append(hit, head, door);
    if (room.row === 'top') {
      const windows = makeNode('span', 'office-room__windows');
      windows.setAttribute('aria-hidden', 'true');
      el.appendChild(windows);
    }

    if (room.id === 'approvals') {
      el.append(decor('office-decor--chair', 46, 102), decor('office-decor--chair', 234, 102), decor('office-decor--chair', 106, 54), decor('office-decor--chair', 174, 54), decor('office-decor--chair', 106, 152), decor('office-decor--chair', 174, 152));
      const table = makeNode('div', 'office-table');
      table.setAttribute('aria-hidden', 'true');
      state.suggestions.slice(0, 5).forEach((item, index) => {
        const paper = makeNode('span', 'office-table__paper');
        paper.style.setProperty('--tilt', `${(index % 2 ? 1 : -1) * (3 + index)}deg`);
        const owner = ownerFor(item);
        if (owner) paper.appendChild(makeFace(owner.avatarKey, owner.key));
        table.appendChild(paper);
      });
      const total = state.suggestions.length;
      el.append(table, makeNode('span', `office-table__count${total ? '' : ' office-table__count--clear'}`, total ? plural(total, 'papel esperando você', 'papéis esperando você') : 'Mesa limpa'));
      return el;
    }

    if (room.id === 'owner') {
      el.append(decor('office-decor--plant', 268, 182), decor('office-decor--shelf', 24, 44));
      const seat = makeNode('div', 'office-seat office-seat--owner');
      seat.setAttribute('aria-hidden', 'true');
      seat.style.left = `${room.w / 2}px`;
      seat.style.top = '122px';
      const chair = makeNode('span', 'office-seat__chair');
      const face = makeNode('span', 'office-seat__face office-seat__face--owner', state.userInitial || '•');
      const desk = makeNode('span', 'office-seat__desk office-seat__desk--wide');
      desk.appendChild(makeNode('span', 'office-seat__monitor'));
      const plate = makeNode('span', 'office-seat__plate');
      plate.append(makeNode('strong', '', state.userName || 'Você'), makeNode('small', '', 'Sua mesa'));
      seat.append(chair, face, desk, plate);
      el.appendChild(seat);
      return el;
    }

    if (room.id === 'central') {
      el.append(decor('office-decor--rug', 70, 64), decor('office-decor--armchair', 30, 158), decor('office-decor--armchair', 64, 168), decor('office-decor--plant', 266, 182));
    } else {
      el.append(decor('office-decor--plant', 266, 214));
    }

    const seated = enabledAgents().filter((agent) => agent.department === room.id);
    if (room.id === 'central') {
      seated.forEach((agent) => el.appendChild(makeSeat(agent, room.w / 2 + 20, 120)));
      if (!seated.length) el.appendChild(makeNode('span', 'office-room__empty', 'Sem gerente'));
      return el;
    }
    const slots = Math.max(2, seated.length);
    for (let index = 0; index < slots; index += 1) {
      const x = (room.w * (index + 1)) / (slots + 1);
      const agent = seated[index];
      el.appendChild(agent ? makeSeat(agent, x, 134) : emptyDesk(x, 134));
    }
    return el;
  }

  /** The plan is drawn at its full size and scaled down to fit narrower cards. */
  function fitPlan() {
    const scroll = $('.office-plan-scroll');
    const plan = $('#officePlan');
    if (!scroll || !plan) return;
    const available = scroll.clientWidth - 28;
    if (available <= 0) return;
    const scale = Math.min(1, available / PLAN.w);
    state.planScale = scale;
    plan.style.transform = scale < 1 ? `scale(${scale})` : '';
    scroll.style.height = `${Math.ceil(PLAN.h * scale) + 14}px`;
    positionChat();
  }

  function renderPlan() {
    const plan = $('#officePlan');
    if (!plan) return;
    plan.replaceChildren(...ROOMS.map(makeRoom));
    const corridor = makeNode('span', 'office-plan__corridor');
    corridor.setAttribute('aria-hidden', 'true');
    const entrance = makeNode('span', 'office-plan__entrance', 'ENTRADA');
    entrance.setAttribute('aria-hidden', 'true');
    const me = makeNode('div', 'office-me');
    me.id = 'officeMe';
    me.setAttribute('aria-hidden', 'true');
    me.append(makeNode('span', 'office-me__face', state.userInitial || '•'), makeNode('span', 'office-me__label', 'Você'));
    plan.prepend(corridor);
    plan.append(entrance, me);
    const entranceOpen = !$('#officeEntrance')?.hidden;
    const active = activeAgent();
    placeMe(entranceOpen || !active ? ENTRANCE_POINT : doorPoint(roomById(active.department)));
    if (state.chatKey) markTalking(state.chatKey);
    fitPlan();
  }

  function renderCorridor() {
    const list = $('#officeCorridor');
    if (!list) return;
    const rows = [];
    ROOMS.filter((room) => room.id !== 'owner').forEach((room) => {
      if (room.id === 'approvals') {
        const li = makeNode('li');
        const button = makeNode('button', 'office-corridor__item office-corridor__item--table');
        button.type = 'button';
        button.dataset.room = 'approvals';
        const count = state.suggestions.length;
        const copy = makeNode('span', 'office-corridor__copy');
        copy.append(makeNode('strong', '', room.label), makeNode('small', '', count ? plural(count, 'papel esperando você', 'papéis esperando você') : 'Mesa limpa'));
        button.append(makeNode('span', 'office-corridor__icon', String(count)), copy);
        li.appendChild(button);
        rows.push(li);
        return;
      }
      enabledAgents().filter((agent) => agent.department === room.id).forEach((agent) => {
        const li = makeNode('li');
        const button = makeNode('button', `office-corridor__item office-corridor__item--${seatTone(agent)}`);
        button.type = 'button';
        button.dataset.chat = agent.key;
        const face = makeNode('span', 'office-corridor__face');
        face.appendChild(makeFace(agent.avatarKey, agent.key));
        const copy = makeNode('span', 'office-corridor__copy');
        const title = makeNode('strong', '', agent.name);
        title.appendChild(makeNode('span', '', ` · ${room.label}`));
        copy.append(title, makeNode('small', '', bubbleLines(agent).join(' · ')));
        button.append(face, copy, makeNode('span', 'office-corridor__talk', 'Conversar'));
        li.appendChild(button);
        rows.push(li);
      });
    });
    list.replaceChildren(...rows);
  }

  function rotateBubbles() {
    state.bubbleTick += 1;
    $$('.office-seat:not(.is-talking):not(.is-greeting) .office-seat__bubble').forEach((bubble) => {
      if (bubble.dataset.flash) return;
      const lines = String(bubble.dataset.lines || '').split('|').filter(Boolean);
      if (lines.length > 1) bubble.textContent = lines[state.bubbleTick % lines.length];
    });
  }

  function focusApprovals() {
    const panel = $('#officeApprovals');
    if (!panel) return;
    placeMe(doorPoint(roomById('approvals')));
    panel.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'nearest' });
    panel.focus({ preventScroll: true });
  }

  function onRoomClick(event) {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const chat = target.closest('[data-chat]');
    if (chat) { openChat(chat.dataset.chat); return; }
    const hit = target.closest('[data-room]');
    if (!hit) return;
    const roomId = hit.dataset.room;
    if (roomId === 'approvals') { focusApprovals(); return; }
    const room = roomById(roomId);
    placeMe(doorPoint(room));
    const agent = enabledAgents().find((item) => item.department === roomId);
    if (agent) openChat(agent.key);
  }

  /* ───────── conversa rápida na mesa ───────── */

  const CHAT_KEY = 'om.office.chat.';

  function chatThread(key) {
    try { return JSON.parse(sessionStorage.getItem(CHAT_KEY + key) || '[]'); } catch (_) { return []; }
  }

  function saveThread(key, thread) {
    try { sessionStorage.setItem(CHAT_KEY + key, JSON.stringify(thread.slice(-20))); } catch (_) {}
  }

  function greetingFor(agent) {
    const name = state.userName ? `, ${state.userName}` : '';
    if (agent.key === 'mate') {
      const total = state.suggestions.length;
      return `${hello()}${name}! A equipe está toda nas mesas. ${total ? `Tem ${plural(total, 'papel', 'papéis')} te esperando na mesa de aprovações.` : 'Nada urgente hoje.'} Quer um resumo do dia?`;
    }
    const items = itemsFor(agent);
    if (!items.length) return `Oi${name}! Tudo em dia aqui no ${(AGENT_DEPARTMENTS[agent.department] || 'setor').toLowerCase()}. Precisa de alguma coisa?`;
    const first = String(items[0].title || '').trim();
    if (needsYou(items)) return `${hello()}${name}! Que bom que passou aqui. ${first}. Quer que eu prepare?`;
    return `Oi${name}! Tô com ${plural(items.length, 'coisa', 'coisas')} aqui: ${first}. Posso ajudar em algo?`;
  }

  function chipsFor(agent) {
    const items = agent.key === 'mate' ? state.suggestions : itemsFor(agent);
    const chips = [];
    if (agent.key === 'mate') chips.push({ text: 'Me dá um resumo do dia' });
    else if (items[0]?.run?.action) chips.push({ text: 'Pode preparar', run: items[0] });
    chips.push({ text: 'Tudo bem por aí?' });
    chips.push({ text: items.length ? 'Me explica melhor' : 'O que você faz por aqui?' });
    return chips;
  }

  function seatOf(key) {
    return $(`.office-seat[data-agent-key="${CSS.escape(key)}"]`);
  }

  function markTalking(key) {
    $$('.office-seat.is-talking').forEach((seat) => seat.classList.remove('is-talking'));
    const seat = key ? seatOf(key) : null;
    if (seat) seat.classList.add('is-talking');
  }

  function flashBubble(key, text) {
    const bubble = seatOf(key)?.querySelector('.office-seat__bubble');
    if (!bubble) return;
    bubble.textContent = shortText(text, 34);
    bubble.dataset.flash = '1';
    window.setTimeout(() => {
      delete bubble.dataset.flash;
      const lines = String(bubble.dataset.lines || '').split('|');
      bubble.textContent = lines[0] || '';
    }, 6000);
  }

  function positionChat() {
    const chat = $('#officeChat');
    const floor = $('.office-floor');
    if (!chat || chat.hidden || !floor || !state.chatKey) return;
    if (window.matchMedia('(max-width: 760px)').matches) { chat.style.left = ''; chat.style.top = ''; return; }
    const seat = seatOf(state.chatKey);
    if (!seat) return;
    const seatBox = seat.getBoundingClientRect();
    const floorBox = floor.getBoundingClientRect();
    const width = chat.offsetWidth || 340;
    const height = chat.offsetHeight || 420;
    let left = seatBox.right - floorBox.left + 12;
    if (left + width > floorBox.width - 8) left = seatBox.left - floorBox.left - width - 12;
    left = Math.max(8, Math.min(left, floorBox.width - width - 8));
    let top = seatBox.top - floorBox.top - 40;
    top = Math.max(8, Math.min(top, floorBox.height - height - 8));
    chat.style.left = `${left}px`;
    chat.style.top = `${top}px`;
  }

  function renderChat() {
    const agent = state.agents.find((item) => item.key === state.chatKey);
    const log = $('#officeChatLog');
    if (!agent || !log) return;
    const thread = chatThread(agent.key);
    const rows = thread.map((message) => {
      const row = makeNode('div', `office-chat__msg office-chat__msg--${message.role}`);
      row.appendChild(makeNode('p', '', message.text));
      if (message.card) {
        const card = makeNode('div', 'office-chat__card');
        if (message.card.title) card.appendChild(makeNode('strong', '', message.card.title));
        if (message.card.rows.length) {
          const list = makeNode('ul');
          message.card.rows.forEach((item) => {
            const li = makeNode('li');
            li.appendChild(makeNode('span', '', item.title));
            if (item.detail) li.appendChild(makeNode('small', '', item.detail));
            list.appendChild(li);
          });
          card.appendChild(list);
        }
        if (message.card.more) card.appendChild(makeNode('small', 'office-chat__more', `e mais ${message.card.more}`));
        row.appendChild(card);
      }
      if (message.pedido) {
        const open = makeNode('a', 'office-chat__open', message.link || 'Abrir na minha mesa');
        open.href = agentHref(agent, { pedido: message.pedido });
        row.appendChild(open);
      }
      if (message.role === 'assistant' && message.text) {
        const listen = makeNode('button', 'office-chat__speak', 'Ouvir resposta');
        listen.type = 'button';
        listen.setAttribute('aria-label', `Ouvir resposta de ${agent.name}`);
        listen.addEventListener('click', async () => {
          listen.disabled = true;
          listen.textContent = 'Preparando voz…';
          const played = await speakAgent(agent, message.text);
          listen.disabled = false;
          listen.textContent = played ? 'Repetir resposta' : 'Voz indisponível';
        });
        row.appendChild(listen);
      }
      return row;
    });
    if (state.chatTyping) {
      const typing = makeNode('div', 'office-chat__msg office-chat__msg--assistant office-chat__typing');
      typing.setAttribute('aria-label', `${agent.name} está digitando`);
      typing.append(makeNode('span'), makeNode('span'), makeNode('span'));
      rows.push(typing);
    }
    log.replaceChildren(...rows);
    log.scrollTop = log.scrollHeight;
    const chips = $('#officeChatChips');
    if (chips) {
      chips.replaceChildren(...chipsFor(agent).map((chip, index) => {
        const button = makeNode('button', 'office-chat__chip', chip.text);
        button.type = 'button';
        button.dataset.chip = String(index);
        return button;
      }));
      chips.hidden = state.chatTyping;
    }
  }

  function openChat(key) {
    const agent = state.agents.find((item) => item.key === key && item.enabled);
    const chat = $('#officeChat');
    if (!agent || !chat) return;
    stopAgentSpeech();
    state.chatKey = agent.key;
    const room = roomById(agent.department);
    if (room && window.matchMedia('(min-width: 761px)').matches) placeMe(doorPoint(room));
    const face = $('#officeChatFace');
    if (face) face.replaceChildren(makeFace(agent.avatarKey, agent.key));
    setText('#officeChatName', agent.name);
    setText('#officeChatTitle', agent.title);
    const badge = $('#officeChatBadge');
    if (badge) badge.hidden = agent.key === 'mate';
    const desk = $('#officeChatDesk');
    if (desk) desk.href = agentHref(agent);
    const input = $('#officeChatInput');
    if (input) input.placeholder = `Fale com ${agent.name}…`;
    chat.hidden = false;
    markTalking(agent.key);
    const thread = chatThread(agent.key);
    const last = thread[thread.length - 1];
    const stale = !last || Date.now() - (last.at || 0) > 30 * 60 * 1000;
    if (stale) {
      state.chatTyping = true;
      renderChat();
      positionChat();
      window.setTimeout(() => {
        if (state.chatKey !== agent.key) return;
        const next = chatThread(agent.key);
        next.push({ role: 'assistant', text: greetingFor(agent), at: Date.now() });
        saveThread(agent.key, next);
        state.chatTyping = false;
        renderChat();
        positionChat();
      }, reduceMotion ? 0 : 650);
    } else {
      state.chatTyping = false;
      renderChat();
      positionChat();
    }
    input?.focus({ preventScroll: true });
  }

  function closeChat() {
    stopAgentSpeech();
    const chat = $('#officeChat');
    if (chat) chat.hidden = true;
    state.chatKey = '';
    state.chatTyping = false;
    markTalking('');
  }

  async function sendChat(text) {
    const agent = state.agents.find((item) => item.key === state.chatKey);
    const message = String(text || '').trim();
    if (!agent || !message || state.chatTyping) return;
    const key = agent.key;
    const thread = chatThread(key);
    const memory = thread.slice(-8).map((item) => ({ role: item.role === 'user' ? 'user' : 'assistant', text: String(item.text).slice(0, 900) }));
    thread.push({ role: 'user', text: message, at: Date.now() });
    saveThread(key, thread);
    state.chatTyping = true;
    renderChat();
    let reply = { role: 'assistant', text: '', at: Date.now() };
    try {
      const response = await fetch('/api/mate-ai/act', {
        method: 'POST',
        credentials: 'include',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: message, agent_key: key, memory }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.success === false) throw new Error(data.error || 'Não consegui responder agora.');
      if (data.type === 'reply') {
        reply.text = String(data.message || 'Certo!');
      } else if ((data.type === 'answer' || data.read_only) && data.card) {
        // Questions answered by a read-only lookup show the answer right here.
        reply.card = summarizeCard(data.card);
        reply.text = String(data.message || (reply.card.rows.length ? 'Olha o que eu achei:' : 'Não achei nada por aqui.'));
        reply.pedido = message;
        reply.link = 'Ver na mesa';
      } else {
        const heading = data.card?.title ? `“${data.card.title}”` : 'isso';
        reply.text = data.type === 'error'
          ? String(data.message || 'Não consegui preparar isso.')
          : `${data.message ? `${data.message} ` : ''}Preparei ${heading} na minha mesa. Dá uma olhada antes de eu seguir?`;
        if (data.type !== 'error') reply.pedido = message;
      }
    } catch (error) {
      reply.text = 'Tive um problema ao preparar isso. Tente novamente daqui a pouco.';
    }
    const next = chatThread(key);
    next.push(reply);
    saveThread(key, next);
    if (state.chatKey === key) {
      state.chatTyping = false;
      renderChat();
    }
    flashBubble(key, reply.text);
  }

  /** Compact text version of an answer card (lists, fields, totals, tables, notes). */
  function summarizeCard(card) {
    const rows = [];
    (Array.isArray(card?.sections) ? card.sections : []).forEach((section) => {
      if (section.type === 'list') (section.items || []).forEach((item) => rows.push({ title: String(item.title || ''), detail: [item.detail, item.meta].filter(Boolean).join(' · ') }));
      else if (section.type === 'fields' || section.type === 'totals') (section.rows || []).forEach((item) => rows.push({ title: String(item.label || ''), detail: String(item.value ?? '') }));
      else if (section.type === 'table') (section.rows || []).forEach((cells) => rows.push({ title: String(cells[0] || ''), detail: cells.slice(1).filter(Boolean).join(' · ') }));
      else if (section.type === 'pick') (section.items || []).forEach((item) => rows.push({ title: String(item.title || ''), detail: [item.detail, item.meta].filter(Boolean).join(' · ') }));
      else if (section.type === 'note' && section.text) rows.push({ title: String(section.text), detail: '' });
    });
    const clean = rows.filter((item) => item.title);
    return { title: String(card?.title || ''), rows: clean.slice(0, 6), more: Math.max(0, clean.length - 6) };
  }

  function onChatChip(event) {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const button = target.closest('[data-chip]');
    const agent = state.agents.find((item) => item.key === state.chatKey);
    if (!button || !agent) return;
    const chip = chipsFor(agent)[Number(button.dataset.chip)];
    if (!chip) return;
    if (chip.run) { walkTo(roomById(agent.department), agentHref(agent, { sugestao: chip.run.run.action })); return; }
    sendChat(chip.text);
  }

  function runRequestedPedido() {
    const pedido = query.get('pedido');
    if (!pedido || state.pedidoRun) return;
    state.pedidoRun = true;
    const url = new URL(location.href);
    url.searchParams.delete('pedido');
    history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
    let tries = 0;
    const attempt = () => {
      if (window.MateAI && typeof window.MateAI.ask === 'function') {
        window.MateAI.ask(pedido.slice(0, 600));
        $('#officeDesk')?.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
        return;
      }
      tries += 1;
      if (tries < 30) window.setTimeout(attempt, 100);
    };
    attempt();
  }

  /* ───────── entrance ───────── */

  function todayKey() {
    const now = new Date();
    return `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
  }

  function entranceSeenToday() {
    try { return localStorage.getItem(ENTRANCE_KEY) === todayKey(); } catch (_) { return true; }
  }

  function showEntrance() {
    const entrance = $('#officeEntrance');
    if (!entrance) return;
    const hour = new Date().getHours();
    const hello = hour < 12 ? 'Bom dia' : hour < 18 ? 'Boa tarde' : 'Boa noite';
    const names = enabledAgents().filter((agent) => agent.key !== 'mate').map((agent) => agent.name);
    const count = state.suggestions.length;
    const team = names.length ? `${joinNames(names)} ${names.length === 1 ? 'já está na mesa' : 'já estão nas mesas'}.` : 'O escritório está pronto.';
    const papers = count ? `Deixei ${plural(count, 'papel', 'papéis')} na mesa de aprovações para você.` : 'A mesa de aprovações está limpa.';
    setText('#officeEntranceText', `${hello}${state.userName ? `, ${state.userName}` : ''}! ${team} ${papers}`);
    entrance.classList.remove('is-leaving');
    entrance.hidden = false;
    placeMe(ENTRANCE_POINT);
    $('#officeEnter')?.focus({ preventScroll: true });
  }

  function enterOffice() {
    const entrance = $('#officeEntrance');
    try { localStorage.setItem(ENTRANCE_KEY, todayKey()); } catch (_) {}
    if (!entrance) return;
    const finish = () => {
      entrance.hidden = true;
      const active = activeAgent();
      placeMe(active ? doorPoint(roomById(active.department)) : ENTRANCE_POINT);
    };
    if (reduceMotion) { finish(); return; }
    entrance.classList.add('is-leaving');
    window.setTimeout(finish, 700);
  }

  /* ───────── mesa de aprovações ───────── */

  function runSuggestion(item) {
    if (!item?.run?.action) return;
    let tries = 0;
    const attempt = () => {
      if (window.MateAI && typeof window.MateAI.run === 'function') {
        window.MateAI.run(item.run.action, item.run.args || {});
        $('#officeDesk')?.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
        return;
      }
      tries += 1;
      if (tries < 30) window.setTimeout(attempt, 100);
    };
    attempt();
  }

  function makeTask(item, index) {
    const department = departmentFor(item);
    const details = DEPARTMENTS[department] || DEPARTMENTS.all;
    const tone = ['critical', 'warning', 'accent', 'neutral'].includes(item.tone) ? item.tone : 'neutral';
    const owner = ownerFor(item);
    const article = makeNode('article', `office-task office-task--${tone}`);
    article.dataset.department = department;

    const mark = makeNode('span', 'office-task__mark');
    mark.setAttribute('aria-hidden', 'true');
    if (owner) mark.appendChild(makeFace(owner.avatarKey, owner.key));
    else mark.textContent = details.icon;

    const body = makeNode('div', 'office-task__body');
    body.append(
      makeNode('div', 'office-task__meta', `${owner ? `${owner.name} deixou na mesa` : details.label} · ${TONE_LABELS[tone]}`),
      makeNode('h3', 'office-task__title', String(item.title || 'Recomendação do Mate')),
    );
    if (item.detail) body.appendChild(makeNode('p', 'office-task__detail', String(item.detail)));

    const actions = makeNode('div', 'office-task__actions');
    if (owner && item.run?.action) {
      const resolve = makeNode('button', 'office-task__resolve', `Resolver com ${owner.name}`);
      resolve.type = 'button';
      resolve.dataset.taskIndex = String(index);
      actions.appendChild(resolve);
    }
    const link = makeNode('a', 'office-task__link', details.link);
    link.href = details.href;
    actions.appendChild(link);
    body.appendChild(actions);

    article.append(mark, body);
    return article;
  }

  function renderTasks() {
    const host = $('#officeTasks');
    if (!host) return;
    host.setAttribute('aria-busy', 'false');
    const count = state.suggestions.length;
    setText('#officeTasksTitle', count ? `${plural(count, 'papel', 'papéis')} esperando você` : 'Esperando você');
    if (!count) {
      const empty = makeNode('div', 'office-empty');
      empty.append(makeNode('strong', '', 'Mesa limpa'), makeNode('span', '', 'Quando alguém da equipe precisar do seu OK, o papel aparece aqui.'));
      host.replaceChildren(empty);
      return;
    }
    host.replaceChildren(...state.suggestions.map(makeTask));
  }

  function onTaskClick(event) {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const button = target.closest('[data-task-index]');
    if (!button) return;
    const item = state.suggestions[Number(button.dataset.taskIndex)];
    const owner = ownerFor(item);
    if (!item || !owner) return;
    if (owner.key === state.activeAgentKey) runSuggestion(item);
    else walkTo(roomById(owner.department), agentHref(owner, { sugestao: item.run.action }));
  }

  function runRequestedSuggestion() {
    if (!requestedSuggestion || state.suggestionRun) return;
    state.suggestionRun = true;
    const item = state.suggestions.find((suggestion) => suggestion?.run?.action === requestedSuggestion);
    const url = new URL(location.href);
    url.searchParams.delete('sugestao');
    history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
    if (item) runSuggestion(item);
  }

  /* ───────── reunião do dia (na sala do Mate) ───────── */

  function meetingReports() {
    return enabledAgents().filter((agent) => agent.key !== 'mate').map((agent) => {
      const items = itemsFor(agent);
      const text = items.length
        ? `${String(items[0].title || 'Tenho um próximo passo').trim()}${items.length > 1 ? `, e mais ${items.length - 1}` : ''}.`
        : 'Tudo em dia por aqui.';
      return { agent, text, waiting: needsYou(items) };
    });
  }

  function renderMeeting() {
    const agent = activeAgent();
    const host = $('#officeCurrentWork');
    if (!host || !agent || agent.key !== 'mate' || state.entityShown) return false;
    setCurrentHeading(true);
    const reports = meetingReports();
    const wrap = makeNode('div', 'office-meeting');
    if (!reports.length) {
      wrap.appendChild(makeNode('p', 'office-meeting__intro', 'Ainda não há funcionários no escritório além do Mate.'));
      host.replaceChildren(wrap);
      return true;
    }
    const shown = Math.min(state.meetingShown, reports.length);
    if (!shown) {
      wrap.appendChild(makeNode('p', 'office-meeting__intro', `${plural(reports.length, 'pessoa trouxe', 'pessoas trouxeram')} novidades hoje. Cada uma fala em uma frase.`));
      const start = makeNode('button', 'office-button office-button--dark office-meeting__start', 'Começar a reunião');
      start.type = 'button';
      start.dataset.meeting = 'start';
      wrap.appendChild(start);
      host.replaceChildren(wrap);
      return true;
    }
    reports.slice(0, shown).forEach((report) => {
      const row = makeNode('article', `office-meeting__report${report.waiting ? ' office-meeting__report--waiting' : ''}`);
      const face = makeNode('span', 'office-meeting__face');
      face.appendChild(makeFace(report.agent.avatarKey, report.agent.key));
      const copy = makeNode('div', 'office-meeting__copy');
      const who = makeNode('strong', '', report.agent.name);
      who.appendChild(makeNode('small', '', report.agent.title));
      const link = makeNode('a', 'office-meeting__link', 'Ir até a mesa');
      link.href = agentHref(report.agent);
      copy.append(who, makeNode('p', '', `“${report.text}”`), link);
      row.append(face, copy);
      wrap.appendChild(row);
    });
    if (shown >= reports.length) {
      const waiting = reports.filter((report) => report.waiting).length;
      wrap.appendChild(makeNode('p', 'office-meeting__wrap', waiting
        ? `Ficaram ${plural(waiting, 'decisão', 'decisões')} com você. Está tudo na mesa de aprovações.`
        : 'Nada urgente hoje. A equipe segue nos próximos passos.'));
    }
    host.replaceChildren(wrap);
    return true;
  }

  function startMeeting() {
    window.clearInterval(state.meetingTimer);
    const total = meetingReports().length;
    state.meetingShown = 1;
    renderMeeting();
    if (reduceMotion) { state.meetingShown = total; renderMeeting(); return; }
    state.meetingTimer = window.setInterval(() => {
      if (state.meetingShown >= total || state.entityShown) { window.clearInterval(state.meetingTimer); return; }
      state.meetingShown += 1;
      renderMeeting();
    }, 1400);
  }

  /* ───────── editar perfil (crachá) ───────── */

  function avatarOwners(exceptKey) {
    const owners = {};
    state.agents.forEach((agent) => { if (agent.key !== exceptKey && agent.key !== 'mate') owners[agent.avatarKey] = agent.name; });
    return owners;
  }

  function updateBadge() {
    const key = $('#agentKey')?.value;
    const name = $('#agentName')?.value.trim() || 'Sem nome';
    const title = $('#agentTitle')?.value.trim() || 'Cargo';
    const department = AGENT_DEPARTMENTS[$('#agentDepartment')?.value] || 'Escritório';
    const selected = $('.office-avatar-choice[aria-pressed="true"]')?.dataset.avatarKey
      || state.agents.find((agent) => agent.key === key)?.avatarKey || 'avatar-1';
    const photo = $('#agentBadgePhoto');
    if (photo) photo.replaceChildren(makeFace(selected, key));
    setText('#agentBadgeName', name);
    setText('#agentBadgeTitle', title);
    setText('#agentBadgeSeal', key === 'mate' ? `GERENTE GERAL · ${department.toUpperCase()}` : `ASSISTENTE DE IA · ${department.toUpperCase()}`);
    setText('#agentBadgeOrg', state.orgName || 'ObraMate');
    setText('#agentBadgeSignature', `${name} · ${title} (AI assistant) — ${state.orgName || 'ObraMate'}`);
  }

  function selectAvatar(avatarKey) {
    $$('.office-avatar-choice').forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.avatarKey === avatarKey));
    });
    updateBadge();
  }

  function buildEditorChoices(agent) {
    const avatars = $('#agentAvatarChoices');
    const capabilities = $('#agentCapabilities');
    if (avatars) {
      avatars.replaceChildren();
      if (agent.key === 'mate') {
        const mateImage = makeNode('div', 'office-avatar-choice office-avatar-choice--mate');
        mateImage.setAttribute('role', 'img');
        mateImage.setAttribute('aria-label', 'Mascote ObraMate');
        mateImage.appendChild(makeFace(agent.avatarKey, 'mate'));
        avatars.appendChild(mateImage);
      } else {
        const owners = avatarOwners(agent.key);
        Object.keys(FACE_IMAGES).forEach((avatarKey, index) => {
          const button = makeNode('button', `office-avatar-choice${owners[avatarKey] ? ' office-avatar-choice--taken' : ''}`);
          button.type = 'button';
          button.dataset.avatarKey = avatarKey;
          button.setAttribute('aria-label', owners[avatarKey] ? `Rosto ${index + 1}, em uso por ${owners[avatarKey]}` : `Rosto ${index + 1}`);
          button.setAttribute('aria-pressed', String(agent.avatarKey === avatarKey));
          button.appendChild(makeFace(avatarKey));
          if (owners[avatarKey]) button.appendChild(makeNode('span', 'office-avatar-choice__taken', owners[avatarKey]));
          avatars.appendChild(button);
        });
      }
    }
    if (capabilities) {
      capabilities.replaceChildren();
      CAPABILITY_OPTIONS.forEach((option) => {
        const label = makeNode('label', 'office-capability-option');
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.name = 'capabilities';
        input.value = option.key;
        input.checked = (agent.capabilities || []).includes(option.key);
        label.append(input, makeNode('span', '', option.label));
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
    const fixed = agent.key === 'mate';
    $('#agentName').readOnly = fixed;
    setText('#agentDialogTitle', `Editar perfil · ${agent.name}`);
    const error = $('#agentFormError');
    if (error) { error.hidden = true; error.textContent = ''; }
    buildEditorChoices(agent);
    updateBadge();
    dialog.showModal();
    (fixed ? $('#agentTitle') : $('#agentName')).focus();
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
      renderOffice();
      $('#agentDialog').close();
      setText('#officeUpdated', `Perfil de ${data.data?.name || 'funcionário'} salvo`);
    } catch (err) {
      if (error) {
        error.hidden = false;
        error.textContent = String(err?.message || 'Não foi possível salvar o perfil.');
      }
    } finally {
      if (save) { save.disabled = false; save.textContent = 'Salvar perfil'; }
    }
  }

  /* ───────── loading ───────── */

  function renderOffice() {
    renderCounts();
    renderActiveAgent();
    renderPlan();
    renderCorridor();
    renderTasks();
    if (!state.entityShown) setCurrentEmpty();
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
    state.userName = userName;
    state.userInitial = userName ? userName.charAt(0).toUpperCase() : '';
    state.orgName = data.organization?.name || '';
    state.organizationId = String(data.organization?.id || location.host);
    state.userId = String(data.user?.id || 'user');
    loadVoicePrefs();
    setText('#officeWelcome', userName
      ? `Olá, ${userName}. A equipe trabalha aqui; tudo o que vai para o cliente passa por você.`
      : 'A equipe trabalha aqui; tudo o que vai para o cliente passa por você.');
    setText('#officeOrgName', state.orgName || 'Escritório ObraMate');
  }

  async function loadAgents() {
    const response = await fetch(API_AGENTS, { credentials: 'include', cache: 'no-store' });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.success === false) {
      throw new Error(data.error || 'Não foi possível carregar os funcionários virtuais.');
    }
    state.agents = Array.isArray(data.data) ? data.data : [];
    if ($('#officeVoiceDialog')?.open) renderVoiceRows();
  }

  async function loadSuggestions() {
    const suggestionKey = (item) => `${item.id}:${item.title}`;
    const previousIds = new Set(state.suggestions.map(suggestionKey));
    const response = await fetch(API_SUGGESTIONS, { credentials: 'include', cache: 'no-store' });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.success === false) {
      throw new Error(data.error || 'Não foi possível carregar as recomendações do Mate.');
    }
    const priority = { critical: 0, warning: 1, accent: 2, neutral: 3 };
    state.suggestions = (Array.isArray(data.data) ? data.data : []).slice().sort((a, b) =>
      (priority[a.tone] ?? 4) - (priority[b.tone] ?? 4),
    );
    if (state.suggestionsLoaded) {
      const newUrgent = state.suggestions.filter((item) =>
        !previousIds.has(suggestionKey(item)) && (item.tone === 'critical' || item.tone === 'warning'),
      );
      if (newUrgent.length) showOfficeAlert(newUrgent);
    }
    state.suggestionsLoaded = true;
    if (typeof window.pullCrmNotifications === 'function') window.pullCrmNotifications();
  }

  async function refresh(first) {
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
      const results = await Promise.allSettled([loadSuggestions(), loadAgents()]);
      renderOffice();
      updateTimestamp();
      if (first === true && !query.has('agent') && !entranceSeenToday()) showEntrance();
      runRequestedSuggestion();
      runRequestedPedido();
      const failed = results.find((result) => result.status === 'rejected');
      if (failed) throw failed.reason;
    } catch (err) {
      const message = String(err?.message || 'Erro ao carregar o escritório.');
      if (!message.includes('Entre novamente') && !message.includes('troca de senha') && error) {
        error.hidden = false;
        error.textContent = message;
      }
    } finally {
      document.body.classList.remove('is-loading');
      if (refreshButton) refreshButton.disabled = false;
      state.busy = false;
    }
  }

  function bindControls() {
    window.addEventListener('mate:office-context', onOfficeContext);
    if (window.__mateAiOfficeContext) {
      const entity = window.__mateAiOfficeContext.entity || null;
      state.entityShown = Boolean(entity && entity.id);
      showCurrentWork(entity);
    }
    $('#officeRefresh')?.addEventListener('click', () => refresh(false));
    $('#officeVoiceSettings')?.addEventListener('click', async () => {
      const dialog = $('#officeVoiceDialog');
      if (!dialog) return;
      if (!dialog.open) dialog.showModal();
      const toggle = $('#officeVoiceAlerts');
      if (toggle) toggle.checked = state.voicePrefs.speakPending === true;
      await loadVoiceOptions();
    });
    $('#officeVoiceAlerts')?.addEventListener('change', (event) => {
      state.voicePrefs.speakPending = Boolean(event.target.checked);
      saveVoicePrefs();
      setVoiceMessage(state.voicePrefs.speakPending
        ? 'Pronto. Avisos prioritários novos serão falados enquanto o Escritório estiver aberto.'
        : 'Os avisos continuam no sino e na mesa. A fala automática está desativada.');
    });
    $('#officeVoiceRows')?.addEventListener('change', (event) => {
      const target = event.target;
      if (!(target instanceof HTMLSelectElement) || !target.dataset.officeVoiceAgent) return;
      state.voicePrefs.voices[target.dataset.officeVoiceAgent] = target.value || 'browser';
      saveVoicePrefs();
      const agent = state.agents.find((item) => item.key === target.dataset.officeVoiceAgent);
      setVoiceMessage(`A voz de ${agent?.name || 'funcionário'} foi atualizada.`);
    });
    $('#officeVoiceRows')?.addEventListener('click', async (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const button = target.closest('[data-office-voice-test]');
      if (!button) return;
      const agent = state.agents.find((item) => item.key === button.dataset.officeVoiceTest);
      if (!agent) return;
      button.disabled = true;
      button.textContent = 'Preparando…';
      const played = await speakAgent(agent, `Oi, aqui é ${agent.name}, ${agent.title.toLowerCase()}. Vou avisar você com clareza quando houver um próximo passo importante na minha área.`);
      button.disabled = false;
      button.textContent = played ? 'Ouvir' : 'Indisponível';
      setVoiceMessage(played ? `Você ouviu a voz de ${agent.name}.` : 'Este navegador não tem uma voz disponível.');
    });
    $('#officeVoiceTest')?.addEventListener('click', async () => {
      const agent = activeAgent();
      if (!agent) return;
      const played = await speakAgent(agent, `Oi${state.userName ? `, ${state.userName}` : ''}! Aqui é ${agent.name}. Esta é a voz que vou usar para conversar e avisar você sobre ações pendentes.`);
      setVoiceMessage(played ? `Você ouviu a voz de ${agent.name}.` : 'Este navegador não tem uma voz disponível.');
    });
    $('#officeAlertDismiss')?.addEventListener('click', () => {
      const toast = $('#officeAlertToast');
      if (toast) toast.hidden = true;
      if (state.alertTimer) window.clearTimeout(state.alertTimer);
      state.alertTimer = 0;
    });
    $('#officeAlertOpen')?.addEventListener('click', () => {
      const panel = $('#officeApprovals');
      panel?.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' });
      panel?.focus({ preventScroll: true });
      const toast = $('#officeAlertToast');
      if (toast) toast.hidden = true;
    });
    $('#officePlan')?.addEventListener('click', onRoomClick);
    $('#officeCorridor')?.addEventListener('click', onRoomClick);
    $('#officeTasks')?.addEventListener('click', onTaskClick);
    $('#officeChatClose')?.addEventListener('click', closeChat);
    $('#officeChatChips')?.addEventListener('click', onChatChip);
    $('#officeChatForm')?.addEventListener('submit', (event) => {
      event.preventDefault();
      const input = $('#officeChatInput');
      const text = input ? input.value : '';
      if (input) input.value = '';
      sendChat(text);
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && state.chatKey && !$('#agentDialog')?.open) closeChat();
    });
    $('#officeEnter')?.addEventListener('click', enterOffice);
    $('#officeReplayEntrance')?.addEventListener('click', showEntrance);
    $('#officeEditActive')?.addEventListener('click', () => { const agent = activeAgent(); if (agent) openAgentEditor(agent.key); });
    $('#officeCurrentWork')?.addEventListener('click', (event) => {
      const target = event.target;
      if (target instanceof Element && target.closest('[data-meeting="start"]')) startMeeting();
    });
    window.setInterval(rotateBubbles, 3200);
    window.setInterval(() => {
      if (document.visibilityState === 'visible') refresh(false);
    }, 60_000);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && !state.busy) refresh(false);
    });
    window.addEventListener('resize', fitPlan);

    const avatarChoices = $('#agentAvatarChoices');
    if (avatarChoices) {
      avatarChoices.addEventListener('click', (event) => {
        const target = event.target;
        if (!(target instanceof Element)) return;
        const button = target.closest('[data-avatar-key]');
        if (button) selectAvatar(button.dataset.avatarKey);
      });
    }
    ['#agentName', '#agentTitle', '#agentDepartment'].forEach((selector) => {
      $(selector)?.addEventListener('input', updateBadge);
      $(selector)?.addEventListener('change', updateBadge);
    });
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

  window.OfficeAgentVoice = { speak: speakAgent };
  bindControls();
  refresh(true);
})();
