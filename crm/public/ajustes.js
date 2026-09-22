(function () {
  const PRESETS = [
    { primary: "#1a2036", accent: "#d6b598", label: "Senior Floors" },
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
    const p = $("primaryColor").value || "#1a2036";
    const a = $("accentColor").value || "#d6b598";
    $("primaryColorPicker").value = /^#[0-9A-Fa-f]{6}$/.test(p) ? p : "#1a2036";
    $("accentColorPicker").value = /^#[0-9A-Fa-f]{6}$/.test(a) ? a : "#d6b598";
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
    $("primaryColor").value = d.primary_color || "#1a2036";
    $("accentColor").value = d.accent_color || "#d6b598";
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
        return;
      }
      const nameEl = $("sidebarUserName");
      const roleEl = $("sidebarUserRole");
      if (nameEl) nameEl.textContent = j.user?.name || j.user?.email || "—";
      if (roleEl) roleEl.textContent = j.user?.role || "";
      const perms = j.user?.permissions || [];
      const isAdmin = j.user?.role === "admin";
      if (!isAdmin && !perms.includes("settings.manage")) {
        notify("Sem permissão para gerenciar ajustes.", "error");
        setTimeout(() => {
          location.href = "/dashboard.html";
        }, 1200);
      }
    } catch {
      location.href = "/login.html";
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
    $("primaryColor").value = "#1a2036";
    $("accentColor").value = "#d6b598";
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

  renderSwatches();
  loadSession().then(loadBranding).catch((err) => {
    notify(err.message || "Erro", "error");
  });
})();
