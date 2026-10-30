/**
 * Job page › Builder: the channel with the builder who sent the job (updates, questions, photos, PDFs)
 * and whether every ObraCam photo of the job shows in the builder's portal.
 */
(function () {
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const when = (d) => {
    const x = new Date(d);
    if (Number.isNaN(x.getTime())) return '';
    const today = new Date();
    const same = x.toDateString() === today.toDateString();
    return same
      ? x.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
      : x.toLocaleString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  };
  async function api(url, opts) {
    const r = await fetch(url, { credentials: 'include', ...(opts || {}) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.success === false) throw new Error(j.error || 'Não foi possível concluir.');
    return j;
  }
  function shrink(file, max) {
    if (file.type === 'application/pdf') return new Promise((ok, bad) => { const fr = new FileReader(); fr.onload = () => ok({ name: file.name, data_url: fr.result }); fr.onerror = bad; fr.readAsDataURL(file); });
    return new Promise((ok, bad) => {
      const img = new Image(); const url = URL.createObjectURL(file);
      img.onload = () => {
        const s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
        const c = document.createElement('canvas'); c.width = Math.round(img.naturalWidth * s); c.height = Math.round(img.naturalHeight * s);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
        ok({ name: file.name.replace(/\.\w+$/, '') + '.jpg', data_url: c.toDataURL('image/jpeg', 0.85) });
      };
      img.onerror = () => { URL.revokeObjectURL(url); bad(new Error('Imagem inválida')); };
      img.src = url;
    });
  }

  const state = new Map(); // jobId → { data, files }

  function bubble(m) {
    const mine = m.side === 'company';
    const files = (m.files || []).map((f) => /^image\//.test(f.content_type)
      ? `<a class="bc-img" href="${esc(f.url)}" target="_blank" rel="noopener"><img src="${esc(f.url)}" alt="${esc(f.name)}" loading="lazy" /></a>`
      : `<a class="bc-file" href="${esc(f.url)}" target="_blank" rel="noopener"><i>PDF</i><span>${esc(f.name)}</span></a>`).join('');
    return `<li class="bc-msg ${mine ? 'is-mine' : ''}">
      <div class="bc-bub">${m.body ? `<p>${esc(m.body)}</p>` : ''}${files ? `<div class="bc-files">${files}</div>` : ''}</div>
      <small>${mine ? '' : `<b>${esc(m.author)}</b> · `}${mine ? `${esc(m.author)} · ` : ''}${esc(when(m.created_at))}</small>
    </li>`;
  }

  function paint(box, ctx) {
    const st = state.get(ctx.jobId); const d = st.data;
    const tabCount = document.getElementById('jdTabBuilder');
    if (tabCount) tabCount.textContent = d.messages.length ? String(d.messages.length) : '';
    if (!d.partner) { box.innerHTML = '<div class="jd-card"><p class="jd-empty">Este job não tem builder vinculado.</p></div>'; return; }
    box.innerHTML = `<div class="bc">
      <div class="jd-card bc-head">
        <div class="bc-who"><span class="bc-av">${esc(d.partner.name.replace(/^the\s+/i, '').split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase())}</span>
          <div><h2>${esc(d.partner.name)}</h2><p>${d.on_obrabuilder ? 'Recebe as mensagens e fotos no ObraBuilder, com aviso no celular.' : 'Este builder ainda não usa o ObraBuilder — as mensagens ficam guardadas aqui.'}</p></div></div>
        <label class="bc-share"><input type="checkbox" data-bc-share ${d.share_photos ? 'checked' : ''} ${ctx.canManage ? '' : 'disabled'} />
          <span><strong>Fotos do ObraCam visíveis para o builder</strong><small>${d.share_photos ? `Todas as ${d.photos} foto${d.photos === 1 ? '' : 's'} deste job aparecem no portal dele, e as novas também.` : 'Desligado: só as fotos marcadas uma a uma em Fotos.'}</small></span></label>
      </div>
      <div class="jd-card bc-thread">
        <div class="jd-ch"><h2>Mensagens com o builder</h2><span class="jd-ch__n">${d.messages.length || ''}</span></div>
        <ol class="bc-list" data-bc-list>${d.messages.length ? d.messages.map(bubble).join('') : '<li class="bc-none">Nenhuma mensagem ainda. Envie atualizações do job, dúvidas ou fotos — o builder recebe na hora.</li>'}</ol>
        <form class="bc-form" data-bc-form>
          <div class="bc-pending" data-bc-pending>${st.files.map((f, i) => `<span class="bc-chip">${/^data:image/.test(f.data_url) ? `<img src="${f.data_url}" alt="" />` : '<i>PDF</i>'}<button type="button" data-bc-rm="${i}" aria-label="Remover ${esc(f.name)}">×</button></span>`).join('')}</div>
          <div class="bc-compose">
            <label class="bc-attach" title="Anexar fotos ou PDF"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21.4 11.6l-8.8 8.8a5.5 5.5 0 01-7.8-7.8l8.8-8.8a3.7 3.7 0 015.2 5.2l-8.8 8.8a1.8 1.8 0 01-2.6-2.6l8.1-8.1"/></svg><span class="bc-sr">Anexar</span><input type="file" accept="image/*,application/pdf" multiple hidden data-bc-file /></label>
            <textarea data-bc-text data-crm-rich="off" rows="1" maxlength="4000" placeholder="Escreva uma atualização para o builder…"></textarea>
            <button type="submit" class="jd-btn jd-btn--pri bc-send">Enviar</button>
          </div>
        </form>
      </div>
    </div>`;
    const list = box.querySelector('[data-bc-list]'); if (list) list.scrollTop = list.scrollHeight;
    const ta = box.querySelector('[data-bc-text]');
    const grow = () => { ta.style.height = 'auto'; ta.style.height = `${Math.min(160, ta.scrollHeight)}px`; };
    ta.addEventListener('input', grow);
    ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) box.querySelector('[data-bc-form]').requestSubmit(); });
    box.querySelector('[data-bc-file]').addEventListener('change', async (e) => {
      for (const f of Array.from(e.target.files || [])) { if (st.files.length >= 6) break; try { st.files.push(await shrink(f, 1800)); } catch (_) { /* skip */ } }
      const keep = ta.value; paint(box, ctx); box.querySelector('[data-bc-text]').value = keep;
    });
    box.querySelectorAll('[data-bc-rm]').forEach((b) => b.addEventListener('click', () => { st.files.splice(Number(b.getAttribute('data-bc-rm')), 1); const keep = ta.value; paint(box, ctx); box.querySelector('[data-bc-text]').value = keep; }));
    box.querySelector('[data-bc-form]').addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = ta.value.trim();
      if (!body && !st.files.length) { ta.focus(); return; }
      const btn = box.querySelector('.bc-send'); btn.disabled = true; btn.textContent = 'Enviando…';
      try {
        const r = await api(`/api/work-orders/${encodeURIComponent(ctx.jobId)}/builder-channel`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body, files: st.files }) });
        d.messages.push(r.data); st.files = [];
        paint(box, ctx);
        if (ctx.notify) ctx.notify(d.on_obrabuilder ? 'Mensagem enviada — o builder foi avisado.' : 'Mensagem salva.');
      } catch (err) {
        btn.disabled = false; btn.textContent = 'Enviar';
        if (ctx.notify) ctx.notify(err.message, 'error');
      }
    });
    const share = box.querySelector('[data-bc-share]');
    share.addEventListener('change', async () => {
      try {
        await api(`/api/work-orders/${encodeURIComponent(ctx.jobId)}/builder-channel`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ share_photos: share.checked }) });
        d.share_photos = share.checked; paint(box, ctx);
        if (ctx.notify) ctx.notify(share.checked ? 'O builder vê as fotos do ObraCam deste job.' : 'Fotos do ObraCam ocultas para o builder.');
      } catch (err) { share.checked = !share.checked; if (ctx.notify) ctx.notify(err.message, 'error'); }
    });
  }

  async function mount(box, ctx) {
    if (!box) return;
    if (!state.has(ctx.jobId)) box.innerHTML = '<div class="jd-card"><p class="jd-empty">A carregar…</p></div>';
    try {
      const r = await api(`/api/work-orders/${encodeURIComponent(ctx.jobId)}/builder-channel`);
      const prev = state.get(ctx.jobId);
      state.set(ctx.jobId, { data: r.data, files: prev ? prev.files : [] });
      paint(box, ctx);
    } catch (err) {
      box.innerHTML = `<div class="jd-card"><p class="jd-empty">${esc(err.message)}</p></div>`;
    }
  }
  /** Count on the tab right after the page loads. */
  async function count(jobId) {
    try {
      const r = await api(`/api/work-orders/${encodeURIComponent(jobId)}/builder-channel`);
      const el = document.getElementById('jdTabBuilder');
      if (el) el.textContent = r.data.messages.length ? String(r.data.messages.length) : '';
    } catch (_) { /* optional */ }
  }

  window.JobBuilderChannel = { mount, count };
})();
