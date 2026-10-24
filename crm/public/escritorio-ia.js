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
  /** ?agent=… opens that employee's desk as its own page; without it, the office floor. */
  const view = query.has('agent') ? 'desk' : 'office';
  document.body.dataset.officeView = view;
  const API_REMINDERS = '/api/virtual-office/reminders';
  const SEEN_KEY = 'om.office.seen.';
  const state = {
    suggestions: [], agents: [], busy: false, canManage: false, userName: '', userInitial: '', orgName: '',
    activeAgentKey: /^[a-z0-9_-]{1,60}$/i.test(requestedAgent) ? requestedAgent.toLowerCase() : 'mate',
    contextRequest: 0, entityShown: false, meetingShown: 0, meetingTimer: 0, bubbleTick: 0, suggestionRun: false,
    chatKey: '', chatTyping: false, planScale: 1, pedidoRun: false,
    organizationId: '', userId: '', voicePrefs: { speakPending: false, voices: {} }, voiceOptions: [], defaultVoiceId: '',
    voiceLoading: false, voiceLoaded: false, voiceLoadPromise: null, voiceError: '', speechAudio: null, speechUrl: '', suggestionsLoaded: false, alertTimer: 0,
    reminders: [], remindersLoaded: false, alertAgentKey: '', editorPhotoUrl: '',
  };
  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const $ = (selector, root) => (root || document).querySelector(selector);
  const $$ = (selector, root) => Array.from((root || document).querySelectorAll(selector));

  function makeFace(avatarKey, agentKey, photoUrl) {
    const image = document.createElement('img');
    image.className = `office-avatar-image${agentKey === 'mate' ? ' office-avatar-image--mate' : ''}`;
    image.src = agentKey === 'mate' ? MATE_IMAGE : (photoUrl || FACE_IMAGES[avatarKey] || FACE_IMAGES['avatar-1']);
    image.alt = '';
    image.setAttribute('aria-hidden', 'true');
    image.loading = 'lazy';
    image.decoding = 'async';
    return image;
  }

  function faceFor(agent) {
    return makeFace(agent?.avatarKey, agent?.key, agent?.photoUrl);
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
    return state.voiceOptions.filter((voice) => [...(voice.languages || []), voice.labels?.language, voice.labels?.accent].filter(Boolean)
      .some((language) => /(^pt\b|portuguese)/i.test(language)));
  }

  function preferredVoiceId(agent) {
    const saved = state.voicePrefs.voices?.[agent.key];
    if (saved && saved !== 'browser' && state.voiceOptions.some((voice) => voice.voiceId === saved)) return saved;
    if (agent.voiceId && (!state.voiceOptions.length || state.voiceOptions.some((voice) => voice.voiceId === agent.voiceId))) return agent.voiceId;
    if (saved === 'browser') return '';
    if (saved && saved !== 'recommended') return saved;
    if (state.defaultVoiceId) return state.defaultVoiceId;
    const portuguese = portugueseVoices();
    const brazilian = portuguese.find((voice) => [...(voice.languages || []), voice.labels?.language, voice.labels?.accent]
      .filter(Boolean).some((language) => /pt[-_]br|brazil/i.test(language)));
    return brazilian?.voiceId || portuguese[0]?.voiceId || '';
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
          ? 'ElevenLabs está conectado. A voz recomendada usa o modelo mais expressivo; teste cada pessoa antes de ativar os avisos.'
          : 'Nenhuma voz foi encontrada na conta ElevenLabs. Configure uma voz brasileira para ativar a fala.');
      } catch (error) {
        state.voiceOptions = [];
        state.defaultVoiceId = '';
        state.voiceError = String(error?.message || 'ElevenLabs está indisponível.');
        setVoiceMessage(`${state.voiceError} A fala não será trocada silenciosamente pela voz do navegador.`, true);
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
      face.appendChild(faceFor(agent));
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
      select.appendChild(new Option('Recomendada · ElevenLabs', 'recommended'));
      select.appendChild(new Option('Voz do navegador · menos natural', 'browser'));
      const options = [...state.voiceOptions].sort((left, right) => {
        const score = (voice) => [...(voice.languages || []), voice.labels?.language, voice.labels?.accent]
          .filter(Boolean).some((language) => /pt[-_]br|brazil/i.test(language)) ? 0
          : [...(voice.languages || []), voice.labels?.language].filter(Boolean).some((language) => /(^pt\b|portuguese)/i.test(language)) ? 1 : 2;
        return score(left) - score(right) || left.name.localeCompare(right.name);
      });
      options.forEach((voice) => {
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

      const chosen = state.voicePrefs.voices?.[agent.key] || 'recommended';
      select.value = chosen;
      if (!Array.from(select.options).some((option) => option.value === chosen)) select.value = 'recommended';
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
    stopLoopAudio();
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

  function cleanSpeech(text) {
    return String(text || '')
      .replace(/\[([^\]]+)\]\((?:https?:\/\/[^)]+)\)/g, '$1')
      .replace(/https?:\/\/\S+/g, '')
      .replace(/\*\*(.*?)\*\*/g, '$1')
      .replace(/[`*_#>]/g, '')
      .replace(/^\s*[-•]+\s*/gm, '')
      .replace(/\n+/g, '. ')
      .replace(/\s+/g, ' ')
      .trim().slice(0, 2000);
  }

  /** ElevenLabs audio for this employee's voice (null when the voice is the browser's or missing). */
  async function fetchSpeech(agent, cleanText) {
    if (!state.voiceLoaded) await loadVoiceOptions();
    if (state.voicePrefs.voices?.[agent.key] === 'browser') return null;
    const voiceId = preferredVoiceId(agent);
    if (!voiceId) {
      setVoiceMessage('Não encontrei uma voz ElevenLabs em português. Escolha uma voz na lista ou configure ELEVENLABS_VOICE_ID.', true);
      return null;
    }
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
    return blob;
  }

  async function speakAgent(agent, text) {
    const cleanText = cleanSpeech(text);
    if (!agent || !cleanText) return false;
    stopAgentSpeech();
    try {
      const blob = await fetchSpeech(agent, cleanText);
      if (!blob) return state.voicePrefs.voices?.[agent.key] === 'browser' ? speakWithBrowser(cleanText) : false;
      state.speechUrl = URL.createObjectURL(blob);
      state.speechAudio = new Audio(state.speechUrl);
      state.speechAudio.addEventListener('ended', stopAgentSpeech, { once: true });
      await state.speechAudio.play();
      return true;
    } catch (error) {
      stopAgentSpeech();
      setVoiceMessage(error instanceof Error ? error.message : 'A voz ElevenLabs não conseguiu gerar o áudio. Confira a voz selecionada.', true);
      return false;
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
    state.alertAgentKey = '';
    setText('#officeAlertOpen', 'Ver pendência');
    setText('#officeAlertTitle', title);
    setText('#officeAlertMessage', suggestions.length > 1 ? `${detail} Também há outras ações esperando sua revisão.` : detail);
    toast.hidden = false;
    if (state.alertTimer) window.clearTimeout(state.alertTimer);
    state.alertTimer = window.setTimeout(() => { toast.hidden = true; }, 14_000);

    if (state.voicePrefs.speakPending) {
      const intro = `${greeting} Aqui é ${owner.name}, ${area}.`;
      const spoken = `${intro} Tenho uma atualização: ${first.title}. ${first.detail ? `${first.detail}. ` : ''}Você pode ${first.run?.label?.toLowerCase() || 'revisar isso comigo'}.${suggestions.length > 1 ? ` Também deixei mais ${suggestions.length - 1} ${suggestions.length === 2 ? 'ação' : 'ações'} para você.` : ''}`;
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
    return `${url.pathname}${url.search}`;
  }

  function renderActiveAgent() {
    const agent = activeAgent();
    if (!agent) return;
    if (view !== 'desk') return;
    if (agent.key !== state.activeAgentKey) {
      location.replace(agentHref(agent));
      return;
    }
    const avatar = $('#officeActiveAvatar');
    if (avatar) avatar.replaceChildren(faceFor(agent));
    setText('#officeActiveName', deskTitle(agent));
    setText('#officeActiveTitle', agent.title || AGENT_DEPARTMENTS[agent.department] || 'Funcionário virtual');
    setText('#officeActiveDepartment', `${agent.key === 'mate' ? 'GERÊNCIA' : 'MESA'} · ${(AGENT_DEPARTMENTS[agent.department] || 'ESCRITÓRIO').toUpperCase()}`);
    const badge = $('#officeActiveBadge');
    if (badge) badge.hidden = agent.key === 'mate';
    const edit = $('#officeEditActive');
    if (edit) edit.hidden = !state.canManage;
    document.title = `${deskTitle(agent)} · Escritório ObraMate`;
    renderDeskTop(agent);
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
    const due = dueReminders(agent.key)[0];
    if (due) return ['Lembrete pra você', shortText(due.text, 30)];
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
    if (dueReminders(agent.key).length) return 'waiting';
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
    if (faces) faces.replaceChildren(...agents.slice(0, 4).map((agent) => faceFor(agent)));
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
    face.appendChild(faceFor(agent));
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
        if (owner) paper.appendChild(faceFor(owner));
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
    syncShowroom();
  }

  /* ───────── showroom 3D (visão geral) ───────── */

  let showroom = null;
  function faceUrl(agent) {
    return agent.key === 'mate' ? MATE_IMAGE : (agent.photoUrl || FACE_IMAGES[agent.avatarKey] || FACE_IMAGES['avatar-1']);
  }
  function syncShowroom() {
    const host = $('#officeShowroom');
    const floor = $('.office-floor');
    const api = window.OfficeShowroom;
    if (!host || !floor || !api || !api.supported()) return;
    if (!showroom) {
      host.hidden = false;
      floor.classList.add('has-showroom');
      showroom = api.mount(host, { onPick: (key) => openChat(key) });
    }
    const taken = new Set();
    const agents = enabledAgents().filter((agent) => {
      if (taken.has(agent.department)) return false;
      taken.add(agent.department);
      return true;
    }).map((agent) => ({
      key: agent.key,
      name: agent.name,
      title: agent.title,
      department: agent.department,
      tone: seatTone(agent),
      line: shortText(bubbleLines(agent)[0] || '', 40),
      face: faceUrl(agent),
      seated: api.seatedFor(agent),
    }));
    showroom.update({ agents, pending: state.suggestions.length, chatKey: state.chatKey });
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
        face.appendChild(faceFor(agent));
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
    const due = dueReminders(agent.key)[0];
    if (due) {
      const again = due.nudges > 0 ? 'De novo: ' : '';
      return `${hello()}${name}! ${again ? 'De novo: você' : 'Você'} me pediu para lembrar: ${due.text}. Já deu para fazer?`;
    }
    const nag = nagLine(agent);
    if (nag) return nag;
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
    const due = dueReminders(agent.key)[0];
    if (due) {
      return [
        { text: 'Já fiz', reminder: due.id, op: 'done' },
        { text: 'Me lembra em 1 hora', reminder: due.id, op: 'snooze', minutes: 60 },
        { text: 'Amanhã cedo', reminder: due.id, op: 'snooze', minutes: minutesUntilTomorrow(9) },
      ];
    }
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
    if (showroom) showroom.say(key, shortText(text, 90));
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
    if (showroom) { chat.style.left = ''; chat.style.top = ''; return; }
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
      if (message.confirm && !message.confirmed) {
        const confirm = makeNode('button', 'office-chat__confirm', message.confirm.label);
        confirm.type = 'button';
        confirm.dataset.confirmAt = String(message.at);
        row.appendChild(confirm);
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
    if (face) face.replaceChildren(faceFor(agent));
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
    if (showroom) { showroom.focus(agent.key); syncShowroom(); }
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
    if (voice.active && voice.target === 'chat') voiceStop();
    stopAgentSpeech();
    const chat = $('#officeChat');
    if (chat) chat.hidden = true;
    state.chatKey = '';
    state.chatTyping = false;
    markTalking('');
    if (showroom) { showroom.overview(); syncShowroom(); }
  }

  async function sendChat(text) {
    const agent = state.agents.find((item) => item.key === state.chatKey);
    const message = String(text || '').trim();
    if (!agent || !message || state.chatTyping) return null;
    const open = chatThread(agent.key).slice().reverse().find((item) => item.confirm && !item.confirmed);
    if (open && /^(pode|pode sim|sim|isso|confirma|confirmo|manda|beleza|ok|okay|fechado|combinado)\b[.!]?$/i.test(message)) {
      const result = await confirmChat(agent, open.at, message);
      return result ? { text: result, speech: result } : null;
    }
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
      } else if (data.type === 'card' && data.card?.confirm && data.card.confirm.tone === 'normal' && data.card.confirm.exec) {
        // Simple, internal changes (a reminder, a note) are confirmed right here in the chat.
        reply.card = summarizeCard(data.card);
        reply.text = String(data.message || `Posso fazer assim: ${data.card.title}?`);
        reply.confirm = { label: String(data.card.confirm.label || 'Confirmar'), endpoint: String(data.card.confirm.exec.endpoint || ''), body: data.card.confirm.exec.body || {} };
        reply.pedido = message;
        reply.link = 'Ajustar na mesa';
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
    const rows = reply.card?.rows || [];
    reply.speech = [reply.text, ...rows.slice(0, 3).map((row) => [row.title, row.detail].filter(Boolean).join(', '))].join('. ');
    if (reply.confirm) reply.speech += `. Se estiver certo, diga "pode" ou toque em ${reply.confirm.label}.`;
    return reply;
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
    if (chip.reminder) { answerReminder(agent, chip); return; }
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
    if (owner) mark.appendChild(faceFor(owner));
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
      face.appendChild(faceFor(report.agent));
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
    if (photo) photo.replaceChildren(makeFace(selected, key, state.editorPhotoUrl));
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
    fillProfileExtras(agent);
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
      ...profileExtras(),
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
      if (payload.voiceId !== undefined && state.voicePrefs.voices?.[key]) { delete state.voicePrefs.voices[key]; saveVoicePrefs(); }
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
    if (view === 'office') {
      renderPlan();
      renderCorridor();
      renderTasks();
    } else {
      renderDeskSide();
    }
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
    rememberSeen();
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
      const results = await Promise.allSettled([loadSuggestions(), loadAgents(), loadReminders()]);
      renderOffice();
      announceDueReminders();
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
      const agent = state.agents.find((item) => item.key === target.dataset.officeVoiceAgent);
      if (state.canManage && agent && target.value && target.value !== 'browser') {
        delete state.voicePrefs.voices[agent.key];
        saveVoicePrefs();
        patchAgent(agent.key, { voiceId: target.value })
          .then(() => setVoiceMessage(`A voz de ${agent.name} foi salva para toda a empresa.`))
          .catch((error) => setVoiceMessage(String(error?.message || 'Não foi possível salvar a voz.'), true));
        return;
      }
      state.voicePrefs.voices[target.dataset.officeVoiceAgent] = target.value || 'browser';
      saveVoicePrefs();
      setVoiceMessage(`A voz de ${agent?.name || 'funcionário'} foi atualizada neste aparelho.`);
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
      if (played) setVoiceMessage(`Você ouviu a voz de ${agent.name}.`);
      else if (state.voicePrefs.voices?.[agent.key] === 'browser') setVoiceMessage('A voz do navegador não está disponível neste aparelho.', true);
    });
    $('#officeVoiceTest')?.addEventListener('click', async () => {
      const agent = activeAgent();
      if (!agent) return;
      const played = await speakAgent(agent, `Oi${state.userName ? `, ${state.userName}` : ''}! Aqui é ${agent.name}. Esta é a voz que vou usar para conversar e avisar você sobre ações pendentes.`);
      if (played) setVoiceMessage(`Você ouviu a voz de ${agent.name}.`);
      else if (state.voicePrefs.voices?.[agent.key] === 'browser') setVoiceMessage('A voz do navegador não está disponível neste aparelho.', true);
    });
    $('#officeAlertDismiss')?.addEventListener('click', () => {
      const toast = $('#officeAlertToast');
      if (toast) toast.hidden = true;
      if (state.alertTimer) window.clearTimeout(state.alertTimer);
      state.alertTimer = 0;
    });
    $('#officeAlertOpen')?.addEventListener('click', () => {
      const agentKey = state.alertAgentKey;
      if (agentKey) {
        const toast = $('#officeAlertToast');
        if (toast) toast.hidden = true;
        const agent = state.agents.find((item) => item.key === agentKey);
        if (view === 'office' && agent) openChat(agent.key);
        else if (agent && agent.key !== state.activeAgentKey) location.href = agentHref(agent);
        return;
      }
      const panel = $('#officeApprovals');
      panel?.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' });
      panel?.focus({ preventScroll: true });
      const toast = $('#officeAlertToast');
      if (toast) toast.hidden = true;
    });
    $('#officePlan')?.addEventListener('click', onRoomClick);
    $('#officeCorridor')?.addEventListener('click', onRoomClick);
    $('#officeTasks')?.addEventListener('click', onTaskClick);
    bindV4Controls();
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

  /* ───────── reminders (bilhetes) ───────── */

  function dueReminders(agentKey) {
    return state.reminders.filter((item) => item.status === 'open' && item.overdue && (!agentKey || item.agent_key === agentKey));
  }

  function openReminders(agentKey) {
    return state.reminders.filter((item) => item.status === 'open' && (!agentKey || item.agent_key === agentKey));
  }

  function minutesUntilTomorrow(hour) {
    const next = new Date();
    next.setDate(next.getDate() + 1);
    next.setHours(hour, 0, 0, 0);
    return Math.max(5, Math.round((next.getTime() - Date.now()) / 60000));
  }

  function whenLabel(iso) {
    const date = new Date(iso);
    const today = new Date();
    const tomorrow = new Date(); tomorrow.setDate(today.getDate() + 1);
    const time = date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    if (date.toDateString() === today.toDateString()) return `hoje às ${time}`;
    if (date.toDateString() === tomorrow.toDateString()) return `amanhã às ${time}`;
    return `${date.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short' })} às ${time}`;
  }

  async function loadReminders() {
    const response = await fetch(API_REMINDERS, { credentials: 'include', cache: 'no-store' });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.success === false) throw new Error(data.error || 'Não foi possível carregar os lembretes.');
    state.reminders = Array.isArray(data.data) ? data.data : [];
    state.remindersLoaded = true;
  }

  async function updateReminder(id, body) {
    const response = await fetch(`${API_REMINDERS}/${encodeURIComponent(id)}`, {
      method: 'PATCH', credentials: 'include', cache: 'no-store',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.success === false) throw new Error(data.error || 'Não foi possível atualizar o lembrete.');
    state.reminders = state.reminders.map((item) => item.id === id ? data.data : item);
    return data.data;
  }

  /** Each due reminder is brought up once per nudge: a toast, the bubble and, if enabled, the voice. */
  function announceDueReminders() {
    const due = dueReminders();
    if (!due.length) return;
    let seen = {};
    try { seen = JSON.parse(sessionStorage.getItem('om.office.announced') || '{}'); } catch (_) {}
    const fresh = due.filter((item) => seen[item.id] !== item.nudges);
    if (!fresh.length) return;
    fresh.forEach((item) => { seen[item.id] = item.nudges; });
    try { sessionStorage.setItem('om.office.announced', JSON.stringify(seen)); } catch (_) {}
    const first = fresh[0];
    const agent = state.agents.find((item) => item.key === first.agent_key) || activeAgent();
    if (!agent) return;
    const toast = $('#officeAlertToast');
    const message = `${state.userName ? `${state.userName}, ` : ''}você me pediu para lembrar: ${first.text}.`;
    if (toast) {
      state.alertAgentKey = agent.key;
      setText('#officeAlertTitle', `${agent.name}: lembrete`);
      setText('#officeAlertMessage', fresh.length > 1 ? `${message} E tem mais ${fresh.length - 1}.` : message);
      setText('#officeAlertOpen', view === 'office' ? `Falar com ${agent.name}` : 'Ver bilhetes');
      toast.hidden = false;
      if (state.alertTimer) window.clearTimeout(state.alertTimer);
      state.alertTimer = window.setTimeout(() => { toast.hidden = true; }, 16_000);
    }
    if (view === 'office') flashBubble(agent.key, `Lembrete: ${first.text}`);
    if (state.voicePrefs.speakPending && !voice.active) void speakAgent(agent, `${hello()}! Aqui é ${agent.name}. ${message} Já deu para fazer?`);
  }

  async function answerReminder(agent, chip) {
    const thread = chatThread(agent.key);
    thread.push({ role: 'user', text: chip.text, at: Date.now() });
    saveThread(agent.key, thread);
    state.chatTyping = true;
    renderChat();
    let text;
    try {
      if (chip.op === 'done') {
        await updateReminder(chip.reminder, { action: 'done' });
        text = 'Boa! Tirei da minha mesa.';
      } else {
        const item = await updateReminder(chip.reminder, { action: 'snooze', minutes: chip.minutes });
        text = `Combinado, eu volto a te chamar ${whenLabel(item.due_at)}.`;
      }
    } catch (error) {
      text = String(error?.message || 'Não consegui atualizar agora. Tenta de novo?');
    }
    const next = chatThread(agent.key);
    next.push({ role: 'assistant', text, at: Date.now() });
    saveThread(agent.key, next);
    state.chatTyping = false;
    renderOffice();
    if (state.chatKey === agent.key) renderChat();
    if (voice.active && voice.agentKey === agent.key) {
      setVoicePhase('speaking', `${agent.name} está falando… toque aqui para interromper.`);
      await speakLoop(agent, text);
      if (voice.active) voiceListen();
    }
  }

  /* ───────── what has been waiting, and since when ───────── */

  function seenStore() {
    try { return JSON.parse(localStorage.getItem(SEEN_KEY + (state.organizationId || location.host)) || '{}'); } catch (_) { return {}; }
  }

  function rememberSeen() {
    const store = seenStore();
    const now = Date.now();
    const next = {};
    state.suggestions.forEach((item) => { next[item.id] = store[item.id] || now; });
    try { localStorage.setItem(SEEN_KEY + (state.organizationId || location.host), JSON.stringify(next)); } catch (_) {}
  }

  function waitingDays(item) {
    const since = seenStore()[item.id];
    return since ? Math.floor((Date.now() - since) / 86_400_000) : 0;
  }

  /** The employee insists on what has been sitting on the desk (unless they follow up lightly). */
  function nagLine(agent) {
    if (agent.followUpStyle === 'light') return '';
    const items = agent.key === 'mate' ? state.suggestions : itemsFor(agent);
    const urgent = items.filter((item) => item.tone === 'critical' || item.tone === 'warning');
    const oldest = urgent.map((item) => ({ item, days: waitingDays(item) })).sort((a, b) => b.days - a.days)[0];
    if (!oldest || oldest.days < 1) return '';
    const name = state.userName ? `${state.userName}, ` : '';
    const since = oldest.days === 1 ? 'desde ontem' : `há ${oldest.days} dias`;
    const title = String(oldest.item.title || '').trim();
    if (agent.followUpStyle === 'firm') return `${name}preciso de você nisso, está parado ${since}: ${title}. Bora resolver agora?`;
    return `${hello()}${state.userName ? `, ${state.userName}` : ''}! Isso continua na minha mesa ${since}: ${title}. Quer que eu prepare?`;
  }

  /* ───────── desk page ───────── */

  function renderDeskTop(agent) {
    const face = $('#officeDeskFace');
    if (face) face.replaceChildren(faceFor(agent));
    setText('#officeDeskKicker', `ESCRITÓRIO · ${(AGENT_DEPARTMENTS[agent.department] || 'EQUIPE').toUpperCase()}`);
    setText('#officeDeskName', deskTitle(agent));
    setText('#officeDeskRole', agent.title || 'Funcionário virtual');
    const badge = $('#officeDeskBadge');
    if (badge) badge.hidden = agent.key === 'mate';
    const items = agent.key === 'mate' ? state.suggestions : itemsFor(agent);
    const late = dueReminders(agent.key).length;
    const mood = $('#officeDeskMood');
    if (mood) {
      mood.dataset.tone = late || needsYou(items) ? 'waiting' : items.length ? 'busy' : 'idle';
      mood.textContent = late
        ? `${plural(late, 'lembrete', 'lembretes')} para você`
        : needsYou(items) ? 'Precisa de você' : items.length ? plural(items.length, 'coisa na mesa', 'coisas na mesa') : 'Em dia';
    }
    const edit = $('#officeDeskEdit');
    if (edit) edit.hidden = !state.canManage;
  }

  function renderDeskSide() {
    const agent = activeAgent();
    if (!agent) return;
    renderNotes(agent);
    const host = $('#officeDeskTasks');
    if (!host) return;
    const items = agent.key === 'mate' ? state.suggestions : itemsFor(agent);
    setText('#officeDeskPendingTitle', items.length ? `${plural(items.length, 'papel', 'papéis')} esperando você` : 'Esperando você');
    if (!items.length) {
      const empty = makeNode('div', 'office-empty');
      empty.append(makeNode('strong', '', 'Mesa limpa'), makeNode('span', '', `Quando ${agent.name} precisar do seu OK, o papel aparece aqui.`));
      host.replaceChildren(empty);
      return;
    }
    host.replaceChildren(...items.map((item) => makeTask(item, state.suggestions.indexOf(item))));
  }

  function renderNotes(agent) {
    const list = $('#officeNotes');
    if (!list) return;
    const rows = state.reminders.filter((item) => item.agent_key === agent.key || agent.key === 'mate');
    const open = rows.filter((item) => item.status === 'open');
    const done = rows.filter((item) => item.status === 'done').slice(0, 3);
    if (!open.length && !done.length) {
      const empty = makeNode('li', 'office-note office-note--empty');
      empty.append(makeNode('strong', '', 'Nenhum bilhete'), makeNode('span', '', `Peça para ${agent.name}: “me lembra amanhã às 10 de ligar pro cliente”.`));
      list.replaceChildren(empty);
      return;
    }
    list.replaceChildren(...open.concat(done).map((item) => {
      const li = makeNode('li', `office-note${item.overdue ? ' office-note--late' : ''}${item.status === 'done' ? ' office-note--done' : ''}`);
      li.dataset.reminder = item.id;
      li.appendChild(makeNode('p', 'office-note__text', item.text));
      const owner = agent.key === 'mate' && item.agent_key !== 'mate' ? state.agents.find((a) => a.key === item.agent_key)?.name : '';
      const meta = item.status === 'done'
        ? 'Feito'
        : `${item.overdue ? 'Passou da hora · ' : ''}${whenLabel(item.due_at)}${owner ? ` · ${owner}` : ''}`;
      li.appendChild(makeNode('small', 'office-note__meta', meta));
      if (item.status === 'open') {
        const actions = makeNode('div', 'office-note__actions');
        [['done', 'Feito'], ['snooze60', '+1 hora'], ['tomorrow', 'Amanhã']].forEach(([op, label]) => {
          const button = makeNode('button', '', label);
          button.type = 'button';
          button.dataset.noteOp = op;
          actions.appendChild(button);
        });
        li.appendChild(actions);
      } else {
        const undo = makeNode('button', 'office-note__undo', 'Reabrir');
        undo.type = 'button';
        undo.dataset.noteOp = 'reopen';
        li.appendChild(undo);
      }
      return li;
    }));
  }

  function fillNoteWhen() {
    const select = $('#officeNoteWhen');
    if (!select || select.options.length) return;
    const now = new Date();
    const at = (days, hour, minute) => { const d = new Date(); d.setDate(d.getDate() + days); d.setHours(hour, minute || 0, 0, 0); return d; };
    const options = [['in60', 'Daqui a 1 hora', new Date(now.getTime() + 3_600_000)]];
    if (now.getHours() < 17) options.push(['today', 'Hoje às 17:30', at(0, 17, 30)]);
    options.push(['tomorrow', 'Amanhã às 9:00', at(1, 9)]);
    const monday = at(((8 - now.getDay()) % 7) || 7, 9);
    options.push(['monday', `Segunda às 9:00`, monday]);
    options.forEach(([value, label, date]) => {
      const option = document.createElement('option');
      option.value = date.toISOString();
      option.textContent = label;
      select.appendChild(option);
    });
    const custom = document.createElement('option');
    custom.value = 'custom';
    custom.textContent = 'Escolher dia e hora…';
    select.appendChild(custom);
    select.selectedIndex = Math.min(2, select.options.length - 2);
  }

  async function addNote(event) {
    event.preventDefault();
    const agent = activeAgent();
    const text = $('#officeNoteText')?.value.trim();
    const when = $('#officeNoteWhen')?.value;
    const custom = $('#officeNoteCustom')?.value;
    const due = when === 'custom' ? (custom ? new Date(custom) : null) : new Date(when);
    if (!agent || !text || !due || Number.isNaN(due.getTime())) return;
    const button = $('#officeNoteForm button[type="submit"]');
    if (button) button.disabled = true;
    try {
      const response = await fetch(API_REMINDERS, {
        method: 'POST', credentials: 'include', cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent_key: agent.key, text, due_at: due.toISOString() }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.success === false) throw new Error(data.error || 'Não foi possível deixar o bilhete.');
      state.reminders = state.reminders.concat(data.data).sort((a, b) => a.due_at.localeCompare(b.due_at));
      $('#officeNoteText').value = '';
      renderOffice();
      setText('#officeUpdated', `${agent.name} vai te lembrar ${whenLabel(data.data.due_at)}`);
    } catch (error) {
      setText('#officeUpdated', String(error?.message || 'Não foi possível deixar o bilhete.'));
    } finally {
      if (button) button.disabled = false;
    }
  }

  async function onNotesClick(event) {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const button = target.closest('[data-note-op]');
    const row = target.closest('[data-reminder]');
    if (!button || !row) return;
    const op = button.dataset.noteOp;
    const body = op === 'done' ? { action: 'done' }
      : op === 'reopen' ? { action: 'reopen' }
        : op === 'snooze60' ? { action: 'snooze', minutes: 60 }
          : { action: 'snooze', minutes: minutesUntilTomorrow(9) };
    button.disabled = true;
    try {
      await updateReminder(row.dataset.reminder, body);
      renderOffice();
    } catch (error) {
      setText('#officeUpdated', String(error?.message || 'Não foi possível atualizar o lembrete.'));
      button.disabled = false;
    }
  }

  /* ───────── confirming simple cards right in the chat ───────── */

  async function confirmChat(agent, at, spoken) {
    const thread = chatThread(agent.key);
    const message = thread.find((item) => item.at === at && item.confirm && !item.confirmed);
    if (!message) return '';
    if (spoken) thread.push({ role: 'user', text: spoken, at: Date.now() });
    message.confirmed = true;
    saveThread(agent.key, thread);
    state.chatTyping = true;
    renderChat();
    let text;
    try {
      const response = await fetch(message.confirm.endpoint, {
        method: 'POST', credentials: 'include', cache: 'no-store',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(message.confirm.body),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.success === false) throw new Error(data.error || 'Não consegui concluir.');
      text = String(data.result?.title || 'Feito!');
      await loadReminders().catch(() => {});
    } catch (error) {
      text = String(error?.message || 'Não consegui concluir agora.');
      const again = chatThread(agent.key);
      const original = again.find((item) => item.at === at);
      if (original) { original.confirmed = false; saveThread(agent.key, again); }
    }
    const next = chatThread(agent.key);
    next.push({ role: 'assistant', text, at: Date.now() });
    saveThread(agent.key, next);
    state.chatTyping = false;
    renderOffice();
    if (state.chatKey === agent.key) renderChat();
    flashBubble(agent.key, text);
    return text;
  }

  /* ───────── profile: voice, way of talking, follow-up, hours, photo ───────── */

  function agentPayload(agent) {
    return {
      name: agent.name, title: agent.title, department: agent.department, avatarKey: agent.avatarKey,
      description: agent.description, capabilities: agent.capabilities || [], enabled: Boolean(agent.enabled),
      voiceId: agent.voiceId || null, personality: agent.personality || null, followUpStyle: agent.followUpStyle || 'normal',
      workStartHour: agent.workStartHour ?? 8, workEndHour: agent.workEndHour ?? 18,
    };
  }

  async function patchAgent(key, changes) {
    const agent = state.agents.find((item) => item.key === key);
    if (!agent) throw new Error('Funcionário não encontrado.');
    const response = await fetch(`${API_AGENTS}/${encodeURIComponent(key)}`, {
      method: 'PATCH', credentials: 'include', cache: 'no-store',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...agentPayload(agent), ...changes }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.success === false) throw new Error(data.error || 'Não foi possível salvar.');
    state.agents = state.agents.map((item) => item.key === key ? data.data : item);
    return data.data;
  }

  function hourLabel(hour) {
    return `${String(hour % 24).padStart(2, '0')}:00${hour === 24 ? ' (meia-noite)' : ''}`;
  }

  async function fillVoiceSelect(agent) {
    const select = $('#agentVoice');
    if (!select) return;
    const note = $('#agentVoiceNote');
    select.replaceChildren(new Option('Voz padrão da empresa', ''));
    await loadVoiceOptions();
    const portuguese = new Set(portugueseVoices().map((voice) => voice.voiceId));
    const sorted = state.voiceOptions.slice().sort((a, b) => Number(portuguese.has(b.voiceId)) - Number(portuguese.has(a.voiceId)) || a.name.localeCompare(b.name));
    sorted.forEach((voice) => {
      const accent = voice.labels?.accent || voice.labels?.language || '';
      select.appendChild(new Option(`${voice.name}${accent ? ` · ${accent}` : ''}${portuguese.has(voice.voiceId) ? '' : ' (outro idioma)'}`, voice.voiceId));
    });
    select.value = agent.voiceId && sorted.some((voice) => voice.voiceId === agent.voiceId) ? agent.voiceId : '';
    if (note) note.textContent = state.voiceError ? state.voiceError : sorted.length ? 'Vozes da sua conta ElevenLabs. As em português aparecem primeiro.' : 'Nenhuma voz encontrada na conta ElevenLabs.';
  }

  function fillProfileExtras(agent) {
    const personality = $('#agentPersonality');
    if (personality) personality.value = agent.personality || '';
    const style = agent.followUpStyle || 'normal';
    $$('input[name="followUpStyle"]').forEach((input) => { input.checked = input.value === style; });
    const start = $('#agentWorkStart');
    const end = $('#agentWorkEnd');
    if (start && !start.options.length) for (let hour = 0; hour <= 23; hour += 1) start.appendChild(new Option(hourLabel(hour), String(hour)));
    if (end && !end.options.length) for (let hour = 1; hour <= 24; hour += 1) end.appendChild(new Option(hourLabel(hour), String(hour)));
    if (start) start.value = String(agent.workStartHour ?? 8);
    if (end) end.value = String(agent.workEndHour ?? 18);
    state.editorPhotoUrl = agent.photoUrl || '';
    const box = $('#agentPhotoBox');
    if (box) box.hidden = agent.key === 'mate';
    const consent = $('#agentPhotoConsent');
    if (consent) consent.checked = Boolean(agent.photoUrl);
    const remove = $('#agentPhotoRemove');
    if (remove) remove.hidden = !agent.photoUrl;
    setText('#agentPhotoNote', agent.photoUrl ? 'Usando a foto enviada. O selo de IA continua aparecendo.' : '');
    $('#agentAvatarChoices')?.classList.toggle('is-muted', Boolean(agent.photoUrl));
    void fillVoiceSelect(agent);
  }

  function profileExtras() {
    const start = Number($('#agentWorkStart')?.value ?? 8);
    const end = Number($('#agentWorkEnd')?.value ?? 18);
    return {
      personality: $('#agentPersonality')?.value.trim() || null,
      voiceId: $('#agentVoice')?.value || null,
      followUpStyle: $('input[name="followUpStyle"]:checked')?.value || 'normal',
      workStartHour: start,
      workEndHour: Math.max(start + 1, end),
    };
  }

  function shrinkPhoto(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Não consegui ler a foto.'));
      reader.onload = () => {
        const image = new Image();
        image.onerror = () => reject(new Error('Esse arquivo não parece uma foto.'));
        image.onload = () => {
          const size = Math.min(640, image.width, image.height);
          const crop = Math.min(image.width, image.height);
          const canvas = document.createElement('canvas');
          canvas.width = size; canvas.height = size;
          canvas.getContext('2d').drawImage(image, (image.width - crop) / 2, (image.height - crop) / 2, crop, crop, 0, 0, size, size);
          resolve(canvas.toDataURL('image/jpeg', 0.86));
        };
        image.src = String(reader.result);
      };
      reader.readAsDataURL(file);
    });
  }

  async function savePhoto(dataUrl) {
    const key = $('#agentKey')?.value;
    if (!key) return;
    setText('#agentPhotoNote', dataUrl ? 'Enviando foto…' : 'Voltando para o rosto da galeria…');
    try {
      const response = await fetch(`${API_AGENTS}/${encodeURIComponent(key)}/photo`, {
        method: 'PUT', credentials: 'include', cache: 'no-store',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data_url: dataUrl }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.success === false) throw new Error(data.error || 'Não foi possível salvar a foto.');
      state.agents = state.agents.map((item) => item.key === key ? data.data : item);
      fillProfileExtras(data.data);
      updateBadge();
      renderOffice();
    } catch (error) {
      setText('#agentPhotoNote', String(error?.message || 'Não foi possível salvar a foto.'));
    }
  }

  /* ───────── voice conversation: talk, listen, answer, listen again ───────── */

  const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
  const canRecord = Boolean(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);
  const voice = { active: false, target: '', agentKey: '', phase: 'idle', stream: null, ctx: null, analyser: null, recorder: null, recognition: null, source: null, idleRounds: 0, browserMode: !canRecord, ticker: 0 };
  const GOODBYE = /^(tchau|at[eé] (mais|logo|amanh[aã])|pode parar|para de ouvir|encerrar|chega por hoje|[eé] s[oó] isso|s[oó] isso,? obrigad)/i;

  function voiceAgent() {
    return state.agents.find((item) => item.key === voice.agentKey) || activeAgent();
  }

  function voiceButtons() {
    return [$('#officeChatMic'), $('#officeDeskVoice')].filter(Boolean);
  }

  function setVoicePhase(phase, text) {
    voice.phase = phase;
    ['#officeChatVoiceLive', '#officeDeskVoiceLive'].forEach((selector) => {
      const el = $(selector);
      if (!el) return;
      const mine = (selector === '#officeDeskVoiceLive') === (voice.target === 'desk');
      el.hidden = !mine || phase === 'idle';
      el.dataset.phase = phase;
      el.textContent = mine ? (text || '') : '';
    });
    voiceButtons().forEach((button) => {
      const on = voice.active && ((button.id === 'officeDeskVoice') === (voice.target === 'desk'));
      button.setAttribute('aria-pressed', String(on));
      button.classList.toggle('is-live', on);
      const label = button.querySelector('span');
      if (label) label.textContent = on ? 'Encerrar conversa' : 'Conversar por voz';
      if (button.id === 'officeChatMic') button.setAttribute('aria-label', on ? 'Encerrar conversa por voz' : 'Conversar por voz');
    });
  }

  function stopLoopAudio() {
    if (!voice.source) return;
    try { voice.source.onended = null; voice.source.stop(); } catch (_) {}
    const done = voice.source.__done;
    voice.source = null;
    if (done) done();
  }

  /** Plays through the AudioContext opened by the tap, so phones allow every next answer. */
  async function speakLoop(agent, text) {
    const clean = cleanSpeech(text);
    if (!clean || !voice.active) return;
    stopAgentSpeech();
    let blob = null;
    try { blob = await fetchSpeech(agent, clean); } catch (_) { blob = null; }
    if (!voice.active) return;
    if (blob && voice.ctx) {
      try {
        const buffer = await voice.ctx.decodeAudioData(await blob.arrayBuffer());
        await new Promise((resolve) => {
          const source = voice.ctx.createBufferSource();
          source.buffer = buffer;
          source.connect(voice.ctx.destination);
          source.__done = resolve;
          source.onended = () => { if (voice.source === source) voice.source = null; resolve(); };
          voice.source = source;
          source.start();
        });
        return;
      } catch (_) { /* fall through to the browser voice */ }
    }
    if (!window.speechSynthesis || typeof window.SpeechSynthesisUtterance !== 'function') return;
    await new Promise((resolve) => {
      speakWithBrowser(clean);
      const started = Date.now();
      const poll = window.setInterval(() => {
        const busy = window.speechSynthesis.speaking || window.speechSynthesis.pending;
        if ((!busy && Date.now() - started > 400) || !voice.active || Date.now() - started > 60_000) { window.clearInterval(poll); resolve(); }
      }, 200);
    });
  }

  function pickMime() {
    const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
    return types.find((type) => window.MediaRecorder.isTypeSupported && window.MediaRecorder.isTypeSupported(type)) || '';
  }

  function transcribeBlob(blob) {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onerror = () => resolve('');
      reader.onloadend = async () => {
        try {
          const response = await fetch('/api/mate-ai/transcribe', {
            method: 'POST', credentials: 'include', cache: 'no-store',
            headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data_url: reader.result, language: 'pt' }),
          });
          const data = await response.json().catch(() => ({}));
          if (!response.ok || data.success === false) {
            if (data.fallback === 'browser' && SpeechRec) { voice.browserMode = true; resolve(await listenBrowser()); return; }
            throw new Error(data.error || 'Não consegui entender o áudio.');
          }
          resolve(String(data.text || '').trim());
        } catch (error) {
          setVoicePhase('error', String(error?.message || 'Não consegui entender o áudio.'));
          resolve('');
        }
      };
      reader.readAsDataURL(blob);
    });
  }

  /** Records until the person stops talking (about a second of silence). */
  function listenRecorder() {
    return new Promise((resolve) => {
      const mime = pickMime();
      let recorder;
      try { recorder = mime ? new MediaRecorder(voice.stream, { mimeType: mime }) : new MediaRecorder(voice.stream); } catch (_) { resolve(''); return; }
      voice.recorder = recorder;
      const chunks = [];
      const samples = new Float32Array(voice.analyser.fftSize);
      const started = performance.now();
      let floor = 0.006;
      let spoke = false;
      let lastLoud = 0;
      const live = $(voice.target === 'desk' ? '#officeDeskVoiceLive' : '#officeChatVoiceLive');
      recorder.ondataavailable = (event) => { if (event.data && event.data.size) chunks.push(event.data); };
      recorder.onstop = async () => {
        window.clearInterval(voice.ticker);
        voice.recorder = null;
        if (live) live.style.removeProperty('--level');
        if (!voice.active || recorder.__discard || !spoke) { resolve(''); return; }
        const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
        if (blob.size < 1500) { resolve(''); return; }
        setVoicePhase('thinking', 'Entendendo…');
        resolve(await transcribeBlob(blob));
      };
      voice.ticker = window.setInterval(() => {
        voice.analyser.getFloatTimeDomainData(samples);
        let sum = 0;
        for (let i = 0; i < samples.length; i += 1) sum += samples[i] * samples[i];
        const rms = Math.sqrt(sum / samples.length);
        const now = performance.now();
        if (now - started < 350) { floor = Math.min(0.04, Math.max(floor, rms)); return; }
        const threshold = Math.max(0.018, floor * 2.4);
        if (live) live.style.setProperty('--level', String(Math.min(1, rms / (threshold * 2))));
        if (rms > threshold) { spoke = true; lastLoud = now; }
        const stop = (spoke && now - lastLoud > 1100) || (!spoke && now - started > 9000) || now - started > 45_000;
        if (stop && recorder.state === 'recording') recorder.stop();
      }, 60);
      recorder.start(250);
    });
  }

  function listenBrowser() {
    return new Promise((resolve) => {
      if (!SpeechRec) { resolve(''); return; }
      const recognition = new SpeechRec();
      voice.recognition = recognition;
      recognition.lang = 'pt-BR';
      recognition.continuous = false;
      recognition.interimResults = false;
      let text = '';
      const timer = window.setTimeout(() => { try { recognition.stop(); } catch (_) {} }, 15_000);
      recognition.onresult = (event) => { text = Array.from(event.results).map((result) => result[0]?.transcript || '').join(' ').trim(); };
      recognition.onerror = () => {};
      recognition.onend = () => { window.clearTimeout(timer); voice.recognition = null; resolve(voice.active ? text : ''); };
      try { recognition.start(); } catch (_) { window.clearTimeout(timer); resolve(''); }
    });
  }

  /** On the desk the big conversation answers; we wait for its reply to speak it. */
  function askDesk(text) {
    return new Promise((resolve) => {
      let done = false;
      const finish = (speech) => {
        if (done) return;
        done = true;
        window.removeEventListener('mateai:reply', onReply);
        window.clearTimeout(timer);
        resolve(speech);
      };
      const onReply = (event) => finish(String(event.detail?.speech || ''));
      window.addEventListener('mateai:reply', onReply);
      const timer = window.setTimeout(() => finish(''), 45_000);
      if (window.MateAI && typeof window.MateAI.ask === 'function') window.MateAI.ask(text);
      else finish('');
    });
  }

  async function voiceListen() {
    if (!voice.active) return;
    const agent = voiceAgent();
    if (!agent) { voiceStop(); return; }
    setVoicePhase('listening', `Ouvindo… pode falar com ${agent.name}.`);
    const text = voice.browserMode ? await listenBrowser() : await listenRecorder();
    if (!voice.active) return;
    if (!text) {
      voice.idleRounds += 1;
      if (voice.idleRounds >= 2) { voiceStop(); setVoiceNote('Fiquei esperando você falar. Toque no microfone quando quiser continuar.'); return; }
      voiceListen();
      return;
    }
    voice.idleRounds = 0;
    if (GOODBYE.test(text.trim())) {
      setVoicePhase('speaking', `${agent.name} está falando…`);
      await speakLoop(agent, `Combinado${state.userName ? `, ${state.userName}` : ''}! Qualquer coisa, é só chamar.`);
      voiceStop();
      return;
    }
    setVoicePhase('thinking', `“${shortText(text, 70)}” · ${agent.name} está pensando…`);
    let speech = '';
    if (voice.target === 'desk') speech = await askDesk(text);
    else {
      const reply = await sendChat(text);
      speech = reply?.speech || reply?.text || '';
    }
    if (!voice.active) return;
    if (speech) {
      setVoicePhase('speaking', `${agent.name} está falando… toque aqui para interromper.`);
      await speakLoop(agent, speech);
    }
    if (voice.active) voiceListen();
  }

  function setVoiceNote(text) {
    const el = $(voice.target === 'desk' ? '#officeDeskVoiceLive' : '#officeChatVoiceLive');
    if (!el) return;
    el.hidden = false;
    el.dataset.phase = 'note';
    el.textContent = text;
    window.setTimeout(() => { if (!voice.active && el.dataset.phase === 'note') el.hidden = true; }, 7000);
  }

  async function voiceStart(target) {
    const agent = target === 'desk' ? activeAgent() : state.agents.find((item) => item.key === state.chatKey);
    if (!agent) return;
    if (voice.active) {
      const same = voice.target === target;
      voiceStop();
      if (same) return;
    }
    if (!canRecord && !SpeechRec) {
      voice.target = target;
      setVoiceNote('Este navegador não grava voz. Digite a mensagem.');
      return;
    }
    voice.active = true;
    voice.target = target;
    voice.agentKey = agent.key;
    voice.idleRounds = 0;
    stopAgentSpeech();
    try {
      const Context = window.AudioContext || window.webkitAudioContext;
      voice.ctx = Context ? new Context() : null;
      if (voice.ctx && voice.ctx.state === 'suspended') await voice.ctx.resume();
    } catch (_) { voice.ctx = null; }
    if (canRecord && !voice.browserMode) {
      try {
        voice.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
        if (!voice.ctx) throw new Error('no-context');
        voice.analyser = voice.ctx.createAnalyser();
        voice.analyser.fftSize = 1024;
        voice.ctx.createMediaStreamSource(voice.stream).connect(voice.analyser);
      } catch (error) {
        if (voice.stream) voice.stream.getTracks().forEach((track) => track.stop());
        voice.stream = null;
        if (SpeechRec && String(error?.message) === 'no-context') voice.browserMode = true;
        else {
          voice.active = false;
          setVoicePhase('idle');
          setVoiceNote('O navegador bloqueou o microfone. Libere a permissão e toque de novo.');
          return;
        }
      }
    }
    if (target === 'chat') $('#officeChatInput')?.blur();
    voiceListen();
  }

  function voiceStop() {
    voice.active = false;
    window.clearInterval(voice.ticker);
    if (voice.recorder && voice.recorder.state === 'recording') { voice.recorder.__discard = true; voice.recorder.stop(); }
    voice.recorder = null;
    if (voice.recognition) { try { voice.recognition.abort(); } catch (_) {} voice.recognition = null; }
    if (voice.stream) voice.stream.getTracks().forEach((track) => track.stop());
    voice.stream = null;
    stopLoopAudio();
    stopAgentSpeech();
    if (voice.ctx) { voice.ctx.close().catch(() => {}); voice.ctx = null; }
    voice.analyser = null;
    setVoicePhase('idle');
  }

  /** Tapping the status line while someone talks interrupts them and listens to you. */
  function interruptVoice() {
    if (!voice.active || voice.phase !== 'speaking') return;
    stopLoopAudio();
    if (window.speechSynthesis) window.speechSynthesis.cancel();
  }

  function bindV4Controls() {
    $('#officeChatMic')?.addEventListener('click', () => voiceStart('chat'));
    $('#officeDeskVoice')?.addEventListener('click', () => voiceStart('desk'));
    $('#officeChatVoiceLive')?.addEventListener('click', interruptVoice);
    $('#officeDeskVoiceLive')?.addEventListener('click', interruptVoice);
    $('#officeDeskEdit')?.addEventListener('click', () => { const agent = activeAgent(); if (agent) openAgentEditor(agent.key); });
    $('#officeDeskTasks')?.addEventListener('click', onTaskClick);
    $('#officeNotes')?.addEventListener('click', onNotesClick);
    $('#officeNoteForm')?.addEventListener('submit', addNote);
    $('#officeNoteWhen')?.addEventListener('change', (event) => {
      const custom = $('#officeNoteCustom');
      if (custom) custom.hidden = event.target.value !== 'custom';
    });
    fillNoteWhen();
    $('#officeChatLog')?.addEventListener('click', (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const button = target.closest('[data-confirm-at]');
      const agent = state.agents.find((item) => item.key === state.chatKey);
      if (button && agent) { button.disabled = true; confirmChat(agent, Number(button.dataset.confirmAt)); }
    });
    $('#agentVoiceTest')?.addEventListener('click', async () => {
      const key = $('#agentKey')?.value;
      const agent = state.agents.find((item) => item.key === key);
      if (!agent) return;
      const button = $('#agentVoiceTest');
      button.disabled = true;
      button.textContent = 'Preparando…';
      const name = $('#agentName')?.value.trim() || agent.name;
      const played = await speakAgent({ ...agent, voiceId: $('#agentVoice')?.value || null }, `Oi${state.userName ? `, ${state.userName}` : ''}! Aqui é ${name}. É assim que eu vou falar com você no escritório.`);
      button.disabled = false;
      button.textContent = played ? 'Ouvir de novo' : 'Indisponível';
    });
    $('#agentPhotoFile')?.addEventListener('change', async (event) => {
      const input = event.target;
      const file = input.files && input.files[0];
      input.value = '';
      if (!file) return;
      if (!$('#agentPhotoConsent')?.checked) { setText('#agentPhotoNote', 'Marque a autorização da pessoa antes de enviar a foto.'); return; }
      try { await savePhoto(await shrinkPhoto(file)); } catch (error) { setText('#agentPhotoNote', String(error?.message || 'Não foi possível usar essa foto.')); }
    });
    $('#agentPhotoRemove')?.addEventListener('click', () => savePhoto(null));
    window.setInterval(() => {
      if (document.visibilityState !== 'visible' || state.busy) return;
      loadReminders().then(() => { renderOffice(); announceDueReminders(); }).catch(() => {});
    }, 30_000);
    window.addEventListener('pagehide', voiceStop);
  }

  window.OfficeAgentVoice = { speak: speakAgent };
  bindControls();
  refresh(true);
})();
