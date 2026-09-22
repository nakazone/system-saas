/* global fetch, crmNotify */
(function () {
  const id = parseInt(new URLSearchParams(location.search).get('id'), 10);
  const root = document.getElementById('detailRoot');

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function initials(b) {
    return ((b.first_name || '')[0] || '') + ((b.last_name || '')[0] || '') || '?';
  }

  function fmtWhen(iso) {
    if (!iso) return '—';
    return String(iso).slice(0, 16).replace('T', ' ');
  }

  async function api(path, opts) {
    const r = await fetch(path, { credentials: 'include', ...opts });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || r.statusText);
    return j;
  }

  async function setPortalPassword(password) {
    const j = await api(`/api/builders/${id}/reset-portal-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(password ? { password } : {}),
    });
    return j.data?.admin_password || j.data?.temp_password || password;
  }

  function renderPasswordPanel(auth) {
    const a = auth || {};
    const hasPw = !!a.has_password;
    const adminPw = a.admin_password || '';
    const setAt = fmtWhen(a.password_set_at);
    const statusParts = [];
    if (a.portal_access) statusParts.push('Acesso ativo');
    else statusParts.push('Sem acesso');
    if (a.portal_blocked) statusParts.push('bloqueado');
    if (hasPw) statusParts.push('senha definida');
    else statusParts.push('sem senha');

    return `
      <div class="bp-card" style="margin-bottom:1rem">
        <h3 class="bp-title" style="font-size:1rem;margin:0 0 8px">Senha do portal</h3>
        <p class="bp-muted" style="margin:0 0 12px;font-size:13px">
          Estado: ${escapeHtml(statusParts.join(' · '))}.
          A senha encriptada não pode ser lida — s— aparece aqui se foi definida ou resetada por um admin.
        </p>
        ${
          adminPw
            ? `<div id="currentPwBox" style="margin-bottom:12px">
                <label class="bp-eyebrow">Senha atual (visível ao admin)</label>
                <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px">
                  <input type="password" id="adminPwShow" readonly value="${escapeHtml(adminPw)}" style="flex:1;min-width:180px;font-family:monospace" />
                  <button type="button" class="btn btn-secondary" id="btnTogglePw">Mostrar</button>
                  <button type="button" class="btn btn-secondary" id="btnCopyPw">Copiar</button>
                </div>
                <p class="bp-muted" style="margin:6px 0 0;font-size:12px">Definida em: ${escapeHtml(setAt)}</p>
              </div>`
            : hasPw
              ? `<p class="bp-muted" style="margin:0 0 12px">O parceiro alterou a senha no portal — não — visível ao admin. Use o campo abaixo para definir uma nova.</p>`
              : `<p class="bp-muted" style="margin:0 0 12px">Nenhuma senha definida ainda.</p>`
        }
        <label class="bp-eyebrow" for="newPortalPw">Nova senha</label>
        <input type="text" id="newPortalPw" placeholder="Mínimo 8 caracteres" autocomplete="new-password" style="width:100%;margin-top:6px;font-family:monospace" />
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
          <button type="button" class="bp-btn-tan" id="btnSavePortalPw">Guardar senha</button>
          <button type="button" class="btn btn-secondary" id="btnGenPortalPw">Gerar automática</button>
        </div>
      </div>`;
  }

  function wirePasswordPanel(auth) {
    const toggle = document.getElementById('btnTogglePw');
    const copyBtn = document.getElementById('btnCopyPw');
    const input = document.getElementById('adminPwShow');
    if (toggle && input) {
      toggle.addEventListener('click', () => {
        const show = input.type === 'password';
        input.type = show ? 'text' : 'password';
        toggle.textContent = show ? 'Ocultar' : 'Mostrar';
      });
    }
    if (copyBtn && input) {
      copyBtn.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(input.value);
          crmNotify('Senha copiada.', 'success');
        } catch {
          crmNotify('Não foi possível copiar.', 'error');
        }
      });
    }

    document.getElementById('btnSavePortalPw')?.addEventListener('click', async () => {
      const pw = document.getElementById('newPortalPw')?.value?.trim();
      if (!pw || pw.length < 8) {
        crmNotify('A senha deve ter pelo menos 8 caracteres.', 'error');
        return;
      }
      try {
        const saved = await setPortalPassword(pw);
        crmNotify(`Senha guardada: ${saved}`, 'success', 15000);
        reload();
      } catch (e) {
        crmNotify(e.message, 'error');
      }
    });

    document.getElementById('btnGenPortalPw')?.addEventListener('click', async () => {
      try {
        const saved = await setPortalPassword(null);
        document.getElementById('newPortalPw').value = saved;
        crmNotify(`Senha gerada: ${saved}`, 'success', 15000);
        reload();
      } catch (e) {
        crmNotify(e.message, 'error');
      }
    });
  }

  function render(b, projects, accessLog, portalAuth) {
    const months =
      b.created_at
        ? Math.max(
            1,
            Math.round(
              (Date.now() - new Date(b.created_at).getTime()) / (30 * 24 * 3600 * 1000)
            )
          )
        : 0;
    const projRows = (projects || [])
      .map(
        (p) => `<tr>
          <td><a href="project-detail.html?id=${p.id}">${escapeHtml(p.name || p.project_number || '#' + p.id)}</a></td>
          <td>${escapeHtml(p.address || '—')}</td>
          <td>${escapeHtml(p.status || '')}</td>
          <td>${p.contract_value != null ? '$' + Number(p.contract_value).toLocaleString() : '—'}</td>
        </tr>`
      )
      .join('');

    root.innerHTML = `
      <aside class="bp-card">
        <div class="bd-avatar">${escapeHtml(initials(b))}</div>
        <h2 class="bp-title" style="font-size:1.1rem">${escapeHtml(b.first_name)} ${escapeHtml(b.last_name)}</h2>
        <p style="color:var(--bp-muted);margin:0 0 12px">${escapeHtml(b.company || '')}</p>
        <p><strong>Email:</strong> ${escapeHtml(b.email)}</p>
        <p><strong>Phone:</strong> ${escapeHtml(b.phone || '—')}</p>
        <p><strong>Parceiro há:</strong> ${months} meses</p>
        <p><strong>Último login:</strong> ${b.last_login ? escapeHtml(String(b.last_login).slice(0, 16)) : '—'}</p>
        <div style="margin-top:12px;display:flex;flex-direction:column;gap:8px">
          <a class="bp-btn-tan" style="text-align:center;text-decoration:none" href="builder-messages-admin.html?builder_id=${b.id}">Mensagens</a>
          <a class="btn btn-secondary" style="text-align:center" href="builder-login.html" target="_blank" rel="noopener">Ver portal (login)</a>
          <button type="button" class="btn btn-danger" id="btnDeleteBuilder">Excluir cadastro</button>
        </div>
      </aside>
      <div>
        <div class="bd-tabs" role="tablist">
          <button type="button" class="active" data-tab="overview">Visó Geral</button>
          <button type="button" data-tab="projects">Projetos (${(projects || []).length})</button>
          <button type="button" data-tab="access">Acesso ao Portal</button>
        </div>
        <div class="bd-panel active" id="tab-overview">
          <div class="bp-card">
            <p><strong>Status:</strong> ${escapeHtml(b.status)} · <strong>Tipo:</strong> ${escapeHtml(b.type || '')}</p>
            <p><strong>Nota interna:</strong></p>
            <textarea id="internalNote" rows="4" style="width:100%">${escapeHtml(b.internal_note || '')}</textarea>
            <button type="button" class="bp-btn-tan" id="btnSaveNote" style="margin-top:8px">Guardar nota</button>
          </div>
        </div>
        <div class="bd-panel" id="tab-projects">
          <div class="bp-table-wrap"><table class="bp-table"><thead><tr><th>Projeto</th><th>Endereço</th><th>Status</th><th>Valor</th></tr></thead><tbody>${projRows || '<tr><td colspan="4">Sem projetos</td></tr>'}</tbody></table></div>
        </div>
        <div class="bd-panel" id="tab-access">
          ${renderPasswordPanel(portalAuth)}
          <div class="bp-card">
            <h3 class="bp-title" style="font-size:1rem;margin:0 0 8px">Registo de acesso</h3>
            <table class="bp-table"><thead><tr><th>Data</th><th>Ação</th><th>IP</th></tr></thead><tbody>
              ${(accessLog || [])
                .map(
                  (l) =>
                    `<tr><td>${escapeHtml(String(l.created_at).slice(0, 19))}</td><td>${escapeHtml(l.action)}</td><td>${escapeHtml(l.ip_address || '—')}</td></tr>`
                )
                .join('') || '<tr><td colspan="3">Sem registos</td></tr>'}
            </tbody></table>
          </div>
        </div>
      </div>`;

    root.querySelectorAll('.bd-tabs button').forEach((btn) => {
      btn.addEventListener('click', () => {
        root.querySelectorAll('.bd-tabs button').forEach((x) => x.classList.remove('active'));
        root.querySelectorAll('.bd-panel').forEach((x) => x.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
      });
    });

    document.getElementById('btnSaveNote').addEventListener('click', async () => {
      try {
        await api(`/api/builders/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ internal_note: document.getElementById('internalNote').value }),
        });
        crmNotify('Nota guardada.', 'success');
      } catch (e) {
        crmNotify(e.message, 'error');
      }
    });

    wirePasswordPanel(portalAuth);

    document.getElementById('btnDeleteBuilder')?.addEventListener('click', async () => {
      if (!confirm('Excluir este cadastro de builder? Esta ação não pode ser desfeita.')) return;
      try {
        await api(`/api/builders/${id}`, { method: 'DELETE' });
        crmNotify('Cadastro excluído.', 'success');
        location.href = 'builders.html';
      } catch (e) {
        crmNotify(e.message || 'Não foi possível excluir.', 'error');
      }
    });
  }

  async function reload() {
    const j = await api(`/api/builders/${id}`);
    render(j.data.builder, j.data.projects, j.data.access_log, j.data.portal_auth);
  }

  async function init() {
    const sess = await fetch('/api/auth/session', { credentials: 'include' }).then((r) => r.json());
    if (!sess.authenticated) {
      location.href = 'login.html';
      return;
    }
    if (!Number.isFinite(id)) {
      root.textContent = 'ID inválido';
      return;
    }
    try {
      await reload();
    } catch (e) {
      root.textContent = e.message;
    }
  }

  init();
})();
