(function () {
  const $ = (id) => document.getElementById(id);
  const mainError = $('partnerPortalError');
  let partnerDocuments = [];
  let documentFilter = 'all';
  let documentsLoaded = false;
  let documentsLoading = false;
  const statusLabels = {
    planning: 'Em planejamento',
    scheduled: 'Agendado',
    in_progress: 'Em andamento',
    needs_invoicing: 'Em finalização',
    completed: 'Concluído',
    canceled: 'Cancelado',
    cancelled: 'Cancelado',
    active: 'Ativo',
    draft: 'Rascunho',
  };

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[char]));
  }

  function formatDate(value) {
    if (!value) return '';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium' }).format(date);
  }

  async function request(url, options) {
    const response = await fetch(url, { credentials: 'include', ...options });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const err = new Error(body.error || 'Não foi possível carregar os dados.');
      err.status = response.status;
      err.code = body.code;
      throw err;
    }
    return body;
  }

  function renderItems(data) {
    const projects = (data.projects || []).map((item) => ({
      id: item.id,
      number: item.number,
      title: item.name,
      status: item.status,
      address: item.address,
      updated_at: item.updatedAt,
      kind: 'Projeto',
    }));
    const jobs = (data.jobs || []).map((item) => ({
      id: item.id,
      number: item.number,
      title: item.title,
      status: item.status,
      address: item.address,
      updated_at: item.updatedAt,
      scheduled_start: item.scheduledStart,
      scheduled_end: item.scheduledEnd,
      kind: 'Job',
    }));
    const items = [...projects, ...jobs].sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
    $('partnerItemCount').textContent = `${items.length} ${items.length === 1 ? 'item' : 'itens'}`;
    if (!items.length) {
      $('partnerItems').innerHTML = '<div class="partner-empty"><h3>Nenhum projeto compartilhado ainda</h3><p>Quando a equipe vincular um projeto ou job ao seu cadastro, ele aparecerá aqui.</p></div>';
      return;
    }
    $('partnerItems').innerHTML = items.map((item) => {
      const dateLine = item.scheduled_start ? `Agendado para ${formatDate(item.scheduled_start)}` : `Atualizado em ${formatDate(item.updated_at)}`;
      return `<article class="partner-item">
        <div class="partner-item-top"><span class="partner-item-kind">${item.kind}</span><span class="partner-status">${escapeHtml(statusLabels[item.status] || item.status || 'Atualizado')}</span></div>
        <h3>${escapeHtml(item.title || `${item.kind} ${item.number || ''}`)}</h3>
        ${item.number ? `<p class="partner-item-number">Nº ${escapeHtml(item.number)}</p>` : ''}
        ${item.address ? `<p class="partner-item-address">${escapeHtml(item.address)}</p>` : ''}
        <p class="partner-item-date">${escapeHtml(dateLine)}</p>
      </article>`;
    }).join('');
  }

  function documentTypeLabel(type) {
    if (type === 'photo') return 'Foto';
    if (type === 'video') return 'Vídeo';
    if (type === 'report') return 'Relatório';
    return 'Arquivo';
  }

  function visibleDocuments() {
    const query = $('partnerDocumentSearch').value.trim().toLocaleLowerCase('pt-BR');
    return partnerDocuments.filter((doc) => {
      const matchesType = documentFilter === 'all' ||
        (documentFilter === 'photo' ? ['photo', 'video'].includes(doc.type) : doc.type === documentFilter);
      const searchText = [doc.title, doc.summary, doc.job?.title, doc.job?.number, doc.job?.address]
        .filter(Boolean).join(' ').toLocaleLowerCase('pt-BR');
      return matchesType && (!query || searchText.includes(query));
    });
  }

  function renderDocuments() {
    const items = visibleDocuments();
    $('partnerDocumentCount').textContent = `${items.length} ${items.length === 1 ? 'documento' : 'documentos'}`;
    if (!partnerDocuments.length) {
      $('partnerDocuments').innerHTML = '<div class="partner-empty"><h3>Nenhum documento compartilhado</h3><p>Quando a equipe liberar fotos, relatórios ou arquivos de uma obra para você, eles aparecerão aqui.</p></div>';
      return;
    }
    if (!items.length) {
      $('partnerDocuments').innerHTML = '<div class="partner-empty"><h3>Nenhum resultado</h3><p>Experimente mudar a busca ou o filtro.</p></div>';
      return;
    }
    $('partnerDocuments').innerHTML = items.map((doc) => {
      const job = doc.job || {};
      const jobLabel = `${job.number ? `Obra nº ${job.number}` : 'Obra'}${job.title ? ` · ${job.title}` : ''}`;
      const date = formatDate(doc.created_at);
      const preview = doc.type === 'photo'
        ? `<a class="partner-document-preview" href="${escapeHtml(doc.file_url)}" target="_blank" rel="noopener" aria-label="Abrir ${escapeHtml(doc.title)}"><img src="${escapeHtml(doc.file_url)}" alt="${escapeHtml(doc.title)}" loading="lazy" /></a>`
        : `<div class="partner-document-preview partner-document-preview--file" aria-hidden="true"><span>${doc.type === 'report' ? 'PDF' : doc.type === 'video' ? 'VÍDEO' : 'ARQUIVO'}</span></div>`;
      return `<article class="partner-document-card">
        ${preview}
        <div class="partner-document-card-body">
          <div class="partner-document-meta"><span class="partner-document-type">${documentTypeLabel(doc.type)}</span>${date ? `<time datetime="${escapeHtml(doc.created_at)}">${escapeHtml(date)}</time>` : ''}</div>
          <h3>${escapeHtml(doc.title || 'Documento da obra')}</h3>
          <p class="partner-document-job">${escapeHtml(jobLabel)}</p>
          ${job.address ? `<p class="partner-document-address">${escapeHtml(job.address)}</p>` : ''}
          ${doc.summary ? `<p class="partner-document-summary">${escapeHtml(doc.summary)}</p>` : ''}
          <div class="partner-document-actions">
            <a class="partner-document-open" href="${escapeHtml(doc.file_url)}" target="_blank" rel="noopener">Visualizar</a>
            <a class="partner-document-download" href="${escapeHtml(doc.file_url)}?download=1">Baixar</a>
          </div>
        </div>
      </article>`;
    }).join('');
  }

  function showPortalView(view) {
    const showDocuments = view === 'documents';
    $('partnerProjectsSection').hidden = showDocuments;
    $('partnerDocumentsSection').hidden = !showDocuments;
    $('partnerJobsTab').setAttribute('aria-selected', showDocuments ? 'false' : 'true');
    $('partnerJobsTab').tabIndex = showDocuments ? -1 : 0;
    $('partnerDocumentsTab').setAttribute('aria-selected', showDocuments ? 'true' : 'false');
    $('partnerDocumentsTab').tabIndex = showDocuments ? 0 : -1;
    if (showDocuments && !documentsLoaded && !documentsLoading) loadDocuments();
  }

  async function loadDocuments() {
    documentsLoading = true;
    $('partnerDocuments').innerHTML = '<div class="partner-empty"><p>Carregando documentos…</p></div>';
    try {
      const response = await request('/api/partner-portal/documents');
      partnerDocuments = response.data || [];
      documentsLoaded = true;
      renderDocuments();
    } catch (err) {
      if (err.status === 401) {
        location.replace('partner-login.html');
        return;
      }
      mainError.textContent = err.message || 'Não foi possível carregar os documentos.';
      mainError.hidden = false;
      $('partnerDocuments').innerHTML = '';
    } finally {
      documentsLoading = false;
    }
  }

  async function loadPortal() {
    mainError.hidden = true;
    try {
      const session = await request('/api/partner-auth/session');
      if (!session.authenticated) {
        location.replace('partner-login.html');
        return;
      }
      const user = session.data || {};
      $('partnerName').textContent = user.name || 'parceiro';
      $('partnerAccountName').textContent = user.name || user.email || 'Parceiro';
      $('partnerCompany').textContent = user.company_name || '';
      $('changePasswordPanel').hidden = !user.must_change_password;
      $('partnerProjectsSection').hidden = Boolean(user.must_change_password);
      $('partnerPortalTabs').hidden = Boolean(user.must_change_password);
      if (user.must_change_password) return;

      const overview = await request('/api/partner-portal/overview');
      renderItems(overview.data || {});
      $('partnerProjectsSection').hidden = false;
      showPortalView('jobs');
    } catch (err) {
      if (err.status === 401) {
        location.replace('partner-login.html');
        return;
      }
      mainError.textContent = err.message || 'Não foi possível carregar o portal.';
      mainError.hidden = false;
    }
  }

  $('changePasswordForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const error = $('passwordError');
    const button = $('changePasswordButton');
    error.hidden = true;
    const password = $('newPassword').value;
    if (password !== $('confirmPassword').value) {
      error.textContent = 'As senhas não coincidem.';
      error.hidden = false;
      return;
    }
    button.disabled = true;
    button.textContent = 'Salvando…';
    try {
      await request('/api/partner-auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      $('newPassword').value = '';
      $('confirmPassword').value = '';
      await loadPortal();
    } catch (err) {
      error.textContent = err.message || 'Não foi possível salvar a senha.';
      error.hidden = false;
    } finally {
      button.disabled = false;
      button.textContent = 'Salvar senha';
    }
  });

  $('partnerJobsTab')?.addEventListener('click', () => showPortalView('jobs'));
  $('partnerDocumentsTab')?.addEventListener('click', () => showPortalView('documents'));
  $('partnerDocumentSearch')?.addEventListener('input', renderDocuments);
  $('partnerDocumentFilters')?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-doc-filter]');
    if (!button) return;
    documentFilter = button.getAttribute('data-doc-filter') || 'all';
    document.querySelectorAll('[data-doc-filter]').forEach((filter) => {
      filter.setAttribute('aria-pressed', filter === button ? 'true' : 'false');
    });
    renderDocuments();
  });

  $('partnerLogout')?.addEventListener('click', async () => {
    try { await request('/api/partner-auth/logout', { method: 'POST' }); } catch (_) { /* sign out locally either way */ }
    location.replace('partner-login.html');
  });

  void loadPortal();
})();
