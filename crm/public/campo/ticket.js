/**
 * Campo · Ticket — status, checklist, fotos (Fase 3)
 */
(function () {
  const VER = "20260925-campo3";
  const $ = (id) => document.getElementById(id);

  let jobId = null;
  let ticket = null;
  let tab = "details";

  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function mapsUrl(address) {
    return `https://maps.apple.com/?q=${encodeURIComponent(address || "")}`;
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

  function toast(msg) {
    if (window.crmToast?.show) window.crmToast.show(msg, { type: "error" });
    else alert(msg);
  }

  function renderHero() {
    const t = ticket;
    $("cmTicketTitle").textContent = `Ticket #${t.number ?? "—"}`;
    $("cmTicketWhen").textContent = t.when_label || "—";
    $("cmTicketBadge").textContent = t.field_status_label || "—";
    $("cmTicketJob").textContent = t.title || "—";
    const sqft =
      t.sqft_total > 0
        ? ` · ${Number(t.sqft_total).toLocaleString("en-US")} sq ft`
        : "";
    $("cmTicketSub").textContent = `${t.client || "—"}${sqft}`;
    $("cmTicketAddr").textContent = t.address || "Sem endereço";
    const nav = $("cmTicketNav");
    if (t.address) {
      nav.href = mapsUrl(t.address);
      nav.style.pointerEvents = "";
    } else {
      nav.removeAttribute("href");
      nav.style.pointerEvents = "none";
    }

    $("cmStepper").innerHTML = (t.stepper || [])
      .map(
        (s) => `
      <div class="cm-stepper__item${s.active ? " is-active" : ""}${s.done && !s.active ? " is-done" : ""}">
        <span class="cm-stepper__bar"></span>
        <span class="cm-stepper__label">${escapeHtml(s.label)}</span>
      </div>`,
      )
      .join("");

    const cta = $("cmTicketCta");
    const wrap = $("cmTicketCtaWrap");
    if (t.cta_label) {
      wrap.hidden = false;
      cta.textContent = t.cta_label;
      cta.disabled = false;
    } else {
      wrap.hidden = false;
      cta.textContent = "Visita concluída";
      cta.disabled = true;
    }
  }

  function renderDetails() {
    const t = ticket;
    const att = $("cmAttention");
    if (t.attention) {
      att.hidden = false;
      $("cmAttentionText").textContent = t.attention;
    } else {
      att.hidden = true;
    }

    const total = t.sqft_total > 0 ? `${Number(t.sqft_total).toLocaleString("en-US")} sq ft` : "—";
    $("cmScopeTotal").textContent = total;
    const scope = t.scope || [];
    if (!scope.length) {
      $("cmScopeList").innerHTML =
        '<p class="cm-subtitle" style="margin:0.5rem 0 0">Sem linhas de escopo.</p>';
    } else {
      $("cmScopeList").innerHTML = scope
        .map(
          (s) => `
        <div class="cm-scope__row">
          <span>${escapeHtml(s.name)}</span>
          <span>${Number(s.sqft || 0).toLocaleString("en-US")} sq ft</span>
        </div>`,
        )
        .join("");
    }

    const notes = $("cmNotes");
    if (t.notes && !t.attention) {
      notes.hidden = false;
      notes.textContent = t.notes;
    } else {
      notes.hidden = true;
    }
  }

  function renderChecklist() {
    const t = ticket;
    const done = t.checklist_done || 0;
    const total = t.checklist_total || 0;
    $("cmCheckCount").textContent = `${done} de ${total}`;
    $("cmTabChecklist").textContent = `Checklist ${done}/${total}`;
    const pct = total ? Math.round((done / total) * 100) : 0;
    $("cmCheckBarFill").style.width = `${pct}%`;

    $("cmCheckList").innerHTML = (t.checklist || [])
      .map(
        (item) => `
      <button type="button" class="cm-check-item${item.done ? " is-done" : ""}" data-check-id="${escapeHtml(item.id)}">
        <span class="cm-check-item__box" aria-hidden="true">${item.done ? "✓" : ""}</span>
        <span class="cm-check-item__text">${escapeHtml(item.text)}</span>
      </button>`,
      )
      .join("");
  }

  function renderPhotos() {
    const t = ticket;
    $("cmTabPhotos").textContent = `Fotos · ${t.photos_count || 0}`;
    const grid = $("cmPhotosGrid");
    const photos = t.photos || [];
    if (!photos.length) {
      grid.innerHTML =
        '<p class="cm-subtitle" style="margin:0.5rem 0">Nenhuma foto ainda.</p>';
      return;
    }
    grid.innerHTML = photos
      .map(
        (p) => `
      <a class="cm-photo" href="${escapeHtml(p.url)}" target="_blank" rel="noopener">
        <img src="${escapeHtml(p.url)}" alt="Foto da obra" loading="lazy" />
      </a>`,
      )
      .join("");
  }

  function renderAll() {
    renderHero();
    renderDetails();
    renderChecklist();
    renderPhotos();
    showTab(tab);
  }

  function showTab(name) {
    tab = name;
    document.querySelectorAll(".cm-ticket-tabs__btn").forEach((btn) => {
      const on = btn.getAttribute("data-tab") === name;
      btn.classList.toggle("is-active", on);
      btn.setAttribute("aria-selected", on ? "true" : "false");
    });
    document.querySelectorAll(".cm-ticket-panel").forEach((panel) => {
      panel.hidden = panel.getAttribute("data-panel") !== name;
    });
  }

  function apply(data) {
    ticket = data;
    renderAll();
  }

  function openProblem() {
    $("cmProblemNote").value = ticket?.problem_note || "";
    $("cmProblemBackdrop").hidden = false;
    $("cmProblemSheet").hidden = false;
    document.body.classList.add("cm-sheet-open");
  }

  function closeProblem() {
    $("cmProblemBackdrop").hidden = true;
    $("cmProblemSheet").hidden = true;
    document.body.classList.remove("cm-sheet-open");
  }

  function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(new Error("Falha ao ler imagem"));
      reader.readAsDataURL(file);
    });
  }

  function bind() {
    $("cmTicketBack")?.addEventListener("click", () => {
      if (history.length > 1) history.back();
      else location.href = "hoje.html";
    });

    document.querySelectorAll(".cm-ticket-tabs__btn").forEach((btn) => {
      btn.addEventListener("click", () => showTab(btn.getAttribute("data-tab")));
    });

    $("cmTicketCta")?.addEventListener("click", async () => {
      if (!ticket?.next_status) return;
      try {
        const json = await api(`/api/campo/jobs/${jobId}/field-status`, {
          method: "POST",
          body: JSON.stringify({ advance: true }),
        });
        apply(json.data);
      } catch (err) {
        toast(err.message || "Falha ao atualizar status");
      }
    });

    $("cmCheckList")?.addEventListener("click", async (e) => {
      const btn = e.target.closest("[data-check-id]");
      if (!btn) return;
      const id = btn.getAttribute("data-check-id");
      const item = (ticket.checklist || []).find((c) => c.id === id);
      if (!item) return;
      try {
        const json = await api(`/api/campo/jobs/${jobId}/checklist`, {
          method: "PATCH",
          body: JSON.stringify({ item_id: id, done: !item.done }),
        });
        apply(json.data);
      } catch (err) {
        toast(err.message || "Falha no checklist");
      }
    });

    $("cmPhotoInput")?.addEventListener("change", async (e) => {
      const file = e.target.files && e.target.files[0];
      e.target.value = "";
      if (!file) return;
      try {
        const dataUrl = await fileToDataUrl(file);
        const json = await api(`/api/campo/jobs/${jobId}/photos`, {
          method: "POST",
          body: JSON.stringify({ data_url: dataUrl }),
        });
        apply(json.data);
        showTab("photos");
      } catch (err) {
        toast(err.message || "Falha no upload");
      }
    });

    $("cmProblemBtn")?.addEventListener("click", openProblem);
    $("cmProblemClose")?.addEventListener("click", closeProblem);
    $("cmProblemBackdrop")?.addEventListener("click", closeProblem);
    $("cmProblemSubmit")?.addEventListener("click", async () => {
      const note = ($("cmProblemNote").value || "").trim();
      if (note.length < 2) {
        toast("Descreva o problema");
        return;
      }
      try {
        const json = await api(`/api/campo/jobs/${jobId}/problem`, {
          method: "POST",
          body: JSON.stringify({ note }),
        });
        apply(json.data);
        closeProblem();
      } catch (err) {
        toast(err.message || "Falha ao enviar");
      }
    });
  }

  async function init() {
    const params = new URLSearchParams(location.search);
    jobId = params.get("id");
    if (!jobId) {
      location.href = "hoje.html";
      return;
    }
    bind();
    try {
      const json = await api(`/api/campo/jobs/${encodeURIComponent(jobId)}`);
      apply(json.data);
    } catch (err) {
      toast(err.message || "Ticket não encontrado");
      setTimeout(() => {
        location.href = "hoje.html";
      }, 800);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  window.__campoTicket = { VER };
})();
