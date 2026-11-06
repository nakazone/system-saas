/** Campo · Minhas horas — os dias da semana (status, horas, extra, valor). */
(function () {
  const $ = (id) => document.getElementById(id);
  const esc = (s) =>
    String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const money = (n) => (Number(n) || 0).toLocaleString("en-US", { style: "currency", currency: "USD" });
  const minLabel = (m) => {
    m = Math.max(0, Math.round(m || 0));
    const h = Math.floor(m / 60);
    const r = m % 60;
    return !h ? `${r} min` : r ? `${h}h${String(r).padStart(2, "0")}` : `${h}h`;
  };
  let ref = new Date().toISOString().slice(0, 10);

  function shift(days) {
    const d = new Date(`${ref}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    ref = d.toISOString().slice(0, 10);
    load();
  }
  const br = (ymd) => ymd.split("-").reverse().slice(0, 2).join("/");

  function dayParts(label) {
    const raw = String(label || "").trim();
    const bits = raw.split(",").map((s) => s.trim()).filter(Boolean);
    if (bits.length >= 2) return { wd: bits[0], rest: bits.slice(1).join(", ") };
    const sp = raw.split(/\s+/);
    if (sp.length >= 2) return { wd: sp[0], rest: sp.slice(1).join(" ") };
    return { wd: raw || "—", rest: "" };
  }

  async function load() {
    try {
      let data;
      if (window.OmOffline && typeof window.OmOffline.api === "function") {
        data = await window.OmOffline.api(`/api/campo/dia/semana?week=${ref}`, {
          credentials: "include",
          dataOnly: true,
        });
      } else {
        const r = await fetch(`/api/campo/dia/semana?week=${ref}`, { credentials: "include" });
        if (r.status === 401) return (location.href = "/login.html");
        const j = await r.json();
        if (!j.success) throw new Error(j.error || "Erro");
        data = j.data;
      }
      render(data);
    } catch (e) {
      $("hrTotals").innerHTML = `<h2>Não foi possível carregar</h2><p class="dy-card__sub">${esc(e.message)}</p>`;
    }
  }

  function dayCard(d) {
    const when = dayParts(d.date_label);
    const jobs = (d.jobs || []).map((j) => j.client || j.title || "Job").filter(Boolean);
    const hours =
      d.clock_out_label
        ? `${d.clock_in_label} – ${d.clock_out_label}`
        : `${d.clock_in_label} · em andamento`;
    const pillStyle =
      d.status === "approved"
        ? "background:var(--om-ink);color:#fff"
        : d.status === "in_progress"
          ? "background:var(--om-bg);color:var(--om-ink-3)"
          : "";
    return `<article class="hr-day">
      <header class="hr-day__hd">
        <div class="hr-day__when">
          <b>${esc(when.wd)}</b>
          ${when.rest ? `<span>${esc(when.rest)}</span>` : ""}
        </div>
        <span class="dy-pill dy-pill--${esc(d.status)}" style="${pillStyle}">${esc(d.status_label)}</span>
      </header>
      <div class="hr-day__body">
        <p class="hr-day__hours">${esc(hours)} · ${esc(d.worked_label)}</p>
        ${d.overtime_minutes ? `<p class="hr-day__ot">+${esc(minLabel(d.overtime_minutes))} extra</p>` : ""}
        <p class="hr-day__jobs">${esc(jobs.join(" · ") || "Sem job")}</p>
      </div>
      <footer class="hr-day__ft">
        <b class="hr-day__amt">${esc(money(d.amount))}</b>
        ${d.status === "returned" ? `<a class="dy-btn dy-btn--sm dy-btn--ink" href="hoje.html">Ajustar</a>` : ""}
      </footer>
      ${d.review_note ? `<p class="hr-day__note hr-day__note--warn">${esc(d.review_note)}</p>` : ""}
      ${d.note ? `<p class="hr-day__note">“${esc(d.note)}”</p>` : ""}
    </article>`;
  }

  function render(w) {
    ref = w.week_start;
    $("hrWeekLbl").textContent = `Semana ${br(w.week_start)} – ${br(w.week_end)}`;
    const t = w.totals;
    $("hrTotals").innerHTML = `<div class="dy-card__lbl"><span>Total da semana</span><span>${t.days} dia${t.days === 1 ? "" : "s"}</span></div>
      <div class="dy-time"><b>${esc(money(t.amount))}</b><span>${t.approved_amount !== t.amount ? `${esc(money(t.approved_amount))} aprovado` : "tudo aprovado"}</span></div>
      <div class="dy-stats">
        <div class="dy-stat"><small>Horas</small><b>${esc(minLabel(t.worked_minutes))}</b></div>
        <div class="dy-stat dy-stat--ot"><small>Extra</small><b>${t.overtime_minutes ? esc(minLabel(t.overtime_minutes)) : "—"}</b></div>
        <div class="dy-stat"><small>Produção</small><b>${t.sqft ? `${t.sqft} sq ft` : "—"}</b></div>
      </div>`;
    $("hrDays").innerHTML = w.days.length
      ? w.days.map(dayCard).join("")
      : '<div class="dy-empty">Nenhum dia lançado nesta semana.</div>';
  }

  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-week]");
    if (b) shift(Number(b.getAttribute("data-week")) * 7);
  });
  load();
})();
