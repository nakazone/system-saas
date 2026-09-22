/**
 * Previsão de pagamentos — builders / projetos / data
 */
const API = '/api/builder-payment-forecasts';
let canEdit = false;
let builders = [];

const fmt$ = (v) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 }).format(
    parseFloat(v) || 0
  );

function escapeHtml(s) {
  const d = document.createElement('div');
  d.textContent = s == null ? '' : String(s);
  return d.innerHTML;
}

function showFormErr(msg) {
  const el = document.getElementById('bpfFormErr');
  if (!el) return;
  if (msg) {
    el.textContent = msg;
    el.classList.remove('hidden');
  } else {
    el.textContent = '';
    el.classList.add('hidden');
  }
}

function apiUrl(path) {
  if (path.startsWith('?')) return `${API}${path}`;
  if (!path.startsWith('/')) return `${API}/${path}`;
  return `${API}${path}`;
}

async function api(method, path, body) {
  const opts = { method, credentials: 'include', headers: {} };
  if (body != null) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const r = await fetch(apiUrl(path), opts);
  const j = await r.json().catch(() => ({}));
  if (j.code === 'BPF_SCHEMA_MISSING') {
    document.getElementById('bpfSchemaBanner')?.classList.add('on');
  }
  if (!r.ok) {
    const err = new Error(j.error || r.statusText || 'Erro');
    err.status = r.status;
    throw err;
  }
  return j;
}

function fillBuilderSelects() {
  const sel = document.getElementById('bpfBuilder');
  const fil = document.getElementById('bpfFilterBuilder');
  const curB = sel?.value || '';
  const curF = fil?.value || '';
  if (sel) {
    sel.innerHTML =
      '<option value="">— Escolher —</option>' +
      builders.map((b) => `<option value="${b.id}">${escapeHtml(b.name)}</option>`).join('');
    if (curB && builders.some((x) => String(x.id) === curB)) sel.value = curB;
  }
  if (fil) {
    fil.innerHTML =
      '<option value="">Todos</option>' +
      builders.map((b) => `<option value="${b.id}">${escapeHtml(b.name)}</option>`).join('');
    if (curF && builders.some((x) => String(x.id) === curF)) fil.value = curF;
  }
}

async function loadBuilders() {
  const j = await api('GET', '/builders');
  builders = j.data || [];
  if (!builders.length) {
    builders = [];
  }
  fillBuilderSelects();
}

async function loadProjectsForBuilder(builderId) {
  const sel = document.getElementById('bpfProject');
  if (!sel) return;
  if (!builderId) {
    sel.innerHTML = '<option value="">— Primeiro o builder —</option>';
    sel.disabled = true;
    return;
  }
  sel.disabled = false;
  sel.innerHTML = '<option value="">A carregar…</option>';
  try {
    const j = await api('GET', `/projects?builder_id=${encodeURIComponent(builderId)}`);
    const rows = j.data || [];
    const cur = sel.dataset.keepValue;
    delete sel.dataset.keepValue;
    sel.innerHTML =
      '<option value="">— Projeto —</option>' +
      rows
        .map((p) => {
          const num = p.project_number ? `${escapeHtml(p.project_number)} · ` : '';
          return `<option value="${p.id}">${num}${escapeHtml(p.name || 'Projeto')}</option>`;
        })
        .join('');
    if (cur && rows.some((x) => String(x.id) === String(cur))) sel.value = String(cur);
  } catch (e) {
    sel.innerHTML = '<option value="">Erro ao carregar</option>';
  }
}

async function loadList() {
  const tb = document.getElementById('bpfTbody');
  const bid = document.getElementById('bpfFilterBuilder')?.value || '';
  const path = bid ? `?builder_id=${encodeURIComponent(bid)}` : '/';
  try {
    const j = await api('GET', path);
    if (j.meta?.tableMissing) {
      document.getElementById('bpfSchemaBanner')?.classList.add('on');
      tb.innerHTML =
        '<tr><td colspan="6" class="bpf-muted" style="border:0">Sem tabela no servidor.</td></tr>';
      return;
    }
    document.getElementById('bpfSchemaBanner')?.classList.remove('on');
    const rows = j.data || [];
    if (!rows.length) {
      tb.innerHTML = '<tr><td colspan="6" class="bpf-muted" style="border:0">Nenhum registo.</td></tr>';
      return;
    }
    tb.innerHTML = rows
      .map((r) => {
        const dt = r.expected_payment_date ? String(r.expected_payment_date).slice(0, 10) : '—';
        const amt =
          r.amount != null && r.amount !== ''
            ? fmt$(r.amount)
            : '—';
        const actions = canEdit
          ? `<button type="button" class="btn btn-sm btn-secondary bpf-edit" data-id="${r.id}">Editar</button>
             <button type="button" class="btn btn-sm btn-danger bpf-del" data-id="${r.id}" style="margin-left:4px">Eliminar</button>`
          : '—';
        return `<tr>
          <td>${escapeHtml(dt)}</td>
          <td>${escapeHtml(r.builder_name || '—')}</td>
          <td>${escapeHtml(r.project_number ? r.project_number + ' · ' : '')}${escapeHtml(r.project_name || '—')}</td>
          <td>${escapeHtml(amt)}</td>
          <td>${escapeHtml(r.notes || '—')}</td>
          <td>${actions}</td>
        </tr>`;
      })
      .join('');

    tb.querySelectorAll('.bpf-edit').forEach((btn) => {
      btn.addEventListener('click', () => startEdit(parseInt(btn.getAttribute('data-id'), 10)));
    });
    tb.querySelectorAll('.bpf-del').forEach((btn) => {
      btn.addEventListener('click', () => removeRow(parseInt(btn.getAttribute('data-id'), 10)));
    });
  } catch (e) {
    tb.innerHTML = `<tr><td colspan="6" class="text-red-600" style="border:0">${escapeHtml(e.message)}</td></tr>`;
  }
}

function resetForm() {
  document.getElementById('bpfEditId').value = '';
  document.getElementById('bpfDate').value = '';
  document.getElementById('bpfAmount').value = '';
  document.getElementById('bpfNotes').value = '';
  document.getElementById('bpfCancelEdit')?.classList.add('hidden');
  showFormErr('');
}

async function startEdit(id) {
  const j = await api('GET', '/');
  const row = (j.data || []).find((x) => x.id === id);
  if (!row) return;
  document.getElementById('bpfEditId').value = String(id);
  document.getElementById('bpfBuilder').value = String(row.builder_id);
  document.getElementById('bpfProject').dataset.keepValue = String(row.project_id);
  await loadProjectsForBuilder(row.builder_id);
  document.getElementById('bpfProject').value = String(row.project_id);
  document.getElementById('bpfDate').value = String(row.expected_payment_date || '').slice(0, 10);
  document.getElementById('bpfAmount').value =
    row.amount != null && row.amount !== '' ? String(row.amount) : '';
  document.getElementById('bpfNotes').value = row.notes || '';
  document.getElementById('bpfCancelEdit')?.classList.remove('hidden');
  showFormErr('');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function removeRow(id) {
  if (!canEdit || !id) return;
  if (!confirm('Eliminar esta previsão?')) return;
  try {
    await api('DELETE', `/${id}`);
    window.crmToast?.success?.('Eliminado');
    await loadList();
  } catch (e) {
    window.crmToast?.error?.(e.message);
  }
}

async function saveForm() {
  if (!canEdit) return;
  showFormErr('');
  const editId = document.getElementById('bpfEditId').value.trim();
  const builder_id = document.getElementById('bpfBuilder').value;
  const project_id = document.getElementById('bpfProject').value;
  const expected_payment_date = document.getElementById('bpfDate').value;
  const amountStr = document.getElementById('bpfAmount').value.trim();
  const notes = document.getElementById('bpfNotes').value.trim();

  if (!builder_id || !project_id || !expected_payment_date) {
    showFormErr('Preencha builder, projeto e data.');
    return;
  }

  const body = {
    builder_id: parseInt(builder_id, 10),
    project_id: parseInt(project_id, 10),
    expected_payment_date,
    notes: notes || null,
  };
  if (amountStr !== '') body.amount = parseFloat(amountStr.replace(',', '.')) || 0;

  try {
    if (editId) {
      await api('PUT', `/${editId}`, body);
      window.crmToast?.success?.('Atualizado');
    } else {
      await api('POST', '/', body);
      window.crmToast?.success?.('Guardado');
    }
    resetForm();
    document.getElementById('bpfProject').innerHTML = '<option value="">— Primeiro o builder —</option>';
    document.getElementById('bpfProject').disabled = !document.getElementById('bpfBuilder').value;
    await loadList();
  } catch (e) {
    showFormErr(e.message || 'Erro ao guardar');
    window.crmToast?.error?.(e.message);
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  const sess = await fetch('/api/auth/session', { credentials: 'include' }).then((r) => r.json());
  if (!sess.authenticated) {
    window.location.href = '/login.html';
    return;
  }
  const keys = Array.isArray(sess.user?.permissions) ? sess.user.permissions : [];
  const admin = String(sess.user?.role || '').toLowerCase() === 'admin';
  canEdit = admin || keys.includes('projects.edit');

  if (!canEdit) {
    const h2 = document.querySelector('#bpfFormCard h2');
    if (h2 && !document.getElementById('bpfReadOnlyNote')) {
      const note = document.createElement('p');
      note.id = 'bpfReadOnlyNote';
      note.className = 'bpf-muted';
      note.textContent = 'Apenas leitura. É necessária a permissão projects.edit para criar ou alterar previsões.';
      h2.after(note);
    }
    document.getElementById('bpfSave')?.classList.add('hidden');
    document.getElementById('bpfCancelEdit')?.classList.add('hidden');
    document.querySelectorAll('#bpfFormCard input, #bpfFormCard select').forEach((el) => {
      el.disabled = true;
    });
  }

  await loadBuilders();
  await loadList();

  document.getElementById('bpfBuilder')?.addEventListener('change', (e) => {
    loadProjectsForBuilder(e.target.value);
  });

  document.getElementById('bpfFilterBuilder')?.addEventListener('change', () => loadList());

  document.getElementById('bpfSave')?.addEventListener('click', saveForm);
  document.getElementById('bpfCancelEdit')?.addEventListener('click', () => {
    resetForm();
    const b = document.getElementById('bpfBuilder').value;
    loadProjectsForBuilder(b);
  });
  document.getElementById('btnReload')?.addEventListener('click', async () => {
    await loadBuilders();
    await loadList();
  });
});
