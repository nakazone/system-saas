/**
 * Campo · Samples de stain — the sanding crew registers each sample (photo first, then the color),
 * sends the round to the client, or lets the client approve on this phone. Once the client signs,
 * the color is locked here and on the job page.
 */
(function () {
  const $ = (id) => document.getElementById(id);
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const params = new URLSearchParams(location.search);
  const jobId = params.get("id");
  const wantsChange = params.get("mudanca") === "1";
  const WOODS = ["White Oak", "Red Oak", "Hickory", "Maple"];
  const COMMON = ["Special Walnut", "Jacobean", "Provincial", "Classic Gray", "Ebony", "Early American", "Weathered Oak", "Dark Walnut"];
  const ICON = {
    chev: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18l6-6-6-6"/></svg>',
    cam: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>',
    lock: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
  };

  let data = null;
  let view = "home";
  let draft = null; // sample being edited
  let cameraFor = null; // "sample" | "board"
  let busy = false;
  let company = "";

  function toast(msg, kind) {
    const t = $("stToast");
    t.textContent = msg;
    t.className = `st-toast${kind === "error" ? " is-error" : ""}`;
    t.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => (t.hidden = true), 3200);
  }

  async function api(path, opts) {
    const res = await fetch(path, { credentials: "same-origin", headers: { Accept: "application/json", "Content-Type": "application/json" }, ...(opts || {}) });
    const json = await res.json().catch(() => ({}));
    if (res.status === 401) {
      location.href = "/login.html";
      throw new Error("unauth");
    }
    if (!res.ok || json.success === false) throw new Error(json.error || "Não foi possível concluir.");
    return json.data;
  }
  const post = (path, body) => api(path, { method: "POST", body: JSON.stringify(body || {}) });
  const patch = (path, body) => api(path, { method: "PATCH", body: JSON.stringify(body || {}) });
  const del = (path) => api(path, { method: "DELETE" });

  async function guarded(fn) {
    if (busy) return;
    busy = true;
    document.body.classList.add("st-busy");
    try {
      await fn();
    } catch (err) {
      if (err.message !== "unauth") toast(err.message || "Erro", "error");
    } finally {
      busy = false;
      document.body.classList.remove("st-busy");
    }
  }

  function shrink(file, max) {
    return new Promise((ok, bad) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        const s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
        const c = document.createElement("canvas");
        c.width = Math.round(img.naturalWidth * s);
        c.height = Math.round(img.naturalHeight * s);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        ok(c.toDataURL("image/jpeg", 0.85));
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        bad(new Error("Não consegui ler a foto. Tente de novo."));
      };
      img.src = url;
    });
  }

  function photoMeta() {
    return { taken_at_device: new Date().toISOString(), client_upload_id: `st-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, device_label: navigator.userAgent.slice(0, 100) };
  }

  const when = (d) => (d ? new Date(d).toLocaleTimeString("pt-BR", { hour: "numeric", minute: "2-digit" }) : "");
  const whenLong = (d) => (d ? new Date(d).toLocaleString("pt-BR", { day: "2-digit", month: "short", hour: "numeric", minute: "2-digit" }) : "");

  function current() {
    return data && data.rounds.length ? data.rounds[data.rounds.length - 1] : null;
  }

  function setBar(html) {
    const bar = $("stBar");
    bar.hidden = !html;
    bar.innerHTML = html || "";
  }

  // ------------------------------------------------------------------ views
  function render() {
    if (!data) return;
    $("stJobLine").textContent = [data.job.number ? `Job #${data.job.number}` : null, data.job.title].filter(Boolean).join(" · ");
    if (view === "sample") return renderSample();
    if (view === "review") return renderReview();
    const r = current();
    if (data.approved && (!r || r.status === "approved" || r.status === "superseded")) return renderLocked();
    if (!r || r.status === "changes_requested" || r.status === "superseded") return renderStart(r);
    if (r.status === "draft") return renderRound(r);
    return renderWaiting(r);
  }

  function historyHtml() {
    const items = data.history.slice().reverse().slice(0, 8);
    if (!items.length) return "";
    return `<div class="st-hist">${items.map((h) => `<div class="${h.strong ? "is-strong" : ""}"><span>${esc(h.text)}</span><span>${esc(whenLong(h.at))}</span></div>`).join("")}</div>`;
  }

  function renderLocked() {
    const a = data.approved;
    const s = a.sample;
    const ph = s.photos[0];
    const manage = data.can_manage;
    $("stView").innerHTML = `
      <section class="st-locked">
        <div class="st-locked__eb">${ICON.lock}STAIN APROVADO E TRAVADO</div>
        <div class="st-locked__main"><div class="st-locked__ph">${ph ? `<img src="${esc(ph.thumb_url)}" alt="Foto do sample aprovado">` : ""}</div>
          <div><b>${esc(s.display_name)}</b><small>${esc(s.sub)}${data.rounds.find((r) => r.id === a.round_id)?.wood_species ? ` · ${esc(data.rounds.find((r) => r.id === a.round_id).wood_species)}` : ""} · sample #${s.number}</small></div></div>
        <div class="st-locked__meta"><span>Assinado por ${esc(a.signer_name || "Cliente")}</span><small>${esc(whenLong(a.signed_at))}</small>${data.job.has_builder ? `<small>${a.builder_notified_at ? `Enviado ao builder ${esc(when(a.builder_notified_at))}` : "Ainda não enviado ao builder"}</small>` : ""}</div>
        <a href="/api/stain/approvals/${encodeURIComponent(a.approval_id)}/pdf" target="_blank" rel="noopener">Comprovante PDF</a>
      </section>
      <div class="st-card"><b style="font-size:15px">Cliente quer mudar?</b>
        <p class="st-hint" style="font-size:13px">${manage ? "Abra uma nova rodada de samples. A cor atual continua valendo até a cliente assinar a nova." : "Só o escritório abre uma mudança. A cor atual continua valendo até a cliente assinar uma nova."}</p>
        ${manage ? '<button type="button" class="st-btn st-btn--line" data-act="new-round">Abrir mudança · nova rodada</button>' : ""}
      </div>
      ${historyHtml()}`;
    setBar("");
    if (manage && wantsChange && !renderLocked._auto) {
      renderLocked._auto = true;
      $("stView").querySelector('[data-act="new-round"]')?.scrollIntoView({ block: "center" });
    }
  }

  function renderStart(r) {
    const asked = r && r.status === "changes_requested" ? r.answers.find((x) => x.decision === "needs_sample") : null;
    $("stView").innerHTML = `
      ${asked ? `<div class="st-card"><b style="font-size:15px">A cliente pediu outra amostra</b><p class="st-note">“${esc(asked.comment || "")}”</p></div>` : ""}
      <div class="st-card">
        <b style="font-size:15px">${r ? `Rodada ${r.number + 1}` : "Nenhum sample registrado"}</b>
        <p class="st-hint" style="font-size:13px">Para cada sample: tire a foto no piso, com o número da fita aparecendo, e escolha a cor. Depois mande o link para a cliente escolher e assinar.</p>
      </div>
      ${historyHtml()}`;
    setBar('<button type="button" class="st-btn" data-act="new-round">Começar rodada de samples</button>');
  }

  function sampleRow(s, editable) {
    const ph = s.photos[0];
    const tag = editable ? "button" : "div";
    return `<${tag} ${editable ? `type="button" data-sample="${esc(s.id)}"` : ""} class="st-row">
      <span class="st-row__ph">${ph ? `<img src="${esc(ph.thumb_url)}" alt="">` : ""}<span class="st-num">#${s.number}</span></span>
      <span class="st-row__txt"><b>#${s.number} · ${esc(s.label)}</b><small class="${s.photos.length ? "" : "is-warn"}">${esc(s.sub)} · ${s.photos.length ? `${s.photos.length} foto${s.photos.length === 1 ? "" : "s"}` : "falta a foto"}</small></span>
      ${editable ? ICON.chev : ""}
    </${tag}>`;
  }

  function renderRound(r) {
    const woodOther = r.wood_species && !WOODS.includes(r.wood_species);
    const photos = r.samples.reduce((n, s) => n + s.photos.length, 0);
    const ready = r.samples.length > 0 && r.samples.every((s) => s.photos.length > 0);
    $("stView").innerHTML = `
      <div class="st-card">
        <div class="st-card__head"><b>Rodada ${r.number}</b><span class="st-pill">Rascunho</span></div>
        <div class="st-field"><span class="st-label">Madeira</span>
          <div class="st-chips">${WOODS.map((w) => `<button type="button" class="st-chip ${r.wood_species === w ? "is-on" : ""}" data-wood="${esc(w)}">${esc(w)}</button>`).join("")}
          <button type="button" class="st-chip ${woodOther ? "is-on" : ""}" data-wood="__other">${woodOther ? esc(r.wood_species) : "Outra"}</button></div></div>
        <div class="st-field"><label for="stRoom">Onde os samples foram feitos</label><input id="stRoom" class="st-input" maxlength="120" placeholder="Ex.: sala, perto da janela" value="${esc(r.room || "")}"></div>
      </div>
      <div style="display:flex;flex-direction:column;gap:8px">
        <div class="st-card__head" style="padding:0 4px"><b>Samples no piso</b><span class="st-hint" style="font-size:13px">${r.samples.length} sample${r.samples.length === 1 ? "" : "s"} · ${photos} foto${photos === 1 ? "" : "s"}</span></div>
        ${r.samples.length ? `<div class="st-list">${r.samples.map((s) => sampleRow(s, true)).join("")}</div>` : ""}
        <button type="button" class="st-add" data-act="add-sample">+ Adicionar sample</button>
      </div>
      <button type="button" class="st-board" data-act="board">
        <span class="st-board__ph">${r.board ? `<img src="${esc(r.board.thumb_url)}" alt="">` : ICON.cam}</span>
        <span><b>Foto do conjunto${r.board ? "" : " (opcional)"}</b><small>Todos os samples lado a lado no piso. Abre o e-mail da cliente.</small></span>
      </button>
      ${r.samples.length ? "" : '<p class="st-hint" style="text-align:center">Comece pelo sample #1: foto primeiro, depois a cor.</p>'}
      <button type="button" class="st-btn st-btn--line st-btn--sm" style="align-self:center" data-act="discard">Descartar rodada</button>`;
    setBar(`<button type="button" class="st-btn" data-act="review" ${ready ? "" : "disabled"}>${ready ? "Revisar e enviar à cliente" : r.samples.length ? "Falta foto em algum sample" : "Adicione os samples"}</button>`);
  }

  function renderWaiting(r) {
    $("stView").innerHTML = `
      <div class="st-card">
        <div class="st-card__head"><b>Rodada ${r.number}</b><span class="st-pill is-dark">${r.status === "viewed" ? "Vista pela cliente" : "Enviada"}</span></div>
        <p class="st-hint" style="font-size:13px">Aguardando a cliente escolher e assinar${r.recipient_email ? ` · ${esc(r.recipient_email)}` : ""}. Você recebe o aviso quando ela assinar.</p>
        <div class="st-chips"><button type="button" class="st-chip" data-act="resend">Reenviar e-mail</button><button type="button" class="st-chip" data-act="approve-here">Cliente aprova neste celular</button></div>
      </div>
      <div class="st-list">${r.samples.map((s) => sampleRow(s, false)).join("")}</div>
      ${historyHtml()}`;
    setBar("");
  }

  function sampleColorLabel(d) {
    if (d.kind === "natural") return "Natural";
    if (d.kind === "blend") return d.blend.filter((b) => b.color && b.percent).map((b) => `${b.percent}% ${b.color}`).join(" + ");
    if (d.kind === "other") return [d.brand, d.color].filter(Boolean).join(" ");
    return d.color || "";
  }

  function renderSample() {
    const d = draft;
    const shots = [...d.photos.map((p) => ({ src: p.thumb_url, id: p.id })), ...d.pending.map((src, i) => ({ src, pending: i }))];
    const main = shots[0];
    const list = (data.catalog.duraseal || []).filter((c) => !d.query || c.toLowerCase().includes(d.query.toLowerCase()));
    let colorBox = "";
    if (d.kind === "duraseal") {
      colorBox = `<div style="position:relative"><label for="stQ" class="st-label" style="position:absolute;left:-9999px">Buscar cor</label>
          <input id="stQ" class="st-input" placeholder="Buscar entre ${data.catalog.duraseal.length} cores DuraSeal" value="${esc(d.query || "")}" autocomplete="off"></div>
        ${d.query ? `<div class="st-results">${list.length ? list.map((c) => `<button type="button" data-color="${esc(c)}" class="${d.color === c ? "is-on" : ""}">${esc(c)}</button>`).join("") : '<p class="st-hint" style="padding:12px">Nenhuma cor com esse nome. Use “Outra” para cores de outra marca.</p>'}</div>` : `<span class="st-label">Mais usadas</span>
        <div class="st-chips">${[...new Set([d.color, ...COMMON].filter(Boolean))].slice(0, 9).map((c) => `<button type="button" class="st-chip ${d.color === c ? "is-on" : ""}" data-color="${esc(c)}">${esc(c)}</button>`).join("")}</div>`}`;
    } else if (d.kind === "blend") {
      colorBox = `<datalist id="stDuraList">${data.catalog.duraseal.map((c) => `<option value="${esc(c)}">`).join("")}</datalist>
        ${d.blend.map((b, i) => `<div class="st-blend"><input class="st-input" list="stDuraList" data-blend-color="${i}" placeholder="Cor ${i + 1}" value="${esc(b.color)}" aria-label="Cor ${i + 1} da mistura">
          <input class="st-input" type="number" inputmode="numeric" min="1" max="100" data-blend-pct="${i}" value="${esc(b.percent)}" aria-label="Porcentagem da cor ${i + 1}"></div>`).join("")}
        ${d.blend.length < 3 ? '<button type="button" class="st-chip" data-act="blend-add" style="align-self:flex-start">+ Mais uma cor</button>' : ""}
        <p class="st-hint">Proporção em %, como foi misturado no balde.</p>`;
    } else if (d.kind === "natural") {
      colorBox = '<p class="st-hint" style="font-size:14px">Sem stain, só o acabamento.</p>';
    } else {
      colorBox = `<div class="st-field"><label for="stBrand">Marca</label><input id="stBrand" class="st-input" maxlength="60" placeholder="Ex.: Bona, Minwax" value="${esc(d.brand || "")}"></div>
        <div class="st-field"><label for="stColor">Nome da cor</label><input id="stColor" class="st-input" maxlength="80" value="${esc(d.color || "")}"></div>`;
    }
    $("stView").innerHTML = `
      <div class="st-field"><span class="st-label">1 · FOTO DO SAMPLE #${d.number} NO PISO</span>
        ${main ? `<div class="st-shot"><img src="${esc(main.src)}" alt="Foto do sample #${d.number}"><span class="st-num">#${d.number}</span></div>` : `<button type="button" class="st-cam" data-act="camera">${ICON.cam}Tirar foto do sample #${d.number}</button>`}
        ${shots.length ? `<div class="st-thumbs">${shots.map((s) => `<div class="st-thumb"><img src="${esc(s.src)}" alt=""><button type="button" aria-label="Remover foto" ${s.id ? `data-rm-photo="${esc(s.id)}"` : `data-rm-pending="${s.pending}"`}>×</button></div>`).join("")}
          ${shots.length < 6 ? `<button type="button" class="st-thumb st-cam" style="height:64px;font-size:0" data-act="camera" aria-label="Mais uma foto">${ICON.cam}</button>` : ""}</div>` : ""}
        <p class="st-hint">Deixe o número da fita aparecer na foto. A foto entra no ObraCam do job.</p>
      </div>
      <div class="st-field"><span class="st-label">2 · QUAL COR É ESSE SAMPLE?</span>
        <div class="st-seg" role="radiogroup" aria-label="Tipo de sample">${[["duraseal", "DuraSeal"], ["blend", "Mistura"], ["natural", "Natural"], ["other", "Outra"]].map(([k, l]) => `<button type="button" role="radio" aria-checked="${d.kind === k}" class="${d.kind === k ? "is-on" : ""}" data-kind="${k}">${l}</button>`).join("")}</div>
        ${colorBox}
      </div>
      ${d.id ? '<button type="button" class="st-btn st-btn--line st-btn--sm" style="align-self:center" data-act="delete-sample">Excluir sample</button>' : ""}`;
    const label = sampleColorLabel(d);
    setBar(`<button type="button" class="st-btn" data-act="save-sample">${label ? `Salvar sample #${d.number} · ${esc(label)}` : `Salvar sample #${d.number}`}</button>
      <button type="button" class="st-btn st-btn--line" data-act="cancel">Cancelar</button>`);
    const q = $("stQ");
    if (q && d.focusQuery) {
      q.focus();
      q.setSelectionRange(q.value.length, q.value.length);
    }
  }

  function renderReview() {
    const r = current();
    const board = r.board || r.samples.find((s) => s.photos[0])?.photos[0];
    $("stView").innerHTML = `
      <div class="st-field"><label for="stEmail">E-mail da cliente</label>
        <input id="stEmail" class="st-input" type="email" inputmode="email" autocomplete="email" value="${esc(r.recipient_email || data.job.customer_email || "")}" placeholder="cliente@email.com">
        <span class="st-hint">Vem do cliente do job. Mudar aqui não altera o cadastro.</span></div>
      <div class="st-field"><span class="st-label">PRÉVIA DO E-MAIL (INGLÊS)</span>
        <div class="st-mail"><div class="st-mail__head">${esc(company)}<b>Choose your stain color</b></div>
          <div class="st-mail__body">${board ? `<div class="st-shot"><img src="${esc(board.thumb_url)}" alt=""></div>` : ""}
            <span>We applied ${r.samples.length} stain sample${r.samples.length === 1 ? "" : "s"} on your${r.wood_species ? ` ${esc(r.wood_species)}` : ""} floor. Please look at them, choose one and sign so we can finish your floors.</span>
            <span class="st-pill is-dark" style="align-self:flex-start">Choose your color</span></div></div></div>
      ${data.job.has_builder ? `<div class="st-card"><span class="st-label">JOB DE BUILDER${data.job.builder_name ? ` · ${esc(data.job.builder_name)}` : ""}</span>
        <label class="st-switch"><input type="checkbox" id="stBuilder" ${r.send_to_builder ? "checked" : ""}><span><b>Mandar a aprovação ao builder</b><small>Foto, cor e PDF entram no job dele no ObraBuilder, com aviso no celular.</small></span></label></div>` : ""}
      <p class="st-hint" style="text-align:center">${r.samples.length} samples · link vale 14 dias</p>`;
    setBar(`<button type="button" class="st-btn" data-act="send">Enviar para a cliente</button>
      <button type="button" class="st-btn st-btn--line" data-act="approve-here">Cliente aprova agora, neste celular</button>`);
  }

  // ------------------------------------------------------------------ actions
  async function load() {
    data = await api(`/api/work-orders/${encodeURIComponent(jobId)}/stain`);
    render();
  }

  function openSample(sample) {
    const r = current();
    const nextNumber = r.samples.reduce((m, s) => Math.max(m, s.number), 0) + 1;
    draft = sample
      ? { id: sample.id, number: sample.number, kind: sample.kind, color: sample.kind === "other" ? sample.color_name : sample.color_name, brand: sample.brand || "", blend: sample.blend.length ? sample.blend.map((b) => ({ ...b })) : [{ color: "", percent: 50 }, { color: "", percent: 50 }], photos: sample.photos.slice(), pending: [], removed: [], orig: JSON.stringify([sample.kind, sample.color_name, sample.brand || "", sample.blend]) }
      : { id: null, number: nextNumber, kind: "duraseal", color: "", brand: "", blend: [{ color: "", percent: 50 }, { color: "", percent: 50 }], photos: [], pending: [], removed: [] };
    view = "sample";
    render();
    window.scrollTo(0, 0);
    if (!sample) setTimeout(() => openCamera("sample"), 60);
  }

  function openCamera(kind) {
    cameraFor = kind;
    const input = $("stCamera");
    input.value = "";
    input.click();
  }

  function samplePayload(d) {
    if (d.kind === "blend") return { kind: "blend", blend: d.blend.filter((b) => b.color.trim()).map((b) => ({ color: b.color.trim(), percent: Math.round(Number(b.percent) || 0) })) };
    if (d.kind === "natural") return { kind: "natural" };
    if (d.kind === "other") return { kind: "other", brand: d.brand.trim(), color_name: d.color.trim() };
    return { kind: "duraseal", color_name: d.color };
  }

  async function saveSample() {
    const d = draft;
    if (!d.photos.length && !d.pending.length) throw new Error(`Tire a foto do sample #${d.number}.`);
    const body = samplePayload(d);
    if (body.kind === "duraseal" && !body.color_name) throw new Error("Escolha a cor do sample.");
    const r = current();
    let sampleId = d.id;
    if (!sampleId) {
      const out = await post(`/api/stain/rounds/${encodeURIComponent(r.id)}/samples`, { ...body, number: d.number });
      sampleId = out.sample_id;
      data = out;
    } else if (JSON.stringify([body.kind, body.color_name || "", body.brand || "", body.blend || []]) !== d.orig) {
      data = await patch(`/api/stain/samples/${encodeURIComponent(sampleId)}`, body);
    }
    for (const id of d.removed) data = await del(`/api/stain/samples/${encodeURIComponent(sampleId)}/photos/${encodeURIComponent(id)}`);
    for (let i = 0; i < d.pending.length; i++) {
      data = await post(`/api/stain/samples/${encodeURIComponent(sampleId)}/photos`, { data_url: d.pending[i], ...photoMeta() });
    }
    draft = null;
    view = "home";
    toast(`Sample #${d.number} salvo`);
    render();
  }

  async function ensureRound() {
    const out = await post(`/api/work-orders/${encodeURIComponent(jobId)}/stain/rounds`, {});
    data = out;
    view = "home";
    render();
  }

  async function sendNow(linkOnly) {
    const r = current();
    const emailInput = $("stEmail");
    const email = emailInput ? emailInput.value.trim() : r.recipient_email || "";
    const builder = $("stBuilder");
    if (view === "review") {
      await patch(`/api/stain/rounds/${encodeURIComponent(r.id)}`, { recipient_email: email || "", ...(builder ? { send_to_builder: builder.checked } : {}) });
    }
    if (!linkOnly && !email) throw new Error("Digite o e-mail da cliente ou use “Cliente aprova agora”.");
    const out = await post(`/api/stain/rounds/${encodeURIComponent(r.id)}/send`, linkOnly ? { link_only: true } : { email });
    if (linkOnly) {
      location.href = out.url;
      return;
    }
    data = out;
    view = "home";
    toast(out.emailed ? "Enviado para a cliente" : "Link criado");
    render();
  }

  function bind() {
    $("stBack").addEventListener("click", () => {
      if (view !== "home") {
        view = "home";
        draft = null;
        render();
        return;
      }
      if (history.length > 1) history.back();
      else location.href = `ticket.html?id=${encodeURIComponent(jobId)}`;
    });

    $("stCamera").addEventListener("change", async (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      try {
        const dataUrl = await shrink(file, 1600);
        if (cameraFor === "board") {
          await guarded(async () => {
            data = await post(`/api/stain/rounds/${encodeURIComponent(current().id)}/board-photo`, { data_url: dataUrl, ...photoMeta() });
            toast("Foto do conjunto salva");
            render();
          });
        } else if (draft) {
          draft.pending.push(dataUrl);
          render();
        }
      } catch (err) {
        toast(err.message, "error");
      }
    });

    document.addEventListener("click", (e) => {
      const t = e.target.closest("[data-act],[data-sample],[data-wood],[data-kind],[data-color],[data-rm-photo],[data-rm-pending]");
      if (!t) return;
      const act = t.getAttribute("data-act");
      if (t.hasAttribute("data-sample")) {
        const s = current().samples.find((x) => x.id === t.getAttribute("data-sample"));
        if (s) openSample(s);
        return;
      }
      if (t.hasAttribute("data-wood")) {
        let w = t.getAttribute("data-wood");
        if (w === "__other") {
          w = (prompt("Qual madeira?") || "").trim();
          if (!w) return;
        }
        guarded(async () => {
          data = await patch(`/api/stain/rounds/${encodeURIComponent(current().id)}`, { wood_species: w });
          render();
        });
        return;
      }
      if (t.hasAttribute("data-kind")) {
        draft.kind = t.getAttribute("data-kind");
        render();
        return;
      }
      if (t.hasAttribute("data-color")) {
        draft.color = t.getAttribute("data-color");
        draft.query = "";
        draft.focusQuery = false;
        render();
        return;
      }
      if (t.hasAttribute("data-rm-photo")) {
        const id = t.getAttribute("data-rm-photo");
        draft.photos = draft.photos.filter((p) => p.id !== id);
        draft.removed.push(id);
        render();
        return;
      }
      if (t.hasAttribute("data-rm-pending")) {
        draft.pending.splice(Number(t.getAttribute("data-rm-pending")), 1);
        render();
        return;
      }
      if (act === "new-round") guarded(ensureRound);
      if (act === "add-sample") openSample(null);
      if (act === "camera") openCamera("sample");
      if (act === "board") openCamera("board");
      if (act === "blend-add") {
        draft.blend.push({ color: "", percent: 0 });
        render();
      }
      if (act === "save-sample") guarded(saveSample);
      if (act === "cancel") {
        draft = null;
        view = "home";
        render();
      }
      if (act === "delete-sample") {
        if (!confirm(`Excluir o sample #${draft.number}?`)) return;
        guarded(async () => {
          data = await del(`/api/stain/samples/${encodeURIComponent(draft.id)}`);
          draft = null;
          view = "home";
          render();
        });
      }
      if (act === "discard") {
        if (!confirm("Descartar esta rodada e os samples dela?")) return;
        guarded(async () => {
          data = await del(`/api/stain/rounds/${encodeURIComponent(current().id)}`);
          render();
        });
      }
      if (act === "review") {
        view = "review";
        render();
        window.scrollTo(0, 0);
      }
      if (act === "send") guarded(() => sendNow(false));
      if (act === "approve-here") guarded(() => sendNow(true));
      if (act === "resend") guarded(() => sendNow(false));
    });

    document.addEventListener("input", (e) => {
      const t = e.target;
      if (!draft) return;
      if (t.id === "stQ") {
        draft.query = t.value;
        draft.focusQuery = true;
        render();
      } else if (t.id === "stBrand") draft.brand = t.value;
      else if (t.id === "stColor") draft.color = t.value;
      else if (t.hasAttribute("data-blend-color")) draft.blend[Number(t.getAttribute("data-blend-color"))].color = t.value;
      else if (t.hasAttribute("data-blend-pct")) draft.blend[Number(t.getAttribute("data-blend-pct"))].percent = t.value;
    });

    document.addEventListener("change", (e) => {
      const t = e.target;
      if (t.id === "stRoom") {
        guarded(async () => {
          data = await patch(`/api/stain/rounds/${encodeURIComponent(current().id)}`, { room: t.value.trim() });
        });
      }
      if (draft && (t.hasAttribute("data-blend-color") || t.hasAttribute("data-blend-pct") || t.id === "stBrand" || t.id === "stColor")) render();
    });
  }

  async function boot() {
    if (!jobId) {
      $("stView").innerHTML = '<p class="st-empty">Abra pelo job.</p>';
      return;
    }
    bind();
    try {
      await load();
      try {
        const s = await fetch("/api/auth/session", { credentials: "same-origin" }).then((r) => r.json());
        company = s?.organization?.name || s?.user?.organization?.name || "";
      } catch (_) {}
    } catch (err) {
      $("stView").innerHTML = `<p class="st-empty">${esc(err.message)}</p>`;
    }
  }

  boot();
})();
