/**
 * Calendar inside a job: when it happens, where it stands today, and who else needs the same people.
 * Shared by the Jobs side panel, the job page and the phone screen.
 *
 * window.JobAgendaBlock = { mount(el, opts) }
 * mount opts: { job, canManage, canViewCalendar } → { update(job) }
 */
(function () {
  if (window.JobAgendaBlock) return;

  const WD = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
  const MO = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
  const DAY = 86400000;
  const MAX_CONFLICTS = 3;

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

  /** The week the job starts in; marked days are the ones it takes, in every phase. */
  function weekStrip(ranges) {
    const start = ranges[0].from;
    const first = new Date(start.getFullYear(), start.getMonth(), start.getDate() - start.getDay());
    const today = sod(new Date()).getTime();
    const spans = ranges.map((r) => [sod(r.from).getTime(), sod(r.to || r.from).getTime()]);
    const cells = [];
    for (let i = 0; i < 7; i += 1) {
      const d = new Date(first.getFullYear(), first.getMonth(), first.getDate() + i);
      const t = d.getTime();
      const on = spans.some(([from, to]) => t >= from && t <= to);
      cells.push(
        `<li class="ja-day${on ? " is-on" : ""}${t === today ? " is-today" : ""}"${t === today ? ' aria-current="date"' : ""}><small>${WD[d.getDay()][0]}</small><b>${d.getDate()}</b></li>`,
      );
    }
    const week = new Date(first.getFullYear(), first.getMonth(), first.getDate() + 6).getTime();
    const later = spans.reduce((n, [from, to]) => n + (to > week ? Math.round((to - Math.max(from, week + DAY)) / DAY) + 1 : 0), 0);
    return `<ol class="ja-week" aria-label="Dias do job nesta semana">${cells.join("")}</ol>${later ? `<p class="ja-sub">e mais ${days(later)} depois desta semana</p>` : ""}`;
  }

  function calendarHref(job, iso) {
    return iso ? `schedule.html?focus=${encodeURIComponent(iso)}&event=${encodeURIComponent(job.id)}` : "schedule.html";
  }

  function conflictHtml(list) {
    if (!list.length) return "";
    const rows = list.slice(0, MAX_CONFLICTS).map((c) => {
      const s = new Date(c.start);
      const when = periodText(s, c.end ? new Date(c.end) : null);
      const name = c.kind === "job" ? `${c.number != null ? `Job #${c.number}` : "Outro job"}${c.client ? ` · ${c.client}` : ""}` : `Reunião: ${c.title}`;
      const label = `${esc(name)}, ${esc(when)}`;
      return `<li>${c.kind === "job" ? `<a href="job-detail.html?id=${encodeURIComponent(c.id)}">${label}</a>` : label}</li>`;
    });
    const extra = list.length - MAX_CONFLICTS;
    return `<div class="ja-conflict" role="status">
      <p><b>Conflito de agenda:</b> ${esc(list[0].who || "A equipe")} também está em</p>
      <ul>${rows.join("")}${extra > 0 ? `<li>e mais ${extra}</li>` : ""}</ul>
    </div>`;
  }

  function deliveriesHtml(job) {
    const stops = (job.deliveries || []).filter((d) => d && d.scheduled_start);
    if (!stops.length) return "";
    return `<ul class="ja-rows">${stops
      .map((d) => `<li><span>Entrega</span><b>${esc(dayText(new Date(d.scheduled_start)))}</b>${d.pickup_address || d.location_name ? `<small>${esc(d.location_name || d.pickup_address)}</small>` : ""}</li>`)
      .join("")}</ul>`;
  }

  function html(job, opts, conflicts) {
    const start = job.scheduled_start ? new Date(job.scheduled_start) : null;
    const end = job.scheduled_end ? new Date(job.scheduled_end) : null;
    const sand = job.sand_scheduled_start ? new Date(job.sand_scheduled_start) : null;
    const open = job.status !== "completed" && job.status !== "canceled";
    const both = job.sector === "both";
    const anchor = start || sand;
    const parts = [];

    if (!anchor) {
      parts.push(`<p class="ja-main ja-mu">Sem data</p><p class="ja-sub">${open ? "Este job ainda não está no calendário." : "Ficou sem data no calendário."}</p>`);
    } else if (both) {
      parts.push(`<ul class="ja-rows">
        <li><span>Instalação</span><b>${start ? esc(periodText(start, end)) : "Sem data"}</b>${start && open ? `<small>${esc(progressText(job, start, end))}</small>` : ""}</li>
        <li><span>Lixa</span><b>${sand ? esc(dayText(sand)) : "Sem data"}</b>${sand && open ? `<small>${esc(progressText(job, sand, null))}</small>` : ""}</li>
      </ul>`);
    } else {
      const note = start ? progressText(job, start, end) : "";
      parts.push(`<p class="ja-main">${esc(periodText(anchor, end))}</p>${note ? `<p class="ja-sub">${esc(note)}</p>` : ""}`);
    }
    if (anchor) {
      const ranges = [...(start ? [{ from: start, to: end }] : []), ...(sand ? [{ from: sand, to: null }] : [])];
      parts.push(weekStrip(ranges));
    }
    if (open) parts.push(conflictHtml(conflicts || []));
    parts.push(deliveriesHtml(job));

    const acts = [];
    if (opts.canManage && open) {
      acts.push(`<button type="button" class="ja-act${anchor ? "" : " ja-act--main"}" data-ja-act="schedule">${anchor ? "Remarcar" : "Agendar"}</button>`);
      if (job.sector === "installation") acts.push(`<button type="button" class="ja-act" data-ja-act="sand">Agendar lixa</button>`);
    }
    if (opts.canViewCalendar && job.status !== "canceled") {
      acts.push(`<a class="ja-act" href="${esc(calendarHref(job, anchor ? anchor.toISOString() : ""))}">Ver no calendário</a>`);
    }
    if (acts.length) parts.push(`<div class="ja-acts">${acts.join("")}</div>`);
    return parts.join("");
  }

  function mount(el, opts) {
    let job = opts.job;
    let conflicts = [];
    let seq = 0;
    const paint = () => {
      el.innerHTML = html(job, opts, conflicts);
    };
    /** Conflicts arrive after the dates, so the block never waits on them. */
    async function loadConflicts() {
      const mine = ++seq;
      conflicts = [];
      if (!job.scheduled_start && !job.sand_scheduled_start) return;
      try {
        const r = await fetch(`/api/work-orders/${encodeURIComponent(job.id)}/schedule-conflicts`, { credentials: "include" });
        const j = await r.json();
        if (mine !== seq || !r.ok || !Array.isArray(j.data)) return;
        conflicts = j.data;
        if (el.isConnected) paint();
      } catch (_) {
        // Not knowing about a conflict must not get in the way of the dates.
      }
    }
    el.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-ja-act]");
      if (!btn) return;
      const modal = window.__crmJobModal;
      const fail = (err) => {
        const msg = err?.message || "Não foi possível abrir a agenda do job. Tente de novo.";
        if (typeof window.crmNotify === "function") window.crmNotify(msg, "error");
        else window.crmToast?.error?.(msg);
      };
      if (btn.getAttribute("data-ja-act") === "sand") modal.openScheduleLixa(job).catch(fail);
      else modal.openEdit(job.id, { section: "schedule" }).catch(fail);
    });
    paint();
    loadConflicts();
    return {
      update(next) {
        job = next;
        paint();
        loadConflicts();
      },
    };
  }

  window.JobAgendaBlock = { mount };
})();
