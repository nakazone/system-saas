/**
 * Job page › Fases: the job's phases for trades that keep them per job (Tile: site ready, prep,
 * waterproofing, flood test, setting, grout, seal). One vertical list: done phases with who/when and
 * their proofs, the current phase open with its proofs and "Concluir", the next ones with their
 * cure waits. Hardwood keeps Instalação / Lixa on the job status, so the tab stays hidden there.
 *
 * Without signal (bathrooms often have none): the last copy of the phases opens from the phone
 * (OmOffline), and proofs, photos and "Concluir" are saved on the phone, shown as "aguardando
 * sinal" and sent in order when the signal comes back, with the time they were done.
 */
(function () {
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const CSS_ID = "jobPhasesCss";
  const DAY = 86400000;

  async function api(url, opts) {
    const r = await fetch(url, { credentials: "include", headers: { "Content-Type": "application/json", Accept: "application/json" }, ...(opts || {}) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.success === false) {
      const e = new Error(j.error || "Não foi possível concluir.");
      e.code = j.code;
      e.status = r.status;
      throw e;
    }
    return j.data;
  }

  const OFF = () => window.OmOffline || null;
  const online = () => navigator.onLine !== false;

  /** Phases: from the server, or the phone's last copy when there is no signal. */
  async function load(url) {
    const O = OFF();
    if (!O) return { data: await api(url), savedAt: null };
    const j = await O.api(url, { method: "GET", allowQueue: false });
    if (j && j.success === false) throw new Error(j.error || "Não foi possível abrir as fases.");
    return { data: j.data, savedAt: j.fromCache ? j.savedAt || null : null };
  }

  /** Keep the phone's copy in step with what the crew did offline (so a reload shows it). */
  function saveCopy(url, d) {
    const O = OFF();
    if (O && O.putSnapshot) O.putSnapshot(url, { success: true, data: d }).catch(() => {});
  }

  /** The server's rules, applied on the phone while the action waits for signal. */
  const local = {
    evidence(d, phase, req, body, at) {
      const p = d.phases.find((x) => x.key === phase);
      const r = p && p.requires.find((x) => x.key === req);
      if (!r) return;
      r.done = true;
      r.pending = true;
      r.at = at;
      r.by = "Você";
      r.value = body.value ?? (body.photo ? null : r.value);
      if (body.photo) r.photo = { id: null, url: body.photo.data_url, thumb_url: body.photo.data_url };
    },
    complete(d, phase, at) {
      const i = d.phases.findIndex((x) => x.key === phase);
      const p = d.phases[i];
      if (!p) return;
      p.status = "done";
      p.pending = true;
      p.done_at = at;
      p.done_by_name = "Você";
      const next = d.phases.slice(i + 1).find((x) => x.status !== "skipped");
      if (next) next.ready_at = new Date(new Date(at).getTime() + (p.wait_after_hours || 0) * 3600000).toISOString();
    },
  };
  const isNetworkError = (e) => !e || e.status == null;

  function ensureCss() {
    if (document.getElementById(CSS_ID)) return;
    const l = document.createElement("link");
    l.id = CSS_ID;
    l.rel = "stylesheet";
    l.href = "/job-phases.css?v=20261106-nr1";
    document.head.appendChild(l);
  }

  /** Only trades whose phases live per job (not Hardwood's job status). */
  function available() {
    const t = window.__OM_TRADE;
    return Boolean(t && t.phaseStorage === "table" && Array.isArray(t.jobPhases) && t.jobPhases.length);
  }

  function dayLabel(d, now) {
    const start = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const diff = Math.round((start(d) - start(now)) / DAY);
    const time = d.toLocaleTimeString("pt-BR", { hour: "numeric", minute: "2-digit" });
    if (diff === 0) return `Hoje ${time}`;
    if (diff === 1) return `Amanhã ${time}`;
    if (diff === -1) return `Ontem ${time}`;
    const day = d.toLocaleDateString("pt-BR", { weekday: "short", day: "numeric", month: "short" }).replace(/\./g, "");
    return `${day.charAt(0).toUpperCase()}${day.slice(1)} · ${time}`;
  }

  const dateOnly = (d) => {
    const t = d.toLocaleDateString("pt-BR", { weekday: "short", day: "numeric", month: "short" }).replace(/\./g, "");
    return t.charAt(0).toUpperCase() + t.slice(1);
  };
  /**
   * Shop lead time (Countertops install): "A partir de Qui 12 nov" once the layout is approved,
   * and a warning when the job is on the calendar before that. It does not block.
   */
  function leadLine(p, d) {
    const lt = p.lead_time;
    if (!lt) return "";
    const after = esc(String(lt.after_label || "").toLowerCase());
    if (!lt.earliest_at) return `Pelo menos ${lt.business_days} dias úteis depois de ${after}`;
    const earliest = new Date(lt.earliest_at);
    let out = `A partir de ${esc(dateOnly(earliest))} · ${lt.business_days} dias úteis depois de ${after}`;
    const when = p.scheduled_start || d.scheduled_start;
    if (when) {
      const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
      const w = new Date(when);
      if (day(w) < day(earliest)) out += ` <span class="jp-warn">Agendado para ${esc(dateOnly(w))}, antes do prazo da oficina</span>`;
    }
    return out;
  }

  function left(ms) {
    const h = Math.ceil(ms / 3600000);
    if (h < 1) return "falta menos de 1 h";
    if (h < 48) return `faltam ${h} h`;
    return `faltam ${Math.ceil(h / 24)} dias`;
  }

  /** Short text for a recorded proof (photos show as a thumbnail instead). */
  function valueText(r) {
    const v = r.value;
    if (r.key === "flood_result" && v && typeof v === "object") {
      const bits = [];
      if (v.depth_in != null && v.depth_in !== "") bits.push(`${v.depth_in}" de água`);
      if (v.hours != null && v.hours !== "") bits.push(`${v.hours} h`);
      bits.push(v.passed === false ? "vazou" : "sem vazamento");
      return bits.join(" · ");
    }
    if (v && typeof v === "object" && v.text) return String(v.text);
    if (v && typeof v === "object" && v.per_10ft_in != null) return `${v.per_10ft_in}" em 10 ft`;
    if (typeof v === "string" && v) return v;
    if (r.kind === "checklist" || r.kind === "signature") return "Conferido";
    return "";
  }

  const failed = (p) => p.requires.some((r) => r.value && typeof r.value === "object" && r.value.passed === false);

  /** Phases shown: a variant's phases (Tile: natural stone) only while the variant is on. */
  const shown = (d) => d.phases.filter((p) => !(p.variant && p.status === "skipped"));

  /** Which phase is open, and is it waiting for the previous phase's cure. */
  function shape(d0, now) {
    const d = { ...d0, phases: shown(d0) };
    const cur = d.phases.find((p) => p.status !== "done" && p.status !== "skipped") || null;
    const readyAt = cur && cur.ready_at ? new Date(cur.ready_at) : null;
    const waiting = Boolean(readyAt && readyAt.getTime() > now.getTime());
    const done = d.phases.filter((p) => p.status === "done" || p.status === "skipped").length;
    return { cur, readyAt, waiting, done, total: d.phases.length };
  }

  function chip(r) {
    if (r.photo) {
      return `<a class="jp-thumb" href="${esc(r.photo.url)}" target="_blank" rel="noopener" title="${esc(r.label)}"><img src="${esc(r.photo.thumb_url)}" alt="${esc(r.label)}" loading="lazy" /></a>`;
    }
    const t = valueText(r);
    return `<span class="jp-chip${r.value && r.value.passed === false ? " is-bad" : ""}">✓ ${esc(r.label)}${t ? `<small> · ${esc(t)}</small>` : ""}</span>`;
  }

  function reqForm(p, r) {
    if (r.key === "flood_result") {
      return `<form class="jp-form" data-req-form="${esc(r.key)}" data-phase="${esc(p.key)}">
        <label>Altura da água <span><input name="depth_in" inputmode="decimal" placeholder="2" required /> pol</span></label>
        <label>Duração <span><input name="hours" inputmode="decimal" placeholder="24" required /> h</span></label>
        <label>Resultado <select name="passed"><option value="yes">Sem vazamento</option><option value="no">Vazou</option></select></label>
        <div class="jp-form__acts"><button type="button" class="jp-b" data-req-cancel>Cancelar</button><button type="submit" class="jp-b jp-b--ink">Salvar</button></div>
      </form>`;
    }
    const hint = r.key === "flatness" ? 'Ex.: 1/8" em 10 ft' : r.key === "sealer" ? "Ex.: selante penetrante, 2 demãos" : "Resultado";
    return `<form class="jp-form" data-req-form="${esc(r.key)}" data-phase="${esc(p.key)}">
      <label class="jp-form__wide">${esc(r.label)} <input name="text" placeholder="${esc(hint)}" required /></label>
      <div class="jp-form__acts"><button type="button" class="jp-b" data-req-cancel>Cancelar</button><button type="submit" class="jp-b jp-b--ink">Salvar</button></div>
    </form>`;
  }

  function reqRow(p, r, st) {
    const action = r.kind === "photo" ? "Adicionar foto" : r.kind === "test" ? "Registrar" : "Confirmar";
    const open = st.editing === `${p.key}:${r.key}`;
    const wait = r.pending ? ' <span class="jp-wait">aguardando sinal</span>' : "";
    const doneLine = r.done ? (r.photo ? `${chip(r)}${wait}` : `<small class="jp-req__val">${esc(valueText(r) || "Registrado")}${r.by ? ` · ${esc(r.by)}` : ""}</small>${wait}`) : "";
    const btn = st.canAct
      ? `<button type="button" class="jp-b" data-req="${esc(r.key)}" data-kind="${esc(r.kind)}" data-phase="${esc(p.key)}" ${st.busy ? "disabled" : ""}>${r.done ? (r.kind === "photo" ? "Trocar foto" : "Refazer") : action}</button>`
      : "";
    return `<div class="jp-req${r.done ? " is-ok" : ""}">
      <span class="jp-req__box" aria-hidden="true">${r.done ? "✓" : ""}</span>
      <div class="jp-req__t">${esc(r.label)}${doneLine ? `<div>${doneLine}</div>` : ""}</div>
      ${open ? "" : btn}
    </div>${open ? reqForm(p, r) : ""}`;
  }

  function currentBox(p, s, d, st) {
    const missing = p.requires.filter((r) => !r.done).length;
    const bad = failed(p);
    const can = !s.waiting && !missing && !bad;
    // While waiting, the line above already says until when.
    const why = s.waiting
      ? ""
      : bad
        ? "O teste falhou: corrija e registre de novo"
        : missing
          ? `Falta${missing > 1 ? "m" : ""} ${missing} prova${missing > 1 ? "s" : ""}`
          : "";
    const bg = d.builder_gate && d.builder_gate.phase === p.key && st.canAct ? d.builder_gate : null;
    return `<div class="jp-cur">
      ${p.requires.map((r) => reqRow(p, r, st)).join("")}
      ${bg ? `<div class="jp-nr"><button type="button" class="jp-link" data-not-ready ${st.busy ? "disabled" : ""}>Obra não estava pronta</button><span class="jp-s">${bg.builder_job ? "Avisa a construtora e pede nova confirmação" : "Desfaz a conferência"}${bg.can_charge ? " · cobra a viagem perdida" : ""}</span></div>` : ""}
      <div class="jp-cur__foot">
        ${s.waiting && d.can_force && st.canAct ? `<button type="button" class="jp-link" data-force="${esc(p.key)}" ${st.busy ? "disabled" : ""}>Liberar a espera (escritório)</button>` : `<span class="jp-why">${why}</span>`}
        ${st.canAct ? `<button type="button" class="jp-b jp-b--pri" data-complete="${esc(p.key)}" ${can && !st.busy ? "" : "disabled"}>Concluir fase</button>` : ""}
      </div>
    </div>`;
  }

  function row(p, i, d, s, st) {
    const isCur = s.cur && s.cur.key === p.key;
    const isDone = p.status === "done" || p.status === "skipped";
    const cls = isDone ? "is-done" : isCur ? (s.waiting ? "is-wait" : "is-cur") : "is-todo";
    const dot = isDone ? "✓" : isCur && s.waiting ? "◷" : String(i + 1);
    const next = d.phases[i + 1];
    let sub = "";
    let right = "";
    if (isDone) {
      const at = p.done_at ? dayLabel(new Date(p.done_at), st.now) : "";
      sub = [p.status === "skipped" ? "Pulada" : at, p.done_by_name].filter(Boolean).map(esc).join(" · ");
      if (p.pending) sub += ' · <span class="jp-wait">aguardando sinal</span>';
      if (p.wait_after_hours && next) sub += ` · depois ${p.wait_after_hours} h de cura`;
    } else if (isCur) {
      const lead = leadLine(p, d);
      sub = s.waiting
        ? `Em cura até ${esc(dayLabel(s.readyAt, st.now))} · depois registre as provas e conclua`
        : p.requires.length
          ? "Registre as provas e conclua"
          : "Pronta para concluir";
      if (lead) sub = `${lead} · ${sub}`;
      if (s.waiting) {
        const l = esc(left(s.readyAt.getTime() - st.now.getTime()));
        right = `<span class="jp-left">${l}</span>`;
        sub = `<b class="jp-left jp-left--inline">${l} · </b>${sub}`;
      }
    } else if (p.lead_time) {
      sub = leadLine(p, d);
    } else if (p.wait_after_hours && next) {
      sub = `Depois: ${p.wait_after_hours} h de cura antes de ${esc(next.label.toLowerCase())}`;
    } else if (p.requires.length) {
      sub = `Pede: ${p.requires.map((r) => esc(r.label.toLowerCase())).join(", ")}`;
    }
    const proofs = isDone ? p.requires.filter((r) => r.at || r.photo).map(chip).join("") : "";
    return `<li class="${cls}">
      <span class="jp-dot" aria-hidden="true">${dot}</span>
      <div class="jp-body">
        <div class="jp-t">${esc(p.label)}</div>
        ${sub ? `<div class="jp-s">${sub}</div>` : ""}
        ${proofs ? `<div class="jp-proofs">${proofs}</div>` : ""}
        ${isCur ? currentBox(p, s, d, st) : ""}
      </div>
      ${right}
    </li>`;
  }

  function sideCard(d) {
    const got = [];
    const miss = [];
    d.phases.forEach((p) => p.requires.forEach((r) => (r.at || r.photo ? got.push(r) : !r.done ? miss.push(r) : null)));
    return `<div class="jd-card jp-side">
      <div class="jd-ch"><h2>Provas</h2><span class="jp-n">${got.length}</span></div>
      <p class="jp-s">Ficam registradas no job, com data e quem fez.</p>
      ${got.length ? `<div class="jp-proofs">${got.map(chip).join("")}</div>` : '<p class="jd-empty">Nenhuma prova ainda.</p>'}
      ${miss.length ? `<p class="jp-s jp-side__miss">Faltam: ${miss.map((r) => esc(r.label.toLowerCase())).join(", ")}.</p>` : ""}
    </div>`;
  }

  const fmtMoney = (n) => `$${Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  /**
   * Pieces made again (Countertops remakes): which piece, why, on whom, and the cost (office only).
   * The crew can record one from the ticket; the office sets the cost and removes mistakes.
   */
  function reworkCard(d, st) {
    const rw = d.reworks;
    if (!rw) return "";
    const office = rw.can_manage;
    // Money (cost of each remake, the total, the cost field) only for people who see prices.
    const money = rw.can_cost !== undefined ? Boolean(rw.can_cost) : office;
    const items = rw.items
      .map(
        (r) => `<li class="jp-rw__i">
          <div><b>${esc(r.piece)}</b><small>${esc(r.reason_label)} · ${esc(r.responsible_label)}${r.phase_label ? ` · ${esc(r.phase_label)}` : ""}</small>
          ${r.notes ? `<small class="jp-rw__note">${esc(r.notes)}</small>` : ""}${r.photo ? `<a class="jp-rw__img" href="${esc(r.photo.url)}" target="_blank" rel="noopener"><img src="${esc(r.photo.thumb_url)}" alt="Foto da peça ${esc(r.piece)}" loading="lazy" /></a>` : ""}<small class="jp-rw__by">${esc(r.by || "")}${r.by ? " · " : ""}${esc(dayLabel(new Date(r.at), st.now))}</small></div>
          ${office ? `<div class="jp-rw__side">${money ? (r.cost != null ? `<b translate="no">${fmtMoney(r.cost)}</b>` : '<span class="jp-rw__nocost">sem custo</span>') : ""}<button type="button" class="jp-link" data-rw-del="${esc(r.id)}" ${st.busy ? "disabled" : ""}>Remover</button></div>` : ""}
        </li>`,
      )
      .join("");
    // What was typed survives a redraw (a photo picked, the signal coming back…).
    const dr = st.rwDraft || {};
    const opts = (list, v) => list.map((o) => `<option value="${esc(o.key)}" ${v === o.key ? "selected" : ""}>${esc(o.label)}</option>`).join("");
    const cur = d.phases.find((p) => p.status !== "done" && p.status !== "skipped");
    const ph = dr.phase_key !== undefined ? dr.phase_key : cur ? cur.key : "";
    const phaseOpts = `<option value="">—</option>${d.phases.map((p) => `<option value="${esc(p.key)}" ${ph === p.key ? "selected" : ""}>${esc(p.label)}</option>`).join("")}`;
    const form = st.rework
      ? `<form class="jp-rw__form" data-rw-form>
          <label><span>Peça</span><input name="piece" required maxlength="120" placeholder="Ilha, bancada da pia…" value="${esc(dr.piece || "")}" /></label>
          <label><span>Motivo</span><select name="reason" required>${opts(rw.reasons, dr.reason)}</select></label>
          <label><span>Responsável</span><select name="responsible" required>${opts(rw.responsible, dr.responsible)}</select></label>
          <label><span>Fase</span><select name="phase_key">${phaseOpts}</select></label>
          ${money ? `<label><span>Custo (slab, mão de obra, viagem)</span><input name="cost" type="number" inputmode="decimal" min="0" step="0.01" placeholder="0.00" value="${esc(dr.cost || "")}" /></label>` : ""}
          <label class="jp-rw__wide"><span>Observação</span><input name="notes" maxlength="1000" placeholder="O que aconteceu" value="${esc(dr.notes || "")}" /></label>
          <div class="jp-rw__wide jp-rw__ph">${
            st.rwPhoto
              ? `<img src="${esc(st.rwPhoto.data_url)}" alt="Foto da peça" /><button type="button" class="jp-link" data-rw-photo-x>Tirar foto</button>`
              : `<button type="button" class="jp-b" data-rw-photo>Foto da peça</button><small>Ajuda a cobrar do fornecedor ou da transportadora.</small>`
          }</div>
          <div class="jp-rw__act"><button type="submit" class="jp-b jp-b--pri" ${st.busy ? "disabled" : ""}>Registrar</button><button type="button" class="jp-link" data-rw-cancel>Cancelar</button></div>
        </form>`
      : `<button type="button" class="jp-link jp-rw__add" data-rw-open ${st.canAct ? "" : "hidden"}>+ Registrar peça refeita</button>`;
    return `<div class="jd-card jp-rw">
      <div class="jd-ch"><h2>Peças refeitas</h2><span class="jp-n" translate="no" data-no-i18n>${rw.items.length}</span></div>
      ${money && rw.items.length ? `<p class="jp-s">Custo total: <b translate="no">${fmtMoney(rw.total_cost)}</b></p>` : '<p class="jp-s">Quando uma peça precisa ser feita de novo: o motivo e quem responde por ela.</p>'}
      ${rw.items.length ? `<ul class="jp-rw__list">${items}</ul>` : ""}
      ${form}
    </div>`;
  }

  /** The app's confirm sheet (crm-confirm.js, loaded on the job page and the crew ticket). Without it nothing happens. */
  function ask(opts) {
    if (window.crmConfirm) return window.crmConfirm(opts);
    window.crmToast?.error?.("Atualize a página e tente de novo.");
    return Promise.resolve(false);
  }

  /**
   * The job's slab (Countertops yard): the stone held for it and, after Fabricação, used on it.
   * The office reserves in Slabs (opened with this job first) and can release from here.
   */
  function slabCard(d, st, jobId) {
    const sb = d.slabs;
    if (!sb) return "";
    const n = (v) => (Math.round(Number(v) * 10) / 10).toLocaleString("pt-BR");
    const label = { reserved: "Reservado", used: "Usado", available: "Livre", scrapped: "Descartado" };
    const items = sb.items
      .map(
        (s) => `<li class="jp-rw__i jp-sl__i">
          ${s.photo_url ? `<a class="jp-sl__img" href="${esc(s.photo_url)}" target="_blank" rel="noopener"><img src="${esc(s.photo_url)}" alt="Foto do slab ${esc(s.color)}" loading="lazy" /></a>` : '<span class="jp-sl__img jp-sl__img--none" aria-hidden="true"></span>'}
          <div class="jp-sl__txt"><b>${esc(s.color)}${s.kind === "remnant" ? " · sobra" : ""}</b><small>${esc(s.material_label)} · ${esc(s.thickness_cm)} cm · ${n(s.length_in)}″ × ${n(s.width_in)}″</small>
          <small>${esc([s.serial, s.location].filter(Boolean).join(" · ") || "Sem lote")}</small></div>
          <div class="jp-rw__side"><span class="jp-sl__st jp-sl__st--${esc(s.status)}">${esc(label[s.status] || s.status)}</span>${sb.can_manage && st.canAct && s.status === "reserved" ? `<button type="button" class="jp-link" data-sl-release="${esc(s.id)}" ${st.busy ? "disabled" : ""}>Liberar</button>` : ""}</div>
        </li>`,
      )
      .join("");
    const add = sb.can_manage && st.canAct ? `<a class="jp-link jp-rw__add" href="/slabs.html?job=${encodeURIComponent(jobId)}">${sb.items.length ? "+ Outro slab" : "Reservar slab"}</a>` : "";
    return `<div class="jd-card jp-rw jp-sl">
      <div class="jd-ch"><h2>Slab do job</h2><span class="jp-n" translate="no" data-no-i18n>${sb.items.length}</span></div>
      ${sb.items.length ? `<ul class="jp-rw__list">${items}</ul>` : `<p class="jp-s">${sb.can_manage ? "Reserve no pátio a pedra que o cliente escolheu. Na Fabricação ela passa a usada." : "O escritório reserva a pedra no pátio."}</p>`}
      ${add}
    </div>`;
  }

  /** Job variants (Tile: "Pedra natural"): the office switches them; the crew sees which are on. */
  function variantsBar(d, st) {
    const list = Array.isArray(d.variants) ? d.variants : [];
    if (!list.length) return "";
    const office = d.can_force && st.canAct;
    const items = list
      .map((v) =>
        office
          ? `<button type="button" class="jp-var${v.on ? " is-on" : ""}" data-variant="${esc(v.key)}" aria-pressed="${v.on}" ${st.busy ? "disabled" : ""}><span class="jp-var__box" aria-hidden="true">${v.on ? "✓" : ""}</span>${esc(v.label)}</button>`
          : v.on
            ? `<span class="jp-var is-on is-static">${esc(v.label)}</span>`
            : "",
      )
      .join("");
    if (!items) return "";
    return `<div class="jp-vars">${items}${office ? `<small>${list.some((v) => v.on) ? "Inclui recebimento, dry-lay e selagem da pedra." : "Ligue se o job tem mármore, travertino, ardósia…"}</small>` : ""}</div>`;
  }

  function render(box, d0, st) {
    const d = { ...d0, phases: shown(d0) };
    const s = shape(d, st.now);
    const pending = d.phases.some((p) => p.pending || p.requires.some((r) => r.pending));
    const off = st.savedAt || !online() || pending
      ? `<p class="jp-off">${!online() ? `Sem internet${st.savedAt ? ` · fases salvas ${esc(dayLabel(new Date(st.savedAt), st.now).toLowerCase())}` : ""}. ` : ""}${pending ? "O que você registrar fica no celular e é enviado quando o sinal voltar." : !online() ? "Pode registrar as provas: elas ficam no celular até o sinal voltar." : ""}</p>`
      : "";
    const list = `<div class="jd-card">${off}
      <div class="jd-ch"><h2>Fases do job</h2><span class="jp-n" translate="no" data-no-i18n>${s.done} de ${s.total}</span></div>
      ${variantsBar(d0, st)}
      <ol class="jp-tl">${d.phases.map((p, i) => row(p, i, d, s, st)).join("")}</ol>
      ${!s.cur ? '<p class="jp-all">Todas as fases concluídas.</p>' : ""}
    </div>`;
    box.innerHTML = st.compact
      ? `<div class="jp jp--compact">${list}${slabCard(d, st, st.jobId)}${reworkCard(d, st)}</div>`
      : `<div class="jd-grid jp"><div class="jd-col">${list}</div><aside class="jd-col jd-side">${sideCard(d)}${slabCard(d, st, st.jobId)}${reworkCard(d, st)}</aside></div>`;
  }

  function compressImage(file, maxEdge, quality) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        try {
          const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
          const canvas = document.createElement("canvas");
          canvas.width = Math.round(img.width * scale);
          canvas.height = Math.round(img.height * scale);
          canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
          URL.revokeObjectURL(url);
          resolve(canvas.toDataURL("image/jpeg", quality));
        } catch (e) {
          URL.revokeObjectURL(url);
          reject(e);
        }
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("Não foi possível ler a imagem. Use JPG ou PNG."));
      };
      img.src = url;
    });
  }

  function pickPhoto() {
    return new Promise((resolve) => {
      const inp = document.createElement("input");
      inp.type = "file";
      inp.accept = "image/*";
      inp.setAttribute("capture", "environment");
      inp.style.display = "none";
      inp.addEventListener("change", () => {
        resolve(inp.files && inp.files[0] ? inp.files[0] : null);
        inp.remove();
      });
      document.body.appendChild(inp);
      inp.click();
    });
  }

  /** "3/7" on the tab (job page: #jdTabFases; field ticket: [data-phases-badge]). */
  function badge(d) {
    if (!d) return;
    const s = shape(d, new Date());
    document.querySelectorAll("#jdTabFases, [data-phases-badge]").forEach((el) => (el.textContent = `${s.done}/${s.total}`));
  }

  async function summary(jobId) {
    if (!available()) return null;
    try {
      const { data: d } = await load(`/api/work-orders/${encodeURIComponent(jobId)}/phases`);
      badge(d);
      return d;
    } catch (_) {
      return null;
    }
  }

  /**
   * ctx: { jobId, notify, compact, canAct (default true), address, deviceLabel, onChange(data) }
   */
  function mount(box, ctx) {
    if (!box) return;
    ensureCss();
    const notify = ctx.notify || ((m) => console.warn(m));
    const st = { now: new Date(), compact: Boolean(ctx.compact), canAct: ctx.canAct !== false, busy: false, editing: null, savedAt: null, jobId: ctx.jobId };
    let data = null;
    const base = `/api/work-orders/${encodeURIComponent(ctx.jobId)}/phases`;
    const paint = () => {
      st.now = new Date();
      const f = box.querySelector("[data-rw-form]");
      if (f) st.rwDraft = Object.fromEntries(new FormData(f).entries());
      if (data) render(box, data, st);
    };
    const took = (d, msg) => {
      data = d;
      saveCopy(base, d);
      st.editing = null;
      badge(d);
      if (msg) notify(msg, "success");
      if (ctx.onChange) ctx.onChange(d);
    };
    const run = async (fn) => {
      if (st.busy) return;
      st.busy = true;
      paint();
      try {
        await fn();
      } catch (e) {
        notify(e.message || "Não foi possível concluir.", "error");
      } finally {
        st.busy = false;
        paint();
      }
    };
    /**
     * Send an action; without signal (or when the request can't get out), keep it on the phone,
     * apply it to the screen and the phone's copy, and send it later in order.
     */
    const send = async (url, body, label, applyLocal) => {
      const at = new Date().toISOString();
      const O = OFF();
      // Something of this job still waiting to go: this action waits behind it, so the order holds.
      const behind = O && O.list ? (await O.list().catch(() => [])).some((m) => String(m.url || "").startsWith(base)) : false;
      if ((online() && !behind) || !O) {
        try {
          return { data: await api(url, { method: "POST", body: JSON.stringify(body) }) };
        } catch (e) {
          if (!O || !isNetworkError(e)) throw e;
        }
      }
      await O.queue({ url, method: "POST", body: JSON.stringify({ ...body, at }), label, dropOn4xx: true });
      const d = JSON.parse(JSON.stringify(data));
      applyLocal(d, at);
      if (online() && O.flush) setTimeout(() => O.flush().catch(() => {}), 50);
      return { data: d, queued: true };
    };
    const evidence = (phase, req, body, label) =>
      send(`${base}/${encodeURIComponent(phase)}/evidence/${encodeURIComponent(req)}`, body, label, (d, at) => local.evidence(d, phase, req, body, at));
    const complete = (phase, body) =>
      send(`${base}/${encodeURIComponent(phase)}/complete`, body, `Concluir ${phaseLabel(phase)}`, (d, at) => local.complete(d, phase, at));
    const phaseLabel = (key) => ((data && data.phases.find((p) => p.key === key)) || { label: key }).label.toLowerCase();
    const reqLabel = (phase, key) => {
      const p = data && data.phases.find((x) => x.key === phase);
      const r = p && p.requires.find((x) => x.key === key);
      return r ? r.label : key;
    };
    const say = (out, msg) => took(out.data, out.queued ? "Sem sinal: ficou salvo no celular e vai quando o sinal voltar." : msg);
    // Back online: the queue sends what waited; then read the phases again from the server.
    const refresh = () =>
      load(base)
        .then((r) => {
          st.savedAt = r.savedAt;
          took(r.data);
          paint();
        })
        .catch(() => {});
    if (OFF() && !box.__jpWired) {
      box.__jpWired = true;
      let was = null;
      OFF().onChange((s) => {
        if (s.online && s.pending === 0 && was && (was.pending > 0 || !was.online)) refresh();
        else paint();
        was = s;
      });
      window.addEventListener("om-offline-dropped", (e) => {
        if (e.detail && String(e.detail.url || "").startsWith(base)) refresh();
      });
    }

    const note = (t) => `<div class="jp${st.compact ? " jp--compact" : ""}"><div class="jd-card"><p class="jd-empty">${esc(t)}</p></div></div>`;
    box.innerHTML = note("A carregar fases…");
    load(base)
      .then((r) => {
        st.savedAt = r.savedAt;
        took(r.data);
        paint();
      })
      .catch((e) => (box.innerHTML = note(!online() ? "Sem internet e sem cópia das fases neste celular. Abra as fases uma vez com sinal para usar sem internet." : e.message)));

    box.onclick = (e) => {
      if (e.target.closest("[data-not-ready]")) {
        if (!online()) return notify("Precisa de internet para avisar a construtora.", "error");
        const bg = data && data.builder_gate;
        if (!bg) return;
        const askText = window.crmPrompt;
        if (!askText) return notify("Atualize a página e tente de novo.", "error");
        askText({
          title: "Obra não estava pronta",
          text: [
            bg.builder_job ? "A construtora recebe uma mensagem e precisa confirmar de novo no ObraBuilder." : "A conferência desta fase é desfeita.",
            bg.can_charge ? `\u201c${bg.trip_service}\u201d entra no job com o preço da Tabela de Valores.` : bg.trip_service ? "O escritório decide se cobra a viagem perdida." : "",
          ].filter(Boolean).join(" "),
          label: "O que faltava?",
          placeholder: bg.visit === "tile" ? "Ex.: registro do chuveiro fora da altura, parede sem placa" : "Ex.: cabinets da ilha sem nivelar, pia não chegou",
          type: "textarea",
          ok: "Registrar",
          cancel: "Voltar",
        }).then((note) => {
          if (note === null || note === undefined) return;
          run(async () => {
            const r = await api(`${base}/site-not-ready`, { method: "POST", body: JSON.stringify({ note: String(note || "").trim() }) });
            const unpriced = r && r.charged && !(Number(r.charged.amount) > 0);
            took(r, (bg.builder_job ? "Registrado. A construtora foi avisada." : "Registrado.") + (unpriced ? " A viagem perdida entrou no job sem preço: defina o valor no job e na Tabela de Valores." : ""));
          });
        });
        return;
      }
      const req = e.target.closest("[data-req]");
      if (req) {
        const phase = req.getAttribute("data-phase");
        const key = req.getAttribute("data-req");
        const kind = req.getAttribute("data-kind");
        if (kind === "photo") {
          pickPhoto().then((file) => {
            if (!file) return;
            const type = String(file.type || "").toLowerCase();
            if (type.includes("heic") || type.includes("heif")) return notify("Foto HEIC não suportada — exporte como JPG.", "error");
            run(async () => {
              // One request saves the photo to the job's ObraCam and links it (office and crew).
              const dataUrl = await compressImage(file, 1600, 0.72);
              const photo = {
                data_url: dataUrl,
                taken_at_device: new Date(file.lastModified || Date.now()).toISOString(),
                address: ctx.address || null,
                client_upload_id: window.crypto?.randomUUID ? crypto.randomUUID() : `phase-${Date.now()}-${Math.random().toString(16).slice(2)}`,
                device_label: ctx.deviceLabel || "Office web",
              };
              say(await evidence(phase, key, { photo }, `Foto: ${reqLabel(phase, key)}`), "Foto registrada.");
            });
          });
          return;
        }
        if (kind === "test") {
          st.editing = `${phase}:${key}`;
          paint();
          box.querySelector(`[data-req-form="${key}"] input`)?.focus();
          return;
        }
        run(async () => say(await evidence(phase, key, { value: { confirmed: true } }, reqLabel(phase, key)), "Conferido."));
        return;
      }
      const rel = e.target.closest("[data-sl-release]");
      if (rel) {
        if (!online()) return notify("Liberar o slab precisa de internet.", "error");
        const id = rel.getAttribute("data-sl-release");
        run(async () => {
          await api(`/api/slabs/${encodeURIComponent(id)}/release`, { method: "POST", body: "{}" });
          took(await api(base), "Slab liberado.");
        });
        return;
      }
      if (e.target.closest("[data-rw-open]")) {
        st.rework = true;
        st.rwDraft = null;
        st.rwPhoto = null;
        paint();
        box.querySelector("[data-rw-form] input[name=piece]")?.focus();
        return;
      }
      if (e.target.closest("[data-rw-cancel]")) {
        st.rework = false;
        paint();
        st.rwDraft = null;
        st.rwPhoto = null;
        return;
      }
      if (e.target.closest("[data-rw-photo-x]")) {
        st.rwPhoto = null;
        paint();
        return;
      }
      if (e.target.closest("[data-rw-photo]")) {
        pickPhoto().then(async (file) => {
          if (!file) return;
          const type = String(file.type || "").toLowerCase();
          if (type.includes("heic") || type.includes("heif")) return notify("Foto HEIC não suportada — exporte como JPG.", "error");
          st.rwPhoto = {
            data_url: await compressImage(file, 1600, 0.72),
            taken_at_device: new Date(file.lastModified || Date.now()).toISOString(),
            address: ctx.address || null,
            client_upload_id: window.crypto?.randomUUID ? crypto.randomUUID() : `rw-${Date.now()}-${Math.random().toString(16).slice(2)}`,
            device_label: ctx.deviceLabel || "Office web",
          };
          paint();
        });
        return;
      }
      const del = e.target.closest("[data-rw-del]");
      if (del) {
        if (!online()) return notify("Remover precisa de internet.", "error");
        const id = del.getAttribute("data-rw-del");
        const ok = ask({ title: "Remover este registro?", text: "Use só para um registro feito por engano.", ok: "Remover", danger: true });
        Promise.resolve(ok).then((yes) => {
          if (yes) run(async () => took(await api(`/api/work-orders/${encodeURIComponent(ctx.jobId)}/reworks/${encodeURIComponent(id)}`, { method: "DELETE" }), "Registro removido."));
        });
        return;
      }
      if (e.target.closest("[data-req-cancel]")) {
        st.editing = null;
        paint();
        return;
      }
      const vb = e.target.closest("[data-variant]");
      if (vb) {
        if (!online()) return notify("Mudar o tipo do job precisa de internet.", "error");
        const key = vb.getAttribute("data-variant");
        const cur = (data.variants || []).find((v) => v.key === key);
        run(async () => took(await api(`${base}/variant`, { method: "POST", body: JSON.stringify({ variant: key, on: !(cur && cur.on) }) }), cur && cur.on ? "Fases de pedra retiradas." : "Fases de pedra incluídas."));
        return;
      }
      const force = e.target.closest("[data-force]");
      if (force) {
        const phase = force.getAttribute("data-force");
        const ok = ask({ title: "Liberar a espera?", text: "A cura ainda não terminou. Conclua só se tiver certeza de que o material já curou.", ok: "Liberar e concluir" });
        Promise.resolve(ok).then((yes) => {
          if (yes) run(async () => say(await complete(phase, { force: true }), "Fase concluída."));
        });
        return;
      }
      const done = e.target.closest("[data-complete]");
      if (done) {
        const phase = done.getAttribute("data-complete");
        run(async () => say(await complete(phase, {}), "Fase concluída."));
      }
    };
    box.onsubmit = (e) => {
      const rw = e.target.closest("[data-rw-form]");
      if (rw) {
        e.preventDefault();
        if (!online()) return notify("Registrar peça refeita precisa de internet.", "error");
        const fd = new FormData(rw);
        const cost = String(fd.get("cost") || "").replace(",", ".").trim();
        const body = {
          piece: String(fd.get("piece") || "").trim(),
          reason: String(fd.get("reason") || ""),
          responsible: String(fd.get("responsible") || ""),
          phase_key: String(fd.get("phase_key") || "") || null,
          notes: String(fd.get("notes") || "").trim() || null,
          ...(cost ? { cost: Number(cost) } : {}),
          ...(st.rwPhoto ? { photo: st.rwPhoto } : {}),
        };
        run(async () => {
          const d = await api(`/api/work-orders/${encodeURIComponent(ctx.jobId)}/reworks`, { method: "POST", body: JSON.stringify(body) });
          st.rework = false;
          st.rwPhoto = null;
          st.rwDraft = null;
          took(d, "Peça refeita registrada.");
        });
        return;
      }
      const f = e.target.closest("[data-req-form]");
      if (!f) return;
      e.preventDefault();
      const key = f.getAttribute("data-req-form");
      const phase = f.getAttribute("data-phase");
      const fd = new FormData(f);
      const value =
        key === "flood_result"
          ? { depth_in: Number(String(fd.get("depth_in")).replace(",", ".")) || String(fd.get("depth_in")), hours: Number(String(fd.get("hours")).replace(",", ".")) || String(fd.get("hours")), passed: fd.get("passed") !== "no" }
          : { text: String(fd.get("text") || "").trim() };
      run(async () => say(await evidence(phase, key, { value }, reqLabel(phase, key)), "Resultado registrado."));
    };
  }

  window.JobPhases = { available, summary, mount, _test: { shape, valueText, dayLabel, left, local } };
})();
