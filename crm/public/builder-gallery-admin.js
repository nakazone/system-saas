/**
 * CRM admin — manage inspiration gallery (builders see published projects only).
 */
/* global crmNotify */
(function () {
  const $ = (id) => document.getElementById(id);

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function materialsToText(m) {
    if (!m) return '';
    if (Array.isArray(m)) return m.join(', ');
    return String(m);
  }

  async function fetchList(url) {
    const r = await fetch(url, { credentials: 'include' });
    const j = await r.json();
    if (!r.ok || !j.success) throw new Error(j.error || 'Error');
    return j.data || [];
  }

  function renderGrid(items, host) {
    if (!items.length) {
      host.innerHTML =
        '<p class="bp-card">Nenhum projeto na galeria. Clique em <strong>+ Novo projeto</strong>, adicione fotos e defina status <strong>Publicado</strong>.</p>';
      return;
    }
    host.innerHTML = items
      .map(
        (g) => `<article class="bp-gallery-card" data-id="${g.id}">
          <div class="bp-gallery-card__img" style="background-image:url('${escapeHtml(g.cover_url || g.cover_after || '')}')"></div>
          <div class="bp-gallery-card__body">
            <span class="bp-badge bp-badge--${g.status === 'featured' ? 'active' : 'pending'}">${escapeHtml(g.status)}</span>
            <h3>${escapeHtml(g.title)}</h3>
            <p class="bp-muted">${escapeHtml(g.floor_type || '')}${g.area_sqft ? ' - ' + g.area_sqft + ' sq ft' : ''}${g.region ? ' - ' + escapeHtml(g.region) : ''}</p>
            <button type="button" class="bp-btn-tan bp-btn-sm" data-edit="${g.id}">Editar</button>
          </div>
        </article>`
      )
      .join('');
    host.querySelectorAll('[data-edit]').forEach((b) => {
      b.addEventListener('click', () => openEdit(b.dataset.edit));
    });
  }

  async function openEdit(id) {
    const r = await fetch(`/api/gallery/${id}`, { credentials: 'include' });
    const j = await r.json();
    if (!j.success) return;
    const g = j.data.project;
    const photos = j.data.photos || [];
    $('galleryModal').classList.add('open');
    $('modalContent').innerHTML = `
      <h2 class="bp-title">${escapeHtml(g.title)}</h2>
      <form id="galleryForm" class="bp-form-grid">
        <div class="bp-form-full"><label>Titulo</label><input name="title" value="${escapeHtml(g.title)}" required /></div>
        <div class="bp-form-full"><label>Descricao</label><textarea name="description" rows="3">${escapeHtml(g.description || '')}</textarea></div>
        <div><label>Tipo de piso</label>
          <select name="floor_type">
            <option value="">—</option>
            <option value="hardwood">Hardwood</option>
            <option value="engineered">Engineered</option>
            <option value="lvp">LVP</option>
            <option value="tile">Tile</option>
            <option value="custom">Custom</option>
            <option value="stairs">Stairs</option>
          </select>
        </div>
        <div><label>Regiao</label><input name="region" value="${escapeHtml(g.region || '')}" placeholder="Denver, Boulder..." /></div>
        <div><label>Area (sq ft)</label><input name="area_sqft" type="number" min="0" value="${g.area_sqft || ''}" /></div>
        <div><label>Ano</label><input name="year" type="number" value="${g.year || new Date().getFullYear()}" /></div>
        <div><label>Status</label>
          <select name="status">
            <option value="draft">Rascunho</option>
            <option value="published">Publicado</option>
            <option value="featured">Destaque</option>
          </select>
        </div>
        <div class="bp-form-full"><label>Materiais (separados por virgula)</label>
          <input name="materials_text" value="${escapeHtml(materialsToText(g.materials))}" placeholder="Oak 3/4, Bona seal, ..." />
        </div>
        <div class="bp-form-full">
          <label>Upload foto</label>
          <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center">
            <input type="file" id="galleryPhotoFile" accept="image/jpeg,image/png,image/webp" />
            <select id="galleryPhotoPhase">
              <option value="before">Antes</option>
              <option value="during">Durante</option>
              <option value="after" selected>Depois</option>
            </select>
            <button type="button" class="bp-btn-tan bp-btn-sm" id="btnUploadPhoto">Enviar foto</button>
          </div>
        </div>
        <div class="bp-form-full bp-photo-grid bp-photo-grid--admin">${photos
          .map(
            (p) =>
              `<figure class="bp-photo-thumb"><img src="${escapeHtml(p.url)}" alt="" /><figcaption>${escapeHtml(p.phase)}</figcaption></figure>`
          )
          .join('')}</div>
        <div class="bp-form-full" style="display:flex;gap:8px">
          <button type="submit" class="bp-btn-tan">Salvar</button>
          <button type="button" class="bp-btn-ghost" id="btnCloseGalleryModal">Fechar</button>
        </div>
      </form>`;
    const ft = $('galleryForm').querySelector('[name=floor_type]');
    if (ft) ft.value = g.floor_type || '';
    $('galleryForm').querySelector('[name=status]').value = g.status || 'draft';
    $('btnCloseGalleryModal')?.addEventListener('click', () => $('galleryModal').classList.remove('open'));
    $('galleryForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const mats = String(fd.get('materials_text') || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const body = {
        title: fd.get('title'),
        description: fd.get('description'),
        floor_type: fd.get('floor_type'),
        region: fd.get('region'),
        area_sqft: fd.get('area_sqft') ? Number(fd.get('area_sqft')) : null,
        year: fd.get('year') ? Number(fd.get('year')) : null,
        status: fd.get('status'),
        materials: mats,
      };
      await fetch(`/api/gallery/${id}`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      crmNotify('Salvo. Builders veem projetos Publicado/Destaque no portal.', 'success');
      $('galleryModal').classList.remove('open');
      loadAdmin();
    });
    $('btnUploadPhoto')?.addEventListener('click', async () => {
      const file = $('galleryPhotoFile').files[0];
      if (!file) return;
      const fd = new FormData();
      fd.append('file', file);
      fd.append('phase', $('galleryPhotoPhase')?.value || 'after');
      const ur = await fetch(`/api/gallery/${id}/photos`, { method: 'POST', credentials: 'include', body: fd });
      if (ur.ok) {
        crmNotify('Foto enviada.', 'success');
        openEdit(id);
      } else {
        const j = await ur.json().catch(() => ({}));
        crmNotify(j.error || 'Falha no upload', 'error');
      }
    });
  }

  async function loadAdmin() {
    const st = $('filterStatus').value;
    const url = st ? `/api/gallery?status=${encodeURIComponent(st)}` : '/api/gallery';
    const items = await fetchList(url);
    renderGrid(items, $('galleryGrid'));
  }

  async function init() {
    const sess = await fetch('/api/auth/session', { credentials: 'include' }).then((r) => r.json());
    if (!sess.authenticated) {
      location.href = 'login.html?return=' + encodeURIComponent(location.pathname);
      return;
    }
    $('filterStatus')?.addEventListener('change', loadAdmin);
    $('btnNewGallery')?.addEventListener('click', async () => {
      const r = await fetch('/api/gallery', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Novo projeto', status: 'draft', floor_type: 'hardwood' }),
      });
      const j = await r.json();
      if (j.success) openEdit(j.data.id);
      else crmNotify(j.error || 'Erro', 'error');
    });
    await loadAdmin();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
