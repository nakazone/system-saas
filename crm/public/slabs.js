/**
 * Slabs (Countertops): the shop's yard of slabs and remnants as a photo grid. A card opens a sheet to
 * reserve the slab for a job, release it, mark it used, bring back the leftover as a remnant,
 * set it aside as broken, or edit its tag, size and rack. The office changes; the crew reads.
 */
(function () {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const MATERIALS = [["quartz", "Quartzo"], ["granite", "Granito"], ["quartzite", "Quartzito"], ["marble", "Mármore"], ["porcelain", "Porcelanato"], ["other", "Outro"]];
  const FINISHES = [["", "—"], ["polished", "Polido"], ["honed", "Levigado"], ["leathered", "Escovado"], ["other", "Outro"]];
  const STATUS = { available: "Livre", reserved: "Reservado", used: "Usado", scrapped: "Descartado" };
  const num = (n) => (Math.round(Number(n) * 10) / 10).toLocaleString("pt-BR");
  const inch = (n) => `${num(n)}″`;
  const money = (n) => (n == null ? "—" : `$${Number(n).toLocaleString("en-US", { maximumFractionDigits: 2 })}`);

  const st = { items: [], used: null, summary: null, canManage: false, filter: "all", q: "", fitL: null, fitW: null, open: null, busy: false };

  async function api(url, opts) {
    const r = await fetch(url, { credentials: "include", headers: { "Content-Type": "application/json", Accept: "application/json" }, ...(opts || {}) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.success === false) {
      const e = new Error(j.error || "Não foi possível concluir.");
      e.status = r.status;
      e.code = j.code;
      throw e;
    }
    return j.data;
  }
  const toast = (msg, kind) => (kind === "error" ? window.crmToast?.error?.(msg) : window.crmToast?.success?.(msg)) || null;

  /* ───────────── loading ───────────── */

  async function load() {
    try {
      const d = await api("/api/slabs");
      st.items = d.items || [];
      st.summary = d.summary || null;
      st.canManage = Boolean(d.can_manage);
      st.canReadTag = Boolean(d.can_read_tag);
      if (st.filter === "used") st.used = (await api("/api/slabs?status=used")).items || [];
      $("slAdd").hidden = !st.canManage;
      $("slExport").hidden = !st.canManage;
      $("slStatus").hidden = true;
      render();
    } catch (e) {
      $("slStatus").hidden = false;
      $("slStatus").textContent = e.status === 404 ? "O estoque de slabs não existe no ofício desta empresa." : e.message;
      $("slGrid").innerHTML = "";
    }
  }

  /* ───────────── yard ───────────── */

  function fits(s) {
    if (!st.fitL || !st.fitW) return true;
    const [a, b] = [Math.max(s.length_in, s.width_in), Math.min(s.length_in, s.width_in)];
    const [x, y] = [Math.max(st.fitL, st.fitW), Math.min(st.fitL, st.fitW)];
    return a >= x && b >= y;
  }
  function matches(s) {
    if (!st.q) return true;
    const hay = [s.color, s.brand, s.serial, s.supplier, s.location, s.material_label, s.notes, s.job && s.job.customer, s.job && s.job.number && `#${s.job.number}`].filter(Boolean).join(" ").toLowerCase();
    return hay.includes(st.q);
  }
  const base = () => (st.filter === "used" ? st.used || [] : st.items);
  function shown() {
    return base()
      .filter((s) => st.filter === "all" || st.filter === "used" || (st.filter === "reserved" ? s.status === "reserved" : s.kind === st.filter))
      .filter(matches)
      .filter(fits);
  }

  function tilesHtml() {
    const s = st.summary;
    if (!s) return "";
    const jobs = new Set(st.items.filter((x) => x.status === "reserved" && x.job).map((x) => x.job.id)).size;
    const tile = (label, n, sub) => `<div class="sl-tile"><span>${label}</span><b>${n}</b><small>${sub}</small></div>`;
    return (
      tile("Slabs livres", s.available_slabs.n, `${num(s.available_slabs.sf)} pé²`) +
      tile("Sobras", s.available_remnants.n, `${num(s.available_remnants.sf)} pé²`) +
      tile("Reservados", s.reserved.n, `${jobs} job${jobs === 1 ? "" : "s"}`)
    );
  }

  function chipsHtml() {
    const all = st.items;
    const chips = [
      ["all", "Todos", all.length],
      ["slab", "Slabs", all.filter((s) => s.kind === "slab").length],
      ["remnant", "Sobras", all.filter((s) => s.kind === "remnant").length],
      ["reserved", "Reservados", all.filter((s) => s.status === "reserved").length],
      ["used", "Usados", st.used ? st.used.length : null],
    ];
    return chips
      .map(([k, l, n]) => `<button type="button" class="sl-chip${st.filter === k ? " is-on" : ""}" data-sl-filter="${k}" aria-pressed="${st.filter === k}">${l}${n == null ? "" : `<em>${n}</em>`}</button>`)
      .join("");
  }

  const photoStyle = (s) => (s.photo_url ? ` style="background-image:url('${esc(s.photo_url)}')"` : "");
  const tagOf = (s) => [s.serial, s.location].filter(Boolean).join(" · ");
  const subOf = (s) => [s.material_label, s.brand, `${s.thickness_cm} cm`].filter(Boolean).join(" · ");
  const sizeOf = (s) => `${inch(s.length_in)} × ${inch(s.width_in)} · ${num(s.sq_ft)} pé²`;
  function pillHtml(s) {
    const label = s.status === "reserved" || s.status === "used" ? (s.job ? `#${s.job.number ?? "?"}${s.job.customer ? ` ${s.job.customer}` : ""}` : STATUS[s.status]) : STATUS[s.status] || s.status;
    return `<span class="sl-pill sl-pill--${esc(s.status)}" title="${esc(STATUS[s.status] || "")}">${esc(label)}</span>`;
  }

  function cardHtml(s) {
    const tag = tagOf(s);
    const act = s.status === "available" && st.canManage ? "Reservar" : s.job ? "Ver job" : "Abrir";
    return `<button type="button" class="sl-card" data-sl-open="${esc(s.id)}" aria-label="${esc(`${s.color}, ${sizeOf(s)}, ${STATUS[s.status] || ""}`)}">
      <div class="sl-ph${s.photo_url ? "" : " sl-ph--none"}"${photoStyle(s)}>${s.photo_url ? "" : "Sem foto"}${tag ? `<span class="sl-ph__tag">${esc(tag)}</span>` : ""}${s.kind === "remnant" ? '<span class="sl-ph__kind">Sobra</span>' : ""}</div>
      <div class="sl-cb"><h3>${esc(s.color)}</h3><p>${esc(subOf(s))}</p><p>${esc(sizeOf(s))}</p>
        <div class="sl-cb__row">${pillHtml(s)}<span class="sl-link" aria-hidden="true">${act}</span></div></div>
    </button>`;
  }

  function render() {
    $("slTiles").innerHTML = tilesHtml();
    $("slChips").innerHTML = chipsHtml();
    const list = shown();
    if (!list.length) {
      const filtered = st.q || st.fitL || st.fitW || st.filter !== "all";
      $("slGrid").innerHTML = `<div class="sl-empty">${
        filtered
          ? "<b>Nada com esse filtro.</b>Tente outra cor ou um tamanho menor."
          : `<b>O pátio ainda está vazio.</b>${st.canManage ? "Cadastre os slabs com a foto da etiqueta: assim dá para reservar cada um para um job." : "O escritório cadastra os slabs aqui."}`
      }</div>`;
      return;
    }
    $("slGrid").innerHTML = list.map(cardHtml).join("");
  }

  /* ───────────── sheet ───────────── */

  const find = (id) => st.items.concat(st.used || []).find((s) => s.id === id) || null;

  function openSheet(html, title) {
    $("slSheetPanel").innerHTML = `<header class="sl-sheet__bar"><h2 id="slSheetTitle">${esc(title)}</h2><button type="button" class="sl-link" data-sl-close>Fechar</button></header><div class="sl-sheet__body">${html}</div>`;
    $("slSheet").hidden = false;
    document.body.style.overflow = "hidden";
    setTimeout(() => $("slSheetPanel").querySelector("input, select, button:not([data-sl-close])")?.focus(), 30);
  }
  function closeSheet() {
    $("slSheet").hidden = true;
    document.body.style.overflow = "";
    const id = st.open;
    st.open = null;
    if (id) document.querySelector(`[data-sl-open="${CSS.escape(id)}"]`)?.focus();
  }

  function detailHtml(s) {
    const facts = [
      ["Pedra", subOf(s)],
      ["Tamanho", sizeOf(s)],
      ...(s.finish ? [["Acabamento", (FINISHES.find(([k]) => k === s.finish) || [, s.finish])[1]]] : []),
      ["Lote", s.serial || "—"],
      ["Local", s.location || "—"],
      ["Fornecedor", s.supplier || "—"],
      ...(st.canManage ? [["Custo", money(s.cost)]] : []),
      ["Status", STATUS[s.status] || s.status],
      ...(s.job ? [["Job", `<a href="job-detail.html?id=${encodeURIComponent(s.job.id)}">#${esc(s.job.number ?? "?")}${s.job.customer ? ` · ${esc(s.job.customer)}` : ""}</a>`]] : []),
      ...(s.notes ? [["Notas", esc(s.notes)]] : []),
    ];
    const m = st.canManage;
    const acts = [];
    if (m && s.status === "available") acts.push('<button type="button" class="sl-btn sl-btn--pri" data-sl-act="reserve">Reservar para um job</button>');
    if (m && s.status === "reserved") acts.push('<button type="button" class="sl-btn sl-btn--pri" data-sl-act="use">Foi para a fabricação</button>', '<button type="button" class="sl-btn" data-sl-act="release">Liberar</button>');
    if (m && (s.status === "used" || s.status === "available") && s.kind === "slab") acts.push('<button type="button" class="sl-btn" data-sl-act="remnant">Registrar sobra</button>');
    if (m && s.status !== "used") acts.push('<button type="button" class="sl-btn" data-sl-act="edit">Editar</button>');
    if (m && s.status !== "used" && s.status !== "scrapped") acts.push('<button type="button" class="sl-btn" data-sl-act="scrap">Descartar (quebrou)</button>');
    if (m && s.status === "scrapped") acts.push('<button type="button" class="sl-btn" data-sl-act="back">Voltar ao pátio</button>');
    if (m && (s.status === "available" || s.status === "scrapped")) acts.push('<button type="button" class="sl-btn sl-btn--danger" data-sl-act="delete">Apagar</button>');
    return `<div class="sl-ph sl-sheet__ph${s.photo_url ? "" : " sl-ph--none"}"${photoStyle(s)}>${s.photo_url ? "" : "Sem foto"}${s.kind === "remnant" ? '<span class="sl-ph__kind">Sobra</span>' : ""}</div>
      ${m ? `<label class="sl-btn" style="text-align:center">${s.photo_url ? "Trocar foto" : "Foto da etiqueta / do slab"}<input type="file" accept="image/jpeg,image/png" data-sl-photo hidden /></label>` : ""}
      <dl class="sl-facts">${facts.map(([k, v]) => `<dt>${k}</dt><dd>${k === "Job" || k === "Notas" ? v : esc(v)}</dd>`).join("")}</dl>
      ${acts.length ? `<div class="sl-acts">${acts.join("")}</div>` : ""}
      <div id="slSub"></div>`;
  }

  function showDetail(id) {
    const s = find(id);
    if (!s) return;
    st.open = id;
    openSheet(detailHtml(s), s.color);
  }

  function formHtml(s) {
    const v = (k, d = "") => esc(s ? s[k] ?? d : d);
    const opt = (list, cur) => list.map(([k, l]) => `<option value="${k}"${(cur || "") === k ? " selected" : ""}>${l}</option>`).join("");
    const kind = s ? s.kind : "slab";
    const th = s ? s.thickness_cm : 3;
    const tag = !s && st.canReadTag
      ? `<div class="sl-box sl-tag full" id="slTagBox">${
          st.tagPhoto
            ? `<div class="sl-tag__row"><img src="${esc(st.tagPhoto)}" alt="Foto da etiqueta" /><p id="slTagMsg">${esc(st.tagMsg || "")}</p></div>`
            : `<h3>Ler a etiqueta pela foto</h3><p>Tire uma foto da etiqueta do slab: o Mate preenche pedra, cor, medidas e lote. Você confere antes de salvar.</p>`
        }<label class="sl-btn" style="text-align:center">${st.tagPhoto ? "Outra foto" : "Foto da etiqueta"}<input type="file" accept="image/jpeg,image/png" capture="environment" data-sl-tag hidden /></label></div>`
      : "";
    return `<form class="sl-form" id="slForm" novalidate>
      ${tag}
      <label class="full">Tipo<div class="sl-seg" role="group" aria-label="Tipo"><button type="button" data-sl-kind="slab" class="${kind === "slab" ? "is-on" : ""}">Slab</button><button type="button" data-sl-kind="remnant" class="${kind === "remnant" ? "is-on" : ""}">Sobra</button></div></label>
      <label class="full">Cor / nome<input name="color" required maxlength="80" value="${v("color")}" placeholder="Ex.: Calacatta Laza" /></label>
      <label>Pedra<select name="material">${opt(MATERIALS, s ? s.material : "quartz")}</select></label>
      <label>Marca<input name="brand" maxlength="80" value="${v("brand")}" placeholder="MSI, Cambria…" /></label>
      <label>Comprimento (pol)<input name="length_in" type="number" inputmode="decimal" min="1" max="200" step="0.25" required value="${v("length_in")}" placeholder="126" /></label>
      <label>Largura (pol)<input name="width_in" type="number" inputmode="decimal" min="1" max="200" step="0.25" required value="${v("width_in")}" placeholder="63" /></label>
      <label>Espessura<div class="sl-seg" role="group" aria-label="Espessura"><button type="button" data-sl-th="3" class="${th === 3 ? "is-on" : ""}">3 cm</button><button type="button" data-sl-th="2" class="${th === 2 ? "is-on" : ""}">2 cm</button></div></label>
      <label>Acabamento<select name="finish">${opt(FINISHES, s ? s.finish : "")}</select></label>
      <label>Lote / série<input name="serial" maxlength="80" value="${v("serial")}" placeholder="Da etiqueta" /></label>
      <label>Local<input name="location" maxlength="60" value="${v("location")}" placeholder="Rack A3" /></label>
      <label>Fornecedor<input name="supplier" maxlength="80" value="${v("supplier")}" /></label>
      <label>Custo ($)<input name="cost" type="number" inputmode="decimal" min="0" step="0.01" value="${s && s.cost != null ? esc(s.cost) : ""}" /></label>
      <label class="full">Notas<textarea name="notes" maxlength="1000" data-crm-rich="off">${v("notes")}</textarea></label>
      <div class="full sl-acts" style="grid-column:1/-1"><button type="submit" class="sl-btn sl-btn--pri">${s ? "Salvar" : "Cadastrar"}</button>${s ? '<button type="button" class="sl-btn" data-sl-act="cancel-edit">Cancelar</button>' : ""}</div>
    </form>`;
  }

  function readForm() {
    const f = $("slForm");
    const g = (n) => f.elements[n].value.trim();
    const numOr = (n) => (g(n) === "" ? null : Number(g(n)));
    return {
      kind: f.querySelector("[data-sl-kind].is-on")?.dataset.slKind || "slab",
      thickness_cm: Number(f.querySelector("[data-sl-th].is-on")?.dataset.slTh || 3),
      color: g("color"),
      material: g("material"),
      brand: g("brand") || null,
      finish: g("finish") || null,
      length_in: numOr("length_in"),
      width_in: numOr("width_in"),
      serial: g("serial") || null,
      location: g("location") || null,
      supplier: g("supplier") || null,
      cost: numOr("cost"),
      notes: g("notes") || null,
    };
  }

  async function submitForm() {
    const body = readForm();
    if (!body.color) return toast("Escreva a cor ou o nome da pedra.", "error");
    if (!(body.length_in > 0) || !(body.width_in > 0)) return toast("Coloque o comprimento e a largura em polegadas.", "error");
    const id = st.open;
    try {
      const row = id ? await api(`/api/slabs/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(body) }) : await api("/api/slabs", { method: "POST", body: JSON.stringify(body) });
      // The tag photo the Mate read becomes the slab's photo.
      if (!id && st.tagPhoto) {
        await api(`/api/slabs/${encodeURIComponent(row.id)}/photo`, { method: "POST", body: JSON.stringify({ data_url: st.tagPhoto }) }).catch(() => null);
      }
      st.tagPhoto = null;
      st.tagMsg = "";
      toast(id ? "Slab salvo" : "Slab cadastrado");
      await load();
      showDetail(row.id);
    } catch (e) {
      toast(e.message, "error");
    }
  }

  /* reserve: pick the job */
  let jobTimer = null;
  function reserveHtml() {
    return `<div class="sl-box"><h3>Reservar para qual job?</h3><input type="search" class="sl-search-in" id="slJobQ" placeholder="Número, cliente ou endereço" style="border:1px solid var(--sl-line);border-radius:10px;padding:.6rem .7rem;font:inherit" /><div class="sl-jobs" id="slJobs"><p>Carregando…</p></div></div>`;
  }
  async function searchJobs(q) {
    const host = $("slJobs");
    if (!host) return;
    try {
      const params = new URLSearchParams();
      if (q) params.set("q", q);
      else if (st.jobHint) params.set("id", st.jobHint);
      const r = await fetch(`/api/work-orders?${params}`, { credentials: "include", headers: { Accept: "application/json" } });
      const j = await r.json();
      const list = (j.data || [])
        .filter((x) => !["canceled", "paid", "invoiced", "completed"].includes(x.status))
        .sort((a, b) => (b.id === st.jobHint) - (a.id === st.jobHint))
        .slice(0, 12);
      host.innerHTML = list.length
        ? list
            .map((x) => {
              const who = (x.customer && x.customer.name) || x.client_name || x.customer_name || (x.builder && x.builder.company) || "";
              return `<button type="button" class="sl-job" data-sl-job="${esc(x.id)}"><span>#${esc(x.number ?? "?")} ${esc(x.title || "")}</span><small>${esc(who)}</small></button>`;
            })
            .join("")
        : "<p>Nenhum job aberto encontrado.</p>";
    } catch (_) {
      host.innerHTML = "<p>Não foi possível buscar os jobs.</p>";
    }
  }

  function remnantHtml(s) {
    return `<form class="sl-box" id="slRemForm"><h3>Sobra deste slab</h3><p>Entra no pátio como sobra da mesma pedra e lote.</p>
      <div class="sl-form"><label>Comprimento (pol)<input name="length_in" type="number" inputmode="decimal" min="1" max="${esc(Math.max(s.length_in, s.width_in))}" step="0.25" required /></label>
      <label>Largura (pol)<input name="width_in" type="number" inputmode="decimal" min="1" max="${esc(Math.min(s.length_in, s.width_in))}" step="0.25" required /></label>
      <label class="full">Local<input name="location" maxlength="60" placeholder="Rack de sobras" value="${esc(s.location || "")}" /></label></div>
      <div class="sl-acts"><button type="submit" class="sl-btn sl-btn--pri">Registrar sobra</button></div></form>`;
  }

  async function act(name) {
    const id = st.open;
    const s = id && find(id);
    if (!s || st.busy) return;
    const post = async (path, body, msg) => {
      st.busy = true;
      try {
        await api(`/api/slabs/${encodeURIComponent(id)}${path}`, { method: "POST", body: JSON.stringify(body || {}) });
        toast(msg);
        await load();
        showDetail(id);
      } catch (e) {
        toast(e.message, "error");
      } finally {
        st.busy = false;
      }
    };
    if (name === "reserve") {
      $("slSub").innerHTML = reserveHtml();
      $("slJobQ").focus();
      return searchJobs("");
    }
    if (name === "release") return post("/release", {}, "Slab liberado");
    if (name === "use") return post("/use", {}, "Slab marcado como usado");
    if (name === "remnant") {
      $("slSub").innerHTML = remnantHtml(s);
      return $("slRemForm").elements.length_in.focus();
    }
    if (name === "edit") return openSheet(formHtml(s), `Editar ${s.color}`);
    if (name === "cancel-edit") return showDetail(id);
    if (name === "scrap" || name === "back") {
      st.busy = true;
      try {
        await api(`/api/slabs/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ status: name === "scrap" ? "scrapped" : "available" }) });
        toast(name === "scrap" ? "Slab descartado" : "Slab de volta ao pátio");
        await load();
        showDetail(id);
      } catch (e) {
        toast(e.message, "error");
      } finally {
        st.busy = false;
      }
      return;
    }
    if (name === "delete") {
      const b = $("slSheetPanel").querySelector('[data-sl-act="delete"]');
      if (b && b.dataset.confirm !== "1") {
        b.dataset.confirm = "1";
        b.textContent = "Apagar mesmo? Toque de novo";
        return;
      }
      try {
        await api(`/api/slabs/${encodeURIComponent(id)}`, { method: "DELETE" });
        toast("Slab apagado");
        st.open = null;
        closeSheet();
        await load();
      } catch (e) {
        toast(e.message, "error");
      }
    }
  }

  /** The Mate reads the tag: fills the empty fields of the new-slab form, the office checks them. */
  async function readTag(file) {
    if (!file) return;
    if (!/^image\/(jpeg|png)$/.test(file.type)) return toast("Use uma foto JPG ou PNG.", "error");
    const f = $("slForm");
    const keep = f ? readForm() : null;
    st.tagPhoto = await shrink(file);
    st.tagMsg = "Lendo a etiqueta…";
    openSheet(formHtml(null), "Novo slab");
    if (keep) fillForm(keep, true);
    try {
      const t = await api("/api/slabs/read-tag", { method: "POST", body: JSON.stringify({ data_url: st.tagPhoto }) });
      const got = fillForm(t, false);
      st.tagMsg = got ? `O Mate leu ${got} campo${got === 1 ? "" : "s"} (em laranja). Confira antes de cadastrar.` : "O Mate não achou dados na etiqueta. Preencha à mão.";
    } catch (e) {
      st.tagMsg = e.message || "Não deu para ler a etiqueta.";
    }
    const msg = $("slTagMsg");
    if (msg) msg.textContent = st.tagMsg;
  }

  /** Put values in the form; `all` false = only where the form is empty. Returns how many were set. */
  function fillForm(v, all) {
    const f = $("slForm");
    if (!f || !v) return 0;
    let n = 0;
    const set = (name, val) => {
      if (val == null || val === "") return;
      const el = f.elements[name];
      if (!el || (!all && String(el.value).trim() !== "" && !(name === "material" && el.value === "quartz"))) return;
      el.value = String(val);
      if (!all) el.classList.add("is-ai");
      n++;
    };
    ["color", "material", "brand", "finish", "length_in", "width_in", "serial", "supplier", "location", "cost", "notes"].forEach((k) => set(k, v[k]));
    const seg = (attr, val) => {
      if (val == null) return;
      const b = f.querySelector(`[${attr}="${val}"]`);
      if (!b) return;
      b.parentElement.querySelectorAll("button").forEach((x) => x.classList.toggle("is-on", x === b));
      if (!all) n++;
    };
    seg("data-sl-th", v.thickness_cm);
    if (all) seg("data-sl-kind", v.kind);
    return n;
  }

  async function uploadPhoto(file) {
    const id = st.open;
    if (!id || !file) return;
    if (!/^image\/(jpeg|png)$/.test(file.type)) return toast("Use uma foto JPG ou PNG.", "error");
    const data_url = await shrink(file);
    try {
      await api(`/api/slabs/${encodeURIComponent(id)}/photo`, { method: "POST", body: JSON.stringify({ data_url }) });
      toast("Foto salva");
      await load();
      showDetail(id);
    } catch (e) {
      toast(e.message, "error");
    }
  }
  /** Phone photos are big: keep the long side at 1800 px, JPEG. */
  function shrink(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        const k = Math.min(1, 1800 / Math.max(img.width, img.height));
        const c = document.createElement("canvas");
        c.width = Math.round(img.width * k);
        c.height = Math.round(img.height * k);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        resolve(c.toDataURL("image/jpeg", 0.85));
      };
      img.onerror = () => reject(new Error("Foto inválida."));
      img.src = url;
    });
  }

  /* ───────────── events ───────────── */

  function bind() {
    $("slAdd").addEventListener("click", () => {
      st.open = null;
      st.tagPhoto = null;
      st.tagMsg = "";
      openSheet(formHtml(null), "Novo slab");
    });
    $("slQ").addEventListener("input", (e) => {
      st.q = e.target.value.trim().toLowerCase();
      render();
    });
    const fit = () => {
      const l = Number($("slFitL").value);
      const w = Number($("slFitW").value);
      st.fitL = l > 0 ? l : null;
      st.fitW = w > 0 ? w : null;
      render();
    };
    $("slFitL").addEventListener("input", fit);
    $("slFitW").addEventListener("input", fit);
    $("slChips").addEventListener("click", async (e) => {
      const b = e.target.closest("[data-sl-filter]");
      if (!b) return;
      st.filter = b.dataset.slFilter;
      if (st.filter === "used" && !st.used) {
        try {
          st.used = (await api("/api/slabs?status=used")).items || [];
        } catch (_) {
          st.used = [];
        }
      }
      render();
    });
    $("slGrid").addEventListener("click", (e) => {
      const c = e.target.closest("[data-sl-open]");
      if (c) showDetail(c.dataset.slOpen);
    });
    const sheet = $("slSheet");
    sheet.addEventListener("click", async (e) => {
      if (e.target.closest("[data-sl-close]")) return closeSheet();
      const seg = e.target.closest("[data-sl-kind], [data-sl-th]");
      if (seg) {
        seg.parentElement.querySelectorAll("button").forEach((x) => x.classList.toggle("is-on", x === seg));
        return;
      }
      const a = e.target.closest("[data-sl-act]");
      if (a) return act(a.dataset.slAct);
      const j = e.target.closest("[data-sl-job]");
      if (j && st.open && !st.busy) {
        st.busy = true;
        try {
          const row = await api(`/api/slabs/${encodeURIComponent(st.open)}/reserve`, { method: "POST", body: JSON.stringify({ job_id: j.dataset.slJob }) });
          toast(`Reservado para o job #${row.job && row.job.number != null ? row.job.number : ""}`);
          await load();
          showDetail(st.open);
        } catch (err) {
          toast(err.message, "error");
        } finally {
          st.busy = false;
        }
      }
    });
    sheet.addEventListener("input", (e) => {
      if (e.target.id !== "slJobQ") return;
      clearTimeout(jobTimer);
      const q = e.target.value.trim();
      jobTimer = setTimeout(() => searchJobs(q), 250);
    });
    sheet.addEventListener("change", (e) => {
      if (e.target.matches("[data-sl-photo]")) uploadPhoto(e.target.files && e.target.files[0]);
      if (e.target.matches("[data-sl-tag]")) readTag(e.target.files && e.target.files[0]);
    });
    sheet.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (e.target.id === "slForm") return submitForm();
      if (e.target.id === "slRemForm") {
        const f = e.target;
        const body = { length_in: Number(f.elements.length_in.value), width_in: Number(f.elements.width_in.value), location: f.elements.location.value.trim() || null };
        if (!(body.length_in > 0) || !(body.width_in > 0)) return toast("Coloque as medidas da sobra.", "error");
        try {
          const row = await api(`/api/slabs/${encodeURIComponent(st.open)}/remnant`, { method: "POST", body: JSON.stringify(body) });
          toast("Sobra registrada");
          await load();
          showDetail(row.id);
        } catch (err) {
          toast(err.message, "error");
        }
      }
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !$("slSheet").hidden) closeSheet();
    });
    // Opened from a job ("Reservar slab"): keep the job in mind for the next reservation.
    const job = new URLSearchParams(location.search).get("job");
    if (job) st.jobHint = job;
  }

  function boot() {
    bind();
    load();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
