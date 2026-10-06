/**
 * Menu CRM padrão (Visão geral / Vendas / Operação / Financeiro) em páginas standalone.
 * Respeita permissões via GET /api/auth/session.
 */
(function () {
  // Shell may inject this script while the page also has a static <script> tag —
  // a second IIFE would race and duplicate sidebar groups.
  if (window.__crmSharedNav) return;

  const ICONS = {
    fieldquote:
      '<svg class="nav-icon-svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 17.5 17.5 3l3.5 3.5L6.5 21z"/><path d="m7.5 13 1.8 1.8M10.5 10l1.8 1.8M13.5 7l1.8 1.8"/></svg>',
    dashboard:
      '<svg class="nav-icon-svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 10.5L12 3l9 7.5"/><path d="M5 9.5V20h14V9.5"/></svg>',
    leads:
      '<svg class="nav-icon-svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 4h16l-6 7.5V20l-4-2v-6.5L4 4z"/></svg>',
    customers:
      '<svg class="nav-icon-svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>',
    builders:
      '<svg class="nav-icon-svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 20h20"/><path d="M5 20V10l7-5 7 5v10"/><path d="M9 20v-5h6v5"/></svg>',
    quotes:
      '<svg class="nav-icon-svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6"/><path d="M8 13h8"/><path d="M8 17h5"/></svg>',
    invoices:
      '<svg class="nav-icon-svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1-2-1z"/><path d="M8 10h8"/><path d="M8 14h5"/></svg>',
    schedule:
      '<svg class="nav-icon-svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4"/><path d="M8 2v4"/><path d="M3 10h18"/><path d="M8 14h.01"/><path d="M12 14h.01"/><path d="M16 14h.01"/><path d="M8 18h.01"/><path d="M12 18h.01"/></svg>',
    jobs:
      '<svg class="nav-icon-svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v2"/><path d="M12 12v.01"/><path d="M2 12h20"/></svg>',
    camera:
      '<svg class="nav-icon-svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/></svg>',
    chat:
      '<svg class="nav-icon-svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>',
    cadastro:
      '<svg class="nav-icon-svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>',
    products:
      '<svg class="nav-icon-svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/><path d="M3.3 7L12 12l8.7-5"/><path d="M12 22V12"/></svg>',
    services:
      '<svg class="nav-icon-svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z"/></svg>',
    pricing:
      '<svg class="nav-icon-svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z"/><circle cx="7" cy="7" r="1.25" fill="currentColor" stroke="none"/></svg>',
    finance:
      '<svg class="nav-icon-svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2v20"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>',
    payroll:
      '<svg class="nav-icon-svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 12h.01"/><path d="M18 12h.01"/></svg>',
    users:
      '<svg class="nav-icon-svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
    settings:
      '<svg class="nav-icon-svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>',
    reports:
      '<svg class="nav-icon-svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 19V5"/><path d="M4 19h16"/><path d="M8 17V9"/><path d="M12 17V7"/><path d="M16 17v-5"/></svg>',
  };

  /** Grupos alinhados ao menu do produto (Visão geral / Vendas / Operação / Financeiro) */
  function isMobileDevice() {
    if (window.__omDevice && typeof window.__omDevice.isMobile === 'function') {
      return window.__omDevice.isMobile();
    }
    const ua = navigator.userAgent || '';
    // Phone-only fallback — tablets use the desktop CRM.
    if (/iPhone|iPod|Windows Phone|IEMobile|BlackBerry|Opera Mini/i.test(ua)) return true;
    if (/Android/i.test(ua) && /Mobile/i.test(ua)) return true;
    return false;
  }

  function isFieldRole(role) {
    const r = String(role || '').toLowerCase();
    return r === 'installer' || r === 'crew_lead' || r === 'subcontractor';
  }

  function getFieldSidebarGroups() {
    return [
      {
        label: null,
        items: [{ href: 'funcionario.html', label: 'Início', perm: null, page: '', iconKey: 'dashboard' }],
      },
      {
        label: 'Campo',
        items: [
          { href: 'schedule.html', label: 'Agenda', perm: 'schedule.view', page: '', iconKey: 'schedule' },
          { href: 'jobs.html', label: 'Jobs', perm: 'work_orders.view', page: '', iconKey: 'jobs' },
          { href: 'chat.html', label: 'ObraChat', perm: 'chat.use', page: '', iconKey: 'chat', badge: 'chat' },
          {
            href: '/campo/horas.html',
            label: 'Minha folha',
            perm: 'payroll.self',
            permAny: ['payroll.self', 'payroll.view'],
            page: '',
            iconKey: 'payroll',
          },
        ],
      },
    ];
  }

  function getSidebarGroups(role) {
    if (isFieldRole(role)) return getFieldSidebarGroups();
    const homeHref = isMobileDevice() ? 'home.html' : 'pipeline-lab.html';
    return [
      {
        label: 'Visão geral',
        items: [
          { href: homeHref, label: 'Início', perm: null, page: '', iconKey: 'dashboard' },
          { href: 'chat.html', label: 'ObraChat', perm: 'chat.use', page: '', iconKey: 'chat', badge: 'chat' },
        ],
      },
      {
        label: 'Relatórios',
        items: [
          { href: 'relatorios.html', label: 'Painel', perm: 'reports.view', page: '', iconKey: 'reports' },
        ],
      },
      {
        label: 'Vendas',
        items: [
          { href: 'leads.html', label: 'Leads', perm: 'leads.view', page: 'leads', iconKey: 'leads' },
          { href: 'quotes.html', label: 'Orçamentos', perm: 'quotes.view', page: 'quotes', iconKey: 'quotes' },
          { href: 'field-quote.html', label: 'Field Quote', perm: 'quotes.view', page: '', iconKey: 'fieldquote' },
          {
            href: isMobileDevice() ? 'customers.html' : 'dashboard.html?page=customers',
            label: 'Clientes',
            perm: 'customers.view',
            page: 'customers',
            iconKey: 'customers',
          },
        ],
      },
      {
        label: 'Operação',
        items: [
          { href: 'schedule.html', label: 'Agenda', perm: 'schedule.view', page: '', iconKey: 'schedule' },
          { href: 'jobs.html', label: 'Jobs', perm: 'work_orders.view', page: '', iconKey: 'jobs' },
          {
            href: 'job-media-board.html',
            label: 'ObraCam',
            perm: 'work_orders.view',
            page: '',
            iconKey: 'camera',
          },
        ],
      },
      {
        label: 'Financeiro',
        items: [
          { href: 'invoices.html', label: 'Faturas', perm: 'invoices.view', page: 'invoices', iconKey: 'invoices' },
          { href: 'finance.html', label: 'Fluxo de caixa', perm: 'finance.view', page: '', iconKey: 'finance' },
          {
            href: 'folha.html',
            label: 'Folha',
            perm: 'payroll.view',
            permAny: ['payroll.view'],
            page: '',
            iconKey: 'payroll',
          },
          {
            href: 'builder-pricing-admin.html',
            label: 'Tabela de Valor',
            perm: 'builders.view',
            permAny: ['builders.view', 'quotes.edit'],
            page: '',
            iconKey: 'pricing',
          },
        ],
      },
    ];
  }

  function getMainNav(role) {
    return getSidebarGroups(role)
      .flatMap((g) => g.items)
      .filter((item) => item.showInTopBar !== false && item.type !== 'dropdown');
  }

  function currentFile() {
    const p = (window.location.pathname || '').split('/').pop() || '';
    return p.toLowerCase();
  }

  function pageParam() {
    return new URLSearchParams(window.location.search).get('page') || '';
  }

  const NAV_CACHE_HTML = 'crm_shared_nav_html_v2';
  const NAV_CACHE_META = 'crm_shared_nav_meta_v2';
  // Bump when sidebar groups/items change so role+perm cache does not hide new links.
  const NAV_STRUCTURE_VERSION = '20261006-fq2';

  function itemFromAnchor(a) {
    const hrefAttr = a.getAttribute('href') || '';
    const dataPage = a.getAttribute('data-page') || '';
    if (hrefAttr === '#' && dataPage) {
      const page = dataPage === 'dashboard' ? '' : dataPage;
      return {
        href: page ? `dashboard.html?page=${encodeURIComponent(page)}` : 'dashboard.html',
        page,
      };
    }
    return { href: hrefAttr, page: dataPage };
  }

  function syncActiveFromLocation() {
    const host = document.getElementById('crmSharedNavRoot');
    if (!host) return;
    const file = currentFile();
    const page = pageParam();
    host.querySelectorAll('a.nav-item').forEach((a) => {
      const item = itemFromAnchor(a);
      a.classList.toggle('active', linkActive(item, file, page));
    });
    host.querySelectorAll('a.crm-shared-nav__link').forEach((a) => {
      const item = itemFromAnchor(a);
      a.classList.toggle('crm-shared-nav__link--active', linkActive(item, file, page));
    });
  }

  function paintNavFromCache() {
    try {
      const host = document.getElementById('crmSharedNavRoot');
      if (!host || host.dataset.layout !== 'sidebar') return false;
      if (host.children.length) return false;
      let meta = {};
      try {
        meta = JSON.parse(sessionStorage.getItem(NAV_CACHE_META) || '{}');
      } catch (_) {
        meta = {};
      }
      if (meta.navVersion !== NAV_STRUCTURE_VERSION) {
        clearNavCache();
        return false;
      }
      const html = sessionStorage.getItem(NAV_CACHE_HTML);
      if (!html || html.indexOf('nav-item') < 0) return false;
      host.innerHTML = html;
      host.dataset.mounted = '1';
      host.dataset.fromCache = '1';
      syncActiveFromLocation();
      return true;
    } catch (_) {
      return false;
    }
  }

  function saveNavCache(role, perms) {
    try {
      const host = document.getElementById('crmSharedNavRoot');
      if (!host || host.dataset.layout !== 'sidebar' || !host.children.length) return;
      if (!host.querySelector('a.nav-item')) return;
      sessionStorage.setItem(NAV_CACHE_HTML, host.innerHTML);
      sessionStorage.setItem(
        NAV_CACHE_META,
        JSON.stringify({
          role: String(role || ''),
          permHash: (Array.isArray(perms) ? perms : []).slice().sort().join(','),
          navVersion: NAV_STRUCTURE_VERSION,
        }),
      );
    } catch (_) {}
  }

  function clearNavCache() {
    try {
      sessionStorage.removeItem(NAV_CACHE_HTML);
      sessionStorage.removeItem(NAV_CACHE_META);
      sessionStorage.removeItem('crm_shared_nav_html_v1');
      sessionStorage.removeItem('crm_shared_nav_meta_v1');
      sessionStorage.removeItem('crm_nav_history_v1');
    } catch (_) {}
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
    if (base === 'home.html') {
      return file === 'home.html';
    }
    if (base === 'pipeline-lab.html') {
      return file === 'pipeline-lab.html' || (file === 'dashboard.html' && !(page || '') && !isMobileDevice());
    }
    if (base === 'leads.html') return file === 'leads.html' || file === 'lead-detail.html';
    if (base === 'quotes.html') return file === 'quotes.html' || file === 'quote-builder.html';
    if (base === 'invoices.html') return file === 'invoices.html' || file === 'invoice.html';
    if (base === 'builder-pricing-admin.html') {
      return file === 'builder-pricing-admin.html' || file === 'quote-catalog.html';
    }
    if (base === 'equipe.html') return file === 'equipe.html';
    if (base === 'payroll-module.html') return file === 'payroll-module.html';
    if (base === 'finance.html') return file === 'finance.html';
    if (base === 'schedule.html') return file === 'schedule.html';
    if (base === 'jobs.html') return file === 'jobs.html' || file === 'job-detail.html';
    if (base === 'chat.html') return file === 'chat.html';
    if (base === 'field-quote.html') return file === 'field-quote.html';
    if (base === 'job-media-board.html') return file === 'job-media-board.html';
    if (base === 'relatorios.html') return file === 'relatorios.html';
    if (base === 'configuracoes.html') return file === 'configuracoes.html';
    if (pathAndQuery.indexOf('dashboard.html') >= 0 || base === 'dashboard.html') {
      if (file === 'home.html' && !(item.page || '')) return true;
      if (file === 'pipeline-lab.html' && item.page === 'pipeline') return true;
      if (file === 'customers.html' && (item.page || '') === 'customers') return true;
      if (file !== 'dashboard.html') return false;
      const expected = item.page || '';
      if ((page || '') !== expected) return false;
      return true;
    }
    const toolFile = pathAndQuery.split('?')[0].split('/').pop().toLowerCase();
    return file === toolFile;
  }

  function canSee(perm, role, keys, permAny) {
    if (role === 'admin') return true;
    if (Array.isArray(permAny) && permAny.length) {
      return permAny.some((p) => keys.has(p));
    }
    if (!perm) return true;
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
    if (Array.isArray(item.permAny) && item.permAny.length) {
      a.setAttribute('data-crm-permission-any', item.permAny.join(','));
    }
    a.setAttribute('aria-label', item.label);
    a.removeAttribute('title');
    const iconHtml = ICONS[item.iconKey] || ICONS.dashboard;
    const tpl = document.createElement('template');
    tpl.innerHTML = iconHtml.trim();
    a.appendChild(tpl.content);
    const span = document.createElement('span');
    span.className = 'nav-item__label';
    span.textContent = item.label;
    a.appendChild(span);
    if (item.badge === 'chat') {
      const badge = document.createElement('span');
      badge.className = 'nav-item__badge';
      badge.setAttribute('data-chat-badge', '1');
      badge.setAttribute('aria-hidden', 'true');
      badge.textContent = '';
      a.appendChild(badge);
      a.style.position = 'relative';
    }
    return a;
  }

  function mountSidebarNav(host, perms, role) {
    const keys = new Set(perms);
    const file = currentFile();
    const page = pageParam();
    getSidebarGroups(role).forEach((group) => {
      const visible = group.items.filter((item) => {
        if (item.type === 'dropdown' && Array.isArray(item.children)) {
          return item.children.some((ch) => canSee(ch.perm, role, keys, ch.permAny));
        }
        return canSee(item.perm, role, keys, item.permAny);
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
        wrap.appendChild(createSidebarLink(item, file, page));
      });
      host.appendChild(wrap);
    });
  }

  function initSidebarUserFooter(user, role) {
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn && !logoutBtn.dataset.crmNavBound) {
      logoutBtn.dataset.crmNavBound = '1';
      logoutBtn.addEventListener('click', async () => {
        try {
          clearNavCache();
          await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
        } catch (_) {}
        window.location.href = 'login.html';
      });
    }

    const brandName =
      (window.__saasBrand && window.__saasBrand.name) ||
      document.querySelector('.sidebar-brand-name')?.textContent ||
      'ObraMate';
    const wsName = document.getElementById('sidebarWorkspaceName');
    if (wsName) wsName.textContent = brandName;
    document.querySelectorAll('.sidebar-brand-name').forEach((el) => {
      el.textContent = brandName;
    });

    const roleLabel = role ? String(role) : '';
    const rolePretty = roleLabel
      ? roleLabel.charAt(0).toUpperCase() + roleLabel.slice(1).replace(/_/g, ' ')
      : '';
    const wsMeta = document.getElementById('sidebarWorkspaceMeta');
    if (wsMeta) wsMeta.textContent = rolePretty ? `Workspace · ${rolePretty}` : 'Workspace';

    const disp = user
      ? (user.name && String(user.name).trim()) || user.email || 'Usuário'
      : '—';
    const initials = (() => {
      const parts = String(disp).trim().split(/\s+/).filter(Boolean);
      if (parts.length >= 2) {
        return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
      }
      const ch = disp.trim().charAt(0).toUpperCase();
      return ch && /[A-Z0-9À-ÖØ-Ý]/.test(ch) ? ch : '?';
    })();

    const sn = document.getElementById('sidebarUserName');
    if (sn) sn.textContent = disp;
    const sr = document.getElementById('sidebarUserRole');
    if (sr) sr.textContent = rolePretty;
    const sa = document.getElementById('sidebarUserAvatar');
    if (sa) sa.textContent = initials;

    // Topbar user chip (account menu)
    const chipAvatar = document.getElementById('crmTopbarUserAvatar');
    const chipName = document.getElementById('crmTopbarUserName');
    const chipRole = document.getElementById('crmTopbarUserRole');
    if (chipAvatar) chipAvatar.textContent = initials;
    if (chipName) chipName.textContent = disp;
    if (chipRole) chipRole.textContent = rolePretty || '—';
  }

  let initInFlight = null;

  async function init() {
    const host = document.getElementById('crmSharedNavRoot');
    if (!host) return;
    // Soft-nav / already mounted: only sync active state
    if (host.dataset.mounted === '1' && host.children.length && host.dataset.fromCache !== '1') {
      syncActiveFromLocation();
      return;
    }
    if (initInFlight) return initInFlight;

    const hadCache = host.dataset.fromCache === '1' && host.children.length;

    initInFlight = (async () => {
    if (!hadCache) host.innerHTML = '';

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
    const permHash = perms.slice().sort().join(',');

    if (hadCache && host.dataset.layout === 'sidebar') {
      let metaOk = false;
      try {
        const m = JSON.parse(sessionStorage.getItem(NAV_CACHE_META) || '{}');
        metaOk =
          m.navVersion === NAV_STRUCTURE_VERSION &&
          m.role === String(role || '') &&
          m.permHash === permHash;
      } catch (_) {}
      // Keep painted menu if perms match OR session failed (avoid wiping into empty nav)
      if (metaOk || !user) {
        host.dataset.fromCache = '0';
        host.dataset.mounted = '1';
        syncActiveFromLocation();
        if (user) {
          initSidebarUserFooter(user, role);
          startChatBadgePolling(perms, role);
          saveNavCache(role, perms);
        }
        return;
      }
      host.innerHTML = '';
      host.dataset.fromCache = '0';
    }

    if (host.dataset.layout === 'sidebar') {
      mountSidebarNav(host, perms, role);
      initSidebarUserFooter(user, role);
      host.dataset.mounted = '1';
      host.dataset.fromCache = '0';
      saveNavCache(role, perms);
      startChatBadgePolling(perms, role);
      return;
    }

    const nav = document.createElement('nav');
    nav.className = 'crm-shared-nav';
    nav.setAttribute('aria-label', 'Navegação principal CRM');

    const inner = document.createElement('div');
    inner.className = 'crm-shared-nav__inner';

    const brand = document.createElement('a');
    brand.className = 'crm-shared-nav__brand crm-shared-nav__brand--logo-only';
    brand.href = isFieldRole(role)
      ? 'funcionario.html'
      : (window.__omDevice && window.__omDevice.entryHref && window.__omDevice.entryHref()) || 'pipeline-lab.html';
    brand.setAttribute('aria-label', 'ObraMate — início');
    brand.innerHTML =
      '<img src="/assets/obramate-logo.png" alt="ObraMate" class="crm-shared-nav__brand-logo crm-system-logo" width="64" height="64" onerror="this.style.display=\'none\'" />';
    inner.appendChild(brand);

    getMainNav(role).forEach((item) => {
      if (!canSee(item.perm, role, keys, item.permAny)) return;
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
        clearNavCache();
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
      syncActiveFromLocation();
      return;
    }
    if (host) {
      host.dataset.mounted = '0';
      host.dataset.fromCache = '0';
      host.innerHTML = '';
    }
    if (force) clearNavCache();
    return init();
  }

  // Paint cached sidebar ASAP (script runs at end of body — host exists)
  paintNavFromCache();

  window.__crmSharedNav = { init, remount, syncActiveFromLocation, paintNavFromCache, clearNavCache };

  let chatBadgeTimer = null;
  async function updateChatBadge() {
    const badges = document.querySelectorAll('[data-chat-badge]');
    if (!badges.length) return;
    try {
      const r = await fetch('/api/chat/unread', { credentials: 'include' });
      const j = await r.json();
      if (!j.success) return;
      const total = Number(j.data?.total || 0) + Number(j.data?.unread_mentions || 0);
      badges.forEach((badge) => {
        if (total > 0) {
          badge.textContent = total > 99 ? '99+' : String(total);
          badge.classList.add('is-on');
        } else {
          badge.textContent = '';
          badge.classList.remove('is-on');
        }
      });
    } catch (_) {
      /* ignore */
    }
  }

  function startChatBadgePolling(perms, role) {
    const keys = new Set(perms || []);
    const can =
      String(role || '').toLowerCase() === 'admin' ||
      keys.has('chat.use');
    if (!can) return;
    window.__crmUpdateChatBadge = updateChatBadge;
    updateChatBadge();
    if (chatBadgeTimer) clearInterval(chatBadgeTimer);
    chatBadgeTimer = setInterval(updateChatBadge, 45000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
