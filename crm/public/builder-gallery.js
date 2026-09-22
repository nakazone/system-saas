/**
 * Builder portal ù project gallery (read-only inspiration).
 */
(function () {
  const $ = (id) => document.getElementById(id);

  const FLOOR_PILLS = [
    { key: '', label: 'All' },
    { key: 'hardwood', label: 'Hardwood' },
    { key: 'engineered', label: 'Engineered' },
    { key: 'lvp', label: 'LVP' },
    { key: 'tile', label: 'Tile' },
    { key: 'custom', label: 'Custom' },
    { key: 'stairs', label: 'Stairs' },
  ];

  const PHASE_PILLS = [
    { key: '', label: 'All phases' },
    { key: 'before', label: 'Before' },
    { key: 'during', label: 'During' },
    { key: 'after', label: 'After' },
  ];

  let portalItems = [];
  let portalFilter = { floor: '', region: '', phase: '', q: '' };
  let lightboxState = { photos: [], index: 0, project: null };

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function floorLabel(key) {
    const p = FLOOR_PILLS.find((x) => x.key === key);
    return p ? p.label : key || '';
  }

  function estimateUrl(item) {
    const params = new URLSearchParams();
    if (item.floor_type) params.set('floor', item.floor_type);
    if (item.area_sqft) params.set('sqft', item.area_sqft);
    params.set('from_gallery', String(item.id));
    return `builder-estimate-request.html?${params.toString()}`;
  }

  function bindBaSlider(root) {
    root.querySelectorAll('.bp-ba-slider__input').forEach((range) => {
      const wrap = range.closest('.bp-ba-slider')?.querySelector('.bp-ba-slider__after-wrap');
      if (!wrap) return;
      const apply = () => {
        wrap.style.width = `${range.value}%`;
      };
      apply();
      range.addEventListener('input', apply);
    });
  }

  function cardHtml(g) {
    const imgAfter = g.cover_after || g.cover_url || '';
    const imgBefore = g.cover_before || '';
    const hasBa = imgBefore && (g.cover_after || g.cover_url);
    const baBlock = hasBa
      ? `<div class="bp-card-ba hidden" data-card-ba="${g.id}">
          <div class="bp-ba-slider bp-ba-slider--card">
            <img src="${escapeHtml(imgBefore)}" alt="Before" class="bp-ba-slider__before" loading="lazy" />
            <div class="bp-ba-slider__after-wrap" style="width:50%">
              <img src="${escapeHtml(imgAfter)}" alt="After" class="bp-ba-slider__after" loading="lazy" />
            </div>
            <input type="range" min="0" max="100" value="50" class="bp-ba-slider__input" aria-label="Compare before and after" />
          </div>
        </div>`
      : '';
    const baBtn = hasBa
      ? `<button type="button" class="bp-card-ba-toggle" data-ba-toggle="${g.id}">Before/After</button>`
      : '';
    return `<article class="bp-gallery-card bp-gallery-card--click" data-id="${g.id}" tabindex="0">
      <div class="bp-gallery-card__img-wrap">
        <div class="bp-gallery-card__img" data-card-cover="${g.id}" style="background-image:url('${escapeHtml(imgAfter || imgBefore)}')"></div>
        ${baBlock}
        ${baBtn}
        ${hasBa ? '<span class="bp-gallery-card__ba-tag">Before/After</span>' : ''}
      </div>
      <div class="bp-gallery-card__body">
        <h3>${escapeHtml(g.title)}</h3>
        <p class="bp-muted">${escapeHtml(floorLabel(g.floor_type) || g.floor_type || '')}${g.area_sqft ? ' - ' + g.area_sqft + ' sq ft' : ''}${g.region ? ' - ' + escapeHtml(g.region) : ''}</p>
      </div>
    </article>`;
  }

  function renderPortalGrid(items, host) {
    if (!items.length) {
      host.innerHTML =
        '<p class="bp-card">No published projects yet. Our team is adding inspiration photos ù check back soon.</p>';
      return;
    }
    host.innerHTML = items.map(cardHtml).join('');
    host.querySelectorAll('[data-ba-toggle]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.dataset.baToggle;
        const cover = host.querySelector(`[data-card-cover="${id}"]`);
        const ba = host.querySelector(`[data-card-ba="${id}"]`);
        if (!cover || !ba) return;
        const on = ba.classList.toggle('hidden');
        btn.classList.toggle('active', !on);
        cover.classList.toggle('hidden', !on);
        if (!on) bindBaSlider(ba);
      });
    });
    host.querySelectorAll('.bp-gallery-card--click').forEach((card) => {
      const open = () => {
        const id = parseInt(card.dataset.id, 10);
        const item = portalItems.find((x) => x.id === id);
        if (item) openLightbox(item);
      };
      card.addEventListener('click', (e) => {
        if (e.target.closest('.bp-card-ba-toggle') || e.target.closest('.bp-ba-slider')) return;
        open();
      });
      card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') open();
      });
    });
  }

  function applyPortalFilters() {
    let list = portalItems;
    if (portalFilter.floor) {
      const f = portalFilter.floor.toLowerCase();
      list = list.filter((g) => String(g.floor_type || '').toLowerCase().includes(f));
    }
    if (portalFilter.region) {
      list = list.filter((g) => String(g.region || '') === portalFilter.region);
    }
    if (portalFilter.phase === 'before') list = list.filter((g) => g.has_before);
    if (portalFilter.phase === 'during') list = list.filter((g) => g.has_during);
    if (portalFilter.phase === 'after') list = list.filter((g) => g.has_after);
    renderPortalGrid(list, $('pg'));
  }

  function materialsHtml(materials) {
    const list = Array.isArray(materials) ? materials : [];
    if (!list.length) return '';
    return `<div class="bp-lightbox__materials"><h3 class="bp-lightbox__subtitle">Materials used</h3><ul>${list
      .map((m) => `<li>${escapeHtml(m)}</li>`)
      .join('')}</ul></div>`;
  }

  function renderLightboxContent() {
    const lb = document.getElementById('bpGalleryLightbox');
    if (!lb) return;
    const g = lightboxState.project;
    const photos = lightboxState.photos;
    const idx = lightboxState.index;
    const cur = photos[idx];
    if (!g) return;

    const before = photos.find((p) => p.phase === 'before')?.url;
    const after = photos.find((p) => p.phase === 'after')?.url || photos.find((p) => p.phase === 'during')?.url;
    const hasCompare = before && after;

    let compareBlock = '';
    if (hasCompare) {
      compareBlock = `<div class="bp-ba-slider bp-ba-slider--lightbox" id="lbBaSlider">
        <img src="${escapeHtml(before)}" alt="Before" class="bp-ba-slider__before" />
        <div class="bp-ba-slider__after-wrap" style="width:50%">
          <img src="${escapeHtml(after)}" alt="After" class="bp-ba-slider__after" />
        </div>
        <input type="range" min="0" max="100" value="50" class="bp-ba-slider__input" id="lbBaRange" />
        <span class="bp-ba-slider__labels"><span>Before</span><span>After</span></span>
      </div>`;
    }

    const mainImg = cur
      ? `<div class="bp-lightbox__stage">
          <button type="button" class="bp-lightbox__arrow bp-lightbox__arrow--prev" id="lbPrev" aria-label="Previous photo"${photos.length < 2 ? ' disabled' : ''}>&#8249;</button>
          <img src="${escapeHtml(cur.url)}" alt="" class="bp-lightbox__hero" id="lbHero" />
          <button type="button" class="bp-lightbox__arrow bp-lightbox__arrow--next" id="lbNext" aria-label="Next photo"${photos.length < 2 ? ' disabled' : ''}>&#8250;</button>
          <p class="bp-lightbox__caption">${escapeHtml(cur.caption || '')} <span class="bp-muted">(${escapeHtml(cur.phase || '')}) ${idx + 1}/${photos.length}</span></p>
        </div>`
      : '<p class="bp-muted">No photos for this project.</p>';

    const thumbs = photos.length
      ? `<div class="bp-lightbox__thumbs">${photos
          .map(
            (p, i) =>
              `<button type="button" class="bp-lightbox__thumb${i === idx ? ' active' : ''}" data-thumb="${i}"><img src="${escapeHtml(p.url)}" alt="" /></button>`
          )
          .join('')}</div>`
      : '';

    lb.innerHTML = `
      <div class="bp-lightbox__inner">
        <button type="button" class="bp-lightbox__close" id="lbClose" aria-label="Close">&times;</button>
        <h2 class="bp-title">${escapeHtml(g.title)}</h2>
        <p class="bp-muted">${escapeHtml(floorLabel(g.floor_type) || g.floor_type || '')}${g.area_sqft ? ' - ' + g.area_sqft + ' sq ft' : ''}${g.region ? ' - ' + escapeHtml(g.region) : ''}</p>
        <p class="bp-lightbox__desc">${escapeHtml(g.description || '')}</p>
        ${materialsHtml(g.materials)}
        ${compareBlock}
        ${mainImg}
        ${thumbs}
        <a href="${estimateUrl(g)}" class="bp-btn-tan bp-lightbox__cta">Want something similar - Request estimate</a>
      </div>`;

    document.getElementById('lbClose')?.addEventListener('click', () => lb.classList.remove('open'));
    lb.onclick = (e) => {
      if (e.target === lb) lb.classList.remove('open');
    };
    bindBaSlider(lb);
    document.getElementById('lbPrev')?.addEventListener('click', (e) => {
      e.stopPropagation();
      if (photos.length < 2) return;
      lightboxState.index = (idx - 1 + photos.length) % photos.length;
      renderLightboxContent();
    });
    document.getElementById('lbNext')?.addEventListener('click', (e) => {
      e.stopPropagation();
      if (photos.length < 2) return;
      lightboxState.index = (idx + 1) % photos.length;
      renderLightboxContent();
    });
    lb.querySelectorAll('[data-thumb]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        lightboxState.index = parseInt(btn.dataset.thumb, 10);
        renderLightboxContent();
      });
    });
  }

  function openLightbox(item) {
    let lb = document.getElementById('bpGalleryLightbox');
    if (!lb) {
      lb = document.createElement('div');
      lb.id = 'bpGalleryLightbox';
      lb.className = 'bp-lightbox';
      document.body.appendChild(lb);
    }
    lb.classList.add('open');
    lb.innerHTML = '<p class="bp-muted" style="padding:24px">Loading...</p>';

    const onKey = (e) => {
      if (!lb.classList.contains('open')) return;
      if (e.key === 'Escape') lb.classList.remove('open');
      if (e.key === 'ArrowLeft') document.getElementById('lbPrev')?.click();
      if (e.key === 'ArrowRight') document.getElementById('lbNext')?.click();
    };
    document.removeEventListener('keydown', lb._bpKeyHandler);
    lb._bpKeyHandler = onKey;
    document.addEventListener('keydown', onKey);

    window.builderAuth.fetch(`/api/gallery/partner/${item.id}`).then(async (r) => {
      const j = await r.json();
      if (!j.success) {
        lb.innerHTML = '<p class="bp-card">Could not load project.</p>';
        return;
      }
      lightboxState.project = j.data.project;
      lightboxState.photos = j.data.photos || [];
      lightboxState.index = 0;
      renderLightboxContent();
    });
  }

  async function loadPortalList() {
    const params = new URLSearchParams();
    if (portalFilter.q) params.set('q', portalFilter.q);
    if (portalFilter.phase) params.set('phase', portalFilter.phase);
    const url = `/api/gallery/partner${params.toString() ? `?${params}` : ''}`;
    const r = await window.builderAuth.fetch(url);
    const j = await r.json();
    if (!r.ok || !j.success) throw new Error(j.error || 'Error');
    portalItems = j.data || [];
    const regions = [...new Set(portalItems.map((g) => g.region).filter(Boolean))].sort();
    const regSel = $('filterRegion');
    if (regSel) {
      const cur = regSel.value;
      regSel.innerHTML = '<option value="">All regions</option>';
      regions.forEach((rgn) => {
        const o = document.createElement('option');
        o.value = rgn;
        o.textContent = rgn;
        regSel.appendChild(o);
      });
      regSel.value = cur;
    }
    applyPortalFilters();
  }

  function renderShell() {
    const host = $('portalGalleryRoot');
    const hdr =
      window.builderPortalCommon?.pageHeaderHtml?.({
        title: 'Project gallery',
        subtitle: 'Completed Senior Floors work for inspiration. Read-only.',
      }) || '<h1 class="bp-title">Project gallery</h1>';
    host.innerHTML = `${hdr}
      <div class="bp-toolbar bp-gallery-toolbar">
        <input type="search" id="gallerySearch" placeholder="Search by keyword..." class="bp-gallery-search" />
        <select id="filterRegion" class="bp-gallery-select"><option value="">All regions</option></select>
      </div>
      <p class="bp-filter-label">Floor type</p>
      <div class="bp-pills" id="floorPills"></div>
      <p class="bp-filter-label">Photo phase</p>
      <div class="bp-pills" id="phasePills"></div>
      <div class="bp-gallery-grid" id="pg"></div>`;

    $('floorPills').innerHTML = FLOOR_PILLS.map(
      (p) =>
        `<button type="button" class="bp-pill${portalFilter.floor === p.key ? ' active' : ''}" data-floor="${escapeHtml(p.key)}">${escapeHtml(p.label)}</button>`
    ).join('');
    $('floorPills').querySelectorAll('.bp-pill').forEach((btn) => {
      btn.addEventListener('click', () => {
        portalFilter.floor = btn.dataset.floor || '';
        $('floorPills').querySelectorAll('.bp-pill').forEach((b) => b.classList.toggle('active', b === btn));
        applyPortalFilters();
      });
    });

    $('phasePills').innerHTML = PHASE_PILLS.map(
      (p) =>
        `<button type="button" class="bp-pill${portalFilter.phase === p.key ? ' active' : ''}" data-phase="${escapeHtml(p.key)}">${escapeHtml(p.label)}</button>`
    ).join('');
    $('phasePills').querySelectorAll('.bp-pill').forEach((btn) => {
      btn.addEventListener('click', () => {
        portalFilter.phase = btn.dataset.phase || '';
        $('phasePills').querySelectorAll('.bp-pill').forEach((b) => b.classList.toggle('active', b === btn));
        loadPortalList();
      });
    });

    let searchTimer;
    $('gallerySearch')?.addEventListener('input', (e) => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        portalFilter.q = e.target.value.trim();
        loadPortalList();
      }, 300);
    });
    $('filterRegion')?.addEventListener('change', (e) => {
      portalFilter.region = e.target.value;
      applyPortalFilters();
    });
  }

  async function init() {
    const boot = window.builderPortalCommon?.whenPortalReady;
    const start = async () => {
      renderShell();
      await loadPortalList();
    };
    if (typeof boot === 'function') {
      const ok = await boot();
      if (ok) await start();
    } else if (window.builderAuth?.requireAuth?.()) {
      await start();
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
