/**
 * Builder portal ù profile, password, documents, manager, notification prefs.
 */
(function () {
  let me = null;
  let replaceDocId = null;

  const DOC_TYPE_LABELS = {
    w9: 'W-9',
    insurance: 'Certificate of Insurance',
    license: 'Business License',
    contract: 'Contract',
    other: 'Other',
  };

  const REQUIRED_DOC_TYPES = [
    { type: 'w9', label: 'W-9' },
    { type: 'insurance', label: 'Certificate of Insurance' },
    { type: 'license', label: 'Business License' },
  ];

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function fmtDate(iso) {
    if (!iso) return '\u2014';
    try {
      return new Date(iso).toLocaleDateString('en-US', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      });
    } catch {
      return String(iso).slice(0, 10);
    }
  }

  function validatePassword(pw) {
    if (!pw || pw.length < 8) return 'Password must be at least 8 characters';
    if (!/[a-zA-Z]/.test(pw)) return 'Password must include at least one letter';
    if (!/[0-9]/.test(pw)) return 'Password must include at least one number';
    return null;
  }

  function docStatusLabel(status) {
    const map = {
      valid: 'Valid',
      pending_review: 'Pending review',
      expired: 'Expired',
      rejected: 'Rejected',
    };
    return map[status] || status || 'Unknown';
  }

  function statusBadgeClass(status) {
    if (status === 'valid') return 'active';
    if (status === 'expired' || status === 'rejected') return 'inactive';
    return 'pending';
  }

  function scrollToHash() {
    const hash = (location.hash || '').replace(/^#/, '');
    if (!hash) return;
    const el = document.getElementById(hash);
    if (el) {
      setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'start' }), 200);
    }
  }

  function renderRequiredDocs(docs) {
    const host = document.getElementById('docRequiredList');
    if (!host) return;
    const byType = {};
    (docs || []).forEach((d) => {
      const t = String(d.type || 'other').toLowerCase();
      if (!byType[t] || d.status === 'valid') byType[t] = d;
    });
    host.innerHTML = `<ul class="bp-doc-required__list">${REQUIRED_DOC_TYPES.map((req) => {
      const doc = byType[req.type];
      const ok = doc && doc.status === 'valid';
      const pending = doc && doc.status === 'pending_review';
      const icon = ok ? '\u2713' : pending ? '\u2026' : '\u2014';
      const cls = ok ? 'bp-doc-required--ok' : pending ? 'bp-doc-required--pending' : 'bp-doc-required--missing';
      return `<li class="${cls}"><span class="bp-doc-required__icon">${icon}</span> ${escapeHtml(req.label)}${
        doc ? ` <span class="bp-muted">(${escapeHtml(docStatusLabel(doc.status))})</span>` : ''
      }</li>`;
    }).join('')}</ul>`;
  }

  function renderDocs(docs) {
    const list = docs || [];
    renderRequiredDocs(list);
    const host = document.getElementById('docList');
    if (!host) return;

    if (!list.length) {
      host.innerHTML =
        '<p class="bp-muted">No documents on file yet. Upload your W-9, insurance certificate, and business license below.</p>';
      return;
    }

    host.innerHTML = `<div class="bp-table-wrap"><table class="bp-table bp-doc-table"><thead><tr>
      <th>Document</th><th>Type</th><th>Uploaded</th><th>Expires</th><th>Status</th><th></th>
    </tr></thead><tbody>${list
      .map((d) => {
        const dl = d.download_url || d.url;
        const typeLabel = DOC_TYPE_LABELS[d.type] || d.type || 'Other';
        const actions = [];
        if (d.url) {
          actions.push(
            `<a href="${escapeHtml(dl)}" target="_blank" rel="noopener" class="bp-link-btn">Download</a>`
          );
        }
        if (d.can_delete) {
          actions.push(
            `<button type="button" class="bp-link-btn bp-doc-replace" data-id="${d.id}" data-type="${escapeHtml(d.type || 'other')}" data-name="${escapeHtml(d.name)}">Replace</button>`
          );
          actions.push(`<button type="button" class="bp-link-btn bp-doc-del" data-id="${d.id}">Remove</button>`);
        }
        return `<tr>
          <td>${d.url ? `<a href="${escapeHtml(dl)}" target="_blank" rel="noopener">${escapeHtml(d.name)}</a>` : escapeHtml(d.name)}</td>
          <td>${escapeHtml(typeLabel)}</td>
          <td>${escapeHtml(fmtDate(d.created_at))}</td>
          <td>${escapeHtml(fmtDate(d.expires_at))}</td>
          <td><span class="bp-badge bp-badge--${statusBadgeClass(d.status)}">${escapeHtml(docStatusLabel(d.status))}</span></td>
          <td class="bp-doc-actions">${actions.join(' ')}</td>
        </tr>`;
      })
      .join('')}</tbody></table></div>`;

    host.querySelectorAll('.bp-doc-del').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm('Remove this document?')) return;
        const r = await window.builderAuth.fetch(`/api/builder-documents/${btn.dataset.id}`, {
          method: 'DELETE',
        });
        const j = await r.json();
        if (!r.ok) alert(j.error || 'Could not delete');
        else loadDocs();
      });
    });

    host.querySelectorAll('.bp-doc-replace').forEach((btn) => {
      btn.addEventListener('click', () => startReplace(btn.dataset));
    });
  }

  function startReplace(data) {
    replaceDocId = data.id ? parseInt(data.id, 10) : null;
    document.getElementById('replaceDocId').value = replaceDocId ? String(replaceDocId) : '';
    const typeSel = document.getElementById('docType');
    if (typeSel && data.type) typeSel.value = data.type;
    const nameInp = document.getElementById('docName');
    if (nameInp && data.name) nameInp.value = data.name;
    document.getElementById('btnCancelReplace')?.classList.remove('hidden');
    document.getElementById('btnDocUpload').textContent = 'Upload replacement';
    document.getElementById('docUploadStatus').textContent = 'Upload a new file to replace this document.';
    document.getElementById('docUploadForm')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function cancelReplace() {
    replaceDocId = null;
    document.getElementById('replaceDocId').value = '';
    document.getElementById('btnCancelReplace')?.classList.add('hidden');
    document.getElementById('btnDocUpload').textContent = 'Upload for review';
    document.getElementById('docUploadStatus').textContent = '';
    document.getElementById('docUploadForm')?.reset();
  }

  async function loadDocs() {
    const r = await window.builderAuth.fetch('/api/builder-documents');
    const j = await r.json();
    if (j.success) renderDocs(j.data);
  }

  function renderManager(mgr) {
    const block = document.getElementById('managerBlock');
    if (!block) return;
    if (!mgr) {
      block.innerHTML =
        '<h2 class="bp-profile-section__title">Your Senior Floors manager</h2><p class="bp-muted">Your account manager will be assigned by Senior Floors.</p>';
      return;
    }
    const phone = mgr.phone ? String(mgr.phone).trim() : '';
    const tel = phone.replace(/\D/g, '');
    const badge =
      window.builderPortalCommon?.sfContactBadgeHtml?.('Senior Floors manager') ||
      '';
    block.innerHTML = `
      <h2 class="bp-profile-section__title">Your Senior Floors manager</h2>
      <div class="bp-profile-manager__row">
        ${badge ? `<div class="bp-profile-manager__badge">${badge}</div>` : ''}
        <div>
          <p class="bp-profile-manager__name">${escapeHtml(mgr.name || '')}</p>
          ${mgr.email ? `<p class="bp-muted"><a href="mailto:${escapeHtml(mgr.email)}">${escapeHtml(mgr.email)}</a></p>` : ''}
          ${phone ? `<p class="bp-muted">Tel: <a href="tel:${escapeHtml(tel)}">${escapeHtml(phone)}</a></p>` : ''}
          <a href="builder-messages.html?general=1" class="bp-btn-tan" style="display:inline-block;margin-top:12px;text-decoration:none;font-size:13px">Send message</a>
        </div>
      </div>`;
  }

  async function load() {
    const r = await window.builderAuth.fetch('/api/builder-auth/me');
    const j = await r.json();
    if (!j.success) return;
    me = j.data;

    document.getElementById('first_name').value = me.first_name || '';
    document.getElementById('last_name').value = me.last_name || '';
    document.getElementById('phone').value = me.phone || '';
    document.getElementById('company').value = me.company || '';
    document.getElementById('website').value = me.website || '';
    const logoEl = document.getElementById('company_logo_url');
    if (logoEl) logoEl.value = me.company_logo_url || '';
    document.getElementById('email').value = me.email || '';

    const prefs = me.notification_prefs || {};
    document.getElementById('pref_project').checked = prefs.project_status !== false;
    document.getElementById('pref_message').checked = prefs.messages !== false;
    document.getElementById('pref_checklist').checked = prefs.checklist !== false;
    document.getElementById('pref_documents').checked = prefs.documents !== false;

    const mustChange = !!me.portal_password_must_change;
    const currentWrap = document.getElementById('currentPasswordWrap');
    if (mustChange && currentWrap) {
      currentWrap.classList.add('hidden');
      document.getElementById('passwordStatus').textContent =
        'You must set a new password before using the portal.';
    }

    renderManager(me.account_manager);
    renderDocs(me.documents);
    scrollToHash();
  }

  document.getElementById('profileForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const r = await window.builderAuth.fetch('/api/builder-auth/profile', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        first_name: document.getElementById('first_name').value.trim(),
        last_name: document.getElementById('last_name').value.trim(),
        phone: document.getElementById('phone').value.trim(),
        company: document.getElementById('company').value.trim(),
        website: document.getElementById('website').value.trim(),
        company_logo_url: document.getElementById('company_logo_url')?.value?.trim() || null,
      }),
    });
    const j = await r.json();
    alert(j.success ? 'Profile saved' : j.error || 'Error');
    if (j.success) load();
  });

  document.getElementById('passwordForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const status = document.getElementById('passwordStatus');
    const np = document.getElementById('new_password').value;
    const cp = document.getElementById('confirm_password').value;
    const mustChange = !!me?.portal_password_must_change;
    const err = validatePassword(np);
    if (err) {
      status.textContent = err;
      return;
    }
    if (np !== cp) {
      status.textContent = 'New passwords do not match';
      return;
    }
    status.textContent = 'Updating...';
    const body = mustChange
      ? { new_password: np }
      : {
          current_password: document.getElementById('current_password').value,
          new_password: np,
        };
    const r = await window.builderAuth.fetch('/api/builder-auth/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const j = await r.json();
    if (!r.ok) {
      status.textContent = j.error || 'Could not update password';
      return;
    }
    status.textContent = j.message || 'Password updated';
    e.target.reset();
    if (mustChange) load();
  });

  document.getElementById('btnSavePrefs')?.addEventListener('click', async () => {
    const r = await window.builderAuth.fetch('/api/builder-auth/profile', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        notification_prefs: {
          project_status: document.getElementById('pref_project').checked,
          messages: document.getElementById('pref_message').checked,
          checklist: document.getElementById('pref_checklist').checked,
          documents: document.getElementById('pref_documents').checked,
        },
      }),
    });
    const j = await r.json();
    alert(j.success ? 'Preferences saved' : j.error || 'Error');
  });

  document.getElementById('btnCancelReplace')?.addEventListener('click', cancelReplace);

  document.getElementById('docUploadForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const file = document.getElementById('docFile')?.files?.[0];
    const statusEl = document.getElementById('docUploadStatus');
    if (!file) {
      statusEl.textContent = 'Select a file.';
      return;
    }
    statusEl.textContent = 'Uploading...';
    const fd = new FormData();
    fd.append('file', file);
    fd.append('name', document.getElementById('docName')?.value || file.name);
    fd.append('type', document.getElementById('docType')?.value || 'other');
    const exp = document.getElementById('docExpires')?.value;
    if (exp) fd.append('expires_at', exp);
    const r = await window.builderAuth.fetch('/api/builder-documents', { method: 'POST', body: fd });
    const j = await r.json();
    if (!r.ok) {
      statusEl.textContent = j.error || 'Upload failed';
      return;
    }
    if (replaceDocId) {
      await window.builderAuth.fetch(`/api/builder-documents/${replaceDocId}`, { method: 'DELETE' });
      cancelReplace();
    }
    statusEl.textContent = 'Uploaded ù pending Senior Floors review.';
    e.target.reset();
    document.getElementById('docType').value = 'w9';
    loadDocs();
  });

  document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('btnCancelReplace')?.classList.add('hidden');
    const boot = window.builderPortalCommon?.whenPortalReady;
    if (typeof boot === 'function') {
      boot().then((ok) => {
        if (ok) load().catch(console.error);
      });
    } else if (window.builderAuth?.getToken()) {
      load().catch(console.error);
    }
  });
})();
