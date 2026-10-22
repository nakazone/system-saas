/* global fetch, crmNotify */
(function () {
  const $ = (id) => document.getElementById(id);
  let partnerWorkspaceSlug = '';
  const TYPE_LABELS = {
    builder: 'Builder / Construtora',
    contractor: 'General Contractor',
    architect: 'Architect',
    designer: 'Interior Designer',
    developer: 'Developer',
    subcontractor: 'Subcontractor',
  };

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function badgeStatus(st) {
    const c = st === 'active' ? 'active' : st === 'pending' ? 'pending' : 'inactive';
    const lbl = st === 'active' ? 'Ativo' : st === 'pending' ? 'Pendente' : 'Inativo';
    return `<span class="bp-badge bp-badge--${c}">${lbl}</span>`;
  }

  function badgeType(t) {
    const key = String(t || 'contractor').toLowerCase();
    return `<span class="bp-badge bp-badge--${key === 'architect' || key === 'designer' || key === 'developer' ? key : 'contractor'}">${escapeHtml(TYPE_LABELS[key] || t)}</span>`;
  }

  function regionsLabel(regions) {
    if (!regions || !regions.length) return '—';
    return escapeHtml(regions.slice(0, 2).join(', ') + (regions.length > 2 ? '…' : ''));
  }

  async function api(path, opts) {
    const r = await fetch(path, { credentials: 'include', ...opts });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || r.statusText);
    return j;
  }

  function renderMetrics(stats) {
    $('metricsRow').innerHTML = `
      <div class="bp-card bp-metric"><div class="bp-metric__val">${stats.active || 0}</div><div class="bp-metric__lbl">Builders ativos</div></div>
      <div class="bp-card bp-metric"><div class="bp-metric__val">${stats.open_projects || 0}</div><div class="bp-metric__lbl">Projetos em andamento</div></div>
      <div class="bp-card bp-metric"><div class="bp-metric__val">${stats.pending || 0}</div><div class="bp-metric__lbl">Pendentes aprovação</div></div>
      <div class="bp-card bp-metric"><div class="bp-metric__val">—</div><div class="bp-metric__lbl">Receita MTD (em breve)</div></div>`;
  }

  async function loadList() {
    const params = new URLSearchParams();
    const s = $('filterSearch').value.trim();
    const t = $('filterType').value;
    const st = $('filterStatus').value;
    if (s) params.set('search', s);
    if (t) params.set('type', t);
    if (st) params.set('status', st);
    try {
      const j = await api(`/api/builders?${params}`);
      renderMetrics(j.stats || {});
      const rows = j.data || [];
      if (!rows.length) {
          $('buildersTbody').innerHTML = '<tr><td colspan="9">Nenhum builder ou contractor encontrado.</td></tr>';
        return;
      }
      $('buildersTbody').innerHTML = rows
        .map((b, i) => {
          const name = escapeHtml(b.full_name || `${b.first_name} ${b.last_name}`);
          const login = b.last_login ? String(b.last_login).slice(0, 16).replace('T', ' ') : '—';
          const hasPartnerUsers = Array.isArray(b.partner_users) && b.partner_users.length > 0;
          const portalLabel = b.portal_access ? 'Ativo' : hasPartnerUsers ? 'Suspenso' : 'Sem acesso';
          const portalBadge = b.portal_access ? 'active' : hasPartnerUsers ? 'pending' : 'inactive';
          const portalAction = b.portal_access ? 'disable' : 'enable';
          const portalActionLabel = b.portal_access ? 'Suspender' : hasPartnerUsers ? 'Reativar' : 'Liberar portal';
          return `<tr>
            <td>${i + 1}</td>
            <td><strong>${name}</strong><br><span style="font-size:11px;color:#6b7280">${escapeHtml(b.email)}</span></td>
            <td>${badgeType(b.type)}</td>
            <td>${escapeHtml(b.company || '—')}</td>
            <td>${b.project_count || 0}</td>
            <td>${badgeStatus(b.status)}</td>
            <td><span class="bp-badge bp-badge--${portalBadge}">${portalLabel}</span></td>
            <td>${login}</td>
            <td style="white-space:nowrap">
              <a href="partner-login.html${partnerWorkspaceSlug ? `?workspace=${encodeURIComponent(partnerWorkspaceSlug)}` : ''}" target="_blank" rel="noopener" title="Abrir o acesso do parceiro">Portal</a> ·
              <button type="button" class="btn btn-sm" data-portal-action="${portalAction}" data-builder-id="${escapeHtml(b.id)}" data-has-users="${hasPartnerUsers ? '1' : '0'}">${portalActionLabel}</button>
              ${b.portal_access ? ` · <button type="button" class="btn btn-sm" data-portal-action="reset" data-builder-id="${escapeHtml(b.id)}">Redefinir senha</button>` : ''} ·
              <button type="button" class="btn btn-sm btn-danger" data-del-builder="${b.id}">Excluir</button>
            </td>
          </tr>`;
        })
        .join('');
    } catch (e) {
      $('buildersTbody').innerHTML = `<tr><td colspan="9">${escapeHtml(e.message)}</td></tr>`;
    }
  }

  async function deleteBuilderCadastro(builderId) {
    const id = parseInt(builderId, 10);
    if (!id) return;
    if (!confirm('Excluir este cadastro de builder? Esta ação não pode ser desfeita.')) return;
    try {
      await api(`/api/builders/${id}`, { method: 'DELETE' });
      crmNotify('Cadastro excluído.', 'success');
      await loadList();
    } catch (e) {
      crmNotify(e.message || 'Não foi possível excluir.', 'error');
    }
  }

  async function changePortalAccess(button) {
    const id = button.dataset.builderId;
    const action = button.dataset.portalAction;
    if (!id || !action) return;
    const enabled = action !== 'disable';
    if (action === 'disable' && !confirm('Suspender o acesso ao portal para este parceiro?')) return;
    if (action === 'reset' && !confirm('Gerar uma nova senha temporária? O parceiro precisará trocá-la ao entrar.')) return;
    button.disabled = true;
    try {
      const j = await api(`/api/builders/${encodeURIComponent(id)}/portal-access`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled, reset_password: action === 'reset' }),
      });
      const tempPassword = j.data?.temp_password;
      const loginUrl = `${location.origin}/partner-login.html${partnerWorkspaceSlug ? `?workspace=${encodeURIComponent(partnerWorkspaceSlug)}` : ''}`;
      crmNotify(
        tempPassword
          ? `Acesso pronto. Login: ${loginUrl} · Senha temporária: ${tempPassword}. O parceiro trocará a senha no primeiro acesso.`
          : action === 'disable' ? 'Acesso ao portal suspenso.' : 'Acesso ao portal atualizado.',
        'success',
        tempPassword ? 16000 : 5000,
      );
      await loadList();
    } catch (e) {
      crmNotify(e.message || 'Não foi possível atualizar o acesso.', 'error');
      button.disabled = false;
    }
  }

  $('buildersTbody')?.addEventListener('click', (e) => {
    const target = e.target;
    const portalBtn = target.closest('[data-portal-action]');
    if (portalBtn) {
      e.preventDefault();
      void changePortalAccess(portalBtn);
      return;
    }
    const btn = target.closest('[data-del-builder]');
    if (!btn) return;
    e.preventDefault();
    void deleteBuilderCadastro(btn.getAttribute('data-del-builder'));
  });

  function openModal() {
    $('builderForm').reset();
    $('modalTitle').textContent = 'Novo Builder';
    $('builderModal').classList.add('open');
  }

  function closeModal() {
    $('builderModal').classList.remove('open');
  }

  $('btnNewBuilder').addEventListener('click', openModal);
  $('modalCancel').addEventListener('click', closeModal);
  $('filterSearch').addEventListener('input', () => {
    clearTimeout(window._bpSearchT);
    window._bpSearchT = setTimeout(loadList, 300);
  });
  $('filterType').addEventListener('change', loadList);
  $('filterStatus').addEventListener('change', loadList);

  $('builderForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const body = {
      first_name: fd.get('first_name'),
      last_name: fd.get('last_name'),
      email: fd.get('email'),
      phone: fd.get('phone') || null,
      company: fd.get('company') || null,
      website: fd.get('website') || null,
      type: fd.get('type'),
      status: fd.get('status'),
      internal_note: fd.get('internal_note') || null,
      portal_access: !!$('portalAccess').checked,
    };
    try {
      const j = await api('/api/builders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      closeModal();
      if (j.data?.temp_password) {
        const loginUrl = `${location.origin}/partner-login.html${partnerWorkspaceSlug ? `?workspace=${encodeURIComponent(partnerWorkspaceSlug)}` : ''}`;
        crmNotify(`Cadastro e portal criados. Login: ${loginUrl} · Senha temporária: ${j.data.temp_password}. O parceiro trocará a senha no primeiro acesso.`, 'success', 16000);
      } else {
        crmNotify('Builder criado.', 'success');
      }
      loadList();
    } catch (err) {
      crmNotify(err.message || 'Erro ao salvar', 'error');
    }
  });

  async function init() {
    const sess = await fetch('/api/auth/session', { credentials: 'include' }).then((r) => r.json());
    if (!sess.authenticated) {
      location.href = 'login.html';
      return;
    }
    partnerWorkspaceSlug = sess.organization?.slug || '';
    $('logoutBtn')?.addEventListener('click', async () => {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
      location.href = 'login.html';
    });
    const u = sess.user || {};
    if ($('sidebarUserName')) $('sidebarUserName').textContent = u.name || u.email || '—';
    if ($('sidebarUserAvatar')) $('sidebarUserAvatar').textContent = (u.name || u.email || '?').charAt(0).toUpperCase();
    await loadList();
  }

  init();
})();
