/**
 * Campo · Meu dia — começar o dia, jobs, fotos do dia, finalizar com nota.
 * API: /api/campo/dia (see src/crm/routes/campo-dia.ts). Photos go through the offline queue.
 */
(function () {
  const $ = (id) => document.getElementById(id);
  let S = null; // server state
  let busy = false;
  let tick = null;
  let sheet = null; // { kind, ... }
  let camJob = null;
  const Q = window.__campoMediaQueue || null;
  let queued = {}; // jobId → count waiting to upload

  // ------------------------------------------------------------ utils
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  }
  function money(n) {
    return (Number(n) || 0).toLocaleString("en-US", { style: "currency", currency: "USD" });
  }
  function initials(name) {
    const p = String(name || "?").trim().split(/\s+/).filter(Boolean);
    return ((p[0] || "?")[0] + (p.length > 1 ? p[p.length - 1][0] : "")).toUpperCase();
  }
  function minLabel(m) {
    m = Math.max(0, Math.round(m || 0));
    const h = Math.floor(m / 60);
    const r = m % 60;
    if (!h) return `${r} min`;
    return r ? `${h}h${String(r).padStart(2, "0")}` : `${h}h`;
  }
  function toast(msg) {
    const t = $("dyToast");
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => (t.hidden = true), 3200);
  }
  async function api(url, opts) {
    const r = await fetch(url, { credentials: "include", headers: { "Content-Type": "application/json" }, ...(opts || {}) });
    if (r.status === 401) {
      location.href = "/login.html?next=" + encodeURIComponent(location.pathname);
      throw new Error("Sessão expirada");
    }
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.success === false) {
      const e = new Error(j.error || `Erro ${r.status}`);
      e.code = j.code;
      e.data = j.data;
      throw e;
    }
    return j.data;
  }
  function gps() {
    return new Promise((resolve) => {
      if (!navigator.geolocation) return resolve(null);
      navigator.geolocation.getCurrentPosition(
        (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
        () => resolve(null),
        { enableHighAccuracy: true, timeout: 9000, maximumAge: 30000 },
      );
    });
  }
  const SECTOR = { installation: "Instalação", sand_finish: "Lixa" };
  const ICON = {
    cam: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 8.5A2.5 2.5 0 0 1 5.5 6h1.6l1.4-2h7l1.4 2h1.6A2.5 2.5 0 0 1 21 8.5v9A2.5 2.5 0 0 1 18.5 20h-13A2.5 2.5 0 0 1 3 17.5z"/><circle cx="12" cy="13" r="3.6"/></svg>',
    pin: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s-7-6.1-7-11.5A7 7 0 0 1 19 9.5C19 14.9 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>',
    play: '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4.5v15l13-7.5z"/></svg>',
    stop: '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="5" y="5" width="14" height="14" rx="2.5"/></svg>',
  };

  // ------------------------------------------------------------ load
  async function load() {
    try {
      S = await api("/api/campo/dia");
      await refreshQueue();
      render();
      flushPhotos();
      if (/[?&]manual=1/.test(location.search) && S.linked && !sheet) {
        history.replaceState(null, "", location.pathname);
        openManual(null);
      }
    } catch (e) {
      $("dyCard").className = "dy-card";
      $("dyCard").innerHTML = `<div class="dy-card__lbl">Meu dia</div><h2>Não foi possível carregar</h2><p class="dy-card__sub">${esc(e.message)}</p>
        <div style="margin-top:14px"><button class="dy-btn dy-btn--white dy-btn--full" data-act="reload">Tentar de novo</button></div>`;
    } finally {
      $("dyRoot").setAttribute("aria-busy", "false");
    }
  }

  async function refreshQueue() {
    queued = {};
    if (!Q) return;
    try {
      (await Q.list()).forEach((r) => (queued[r.jobId] = (queued[r.jobId] || 0) + 1));
    } catch (_) {}
  }

  // ------------------------------------------------------------ render
  function render() {
    const emp = S.employee;
    const first = emp ? emp.name.split(/\s+/)[0] : "";
    const h = new Date().getHours();
    $("dyHello").textContent = `${h < 12 ? "Bom dia" : h < 18 ? "Boa tarde" : "Boa noite"}${first ? `, ${first}` : ""}`;
    $("dyDate").textContent = `${S.today_label}${emp && emp.sector ? ` · ${SECTOR[emp.sector] || emp.sector}` : ""}`;
    $("dyAv").textContent = emp ? initials(emp.name) : "·";
    renderReturned();
    renderCard();
    renderJobs();
    renderPay();
    clearInterval(tick);
    if (S.day && S.day.status === "in_progress") tick = setInterval(renderCard, 30000);
  }

  function renderReturned() {
    $("dyReturned").innerHTML = (S.returned || [])
      .map(
        (d) => `<div class="dy-ret"><div><b>Dia ${esc(d.date_label)} voltou para ajuste</b><p>${esc(d.review_note || "O escritório pediu para conferir este dia.")}</p></div>
        <button class="dy-btn dy-btn--sm dy-btn--ink" data-act="fix" data-id="${esc(d.id)}">Ajustar</button></div>`,
      )
      .join("");
  }

  function jobLine(j) {
    return `${j.number != null ? `#${j.number} · ` : ""}${j.title}`;
  }

  function renderCard() {
    const box = $("dyCard");
    box.className = "dy-card";
    if (!S.linked) {
      box.innerHTML = `<div class="dy-card__lbl">Meu dia</div><h2>Seu acesso ainda não está ligado à folha</h2>
        <p class="dy-card__sub">Peça ao escritório para ligar seu usuário ao seu cadastro de funcionário. Depois disso você começa e finaliza o dia por aqui.</p>`;
      return;
    }
    const emp = S.employee;
    const d = S.day;
    const endLbl = emp.schedule.end_time;
    if (!d) {
      const j = S.jobs_today[0];
      box.innerHTML = `<div class="dy-card__lbl"><span>Seu dia</span><span>Fim padrão ${esc(endLbl)}</span></div>
        <h2>${j ? esc(jobLine(j)) : "Nenhum job na agenda hoje"}</h2>
        <p class="dy-card__sub">${j ? `${j.start_label ? `${esc(j.start_label)} · ` : ""}${esc(j.client || "")}${j.address ? ` · ${esc(j.address)}` : ""}` : "Você pode começar e escolher o job."}</p>
        <div style="margin-top:16px"><button class="dy-btn dy-btn--terra dy-btn--full" data-act="start">${ICON.play} Começar o dia</button></div>
        <p class="dy-card__hint">Registra a hora e sua localização. Depois das ${esc(endLbl)} conta hora extra.<br><button type="button" data-act="manual">Esqueci de bater o ponto</button></p>`;
      return;
    }
    if (d.status === "in_progress") {
      // live numbers from the server snapshot + time passed since load
      const since = new Date(d.clock_in).getTime();
      const elapsed = Math.max(0, Math.round((Date.now() - since) / 60000));
      const endAt = d.expected_end_label;
      const here = d.jobs[d.jobs.length - 1];
      const startH = new Date(d.clock_in);
      const pctBase = (() => {
        // fraction of the normal day done (start → expected end)
        const [eh, em] = String(endAt || "17:00").split(":").map(Number);
        const end = new Date(startH);
        end.setHours(eh, em, 0, 0);
        const total = Math.max(60, (end - startH) / 60000);
        return Math.min(1, elapsed / total);
      })();
      const otNow = Math.max(d.overtime_minutes, 0);
      box.innerHTML = `<div class="dy-card__lbl"><span>Dia em andamento</span><span class="dy-pill dy-pill--in_progress">desde ${esc(d.clock_in_label)}</span></div>
        <div class="dy-time"><b>${esc(minLabel(elapsed))}</b><span>trabalhando</span></div>
        <div class="dy-bar" aria-hidden="true"><i style="width:${(pctBase * 100).toFixed(1)}%"></i></div>
        <div class="dy-bar__lbl"><span>${esc(d.clock_in_label)}</span><span>${esc(endAt || endLbl)}</span></div>
        <div class="dy-stats">
          <div class="dy-stat dy-stat--ot"><small>Extra</small><b>${otNow ? esc(minLabel(otNow)) : "—"}</b></div>
          <div class="dy-stat"><small>Jobs</small><b>${d.jobs.length}</b></div>
          <div class="dy-stat"><small>${emp.pay_type === "production" ? "Produção" : "Hoje"}</small><b>${emp.pay_type === "production" ? `${d.sqft || 0} sq ft` : esc(money(d.amount))}</b></div>
        </div>
        ${here ? `<div class="dy-now"><span class="dy-now__dot" aria-hidden="true"></span><div><small>Onde você está</small><b>${esc(jobLine(here))}</b></div></div>` : ""}
        <div style="margin-top:14px"><button class="dy-btn dy-btn--terra dy-btn--full" data-act="finish">${ICON.stop} Finalizar o dia</button></div>`;
      return;
    }
    // finished
    const pillCls = d.status;
    box.innerHTML = `<div class="dy-card__lbl"><span>Dia enviado</span><span class="dy-pill dy-pill--${pillCls}">${esc(d.status_label)}</span></div>
      <div class="dy-time"><b>${esc(d.worked_label)}</b><span>${esc(d.clock_in_label)} – ${esc(d.clock_out_label || "")}</span></div>
      <div class="dy-stats">
        <div class="dy-stat dy-stat--ot"><small>Extra</small><b>${d.overtime_minutes ? esc(minLabel(d.overtime_minutes)) : "—"}</b></div>
        <div class="dy-stat"><small>Jobs</small><b>${d.jobs.length}</b></div>
        <div class="dy-stat"><small>Valor</small><b>${esc(money(d.amount))}</b></div>
      </div>
      ${
        d.status === "pending" && d.flags.length
          ? `<p class="dy-card__sub">O escritório vai conferir:</p><ul class="dy-flags">${d.flags.map((f) => `<li>${esc(f.label)}</li>`).join("")}</ul>`
          : d.status === "approved"
            ? `<p class="dy-card__sub">Já está na folha da semana.</p>`
            : ""
      }
      ${d.note ? `<p class="dy-card__hint" style="text-align:left">Nota: ${esc(d.note)}</p>` : ""}`;
  }

  function photoTag(j) {
    const n = j.photos_today || 0;
    const q = queued[j.id] || 0;
    if (q) return `<span class="dy-job__ph">${q} na fila</span>`;
    if (n) return `<span class="dy-job__ph dy-job__ph--ok">${n} foto${n > 1 ? "s" : ""} hoje</span>`;
    return `<span class="dy-job__ph dy-job__ph--miss">Falta foto</span>`;
  }

  function renderJobs() {
    const box = $("dyJobs");
    if (!S.linked) {
      box.innerHTML = "";
      return;
    }
    const d = S.day;
    const inDay = d && d.status === "in_progress";
    const list = inDay ? d.jobs : d ? d.jobs : S.jobs_today;
    const here = inDay ? d.jobs[d.jobs.length - 1] : null;
    const title = inDay ? "Jobs do seu dia" : d ? "Jobs do dia" : "Agenda de hoje";
    box.className = "dy-sec";
    box.innerHTML = `<div class="dy-sec__hd"><h3>${title}</h3>${inDay ? `<button type="button" data-act="addjob">+ Outro job</button>` : `<a href="agenda.html">Semana</a>`}</div>
      ${
        list.length
          ? list
              .map(
                (j) => `<div class="dy-job${here && here.id === j.id ? " dy-job--here" : ""}">
            <div class="dy-job__top">
              <span class="dy-job__time">${esc(j.arrived_label || j.start_label || (j.continuing ? "Cont." : "—"))}</span>
              <div class="dy-job__main"><b>${esc(jobLine(j))}</b><small>${esc([j.client, j.address].filter(Boolean).join(" · "))}</small></div>
              ${inDay ? photoTag(j) : ""}
            </div>
            <div class="dy-job__act">
              ${inDay ? `<button class="dy-btn dy-btn--sm dy-btn--ink" data-act="photo" data-job="${esc(j.id)}">${ICON.cam} Foto</button>` : ""}
              ${inDay && here && here.id !== j.id ? `<button class="dy-btn dy-btn--sm dy-btn--line" data-act="goto" data-job="${esc(j.id)}">Estou aqui</button>` : ""}
              <a class="dy-btn dy-btn--sm dy-btn--line" href="ticket.html?id=${encodeURIComponent(j.id)}">Ticket</a>
              ${j.maps_url && !inDay ? `<a class="dy-btn dy-btn--sm dy-btn--line" href="${esc(j.maps_url)}" target="_blank" rel="noopener">${ICON.pin} Mapa</a>` : ""}
            </div>
          </div>`,
              )
              .join("")
          : `<div class="dy-empty">${inDay ? "Nenhum job no seu dia ainda." : "Sem jobs na agenda de hoje."}</div>`
      }`;
  }

  function renderPay() {
    const box = $("dyPay");
    if (!S.linked || !S.payments.length) {
      box.innerHTML = "";
      return;
    }
    box.className = "dy-sec";
    box.innerHTML = `<div class="dy-sec__hd"><h3>Pagamentos</h3><a href="horas.html">Minhas horas</a></div>
      <div class="dy-pay">${S.payments
        .slice(0, 4)
        .map(
          (p) => `<div class="dy-pay__row"><div><b>${esc(p.label.replace(/^Semana /, "Semana "))}</b>
          <small>${p.status === "paid" ? `Pago em ${esc(p.paid_on.split("-").reverse().slice(0, 2).join("/"))}${p.method_label ? ` · ${esc(p.method_label)}` : ""}` : p.status === "due" ? "Semana fechada" : "Semana em andamento"}</small></div>
          <div class="dy-pay__amt"><b>${esc(money(p.status === "paid" && p.paid_amount != null ? p.paid_amount : p.amount))}</b><br><span class="dy-tag dy-tag--${p.status}">${esc(p.status_label)}</span></div></div>`,
        )
        .join("")}</div>`;
  }

  // ------------------------------------------------------------ actions
  async function startDay() {
    if (busy) return;
    const jobs = S.jobs_today;
    if (jobs.length > 1) return openPickJob("start");
    if (!jobs.length) return openPickJob("start");
    await doStart(jobs[0].id);
  }

  async function doStart(jobId) {
    busy = true;
    toast("Pegando sua localização…");
    const g = await gps();
    try {
      S = await api("/api/campo/dia/start", {
        method: "POST",
        body: JSON.stringify({ work_order_id: jobId || null, lat: g?.lat, lng: g?.lng, accuracy: g?.accuracy, device_at: new Date().toISOString() }),
      });
      closeSheet();
      render();
      const d = S.day;
      const far = d?.gps_in?.distance_m;
      toast(!g ? "Dia começou — sem localização (ative o GPS)." : far != null && far > 500 ? `Dia começou — você está a ${(far / 1000).toFixed(1)} km do job.` : "Bom trabalho! Dia começou.");
    } catch (e) {
      toast(e.message);
    } finally {
      busy = false;
    }
  }

  async function gotoJob(jobId) {
    if (busy) return;
    busy = true;
    try {
      S = await api("/api/campo/dia/jobs", { method: "POST", body: JSON.stringify({ work_order_id: jobId }) });
      closeSheet();
      render();
      toast("Job atualizado.");
    } catch (e) {
      toast(e.message);
    } finally {
      busy = false;
    }
  }

  // ------------------------------------------------------------ photos
  function takePhoto(jobId) {
    camJob = jobId;
    $("dyCam").value = "";
    $("dyCam").click();
  }

  function compress(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const k = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
        const c = document.createElement("canvas");
        c.width = Math.round(img.naturalWidth * k);
        c.height = Math.round(img.naturalHeight * k);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        resolve(c.toDataURL("image/jpeg", 0.74));
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("Não deu para ler a foto"));
      };
      img.src = url;
    });
  }

  async function onPhoto(file) {
    const jobId = camJob;
    if (!file || !jobId) return;
    try {
      const [dataUrl, g] = await Promise.all([compress(file), gps()]);
      const row = { jobId, dataUrl, stage: "during", takenAtDevice: new Date().toISOString(), lat: g?.lat, lng: g?.lng, gpsAccuracyM: g?.accuracy, deviceLabel: "Campo · Meu dia" };
      if (Q) {
        await Q.enqueue(row);
        await refreshQueue();
        rerenderAll();
        await flushPhotos();
      } else {
        await postPhoto(row);
        bumpPhoto(jobId);
      }
    } catch (e) {
      toast(e.message || "Falha na foto");
    }
  }

  function postPhoto(row) {
    return api(`/api/campo/jobs/${encodeURIComponent(row.jobId)}/photos`, {
      method: "POST",
      body: JSON.stringify({
        data_url: row.dataUrl,
        stage: row.stage,
        taken_at_device: row.takenAtDevice,
        lat: row.lat,
        lng: row.lng,
        gps_accuracy_m: row.gpsAccuracyM,
        client_upload_id: row.id,
        device_label: row.deviceLabel,
      }),
    });
  }

  function bumpPhoto(jobId) {
    const all = [...(S.day ? S.day.jobs : []), ...S.jobs_today];
    all.forEach((j) => {
      if (j.id === jobId) j.photos_today = (j.photos_today || 0) + 1;
    });
  }

  let flushing = false;
  async function flushPhotos() {
    if (!Q || flushing) return;
    flushing = true;
    try {
      const res = await Q.flush(null, async (row) => {
        const out = await postPhoto(row);
        bumpPhoto(row.jobId);
        return out;
      });
      const ok = res.filter((r) => r.ok).length;
      const bad = res.some((r) => !r.ok);
      await refreshQueue();
      rerenderAll();
      $("dyNet").hidden = !bad;
      if (ok) toast(ok === 1 ? "Foto enviada." : `${ok} fotos enviadas.`);
    } catch (_) {
    } finally {
      flushing = false;
    }
  }

  function rerenderAll() {
    renderJobs();
    if (sheet && sheet.kind === "finish") renderFinish();
  }

  // ------------------------------------------------------------ sheets
  function openSheet(kind, title, extra) {
    sheet = { kind, ...(extra || {}) };
    $("dySheetTitle").textContent = title;
    $("dySheet").hidden = false;
    $("dyBackdrop").hidden = false;
    document.body.classList.add("dy-lock");
  }
  function closeSheet() {
    sheet = null;
    $("dySheet").hidden = true;
    $("dyBackdrop").hidden = true;
    document.body.classList.remove("dy-lock");
  }

  function jobPickHtml(list, selected, multi) {
    return `<div class="dy-pick">${list
      .map((j) => {
        const on = selected.includes(j.id);
        return `<button type="button" class="${on ? "is-on" : ""}" data-act="${multi ? "toggle" : "pick"}" data-job="${esc(j.id)}">
          <span class="dy-pick__ck">${on ? "✓" : ""}</span><div><b>${esc(jobLine(j))}</b><small>${esc([j.start_label, j.client, j.address].filter(Boolean).join(" · "))}</small></div></button>`;
      })
      .join("")}</div>`;
  }

  // pick a job to start / add
  function openPickJob(mode) {
    openSheet("pick", mode === "start" ? "Em qual job você começa?" : "Outro job", { mode, results: null, q: "" });
    renderPick();
  }
  function renderPick() {
    const inDay = new Set((S.day ? S.day.jobs : []).map((j) => j.id));
    const agenda = S.jobs_today.filter((j) => !inDay.has(j.id));
    const res = sheet.results;
    $("dySheetBody").innerHTML = `
      ${agenda.length ? `<p class="dy-step__t">Agenda de hoje</p>${jobPickHtml(agenda, [], false)}` : ""}
      <p class="dy-step__t" style="margin-top:14px">Outro job</p>
      <input class="dy-in" id="dyQ" placeholder="Buscar por número, cliente ou endereço" value="${esc(sheet.q)}" autocomplete="off" />
      <div style="margin-top:8px">${res ? (res.length ? jobPickHtml(res.filter((j) => !inDay.has(j.id)), [], false) : '<p class="dy-empty">Nada encontrado.</p>') : ""}</div>`;
    $("dySheetFt").innerHTML = sheet.mode === "start" ? `<button class="dy-btn dy-btn--line dy-btn--full" data-act="start-nojob">Começar sem job</button>` : "";
  }
  let searchT = null;
  function searchJobs(q) {
    sheet.q = q;
    clearTimeout(searchT);
    searchT = setTimeout(async () => {
      try {
        const rows = await api(`/api/campo/dia/jobs/search?q=${encodeURIComponent(q)}`);
        if (!sheet) return;
        sheet.results = rows;
        const focus = document.activeElement && document.activeElement.id;
        if (sheet.kind === "pick") renderPick();
        else if (sheet.kind === "manual") renderManual();
        if (focus === "dyQ") {
          const el = $("dyQ");
          el.focus();
          el.setSelectionRange(el.value.length, el.value.length);
        }
      } catch (_) {}
    }, 250);
  }

  // finish
  function openFinish() {
    const d = S.day;
    sheet = null;
    openSheet("finish", "Finalizar o dia", {
      note: "",
      sqft: Object.fromEntries(d.jobs.map((j) => [j.id, j.sqft || ""])),
      err: "",
    });
    renderFinish();
    flushPhotos();
  }
  function finishEstimate() {
    const d = S.day;
    const emp = S.employee;
    const elapsed = Math.max(0, Math.round((Date.now() - new Date(d.clock_in).getTime()) / 60000));
    const lunch = elapsed > 300 ? d.lunch_minutes || 0 : 0;
    const [eh, em] = String(d.expected_end_label || emp.schedule.end_time).split(":").map(Number);
    const end = new Date();
    end.setHours(eh, em, 0, 0);
    let ot = Math.max(0, (Date.now() - end) / 60000);
    ot = Math.round(ot / 15) * 15;
    const otRate = (emp.daily_rate || 0) * 0.1;
    const sqft = Object.values(sheet.sqft).reduce((s, v) => s + (Number(v) || 0), 0);
    const amount = emp.pay_type === "production" ? sqft * (emp.production_rate || 0) : (emp.daily_rate || 0) + (ot / 60) * otRate;
    return { worked: elapsed - lunch, ot: emp.pay_type === "production" ? 0 : ot, amount, sqft };
  }
  function renderFinish() {
    const d = S.day;
    const emp = S.employee;
    const missing = d.jobs.filter((j) => emp.require_photos && !(j.photos_today || 0));
    const waiting = d.jobs.reduce((s, j) => s + (queued[j.id] || 0), 0);
    const est = finishEstimate();
    const now = new Date();
    $("dySheetBody").innerHTML = `
      <div class="dy-step"><p class="dy-step__t">1 · Onde você trabalhou</p>
        ${d.jobs
          .map((j) => {
            const n = j.photos_today || 0;
            const q = queued[j.id] || 0;
            const miss = emp.require_photos && !n;
            return `<div class="dy-fjob${miss ? " dy-fjob--miss" : ""}">
              <div class="dy-fjob__top"><div><b>${esc(jobLine(j))}</b><small>${esc(j.address || j.client || "")}</small></div>
                <span class="dy-fjob__ph">${q ? `${q} na fila` : n ? `✓ ${n} foto${n > 1 ? "s" : ""}` : "Falta foto"}</span></div>
              <div class="dy-fjob__row">
                <button class="dy-btn dy-btn--sm ${miss ? "dy-btn--terra" : "dy-btn--line"}" data-act="photo" data-job="${esc(j.id)}">${ICON.cam} ${n ? "Mais foto" : "Tirar foto"}</button>
                ${
                  emp.pay_type === "production"
                    ? `<label>sq ft <input class="dy-in dy-in--sqft" inputmode="decimal" data-sqft="${esc(j.id)}" value="${esc(sheet.sqft[j.id])}" placeholder="0" /></label>`
                    : d.jobs.length > 1
                      ? `<button class="dy-btn dy-btn--sm dy-btn--line" data-act="rmjob" data-job="${esc(j.id)}">Não fui</button>`
                      : ""
                }
              </div></div>`;
          })
          .join("")}
        <button class="dy-btn dy-btn--sm dy-btn--line dy-btn--full" data-act="addjob">+ Trabalhei em outro job</button>
      </div>
      <div class="dy-step"><p class="dy-step__t">2 · Nota do dia</p>
        <textarea class="dy-in dy-ta" id="dyNote" maxlength="1000" placeholder="Como foi o dia? O que ficou faltando, material, problemas…">${esc(sheet.note)}</textarea></div>
      <div class="dy-step"><p class="dy-step__t">3 · Resumo</p>
        <div class="dy-sum">
          <div><small>Entrada</small><b>${esc(d.clock_in_label)}</b></div>
          <div><small>Saída</small><b>${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}</b></div>
          <div><small>Horas${d.lunch_minutes ? ` (−${d.lunch_minutes} almoço)` : ""}</small><b>${esc(minLabel(est.worked))}</b></div>
          <div class="ot"><small>Extra (depois das ${esc(d.expected_end_label || emp.schedule.end_time)})</small><b>${est.ot ? esc(minLabel(est.ot)) : "—"}</b></div>
          <div class="big"><small>${emp.pay_type === "production" ? `${est.sqft || 0} sq ft` : "Estimativa do dia"}</small><b>${esc(money(est.amount))}</b></div>
        </div>
        <p class="dy-gps">${ICON.pin} Ao enviar registramos a hora e sua localização.</p></div>`;
    const blocked = missing.length > 0 || waiting > 0;
    $("dySheetFt").innerHTML = `${blocked ? `<p>${waiting ? `Enviando ${waiting} foto${waiting > 1 ? "s" : ""}… espere o sinal.` : `Falta foto em ${missing.length} job${missing.length > 1 ? "s" : ""}.`}</p>` : ""}
      <button class="dy-btn dy-btn--terra dy-btn--full" data-act="send" ${blocked ? "disabled" : ""}>${ICON.stop} Enviar o dia</button>
      ${sheet.err ? `<p class="dy-err">${esc(sheet.err)}</p>` : ""}`;
  }
  async function sendFinish() {
    if (busy) return;
    busy = true;
    const btn = document.querySelector('[data-act="send"]');
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Enviando…";
    }
    const g = await gps();
    try {
      const jobs = S.day.jobs.map((j) => ({ work_order_id: j.id, sqft: Number(sheet.sqft[j.id]) || 0 }));
      S = await api("/api/campo/dia/finish", {
        method: "POST",
        body: JSON.stringify({ jobs, note: sheet.note || null, lat: g?.lat, lng: g?.lng, accuracy: g?.accuracy, device_at: new Date().toISOString() }),
      });
      closeSheet();
      render();
      toast(S.day && S.day.status === "approved" ? "Dia enviado e aprovado. Bom descanso!" : "Dia enviado — o escritório vai conferir.");
    } catch (e) {
      if (e.code === "PHOTOS_REQUIRED" && e.data && e.data.missing) {
        S.day.jobs.forEach((j) => {
          if (e.data.missing.includes(j.id)) j.photos_today = 0;
        });
      }
      if (sheet) {
        sheet.err = e.message;
        renderFinish();
      }
    } finally {
      busy = false;
    }
  }

  // manual / fix a returned day
  function openManual(day) {
    const today = S.today;
    const opts = [];
    for (let i = 0; i <= 7; i++) {
      const dt = new Date(`${today}T12:00:00Z`);
      dt.setUTCDate(dt.getUTCDate() - i);
      opts.push(dt.toISOString().slice(0, 10));
    }
    const emp = S.employee;
    openSheet("manual", day ? `Ajustar dia ${day.date_label}` : "Lançar dia", {
      day,
      date: day ? day.date : S.day ? opts[1] : today,
      dates: opts,
      start: day ? day.clock_in_label : emp.schedule.start_time,
      end: day ? day.clock_out_label || emp.schedule.end_time : emp.schedule.end_time,
      jobs: day ? day.jobs.map((j) => j.id) : S.jobs_today.slice(0, 1).map((j) => j.id),
      known: [...(day ? day.jobs : []), ...S.jobs_today],
      sqft: day ? Object.fromEntries(day.jobs.map((j) => [j.id, j.sqft || ""])) : {},
      note: day ? day.note || "" : "",
      results: null,
      q: "",
      err: "",
    });
    renderManual();
  }
  function renderManual() {
    const m = sheet;
    const emp = S.employee;
    const known = [...m.known, ...(m.results || [])].filter((j, i, a) => a.findIndex((x) => x.id === j.id) === i);
    const sel = known.filter((j) => m.jobs.includes(j.id));
    const others = known.filter((j) => !m.jobs.includes(j.id));
    const fmt = (ymd) => {
      const [y, mo, da] = ymd.split("-");
      return ymd === S.today ? `Hoje (${da}/${mo})` : `${["dom", "seg", "ter", "qua", "qui", "sex", "sáb"][new Date(`${ymd}T12:00:00Z`).getUTCDay()]}, ${da}/${mo}`;
    };
    $("dySheetBody").innerHTML = `
      ${m.day && m.day.review_note ? `<div class="dy-ret"><div><b>Motivo</b><p>${esc(m.day.review_note)}</p></div></div>` : ""}
      <div class="dy-step"><p class="dy-step__t">Dia e horário</p>
        ${m.day ? "" : `<label class="dy-field">Dia<select class="dy-in" id="dyMDate">${m.dates.map((d) => `<option value="${d}"${d === m.date ? " selected" : ""}>${fmt(d)}</option>`).join("")}</select></label>`}
        <div class="dy-grid2" style="margin-top:8px">
          <label class="dy-field">Entrada<input class="dy-in" type="time" id="dyMStart" value="${esc(m.start)}" /></label>
          <label class="dy-field">Saída<input class="dy-in" type="time" id="dyMEnd" value="${esc(m.end)}" /></label>
        </div></div>
      <div class="dy-step"><p class="dy-step__t">Jobs desse dia</p>
        ${sel.length ? jobPickHtml(sel, m.jobs, true) : '<p class="dy-empty">Escolha pelo menos um job.</p>'}
        ${
          emp.pay_type === "production" && sel.length
            ? `<div style="margin-top:8px">${sel.map((j) => `<label class="dy-field" style="margin-top:6px">sq ft · ${esc(jobLine(j))}<input class="dy-in dy-in--sqft" inputmode="decimal" data-msqft="${esc(j.id)}" value="${esc(m.sqft[j.id] || "")}" /></label>`).join("")}</div>`
            : ""
        }
        <input class="dy-in" id="dyQ" style="margin-top:10px" placeholder="Adicionar outro job — buscar" value="${esc(m.q)}" autocomplete="off" />
        ${others.length ? `<div style="margin-top:8px">${jobPickHtml(others.slice(0, 8), m.jobs, true)}</div>` : ""}
      </div>
      <div class="dy-step"><p class="dy-step__t">Nota</p><textarea class="dy-in dy-ta" id="dyMNote" maxlength="1000" placeholder="Por que lançou manualmente? Como foi o dia?">${esc(m.note)}</textarea></div>
      <p class="dy-gps">As fotos desse dia precisam estar no job. Lançamentos manuais passam pela aprovação do escritório.</p>`;
    $("dySheetFt").innerHTML = `<button class="dy-btn dy-btn--terra dy-btn--full" data-act="send-manual">${m.day ? "Reenviar dia" : "Enviar dia"}</button>${m.err ? `<p class="dy-err">${esc(m.err)}</p>` : ""}`;
  }
  async function sendManual() {
    if (busy) return;
    const m = sheet;
    busy = true;
    try {
      S = await api("/api/campo/dia/manual", {
        method: "POST",
        body: JSON.stringify({
          day_id: m.day ? m.day.id : null,
          date: m.day ? null : m.date,
          start: m.start,
          end: m.end,
          jobs: m.jobs.map((id) => ({ work_order_id: id, sqft: Number(m.sqft[id]) || 0 })),
          note: m.note || null,
        }),
      });
      closeSheet();
      render();
      toast("Dia enviado para aprovação.");
    } catch (e) {
      m.err = e.code === "PHOTOS_REQUIRED" ? "Falta foto desse dia em algum job. Tire/envie a foto pelo ticket do job." : e.message;
      renderManual();
    } finally {
      busy = false;
    }
  }

  // ------------------------------------------------------------ events
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-act]");
    if (!b) return;
    const act = b.getAttribute("data-act");
    const job = b.getAttribute("data-job");
    switch (act) {
      case "reload":
        return load();
      case "start":
        return startDay();
      case "start-nojob":
        return doStart(null);
      case "pick":
        if (sheet && sheet.mode === "start") return doStart(job);
        return gotoJob(job);
      case "goto":
        return gotoJob(job);
      case "addjob":
        return openPickJob("add");
      case "finish":
        return openFinish();
      case "photo":
        return takePhoto(job);
      case "rmjob":
        return api(`/api/campo/dia/jobs/${encodeURIComponent(job)}`, { method: "DELETE" })
          .then((st) => {
            S = st;
            render();
            if (sheet && sheet.kind === "finish") renderFinish();
          })
          .catch((err) => toast(err.message));
      case "send":
        return sendFinish();
      case "manual":
        return openManual(null);
      case "fix":
        return openManual((S.returned || []).find((d) => d.id === b.getAttribute("data-id")));
      case "toggle": {
        const i = sheet.jobs.indexOf(job);
        if (i >= 0) sheet.jobs.splice(i, 1);
        else sheet.jobs.push(job);
        return renderManual();
      }
      case "send-manual":
        return sendManual();
      case "close":
        return closeSheet();
    }
  });
  $("dyBackdrop").addEventListener("click", closeSheet);
  document.addEventListener("input", (e) => {
    const t = e.target;
    if (!sheet) return;
    if (t.id === "dyQ") return searchJobs(t.value.trim());
    if (t.id === "dyNote") sheet.note = t.value;
    if (t.id === "dyMNote") sheet.note = t.value;
    if (t.id === "dyMStart") sheet.start = t.value;
    if (t.id === "dyMEnd") sheet.end = t.value;
    if (t.hasAttribute("data-sqft")) {
      sheet.sqft[t.getAttribute("data-sqft")] = t.value;
      const est = finishEstimate();
      const big = document.querySelector(".dy-sum .big");
      if (big) big.innerHTML = `<small>${est.sqft || 0} sq ft</small><b>${esc(money(est.amount))}</b>`;
    }
    if (t.hasAttribute("data-msqft")) sheet.sqft[t.getAttribute("data-msqft")] = t.value;
  });
  document.addEventListener("change", (e) => {
    if (e.target.id === "dyMDate" && sheet) sheet.date = e.target.value;
  });
  $("dyCam").addEventListener("change", (e) => onPhoto(e.target.files && e.target.files[0]));
  window.addEventListener("online", () => {
    $("dyNet").hidden = true;
    flushPhotos();
  });
  window.addEventListener("offline", () => ($("dyNet").hidden = false));
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && !sheet) load();
  });

  load();
})();
