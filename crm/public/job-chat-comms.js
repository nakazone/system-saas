/**
 * Job "Comunicações" — timeline + gallery from chat messages linked to a work order.
 * Shared by job-detail desktop and mobile.
 */
(function (global) {
  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function fmtDateTime(iso) {
    if (!iso) return "—";
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function typeBadge(type) {
    const map = { dm: "Direta", group: "Grupo", job: "Canal" };
    return map[type] || type || "ObraChat";
  }

  function stripTokens(body) {
    return String(body || "")
      .replace(/<@user:[0-9a-f-]+>/gi, "@alguém")
      .replace(/<@team>/gi, "@equipe")
      .replace(/<@all>/gi, "@todos")
      .replace(/<#job:[0-9a-f-]+>/gi, "#job")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&");
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

  async function fetchTimeline(jobId, filters) {
    const f = filters || {};
    const params = new URLSearchParams({ limit: String(f.limit || 50) });
    if (f.person_id) params.set("person_id", f.person_id);
    if (f.q) params.set("q", f.q);
    if (f.with_attachments) params.set("with_attachments", "1");
    if (f.from) params.set("from", f.from);
    if (f.to) params.set("to", f.to);
    const j = await api(`/api/chat/jobs/${encodeURIComponent(jobId)}/timeline?${params}`);
    return j.data || [];
  }

  async function fetchGallery(jobId) {
    const j = await api(`/api/chat/jobs/${encodeURIComponent(jobId)}/gallery`);
    return j.data || [];
  }

  async function openJobChannel(jobId) {
    const j = await api(`/api/chat/jobs/${encodeURIComponent(jobId)}/ensure-channel`, {
      method: "POST",
      body: "{}",
    });
    const cid = j.data?.conversationId;
    if (!cid) throw new Error("Canal da obra não encontrado");
    window.location.href = `chat.html?c=${encodeURIComponent(cid)}`;
  }

  function chatDeepLink(item) {
    const c = item.conversation?.id;
    const m = item.id;
    if (!c) return "chat.html";
    return `chat.html?c=${encodeURIComponent(c)}&m=${encodeURIComponent(m)}`;
  }

  function filtersHtml(opts) {
    opts = opts || {};
    const people = opts.people || [];
    const peopleOpts = people
      .map(
        (p) =>
          `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name || p.id)}</option>`,
      )
      .join("");
    return `<div class="jd-comms-filters">
      <label class="jd-comms-filters__field">
        <span>Pessoa</span>
        <select data-comms-person>
          <option value="">Todas</option>
          ${peopleOpts}
        </select>
      </label>
      <label class="jd-comms-filters__field">
        <span>De</span>
        <input type="date" data-comms-from />
      </label>
      <label class="jd-comms-filters__field">
        <span>Até</span>
        <input type="date" data-comms-to />
      </label>
      <label class="jd-comms-filters__field jd-comms-filters__field--grow">
        <span>Busca</span>
        <input type="search" data-comms-q placeholder="Texto na mensagem…" />
      </label>
      <label class="jd-comms-filters__check">
        <input type="checkbox" data-comms-atts />
        Só com anexos
      </label>
      <button type="button" class="btn btn-secondary jd-comms-filters__btn" data-comms-apply>Filtrar</button>
    </div>`;
  }

  function timelineItemHtml(item) {
    const author = item.author?.name || "—";
    const conv = item.conversation || {};
    const convLabel = conv.name || typeBadge(conv.type);
    const body =
      item.hidden && !item.can_view_original
        ? item.hidden_placeholder || "Mensagem removida"
        : stripTokens(item.body || "");
    const atts = (item.attachments || [])
      .map((a) => {
        if ((a.mime_type || "").startsWith("image/")) {
          return `<a class="jd-comms-att" href="${escapeHtml(a.url)}" target="_blank" rel="noopener"><img src="${escapeHtml(a.thumb_url || a.url)}" alt="" loading="lazy" /></a>`;
        }
        return `<a class="jd-comms-att jd-comms-att--file" href="${escapeHtml(a.url)}" target="_blank" rel="noopener">${escapeHtml(a.mime_type || "arquivo")}</a>`;
      })
      .join("");
    return `<article class="jd-comms-item" data-msg="${escapeHtml(item.id)}">
      <header class="jd-comms-item__head">
        <div>
          <strong>${escapeHtml(author)}</strong>
          <span class="jd-comms-item__time">${escapeHtml(fmtDateTime(item.created_at))}</span>
        </div>
        <span class="jd-comms-badge">${escapeHtml(typeBadge(conv.type))}</span>
      </header>
      <p class="jd-comms-item__conv">Em ${escapeHtml(convLabel)}</p>
      <p class="jd-comms-item__body">${escapeHtml(body)}</p>
      ${atts ? `<div class="jd-comms-item__atts">${atts}</div>` : ""}
      <a class="jd-comms-item__open" href="${escapeHtml(chatDeepLink(item))}">Abrir na conversa →</a>
    </article>`;
  }

  function galleryHtml(items) {
    if (!items.length) {
      return `<p class="jobs-empty jd-comms-empty">Nenhuma foto ou vídeo do chat neste job.</p>`;
    }
    return `<div class="jd-comms-gallery">${items
      .map((a) => {
        const isVideo = (a.mime_type || "").startsWith("video/");
        const href = `chat.html?c=${encodeURIComponent(a.conversation_id)}&m=${encodeURIComponent(a.message_id)}`;
        if (isVideo) {
          return `<a class="jd-comms-gallery__item jd-comms-gallery__item--video" href="${escapeHtml(href)}" title="Abrir no chat">
            <span>Vídeo</span>
          </a>`;
        }
        return `<a class="jd-comms-gallery__item" href="${escapeHtml(href)}" title="Abrir no chat">
          <img src="${escapeHtml(a.thumb_url || a.url)}" alt="" loading="lazy" />
        </a>`;
      })
      .join("")}</div>`;
  }

  function peopleFromJob(wo) {
    const map = new Map();
    if (wo?.assigned_user?.id) {
      map.set(wo.assigned_user.id, {
        id: wo.assigned_user.id,
        name: wo.assigned_user.name,
      });
    }
    (wo?.members || []).forEach((m) => {
      const id = m.user_id || m.userId || m.id;
      const name = m.name || m.user?.name;
      if (id && name) map.set(id, { id, name });
    });
    return [...map.values()].sort((a, b) => String(a.name).localeCompare(String(b.name)));
  }

  function readFilters(root) {
    const from = root.querySelector("[data-comms-from]")?.value;
    const to = root.querySelector("[data-comms-to]")?.value;
    return {
      person_id: root.querySelector("[data-comms-person]")?.value || "",
      q: root.querySelector("[data-comms-q]")?.value?.trim() || "",
      with_attachments: !!root.querySelector("[data-comms-atts]")?.checked,
      from: from ? new Date(from + "T00:00:00").toISOString() : "",
      to: to ? new Date(to + "T23:59:59").toISOString() : "",
    };
  }

  /**
   * Mount communications panel into `root` element.
   * @returns {{ refresh: Function, destroy: Function }}
   */
  function mount(root, options) {
    const jobId = options.jobId;
    const wo = options.workOrder || null;
    const compact = !!options.compact;

    root.innerHTML = `<div class="jd-comms ${compact ? "jd-comms--compact" : ""}">
      <div class="jd-comms-toolbar">
        <button type="button" class="btn btn-primary" data-comms-open-channel>Abrir canal da obra</button>
        <button type="button" class="btn btn-secondary" data-comms-refresh>Atualizar</button>
      </div>
      ${filtersHtml({ people: peopleFromJob(wo) })}
      <div class="jd-comms-views">
        <button type="button" class="jd-comms-tab is-active" data-comms-view="timeline">Linha do tempo</button>
        <button type="button" class="jd-comms-tab" data-comms-view="gallery">Galeria do chat</button>
      </div>
      <div class="jd-comms-body" data-comms-body>
        <p class="jd-comms-empty">A carregar…</p>
      </div>
    </div>`;

    let view = "timeline";
    let destroyed = false;

    async function refresh() {
      if (destroyed) return;
      const body = root.querySelector("[data-comms-body]");
      body.innerHTML = `<p class="jd-comms-empty">A carregar…</p>`;
      try {
        if (view === "gallery") {
          const items = await fetchGallery(jobId);
          if (!destroyed) body.innerHTML = galleryHtml(items);
          return;
        }
        const items = await fetchTimeline(jobId, readFilters(root));
        if (destroyed) return;
        if (!items.length) {
          body.innerHTML = `<p class="jd-comms-empty">Nenhuma mensagem vinculada a este job ainda. Mensagens de DM só aparecem se forem vinculadas explicitamente.</p>`;
          return;
        }
        body.innerHTML = `<div class="jd-comms-timeline">${items.map(timelineItemHtml).join("")}</div>`;
      } catch (err) {
        if (!destroyed) {
          body.innerHTML = `<p class="jd-comms-empty">${escapeHtml(err.message || "Erro")}</p>`;
        }
      }
    }

    root.addEventListener("click", (e) => {
      const tab = e.target.closest("[data-comms-view]");
      if (tab) {
        view = tab.getAttribute("data-comms-view") || "timeline";
        root.querySelectorAll("[data-comms-view]").forEach((t) => {
          t.classList.toggle("is-active", t === tab);
        });
        refresh();
        return;
      }
      if (e.target.closest("[data-comms-apply]") || e.target.closest("[data-comms-refresh]")) {
        refresh();
        return;
      }
      if (e.target.closest("[data-comms-open-channel]")) {
        openJobChannel(jobId).catch((err) => {
          if (typeof options.onError === "function") options.onError(err);
          else alert(err.message || "Erro");
        });
      }
    });

    refresh();
    return {
      refresh,
      destroy() {
        destroyed = true;
        root.innerHTML = "";
      },
    };
  }

  global.JobChatComms = {
    mount,
    fetchTimeline,
    fetchGallery,
    openJobChannel,
    peopleFromJob,
  };
})(typeof window !== "undefined" ? window : globalThis);
