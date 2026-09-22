(function () {
  const MAX_FILES = 5;
  const MAX_BYTES = 20 * 1024 * 1024;
  const PROJECT_TYPE_LABELS = {
    my_client: 'New client of mine',
    my_project: 'My own project',
    sf_referral: 'Direct referral to Senior Floors',
  };
  const URGENCY_LABELS = {
    flexible: 'Flexible',
    moderate: 'Moderate',
    urgent: 'Urgent',
  };

  let selectedFiles = [];

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function formatBytes(n) {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  }

  function bootAddressAutocomplete() {
    const input = document.getElementById('estAddress');
    const hint = document.getElementById('estAddressHint');
    if (!input || typeof window.sfAttachAddressAutocomplete !== 'function') return;
    window.sfEnsureCrmAddressAutocomplete?.().then((ok) => {
      if (!ok) return;
      window.sfAttachAddressAutocomplete(input, { country: 'us', map: { combined: '#estAddress' } }).then((attached) => {
        if (attached && hint) hint.classList.remove('hidden');
      });
    });
  }

  function applyUrlPrefill() {
    const params = new URLSearchParams(location.search);
    const projectType = params.get('project_type') || params.get('referral');
    if (projectType) {
      const sel = document.getElementById('estProjectType');
      const normalized =
        projectType === '1' || projectType === 'referral' || projectType === 'true'
          ? 'sf_referral'
          : projectType;
      if (sel && sel.querySelector(`option[value="${normalized}"]`)) {
        sel.value = normalized;
      }
    }
    const sqft = params.get('sqft');
    const floor = params.get('floor');
    if (sqft) {
      const inp = document.getElementById('estArea');
      if (inp) inp.value = sqft;
    }
    if (floor) {
      const f = floor.toLowerCase();
      const map = {
        hardwood: ['hardwood', 'sanding'],
        engineered: ['engineered', 'hardwood'],
        lvp: ['lvp'],
        tile: ['tile'],
        custom: ['custom'],
        stairs: ['custom', 'hardwood'],
      };
      const keys = map[f] || [f];
      document.querySelectorAll('input[name=svc]').forEach((cb) => {
        const v = (cb.value || '').toLowerCase();
        if (keys.some((k) => v.includes(k))) cb.checked = true;
      });
    }
  }

  function renderFilePreview() {
    const host = document.getElementById('estFilePreview');
    if (!host) return;
    host.innerHTML = '';
    selectedFiles.forEach((item, idx) => {
      const card = document.createElement('div');
      card.className = 'bp-est-file-card';
      if (item.previewUrl) {
        const img = document.createElement('img');
        img.src = item.previewUrl;
        img.alt = item.file.name;
        card.appendChild(img);
      } else {
        const icon = document.createElement('span');
        icon.className = 'bp-est-file-card__pdf';
        icon.textContent = 'PDF';
        card.appendChild(icon);
      }
      const meta = document.createElement('div');
      meta.className = 'bp-est-file-card__meta';
      meta.innerHTML = `<span class="bp-est-file-card__name">${escapeHtml(item.file.name)}</span><span class="bp-est-file-card__size">${formatBytes(item.file.size)}</span>`;
      const rm = document.createElement('button');
      rm.type = 'button';
      rm.className = 'bp-est-file-card__remove';
      rm.setAttribute('aria-label', 'Remove file');
      rm.textContent = '\u00d7';
      rm.addEventListener('click', () => {
        if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
        selectedFiles.splice(idx, 1);
        syncFileInput();
        renderFilePreview();
      });
      card.appendChild(meta);
      card.appendChild(rm);
      host.appendChild(card);
    });
  }

  function syncFileInput() {
    const input = document.getElementById('estFiles');
    if (!input || typeof DataTransfer === 'undefined') return;
    const dt = new DataTransfer();
    selectedFiles.forEach((item) => dt.items.add(item.file));
    input.files = dt.files;
  }

  function onFilesSelected(fileList) {
    const incoming = [...(fileList || [])];
    for (const file of incoming) {
      if (selectedFiles.length >= MAX_FILES) {
        alert(`Maximum ${MAX_FILES} files allowed.`);
        break;
      }
      const ext = (file.name || '').toLowerCase();
      const okType =
        file.type.startsWith('image/') ||
        file.type === 'application/pdf' ||
        ext.endsWith('.pdf');
      if (!okType) {
        alert(`${file.name}: use JPG, PNG, WebP or PDF.`);
        continue;
      }
      if (file.size > MAX_BYTES) {
        alert(`${file.name} exceeds 20 MB.`);
        continue;
      }
      const previewUrl = file.type.startsWith('image/') ? URL.createObjectURL(file) : null;
      selectedFiles.push({ file, previewUrl });
    }
    syncFileInput();
    renderFilePreview();
  }

  function collectFormSnapshot(form) {
    const svcs = [...form.querySelectorAll('input[name=svc]:checked')].map((c) => c.value);
    return {
      project_type: form.project_type.value,
      project_type_label: PROJECT_TYPE_LABELS[form.project_type.value] || form.project_type.value,
      address: (form.address?.value || document.getElementById('estAddress')?.value || '').trim(),
      services: svcs,
      area_sqft: form.area_sqft.value,
      desired_start: form.desired_start.value || '',
      urgency: form.urgency.value,
      urgency_label: URGENCY_LABELS[form.urgency.value] || form.urgency.value,
      notes: form.notes.value || '',
      site_access: document.getElementById('estSiteAccess')?.checked || false,
      file_names: selectedFiles.map((f) => f.file.name),
    };
  }

  function renderSuccessSummary(snapshot, refNumber) {
    document.getElementById('estRef').textContent = refNumber;
    const host = document.getElementById('estSummary');
    if (!host) return;
    const files =
      snapshot.file_names.length > 0
        ? snapshot.file_names.map((n) => escapeHtml(n)).join(', ')
        : 'None';
    host.innerHTML = `
      <h3 class="bp-est-summary__title">What you submitted</h3>
      <dl class="bp-est-summary__dl">
        <dt>Project type</dt><dd>${escapeHtml(snapshot.project_type_label)}</dd>
        <dt>Address</dt><dd>${escapeHtml(snapshot.address)}</dd>
        <dt>Services</dt><dd>${snapshot.services.length ? escapeHtml(snapshot.services.join(', ')) : 'ù'}</dd>
        <dt>Area</dt><dd>${escapeHtml(snapshot.area_sqft)} sq ft</dd>
        <dt>Desired start</dt><dd>${snapshot.desired_start ? escapeHtml(snapshot.desired_start) : 'ù'}</dd>
        <dt>Urgency</dt><dd>${escapeHtml(snapshot.urgency_label)}</dd>
        <dt>Site access</dt><dd>${snapshot.site_access ? 'Yes' : 'No'}</dd>
        <dt>Attachments</dt><dd>${files}</dd>
        ${snapshot.notes ? `<dt>Notes</dt><dd>${escapeHtml(snapshot.notes)}</dd>` : ''}
      </dl>`;
  }

  document.getElementById('estFiles')?.addEventListener('change', (e) => {
    onFilesSelected(e.target.files);
    e.target.value = '';
  });

  document.getElementById('estForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const btn = document.getElementById('estSubmitBtn');
    const snapshot = collectFormSnapshot(form);

    if (!snapshot.services.length) {
      alert('Select at least one service.');
      return;
    }

    const fd = new FormData();
    fd.append('project_type', snapshot.project_type);
    fd.append('address', snapshot.address);
    fd.append('services', JSON.stringify(snapshot.services));
    fd.append('area_sqft', snapshot.area_sqft);
    fd.append('desired_start', snapshot.desired_start);
    fd.append('urgency', snapshot.urgency);
    fd.append('notes', snapshot.notes);
    fd.append('site_access', snapshot.site_access ? '1' : '0');
    selectedFiles.forEach((item) => fd.append('attachments', item.file));

    btn.disabled = true;
    btn.textContent = 'Submittingù';
    try {
      const r = await window.builderAuth.fetch('/api/estimate-requests', { method: 'POST', body: fd });
      const j = await r.json();
      if (!r.ok || !j.success) {
        alert(j.error || 'Could not submit');
        return;
      }
      form.classList.add('hidden');
      document.getElementById('estSuccess').classList.remove('hidden');
      renderSuccessSummary(snapshot, j.data.ref_number);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      alert(err.message || 'Network error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Submit request';
    }
  });

  document.addEventListener('DOMContentLoaded', () => {
    const boot = window.builderPortalCommon?.whenPortalReady;
    const afterAuth = () => {
      applyUrlPrefill();
      bootAddressAutocomplete();
    };
    if (typeof boot === 'function') {
      boot().then((ok) => {
        if (ok) afterAuth();
      });
    } else if (window.builderAuth?.getToken()) {
      afterAuth();
    }
  });
})();
