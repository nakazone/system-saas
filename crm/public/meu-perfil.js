(function () {
  const $ = (id) => document.getElementById(id);

  let profile = null;
  let pendingAvatarDataUrl = null;
  let clearAvatar = false;

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
    el.classList.toggle("is-on", !!on && !!text);
  }

  function clearMsgs(...ids) {
    ids.forEach((id) => {
      const el = $(id);
      if (el) {
        el.textContent = "";
        el.classList.remove("is-on");
      }
    });
  }

  async function api(url, opts) {
    const r = await fetch(url, {
      credentials: "include",
      headers: { "Content-Type": "application/json", ...(opts && opts.headers) },
      ...opts,
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.success === false) {
      const err = new Error(j.error || j.message || `HTTP ${r.status}`);
      err.status = r.status;
      err.body = j;
      throw err;
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
    if (clearBtn) {
      clearBtn.hidden = !(src || (url && !clearAvatar));
    }
  }

  function paint(p) {
    profile = p;
    const name = p.name || p.email || "—";
    const role = roleLabel(p.role, p.role_name);
    $("mpHeroName").textContent = name;
    $("mpHeroMeta").textContent = [role, p.email].filter(Boolean).join(" · ");
    $("mpName").value = p.name || "";
    $("mpPhone").value = p.phone || "";
    $("mpEmail").value = p.email || "";
    $("mpRoute").value = p.route_start_address || "";
    $("mpMetaRole").textContent = role;
    $("mpMetaCreated").textContent = fmtDate(p.created_at);
    $("mpMetaUpdated").textContent = fmtDate(p.updated_at);
    setAvatarUi(name, p.avatar_url);

    const sn = $("sidebarUserName");
    if (sn) sn.textContent = name;
    const sr = $("sidebarUserRole");
    if (sr) sr.textContent = role;
    const sa = $("sidebarUserAvatar");
    if (sa) {
      if (p.avatar_url && !clearAvatar && !pendingAvatarDataUrl) {
        sa.innerHTML = "";
        const im = document.createElement("img");
        im.src = p.avatar_url;
        im.alt = "";
        im.style.cssText = "width:100%;height:100%;object-fit:cover;border-radius:50%";
        sa.appendChild(im);
      } else {
        sa.textContent = initials(name);
      }
    }
  }

  function syncLocaleSeg() {
    const cur = window.CrmI18n ? window.CrmI18n.getLocale() : "pt";
    document.querySelectorAll(".mp-seg [data-locale]").forEach((btn) => {
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

  async function boot() {
    try {
      const session = await api("/api/auth/session");
      if (!session.authenticated) {
        location.href = "/login.html";
        return;
      }
      if (session.user && session.user.must_change_password) {
        location.href = "/change-password.html";
        return;
      }
      window.__crmPermissionKeys = (session.user && session.user.permissions) || [];
      window.__crmUserRole = (session.user && session.user.role) || "";

      const me = await api("/api/me");
      paint(me.data);
      syncLocaleSeg();
    } catch (_) {
      location.href = "/login.html";
      return;
    }

    $("mpDadosForm")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      clearMsgs("mpDadosErr", "mpDadosOk");
      const name = String($("mpName").value || "").trim();
      const phone = String($("mpPhone").value || "").trim();
      if (!name) {
        showMsg($("mpDadosErr"), "Indique o seu nome.", true);
        return;
      }
      const btn = $("mpDadosSave");
      if (btn) btn.disabled = true;
      try {
        const j = await api("/api/me", {
          method: "PATCH",
          body: JSON.stringify({ name, phone }),
        });
        paint(j.data);
        showMsg($("mpDadosOk"), "Dados guardados.", true);
        if (typeof window.crmNotify === "function") window.crmNotify("Perfil atualizado.", "success");
      } catch (err) {
        showMsg($("mpDadosErr"), err.message || "Não foi possível guardar.", true);
      } finally {
        if (btn) btn.disabled = false;
      }
    });

    $("mpRotaForm")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      clearMsgs("mpRotaErr", "mpRotaOk");
      const route = String($("mpRoute").value || "").trim();
      const btn = $("mpRotaSave");
      if (btn) btn.disabled = true;
      try {
        const j = await api("/api/me", {
          method: "PATCH",
          body: JSON.stringify({ route_start_address: route }),
        });
        paint(j.data);
        showMsg($("mpRotaOk"), "Endereço guardado.", true);
        if (typeof window.crmNotify === "function") window.crmNotify("Endereço guardado.", "success");
      } catch (err) {
        showMsg($("mpRotaErr"), err.message || "Não foi possível guardar.", true);
      } finally {
        if (btn) btn.disabled = false;
      }
    });

    $("mpSenhaForm")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      clearMsgs("mpSenhaErr", "mpSenhaOk");
      const cur = $("mpCurPass").value;
      const n1 = $("mpNewPass").value;
      const n2 = $("mpNewPass2").value;
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
        $("mpSenhaForm").reset();
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

    document.querySelectorAll(".mp-seg [data-locale]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const code = btn.getAttribute("data-locale");
        if (window.CrmI18n) window.CrmI18n.setLocale(code);
        syncLocaleSeg();
        if (window.CrmI18n) window.CrmI18n.apply(document);
        if (typeof window.crmNotify === "function") {
          window.crmNotify("Idioma atualizado neste aparelho.", "success");
        }
      });
    });

    $("logoutBtn")?.addEventListener("click", async () => {
      try {
        await api("/api/auth/logout", { method: "POST" });
      } catch (_) {}
      location.href = "/login.html";
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
