/**
 * Campo · Minhas horas (Fase 4)
 */
(function () {
  const VER = "20260925-campo4";
  const $ = (id) => document.getElementById(id);

  let state = null;
  let seg = "ponto";
  let mType = "hours";
  let mDay = null;
  let mJob = null;
  let mAct = "on_site";
  let mMinutes = 60;
  let mSqft = 100;

  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  async function api(path, opts) {
    const res = await fetch(path, {
      credentials: "same-origin",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      ...opts,
    });
    const json = await res.json().catch(() => ({}));
    if (res.status === 401) {
      location.href = "/login.html";
      throw new Error("unauth");
    }
    if (!res.ok || json.success === false) {
      throw new Error(json.error || `HTTP ${res.status}`);
    }
    return json;
  }

  function toast(msg, type) {
    if (window.crmToast?.show) window.crmToast.show(msg, { type: type || "error" });
    else alert(msg);
  }

  function formatDur(mins) {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return `${h}h ${String(m).padStart(2, "0")}m`;
  }

  function apply(data) {
    state = data;
    render();
  }

  function render() {
    if (!state) return;
    $("cmHorasWeek").textContent = `Semana ${state.range_label}`;
    $("cmHorasTotal").textContent = state.totals.hours_label;
    $("cmHorasProd").textContent = state.totals.production_label;
    $("cmHorasPay").textContent = state.totals.pay_label;
    const st = $("cmWeekStatus");
    st.textContent = state.status_label;
    st.className =
      "cm-badge " + (state.status === "submitted" ? "cm-badge--sched" : "cm-badge--draft");

    $("cmLegend").style.display = seg === "ponto" ? "" : "none";
    $("cmManualBtn").disabled = !state.can_edit;
    $("cmSubmitWeek").disabled = !state.can_submit;
    $("cmSubmitWeek").textContent =
      state.status === "submitted"
        ? "Semana enviada"
        : "Enviar semana para aprovação";

    if (seg === "prod") {
      const jobs = state.production_jobs || [];
      if (!jobs.length) {
        $("cmHorasDays").innerHTML =
          '<p class="cm-subtitle" style="margin:0.5rem 0">Sem produção nesta semana.</p>';
        return;
      }
      $("cmHorasDays").innerHTML = jobs
        .map(
          (j) => `
        <article class="cm-hours-day">
          <div class="cm-hours-day__top">
            <p class="cm-hours-day__date">${escapeHtml(j.title)}</p>
            <p class="cm-hours-day__total">${Number(j.sqft).toLocaleString("en-US")} ft²</p>
          </div>
          <p class="cm-hours-day__sub">#${j.number ?? "—"} · ${escapeHtml(j.client)}</p>
        </article>`,
        )
        .join("");
      return;
    }

    const days = state.days || [];
    if (!days.length) {
      $("cmHorasDays").innerHTML =
        '<p class="cm-subtitle" style="margin:0.5rem 0">Sem horas nesta semana. Use + para lançamento manual.</p>';
      return;
    }
    $("cmHorasDays").innerHTML = days
      .map((d) => {
        const b = d.bar || { obra: 100, travel: 0, shop: 0 };
        return `
        <article class="cm-hours-day">
          <div class="cm-hours-day__top">
            <p class="cm-hours-day__date">${escapeHtml(d.label)}</p>
            <p class="cm-hours-day__total">${escapeHtml(d.total)}</p>
          </div>
          <p class="cm-hours-day__sub">${escapeHtml(d.sub)}</p>
          <div class="cm-bar" aria-hidden="true">
            <span class="cm-bar__seg cm-bar__seg--obra" style="width:${b.obra}%"></span>
            <span class="cm-bar__seg cm-bar__seg--travel" style="width:${b.travel}%"></span>
            <span class="cm-bar__seg cm-bar__seg--shop" style="width:${b.shop}%"></span>
          </div>
        </article>`;
      })
      .join("");
  }

  function chipHtml(items, selected, dataAttr) {
    return (items || [])
      .map((it) => {
        const id = it.id || it.ymd;
        const label = it.label;
        const on = id === selected ? " is-selected" : "";
        return `<button type="button" class="cm-chip${on}" data-${dataAttr}="${escapeHtml(id)}">${escapeHtml(label)}</button>`;
      })
      .join("");
  }

  function renderManualForm() {
    const form = state?.form || { days: [], jobs: [], activities: [] };
    if (!mDay && form.days.length) mDay = form.days[form.days.length - 1].ymd;
    if (!mJob && form.jobs.length) mJob = form.jobs[0].id;
    $("cmManualDays").innerHTML = chipHtml(form.days, mDay, "day");
    $("cmManualJobs").innerHTML = chipHtml(form.jobs, mJob, "job");
    $("cmManualActs").innerHTML = chipHtml(form.activities, mAct, "act");
    $("cmDurValue").textContent = formatDur(mMinutes);
    $("cmSqftValue").textContent = String(mSqft);

    const hoursMode = mType === "hours";
    $("cmManualActBlock").hidden = !hoursMode;
    $("cmManualDurBlock").hidden = !hoursMode;
    $("cmManualSqftBlock").hidden = hoursMode;
    $("cmManualObraBlock").hidden = false;
  }

  function openManual() {
    if (!state?.can_edit) return;
    mType = "hours";
    mMinutes = 60;
    mSqft = 100;
    document.querySelectorAll("#cmManualType .cm-seg__btn").forEach((b) => {
      const on = b.getAttribute("data-mtype") === "hours";
      b.classList.toggle("is-active", on);
    });
    $("cmManualReason").value = "";
    renderManualForm();
    $("cmManualBackdrop").hidden = false;
    $("cmManualSheet").hidden = false;
    document.body.classList.add("cm-sheet-open");
  }

  function closeManual() {
    $("cmManualBackdrop").hidden = true;
    $("cmManualSheet").hidden = true;
    document.body.classList.remove("cm-sheet-open");
  }

  function bind() {
    document.querySelectorAll(".cm-seg__btn[data-seg]").forEach((btn) => {
      btn.addEventListener("click", () => {
        seg = btn.getAttribute("data-seg") || "ponto";
        document.querySelectorAll(".cm-seg__btn[data-seg]").forEach((b) => {
          const on = b === btn;
          b.classList.toggle("is-active", on);
          b.setAttribute("aria-selected", on ? "true" : "false");
        });
        render();
      });
    });

    $("cmManualBtn")?.addEventListener("click", openManual);
    $("cmManualClose")?.addEventListener("click", closeManual);
    $("cmManualBackdrop")?.addEventListener("click", closeManual);

    document.querySelectorAll("#cmManualType .cm-seg__btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        mType = btn.getAttribute("data-mtype") || "hours";
        document.querySelectorAll("#cmManualType .cm-seg__btn").forEach((b) => {
          b.classList.toggle("is-active", b === btn);
        });
        renderManualForm();
      });
    });

    $("cmManualDays")?.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-day]");
      if (!btn) return;
      mDay = btn.getAttribute("data-day");
      renderManualForm();
    });
    $("cmManualJobs")?.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-job]");
      if (!btn) return;
      mJob = btn.getAttribute("data-job");
      renderManualForm();
    });
    $("cmManualActs")?.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-act]");
      if (!btn) return;
      mAct = btn.getAttribute("data-act");
      renderManualForm();
    });

    $("cmDurMinus")?.addEventListener("click", () => {
      mMinutes = Math.max(15, mMinutes - 15);
      $("cmDurValue").textContent = formatDur(mMinutes);
    });
    $("cmDurPlus")?.addEventListener("click", () => {
      mMinutes = Math.min(24 * 60, mMinutes + 15);
      $("cmDurValue").textContent = formatDur(mMinutes);
    });
    $("cmSqftMinus")?.addEventListener("click", () => {
      mSqft = Math.max(10, mSqft - 10);
      $("cmSqftValue").textContent = String(mSqft);
    });
    $("cmSqftPlus")?.addEventListener("click", () => {
      mSqft = Math.min(50000, mSqft + 10);
      $("cmSqftValue").textContent = String(mSqft);
    });

    $("cmManualSubmit")?.addEventListener("click", async () => {
      if (!mDay) {
        toast("Escolha o dia");
        return;
      }
      const payload = {
        entry_type: mType,
        work_date: mDay,
        work_order_id: mJob,
        reason: ($("cmManualReason").value || "").trim() || null,
        week: state?.week_start,
      };
      if (mType === "hours") {
        payload.activity_kind = mAct;
        payload.duration_minutes = mMinutes;
      } else {
        payload.sqft = mSqft;
      }
      try {
        const json = await api("/api/campo/horas/manual", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        apply(json.data);
        closeManual();
        toast("Lançamento enviado", "success");
      } catch (err) {
        toast(err.message || "Falha ao lançar");
      }
    });

    $("cmSubmitWeek")?.addEventListener("click", async () => {
      if (!state?.can_submit) return;
      if (!confirm("Enviar a semana para aprovação do escritório?")) return;
      try {
        const json = await api("/api/campo/horas/submit-week", {
          method: "POST",
          body: JSON.stringify({ week: state.week_start }),
        });
        apply(json.data);
        toast("Semana enviada", "success");
      } catch (err) {
        toast(err.message || "Falha ao enviar");
      }
    });
  }

  async function init() {
    bind();
    try {
      const json = await api("/api/campo/horas");
      apply(json.data);
    } catch (err) {
      console.warn("[campo/horas]", err);
      $("cmHorasDays").innerHTML =
        '<p class="cm-subtitle">Não foi possível carregar as horas.</p>';
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  window.__campoHoras = { VER };
})();
