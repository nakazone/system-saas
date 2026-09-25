/**
 * Mobile "Novo lead" bottom sheet — shared across Home / Leads / FAB.
 */
(function () {
  const FLOOR_TYPES = ["Hardwood", "Vinyl (LVP)", "Laminate", "Tile", "Carpet"];
  const SOURCES = ["Website", "Indicação", "Google", "Instagram", "Manual"];
  const VER = "20260925-leadui1";

  let floorType = "Hardwood";
  let source = "Website";
  let onCreated = null;

  function ensureCss() {
    if ([...document.querySelectorAll('link[href*="lead-mobile.css"]')].length) return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = `lead-mobile.css?v=${VER}`;
    document.head.appendChild(link);
  }

  function isMobile() {
    if (window.__omDevice && typeof window.__omDevice.isMobile === "function") {
      return window.__omDevice.isMobile();
    }
    return /Android|webOS|iPhone|iPod|BlackBerry|IEMobile|Opera Mini|Mobile|iPad/i.test(
      navigator.userAgent || "",
    );
  }

  function chipsHtml(list, selected, group) {
    return list
      .map(
        (v) =>
          `<button type="button" class="nls-chip${v === selected ? " is-active" : ""}" data-nls-group="${group}" data-value="${v.replace(
            /"/g,
            "&quot;",
          )}">${v}</button>`,
      )
      .join("");
  }

  function ensureDom() {
    if (document.getElementById("nlsRoot")) return;
    ensureCss();
    const root = document.createElement("div");
    root.id = "nlsRoot";
    root.className = "nls-root";
    root.innerHTML = `
      <button type="button" class="nls-backdrop" id="nlsBackdrop" hidden aria-label="Fechar"></button>
      <div class="nls-sheet" id="nlsSheet" role="dialog" aria-modal="true" aria-labelledby="nlsTitle" hidden>
        <div class="nls-grab" aria-hidden="true"></div>
        <header class="nls-head">
          <h2 class="nls-title" id="nlsTitle">Novo lead</h2>
          <button type="button" class="nls-close" id="nlsClose" aria-label="Fechar">×</button>
        </header>
        <form id="nlsForm">
          <div class="nls-field">
            <label class="nls-label" for="nlsName">Nome do cliente</label>
            <input class="nls-input" id="nlsName" name="name" required maxlength="200" placeholder="Ex.: Maria Oliveira" autocomplete="name" />
          </div>
          <div class="nls-field">
            <label class="nls-label" for="nlsPhone">Telefone</label>
            <input class="nls-input" id="nlsPhone" name="phone" required maxlength="40" placeholder="(555) 000-0000" autocomplete="tel" inputmode="tel" />
          </div>
          <div class="nls-field">
            <span class="nls-label">Tipo de piso</span>
            <div class="nls-chips" id="nlsFloorChips">${chipsHtml(FLOOR_TYPES, floorType, "floor")}</div>
          </div>
          <div class="nls-field">
            <label class="nls-label" for="nlsArea">Área aproximada (sq ft)</label>
            <input class="nls-input" id="nlsArea" name="area" inputmode="numeric" placeholder="Ex.: 650" />
          </div>
          <div class="nls-field">
            <span class="nls-label">Origem</span>
            <div class="nls-chips" id="nlsSourceChips">${chipsHtml(SOURCES, source, "source")}</div>
          </div>
          <button type="submit" class="nls-submit" id="nlsSubmit">Criar lead</button>
        </form>
      </div>`;
    document.body.appendChild(root);

    document.getElementById("nlsBackdrop")?.addEventListener("click", close);
    document.getElementById("nlsClose")?.addEventListener("click", close);
    document.getElementById("nlsForm")?.addEventListener("submit", onSubmit);
    root.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-nls-group]");
      if (!btn) return;
      const group = btn.getAttribute("data-nls-group");
      const value = btn.getAttribute("data-value") || "";
      if (group === "floor") floorType = value;
      if (group === "source") source = value;
      root.querySelectorAll(`[data-nls-group="${group}"]`).forEach((el) => {
        el.classList.toggle("is-active", el.getAttribute("data-value") === value);
      });
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") close();
    });
  }

  function open(opts) {
    ensureDom();
    onCreated = opts && typeof opts.onCreated === "function" ? opts.onCreated : null;
    floorType = "Hardwood";
    source = "Website";
    const form = document.getElementById("nlsForm");
    if (form) form.reset();
    const floorHost = document.getElementById("nlsFloorChips");
    const sourceHost = document.getElementById("nlsSourceChips");
    if (floorHost) floorHost.innerHTML = chipsHtml(FLOOR_TYPES, floorType, "floor");
    if (sourceHost) sourceHost.innerHTML = chipsHtml(SOURCES, source, "source");
    document.getElementById("nlsBackdrop").hidden = false;
    document.getElementById("nlsSheet").hidden = false;
    document.body.classList.add("nls-open");
    setTimeout(() => document.getElementById("nlsName")?.focus(), 50);
  }

  function close() {
    const backdrop = document.getElementById("nlsBackdrop");
    const sheet = document.getElementById("nlsSheet");
    if (backdrop) backdrop.hidden = true;
    if (sheet) sheet.hidden = true;
    document.body.classList.remove("nls-open");
  }

  async function onSubmit(e) {
    e.preventDefault();
    const name = (document.getElementById("nlsName")?.value || "").trim();
    const phone = (document.getElementById("nlsPhone")?.value || "").trim();
    const areaRaw = (document.getElementById("nlsArea")?.value || "").trim();
    if (name.length < 2) {
      alert("Indique o nome do cliente.");
      return;
    }
    if (phone.length < 3) {
      alert("Indique um telefone válido.");
      return;
    }
    const area = areaRaw ? Number(String(areaRaw).replace(/[^\d.]/g, "")) : null;
    const messageParts = [floorType];
    if (area && Number.isFinite(area) && area > 0) {
      messageParts.push(Math.round(area).toLocaleString("en-US") + " sq ft");
    }
    const submit = document.getElementById("nlsSubmit");
    if (submit) submit.disabled = true;
    try {
      const body = {
        name,
        phone,
        source: source || "Manual",
        message: messageParts.join(" · "),
        status: "new_lead",
        priority: "medium",
        notes: area && Number.isFinite(area) ? `Área aproximada: ${Math.round(area)} sq ft` : null,
      };
      const res = await fetch("/api/leads", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.success === false) {
        throw new Error(data.error || `Erro ${res.status}`);
      }
      if (window.crmToast?.show) window.crmToast.show("Lead criado", { type: "success" });
      close();
      const id = data.data?.id || data.id;
      if (typeof onCreated === "function") onCreated(data);
      else if (id) location.href = "lead-detail.html?id=" + encodeURIComponent(String(id));
      else location.reload();
    } catch (err) {
      alert(err.message || "Erro ao criar lead");
    } finally {
      if (submit) submit.disabled = false;
    }
  }

  function openNewLead(opts) {
    if (isMobile()) {
      open(opts || {});
      return true;
    }
    return false;
  }

  window.__omNovoLeadSheet = { open, close, openNewLead, isMobile };
})();
