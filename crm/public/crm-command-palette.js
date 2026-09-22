/**
 * Command palette — Ctrl+K / Cmd+K (dashboard)
 */
(function () {
  const ACTIONS = [
    { id: 'dash', label: 'Dashboard', sub: 'Visão geral', href: 'dashboard.html', perm: null },
    { id: 'leads', label: 'Leads', sub: 'Kanban / pipeline', href: 'dashboard.html?page=leads', perm: 'leads.view' },
    { id: 'quotes', label: 'Orçamentos', sub: 'Lista de quotes', href: 'dashboard.html?page=quotes', perm: 'quotes.view' },
    { id: 'newq', label: 'Novo orçamento', sub: 'Quote builder', href: 'quote-builder.html', perm: 'quotes.edit' },
    { id: 'onsite', label: 'Quick quote', sub: 'Field · 2 steps', href: 'onsite-quote.html', perm: 'quotes.create' },
    { id: 'cat', label: 'Catálogo de serviços', sub: '', href: 'quote-catalog.html', perm: 'quotes.edit' },
    { id: 'clients', label: 'Clientes', sub: '', href: 'dashboard.html?page=customers', perm: 'customers.view' },
    { id: 'proj', label: 'Projetos', sub: '', href: 'projects.html', perm: 'projects.view' },
    { id: 'sched', label: 'Agenda', sub: '', href: 'dashboard.html?page=schedule', perm: 'visits.view' },
  ];

  function can(perm) {
    if (!perm) return true;
    const role = window.__crmPaletteRole || '';
    const keys = window.__crmPalettePerms || [];
    if (role === 'admin') return true;
    return keys.includes(perm);
  }

  function filterActions(q) {
    const t = String(q || '')
      .trim()
      .toLowerCase();
    return ACTIONS.filter((a) => can(a.perm)).filter((a) => {
      if (!t) return true;
      return (
        a.label.toLowerCase().includes(t) ||
        (a.sub && a.sub.toLowerCase().includes(t)) ||
        a.id.includes(t)
      );
    });
  }

  function close() {
    const root = document.getElementById('crmCmdPalette');
    if (!root) return;
    root.classList.remove('crm-cmd-palette--open');
    root.setAttribute('aria-hidden', 'true');
  }

  function openPalette() {
    const root = document.getElementById('crmCmdPalette');
    const input = document.getElementById('crmCmdPaletteInput');
    const list = document.getElementById('crmCmdPaletteList');
    if (!root || !input || !list) return;
    root.classList.add('crm-cmd-palette--open');
    root.setAttribute('aria-hidden', 'false');
    input.value = '';
    renderList('');
    input.focus();
  }

  function renderList(q) {
    const list = document.getElementById('crmCmdPaletteList');
    if (!list) return;
    const items = filterActions(q);
    if (!items.length) {
      list.innerHTML = '<div class="crm-cmd-palette__empty">Sem resultados</div>';
      return;
    }
    list.innerHTML = items
      .map(
        (a) =>
          `<button type="button" class="crm-cmd-palette__item" data-href="${a.href.replace(/"/g, '&quot;')}"><strong>${a.label}</strong>${a.sub ? `<span>${a.sub}</span>` : ''}</button>`
      )
      .join('');
    list.querySelectorAll('.crm-cmd-palette__item').forEach((btn) => {
      btn.addEventListener('click', () => {
        const h = btn.getAttribute('data-href');
        if (h) window.location.href = h;
        close();
      });
    });
  }

  function init() {
    const root = document.getElementById('crmCmdPalette');
    if (!root) return;

    root.addEventListener('click', (e) => {
      if (e.target === root) close();
    });

    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        if (root.classList.contains('crm-cmd-palette--open')) close();
        else openPalette();
      }
      if (e.key === 'Escape' && root.classList.contains('crm-cmd-palette--open')) {
        e.preventDefault();
        close();
      }
    });

    const input = document.getElementById('crmCmdPaletteInput');
    if (input) {
      input.addEventListener('input', () => renderList(input.value));
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
