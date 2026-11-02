/**
 * Job page › Fases: the job's phases for trades that keep them per job (Tile: site ready, prep,
 * waterproofing, flood test, setting, grout, seal). One vertical list: done phases with who/when and
 * their proofs, the current phase open with its proofs and "Concluir", the next ones with their
 * cure waits. Hardwood keeps Instalação / Lixa on the job status, so the tab stays hidden there.
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
      throw e;
    }
    return j.data;
  }

  function ensureCss() {
    if (document.getElementById(CSS_ID)) return;
    const l = document.createElement("link");
    l.id = CSS_ID;
    l.rel = "stylesheet";
    l.href = "job-phases.css?v=20261102-fases1";
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

  /** Which phase is open, and is it waiting for the previous phase's cure. */
  function shape(d, now) {
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
    const hint = r.key === "flatness" ? 'Ex.: 1/8" em 10 ft' : "Resultado";
    return `<form class="jp-form" data-req-form="${esc(r.key)}" data-phase="${esc(p.key)}">
      <label class="jp-form__wide">${esc(r.label)} <input name="text" placeholder="${esc(hint)}" required /></label>
      <div class="jp-form__acts"><button type="button" class="jp-b" data-req-cancel>Cancelar</button><button type="submit" class="jp-b jp-b--ink">Salvar</button></div>
    </form>`;
  }

  function reqRow(p, r, st) {
    const action = r.kind === "photo" ? "Adicionar foto" : r.kind === "test" ? "Registrar" : "Confirmar";
    const open = st.editing === `${p.key}:${r.key}`;
    const doneLine = r.done ? (r.photo ? chip(r) : `<small class="jp-req__val">${esc(valueText(r) || "Registrado")}${r.by ? ` · ${esc(r.by)}` : ""}</small>`) : "";
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
    return `<div class="jp-cur">
      ${p.requires.map((r) => reqRow(p, r, st)).join("")}
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
      if (p.wait_after_hours && next) sub += ` · depois ${p.wait_after_hours} h de cura`;
    } else if (isCur) {
      sub = s.waiting
        ? `Em cura até ${esc(dayLabel(s.readyAt, st.now))} · depois registre as provas e conclua`
        : p.requires.length
          ? "Registre as provas e conclua"
          : "Pronta para concluir";
      if (s.waiting) {
        const l = esc(left(s.readyAt.getTime() - st.now.getTime()));
        right = `<span class="jp-left">${l}</span>`;
        sub = `<b class="jp-left jp-left--inline">${l} · </b>${sub}`;
      }
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

  function render(box, d, st) {
    const s = shape(d, st.now);
    const list = `<div class="jd-card">
      <div class="jd-ch"><h2>Fases do job</h2><span class="jp-n" translate="no" data-no-i18n>${s.done} de ${s.total}</span></div>
      <ol class="jp-tl">${d.phases.map((p, i) => row(p, i, d, s, st)).join("")}</ol>
      ${!s.cur ? '<p class="jp-all">Todas as fases concluídas.</p>' : ""}
    </div>`;
    box.innerHTML = st.compact ? `<div class="jp jp--compact">${list}</div>` : `<div class="jd-grid jp"><div class="jd-col">${list}</div><aside class="jd-col jd-side">${sideCard(d)}</aside></div>`;
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

  function badge(d) {
    const el = document.getElementById("jdTabFases");
    if (!el || !d) return;
    const s = shape(d, new Date());
    el.textContent = `${s.done}/${s.total}`;
  }

  async function summary(jobId) {
    if (!available()) return null;
    try {
      const d = await api(`/api/work-orders/${encodeURIComponent(jobId)}/phases`);
      badge(d);
      return d;
    } catch (_) {
      return null;
    }
  }

  /**
   * ctx: { jobId, notify, compact, canAct (default true), address, onChange(data) }
   */
  function mount(box, ctx) {
    if (!box) return;
    ensureCss();
    const notify = ctx.notify || ((m) => console.warn(m));
    const st = { now: new Date(), compact: Boolean(ctx.compact), canAct: ctx.canAct !== false, busy: false, editing: null };
    let data = null;
    const base = `/api/work-orders/${encodeURIComponent(ctx.jobId)}/phases`;
    const paint = () => {
      st.now = new Date();
      if (data) render(box, data, st);
    };
    const took = (d, msg) => {
      data = d;
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
    const evidence = (phase, req, body) => api(`${base}/${encodeURIComponent(phase)}/evidence/${encodeURIComponent(req)}`, { method: "POST", body: JSON.stringify(body) });

    box.innerHTML = '<div class="jd-card"><p class="jd-empty">A carregar fases…</p></div>';
    api(base)
      .then((d) => {
        took(d);
        paint();
      })
      .catch((e) => (box.innerHTML = `<div class="jd-card"><p class="jd-empty">${esc(e.message)}</p></div>`));

    box.onclick = (e) => {
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
              const dataUrl = await compressImage(file, 1600, 0.75);
              const m = await api(`/api/work-orders/${encodeURIComponent(ctx.jobId)}/media`, {
                method: "POST",
                body: JSON.stringify({
                  data_url: dataUrl,
                  stage: "during",
                  taken_at_device: new Date(file.lastModified || Date.now()).toISOString(),
                  address: ctx.address || null,
                  client_upload_id: window.crypto?.randomUUID ? crypto.randomUUID() : `phase-${Date.now()}`,
                  device_label: "Office web",
                  is_public: false,
                }),
              });
              took(await evidence(phase, key, { media_id: m.id }), "Foto registrada.");
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
        run(async () => took(await evidence(phase, key, { value: { confirmed: true } }), "Conferido."));
        return;
      }
      if (e.target.closest("[data-req-cancel]")) {
        st.editing = null;
        paint();
        return;
      }
      const force = e.target.closest("[data-force]");
      if (force) {
        const phase = force.getAttribute("data-force");
        const ok = window.crmConfirm
          ? window.crmConfirm({ title: "Liberar a espera?", text: "A cura ainda não terminou. Conclua só se tiver certeza de que o material já curou.", ok: "Liberar e concluir" })
          : Promise.resolve(window.confirm("A cura ainda não terminou. Liberar e concluir?"));
        Promise.resolve(ok).then((yes) => {
          if (yes) run(async () => took(await api(`${base}/${encodeURIComponent(phase)}/complete`, { method: "POST", body: JSON.stringify({ force: true }) }), "Fase concluída."));
        });
        return;
      }
      const done = e.target.closest("[data-complete]");
      if (done) {
        const phase = done.getAttribute("data-complete");
        run(async () => took(await api(`${base}/${encodeURIComponent(phase)}/complete`, { method: "POST", body: "{}" }), "Fase concluída."));
      }
    };
    box.onsubmit = (e) => {
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
      run(async () => took(await evidence(phase, key, { value }), "Resultado registrado."));
    };
  }

  window.JobPhases = { available, summary, mount, _test: { shape, valueText, dayLabel, left } };
})();
