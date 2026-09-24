(function () {
  let view = "month";
  let cursor = startOfMonth(new Date());
  let events = [];
  let canManageMeetings = false;

  function $(id) {
    return document.getElementById(id);
  }

  function notify(msg, type) {
    if (typeof window.crmNotify === "function") window.crmNotify(msg, type || "info");
    else alert(msg);
  }

  function startOfMonth(d) {
    return new Date(d.getFullYear(), d.getMonth(), 1);
  }

  function addMonths(d, n) {
    return new Date(d.getFullYear(), d.getMonth() + n, 1);
  }

  function startOfWeek(d) {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    const day = x.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    x.setDate(x.getDate() + diff);
    return x;
  }

  function addDays(d, n) {
    const x = new Date(d);
    x.setDate(x.getDate() + n);
    return x;
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
    if (view === "week") {
      const start = startOfWeek(cursor);
      const end = endOfDay(addDays(start, 6));
      return { start, end };
    }
    const start = startOfWeek(startOfMonth(cursor));
    const endMonth = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
    const end = endOfDay(addDays(startOfWeek(endMonth), 6));
    return { start, end };
  }

  async function loadEvents() {
    const { start, end } = rangeForView();
    const j = await api(
      `/api/schedule/events?from=${encodeURIComponent(start.toISOString())}&to=${encodeURIComponent(end.toISOString())}`,
    );
    events = j.data || [];
    render();
  }

  function eventsOnDay(day) {
    const a = new Date(day);
    a.setHours(0, 0, 0, 0);
    const b = endOfDay(day);
    return events.filter((ev) => {
      const s = new Date(ev.start);
      const e = new Date(ev.end);
      return s <= b && e >= a;
    });
  }

  function renderMonth() {
    const label = cursor.toLocaleDateString(undefined, { month: "long", year: "numeric" });
    $("schedRangeLabel").textContent = label.charAt(0).toUpperCase() + label.slice(1);

    const start = startOfWeek(startOfMonth(cursor));
    const days = [];
    for (let i = 0; i < 42; i++) days.push(addDays(start, i));

    const dows = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    let html = '<div class="sched-month-grid">';
    dows.forEach((d) => {
      html += `<div class="sched-dow">${d}</div>`;
    });
    const today = ymd(new Date());
    days.forEach((day) => {
      const outside = day.getMonth() !== cursor.getMonth();
      const isToday = ymd(day) === today;
      const list = eventsOnDay(day).slice(0, 4);
      html += `<div class="sched-day${outside ? " is-outside" : ""}${isToday ? " is-today" : ""}">`;
      html += `<div class="sched-day-num">${day.getDate()}</div>`;
      list.forEach((ev) => {
        html += `<button type="button" class="sched-pill sched-pill--${ev.type}" data-ev="${ev.type}:${ev.id}" style="background:${escapeAttr(ev.color)}">${escapeHtml(ev.title)}</button>`;
      });
      html += "</div>";
    });
    html += "</div>";
    $("schedCalendar").innerHTML = html;
    bindEventButtons();
  }

  function renderWeek() {
    const start = startOfWeek(cursor);
    const end = addDays(start, 6);
    $("schedRangeLabel").textContent = `${start.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    })} – ${end.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`;

    const hours = [];
    for (let h = 7; h <= 19; h++) hours.push(h);

    let html = '<div class="sched-week">';
    html += '<div class="sched-week-head"></div>';
    for (let i = 0; i < 7; i++) {
      const d = addDays(start, i);
      html += `<div class="sched-week-head">${d.toLocaleDateString(undefined, {
        weekday: "short",
        day: "numeric",
      })}</div>`;
    }

    hours.forEach((h) => {
      html += `<div class="sched-week-gutter">${String(h).padStart(2, "0")}:00</div>`;
      for (let i = 0; i < 7; i++) {
        const day = addDays(start, i);
        const cellStart = new Date(day);
        cellStart.setHours(h, 0, 0, 0);
        const cellEnd = new Date(day);
        cellEnd.setHours(h + 1, 0, 0, 0);
        const cellEvents = events.filter((ev) => {
          const s = new Date(ev.start);
          const e = new Date(ev.end);
          return s < cellEnd && e > cellStart && ymd(s) === ymd(day);
        });
        html += `<div class="sched-week-cell">`;
        cellEvents.forEach((ev) => {
          const s = new Date(ev.start);
          const topPct = ((s.getMinutes() || 0) / 60) * 100;
          html += `<button type="button" class="sched-week-event" data-ev="${ev.type}:${ev.id}" style="top:${topPct}%;background:${escapeAttr(ev.color)}">${escapeHtml(ev.title)}</button>`;
        });
        html += `</div>`;
      }
    });
    html += "</div>";
    $("schedCalendar").innerHTML = html;
    bindEventButtons();
  }

  function render() {
    if (view === "week") renderWeek();
    else renderMonth();
  }

  function bindEventButtons() {
    $("schedCalendar").querySelectorAll("[data-ev]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const [type, id] = String(btn.getAttribute("data-ev") || "").split(":");
        const ev = events.find((e) => e.type === type && e.id === id);
        if (ev) showEvent(ev);
      });
    });
  }

  function showEvent(ev) {
    $("eventModalTitle").textContent = ev.title;
    const meta = ev.meta || {};
    const when = `${new Date(ev.start).toLocaleString()} → ${new Date(ev.end).toLocaleString()}`;
    let body = `<p><strong>Tipo:</strong> ${ev.type === "job" ? "Job" : "Meeting"}</p>`;
    body += `<p><strong>Quando:</strong> ${when}</p>`;
    body += `<p><strong>Status:</strong> ${escapeHtml(ev.status)}</p>`;
    if (ev.type === "job") {
      body += `<p><strong>Origem:</strong> ${escapeHtml(meta.source_name || meta.source_type || "—")}</p>`;
      body += `<p><strong>Endereço:</strong> ${escapeHtml(meta.address || "—")}</p>`;
      $("btnOpenJob").hidden = false;
      $("btnOpenJob").href = `jobs.html`;
      $("btnOpenJob").onclick = () => {
        sessionStorage.setItem("obramate_open_job", ev.id);
      };
    } else {
      body += `<p><strong>Local:</strong> ${escapeHtml(meta.location || "—")}</p>`;
      $("btnOpenJob").hidden = true;
    }
    if (meta.assigned_user?.name) {
      body += `<p><strong>Responsável:</strong> ${escapeHtml(meta.assigned_user.name)}</p>`;
    }
    if (meta.notes) body += `<p><strong>Notas:</strong> ${escapeHtml(meta.notes)}</p>`;
    $("eventModalBody").innerHTML = body;
    $("eventModal").classList.add("is-open");
    $("eventBackdrop").classList.add("is-open");
  }

  function closeEvent() {
    $("eventModal").classList.remove("is-open");
    $("eventBackdrop").classList.remove("is-open");
  }

  function openMeetingModal() {
    if (!canManageMeetings) return;
    const now = new Date();
    now.setMinutes(0, 0, 0);
    now.setHours(now.getHours() + 1);
    const end = new Date(now);
    end.setHours(end.getHours() + 1);
    $("mtgTitle").value = "";
    $("mtgStart").value = toLocalInput(now);
    $("mtgEnd").value = toLocalInput(end);
    $("mtgLocation").value = "";
    $("mtgNotes").value = "";
    $("meetingModal").classList.add("is-open");
    $("meetingBackdrop").classList.add("is-open");
  }

  function closeMeetingModal() {
    $("meetingModal").classList.remove("is-open");
    $("meetingBackdrop").classList.remove("is-open");
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

  async function boot() {
    try {
      const s = await api("/api/auth/session");
      if (!s.authenticated) {
        location.href = "/login.html";
        return;
      }
      const perms = s.user?.permissions || [];
      const role = s.user?.role || "";
      canManageMeetings = role === "admin" || perms.includes("schedule.manage");
      window.__crmPermissionKeys = perms;
      window.__crmUserRole = role;
      $("sidebarUserName").textContent = s.user?.name || s.user?.email || "—";
      $("sidebarUserRole").textContent = role || "";
      if (!canManageMeetings) $("btnNewMeeting").style.display = "none";

      const users = await api("/api/users?limit=100").catch(() => ({ data: [] }));
      const sel = $("mtgAssignee");
      (users.data || [])
        .filter((u) => u.is_active !== 0 && u.status !== "disabled")
        .forEach((u) => {
          const opt = document.createElement("option");
          opt.value = u.id;
          opt.textContent = u.name || u.email;
          sel.appendChild(opt);
        });

      $("btnPrev").addEventListener("click", () => {
        cursor = view === "week" ? addDays(cursor, -7) : addMonths(cursor, -1);
        loadEvents().catch((e) => notify(e.message, "error"));
      });
      $("btnNext").addEventListener("click", () => {
        cursor = view === "week" ? addDays(cursor, 7) : addMonths(cursor, 1);
        loadEvents().catch((e) => notify(e.message, "error"));
      });
      $("btnToday").addEventListener("click", () => {
        cursor = startOfMonth(new Date());
        if (view === "week") cursor = new Date();
        loadEvents().catch((e) => notify(e.message, "error"));
      });
      document.querySelectorAll(".sched-view-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
          document.querySelectorAll(".sched-view-btn").forEach((b) => b.classList.remove("is-active"));
          btn.classList.add("is-active");
          view = btn.getAttribute("data-view") || "month";
          loadEvents().catch((e) => notify(e.message, "error"));
        });
      });
      $("btnCloseEvent").addEventListener("click", closeEvent);
      $("eventBackdrop").addEventListener("click", closeEvent);
      $("btnNewMeeting").addEventListener("click", openMeetingModal);
      $("btnCancelMeeting").addEventListener("click", closeMeetingModal);
      $("meetingBackdrop").addEventListener("click", closeMeetingModal);
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

      await loadEvents();
    } catch (err) {
      notify(err.message || "Falha ao carregar", "error");
      location.href = "/login.html";
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
