(function () {
  const PRESETS = [
    { primary: "#211d1a", accent: "#e8792c", label: "ObraMate" },
    { primary: "#0f172a", accent: "#38bdf8", label: "Slate / Sky" },
    { primary: "#14532d", accent: "#86efac", label: "Forest" },
    { primary: "#1e3a5f", accent: "#f59e0b", label: "Navy / Amber" },
    { primary: "#3b0764", accent: "#e9d5ff", label: "Violet" },
    { primary: "#7c2d12", accent: "#fdba74", label: "Copper" },
  ];

  let logoDataUrl = null;
  let clearLogo = false;
  let currentLogoUrl = null;

  function $(id) {
    return document.getElementById(id);
  }

  function notify(msg, type) {
    if (typeof window.crmNotify === "function") window.crmNotify(msg, type || "info");
    else {
      const el = $("brandStatus");
      if (el) el.textContent = msg;
    }
  }

  function syncPickers() {
    const p = $("primaryColor").value || "#211d1a";
    const a = $("accentColor").value || "#e8792c";
    $("primaryColorPicker").value = /^#[0-9A-Fa-f]{6}$/.test(p) ? p : "#211d1a";
    $("accentColorPicker").value = /^#[0-9A-Fa-f]{6}$/.test(a) ? a : "#e8792c";
    applyLivePreview();
  }

  function applyLivePreview() {
    const p = $("primaryColor").value;
    const a = $("accentColor").value;
    if (/^#[0-9A-Fa-f]{6}$/.test(p)) {
      document.documentElement.style.setProperty("--sf-navy", p);
      document.documentElement.style.setProperty("--color-primary", p);
      document.documentElement.style.setProperty("--bp-navy", p);
    }
    if (/^#[0-9A-Fa-f]{6}$/.test(a)) {
      document.documentElement.style.setProperty("--sf-gold", a);
      document.documentElement.style.setProperty("--color-accent", a);
      document.documentElement.style.setProperty("--bp-tan", a);
    }
    const preview = $("logoPreview");
    if (preview && /^#[0-9A-Fa-f]{6}$/.test(p)) preview.style.background = p;
  }

  function setLogoPreview(url) {
    const img = $("logoImg");
    const ph = $("logoPlaceholder");
    if (url) {
      img.src = url;
      img.hidden = false;
      ph.hidden = true;
    } else {
      img.removeAttribute("src");
      img.hidden = true;
      ph.hidden = false;
    }
  }

  function renderSwatches() {
    const host = $("brandSwatches");
    host.innerHTML = "";
    PRESETS.forEach((preset) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "brand-swatch";
      btn.title = preset.label;
      btn.style.background = `linear-gradient(135deg, ${preset.primary} 50%, ${preset.accent} 50%)`;
      btn.addEventListener("click", () => {
        $("primaryColor").value = preset.primary;
        $("accentColor").value = preset.accent;
        syncPickers();
        host.querySelectorAll(".brand-swatch").forEach((b) => b.classList.remove("is-active"));
        btn.classList.add("is-active");
      });
      host.appendChild(btn);
    });
  }

  async function loadBranding() {
    const r = await fetch("/api/branding", { credentials: "include", cache: "no-store" });
    const j = await r.json();
    if (!j.success) throw new Error(j.error || "Falha ao carregar branding");
    const d = j.data;
    $("brandName").value = d.name || "";
    $("primaryColor").value = d.primary_color || "#211d1a";
    $("accentColor").value = d.accent_color || "#e8792c";
    currentLogoUrl = d.logo_url || null;
    logoDataUrl = null;
    clearLogo = false;
    setLogoPreview(currentLogoUrl);
    syncPickers();
  }

  async function loadSession() {
    try {
      const r = await fetch("/api/auth/session", { credentials: "include" });
      const j = await r.json();
      if (!j.authenticated) {
        location.href = "/login.html";
        return null;
      }
      const nameEl = $("sidebarUserName");
      const roleEl = $("sidebarUserRole");
      if (nameEl) nameEl.textContent = j.user?.name || j.user?.email || "—";
      if (roleEl) roleEl.textContent = j.user?.role || "";
      const perms = j.user?.permissions || [];
      const isAdmin = j.user?.role === "admin";
      const canBrand = isAdmin || perms.includes("settings.manage");
      if (!canBrand) {
        document
          .querySelectorAll(".brand-ajustes > .brand-card, .brand-ajustes > form.brand-card, .brand-ajustes > .brand-actions")
          .forEach((el) => {
            if (el.id === "suporte") return;
            el.style.display = "none";
          });
        const lead = document.querySelector(".brand-ajustes > .lead");
        const h1 = document.querySelector(".brand-ajustes > h1");
        if (h1) h1.textContent = "Suporte";
        if (lead) {
          lead.textContent =
            "Envie dúvidas, sugestões ou problemas diretamente para a equipe ObraMate.";
        }
        const brandStatus = $("brandStatus");
        if (brandStatus) brandStatus.style.display = "none";
      }
      return { canBrand };
    } catch {
      location.href = "/login.html";
      return null;
    }
  }

  function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(new Error("Falha ao ler arquivo"));
      reader.readAsDataURL(file);
    });
  }

  $("logoFile").addEventListener("change", async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    if (file.size > 2.5 * 1024 * 1024) {
      notify("Logo deve ter no máximo 2,5 MB.", "error");
      e.target.value = "";
      return;
    }
    try {
      logoDataUrl = await fileToDataUrl(file);
      clearLogo = false;
      setLogoPreview(logoDataUrl);
    } catch (err) {
      notify(err.message || "Erro no logo", "error");
    }
  });

  $("btnClearLogo").addEventListener("click", () => {
    logoDataUrl = null;
    clearLogo = true;
    currentLogoUrl = null;
    $("logoFile").value = "";
    setLogoPreview(null);
  });

  ["primaryColor", "accentColor"].forEach((id) => {
    $(id).addEventListener("input", syncPickers);
  });
  $("primaryColorPicker").addEventListener("input", (e) => {
    $("primaryColor").value = e.target.value;
    applyLivePreview();
  });
  $("accentColorPicker").addEventListener("input", (e) => {
    $("accentColor").value = e.target.value;
    applyLivePreview();
  });

  $("btnResetBrand").addEventListener("click", () => {
    $("primaryColor").value = "#211d1a";
    $("accentColor").value = "#e8792c";
    syncPickers();
  });

  $("btnSaveBrand").addEventListener("click", async () => {
    const payload = {
      name: $("brandName").value.trim(),
      primary_color: $("primaryColor").value.trim(),
      accent_color: $("accentColor").value.trim(),
    };
    if (clearLogo) payload.clear_logo = true;
    else if (logoDataUrl) payload.logo_data_url = logoDataUrl;

    $("btnSaveBrand").disabled = true;
    $("brandStatus").textContent = "Salvando…";
    try {
      const r = await fetch("/api/branding", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const j = await r.json();
      if (!r.ok || !j.success) throw new Error(j.error || "Falha ao salvar");
      notify("Branding salvo. Recarregando…", "success");
      logoDataUrl = null;
      clearLogo = false;
      // Force CSS refresh
      setTimeout(() => {
        location.reload();
      }, 600);
    } catch (err) {
      notify(err.message || "Erro ao salvar", "error");
      $("brandStatus").textContent = err.message || "Erro";
    } finally {
      $("btnSaveBrand").disabled = false;
    }
  });

  const CAT_LABEL = {
    question: "Dúvida",
    suggestion: "Sugestão",
    bug: "Problema",
    other: "Outro",
  };

  function formatWhen(iso) {
    try {
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return iso || "";
      return d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
    } catch {
      return iso || "";
    }
  }

  async function loadSupportHistory() {
    const host = $("supportHistory");
    const list = $("supportHistoryList");
    if (!host || !list) return;
    try {
      const r = await fetch("/api/support/tickets", { credentials: "include", cache: "no-store" });
      const j = await r.json();
      if (!r.ok || !j.success) return;
      const rows = Array.isArray(j.data) ? j.data : [];
      if (rows.length === 0) {
        host.hidden = true;
        list.innerHTML = "";
        return;
      }
      host.hidden = false;
      list.innerHTML = rows
        .map((t) => {
          const status = t.status === "closed" ? "closed" : "open";
          const statusLabel = status === "closed" ? "Resolvido" : "Aberto";
          const cat = CAT_LABEL[t.category] || t.category || "";
          const body = String(t.body || "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;");
          const subject = String(t.subject || "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;");
          return (
            `<article class="support-history__item">` +
            `<div class="support-history__meta">` +
            `<span class="support-history__badge support-history__badge--${status}">${statusLabel}</span>` +
            `<span>${cat}</span>` +
            `<span>${formatWhen(t.created_at)}</span>` +
            `</div>` +
            `<p class="support-history__subject">${subject}</p>` +
            `<p class="support-history__body">${body}</p>` +
            `</article>`
          );
        })
        .join("");
    } catch {
      /* ignore history errors */
    }
  }

  $("supportForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = $("btnSendSupport");
    const status = $("supportStatus");
    const payload = {
      category: $("supportCategory").value,
      subject: $("supportSubject").value.trim(),
      body: $("supportBody").value.trim(),
    };
    if (btn) btn.disabled = true;
    if (status) status.textContent = "Enviando…";
    try {
      const r = await fetch("/api/support/tickets", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const j = await r.json();
      if (!r.ok || !j.success) throw new Error(j.error || "Falha ao enviar");
      notify("Mensagem enviada ao suporte.", "success");
      if (status) status.textContent = "Enviado. Obrigado!";
      $("supportSubject").value = "";
      $("supportBody").value = "";
      $("supportCategory").value = "question";
      await loadSupportHistory();
    } catch (err) {
      notify(err.message || "Erro ao enviar", "error");
      if (status) status.textContent = err.message || "Erro";
    } finally {
      if (btn) btn.disabled = false;
    }
  });

  renderSwatches();
  loadSession()
    .then((session) => {
      if (session?.canBrand) return loadBranding();
      return null;
    })
    .then(loadSupportHistory)
    .catch((err) => {
      notify(err.message || "Erro", "error");
    });
})();
