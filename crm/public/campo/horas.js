/** Campo · Minhas horas — os dias da semana (status, horas, extra, valor). */
(function () {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const money = (n) => (Number(n) || 0).toLocaleString("en-US", { style: "currency", currency: "USD" });
  const minLabel = (m) => {
    m = Math.max(0, Math.round(m || 0));
    const h = Math.floor(m / 60), r = m % 60;
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

  async function load() {
    try {
      const r = await fetch(`/api/campo/dia/semana?week=${ref}`, { credentials: "include" });
      if (r.status === 401) return (location.href = "/login.html");
      const j = await r.json();
      if (!j.success) throw new Error(j.error || "Erro");
      render(j.data);
    } catch (e) {
      $("hrTotals").innerHTML = `<h2>Não foi possível carregar</h2><p class="dy-card__sub">${esc(e.message)}</p>`;
    }
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
      ? w.days
          .map(
            (d) => `<div class="dy-job">
          <div class="dy-job__top">
            <span class="dy-job__time">${esc(d.date_label.split(", ")[0])}<br><small style="font-weight:600;color:#8a8074">${esc(d.date_label.split(", ")[1] || "")}</small></span>
            <div class="dy-job__main"><b>${esc(d.clock_in_label)}${d.clock_out_label ? ` – ${esc(d.clock_out_label)}` : " · em andamento"} · ${esc(d.worked_label)}${d.overtime_minutes ? ` · <span style="color:#c1652f">+${esc(minLabel(d.overtime_minutes))} extra</span>` : ""}</b>
              <small>${esc(d.jobs.map((j) => (j.number != null ? `#${j.number} ` : "") + j.title).join(" · ") || "Sem job")}</small></div>
            <span class="dy-pill dy-pill--${d.status}" style="${d.status === "approved" ? "background:#211d1a;color:#fff" : d.status === "in_progress" ? "background:#f7f4ee;color:#4a433d" : ""}">${esc(d.status_label)}</span>
          </div>
          <div class="dy-job__act" style="align-items:center">
            <span style="font-weight:800;font-size:15px">${esc(money(d.amount))}</span>
            ${d.status === "returned" ? `<a class="dy-btn dy-btn--sm dy-btn--ink" href="hoje.html">Ajustar</a>` : ""}
          </div>
          ${d.review_note ? `<p style="margin:8px 0 0;font-size:13px;color:#b42318;font-weight:600">${esc(d.review_note)}</p>` : ""}
          ${d.status === "pending" && d.flags.length ? `<p style="margin:8px 0 0;font-size:12.5px;color:#8a8074;font-weight:600">Em conferência: ${esc(d.flags.map((f) => f.label).join(", "))}</p>` : ""}
          ${d.note ? `<p style="margin:6px 0 0;font-size:13px;color:#4a433d">“${esc(d.note)}”</p>` : ""}
        </div>`,
          )
          .join("")
      : '<div class="dy-empty">Nenhum dia lançado nesta semana.</div>';
  }

  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-week]");
    if (b) shift(Number(b.getAttribute("data-week")) * 7);
  });
  load();
})();
