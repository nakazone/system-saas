/**
 * Menu CRM padrão (mesma estrutura, grupos e ícones que dashboard.html) em páginas standalone.
 * Respeita permissões via GET /api/auth/session.
 */
(function () {
  const ICONS = {
    dashboard:
      '<svg class="nav-icon-svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" aria-hidden="true"><path d="M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z"/></svg>',
    marketing:
      '<svg class="nav-icon-svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" aria-hidden="true"><path d="M3 11v2a1 1 0 001 1h2l4 9V4L6 11H4a1 1 0 00-1 1z"/><path d="M16 9a4 4 0 010 8"/><path d="M19 6a8 8 0 010 12"/></svg>',
    leads:
      '<svg class="nav-icon-svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" aria-hidden="true"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2"/><path d="M9 5a2 2 0 012-2h2a2 2 0 012 2v0a2 2 0 01-2 2H9a2 2 0 01-2-2v0z"/><path d="M9 12h6"/><path d="M9 16h6"/></svg>',
    crm:
      '<svg class="nav-icon-svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" aria-hidden="true"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>',
    customers:
      '<svg class="nav-icon-svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" aria-hidden="true"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>',
    quotes:
      '<svg class="nav-icon-svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" aria-hidden="true"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6"/><path d="M16 13H8"/><path d="M16 17H8"/><path d="M10 9H8"/></svg>',
    schedule:
      '<svg class="nav-icon-svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4"/><path d="M8 2v4"/><path d="M3 10h18"/></svg>',
    projects:
      '<svg class="nav-icon-svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" aria-hidden="true"><path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z"/><path d="M5 3l4 4"/></svg>',
    financial:
      '<svg class="nav-icon-svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" aria-hidden="true"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>',
    payroll:
      '<svg class="nav-icon-svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" aria-hidden="true"><path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>',
    activities:
      '<svg class="nav-icon-svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>',
    users:
      '<svg class="nav-icon-svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" aria-hidden="true"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
  };

  const CADASTRO_CHILDREN = [
    { href: 'products-erp.html', label: 'Produtos', perm: 'quotes.view', page: '', iconKey: 'quotes' },
    { href: 'financial.html#vendors', label: 'Fornecedores', perm: 'contracts.view', page: '', iconKey: 'financial' },
    { href: 'quote-catalog.html', label: 'Serviços', perm: 'quotes.edit', page: '', iconKey: 'quotes' },
    { href: 'dashboard.html?page=customers', label: 'Clientes', perm: 'customers.view', page: 'customers', iconKey: 'customers' },
    {
      href: 'dashboard.html?page=customers&type=builder',
      label: 'Builders',
      perm: 'customers.view',
      page: 'customers',
      iconKey: 'customers',
      customerType: 'builder',
    },
    { href: 'financial.html#notas-recibos', label: 'Notas / recibos', perm: 'contracts.view', page: '', iconKey: 'financial' },
    { href: 'financial.html#recebimentos', label: 'Recebimentos', perm: 'contracts.view', page: '', iconKey: 'financial' },
  ];

  /** Grupos alinhados a dashboard.html */
  const SIDEBAR_GROUPS = [
    {
      label: null,
      items: [
        { href: 'dashboard.html', label: 'Dashboard', perm: null, page: '', iconKey: 'dashboard' },
      ],
    },
    {
      label: 'Comercial',
      items: [
        { href: 'marketing.html', label: 'Marketing', perm: 'reports.view', page: '', iconKey: 'marketing' },
        { href: 'dashboard.html?page=leads', label: 'Leads', perm: 'leads.view', page: 'leads', iconKey: 'leads' },
      ],
    },
    {
      label: 'Operações',
      items: [
        { href: 'dashboard.html?page=quotes', label: 'Quotes', perm: 'quotes.view', page: 'quotes', iconKey: 'quotes' },
        { href: 'dashboard.html?page=invoices', label: 'Invoices', perm: 'quotes.view', page: 'invoices', iconKey: 'quotes' },
        { href: 'dashboard.html?page=schedule', label: 'Schedule', perm: 'visits.view', page: 'schedule', iconKey: 'schedule' },
        { href: 'projects.html', label: 'Projetos', perm: 'projects.view', page: '', iconKey: 'projects' },
        {
          href: 'builder-payments-forecast.html',
          label: 'Previsão builders',
          perm: 'projects.view',
          page: '',
          iconKey: 'projects',
        },
        { type: 'dropdown', label: 'Cadastro', perm: null, iconKey: 'quotes', children: CADASTRO_CHILDREN },
      ],
    },
    {
      label: 'Builders',
      items: [
        { href: 'builders.html', label: 'Builders', perm: 'builders.view', page: '', iconKey: 'customers' },
        { href: 'builder-portal.html', label: 'Portal do Builder', perm: 'builders.view', page: '', iconKey: 'customers' },
        { href: 'projects.html?client_type=builder', label: 'Projetos Builders', perm: 'projects.view', page: '', iconKey: 'projects' },
        { href: 'builder-pricing-admin.html', label: 'Tabela de Valores', perm: 'builders.view', page: '', iconKey: 'quotes' },
        { href: 'builder-gallery-admin.html', label: 'Galeria de Projetos', perm: 'builders.view', page: '', iconKey: 'projects' },
        { href: 'builder-messages-admin.html', label: 'Mensagens', perm: 'builders.view', page: '', iconKey: 'activities' },
        {
          href: 'builder-estimate-requests.html',
          label: 'Pedidos estimativa',
          perm: 'builders.view',
          page: '',
          iconKey: 'leads',
        },
      ],
    },
    {
      label: 'Financeiro & registo',
      items: [
        { href: 'financial.html', label: 'Financeiro', perm: 'contracts.view', page: '', iconKey: 'financial' },
        { href: 'payroll-module.html', label: 'Folha de pagamento', perm: 'payroll.view', page: '', iconKey: 'payroll' },
        { href: 'dashboard.html?page=activities', label: 'Activities', perm: 'activities.view', page: 'activities', iconKey: 'activities' },
      ],
    },
    {
      label: 'Sistema',
      items: [{ href: 'dashboard.html?page=users', label: 'Users', perm: 'users.view', page: 'users', iconKey: 'users' }],
    },
  ];

  const MAIN_NAV = SIDEBAR_GROUPS.flatMap((g) => g.items).filter(
    (item) => item.showInTopBar !== false && item.type !== 'dropdown'
  );

  /** Só na barra horizontal (páginas sem sidebar); não aparece no menu lateral fixo. */
  const TOOL_NAV = [
    { href: 'quote-builder.html', label: 'Novo orçamento', perm: 'quotes.edit' },
    { href: 'onsite-quote.html', label: 'Quick quote', perm: 'quotes.create' },
    { href: 'estimate-builder.html', label: 'Estimate', perm: 'quotes.view' },
    { href: 'estimate-analytics.html', label: 'Est. analytics', perm: 'quotes.view' },
  ];

  function currentFile() {
    const p = (window.location.pathname || '').split('/').pop() || '';
    return p.toLowerCase();
  }

  function pageParam() {
    return new URLSearchParams(window.location.search).get('page') || '';
  }

  function linkActive(item, file, page) {
    const h = item.href || '';
    const pathAndQuery = h.split('#')[0];
    const wantHash = (h.split('#')[1] || '').toLowerCase();
    const base = pathAndQuery.split('?')[0].split('/').pop().toLowerCase();

    if (base === 'financial.html' && file === 'financial.html') {
      const curHash = (location.hash || '').replace(/^#/, '').toLowerCase();
      if (wantHash) return curHash === wantHash;
      return !curHash;
    }

    if (file === 'lead-detail.html') {
      return base === 'dashboard.html' && (item.page || '') === 'leads';
    }
    if (file === 'quote-builder.html') {
      if ((item.page || '') === 'quotes') return true;
      if (base === 'quote-builder.html') return true;
    }
    if (base === 'marketing.html') {
      return file === 'marketing.html';
    }
    if (base === 'projects.html') {
      return file === 'projects.html';
    }
    if (base === 'builder-payments-forecast.html') {
      return file === 'builder-payments-forecast.html';
    }
    if (base === 'builders.html') return file === 'builders.html';
    if (base === 'builder-detail.html') return file === 'builder-detail.html';
    if (base === 'builder-pricing-admin.html') return file === 'builder-pricing-admin.html';
    if (base === 'builder-gallery-admin.html') return file === 'builder-gallery-admin.html';
    if (base === 'builder-messages-admin.html') return file === 'builder-messages-admin.html';
    if (base === 'builder-portal.html') return file === 'builder-portal.html';
    if (base === 'builder-estimate-requests.html') return file === 'builder-estimate-requests.html';
    if (base === 'builder-calculator.html') return file === 'builder-calculator.html';
    if (pathAndQuery.indexOf('dashboard.html') >= 0 || base === 'dashboard.html') {
      if (file !== 'dashboard.html') return false;
      const expected = item.page || '';
      if ((page || '') !== expected) return false;
      const q = pathAndQuery.includes('?') ? pathAndQuery.split('?')[1] : '';
      const wantType = new URLSearchParams(q).get('type') || item.customerType || '';
      const curType = new URLSearchParams(window.location.search).get('type') || '';
      if (wantType) return curType === wantType;
      if (curType === 'builder' && expected === 'customers') return false;
      return true;
    }
    const toolFile = pathAndQuery.split('?')[0].split('/').pop().toLowerCase();
    return file === toolFile;
  }

  function canSee(perm, role, keys) {
    if (!perm) return true;
    if (role === 'admin') return true;
    return keys.has(perm);
  }

  function createSidebarLink(item, file, page) {
    const a = document.createElement('a');
    a.href = item.href;
    a.className = 'nav-item' + (linkActive(item, file, page) ? ' active' : '');
    if (item.perm) a.setAttribute('data-crm-permission', item.perm);
    const tpl = document.createElement('template');
    tpl.innerHTML = ICONS[item.iconKey].trim();
    a.appendChild(tpl.content);
    a.appendChild(document.createTextNode(item.label));
    return a;
  }

  function createSidebarCadastroDropdown(item, children, file, page, role, keys) {
    const kids = children.filter((ch) => canSee(ch.perm, role, keys));
    if (kids.length === 0) return null;
    const anyActive = kids.some((ch) => linkActive(ch, file, page));
    const det = document.createElement('details');
    det.className = 'sidebar-nav-dropdown';
    if (anyActive) det.setAttribute('open', '');
    const sum = document.createElement('summary');
    sum.className = 'nav-item nav-item--dropdown' + (anyActive ? ' active' : '');
    const stpl = document.createElement('template');
    stpl.innerHTML = ICONS[item.iconKey].trim();
    sum.appendChild(stpl.content);
    sum.appendChild(document.createTextNode(item.label));
    const panel = document.createElement('div');
    panel.className = 'sidebar-nav-dropdown__panel';
    kids.forEach((ch) => {
      const sub = createSidebarLink(ch, file, page);
      sub.classList.add('nav-item--sub');
      panel.appendChild(sub);
    });
    det.appendChild(sum);
    det.appendChild(panel);
    return det;
  }

  function mountSidebarNav(host, perms, role) {
    const keys = new Set(perms);
    const file = currentFile();
    const page = pageParam();
    SIDEBAR_GROUPS.forEach((group) => {
      const visible = group.items.filter((item) => {
        if (item.type === 'dropdown' && Array.isArray(item.children)) {
          return item.children.some((ch) => canSee(ch.perm, role, keys));
        }
        return canSee(item.perm, role, keys);
      });
      if (visible.length === 0) return;
      const wrap = document.createElement('div');
      wrap.className = 'sidebar-nav-group';
      if (group.label) {
        const lab = document.createElement('p');
        lab.className = 'sidebar-nav-group-label';
        lab.textContent = group.label;
        wrap.appendChild(lab);
      }
      visible.forEach((item) => {
        if (item.type === 'dropdown' && Array.isArray(item.children)) {
          const dd = createSidebarCadastroDropdown(item, item.children, file, page, role, keys);
          if (dd) wrap.appendChild(dd);
          return;
        }
        wrap.appendChild(createSidebarLink(item, file, page));
      });
      host.appendChild(wrap);
    });
  }

  function appendTopBarCadastroDropdown(inner, keys, role, file, page) {
    const kids = CADASTRO_CHILDREN.filter((ch) => canSee(ch.perm, role, keys));
    if (kids.length === 0) return;
    const sepCad = document.createElement('span');
    sepCad.className = 'crm-shared-nav__sep';
    sepCad.setAttribute('aria-hidden', 'true');
    inner.appendChild(sepCad);
    const anyActive = kids.some((ch) => linkActive(ch, file, page));
    const det = document.createElement('details');
    det.className = 'crm-shared-nav__dropdown';
    if (anyActive) det.setAttribute('open', '');
    const sum = document.createElement('summary');
    sum.className = 'crm-shared-nav__dropdown-toggle';
    if (anyActive) sum.classList.add('crm-shared-nav__dropdown-toggle--active');
    sum.textContent = 'Cadastro';
    const menu = document.createElement('div');
    menu.className = 'crm-shared-nav__dropdown-menu';
    menu.setAttribute('role', 'menu');
    kids.forEach((ch) => {
      const a = document.createElement('a');
      a.href = ch.href;
      a.className = 'crm-shared-nav__dropdown-link' + (linkActive(ch, file, page) ? ' crm-shared-nav__dropdown-link--active' : '');
      a.setAttribute('role', 'menuitem');
      a.textContent = ch.label;
      menu.appendChild(a);
    });
    det.appendChild(sum);
    det.appendChild(menu);
    inner.appendChild(det);
  }

  function initSidebarUserFooter(user, role) {
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn && !logoutBtn.dataset.crmNavBound) {
      logoutBtn.dataset.crmNavBound = '1';
      logoutBtn.addEventListener('click', async () => {
        try {
          await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
        } catch (_) {}
        window.location.href = 'login.html';
      });
    }
    const sn = document.getElementById('sidebarUserName');
    if (!sn || !user) return;
    const disp = (user.name && String(user.name).trim()) || user.email || 'Utilizador';
    sn.textContent = disp;
    const sr = document.getElementById('sidebarUserRole');
    if (sr) sr.textContent = role ? String(role) : '';
    const sa = document.getElementById('sidebarUserAvatar');
    if (sa) {
      const ch = disp.trim().charAt(0).toUpperCase();
      sa.textContent = ch && /[A-Z0-9]/.test(ch) ? ch : '?';
    }
  }

  async function init() {
    const host = document.getElementById('crmSharedNavRoot');
    if (!host) return;

    let user = null;
    let perms = [];
    let role = '';
    try {
      const r = await fetch('/api/auth/session', { credentials: 'include' });
      const j = await r.json();
      if (j.authenticated && j.user) {
        user = j.user;
        perms = Array.isArray(j.user.permissions) ? j.user.permissions : [];
        role = j.user.role || '';
      }
    } catch (_) {}

    const keys = new Set(perms);
    const file = currentFile();
    const page = pageParam();

    if (host.dataset.layout === 'sidebar') {
      mountSidebarNav(host, perms, role);
      initSidebarUserFooter(user, role);
      return;
    }

    const nav = document.createElement('nav');
    nav.className = 'crm-shared-nav';
    nav.setAttribute('aria-label', 'Navegação principal CRM');

    const inner = document.createElement('div');
    inner.className = 'crm-shared-nav__inner';

    const brand = document.createElement('a');
    brand.className = 'crm-shared-nav__brand crm-shared-nav__brand--logo-only';
    brand.href = 'dashboard.html';
    brand.setAttribute('aria-label', 'Senior Floors CRM — início');
    brand.innerHTML =
      '<img src="/assets/SeniorFloors.png" alt="" class="crm-shared-nav__brand-logo" width="64" height="64" onerror="this.style.display=\'none\'" />';
    inner.appendChild(brand);

    MAIN_NAV.forEach((item) => {
      if (!canSee(item.perm, role, keys)) return;
      const a = document.createElement('a');
      a.href = item.href;
      a.className = 'crm-shared-nav__link' + (linkActive(item, file, page) ? ' crm-shared-nav__link--active' : '');
      a.textContent = item.label;
      inner.appendChild(a);
    });

    appendTopBarCadastroDropdown(inner, keys, role, file, page);

    const sep = document.createElement('span');
    sep.className = 'crm-shared-nav__sep';
    sep.setAttribute('aria-hidden', 'true');
    inner.appendChild(sep);

    const lab = document.createElement('span');
    lab.className = 'crm-shared-nav__label crm-shared-nav__label--tools';
    lab.textContent = 'Ferramentas';
    inner.appendChild(lab);

    TOOL_NAV.forEach((item) => {
      if (!canSee(item.perm, role, keys)) return;
      const a = document.createElement('a');
      a.href = item.href;
      a.className = 'crm-shared-nav__link' + (linkActive(item, file, page) ? ' crm-shared-nav__link--active' : '');
      a.textContent = item.label;
      inner.appendChild(a);
    });

    const logout = document.createElement('button');
    logout.type = 'button';
    logout.className = 'crm-shared-nav__logout';
    logout.textContent = 'Sair';
    logout.addEventListener('click', async () => {
      try {
        await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
      } catch (_) {}
      window.location.href = 'login.html';
    });
    inner.appendChild(logout);

    nav.appendChild(inner);
    host.appendChild(nav);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
