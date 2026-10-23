(function () {
  const $ = (id) => document.getElementById(id);
  const mainError = $('partnerPortalError');
  let partnerDocuments = [];
  let documentFilter = 'all';
  let documentsLoaded = false;
  let documentsLoading = false;
  let partnerJobs = [];
  let partnerProjects = [];
  let partnerProviders = [];
  let invoicesLoaded = false;
  let requestsLoaded = false;
  let calendarMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  let selectedCalendarDate = dateKey(new Date());
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

  function dateKey(value) {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function money(value) {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(value) || 0);
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

  function jobCard(item) {
    const dateLine = item.scheduledStart ? `Agendado para ${formatDate(item.scheduledStart)}` : `Atualizado em ${formatDate(item.updatedAt)}`;
    return `<article class="partner-item">
      <div class="partner-item-top"><span class="partner-item-kind">Job${item.number ? ` · #${escapeHtml(item.number)}` : ''}</span><span class="partner-status">${escapeHtml(statusLabels[item.status] || item.status || 'Atualizado')}</span></div>
      <h3>${escapeHtml(item.title || 'Job')}</h3>
      ${item.address ? `<p class="partner-item-address">${escapeHtml(item.address)}</p>` : ''}
      <p class="partner-item-date">${escapeHtml(dateLine)}</p>
    </article>`;
  }

  function renderItems(data) {
    partnerProjects = (data.projects || []).map((item) => ({
      id: item.id,
      number: item.number,
      title: item.name,
      status: item.status,
      address: item.address,
      updated_at: item.updatedAt,
      kind: 'Projeto',
    }));
    partnerJobs = (data.jobs || []).map((item) => ({
      id: item.id,
      number: item.number,
      title: item.title,
      status: item.status,
      address: item.address,
      updatedAt: item.updatedAt,
      scheduledStart: item.scheduledStart,
      scheduledEnd: item.scheduledEnd,
    }));
    const activeJobs = partnerJobs.filter((job) => job.status !== 'completed');
    const historyJobs = partnerJobs.filter((job) => job.status === 'completed');
    const active = [...activeJobs.map((job) => ({ ...job, kind: 'Job' })), ...partnerProjects]
      .sort((a, b) => new Date(b.updatedAt || b.updated_at).getTime() - new Date(a.updatedAt || a.updated_at).getTime());
    $('partnerItemCount').textContent = `${activeJobs.length} ${activeJobs.length === 1 ? 'job ativo' : 'jobs ativos'}`;
    $('partnerJobSummary').innerHTML = [
      ['Em andamento', partnerJobs.filter((job) => job.status === 'in_progress').length],
      ['Agendados', partnerJobs.filter((job) => job.status === 'scheduled').length],
      ['Aguardando agenda', partnerJobs.filter((job) => job.status === 'draft').length],
    ].map(([label, value]) => `<div class="partner-summary-card"><span>${label}</span><strong>${value}</strong></div>`).join('');
    $('partnerItems').innerHTML = active.length
      ? active.map((item) => item.kind === 'Job' ? jobCard(item) : `<article class="partner-item"><div class="partner-item-top"><span class="partner-item-kind">Projeto</span><span class="partner-status">${escapeHtml(statusLabels[item.status] || item.status || 'Atualizado')}</span></div><h3>${escapeHtml(item.title || 'Projeto')}</h3>${item.number ? `<p class="partner-item-number">Nº ${escapeHtml(item.number)}</p>` : ''}${item.address ? `<p class="partner-item-address">${escapeHtml(item.address)}</p>` : ''}<p class="partner-item-date">Atualizado em ${escapeHtml(formatDate(item.updated_at))}</p></article>`).join('')
      : '<div class="partner-empty"><h3>Nenhum job ativo</h3><p>Quando o fornecedor selecionado agendar ou iniciar um job para você, ele aparecerá aqui.</p></div>';
    $('partnerHistoryCount').textContent = `${historyJobs.length} ${historyJobs.length === 1 ? 'job concluído' : 'jobs concluídos'}`;
    $('partnerHistoryItems').innerHTML = historyJobs.length
      ? historyJobs.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()).map(jobCard).join('')
      : '<div class="partner-empty"><h3>Nenhum job concluído</h3><p>Jobs concluídos pelo fornecedor aparecerão aqui.</p></div>';
    renderCalendar();
  }

  function renderCalendar() {
    const monthLabel = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' }).format(calendarMonth);
    const first = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), 1);
    const offset = (first.getDay() + 6) % 7;
    const start = new Date(first.getFullYear(), first.getMonth(), 1 - offset);
    const today = dateKey(new Date());
    const scheduled = partnerJobs.filter((job) => job.scheduledStart);
    const byDay = new Map();
    scheduled.forEach((job) => {
      const startDay = new Date(job.scheduledStart);
      const endDay = job.scheduledEnd ? new Date(job.scheduledEnd) : new Date(startDay);
      startDay.setHours(0, 0, 0, 0);
      endDay.setHours(0, 0, 0, 0);
      const days = Math.min(31, Math.max(0, Math.round((endDay.getTime() - startDay.getTime()) / 86400000)));
      for (let offset = 0; offset <= days; offset += 1) {
        const key = dateKey(new Date(startDay.getFullYear(), startDay.getMonth(), startDay.getDate() + offset));
        if (!byDay.has(key)) byDay.set(key, []);
        byDay.get(key).push(job);
      }
    });
    const weekdays = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
    const days = Array.from({ length: 42 }, (_, index) => {
      const day = new Date(start.getFullYear(), start.getMonth(), start.getDate() + index);
      const key = dateKey(day);
      const jobs = byDay.get(key) || [];
      const classes = [
        'partner-calendar-day',
        day.getMonth() !== calendarMonth.getMonth() ? 'is-outside' : '',
        key === today ? 'is-today' : '',
        key === selectedCalendarDate ? 'is-selected' : '',
      ].filter(Boolean).join(' ');
      return `<div class="${classes}" data-calendar-day="${key}">
        <button type="button" class="partner-calendar-date-button" data-calendar-select="${key}" aria-label="Selecionar ${escapeHtml(formatDate(day))}"><span class="partner-calendar-date">${day.getDate()}</span></button>
        ${jobs.slice(0, 2).map((job) => `<button type="button" class="partner-calendar-event" data-calendar-select="${key}" title="${escapeHtml(job.title)}">${escapeHtml(job.title || 'Job')}</button>`).join('')}
        ${jobs.length > 2 ? `<span class="partner-calendar-more">+${jobs.length - 2} jobs</span>` : ''}
      </div>`;
    }).join('');
    $('partnerCalendar').innerHTML = `<div class="partner-calendar-head"><strong>${escapeHtml(monthLabel)}</strong><div class="partner-calendar-controls"><button type="button" data-calendar-month="prev" aria-label="Mês anterior">‹</button><button type="button" data-calendar-month="today">Hoje</button><button type="button" data-calendar-month="next" aria-label="Próximo mês">›</button></div></div><div class="partner-calendar-grid">${weekdays.map((day) => `<div class="partner-calendar-weekday">${day}</div>`).join('')}${days}</div>`;
    const selectedJobs = (byDay.get(selectedCalendarDate) || []).slice().sort((a, b) => new Date(a.scheduledStart).getTime() - new Date(b.scheduledStart).getTime());
    $('partnerCalendarJobs').innerHTML = selectedJobs.length
      ? selectedJobs.map(jobCard).join('')
      : `<div class="partner-empty"><h3>Nenhum job para ${escapeHtml(formatDate(new Date(`${selectedCalendarDate}T12:00:00`)))}</h3><p>Os jobs agendados para o dia selecionado aparecerão aqui.</p></div>`;
  }

  function renderInvoices(invoices) {
    $('partnerInvoiceCount').textContent = `${invoices.length} ${invoices.length === 1 ? 'invoice' : 'invoices'}`;
    if (!invoices.length) {
      $('partnerInvoices').innerHTML = '<div class="partner-empty"><h3>Nenhuma invoice disponível</h3><p>Invoices emitidas pelo fornecedor selecionado aparecerão aqui.</p></div>';
      return;
    }
    $('partnerInvoices').innerHTML = invoices.map((invoice) => {
      const paid = invoice.status === 'paid' || Number(invoice.balance) <= 0;
      const overdue = !paid && invoice.due_date && new Date(invoice.due_date).getTime() < Date.now();
      const label = paid ? 'Pago' : overdue ? 'Atrasado' : invoice.status === 'partially_paid' ? 'Parcialmente pago' : invoice.status === 'sent' ? 'Em aberto' : statusLabels[invoice.status] || invoice.status;
      const job = invoice.job || invoice.quote || {};
      const reference = job.number ? `Job #${job.number}` : job.quoteNumber || job.number ? `Quote #${job.quoteNumber || job.number}` : job.title || 'Fatura';
      const amount = money(invoice.amount);
      return `<article class="partner-invoice-row"><div><h3>${escapeHtml(invoice.number ? `Invoice ${invoice.number}` : 'Invoice')}</h3><p>${escapeHtml(reference)}${job.title && job.number ? ` · ${escapeHtml(job.title)}` : ''}</p><p>Emitida em ${escapeHtml(formatDate(invoice.issued_at))}${invoice.due_date ? ` · Vence ${escapeHtml(formatDate(invoice.due_date))}` : ''}</p></div><div class="partner-invoice-amount"><strong>${amount}</strong>${Number(invoice.balance) > 0 && Number(invoice.paid_amount) > 0 ? `<small>Saldo ${money(invoice.balance)}</small>` : ''}</div><span class="partner-invoice-status ${paid ? 'is-paid' : 'is-open'}">${escapeHtml(label)}</span>${invoice.invoice_url ? `<a class="partner-invoice-open" href="${escapeHtml(invoice.invoice_url)}" target="_blank" rel="noopener">Abrir invoice</a>` : ''}</article>`;
    }).join('');
  }

  function formatFileSize(size) {
    if (size >= 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
    return `${Math.max(1, Math.round(size / 1024))} KB`;
  }

  function renderRequests(requests) {
    $('partnerRequestCount').textContent = `${requests.length} ${requests.length === 1 ? 'pedido' : 'pedidos'}`;
    if (!requests.length) {
      $('partnerRequests').innerHTML = '<div class="partner-empty"><h3>Você ainda não enviou pedidos</h3><p>Use o formulário acima para solicitar um serviço ao fornecedor selecionado.</p></div>';
      return;
    }
    $('partnerRequests').innerHTML = requests.map((item) => {
      const label = item.status === 'accepted' ? 'Aceito' : item.status === 'declined' ? 'Não aprovado' : 'Aguardando análise';
      const files = (item.files || []).map((file) => `<a href="${escapeHtml(file.file_url)}" target="_blank" rel="noopener">${escapeHtml(file.name)} · ${formatFileSize(file.size)}</a>`).join('');
      const jobLink = item.job_id ? '<p class="partner-inline-link">Job criado — consulte na aba Jobs.</p>' : '';
      return `<article class="partner-request-card"><div class="partner-item-top"><span class="partner-item-kind">Pedido · ${escapeHtml(formatDate(item.created_at))}</span><span class="partner-status">${label}</span></div><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.address)}</p>${item.service_type ? `<p>Serviço: ${escapeHtml(item.service_type)}</p>` : ''}${item.preferred_date ? `<p>Data desejada: ${escapeHtml(formatDate(item.preferred_date))}</p>` : ''}${item.notes ? `<p>${escapeHtml(item.notes)}</p>` : ''}${item.review_note ? `<p class="partner-request-review">Resposta da equipe: ${escapeHtml(item.review_note)}</p>` : ''}${jobLink}${files ? `<div class="partner-request-files">${files}</div>` : ''}</article>`;
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
    const views = {
      jobs: ['partnerProjectsSection', 'partnerJobsTab'],
      calendar: ['partnerCalendarSection', 'partnerCalendarTab'],
      history: ['partnerHistorySection', 'partnerHistoryTab'],
      invoices: ['partnerInvoicesSection', 'partnerInvoicesTab'],
      requests: ['partnerRequestsSection', 'partnerRequestsTab'],
      documents: ['partnerDocumentsSection', 'partnerDocumentsTab'],
    };
    Object.entries(views).forEach(([key, [sectionId, tabId]]) => {
      const selected = key === view;
      $(sectionId).hidden = !selected;
      $(tabId).setAttribute('aria-selected', selected ? 'true' : 'false');
      $(tabId).tabIndex = selected ? 0 : -1;
    });
    if (view === 'documents' && !documentsLoaded && !documentsLoading) loadDocuments();
    if (view === 'invoices' && !invoicesLoaded) loadInvoices();
    if (view === 'requests' && !requestsLoaded) loadRequests();
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

  async function loadInvoices() {
    $('partnerInvoices').innerHTML = '<div class="partner-empty"><p>Carregando invoices…</p></div>';
    try {
      const response = await request('/api/partner-portal/invoices');
      invoicesLoaded = true;
      renderInvoices(response.data || []);
    } catch (err) {
      if (err.status === 401) return location.replace('partner-login.html');
      mainError.textContent = err.message || 'Não foi possível carregar as invoices.';
      mainError.hidden = false;
      $('partnerInvoices').innerHTML = '';
    }
  }

  async function loadRequests() {
    $('partnerRequests').innerHTML = '<div class="partner-empty"><p>Carregando pedidos…</p></div>';
    try {
      const response = await request('/api/partner-portal/requests');
      requestsLoaded = true;
      renderRequests(response.data || []);
    } catch (err) {
      if (err.status === 401) return location.replace('partner-login.html');
      mainError.textContent = err.message || 'Não foi possível carregar os pedidos.';
      mainError.hidden = false;
      $('partnerRequests').innerHTML = '';
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
      partnerProviders = user.providers || [];
      $('partnerProviderTools').hidden = partnerProviders.length < 2;
      if (partnerProviders.length > 1) {
        $('partnerProviderSelect').innerHTML = partnerProviders.map((provider) => `<option value="${escapeHtml(provider.slug)}">${escapeHtml(provider.name || provider.company_name)}</option>`).join('');
        $('partnerProviderSelect').value = user.workspace || '';
      }
      $('changePasswordPanel').hidden = !user.must_change_password;
      $('partnerProjectsSection').hidden = Boolean(user.must_change_password);
      $('partnerPortalTabs').hidden = Boolean(user.must_change_password);
      document.body.classList.toggle('partner-nav-ready', !user.must_change_password);
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
  $('partnerCalendarTab')?.addEventListener('click', () => showPortalView('calendar'));
  $('partnerHistoryTab')?.addEventListener('click', () => showPortalView('history'));
  $('partnerInvoicesTab')?.addEventListener('click', () => showPortalView('invoices'));
  $('partnerRequestsTab')?.addEventListener('click', () => showPortalView('requests'));
  $('partnerDocumentsTab')?.addEventListener('click', () => showPortalView('documents'));
  $('partnerCalendar')?.addEventListener('click', (event) => {
    const monthButton = event.target.closest('[data-calendar-month]');
    if (monthButton) {
      const action = monthButton.getAttribute('data-calendar-month');
      if (action === 'prev') calendarMonth = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() - 1, 1);
      if (action === 'next') calendarMonth = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 1);
      if (action === 'today') {
        calendarMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
        selectedCalendarDate = dateKey(new Date());
      }
      renderCalendar();
      return;
    }
    const dayButton = event.target.closest('[data-calendar-select]');
    if (dayButton) {
      selectedCalendarDate = dayButton.getAttribute('data-calendar-select') || selectedCalendarDate;
      renderCalendar();
    }
  });
  $('partnerProviderSwitch')?.addEventListener('click', async () => {
    const button = $('partnerProviderSwitch');
    const workspace = $('partnerProviderSelect').value;
    if (!workspace) return;
    button.disabled = true;
    button.textContent = 'Trocando…';
    mainError.hidden = true;
    try {
      const result = await request('/api/partner-auth/switch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspace }),
      });
      location.replace(result.data?.redirect_url || 'partner-portal.html');
    } catch (err) {
      mainError.textContent = err.message || 'Não foi possível trocar de fornecedor.';
      mainError.hidden = false;
      button.disabled = false;
      button.textContent = 'Trocar';
    }
  });

  $('requestFiles')?.addEventListener('change', () => {
    const files = Array.from($('requestFiles').files || []);
    const bytes = files.reduce((sum, file) => sum + file.size, 0);
    $('requestFileSummary').textContent = files.length
      ? `${files.length} arquivo(s) · ${formatFileSize(bytes)}${files.length > 5 || bytes > 10 * 1024 * 1024 ? ' — acima do limite' : ''}`
      : '';
  });

  function readFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error(`Não foi possível ler ${file.name}.`));
      reader.readAsDataURL(file);
    });
  }

  $('partnerRequestForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const error = $('partnerRequestError');
    const button = $('partnerRequestSubmit');
    const files = Array.from($('requestFiles').files || []);
    const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
    error.hidden = true;
    error.classList.remove('partner-success');
    if (files.length > 5 || totalBytes > 10 * 1024 * 1024) {
      error.textContent = 'Anexe até 5 arquivos com 10 MB no total.';
      error.hidden = false;
      return;
    }
    button.disabled = true;
    button.textContent = 'Enviando…';
    try {
      const attachments = await Promise.all(files.map(async (file) => ({ name: file.name, data_url: await readFile(file) })));
      await request('/api/partner-portal/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: $('requestTitle').value,
          address: $('requestAddress').value,
          contact_name: $('requestContact').value,
          contact_email: $('requestEmail').value,
          contact_phone: $('requestPhone').value,
          service_type: $('requestService').value,
          preferred_date: $('requestPreferredDate').value,
          notes: $('requestNotes').value,
          files: attachments,
        }),
      });
      $('partnerRequestForm').reset();
      $('requestFileSummary').textContent = '';
      requestsLoaded = false;
      error.textContent = 'Pedido enviado. A equipe do fornecedor vai analisar as informações e os anexos.';
      error.classList.add('partner-success');
      error.hidden = false;
      await loadRequests();
    } catch (err) {
      error.textContent = err.message || 'Não foi possível enviar o pedido.';
      error.hidden = false;
    } finally {
      button.disabled = false;
      button.textContent = 'Enviar solicitação';
    }
  });
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
