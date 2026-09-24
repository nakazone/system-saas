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
    if (canManageJobs) {
      sessionStorage.setItem("obramate_job_pref_start", date.toISOString());
    }
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
        html += `<button type="button" class="gcal-event" data-ev="${ev.type}:${ev.id}"
          style="top:${top}px;height:${hgt}px;background:${escapeAttr(ev.color || (ev.type === "job" ? "#e8792c" : "#039be5"))}">
          <span class="gcal-event__time">${fmtTime(ev.start)}</span>
          ${escapeHtml(ev.title)}
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
        html += `<button type="button" class="gcal-month-pill" data-ev="${ev.type}:${ev.id}" style="background:${escapeAttr(ev.color || (ev.type === "job" ? "#e8792c" : "#039be5"))}">${escapeHtml(ev.title)}</button>`;
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
    $("eventModalTitle").textContent = ev.title;
    $("eventAccent").style.background = ev.color || (ev.type === "job" ? "#e8792c" : "#039be5");
    const meta = ev.meta || {};
    const when = `${new Date(ev.start).toLocaleString()} → ${new Date(ev.end).toLocaleString()}`;
    let body = `<p><strong>${ev.type === "job" ? "Job" : "Meeting"}</strong> · ${escapeHtml(ev.status)}</p>`;
    body += `<p>${escapeHtml(when)}</p>`;
    if (ev.type === "job") {
      body += `<p>${escapeHtml(meta.source_name || meta.source_type || "")}</p>`;
      if (meta.address) body += `<p>📍 ${escapeHtml(meta.address)}</p>`;
      $("btnOpenJob").hidden = false;
      $("btnOpenJob").href = "jobs.html";
      $("btnOpenJob").onclick = () => sessionStorage.setItem("obramate_open_job", ev.id);
    } else {
      if (meta.location) body += `<p>📍 ${escapeHtml(meta.location)}</p>`;
      $("btnOpenJob").hidden = true;
    }
    if (meta.assigned_user?.name) body += `<p>👤 ${escapeHtml(meta.assigned_user.name)}</p>`;
    if (meta.notes) body += `<p>${escapeHtml(meta.notes)}</p>`;
    $("eventModalBody").innerHTML = body;
    $("eventModal").hidden = false;
    $("eventBackdrop").hidden = false;
  }

  function closeEvent() {
    $("eventModal").hidden = true;
    $("eventBackdrop").hidden = true;
  }

  function openMeetingModal(prefStart) {
    if (!canManageMeetings) return;
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
    $("meetingModal").classList.add("is-open");
    $("meetingBackdrop").classList.add("is-open");
    closeSlotMenu();
    closeCreateMenu();
  }

  function closeMeetingModal() {
    $("meetingModal").classList.remove("is-open");
    $("meetingBackdrop").classList.remove("is-open");
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

      $("btnCloseEvent").addEventListener("click", closeEvent);
      $("btnCloseEvent2").addEventListener("click", closeEvent);
      $("eventBackdrop").addEventListener("click", closeEvent);
      $("btnCancelMeeting").addEventListener("click", closeMeetingModal);
      $("meetingBackdrop").addEventListener("click", closeMeetingModal);

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
          await api("/api/meetings", {
            method: "POST",
            body: JSON.stringify({
              title: $("mtgTitle").value.trim(),
              scheduled_start: start.toISOString(),
              scheduled_end: end.toISOString(),
              location: $("mtgLocation").value.trim() || null,
              notes: $("mtgNotes").value.trim() || null,
              assigned_user_id: $("mtgAssignee").value || null,
            }),
          });
          notify("Meeting criado.", "success");
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
