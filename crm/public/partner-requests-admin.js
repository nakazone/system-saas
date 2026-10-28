(function () {
  const $ = (id) => document.getElementById(id);
  const list = $('requestsList');
  const error = $('requestsError');
  const modeSave = $('requestModeSave');
  const modeStatus = $('requestModeStatus');
  const modeInputs = Array.from(document.querySelectorAll('input[name="requestMode"]'));
  let savedRequestMode = 'review';
  let canEditRequestMode = false;

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  }

  function formatDate(value) {
    if (!value) return '—';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium' }).format(date);
  }

  async function request(url, options) {
    const response = await fetch(url, { credentials: 'include', ...options });
    const body = await response.json().catch(() => ({}));
    if (response.status === 401) {
      location.replace('login.html');
      throw new Error('Faça login novamente para continuar.');
    }
    if (response.status === 403) throw new Error(body.error === 'Permission denied'
      ? 'Seu usuário precisa da permissão de configurações para alterar esta regra.'
      : body.error || 'Seu usuário precisa da permissão de gerenciamento de jobs para revisar pedidos.');
    if (!response.ok) throw new Error(body.error || 'Não foi possível concluir a operação.');
    return body;
  }

  function statusLabel(status) {
    if (status === 'accepted') return 'Aceito';
    if (status === 'declined') return 'Não aprovado';
    return 'Pendente';
  }

  function selectedRequestMode() {
    return modeInputs.find((input) => input.checked)?.value || 'review';
  }

  function paintRequestMode() {
    const mode = selectedRequestMode();
    document.querySelectorAll('.requests-policy-choice').forEach((label) => {
      label.classList.toggle('is-selected', label.querySelector('input')?.checked === true);
      label.classList.toggle('is-disabled', !canEditRequestMode);
    });
    modeSave.disabled = !canEditRequestMode || mode === savedRequestMode;
    modeStatus.textContent = canEditRequestMode
      ? mode === savedRequestMode ? '' : 'Há uma alteração pendente para salvar.'
      : 'Somente quem tem permissão de configurações pode alterar esta regra.';
    $('requestModeHelp').textContent = mode === 'automatic'
      ? 'Novos pedidos de todos os Builders e Contractors conectados a esta empresa viram Jobs. Atualizações são anexadas ao Job indicado; a data solicitada entra no calendário quando um Job novo é criado. Pedidos que já estão na fila continuam pendentes.'
      : 'Novos pedidos de todos os Builders e Contractors conectados a esta empresa aguardam aprovação. Ao aceitar, um pedido novo cria um Job e registra a data solicitada no calendário; atualizações são anexadas ao Job indicado. Pedidos já aceitos ou recusados não mudam.';
    $('requestStatusFilter').value = mode === 'automatic' ? 'all' : 'pending';
    document.querySelector('.requests-intro').textContent = mode === 'automatic'
      ? 'Esta tela mantém o histórico dos pedidos enviados pelo portal. A equipe recebe uma notificação quando um pedido novo vira Job.'
      : 'Esta tela reúne pedidos aguardando revisão. Ao aceitar, um pedido novo cria um Job; a equipe pode completar os detalhes e conferir a data solicitada no calendário.';
  }

  async function loadRequestMode() {
    try {
      const result = await request('/api/settings/partner-portal');
      const settings = result.data || {};
      savedRequestMode = settings.request_mode === 'automatic' ? 'automatic' : 'review';
      canEditRequestMode = Boolean(settings.can_edit);
      modeInputs.forEach((input) => {
        input.checked = input.value === savedRequestMode;
        input.disabled = !canEditRequestMode;
      });
      paintRequestMode();
      await load();
    } catch (err) {
      modeStatus.textContent = err.message || 'Não foi possível carregar a regra de entrada.';
      modeStatus.classList.add('is-error');
      await load();
    }
  }

  async function saveRequestMode() {
    const mode = selectedRequestMode();
    if (!canEditRequestMode || mode === savedRequestMode) return;
    modeSave.disabled = true;
    modeSave.textContent = 'Salvando…';
    modeStatus.classList.remove('is-error');
    modeStatus.textContent = '';
    try {
      await request('/api/settings/partner-portal', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ request_mode: mode }),
      });
      savedRequestMode = mode;
      paintRequestMode();
      modeStatus.textContent = 'Regra salva. Ela vale para os próximos pedidos.';
      await load();
    } catch (err) {
      modeStatus.textContent = err.message || 'Não foi possível salvar a regra.';
      modeStatus.classList.add('is-error');
      modeSave.disabled = false;
    } finally {
      modeSave.textContent = 'Salvar regra';
    }
  }

  async function load() {
    error.hidden = true;
    list.innerHTML = '<div class="requests-empty">Carregando pedidos…</div>';
    try {
      const status = $('requestStatusFilter').value;
      const result = await request(`/api/partner-requests?status=${encodeURIComponent(status)}`);
      render(result.data || []);
    } catch (err) {
      error.textContent = err.message || 'Não foi possível carregar os pedidos.';
      error.hidden = false;
      list.innerHTML = '';
    }
  }

  function render(rows) {
    if (!rows.length) {
      list.innerHTML = '<div class="requests-empty">Nenhum pedido nesta lista.</div>';
      return;
    }
    list.innerHTML = rows.map((item) => {
      const statusClass = item.status === 'accepted' ? 'is-accepted' : item.status === 'declined' ? 'is-declined' : '';
      const files = (item.files || []).map((file) => `<a href="${escapeHtml(file.file_url)}" target="_blank" rel="noopener">${escapeHtml(file.name)}</a>`).join('');
      const details = [
        item.target_job ? `<p><strong>Atualização do job:</strong> #${escapeHtml(item.target_job.number || '')} ${escapeHtml(item.target_job.title)}</p>` : '',
        `<p><strong>Builder:</strong> ${escapeHtml(item.partner_company)} · ${escapeHtml(item.partner_name)} (${escapeHtml(item.partner_email)})</p>`,
        item.external_ref ? `<p><strong>Nº do builder:</strong> ${escapeHtml(item.external_ref)}</p>` : '',
        `<p><strong>Endereço:</strong> ${escapeHtml(item.address)}</p>`,
        `<p><strong>Contato no local:</strong> ${escapeHtml(item.contact_name || '—')}${item.contact_phone ? ` · ${escapeHtml(item.contact_phone)}` : ''}${item.contact_email ? ` · ${escapeHtml(item.contact_email)}` : ''}</p>`,
        `<p><strong>Serviço:</strong> ${escapeHtml(item.service_type || '—')}</p>`,
        `<p><strong>Data desejada:</strong> ${escapeHtml(formatDate(item.preferred_date))}</p>`,
        `<p><strong>Enviado:</strong> ${escapeHtml(formatDate(item.created_at))}</p>`,
        item.notes ? `<p><strong>Informações:</strong> ${escapeHtml(item.notes)}</p>` : '',
        item.review_note ? `<p><strong>Resposta enviada:</strong> ${escapeHtml(item.review_note)}</p>` : '',
        item.work_order ? `<p><strong>Job criado:</strong> #${escapeHtml(item.work_order.number || '')} ${escapeHtml(item.work_order.title)}</p>` : '',
      ].join('');
      const review = item.status === 'pending' ? `<div class="requests-review"><label for="review-${escapeHtml(item.id)}">Mensagem para o Builder (opcional)</label><textarea id="review-${escapeHtml(item.id)}" maxlength="2000" placeholder="Confirmação, pedido de informação ou motivo da recusa…"></textarea><div class="requests-actions"><button type="button" data-action="accept" data-id="${escapeHtml(item.id)}">${item.target_job ? 'Aceitar e atualizar o Job' : 'Aceitar e criar Job'}</button><button type="button" data-action="decline" data-id="${escapeHtml(item.id)}">Não aprovar</button></div></div>` : '';
      return `<article class="requests-card"><div class="requests-card-head"><div><h2>${escapeHtml(item.title)}</h2><p class="requests-meta">${escapeHtml(item.partner_company)} · ${escapeHtml(formatDate(item.created_at))}${item.read_by_ai ? ' · lido pela IA a partir do arquivo' : ''}${item.target_job ? ' · atualização' : ''}</p></div><span class="requests-status ${statusClass}">${statusLabel(item.status)}</span></div><div class="requests-info">${details}</div>${files ? `<div class="requests-files">${files}</div>` : ''}${review}</article>`;
    }).join('');
  }

  list.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    const id = button.getAttribute('data-id');
    const action = button.getAttribute('data-action');
    const note = $(`review-${id}`)?.value.trim() || '';
    if (action === 'decline' && !note && !window.confirm('Não aprovar este pedido sem adicionar uma mensagem?')) return;
    button.disabled = true;
    try {
      await request(`/api/partner-requests/${encodeURIComponent(id)}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ review_note: note }),
      });
      await load();
    } catch (err) {
      error.textContent = err.message || 'Não foi possível atualizar o pedido.';
      error.hidden = false;
      button.disabled = false;
    }
  });

  $('requestStatusFilter').addEventListener('change', load);
  $('requestsRefresh').addEventListener('click', load);
  modeInputs.forEach((input) => input.addEventListener('change', () => {
    paintRequestMode();
    void load();
  }));
  modeSave.addEventListener('click', saveRequestMode);
  void loadRequestMode();
})();
