/**
 * Meu Perfil inside Configurações — GET/PATCH /api/me + change-password.
 * Loaded once via loadSection("meu-perfil").
 */
(function () {
  const $ = (id) => document.getElementById(id);

  let profile = null;
  let pendingAvatarDataUrl = null;
  let clearAvatar = false;
  let pendingSigDataUrl = null;
  let clearSignature = false;
  let bound = false;

  function initials(name) {
    const parts = String(name || "")
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    if (!parts.length) return "—";
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  function roleLabel(role, roleName) {
    if (roleName) return roleName;
    const r = String(role || "").toLowerCase();
    if (r === "admin") return "Administrador";
    if (r === "manager") return "Manager";
    if (r === "sales") return "Vendas";
    if (r === "builder") return "Builder";
    if (r === "field" || r === "field_worker") return "Campo";
    return role || "—";
  }

  function fmtDate(iso) {
    if (!iso) return "—";
    try {
      return new Date(iso).toLocaleDateString(undefined, {
        day: "2-digit",
        month: "short",
        year: "numeric",
      });
    } catch (_) {
      return "—";
    }
  }

  function showMsg(el, text, on) {
    if (!el) return;
    el.textContent = text || "";
    if (on && text) el.removeAttribute("hidden");
    else el.setAttribute("hidden", "");
  }

  function clearMsgs(...ids) {
    ids.forEach((id) => showMsg($(id), "", false));
  }

  async function api(url, opts) {
    const r = await fetch(url, {
      credentials: "include",
      headers: { "Content-Type": "application/json", ...(opts && opts.headers) },
      ...opts,
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.success === false) {
      throw new Error(j.error || j.message || `HTTP ${r.status}`);
    }
    return j;
  }

  function setAvatarUi(name, url) {
    const img = $("mpAvImg");
    const init = $("mpAvInit");
    const clearBtn = $("mpAvatarClear");
    if (!img || !init) return;
    const src = pendingAvatarDataUrl || (!clearAvatar && url) || "";
    if (src) {
      img.src = src;
      img.hidden = false;
      init.hidden = true;
    } else {
      img.removeAttribute("src");
      img.hidden = true;
      init.hidden = false;
      init.textContent = initials(name);
    }
    if (clearBtn) clearBtn.hidden = !(src || (url && !clearAvatar));
  }

  function paint(p) {
    profile = p;
    const name = p.name || p.email || "—";
    const role = roleLabel(p.role, p.role_name);
    if ($("mpHeroName")) $("mpHeroName").textContent = name;
    if ($("mpHeroMeta")) $("mpHeroMeta").textContent = [role, p.email].filter(Boolean).join(" · ");
    if ($("mpName")) $("mpName").value = p.name || "";
    if ($("mpPhone")) $("mpPhone").value = p.phone || "";
    if ($("mpEmail")) $("mpEmail").value = p.email || "";
    if ($("mpRoute")) $("mpRoute").value = p.route_start_address || "";
    if ($("mpMetaRole")) $("mpMetaRole").textContent = role;
    if ($("mpMetaCreated")) $("mpMetaCreated").textContent = fmtDate(p.created_at);
    if ($("mpMetaUpdated")) $("mpMetaUpdated").textContent = fmtDate(p.updated_at);
    setAvatarUi(name, p.avatar_url);
    setSigUi(p.signature_url);
  }

  function setSigUi(url) {
    const img = $("mpSigImg");
    const empty = $("mpSigEmpty");
    const clearBtn = $("mpSigClear");
    if (!img || !empty) return;
    const src = pendingSigDataUrl || (!clearSignature && url) || "";
    if (src) {
      img.src = src;
      img.hidden = false;
      empty.hidden = true;
    } else {
      img.removeAttribute("src");
      img.hidden = true;
      empty.hidden = false;
    }
    if (clearBtn) clearBtn.hidden = !(src || (url && !clearSignature));
  }

  async function saveSignature() {
    clearMsgs("mpSigErr", "mpSigOk");
    if (!pendingSigDataUrl && !clearSignature) return;
    try {
      const body = clearSignature
        ? { clear_signature: true }
        : { signature_data_url: pendingSigDataUrl };
      const j = await api("/api/me", { method: "PATCH", body: JSON.stringify(body) });
      pendingSigDataUrl = null;
      clearSignature = false;
      const input = $("mpSigInput");
      if (input) input.value = "";
      paint(j.data);
      showMsg($("mpSigOk"), "Assinatura atualizada.", true);
      if (typeof window.crmNotify === "function") window.crmNotify("Assinatura atualizada.", "success");
    } catch (e) {
      showMsg($("mpSigErr"), e.message || "Falha ao guardar a assinatura.", true);
    }
  }

  function syncLocaleSeg() {
    const cur = window.CrmI18n ? window.CrmI18n.getLocale() : "pt";
    document.querySelectorAll(".mp-langs [data-locale]").forEach((btn) => {
      btn.classList.toggle("is-on", btn.getAttribute("data-locale") === cur);
    });
  }

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result || ""));
      fr.onerror = () => reject(new Error("Não foi possível ler a imagem."));
      fr.readAsDataURL(file);
    });
  }

  async function saveAvatar() {
    clearMsgs("mpAvatarErr", "mpAvatarOk");
    if (!pendingAvatarDataUrl && !clearAvatar) return;
    try {
      const body = clearAvatar
        ? { clear_avatar: true }
        : { avatar_data_url: pendingAvatarDataUrl };
      const j = await api("/api/me", { method: "PATCH", body: JSON.stringify(body) });
      pendingAvatarDataUrl = null;
      clearAvatar = false;
      const input = $("mpAvatarInput");
      if (input) input.value = "";
      paint(j.data);
      showMsg($("mpAvatarOk"), "Foto atualizada.", true);
      if (typeof window.crmNotify === "function") window.crmNotify("Foto atualizada.", "success");
    } catch (e) {
      showMsg($("mpAvatarErr"), e.message || "Falha ao guardar a foto.", true);
    }
  }

  function bind() {
    if (bound) return;
    bound = true;

    $("mpDadosForm")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      clearMsgs("mpDadosErr", "mpDadosOk");
      const name = String($("mpName")?.value || "").trim();
      const phone = String($("mpPhone")?.value || "").trim();
      const route = String($("mpRoute")?.value || "").trim();
      if (!name) {
        showMsg($("mpDadosErr"), "Indique o seu nome.", true);
        return;
      }
      const btn = $("mpDadosSave");
      if (btn) btn.disabled = true;
      try {
        const j = await api("/api/me", {
          method: "PATCH",
          body: JSON.stringify({ name, phone, route_start_address: route }),
        });
        paint(j.data);
        showMsg($("mpDadosOk"), "Perfil guardado.", true);
        if (typeof window.crmNotify === "function") window.crmNotify("Perfil atualizado.", "success");
      } catch (err) {
        showMsg($("mpDadosErr"), err.message || "Não foi possível guardar.", true);
      } finally {
        if (btn) btn.disabled = false;
      }
    });

    $("mpSenhaForm")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      clearMsgs("mpSenhaErr", "mpSenhaOk");
      const cur = $("mpCurPass")?.value || "";
      const n1 = $("mpNewPass")?.value || "";
      const n2 = $("mpNewPass2")?.value || "";
      if (n1.length < 8) {
        showMsg($("mpSenhaErr"), "A nova senha deve ter pelo menos 8 caracteres.", true);
        return;
      }
      if (n1 !== n2) {
        showMsg($("mpSenhaErr"), "As novas senhas não coincidem.", true);
        return;
      }
      const btn = $("mpSenhaSave");
      if (btn) btn.disabled = true;
      try {
        await api("/api/auth/change-password", {
          method: "POST",
          body: JSON.stringify({ current_password: cur, new_password: n1 }),
        });
        $("mpSenhaForm")?.reset();
        showMsg($("mpSenhaOk"), "Senha alterada com sucesso.", true);
        if (typeof window.crmNotify === "function") window.crmNotify("Senha alterada.", "success");
      } catch (err) {
        showMsg($("mpSenhaErr"), err.message || "Não foi possível alterar a senha.", true);
      } finally {
        if (btn) btn.disabled = false;
      }
    });

    $("mpAvatarInput")?.addEventListener("change", async (e) => {
      clearMsgs("mpAvatarErr", "mpAvatarOk");
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      if (!String(file.type || "").startsWith("image/")) {
        showMsg($("mpAvatarErr"), "Escolha um ficheiro de imagem.", true);
        return;
      }
      if (file.size > 2.5 * 1024 * 1024) {
        showMsg($("mpAvatarErr"), "A foto deve ter menos de 2,5 MB.", true);
        return;
      }
      try {
        pendingAvatarDataUrl = await readFileAsDataUrl(file);
        clearAvatar = false;
        setAvatarUi(profile?.name || "", profile?.avatar_url);
        await saveAvatar();
      } catch (err) {
        showMsg($("mpAvatarErr"), err.message || "Falha ao ler a imagem.", true);
      }
    });

    $("mpAvatarClear")?.addEventListener("click", async () => {
      clearMsgs("mpAvatarErr", "mpAvatarOk");
      pendingAvatarDataUrl = null;
      clearAvatar = true;
      const input = $("mpAvatarInput");
      if (input) input.value = "";
      setAvatarUi(profile?.name || "", null);
      await saveAvatar();
    });

    $("mpSigInput")?.addEventListener("change", async (e) => {
      clearMsgs("mpSigErr", "mpSigOk");
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      if (!String(file.type || "").startsWith("image/") || String(file.type).includes("svg")) {
        showMsg($("mpSigErr"), "Escolha PNG, JPG ou WebP.", true);
        return;
      }
      if (file.size > 1.5 * 1024 * 1024) {
        showMsg($("mpSigErr"), "A assinatura deve ter menos de 1,5 MB.", true);
        return;
      }
      try {
        pendingSigDataUrl = await readFileAsDataUrl(file);
        clearSignature = false;
        setSigUi(profile?.signature_url);
        await saveSignature();
      } catch (err) {
        showMsg($("mpSigErr"), err.message || "Falha ao ler a imagem.", true);
      }
    });

    $("mpSigClear")?.addEventListener("click", async () => {
      clearMsgs("mpSigErr", "mpSigOk");
      pendingSigDataUrl = null;
      clearSignature = true;
      const input = $("mpSigInput");
      if (input) input.value = "";
      setSigUi(null);
      await saveSignature();
    });

    document.querySelectorAll(".mp-langs [data-locale]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const code = btn.getAttribute("data-locale");
        if (window.CrmI18n && window.CrmI18n.getLocale() === code) return;
        document.querySelectorAll(".mp-langs [data-locale]").forEach((b) => b.classList.toggle("is-on", b === btn));
        // Saved on the account (all devices) and the page reloads in the new language.
        if (window.CrmI18n && window.CrmI18n.switchTo) window.CrmI18n.switchTo(code);
      });
    });
  }

  async function load() {
    bind();
    try {
      const me = await api("/api/me");
      paint(me.data);
      syncLocaleSeg();
    } catch (e) {
      showMsg($("mpDadosErr"), e.message || "Não foi possível carregar o perfil.", true);
    }
  }

  window.__cfgMeuPerfil = { load };
})();
