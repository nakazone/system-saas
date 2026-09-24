/**
 * Menu CRM padrão (mesma estrutura, grupos e ícones que dashboard.html) em páginas standalone.
 * Respeita permissões via GET /api/auth/session.
 * Apenas módulos padrão: Dashboard, Leads, Quotes, Invoices, Cadastro,
 * Schedule, Jobs, Tabela de Valores, Folha de Pagamento.
 */
(function () {
  // Shell may inject this script while the page also has a static <script> tag —
  // a second IIFE would race and duplicate sidebar groups.
  if (window.__crmSharedNav) return;

  const ICONS = {
    dashboard:
      '<svg class="nav-icon-svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" aria-hidden="true"><path d="M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z"/></svg>',
    leads:
      '<svg class="nav-icon-svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" aria-hidden="true"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2"/><path d="M9 5a2 2 0 012-2h2a2 2 0 012 2v0a2 2 0 01-2 2H9a2 2 0 01-2-2v0z"/><path d="M9 12h6"/><path d="M9 16h6"/></svg>',
    customers:
      '<svg class="nav-icon-svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" aria-hidden="true"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>',
    quotes:
      '<svg class="nav-icon-svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" aria-hidden="true"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6"/><path d="M16 13H8"/><path d="M16 17H8"/><path d="M10 9H8"/></svg>',
    schedule:
      '<svg class="nav-icon-svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4"/><path d="M8 2v4"/><path d="M3 10h18"/></svg>',
    jobs:
      '<svg class="nav-icon-svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" aria-hidden="true"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2"/><path d="M9 5a2 2 0 012-2h2a2 2 0 012 2v0a2 2 0 01-2 2H9a2 2 0 01-2-2v0z"/><path d="M9 12h6"/><path d="M9 16h4"/></svg>',
    payroll:
      '<svg class="nav-icon-svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" aria-hidden="true"><path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>',
    users:
      '<svg class="nav-icon-svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" aria-hidden="true"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
    settings:
      '<svg class="nav-icon-svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>',
  };

  const CADASTRO_CHILDREN = [
    { href: 'products-erp.html', label: 'Produtos', perm: 'quotes.view', page: '', iconKey: 'quotes' },
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
  ];

  /** Grupos alinhados a dashboard.html — só módulos padrão do sistema */
  const SIDEBAR_GROUPS = [
    {
      label: null,
      items: [
        { href: 'pipeline-lab.html', label: 'Dashboard', perm: null, page: '', iconKey: 'dashboard' },
      ],
    },
    {
      label: 'Comercial',
      items: [
        { href: 'leads.html', label: 'Leads', perm: 'leads.view', page: 'leads', iconKey: 'leads' },
      ],
    },
    {
      label: 'Operações',
      items: [
        { href: 'quotes.html', label: 'Quotes', perm: 'quotes.view', page: 'quotes', iconKey: 'quotes' },
        { href: 'invoices.html', label: 'Invoices', perm: 'quotes.view', page: 'invoices', iconKey: 'quotes' },
        { href: 'schedule.html', label: 'Schedule', perm: 'schedule.view', page: '', iconKey: 'schedule' },
        { href: 'jobs.html', label: 'Jobs', perm: 'work_orders.view', page: '', iconKey: 'jobs' },
        { type: 'dropdown', label: 'Cadastro', perm: null, iconKey: 'quotes', children: CADASTRO_CHILDREN },
        {
          href: 'builder-pricing-admin.html',
          label: 'Tabela de Valores',
          perm: 'builders.view',
          page: '',
          iconKey: 'quotes',
        },
        {
          href: 'payroll-module.html',
          label: 'Folha de Pagamento',
          perm: 'payroll.view',
          page: '',
          iconKey: 'payroll',
        },
      ],
    },
  ];

  const MAIN_NAV = SIDEBAR_GROUPS.flatMap((g) => g.items).filter(
    (item) => item.showInTopBar !== false && item.type !== 'dropdown'
  );

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
    const base = pathAndQuery.split('?')[0].split('/').pop().toLowerCase();

    if (file === 'lead-detail.html') {
      return base === 'leads.html' || ((item.page || '') === 'leads' && (base === 'leads.html' || base === 'dashboard.html'));
    }
    if (file === 'quote-builder.html') {
      if ((item.page || '') === 'quotes') return true;
      if (base === 'quote-builder.html' || base === 'quotes.html') return true;
    }
    if (base === 'pipeline-lab.html') {
      return file === 'pipeline-lab.html' || (file === 'dashboard.html' && !(page || ''));
    }
    if (base === 'leads.html') return file === 'leads.html' || file === 'lead-detail.html';
    if (base === 'quotes.html') return file === 'quotes.html' || file === 'quote-builder.html';
    if (base === 'invoices.html') return file === 'invoices.html';
    if (base === 'builder-pricing-admin.html') return file === 'builder-pricing-admin.html';
    if (base === 'payroll-module.html') return file === 'payroll-module.html';
    if (base === 'schedule.html') return file === 'schedule.html';
    if (base === 'jobs.html') return file === 'jobs.html' || file === 'job-detail.html';
    if (base === 'ajustes.html') return file === 'ajustes.html';
    if (base === 'products-erp.html') return file === 'products-erp.html';
    if (base === 'quote-catalog.html') return file === 'quote-catalog.html';
    if (pathAndQuery.indexOf('dashboard.html') >= 0 || base === 'dashboard.html') {
      if (file === 'pipeline-lab.html' && !(item.page || '')) return true;
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
    const onDashboard = file === 'dashboard.html';
    const isDashPage = (item.href || '').indexOf('dashboard.html') >= 0 && item.page != null && item.page !== undefined;
    // Soft-nav on dashboard SPA; real links everywhere else
    if (onDashboard && isDashPage) {
      a.href = '#';
      if (item.page) a.setAttribute('data-page', item.page);
      else a.setAttribute('data-page', 'dashboard');
    } else {
      a.href = item.href;
      if (item.page) a.setAttribute('data-page', item.page);
    }
    if (item.customerType) a.setAttribute('data-customers-type', item.customerType);
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

  let initInFlight = null;

  async function init() {
    const host = document.getElementById('crmSharedNavRoot');
    if (!host) return;
    // Avoid double-mount / concurrent init races (shell remount + script onload)
    if (host.dataset.mounted === '1' && host.children.length) return;
    if (initInFlight) return initInFlight;

    initInFlight = (async () => {
    host.innerHTML = '';

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

    window.__crmPermissionKeys = perms;
    window.__crmUserRole = role;
    window.__crmPalettePerms = perms;
    window.__crmPaletteRole = role;

    const keys = new Set(perms);
    const file = currentFile();
    const page = pageParam();

    if (host.dataset.layout === 'sidebar') {
      mountSidebarNav(host, perms, role);
      initSidebarUserFooter(user, role);
      host.dataset.mounted = '1';
      return;
    }

    const nav = document.createElement('nav');
    nav.className = 'crm-shared-nav';
    nav.setAttribute('aria-label', 'Navegação principal CRM');

    const inner = document.createElement('div');
    inner.className = 'crm-shared-nav__inner';

    const brand = document.createElement('a');
    brand.className = 'crm-shared-nav__brand crm-shared-nav__brand--logo-only';
    brand.href = 'pipeline-lab.html';
    brand.setAttribute('aria-label', 'ObraMate — início');
    brand.innerHTML =
      '<img src="/assets/obramate-logo.png" alt="ObraMate" class="crm-shared-nav__brand-logo crm-system-logo" width="64" height="64" onerror="this.style.display=\'none\'" />';
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
    host.dataset.mounted = '1';
    })();

    try {
      await initInFlight;
    } finally {
      initInFlight = null;
    }
  }

  async function remount(force) {
    if (initInFlight) {
      try {
        await initInFlight;
      } catch (_) {}
    }
    const host = document.getElementById('crmSharedNavRoot');
    // Avoid empty→fill→empty→fill flash on every page (shell + auto-init race)
    if (!force && host && host.dataset.mounted === '1' && host.children.length) {
      return;
    }
    if (host) {
      host.dataset.mounted = '0';
      host.innerHTML = '';
    }
    return init();
  }

  window.__crmSharedNav = { init, remount };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
