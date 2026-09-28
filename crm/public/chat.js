/**
 * ObraMate internal chat UI — list, thread, @ / autocomplete, attachments, SSE.
 */
(function () {
  const TOKEN_RE =
    /<@(user:([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})|team|all|equipe|todos)>|<#job:([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})>/gi;

  const state = {
    me: null,
    perms: [],
    conversations: [],
    jobs: [],
    jobsLoading: false,
    jobsLoadSeq: 0,
    jobsSearchTimer: null,
    filter: "all",
    listQuery: "",
    jobStatus: "active",
    jobFrom: "",
    jobTo: "",
    activeId: null,
    messages: [],
    hasMore: false,
    loadingOlder: false,
    contextJob: null,
    typingTimer: null,
    ac: { open: false, mode: null, items: [], index: 0, start: 0, query: "" },
    pendingFiles: [],
    groupSelected: new Set(),
    userNameCache: {},
    jobLabelCache: {},
    realtime: null,
    muted: false,
    highlightId: null,
    editingId: null,
    canViewHidden: false,
    mentionsUnreadOnly: true,
  };

  function $(id) {
    return document.getElementById(id);
  }

  function notify(msg, type) {
    if (typeof window.crmNotify === "function") window.crmNotify(msg, type || "info");
    else console.log(msg);
  }

  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
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

  function hasPerm(key) {
    if (!state.me) return false;
    if (state.me.roleKey === "admin") return true;
    return (state.perms || []).includes(key);
  }

  function updateDocTitle() {
    const total = state.conversations.reduce((n, c) => n + (c.unread_count || 0), 0);
    document.title = total > 0 ? `(${total}) Chat | ObraMate` : "Chat | ObraMate";
  }

  function fmtTime(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    if (sameDay) return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }

  function typeLabel(t) {
    if (t === "job") return "Job";
    if (t === "group") return "Grupo";
    if (t === "dm") return "DM";
    return t || "";
  }

  function sectionFor(c) {
    return c.type === "job" ? "Jobs" : c.type === "group" ? "Grupos" : "Diretas";
  }


  function jobCompanyFrom(j) {
    if (!j) return "Job";
    return (
      j.company ||
      j.customer_name ||
      j.customer?.name ||
      j.builder?.company ||
      j.builder?.name ||
      j.source_name ||
      j.title ||
      (j.number != null ? `Job #${j.number}` : "Job")
    );
  }

  function jobAddressFrom(j) {
    if (!j) return "";
    return String(j.address || "").trim();
  }

  function formatJobChipLabel(j) {
    const company = jobCompanyFrom(j);
    const addr = jobAddressFrom(j);
    if (!addr) return company;
    const short = addr.length > 36 ? addr.slice(0, 34) + "…" : addr;
    return `${company} · ${short}`;
  }

  function formatJobFullLabel(j) {
    const company = jobCompanyFrom(j);
    const addr = jobAddressFrom(j);
    return addr ? `${company} · ${addr}` : company;
  }

  function humanizePreview(body, conv) {
    let text = String(body || "");
    text = text
      .replace(/<@user:[0-9a-f-]+>/gi, "@alguém")
      .replace(/<@team>/gi, "@equipe")
      .replace(/<@all>/gi, "@todos")
      .replace(/<#job:([0-9a-f-]+)>/gi, (_, id) => {
        const j = state.jobLabelCache[id] || (conv?.work_order_id === id ? conv.work_order : null);
        return j ? jobCompanyFrom(j) : "Job";
      });
    return text;
  }

  // —— Body render ——
  function renderBodyHtml(body, jobs) {
    if (body == null) return "<em>Mensagem removida</em>";
    const jobMap = {};
    (jobs || []).forEach((j) => {
      jobMap[j.id] = j;
    });
    let html = "";
    let last = 0;
    const re = new RegExp(TOKEN_RE.source, "gi");
    let m;
    const text = String(body);
    while ((m = re.exec(text)) !== null) {
      html += linkifyText(escapeHtml(text.slice(last, m.index)));
      const full = m[0];
      const lower = full.toLowerCase();
      if (lower.startsWith("<@user:") && m[2]) {
        const name = state.userNameCache[m[2]] || "usuário";
        html += `<span class="chat-chip chat-chip--user">@${escapeHtml(name)}</span>`;
      } else if (lower === "<@team>" || lower === "<@equipe>") {
        html += `<span class="chat-chip chat-chip--special">@equipe</span>`;
      } else if (lower === "<@all>" || lower === "<@todos>") {
        html += `<span class="chat-chip chat-chip--special">@todos</span>`;
      } else if (lower.startsWith("<#job:") && m[3]) {
        const j = jobMap[m[3]] || state.jobLabelCache[m[3]];
        const label = formatJobChipLabel(j);
        html += `<a class="chat-chip chat-chip--job" href="job-detail.html?id=${encodeURIComponent(m[3])}" title="${escapeHtml(
          formatJobFullLabel(j),
        )}">${escapeHtml(label)}</a>`;
      } else {
        html += escapeHtml(full);
      }
      last = m.index + full.length;
    }
    html += linkifyText(escapeHtml(text.slice(last)));
    return html;
  }

  function linkifyText(escaped) {
    return escaped.replace(/(https?:\/\/[^\s<&]+)/g, (url) => {
      return `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`;
    });
  }

  // —— List ——
  function jobStatusLabel(status) {
    const map = {
      draft: "Rascunho",
      scheduled: "Agendado",
      in_progress: "Andamento",
      completed: "Concluído",
      canceled: "Cancelado",
    };
    return map[status] || status || "";
  }

  function fmtJobSchedule(start) {
    if (!start) return "Sem agenda";
    const d = new Date(start);
    if (Number.isNaN(d.getTime())) return "Sem agenda";
    return d.toLocaleDateString(undefined, { day: "2-digit", month: "short" });
  }

  function toLocalDateInputValue(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  function syncJobFilterUi() {
    const filters = $("chatJobFilters");
    const search = $("chatListSearch");
    const onJobs = state.filter === "job";
    if (filters) filters.hidden = !onJobs;
    if (search) {
      search.placeholder = onJobs ? "Buscar jobs…" : "Buscar conversas…";
    }
    if ($("chatJobStatus")) $("chatJobStatus").value = state.jobStatus || "active";
    if ($("chatJobFrom")) $("chatJobFrom").value = state.jobFrom || "";
    if ($("chatJobTo")) $("chatJobTo").value = state.jobTo || "";
  }

  function filteredConversations() {
    const q = state.listQuery.trim().toLowerCase();
    return state.conversations.filter((c) => {
      if (state.filter !== "all" && c.type !== state.filter) return false;
      if (!q) return true;
      const hay = `${c.title || ""} ${c.name || ""} ${c.work_order?.title || ""}`.toLowerCase();
      return hay.includes(q);
    });
  }

  function renderJobsList() {
    const empty = $("chatListEmpty");
    const root = $("chatListSections");
    if (state.jobsLoading && !state.jobs.length) {
      empty.hidden = false;
      empty.textContent = "Carregando jobs…";
      root.hidden = true;
      root.innerHTML = "";
      return;
    }
    if (!state.jobs.length) {
      empty.hidden = false;
      empty.textContent = "Nenhum job neste filtro.";
      root.hidden = true;
      root.innerHTML = "";
      return;
    }
    empty.hidden = true;
    root.hidden = false;
    let html = "";
    state.jobs.forEach((job) => {
      const active =
        job.conversation_id && job.conversation_id === state.activeId ? " is-active" : "";
      const badge =
        job.unread_count > 0
          ? `<span class="chat-conv__badge">${job.unread_count > 99 ? "99+" : job.unread_count}</span>`
          : "";
      const company = job.company || job.customer_name || job.title || "Job";
      const addr = job.address || "";
      const preview = job.last_message
        ? humanizePreview(job.last_message.body, { work_order: job, work_order_id: job.id })
        : addr || "Abrir canal do job";
      const addrHtml = addr
        ? `<span class="chat-conv__addr">${escapeHtml(addr)}</span>`
        : "";
      html += `<button type="button" class="chat-conv chat-conv--job${active}" data-work-order-id="${job.id}"${
        job.conversation_id ? ` data-id="${job.conversation_id}"` : ""
      }>
        <span class="chat-conv__title"><span class="chat-conv__status is-${escapeHtml(
          job.status || "",
        )}">${escapeHtml(jobStatusLabel(job.status))}</span>${escapeHtml(company)}</span>
        <span class="chat-conv__time">${escapeHtml(fmtJobSchedule(job.scheduled_start))}</span>
        ${addrHtml}
        <span class="chat-conv__preview">${escapeHtml(String(preview || "").slice(0, 90))}</span>
        ${badge}
      </button>`;
    });
    root.innerHTML = html;
  }

  function renderList() {
    if (state.filter === "job") {
      renderJobsList();
      return;
    }
    const empty = $("chatListEmpty");
    const root = $("chatListSections");
    const rows = filteredConversations();
    if (!rows.length) {
      empty.hidden = false;
      empty.textContent = state.conversations.length
        ? "Nenhuma conversa neste filtro."
        : "Nenhuma conversa ainda. Inicie uma DM ou grupo.";
      root.hidden = true;
      root.innerHTML = "";
      return;
    }
    empty.hidden = true;
    root.hidden = false;
    const order = ["Jobs", "Grupos", "Diretas"];
    const bySec = { Jobs: [], Grupos: [], Diretas: [] };
    rows.forEach((c) => bySec[sectionFor(c)].push(c));
    let html = "";
    order.forEach((sec) => {
      if (!bySec[sec].length) return;
      if (state.filter === "all") html += `<p class="chat-section-label">${sec}</p>`;
      bySec[sec].forEach((c) => {
        const active = c.id === state.activeId ? " is-active" : "";
        const badge =
          c.unread_count > 0
            ? `<span class="chat-conv__badge">${c.unread_count > 99 ? "99+" : c.unread_count}</span>`
            : "";
        const rawPreview = c.last_message
          ? c.last_message.body
          : "Sem mensagens";
        const preview = humanizePreview(rawPreview, c);
        const company =
          c.type === "job"
            ? c.work_order?.company || c.title || c.name || "Job"
            : c.title || c.name || "Conversa";
        const addr = c.type === "job" ? c.subtitle || c.work_order?.address || "" : "";
        const addrHtml = addr
          ? `<span class="chat-conv__addr">${escapeHtml(addr)}</span>`
          : "";
        html += `<button type="button" class="chat-conv${active}${
          c.type === "job" ? " chat-conv--job" : ""
        }" data-id="${c.id}">
          <span class="chat-conv__title"><span class="chat-conv__type">${typeLabel(c.type)}</span>${escapeHtml(company)}</span>
          <span class="chat-conv__time">${fmtTime(c.last_message?.created_at || c.updated_at)}</span>
          ${addrHtml}
          <span class="chat-conv__preview">${escapeHtml(String(preview || "").slice(0, 90))}</span>
          ${badge}
        </button>`;
      });
    });
    root.innerHTML = html;
  }

  async function loadJobsList() {
    if (state.filter !== "job") return;
    const seq = ++state.jobsLoadSeq;
    state.jobsLoading = true;
    renderJobsList();
    try {
      const params = new URLSearchParams();
      params.set("status", state.jobStatus || "active");
      if (state.listQuery.trim()) params.set("q", state.listQuery.trim());
      if (state.jobFrom) params.set("from", state.jobFrom);
      if (state.jobTo) params.set("to", state.jobTo);
      const j = await api(`/api/chat/jobs?${params.toString()}`);
      if (seq !== state.jobsLoadSeq) return;
      state.jobs = j.data || [];
      state.jobs.forEach((job) => {
        state.jobLabelCache[job.id] = job;
      });
    } catch (err) {
      if (seq !== state.jobsLoadSeq) return;
      state.jobs = [];
      notify(err.message || "Falha ao carregar jobs", "error");
    } finally {
      if (seq === state.jobsLoadSeq) {
        state.jobsLoading = false;
        renderJobsList();
      }
    }
  }

  function scheduleJobsReload(immediate) {
    if (state.jobsSearchTimer) clearTimeout(state.jobsSearchTimer);
    if (immediate) {
      loadJobsList();
      return;
    }
    state.jobsSearchTimer = setTimeout(() => loadJobsList(), 280);
  }

  async function openJobChannel(workOrderId) {
    const j = await api(`/api/chat/jobs/${encodeURIComponent(workOrderId)}/ensure-channel`, {
      method: "POST",
      body: "{}",
    });
    const conversationId = j.data?.conversationId || j.data?.conversation_id;
    if (!conversationId) throw new Error("Canal do job não disponível");
    await loadConversations();
    if (state.filter === "job") await loadJobsList();
    await openConversation(conversationId);
  }

  async function loadConversations() {
    const j = await api("/api/chat/conversations");
    state.conversations = j.data || [];
    state.conversations.forEach((c) => {
      if (c.work_order?.id) state.jobLabelCache[c.work_order.id] = c.work_order;
    });
    renderList();
    updateDocTitle();
    if (typeof window.__crmUpdateChatBadge === "function") {
      window.__crmUpdateChatBadge();
    }
    refreshMentionsBadge().catch(() => {});
  }

  // —— Thread ——
  function showThread(show) {
    document.body.classList.toggle("chat-show-thread", !!show);
  }

  function scrollToBottom(force) {
    const el = $("chatMessages");
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (force || nearBottom) el.scrollTop = el.scrollHeight;
  }

  function renderAttachments(atts) {
    if (!atts || !atts.length) return "";
    return `<div class="chat-msg__atts">${atts
      .map((a) => {
        if ((a.mime_type || "").startsWith("image/")) {
          return `<a href="${escapeHtml(a.url)}" target="_blank" rel="noopener"><img src="${escapeHtml(a.thumb_url || a.url)}" alt="" loading="lazy" /></a>`;
        }
        if ((a.mime_type || "").startsWith("video/")) {
          return `<a class="chat-file-link" href="${escapeHtml(a.url)}" target="_blank" rel="noopener">Vídeo</a>`;
        }
        return `<a class="chat-file-link" href="${escapeHtml(a.url)}" target="_blank" rel="noopener">Anexo (${escapeHtml(a.mime_type || "file")})</a>`;
      })
      .join("")}</div>`;
  }

  function renderMessages() {
    const inner = $("chatMessagesInner");
    const loadOlder = $("chatLoadOlder");
    loadOlder.hidden = !state.hasMore;
    inner.innerHTML = state.messages
      .map((m) => {
        if (m.type === "system") {
          return `<div class="chat-msg chat-msg--system" data-id="${m.id}"><div class="chat-msg__bubble">${escapeHtml(m.body || "")}</div></div>`;
        }
        const mine = m.author_id === state.me?.id;
        const cls = [
          "chat-msg",
          mine ? "chat-msg--mine" : "",
          m._status === "sending" ? "is-sending" : "",
          m._status === "error" ? "is-error" : "",
          m.id === state.highlightId ? "is-highlight" : "",
        ]
          .filter(Boolean)
          .join(" ");
        const author = m.author?.name || (mine ? "Você" : "—");
        const edited = m.edited_at ? `<span class="chat-msg__edited">(editado)</span>` : "";
        const removedNote =
          m.hidden && m.can_view_original
            ? `<span class="chat-msg__edited">(removida — visível a gestores)</span>`
            : "";
        const isTmp = String(m.id).startsWith("tmp_");
        const editing = state.editingId === m.id;

        let bubbleInner;
        if (editing) {
          bubbleInner = `<div class="chat-msg__edit">
            <textarea data-edit-area="${m.id}"></textarea>
            <div class="chat-msg__edit-actions">
              <button type="button" class="btn btn-secondary" data-edit-cancel="${m.id}">Cancelar</button>
              <button type="button" class="btn btn-primary" data-edit-save="${m.id}">Salvar</button>
            </div>
          </div>`;
        } else if (m.hidden && !m.can_view_original) {
          bubbleInner = `<em>${escapeHtml(m.hidden_placeholder || "Mensagem removida")}</em>`;
        } else {
          bubbleInner =
            renderBodyHtml(m.body, m.jobs) + renderAttachments(m.attachments);
        }

        const status =
          m._status === "error"
            ? `<div class="chat-msg__status"><button type="button" data-retry="${m._tempId || m.id}">Tentar novamente</button></div>`
            : m._status === "sending"
              ? `<div class="chat-msg__status">Enviando…</div>`
              : "";

        const actions = [];
        if (!isTmp && !editing && m.type === "text") {
          if (!m.hidden && mine) {
            actions.push(`<button type="button" data-edit="${m.id}">Editar</button>`);
            actions.push(`<button type="button" data-hide="${m.id}">Remover</button>`);
          } else if (!m.hidden && state.canViewHidden) {
            actions.push(`<button type="button" data-hide="${m.id}">Remover</button>`);
          }
          if (m.edited_at && state.canViewHidden) {
            actions.push(`<button type="button" data-history="${m.id}">Histórico</button>`);
          }
        }
        const actionsHtml = actions.length
          ? `<div class="chat-msg__actions">${actions.join("")}</div>`
          : "";

        const historyHtml =
          m._showHistory && Array.isArray(m.edits) && m.edits.length
            ? `<div class="chat-msg__history">${m.edits
                .map(
                  (e) =>
                    `<p><strong>${fmtTime(e.edited_at)}</strong>: ${escapeHtml(e.previous_body || "")}</p>`,
                )
                .join("")}</div>`
            : m._showHistory
              ? `<div class="chat-msg__history"><p>Sem versões anteriores nesta carga.</p></div>`
              : "";

        return `<div class="${cls}" data-id="${m.id}">
          <div class="chat-msg__meta">${escapeHtml(author)} · ${fmtTime(m.created_at)}${edited}${removedNote}</div>
          <div class="chat-msg__bubble">${bubbleInner}</div>
          ${actionsHtml}
          ${historyHtml}
          ${status}
        </div>`;
      })
      .join("");

    state.messages.forEach((m) => {
      if (state.editingId === m.id) {
        const ta = inner.querySelector(`[data-edit-area="${CSS.escape(m.id)}"]`);
        if (ta) ta.value = m.body || "";
      }
    });
  }

  async function openConversation(id, opts) {
    opts = opts || {};
    state.activeId = id;
    state.messages = [];
    state.hasMore = false;
    state.highlightId = opts.highlightId || null;
    $("chatThreadEmpty").hidden = true;
    $("chatThread").hidden = false;
    showThread(true);
    renderList();

    const detail = await api(`/api/chat/conversations/${id}`);
    const d = detail.data;
    const conv = state.conversations.find((c) => c.id === id);
    if (d.type === "job") {
      const job = d.context_job || conv?.work_order;
      if (job?.id) state.jobLabelCache[job.id] = job;
      $("chatThreadTitle").textContent = jobCompanyFrom(job) || d.name || "Job";
      $("chatThreadSub").textContent = jobAddressFrom(job) || "Canal da obra";
    } else {
      $("chatThreadTitle").textContent = d.name || conv?.title || "Conversa";
      $("chatThreadSub").textContent =
        d.members
          ?.map((m) => m.name)
          .filter(Boolean)
          .slice(0, 6)
          .join(", ") || typeLabel(d.type);
    }
    state.muted = !!d.muted;
    $("chatMuteBtn").setAttribute("aria-pressed", state.muted ? "true" : "false");
    $("chatMuteBtn").title = state.muted ? "Reativar notificações" : "Silenciar";
    $("chatMuteBtn").classList.toggle("is-muted", state.muted);

    if (d.type === "job" && d.work_order_id) {
      state.contextJob = d.context_job || { id: d.work_order_id };
      $("chatContextChip").hidden = true;
    } else {
      state.contextJob = d.context_job || null;
      updateContextChip();
    }

    (d.members || []).forEach((m) => {
      state.userNameCache[m.user_id] = m.name;
    });

    await loadMessages({ initial: true });
    await api(`/api/chat/conversations/${id}/read`, { method: "POST", body: "{}" });
    const conv = state.conversations.find((c) => c.id === id);
    if (conv) conv.unread_count = 0;
    renderList();

    connectRealtime(id);

    if (opts.highlightId) {
      requestAnimationFrame(() => {
        const el = innerMsgEl(opts.highlightId);
        if (el) {
          el.scrollIntoView({ block: "center" });
          setTimeout(() => {
            state.highlightId = null;
            el.classList.remove("is-highlight");
          }, 2500);
        }
      });
    } else {
      scrollToBottom(true);
    }

    const url = new URL(window.location.href);
    url.searchParams.set("c", id);
    if (opts.highlightId) url.searchParams.set("m", opts.highlightId);
    else url.searchParams.delete("m");
    history.replaceState(null, "", url.pathname + url.search);
  }

  function innerMsgEl(id) {
    return $("chatMessagesInner").querySelector(`[data-id="${CSS.escape(id)}"]`);
  }

  async function loadMessages(opts) {
    opts = opts || {};
    if (!state.activeId) return;
    const params = new URLSearchParams({ limit: "40" });
    if (opts.before) params.set("before", opts.before);
    const j = await api(`/api/chat/conversations/${state.activeId}/messages?${params}`);
    const batch = j.data?.messages || [];
    state.hasMore = !!j.data?.has_more;
    batch.forEach((m) => {
      if (m.author?.id) state.userNameCache[m.author.id] = m.author.name;
      (m.jobs || []).forEach((job) => {
        state.jobLabelCache[job.id] = job;
      });
    });
    if (opts.before) {
      state.messages = [...batch, ...state.messages];
    } else {
      state.messages = batch;
    }
    renderMessages();
    if (opts.initial) scrollToBottom(true);
  }

  function updateContextChip() {
    const chip = $("chatContextChip");
    if (!state.contextJob || !state.activeId) {
      chip.hidden = true;
      return;
    }
    const conv = state.conversations.find((c) => c.id === state.activeId);
    if (conv?.type === "job") {
      chip.hidden = true;
      return;
    }
    const j = state.contextJob;
    $("chatContextLabel").textContent = formatJobFullLabel(j);
    chip.hidden = false;
  }

  // —— Send ——
  async function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function renderPendingFiles() {
    const el = $("chatPendingFiles");
    if (!state.pendingFiles.length) {
      el.hidden = true;
      el.innerHTML = "";
      return;
    }
    el.hidden = false;
    el.innerHTML = state.pendingFiles
      .map((f, i) => {
        if (f.preview) {
          return `<div class="chat-pending-files__item"><img src="${f.preview}" alt="" /><button type="button" data-rm="${i}" aria-label="Remover">✕</button></div>`;
        }
        return `<div class="chat-pending-files__item chat-pending-files__doc">${escapeHtml(f.name)}<button type="button" data-rm="${i}">✕</button></div>`;
      })
      .join("");
  }

  async function addFiles(fileList) {
    const files = [...fileList].slice(0, 8 - state.pendingFiles.length);
    for (const file of files) {
      const dataUrl = await fileToDataUrl(file);
      state.pendingFiles.push({
        name: file.name,
        data_url: dataUrl,
        preview: file.type.startsWith("image/") ? dataUrl : null,
        mime: file.type,
      });
    }
    renderPendingFiles();
  }

  async function sendMessage(opts) {
    opts = opts || {};
    if (!state.activeId) return;
    const input = $("chatInput");
    let body = opts.body != null ? opts.body : input.value;
    body = String(body || "");
    if (!body.trim() && !state.pendingFiles.length && !opts.attachments) return;

    const attachments =
      opts.attachments ||
      state.pendingFiles.map((f) => ({
        data_url: f.data_url,
      }));

    const tempId = "tmp_" + Date.now();
    const optimistic = {
      id: tempId,
      _tempId: tempId,
      _status: "sending",
      _payload: { body, attachments, add_mentioned_members: opts.add_mentioned_members },
      body,
      type: "text",
      author_id: state.me.id,
      author: { id: state.me.id, name: state.me.name },
      created_at: new Date().toISOString(),
      edited_at: null,
      hidden: false,
      attachments: [],
      jobs: state.contextJob ? [state.contextJob] : [],
    };
    if (!opts.retry) {
      state.messages.push(optimistic);
      input.value = "";
      autosizeInput();
      state.pendingFiles = [];
      renderPendingFiles();
      hideAc();
      renderMessages();
      scrollToBottom(true);
    } else {
      const existing = state.messages.find((m) => m.id === opts.retryId || m._tempId === opts.retryId);
      if (existing) {
        existing._status = "sending";
        body = existing._payload.body;
        renderMessages();
      }
    }

    try {
      // Non-member mentions: ask once
      let addMembers = opts.add_mentioned_members;
      const j = await api(`/api/chat/conversations/${state.activeId}/messages`, {
        method: "POST",
        body: JSON.stringify({
          body,
          attachments,
          add_mentioned_members: !!addMembers,
        }),
      });
      const data = j.data;
      if (data.non_member_mentions?.length && addMembers == null) {
        const ok = window.confirm(
          "Há pessoas mencionadas que não estão nesta conversa. Deseja adicioná-las?",
        );
        if (ok) {
          return sendMessage({
            body,
            attachments,
            add_mentioned_members: true,
            retry: true,
            retryId: tempId,
          });
        }
      }
      state.messages = state.messages.filter((m) => m.id !== tempId && m._tempId !== tempId);
      state.messages.push({
        ...data,
        author: { id: state.me.id, name: state.me.name },
        jobs: (data.job_ids || []).map((id) => state.jobLabelCache[id] || { id }),
      });
      renderMessages();
      scrollToBottom(true);
      await loadConversations();
    } catch (err) {
      const existing = state.messages.find((m) => m.id === tempId || m._tempId === tempId);
      if (existing) {
        existing._status = "error";
        renderMessages();
      }
      notify(err.message || "Falha ao enviar", "error");
    }
  }

  // —— Autocomplete @ / ——
  function hideAc() {
    state.ac.open = false;
    state.ac.items = [];
    $("chatAc").hidden = true;
    $("chatAc").innerHTML = "";
  }

  function renderAc() {
    const el = $("chatAc");
    if (!state.ac.open || !state.ac.items.length) {
      el.hidden = true;
      return;
    }
    el.hidden = false;
    el.innerHTML = state.ac.items
      .map((item, i) => {
        const active = i === state.ac.index ? " is-active" : "";
        return `<button type="button" class="chat-ac__item${active}" role="option" data-i="${i}">
          ${escapeHtml(item.label)}
          ${item.sub ? `<small>${escapeHtml(item.sub)}</small>` : ""}
        </button>`;
      })
      .join("");
  }

  async function updateAutocomplete() {
    const input = $("chatInput");
    const val = input.value;
    const caret = input.selectionStart || 0;
    const before = val.slice(0, caret);
    const at = before.match(/(^|\s)@([^\s@]*)$/);
    const slash = before.match(/(^|\s)\/([^\s/]*)$/);

    if (at) {
      state.ac.mode = "mention";
      state.ac.start = caret - at[2].length - 1;
      state.ac.query = at[2];
      const q = at[2];
      const items = [];
      items.push({
        kind: "special",
        token: "<@team>",
        label: "@equipe",
        sub: "Membros do Job / conversa",
      });
      if (hasPerm("chat.mention_all")) {
        items.push({
          kind: "special",
          token: "<@all>",
          label: "@todos",
          sub: "Todos os membros da conversa",
        });
      }
      try {
        const j = await api(`/api/chat/users?q=${encodeURIComponent(q)}`);
        (j.data || []).forEach((u) => {
          if (u.id === state.me.id) return;
          state.userNameCache[u.id] = u.name;
          items.push({
            kind: "user",
            token: `<@user:${u.id}>`,
            label: u.name,
            sub: u.email,
            userId: u.id,
          });
        });
      } catch (_) {
        /* ignore */
      }
      state.ac.items = items.slice(0, 12);
      state.ac.index = 0;
      state.ac.open = true;
      renderAc();
      return;
    }

    if (slash) {
      state.ac.mode = "job";
      state.ac.start = caret - slash[2].length - 1;
      state.ac.query = slash[2];
      try {
        const j = await api(`/api/chat/jobs-suggest?q=${encodeURIComponent(slash[2])}`);
        state.ac.items = (j.data || []).map((job) => {
          state.jobLabelCache[job.id] = job;
          return {
            kind: "job",
            token: job.token,
            label: job.company || job.label || job.customer_name || job.title || "Job",
            sub: [job.address, jobStatusLabel(job.status)].filter(Boolean).join(" · "),
            job,
          };
        });
        state.ac.index = 0;
        state.ac.open = !!state.ac.items.length;
        renderAc();
      } catch (_) {
        hideAc();
      }
      return;
    }

    hideAc();
  }

  function applyAcItem(item) {
    const input = $("chatInput");
    const val = input.value;
    const caret = input.selectionStart || 0;
    const before = val.slice(0, state.ac.start);
    const after = val.slice(caret);
    const insert = item.token + " ";
    input.value = before + insert + after;
    const pos = before.length + insert.length;
    input.setSelectionRange(pos, pos);
    input.focus();
    hideAc();

    if (item.kind === "job" && item.job) {
      setContextJob(item.job).catch(() => {});
    }
    autosizeInput();
  }

  async function setContextJob(job) {
    if (!state.activeId) return;
    const conv = state.conversations.find((c) => c.id === state.activeId);
    if (conv?.type === "job") return;
    await api(`/api/chat/conversations/${state.activeId}/context`, {
      method: "PUT",
      body: JSON.stringify({ work_order_id: job.id }),
    });
    state.contextJob = job;
    state.jobLabelCache[job.id] = job;
    updateContextChip();
  }

  async function clearContextJob() {
    if (!state.activeId) return;
    await api(`/api/chat/conversations/${state.activeId}/context`, {
      method: "PUT",
      body: JSON.stringify({ work_order_id: null }),
    });
    state.contextJob = null;
    updateContextChip();
  }

  function autosizeInput() {
    const input = $("chatInput");
    input.style.height = "auto";
    input.style.height = Math.min(140, Math.max(44, input.scrollHeight)) + "px";
  }

  // —— Typing + realtime ——
  function sendTyping(flag) {
    if (!state.activeId) return;
    api(`/api/chat/conversations/${state.activeId}/typing`, {
      method: "POST",
      body: JSON.stringify({ typing: !!flag }),
    }).catch(() => {});
  }

  function connectRealtime(_conversationId) {
    if (state.realtime) {
      state.realtime.close();
      state.realtime = null;
    }
    if (!window.ChatRealtime) return;
    state.realtime = window.ChatRealtime.connect({
      // Org-wide membership stream (not filtered) so list/unread stay live
      getAfterMessageId: () => {
        const real = [...state.messages].reverse().find((m) => m.id && !String(m.id).startsWith("tmp_"));
        return real?.id || null;
      },
      fetchMessagesSince: async (afterId) => {
        if (!afterId || !state.activeId) return;
        const j = await api(
          `/api/chat/conversations/${state.activeId}/messages?after=${encodeURIComponent(afterId)}&limit=50`,
        );
        const batch = j.data?.messages || [];
        if (!batch.length) return;
        const have = new Set(state.messages.map((m) => m.id));
        batch.forEach((m) => {
          if (!have.has(m.id)) state.messages.push(m);
        });
        state.messages.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
        renderMessages();
        scrollToBottom(false);
      },
      onEvent: (ev) => {
        if (!ev) return;
        if (ev.conversationId !== state.activeId) {
          if (ev.type === "message.created" || ev.type === "conversation.updated" || ev.type === "mention.created") {
            loadConversations().catch(() => {});
            if (typeof window.__crmUpdateChatBadge === "function") window.__crmUpdateChatBadge();
            if (ev.type === "mention.created") refreshMentionsBadge().catch(() => {});
          }
          return;
        }
        if (ev.type === "typing") {
          const users = (ev.payload?.users || []).filter((u) => u.user_id !== state.me.id);
          const el = $("chatTyping");
          if (users.length) {
            el.hidden = false;
            el.textContent =
              users.length === 1
                ? `${users[0].name} está digitando…`
                : `${users.length} pessoas estão digitando…`;
          } else {
            el.hidden = true;
          }
          return;
        }
        if (ev.type === "message.created" && ev.payload?.message) {
          const msg = ev.payload.message;
          if (msg.author_id === state.me.id) return;
          if (state.messages.some((m) => m.id === msg.id)) return;
          state.messages.push(msg);
          renderMessages();
          scrollToBottom(false);
          api(`/api/chat/conversations/${state.activeId}/read`, {
            method: "POST",
            body: JSON.stringify({ message_id: msg.id }),
          }).catch(() => {});
          loadConversations().catch(() => {});
          return;
        }
        if (ev.type === "message.updated" && ev.payload?.message) {
          const msg = ev.payload.message;
          const idx = state.messages.findIndex((m) => m.id === msg.id);
          if (idx >= 0) {
            state.messages[idx] = { ...state.messages[idx], ...msg };
            renderMessages();
          }
          return;
        }
        if (ev.type === "message.hidden" && ev.payload?.message) {
          const msg = ev.payload.message;
          const idx = state.messages.findIndex((m) => m.id === msg.id);
          if (idx >= 0) {
            state.messages[idx] = { ...state.messages[idx], ...msg };
            renderMessages();
          }
        }
      },
    });
  }

  // —— Modals ——
  function openModal(id) {
    $(id).hidden = false;
  }
  function closeModal(id) {
    $(id).hidden = true;
  }

  async function loadUserPicker(listId, q, multi) {
    const j = await api(`/api/chat/users?q=${encodeURIComponent(q || "")}`);
    const el = $(listId);
    el.innerHTML = (j.data || [])
      .filter((u) => u.id !== state.me.id)
      .map((u) => {
        const sel = multi && state.groupSelected.has(u.id) ? " is-selected" : "";
        return `<button type="button" data-user="${u.id}" data-name="${escapeHtml(u.name)}" class="${sel}">
          <strong>${escapeHtml(u.name)}</strong>
          <span style="color:#6b645c;font-size:0.85rem">${escapeHtml(u.email || "")}</span>
        </button>`;
      })
      .join("") || `<p class="chat-empty">Nenhum usuário</p>`;
  }

  async function refreshMentionsBadge() {
    try {
      const j = await api("/api/chat/unread");
      const n = Number(j.data?.unread_mentions || 0);
      const badge = $("chatMentionsBadge");
      if (!badge) return;
      if (n > 0) {
        badge.hidden = false;
        badge.textContent = n > 99 ? "99+" : String(n);
      } else {
        badge.hidden = true;
        badge.textContent = "";
      }
    } catch (_) {
      /* ignore */
    }
  }

  async function loadMentionsPanel() {
    const list = $("chatMentionsList");
    list.innerHTML = `<p class="chat-empty">A carregar…</p>`;
    const q = state.mentionsUnreadOnly ? "?unread=1" : "";
    const j = await api(`/api/chat/mentions${q}`);
    const rows = j.data || [];
    if (!rows.length) {
      list.innerHTML = `<p class="chat-empty">${state.mentionsUnreadOnly ? "Nenhuma menção não lida." : "Nenhuma menção."}</p>`;
      return;
    }
    list.innerHTML = rows
      .map((r) => {
        const unread = !r.read_at ? " is-unread" : "";
        const author = r.message?.author?.name || "Alguém";
        const conv = r.message?.conversation?.name || typeLabel(r.message?.conversation?.type);
        const preview = String(r.message?.body || "").slice(0, 100);
        return `<button type="button" class="chat-mention-row${unread}" data-mention-id="${r.id}" data-conv="${r.message?.conversation?.id || ""}" data-msg="${r.message?.id || ""}">
          <div class="chat-mention-row__top">
            <strong>${escapeHtml(author)}</strong>
            <span>${fmtTime(r.created_at)}</span>
          </div>
          <div class="chat-mention-row__body">${escapeHtml(preview)}</div>
          <div class="chat-mention-row__meta">${escapeHtml(conv)} · ${escapeHtml(r.mention_type || "user")}${r.read_at ? "" : " · não lida"}</div>
        </button>`;
      })
      .join("");
  }

  // —— Init ——
  async function init() {
    try {
      const r = await fetch("/api/auth/session", { credentials: "include" });
      const j = await r.json();
      if (!j.authenticated || !j.user?.id) {
        $("chatListEmpty").textContent = "Faça login para usar o chat.";
        return;
      }
      state.me = {
        id: j.user.id,
        name: j.user.name || "Eu",
        roleKey: j.user.role || null,
      };
      state.perms = Array.isArray(j.user.permissions) ? j.user.permissions : [];
      state.canViewHidden = hasPerm("chat.view_hidden");
      if (!hasPerm("chat.use") && state.me.roleKey !== "admin") {
        $("chatListEmpty").textContent = "Sem permissão para usar o chat.";
        return;
      }
    } catch (err) {
      $("chatListEmpty").textContent = "Faça login para usar o chat.";
      return;
    }

    await loadConversations();

    const params = new URLSearchParams(window.location.search);
    const c = params.get("c");
    const m = params.get("m");
    if (c) {
      try {
        await openConversation(c, { highlightId: m });
      } catch (err) {
        notify(err.message || "Conversa não encontrada", "error");
      }
    }

    // Events
    $("chatListScroll").addEventListener("click", (e) => {
      const btn = e.target.closest(".chat-conv");
      if (!btn) return;
      const woId = btn.getAttribute("data-work-order-id");
      if (woId) {
        openJobChannel(woId).catch((err) => notify(err.message, "error"));
        return;
      }
      const id = btn.getAttribute("data-id");
      if (id) openConversation(id).catch((err) => notify(err.message, "error"));
    });

    document.querySelectorAll(".chat-list-tab").forEach((tab) => {
      tab.addEventListener("click", () => {
        document.querySelectorAll(".chat-list-tab").forEach((t) => t.classList.remove("is-active"));
        tab.classList.add("is-active");
        state.filter = tab.getAttribute("data-filter");
        syncJobFilterUi();
        if (state.filter === "job") scheduleJobsReload(true);
        else renderList();
      });
    });

    $("chatListSearch").addEventListener("input", (e) => {
      state.listQuery = e.target.value;
      if (state.filter === "job") scheduleJobsReload(false);
      else renderList();
    });

    $("chatJobStatus")?.addEventListener("change", (e) => {
      state.jobStatus = e.target.value || "active";
      scheduleJobsReload(true);
    });
    $("chatJobFrom")?.addEventListener("change", (e) => {
      state.jobFrom = e.target.value || "";
      scheduleJobsReload(true);
    });
    $("chatJobTo")?.addEventListener("change", (e) => {
      state.jobTo = e.target.value || "";
      scheduleJobsReload(true);
    });
    document.querySelectorAll(".chat-job-preset").forEach((btn) => {
      btn.addEventListener("click", () => {
        const preset = btn.getAttribute("data-preset");
        const now = new Date();
        document.querySelectorAll(".chat-job-preset").forEach((b) => b.classList.remove("is-active"));
        if (preset === "clear") {
          state.jobFrom = "";
          state.jobTo = "";
        } else if (preset === "today") {
          const v = toLocalDateInputValue(now);
          state.jobFrom = v;
          state.jobTo = v;
          btn.classList.add("is-active");
        } else if (preset === "week") {
          const start = new Date(now);
          const day = (start.getDay() + 6) % 7; // Monday-based week
          start.setDate(start.getDate() - day);
          const end = new Date(start);
          end.setDate(start.getDate() + 6);
          state.jobFrom = toLocalDateInputValue(start);
          state.jobTo = toLocalDateInputValue(end);
          btn.classList.add("is-active");
        } else if (preset === "month") {
          const start = new Date(now.getFullYear(), now.getMonth(), 1);
          const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
          state.jobFrom = toLocalDateInputValue(start);
          state.jobTo = toLocalDateInputValue(end);
          btn.classList.add("is-active");
        }
        syncJobFilterUi();
        scheduleJobsReload(true);
      });
    });

    $("chatBackBtn").addEventListener("click", () => {
      showThread(false);
      state.activeId = null;
      if (state.realtime) {
        state.realtime.close();
        state.realtime = null;
      }
    });

    $("chatLoadOlder").addEventListener("click", async () => {
      if (!state.messages.length || state.loadingOlder) return;
      state.loadingOlder = true;
      const first = state.messages.find((m) => !String(m.id).startsWith("tmp_"));
      const prevHeight = $("chatMessages").scrollHeight;
      try {
        await loadMessages({ before: first?.id });
        const el = $("chatMessages");
        el.scrollTop = el.scrollHeight - prevHeight;
      } finally {
        state.loadingOlder = false;
      }
    });

    $("chatSendBtn").addEventListener("click", () => sendMessage());
    $("chatInput").addEventListener("input", () => {
      autosizeInput();
      updateAutocomplete();
      sendTyping(true);
      clearTimeout(state.typingTimer);
      state.typingTimer = setTimeout(() => sendTyping(false), 2000);
    });
    $("chatInput").addEventListener("keydown", (e) => {
      if (state.ac.open) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          state.ac.index = Math.min(state.ac.items.length - 1, state.ac.index + 1);
          renderAc();
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          state.ac.index = Math.max(0, state.ac.index - 1);
          renderAc();
          return;
        }
        if (e.key === "Enter" || e.key === "Tab") {
          e.preventDefault();
          applyAcItem(state.ac.items[state.ac.index]);
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          hideAc();
          return;
        }
      }
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });

    $("chatAc").addEventListener("click", (e) => {
      const btn = e.target.closest("[data-i]");
      if (!btn) return;
      applyAcItem(state.ac.items[Number(btn.getAttribute("data-i"))]);
    });

    $("chatAttachBtn").addEventListener("click", () => $("chatFileInput").click());
    $("chatCameraBtn").addEventListener("click", () => $("chatCameraInput").click());
    $("chatFileInput").addEventListener("change", (e) => {
      addFiles(e.target.files).catch((err) => notify(err.message, "error"));
      e.target.value = "";
    });
    $("chatCameraInput").addEventListener("change", (e) => {
      addFiles(e.target.files).catch((err) => notify(err.message, "error"));
      e.target.value = "";
    });
    $("chatPendingFiles").addEventListener("click", (e) => {
      const btn = e.target.closest("[data-rm]");
      if (!btn) return;
      state.pendingFiles.splice(Number(btn.getAttribute("data-rm")), 1);
      renderPendingFiles();
    });

    // paste / drop images
    $("chatInput").addEventListener("paste", (e) => {
      const items = [...(e.clipboardData?.items || [])];
      const files = items.filter((i) => i.kind === "file").map((i) => i.getAsFile()).filter(Boolean);
      if (files.length) {
        e.preventDefault();
        addFiles(files).catch(() => {});
      }
    });
    const composer = $("chatComposer");
    composer.addEventListener("dragover", (e) => {
      e.preventDefault();
    });
    composer.addEventListener("drop", (e) => {
      e.preventDefault();
      if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files).catch(() => {});
    });

    $("chatContextClear").addEventListener("click", () => {
      clearContextJob().catch((err) => notify(err.message, "error"));
    });

    $("chatMuteBtn").addEventListener("click", async () => {
      if (!state.activeId) return;
      try {
        const next = !state.muted;
        await api(`/api/chat/conversations/${state.activeId}/mute`, {
          method: "POST",
          body: JSON.stringify({ muted: next }),
        });
        state.muted = next;
        $("chatMuteBtn").title = next ? "Reativar notificações" : "Silenciar";
        $("chatMuteBtn").classList.toggle("is-muted", next);
        $("chatMuteBtn").setAttribute("aria-pressed", next ? "true" : "false");
        notify(next ? "Conversa silenciada — sem push" : "Notificações reativadas", "success");
      } catch (err) {
        notify(err.message, "error");
      }
    });

    $("chatMessagesInner").addEventListener("click", async (e) => {
      const retry = e.target.closest("[data-retry]");
      if (retry) {
        const id = retry.getAttribute("data-retry");
        const msg = state.messages.find((m) => m.id === id || m._tempId === id);
        if (msg?._payload) {
          sendMessage({
            body: msg._payload.body,
            attachments: msg._payload.attachments,
            add_mentioned_members: msg._payload.add_mentioned_members,
            retry: true,
            retryId: id,
          });
        }
        return;
      }

      const editBtn = e.target.closest("[data-edit]");
      if (editBtn) {
        state.editingId = editBtn.getAttribute("data-edit");
        renderMessages();
        return;
      }
      const cancelBtn = e.target.closest("[data-edit-cancel]");
      if (cancelBtn) {
        state.editingId = null;
        renderMessages();
        return;
      }
      const saveBtn = e.target.closest("[data-edit-save]");
      if (saveBtn) {
        const id = saveBtn.getAttribute("data-edit-save");
        const ta = $("chatMessagesInner").querySelector(`[data-edit-area="${CSS.escape(id)}"]`);
        const body = ta?.value ?? "";
        try {
          const j = await api(`/api/chat/messages/${id}`, {
            method: "PATCH",
            body: JSON.stringify({ body }),
          });
          const idx = state.messages.findIndex((m) => m.id === id);
          if (idx >= 0) {
            state.messages[idx] = { ...state.messages[idx], ...j.data };
          }
          state.editingId = null;
          renderMessages();
          notify("Mensagem editada", "success");
        } catch (err) {
          notify(err.message, "error");
        }
        return;
      }
      const hideBtn = e.target.closest("[data-hide]");
      if (hideBtn) {
        const id = hideBtn.getAttribute("data-hide");
        if (!window.confirm("Remover esta mensagem? (soft delete — gestores ainda podem ver)")) return;
        try {
          const j = await api(`/api/chat/messages/${id}`, { method: "DELETE" });
          const idx = state.messages.findIndex((m) => m.id === id);
          if (idx >= 0) state.messages[idx] = { ...state.messages[idx], ...j.data };
          renderMessages();
        } catch (err) {
          notify(err.message, "error");
        }
        return;
      }
      const histBtn = e.target.closest("[data-history]");
      if (histBtn) {
        const id = histBtn.getAttribute("data-history");
        const msg = state.messages.find((m) => m.id === id);
        if (!msg) return;
        msg._showHistory = !msg._showHistory;
        renderMessages();
        return;
      }
    });

    // DM modal
    $("chatNewDmBtn").addEventListener("click", () => {
      openModal("chatDmModal");
      loadUserPicker("chatDmList", "").catch(() => {});
    });
    $("chatDmSearch").addEventListener("input", (e) => {
      loadUserPicker("chatDmList", e.target.value).catch(() => {});
    });
    $("chatDmList").addEventListener("click", async (e) => {
      const btn = e.target.closest("[data-user]");
      if (!btn) return;
      try {
        const j = await api("/api/chat/conversations/dm", {
          method: "POST",
          body: JSON.stringify({ user_id: btn.getAttribute("data-user") }),
        });
        closeModal("chatDmModal");
        await loadConversations();
        await openConversation(j.data.id);
      } catch (err) {
        notify(err.message, "error");
      }
    });

    // Group modal
    $("chatNewGroupBtn").addEventListener("click", () => {
      if (!hasPerm("chat.create_group") && state.me.roleKey !== "admin") {
        notify("Sem permissão para criar grupos", "error");
        return;
      }
      state.groupSelected = new Set();
      $("chatGroupName").value = "";
      openModal("chatGroupModal");
      loadUserPicker("chatGroupList", "", true).catch(() => {});
    });
    $("chatGroupSearch").addEventListener("input", (e) => {
      loadUserPicker("chatGroupList", e.target.value, true).catch(() => {});
    });
    $("chatGroupList").addEventListener("click", (e) => {
      const btn = e.target.closest("[data-user]");
      if (!btn) return;
      const id = btn.getAttribute("data-user");
      if (state.groupSelected.has(id)) state.groupSelected.delete(id);
      else state.groupSelected.add(id);
      btn.classList.toggle("is-selected");
    });
    $("chatGroupCreate").addEventListener("click", async () => {
      const name = $("chatGroupName").value.trim();
      if (!name) {
        notify("Informe o nome do grupo", "error");
        return;
      }
      try {
        const j = await api("/api/chat/conversations/groups", {
          method: "POST",
          body: JSON.stringify({ name, member_ids: [...state.groupSelected] }),
        });
        closeModal("chatGroupModal");
        await loadConversations();
        await openConversation(j.data.id);
      } catch (err) {
        notify(err.message, "error");
      }
    });

    document.querySelectorAll(".chat-modal [data-close]").forEach((el) => {
      el.addEventListener("click", () => {
        el.closest(".chat-modal").hidden = true;
      });
    });

    $("chatMentionsBtn")?.addEventListener("click", () => {
      openModal("chatMentionsModal");
      loadMentionsPanel().catch((err) => notify(err.message, "error"));
    });
    $("chatMentionsUnreadOnly")?.addEventListener("click", () => {
      state.mentionsUnreadOnly = !state.mentionsUnreadOnly;
      $("chatMentionsUnreadOnly").textContent = state.mentionsUnreadOnly
        ? "Mostrar todas"
        : "Só não lidas";
      loadMentionsPanel().catch((err) => notify(err.message, "error"));
    });
    $("chatMentionsReadAll")?.addEventListener("click", async () => {
      try {
        await api("/api/chat/mentions/read-all", { method: "POST", body: "{}" });
        await loadMentionsPanel();
        await refreshMentionsBadge();
        if (typeof window.__crmUpdateChatBadge === "function") window.__crmUpdateChatBadge();
        notify("Menções marcadas como lidas", "success");
      } catch (err) {
        notify(err.message, "error");
      }
    });
    $("chatMentionsList")?.addEventListener("click", async (e) => {
      const row = e.target.closest("[data-mention-id]");
      if (!row) return;
      const mentionId = row.getAttribute("data-mention-id");
      const convId = row.getAttribute("data-conv");
      const msgId = row.getAttribute("data-msg");
      try {
        await api(`/api/chat/mentions/${mentionId}/read`, { method: "POST", body: "{}" });
      } catch (_) {
        /* ignore */
      }
      closeModal("chatMentionsModal");
      await refreshMentionsBadge();
      if (typeof window.__crmUpdateChatBadge === "function") window.__crmUpdateChatBadge();
      if (convId) {
        await openConversation(convId, { highlightId: msgId || null });
      }
    });

    refreshMentionsBadge().catch(() => {});
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
