(function () {
  const HOUR_START = 6;
  const HOUR_END = 21;
  const HOUR_PX = 48;

  let view = "week";
  let cursor = new Date();
  cursor.setHours(0, 0, 0, 0);
  let events = [];
  let filtered = [];
  let canManageMeetings = false;
  let canManageJobs = false;
  let currentUserId = null;
  let slotAnchor = null;
  let editingMeetingId = null;
  let viewingEvent = null;

  const filters = {
    jobs: true,
    meetings: true,
    assignee: "",
    source: "",
    status: "",
    mine: false,
    q: "",
  };

  function $(id) {
    return document.getElementById(id);
  }

  function notify(msg, type) {
    if (typeof window.crmNotify === "function") window.crmNotify(msg, type || "info");
    else alert(msg);
  }

  function startOfWeek(d) {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    const day = x.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    x.setDate(x.getDate() + diff);
    return x;
  }

  function startOfMonth(d) {
    return new Date(d.getFullYear(), d.getMonth(), 1);
  }

  function addDays(d, n) {
    const x = new Date(d);
    x.setDate(x.getDate() + n);
    return x;
  }

  function addMonths(d, n) {
    return new Date(d.getFullYear(), d.getMonth() + n, d.getDate());
  }

  function endOfDay(d) {
    const x = new Date(d);
    x.setHours(23, 59, 59, 999);
    return x;
  }

  function ymd(d) {
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function toLocalInput(d) {
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function escapeAttr(s) {
    return escapeHtml(s).replace(/'/g, "&#39;");
  }

  function fmtTime(d) {
    return new Date(d).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  }

  function fmtHourLabel(h) {
    if (h === 0) return "12 AM";
    if (h < 12) return `${h} AM`;
    if (h === 12) return "12 PM";
    return `${h - 12} PM`;
  }

  async function api(url, opts) {
    const r = await fetch(url, {
      credentials: "include",
      headers: { "Content-Type": "application/json", ...(opts && opts.headers) },
      ...opts,
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.success === false) throw new Error(j.error || `HTTP ${r.status}`);
    return j;
  }

  function rangeForView() {
    if (view === "day") {
      const start = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate());
      return { start, end: endOfDay(start) };
    }
    if (view === "week") {
      const start = startOfWeek(cursor);
      return { start, end: endOfDay(addDays(start, 6)) };
    }
    if (view === "agenda") {
      const start = startOfWeek(cursor);
      return { start, end: endOfDay(addDays(start, 13)) };
    }
    const start = startOfWeek(startOfMonth(cursor));
    const endMonth = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
    return { start, end: endOfDay(addDays(startOfWeek(endMonth), 6)) };
  }

  function applyFilters() {
    const q = filters.q.trim().toLowerCase();
    filtered = events.filter((ev) => {
      if (ev.type === "job" && !filters.jobs) return false;
      if (ev.type === "meeting" && !filters.meetings) return false;
      const meta = ev.meta || {};
      if (filters.assignee) {
        const aid = meta.assigned_user_id || meta.assigned_user?.id;
        if (aid !== filters.assignee) return false;
      }
      if (filters.mine && currentUserId) {
        const aid = meta.assigned_user_id || meta.assigned_user?.id;
        if (aid !== currentUserId) return false;
      }
      if (filters.source && ev.type === "job") {
        if (meta.source_type !== filters.source) return false;
      }
      if (filters.source && ev.type === "meeting") return false;
      if (filters.status && ev.type === "job") {
        if (ev.status !== filters.status) return false;
      }
      if (q) {
        const hay = [
          ev.title,
          meta.address,
          meta.location,
          meta.source_name,
          meta.notes,
          meta.customer?.name,
          meta.assigned_user?.name,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }

  async function loadEvents() {
    const { start, end } = rangeForView();
    const j = await api(
      `/api/schedule/events?from=${encodeURIComponent(start.toISOString())}&to=${encodeURIComponent(end.toISOString())}`,
    );
    events = j.data || [];
    applyFilters();
    render();
  }

  function eventsOnDay(day) {
    const a = new Date(day);
    a.setHours(0, 0, 0, 0);
    const b = endOfDay(day);
    return filtered.filter((ev) => {
      const s = new Date(ev.start);
      const e = new Date(ev.end);
      return s <= b && e >= a;
    });
  }

  function updateRangeLabel() {
    const el = $("schedRangeLabel");
    if (view === "day") {
      el.textContent = cursor.toLocaleDateString(undefined, {
        weekday: "long",
        month: "long",
        day: "numeric",
        year: "numeric",
      });
    } else if (view === "week") {
      const start = startOfWeek(cursor);
      const end = addDays(start, 6);
      if (start.getMonth() === end.getMonth()) {
        el.textContent = `${start.toLocaleDateString(undefined, { month: "long" })} ${start.getDate()} – ${end.getDate()}, ${end.getFullYear()}`;
      } else {
        el.textContent = `${start.toLocaleDateString(undefined, { month: "short", day: "numeric" })} – ${end.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`;
      }
    } else if (view === "agenda") {
      const start = startOfWeek(cursor);
      el.textContent = `Agenda · ${start.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
    } else {
      const label = cursor.toLocaleDateString(undefined, { month: "long", year: "numeric" });
      el.textContent = label.charAt(0).toUpperCase() + label.slice(1);
    }
  }

  /* —— Mini month —— */
  function renderMiniMonth() {
    const host = $("miniMonth");
    if (!host) return;
    const monthCursor = startOfMonth(cursor);
    const label = monthCursor.toLocaleDateString(undefined, { month: "long", year: "numeric" });
    const start = startOfWeek(monthCursor);
    const today = ymd(new Date());
    const selected = ymd(cursor);
    let html = `<div class="gcal-mini-head">
      <strong>${escapeHtml(label.charAt(0).toUpperCase() + label.slice(1))}</strong>
      <span>
        <button type="button" class="gcal-icon-btn" data-mini="prev" aria-label="Mês anterior">‹</button>
        <button type="button" class="gcal-icon-btn" data-mini="next" aria-label="Próximo mês">›</button>
      </span>
    </div><div class="gcal-mini-grid">`;
    ["D", "S", "T", "Q", "Q", "S", "S"].forEach((d) => {
      html += `<div class="gcal-mini-dow">${d}</div>`;
    });
    for (let i = 0; i < 42; i++) {
      const day = addDays(start, i);
      const key = ymd(day);
      const outside = day.getMonth() !== monthCursor.getMonth();
      const cls = [
        "gcal-mini-day",
        outside ? "is-outside" : "",
        key === today ? "is-today" : "",
        key === selected ? "is-selected" : "",
      ]
        .filter(Boolean)
        .join(" ");
      html += `<button type="button" class="${cls}" data-mini-day="${key}">${day.getDate()}</button>`;
    }
    html += "</div>";
    host.innerHTML = html;
    host.querySelectorAll("[data-mini]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const dir = btn.getAttribute("data-mini");
        cursor = addMonths(startOfMonth(cursor), dir === "next" ? 1 : -1);
        loadEvents().catch((e) => notify(e.message, "error"));
      });
    });
    host.querySelectorAll("[data-mini-day]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const [y, m, d] = btn.getAttribute("data-mini-day").split("-").map(Number);
        cursor = new Date(y, m - 1, d);
        if (view === "month") {
          /* stay */
        } else if (view === "agenda") {
          /* stay */
        }
        loadEvents().catch((e) => notify(e.message, "error"));
      });
    });
  }

  function minutesFromGridStart(date) {
    const d = new Date(date);
    return (d.getHours() - HOUR_START) * 60 + d.getMinutes();
  }

  function topPx(date) {
    return (minutesFromGridStart(date) / 60) * HOUR_PX;
  }

  function heightPx(start, end) {
    const mins = Math.max(15, (new Date(end) - new Date(start)) / 60000);
    return Math.max(18, (mins / 60) * HOUR_PX);
  }

  /** Pack overlapping events into side-by-side columns (Google Calendar style). */
  function packDayEvents(items) {
    if (!items.length) return;
    items.sort((a, b) => a.startMs - b.startMs || b.endMs - a.endMs || String(a.ev.title).localeCompare(String(b.ev.title)));

    let cluster = [];
    let clusterEnd = -Infinity;
    const flush = () => {
      if (!cluster.length) return;
      const colEnds = [];
      cluster.forEach((item) => {
        let col = colEnds.findIndex((end) => end <= item.startMs);
        if (col < 0) {
          col = colEnds.length;
          colEnds.push(item.endMs);
        } else {
          colEnds[col] = item.endMs;
        }
        item.col = col;
      });
      const n = Math.max(1, colEnds.length);
      cluster.forEach((item) => {
        item.colCount = n;
      });
      cluster = [];
    };

    items.forEach((item) => {
      if (!cluster.length || item.startMs < clusterEnd) {
        cluster.push(item);
        clusterEnd = Math.max(clusterEnd, item.endMs);
      } else {
        flush();
        cluster = [item];
        clusterEnd = item.endMs;
      }
    });
    flush();
  }

  function eventPlaceStyle(item) {
    // Side-by-side with a light overlap so stacked cards stay readable (GCal-like).
    const gap = 2;
    const n = Math.max(1, item.colCount);
    const col = item.col;
    const base = 100 / n;
    const overlap = n > 1 ? base * 0.22 : 0;
    const left = col * base;
    const width = Math.min(100 - left, base + overlap) - (gap * 2) / 10;
    const z = 2 + col;
    return `top:${item.top}px;height:${item.height}px;left:calc(${left}% + ${gap}px);width:calc(${width}% - ${gap}px);right:auto;z-index:${z};background:${escapeAttr(item.ev.color || (item.ev.type === "job" ? "#e8792c" : "#3b6ea5"))}`;
  }

  function nowLineHtml(day) {
    const now = new Date();
    if (ymd(now) !== ymd(day)) return "";
    if (now.getHours() < HOUR_START || now.getHours() >= HOUR_END) return "";
    const top = topPx(now);
    return `<div class="gcal-now-line" style="top:${top}px"></div>`;
  }

  function bindEventClicks(root) {
    root.querySelectorAll("[data-ev]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const [type, id] = String(btn.getAttribute("data-ev") || "").split(":");
        const ev = filtered.find((x) => x.type === type && x.id === id);
        if (ev) showEvent(ev);
      });
    });
  }

  function openSlotMenu(clientX, clientY, date) {
    slotAnchor = date;
    const menu = $("slotMenu");
    menu.hidden = false;
    const pad = 8;
    let left = clientX;
    let top = clientY;
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
    requestAnimationFrame(() => {
      const r = menu.getBoundingClientRect();
      if (r.right > window.innerWidth - pad) left = window.innerWidth - r.width - pad;
      if (r.bottom > window.innerHeight - pad) top = window.innerHeight - r.height - pad;
      menu.style.left = `${Math.max(pad, left)}px`;
      menu.style.top = `${Math.max(pad, top)}px`;
    });
    $("slotNewMeeting").style.display = canManageMeetings ? "" : "none";
    $("slotNewJob").style.display = canManageJobs ? "" : "none";
  }

  function closeSlotMenu() {
    $("slotMenu").hidden = true;
    slotAnchor = null;
  }

  function renderTimeGrid(days) {
    updateRangeLabel();
    renderMiniMonth();
    const n = days.length;
    const hours = [];
    for (let h = HOUR_START; h < HOUR_END; h++) hours.push(h);

    let html = `<div class="gcal-time-view${n === 1 ? " is-day" : ""}">`;
    html += `<div class="gcal-corner"></div>`;
    html += `<div class="gcal-days-head" style="grid-template-columns:repeat(${n},minmax(0,1fr))">`;
    const today = ymd(new Date());
    days.forEach((day) => {
      const isToday = ymd(day) === today;
      html += `<div class="gcal-day-head${isToday ? " is-today" : ""}">
        <span class="gcal-day-head__dow">${day.toLocaleDateString(undefined, { weekday: "short" })}</span>
        <span class="gcal-day-head__num">${day.getDate()}</span>
      </div>`;
    });
    html += `</div>`;

    html += `<div class="gcal-gutter">`;
    hours.forEach((h) => {
      html += `<div class="gcal-hour-label"><span>${fmtHourLabel(h)}</span></div>`;
    });
    html += `</div>`;

    html += `<div class="gcal-cols" style="grid-template-columns:repeat(${n},minmax(0,1fr))">`;
    days.forEach((day) => {
      html += `<div class="gcal-col" data-day="${ymd(day)}">`;
      hours.forEach((h) => {
        html += `<div class="gcal-hour-line" data-hour="${h}" data-day="${ymd(day)}"></div>`;
      });
      const dayEvents = eventsOnDay(day).filter((ev) => {
        const s = new Date(ev.start);
        return s.getHours() >= HOUR_START || new Date(ev.end).getHours() > HOUR_START;
      });
      const packed = [];
      dayEvents.forEach((ev) => {
        let s = new Date(ev.start);
        let e = new Date(ev.end);
        if (ymd(s) !== ymd(day)) {
          s = new Date(day);
          s.setHours(HOUR_START, 0, 0, 0);
        }
        if (ymd(e) !== ymd(day)) {
          e = endOfDay(day);
        }
        const top = Math.max(0, topPx(s));
        const hgt = heightPx(s, e);
        packed.push({
          ev,
          startMs: s.getTime(),
          endMs: Math.max(s.getTime() + 15 * 60000, e.getTime()),
          top,
          height: hgt,
          col: 0,
          colCount: 1,
        });
      });
      packDayEvents(packed);
      packed.forEach((item) => {
        html += `<button type="button" class="gcal-event is-packed" data-ev="${item.ev.type}:${item.ev.id}"
          style="${eventPlaceStyle(item)}">
          <span class="gcal-event__time">${fmtTime(item.ev.start)}</span>
          ${escapeHtml(item.ev.title)}
        </button>`;
      });
      html += nowLineHtml(day);
      html += `</div>`;
    });
    html += `</div></div>`;

    const host = $("schedCalendar");
    host.innerHTML = html;
    bindEventClicks(host);

    host.querySelectorAll(".gcal-hour-line").forEach((cell) => {
      cell.addEventListener("click", (e) => {
        if (!canManageMeetings && !canManageJobs) return;
        const dayStr = cell.getAttribute("data-day");
        const hour = Number(cell.getAttribute("data-hour"));
        const [y, m, d] = dayStr.split("-").map(Number);
        const when = new Date(y, m - 1, d, hour, 0, 0, 0);
        openSlotMenu(e.clientX, e.clientY, when);
      });
    });

    // Scroll near "now" or 8am
    const board = host.closest(".gcal-board");
    if (board) {
      const now = new Date();
      const scrollH =
        now.getHours() >= HOUR_START && now.getHours() < HOUR_END
          ? Math.max(0, topPx(now) - 80)
          : (8 - HOUR_START) * HOUR_PX;
      board.scrollTop = scrollH;
    }
  }

  function renderDay() {
    renderTimeGrid([new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate())]);
  }

  function renderWeek() {
    const start = startOfWeek(cursor);
    const days = [];
    for (let i = 0; i < 7; i++) days.push(addDays(start, i));
    renderTimeGrid(days);
  }

  function renderMonth() {
    updateRangeLabel();
    renderMiniMonth();
    const start = startOfWeek(startOfMonth(cursor));
    const today = ymd(new Date());
    const dows = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
    let html = `<div class="gcal-month">`;
    dows.forEach((d) => {
      html += `<div class="gcal-month-dow">${d}</div>`;
    });
    for (let i = 0; i < 42; i++) {
      const day = addDays(start, i);
      const key = ymd(day);
      const outside = day.getMonth() !== cursor.getMonth();
      const list = eventsOnDay(day);
      const show = list.slice(0, 3);
      const more = list.length - show.length;
      html += `<div class="gcal-month-cell${outside ? " is-outside" : ""}${key === today ? " is-today" : ""}" data-month-day="${key}">
        <div class="gcal-month-num">${day.getDate()}</div>`;
      show.forEach((ev) => {
        html += `<button type="button" class="gcal-month-pill" data-ev="${ev.type}:${ev.id}" style="background:${escapeAttr(ev.color || (ev.type === "job" ? "#e8792c" : "#3b6ea5"))}">${escapeHtml(ev.title)}</button>`;
      });
      if (more > 0) {
        html += `<button type="button" class="gcal-month-more" data-goto-day="${key}">+${more} mais</button>`;
      }
      html += `</div>`;
    }
    html += `</div>`;
    const host = $("schedCalendar");
    host.innerHTML = html;
    bindEventClicks(host);
    host.querySelectorAll("[data-goto-day]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const [y, m, d] = btn.getAttribute("data-goto-day").split("-").map(Number);
        cursor = new Date(y, m - 1, d);
        setView("day");
      });
    });
    host.querySelectorAll("[data-month-day]").forEach((cell) => {
      cell.addEventListener("dblclick", () => {
        const [y, m, d] = cell.getAttribute("data-month-day").split("-").map(Number);
        cursor = new Date(y, m - 1, d);
        setView("day");
      });
      cell.addEventListener("click", (e) => {
        if (e.target.closest("[data-ev],[data-goto-day]")) return;
        if (!canManageMeetings && !canManageJobs) return;
        const [y, m, d] = cell.getAttribute("data-month-day").split("-").map(Number);
        const when = new Date(y, m - 1, d, 9, 0, 0, 0);
        openSlotMenu(e.clientX, e.clientY, when);
      });
    });
  }

  function renderAgenda() {
    updateRangeLabel();
    renderMiniMonth();
    const start = startOfWeek(cursor);
    const today = ymd(new Date());
    let html = `<div class="gcal-agenda">`;
    let any = false;
    for (let i = 0; i < 14; i++) {
      const day = addDays(start, i);
      const list = eventsOnDay(day).sort((a, b) => a.start.localeCompare(b.start));
      if (!list.length) continue;
      any = true;
      const isToday = ymd(day) === today;
      html += `<div class="gcal-agenda-day${isToday ? " is-today" : ""}">
        <div class="gcal-agenda-day__head">
          <span class="gcal-agenda-day__num">${day.getDate()}</span>
          <span class="gcal-agenda-day__label">${day.toLocaleDateString(undefined, { weekday: "long", month: "short" })}</span>
        </div>`;
      list.forEach((ev) => {
        const meta = ev.meta || {};
        const sub =
          ev.type === "job"
            ? meta.address || meta.source_name || meta.source_type || "Job"
            : meta.location || "Meeting";
        html += `<button type="button" class="gcal-agenda-row" data-ev="${ev.type}:${ev.id}">
          <span class="gcal-agenda-row__time">${fmtTime(ev.start)} – ${fmtTime(ev.end)}</span>
          <span class="gcal-agenda-row__dot" style="background:${escapeAttr(ev.color)}"></span>
          <span>
            <span class="gcal-agenda-row__title">${escapeHtml(ev.title)}</span>
            <div class="gcal-agenda-row__meta">${escapeHtml(sub)}</div>
          </span>
        </button>`;
      });
      html += `</div>`;
    }
    if (!any) html += `<p class="gcal-agenda-empty">Nenhum evento neste período.</p>`;
    html += `</div>`;
    const host = $("schedCalendar");
    host.innerHTML = html;
    bindEventClicks(host);
  }

  function render() {
    if (view === "day") renderDay();
    else if (view === "week") renderWeek();
    else if (view === "agenda") renderAgenda();
    else renderMonth();
  }

  function setView(next) {
    view = next;
    document.querySelectorAll(".gcal-view-btn").forEach((b) => {
      b.classList.toggle("is-active", b.getAttribute("data-view") === view);
    });
    loadEvents().catch((e) => notify(e.message, "error"));
  }

  function showEvent(ev) {
    viewingEvent = ev;
    $("eventModalTitle").textContent = ev.title;
    $("eventAccent").style.background = ev.color || (ev.type === "job" ? "#e8792c" : "#3b6ea5");
    const meta = ev.meta || {};
    const when = `${new Date(ev.start).toLocaleString()} → ${new Date(ev.end).toLocaleString()}`;
    let body = `<p><strong>${ev.type === "job" ? "Job" : "Meeting"}</strong> · ${escapeHtml(ev.status)}</p>`;
    body += `<p>${escapeHtml(when)}</p>`;
    if (ev.type === "job") {
      body += `<p>${escapeHtml(meta.source_name || meta.source_type || "")}</p>`;
      if (meta.address) body += `<p>📍 ${escapeHtml(meta.address)}</p>`;
    } else if (meta.location) {
      body += `<p>📍 ${escapeHtml(meta.location)}</p>`;
    }
    if (meta.assigned_user?.name) body += `<p>👤 ${escapeHtml(meta.assigned_user.name)}</p>`;
    if (meta.notes) body += `<p>${escapeHtml(meta.notes)}</p>`;
    $("eventModalBody").innerHTML = body;

    const canEdit =
      (ev.type === "job" && canManageJobs) || (ev.type === "meeting" && canManageMeetings);
    const openJobBtn = $("btnOpenJob");
    if (openJobBtn) {
      if (ev.type === "job") {
        openJobBtn.hidden = false;
        openJobBtn.href = `job-detail.html?id=${encodeURIComponent(ev.id)}`;
      } else {
        openJobBtn.hidden = true;
        openJobBtn.removeAttribute("href");
      }
    }
    const editBtn = $("btnEditEvent");
    if (editBtn) {
      editBtn.hidden = !canEdit;
      editBtn.textContent = ev.type === "job" ? "Editar job" : "Editar meeting";
      editBtn.onclick = (e) => {
        e.preventDefault();
        closeEvent();
        if (ev.type === "job") {
          if (window.__crmJobModal) {
            window.__crmJobModal.openEdit(ev.id).catch((err) => notify(err.message, "error"));
          }
        } else {
          openMeetingModal(null, ev);
        }
      };
    }
    const delBtn = $("btnDeleteEvent");
    if (delBtn) {
      delBtn.hidden = !canEdit;
      delBtn.textContent = ev.type === "job" ? "Excluir job" : "Excluir meeting";
      delBtn.onclick = (e) => {
        e.preventDefault();
        deleteEvent(ev).catch((err) => notify(err.message, "error"));
      };
    }

    $("eventModal").hidden = false;
    $("eventBackdrop").hidden = false;
  }

  function closeEvent() {
    $("eventModal").hidden = true;
    $("eventBackdrop").hidden = true;
    viewingEvent = null;
  }

  async function deleteEvent(ev) {
    if (!ev) return;
    const label = ev.type === "job" ? "job" : "meeting";
    if (!confirm(`Excluir este ${label}? Ele será cancelado e sairá da agenda.`)) return;
    if (ev.type === "job") {
      if (!canManageJobs) return;
      await api(`/api/work-orders/${ev.id}`, { method: "DELETE" });
      notify("Job excluído.", "success");
    } else {
      if (!canManageMeetings) return;
      await api(`/api/meetings/${ev.id}`, { method: "DELETE" });
      notify("Meeting excluído.", "success");
    }
    closeEvent();
    closeMeetingModal();
    await loadEvents();
  }

  function openMeetingModal(prefStart, existing) {
    if (!canManageMeetings) return;
    editingMeetingId = existing ? existing.id : null;
    const titleEl = $("meetingModalTitle");
    if (titleEl) titleEl.textContent = editingMeetingId ? "Editar meeting" : "Novo meeting";
    const delBtn = $("btnDeleteMeeting");
    if (delBtn) delBtn.hidden = !editingMeetingId;

    if (existing) {
      const meta = existing.meta || {};
      $("mtgTitle").value = existing.title || "";
      $("mtgStart").value = toLocalInput(new Date(existing.start));
      $("mtgEnd").value = toLocalInput(new Date(existing.end));
      $("mtgLocation").value = meta.location || "";
      $("mtgNotes").value = meta.notes || "";
      $("mtgAssignee").value = meta.assigned_user_id || meta.assigned_user?.id || "";
    } else {
      const now = prefStart ? new Date(prefStart) : new Date();
      now.setMinutes(0, 0, 0);
      if (!prefStart) now.setHours(now.getHours() + 1);
      const end = new Date(now);
      end.setHours(end.getHours() + 1);
      $("mtgTitle").value = "";
      $("mtgStart").value = toLocalInput(now);
      $("mtgEnd").value = toLocalInput(end);
      $("mtgLocation").value = "";
      $("mtgNotes").value = "";
      $("mtgAssignee").value = "";
    }

    $("meetingModal").classList.add("is-open");
    $("meetingBackdrop").classList.add("is-open");
    closeSlotMenu();
    closeCreateMenu();
  }

  function closeMeetingModal() {
    $("meetingModal").classList.remove("is-open");
    $("meetingBackdrop").classList.remove("is-open");
    editingMeetingId = null;
    const delBtn = $("btnDeleteMeeting");
    if (delBtn) delBtn.hidden = true;
  }

  function closeCreateMenu() {
    const m = $("createMenu");
    if (m) m.hidden = true;
    const b = $("btnCreate");
    if (b) b.setAttribute("aria-expanded", "false");
  }

  function readFiltersFromDom() {
    filters.jobs = $("filterJobs").checked;
    filters.meetings = $("filterMeetings").checked;
    filters.assignee = $("filterAssignee").value;
    filters.source = $("filterSource").value;
    filters.status = $("filterStatus").value;
    filters.mine = $("filterMine").checked;
    filters.q = $("filterQ").value;
    applyFilters();
    render();
  }

  /* —— Map / distances —— */
  const geoCache = new Map();
  let mapsApiReady = null;
  let mapEngine = null; // "google" | "leaflet"
  let mapInstance = null;
  let mapMarkers = [];
  let mapPolyline = null;
  let mapSelection = [];
  let mapPoints = [];
  let leafletLayer = null;

  function eventAddress(ev) {
    const meta = ev.meta || {};
    return String(meta.address || meta.location || "").trim();
  }

  function haversineKm(a, b) {
    const R = 6371;
    const toRad = (d) => (d * Math.PI) / 180;
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);
    const lat1 = toRad(a.lat);
    const lat2 = toRad(b.lat);
    const h =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  }

  function fmtKm(km) {
    if (km == null || Number.isNaN(km)) return "—";
    if (km < 1) return `${Math.round(km * 1000)} m`;
    return `${km.toFixed(km < 10 ? 1 : 0)} km`;
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      if ([...document.querySelectorAll("script[src]")].some((s) => s.src === src || (s.getAttribute("src") || "") === src)) {
        resolve();
        return;
      }
      const el = document.createElement("script");
      el.src = src;
      el.async = true;
      el.onload = () => resolve();
      el.onerror = () => reject(new Error(`Falha ao carregar ${src}`));
      document.head.appendChild(el);
    });
  }

  function loadStylesheet(href) {
    if ([...document.querySelectorAll('link[rel="stylesheet"]')].some((l) => (l.getAttribute("href") || "").includes(href.split("?")[0]))) {
      return;
    }
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    document.head.appendChild(link);
  }

  async function ensureLeaflet() {
    loadStylesheet("https://unpkg.com/leaflet@1.9.4/dist/leaflet.css");
    if (!window.L) {
      await loadScript("https://unpkg.com/leaflet@1.9.4/dist/leaflet.js");
    }
    return window.L;
  }

  function googleMapsReady() {
    return !!(window.google && window.google.maps && typeof window.google.maps.Map === "function");
  }

  function loadGoogleMapsOnce(key) {
    return new Promise((resolve, reject) => {
      if (googleMapsReady()) {
        resolve();
        return;
      }

      const existing = document.querySelector('script[src*="maps.googleapis.com/maps/api/js"]');
      if (existing) {
        let settled = false;
        const done = (ok, err) => {
          if (settled) return;
          settled = true;
          if (ok) resolve();
          else reject(err || new Error("Falha ao carregar Google Maps"));
        };
        existing.addEventListener("load", () => done(googleMapsReady()));
        existing.addEventListener("error", () => done(false));
        let n = 0;
        const t = setInterval(() => {
          n += 1;
          if (googleMapsReady()) {
            clearInterval(t);
            done(true);
          } else if (n > 60) {
            clearInterval(t);
            done(false, new Error("Timeout Google Maps"));
          }
        }, 100);
        return;
      }

      const cb = `__schedMapsInit_${Date.now()}`;
      window[cb] = () => {
        try {
          delete window[cb];
        } catch (_) {}
        if (googleMapsReady()) resolve();
        else reject(new Error("Google Maps API indisponível"));
      };
      window.gm_authFailure = () => {
        reject(new Error("Chave Google Maps inválida ou restrita (gm_authFailure)"));
      };
      const s = document.createElement("script");
      s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&libraries=places&callback=${cb}`;
      s.async = true;
      s.onerror = () => reject(new Error("Falha ao carregar Google Maps"));
      document.head.appendChild(s);
    });
  }

  async function ensureMapEngine() {
    if (mapEngine === "google" && googleMapsReady()) return "google";
    if (mapEngine === "leaflet" && window.L) return "leaflet";
    if (mapsApiReady) return mapsApiReady;

    mapsApiReady = (async () => {
      try {
        // Reuse the shared CRM loader so we never inject Maps twice
        // (address autocomplete already loads it on Schedule).
        if (typeof window.sfEnsureCrmAddressAutocomplete === "function") {
          const ok = await window.sfEnsureCrmAddressAutocomplete(false);
          if (ok && googleMapsReady()) {
            mapEngine = "google";
            return "google";
          }
        }

        let key = null;
        try {
          const cfg = await api("/api/config/ui");
          key = cfg.data?.googleMapsJsKey ? String(cfg.data.googleMapsJsKey).trim() : null;
        } catch (_) {}

        if (key) {
          await loadGoogleMapsOnce(key);
          if (googleMapsReady()) {
            mapEngine = "google";
            return "google";
          }
        }
      } catch (err) {
        console.warn("[schedule] Google Maps indisponível, a usar OpenStreetMap", err);
        mapsApiReady = null;
      }

      await ensureLeaflet();
      mapEngine = "leaflet";
      return "leaflet";
    })();

    try {
      return await mapsApiReady;
    } catch (err) {
      mapsApiReady = null;
      await ensureLeaflet();
      mapEngine = "leaflet";
      return "leaflet";
    }
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  async function geocodeNominatim(address) {
    const url =
      "https://nominatim.openstreetmap.org/search?format=json&limit=1&q=" + encodeURIComponent(address);
    const r = await fetch(url, {
      headers: { Accept: "application/json" },
    });
    if (!r.ok) return null;
    const rows = await r.json();
    if (!Array.isArray(rows) || !rows[0]) return null;
    return {
      lat: Number(rows[0].lat),
      lng: Number(rows[0].lon),
      formatted: rows[0].display_name || address,
    };
  }

  function geocodeGoogle(address) {
    return new Promise((resolve) => {
      const geocoder = new window.google.maps.Geocoder();
      geocoder.geocode({ address }, (results, status) => {
        if (status === "OK" && results && results[0]) {
          const loc = results[0].geometry.location;
          resolve({
            lat: loc.lat(),
            lng: loc.lng(),
            formatted: results[0].formatted_address,
          });
        } else {
          resolve(null);
        }
      });
    });
  }

  async function geocodeAddress(address) {
    const key = address.toLowerCase();
    if (geoCache.has(key)) return geoCache.get(key);
    let pt = null;
    try {
      if (mapEngine === "google") pt = await geocodeGoogle(address);
      else pt = await geocodeNominatim(address);
    } catch (_) {
      pt = null;
    }
    geoCache.set(key, pt);
    if (mapEngine === "leaflet") await sleep(1100); // Nominatim courtesy rate limit
    return pt;
  }

  async function buildMapPoints() {
    const withAddr = filtered
      .map((ev) => ({ ev, address: eventAddress(ev) }))
      .filter((x) => x.address);
    const points = [];
    for (const row of withAddr) {
      const geo = await geocodeAddress(row.address);
      points.push({
        key: `${row.ev.type}:${row.ev.id}`,
        ev: row.ev,
        address: row.address,
        lat: geo?.lat ?? null,
        lng: geo?.lng ?? null,
        formatted: geo?.formatted || row.address,
      });
    }
    return points;
  }

  function clearMapOverlays() {
    if (mapEngine === "google") {
      mapMarkers.forEach((m) => m.setMap(null));
    } else if (mapEngine === "leaflet" && leafletLayer) {
      mapMarkers.forEach((m) => {
        try {
          leafletLayer.removeLayer(m);
        } catch (_) {}
      });
    }
    mapMarkers = [];
    clearLineOnly();
  }

  function clearMarkersOnly() {
    if (mapEngine === "google") {
      mapMarkers.forEach((m) => m.setMap(null));
    } else if (mapEngine === "leaflet" && leafletLayer) {
      mapMarkers.forEach((m) => {
        try {
          leafletLayer.removeLayer(m);
        } catch (_) {}
      });
    }
    mapMarkers = [];
  }

  function focusMapPoint(pt) {
    if (!pt || pt.lat == null) return;
    if (mapEngine === "google" && mapInstance) {
      mapInstance.panTo({ lat: pt.lat, lng: pt.lng });
      mapInstance.setZoom(Math.max(mapInstance.getZoom() || 11, 13));
    } else if (mapEngine === "leaflet" && mapInstance) {
      mapInstance.setView([pt.lat, pt.lng], Math.max(mapInstance.getZoom() || 11, 13));
    }
  }

  function updateMapSelectionUi() {
    $("mapList")
      ?.querySelectorAll("[data-map-key]")
      .forEach((el) => {
        el.classList.toggle("is-selected", mapSelection.includes(el.getAttribute("data-map-key")));
      });

    const hint = $("mapHint");
    if (mapSelection.length === 2) {
      const a = mapPoints.find((p) => p.key === mapSelection[0]);
      const b = mapPoints.find((p) => p.key === mapSelection[1]);
      if (a?.lat != null && b?.lat != null) {
        const km = haversineKm(a, b);
        if (hint) hint.textContent = `Distância em linha reta: ${fmtKm(km)} · ${a.ev.title} → ${b.ev.title}`;
        drawPairLine(a, b);
        return;
      }
    }
    if (hint) {
      hint.textContent =
        mapSelection.length === 1
          ? "Selecione outro evento para medir a distância."
          : "Eventos com endereço aparecem no mapa. Selecione dois na lista para medir a distância.";
    }
    clearLineOnly();
  }

  function clearLineOnly() {
    if (mapEngine === "google" && mapPolyline) {
      mapPolyline.setMap(null);
      mapPolyline = null;
    } else if (mapEngine === "leaflet" && mapPolyline && leafletLayer) {
      leafletLayer.removeLayer(mapPolyline);
      mapPolyline = null;
    }
  }

  function drawPairLine(a, b) {
    clearLineOnly();
    if (mapEngine === "google" && mapInstance) {
      mapPolyline = new window.google.maps.Polyline({
        path: [
          { lat: a.lat, lng: a.lng },
          { lat: b.lat, lng: b.lng },
        ],
        geodesic: true,
        strokeColor: "#1d4ed8",
        strokeOpacity: 0.85,
        strokeWeight: 3,
        map: mapInstance,
      });
      return;
    }
    if (mapEngine === "leaflet" && leafletLayer) {
      mapPolyline = window.L.polyline(
        [
          [a.lat, a.lng],
          [b.lat, b.lng],
        ],
        { color: "#1d4ed8", weight: 3, opacity: 0.85 },
      ).addTo(leafletLayer);
    }
  }

  function drawDayRoute(dayPoints) {
    const ok = dayPoints.filter((p) => p.lat != null);
    if (ok.length < 2) return;
    clearLineOnly();
    if (mapEngine === "google" && mapInstance) {
      mapPolyline = new window.google.maps.Polyline({
        path: ok.map((p) => ({ lat: p.lat, lng: p.lng })),
        geodesic: true,
        strokeColor: "#e8792c",
        strokeOpacity: 0.75,
        strokeWeight: 3,
        map: mapInstance,
      });
      return;
    }
    if (mapEngine === "leaflet" && leafletLayer) {
      mapPolyline = window.L.polyline(
        ok.map((p) => [p.lat, p.lng]),
        { color: "#e8792c", weight: 3, opacity: 0.75 },
      ).addTo(leafletLayer);
    }
  }

  function renderMapList(points) {
    const list = $("mapList");
    if (!list) return;
    if (!points.length) {
      list.innerHTML =
        '<p class="sched-map-empty">Nenhum evento com endereço no período/filtros atuais. Adicione endereço nos jobs ou local nos meetings.</p>';
      return;
    }

    const byDay = new Map();
    points
      .slice()
      .sort((a, b) => String(a.ev.start).localeCompare(String(b.ev.start)))
      .forEach((p) => {
        const day = ymd(new Date(p.ev.start));
        if (!byDay.has(day)) byDay.set(day, []);
        byDay.get(day).push(p);
      });

    let html = "";
    byDay.forEach((dayPts, day) => {
      const [y, m, d] = day.split("-").map(Number);
      const label = new Date(y, m - 1, d).toLocaleDateString(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
      });
      html += `<p class="sched-map-list__day">${escapeHtml(label)}</p>`;
      let dayTotal = 0;
      let prev = null;
      dayPts.forEach((p, idx) => {
        let leg = null;
        if (prev && prev.lat != null && p.lat != null) {
          leg = haversineKm(prev, p);
          dayTotal += leg;
        }
        const missing = p.lat == null;
        html += `<button type="button" class="sched-map-list__item${missing ? " is-missing" : ""}" data-map-key="${escapeAttr(p.key)}">
          <span class="sched-map-list__title">${idx + 1}. ${escapeHtml(p.ev.title)}</span>
          <div class="sched-map-list__meta">${escapeHtml(fmtTime(p.ev.start))} · ${escapeHtml(p.address)}</div>
          ${leg != null ? `<div class="sched-map-list__dist">→ ${fmtKm(leg)} do anterior</div>` : ""}
          ${missing ? `<div class="sched-map-list__meta">Endereço não encontrado no mapa</div>` : ""}
        </button>`;
        if (!missing) prev = p;
      });
      const geocoded = dayPts.filter((p) => p.lat != null).length;
      if (geocoded >= 2) {
        html += `<div class="sched-map-list__total">Rota do dia · ~${fmtKm(dayTotal)} (linha reta)</div>`;
      }
    });
    list.innerHTML = html;

    list.querySelectorAll("[data-map-key]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const key = btn.getAttribute("data-map-key");
        const pt = mapPoints.find((p) => p.key === key);
        if (!pt || pt.lat == null) {
          notify("Sem coordenadas para este endereço.", "warning");
          return;
        }
        if (mapSelection.includes(key)) {
          mapSelection = mapSelection.filter((k) => k !== key);
        } else if (mapSelection.length >= 2) {
          mapSelection = [key];
        } else {
          mapSelection = [...mapSelection, key];
        }
        focusMapPoint(pt);
        updateMapSelectionUi();
      });
    });

    for (const dayPts of byDay.values()) {
      const ok = dayPts.filter((p) => p.lat != null);
      if (ok.length >= 2) {
        drawDayRoute(ok);
        const hint = $("mapHint");
        if (hint) {
          hint.textContent =
            "Linha laranja: sequência do dia por horário. Clique em dois eventos para medir um trecho.";
        }
        break;
      }
    }
  }

  function placeMarkers(points) {
    clearMarkersOnly();
    if (mapEngine === "google" && mapInstance) {
      const maps = window.google.maps;
      const bounds = new maps.LatLngBounds();
      let any = false;
      points.forEach((p, i) => {
        if (p.lat == null) return;
        any = true;
        const marker = new maps.Marker({
          map: mapInstance,
          position: { lat: p.lat, lng: p.lng },
          title: p.ev.title,
          label: {
            text: String(i + 1),
            color: "#fff",
            fontWeight: "700",
            fontSize: "11px",
          },
        });
        marker.addListener("click", () => {
          const btn = [...($("mapList")?.querySelectorAll("[data-map-key]") || [])].find(
            (el) => el.getAttribute("data-map-key") === p.key,
          );
          btn?.click();
        });
        mapMarkers.push(marker);
        bounds.extend({ lat: p.lat, lng: p.lng });
      });
      if (any) {
        if (mapMarkers.length === 1) {
          mapInstance.setCenter(bounds.getCenter());
          mapInstance.setZoom(13);
        } else {
          mapInstance.fitBounds(bounds, 48);
        }
      }
      return;
    }

    if (mapEngine === "leaflet" && mapInstance && leafletLayer) {
      const latLngs = [];
      points.forEach((p, i) => {
        if (p.lat == null) return;
        const marker = window.L.marker([p.lat, p.lng], {
          title: p.ev.title,
        }).bindTooltip(`${i + 1}. ${p.ev.title}`, { permanent: false });
        marker.on("click", () => {
          const btn = [...($("mapList")?.querySelectorAll("[data-map-key]") || [])].find(
            (el) => el.getAttribute("data-map-key") === p.key,
          );
          btn?.click();
        });
        marker.addTo(leafletLayer);
        mapMarkers.push(marker);
        latLngs.push([p.lat, p.lng]);
      });
      if (latLngs.length === 1) {
        mapInstance.setView(latLngs[0], 13);
      } else if (latLngs.length > 1) {
        mapInstance.fitBounds(latLngs, { padding: [40, 40] });
      }
    }
  }

  async function openMapPanel() {
    $("mapPanel").hidden = false;
    $("mapBackdrop").hidden = false;
    $("mapPanelSub").textContent = `Período da vista atual · ${filtered.length} evento(s) filtrado(s)`;
    $("mapHint").textContent = "A carregar mapa…";
    $("mapList").innerHTML = '<p class="sched-map-empty">A geocodificar endereços…</p>';
    mapSelection = [];

    try {
      const engine = await ensureMapEngine();
      const canvas = $("schedMapCanvas");

      if (engine === "google") {
        if (!mapInstance || mapEngine !== "google" || !(mapInstance instanceof window.google.maps.Map)) {
          canvas.innerHTML = "";
          mapInstance = new window.google.maps.Map(canvas, {
            center: { lat: 39.8283, lng: -98.5795 },
            zoom: 4,
            mapTypeControl: false,
            streetViewControl: false,
            fullscreenControl: true,
          });
          requestAnimationFrame(() => {
            try {
              window.google.maps.event.trigger(mapInstance, "resize");
            } catch (_) {}
          });
        } else {
          window.google.maps.event.trigger(mapInstance, "resize");
        }
      } else {
        if (!mapInstance || mapEngine !== "leaflet" || !window.L || !(mapInstance instanceof window.L.Map)) {
          canvas.innerHTML = "";
          mapInstance = window.L.map(canvas, { scrollWheelZoom: true }).setView([39.8283, -98.5795], 4);
          window.L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
            maxZoom: 19,
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
          }).addTo(mapInstance);
          leafletLayer = window.L.layerGroup().addTo(mapInstance);
        }
        setTimeout(() => mapInstance.invalidateSize(), 50);
      }

      const engineLabel = engine === "google" ? "Google Maps" : "OpenStreetMap";
      $("mapPanelSub").textContent = `Período da vista atual · ${filtered.length} evento(s) · ${engineLabel}`;

      mapPoints = await buildMapPoints();
      placeMarkers(mapPoints.filter((p) => p.lat != null));
      renderMapList(mapPoints);
      if (!mapPoints.some((p) => p.lat != null)) {
        $("mapHint").textContent = "Nenhum endereço geocodificado. Verifique os endereços dos eventos.";
      }
    } catch (err) {
      $("mapList").innerHTML = `<p class="sched-map-empty">${escapeHtml(err.message || "Erro no mapa")}</p>`;
      $("mapHint").textContent = err.message || "Erro no mapa";
      notify(err.message || "Erro no mapa", "error");
    }
  }

  function closeMapPanel() {
    $("mapPanel").hidden = true;
    $("mapBackdrop").hidden = true;
    mapSelection = [];
  }

  async function boot() {
    try {
      const s = await api("/api/auth/session");
      if (!s.authenticated) {
        location.href = "/login.html";
        return;
      }
      const perms = s.user?.permissions || [];
      const role = s.user?.role || "";
      currentUserId = s.user?.id || null;
      canManageMeetings = role === "admin" || perms.includes("schedule.manage");
      canManageJobs = role === "admin" || perms.includes("work_orders.manage");
      window.__crmPermissionKeys = perms;
      window.__crmUserRole = role;
      $("sidebarUserName").textContent = s.user?.name || s.user?.email || "—";
      $("sidebarUserRole").textContent = role || "";
      if (!canManageMeetings && !canManageJobs) {
        $("btnCreate").style.display = "none";
      } else if (!canManageMeetings) {
        $("menuNewMeeting").style.display = "none";
      }
      if (!canManageJobs) {
        const mj = $("menuNewJob");
        if (mj) mj.style.display = "none";
      }

      if (window.__crmJobModal) {
        await window.__crmJobModal.ready.catch(() => {});
        window.__crmJobModal.onSaved(() => loadEvents().catch(() => {}));
      }

      const users = await api("/api/users?limit=100").catch(() => ({ data: [] }));
      const userList = (users.data || []).filter((u) => u.is_active !== 0 && u.status !== "disabled");
      ["mtgAssignee", "filterAssignee"].forEach((selId) => {
        const sel = $(selId);
        userList.forEach((u) => {
          const opt = document.createElement("option");
          opt.value = u.id;
          opt.textContent = u.name || u.email;
          sel.appendChild(opt);
        });
      });

      $("btnPrev").addEventListener("click", () => {
        if (view === "day") cursor = addDays(cursor, -1);
        else if (view === "week" || view === "agenda") cursor = addDays(cursor, -7);
        else cursor = addMonths(cursor, -1);
        loadEvents().catch((e) => notify(e.message, "error"));
      });
      $("btnNext").addEventListener("click", () => {
        if (view === "day") cursor = addDays(cursor, 1);
        else if (view === "week" || view === "agenda") cursor = addDays(cursor, 7);
        else cursor = addMonths(cursor, 1);
        loadEvents().catch((e) => notify(e.message, "error"));
      });
      $("btnToday").addEventListener("click", () => {
        cursor = new Date();
        cursor.setHours(0, 0, 0, 0);
        loadEvents().catch((e) => notify(e.message, "error"));
      });
      document.querySelectorAll(".gcal-view-btn").forEach((btn) => {
        btn.addEventListener("click", () => setView(btn.getAttribute("data-view") || "week"));
      });

      $("btnCreate").addEventListener("click", (e) => {
        e.stopPropagation();
        const m = $("createMenu");
        const open = m.hidden;
        m.hidden = !open;
        $("btnCreate").setAttribute("aria-expanded", open ? "true" : "false");
      });
      $("menuNewMeeting").addEventListener("click", () => openMeetingModal());
      $("menuNewJob")?.addEventListener("click", () => {
        closeCreateMenu();
        closeSlotMenu();
        if (!window.__crmJobModal) {
          notify("Modal de jobs indisponível.", "error");
          return;
        }
        window.__crmJobModal.openCreate().catch((err) => notify(err.message, "error"));
      });
      document.addEventListener("click", () => {
        closeCreateMenu();
        closeSlotMenu();
      });
      $("createMenu").addEventListener("click", (e) => e.stopPropagation());
      $("slotMenu").addEventListener("click", (e) => e.stopPropagation());
      $("slotNewMeeting").addEventListener("click", () => {
        if (slotAnchor) openMeetingModal(slotAnchor);
        else openMeetingModal();
      });
      $("slotNewJob")?.addEventListener("click", () => {
        const when = slotAnchor;
        closeSlotMenu();
        if (!window.__crmJobModal) {
          notify("Modal de jobs indisponível.", "error");
          return;
        }
        window.__crmJobModal.openCreate(when ? { start: when } : {}).catch((err) => notify(err.message, "error"));
      });

      $("btnOpenMap")?.addEventListener("click", () => openMapPanel().catch((e) => notify(e.message, "error")));
      $("btnCloseMap")?.addEventListener("click", closeMapPanel);
      $("mapBackdrop")?.addEventListener("click", closeMapPanel);

      $("btnCloseEvent").addEventListener("click", closeEvent);
      $("btnCloseEvent2").addEventListener("click", closeEvent);
      $("eventBackdrop").addEventListener("click", closeEvent);
      $("btnCancelMeeting").addEventListener("click", closeMeetingModal);
      $("meetingBackdrop").addEventListener("click", closeMeetingModal);
      $("btnDeleteMeeting")?.addEventListener("click", () => {
        if (!editingMeetingId) return;
        const ev =
          viewingEvent && viewingEvent.type === "meeting" && viewingEvent.id === editingMeetingId
            ? viewingEvent
            : { type: "meeting", id: editingMeetingId };
        deleteEvent(ev).catch((err) => notify(err.message, "error"));
      });

      ["filterJobs", "filterMeetings", "filterAssignee", "filterSource", "filterStatus", "filterMine"].forEach(
        (id) => {
          $(id).addEventListener("change", readFiltersFromDom);
        },
      );
      let qTimer;
      $("filterQ").addEventListener("input", () => {
        clearTimeout(qTimer);
        qTimer = setTimeout(readFiltersFromDom, 200);
      });

      $("meetingForm").addEventListener("submit", async (e) => {
        e.preventDefault();
        try {
          const start = new Date($("mtgStart").value);
          const end = new Date($("mtgEnd").value);
          const payload = {
            title: $("mtgTitle").value.trim(),
            scheduled_start: start.toISOString(),
            scheduled_end: end.toISOString(),
            location: $("mtgLocation").value.trim() || null,
            notes: $("mtgNotes").value.trim() || null,
            assigned_user_id: $("mtgAssignee").value || null,
          };
          if (editingMeetingId) {
            await api(`/api/meetings/${editingMeetingId}`, {
              method: "PUT",
              body: JSON.stringify(payload),
            });
            notify("Meeting atualizado.", "success");
          } else {
            await api("/api/meetings", {
              method: "POST",
              body: JSON.stringify(payload),
            });
            notify("Meeting criado.", "success");
          }
          closeMeetingModal();
          await loadEvents();
        } catch (err) {
          notify(err.message || "Erro", "error");
        }
      });

      const rail = $("gcalRail");
      const backdrop = $("gcalRailBackdrop");
      $("btnToggleCalSidebar")?.addEventListener("click", () => {
        rail.classList.toggle("is-open");
        backdrop.hidden = !rail.classList.contains("is-open");
      });
      backdrop?.addEventListener("click", () => {
        rail.classList.remove("is-open");
        backdrop.hidden = true;
      });

      await loadEvents();
    } catch (err) {
      notify(err.message || "Falha ao carregar", "error");
      location.href = "/login.html";
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
