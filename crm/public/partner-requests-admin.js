(function () {
  const $ = (id) => document.getElementById(id);
  const list = $('requestsList');
  const error = $('requestsError');
  const modeSave = $('requestModeSave');
  const modeStatus = $('requestModeStatus');
  const modeInputs = Array.from(document.querySelectorAll('input[name="requestMode"]'));
  let savedRequestMode = 'review';
  let canEditRequestMode = false;
  let filter = 'pending';
  let rows = [];
  let focusDone = false;

  function toast(msg) {
    try { if (window.crmToast && window.crmToast.show) window.crmToast.show(msg, { type: 'success' }); } catch (_) { /* optional */ }
  }
  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  }
  function formatDate(value, withTime) {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return new Intl.DateTimeFormat('pt-BR', withTime ? { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' } : { dateStyle: 'medium', timeZone: 'UTC' }).format(date);
  }
  function money(n) {
    return n == null ? '—' : Number(n).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
  }
  function qty(n) { return Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 2 }); }
  function initials(name) {
    return String(name || 'B').replace(/^the\s+/i, '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || 'B';
  }
  function fileKind(f) {
    const n = String(f.name || '').toLowerCase(); const t = String(f.content_type || '');
    if (t === 'application/pdf' || n.endsWith('.pdf')) return 'PDF';
    if (t.startsWith('image/') || /\.(png|jpe?g|webp|heic)$/.test(n)) return 'IMG';
    return 'ARQ';
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
    if (status === 'accepted') return 'Aprovado';
    if (status === 'declined') return 'Não aprovado';
    return 'Para aprovar';
  }

  /* ───────── regra de entrada ───────── */
  function selectedRequestMode() {
    return modeInputs.find((input) => input.checked)?.value || 'review';
  }
  function paintRequestMode() {
    const mode = selectedRequestMode();
    document.querySelectorAll('.rq-choice').forEach((label) => {
      label.classList.toggle('is-selected', label.querySelector('input')?.checked === true);
      label.classList.toggle('is-disabled', !canEditRequestMode);
    });
    modeSave.disabled = !canEditRequestMode || mode === savedRequestMode;
    modeStatus.classList.remove('is-error');
    modeStatus.textContent = canEditRequestMode
      ? mode === savedRequestMode ? '' : 'Alteração ainda não salva.'
      : 'Só quem tem permissão de configurações pode mudar esta regra.';
    $('requestModeHelp').textContent = mode === 'automatic'
      ? 'Pedidos novos de todos os builders conectados viram Jobs na hora. A equipe recebe um aviso a cada Job criado.'
      : 'Pedidos novos de todos os builders conectados esperam aqui. A equipe recebe um aviso, escolhe a data e aprova.';
    $('rqRuleBtnText').textContent = savedRequestMode === 'automatic' ? 'Regra: Job automático' : 'Regra: aprovar antes';
    $('rqIntro').textContent = savedRequestMode === 'automatic'
      ? 'Os pedidos já viram Jobs automaticamente. Aqui fica o histórico do que os builders enviaram.'
      : 'Pedidos enviados pelos builders conectados. Confira os serviços, escolha a data e aprove.';
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
      if (savedRequestMode === 'automatic') setFilter('all', true);
      paintRequestMode();
    } catch (err) {
      modeStatus.textContent = err.message || 'Não foi possível carregar a regra de entrada.';
      modeStatus.classList.add('is-error');
    }
    await load();
  }
  async function saveRequestMode() {
    const mode = selectedRequestMode();
    if (!canEditRequestMode || mode === savedRequestMode) return;
    modeSave.disabled = true;
    modeSave.textContent = 'Salvando…';
    try {
      await request('/api/settings/partner-portal', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_mode: mode }) });
      savedRequestMode = mode;
      paintRequestMode();
      modeStatus.textContent = 'Regra salva. Vale para os próximos pedidos.';
      toast('Regra salva');
    } catch (err) {
      modeStatus.textContent = err.message || 'Não foi possível salvar a regra.';
      modeStatus.classList.add('is-error');
      modeSave.disabled = false;
    } finally {
      modeSave.textContent = 'Salvar regra';
    }
  }

  /* ───────── lista ───────── */
  function setFilter(status, silent) {
    filter = status;
    document.querySelectorAll('#rqChips .rq-chip').forEach((b) => b.classList.toggle('is-on', b.getAttribute('data-status') === status));
    if (!silent) paint();
  }
  async function load() {
    error.hidden = true;
    if (!rows.length) list.innerHTML = '<p class="rq-empty">Carregando pedidos…</p>';
    try {
      const result = await request('/api/partner-requests?status=all');
      rows = result.data || [];
      paint();
    } catch (err) {
      error.textContent = err.message || 'Não foi possível carregar os pedidos.';
      error.hidden = false;
      list.innerHTML = '';
    }
  }
  function paint() {
    const count = (st) => rows.filter((r) => r.status === st).length;
    const pending = count('pending');
    $('rqSumPending').textContent = String(pending);
    $('rqSumPending').classList.toggle('is-hot', pending > 0);
    $('rqSumAccepted').textContent = String(count('accepted'));
    $('rqSumDeclined').textContent = String(count('declined'));
    $('rqChipPending').textContent = pending ? String(pending) : '';
    // aberto por uma notificação: o pedido aparece mesmo que já tenha sido respondido
    const want = new URLSearchParams(location.search).get('id');
    if (want && !focusDone && filter !== 'all') {
      const target = rows.find((r) => r.id === want);
      if (target && target.status !== filter) setFilter(target.status, true);
    }
    const shown = filter === 'all' ? rows : rows.filter((r) => r.status === filter);
    if (!shown.length) {
      list.innerHTML = `<p class="rq-empty">${filter === 'pending' ? 'Nenhum pedido esperando aprovação. Quando um builder enviar, você recebe um aviso.' : 'Nenhum pedido nesta lista.'}</p>`;
      return;
    }
    list.innerHTML = shown.map(card).join('');
    if (want && !focusDone) {
      const el = list.querySelector(`[data-req-id="${CSS.escape(want)}"]`);
      if (el) { focusDone = true; el.classList.add('is-focus'); setTimeout(() => el.scrollIntoView({ block: 'start', behavior: 'smooth' }), 60); }
    }
  }

  function card(item) {
    const sid = escapeHtml(item.id);
    const pending = item.status === 'pending';
    const pillCls = item.status === 'accepted' ? 'is-accepted' : item.status === 'declined' ? 'is-declined' : '';
    const tags = [
      item.read_by_ai ? '<span class="rq-tag rq-tag--ai">Lido pela IA</span>' : '',
      item.target_job ? `<span class="rq-tag rq-tag--upd">Atualiza o Job #${escapeHtml(item.target_job.number || '')}</span>` : '',
    ].join('');
    const fact = (label, value, wide) => value ? `<div${wide ? ' class="is-wide"' : ''}><dt>${label}</dt><dd>${value}</dd></div>` : '';
    const contact = [item.contact_name, item.contact_phone, item.contact_email].filter(Boolean).map(escapeHtml).join(' · ');
    const facts = `<dl class="rq-facts">
      ${fact('Endereço', escapeHtml(item.address), true)}
      ${fact('Nº do builder', escapeHtml(item.external_ref || ''))}
      ${fact('Data pedida', item.preferred_date ? escapeHtml(formatDate(item.preferred_date)) : 'A combinar')}
      ${fact('Contato no local', contact)}
      ${fact('Serviço', escapeHtml(item.service_type || ''))}
      ${fact('Retirada do material', escapeHtml(item.pickup || ''), true)}
    </dl>`;
    const services = (item.services || []).length ? (() => {
      const sum = item.services.reduce((a, s) => a + (s.total || 0), 0);
      return `<p class="rq-lbl">Serviços · ${item.services.length}</p>
        <div class="rq-svc" role="table" aria-label="Serviços">
          <div class="rq-svc__h" role="row"><span role="columnheader">Serviço</span><span role="columnheader">Qtd</span><span role="columnheader">Preço</span><span role="columnheader">Total</span></div>
          ${item.services.map((s) => `<div class="rq-svc__r" role="row"><div role="cell"><strong>${escapeHtml(s.name || 'Serviço')}</strong>${s.detail ? `<small>${escapeHtml(s.detail)}</small>` : ''}</div><span role="cell">${qty(s.quantity)} ${escapeHtml(String(s.uom || '').toLowerCase())}</span><span role="cell"${s.rate == null ? ' class="is-none"' : ''}>${s.rate == null ? '—' : money(s.rate)}</span><span role="cell"${s.total == null ? ' class="is-none"' : ''}>${s.total == null ? '—' : money(s.total)}</span></div>`).join('')}
          <div class="rq-svc__f" role="row"><span role="cell">Total</span><span role="cell">${money(sum)}</span></div>
          ${item.labor_total != null && Math.abs(item.labor_total - sum) > 0.5 ? `<div class="rq-svc__f rq-svc__f--sub" role="row"><span role="cell">Total impresso na ordem</span><span role="cell">${money(item.labor_total)}</span></div>` : ''}
        </div>`;
    })() : '';
    const notes = item.notes ? `<p class="rq-lbl">Informações</p><p class="rq-notes">${escapeHtml(item.notes)}</p>` : '';
    const meas = item.measurement && item.measurement.lines.length
      ? `<p class="rq-lbl">Medição do builder</p><ul class="rq-meas">${item.measurement.lines.map((l) => `<li><span>${escapeHtml(l.text)}</span><em>${qty(l.qty)} ${escapeHtml(l.uom)}</em></li>`).join('')}</ul>` : '';
    const files = (item.files || []).length
      ? `<p class="rq-lbl">Arquivos</p><div class="rq-files">${item.files.map((f) => `<a class="rq-file" href="${escapeHtml(f.file_url)}" target="_blank" rel="noopener"><i>${fileKind(f)}</i><span>${escapeHtml(f.name)}</span></a>`).join('')}</div>` : '';
    const pref = item.preferred_date ? String(item.preferred_date).slice(0, 10) : '';
    const act = pending ? `<div class="rq-act">
        <div>
          <p class="rq-lbl">Agendar o serviço</p>
          <div class="rq-sched">
            <label class="rq-field">Data do serviço<input type="date" id="sd-${sid}" value="${escapeHtml(pref)}" required /></label>
          </div>
        </div>
        <label class="rq-field">Mensagem para o builder (opcional)<textarea id="review-${sid}" data-crm-rich="off" maxlength="2000" placeholder="Confirmação, pedido de informação ou motivo da recusa…"></textarea></label>
        <p class="rq-hint">${pref ? `O builder pediu ${escapeHtml(formatDate(item.preferred_date))}. ` : ''}Ele recebe o aviso com a data no app.</p>
        <div class="rq-btns"><button type="button" class="rq-btn rq-btn--quiet" data-action="decline" data-id="${sid}">Não aprovar</button><button type="button" class="rq-btn rq-btn--pri" data-action="accept" data-id="${sid}">${item.target_job ? 'Aprovar e atualizar o Job' : 'Aprovar e agendar'}</button></div>
      </div>` : (item.review_note || item.work_order) ? `<div class="rq-review">${item.work_order ? `Job <a href="job-detail.html?id=${encodeURIComponent(item.work_order.id)}">#${escapeHtml(item.work_order.number || '')} ${escapeHtml(item.work_order.title)}</a>` : ''}${item.review_note ? `${item.work_order ? ' · ' : ''}Resposta: ${escapeHtml(item.review_note)}` : ''}</div>` : '';
    const right = `${meas}${notes}${files}` || '<p class="rq-muted" style="margin:0;font-size:13px">Sem arquivos nem medição.</p>';
    return `<article class="rq-card" data-req-id="${sid}">
      <div class="rq-card__head">
        <span class="rq-av" aria-hidden="true">${escapeHtml(initials(item.partner_company))}</span>
        <div class="rq-card__t">
          <h2>${escapeHtml(item.title)}</h2>
          <p class="rq-card__meta"><b>${escapeHtml(item.partner_company)}</b><span>${escapeHtml(item.partner_name)}</span><span>Enviado ${escapeHtml(formatDate(item.created_at, true))}</span>${tags}</p>
        </div>
        <span class="rq-pill ${pillCls}">${statusLabel(item.status)}</span>
      </div>
      <div class="rq-card__body">
        <div class="rq-col">${facts}${services}</div>
        <div class="rq-col">${right}</div>
      </div>
      ${act}
    </article>`;
  }

  list.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    const id = button.getAttribute('data-id');
    const action = button.getAttribute('data-action');
    const note = $(`review-${id}`)?.value.trim() || '';
    if (action === 'decline' && !note && !window.confirm('Não aprovar este pedido sem uma mensagem para o builder?')) return;
    let schedule = null;
    if (action === 'accept') {
      const date = $(`sd-${id}`) ? $(`sd-${id}`).value : '';
      if (!date) {
        error.textContent = 'Escolha a data do serviço para aprovar.';
        error.hidden = false;
        if ($(`sd-${id}`)) $(`sd-${id}`).focus();
        return;
      }
      schedule = { date, start: '', end: '', all_day: true };
    }
    error.hidden = true;
    const label = button.textContent;
    button.disabled = true;
    button.textContent = action === 'accept' ? 'Aprovando…' : 'Enviando…';
    try {
      await request(`/api/partner-requests/${encodeURIComponent(id)}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ review_note: note, ...(schedule ? { schedule } : {}) }),
      });
      toast(action === 'accept' ? 'Pedido aprovado — o Job está no calendário' : 'Pedido não aprovado — o builder foi avisado');
      await load();
    } catch (err) {
      error.textContent = err.message || 'Não foi possível atualizar o pedido.';
      error.hidden = false;
      button.disabled = false;
      button.textContent = label;
    }
  });

  $('rqChips').addEventListener('click', (e) => { const b = e.target.closest('[data-status]'); if (b) setFilter(b.getAttribute('data-status')); });
  $('requestsRefresh').addEventListener('click', load);
  $('rqRuleBtn').addEventListener('click', () => {
    const box = $('rqRule'); box.hidden = !box.hidden;
    $('rqRuleBtn').setAttribute('aria-expanded', String(!box.hidden));
  });
  modeInputs.forEach((input) => input.addEventListener('change', paintRequestMode));
  modeSave.addEventListener('click', saveRequestMode);
  void loadRequestMode();
})();
