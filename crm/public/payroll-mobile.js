/**
 * Folha mobile overlay — periods, preview cards, approve CTA.
 * Uses /api/construction-payroll; desktop UI stays in payroll-module.js.
 */
(function () {
  const CP = "/api/construction-payroll";
  const MONTHS_SHORT = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
  const AV_COLORS = ["#ffe4e6", "#dcfce7", "#e0e7ff", "#fef3c7", "#fce7f3", "#e0f2fe"];

  let periods = [];
  let selectedId = null;
  let preview = null;
  let pendingBank = 0;
  let filter = "all";
  let canManage = false;
  let employees = [];
  let dailyWho = "roster"; // roster | avulso
  let dailyEmpId = null;
  let dailyQty = 1;
  let avulsoSector = "installation";

  function isMobile() {
    return window.__omDevice && typeof window.__omDevice.isMobile === "function"
      ? window.__omDevice.isMobile()
      : false;
  }

  function money(n) {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(n) || 0);
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function initials(name) {
    const parts = String(name || "")
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    if (!parts.length) return "—";
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  function formatRange(start, end) {
    if (!start || !end) return "—";
    const a = new Date(start + "T12:00:00");
    const b = new Date(end + "T12:00:00");
    if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return "—";
    const mon = MONTHS_SHORT[a.getMonth()];
    return `${a.getDate()} – ${b.getDate()} ${mon}`;
  }

  function payDateHint(end) {
    if (!end) return "—";
    const d = new Date(end + "T12:00:00");
    if (Number.isNaN(d.getTime())) return "—";
    d.setDate(d.getDate() + 5);
    const days = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
    return `Paga ${days[d.getDay()]}, ${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`;
  }

  async function api(method, path, body) {
    const opts = {
      method,
      credentials: "include",
      headers: { "Content-Type": "application/json" },
    };
    if (body != null) opts.body = JSON.stringify(body);
    const r = await fetch(CP + path, opts);
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.success === false) {
      const err = new Error(j.error || r.statusText || "Erro");
      err.status = r.status;
      throw err;
    }
    return j;
  }

  function selectedPeriod() {
    return periods.find((p) => String(p.id) === String(selectedId)) || null;
  }

  function paymentTypeLabel(pt) {
    const t = String(pt || "").toLowerCase();
    if (t === "hourly") return "Por hora";
    if (t === "mixed") return "Misto";
    return "Diária";
  }

  function employeeMeta(row) {
    const pt = String(row.payment_type || "daily").toLowerCase();
    const sector =
      row.sector === "sand_finish" ? "Sand & Finish" : row.sector === "installation" ? "Instalação" : "Equipe";
    return `${sector} · ${paymentTypeLabel(pt)}`;
  }

  function volumeMeta(row) {
    const days = Number(row.days_worked_sum) || 0;
    const hours = Number(row.regular_hours_sum) || 0;
    const ot = Number(row.overtime_hours_sum) || 0;
    const pt = String(row.payment_type || "daily").toLowerCase();
    if (pt === "hourly") {
      const totalH = hours + ot;
      return `${totalH.toFixed(1)} h${ot ? ` · ${ot.toFixed(1)} OT` : ""}`;
    }
    return `${days} diária${days === 1 ? "" : "s"}${hours ? ` · ${hours.toFixed(1)} h` : ""}`;
  }

  function filteredEmployees() {
    const rows = (preview && preview.by_employee) || [];
    const open = selectedPeriod()?.status !== "closed";
    return rows.filter((r) => {
      const pt = String(r.payment_type || "daily").toLowerCase();
      const total = Number(r.employee_total != null ? r.employee_total : r.subtotal) || 0;
      if (filter === "pending") return open && total > 0;
      if (filter === "daily") return pt === "daily" || pt === "mixed";
      if (filter === "hourly") return pt === "hourly";
      return true;
    });
  }

  function renderPeriods() {
    const host = document.getElementById("payMobPeriods");
    if (!host) return;
    const sorted = periods
      .slice()
      .sort((a, b) => String(b.end_date || "").localeCompare(String(a.end_date || "")));
    const pair = sorted.slice(0, 2);
    if (!pair.length) {
      host.innerHTML = `<p class="fpm-empty" style="margin:0.5rem;grid-column:1/-1">Sem períodos. Toque + para criar.</p>`;
      return;
    }
    if (!selectedId || !pair.some((p) => String(p.id) === String(selectedId))) {
      const open = pair.find((p) => p.status !== "closed");
      selectedId = String((open || pair[0]).id);
    }
    host.innerHTML = pair
      .map((p) => {
        const active = String(p.id) === String(selectedId);
        const meta = p.status === "closed" ? "Pago" : "Em aberto";
        return `<button type="button" class="fpm-period-btn${active ? " is-active" : ""}" data-pay-period="${escapeHtml(p.id)}">
          <span class="fpm-period-btn__range">${escapeHtml(formatRange(p.start_date, p.end_date))}</span>
          <span class="fpm-period-btn__meta">${escapeHtml(meta)}</span>
        </button>`;
      })
      .join("");
    host.querySelectorAll("[data-pay-period]").forEach((btn) => {
      btn.addEventListener("click", () => {
        selectedId = btn.getAttribute("data-pay-period");
        loadPreview().catch((e) => window.crmToast?.error?.(e.message));
      });
    });
  }

  function renderHero() {
    const p = selectedPeriod();
    const total = Number(preview?.grand_total) || 0;
    const rows = preview?.by_employee || [];
    const open = !p || p.status !== "closed";
    const approvedCount = open ? 0 : rows.length;
    const pendingCount = open ? rows.filter((r) => (Number(r.employee_total ?? r.subtotal) || 0) > 0).length : 0;
    const approvedAmt = open ? 0 : total;
    const pct = total > 0 ? Math.round((approvedAmt / total) * 100) : open ? 0 : 100;

    const tot = document.getElementById("payMobTotal");
    if (tot) tot.textContent = money(total);
    const st = document.getElementById("payMobStatus");
    if (st) {
      st.textContent = open ? "Em aberto" : "Pago";
      st.className = `fpm-badge ${open ? "fpm-badge--open" : "fpm-badge--paid"}`;
    }
    const fill = document.getElementById("payMobProgress");
    if (fill) fill.style.width = `${pct}%`;
    const pl = document.getElementById("payMobProgressLabel");
    if (pl) {
      pl.textContent = open
        ? `$0 de ${money(total)} aprovado`
        : `${money(approvedAmt)} de ${money(total)} aprovado`;
    }
    const pd = document.getElementById("payMobPayDate");
    if (pd) pd.textContent = payDateHint(p?.end_date);

    const steps = document.getElementById("payMobSteps");
    if (steps) {
      const children = [...steps.querySelectorAll(".fpm-step")];
      children.forEach((el) => el.classList.remove("is-active"));
      if (!open) {
        children.forEach((el) => el.classList.add("is-active"));
      } else if (pendingBank > 0 || pendingCount > 0) {
        children[0]?.classList.add("is-active");
      } else {
        children[0]?.classList.add("is-active");
        children[1]?.classList.add("is-active");
      }
    }

    const alert = document.getElementById("payMobAlert");
    const waiting = pendingBank > 0 ? pendingBank : open ? pendingCount : 0;
    if (alert) {
      if (waiting > 0 && open) {
        alert.hidden = false;
        const t = document.getElementById("payMobAlertTitle");
        if (t) {
          t.textContent =
            pendingBank > 0
              ? `${pendingBank} lançamento${pendingBank === 1 ? "" : "s"} no banco de horas`
              : `${waiting} lançamento${waiting === 1 ? "" : "s"} aguardando`;
        }
      } else {
        alert.hidden = true;
      }
    }

    const fab = document.getElementById("payMobFabBar");
    const fabBtn = document.getElementById("payMobApproveAll");
    if (fab && fabBtn) {
      const show = canManage && open && (pendingBank > 0 || pendingCount > 0);
      fab.classList.toggle("is-visible", show);
      if (pendingBank > 0) fabBtn.textContent = `Aprovar banco (${pendingBank})`;
      else fabBtn.textContent = `Fechar período (${pendingCount})`;
    }

    const addDaily = document.getElementById("payMobAddDaily");
    if (addDaily) {
      addDaily.hidden = !(canManage && open && selectedId);
    }
  }

  function renderEmployees() {
    const host = document.getElementById("payMobEmpList");
    if (!host) return;
    const rows = filteredEmployees();
    const open = selectedPeriod()?.status !== "closed";
    if (!rows.length) {
      host.innerHTML = `<p class="fpm-empty">Nenhum colaborador neste filtro.</p>`;
      return;
    }
    host.innerHTML = rows
      .map((r, i) => {
        const total = Number(r.employee_total != null ? r.employee_total : r.subtotal) || 0;
        const status = open ? "Pendente" : "Aprovado";
        const statusCls = open ? "fpm-status--pending" : "fpm-status--ok";
        const bg = AV_COLORS[i % AV_COLORS.length];
        return `<article class="fpm-emp__card">
          <div class="fpm-emp__top">
            <span class="fpm-emp__av" style="background:${bg}">${escapeHtml(initials(r.name))}</span>
            <div style="min-width:0;flex:1">
              <p class="fpm-emp__name">${escapeHtml(r.name || "—")}</p>
              <p class="fpm-emp__role">${escapeHtml(employeeMeta(r))}</p>
            </div>
            <p class="fpm-emp__amt">${money(total)}</p>
          </div>
          <div class="fpm-emp__foot">
            <p class="fpm-emp__meta">${escapeHtml(volumeMeta(r))}</p>
            <span class="fpm-status ${statusCls}">${status}</span>
          </div>
        </article>`;
      })
      .join("");
  }

  function renderAll() {
    renderPeriods();
    renderHero();
    renderEmployees();
  }

  async function loadPendingBank() {
    if (!canManage) {
      pendingBank = 0;
      return;
    }
    try {
      const r = await fetch(`${CP}/hour-bank?status=pending`, { credentials: "include" });
      const j = await r.json().catch(() => ({}));
      const rows = j.data || [];
      pendingBank = Array.isArray(rows) ? rows.length : 0;
    } catch (_) {
      pendingBank = 0;
    }
  }

  async function loadPreview() {
    renderPeriods();
    if (!selectedId) {
      preview = null;
      renderHero();
      renderEmployees();
      return;
    }
    const j = await api("GET", `/periods/${selectedId}/preview`);
    preview = j.data || j;
    renderAll();
  }

  async function loadPeriods() {
    const j = await api("GET", "/periods");
    periods = j.data || [];
    const sorted = periods
      .slice()
      .sort((a, b) => String(b.end_date || "").localeCompare(String(a.end_date || "")));
    const open = sorted.find((p) => p.status !== "closed");
    selectedId = String((open || sorted[0] || {}).id || "") || null;
    await loadPendingBank();
    await loadPreview();
  }

  async function approveAll() {
    if (!canManage) return;
    if (pendingBank > 0) {
      location.hash = "hub-aprovar-banco";
      document.getElementById("hub-aprovar-banco")?.scrollIntoView({ behavior: "smooth" });
      // reveal desktop section briefly if needed — on mobile we navigate to approve via hash
      try {
        const r = await fetch(`${CP}/hour-bank?status=pending`, { credentials: "include" });
        const j = await r.json();
        const rows = j.data || [];
        for (const row of rows) {
          await fetch(`${CP}/hour-bank/${row.id}/approve`, {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: "{}",
          });
        }
        window.crmToast?.success?.("Banco de horas aprovado");
        await loadPendingBank();
        await loadPreview();
      } catch (e) {
        window.crmToast?.error?.(e.message || "Erro ao aprovar");
      }
      return;
    }
    if (!selectedId) return;
    if (!confirm("Fechar este período de folha?")) return;
    try {
      await api("POST", `/periods/${selectedId}/close`);
      window.crmToast?.success?.("Período fechado");
      await loadPeriods();
    } catch (e) {
      window.crmToast?.error?.(e.message || "Erro ao fechar");
    }
  }

  async function loadEmployees() {
    try {
      const j = await api("GET", "/employees");
      employees = (j.data || []).filter((e) => String(e.status || "active") === "active");
    } catch (_) {
      employees = [];
    }
  }

  function closeSheets() {
    ["payMobActionSheet", "payMobDailySheet", "payMobActionBackdrop", "payMobDailyBackdrop"].forEach(
      (id) => {
        const el = document.getElementById(id);
        if (el) el.hidden = true;
      },
    );
    document.body.classList.remove("fpm-sheet-open");
  }

  function openActionSheet() {
    if (!canManage) {
      window.crmToast?.info?.("Sem permissão para gerir a folha.");
      return;
    }
    closeSheets();
    document.getElementById("payMobActionBackdrop").hidden = false;
    document.getElementById("payMobActionSheet").hidden = false;
    document.body.classList.add("fpm-sheet-open");
  }

  function openPeriodPicker() {
    closeSheets();
    const btn = document.getElementById("btnOpenPeriodPicker") || document.getElementById("btnNewPeriod");
    if (btn) btn.click();
    else window.crmToast?.info?.("Crie o período na secção Horas (desktop).");
  }

  function periodDateBounds() {
    const p = selectedPeriod();
    if (!p) return { min: "", max: "", def: "" };
    const today = new Date();
    const ymd = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    let def = ymd;
    if (p.start_date && def < p.start_date) def = p.start_date;
    if (p.end_date && def > p.end_date) def = p.end_date;
    return { min: p.start_date || "", max: p.end_date || "", def };
  }

  function renderDailyEmpChips() {
    const host = document.getElementById("payMobDailyEmpChips");
    const empty = document.getElementById("payMobDailyEmpEmpty");
    if (!host) return;
    const list = employees.slice().sort((a, b) => String(a.name).localeCompare(String(b.name)));
    if (!list.length) {
      host.innerHTML = "";
      if (empty) empty.hidden = false;
      dailyEmpId = null;
      return;
    }
    if (empty) empty.hidden = true;
    if (!dailyEmpId || !list.some((e) => String(e.id) === String(dailyEmpId))) {
      dailyEmpId = String(list[0].id);
    }
    host.innerHTML = list
      .map((e) => {
        const on = String(e.id) === String(dailyEmpId);
        const rate = Number(e.daily_rate) || 0;
        return `<button type="button" class="fpm-chip${on ? " is-active" : ""}" data-daily-emp="${escapeHtml(e.id)}">
          ${escapeHtml(e.name)}${rate ? ` · ${money(rate)}` : ""}
        </button>`;
      })
      .join("");
    host.querySelectorAll("[data-daily-emp]").forEach((btn) => {
      btn.addEventListener("click", () => {
        dailyEmpId = btn.getAttribute("data-daily-emp");
        renderDailyEmpChips();
      });
    });
  }

  function syncDailyWhoUi() {
    document.querySelectorAll("[data-daily-who]").forEach((b) => {
      b.classList.toggle("is-active", b.getAttribute("data-daily-who") === dailyWho);
    });
    const roster = document.getElementById("payMobDailyRosterBlock");
    const avulso = document.getElementById("payMobDailyAvulsoBlock");
    if (roster) roster.hidden = dailyWho !== "roster";
    if (avulso) avulso.hidden = dailyWho !== "avulso";
  }

  async function openDailySheet() {
    if (!canManage) return;
    if (!selectedId) {
      window.crmToast?.info?.("Crie ou selecione um período primeiro.");
      openPeriodPicker();
      return;
    }
    const p = selectedPeriod();
    if (p?.status === "closed") {
      window.crmToast?.error?.("Período fechado — reabra para lançar.");
      return;
    }
    closeSheets();
    await loadEmployees();
    dailyWho = "roster";
    dailyQty = 1;
    avulsoSector = "installation";
    document.querySelectorAll("[data-daily-qty]").forEach((b) => {
      b.classList.toggle("is-active", Number(b.getAttribute("data-daily-qty")) === 1);
    });
    document.querySelectorAll("[data-av-sector]").forEach((b) => {
      b.classList.toggle("is-active", b.getAttribute("data-av-sector") === "installation");
    });
    const bounds = periodDateBounds();
    const dateInp = document.getElementById("payMobDailyDate");
    if (dateInp) {
      dateInp.min = bounds.min || "";
      dateInp.max = bounds.max || "";
      dateInp.value = bounds.def || "";
    }
    const ov = document.getElementById("payMobDailyOverride");
    if (ov) ov.value = "";
    const notes = document.getElementById("payMobDailyNotes");
    if (notes) notes.value = "";
    const an = document.getElementById("payMobAvulsoName");
    if (an) an.value = "";
    const ar = document.getElementById("payMobAvulsoRate");
    if (ar) ar.value = "";
    const sub = document.getElementById("payMobDailySub");
    if (sub && p) sub.textContent = `Semana ${formatRange(p.start_date, p.end_date)}`;
    syncDailyWhoUi();
    renderDailyEmpChips();
    document.getElementById("payMobDailyBackdrop").hidden = false;
    document.getElementById("payMobDailySheet").hidden = false;
    document.body.classList.add("fpm-sheet-open");
  }

  async function submitDaily() {
    if (!selectedId) return;
    const dateInp = document.getElementById("payMobDailyDate");
    const workDate = dateInp?.value;
    if (!workDate) {
      window.crmToast?.error?.("Escolha a data do trabalho");
      return;
    }
    const overrideRaw = document.getElementById("payMobDailyOverride")?.value;
    const override =
      overrideRaw != null && String(overrideRaw).trim() !== "" ? Number(overrideRaw) : null;
    const notes = (document.getElementById("payMobDailyNotes")?.value || "").trim() || null;

    let employeeId = dailyEmpId;
    try {
      const btn = document.getElementById("payMobDailySubmit");
      if (btn) {
        btn.disabled = true;
        btn.textContent = "A lançar…";
      }

      if (dailyWho === "avulso") {
        const name = (document.getElementById("payMobAvulsoName")?.value || "").trim();
        const rate = Number(document.getElementById("payMobAvulsoRate")?.value);
        if (!name) {
          window.crmToast?.error?.("Informe o nome do avulso");
          return;
        }
        if (!Number.isFinite(rate) || rate < 0) {
          window.crmToast?.error?.("Informe o valor da diária");
          return;
        }
        const created = await api("POST", "/employees", {
          name,
          payment_type: "daily",
          daily_rate: rate,
          hourly_rate: 0,
          overtime_rate: 0,
          sector: avulsoSector,
          role_title: "Avulso",
          status: "active",
        });
        employeeId = created.data?.id;
        if (!employeeId) throw new Error("Falha ao criar avulso");
      } else if (!employeeId) {
        window.crmToast?.error?.("Escolha um funcionário");
        return;
      }

      const body = {
        employee_id: employeeId,
        work_date: workDate,
        days_worked: dailyQty,
        regular_hours: 0,
        overtime_hours: 0,
        notes: notes || (dailyWho === "avulso" ? "Diária avulso (mobile)" : "Diária (mobile)"),
      };
      if (override != null && Number.isFinite(override)) {
        body.daily_rate_override = override;
      }

      await api("POST", `/periods/${selectedId}/timesheets`, body);
      closeSheets();
      window.crmToast?.success?.("Diária lançada");
      await loadEmployees();
      await loadPreview();
      if (typeof window.loadTimesheetsForPeriod === "function") {
        try {
          await window.loadTimesheetsForPeriod();
        } catch (_) {}
      }
    } catch (e) {
      window.crmToast?.error?.(e.message || "Falha ao lançar diária");
    } finally {
      const btn = document.getElementById("payMobDailySubmit");
      if (btn) {
        btn.disabled = false;
        btn.textContent = "Lançar diária";
      }
    }
  }

  function bind() {
    document.querySelectorAll("[data-pay-filter]").forEach((btn) => {
      btn.addEventListener("click", () => {
        filter = btn.getAttribute("data-pay-filter") || "all";
        document.querySelectorAll("[data-pay-filter]").forEach((b) => {
          b.classList.toggle("is-active", b.getAttribute("data-pay-filter") === filter);
        });
        renderEmployees();
      });
    });
    document.getElementById("payMobApproveAll")?.addEventListener("click", () => approveAll());
    document.getElementById("payMobAlert")?.addEventListener("click", () => {
      if (pendingBank > 0) location.hash = "hub-aprovar-banco";
      else document.getElementById("payMobApproveAll")?.click();
    });
    document.getElementById("payMobAdd")?.addEventListener("click", () => openActionSheet());
    document.getElementById("payMobAddDaily")?.addEventListener("click", () => openDailySheet());
    document.getElementById("payMobActionDaily")?.addEventListener("click", () => openDailySheet());
    document.getElementById("payMobActionPeriod")?.addEventListener("click", () => openPeriodPicker());
    document.getElementById("payMobActionBackdrop")?.addEventListener("click", () => closeSheets());
    document.getElementById("payMobDailyBackdrop")?.addEventListener("click", () => closeSheets());
    document.getElementById("payMobDailyClose")?.addEventListener("click", () => closeSheets());
    document.getElementById("payMobDailySubmit")?.addEventListener("click", () => submitDaily());

    document.querySelectorAll("[data-daily-who]").forEach((btn) => {
      btn.addEventListener("click", () => {
        dailyWho = btn.getAttribute("data-daily-who") || "roster";
        syncDailyWhoUi();
      });
    });
    document.querySelectorAll("[data-daily-qty]").forEach((btn) => {
      btn.addEventListener("click", () => {
        dailyQty = Number(btn.getAttribute("data-daily-qty")) || 1;
        document.querySelectorAll("[data-daily-qty]").forEach((b) => {
          b.classList.toggle("is-active", Number(b.getAttribute("data-daily-qty")) === dailyQty);
        });
      });
    });
    document.querySelectorAll("[data-av-sector]").forEach((btn) => {
      btn.addEventListener("click", () => {
        avulsoSector = btn.getAttribute("data-av-sector") || "installation";
        document.querySelectorAll("[data-av-sector]").forEach((b) => {
          b.classList.toggle("is-active", b.getAttribute("data-av-sector") === avulsoSector);
        });
      });
    });
  }

  async function boot() {
    if (!isMobile()) return;
    if (!document.getElementById("payMobile")) return;
    try {
      const s = await fetch("/api/auth/session", { credentials: "include" }).then((r) => r.json());
      if (!s.authenticated) {
        location.href = "/login.html";
        return;
      }
      const role = String(s.user?.role || "").toLowerCase();
      const perms = s.user?.permissions || [];
      canManage =
        role === "admin" || perms.includes("payroll.manage") || perms.includes("payroll.view");
      bind();
      await loadEmployees();
      await loadPeriods();
    } catch (e) {
      window.crmToast?.error?.(e.message || "Erro ao carregar folha");
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
