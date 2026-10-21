(() => {
  const $ = (id) => document.getElementById(id);
  const els = {
    notice: $("notice"), history: $("history-list"), refreshHistory: $("refresh-history"),
    start: $("start-call"), end: $("end-call"), title: $("call-status-title"),
    copy: $("call-status-copy"), label: document.querySelector(".live-label"),
    waveform: $("waveform"), avatar: $("voice-avatar"), duration: $("call-duration"),
    transcript: $("transcript-list"), transcriptCount: $("transcript-count"),
    search: $("crm-search"), results: $("crm-results"), selected: $("selected-contact"),
    clear: $("clear-contact"), tabLeads: $("tab-leads"), tabCustomers: $("tab-customers"),
  };

  const state = {
    crmType: "lead", selected: null, conversationId: null, peer: null, channel: null,
    stream: null, audio: null, active: false, connecting: false, finishing: false,
    saveChain: Promise.resolve(), timer: null, startedAt: 0, searchTimer: null,
  };

  const icons = {
    phone: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M6 3.5a2 2 0 0 1 2-2h.5l1.2 3.1-1.5 1.5a12 12 0 0 0 4.2 4.2l1.5-1.5 3.1 1.2v.5a2 2 0 0 1-2 2A12.5 12.5 0 0 1 6 3.5Z"/></svg>',
    arrow: '<svg viewBox="0 0 18 18" aria-hidden="true"><path d="M3 9h11m-4-4 4 4-4 4"/></svg>',
    headset: '<svg viewBox="0 0 18 18" aria-hidden="true"><path d="M3 9V8a6 6 0 0 1 12 0v1M3 9h2.5v5H4a1 1 0 0 1-1-1V9Zm12 0h-2.5v5H14a1 1 0 0 0 1-1V9Zm-2.5 5c-.5 1.1-1.7 1.7-3.5 1.7"/></svg>',
  };

  async function api(url, options = {}) {
    const response = await fetch(url, {
      credentials: "same-origin",
      ...options,
      headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
    return body;
  }

  function showNotice(message, kind = "info") {
    els.notice.textContent = message;
    els.notice.classList.toggle("error", kind === "error");
    els.notice.hidden = false;
  }

  function clearNotice() {
    els.notice.hidden = true;
    els.notice.textContent = "";
    els.notice.classList.remove("error");
  }

  function setCallStatus(kind, title, copy) {
    els.title.textContent = title;
    els.copy.textContent = copy;
    els.label.classList.toggle("connected", kind === "connected" || kind === "listening");
    els.waveform.classList.toggle("active", kind === "connected" || kind === "listening" || kind === "speaking");
    els.avatar.classList.toggle("speaking", kind === "speaking");
    els.start.disabled = state.connecting || state.active;
    els.end.disabled = !state.connecting && !state.active;
  }

  function formatTime(date) {
    return new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" }).format(date);
  }

  function formatDate(dateValue) {
    const date = new Date(dateValue);
    const now = new Date();
    const sameDay = date.toDateString() === now.toDateString();
    return sameDay ? formatTime(date) : new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short" }).format(date);
  }

  function safeText(value, fallback = "") {
    return typeof value === "string" ? value : fallback;
  }

  async function loadHistory() {
    try {
      const { conversations = [] } = await api("/api/mate-voice/conversations");
      els.history.replaceChildren();
      if (!conversations.length) {
        const empty = document.createElement("div");
        empty.className = "history-empty";
        empty.textContent = "Suas conversas aparecerão aqui.";
        els.history.append(empty);
        return;
      }
      for (const item of conversations) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = `history-item${item.id === state.conversationId ? " active" : ""}`;
        button.setAttribute("aria-label", `${safeText(item.title, "Conversa por voz")}, ${formatDate(item.createdAt)}`);
        button.innerHTML = `<span class="history-symbol">${icons.headset}</span><span class="history-copy"><strong></strong><small></small></span>`;
        button.querySelector("strong").textContent = safeText(item.title, "Conversa por voz");
        button.querySelector("small").textContent = `${formatDate(item.createdAt)} · ${item._count?.messages || 0} mensagens`;
        button.addEventListener("click", () => openConversation(item.id));
        els.history.append(button);
      }
    } catch (error) {
      if (!els.history.childElementCount) {
        const empty = document.createElement("div");
        empty.className = "history-empty";
        empty.textContent = error.message || "Não foi possível carregar o histórico.";
        els.history.append(empty);
      }
    }
  }

  function renderTranscript(messages = []) {
    els.transcript.replaceChildren();
    els.transcriptCount.textContent = `${messages.length} ${messages.length === 1 ? "mensagem" : "mensagens"}`;
    if (!messages.length) {
      const empty = document.createElement("div");
      empty.className = "transcript-empty";
      empty.innerHTML = '<span class="empty-wave" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></span><p>A transcrição aparecerá aqui quando a conversa começar.</p>';
      els.transcript.append(empty);
      return;
    }
    for (const message of messages) appendTranscript(message, false);
    els.transcript.scrollTop = els.transcript.scrollHeight;
  }

  function appendTranscript(message, persist = true) {
    const role = message.role === "assistant" ? "assistant" : "user";
    const content = safeText(message.content || message.text).trim();
    if (!content) return;
    const empty = els.transcript.querySelector(".transcript-empty");
    if (empty) empty.remove();
    const row = document.createElement("article");
    row.className = `transcript-message ${role}`;
    const avatar = document.createElement("span");
    avatar.className = "message-avatar";
    avatar.innerHTML = role === "assistant" ? icons.headset : '<svg viewBox="0 0 18 18" aria-hidden="true"><circle cx="9" cy="5.5" r="3"/><path d="M3 15a6 6 0 0 1 12 0"/></svg>';
    const body = document.createElement("div");
    body.className = "message-body";
    const heading = document.createElement("strong");
    heading.textContent = role === "assistant" ? "Mate" : "Você";
    const text = document.createElement("p");
    text.textContent = content;
    const time = document.createElement("span");
    time.className = "message-time";
    time.textContent = formatTime(new Date(message.createdAt || Date.now()));
    body.append(heading, text, time);
    row.append(avatar, body);
    els.transcript.append(row);
    const count = els.transcript.querySelectorAll(".transcript-message").length;
    els.transcriptCount.textContent = `${count} ${count === 1 ? "mensagem" : "mensagens"}`;
    els.transcript.scrollTop = els.transcript.scrollHeight;
    if (persist && state.conversationId) {
      const conversationId = state.conversationId;
      state.saveChain = state.saveChain.then(() => api(`/api/mate-voice/conversations/${conversationId}/messages`, {
        method: "POST", body: JSON.stringify({ role, content }),
      })).catch(() => showNotice("A conversa segue ao vivo, mas não foi possível salvar uma parte da transcrição.", "error"));
    }
  }

  function setSelectedContact(contact) {
    state.selected = contact;
    if (!contact) {
      els.selected.hidden = true;
      els.selected.replaceChildren();
      els.clear.hidden = true;
      return;
    }
    const label = contact.kind === "lead" ? `Lead · ${contact.status || "sem etapa"}` : `Cliente${contact.company ? ` · ${contact.company}` : ""}`;
    els.selected.innerHTML = '<span class="contact-avatar"></span><span class="selected-copy"><strong></strong><small></small></span>';
    els.selected.querySelector(".contact-avatar").textContent = safeText(contact.name, "M").trim().charAt(0).toUpperCase() || "M";
    els.selected.querySelector(".selected-copy strong").textContent = safeText(contact.name, "Contato");
    els.selected.querySelector(".selected-copy small").textContent = label;
    els.selected.hidden = false;
    els.clear.hidden = false;
  }

  function renderCrmResults(results) {
    els.results.replaceChildren();
    if (!results.length) {
      const empty = document.createElement("div");
      empty.className = "crm-empty";
      empty.textContent = "Nenhum registro encontrado.";
      els.results.append(empty);
      return;
    }
    for (const row of results) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "crm-result";
      const avatar = document.createElement("span");
      avatar.className = "contact-avatar";
      avatar.textContent = safeText(row.name, "M").trim().charAt(0).toUpperCase() || "M";
      const copy = document.createElement("span");
      copy.className = "crm-result-copy";
      const name = document.createElement("strong");
      name.textContent = safeText(row.name, "Contato");
      const detail = document.createElement("small");
      detail.textContent = row.kind === "lead" ? `Lead · ${safeText(row.status, "novo")}` : `Cliente${row.company ? ` · ${row.company}` : ""}`;
      copy.append(name, detail);
      const arrow = document.createElement("span");
      arrow.innerHTML = icons.arrow;
      button.append(avatar, copy, arrow);
      button.disabled = state.active || state.connecting;
      button.setAttribute("aria-label", `Selecionar ${row.kind === "lead" ? "lead" : "cliente"} ${safeText(row.name)}`);
      button.addEventListener("click", () => {
        setSelectedContact({ ...row });
        clearNotice();
      });
      els.results.append(button);
    }
  }

  async function searchCrm() {
    const query = els.search.value.trim();
    if (query.length < 2) {
      els.results.innerHTML = '<div class="crm-empty">Busque por pelo menos 2 caracteres.</div>';
      return;
    }
    els.results.innerHTML = '<div class="crm-empty">Buscando no CRM...</div>';
    const path = state.crmType === "lead" ? "leads" : "customers";
    try {
      const { results = [] } = await api(`/api/mate-voice/crm/${path}?q=${encodeURIComponent(query)}`);
      renderCrmResults(results);
    } catch (error) {
      els.results.innerHTML = "";
      const empty = document.createElement("div");
      empty.className = "crm-empty";
      empty.textContent = error.message === "Permission denied" ? "Sem permissão para consultar este tipo de registro." : "Não foi possível buscar no CRM.";
      els.results.append(empty);
    }
  }

  async function openConversation(id) {
    if (state.active || state.connecting) {
      showNotice("Encerre a chamada atual antes de abrir uma conversa anterior.");
      return;
    }
    try {
      const { conversation } = await api(`/api/mate-voice/conversations/${id}`);
      state.conversationId = conversation.id;
      const messages = (conversation.messages || []).map((message) => ({ ...message, role: message.role, content: message.content }));
      renderTranscript(messages);
      if (conversation.lead) setSelectedContact({ ...conversation.lead, kind: "lead" });
      else if (conversation.customer) setSelectedContact({ ...conversation.customer, kind: "customer" });
      setCallStatus("ready", "Conversa anterior", "Seu histórico está carregado. Inicie uma nova sessão para conversar.");
      await loadHistory();
    } catch (error) {
      showNotice(error.message || "Não foi possível abrir esta conversa.", "error");
    }
  }

  function startClock() {
    state.startedAt = Date.now();
    window.clearInterval(state.timer);
    state.timer = window.setInterval(() => {
      const seconds = Math.floor((Date.now() - state.startedAt) / 1000);
      els.duration.textContent = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
    }, 1000);
  }

  function onRealtimeEvent(event) {
    if (event.type === "session.created") {
      setCallStatus("connected", "Você está conectado", "Pode falar: o Mate está ouvindo.");
      return;
    }
    if (event.type === "input_audio_buffer.speech_started") {
      setCallStatus("listening", "O Mate está ouvindo", "Pode continuar falando naturalmente.");
      return;
    }
    if (event.type === "response.created") {
      setCallStatus("speaking", "O Mate está respondendo", "Você pode interromper falando novamente.");
      return;
    }
    if (event.type === "response.done") {
      const waitCalls = (event.response?.output || []).filter((item) => item.type === "function_call" && item.name === "wait_for_user");
      for (const call of waitCalls) {
        // Resolve the no-op tool without requesting another response, so Mate stays quiet and listens.
        if (state.channel?.readyState === "open" && call.call_id) {
          state.channel.send(JSON.stringify({
            type: "conversation.item.create",
            item: { type: "function_call_output", call_id: call.call_id, output: JSON.stringify({ status: "waiting" }) },
          }));
        }
      }
      setCallStatus("connected", "Você está conectado", "Pode falar: o Mate está ouvindo.");
      return;
    }
    if (event.type === "conversation.item.input_audio_transcription.completed") {
      appendTranscript({ role: "user", content: event.transcript });
      setCallStatus("connected", "Você está conectado", "Pode falar: o Mate está ouvindo.");
      return;
    }
    if (event.type === "response.output_audio_transcript.done" || event.type === "response.audio_transcript.done" || event.type === "response.output_text.done") {
      appendTranscript({ role: "assistant", content: event.transcript || event.text });
      return;
    }
    if (event.type === "error") {
      showNotice(event.error?.message || "O serviço de voz retornou um erro.", "error");
    }
  }

  async function connectRealtime(conversationId) {
    const { value: ephemeralKey } = await api(`/api/mate-voice/conversations/${conversationId}/token`, { method: "POST", body: "{}" });
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("Este navegador não permite acesso ao microfone. Use HTTPS ou localhost.");
    state.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    state.peer = new RTCPeerConnection();
    state.audio = document.createElement("audio");
    state.audio.autoplay = true;
    state.audio.setAttribute("aria-label", "Áudio de resposta do Mate");
    state.peer.ontrack = (event) => {
      state.audio.srcObject = event.streams[0];
      void state.audio.play().catch(() => showNotice("Ative o áudio deste site para ouvir as respostas do Mate."));
    };
    for (const track of state.stream.getTracks()) state.peer.addTrack(track, state.stream);
    state.channel = state.peer.createDataChannel("oai-events");
    state.channel.onmessage = (messageEvent) => {
      try { onRealtimeEvent(JSON.parse(messageEvent.data)); } catch { /* ignore malformed server events */ }
    };
    state.channel.onerror = () => showNotice("A conexão de voz encontrou um problema.", "error");
    const channelOpened = new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => reject(new Error("A conexão de voz demorou demais. Tente novamente.")), 25_000);
      state.channel.addEventListener("open", () => { window.clearTimeout(timeout); resolve(); }, { once: true });
      state.channel.addEventListener("close", () => { window.clearTimeout(timeout); reject(new Error("A conexão de voz foi encerrada.")); }, { once: true });
    });
    const offer = await state.peer.createOffer();
    await state.peer.setLocalDescription(offer);
    const sdpResponse = await fetch("https://api.openai.com/v1/realtime/calls", {
      method: "POST",
      headers: { Authorization: `Bearer ${ephemeralKey}`, "Content-Type": "application/sdp" },
      body: offer.sdp,
    });
    if (!sdpResponse.ok) throw new Error("Não foi possível abrir a sessão Realtime. Verifique a configuração de voz do ambiente.");
    await state.peer.setRemoteDescription({ type: "answer", sdp: await sdpResponse.text() });
    await channelOpened;
  }

  async function startCall() {
    if (state.connecting || state.active) return;
    clearNotice();
    state.connecting = true;
    state.conversationId = null;
    state.saveChain = Promise.resolve();
    renderTranscript([]);
    setCallStatus("connecting", "Preparando a conexão", "Solicitando acesso ao microfone e iniciando sessão segura.");
    try {
      const selection = state.selected ? { crmType: state.selected.kind, crmId: state.selected.id } : {};
      const { conversation } = await api("/api/mate-voice/conversations", { method: "POST", body: JSON.stringify(selection) });
      state.conversationId = conversation.id;
      await connectRealtime(conversation.id);
      state.connecting = false;
      state.active = true;
      startClock();
      setCallStatus("connected", "Você está conectado", "Pode falar: o Mate está ouvindo.");
      await loadHistory();
    } catch (error) {
      showNotice(error.message || "Não foi possível iniciar a chamada.", "error");
      await endCall("failed", false);
      setCallStatus("ready", "Seu assistente está pronto", "Conecte-se para iniciar uma conversa natural por voz.");
    }
  }

  function cleanupMedia() {
    window.clearInterval(state.timer);
    state.timer = null;
    if (state.channel && state.channel.readyState !== "closed") state.channel.close();
    if (state.peer) state.peer.close();
    if (state.stream) for (const track of state.stream.getTracks()) track.stop();
    if (state.audio) state.audio.srcObject = null;
    state.channel = null;
    state.peer = null;
    state.stream = null;
    state.audio = null;
    state.active = false;
    state.connecting = false;
    els.duration.textContent = "00:00";
  }

  async function endCall(status = "completed", showReady = true) {
    if (state.finishing) return;
    state.finishing = true;
    const conversationId = state.conversationId;
    cleanupMedia();
    try {
      await state.saveChain;
      if (conversationId) {
        await api(`/api/mate-voice/conversations/${conversationId}/finish`, {
          method: "POST", body: JSON.stringify({ status }),
        });
      }
    } catch { /* keep local controls responsive even if the server is unavailable */ }
    state.finishing = false;
    if (showReady) setCallStatus("ready", "Conversa encerrada", "A transcrição foi salva no seu histórico.");
    await loadHistory();
  }

  function switchCrmType(kind) {
    if (state.active || state.connecting) return;
    state.crmType = kind;
    els.tabLeads.classList.toggle("active", kind === "lead");
    els.tabCustomers.classList.toggle("active", kind === "customer");
    els.tabLeads.setAttribute("aria-selected", String(kind === "lead"));
    els.tabCustomers.setAttribute("aria-selected", String(kind === "customer"));
    els.search.placeholder = kind === "lead" ? "Buscar lead..." : "Buscar cliente...";
    searchCrm();
  }

  els.start.addEventListener("click", startCall);
  els.end.addEventListener("click", () => endCall("completed"));
  els.refreshHistory.addEventListener("click", loadHistory);
  els.clear.addEventListener("click", () => setSelectedContact(null));
  els.tabLeads.addEventListener("click", () => switchCrmType("lead"));
  els.tabCustomers.addEventListener("click", () => switchCrmType("customer"));
  els.search.addEventListener("input", () => {
    window.clearTimeout(state.searchTimer);
    state.searchTimer = window.setTimeout(searchCrm, 220);
  });
  window.addEventListener("beforeunload", () => {
    if (state.peer || state.stream) cleanupMedia();
  });

  setCallStatus("ready", "Seu assistente está pronto", "Conecte-se para iniciar uma conversa natural por voz.");
  loadHistory();
})();
