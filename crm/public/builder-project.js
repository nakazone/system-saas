(function () {
  const projectParams = new URLSearchParams(location.search);
  const projectId = projectParams.get('id');
  const app = document.getElementById('app');
  let state = null;
  const VALID_TABS = new Set(['summary', 'photos', 'materials', 'checklist', 'messages']);
  const tabParam = projectParams.get('tab');
  let activeTab = VALID_TABS.has(tabParam) ? tabParam : 'summary';

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function fmtDate(d) {
    if (!d) return '�';
    try {
      return new Date(`${String(d).slice(0, 10)}T12:00:00`).toLocaleDateString('en-US', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      });
    } catch {
      return String(d).slice(0, 10);
    }
  }

  function fmtTime(iso) {
    if (!iso) return '';
    try {
      return new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    } catch {
      return String(iso).slice(11, 16);
    }
  }

  function fmtDayLabel(iso) {
    if (!iso) return '';
    const day = String(iso).slice(0, 10);
    const today = new Date().toISOString().slice(0, 10);
    const y = new Date();
    y.setDate(y.getDate() - 1);
    const yesterday = y.toISOString().slice(0, 10);
    if (day === today) return 'Today';
    if (day === yesterday) return 'Yesterday';
    return fmtDate(day);
  }

  function teamInitials(name) {
    const parts = String(name || '')
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    if (!parts.length) return 'SF';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  function avatarSrc(url) {
    if (!url) return null;
    const u = String(url).trim();
    if (/^https?:\/\//i.test(u)) return u;
    if (u.startsWith('/')) return u;
    return `/${u.replace(/^\//, '')}`;
  }

  function sfContactBadge() {
    if (window.builderPortalCommon?.sfContactBadgeHtml) {
      return window.builderPortalCommon.sfContactBadgeHtml('Senior Floors team member');
    }
    return '<span class="bp-sf-contact-badge" title="Senior Floors"><img src="/assets/SeniorFloors.png?v=20260529" alt="Senior Floors" width="26" height="26" /></span>';
  }

  function renderProjectTeam(team) {
    const roles = team && team.length ? team : [];
    const cards = roles
      .map((member) => {
        const src = avatarSrc(member.avatar_url);
        const initials = escapeHtml(teamInitials(member.name));
        const avatar = src
          ? `<img class="bp-team-card__avatar" src="${escapeHtml(src)}" alt="" loading="lazy" onerror="this.classList.add('hidden');this.nextElementSibling?.classList.remove('hidden');" /><div class="bp-team-card__avatar bp-team-card__avatar--init hidden">${initials}</div>`
          : `<div class="bp-team-card__avatar bp-team-card__avatar--init">${initials}</div>`;
        const phone = member.phone ? String(member.phone).trim() : '';
        const tel = phone ? phone.replace(/[^\d+]/g, '') : '';
        const contact = member.name
          ? `<p class="bp-team-card__name">${escapeHtml(member.name)}</p>
            ${phone ? `<p class="bp-team-card__contact"><a href="tel:${escapeHtml(tel)}">${escapeHtml(phone)}</a></p>` : ''}
            ${member.email ? `<p class="bp-team-card__contact"><a href="mailto:${escapeHtml(member.email)}">${escapeHtml(member.email)}</a></p>` : ''}`
          : `<p class="bp-team-card__empty">To be assigned by Senior Floors</p>`;
        return `<article class="bp-team-card">
          <div class="bp-team-card__avatar-wrap">
            ${avatar}
            ${sfContactBadge()}
          </div>
          <h3 class="bp-team-card__role">${escapeHtml(member.title)}</h3>
          ${contact}
        </article>`;
      })
      .join('');
    return `<section class="bp-proj-team" aria-label="Senior Floors project team">
      <h2 class="bp-proj-team__title">Your Senior Floors team</h2>
      <div class="bp-proj-team__grid">${cards}</div>
    </section>`;
  }

  function statusBadge(status) {
    const s = String(status || '').toLowerCase();
    const map = {
      scheduled: ['scheduled', 'Scheduled'],
      in_progress: ['active', 'In progress'],
      active: ['active', 'In progress'],
      completed: ['completed', 'Completed'],
      cancelled: ['cancelled', 'Cancelled'],
    };
    const m = map[s] || ['pending', s || '�'];
    return `<span class="bp-badge bp-badge--${m[0]}">${escapeHtml(m[1])}</span>`;
  }

  function renderTimeline(timeline) {
    return `<div class="bp-timeline bp-timeline--dated">${(timeline || [])
      .map((s) => {
        const statusClass = s.status === 'done' ? 'done' : s.status === 'active' ? 'active' : 'pending';
        let dates = '';
        if (s.status === 'done' && s.date_actual) {
          dates = `<span class="bp-timeline__actual">Done ${fmtDate(s.date_actual)}</span>`;
        } else if (s.date_planned) {
          dates = `<span class="bp-timeline__planned">Est. ${fmtDate(s.date_planned)}</span>`;
        }
        return `<div class="bp-timeline__step bp-timeline__step--${statusClass}">
            <div class="bp-timeline__dot"></div>
            <span class="bp-timeline__label">${escapeHtml(s.label)}</span>
            ${dates ? `<span class="bp-timeline__dates">${dates}</span>` : ''}
          </div>`;
      })
      .join('')}</div>`;
  }

  function photoMeta(p) {
    const who = p.partner_upload ? 'You' : 'Senior Floors';
    const when = p.created_at ? fmtDate(p.created_at) : '';
    return [when, who].filter(Boolean).join(' � ');
  }

  function renderPhotos(photos) {
    const list = photos || [];
    const byPhase = { before: [], during: [], after: [] };
    list.forEach((p) => {
      const phase = ['before', 'during', 'after'].includes(p.phase) ? p.phase : 'during';
      byPhase[phase].push(p);
    });
    const phaseLabel = { before: 'Before', during: 'During', after: 'After' };
    const allPhotos = list;
    return Object.keys(byPhase)
      .map((phase) => {
        const items = byPhase[phase];
        const grid = items.length
          ? items
              .map((p, idx) => {
                const globalIdx = allPhotos.findIndex((x) => x.id === p.id);
                return `<div class="bp-photo-card-wrap">
                    <button type="button" class="bp-photo-card" data-photo-idx="${globalIdx >= 0 ? globalIdx : idx}">
                      <img src="${escapeHtml(p.url)}" alt="" loading="lazy" />
                      <span class="bp-photo-card__tag">SF</span>
                    </button>
                    <div class="bp-photo-card__meta">${escapeHtml(photoMeta(p))}</div>
                  </div>`;
              })
              .join('')
          : '<p class="bp-muted">No photos yet.</p>';
        return `<section class="bp-photo-section"><h3>${phaseLabel[phase]} (${items.length})</h3><div class="bp-photo-grid">${grid}</div></section>`;
      })
      .join('');
  }

  function responsibleLabel(assigned) {
    const a = String(assigned || 'sf').toLowerCase();
    return a === 'builder' ? 'Builder' : 'Senior Floors';
  }

  function renderChecklist(groups, progress) {
    const builder = groups?.builder || [];
    const sf = groups?.sf || [];
    const awaiting = groups?.awaiting || [];
    if (!builder.length && !sf.length && !awaiting.length) {
      return `<div class="bp-card bp-checklist-empty">
        <p><strong>Checklist not ready yet</strong></p>
        <p class="bp-muted">Senior Floors will enable items when your project is scheduled. When available, you will see:</p>
        <ul>
          <li>Your action items (with checkboxes)</li>
          <li>Items awaiting SF approval</li>
          <li>Senior Floors responsibilities</li>
        </ul>
        <p class="bp-muted" style="margin-top:12px">You will receive an email when new items are assigned to you.</p>
      </div>`;
    }
    const prog =
      progress && progress.total
        ? `<p class="bp-muted" style="margin-bottom:12px"><strong>${progress.done}</strong> of <strong>${progress.total}</strong> your items completed</p>`
        : '';
    const renderItem = (it, canToggle) => {
      const checked = it.checked === 1 || it.checked === true;
      const due = it.due_date ? `<span class="bp-muted"> � Due ${fmtDate(it.due_date)}</span>` : '';
      const resp = `<span class="bp-muted" style="display:block;font-size:11px">Responsible: ${responsibleLabel(it.assigned_to)}${due}</span>`;
      const notes = it.notes ? `<span class="bp-muted" style="display:block;font-size:11px">${escapeHtml(it.notes)}</span>` : '';
      return `<div class="bp-check-item ${checked ? 'bp-check-item--done' : ''}">
          <label style="display:flex;align-items:flex-start;gap:10px;cursor:${canToggle ? 'pointer' : 'default'}">
            <input type="checkbox" data-chk-id="${it.id}" ${checked ? 'checked' : ''} ${canToggle ? '' : 'disabled'} />
            <span><strong>${escapeHtml(it.item)}</strong>
              ${it.category ? `<span class="bp-muted" style="display:block;font-size:11px">${escapeHtml(it.category)}</span>` : ''}
              ${resp}${notes}
            </span>
          </label>
        </div>`;
    };
    const block = (title, items, canToggle) =>
      items.length
        ? `<h3 style="font-size:13px;margin:16px 0 8px">${title}</h3><div class="bp-checklist">${items.map((it) => renderItem(it, canToggle)).join('')}</div>`
        : '';
    return `${prog}${block('Your responsibility', builder, true)}${block('Awaiting approval', awaiting, false)}${block('Senior Floors responsibility', sf, false)}`;
  }

  function openLightbox(photos, index) {
    let curr = Math.max(0, Math.min(index, photos.length - 1));
    const overlay = document.createElement('div');
    overlay.className = 'bp-proj-lightbox open';
    overlay.setAttribute('role', 'dialog');
    overlay.innerHTML = `<div style="text-align:center;max-width:95vw">
      <img class="bp-proj-lightbox__img" alt="" />
      <p class="bp-proj-lightbox__cap"></p>
      <div class="bp-proj-lightbox__nav"></div>
    </div>`;
    const img = overlay.querySelector('.bp-proj-lightbox__img');
    const cap = overlay.querySelector('.bp-proj-lightbox__cap');
    const nav = overlay.querySelector('.bp-proj-lightbox__nav');

    function draw() {
      const p = photos[curr];
      if (!p) return;
      img.src = p.url;
      cap.textContent = `${photoMeta(p)} � ${curr + 1} / ${photos.length}`;
      nav.innerHTML = '';
      if (curr > 0) {
        const prev = document.createElement('button');
        prev.type = 'button';
        prev.className = 'bp-proj-lightbox__btn';
        prev.textContent = '? Previous';
        prev.onclick = () => {
          curr--;
          draw();
        };
        nav.appendChild(prev);
      }
      const close = document.createElement('button');
      close.type = 'button';
      close.className = 'bp-proj-lightbox__btn';
      close.textContent = 'Close';
      close.onclick = () => overlay.remove();
      nav.appendChild(close);
      if (curr < photos.length - 1) {
        const next = document.createElement('button');
        next.type = 'button';
        next.className = 'bp-proj-lightbox__btn';
        next.textContent = 'Next ?';
        next.onclick = () => {
          curr++;
          draw();
        };
        nav.appendChild(next);
      }
    }

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.remove();
    });
    document.addEventListener(
      'keydown',
      function onKey(e) {
        if (!document.body.contains(overlay)) {
          document.removeEventListener('keydown', onKey);
          return;
        }
        if (e.key === 'Escape') overlay.remove();
        if (e.key === 'ArrowLeft' && curr > 0) {
          curr--;
          draw();
        }
        if (e.key === 'ArrowRight' && curr < photos.length - 1) {
          curr++;
          draw();
        }
      },
      { passive: true }
    );
    document.body.appendChild(overlay);
    draw();
  }

  function compressImage(file, maxDim = 1920, quality = 0.82) {
    return new Promise((resolve, reject) => {
      if (!file.type.startsWith('image/')) {
        resolve(file);
        return;
      }
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        let { width, height } = img;
        if (width <= maxDim && height <= maxDim && file.size < 900000) {
          resolve(file);
          return;
        }
        const scale = Math.min(1, maxDim / Math.max(width, height));
        width = Math.round(width * scale);
        height = Math.round(height * scale);
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        canvas.toBlob(
          (blob) => {
            if (!blob) {
              resolve(file);
              return;
            }
            resolve(new File([blob], file.name.replace(/\.\w+$/, '.jpg'), { type: 'image/jpeg' }));
          },
          'image/jpeg',
          quality
        );
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        resolve(file);
      };
      img.src = url;
    });
  }

  function renderPreviewGrid() {
    const host = document.getElementById('photoPreviewGrid');
    if (!host) return;
    if (!pendingUploads.length) {
      host.innerHTML = '';
      return;
    }
    host.innerHTML = pendingUploads
      .map(
        (item, i) =>
          `<div class="bp-photo-preview" data-preview-idx="${i}">
            <img src="${item.previewUrl}" alt="" />
            <button type="button" class="bp-photo-preview__remove" data-remove-idx="${i}" aria-label="Remove">&times;</button>
          </div>`
      )
      .join('');
    host.querySelectorAll('[data-remove-idx]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = parseInt(btn.dataset.removeIdx, 10);
        const removed = pendingUploads.splice(idx, 1)[0];
        if (removed?.previewUrl) URL.revokeObjectURL(removed.previewUrl);
        renderPreviewGrid();
      });
    });
  }

  async function addFilesToQueue(fileList) {
    const files = Array.from(fileList || []).filter((f) => f.type.startsWith('image/'));
    if (!files.length) return;
    const room = MAX_PHOTOS_PER_BATCH - pendingUploads.length;
    if (room <= 0) {
      alert(`Maximum ${MAX_PHOTOS_PER_BATCH} photos per upload. Remove some previews first.`);
      return;
    }
    const slice = files.slice(0, room);
    if (files.length > room) {
      alert(`Only ${room} more photo(s) added (max ${MAX_PHOTOS_PER_BATCH} per batch).`);
    }
    for (const file of slice) {
      pendingUploads.push({
        file,
        previewUrl: URL.createObjectURL(file),
      });
    }
    renderPreviewGrid();
  }

  async function loadProjectMessages(panel) {
    panel.innerHTML = '<p class="bp-muted">Loading messages...</p>';
    const r = await window.builderAuth.fetch(
      `/api/builder-messages/partner/thread?project_id=${projectId}`
    );
    const j = await r.json();
    if (!j.success) {
      panel.innerHTML = '<p>Could not load messages.</p>';
      return;
    }
    const messages = j.data.messages || [];
    let html = '<div class="bp-msg-thread"><div class="bp-msg-scroll" id="projMsgScroll" style="max-height:400px">';
    let lastDate = '';
    messages.forEach((m) => {
      const day = String(m.created_at).slice(0, 10);
      if (day !== lastDate) {
        lastDate = day;
        html += `<div class="bp-msg-date">${escapeHtml(fmtDayLabel(m.created_at))}</div>`;
      }
      const mine = m.sender_type === 'builder';
      const sender = mine ? 'You' : 'Senior Floors';
      const att =
        m.attachment_url && !m.is_internal_note
          ? m.attachment_url.match(/\.pdf$/i)
            ? `<p><a href="${escapeHtml(m.attachment_url)}" target="_blank" rel="noopener">PDF attachment</a></p>`
            : `<p><a href="${escapeHtml(m.attachment_url)}" target="_blank" rel="noopener"><img src="${escapeHtml(m.attachment_url)}" alt="" style="max-width:220px;border-radius:8px;margin-top:6px" loading="lazy" /></a></p>`
          : '';
      const readMark = mine && m.is_read ? ' <span title="Read">??</span>' : mine ? ' <span title="Sent">?</span>' : '';
      html += `<div class="bp-msg-bubble ${mine ? 'bp-msg-bubble--mine' : ''}">
        <span class="bp-msg-sender" style="font-size:10px;font-weight:600;opacity:.85">${escapeHtml(sender)}</span>
        <p>${escapeHtml(m.message)}</p>${att}
        <span class="bp-msg-time">${fmtTime(m.created_at)}${readMark}</span>
      </div>`;
    });
    if (!messages.length) {
      html += '<p class="bp-muted" style="text-align:center;padding:24px">No messages yet. Contact your Senior Floors manager below.</p>';
    }
    html += `</div><footer class="bp-msg-compose">
      <textarea id="projMsgInput" rows="2" placeholder="Message about this project..."></textarea>
      <div style="display:flex;gap:8px;align-items:center;margin-top:6px;flex-wrap:wrap">
        <label class="bp-btn-ghost" style="cursor:pointer;font-size:12px;padding:6px 10px">Attach
          <input type="file" id="projMsgAttach" accept=".jpg,.jpeg,.png,.webp,.pdf" hidden />
        </label>
        <button type="button" class="bp-btn-tan" id="projMsgSend">Send</button>
      </div>
    </footer></div>`;
    panel.innerHTML = html;
    const scroll = document.getElementById('projMsgScroll');
    if (scroll) scroll.scrollTop = scroll.scrollHeight;
    document.getElementById('projMsgSend')?.addEventListener('click', () => sendProjectMessage(panel));
  }

  async function sendProjectMessage(panel) {
    const text = document.getElementById('projMsgInput')?.value?.trim();
    const file = document.getElementById('projMsgAttach')?.files?.[0];
    if (!text && !file) return;
    const fd = new FormData();
    if (text) fd.append('message', text);
    else if (file) fd.append('message', '(attachment)');
    if (file) fd.append('attachment', file);
    fd.append('project_id', String(parseInt(projectId, 10)));
    const r = await window.builderAuth.fetch('/api/builder-messages/partner', { method: 'POST', body: fd });
    if (!r.ok) {
      alert('Could not send message');
      return;
    }
    document.getElementById('projMsgInput').value = '';
    const att = document.getElementById('projMsgAttach');
    if (att) att.value = '';
    loadProjectMessages(panel);
  }

  function openMessageModal(title, placeholder, prefix) {
    const modal = document.createElement('div');
    modal.className = 'bp-modal open';
    modal.innerHTML = `<div class="bp-modal__box">
      <h3>${escapeHtml(title)}</h3>
      <textarea id="quickMsgText" rows="4" style="width:100%;box-sizing:border-box" placeholder="${escapeHtml(placeholder)}"></textarea>
      <label style="font-size:12px;display:block;margin:8px 0">Urgency
        <select id="quickMsgUrgency" style="width:100%;padding:8px;margin-top:4px">
          <option value="normal">Normal</option>
          <option value="urgent">Urgent</option>
        </select>
      </label>
      <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">
        <button type="button" class="bp-btn-tan" id="quickMsgSubmit">Send</button>
        <button type="button" class="bp-btn-ghost" id="quickMsgCancel">Cancel</button>
      </div>
    </div>`;
    document.body.appendChild(modal);
    modal.querySelector('#quickMsgCancel')?.addEventListener('click', () => modal.remove());
    modal.querySelector('#quickMsgSubmit')?.addEventListener('click', async () => {
      const text = document.getElementById('quickMsgText')?.value?.trim();
      if (!text) return;
      const urg = document.getElementById('quickMsgUrgency')?.value;
      const tag = urg === 'urgent' ? 'URGENT' : prefix;
      await window.builderAuth.fetch('/api/builder-messages/partner', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: `[${tag}] ${text}`,
          project_id: parseInt(projectId, 10),
        }),
      });
      modal.remove();
      activeTab = 'messages';
      render();
    });
  }

  const approvalLabel = {
    pending: 'Awaiting your approval',
    approved: 'Approved',
    rejected: 'Rejected',
    change_requested: 'Change requested',
  };

  function materialsPendingCount(rows) {
    return (rows || []).filter((m) => m.builder_approval_status === 'pending').length;
  }

  function renderMaterials(materials) {
    const rows = materials || [];
    if (!rows.length) {
      return '<div class="bp-card"><p class="bp-muted">No materials shared for this project yet. Senior Floors will publish selections for your approval before work begins.</p></div>';
    }
    const pending = materialsPendingCount(rows);
    const header =
      pending > 0
        ? `<div class="bp-mat-banner">
            <p><strong>${pending}</strong> material(s) awaiting your approval before work can proceed.</p>
            <button type="button" class="bp-btn-tan" id="btnMatApproveAll">Approve all</button>
          </div>`
        : `<p class="bp-muted bp-mat-all-done">All shared materials have been reviewed.</p>`;

    const cards = rows
      .map((m) => {
        const status = m.builder_approval_status || 'pending';
        const img = m.material_image_url
          ? `<img class="bp-mat-card__img" src="${escapeHtml(m.material_image_url)}" alt="" loading="lazy" onerror="this.style.display='none'" />`
          : '<div class="bp-mat-card__img bp-mat-card__img--placeholder" aria-hidden="true"></div>';
        const spec = m.material_spec
          ? `<p class="bp-mat-card__spec">${escapeHtml(m.material_spec)}</p>`
          : '';
        const color = m.material_color
          ? `<p class="bp-mat-card__color"><strong>Color:</strong> ${escapeHtml(m.material_color)}</p>`
          : '';
        const commentBlock =
          m.builder_comment && status !== 'pending'
            ? `<p class="bp-mat-card__comment"><strong>Your note:</strong> ${escapeHtml(m.builder_comment)}</p>`
            : '';
        const actions =
          status === 'pending'
            ? `<div class="bp-mat-card__actions">
                <button type="button" class="bp-btn-tan bp-mat-approve" data-mid="${m.id}">Approve</button>
                <button type="button" class="bp-btn-ghost bp-mat-change" data-mid="${m.id}">Request change</button>
                <button type="button" class="bp-btn-ghost bp-mat-reject" data-mid="${m.id}">Reject</button>
              </div>
              <label class="bp-mat-card__comment-label">Comment (optional)
                <textarea class="bp-mat-comment" data-mid="${m.id}" rows="2" placeholder="Notes for Senior Floors…"></textarea>
              </label>`
            : `<span class="bp-badge bp-badge--${status === 'approved' ? 'completed' : status === 'rejected' ? 'cancelled' : 'pending'}">${escapeHtml(approvalLabel[status] || status)}</span>`;
        return `<article class="bp-mat-card" data-mat-id="${m.id}">
            ${img}
            <div class="bp-mat-card__body">
              <h3 class="bp-mat-card__title">${escapeHtml(m.product_name)}</h3>
              ${m.sku ? `<p class="bp-muted" style="font-size:12px;margin:0">SKU: ${escapeHtml(m.sku)}</p>` : ''}
              ${m.supplier ? `<p class="bp-muted" style="font-size:12px;margin:4px 0 0">Supplier: ${escapeHtml(m.supplier)}</p>` : ''}
              ${color}${spec}${commentBlock}
              <div class="bp-mat-card__footer">${actions}</div>
            </div>
          </article>`;
      })
      .join('');

    return `${header}<div class="bp-mat-grid">${cards}</div>`;
  }

  function openMaterialActionModal(materialId, status, title) {
    const modal = document.createElement('div');
    modal.className = 'bp-modal open';
    modal.innerHTML = `<div class="bp-modal__box">
      <h3>${escapeHtml(title)}</h3>
      <textarea id="matActionComment" rows="3" style="width:100%;box-sizing:border-box" placeholder="Explain what should change (required for change requests)"></textarea>
      <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">
        <button type="button" class="bp-btn-tan" id="matActionSubmit">Submit</button>
        <button type="button" class="bp-btn-ghost" id="matActionCancel">Cancel</button>
      </div>
    </div>`;
    document.body.appendChild(modal);
    modal.querySelector('#matActionCancel')?.addEventListener('click', () => modal.remove());
    modal.querySelector('#matActionSubmit')?.addEventListener('click', async () => {
      const card = document.querySelector(`.bp-mat-comment[data-mid="${materialId}"]`);
      const inline = card?.value?.trim() || '';
      const modalComment = document.getElementById('matActionComment')?.value?.trim() || '';
      const comment = modalComment || inline;
      if (status === 'change_requested' && !comment) {
        alert('Please describe what you would like changed.');
        return;
      }
      modal.remove();
      await updateMaterial(materialId, status, comment);
    });
  }

  function wireMaterials(panel) {
    panel.querySelector('#btnMatApproveAll')?.addEventListener('click', approveAllMaterials);
    panel.querySelectorAll('.bp-mat-approve').forEach((btn) => {
      btn.addEventListener('click', () => {
        const card = panel.querySelector(`.bp-mat-comment[data-mid="${btn.dataset.mid}"]`);
        const comment = card?.value?.trim() || '';
        updateMaterial(btn.dataset.mid, 'approved', comment);
      });
    });
    panel.querySelectorAll('.bp-mat-reject').forEach((btn) => {
      btn.addEventListener('click', () =>
        openMaterialActionModal(btn.dataset.mid, 'rejected', 'Reject material')
      );
    });
    panel.querySelectorAll('.bp-mat-change').forEach((btn) => {
      btn.addEventListener('click', () =>
        openMaterialActionModal(btn.dataset.mid, 'change_requested', 'Request material change')
      );
    });
  }

  async function approveAllMaterials() {
    if (!confirm('Approve all pending materials for this project?')) return;
    const r = await window.builderAuth.fetch(
      `/api/builder-projects/${projectId}/materials/approve-all`,
      { method: 'POST' }
    );
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      alert(j.error || 'Could not approve materials');
      return;
    }
    await load();
    activeTab = 'materials';
    render();
  }

    async function updateMaterial(materialId, status, comment) {
    const r = await window.builderAuth.fetch(
      `/api/builder-projects/${projectId}/materials/${materialId}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ builder_approval_status: status, builder_comment: comment || null }),
      }
    );
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      alert(j.error || 'Could not update material');
      return;
    }
    await load();
    activeTab = 'materials';
    render();
  }

  function render() {
    if (!state?.project) return;
    const { project: p, timeline, checklist_groups, checklist_progress, photos, materials, project_team } =
      state;
    const pct = Math.min(100, Number(p.completion_percentage) || 0);
    app.innerHTML = `
      <a href="builder-projects.html" class="bp-back-link">&larr; Back to projects</a>
      <header class="bp-proj-header">
        <div>
          <h1 class="bp-title">${escapeHtml(p.name || p.project_number || 'Project')}</h1>
          <p class="bp-muted">${escapeHtml(p.address || '')}</p>
        </div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          ${statusBadge(p.status)}
          ${
            ['completed', 'closed'].includes(String(p.status || '').toLowerCase())
              ? `<button type="button" class="bp-btn-tan" id="btnClientReport">Client report (PDF)</button>`
              : ''
          }
          <button type="button" class="bp-btn-ghost" id="btnContact">Contact SF</button>
          <button type="button" class="bp-btn-ghost" id="btnIssue">Report issue</button>
        </div>
      </header>
      <p class="bp-muted" style="margin:0 0 12px">${fmtDate(p.start_date)} &rarr; ${fmtDate(p.end_date_estimated)}</p>
      <div class="bp-progress-wrap">
        <div class="bp-progress-bar"><div class="bp-progress-fill" style="width:${pct}%"></div></div>
        <span class="bp-progress-pct">${pct}%</span>
      </div>
      ${renderTimeline(timeline)}
      <nav class="bp-tabs" role="tablist">
        <button type="button" data-tab="summary" class="${activeTab === 'summary' ? 'active' : ''}">Summary</button>
        <button type="button" data-tab="photos" class="${activeTab === 'photos' ? 'active' : ''}">Site photos</button>
        <button type="button" data-tab="materials" class="${activeTab === 'materials' ? 'active' : ''}">Materials</button>
        <button type="button" data-tab="checklist" class="${activeTab === 'checklist' ? 'active' : ''}">Checklist</button>
        <button type="button" data-tab="messages" class="${activeTab === 'messages' ? 'active' : ''}">Messages</button>
      </nav>
      <div id="tabPanel"></div>
      ${renderProjectTeam(project_team)}`;

    document.getElementById('btnClientReport')?.addEventListener('click', downloadClientReport);
    document.getElementById('btnIssue')?.addEventListener('click', () =>
      openMessageModal('Report an issue', 'Describe the issue or site problem...', 'Issue')
    );
    document.getElementById('btnContact')?.addEventListener('click', () =>
      openMessageModal(
        'Contact Senior Floors',
        'Your question or request about this project...',
        'Contact'
      )
    );

    const panel = document.getElementById('tabPanel');
    if (activeTab === 'summary') {
      const docs = state.documents || [];
      const docList = docs.length
        ? `<ul class="bp-doc-list">${docs
            .map(
              (d) =>
                `<li><a href="${escapeHtml(d.url)}" target="_blank" rel="noopener" download>${escapeHtml(d.name)}</a> <span class="bp-muted">${escapeHtml(d.doc_type || '')}</span></li>`
            )
            .join('')}</ul>`
        : '<p class="bp-muted">No project documents shared yet.</p>';
      const sfNotes = p.internal_notes_for_builder || '';
      const clientNotes = p.client_notes && p.client_notes !== sfNotes ? p.client_notes : '';
      panel.innerHTML = `
        <div class="bp-summary-grid">
          <div class="bp-card">
            <h3 style="margin:0 0 10px;font-size:14px">Project details</h3>
            <p><strong>Floor:</strong> ${escapeHtml(p.flooring_type || '�')}</p>
            <p><strong>Area:</strong> ${p.total_sqft ? `${p.total_sqft} sq ft` : '�'}</p>
            <p><strong>Service:</strong> ${escapeHtml(p.service_type || '�')}</p>
            <p><strong>Address:</strong> ${escapeHtml(p.address || '�')}</p>
            <p><strong>Start:</strong> ${fmtDate(p.start_date)}</p>
            <p><strong>Est. completion:</strong> ${fmtDate(p.end_date_estimated)}</p>
          </div>
          <div class="bp-card">
            <h3 style="margin:0 0 10px;font-size:14px">Project documents</h3>
            ${docList}
            <h3 style="margin:16px 0 10px;font-size:14px">Notes from Senior Floors</h3>
            <p style="white-space:pre-wrap">${escapeHtml(sfNotes || 'No notes yet.')}</p>
            ${clientNotes ? `<h3 style="margin:16px 0 10px;font-size:14px">Project notes</h3><p style="white-space:pre-wrap">${escapeHtml(clientNotes)}</p>` : ''}
          </div>
        </div>`;
    } else if (activeTab === 'photos') {
      const photoList = photos || [];
      panel.innerHTML = `
        <div class="bp-card" style="margin-bottom:16px">
          <h3 style="margin:0 0 8px;font-size:1rem">Site photos</h3>
          <p class="bp-muted" style="margin:0;font-size:13px">Photos added by Senior Floors for this project. Tap any image to view full size.</p>
        </div>
        ${renderPhotos(photoList)}`;
      panel.querySelectorAll('[data-photo-idx]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const idx = parseInt(btn.dataset.photoIdx, 10);
          openLightbox(photoList, idx);
        });
      });
    } else if (activeTab === 'materials') {
      panel.innerHTML = renderMaterials(materials);
      wireMaterials(panel);
    } else if (activeTab === 'checklist') {
      panel.innerHTML = renderChecklist(checklist_groups, checklist_progress);
      panel.querySelectorAll('[data-chk-id]').forEach((inp) => {
        inp.addEventListener('change', () => toggleChecklist(inp.dataset.chkId, inp.checked));
      });
    } else {
      panel.innerHTML = '<div id="projMsgHost"></div>';
      loadProjectMessages(document.getElementById('projMsgHost'));
    }

    app.querySelectorAll('.bp-tabs button').forEach((btn) => {
      btn.addEventListener('click', () => {
        activeTab = btn.dataset.tab;
        render();
      });
    });
  }

  function wirePhotoUpload() {
    const dz = document.getElementById('photoDropzone');
    const input = document.getElementById('uploadFiles');
    if (!dz || !input) return;

    document.querySelectorAll('#phasePills .bp-phase-pill').forEach((pill) => {
      pill.addEventListener('click', () => {
        uploadPhase = pill.dataset.phase || 'during';
        document.querySelectorAll('#phasePills .bp-phase-pill').forEach((p) => {
          p.classList.toggle('active', p.dataset.phase === uploadPhase);
        });
      });
    });

    dz.addEventListener('click', () => input.click());
    input.addEventListener('change', () => {
      addFilesToQueue(input.files);
      input.value = '';
    });
    dz.addEventListener('dragover', (e) => {
      e.preventDefault();
      dz.classList.add('bp-dropzone--over');
    });
    dz.addEventListener('dragleave', () => dz.classList.remove('bp-dropzone--over'));
    dz.addEventListener('drop', (e) => {
      e.preventDefault();
      dz.classList.remove('bp-dropzone--over');
      addFilesToQueue(e.dataTransfer.files);
    });
    document.getElementById('btnUpload')?.addEventListener('click', uploadPhotos);
  }

  async function load() {
    try {
      const r = await window.builderAuth.fetch(`/api/builder-projects/${projectId}`);
      let j;
      try {
        j = await r.json();
      } catch (_) {
        app.innerHTML = `<p class="bp-card">Could not load project (invalid server response).</p>`;
        return;
      }
      if (!r.ok || !j.success) {
        app.innerHTML = `<p class="bp-card">${escapeHtml(j.error || 'Project not found')}</p>
          <p style="margin-top:12px"><a href="builder-projects.html">Back to projects</a></p>`;
        return;
      }
      if (!j.data?.project) {
        app.innerHTML = `<p class="bp-card">Project data is incomplete. Please try again or contact Senior Floors.</p>`;
        return;
      }
      state = j.data;
      if (!state.project_team || !state.project_team.length) {
        const gm = state.manager;
        state.project_team = [
          {
            role: 'general_manager',
            title: 'General Manager',
            name: gm?.name,
            email: gm?.email,
            phone: gm?.phone,
            avatar_url: gm?.avatar_url,
          },
          { role: 'installation_supervisor', title: 'Installation Supervisor' },
          { role: 'sand_finish_supervisor', title: 'Sand & Finish Supervisor' },
        ];
      }
      if (!state.checklist_groups) {
        state.checklist_groups = {
          builder: (state.checklist || []).filter(
            (it) =>
              String(it.assigned_to || 'sf').toLowerCase() === 'builder' &&
              String(it.approval_status || '') !== 'pending_sf'
          ),
          sf: (state.checklist || []).filter(
            (it) =>
              String(it.assigned_to || 'sf').toLowerCase() !== 'builder' &&
              String(it.approval_status || '') !== 'pending_sf'
          ),
          awaiting: (state.checklist || []).filter((it) => String(it.approval_status || '') === 'pending_sf'),
        };
      }
      render();
      void maybeShowEvaluationModal();
    } catch (err) {
      console.error('load project:', err);
      app.innerHTML = `<p class="bp-card">Could not load project. ${escapeHtml(err.message || 'Network error')}</p>
        <p style="margin-top:12px"><a href="builder-projects.html">Back to projects</a></p>`;
    }
  }

  function setUploadProgress(fileName, pct) {
    const list = document.getElementById('uploadProgressList');
    if (!list) return;
    let row = list.querySelector(`[data-file="${CSS.escape(fileName)}"]`);
    if (!row) {
      row = document.createElement('div');
      row.className = 'bp-upload-progress-item';
      row.dataset.file = fileName;
      row.innerHTML = `<span class="bp-upload-progress-item__name"></span><div class="bp-upload-progress-item__bar"><div class="bp-upload-progress-item__fill"></div></div>`;
      list.appendChild(row);
    }
    row.querySelector('.bp-upload-progress-item__name').textContent = `${fileName} � ${pct}%`;
    const fill = row.querySelector('.bp-upload-progress-item__fill');
    if (fill) fill.style.width = `${pct}%`;
  }

  async function uploadPhotos() {
    if (!pendingUploads.length) {
      const status = document.getElementById('uploadStatus');
      if (status) status.textContent = 'Add photos using drag & drop or file picker.';
      return;
    }
    const status = document.getElementById('uploadStatus');
    const progressList = document.getElementById('uploadProgressList');
    if (progressList) progressList.innerHTML = '';
    const phase = uploadPhase;
    let ok = 0;
    const total = pendingUploads.length;
    status.textContent = 'Preparing uploads...';

    for (let i = 0; i < total; i++) {
      const item = pendingUploads[i];
      const name = item.file.name;
      setUploadProgress(name, 10);
      status.textContent = `Compressing ${i + 1}/${total}...`;
      let blob;
      try {
        blob = await compressImage(item.file);
      } catch {
        blob = item.file;
      }
      setUploadProgress(name, 40);
      status.textContent = `Uploading ${i + 1}/${total}...`;
      const fd = new FormData();
      fd.append('file', blob, blob.name || name);
      fd.append('phase', phase);
      setUploadProgress(name, 70);
      const r = await window.builderAuth.fetch(`/api/builder-projects/${projectId}/photos`, {
        method: 'POST',
        body: fd,
      });
      setUploadProgress(name, r.ok ? 100 : 0);
      if (r.ok) ok++;
    }

    pendingUploads.forEach((p) => {
      if (p.previewUrl) URL.revokeObjectURL(p.previewUrl);
    });
    pendingUploads = [];
    status.textContent = `Uploaded ${ok} of ${total} photo(s).`;
    await load();
    activeTab = 'photos';
    render();
  }

  async function downloadClientReport() {
    try {
      const r = await window.builderAuth.fetch(
        `/api/builder-projects/${projectId}/client-report.pdf`
      );
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        alert(j.error || 'Could not generate report');
        return;
      }
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `client-report-${projectId}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      alert(e.message || 'Download failed');
    }
  }

  function openEvaluationModal(googleReviewUrl) {
    const modal = document.createElement('div');
    modal.className = 'bp-modal open bp-eval-modal';
    modal.innerHTML = `<div class="bp-modal__box">
      <h3>How was this project with Senior Floors?</h3>
      <p class="bp-muted">Your feedback helps us improve. This project is marked completed.</p>
      <div class="bp-star-rating" id="evalStars" role="group" aria-label="Rating">
        ${[1, 2, 3, 4, 5].map((n) => `<button type="button" class="bp-star" data-star="${n}" aria-label="${n} stars">&#9733;</button>`).join('')}
      </div>
      <textarea id="evalComment" rows="3" style="width:100%;box-sizing:border-box;margin-top:12px" placeholder="Optional comment�"></textarea>
      <div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap">
        <button type="button" class="bp-btn-tan" id="evalSubmit" disabled>Submit feedback</button>
        <button type="button" class="bp-btn-ghost" id="evalLater">Remind me later</button>
      </div>
    </div>`;
    document.body.appendChild(modal);
    let selected = 0;
    modal.querySelectorAll('.bp-star').forEach((btn) => {
      btn.addEventListener('click', () => {
        selected = parseInt(btn.dataset.star, 10);
        modal.querySelectorAll('.bp-star').forEach((s) => {
          s.classList.toggle('bp-star--on', parseInt(s.dataset.star, 10) <= selected);
        });
        modal.querySelector('#evalSubmit').disabled = false;
      });
    });
    modal.querySelector('#evalLater')?.addEventListener('click', () => {
      sessionStorage.setItem(`bp_eval_skip_${projectId}`, '1');
      modal.remove();
    });
    modal.querySelector('#evalSubmit')?.addEventListener('click', async () => {
      if (!selected) return;
      const comment = document.getElementById('evalComment')?.value?.trim() || '';
      const r = await window.builderAuth.fetch(`/api/builder-projects/${projectId}/evaluation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rating: selected, comment }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        alert(j.error || 'Could not save feedback');
        return;
      }
      modal.remove();
      const reviewUrl = j.data?.google_review_url || googleReviewUrl;
      if (reviewUrl && confirm('Thank you! Would you like to leave a Google review for Senior Floors?')) {
        window.open(reviewUrl, '_blank', 'noopener');
      }
    });
  }

  async function maybeShowEvaluationModal() {
    const p = state?.project;
    if (!p || !['completed', 'closed'].includes(String(p.status || '').toLowerCase())) return;
    if (sessionStorage.getItem(`bp_eval_skip_${projectId}`)) return;
    try {
      const r = await window.builderAuth.fetch(`/api/builder-projects/${projectId}/evaluation`);
      const j = await r.json();
      if (!j.success || !j.data?.eligible || j.data?.submitted) return;
      openEvaluationModal(j.data.google_review_url);
    } catch (_) {}
  }

  async function toggleChecklist(itemId, checked) {
    const r = await window.builderAuth.fetch(`/api/builder-projects/${projectId}/checklist/${itemId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ checked }),
    });
    const j = await r.json();
    if (!r.ok) {
      alert(j.error || 'Could not update');
      await load();
      return;
    }
    await load();
    activeTab = 'checklist';
    render();
  }

  if (!projectId) {
    if (app) app.textContent = 'Invalid project';
  } else {
    document.addEventListener('DOMContentLoaded', () => {
      const boot = window.builderPortalCommon?.whenPortalReady;
      const run = () => {
        if (window.builderAuth?.getToken()) load();
        else location.href = 'builder-login.html';
      };
      if (boot) boot().then((ok) => ok && run());
      else setTimeout(run, 100);
    });
  }
})();
