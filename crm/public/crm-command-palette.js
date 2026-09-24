/**
 * Command palette — Ctrl+K / Cmd+K (dashboard)
 */
(function () {
  const ACTIONS = [
    { id: 'dash', label: 'Dashboard', sub: 'Pipeline e visão geral', href: 'pipeline-lab.html', perm: null },
    { id: 'leads', label: 'Leads', sub: 'Kanban / pipeline', href: 'leads.html', perm: 'leads.view' },
    { id: 'quotes', label: 'Quotes', sub: 'Orçamentos', href: 'quotes.html', perm: 'quotes.view' },
    { id: 'invoices', label: 'Invoices', sub: 'Faturas', href: 'invoices.html', perm: 'quotes.view' },
    { id: 'clients', label: 'Clientes', sub: 'Cadastro', href: 'dashboard.html?page=customers', perm: 'customers.view' },
    { id: 'cat', label: 'Catálogo de serviços', sub: 'Cadastro', href: 'quote-catalog.html', perm: 'quotes.edit' },
    { id: 'products', label: 'Produtos', sub: 'Cadastro', href: 'products-erp.html', perm: 'quotes.view' },
    { id: 'pricing', label: 'Tabela de Valores', sub: '', href: 'builder-pricing-admin.html', perm: 'builders.view' },
    { id: 'schedule', label: 'Schedule', sub: 'Calendário de jobs e meetings', href: 'schedule.html', perm: 'schedule.view' },
    { id: 'jobs', label: 'Jobs', sub: 'Work orders / trabalhos', href: 'jobs.html', perm: 'work_orders.view' },
    { id: 'payroll', label: 'Folha de pagamento', sub: '', href: 'payroll-module.html', perm: 'payroll.view' },
    { id: 'ajustes', label: 'Ajustes', sub: 'Logo e cores', href: 'ajustes.html', perm: 'settings.manage' },
    { id: 'support', label: 'Ajuda / suporte', sub: 'Help center e contato', href: '#help', perm: null },
    { id: 'install', label: 'Instalar app', sub: 'Baixar no dispositivo', href: '#pwa-install', perm: null },
    { id: 'users', label: 'Equipe', sub: 'Utilizadores e permissões', href: 'dashboard.html?page=users', perm: 'users.view' },
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

  window.openCrmCommandPalette = openPalette;

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
        close();
        if (h === '#pwa-install') {
          if (typeof window.openCrmPwaInstall === 'function') window.openCrmPwaInstall();
          return;
        }
        if (h === '#help') {
          if (window.__crmHelpPanel && typeof window.__crmHelpPanel.open === 'function') {
            window.__crmHelpPanel.open();
          }
          return;
        }
        if (h) window.location.href = h;
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
