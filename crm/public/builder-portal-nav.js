/* global document, window */
(function () {
  const ICONS = {
    dashboard:
      '<svg class="nav-icon-svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" aria-hidden="true"><path d="M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z"/></svg>',
    projects:
      '<svg class="nav-icon-svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" aria-hidden="true"><path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z"/><path d="M5 3l4 4"/></svg>',
    schedule:
      '<svg class="nav-icon-svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4"/><path d="M8 2v4"/><path d="M3 10h18"/></svg>',
    quotes:
      '<svg class="nav-icon-svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" aria-hidden="true"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6"/><path d="M16 13H8"/><path d="M16 17H8"/><path d="M10 9H8"/></svg>',
    financial:
      '<svg class="nav-icon-svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" aria-hidden="true"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>',
    leads:
      '<svg class="nav-icon-svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" aria-hidden="true"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2"/><path d="M9 5a2 2 0 012-2h2a2 2 0 012 2v0a2 2 0 01-2 2H9a2 2 0 01-2-2v0z"/><path d="M9 12h6"/><path d="M9 16h6"/></svg>',
    messages:
      '<svg class="nav-icon-svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" aria-hidden="true"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>',
    gallery:
      '<svg class="nav-icon-svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>',
    users:
      '<svg class="nav-icon-svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" aria-hidden="true"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
  };

  /** Same group structure as CRM dashboard sidebar */
  const SIDEBAR_GROUPS = [
    {
      label: null,
      items: [{ id: 'dashboard', href: 'builder-portal.html', label: 'Dashboard', iconKey: 'dashboard' }],
    },
    {
      label: 'Projects',
      items: [
        { id: 'projects', href: 'builder-projects.html', label: 'My Projects', iconKey: 'projects' },
        { id: 'calendar', href: 'builder-calendar.html', label: 'Calendar', iconKey: 'schedule' },
        { id: 'history', href: 'builder-history.html', label: 'History', iconKey: 'projects' },
      ],
    },
    {
      label: 'Estimates & tools',
      items: [
        { id: 'estimate', href: 'builder-estimate-request.html', label: 'Request estimate', iconKey: 'quotes' },
        { id: 'calculator', href: 'builder-calculator.html', label: 'Calculator', iconKey: 'financial' },
        { id: 'pricing', href: 'builder-pricing.html', label: 'Partner pricing', iconKey: 'financial' },
        { id: 'referrals', href: 'builder-referrals.html', label: 'Referrals', iconKey: 'leads' },
      ],
    },
    {
      label: 'Communication',
      items: [
        { id: 'messages', href: 'builder-messages.html', label: 'Messages', iconKey: 'messages', badge: true },
      ],
    },
    {
      label: 'Inspiration',
      items: [{ id: 'gallery', href: 'builder-gallery.html', label: 'Gallery', iconKey: 'gallery' }],
    },
    {
      label: 'Account',
      items: [{ id: 'profile', href: 'builder-profile.html', label: 'Profile', iconKey: 'users' }],
    },
  ];

  function currentPage() {
    const fromBody = document.body?.dataset?.bpPage;
    if (fromBody) return fromBody;
    const file = (location.pathname.split('/').pop() || '').replace(/\.html$/, '');
    const map = {
      'builder-portal': 'dashboard',
      'builder-projects': 'projects',
      'builder-project': 'projects',
      'builder-calendar': 'calendar',
      'builder-calculator': 'calculator',
      'builder-estimate-request': 'estimate',
      'builder-pricing': 'pricing',
      'builder-gallery': 'gallery',
      'builder-messages': 'messages',
      'builder-history': 'history',
      'builder-referrals': 'referrals',
      'builder-profile': 'profile',
    };
    return map[file] || '';
  }

  function createNavLink(item, active) {
    const a = document.createElement('a');
    a.href = item.href;
    a.className = 'nav-item' + (item.id === active ? ' active' : '');
    const tpl = document.createElement('template');
    tpl.innerHTML = (ICONS[item.iconKey] || ICONS.dashboard).trim();
    a.appendChild(tpl.content);
    a.appendChild(document.createTextNode(item.label));
    if (item.badge) {
      const badge = document.createElement('span');
      badge.className = 'bp-nav-badge hidden';
      badge.id = 'bpNavMsgBadge';
      badge.setAttribute('aria-label', 'Unread');
      a.appendChild(badge);
    }
    return a;
  }

  function renderNav(active) {
    const nav = document.getElementById('bpPortalNav');
    if (!nav) return;
    nav.innerHTML = '';
    SIDEBAR_GROUPS.forEach((group) => {
      const groupEl = document.createElement('div');
      groupEl.className = 'sidebar-nav-group';
      if (group.label) {
        const label = document.createElement('p');
        label.className = 'sidebar-nav-group-label';
        label.textContent = group.label;
        groupEl.appendChild(label);
      }
      group.items.forEach((item) => {
        groupEl.appendChild(createNavLink(item, active));
      });
      nav.appendChild(groupEl);
    });
    window.builderPortalCommon?.refreshUnreadBadges?.();
  }

  window.builderPortalNav = { renderNav, currentPage, SIDEBAR_GROUPS };
  document.addEventListener('DOMContentLoaded', () => renderNav(currentPage()));
})();
