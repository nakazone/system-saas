/**
 * Calendar inside a job: the month with this job's days in the same colors as the Agenda,
 * where it stands today, and what else the same people have on those dates.
 * Shared by the Jobs side panel, the job page and the phone screen.
 *
 * window.JobAgendaBlock = { mount(el, opts) }
 * mount opts: { job, canManage, canViewCalendar } → { update(job) }
 */
(function () {
  if (window.JobAgendaBlock) return;

  const WD = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
  const MO = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
  const MONTHS = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
  const DAY = 86400000;
  const MAX_OTHERS = 3;
  /** Neutral until the Agenda's colors arrive, so a phase never shows a color that isn't its own. */
  const NO_COLOR = "#98a2b3";

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
  const sod = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dayText = (d) => `${WD[d.getDay()]} ${d.getDate()} ${MO[d.getMonth()]}`;
  const dayDiff = (a, b) => Math.round((sod(a).getTime() - sod(b).getTime()) / DAY);
  const days = (n) => `${n} dia${n === 1 ? "" : "s"}`;
  const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  function periodText(start, end) {
    if (!end || sod(start).getTime() === sod(end).getTime()) return dayText(start);
    return `${dayText(start)} até ${dayText(end)}`;
  }

  /** Where the job stands against today. Only said when it's true. */
  function progressText(job, start, end) {
    if (job.status === "completed" || job.status === "canceled") return "";
    const today = new Date();
    const last = end || start;
    const untilStart = dayDiff(start, today);
    const total = dayDiff(last, start) + 1;
    if (untilStart > 1) return `Começa em ${days(untilStart)}${total > 1 ? ` · ${days(total)} de trabalho` : ""}`;
    if (untilStart === 1) return `Começa amanhã${total > 1 ? ` · ${days(total)} de trabalho` : ""}`;
    if (dayDiff(today, last) > 0) return job.status === "in_progress" ? `Passou do término há ${days(dayDiff(today, last))}` : `Devia ter começado há ${days(-untilStart)}`;
    if (total === 1) return "É hoje";
    return `Dia ${dayDiff(today, start) + 1} de ${total}`;
  }

  /** Everything this job has on the calendar, one entry per kind of work. */
  function jobItems(job) {
    const items = [];
    const date = (iso) => {
      const d = iso ? new Date(iso) : null;
      return d && !Number.isNaN(d.getTime()) ? d : null;
    };
    const start = date(job.scheduled_start);
    const end = date(job.scheduled_end);
    if (start || job.sector === "both") {
      items.push({ role: "main", label: job.sector === "sand_finish" ? "Lixa" : "Instalação", from: start, to: end });
    }
    if (job.sector === "both") {
      items.push({ role: "sand", label: "Lixa", from: date(job.sand_scheduled_start), to: null });
    }
    (job.deliveries || []).forEach((d, i, all) => {
      const at = date(d.scheduled_start);
      if (!at) return;
      items.push({
        role: "delivery",
        label: all.length > 1 ? `Entrega ${i + 1}` : "Entrega",
        from: at,
        to: null,
        detail: window.JobHeader?.deliveryText?.(d) || "",
      });
    });
    return items;
  }

  /**
   * A light tint of the registered color, so the number always reads, and the color at full
   * strength in a bar along the bottom, so the day still matches the Agenda and the legend.
   */
  function dayPaint(shades) {
    const [one, two = one] = shades;
    const bar = `linear-gradient(90deg, ${one} 50%, ${two} 50%) bottom / 100% 4px no-repeat`;
    return `background:${bar}, linear-gradient(90deg, ${one}2e 50%, ${two}2e 50%)`;
  }

  function monthGrid(items, cursor, colors, opts) {
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const gridStart = new Date(first.getFullYear(), first.getMonth(), 1 - first.getDay());
    const weeks = Math.ceil((first.getDay() + new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate()) / 7);
    const today = sod(new Date()).getTime();
    const dated = items.filter((i) => i.from);
    const cells = [];
    for (let i = 0; i < weeks * 7; i += 1) {
      const d = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i);
      const t = d.getTime();
      const hits = dated.filter((it) => t >= sod(it.from).getTime() && t <= sod(it.to || it.from).getTime());
      const inMonth = d.getMonth() === cursor.getMonth();
      const cls = `ja-cell${inMonth ? "" : " is-out"}${t === today ? " is-today" : ""}${hits.length ? " is-on" : ""}`;
      const current = t === today ? ' aria-current="date"' : "";
      if (!hits.length) {
        cells.push(`<li class="${cls}"${current}><span>${d.getDate()}</span></li>`);
        continue;
      }
      const roles = [...new Set(hits.map((h) => h.role))];
      const shades = roles.map((r) => colors[r] || NO_COLOR);
      const label = `${dayText(d)}: ${[...new Set(hits.map((h) => h.label))].join(" e ")}`;
      const style = esc(dayPaint(shades));
      cells.push(
        `<li class="${cls}"${current}>${
          opts.canViewCalendar
            ? `<a href="schedule.html?date=${ymd(d)}&view=day" style="${style}" title="${esc(label)}" aria-label="${esc(`${label}. Abrir no calendário`)}">${d.getDate()}</a>`
            : `<span style="${style}" title="${esc(label)}" aria-label="${esc(label)}">${d.getDate()}</span>`
        }</li>`,
      );
    }
    return `<div class="ja-month">
      <div class="ja-month__h">
        <button type="button" class="ja-nav" data-ja-month="-1" aria-label="Mês anterior">‹</button>
        <b aria-live="polite">${MONTHS[cursor.getMonth()]} ${cursor.getFullYear()}</b>
        <button type="button" class="ja-nav" data-ja-month="1" aria-label="Próximo mês">›</button>
      </div>
      <ol class="ja-wd" aria-hidden="true">${WD.map((w) => `<li>${w[0]}</li>`).join("")}</ol>
      <ol class="ja-grid" aria-label="Dias do job em ${MONTHS[cursor.getMonth()]}">${cells.join("")}</ol>
    </div>`;
  }

  /** The key to the colors, and the dates in words: color is never the only signal. */
  function legend(job, items, colors) {
    const open = job.status !== "completed" && job.status !== "canceled";
    return `<ul class="ja-key">${items
      .map((it) => {
        const color = colors[it.role] || NO_COLOR;
        const when = !it.from
          ? "Sem data"
          : it.role === "delivery"
            ? it.detail || dayText(it.from)
            : periodText(it.from, it.to);
        const note = it.from && open && it.role !== "delivery" ? progressText(job, it.from, it.to) : "";
        return `<li><i style="background:${it.from ? esc(color) : "transparent"}" class="${it.from ? "" : "is-empty"}" aria-hidden="true"></i><span><small>${esc(it.label)}</small><b>${esc(when)}</b>${note ? `<em>${esc(note)}</em>` : ""}</span></li>`;
      })
      .join("")}</ul>`;
  }

  function othersHtml(list) {
    if (!list.length) return "";
    const rows = list.slice(0, MAX_OTHERS).map((c) => {
      const when = periodText(new Date(c.start), c.end ? new Date(c.end) : null);
      const name = c.kind === "job" ? `${c.number != null ? `Job #${c.number}` : "Outro job"}${c.client ? ` · ${c.client}` : ""}` : `Reunião: ${c.title}`;
      const label = `${esc(name)}, ${esc(when)}`;
      return `<li>${c.kind === "job" ? `<a href="job-detail.html?id=${encodeURIComponent(c.id)}">${label}</a>` : label}</li>`;
    });
    const extra = list.length - MAX_OTHERS;
    return `<div class="ja-others" role="status">
      <p><b>Também nessa data:</b> ${esc(list[0].who || "A equipe")} tem</p>
      <ul>${rows.join("")}${extra > 0 ? `<li>e mais ${extra}</li>` : ""}</ul>
    </div>`;
  }

  function firstMonth(items) {
    const dated = items.filter((i) => i.from).sort((a, b) => a.from - b.from);
    const now = new Date();
    // A job running now opens on this month; otherwise on the next thing it has, or its first date.
    const running = dated.find((i) => sod(now) >= sod(i.from) && sod(now) <= sod(i.to || i.from));
    const next = dated.find((i) => sod(i.from) >= sod(now));
    const at = running ? now : next ? next.from : dated[0]?.from || now;
    return new Date(at.getFullYear(), at.getMonth(), 1);
  }

  function html(job, opts, state) {
    const open = job.status !== "completed" && job.status !== "canceled";
    const items = jobItems(job);
    const anyDate = items.some((i) => i.from);
    const parts = [];
    if (!anyDate && !items.length) {
      parts.push(`<p class="ja-main ja-mu">Sem data</p><p class="ja-sub">${open ? "Este job ainda não está no calendário." : "Ficou sem data no calendário."}</p>`);
    }
    parts.push(monthGrid(items, state.cursor, state.colors, opts));
    if (items.length) parts.push(legend(job, items, state.colors));
    if (open) parts.push(othersHtml(state.others));

    const acts = [];
    if (opts.canManage && open) {
      acts.push(`<button type="button" class="ja-act${anyDate ? "" : " ja-act--main"}" data-ja-act="schedule">${anyDate ? "Remarcar" : "Agendar"}</button>`);
      if (state.others.length) acts.push(`<button type="button" class="ja-act" data-ja-act="team">Trocar equipe</button>`);
      if (job.sector === "installation") acts.push(`<button type="button" class="ja-act" data-ja-act="sand">Agendar lixa</button>`);
    }
    if (opts.canViewCalendar && job.status !== "canceled") {
      const first = items.filter((i) => i.from).sort((a, b) => a.from - b.from)[0];
      const href = first ? `schedule.html?focus=${encodeURIComponent(first.from.toISOString())}&event=${encodeURIComponent(job.id)}` : "schedule.html";
      acts.push(`<a class="ja-act" href="${esc(href)}">Ver no calendário</a>`);
    }
    if (acts.length) parts.push(`<div class="ja-acts">${acts.join("")}</div>`);
    return parts.join("");
  }

  function mount(el, opts) {
    let job = opts.job;
    const state = { cursor: firstMonth(jobItems(job)), colors: {}, others: [] };
    let seq = 0;
    const paint = () => {
      el.innerHTML = html(job, opts, state);
    };

    /** The colors registered in the Agenda settings. A failure keeps the last ones shown. */
    async function loadColors(mine) {
      const r = await fetch(`/api/work-orders/${encodeURIComponent(job.id)}/calendar-colors`, { credentials: "include" });
      const j = await r.json();
      if (mine === seq && r.ok && j.data) state.colors = j.data;
    }
    async function loadOthers(mine) {
      if (!job.scheduled_start && !job.sand_scheduled_start) return;
      const r = await fetch(`/api/work-orders/${encodeURIComponent(job.id)}/schedule-conflicts`, { credentials: "include" });
      const j = await r.json();
      if (mine === seq && r.ok && Array.isArray(j.data)) state.others = j.data;
    }
    /** Dates show right away; colors and other jobs fill in, and a failure never hides the dates. */
    function refresh() {
      const mine = ++seq;
      state.others = [];
      Promise.allSettled([loadColors(mine), loadOthers(mine)]).then(() => {
        if (mine === seq && el.isConnected) paint();
      });
    }

    el.addEventListener("click", (e) => {
      const nav = e.target.closest("[data-ja-month]");
      if (nav) {
        const step = Number(nav.getAttribute("data-ja-month"));
        state.cursor = new Date(state.cursor.getFullYear(), state.cursor.getMonth() + step, 1);
        paint();
        el.querySelector(`[data-ja-month="${step}"]`)?.focus();
        return;
      }
      const btn = e.target.closest("[data-ja-act]");
      if (!btn) return;
      const modal = window.__crmJobModal;
      const fail = (err) => {
        const msg = err?.message || "Não foi possível abrir a agenda do job. Tente de novo.";
        if (typeof window.crmNotify === "function") window.crmNotify(msg, "error");
        else window.crmToast?.error?.(msg);
      };
      const act = btn.getAttribute("data-ja-act");
      if (act === "sand") modal.openScheduleLixa(job).catch(fail);
      else modal.openEdit(job.id, { section: act }).catch(fail);
    });
    paint();
    refresh();
    return {
      update(next) {
        job = next;
        state.cursor = firstMonth(jobItems(job));
        paint();
        refresh();
      },
    };
  }

  window.JobAgendaBlock = { mount };
})();
