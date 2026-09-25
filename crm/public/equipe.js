/**
 * Equipe — utilizadores e cargos (página standalone).
 */
(function () {
  let usersPage = 1;
  let permissionRegistryCache = null;
  let crmRolesCache = null;
  let crmUserPermissions = [];
  let crmUserRole = "";
  let crmUserAvatarPendingFile = null;
  let crmUserAvatarRemove = false;

  function toast(msg, type) {
    if (typeof window.crmNotify === "function") window.crmNotify(msg, type || "info");
    else if (typeof window.crmToastSafe === "function") window.crmToastSafe(msg, { type: type || "info" });
    else console.log(msg);
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/"/g, "&quot;");
  }

  function canManageRoles() {
    return crmUserRole === "admin" || crmUserPermissions.includes("roles.manage");
  }

  function canManageUserPerms() {
    return (
      crmUserRole === "admin" ||
      crmUserPermissions.includes("users.manage") ||
      crmUserPermissions.includes("roles.manage") ||
      crmUserPermissions.includes("users.manage_permissions")
    );
  }

  function updateActions() {
    const n = document.getElementById("crmNewUserBtn");
    if (n) {
      const show = crmUserRole === "admin" || crmUserPermissions.includes("users.create");
      n.style.display = show ? "" : "none";
    }
    const r = document.getElementById("crmNewRoleBtn");
    if (r) r.style.display = canManageRoles() ? "" : "none";
  }

  function initials(name) {
    return (
      String(name || "?")
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .map((w) => w[0])
        .join("")
        .slice(0, 2)
        .toUpperCase() || "?"
    );
  }

  function resetAvatarState() {
    crmUserAvatarPendingFile = null;
    crmUserAvatarRemove = false;
    const input = document.getElementById("crmUserAvatarInput");
    if (input) input.value = "";
  }

  function updateAvatarPreview(name) {
    const img = document.getElementById("crmUserAvatarImg");
    const init = document.getElementById("crmUserAvatarInitials");
    const removeBtn = document.getElementById("crmUserAvatarRemoveBtn");
    if (!img || !init) return;
    if (!crmUserAvatarPendingFile) {
      img.removeAttribute("src");
      img.classList.add("hidden");
      init.textContent = initials(name);
      init.classList.remove("hidden");
    }
    if (removeBtn) {
      removeBtn.style.display = crmUserAvatarPendingFile ? "" : "none";
      removeBtn.disabled = !crmUserAvatarPendingFile;
    }
  }

  function tableAvatar(u) {
    const name = u.name || "-";
    return `<span class="crm-user-cell__avatar">${escapeHtml(initials(name))}</span>`;
  }

  async function fetchPermissionRegistry() {
    if (permissionRegistryCache) return permissionRegistryCache;
    const res = await fetch("/api/permissions", { credentials: "include" });
    const data = await res.json();
    permissionRegistryCache = data.success ? data : { by_group: {}, data: [] };
    return permissionRegistryCache;
  }

  async function fetchRoles(force) {
    if (crmRolesCache && !force) return crmRolesCache;
    const res = await fetch("/api/roles", { credentials: "include" });
    const data = await res.json();
    crmRolesCache = data.success && Array.isArray(data.data) ? data.data : [];
    return crmRolesCache;
  }

  async function populateRoleSelect(selectedKey) {
    const roleSelect = document.getElementById("crmUserRole");
    if (!roleSelect) return;
    const roles = await fetchRoles();
    const preferred = selectedKey || roleSelect.value || "";
    roleSelect.innerHTML = roles
      .map((r) => `<option value="${escapeHtml(r.key)}">${escapeHtml(r.name || r.key)}</option>`)
      .join("");
    if (!roles.length) {
      roleSelect.innerHTML =
        '<option value="admin">Administrador</option><option value="sales">Sales</option>';
    }
    const keys = new Set([...roleSelect.options].map((o) => o.value));
    if (preferred && keys.has(preferred)) roleSelect.value = preferred;
    else if (keys.has("sales")) roleSelect.value = "sales";
    else if (roleSelect.options.length) roleSelect.selectedIndex = 0;
  }

  function renderPermCheckboxes(byGroup, selectedSet, enabled) {
    let html = "";
    const keys = Object.keys(byGroup || {}).sort();
    for (const g of keys) {
      const items = byGroup[g] || [];
      html +=
        '<div style="margin-bottom:0.75rem"><strong style="text-transform:capitalize">' +
        escapeHtml(g) +
        "</strong>";
      for (const p of items) {
        const id = p.id;
        const checked = selectedSet.has(id) || selectedSet.has(String(id)) ? " checked" : "";
        const dis = enabled ? "" : " disabled";
        html +=
          '<label style="display:flex;align-items:flex-start;gap:0.5rem;margin:0.25rem 0 0 1rem;cursor:' +
          (enabled ? "pointer" : "default") +
          '">' +
          '<input type="checkbox" class="crm-perm-cb" data-perm-id="' +
          escapeHtml(String(id)) +
          '"' +
          checked +
          dis +
          ">" +
          "<span>" +
          escapeHtml(p.permission_name || p.permission_key) +
          ' <small style="color:#94a3b8">(' +
          escapeHtml(p.permission_key) +
          ")</small></span></label>";
      }
      html += "</div>";
    }
    return html || "<p>Nenhuma permissão na base de dados.</p>";
  }

  function collectSelectedPermissionIds(root) {
    const scope = root || document;
    return Array.from(scope.querySelectorAll(".crm-perm-cb:checked"))
      .map((cb) => String(cb.getAttribute("data-perm-id") || "").trim())
      .filter(Boolean);
  }

  async function loadUsers() {
    const tbody = document.getElementById("usersTableBody");
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="7" class="text-center">A carregar…</td></tr>';
    updateActions();
    try {
      const response = await fetch(`/api/users?page=${usersPage}&limit=20`, { credentials: "include" });
      const data = await response.json();
      if (response.status === 403) {
        tbody.innerHTML =
          '<tr><td colspan="7" class="text-center">Sem permissão para ver a equipe (' +
          escapeHtml(data.error || "") +
          ").</td></tr>";
        return;
      }
      if (!data.success || !data.data) {
        tbody.innerHTML =
          '<tr><td colspan="7" class="text-center">Erro: ' +
          escapeHtml(data.error || "desconhecido") +
          "</td></tr>";
        return;
      }
      const canEdit = crmUserRole === "admin" || crmUserPermissions.includes("users.edit");
      const canDel = crmUserRole === "admin" || crmUserPermissions.includes("users.delete");
      if (!data.data.length) {
        tbody.innerHTML = '<tr><td colspan="7" class="text-center">Nenhum utilizador encontrado</td></tr>';
      } else {
        tbody.innerHTML = data.data
          .map((u) => {
            const active = u.is_active !== undefined ? u.is_active : u.active;
            const roleLabel = u.role_name || u.role || "—";
            const uid = String(u.id).replace(/'/g, "\\'");
            const actions = [];
            if (canEdit)
              actions.push(
                `<button type="button" class="btn btn-sm" data-edit-user="${escapeHtml(String(u.id))}">Editar</button>`
              );
            if (canDel)
              actions.push(
                `<button type="button" class="btn btn-sm btn-danger" data-deactivate-user="${escapeHtml(String(u.id))}">Desativar</button>`
              );
            return `<tr>
              <td><div class="crm-user-cell">${tableAvatar(u)}<span>${escapeHtml(u.name || "-")}</span></div></td>
              <td>${escapeHtml(u.email || "-")}</td>
              <td>${escapeHtml(u.phone || "-")}</td>
              <td>${escapeHtml(roleLabel)}</td>
              <td><span class="badge badge-${active ? "active" : "inactive"}">${active ? "Ativo" : "Inativo"}</span></td>
              <td>${u.created_at ? new Date(u.created_at).toLocaleDateString("pt-PT") : "—"}</td>
              <td>${actions.join(" ") || "—"}</td>
            </tr>`;
          })
          .join("");
      }
      const totalPages = Math.ceil((data.total || 0) / 20);
      const info = document.getElementById("pageInfoUsers");
      const prev = document.getElementById("prevPageUsers");
      const next = document.getElementById("nextPageUsers");
      if (info) info.textContent = `Página ${usersPage} de ${totalPages || 1}`;
      if (prev) prev.disabled = usersPage <= 1;
      if (next) next.disabled = usersPage >= totalPages;
    } catch (error) {
      tbody.innerHTML =
        '<tr><td colspan="7" class="text-center">Erro: ' + escapeHtml(error.message) + "</td></tr>";
    }
  }

  function closeUserModal() {
    const modal = document.getElementById("crmUserModal");
    if (modal) modal.classList.remove("active");
  }

  function closeRoleModal() {
    const modal = document.getElementById("crmRoleModal");
    if (modal) modal.classList.remove("active");
  }

  async function openUserModal(userId) {
    const modal = document.getElementById("crmUserModal");
    const title = document.getElementById("crmUserModalTitle");
    const errEl = document.getElementById("crmUserFormError");
    const permsSection = document.getElementById("crmUserPermsSection");
    const groupsEl = document.getElementById("crmUserPermsGroups");
    const form = document.getElementById("crmUserForm");
    if (!modal || !form) return;

    errEl.style.display = "none";
    form.reset();
    resetAvatarState();
    document.getElementById("crmUserFormId").value = userId != null ? String(userId) : "";
    document.getElementById("crmUserActive").checked = true;
    document.getElementById("crmUserForcePwChange").checked = true;

    const canManage = canManageUserPerms();
    const reg = await fetchPermissionRegistry();
    const byG = reg.by_group || {};
    const roleSelect = document.getElementById("crmUserRole");
    const onRoleChange = function () {
      permsSection.style.display = roleSelect.value === "admin" ? "none" : "";
    };
    roleSelect.onchange = onRoleChange;

    if (userId != null) {
      title.textContent = "Editar utilizador";
      document.getElementById("crmUserPasswordHint").textContent = "(deixe vazio para não alterar)";
      const [ur, pr] = await Promise.all([
        fetch(`/api/users/${userId}`, { credentials: "include" }).then((r) => r.json()),
        fetch(`/api/users/${userId}/permissions`, { credentials: "include" }).then((r) => r.json()),
      ]);
      if (!ur.success || !ur.data) {
        toast(ur.error || "Erro ao carregar utilizador", "error");
        return;
      }
      const d = ur.data;
      document.getElementById("crmUserName").value = d.name || "";
      document.getElementById("crmUserEmail").value = d.email || "";
      document.getElementById("crmUserPhone").value = d.phone || "";
      await populateRoleSelect(d.role || "");
      document.getElementById("crmUserPassword").value = "";
      const active = d.is_active !== undefined ? d.is_active : d.active;
      document.getElementById("crmUserActive").checked = !!active;
      document.getElementById("crmUserForcePwChange").checked = !!d.must_change_password;
      updateAvatarPreview(d.name || "");
      const selected = new Set(
        (pr.success && pr.data && Array.isArray(pr.data.permission_ids) ? pr.data.permission_ids : []).map(String)
      );
      if (String(d.role).toLowerCase() === "admin") {
        permsSection.style.display = "none";
      } else {
        permsSection.style.display = "";
        document.getElementById("crmUserPermsHelp").textContent = canManage
          ? "Marque os módulos permitidos para este utilizador (além do cargo)."
          : "Só administradores ou quem gere cargos/utilizadores podem alterar isto.";
        groupsEl.innerHTML = renderPermCheckboxes(byG, selected, canManage);
      }
    } else {
      title.textContent = "Novo utilizador";
      document.getElementById("crmUserPasswordHint").textContent = "(obrigatório, mín. 8 caracteres)";
      await populateRoleSelect("");
      updateAvatarPreview("");
      permsSection.style.display = "";
      document.getElementById("crmUserPermsHelp").textContent =
        "Opcional: deixe vazio para aplicar as permissões do cargo. Ou marque módulos específicos.";
      groupsEl.innerHTML = renderPermCheckboxes(byG, new Set(), true);
      onRoleChange();
    }
    modal.classList.add("active");
  }

  async function deactivateUser(id) {
    if (!confirm("Desativar este utilizador? Não poderá iniciar sessão.")) return;
    try {
      const res = await fetch(`/api/users/${id}`, { method: "DELETE", credentials: "include" });
      const j = await res.json();
      if (!res.ok) {
        toast(j.error || "Falha ao desativar", "error");
        return;
      }
      loadUsers();
    } catch (e) {
      toast(e.message || "Erro de rede", "error");
    }
  }

  async function onUserFormSubmit(e) {
    e.preventDefault();
    const errEl = document.getElementById("crmUserFormError");
    errEl.style.display = "none";
    const id = document.getElementById("crmUserFormId").value.trim();
    const name = document.getElementById("crmUserName").value.trim();
    const email = document.getElementById("crmUserEmail").value.trim();
    const phone = document.getElementById("crmUserPhone").value.trim();
    const role = document.getElementById("crmUserRole").value;
    const pw = document.getElementById("crmUserPassword").value;
    const isActive = document.getElementById("crmUserActive").checked;
    const forcePw = document.getElementById("crmUserForcePwChange").checked;
    const submitBtn = document.getElementById("crmUserFormSubmit");

    if (!id && (!pw || pw.length < 8)) {
      errEl.textContent = "Defina uma senha inicial com pelo menos 8 caracteres.";
      errEl.style.display = "block";
      return;
    }
    if (pw && pw.length < 8) {
      errEl.textContent = "A senha deve ter pelo menos 8 caracteres.";
      errEl.style.display = "block";
      return;
    }

    submitBtn.disabled = true;
    try {
      if (!id) {
        const body = {
          name,
          email,
          phone: phone || null,
          role,
          is_active: isActive,
          force_password_change: forcePw,
          password: pw,
        };
        if (role !== "admin") {
          const pids = collectSelectedPermissionIds(document.getElementById("crmUserPermsGroups"));
          if (pids.length) body.permission_ids = pids;
        }
        const res = await fetch("/api/users", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const j = await res.json();
        if (!res.ok) {
          errEl.textContent = j.error || "Erro ao criar.";
          errEl.style.display = "block";
          submitBtn.disabled = false;
          return;
        }
      } else {
        const body = {
          name,
          email,
          phone: phone || null,
          role,
          is_active: isActive,
          force_password_change: forcePw,
        };
        if (pw) body.password = pw;
        const res = await fetch(`/api/users/${id}`, {
          method: "PUT",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const j = await res.json();
        if (!res.ok) {
          errEl.textContent = j.error || "Erro ao atualizar.";
          errEl.style.display = "block";
          submitBtn.disabled = false;
          return;
        }
        if (role !== "admin" && canManageUserPerms()) {
          const pids = collectSelectedPermissionIds(document.getElementById("crmUserPermsGroups"));
          const pr = await fetch(`/api/users/${id}/permissions`, {
            method: "PUT",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ permission_ids: pids }),
          });
          const pj = await pr.json();
          if (!pr.ok) {
            errEl.textContent = pj.error || "Dados guardados, mas falhou ao atualizar permissões.";
            errEl.style.display = "block";
            submitBtn.disabled = false;
            loadUsers();
            return;
          }
        }
      }
      closeUserModal();
      permissionRegistryCache = null;
      loadUsers();
    } catch (ex) {
      errEl.textContent = ex.message || "Erro de rede.";
      errEl.style.display = "block";
    }
    submitBtn.disabled = false;
  }

  async function showNewRoleModal() {
    if (!canManageRoles()) {
      toast("Sem permissão para criar cargos", "error");
      return;
    }
    const modal = document.getElementById("crmRoleModal");
    const form = document.getElementById("crmRoleForm");
    const errEl = document.getElementById("crmRoleFormError");
    const groupsEl = document.getElementById("crmRolePermsGroups");
    if (!modal || !form) return;
    errEl.style.display = "none";
    form.reset();
    const reg = await fetchPermissionRegistry();
    groupsEl.innerHTML = renderPermCheckboxes(reg.by_group || {}, new Set(), true);
    modal.classList.add("active");
  }

  async function onRoleFormSubmit(e) {
    e.preventDefault();
    const errEl = document.getElementById("crmRoleFormError");
    const submitBtn = document.getElementById("crmRoleFormSubmit");
    errEl.style.display = "none";
    const name = document.getElementById("crmRoleName").value.trim();
    const key = document.getElementById("crmRoleKey").value.trim();
    const description = document.getElementById("crmRoleDescription").value.trim();
    const permission_ids = collectSelectedPermissionIds(document.getElementById("crmRolePermsGroups"));
    if (!name) {
      errEl.textContent = "Indique o nome do cargo.";
      errEl.style.display = "block";
      return;
    }
    submitBtn.disabled = true;
    try {
      const body = { name, permission_ids };
      if (key) body.key = key;
      if (description) body.description = description;
      const res = await fetch("/api/roles", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await res.json();
      if (!res.ok) {
        errEl.textContent = j.error || "Erro ao criar cargo.";
        errEl.style.display = "block";
        submitBtn.disabled = false;
        return;
      }
      crmRolesCache = null;
      closeRoleModal();
      toast("Cargo criado: " + (j.data?.name || name), "success");
      await populateRoleSelect(j.data?.key || "");
    } catch (ex) {
      errEl.textContent = ex.message || "Erro de rede.";
      errEl.style.display = "block";
    }
    submitBtn.disabled = false;
  }

  function bindUi() {
    document.getElementById("crmUserForm")?.addEventListener("submit", onUserFormSubmit);
    document.getElementById("crmRoleForm")?.addEventListener("submit", onRoleFormSubmit);
    document.getElementById("crmNewUserBtn")?.addEventListener("click", () => openUserModal(null));
    document.getElementById("crmNewRoleBtn")?.addEventListener("click", () => showNewRoleModal());
    document.getElementById("prevPageUsers")?.addEventListener("click", () => {
      usersPage = Math.max(1, usersPage - 1);
      loadUsers();
    });
    document.getElementById("nextPageUsers")?.addEventListener("click", () => {
      usersPage += 1;
      loadUsers();
    });
    document.getElementById("usersTableBody")?.addEventListener("click", (e) => {
      const edit = e.target.closest("[data-edit-user]");
      if (edit) {
        openUserModal(edit.getAttribute("data-edit-user"));
        return;
      }
      const del = e.target.closest("[data-deactivate-user]");
      if (del) deactivateUser(del.getAttribute("data-deactivate-user"));
    });
    document.querySelectorAll('[onclick*="closeCrmUserModal"]').forEach((el) => {
      el.removeAttribute("onclick");
      el.addEventListener("click", closeUserModal);
    });
    document.querySelectorAll('[onclick*="closeCrmRoleModal"]').forEach((el) => {
      el.removeAttribute("onclick");
      el.addEventListener("click", closeRoleModal);
    });
    document.getElementById("logoutBtn")?.addEventListener("click", async () => {
      await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
      window.location.href = "/login.html";
    });

    window.closeCrmUserModal = closeUserModal;
    window.closeCrmRoleModal = closeRoleModal;
    window.showNewUserModal = () => openUserModal(null);
    window.showNewRoleModal = showNewRoleModal;
    window.openCrmUserModal = openUserModal;
    window.deactivateCrmUser = deactivateUser;
    window.changePageUsers = (delta) => {
      usersPage = Math.max(1, usersPage + delta);
      loadUsers();
    };
  }

  async function boot() {
    bindUi();
    try {
      const r = await fetch("/api/auth/session", { credentials: "include" });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || !data.authenticated) {
        window.location.href = "/login.html";
        return;
      }
      const u = data.user || {};
      if (u.must_change_password) {
        window.location.href = "/change-password.html";
        return;
      }
      crmUserPermissions = Array.isArray(u.permissions) ? u.permissions : [];
      crmUserRole = u.role || "";
      window.__crmPermissionKeys = crmUserPermissions.slice();
      window.__crmUserRole = crmUserRole;
      window.__crmPalettePerms = crmUserPermissions.slice();
      window.__crmPaletteRole = crmUserRole;
      const disp = (u.name && String(u.name).trim()) || u.email || "Utilizador";
      const sn = document.getElementById("sidebarUserName");
      const sr = document.getElementById("sidebarUserRole");
      const sa = document.getElementById("sidebarUserAvatar");
      if (sn) sn.textContent = disp;
      if (sr) sr.textContent = crmUserRole ? String(crmUserRole) : "";
      if (sa) {
        const ch = disp.trim().charAt(0).toUpperCase();
        sa.textContent = ch && /[A-Z0-9]/.test(ch) ? ch : "?";
      }
      if (!crmUserPermissions.includes("users.view") && crmUserRole !== "admin") {
        toast("Sem permissão para ver a equipe", "error");
      }
      await loadUsers();
    } catch (err) {
      console.error(err);
      window.location.href = "/login.html";
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
