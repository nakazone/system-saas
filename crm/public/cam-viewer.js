/**
 * Visualizador de fotos do ObraCam (computador, iPad e iPhone).
 * window.CamViewer.open({ photos, index, canPortfolio, onPortfolio(photo, next) => Promise<photo|void> })
 * photo = { id, url, thumb_url, stage, when, author, device, caption, address, lat, lng, distance_m,
 *           far_from_job, location_available, in_portfolio, job: { id, number, title, client } }
 */
(function () {
  const STAGE = { before: "Antes", during: "Durante", after: "Depois" };
  const WD = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
  const MO = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
  const ICON = {
    x: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    prev: '<svg viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"/></svg>',
    next: '<svg viewBox="0 0 24 24"><path d="M9 18l6-6-6-6"/></svg>',
    star: '<svg viewBox="0 0 24 24"><path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/></svg>',
    dl: '<svg viewBox="0 0 24 24"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>',
    pin: '<svg viewBox="0 0 24 24"><path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>',
  };
  let st = null;
  let root = null;

  function esc(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function when(iso) {
    if (!iso) return "—";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "—";
    const p = (n) => String(n).padStart(2, "0");
    return `${WD[d.getDay()]}, ${d.getDate()} ${MO[d.getMonth()]} · ${p(d.getHours())}:${p(d.getMinutes())}`;
  }
  function dist(m) {
    if (m == null || !Number.isFinite(Number(m))) return "";
    const n = Number(m);
    return n < 1000 ? `${Math.round(n)} m` : `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)} km`;
  }
  function gpsText(p) {
    const has = p.location_available !== false && p.lat != null && p.lng != null;
    if (!has) return { text: "Sem GPS", cls: "is-mu", href: "" };
    const d = dist(p.distance_m);
    const href = `https://maps.google.com/?q=${encodeURIComponent(`${p.lat},${p.lng}`)}`;
    if (p.far_from_job) return { text: `Longe do job${d ? ` · ${d}` : ""}`, cls: "is-hot", href };
    return { text: d ? `${d} do job` : "Com GPS", cls: "", href };
  }

  function ensure() {
    if (root) return root;
    root = document.createElement("div");
    root.className = "cv";
    root.hidden = true;
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-modal", "true");
    root.setAttribute("aria-label", "Foto");
    document.body.appendChild(root);
    root.addEventListener("click", onClick);
    let x0 = null;
    root.addEventListener("touchstart", (e) => {
      if (e.target.closest(".cv-side")) return;
      x0 = e.touches[0].clientX;
    }, { passive: true });
    root.addEventListener("touchend", (e) => {
      if (x0 == null) return;
      const dx = e.changedTouches[0].clientX - x0;
      x0 = null;
      if (Math.abs(dx) > 50) go(dx < 0 ? 1 : -1);
    });
    document.addEventListener("keydown", (e) => {
      if (!st || root.hidden) return;
      if (e.key === "Escape") close();
      else if (e.key === "ArrowLeft") go(-1);
      else if (e.key === "ArrowRight") go(1);
    });
    return root;
  }

  function render() {
    const p = st.photos[st.index];
    const n = st.photos.length;
    const g = gpsText(p);
    const job = p.job || {};
    const stage = STAGE[p.stage] || "Geral";
    const strip =
      n > 1
        ? `<div class="cv-strip">${st.photos
            .map((q, i) => `<button type="button" class="${i === st.index ? "is-on" : ""}" data-cv-i="${i}" aria-label="Foto ${i + 1}" style="background-image:url('${esc(q.thumb_url || q.url)}')"></button>`)
            .join("")}</div>`
        : "";
    root.innerHTML = `
      <div class="cv-stage">
        <img class="cv-img" src="${esc(p.url)}" alt="${esc(p.caption || stage)}" />
        ${n > 1 ? `<button type="button" class="cv-nav cv-nav--prev" data-cv="prev" aria-label="Anterior">${ICON.prev}</button><button type="button" class="cv-nav cv-nav--next" data-cv="next" aria-label="Próxima">${ICON.next}</button>` : ""}
        ${strip}
        <div class="cv-top"><button type="button" class="cv-round" data-cv="close" aria-label="Fechar">${ICON.x}</button><span class="cv-count">${n > 1 ? `${st.index + 1} de ${n}` : ""}</span>
        ${st.canPortfolio && p.id ? `<button type="button" class="cv-round${p.in_portfolio ? " is-on" : ""}" data-cv="port" aria-label="${p.in_portfolio ? "Tirar do portfólio" : "Pôr no portfólio"}">${ICON.star}</button>` : "<span></span>"}</div>
      </div>
      <aside class="cv-side">
        <span class="cv-grab" aria-hidden="true"></span>
        <div class="cv-chips"><span class="cv-pill cv-pill--dk">${esc(stage)}</span>${n > 1 ? `<span class="cv-sub">Foto ${st.index + 1} de ${n}</span>` : ""}</div>
        ${job.title || job.number != null ? `<div class="cv-job">${job.number != null ? `<small>Job #${esc(job.number)}</small>` : ""}<h2>${esc(job.title || "Job")}</h2>${job.client || p.address ? `<p>${esc([job.client, p.address].filter(Boolean).join(" · "))}</p>` : ""}</div>` : ""}
        <dl class="cv-kv">
          <dt>Tirada</dt><dd>${esc(when(p.taken_at_device || p.created_at))}</dd>
          ${p.author ? `<dt>Por</dt><dd>${esc(p.author)}</dd>` : ""}
          ${p.device ? `<dt>Aparelho</dt><dd>${esc(p.device)}</dd>` : ""}
          <dt>Local</dt><dd class="${g.cls}">${g.href ? `<a href="${esc(g.href)}" target="_blank" rel="noopener">${ICON.pin}${esc(g.text)}</a>` : esc(g.text)}</dd>
          <dt>Legenda</dt><dd class="${p.caption ? "" : "is-mu"}">${esc(p.caption || "Sem legenda")}</dd>
        </dl>
        <div class="cv-sp"></div>
        <div class="cv-acts">
          ${job.id ? `<a class="cv-btn cv-btn--pri" href="job-detail.html?id=${encodeURIComponent(job.id)}#fotos">Abrir job</a>` : ""}
          <div class="cv-row">
            ${st.canPortfolio && p.id ? `<button type="button" class="cv-btn" data-cv="port">${ICON.star}${p.in_portfolio ? "No portfólio" : "Portfólio"}</button>` : ""}
            <a class="cv-btn" href="${esc(p.url)}" download target="_blank" rel="noopener">${ICON.dl}Baixar</a>
          </div>
        </div>
      </aside>`;
  }

  async function onClick(e) {
    const b = e.target.closest("[data-cv],[data-cv-i]");
    if (!b) {
      if (e.target === root || e.target.classList.contains("cv-stage")) close();
      return;
    }
    if (b.hasAttribute("data-cv-i")) {
      st.index = Number(b.getAttribute("data-cv-i")) || 0;
      render();
      return;
    }
    const a = b.getAttribute("data-cv");
    if (a === "close") close();
    else if (a === "prev") go(-1);
    else if (a === "next") go(1);
    else if (a === "port" && st.onPortfolio) {
      const p = st.photos[st.index];
      try {
        const res = await st.onPortfolio(p, !p.in_portfolio);
        p.in_portfolio = res && typeof res.in_portfolio === "boolean" ? res.in_portfolio : !p.in_portfolio;
        render();
      } catch (err) {
        window.crmToast?.error?.(err.message || "Erro");
      }
    }
  }

  function go(d) {
    if (!st || st.photos.length < 2) return;
    st.index = (st.index + d + st.photos.length) % st.photos.length;
    render();
  }

  function open(opts) {
    const photos = (opts && opts.photos) || [];
    if (!photos.length) return;
    st = { photos, index: Math.min(Math.max(0, opts.index || 0), photos.length - 1), canPortfolio: !!opts.canPortfolio, onPortfolio: opts.onPortfolio || null };
    ensure();
    render();
    root.hidden = false;
    document.body.classList.add("cv-open");
  }
  function close() {
    if (!root) return;
    root.hidden = true;
    document.body.classList.remove("cv-open");
    st = null;
  }

  window.CamViewer = { open, close };
})();
