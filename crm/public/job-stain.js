/**
 * Job page › Stain: the color the client approved and signed (locked), every round with the crew's
 * photos, the history, the PDF, and the update sent to the builder.
 */
(function () {
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const when = (d) => {
    const x = new Date(d);
    if (Number.isNaN(x.getTime())) return "";
    return x.toLocaleString("pt-BR", { day: "2-digit", month: "short", hour: "numeric", minute: "2-digit" });
  };
  async function api(url, opts) {
    const r = await fetch(url, { credentials: "include", headers: { "Content-Type": "application/json", Accept: "application/json" }, ...(opts || {}) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.success === false) throw new Error(j.error || "Não foi possível concluir.");
    return j.data;
  }
  const STATUS_CLASS = { approved: "is-ok", changes_requested: "is-warn", superseded: "is-off", draft: "is-off" };
  const CSS_ID = "jobStainCss";

  function ensureCss() {
    if (document.getElementById(CSS_ID)) return;
    const l = document.createElement("link");
    l.id = CSS_ID;
    l.rel = "stylesheet";
    l.href = "job-stain.css?v=20261030-stain1";
    document.head.appendChild(l);
  }

  function photo(p, cls, alt) {
    return p ? `<a class="${cls}" href="${esc(p.url)}" target="_blank" rel="noopener"><img src="${esc(p.thumb_url || p.url)}" alt="${esc(alt || "")}" loading="lazy" /></a>` : `<span class="${cls} is-empty" aria-hidden="true"></span>`;
  }

  function approvedCard(d, ctx) {
    const a = d.approved;
    if (!a) {
      const open = d.rounds.find((r) => ["sent", "viewed"].includes(r.status));
      const asked = [...d.rounds].reverse().find((r) => r.status === "changes_requested");
      const line = open
        ? `Rodada ${open.number} ${open.status === "viewed" ? "vista pela cliente" : "enviada"} · aguardando a escolha`
        : asked
          ? "A cliente pediu outra amostra. Abra uma nova rodada."
          : d.rounds.length ? "Rodada em rascunho no app de campo." : "Nenhuma cor aprovada ainda.";
      return `<div class="js-hero js-hero--empty"><span class="js-eyebrow">COR DO STAIN</span><p class="js-hero__none">${esc(line)}</p>
        <a class="jd-btn jd-btn--pri" href="campo/stain.html?id=${encodeURIComponent(ctx.jobId)}">${d.rounds.length ? "Abrir samples" : "Registrar samples"}</a></div>`;
    }
    const s = a.sample;
    const builder = d.job.has_builder
      ? a.builder_notified_at ? `Enviado ao builder ${esc(when(a.builder_notified_at))}` : "Ainda não enviado ao builder"
      : "";
    return `<div class="js-hero">
      <span class="js-eyebrow">COR APROVADA · TRAVADA</span>
      ${photo(s.photos[0], "js-hero__ph", `Foto do sample ${s.number} aprovado`)}
      <div><p class="js-hero__name">${esc(s.display_name)}</p><p class="js-hero__sub">${esc(s.sub)} · sample #${s.number} · rodada ${a.round_number}</p></div>
      <div class="js-hero__meta"><span>Assinado por ${esc(a.signer_name || "Cliente")}</span><small>${esc(when(a.signed_at))} · IP registrado</small>${builder ? `<small>${builder}</small>` : ""}</div>
      <div class="js-hero__acts">
        <a class="js-hbtn" href="/api/stain/approvals/${encodeURIComponent(a.approval_id)}/pdf" target="_blank" rel="noopener">Comprovante PDF</a>
        ${ctx.canManage ? `<a class="js-hbtn js-hbtn--ghost" href="campo/stain.html?id=${encodeURIComponent(ctx.jobId)}&mudanca=1">Abrir mudança</a>` : ""}
      </div>
    </div>`;
  }

  function roundCard(r, d) {
    const approvedId = d.approved && d.approved.sample.id;
    const tiles = r.samples.map((s) => `<figure class="js-tile ${s.id === approvedId ? "is-approved" : ""}">
        ${photo(s.photos[0], "js-tile__ph", `Foto do sample ${s.number}`)}
        <figcaption><b>#${s.number} · ${esc(s.label)}</b>${s.id === approvedId ? " · aprovado" : ""}<small>${esc(s.sub)}${s.photos.length > 1 ? ` · ${s.photos.length} fotos` : ""}</small></figcaption>
      </figure>`).join("");
    const answer = r.answers.find((x) => x.decision === "needs_sample");
    return `<div class="jd-card js-round">
      <div class="jd-ch"><h2>Rodada ${r.number}</h2><span class="js-chip ${STATUS_CLASS[r.status] || ""}">${esc(r.status_label)}</span></div>
      <p class="js-round__meta">${[r.wood_species, r.room, r.created_by_name ? `por ${r.created_by_name}` : null, when(r.created_at)].filter(Boolean).map(esc).join(" · ")}</p>
      ${answer ? `<p class="js-note">Cliente: “${esc(answer.comment)}”</p>` : ""}
      ${r.board ? `<div class="js-board">${photo(r.board, "js-board__ph", "Foto do conjunto")}<span>Foto do conjunto</span></div>` : ""}
      ${tiles ? `<div class="js-tiles">${tiles}</div>` : '<p class="jd-empty">Sem samples.</p>'}
    </div>`;
  }

  function historyCard(d, ctx) {
    const items = d.history.slice().reverse();
    const last = d.approved && d.rounds.find((r) => r.id === d.approved.round_id);
    return `<div class="jd-card js-hist"><div class="jd-ch"><h2>Histórico</h2></div>
      ${items.length ? `<ol>${items.map((h) => `<li><time>${esc(when(h.at))}</time><span class="${h.strong ? "is-strong" : ""}">${esc(h.text)}</span></li>`).join("")}</ol>` : '<p class="jd-empty">Nada ainda.</p>'}
      ${ctx.canManage && last && d.job.has_builder ? `<button type="button" class="jd-btn jd-btn--ghost" data-js-builder="${esc(last.id)}">${last.builder_notified_at ? "Reenviar ao builder" : "Enviar ao builder"}</button>` : ""}
    </div>`;
  }

  function paint(box, ctx, d) {
    const count = document.getElementById("jdTabStain");
    if (count) count.textContent = d.approved ? "✓" : d.rounds.length ? String(d.rounds.length) : "";
    const rounds = d.rounds.slice().reverse().map((r) => roundCard(r, d)).join("");
    box.innerHTML = `<div class="js ${ctx.compact ? "js--compact" : ""}">
      ${approvedCard(d, ctx)}
      <div class="js-col">${rounds || '<div class="jd-card"><p class="jd-empty">O lixador registra os samples pelo app de campo, com a foto de cada um. A cliente escolhe e assina pelo link.</p></div>'}</div>
      ${historyCard(d, ctx)}
    </div>`;
    box.querySelector("[data-js-builder]")?.addEventListener("click", async (e) => {
      const b = e.currentTarget;
      b.disabled = true;
      try {
        const fresh = await api(`/api/stain/rounds/${encodeURIComponent(b.getAttribute("data-js-builder"))}/builder`, { method: "POST", body: "{}" });
        ctx.notify && ctx.notify("Aprovação enviada ao builder.", "success");
        paint(box, ctx, { ...fresh, can_manage: d.can_manage });
      } catch (err) {
        b.disabled = false;
        ctx.notify && ctx.notify(err.message, "error");
      }
    });
  }

  async function mount(box, ctx) {
    if (!box) return;
    ensureCss();
    box.innerHTML = '<div class="jd-card"><p class="jd-empty">A carregar…</p></div>';
    try {
      const d = await api(`/api/work-orders/${encodeURIComponent(ctx.jobId)}/stain`);
      paint(box, { ...ctx, canManage: d.can_manage }, d);
    } catch (err) {
      box.innerHTML = `<div class="jd-card"><p class="jd-empty">${esc(err.message)}</p></div>`;
    }
  }

  /** Header chip + tab badge without opening the tab. */
  async function summary(jobId) {
    try {
      const d = await api(`/api/work-orders/${encodeURIComponent(jobId)}/stain`);
      const count = document.getElementById("jdTabStain");
      if (count) count.textContent = d.approved ? "✓" : d.rounds.length ? String(d.rounds.length) : "";
      return d;
    } catch (_) {
      return null;
    }
  }

  window.JobStain = { mount, summary };
})();
