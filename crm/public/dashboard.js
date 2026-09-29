/**
 * Dashboard JavaScript - Main functionality
 */
let currentPage = 1;
let currentPageName = 'dashboard';
let dashboardStats = null;
let lastLeadCount = null;
/** Período do dashboard operacional: today | week | month */
let currentDashboardPeriod = 'month';
let dashboardAutoRefreshTimer = null;
const NEW_LEAD_POLL_INTERVAL_MS = 30000; // 30s
let newLeadPollTimer = null;

/** Permissões do utilizador com sessão (menu + módulo Users) */
let crmUserPermissions = [];
let crmUserRole = '';

/** Viewport mobile (coexiste com desktop ≥768px) — usar matchMedia, não user-agent */
const sfMobileMq = window.matchMedia('(max-width: 768px)');

/** Cache da página atual de orçamentos para pesquisa client-side no cartão mobile */
let sfQuotesListCache = [];

/** Slug → cor hex (lista de leads alinhada às colunas do Kanban) */
let leadsPipelineSlugToColor = null;

function sanitizeLeadStageHexColor(c) {
    if (c == null || c === undefined) return '';
    const s = String(c).trim();
    return /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$/.test(s) ? s : '';
}

function escapeHtmlLeadList(s) {
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/"/g, '&quot;');
}

async function ensureLeadsPipelineColorMap() {
    if (leadsPipelineSlugToColor) return;
    leadsPipelineSlugToColor = {};
    try {
        const response = await fetch('/api/pipeline-stages', { credentials: 'include' });
        const data = await response.json();
        if (data.success && Array.isArray(data.data)) {
            const fallback = '#94a3b8';
            data.data.forEach((stage) => {
                if (!stage || !stage.slug) return;
                leadsPipelineSlugToColor[stage.slug] = sanitizeLeadStageHexColor(stage.color) || fallback;
            });
        }
    } catch (e) {
        leadsPipelineSlugToColor = {};
    }
}

function resolveLeadRowStageColor(lead) {
    const fallback = '#94a3b8';
    const fromJoin = sanitizeLeadStageHexColor(lead.pipeline_stage_color);
    if (fromJoin) return fromJoin;
    const slug = lead.pipeline_stage_slug || lead.status;
    if (slug && leadsPipelineSlugToColor && leadsPipelineSlugToColor[slug]) {
        return leadsPipelineSlugToColor[slug];
    }
    return fallback;
}

function applyCrmNavPermissions(permissions, role) {
    const keys = new Set(permissions || []);
    const isAdmin = role === 'admin';
    window.__crmPaletteRole = role || '';
    window.__crmPalettePerms = Array.isArray(permissions) ? permissions.slice() : [];
    window.__crmPermissionKeys = Array.isArray(permissions) ? permissions.slice() : [];
    window.__crmUserRole = role || '';
    document.querySelectorAll('[data-crm-permission], [data-crm-permission-any]').forEach((el) => {
        const need = el.getAttribute('data-crm-permission');
        const anyRaw = el.getAttribute('data-crm-permission-any');
        const anyList = anyRaw
            ? anyRaw.split(',').map((s) => s.trim()).filter(Boolean)
            : [];
        let ok = isAdmin;
        if (!ok && anyList.length) ok = anyList.some((p) => keys.has(p));
        if (!ok && need) ok = keys.has(need);
        if (!ok && !need && !anyList.length) ok = true;
        // Keep account-menu items in the flow — they use [hidden], not display
        if (el.closest && el.closest('#crmAccountMenu')) {
            el.hidden = !ok;
            return;
        }
        el.style.display = ok ? '' : 'none';
    });
    refreshCrmNavGroupVisibility();
    updateUsersPageActions();
}

function refreshCrmNavGroupVisibility() {
    document.querySelectorAll('.sidebar-nav-dropdown').forEach((det) => {
        const panel = det.querySelector('.sidebar-nav-dropdown__panel');
        if (!panel) return;
        const any = Array.from(panel.querySelectorAll('.nav-item')).some((el) => el.style.display !== 'none');
        det.style.display = any ? '' : 'none';
    });
    document.querySelectorAll('.mobile-more-sheet__cadastro').forEach((det) => {
        const panel = det.querySelector('.mobile-more-sheet__cadastro-panel');
        if (!panel) return;
        const any = Array.from(panel.querySelectorAll('.mobile-more-sheet__btn')).some((el) => el.style.display !== 'none');
        det.style.display = any ? '' : 'none';
    });
}

function syncSidebarCadastroDropdowns() {
    const side = document.getElementById('dashboardSidebar');
    if (!side) return;
    side.querySelectorAll('.sidebar-nav-dropdown').forEach((det) => {
        const activeInPanel = det.querySelector('.sidebar-nav-dropdown__panel .nav-item.active');
        det.open = !!activeInPanel;
        const sum = det.querySelector('summary.nav-item');
        if (sum) sum.classList.toggle('active', !!activeInPanel);
    });
}

function canManageRoles() {
    return crmUserRole === 'admin' || crmUserPermissions.includes('roles.manage');
}

function canManageUserPerms() {
    return (
        crmUserRole === 'admin' ||
        crmUserPermissions.includes('users.manage') ||
        crmUserPermissions.includes('roles.manage') ||
        crmUserPermissions.includes('users.manage_permissions')
    );
}

function updateUsersPageActions() {
    const n = document.getElementById('crmNewUserBtn');
    if (n) {
        const show = crmUserRole === 'admin' || crmUserPermissions.includes('users.create');
        n.style.display = show ? '' : 'none';
    }
    const r = document.getElementById('crmNewRoleBtn');
    if (r) r.style.display = canManageRoles() ? '' : 'none';
}

let crmRolesCache = null;

async function fetchCrmRoles(force) {
    if (crmRolesCache && !force) return crmRolesCache;
    const res = await fetch('/api/roles', { credentials: 'include' });
    const data = await res.json();
    crmRolesCache = data.success && Array.isArray(data.data) ? data.data : [];
    return crmRolesCache;
}

async function populateCrmUserRoleSelect(selectedKey) {
    const roleSelect = document.getElementById('crmUserRole');
    if (!roleSelect) return;
    const roles = await fetchCrmRoles();
    const preferred = selectedKey || roleSelect.value || 'sales' || 'sales_rep';
    roleSelect.innerHTML = roles
        .map((r) => {
            const label = escapeHtmlCrm(r.name || r.key);
            return `<option value="${escapeHtmlCrm(r.key)}">${label}</option>`;
        })
        .join('');
    if (!roles.length) {
        roleSelect.innerHTML =
            '<option value="admin">Administrador</option><option value="sales">Sales</option>';
    }
    const keys = new Set([...roleSelect.options].map((o) => o.value));
    if (preferred && keys.has(preferred)) roleSelect.value = preferred;
    else if (keys.has('sales')) roleSelect.value = 'sales';
    else if (keys.has('sales_rep')) roleSelect.value = 'sales_rep';
    else if (roleSelect.options.length) roleSelect.selectedIndex = 0;
}

fetch('/api/auth/session', { credentials: 'include' })
    .then(async (r) => {
        const data = await r.json().catch(() => ({}));
        if (!r.ok) {
            const msg =
                data.message ||
                (r.status === 503
                    ? 'Base de dados indisponível. Verifique DATABASE_URL / MySQL na Railway.'
                    : 'Erro do servidor (' + r.status + ').');
            const full = data.hint ? msg + ' ' + data.hint : msg;
            if (typeof window.crmNotify === 'function') {
                window.crmNotify(full, 'error');
            } else {
                console.error(full, data);
            }
            if (r.status === 401 || r.status === 403) {
                window.location.href = '/login.html';
            }
            return;
        }
        if (!data.authenticated) {
            window.location.href = '/login.html';
            return;
        }
        const u = data.user || {};
        if (u.must_change_password) {
            window.location.href = '/change-password.html';
            return;
        }
        crmUserPermissions = Array.isArray(u.permissions) ? u.permissions : [];
        crmUserRole = u.role || '';
        const disp = (u.name && String(u.name).trim()) || u.email || 'Utilizador';
        const sn = document.getElementById('sidebarUserName');
        const sr = document.getElementById('sidebarUserRole');
        const sa = document.getElementById('sidebarUserAvatar');
        if (sn) sn.textContent = disp;
        if (sr) sr.textContent = crmUserRole ? String(crmUserRole) : '';
        if (sa) {
            const ch = disp.trim().charAt(0).toUpperCase();
            sa.textContent = ch && /[A-Z0-9]/.test(ch) ? ch : '?';
        }
        applyCrmNavPermissions(crmUserPermissions, crmUserRole);
        if (typeof applySfMobileShell === 'function') applySfMobileShell();
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.register('/sw.js').catch(() => {});
        }
        loadDashboard();
        if (typeof window.sfBootCrmAddressAutocomplete === 'function') {
            setTimeout(function () {
                window.sfBootCrmAddressAutocomplete();
            }, 600);
        }
        startNewLeadPolling();
        const pageParam = new URLSearchParams(window.location.search).get('page');
        const routePage = pageParam === 'crm' ? 'leads' : pageParam;
        if (pageParam === 'projects' || pageParam === 'schedule') {
            showPage('dashboard');
            return;
        }
        const goRoutedPage = () => {
            if (pageParam === 'customers') {
                const qp = new URLSearchParams(window.location.search);
                const tp = qp.get('type');
                customersTypeFilter = tp === 'builder' ? 'builder' : '';
                // ?q= comes from the global search (⌘K) result for a customer
                customersSearchFilter = (qp.get('q') || '').trim();
                showPage('customers');
            } else if (routePage && document.querySelector(`#dashboardSidebar [data-page="${routePage}"]`)) {
                showPage(routePage);
            } else if (routePage) {
                // Shared nav may still be mounting — soft-route anyway
                showPage(routePage);
            }
        };
        const host = document.getElementById('crmSharedNavRoot');
        if (host && !host.children.length) {
            let tries = 0;
            const waitNav = setInterval(() => {
                tries += 1;
                if (host.children.length || tries > 40) {
                    clearInterval(waitNav);
                    goRoutedPage();
                }
            }, 50);
        } else {
            goRoutedPage();
        }
    })
    .catch((err) => {
        console.error('Session check error:', err);
        if (typeof window.crmNotify === 'function') {
            window.crmNotify('Falha de rede ao verificar sessão.', 'error');
        }
        window.location.href = '/login.html';
    });

// Popup toast no canto inferior – novo lead recebido
function showNewLeadToast(count, message) {
    var msg = message || (count === 1 ? '1 novo lead. Contate em até 30 min!' : count + ' novos leads. Contate em até 30 min!');
    if (typeof window.addCrmNotification === 'function') {
        window.addCrmNotification({
            title: count === 1 ? 'Novo lead recebido' : count + ' novos leads',
            body: msg,
            type: 'lead_new',
            action: { kind: 'page', page: 'leads' },
        });
    }
    var container = document.getElementById('toastContainer');
    if (!container) return;
    var toast = document.createElement('div');
    toast.className = 'toast-lead';
    toast.setAttribute('role', 'alert');
    toast.innerHTML =
        '<span class="toast-lead-icon">!</span>' +
        '<div class="toast-lead-body">' +
        '<div class="toast-lead-title">Novo lead recebido!</div>' +
        '<div class="toast-lead-msg">' + msg + '</div>' +
        '</div>' +
        '<button type="button" class="toast-lead-btn" onclick="this.closest(\'.toast-lead\').remove(); showPage(\'leads\');">Ver leads</button>';
    container.appendChild(toast);
    setTimeout(function () {
        if (toast.parentNode) toast.remove();
    }, 8000);
}

// Auto-refresh: poll for new leads and show notification
function startNewLeadPolling() {
    if (newLeadPollTimer) return;
    if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission();
    }
    function poll() {
        fetch('/api/leads?limit=1&page=1', { credentials: 'include' })
            .then(r => r.json())
            .then(data => {
                if (!data.success || typeof data.total !== 'number') return;
                const total = data.total;
                if (lastLeadCount !== null && total > lastLeadCount) {
                    const n = total - lastLeadCount;
                    const msg = n === 1 ? '1 novo lead recebido.' : n + ' novos leads recebidos.';
                    showNewLeadToast(n, msg);
                    if ('Notification' in window && Notification.permission === 'granted') {
                        try { new Notification('Senior Floors CRM – Novo lead', { body: msg }); } catch (e) {}
                    }
                    if (currentPageName === 'dashboard') loadDashboard();
                    if (currentPageName === 'leads' && typeof loadKanbanBoard === 'function') loadKanbanBoard();
                }
                lastLeadCount = total;
            })
            .catch(() => {});
    }
    poll();
    newLeadPollTimer = setInterval(poll, NEW_LEAD_POLL_INTERVAL_MS);
}

// Logout
document.getElementById('logoutBtn')?.addEventListener('click', async () => {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    window.location.href = '/login.html';
});

// Mobile menu toggle
const mobileMenuToggle = document.getElementById('mobileMenuToggle');
const dashboardSidebar = document.getElementById('dashboardSidebar');
const mobileOverlay = document.getElementById('mobileOverlay');

function isMobile() {
    return window.innerWidth <= 768;
}

/** Telemóvel e iPad: menu em gaveta + barra hamburger (sem tab bar no tablet). */
function isCompactNav() {
    return window.innerWidth <= 1366;
}

/** Quotes: cards + cliente visivel em telemovel e iPad (incl. landscape). */
function isQuotesCompactLayout() {
    return window.innerWidth <= 1366;
}

/** Telefone, tablet e iPad — pull-to-refresh */
function isTouchViewport() {
    if (navigator.maxTouchPoints > 0) return true;
    if (window.matchMedia('(hover: none) and (pointer: coarse)').matches) return true;
    return window.innerWidth <= 1024;
}

function getSfScrollRoot() {
    const main = document.querySelector('.dashboard-main');
    if (!main) return null;
    const oy = window.getComputedStyle(main).overflowY;
    if (
        (oy === 'auto' || oy === 'scroll' || oy === 'overlay') &&
        main.scrollHeight > main.clientHeight + 2
    ) {
        return main;
    }
    return null;
}

function getSfScrollTop(scrollRoot) {
    const tops = [
        window.scrollY || 0,
        document.documentElement.scrollTop || 0,
        document.body.scrollTop || 0,
    ];
    if (scrollRoot) tops.unshift(scrollRoot.scrollTop || 0);
    return Math.max(...tops);
}

/** Só permite PTR se a janela e colunas Kanban tocadas estão no topo. */
function isSfPtrAtScrollTop(target) {
    if (getSfScrollTop(getSfScrollRoot()) > 2) return false;
    let el = target;
    while (el && el !== document.body) {
        if (el.classList && el.classList.contains('kanban-column-cards')) {
            if (el.scrollTop > 2) return false;
        }
        const oy = window.getComputedStyle(el).overflowY;
        if (
            (oy === 'auto' || oy === 'scroll' || oy === 'overlay') &&
            el.scrollHeight > el.clientHeight + 2 &&
            el.scrollTop > 2
        ) {
            return false;
        }
        el = el.parentElement;
    }
    return true;
}

function sfPtrTouchStartsInsideScrolledColumn(target) {
    const col = target && target.closest && target.closest('.kanban-column-cards');
    return !!(col && col.scrollHeight > col.clientHeight + 2 && col.scrollTop > 2);
}

function getSfPtrIndicatorForPage(pageName) {
    if (pageName === 'quotes') return document.getElementById('quotesPtrIndicator');
    if (pageName === 'leads') return document.getElementById('leadsPtrIndicator');
    if (pageName === 'dashboard') return document.getElementById('dashboardPtrIndicator');
    return null;
}

async function runSfPtrRefresh(pageName) {
    if (pageName === 'leads') {
        await refreshLeads();
        return;
    }
    if (pageName === 'quotes') {
        quotesListPage = 1;
        await loadQuotes();
        return;
    }
    if (pageName === 'dashboard') {
        await loadDashboard(currentDashboardPeriod);
        return;
    }
    if (pageName === 'marketing' && typeof loadMarketingDashboard === 'function') {
        await loadMarketingDashboard();
    }
}

let sfPtrPulling = false;
let sfPtrStartY = 0;
let sfPtrArmed = false;
let sfPtrRefreshing = false;

function sfPtrResetState() {
    sfPtrPulling = false;
    sfPtrArmed = false;
    const ind = getSfPtrIndicatorForPage(currentPageName);
    if (ind) ind.classList.remove('sf-ptr-visible', 'is-ready');
}

function initSfPullToRefresh() {
    if (document.documentElement.dataset.sfPtrBound) return;
    document.documentElement.dataset.sfPtrBound = '1';

    const onTouchStart = (e) => {
        if (!isTouchViewport()) return;
        if (!getSfPtrIndicatorForPage(currentPageName)) return;
        if (!e.touches || !e.touches.length) return;
        if (sfPtrTouchStartsInsideScrolledColumn(e.target)) return;
        sfPtrPulling = true;
        sfPtrStartY = e.touches[0].clientY;
        sfPtrArmed = isSfPtrAtScrollTop(e.target);
    };

    const onTouchMove = (e) => {
        if (!isTouchViewport() || !sfPtrPulling || !sfPtrArmed) return;
        if (!e.touches || !e.touches.length) return;
        const ind = getSfPtrIndicatorForPage(currentPageName);
        if (!ind) return;
        if (!isSfPtrAtScrollTop(e.target)) {
            ind.classList.remove('sf-ptr-visible');
            sfPtrArmed = false;
            return;
        }
        const dy = e.touches[0].clientY - sfPtrStartY;
        if (dy > 0 && dy < 120) {
            try {
                e.preventDefault();
            } catch (err) {}
        }
        if (dy > 48) {
            ind.classList.add('sf-ptr-visible');
            const ready = dy > 64;
            ind.classList.toggle('is-ready', ready);
            ind.textContent = ready ? '↓ Largar para atualizar' : '↓ Puxe para atualizar';
        } else {
            ind.classList.remove('sf-ptr-visible', 'is-ready');
        }
    };

    const onTouchEnd = async () => {
        if (!isTouchViewport()) return;
        const ind = getSfPtrIndicatorForPage(currentPageName);
        const refresh = !!(ind && ind.classList.contains('sf-ptr-visible'));
        sfPtrPulling = false;
        sfPtrArmed = false;
        if (ind) {
            ind.classList.remove('sf-ptr-visible', 'is-ready');
            if (refresh) ind.textContent = 'A atualizar…';
        }
        if (refresh && isSfPtrAtScrollTop(document.body) && !sfPtrRefreshing) {
            sfPtrRefreshing = true;
            try {
                navigator.vibrate(12);
            } catch (err) {}
            try {
                await new Promise((r) => setTimeout(r, 180));
                await runSfPtrRefresh(currentPageName);
            } finally {
                sfPtrRefreshing = false;
                if (ind) ind.textContent = '↓ Puxe para atualizar';
            }
        }
    };

    document.addEventListener('touchstart', onTouchStart, { passive: true, capture: true });
    document.addEventListener('touchmove', onTouchMove, { passive: false, capture: true });
    document.addEventListener('touchend', onTouchEnd, { passive: true, capture: true });
    document.addEventListener('touchcancel', sfPtrResetState, { passive: true, capture: true });
}

const MOBILE_PAGE_TITLES = {
    dashboard: 'Dashboard',
    marketing: 'Marketing',
    leads: 'Leads',
    customers: 'Clientes',
    quotes: 'Orçamentos',
    invoices: 'Invoices',
    projects: 'Projetos',
    schedule: 'Agenda',
    financeiro: 'Financeiro',
    activities: 'Atividades',
    users: 'Utilizadores',
};

/** Módulos no drawer “Mais” (tabs principais Home/Quotes/Clients ficam na barra) */
const MOBILE_MORE_PAGES = new Set([
    'marketing',
    'leads',
    'invoices',
    'projects',
    'schedule',
    'financeiro',
    'activities',
    'users',
]);

function setMobileMenuOpen(open) {
    if (!dashboardSidebar || !mobileOverlay) return;
    dashboardSidebar.classList.toggle('mobile-open', open);
    mobileOverlay.classList.toggle('active', open);
    if (mobileMenuToggle) mobileMenuToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
}

function syncMobileAppChrome(pageName) {
    const titleEl = document.getElementById('mobileAppTitle');
    if (titleEl) {
        titleEl.textContent = MOBILE_PAGE_TITLES[pageName] || pageName;
    }
    document.querySelectorAll('#mobileTabBar .mobile-tab-bar__item').forEach((btn) => {
        const tab = btn.dataset.mobileTab;
        if (!tab) return;
        const inMore = MOBILE_MORE_PAGES.has(pageName);
        const active = tab === 'more' ? inMore : tab === pageName;
        btn.classList.toggle('mobile-tab-bar__item--active', active);
        if (active) btn.setAttribute('aria-current', 'page');
        else btn.removeAttribute('aria-current');
    });
    moveMobileTabThumb();
    if (isMobile()) {
        try {
            window.scrollTo(0, 0);
        } catch (e) {}
        const main = document.querySelector('.dashboard-main');
        if (main && typeof main.scrollTop === 'number') main.scrollTop = 0;
        const pageEl = document.getElementById(pageName + 'Page');
        if (pageEl) {
            pageEl.classList.remove('mobile-page-flash');
            void pageEl.offsetWidth;
            pageEl.classList.add('mobile-page-flash');
        }
    }
}

function moveMobileTabThumb() {
    const bar = document.getElementById('mobileTabBar');
    const thumb = document.getElementById('mobileTabThumb');
    if (!bar || !thumb) return;
    const slots = Array.from(bar.children).filter((el) => !el.classList.contains('mobile-tab-bar__thumb'));
    const active = bar.querySelector('.mobile-tab-bar__item--active');
    if (!active) return;
    const idx = slots.indexOf(active);
    if (idx < 0) return;
    thumb.style.transform = `translateX(${idx * 100}%)`;
}

function syncSfMobilePeriodUi(period) {
    const p = period === 'overall' ? 'month' : period;
    const map = { today: 0, week: 1, month: 2 };
    const idx = map[p] != null ? map[p] : 2;
    const thumb = document.getElementById('sfMobilePeriodThumb');
    if (thumb) thumb.style.transform = `translateX(${idx * 100}%)`;
    document.querySelectorAll('#sfMobilePeriod [data-sf-period]').forEach((btn) => {
        const on = btn.getAttribute('data-sf-period') === p;
        btn.classList.toggle('is-active', on);
        btn.setAttribute('aria-selected', on ? 'true' : 'false');
    });
}

function initSfMobilePeriodControl() {
    const root = document.getElementById('sfMobilePeriod');
    if (!root || root.dataset.bound === '1') return;
    root.dataset.bound = '1';
    root.querySelectorAll('[data-sf-period]').forEach((btn) => {
        btn.addEventListener('click', () => {
            const p = btn.getAttribute('data-sf-period');
            if (!p) return;
            syncSfMobilePeriodUi(p);
            setDashboardPeriod(p);
        });
    });
    syncSfMobilePeriodUi(currentDashboardPeriod);
}

function initSfMobileHeaderScroll() {
    if (document.documentElement.dataset.sfHeaderScrollBound === '1') return;
    document.documentElement.dataset.sfHeaderScrollBound = '1';
    const header = document.getElementById('mobileAppHeader');
    const main = document.querySelector('.dashboard-main');
    if (!header || !main) return;
    const update = () => {
        const top = Math.max(main.scrollTop || 0, window.scrollY || 0);
        header.classList.toggle('is-scrolled', top > 4);
    };
    main.addEventListener('scroll', update, { passive: true });
    window.addEventListener('scroll', update, { passive: true });
    update();
}

function closeMobileMoreSheet() {
    const backdrop = document.getElementById('mobileMoreBackdrop');
    const sheet = document.getElementById('mobileMoreSheet');
    if (backdrop) backdrop.hidden = true;
    if (sheet) sheet.hidden = true;
    document.body.classList.remove('mobile-more-open');
}

function openMobileMoreSheet() {
    const backdrop = document.getElementById('mobileMoreBackdrop');
    const sheet = document.getElementById('mobileMoreSheet');
    if (!backdrop || !sheet) return;
    closeSfFabSheet();
    backdrop.hidden = false;
    sheet.hidden = false;
    document.body.classList.add('mobile-more-open');
}

function updateMobileChromeVisibility() {
    const header = document.getElementById('mobileAppHeader');
    const tabBar = document.getElementById('mobileTabBar');
    const phone = isMobile();
    const compact = isCompactNav();
    if (header) header.setAttribute('aria-hidden', compact ? 'false' : 'true');
    if (tabBar) tabBar.setAttribute('aria-hidden', phone ? 'false' : 'true');
    if (!phone) closeMobileMoreSheet();
}

function updateMobileMenuVisibility() {
    if (mobileMenuToggle && dashboardSidebar) {
        if (isCompactNav()) {
            mobileMenuToggle.style.display = 'flex';
        } else {
            mobileMenuToggle.style.display = 'none';
            setMobileMenuOpen(false);
        }
    }
    updateMobileChromeVisibility();
}

function applySfMobileShell() {
    document.body.classList.toggle('sf-mobile-shell', sfMobileMq.matches);
    updateMobileMenuVisibility();
    if (!sfMobileMq.matches) closeSfFabSheet();
    else if (typeof currentPageName === 'string' && currentPageName === 'quotes' && typeof renderQuotesMobileFromCache === 'function') {
        renderQuotesMobileFromCache();
    }
    requestAnimationFrame(() => moveMobileTabThumb());
}

sfMobileMq.addEventListener('change', () => applySfMobileShell());

window.addEventListener('resize', () => {
    applySfMobileShell();
    if (!isCompactNav()) {
        setMobileMenuOpen(false);
    }
});

if (mobileMenuToggle && dashboardSidebar && mobileOverlay) {
    mobileMenuToggle.addEventListener('click', () => {
        const open = !dashboardSidebar.classList.contains('mobile-open');
        setMobileMenuOpen(open);
    });

    mobileOverlay.addEventListener('click', () => {
        setMobileMenuOpen(false);
    });

    dashboardSidebar.querySelectorAll('.nav-item').forEach((item) => {
        item.addEventListener('click', () => {
            if (item.tagName === 'SUMMARY') return;
            if (isCompactNav()) {
                dashboardSidebar.classList.remove('mobile-open');
                mobileOverlay.classList.remove('active');
            }
        });
    });
}
applySfMobileShell();

const mobileTabBarEl = document.getElementById('mobileTabBar');
if (mobileTabBarEl) {
    mobileTabBarEl.querySelectorAll('[data-mobile-tab]').forEach((btn) => {
        btn.addEventListener('click', () => {
            const t = btn.dataset.mobileTab;
            if (t === 'more') {
                closeSfFabSheet();
                openMobileMoreSheet();
                return;
            }
            closeMobileMoreSheet();
            closeSfFabSheet();
            if (t === 'customers') customersTypeFilter = '';
            showPage(t);
        });
    });
}

const mobileMoreSheetEl = document.getElementById('mobileMoreSheet');
if (mobileMoreSheetEl) {
    mobileMoreSheetEl.querySelectorAll('[data-page], [data-href]').forEach((btn) => {
        btn.addEventListener('click', () => {
            closeMobileMoreSheet();
            const href = btn.dataset.href;
            if (href) {
                window.location.href = href;
                return;
            }
            const p = btn.dataset.page;
            if (p) showPage(p);
        });
    });
}

document.getElementById('mobileMoreBackdrop')?.addEventListener('click', () => closeMobileMoreSheet());

document.getElementById('mobileMoreLogout')?.addEventListener('click', () => {
    document.getElementById('logoutBtn')?.click();
});

function openSfFabSheet() {
    const backdrop = document.getElementById('sfFabBackdrop');
    const sheet = document.getElementById('sfFabSheet');
    const fab = document.getElementById('sfMobileFab');
    if (!backdrop || !sheet) return;
    backdrop.hidden = false;
    backdrop.setAttribute('aria-hidden', 'false');
    sheet.hidden = false;
    document.body.classList.add('sf-fab-open');
    if (fab) {
        fab.classList.add('is-open');
        fab.setAttribute('aria-expanded', 'true');
    }
}

function closeSfFabSheet() {
    const backdrop = document.getElementById('sfFabBackdrop');
    const sheet = document.getElementById('sfFabSheet');
    const fab = document.getElementById('sfMobileFab');
    if (backdrop) {
        backdrop.hidden = true;
        backdrop.setAttribute('aria-hidden', 'true');
    }
    if (sheet) sheet.hidden = true;
    document.body.classList.remove('sf-fab-open');
    if (fab) {
        fab.classList.remove('is-open');
        fab.setAttribute('aria-expanded', 'false');
    }
}

document.getElementById('sfFabBackdrop')?.addEventListener('click', () => closeSfFabSheet());

document.getElementById('sfFabNewQuote')?.addEventListener('click', () => {
    closeSfFabSheet();
    window.location.href = 'quote-builder.html';
});
document.getElementById('sfFabNewClient')?.addEventListener('click', () => {
    closeSfFabSheet();
    customersTypeFilter = '';
    showPage('customers');
    if (typeof showNewCustomerModal === 'function') showNewCustomerModal();
});
document.getElementById('sfFabNewLead')?.addEventListener('click', () => {
    closeSfFabSheet();
    showPage('leads');
    const m = document.getElementById('newLeadModal');
    if (m) {
        m.classList.add('active');
        m.style.display = 'flex';
    }
});
document.getElementById('sfFabNewVisit')?.addEventListener('click', () => {
    closeSfFabSheet();
    showPage('schedule');
});

document.getElementById('sfMobileFab')?.addEventListener('click', () => {
    closeMobileMoreSheet();
    const sheet = document.getElementById('sfFabSheet');
    if (sheet && !sheet.hidden) closeSfFabSheet();
    else openSfFabSheet();
});

document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const fabSheet = document.getElementById('sfFabSheet');
    if (fabSheet && !fabSheet.hidden) {
        closeSfFabSheet();
        return;
    }
    const sheet = document.getElementById('mobileMoreSheet');
    if (sheet && !sheet.hidden) closeMobileMoreSheet();
});

// Navigation (só links da sidebar — nunca misturar com .nav-item noutros blocos)
const dashboardSidebarEl = document.getElementById('dashboardSidebar');
if (dashboardSidebarEl && !dashboardSidebarEl.dataset.navBound) {
    dashboardSidebarEl.dataset.navBound = '1';
    dashboardSidebarEl.addEventListener('click', (e) => {
        const item = e.target.closest('.nav-item');
        if (!item || !dashboardSidebarEl.contains(item)) return;
        if (item.tagName === 'SUMMARY') return;
        const href = (item.getAttribute('href') || '').trim();
        /* Folha obra e outros links reais (.html) — não interceptar */
        if (href && href !== '#' && !href.startsWith('#')) {
            return;
        }
        e.preventDefault();
        const page = item.dataset.page;
        const ct = item.getAttribute('data-customers-type');
        if (page === 'customers') {
            customersTypeFilter = ct === 'builder' ? 'builder' : '';
        }
        if (page) showPage(page);
    });
}

function showPage(pageName) {
    if (!pageName || typeof pageName !== 'string') return;

    if (pageName === 'crm') pageName = 'leads';

    // Standalone module panels (Jobs-style)
    if (pageName === 'leads') {
        window.location.href = 'leads.html';
        return;
    }
    if (pageName === 'quotes') {
        window.location.href = 'quotes.html';
        return;
    }
    if (pageName === 'invoices') {
        window.location.href = 'invoices.html';
        return;
    }
    if (pageName === 'users') {
        window.location.href = 'equipe.html';
        return;
    }

    // SaaS: modules not offered in this product surface
    const saasDisabledPages = new Set([
      'marketing',
      'schedule',
      'projects',
      'activities',
      'financeiro',
    ]);
    if (saasDisabledPages.has(pageName)) {
      pageName = 'dashboard';
    }

    if (pageName === 'financeiro') {
        window.location.href = 'financial.html';
        return;
    }

    const contentRoot = document.querySelector('.dashboard-main .dashboard-content');
    const pages = contentRoot
        ? contentRoot.querySelectorAll(':scope > .page-content')
        : document.querySelectorAll('.dashboard-main .page-content');
    pages.forEach((p) => {
        p.classList.remove('is-active');
        p.style.setProperty('display', 'none', 'important');
    });

    const side = document.getElementById('dashboardSidebar');
    if (side) {
        side.querySelectorAll('.sidebar-nav .nav-item').forEach((n) => n.classList.remove('active'));
    }

    const pageEl = document.getElementById(pageName + 'Page');
    if (pageEl) {
        pageEl.classList.add('is-active');
        pageEl.style.setProperty('display', 'flex', 'important');
        let navLink = null;
        if (side && pageName) {
            if (pageName === 'customers') {
                if (customersTypeFilter === 'builder') {
                    navLink = side.querySelector('.nav-item[data-page="customers"][data-customers-type="builder"]');
                } else {
                    navLink = side.querySelector('.nav-item[data-page="customers"]:not([data-customers-type])');
                }
            } else {
                navLink = side.querySelector(`[data-page="${pageName}"]`);
            }
        }
        if (navLink) navLink.classList.add('active');
        syncSidebarCadastroDropdowns();
        currentPageName = pageName;
        
        // Load page data
        if (pageName === 'dashboard') loadDashboard();
        else if (pageName === 'marketing') {
            if (typeof initMarketingPage === 'function') initMarketingPage();
            if (typeof loadMarketingDashboard === 'function') loadMarketingDashboard();
        }
        else if (pageName === 'leads') {
            currentPage = 1;
            if (typeof loadCRMKanban === 'function') {
                void loadCRMKanban();
            } else if (typeof loadKanbanBoard === 'function') {
                void loadKanbanBoard();
            } else {
                loadLeads();
            }
        }
        else if (pageName === 'customers') {
            customersPage = 1;
            syncCustomersPageChrome();
            loadCustomers();
        }
        else if (pageName === 'quotes') {
            currentPage = 1;
            if (typeof updateQuotesFilterChipStyles === 'function') updateQuotesFilterChipStyles();
            loadQuotes();
        }
        else if (pageName === 'invoices') {
            invoicesListPage = 1;
            if (typeof updateInvoicesFilterChipStyles === 'function') updateInvoicesFilterChipStyles();
            loadInvoices();
        }
        else if (pageName === 'projects') { currentPage = 1; loadProjects(); }
        else if (pageName === 'schedule') { 
            currentPage = 1; 
            if (typeof loadScheduleData === 'function') {
                loadScheduleData();
            } else {
                loadVisits(); // Fallback to old visits
            }
        }
        else if (pageName === 'financeiro') { 
            currentPage = 1; 
            if (typeof showFinancialView === 'function') {
                showFinancialView('dashboard');
            } else {
                loadContracts(); // Fallback
            }
        }
        else if (pageName === 'activities') { currentPage = 1; loadActivities(); }
        else if (pageName === 'users') { currentPage = 1; loadUsers(); }

        syncMobileAppChrome(pageName);
        if (isCompactNav()) setMobileMenuOpen(false);
    }
}

window.showPage = showPage;

// Dashboard operacional (GET /api/dashboard/stats?period=)
function formatDashboardCurrency(v) {
    const n = parseFloat(v);
    const x = Number.isFinite(n) ? n : 0;
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
    }).format(x);
}

/** KPIs grandes: compacto acima de $1k */
function formatDashboardCompact(v) {
    const n = parseFloat(v);
    const x = Number.isFinite(n) ? n : 0;
    if (x >= 1000000) return '$' + (x / 1000000).toFixed(1) + 'M';
    if (x >= 1000) return '$' + (x / 1000).toFixed(0) + 'k';
    return formatDashboardCurrency(x);
}

function formatDashboardPercent(v) {
    const n = parseFloat(v);
    const x = Number.isFinite(n) ? n : 0;
    return `${x.toFixed(1)}%`;
}

function dashKpiProgPct(value, cap) {
    const n = parseFloat(value);
    const x = Number.isFinite(n) ? n : 0;
    return Math.min(100, Math.max(0, cap > 0 ? (x / cap) * 100 : 0));
}

function setDashboardPeriod(p) {
    if (!['today', 'week', 'month', 'overall'].includes(p)) return;
    currentDashboardPeriod = p;
    document.querySelectorAll('[data-dash-period]').forEach((btn) => {
        const on = btn.getAttribute('data-dash-period') === p;
        btn.classList.toggle('dash-period--active', on);
        btn.classList.toggle('active', on);
    });
    loadDashboard(p);
}
window.setDashboardPeriod = setDashboardPeriod;

function showDashboardSkeletons() {
    const root = document.getElementById('dashInsightsRoot');
    if (root) root.classList.add('dash-skeleton');
}

function hideDashboardSkeletons() {
    const root = document.getElementById('dashInsightsRoot');
    if (root) root.classList.remove('dash-skeleton');
}

function handleDashboardActionUrl(url) {
    if (!url) return;
    const u = String(url).toLowerCase();
    if (u.includes('schedule') || u.endsWith('/schedule') || u.includes('/projects') || u.includes('/reports')) {
        showPage('dashboard');
        return;
    }
    if (u.includes('lead') || u.includes('filter=no_contact') || u.includes('crm')) {
        showPage('leads');
        return;
    }
    showPage('leads');
}

function dashLocalYmd(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

function dashLocalYm(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    return `${y}-${m}`;
}

/** @type {Record<string, any>} */
const _dashCharts = {};

function destroyDashChart(id) {
    const ch = _dashCharts[id];
    if (ch) {
        ch.destroy();
        delete _dashCharts[id];
    }
}

const SF_CHART_COLORS = {
    navy: '#1a2036',
    navy2: '#252b47',
    navy3: '#2a3150',
    gold3: '#c9a882',
    gold4: '#b8906a',
    gold5: '#a07850',
    ok: '#2d6e4a',
    warn: '#8f5010',
    bad: '#8f2020',
};

const SOURCE_CHART_COLORS = [
    SF_CHART_COLORS.navy,
    SF_CHART_COLORS.gold3,
    SF_CHART_COLORS.gold4,
    SF_CHART_COLORS.gold5,
    SF_CHART_COLORS.ok,
    SF_CHART_COLORS.warn,
];
const PROPOSAL_CHART_COLORS = {
    accepted: SF_CHART_COLORS.ok,
    sent: SF_CHART_COLORS.gold3,
    viewed: SF_CHART_COLORS.gold4,
    draft: SF_CHART_COLORS.navy2,
    declined: SF_CHART_COLORS.bad,
    expired: SF_CHART_COLORS.warn,
};
const SERVICE_CHART_COLORS = [SF_CHART_COLORS.navy, SF_CHART_COLORS.gold3, SF_CHART_COLORS.ok];

function dashSetText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
}

function dashBuildLegend(containerId, items) {
    const el = document.getElementById(containerId);
    if (!el) return;
    el.innerHTML = items
        .map(
            (item) => `
    <div style="display:flex;align-items:center;gap:6px;font-size:10px;color:var(--sf-navy)">
      <span style="width:8px;height:8px;border-radius:50%;background:${item.color};flex-shrink:0"></span>
      <span style="flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${item.label}</span>
      <span style="font-weight:700;font-size:11px;flex-shrink:0">${item.value}</span>
    </div>`,
        )
        .join('');
}

function dashCreateDonut(canvasId, labels, data, colors) {
    destroyDashChart(canvasId);
    const canvas = document.getElementById(canvasId);
    if (!canvas || typeof Chart === 'undefined') return;
    const ctx = canvas.getContext('2d');
    _dashCharts[canvasId] = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels,
            datasets: [
                {
                    data,
                    backgroundColor: colors,
                    borderWidth: 0,
                    hoverOffset: 4,
                },
            ],
        },
        options: {
            responsive: false,
            cutout: '68%',
            animation: { animateRotate: true, duration: 600 },
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: (c) => ` ${c.label}: ${c.parsed}`,
                    },
                },
            },
        },
    });
}

function renderFunnel(funnel) {
    const container = document.getElementById('funnel-rows');
    if (!container) {
        console.error('[FUNNEL] #funnel-rows não encontrado no HTML');
        return;
    }
    if (!funnel || !funnel.length) {
        container.innerHTML =
            '<div style="font-size:11px;color:var(--sf-muted);text-align:center;padding:16px">Sem dados no período</div>';
        return;
    }

    const normalized = funnel.map((s) => ({
        ...s,
        stage_key: s.stage_key || s.slug || '',
        count: parseInt(s.count, 10) || 0,
    }));

    const withData = normalized.filter((s) => s.count > 0);
    const toRender = withData.length > 0 ? withData : normalized;
    const max = Math.max(...toRender.map((s) => s.count), 1);

    const COLORS = {
        lead_received: '#1a2036',
        contact_made: '#252b47',
        qualified: '#2a3150',
        visit_scheduled: '#c9a882',
        measurement_done: '#c9a882',
        proposal_created: '#b8906a',
        proposal_sent: '#b8906a',
        negotiation: '#8f5010',
        closed_won: '#2d6e4a',
        production: '#2d6e4a',
    };

    const LABELS = {
        lead_received: 'Lead recebido',
        contact_made: 'Contato feito',
        qualified: 'Qualificado',
        visit_scheduled: 'Visita agend.',
        measurement_done: 'Medição feita',
        proposal_created: 'Proposta criada',
        proposal_sent: 'Proposta env.',
        negotiation: 'Negociação',
        closed_won: 'Fechado ✓',
        production: 'Em produção',
    };

    container.innerHTML = toRender
        .map((s) => {
            const pct = Math.max(Math.round((s.count / max) * 100), 4);
            const key = String(s.stage_key || '');
            const color = COLORS[key] || '#1a2036';
            const rawLabel = LABELS[key] || s.stage_name || key;
            const label = escapeHtmlCrm(rawLabel);
            return `
      <div class="dash-funnel__row sf-funnel-row" style="display:flex;align-items:center;gap:8px;cursor:pointer"
           role="button" tabindex="0"
           onclick="showPage('leads')"
           onkeydown="if(event.key==='Enter'){showPage('leads');}">
        <div style="font-size:10px;color:var(--sf-gold5);width:100px;flex-shrink:0;
                    font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
                    text-align:right">${label}</div>
        <div style="flex:1;height:17px;background:rgba(26,32,54,.07);border-radius:3px;overflow:hidden">
          <div style="height:100%;width:${pct}%;background:${color};border-radius:3px;
                      display:flex;align-items:center;padding-left:7px;
                      transition:width .5s cubic-bezier(.4,0,.2,1)">
            <span style="font-size:9px;font-weight:700;color:rgba(255,255,255,.9)">${s.count}</span>
          </div>
        </div>
      </div>`;
        })
        .join('');
}

function renderLeadsBySourceChart(sources) {
    const card = document.getElementById('card-chart-sources');
    if (card) card.style.opacity = '1';
    if (!sources?.length) {
        destroyDashChart('chart-sources');
        dashSetText('chart-sources-total', '—');
        dashSetText('chart-sources-sub', '0 total');
        dashBuildLegend('chart-sources-legend', []);
        return;
    }
    const total = sources.reduce((acc, r) => acc + (parseInt(r.count, 10) || 0), 0);
    const labels = sources.map((r) => r.source || 'direct');
    const data = sources.map((r) => parseInt(r.count, 10) || 0);
    const colors = labels.map((_, i) => SOURCE_CHART_COLORS[i % SOURCE_CHART_COLORS.length]);

    dashSetText('chart-sources-total', String(total));
    const sub = document.getElementById('chart-sources-sub');
    if (sub) sub.textContent = `${total} total`;

    dashCreateDonut('chart-sources', labels, data, colors);
    dashBuildLegend(
        'chart-sources-legend',
        labels.map((l, i) => ({
            label: l.charAt(0).toUpperCase() + l.slice(1),
            value: data[i],
            color: colors[i],
        })),
    );
}

function renderProposalsByStatusChart(proposals) {
    if (!proposals?.length) {
        destroyDashChart('chart-proposals');
        dashSetText('chart-proposals-total', '—');
        dashBuildLegend('chart-proposals-legend', []);
        return;
    }
    const total = proposals.reduce((acc, r) => acc + (parseInt(r.count, 10) || 0), 0);

    const STATUS_LABEL = {
        accepted: 'Aceitas',
        sent: 'Enviadas',
        viewed: 'Visualizadas',
        draft: 'Rascunho',
        declined: 'Recusadas',
        expired: 'Expiradas',
    };

    const filtered = proposals.filter((r) => parseInt(r.count, 10) > 0);
    const labels = filtered.map((r) => STATUS_LABEL[r.status] || r.status);
    const data = filtered.map((r) => parseInt(r.count, 10) || 0);
    const colors = filtered.map((r) => PROPOSAL_CHART_COLORS[r.status] || SF_CHART_COLORS.navy3);

    dashSetText('chart-proposals-total', String(total));
    dashCreateDonut('chart-proposals', labels, data, colors);
    dashBuildLegend(
        'chart-proposals-legend',
        labels.map((l, i) => ({
            label: l,
            value: data[i],
            color: colors[i],
        })),
    );
}

function renderRevenueByServiceChart(services) {
    const elCard = document.getElementById('card-chart-services');
    if (!services) {
        if (elCard) elCard.style.opacity = '0.5';
        return;
    }
    const supply = parseFloat(services.supply) || 0;
    const install = parseFloat(services.installation) || 0;
    const sand = parseFloat(services.sand_finish) || 0;
    const total = supply + install + sand;

    if (total === 0) {
        destroyDashChart('chart-services');
        if (elCard) elCard.style.opacity = '0.5';
        dashSetText('chart-services-total', '—');
        dashBuildLegend('chart-services-legend', []);
        return;
    }

    if (elCard) elCard.style.opacity = '1';

    const labels = ['Supply', 'Installation', 'Sand & Finish'];
    const data = [supply, install, sand];
    const colors = SERVICE_CHART_COLORS;

    const totEl = document.getElementById('chart-services-total');
    if (totEl) totEl.textContent = formatDashboardCompact(total);

    dashCreateDonut('chart-services', labels, data, colors);
    dashBuildLegend(
        'chart-services-legend',
        labels.map((l, i) => ({
            label: l,
            value: data[i] > 0 ? `${Math.round((data[i] / total) * 100)}%` : '0%',
            color: colors[i],
        })),
    );
}

function dashGetLast6Months() {
    const months = [];
    const now = new Date();
    for (let i = 5; i >= 0; i -= 1) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        months.push({
            key: dashLocalYm(d),
            label: d.toLocaleDateString('pt-BR', { month: 'short' }),
        });
    }
    return months;
}

function renderMonthlyRevenueChart(months) {
    destroyDashChart('chart-revenue');
    const canvas = document.getElementById('chart-revenue');
    if (!canvas || typeof Chart === 'undefined') return;

    if (!months || !months.length) {
        dashSetText('chart-revenue-avg', '—');
        const trendEl = document.getElementById('chart-revenue-trend');
        if (trendEl) {
            trendEl.textContent = '—';
            trendEl.style.color = 'var(--sf-muted)';
        }
    }

    const last6 = dashGetLast6Months();
    const dataMap = {};
    (months || []).forEach((m) => {
        dataMap[m.month] = parseFloat(m.revenue) || 0;
    });
    const revenues = last6.map((m) => dataMap[m.key] || 0);
    const labels = last6.map((m) => m.label);

    const nonZero = revenues.filter((v) => v > 0);
    const avg = nonZero.length ? nonZero.reduce((a, b) => a + b, 0) / nonZero.length : 0;
    const last = revenues[revenues.length - 1] || 0;
    const prev = revenues[revenues.length - 2] || 0;
    const trend = prev > 0 ? ((last - prev) / prev) * 100 : null;

    dashSetText('chart-revenue-avg', formatDashboardCompact(avg));
    const trendEl = document.getElementById('chart-revenue-trend');
    if (trendEl) {
        if (trend !== null && Number.isFinite(trend)) {
            const sign = trend >= 0 ? '↑' : '↓';
            trendEl.textContent = `${sign} ${Math.abs(Math.round(trend))}%`;
            trendEl.style.color = trend >= 0 ? 'var(--sf-ok)' : 'var(--sf-bad, #8f2020)';
        } else {
            trendEl.textContent = '—';
            trendEl.style.color = 'var(--sf-muted)';
        }
    }

    const ctx = canvas.getContext('2d');
    _dashCharts['chart-revenue'] = new Chart(ctx, {
        type: 'bar',
        data: {
            labels,
            datasets: [
                {
                    data: revenues,
                    backgroundColor: revenues.map((_, i) => (i === revenues.length - 1 ? '#1a2036' : '#c9a882')),
                    borderWidth: 0,
                    borderRadius: 4,
                },
            ],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: { duration: 600 },
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: (c) => ` ${formatDashboardCompact(c.parsed.y)}`,
                    },
                },
            },
            scales: {
                x: {
                    grid: { display: false },
                    border: { display: false },
                    ticks: {
                        font: { size: 10, family: "'Inter', sans-serif" },
                        color: '#8a8074',
                    },
                },
                y: {
                    grid: { color: 'rgba(26,32,54,.06)', drawBorder: false },
                    border: { display: false },
                    ticks: {
                        font: { size: 9, family: "'Inter', sans-serif" },
                        color: '#8a8074',
                        callback: (v) => formatDashboardCompact(v),
                    },
                },
            },
        },
    });
}

function renderLeadsTrend7dChart(rows) {
    destroyDashChart('chart-leads-trend');
    const canvas = document.getElementById('chart-leads-trend');
    if (!canvas || typeof Chart === 'undefined') return;

    const days = [];
    const now = new Date();
    for (let i = 6; i >= 0; i -= 1) {
        const d = new Date(now);
        d.setDate(d.getDate() - i);
        days.push({
            key: dashLocalYmd(d),
            label: d.toLocaleDateString('pt-BR', { weekday: 'short', day: 'numeric' }),
        });
    }
    const map = {};
    (rows || []).forEach((r) => {
        const k = r.day_key != null ? String(r.day_key).slice(0, 10) : '';
        map[k] = parseInt(r.count, 10) || 0;
    });
    const data = days.map((d) => map[d.key] || 0);
    const labels = days.map((d) => d.label);

    const ctx = canvas.getContext('2d');
    _dashCharts['chart-leads-trend'] = new Chart(ctx, {
        type: 'line',
        data: {
            labels,
            datasets: [
                {
                    data,
                    borderColor: '#1a2036',
                    backgroundColor: 'rgba(201,168,130,0.15)',
                    fill: true,
                    tension: 0.35,
                    pointRadius: 3,
                    pointBackgroundColor: '#c9a882',
                },
            ],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: { duration: 500 },
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: (c) => ` ${c.parsed.y} leads`,
                    },
                },
            },
            scales: {
                x: {
                    grid: { display: false },
                    border: { display: false },
                    ticks: { font: { size: 9 }, color: '#8a8074', maxRotation: 45 },
                },
                y: {
                    beginAtZero: true,
                    grid: { color: 'rgba(26,32,54,.06)' },
                    border: { display: false },
                    ticks: { stepSize: 1, font: { size: 9 }, color: '#8a8074' },
                },
            },
        },
    });
}

function renderDashboardCharts(d) {
    if (typeof Chart === 'undefined') {
        console.warn('[dashboard] Chart.js não carregado; gráficos omitidos.');
        return;
    }
    const ch = d.charts;
    if (!ch) return;
    renderLeadsBySourceChart(ch.leads_by_source);
    renderProposalsByStatusChart(ch.proposals_by_status);
    renderRevenueByServiceChart(ch.revenue_by_service);
    renderMonthlyRevenueChart(ch.monthly_revenue);
    renderLeadsTrend7dChart(ch.leads_trend_7d);
}

async function loadDashboard(period) {
    const p = period && ['today', 'week', 'month', 'overall'].includes(period) ? period : currentDashboardPeriod;
    currentDashboardPeriod = p;
    document.querySelectorAll('[data-dash-period]').forEach((btn) => {
        const on = btn.getAttribute('data-dash-period') === p;
        btn.classList.toggle('dash-period--active', on);
        btn.classList.toggle('active', on);
    });
    syncSfMobilePeriodUi(p);

    const errBanner = document.getElementById('dashErrorBanner');
    if (errBanner) {
        errBanner.style.display = 'none';
        errBanner.textContent = '';
    }
    showDashboardSkeletons();

    try {
        const response = await fetch(`/api/dashboard/stats?period=${encodeURIComponent(p)}`, { credentials: 'include' });
        const data = await response.json();

        if (data.success) {
            dashboardStats = data;
            renderDashboardStats();
        } else if (errBanner) {
            errBanner.textContent = data.error || 'Não foi possível carregar o dashboard.';
            errBanner.style.display = 'block';
        }
    } catch (error) {
        console.error('Dashboard error:', error);
        if (errBanner) {
            errBanner.textContent = 'Erro ao carregar dados. Tente novamente.';
            errBanner.style.display = 'block';
        }
    } finally {
        hideDashboardSkeletons();
    }
}
window.loadDashboard = loadDashboard;

function renderDashboardStats() {
    if (!dashboardStats || !dashboardStats.pipeline) return;

    const d = dashboardStats;
    const pl = d.pipeline || {};
    const conv = d.conversion || {};
    const fin = d.financial || {};

    const nameEl = document.getElementById('sidebarUserName');
    const name = nameEl ? String(nameEl.textContent || '').trim() : '';
    const h = new Date().getHours();
    let greet = 'Bom dia';
    if (h >= 12 && h < 18) greet = 'Boa tarde';
    else if (h >= 18) greet = 'Boa noite';
    const greetLine = document.getElementById('dashGreetingLine');
    if (greetLine) greetLine.textContent = name ? `${greet}, ${name}` : greet;

    const eyebrow = document.getElementById('dashPageEyebrow');
    if (eyebrow) {
        const pe =
            d.period === 'today'
                ? 'Visão geral · hoje'
                : d.period === 'week'
                  ? 'Visão geral · últimos 7 dias'
                  : d.period === 'overall'
                    ? 'Visão geral · todo o histórico'
                    : 'Visão geral · mês corrente';
        eyebrow.textContent = pe;
    }

    const subLine = document.getElementById('dashSubtitleLine');
    if (subLine) {
        const longDate = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'long' }).format(new Date());
        subLine.textContent = `Atualizado agora · ${longDate}`;
    }

    const urgentCount = d.new_leads_urgent_count || 0;
    const bannerEl = document.getElementById('urgentLeadsBanner');
    const bannerText = document.getElementById('urgentLeadsBannerText');
    if (bannerEl && bannerText) {
        if (urgentCount > 0) {
            bannerText.textContent =
                '⚠️ Você tem ' + urgentCount + ' lead(s) novo(s). Contate em até 30 minutos!';
            bannerEl.style.display = 'flex';
        } else {
            bannerEl.style.display = 'none';
        }
    }

    const alertsBar = document.getElementById('dashAlertsBar');
    if (alertsBar) {
        const alerts = Array.isArray(d.alerts) ? d.alerts : [];
        const icons = { warning: '⚠️', danger: '🔴', info: 'ℹ️' };
        alertsBar.innerHTML = alerts
            .map((a) => {
                const t = a.type === 'danger' ? 'danger' : a.type === 'info' ? 'info' : 'warning';
                const msg = escapeHtmlCrm(a.message || '');
                const cnt = Number(a.count) || 0;
                const url = escapeHtmlCrm(a.action_url || '#');
                return `<a href="#" class="sf-alert dash-alert dash-alert--${t}" onclick="event.preventDefault(); handleDashboardActionUrl('${url}');">
                    <span class="sf-alert-pip" aria-hidden="true"></span>
                    <span class="sf-alert-text">${icons[t]} ${msg} <strong>(${cnt})</strong></span>
                    <span class="sf-alert-cta">Abrir →</span>
                </a>`;
            })
            .join('');
    }

    const openValNum = parseFloat(pl.proposals_open_value);
    const openVal = Number.isFinite(openValNum) ? openValNum : 0;
    const closedValNum = parseFloat(pl.closed_won_value);
    const closedVal = Number.isFinite(closedValNum) ? closedValNum : 0;
    const avgDealNum = parseFloat(conv.avg_deal_value);
    const avgDeal = Number.isFinite(avgDealNum) ? avgDealNum : 0;
    const revMonthNum = parseFloat(fin.revenue_month);
    const revMonth = Number.isFinite(revMonthNum) ? revMonthNum : 0;

    const row1 = document.getElementById('dashKpiRow1');
    if (row1) {
        const periodBadge =
            d.period === 'today'
                ? 'hoje'
                : d.period === 'week'
                  ? '7 dias'
                  : d.period === 'overall'
                    ? 'geral'
                    : 'mês';
        const badgeLeads =
            pl.leads_new_today > 0 ? `+${pl.leads_new_today} hoje` : escapeHtmlCrm(periodBadge);
        const badgeVis = pl.visits_today > 0 ? `${pl.visits_today} hoje` : escapeHtmlCrm(periodBadge);
        const badgeVisDone = escapeHtmlCrm(periodBadge);
        const leadsInProp = Number(pl.leads_in_proposal) || 0;
        const badgeProposalPipeline =
            pl.proposals_open_count > 0 ? `${pl.proposals_open_count} em aberto (docs)` : 'pipeline';
        row1.innerHTML = `
            <div class="sf-card">
                <div class="sf-card__head">
                    <div class="sf-card-ic" aria-hidden="true"><span class="sf-card-ic-emoji">📥</span></div>
                    <span class="sf-card-badge">${badgeLeads}</span>
                </div>
                <div class="sf-card-val">${pl.leads_received}</div>
                <div class="sf-card-lbl">Leads recebidos</div>
                <div class="sf-card-sub">Criados no período selecionado</div>
                <div class="sf-card-prog"><div class="sf-card-pf" style="width:${dashKpiProgPct(pl.leads_received, 50)}%"></div></div>
            </div>
            <div class="sf-card">
                <div class="sf-card__head">
                    <div class="sf-card-ic" aria-hidden="true"><span class="sf-card-ic-emoji">🗓️</span></div>
                    <span class="sf-card-badge">${badgeVis}</span>
                </div>
                <div class="sf-card-val">${pl.visits_scheduled}</div>
                <div class="sf-card-lbl">Visitas agendadas</div>
                <div class="sf-card-sub">Com data agendada no período</div>
                <div class="sf-card-prog"><div class="sf-card-pf" style="width:${dashKpiProgPct(pl.visits_scheduled, 20)}%"></div></div>
            </div>
            <div class="sf-card">
                <div class="sf-card__head">
                    <div class="sf-card-ic" aria-hidden="true"><span class="sf-card-ic-emoji">✔️</span></div>
                    <span class="sf-card-badge">${badgeVisDone}</span>
                </div>
                <div class="sf-card-val">${pl.visits_completed}</div>
                <div class="sf-card-lbl">Visitas realizadas</div>
                <div class="sf-card-sub">Status concluída · por data de atualização</div>
                <div class="sf-card-prog"><div class="sf-card-pf" style="width:${dashKpiProgPct(pl.visits_completed, 20)}%"></div></div>
            </div>
            <div class="sf-card">
                <div class="sf-card__head">
                    <div class="sf-card-ic" aria-hidden="true"><span class="sf-card-ic-emoji">📄</span></div>
                    <span class="sf-card-badge">${escapeHtmlCrm(badgeProposalPipeline)}</span>
                </div>
                <div class="sf-card-val">${leadsInProp}</div>
                <div class="sf-card-lbl">Leads em proposta</div>
                <div class="sf-card-sub">Etapas: proposta criada, enviada, negociação</div>
                <div class="sf-card-prog"><div class="sf-card-pf" style="width:${dashKpiProgPct(leadsInProp, 15)}%"></div></div>
            </div>
            <div class="sf-card sf-warn">
                <div class="sf-card__head">
                    <div class="sf-card-ic" aria-hidden="true"><span class="sf-card-ic-emoji">💰</span></div>
                    <span class="sf-card-badge sf-card-badge--muted">${pl.proposals_open_count} itens</span>
                </div>
                <div class="sf-card-val">${openVal >= 1000 ? formatDashboardCompact(openVal) : formatDashboardCurrency(openVal)}</div>
                <div class="sf-card-lbl">Valor em aberto (pipeline)</div>
                <div class="sf-card-sub">${formatDashboardCurrency(openVal)} total · rascunho/enviado/visualizado</div>
                <div class="sf-card-prog"><div class="sf-card-pf" style="width:${dashKpiProgPct(openVal, 100000)}%"></div></div>
            </div>
            <div class="sf-card sf-ok">
                <div class="sf-card__head">
                    <div class="sf-card-ic" aria-hidden="true"><span class="sf-card-ic-emoji">✅</span></div>
                    <span class="sf-card-badge">${pl.closed_won_count} won</span>
                </div>
                <div class="sf-card-val">${formatDashboardCurrency(closedVal)}</div>
                <div class="sf-card-lbl">Valor fechado no período</div>
                <div class="sf-card-sub">Propostas, quotes e estimates aceites · ${pl.closed_won_count} lead(s) em etapa won</div>
                <div class="sf-card-prog"><div class="sf-card-pf" style="width:${dashKpiProgPct(closedVal, 100000)}%"></div></div>
            </div>
            <div class="sf-card">
                <div class="sf-card__head">
                    <div class="sf-card-ic" aria-hidden="true"><span class="sf-card-ic-emoji">🔨</span></div>
                    <span class="sf-card-badge">ativos</span>
                </div>
                <div class="sf-card-val">${pl.in_production}</div>
                <div class="sf-card-lbl">Em produção</div>
                <div class="sf-card-prog"><div class="sf-card-pf" style="width:${dashKpiProgPct(pl.in_production, 8)}%"></div></div>
            </div>`;
    }

    const row2 = document.getElementById('dashKpiRow2');
    if (row2) {
        const lv = Math.min(100, Math.max(0, parseFloat(conv.lead_to_visit_rate) || 0));
        const pw = Math.min(100, Math.max(0, parseFloat(conv.proposal_win_rate) || 0));
        const fPending = Number(pl.followups_pending) || 0;
        const fOverdue = Number(pl.followups_overdue) || 0;
        const fDueToday = Number(pl.followups_due_today) || 0;
        const fuBadge =
            fOverdue > 0
                ? `${fOverdue} atrasado(s)`
                : fDueToday > 0
                  ? `${fDueToday} hoje`
                  : 'pendentes';
        const fuCardClass = fOverdue > 0 ? 'sf-card sf-warn' : 'sf-card';
        row2.innerHTML = `
            <div class="${fuCardClass} sf-card--clickable" role="button" tabindex="0" title="Abrir pipeline (Leads)" onclick="showPage('leads')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();showPage('leads');}">
                <div class="sf-card__head">
                    <div class="sf-card-ic" aria-hidden="true"><span class="sf-card-ic-emoji">📌</span></div>
                    <span class="sf-card-badge">${escapeHtmlCrm(fuBadge)}</span>
                </div>
                <div class="sf-card-val">${fPending}</div>
                <div class="sf-card-lbl">Follow-ups</div>
                <div class="sf-card-sub">Tarefas abertas com lead · clique para o pipeline</div>
                <div class="sf-card-prog"><div class="sf-card-pf" style="width:${dashKpiProgPct(fPending, 25)}%"></div></div>
            </div>
            <div class="sf-card">
                <div class="sf-card__head">
                    <div class="sf-card-ic" aria-hidden="true"><span class="sf-card-ic-emoji">📈</span></div>
                    <span class="sf-card-badge">Lead → visita</span>
                </div>
                <div class="sf-card-val">${formatDashboardPercent(conv.lead_to_visit_rate)}</div>
                <div class="sf-card-lbl">Taxa lead → visita</div>
                <div class="sf-card-prog"><div class="sf-card-pf" style="width:${lv}%"></div></div>
            </div>
            <div class="sf-card">
                <div class="sf-card__head">
                    <div class="sf-card-ic" aria-hidden="true"><span class="sf-card-ic-emoji">🎯</span></div>
                    <span class="sf-card-badge">Propostas</span>
                </div>
                <div class="sf-card-val">${formatDashboardPercent(conv.proposal_win_rate)}</div>
                <div class="sf-card-lbl">Taxa proposta ganha</div>
                <div class="sf-card-sub">${Number(conv.proposal_wins) || 0} ganhos · ${Number(conv.proposal_losses) || 0} perdas no período · visita→prop. ${formatDashboardPercent(conv.visit_to_proposal_rate)}</div>
                <div class="sf-card-prog"><div class="sf-card-pf" style="width:${pw}%"></div></div>
            </div>
            <div class="sf-card sf-ok">
                <div class="sf-card__head">
                    <div class="sf-card-ic" aria-hidden="true"><span class="sf-card-ic-emoji">💵</span></div>
                    <span class="sf-card-badge">${d.period === 'overall' ? 'Total' : 'MTD'}</span>
                </div>
                <div class="sf-card-val">${formatDashboardCompact(revMonth)}</div>
                <div class="sf-card-lbl">${d.period === 'overall' ? 'Receita acumulada' : 'Receita do mês'}</div>
                <div class="sf-card-sub">${d.period === 'overall' ? 'Project financials · histórico completo' : 'Project financials'}</div>
                <div class="sf-card-prog"><div class="sf-card-pf" style="width:${dashKpiProgPct(revMonth, 25000)}%"></div></div>
            </div>
            <div class="sf-card">
                <div class="sf-card__head">
                    <div class="sf-card-ic" aria-hidden="true"><span class="sf-card-ic-emoji">🎫</span></div>
                    <span class="sf-card-badge">${pl.closed_won_count} fech.</span>
                </div>
                <div class="sf-card-val">${formatDashboardCompact(avgDeal)}</div>
                <div class="sf-card-lbl">Ticket médio (quotes)</div>
                <div class="sf-card-sub">${formatDashboardCurrency(avgDeal)} · ${Number(conv.avg_ticket_quotes_count) || 0} quotes · ${formatDashboardCompact(conv.avg_ticket_quotes_total || 0)} total</div>
                <div class="sf-card-prog"><div class="sf-card-pf" style="width:${dashKpiProgPct(avgDeal, 15000)}%"></div></div>
            </div>`;
    }

    renderFunnel(d.pipeline_funnel || d.charts?.pipeline_funnel || []);
    renderDashboardCharts(d);

    const recentEl = document.getElementById('dashRecentLeads');
    if (recentEl) {
        const list = Array.isArray(d.recent_leads) ? d.recent_leads : [];
        const stageClsForSlug = (slug) => {
            const s = String(slug || '');
            if (s === 'closed_won') return 'sf-stage-won';
            if (['proposal_created', 'proposal_sent', 'negotiation'].includes(s)) return 'sf-stage-prop';
            if (['visit_scheduled', 'measurement_done'].includes(s)) return 'sf-stage-vis';
            return 'sf-stage-new';
        };
        recentEl.innerHTML =
            list.length === 0
                ? '<li class="sf-dash-list-empty">Nenhum lead recente.</li>'
                : list
                      .map((l) => {
                          const badge = escapeHtmlCrm(l.pipeline_stage || '—');
                          const stCls = stageClsForSlug(l.slug);
                          const initials = String(l.name || '—')
                              .split(/\s+/)
                              .filter(Boolean)
                              .slice(0, 2)
                              .map((w) => w[0])
                              .join('')
                              .toUpperCase();
                          return `<li class="sf-dash-lead-row">
                            <div class="sf-dash-lead-avatar" aria-hidden="true">${escapeHtmlCrm(initials)}</div>
                            <div class="sf-dash-lead-main">
                              <div class="sf-dash-lead-name">${escapeHtmlCrm(l.name || '—')}</div>
                              <div class="sf-dash-lead-meta">${escapeHtmlCrm(l.time_ago || '')} · ${escapeHtmlCrm(l.source || '')}</div>
                            </div>
                            <span class="sf-stage ${stCls}">${badge}</span>
                          </li>`;
                      })
                      .join('');
    }

    const visitsEl = document.getElementById('dashVisitsToday');
    if (visitsEl) {
        const vlist = Array.isArray(d.visits_today_detail) ? d.visits_today_detail : [];
        visitsEl.innerHTML =
            vlist.length === 0
                ? '<li class="sf-dash-list-empty">Nenhuma visita hoje 🎉</li>'
                : vlist
                      .map((v) => {
                          const t = new Date(v.scheduled_at);
                          const timeStr = t.toLocaleTimeString('pt-BR', { hour: 'numeric', minute: '2-digit' });
                          return `<li class="sf-dash-lead-row">
                            <div class="sf-dash-lead-main">
                              <div class="sf-dash-lead-name">${escapeHtmlCrm(v.client_name || '—')}</div>
                              <div class="sf-dash-lead-meta">${timeStr}</div>
                            </div>
                            <span class="sf-stage sf-stage-vis">${escapeHtmlCrm(v.status || '')}</span>
                          </li>`;
                      })
                      .join('');
    }

    const insightHost = document.getElementById('dashInsightCards');
    if (insightHost) {
        const cards = [];
        if (pl.contact_pending > 0) {
            cards.push(`<div class="sf-dash-insight sf-dash-insight--warn">
                <div class="sf-dash-insight__ic" aria-hidden="true">⚠</div>
                <div class="sf-dash-insight__body">
                  <p><strong>${pl.contact_pending}</strong> lead(s) aguardam primeiro contato há mais de 24h.</p>
                  <button type="button" class="sf-dash-insight__btn" onclick="showPage('leads')">Ver leads →</button>
                </div>
            </div>`);
        }
        if (pl.visits_today > 0) {
            cards.push(`<div class="sf-dash-insight sf-dash-insight--info">
                <div class="sf-dash-insight__ic" aria-hidden="true">📅</div>
                <div class="sf-dash-insight__body">
                  <p><strong>${pl.visits_today}</strong> visita(s) hoje.</p>
                  <button type="button" class="sf-dash-insight__btn" onclick="showPage('leads')">Ver leads →</button>
                </div>
            </div>`);
        }
        if (pl.proposals_open_count > 5) {
            cards.push(`<div class="sf-dash-insight sf-dash-insight--warn">
                <div class="sf-dash-insight__ic" aria-hidden="true">📄</div>
                <div class="sf-dash-insight__body">
                  <p><strong>${pl.proposals_open_count}</strong> propostas em aberto precisam de follow-up.</p>
                  <button type="button" class="sf-dash-insight__btn" onclick="showPage('leads')">Ver pipeline →</button>
                </div>
            </div>`);
        }
        if (pl.closed_won_count === 0 && closedVal < 0.005) {
            cards.push(`<div class="sf-dash-insight sf-dash-insight--muted">
                <div class="sf-dash-insight__ic" aria-hidden="true">ℹ</div>
                <div class="sf-dash-insight__body">
                  <p>Nenhum fechamento no período (pipeline nem valor de quotes/estimates aceites). Envios: <strong>${pl.proposals_sent}</strong>.</p>
                </div>
            </div>`);
        }
        if (fin.profit_month < 0) {
            cards.push(`<div class="sf-dash-insight sf-dash-insight--bad">
                <div class="sf-dash-insight__ic" aria-hidden="true">⚠</div>
                <div class="sf-dash-insight__body">
                  <p>Margem negativa este mês. Revise os custos.</p>
                  <button type="button" class="sf-dash-insight__btn" onclick="showPage('quotes')">Ver quotes →</button>
                </div>
            </div>`);
        }
        insightHost.innerHTML =
            cards.length > 0
                ? cards.join('')
                : '<p class="sf-dash-list-empty">Nenhuma ação sugerida no momento.</p>';
    }

    renderSfMobileDashboardBlocks();
    loadSfMobileRecentQuotes();
}

function renderSfMobileDashboardBlocks() {
    if (!dashboardStats || !dashboardStats.pipeline) return;
    const d = dashboardStats;
    const pl = d.pipeline;
    const fin = d.financial || {};
    const conv = d.conversion || {};

    const greetingEl = document.getElementById('sfMobileGreeting');
    const nameEl = document.getElementById('sidebarUserName');
    const name = nameEl ? String(nameEl.textContent || '').trim() : '';
    const h = new Date().getHours();
    let g = 'Bom dia';
    if (h >= 12 && h < 18) g = 'Boa tarde';
    else if (h >= 18) g = 'Boa noite';
    if (greetingEl) {
        greetingEl.textContent = name ? `${g}, ${name}` : g;
        greetingEl.style.color = 'var(--sf-navy, #1a2036)';
        greetingEl.style.fontSize = '20px';
        greetingEl.style.fontWeight = '700';
    }

    const openVal = formatDashboardCompact(pl.proposals_open_value);
    const closedVal = formatDashboardCompact(pl.closed_won_value);
    const kpiGrid = document.getElementById('sfMobileKpiGrid');
    if (kpiGrid) {
        const mFu = Number(pl.followups_pending) || 0;
        const mFuOd = Number(pl.followups_overdue) || 0;
        kpiGrid.innerHTML = `
            <div class="sf-kpi-card touchable" onclick="showPage('leads')">
                <div class="sf-kpi-card__value">${mFu}</div>
                <div class="sf-kpi-card__label">Follow-ups</div>
                <div class="sf-kpi-card__meta">${mFuOd > 0 ? mFuOd + ' atras.' : 'abertos'}</div>
            </div>
            <div class="sf-kpi-card touchable">
                <div class="sf-kpi-card__value">${pl.leads_received}</div>
                <div class="sf-kpi-card__label">Leads (período)</div>
            </div>
            <div class="sf-kpi-card touchable">
                <div class="sf-kpi-card__value">${openVal}</div>
                <div class="sf-kpi-card__label">Em aberto</div>
                <div class="sf-kpi-card__meta">${pl.proposals_open_count || 0} orç./prop.</div>
            </div>
            <div class="sf-kpi-card touchable">
                <div class="sf-kpi-card__value">${closedVal}</div>
                <div class="sf-kpi-card__label">Fechado (valor)</div>
                <div class="sf-kpi-card__meta">${pl.closed_won_count || 0} leads won · ${d.period === 'today' ? 'hoje' : d.period === 'week' ? '7 dias' : d.period === 'overall' ? 'geral' : 'mês'}</div>
            </div>
            <div class="sf-kpi-card touchable">
                <div class="sf-kpi-card__value">${formatDashboardPercent(conv.proposal_win_rate)}</div>
                <div class="sf-kpi-card__label">Win rate</div>
            </div>`;
    }

    const qa = document.getElementById('sfMobileQuickActions');
    if (qa) {
        qa.innerHTML = `
            <button type="button" class="sf-quick-pill touchable" data-crm-permission="quotes.edit" onclick="location.href='quote-builder.html'"><span aria-hidden="true">+</span> Quote</button>
            <button type="button" class="sf-quick-pill touchable" data-crm-permission="customers.create" onclick="showPage('customers'); showNewCustomerModal();"><span aria-hidden="true">+</span> Cliente</button>`;
    }
    if (typeof applyCrmNavPermissions === 'function') {
        applyCrmNavPermissions(crmUserPermissions, crmUserRole);
    }

    const act = document.getElementById('sfMobileActivityChips');
    if (act) {
        const chips = [];
        (d.new_leads_urgent || []).slice(0, 6).forEach((l) => {
            const nm = escapeHtmlCrm(l.name || 'Lead');
            chips.push(
                `<button type="button" class="sf-quick-pill touchable" onclick="showPage('leads')">${nm}</button>`
            );
        });
        (d.upcoming_visits || []).slice(0, 6).forEach((v) => {
            const label = escapeHtmlCrm(v.lead_name || v.customer_name || v.project_name || 'Visita');
            chips.push(
                `<button type="button" class="sf-quick-pill touchable" onclick="showPage('leads')">${label}</button>`
            );
        });
        act.innerHTML =
            chips.length > 0
                ? chips.join('')
                : '<span class="sf-caption" style="padding:8px 0;">Sem pendências urgentes na agenda</span>';
    }
}

async function loadSfMobileRecentQuotes() {
    const host = document.getElementById('sfMobileRecentQuotes');
    if (!host) return;
    host.innerHTML = sfQuotesMobileSkeleton(3);
    try {
        const r = await fetch('/api/quotes?page=1&limit=5', { credentials: 'include' });
        const d = await r.json();
        if (!d.success || !Array.isArray(d.data)) {
            host.innerHTML = '<p class="sf-caption">Não foi possível carregar orçamentos recentes.</p>';
            return;
        }
        if (d.data.length === 0) {
            host.innerHTML = sfQuotesMobileEmptyHtml();
            if (typeof applyCrmNavPermissions === 'function') {
                applyCrmNavPermissions(crmUserPermissions, crmUserRole);
            }
            return;
        }
        const canDeleteQuote =
            crmUserRole === 'admin' || (Array.isArray(crmUserPermissions) && crmUserPermissions.includes('quotes.edit'));
        host.innerHTML = d.data.map((q) => quoteMobileCardHtml(q, { canDelete: canDeleteQuote })).join('');
        bindSfQuoteCardInteractions(host);
        if (typeof applyCrmNavPermissions === 'function') {
            applyCrmNavPermissions(crmUserPermissions, crmUserRole);
        }
    } catch (e) {
        host.innerHTML = '<p class="sf-caption">Erro ao carregar orçamentos recentes.</p>';
    }
}

document.querySelectorAll('[data-dash-period]').forEach((btn) => {
    btn.addEventListener('click', () => setDashboardPeriod(btn.getAttribute('data-dash-period')));
});

if (!dashboardAutoRefreshTimer) {
    dashboardAutoRefreshTimer = setInterval(() => {
        if (currentPageName === 'dashboard') loadDashboard(currentDashboardPeriod);
    }, 5 * 60 * 1000);
}

// Leads
let leadsPage = 1;
const LEADS_PAGE_LIMIT = 50;
/** Filtro de texto na lista (nome, email, telefone, ID) — alinhado ao Kanban */
let leadsListSearch = '';

function leadsSearchSubmit() {
    const el = document.getElementById('leadsListSearchInput');
    leadsListSearch = el ? el.value.trim() : '';
    leadsPage = 1;
    if (typeof loadKanbanBoard === 'function') {
        void loadKanbanBoard();
    } else {
        loadLeads();
    }
}

function leadsSearchClear() {
    const el = document.getElementById('leadsListSearchInput');
    if (el) el.value = '';
    const mobile = document.getElementById('leadsMobileSearch');
    if (mobile) mobile.value = '';
    leadsListSearch = '';
    leadsPage = 1;
    if (typeof loadKanbanBoard === 'function') {
        void loadKanbanBoard();
    } else {
        loadLeads();
    }
}

async function loadLeads() {
    const tbody = document.getElementById('leadsTableBody');
    if (tbody) {
        tbody.innerHTML = '<tr><td colspan="9" class="text-center">Loading...</td></tr>';
    }
    
    try {
        await ensureLeadsPipelineColorMap();
        const qParam = leadsListSearch ? `&q=${encodeURIComponent(leadsListSearch)}` : '';
        const response = await fetch(
            `/api/leads?page=${leadsPage}&limit=${LEADS_PAGE_LIMIT}${qParam}`,
            { credentials: 'include' }
        );
        const data = await response.json();
        
        if (data.success && data.data) {
            if (tbody) {
                if (data.data.length === 0) {
                    tbody.innerHTML = '<tr><td colspan="9" class="text-center">No leads found</td></tr>';
                } else {
                    function isLeadUrgentNew(createdAt) {
                        if (!createdAt) return 0;
                        var end = new Date(new Date(createdAt).getTime() + 30 * 60000);
                        return Math.max(0, Math.ceil((end - new Date()) / 60000));
                    }
                    tbody.innerHTML = data.data.map(lead => {
                        var minLeft = isLeadUrgentNew(lead.created_at);
                        var urgentBadge = minLeft > 0 ? ' <span class="badge-urgent-new">Novo – ' + minLeft + ' min</span>' : '';
                        var stageColor = resolveLeadRowStageColor(lead);
                        var statusSlug = lead.status || 'new';
                        var statusLabel =
                            (lead.pipeline_stage_name && String(lead.pipeline_stage_name).trim()) ||
                            statusSlug.replace(/_/g, ' ');
                        return `<tr class="lead-table-row" style="--lead-stage-color: ${stageColor}">
                            <td>${lead.id}</td>
                            <td>${lead.name || '-'}${urgentBadge}</td>
                            <td>${lead.email || '-'}</td>
                            <td>${lead.phone || '-'}</td>
                            <td>${lead.zipcode || '-'}</td>
                            <td><span class="lead-status-pipeline" title="${escapeHtmlLeadList(statusLabel)}"><span class="lead-stage-color-dot" style="background-color: ${stageColor}" aria-hidden="true"></span><span class="badge badge-${statusSlug}">${escapeHtmlLeadList(statusLabel)}</span></span></td>
                            <td>${lead.source || '-'}</td>
                            <td>${lead.created_at ? new Date(lead.created_at).toLocaleDateString() : '-'}</td>
                            <td>
                                <button class="btn btn-sm" onclick="viewLead('${lead.id}')" title="Ver"><span class="action-btn-icon">V</span></button>
                                <button class="btn btn-sm" onclick="showAssignLeadModal('${lead.id}')" title="Designar"><span class="action-btn-icon">U</span></button>
                                <button class="btn btn-sm" onclick="showFollowupModal('${lead.id}')" title="Follow-up"><span class="action-btn-icon">D</span></button>
                                <button class="btn btn-sm btn-lead-delete" onclick="deleteLead('${lead.id}')" title="Excluir">✕</button>
                            </td>
                        </tr>`;
                    }).join('');
                }
            }
            
            const totalPages = Math.ceil(data.total / LEADS_PAGE_LIMIT);
            const pageInfo = document.getElementById('pageInfoLeads');
            if (pageInfo) pageInfo.textContent = `Page ${leadsPage} of ${totalPages || 1}`;
            const prevBtn = document.getElementById('prevPageLeads');
            if (prevBtn) prevBtn.disabled = leadsPage <= 1;
            const nextBtn = document.getElementById('nextPageLeads');
            if (nextBtn) nextBtn.disabled = leadsPage >= totalPages;
        }
    } catch (error) {
        if (tbody) {
            tbody.innerHTML = '<tr><td colspan="9" class="text-center">Error: ' + error.message + '</td></tr>';
        }
    }
}

function changePageLeads(delta) {
    leadsPage += delta;
    if (leadsPage < 1) leadsPage = 1;
    loadLeads();
}

async function refreshLeads() {
    leadsPage = 1;
    const searchEl = document.getElementById('leadsListSearchInput');
    leadsListSearch = searchEl ? searchEl.value.trim() : '';
    leadsPipelineSlugToColor = null;
    try {
        if (typeof loadCRMKanban === 'function') {
            await loadCRMKanban();
        } else if (typeof loadKanbanBoard === 'function') {
            if (typeof loadPipelineStages === 'function') await loadPipelineStages();
            await loadKanbanBoard();
        } else {
            await loadLeads();
        }
    } catch (e) {
        console.error('refreshLeads failed', e);
        const board = document.getElementById('kanbanBoard');
        if (board) {
            board.removeAttribute('aria-busy');
            if (!board.querySelector('.kanban-column')) {
                board.innerHTML =
                    '<p class="kanban-board-message kanban-board-message--error">Erro ao atualizar. Tente novamente.</p>';
            }
        }
    }
}

function viewLead(id) {
    window.location.href = `lead-detail.html?id=${id}`;
}

async function deleteLead(id) {
    if (!id || !confirm('Excluir este lead permanentemente? Esta ação não pode ser desfeita.')) return;
    try {
        const r = await fetch(`/api/leads/${encodeURIComponent(id)}`, { method: 'DELETE', credentials: 'include' });
        const d = await r.json().catch(() => ({}));
        if (!r.ok || !d.success) {
            if (typeof crmNotify === 'function') crmNotify(d.error || 'Não foi possível excluir o lead.', 'error');
            else alert(d.error || 'Não foi possível excluir o lead.');
            return;
        }
        if (typeof crmNotify === 'function') crmNotify('Lead excluído.', 'success');
        if (typeof loadKanbanBoard === 'function') loadKanbanBoard();
        else if (typeof loadCRMKanban === 'function') loadCRMKanban();
        else if (currentPageName === 'leads') loadLeads();
    } catch (e) {
        if (typeof crmNotify === 'function') crmNotify('Erro de rede ao excluir.', 'error');
        else alert('Erro de rede ao excluir.');
    }
}

// Make functions globally available
window.viewLead = viewLead;
window.deleteLead = deleteLead;
window.deleteQuote = deleteQuote;
window.leadsSearchSubmit = leadsSearchSubmit;
window.leadsSearchClear = leadsSearchClear;
window.refreshLeads = refreshLeads;

// Clients (/api/customers)
let customersPage = 1;
/** '' | 'builder' | … — filtro da lista em Clientes / Builders */
let customersTypeFilter = '';
let customersSearchFilter = '';
let customerInsightEditId = null;
/** In-memory custom rates while editing the client form: { [pricingItemId]: number } */
let clientCustomPricingRates = {};
let clientPricingCatalogCache = null;
let clientCustomPricingDraft = {};
let clientCustomPricingSearch = '';

const CUSTOMERS_TYPE_LABELS = {
    particular: 'Particular',
    builder: 'Builder',
    contractor: 'Contractor',
    loja: 'Loja',
    // legacy labels (pre-migration rows)
    residential: 'Particular',
    commercial: 'Loja',
    property_manager: 'Particular',
    investor: 'Particular',
};

const CUSTOMERS_ORG_TYPES = new Set(['builder', 'contractor', 'loja']);

function normalizeClientTypeUi(raw) {
    const v = String(raw || 'particular').toLowerCase();
    if (CUSTOMERS_ORG_TYPES.has(v) || v === 'particular') return v;
    if (v === 'commercial') return 'loja';
    return 'particular';
}

function isOrgClientType(type) {
    return CUSTOMERS_ORG_TYPES.has(normalizeClientTypeUi(type));
}

function syncCustomersPageChrome() {
    const isBuilder = customersTypeFilter === 'builder';
    const titleEl = document.getElementById('customersPageTitle');
    const subEl = document.getElementById('customersPageSubtitle');
    const nameCol = document.getElementById('customersColName');
    const typeSel = document.getElementById('customersTypeSelect');
    const searchEl = document.getElementById('customersSearchInput');

    if (titleEl) titleEl.textContent = isBuilder ? 'Builders' : 'Clientes';
    if (subEl) {
        subEl.textContent = isBuilder
            ? 'Empresas parceiras e contacto responsável'
            : 'Builders e clientes finais';
    }
    if (nameCol) nameCol.textContent = isBuilder ? 'Empresa' : 'Cliente';
    if (typeSel && typeSel.value !== customersTypeFilter) {
        typeSel.value = customersTypeFilter;
    }
    if (searchEl && searchEl.value !== customersSearchFilter) {
        searchEl.value = customersSearchFilter;
    }
}

/** Compact ref for UUID / long ids — full value stays in title / data-copy */
function shortRefId(id) {
    const s = String(id || '').trim();
    if (!s) return '';
    if (/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(s)) return s.slice(0, 8);
    if (s.length > 12) return s.slice(0, 8);
    return s;
}

function customerInitials(name) {
    const parts = String(name || '')
        .trim()
        .split(/\s+/)
        .filter(Boolean);
    if (!parts.length) return '?';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function customerLocalLabel(c) {
    const city = c.city != null ? String(c.city).trim() : '';
    const state = c.state != null ? String(c.state).trim() : '';
    if (city || state) return [city, state].filter(Boolean).join(', ');
    const addr = c.address != null ? String(c.address).trim() : '';
    if (!addr) return '';
    // Prefer a short tail when address is a full line
    const parts = addr.split(',').map((p) => p.trim()).filter(Boolean);
    if (parts.length >= 2) return parts.slice(-2).join(', ');
    return addr.length > 36 ? `${addr.slice(0, 34)}…` : addr;
}

function copyCustomerRef(btn) {
    const full = btn && btn.getAttribute('data-copy');
    if (!full || !navigator.clipboard) return;
    navigator.clipboard.writeText(full).then(() => {
        const prev = btn.textContent;
        btn.textContent = 'Copiado';
        btn.classList.add('is-copied');
        setTimeout(() => {
            btn.textContent = prev;
            btn.classList.remove('is-copied');
        }, 1200);
    }).catch(() => {});
}
window.copyCustomerRef = copyCustomerRef;

function customersSearchSubmit() {
    const searchEl = document.getElementById('customersSearchInput');
    const typeSel = document.getElementById('customersTypeSelect');
    customersSearchFilter = searchEl ? searchEl.value.trim() : '';
    customersTypeFilter = typeSel ? typeSel.value.trim() : '';
    customersPage = 1;
    syncCustomersPageChrome();
    loadCustomers();
}

function customersSearchClear() {
    customersSearchFilter = '';
    customersTypeFilter = '';
    customersPage = 1;
    const searchEl = document.getElementById('customersSearchInput');
    const typeSel = document.getElementById('customersTypeSelect');
    if (searchEl) searchEl.value = '';
    if (typeSel) typeSel.value = '';
    syncCustomersPageChrome();
    loadCustomers();
}

window.customersSearchSubmit = customersSearchSubmit;
window.customersSearchClear = customersSearchClear;

function fmtMoneyInsight(n) {
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
    }).format(parseFloat(n) || 0);
}

function customerViewOpenEdit() {
    const id = customerInsightEditId;
    if (id == null) return;
    if (typeof closeModal === 'function') closeModal('customerViewModal');
    viewCustomer(id);
}

function escapeClientCell(s) {
    if (s == null || s === '') return '';
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/"/g, '&quot;');
}

/** Até 10 dígitos → (XXX) XXX-XXXX */
function formatUsPhoneMaskFromDigits(raw) {
    const d = String(raw || '').replace(/\D/g, '').slice(0, 10);
    if (d.length === 0) return '';
    if (d.length <= 3) return `(${d}`;
    if (d.length <= 6) return `(${d.slice(0, 3)}) ${d.slice(3)}`;
    return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

function displayPhoneInClientForm(phone) {
    if (phone == null || phone === '') return '';
    const s = String(phone).trim();
    if (s === '—' || s === '-' || /^n\/?a$/i.test(s)) return '';
    let d = s.replace(/\D/g, '');
    if (d.length === 11 && d.startsWith('1')) d = d.slice(1);
    if (d.length === 10) return formatUsPhoneMaskFromDigits(d);
    return s;
}

async function loadCustomers() {
    syncCustomersPageChrome();
    const list = document.getElementById('customersTableBody');
    if (!list) return;
    list.innerHTML = '<p class="customers-list-empty">A carregar…</p>';

    try {
        const qs = new URLSearchParams({ page: String(customersPage), limit: '20' });
        if (customersTypeFilter) qs.set('customer_type', customersTypeFilter);
        if (customersSearchFilter) qs.set('search', customersSearchFilter);
        const response = await fetch(`/api/customers?${qs}`, { credentials: 'include' });
        const data = await response.json();

        if (data.success && data.data) {
            if (data.data.length === 0) {
                list.innerHTML = '<p class="customers-list-empty">Nenhum cliente encontrado</p>';
            } else {
                list.innerHTML = data.data.map((c, i) => {
                    const id = String(c.id || '');
                    const idAttr = escapeClientCell(id);
                    const shortId = shortRefId(id);
                    const leadId = c.lead_id != null && c.lead_id !== '' ? String(c.lead_id) : '';
                    const shortLead = leadId ? shortRefId(leadId) : '';
                    const isOrg = isOrgClientType(c.customer_type);
                    const typeLabel =
                        CUSTOMERS_TYPE_LABELS[normalizeClientTypeUi(c.customer_type)] ||
                        c.customer_type ||
                        '—';
                    const name = escapeClientCell(c.name) || '—';
                    const email = c.email ? escapeClientCell(c.email) : '';
                    const phoneRaw = c.phone ? displayPhoneInClientForm(c.phone) || String(c.phone) : '';
                    const phone = phoneRaw ? escapeClientCell(phoneRaw) : '';
                    const local = escapeClientCell(customerLocalLabel(c));
                    const status = escapeClientCell(c.status || 'active');
                    const resp =
                        isOrg && c.responsible_name
                            ? escapeClientCell(c.responsible_name)
                            : '';
                    const created = c.created_at
                        ? new Date(c.created_at).toLocaleDateString('pt-BR', {
                              day: '2-digit',
                              month: 'short',
                              year: 'numeric',
                          })
                        : '';

                    const leadChip = leadId
                        ? `<a class="customers-ref customers-ref--lead" href="lead-detail.html?id=${encodeURIComponent(leadId)}" title="Lead ${escapeClientCell(leadId)}" onclick="event.stopPropagation()">Lead · ${escapeClientCell(shortLead)}</a>`
                        : '';

                    const contactBits = [];
                    if (email) {
                        contactBits.push(
                            `<a class="customers-row__mail" href="mailto:${email}" onclick="event.stopPropagation()">${email}</a>`,
                        );
                    }
                    if (phone) contactBits.push(`<span class="customers-row__phone">${phone}</span>`);
                    if (!contactBits.length) contactBits.push('<span class="customers-row__muted">—</span>');

                    return `
                    <article class="customers-row" role="listitem" style="--av-hue:${(i * 47) % 360}">
                        <div class="customers-row__identity">
                            <span class="customers-row__av" aria-hidden="true">${escapeClientCell(customerInitials(c.name))}</span>
                            <div class="customers-row__who">
                                <div class="customers-row__name">${name}</div>
                                <div class="customers-row__refs">
                                    <button type="button" class="customers-ref" title="ID ${idAttr} — clicar para copiar" data-copy="${idAttr}" onclick="event.stopPropagation(); copyCustomerRef(this)">#${escapeClientCell(shortId)}</button>
                                    ${leadChip}
                                </div>
                                ${resp ? `<div class="customers-row__sub">Contacto: ${resp}</div>` : ''}
                                ${created ? `<div class="customers-row__sub customers-row__sub--soft">Desde ${escapeClientCell(created)}</div>` : ''}
                            </div>
                        </div>
                        <div class="customers-row__contact">${contactBits.join('')}</div>
                        <div class="customers-row__local">${local || '<span class="customers-row__muted">—</span>'}</div>
                        <div class="customers-row__type"><span class="customers-type-pill">${escapeClientCell(typeLabel)}</span></div>
                        <div class="customers-row__status"><span class="badge badge-${status}">${status}</span></div>
                        <div class="customers-row__actions">
                            <button type="button" class="btn btn-sm btn-secondary" onclick="inspectCustomer('${idAttr}')">Ver</button>
                            <button type="button" class="btn btn-sm" onclick="viewCustomer('${idAttr}')">Editar</button>
                        </div>
                    </article>`;
                }).join('');
            }

            const totalPages = Math.ceil((data.total || 0) / 20) || 1;
            document.getElementById('pageInfoCustomers').textContent =
                `Página ${customersPage} de ${totalPages}`;
            document.getElementById('prevPageCustomers').disabled = customersPage <= 1;
            document.getElementById('nextPageCustomers').disabled = customersPage >= totalPages;
        }
    } catch (error) {
        list.innerHTML = `<p class="customers-list-empty">Erro: ${escapeClientCell(error.message)}</p>`;
    }
}
function changePageCustomers(delta) {
    customersPage += delta;
    if (customersPage < 1) customersPage = 1;
    loadCustomers();
}

function syncClientFormBuilderFields() {
    const typeEl = document.getElementById('clientType');
    const nonRow = document.getElementById('clientNonBuilderNameRow');
    const bRow = document.getElementById('clientBuilderNameRow');
    const nameInp = document.getElementById('clientName');
    const compInp = document.getElementById('clientCompanyName');
    const respInp = document.getElementById('clientResponsibleName');
    if (!typeEl || !nonRow || !bRow) return;
    const isOrg = isOrgClientType(typeEl.value);
    nonRow.style.display = isOrg ? 'none' : '';
    bRow.style.display = isOrg ? '' : 'none';
    if (nameInp) {
        nameInp.required = !isOrg;
        if (isOrg) nameInp.removeAttribute('required');
    }
    if (compInp) compInp.required = isOrg;
    if (respInp) respInp.required = isOrg;
    const hint = document.getElementById('clientPricingModeHint');
    const actions = document.getElementById('clientPricingCustomActions');
    const isCustom = getClientPricingMode() === 'custom';
    if (actions) actions.hidden = !isCustom;
    updateClientCustomPricingCount();
    if (hint) {
        const t = normalizeClientTypeUi(typeEl.value);
        const labels = { particular: 'Particular', builder: 'Builder', contractor: 'Contractor', loja: 'Loja' };
        hint.textContent = isCustom
            ? 'Preços só deste cliente. Clique em «Editar preços customizados» para ajustar a lista de serviços.'
            : `Jobs e quotes usam a coluna «${labels[t] || t}» da Tabela de Valores.`;
    }
}

function getClientPricingMode() {
    const custom = document.getElementById('clientPricingModeCustom');
    if (custom && custom.checked) return 'custom';
    return 'table';
}

function setClientPricingMode(mode) {
    const table = document.getElementById('clientPricingModeTable');
    const custom = document.getElementById('clientPricingModeCustom');
    const isCustom = mode === 'custom';
    if (table) table.checked = !isCustom;
    if (custom) custom.checked = isCustom;
}

function updateClientCustomPricingCount() {
    const el = document.getElementById('clientCustomPricingCount');
    if (!el) return;
    const n = Object.keys(clientCustomPricingRates || {}).filter((k) => Number(clientCustomPricingRates[k]) > 0).length;
    el.textContent = n ? `${n} preço${n === 1 ? '' : 's'} definido${n === 1 ? '' : 's'}` : 'Nenhum preço customizado ainda';
}

function tableRateForCustomerType(item, customerType) {
    const t = normalizeClientTypeUi(customerType);
    const key =
        t === 'builder'
            ? 'price_builder'
            : t === 'contractor'
              ? 'price_contractor'
              : t === 'loja'
                ? 'price_loja'
                : 'price_particular';
    const preferred = Number(item[key]);
    if (Number.isFinite(preferred) && preferred > 0) return preferred;
    const fallbacks = [item.price_loja, item.price_min, item.price_builder, item.partner_price, item.price_particular, item.price_max];
    for (const c of fallbacks) {
        const n = Number(c);
        if (c != null && c !== '' && Number.isFinite(n) && n > 0) return n;
    }
    return 0;
}

async function loadClientPricingCatalog() {
    if (Array.isArray(clientPricingCatalogCache)) return clientPricingCatalogCache;
    const res = await fetch('/api/pricing', { credentials: 'include' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Não foi possível carregar a Tabela de Valores');
    clientPricingCatalogCache = Array.isArray(data.data) ? data.data : [];
    return clientPricingCatalogCache;
}

function renderClientCustomPricingList() {
    const box = document.getElementById('clientCustomPricingList');
    if (!box) return;
    const catalog = Array.isArray(clientPricingCatalogCache) ? clientPricingCatalogCache : [];
    const q = String(clientCustomPricingSearch || '').trim().toLowerCase();
    const type = normalizeClientTypeUi(document.getElementById('clientType')?.value);
    const rows = catalog.filter((s) => {
        if (!q) return true;
        const hay = [s.name, s.unit, s.category].map((x) => String(x || '').toLowerCase()).join(' ');
        return hay.includes(q);
    });
    if (!catalog.length) {
        box.innerHTML = '<p class="client-custom-pricing-empty">Nenhum serviço na Tabela de Valores.</p>';
        return;
    }
    if (!rows.length) {
        box.innerHTML = '<p class="client-custom-pricing-empty">Nenhum serviço corresponde à busca.</p>';
        return;
    }
    box.innerHTML = rows
        .map((s) => {
            const id = String(s.id);
            const tableRate = tableRateForCustomerType(s, type);
            const customVal = clientCustomPricingDraft[id];
            const shown =
                customVal != null && customVal !== '' && Number.isFinite(Number(customVal))
                    ? String(customVal)
                    : '';
            return `<div class="client-custom-pricing-row" data-id="${escapeClientCell(id)}">
                <div class="client-custom-pricing-row__name">${escapeClientCell(s.name || 'Serviço')}
                    <span class="client-custom-pricing-row__meta">${escapeClientCell(s.category || '')}</span>
                </div>
                <div class="client-custom-pricing-row__unit">${escapeClientCell(s.unit || '—')}</div>
                <div class="client-custom-pricing-row__table">Tabela<br><strong>${tableRate > 0 ? tableRate.toFixed(2) : '—'}</strong></div>
                    <input type="number" min="0" step="0.01" inputmode="decimal" data-custom-rate="${escapeClientCell(id)}" placeholder="${tableRate > 0 ? tableRate.toFixed(2) : '0.00'}" value="${escapeClientCell(shown)}" aria-label="Preço customizado" />
                </label>
            </div>`;
        })
        .join('');
    box.querySelectorAll('[data-custom-rate]').forEach((inp) => {
        inp.addEventListener('input', () => {
            const id = inp.getAttribute('data-custom-rate');
            const raw = String(inp.value || '').trim();
            if (!id) return;
            if (raw === '') {
                delete clientCustomPricingDraft[id];
                return;
            }
            const n = Number(raw);
            if (Number.isFinite(n) && n >= 0) clientCustomPricingDraft[id] = n;
        });
    });
}

async function openClientCustomPricingModal() {
    const modal = document.getElementById('clientCustomPricingModal');
    const list = document.getElementById('clientCustomPricingList');
    const intro = document.getElementById('clientCustomPricingIntro');
    const type = normalizeClientTypeUi(document.getElementById('clientType')?.value);
    const labels = { particular: 'Particular', builder: 'Builder', contractor: 'Contractor', loja: 'Loja' };
    if (intro) {
        intro.textContent = `Preços só deste cadastro. Coluna de referência da tabela: ${labels[type] || type}. Deixe em branco para manter o valor da tabela.`;
    }
    if (list) list.innerHTML = '<p class="client-custom-pricing-empty">A carregar serviços…</p>';
    if (modal) modal.style.display = 'flex';
    clientCustomPricingDraft = { ...(clientCustomPricingRates || {}) };
    clientCustomPricingSearch = '';
    const search = document.getElementById('clientCustomPricingSearch');
    if (search) search.value = '';
    try {
        await loadClientPricingCatalog();
        renderClientCustomPricingList();
    } catch (e) {
        if (list) list.innerHTML = `<p class="client-custom-pricing-empty">${escapeClientCell(e.message || 'Erro ao carregar')}</p>`;
    }
}

function closeClientCustomPricingModal() {
    const modal = document.getElementById('clientCustomPricingModal');
    if (modal) modal.style.display = 'none';
}

function applyClientCustomPricingModal() {
    const next = {};
    Object.keys(clientCustomPricingDraft || {}).forEach((id) => {
        const n = Number(clientCustomPricingDraft[id]);
        if (Number.isFinite(n) && n >= 0) next[id] = Math.round(n * 100) / 100;
    });
    clientCustomPricingRates = next;
    setClientPricingMode('custom');
    syncClientFormBuilderFields();
    closeClientCustomPricingModal();
}

function onClientPricingModeChange() {
    const mode = getClientPricingMode();
    if (mode === 'custom') {
        openClientCustomPricingModal();
    } else {
        // Keep saved overrides in memory in case they switch back, but UI shows table mode.
        syncClientFormBuilderFields();
    }
}

function resetClientForm() {
    const ids = [
        'clientFormId',
        'clientFormLeadId',
        'clientName',
        'clientCompanyName',
        'clientResponsibleName',
        'clientEmail',
        'clientPhone',
        'clientAddress',
        'clientCity',
        'clientState',
        'clientZip',
        'clientNotes',
        'clientFormError',
    ];
    ids.forEach((id) => {
        const el = document.getElementById(id);
        if (!el) return;
        if (id === 'clientFormError') {
            el.textContent = '';
            el.style.display = 'none';
        } else el.value = '';
    });
    const typeEl = document.getElementById('clientType');
    if (typeEl) typeEl.value = 'particular';
    setClientPricingMode('table');
    clientCustomPricingRates = {};
    const st = document.getElementById('clientStatus');
    if (st) st.value = 'active';
    syncClientFormBuilderFields();
}

function showNewCustomerModal() {
    resetClientForm();
    const t = document.getElementById('clientModalTitle');
    if (t) t.textContent = 'Novo cliente';
    const modal = document.getElementById('clientModal');
    if (modal) modal.style.display = 'flex';
}

async function inspectCustomer(id) {
    customerInsightEditId = id;
    const modal = document.getElementById('customerViewModal');
    const body = document.getElementById('customerViewBody');
    const title = document.getElementById('customerViewTitle');
    if (!modal || !body) return;
    body.innerHTML = '<p class="text-center text-muted" style="padding:2rem">A carregar…</p>';
    modal.style.display = 'flex';
    if (title) title.textContent = 'Cliente';
    try {
        const res = await fetch(`/api/customers/${encodeURIComponent(id)}/insight`, { credentials: 'include' });
        const data = await res.json();
        if (!data.success || !data.data) {
            body.innerHTML = `<p class="text-center" style="color:#c0392b;padding:2rem">${escapeClientCell(data.error || 'Erro ao carregar')}</p>`;
            return;
        }
        const { customer, lead_insight, builder_insight } = data.data;
        const isOrg = isOrgClientType(customer.customer_type);
        const typeLabel = CUSTOMERS_TYPE_LABELS[normalizeClientTypeUi(customer.customer_type)] || customer.customer_type;
        if (title) {
            title.textContent =
                isOrg && customer.responsible_name
                    ? `${customer.name || ''} · ${customer.responsible_name}`
                    : customer.name || 'Cliente';
        }
        const z = (v) => (v != null && String(v).trim() !== '' ? escapeClientCell(String(v)) : '—');
        let html = '';
        const pricingMode = (customer.pricing_mode || 'table') === 'custom' ? 'custom' : 'table';
        const customCount = customer.custom_pricing_rates
            ? Object.keys(customer.custom_pricing_rates).filter((k) => Number(customer.custom_pricing_rates[k]) > 0).length
            : 0;
        const pricingLabel =
            pricingMode === 'custom'
                ? customCount
                    ? `Customizar (${customCount})`
                    : 'Customizar'
                : 'Tabela de Valores';

        html += `<div class="customer-view-card" style="background:var(--bg-light,#f6f7f9);border-radius:10px;padding:14px 16px;margin-bottom:16px;">
            <p style="margin:0 0 8px;font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:var(--sf-muted,#666)">Cadastro</p>
            <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:10px 16px;font-size:14px;">
                <div><span style="color:var(--sf-muted,#666)">ID</span><br><strong title="${escapeClientCell(String(customer.id || ''))}">#${escapeClientCell(shortRefId(customer.id))}</strong></div>
                <div><span style="color:var(--sf-muted,#666)">Tipo</span><br><strong>${escapeClientCell(typeLabel)}</strong></div>
                <div><span style="color:var(--sf-muted,#666)">Preços</span><br><strong>${escapeClientCell(pricingLabel)}</strong></div>
                ${isOrg ? `<div><span style="color:var(--sf-muted,#666)">Empresa</span><br><strong>${z(customer.name)}</strong></div><div><span style="color:var(--sf-muted,#666)">Contato responsável</span><br><strong>${z(customer.responsible_name)}</strong></div>` : ''}
                <div><span style="color:var(--sf-muted,#666)">Email</span><br><strong>${z(customer.email)}</strong></div>
                <div><span style="color:var(--sf-muted,#666)">Telefone</span><br><strong>${z(customer.phone)}</strong></div>
                <div><span style="color:var(--sf-muted,#666)">Cidade</span><br><strong>${z(customer.city)}</strong></div>
                <div><span style="color:var(--sf-muted,#666)">Estado</span><br><strong>${z(customer.state)}</strong></div>
                <div><span style="color:var(--sf-muted,#666)">Status</span><br><strong>${z(customer.status)}</strong></div>
            </div>
            ${customer.address ? `<p style="margin:12px 0 0;font-size:13px;color:#333">${escapeClientCell(customer.address)}</p>` : ''}
            ${customer.notes ? `<p style="margin:10px 0 0;font-size:13px;color:#555"><em>Notas:</em> ${escapeClientCell(customer.notes)}</p>` : ''}
        </div>`;

        if (lead_insight && lead_insight.lead) {
            const L = lead_insight.lead;
            const pipe = L.pipeline_stage_name || L.pipeline_stage_slug || '—';
            html += `<div class="customer-view-card" style="border:1px solid rgba(26,32,54,.12);border-radius:10px;padding:14px 16px;margin-bottom:16px;">
                <p style="margin:0 0 10px;font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:var(--sf-muted,#666)">Origem — Lead · ${escapeClientCell(shortRefId(L.id))}</p>
                <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:10px 16px;font-size:14px;">
                    <div><span style="color:var(--sf-muted,#666)">Nome</span><br><strong>${z(L.name)}</strong></div>
                    <div><span style="color:var(--sf-muted,#666)">Email</span><br><strong>${z(L.email)}</strong></div>
                    <div><span style="color:var(--sf-muted,#666)">Telefone</span><br><strong>${z(L.phone)}</strong></div>
                    <div><span style="color:var(--sf-muted,#666)">Pipeline</span><br><strong>${escapeClientCell(pipe)}</strong></div>
                    <div><span style="color:var(--sf-muted,#666)">Estado (lead)</span><br><strong>${z(L.status)}</strong></div>
                    <div><span style="color:var(--sf-muted,#666)">Valor estimado</span><br><strong>${L.estimated_value != null ? fmtMoneyInsight(L.estimated_value) : '—'}</strong></div>
                    <div><span style="color:var(--sf-muted,#666)">Orçamentos</span><br><strong>${lead_insight.quotes_count ?? 0}</strong></div>
                    <div><span style="color:var(--sf-muted,#666)">Estimates</span><br><strong>${lead_insight.estimates_count ?? 0}</strong></div>
                </div>
                ${L.address ? `<p style="margin:12px 0 0;font-size:13px">${escapeClientCell(L.address)} ${L.zipcode ? escapeClientCell(String(L.zipcode)) : ''}</p>` : ''}
                <p style="margin:12px 0 0"><a class="btn btn-sm btn-secondary" href="lead-detail.html?id=${encodeURIComponent(L.id)}">Abrir ficha do lead</a></p>
            </div>`;
        } else if (!isB) {
            html += `<p class="text-muted" style="font-size:14px;margin-bottom:16px">Este cliente não está ligado a um lead na base de dados.</p>`;
        }

        if (builder_insight && builder_insight.aggregates) {
            const a = builder_insight.aggregates;
            const rows = builder_insight.projects || [];
            html += `<div class="customer-view-card" style="border:1px solid rgba(26,32,54,.12);border-radius:10px;padding:14px 16px;margin-bottom:8px;">
                <p style="margin:0 0 12px;font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:var(--sf-muted,#666)">Builder — Projetos e performance</p>
                <div class="stats-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:12px;margin-bottom:16px;">
                    <div style="background:var(--bg-light,#f6f7f9);border-radius:8px;padding:10px 12px;">
                        <div style="font-size:11px;color:var(--sf-muted,#666)">Projetos</div>
                        <div style="font-size:20px;font-weight:700">${a.project_count ?? 0}</div>
                    </div>
                    <div style="background:var(--bg-light,#f6f7f9);border-radius:8px;padding:10px 12px;">
                        <div style="font-size:11px;color:var(--sf-muted,#666)">Receita total</div>
                        <div style="font-size:18px;font-weight:700">${fmtMoneyInsight(a.total_revenue)}</div>
                    </div>
                    <div style="background:var(--bg-light,#f6f7f9);border-radius:8px;padding:10px 12px;">
                        <div style="font-size:11px;color:var(--sf-muted,#666)">Lucro bruto total</div>
                        <div style="font-size:18px;font-weight:700">${fmtMoneyInsight(a.total_profit)}</div>
                    </div>
                    <div style="background:var(--bg-light,#f6f7f9);border-radius:8px;padding:10px 12px;">
                        <div style="font-size:11px;color:var(--sf-muted,#666)">Margem geral</div>
                        <div style="font-size:18px;font-weight:700">${(a.overall_margin_pct != null ? a.overall_margin_pct : 0).toFixed(1)}%</div>
                    </div>
                    <div style="background:var(--bg-light,#f6f7f9);border-radius:8px;padding:10px 12px;">
                        <div style="font-size:11px;color:var(--sf-muted,#666)">Margem média / projeto</div>
                        <div style="font-size:18px;font-weight:700">${(a.avg_margin_pct != null ? a.avg_margin_pct : 0).toFixed(1)}%</div>
                    </div>
                    <div style="background:var(--bg-light,#f6f7f9);border-radius:8px;padding:10px 12px;">
                        <div style="font-size:11px;color:var(--sf-muted,#666)">Sqft (soma)</div>
                        <div style="font-size:18px;font-weight:700">${a.total_sqft != null ? escapeClientCell(String(a.total_sqft)) : '—'}</div>
                    </div>
                </div>`;
            if (rows.length === 0) {
                html += `<p class="text-muted" style="font-size:14px">Nenhum projeto builder associado a este cliente.</p>`;
            } else {
                html += `<div class="table-container" style="max-height:280px;overflow:auto"><table class="data-table" style="font-size:13px">
                    <thead><tr><th>Projeto</th><th>Nº</th><th>Estado</th><th>Contrato</th><th>Custos</th><th>Lucro</th><th>Margem</th></tr></thead><tbody>`;
                for (const pr of rows) {
                    const nm = escapeClientCell(pr.name || '—');
                    const num = escapeClientCell(pr.project_number || '—');
                    const st = escapeClientCell(pr.status || '—');
                    html += `<tr style="cursor:pointer" data-pd="${pr.id}">
                        <td>${nm}</td><td>${num}</td><td>${st}</td>
                        <td>${fmtMoneyInsight(pr.contract_value)}</td>
                        <td>${fmtMoneyInsight(pr.total_cost_actual)}</td>
                        <td>${fmtMoneyInsight(pr.gross_profit)}</td>
                        <td>${pr.margin_pct != null ? escapeClientCell(String(pr.margin_pct)) + '%' : '—'}</td>
                    </tr>`;
                }
                html += `</tbody></table></div>`;
            }
            html += `</div>`;
        } else if (isB && builder_insight && builder_insight.error) {
            html += `<p style="color:#c0392b;font-size:14px">Builder: ${escapeClientCell(builder_insight.error)}</p>`;
        } else if (isB && !builder_insight) {
            html += `<p class="text-muted" style="font-size:14px">Não foi possível carregar o histórico de projetos deste builder.</p>`;
        }

        body.innerHTML = html;
        body.querySelectorAll('tr[data-pd]').forEach((tr) => {
            tr.addEventListener('click', () => {
                const pid = tr.getAttribute('data-pd');
                if (pid) window.location.href = `/project-detail.html?id=${encodeURIComponent(pid)}`;
            });
        });
    } catch (e) {
        body.innerHTML = `<p class="text-center" style="color:#c0392b;padding:2rem">${escapeClientCell(e.message || 'Erro de rede')}</p>`;
    }
}

async function viewCustomer(id) {
    resetClientForm();
    const t = document.getElementById('clientModalTitle');
    if (t) t.textContent = 'Editar cliente';
    const err = document.getElementById('clientFormError');
    try {
        const res = await fetch(`/api/customers/${id}`, { credentials: 'include' });
        const data = await res.json();
        if (!data.success || !data.data) {
            if (err) {
                err.textContent = data.error || 'Não foi possível carregar o cliente';
                err.style.display = 'block';
            }
            return;
        }
        const c = data.data;
        const set = (fid, v) => {
            const el = document.getElementById(fid);
            if (el) el.value = v != null && v !== '' ? String(v) : '';
        };
        document.getElementById('clientFormId').value = String(c.id);
        set('clientFormLeadId', c.lead_id != null ? c.lead_id : '');
        const isOrg = isOrgClientType(c.customer_type);
        set('clientName', isOrg ? '' : c.name);
        set('clientCompanyName', isOrg ? c.name : '');
        set('clientResponsibleName', isOrg && c.responsible_name != null ? c.responsible_name : '');
        set('clientEmail', c.email);
        set('clientPhone', displayPhoneInClientForm(c.phone));
        set('clientAddress', c.address);
        set('clientCity', c.city);
        set('clientState', c.state);
        set('clientZip', c.zipcode);
        set('clientType', normalizeClientTypeUi(c.customer_type));
        setClientPricingMode(c.pricing_mode === 'custom' ? 'custom' : 'table');
        clientCustomPricingRates =
            c.custom_pricing_rates && typeof c.custom_pricing_rates === 'object' ? { ...c.custom_pricing_rates } : {};
        set('clientStatus', c.status || 'active');
        set('clientNotes', c.notes);
        syncClientFormBuilderFields();
        const modal = document.getElementById('clientModal');
        if (modal) modal.style.display = 'flex';
    } catch (e) {
        if (err) {
            err.textContent = e.message || 'Erro de rede';
            err.style.display = 'block';
        }
    }
}

async function submitClientForm(ev) {
    ev.preventDefault();
    const errEl = document.getElementById('clientFormError');
    if (errEl) {
        errEl.textContent = '';
        errEl.style.display = 'none';
    }
    const id = document.getElementById('clientFormId').value.trim();
    const ctype = normalizeClientTypeUi(document.getElementById('clientType').value);
    let nameVal;
    let responsibleVal = null;
    if (isOrgClientType(ctype)) {
        nameVal = document.getElementById('clientCompanyName').value.trim();
        responsibleVal = document.getElementById('clientResponsibleName').value.trim();
        if (nameVal.length < 2) {
            if (errEl) {
                errEl.textContent = 'Indique o nome da empresa.';
                errEl.style.display = 'block';
            }
            return;
        }
        if (responsibleVal.length < 2) {
            if (errEl) {
                errEl.textContent = 'Indique o responsável (pessoa de contacto).';
                errEl.style.display = 'block';
            }
            return;
        }
    } else {
        nameVal = document.getElementById('clientName').value.trim();
    }
    const body = {
        name: nameVal,
        email: document.getElementById('clientEmail').value.trim(),
        phone: document.getElementById('clientPhone').value.trim(),
        address: document.getElementById('clientAddress').value.trim() || null,
        city: document.getElementById('clientCity').value.trim() || null,
        state: document.getElementById('clientState').value.trim() || null,
        zipcode: document.getElementById('clientZip').value.replace(/\D/g, '').slice(0, 10) || null,
        customer_type: ctype,
        pricing_mode: getClientPricingMode(),
        custom_pricing_rates: getClientPricingMode() === 'custom' ? clientCustomPricingRates : {},
        notes: document.getElementById('clientNotes').value.trim() || null,
    };
    if (isOrgClientType(ctype)) body.responsible_name = responsibleVal;
    else body.responsible_name = null;
    const leadRaw = document.getElementById('clientFormLeadId').value.trim();
    if (leadRaw && !id) body.lead_id = leadRaw;

    if (id) {
        body.status = document.getElementById('clientStatus').value;
    }

    const btn = document.getElementById('clientFormSubmit');
    if (btn) {
        btn.disabled = true;
        btn.textContent = 'A guardar…';
    }
    try {
        const url = id ? `/api/customers/${encodeURIComponent(id)}` : '/api/customers';
        const method = id ? 'PUT' : 'POST';
        const res = await fetch(url, {
            method,
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            if (errEl) {
                errEl.textContent = data.error || 'Pedido falhou (HTTP ' + res.status + ')';
                errEl.style.display = 'block';
            }
            return;
        }
        if (typeof closeModal === 'function') closeModal('clientModal');
        loadCustomers();
    } catch (e) {
        if (errEl) {
            errEl.textContent = e.message || 'Erro de rede';
            errEl.style.display = 'block';
        }
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.textContent = 'Guardar';
        }
    }
}

window.viewCustomer = viewCustomer;
window.inspectCustomer = inspectCustomer;
window.customerViewOpenEdit = customerViewOpenEdit;
window.showNewCustomerModal = showNewCustomerModal;
window.submitClientForm = submitClientForm;

// Quotes (pagination: não usar nome "quotesPage" — colide com id DOM #quotesPage e quebrava showPage)
let quotesListPage = 1;
let quotesListFilter = 'all';
let invoicesListPage = 1;
let invoicesListFilter = 'sent';
let invoicesListSearchTimer = null;

const QUOTES_FILTER_LABELS = {
    all: 'Todos',
    draft: 'Rascunho',
    sent: 'Enviado',
    viewed: 'Visto',
    approved: 'Aprovado',
    rejected: 'Rejeitado',
    expiring7: 'Expira ≤7 dias',
};

function getQuotesListSearchQuery() {
    const desktop = document.getElementById('quotesDesktopSearch');
    const mobile = document.getElementById('quotesMobileSearch');
    const raw = isQuotesCompactLayout() ? mobile?.value : desktop?.value ?? mobile?.value;
    return String(raw || '').trim();
}

function formatQuotesMoneyAmount(n) {
    const x = Number(n) || 0;
    return (
        '$' +
        x.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    );
}

function updateQuotesTotalsUi(totalCount, totalAmount) {
    const filterLabel = QUOTES_FILTER_LABELS[quotesListFilter] || quotesListFilter;
    const labelText = `Total (${filterLabel})`;
    const amountText = formatQuotesMoneyAmount(totalAmount);
    const t = typeof totalCount === 'number' ? totalCount : 0;
    const metaText = t === 0 ? '' : t === 1 ? ' · 1 orçamento' : ` · ${t} orçamentos`;
    [
        ['quotesTotalFilterLabel', 'quotesFilterTotalAmount', 'quotesTotalCountMeta'],
        ['quotesMobileTotalFilterLabel', 'quotesMobileFilterTotalAmount', 'quotesMobileTotalCountMeta'],
    ].forEach(([labelId, amountId, metaId]) => {
        const labelEl = document.getElementById(labelId);
        const amountEl = document.getElementById(amountId);
        const metaEl = document.getElementById(metaId);
        if (labelEl) labelEl.textContent = labelText;
        if (amountEl) amountEl.textContent = amountText;
        if (metaEl) metaEl.textContent = metaText;
    });
}


function updateQuotesFilterChipStyles() {
    document.querySelectorAll('.quotes-filter-chip').forEach((b) => {
        b.classList.toggle('quotes-filter-chip--active', b.getAttribute('data-quotes-filter') === quotesListFilter);
        b.classList.toggle('is-active', b.getAttribute('data-quotes-filter') === quotesListFilter);
    });
    if (typeof syncChiptrackBar === 'function') {
        requestAnimationFrame(() => {
            syncChiptrackBar('quotesMobileChiptrack', 'quotesMobileChipBar', '.quotes-filter-chip--active, .chiptrack__chip.is-active');
        });
    } else {
        const track = document.getElementById('quotesMobileChiptrack');
        const bar = document.getElementById('quotesMobileChipBar');
        if (track && bar) {
            const scroll = track.querySelector('.chiptrack__scroll') || track;
            const active = scroll.querySelector('.quotes-filter-chip--active, .chiptrack__chip.is-active');
            if (active) {
                const trackRect = track.getBoundingClientRect();
                const activeRect = active.getBoundingClientRect();
                bar.style.width = Math.max(20, activeRect.width) + 'px';
                bar.style.transform = `translateX(${Math.max(0, activeRect.left - trackRect.left)}px)`;
            }
        }
    }
}

function setQuotesFilter(f) {
    quotesListFilter = f && typeof f === 'string' ? f : 'all';
    quotesListPage = 1;
    updateQuotesFilterChipStyles();
    loadQuotes();
}
window.setQuotesFilter = setQuotesFilter;

function quoteStatusSfBadgeHtml(status) {
    const raw = String(status || 'draft').toLowerCase();
    let slug = raw.replace(/[^a-z0-9_-]/g, '') || 'draft';
    if (slug === 'accepted') slug = 'accepted';
    const labels = {
        draft: 'Rascunho',
        sent: 'Enviado',
        viewed: 'Visto',
        approved: 'Aprovado',
        accepted: 'Aceite',
        rejected: 'Rejeitado',
        declined: 'Recusado',
        expired: 'Expirado',
    };
    const label = labels[slug] || escapeHtmlCrm(status || 'draft');
    return `<span class="sf-quote-badge sf-quote-badge--${slug}">${label}</span>`;
}

function sfQuotesMobileSkeleton(count) {
    const n = Math.max(1, Math.min(8, count | 0));
    let html = '';
    for (let i = 0; i < n; i++) {
        html += '<div class="sf-quote-card"><div class="skeleton" style="height:72px;width:100%;border-radius:12px"></div></div>';
    }
    return html;
}

function sfQuotesMobileEmptyHtml() {
    return `<div class="ds-empty-state" role="status">
<h3 class="ds-empty-state__title">Nenhum orçamento ainda</h3>
<p class="ds-empty-state__text">Crie o primeiro orçamento tocando no +</p>
<button type="button" class="btn btn-primary touchable" data-crm-permission="quotes.edit" onclick="location.href='quote-builder.html'">+ Novo orçamento</button>
</div>`;
}

function quoteMobileCardHtml(q, opts) {
    const canDelete = opts && opts.canDelete;
    const clientLabel = escapeHtmlCrm(q.customer_name || q.lead_name || '—');
    const qnum = escapeHtmlCrm(q.quote_number != null ? String(q.quote_number) : 'N/A');
    const amt = parseFloat(q.total_amount || 0).toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    });
    const id = Number(q.id);
    const delBtn = canDelete
        ? `<button type="button" class="sf-quote-card__action-btn sf-quote-card__action-btn--del touchable" onclick="event.stopPropagation(); deleteQuote(${id})">Apagar</button>`
        : '';
    const editBtn = `<button type="button" class="sf-quote-card__action-btn sf-quote-card__action-btn--edit touchable" onclick="event.stopPropagation(); viewQuote(${id})">Abrir</button>`;
    return `
    <article class="sf-quote-card touchable" data-quote-id="${id}" role="button" tabindex="0">
      <div class="sf-quote-card__inner">
        <div class="sf-quote-card__client" title="${clientLabel}">${clientLabel}</div>
        <div class="sf-quote-card__row">
          <div class="sf-quote-card__meta">Quote #${qnum}</div>
          <div class="sf-quote-card__amt">$${amt}</div>
        </div>
        ${quoteStatusSfBadgeHtml(q.status)}
      </div>
      <div class="sf-quote-card__actions">${editBtn}${delBtn}</div>
    </article>`;
}

function getQuotesMobileFilteredRows() {
    return sfQuotesListCache.slice();
}


function bindQuotesTableRowOpen() {
    const list = document.getElementById('quotesTableBody');
    if (!list || list.dataset.quoteRowOpenBound === '1') return;
    list.dataset.quoteRowOpenBound = '1';
    list.addEventListener('click', (e) => {
        if (e.target.closest('button, a, .customers-row__actions')) return;
        const row = e.target.closest('.customers-row--quote[data-quote-id]');
        if (!row) return;
        const id = parseInt(row.getAttribute('data-quote-id'), 10);
        if (Number.isFinite(id) && id > 0) viewQuote(id);
    });
    list.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        const row = e.target.closest('.customers-row--quote[data-quote-id]');
        if (!row) return;
        e.preventDefault();
        const id = parseInt(row.getAttribute('data-quote-id'), 10);
        if (Number.isFinite(id) && id > 0) viewQuote(id);
    });
}

function bindSfQuoteCardInteractions(container) {
    if (!container || container.dataset.sfSwipeBound === '1') return;
    container.dataset.sfSwipeBound = '1';
    const OPEN_X = -144;
    let activeCard = null;
    let startX = 0;
    let startY = 0;
    let dragging = false;
    let axisLocked = null;
    let lastX = 0;
    let skipClick = false;

    function getInner(card) {
        return card && card.querySelector('.sf-quote-card__inner');
    }

    function setOpen(card, open) {
        const inner = getInner(card);
        if (!inner) return;
        card.classList.toggle('sf-quote-card--open', open);
        if (open) {
            inner.style.transform = `translateX(${OPEN_X}px)`;
        } else {
            inner.style.transform = '';
        }
    }

    function closeOthers(except) {
        container.querySelectorAll('.sf-quote-card--open').forEach((c) => {
            if (c !== except) setOpen(c, false);
        });
    }

    container.addEventListener(
        'pointerdown',
        (e) => {
            const card = e.target.closest('.sf-quote-card');
            if (!card || e.target.closest('button')) return;
            activeCard = card;
            startX = e.clientX;
            startY = e.clientY;
            lastX = e.clientX;
            dragging = false;
            axisLocked = null;
            skipClick = false;
            const inner = getInner(card);
            if (inner) inner.style.transition = 'none';
            try {
                card.setPointerCapture(e.pointerId);
            } catch (_) {}
        },
        { passive: true }
    );

    container.addEventListener(
        'pointermove',
        (e) => {
            if (!activeCard) return;
            const dx = e.clientX - startX;
            const dy = e.clientY - startY;
            lastX = e.clientX;
            if (!axisLocked) {
                if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
                axisLocked = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
            }
            if (axisLocked !== 'x') return;
            dragging = true;
            skipClick = true;
            const base = activeCard.classList.contains('sf-quote-card--open') ? OPEN_X : 0;
            let next = base + dx;
            if (next > 0) next = 0;
            if (next < OPEN_X - 24) next = OPEN_X - 24;
            const inner = getInner(activeCard);
            if (inner) inner.style.transform = `translateX(${next}px)`;
        },
        { passive: true }
    );

    const endDrag = (e) => {
        if (!activeCard) return;
        const card = activeCard;
        const inner = getInner(card);
        activeCard = null;
        if (inner) inner.style.transition = '';
        if (!dragging || axisLocked !== 'x') {
            dragging = false;
            axisLocked = null;
            return;
        }
        dragging = false;
        axisLocked = null;
        const clientX = e && e.clientX != null ? e.clientX : lastX;
        const dx = clientX - startX;
        const wasOpen = card.classList.contains('sf-quote-card--open');
        const shouldOpen = wasOpen ? dx > 40 ? false : true : dx < -56;
        closeOthers(card);
        setOpen(card, shouldOpen);
        if (shouldOpen) {
            try {
                navigator.vibrate(8);
            } catch (err) {}
        }
    };

    container.addEventListener('pointerup', endDrag, { passive: true });
    container.addEventListener('pointercancel', endDrag, { passive: true });

    container.addEventListener('click', (e) => {
        const card = e.target.closest('.sf-quote-card');
        if (!card) return;
        if (e.target.closest('button')) return;
        if (skipClick) {
            skipClick = false;
            return;
        }
        if (card.classList.contains('sf-quote-card--open')) {
            setOpen(card, false);
            return;
        }
        const id = parseInt(String(card.dataset.quoteId || ''), 10);
        if (Number.isFinite(id) && id > 0) viewQuote(id);
    });
}

function renderQuotesMobileFromCache() {
    const mobileList = document.getElementById('quotesMobileList');
    if (!mobileList || !isQuotesCompactLayout()) return;
    const canDeleteQuote =
        crmUserRole === 'admin' || (Array.isArray(crmUserPermissions) && crmUserPermissions.includes('quotes.edit'));
    const rows = getQuotesMobileFilteredRows();
    if (rows.length === 0) {
        mobileList.innerHTML = sfQuotesMobileEmptyHtml();
        if (typeof applyCrmNavPermissions === 'function') {
            applyCrmNavPermissions(crmUserPermissions, crmUserRole);
        }
        return;
    }
    mobileList.innerHTML = rows.map((q) => quoteMobileCardHtml(q, { canDelete: canDeleteQuote })).join('');
    bindSfQuoteCardInteractions(mobileList);
}

function updateQuotesMobileChrome(total, totalPages) {
    const sub = document.getElementById('quotesMobileSubtitle');
    const btn = document.getElementById('quotesMobileLoadMore');
    if (sub) {
        const t = typeof total === 'number' ? total : 0;
        const tp = Math.max(1, totalPages | 0);
        const p = quotesListPage;
        sub.textContent =
            t === 0
                ? '0 orçamentos'
                : t === 1
                  ? '1 orçamento'
                  : `${t} orçamentos · página ${p} de ${tp}`;
    }
    if (btn) {
        const tp = Math.max(1, totalPages | 0);
        btn.style.display = isQuotesCompactLayout() && quotesListPage < tp ? 'inline-block' : 'none';
    }
}

function syncQuotesSearchInputs(fromEl) {
    const desktop = document.getElementById('quotesDesktopSearch');
    const mobile = document.getElementById('quotesMobileSearch');
    const v = fromEl ? String(fromEl.value || '') : '';
    if (desktop && desktop !== fromEl) desktop.value = v;
    if (mobile && mobile !== fromEl) mobile.value = v;
}

function initQuotesListSearchUx() {
    const bindSearch = (el) => {
        if (!el || el.dataset.sfQuotesSearchBound) return;
        el.dataset.sfQuotesSearchBound = '1';
        let t;
        el.addEventListener('input', () => {
            syncQuotesSearchInputs(el);
            clearTimeout(t);
            t = setTimeout(() => {
                quotesListPage = 1;
                loadQuotes();
            }, 280);
        });
    };
    bindSearch(document.getElementById('quotesMobileSearch'));
    bindSearch(document.getElementById('quotesDesktopSearch'));
}

function initQuotesMobileUx() {
    initQuotesListSearchUx();

    initSfPullToRefresh();

    const lm = document.getElementById('quotesMobileLoadMore');
    if (lm && !lm.dataset.sfBound) {
        lm.dataset.sfBound = '1';
        lm.addEventListener('click', () => changePageQuotes(1));
    }
}

initQuotesMobileUx();
initSfPullToRefresh();
initSfMobilePeriodControl();
initSfMobileHeaderScroll();
requestAnimationFrame(() => moveMobileTabThumb());

function formatQuoteExpiryHtml(expirationDateStr, status) {
    const st = String(status || '').toLowerCase();
    if (st === 'expired') {
        return '<div class="quotes-expiry quotes-expiry--overdue"><span class="quotes-expiry__rel">Expirado</span><span class="quotes-expiry__date">—</span></div>';
    }
    if (!expirationDateStr) {
        return '<span class="quotes-cell-muted">—</span>';
    }
    const d = new Date(expirationDateStr);
    if (Number.isNaN(d.getTime())) {
        return '<span class="quotes-cell-muted">—</span>';
    }
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const exp = new Date(d);
    exp.setHours(0, 0, 0, 0);
    const diff = Math.round((exp - now) / 86400000);
    let rel = '';
    let cls = 'quotes-expiry';
    if (diff < 0) {
        rel = 'Expirado';
        cls += ' quotes-expiry--overdue';
    } else if (diff === 0) {
        rel = 'Hoje';
        cls += ' quotes-expiry--soon';
    } else if (diff === 1) {
        rel = 'Amanhã';
        cls += ' quotes-expiry--soon';
    } else if (diff <= 7) {
        rel = 'Em ' + diff + ' dias';
        cls += ' quotes-expiry--soon';
    } else {
        rel = 'Em ' + diff + ' dias';
    }
    const dateStr = d.toLocaleDateString();
    return `<div class="${cls}"><span class="quotes-expiry__rel">${rel}</span><span class="quotes-expiry__date">${dateStr}</span></div>`;
}

function quoteStatusBadgeHtml(status) {
    const raw = String(status || 'draft').toLowerCase();
    let slug = raw.replace(/[^a-z0-9_-]/g, '') || 'draft';
    if (slug === 'accepted') slug = 'accepted';
    const labels = {
        draft: 'Rascunho',
        sent: 'Enviado',
        viewed: 'Visto',
        approved: 'Aprovado',
        accepted: 'Aceite',
        rejected: 'Rejeitado',
        declined: 'Recusado',
        expired: 'Expirado',
    };
    const label = labels[slug] || escapeHtmlCrm(status || 'draft');
    return `<span class="badge-quote badge-quote--${slug}">${label}</span>`;
}

function quotesListEmptyStateRowHtml() {
    return `<div class="ds-empty-state customers-list-empty" role="status" style="padding:2rem 1.25rem">
<svg class="ds-empty-state__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
<path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6"/><path d="M9 15h6"/><path d="M9 11h6"/></svg>
<h3 class="ds-empty-state__title">Nenhum orçamento encontrado</h3>
<p class="ds-empty-state__text">Crie um orçamento ou altere os filtros acima para ver mais resultados.</p>
<button type="button" class="btn btn-primary" data-crm-permission="quotes.edit" onclick="location.href='quote-builder.html'">+ Novo orçamento</button>
</div>`;
}

function crmToastSafe(msg, opts) {
    const t = (opts && opts.type) || 'success';
    if (typeof window.crmNotify === 'function') {
        window.crmNotify(msg, t === 'error' ? 'error' : t === 'info' ? 'info' : 'success');
        return;
    }
    if (window.crmToast && typeof window.crmToast.show === 'function') {
        window.crmToast.show(msg, opts || {});
    } else {
        alert(msg);
    }
}

async function duplicateQuoteFromList(id) {
    const qid = parseInt(String(id), 10);
    if (!Number.isFinite(qid) || qid <= 0) return;
    try {
        const r = await fetch(`/api/quotes/${qid}/duplicate`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: '{}',
        });
        const d = await r.json().catch(() => ({}));
        if (!r.ok || d.success === false) {
            crmToastSafe(d.error || 'Não foi possível duplicar o orçamento.', { type: 'error' });
            return;
        }
        const nid = d.data && d.data.quote && d.data.quote.id;
        if (nid) {
            window.location.href = 'quote-builder.html?id=' + encodeURIComponent(String(nid));
        } else {
            crmToastSafe('Duplicado, mas resposta inválida.', { type: 'error' });
        }
    } catch (e) {
        crmToastSafe(e.message || 'Erro de rede ao duplicar.', { type: 'error' });
    }
}
window.duplicateQuoteFromList = duplicateQuoteFromList;

async function openQuoteInvoicePdf(id, title, filename) {
    const qid = parseInt(String(id), 10);
    if (!Number.isFinite(qid) || qid <= 0) return;
    const pdfTitle = title || `Orçamento #${qid}`;
    const pdfName = filename || `orcamento-${qid}.pdf`;
    if (window.crmPdfViewer?.openFromUrl) {
        await window.crmPdfViewer.openFromUrl(`/api/quotes/${qid}/invoice-pdf`, {
            title: pdfTitle,
            filename: pdfName,
        });
        return;
    }
    window.open(`/api/quotes/${qid}/invoice-pdf`, '_blank', 'noopener');
}
window.openQuoteInvoicePdf = openQuoteInvoicePdf;

async function openClientInvoicePdf(invoiceId, title) {
    const id = parseInt(String(invoiceId), 10);
    if (!Number.isFinite(id) || id <= 0) return;
    const pdfTitle = title || `Invoice #${id}`;
    const url = `/api/quote-invoices/${id}/pdf`;
    if (window.crmPdfViewer?.openFromUrl) {
        await window.crmPdfViewer.openFromUrl(url, {
            title: pdfTitle,
            filename: `invoice-${id}.pdf`,
        });
        return;
    }
    window.open(url, '_blank', 'noopener');
}
window.openClientInvoicePdf = openClientInvoicePdf;

function invoiceStatusBadgeHtml(status) {
    const s = String(status || '').toLowerCase();
    const labels = { issued: 'Emitido', sent: 'Enviado', paid: 'Pago', void: 'Anulado' };
    const label = labels[s] || escapeHtmlCrm(status || '—');
    const cls =
        s === 'paid'
            ? 'quote-status-badge quote-status-badge--approved'
            : s === 'sent'
              ? 'quote-status-badge quote-status-badge--sent'
              : s === 'issued'
                ? 'quote-status-badge quote-status-badge--draft'
                : 'quote-status-badge';
    return `<span class="${cls}">${label}</span>`;
}

function invoiceTypeLabel(type) {
    const t = String(type || '').toLowerCase();
    const map = {
        deposit: 'Deposit',
        progress: 'Progress',
        final: 'Final',
        full: 'Full',
        other: 'Other',
        remaining: 'Final',
    };
    return map[t] || type || '—';
}

function formatInvoiceListDate(raw) {
    if (!raw) return '—';
    try {
        const d = new Date(raw);
        if (Number.isNaN(d.getTime())) return String(raw).slice(0, 10);
        return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
    } catch (_) {
        return String(raw).slice(0, 10);
    }
}

function updateInvoicesFilterChipStyles() {
    document.querySelectorAll('[data-invoices-filter]').forEach((b) => {
        b.classList.toggle(
            'quotes-filter-chip--active',
            b.getAttribute('data-invoices-filter') === invoicesListFilter
        );
    });
}

function setInvoicesFilter(f) {
    invoicesListFilter = f && typeof f === 'string' ? f : 'sent';
    invoicesListPage = 1;
    updateInvoicesFilterChipStyles();
    loadInvoices();
}
window.setInvoicesFilter = setInvoicesFilter;

function changePageInvoices(delta) {
    const next = invoicesListPage + (parseInt(delta, 10) || 0);
    if (next < 1) return;
    invoicesListPage = next;
    loadInvoices();
}
window.changePageInvoices = changePageInvoices;

async function loadInvoices() {
    const list = document.getElementById('invoicesTableBody');
    if (!list) return;
    const subEl = document.getElementById('invoicesListSubtitle');
    if (subEl) subEl.textContent = 'A carregar…';
    list.innerHTML = '<p class="customers-list-empty">A carregar…</p>';

    const searchEl = document.getElementById('invoicesSearchInput');
    const q = searchEl ? String(searchEl.value || '').trim() : '';
    let url = `/api/quote-invoices?page=${invoicesListPage}&limit=25&status=${encodeURIComponent(invoicesListFilter || 'sent')}`;
    if (q) url += '&q=' + encodeURIComponent(q);

    try {
        const response = await fetch(url, { credentials: 'include' });
        const data = await response.json();
        if (!data.success) {
            list.innerHTML = `<p class="customers-list-empty">${escapeHtmlCrm(data.error || 'Erro ao carregar')}</p>`;
            if (subEl) subEl.textContent = 'Erro';
            return;
        }
        const rows = Array.isArray(data.data) ? data.data : [];
        const total = typeof data.total === 'number' ? data.total : rows.length;
        const totalAmount = typeof data.total_amount === 'number' ? data.total_amount : 0;
        const totalEl = document.getElementById('invoicesFilterTotalAmount');
        const metaEl = document.getElementById('invoicesTotalCountMeta');
        if (totalEl) {
            totalEl.textContent =
                '$' +
                totalAmount.toLocaleString(undefined, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                });
        }
        if (metaEl) metaEl.textContent = total === 1 ? '1 invoice' : `${total} invoices`;
        if (subEl) {
            subEl.textContent =
                total === 0 ? 'Nenhum invoice' : total === 1 ? '1 invoice' : `${total} invoices`;
        }

        const pageInfo = document.getElementById('pageInfoInvoices');
        const limit = data.limit || 25;
        const pages = Math.max(1, Math.ceil(total / limit));
        if (pageInfo) pageInfo.textContent = `Página ${invoicesListPage} de ${pages}`;
        const prevBtn = document.getElementById('prevPageInvoices');
        const nextBtn = document.getElementById('nextPageInvoices');
        if (prevBtn) prevBtn.disabled = invoicesListPage <= 1;
        if (nextBtn) nextBtn.disabled = invoicesListPage >= pages;

        if (rows.length === 0) {
            list.innerHTML =
                '<p class="customers-list-empty">Nenhum invoice enviado encontrado.</p>';
            return;
        }

        list.innerHTML = rows
            .map((inv, i) => {
                const invNum = escapeHtmlCrm(inv.invoice_number || String(inv.id));
                const qNum = escapeHtmlCrm(inv.quote_number || '—');
                const client = escapeHtmlCrm(inv.customer_name || '—');
                const type = escapeHtmlCrm(invoiceTypeLabel(inv.invoice_type));
                const amt = Number(inv.amount || 0);
                const paid = Number(inv.paid_amount || 0);
                const remaining =
                    inv.remaining_amount != null
                        ? Number(inv.remaining_amount)
                        : Math.max(0, amt - paid);
                const amtLabel = amt.toLocaleString(undefined, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                });
                const payHint =
                    paid > 0.009
                        ? `<div class="customers-row__sub">Pago $${paid.toFixed(2)}${
                              remaining > 0.009 ? ` · falta $${remaining.toFixed(2)}` : ''
                          }</div>`
                        : '';
                const sentAt = escapeHtmlCrm(formatInvoiceListDate(inv.email_sent_at || inv.created_at));
                const status = String(inv.status || '').toLowerCase();
                const pdfBtn = inv.has_pdf
                    ? `<button type="button" class="btn btn-sm" onclick="event.stopPropagation(); openClientInvoicePdf(${inv.id})">PDF</button>`
                    : '';
                const receiveBtn =
                    status !== 'paid' && remaining > 0.009
                        ? `<button type="button" class="btn btn-sm btn-primary" data-crm-permission="quotes.edit" onclick="event.stopPropagation(); openDashReceiptModal(${inv.id})">Receber</button>`
                        : '';
                const openQuote =
                    inv.quote_id != null
                        ? `<a class="btn btn-sm btn-secondary" href="quote-builder.html?id=${encodeURIComponent(String(inv.quote_id))}">Quote</a>`
                        : '';
                const actions = [pdfBtn, receiveBtn, openQuote].filter(Boolean).join('') ||
                    '<span class="customers-row__muted">—</span>';
                return `
                <article class="customers-row customers-row--invoice" role="listitem" style="--av-hue:${(i * 47) % 360}">
                    <div class="customers-row__identity">
                        <span class="customers-row__av" aria-hidden="true">${escapeHtmlCrm((inv.customer_name || 'IN').trim().slice(0, 2).toUpperCase())}</span>
                        <div class="customers-row__who">
                            <div class="customers-row__name" title="${client}">${client}</div>
                            <div class="customers-row__refs">
                                <span class="customers-ref" title="Invoice">${invNum}</span>
                                <span class="customers-ref customers-ref--lead" title="Quote">Q · ${qNum}</span>
                            </div>
                        </div>
                    </div>
                    <div class="customers-row__amt tabular-nums">$${amtLabel}${payHint}</div>
                    <div class="customers-row__type"><span class="customers-type-pill">${type}</span></div>
                    <div class="customers-row__status">${invoiceStatusBadgeHtml(inv.status)}</div>
                    <div class="customers-row__local">${sentAt}</div>
                    <div class="customers-row__actions">${actions}</div>
                </article>`;
            })
            .join('');
        if (typeof applyCrmNavPermissions === 'function') {
            applyCrmNavPermissions(crmUserPermissions, crmUserRole);
        }
    } catch (e) {
        list.innerHTML =
            '<p class="customers-list-empty">Erro de rede ao carregar invoices.</p>';
        if (subEl) subEl.textContent = 'Erro';
    }
}
window.loadInvoices = loadInvoices;

async function openDashReceiptModal(invoiceId) {
    const id = parseInt(String(invoiceId), 10);
    if (!Number.isFinite(id) || id <= 0) return;
    const modal = document.getElementById('dashReceiptModal');
    if (!modal) return;
    document.getElementById('dashRcpInvoiceId').value = String(id);
    document.getElementById('dashRcpDate').value = new Date().toISOString().slice(0, 10);
    document.getElementById('dashRcpMethod').value = 'check';
    document.getElementById('dashRcpRef').value = '';
    document.getElementById('dashRcpNotes').value = '';
    const sendEl = document.getElementById('dashRcpSendEmail');
    if (sendEl) sendEl.checked = true;
    const metaEl = document.getElementById('dashRcpMeta');
    if (metaEl) metaEl.textContent = 'A carregar saldo…';
    document.getElementById('dashRcpAmount').value = '';
    modal.style.display = 'flex';
    modal.classList.add('active');
    try {
        const r = await fetch(`/api/quote-invoices/${id}/receipts`, { credentials: 'include' }).then((res) =>
            res.json()
        );
        if (!r.success) {
            if (metaEl) metaEl.textContent = r.error || 'Erro ao carregar saldo.';
            return;
        }
        const bal = r.balance || {};
        const remaining = Number(bal.remaining) || 0;
        const paid = Number(bal.paid_total) || 0;
        const amt = Number(bal.invoice_amount) || 0;
        document.getElementById('dashRcpAmount').value =
            remaining > 0 ? String(Math.round(remaining * 100) / 100) : '';
        if (metaEl) {
            metaEl.textContent = `${bal.invoice_number || `INV-${id}`} · total $${amt.toFixed(2)} · pago $${paid.toFixed(2)} · saldo $${remaining.toFixed(2)}`;
        }
    } catch (e) {
        if (metaEl) metaEl.textContent = 'Não foi possível carregar o saldo.';
    }
}
window.openDashReceiptModal = openDashReceiptModal;

function closeDashReceiptModal() {
    const modal = document.getElementById('dashReceiptModal');
    if (!modal) return;
    modal.style.display = 'none';
    modal.classList.remove('active');
}
window.closeDashReceiptModal = closeDashReceiptModal;

async function submitDashReceiptForm(e) {
    e.preventDefault();
    const invoiceId = document.getElementById('dashRcpInvoiceId')?.value;
    if (!invoiceId) return;
    const amount = parseFloat(document.getElementById('dashRcpAmount')?.value);
    if (!(amount > 0)) {
        crmToastSafe('Indique o valor recebido.', { type: 'error' });
        return;
    }
    const btn = document.getElementById('dashRcpSubmit');
    const prev = btn?.textContent;
    if (btn) {
        btn.disabled = true;
        btn.textContent = 'A processar…';
    }
    try {
        const body = {
            amount,
            payment_date: document.getElementById('dashRcpDate')?.value || undefined,
            payment_method: document.getElementById('dashRcpMethod')?.value || 'check',
            reference_number: document.getElementById('dashRcpRef')?.value || undefined,
            notes: document.getElementById('dashRcpNotes')?.value || undefined,
            send_email: !!document.getElementById('dashRcpSendEmail')?.checked,
        };
        const r = await fetch(`/api/quote-invoices/${invoiceId}/receipts`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        }).then((res) => res.json());
        if (!r.success) {
            crmToastSafe(r.error || 'Erro ao gerar recibo', { type: 'error' });
            return;
        }
        closeDashReceiptModal();
        const paidNote = r.invoice_paid ? ' Invoice liquidado.' : '';
        crmToastSafe(
            `Recibo ${r.data?.receipt_number || ''} criado.${paidNote}`,
            { type: 'success' }
        );
        loadInvoices();
        if (r.data?.id && window.crmPdfViewer?.openFromUrl) {
            await window.crmPdfViewer.openFromUrl(`/api/invoice-receipts/${r.data.id}/pdf`, {
                title: r.data.receipt_number ? `Recibo ${r.data.receipt_number}` : 'Recibo',
                filename: `receipt-${r.data.id}.pdf`,
            });
        }
    } catch (err) {
        crmToastSafe(err.message || 'Erro de rede', { type: 'error' });
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.textContent = prev || 'Gerar recibo e dar baixa';
        }
    }
}
window.submitDashReceiptForm = submitDashReceiptForm;

async function generateQuotePdfFromList(id) {
    const qid = parseInt(String(id), 10);
    if (!Number.isFinite(qid) || qid <= 0) return;
    try {
        const r = await fetch(`/api/quotes/${qid}/generate-pdf`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: '{}',
        });
        const d = await r.json().catch(() => ({}));
        if (!r.ok || d.success === false) {
            crmToastSafe(d.error || 'Não foi possível gerar o PDF.', { type: 'error' });
            return;
        }
        const qnum = d.data?.quote_number || d.quote_number;
        await openQuoteInvoicePdf(qid, qnum ? `Orçamento ${qnum}` : `Orçamento #${qid}`);
        if (typeof loadQuotes === 'function') loadQuotes();
    } catch (e) {
        crmToastSafe(e.message || 'Erro de rede ao gerar PDF.', { type: 'error' });
    }
}
window.generateQuotePdfFromList = generateQuotePdfFromList;

async function loadQuotes() {
    const list = document.getElementById('quotesTableBody');
    if (!list) return;
    const mobileList = document.getElementById('quotesMobileList');
    const subEl = document.getElementById('quotesListSubtitle');
    if (subEl) subEl.textContent = 'A carregar…';
    list.innerHTML = '<p class="customers-list-empty">A carregar…</p>';
    if (mobileList && isQuotesCompactLayout()) {
        mobileList.innerHTML = sfQuotesMobileSkeleton(5);
    }
    const canDeleteQuote =
        crmUserRole === 'admin' || (Array.isArray(crmUserPermissions) && crmUserPermissions.includes('quotes.edit'));
    const canGenPdf = crmUserRole === 'admin' || (Array.isArray(crmUserPermissions) && crmUserPermissions.includes('quotes.edit'));

    let url = `/api/quotes?page=${quotesListPage}&limit=20`;
    if (quotesListFilter === 'expiring7') {
        url += '&expiring_within_days=7';
    } else if (quotesListFilter !== 'all') {
        url += '&status=' + encodeURIComponent(quotesListFilter);
    }
    const quotesSearchQ = getQuotesListSearchQuery();
    if (quotesSearchQ) {
        url += '&q=' + encodeURIComponent(quotesSearchQ);
    }

    try {
        const response = await fetch(url, { credentials: 'include' });
        const data = await response.json();

        if (data.success && data.data) {
            const total = typeof data.total === 'number' ? data.total : data.data.length;
            const totalAmount =
                typeof data.total_amount === 'number'
                    ? data.total_amount
                    : data.data.reduce((s, q) => s + (Number(q.total_amount) || 0), 0);
            updateQuotesTotalsUi(total, totalAmount);
            if (subEl) {
                subEl.textContent =
                    total === 0
                        ? '0 orçamentos'
                        : total === 1
                          ? '1 orçamento'
                          : `${total} orçamentos`;
            }
            if (data.data.length === 0) {
                sfQuotesListCache = [];
                updateQuotesTotalsUi(0, 0);
                list.innerHTML = quotesListEmptyStateRowHtml();
                if (mobileList && isQuotesCompactLayout()) {
                    mobileList.innerHTML = sfQuotesMobileEmptyHtml();
                }
                if (typeof applyCrmNavPermissions === 'function') {
                    applyCrmNavPermissions(crmUserPermissions, crmUserRole);
                }
            } else {
                sfQuotesListCache = data.data.slice();
                list.innerHTML = data.data
                    .map((q, i) => {
                        const hasPdf = !!(q.pdf_path || q.has_invoice_pdf);
                        const pdfCell = hasPdf
                            ? `<button type="button" class="btn btn-sm" onclick="event.stopPropagation(); openQuoteInvoicePdf(${q.id}, 'Orçamento ${escapeHtmlCrm(q.quote_number != null ? String(q.quote_number) : String(q.id))}')">Ver PDF</button>`
                            : canGenPdf
                              ? `<button type="button" class="btn btn-sm btn-secondary" onclick="event.stopPropagation(); generateQuotePdfFromList(${q.id})">Gerar PDF</button>`
                              : '<span class="customers-row__muted">—</span>';
                        const deleteBtn = canDeleteQuote
                            ? `<button type="button" class="btn btn-sm btn-secondary" onclick="event.stopPropagation(); deleteQuote(${q.id})" title="Excluir orçamento">Excluir</button>`
                            : '';
                        const clientLabel = escapeHtmlCrm(q.customer_name || q.lead_name || '—');
                        const qnum = escapeHtmlCrm(q.quote_number != null ? String(q.quote_number) : 'N/A');
                        const amt = parseFloat(q.total_amount || 0).toLocaleString(undefined, {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                        });
                        const created = q.created_at
                            ? escapeHtmlCrm(
                                  new Date(q.created_at).toLocaleDateString('pt-BR', {
                                      day: '2-digit',
                                      month: 'short',
                                      year: 'numeric',
                                  }),
                              )
                            : '—';
                        const initials = String(q.customer_name || q.lead_name || 'OR')
                            .trim()
                            .split(/\s+/)
                            .filter(Boolean)
                            .slice(0, 2)
                            .map((w) => w[0])
                            .join('')
                            .toUpperCase() || 'OR';
                        return `
                    <article class="customers-row customers-row--quote" role="listitem" tabindex="0" data-quote-id="${q.id}" aria-label="Abrir orçamento ${qnum}" style="--av-hue:${(i * 47) % 360}">
                        <div class="customers-row__identity">
                            <span class="customers-row__av" aria-hidden="true">${escapeHtmlCrm(initials)}</span>
                            <div class="customers-row__who">
                                <div class="customers-row__name" title="${clientLabel}">${clientLabel}</div>
                                <div class="customers-row__refs">
                                    <span class="customers-ref" title="Quote #${qnum}">#${qnum}</span>
                                </div>
                            </div>
                        </div>
                        <div class="customers-row__amt tabular-nums">$${amt}</div>
                        <div class="customers-row__status">${quoteStatusBadgeHtml(q.status)}</div>
                        <div class="customers-row__pdf">${pdfCell}</div>
                        <div class="customers-row__local">${created}</div>
                        <div class="customers-row__actions">
                            <button type="button" class="btn btn-sm btn-secondary" onclick="event.stopPropagation(); viewQuote(${q.id})" title="Editar orçamento">Abrir</button>
                            ${deleteBtn}
                        </div>
                    </article>`;
                    })
                    .join('');
                bindQuotesTableRowOpen();
                if (isQuotesCompactLayout()) {
                    renderQuotesMobileFromCache();
                }
            }

            const totalPages = Math.max(1, Math.ceil(total / 20));
            const pageInfoEl = document.getElementById('pageInfoQuotes');
            if (pageInfoEl) {
                pageInfoEl.textContent = `Página ${quotesListPage} de ${totalPages || 1}`;
            }
            const prevQ = document.getElementById('prevPageQuotes');
            const nextQ = document.getElementById('nextPageQuotes');
            if (prevQ) prevQ.disabled = quotesListPage <= 1;
            if (nextQ) nextQ.disabled = quotesListPage >= totalPages;
            updateQuotesMobileChrome(total, totalPages);
        } else {
            if (subEl) subEl.textContent = 'Erro ao carregar';
            updateQuotesTotalsUi(0, 0);
            list.innerHTML =
                '<p class="customers-list-empty">Resposta inválida do servidor</p>';
            sfQuotesListCache = [];
            if (mobileList && isQuotesCompactLayout()) {
                mobileList.innerHTML =
                    '<p class="sf-caption">Não foi possível carregar os orçamentos.</p>';
            }
        }
    } catch (error) {
        if (subEl) subEl.textContent = 'Erro ao carregar';
        list.innerHTML =
            '<p class="customers-list-empty">Erro: ' + escapeHtmlCrm(error.message) + '</p>';
        if (mobileList && isQuotesCompactLayout()) {
            mobileList.innerHTML =
                '<p class="sf-caption">Erro ao carregar. Tente puxar para atualizar.</p>';
        }
    }
}

function changePageQuotes(delta) {
    quotesListPage += delta;
    if (quotesListPage < 1) quotesListPage = 1;
    loadQuotes();
}

function viewQuote(id) {
    const qid = parseInt(String(id), 10);
    if (!Number.isFinite(qid) || qid <= 0) return;
    window.location.href = `quote-builder.html?id=${qid}`;
}

async function deleteQuote(id) {
    const qid = parseInt(String(id), 10);
    if (!Number.isFinite(qid) || qid <= 0) return;
    if (!confirm('Excluir este orçamento permanentemente? As linhas e o registo serão removidos. Esta ação não pode ser desfeita.')) {
        return;
    }
    try {
        const r = await fetch(`/api/quotes/${qid}`, { method: 'DELETE', credentials: 'include' });
        const d = await r.json().catch(() => ({}));
        if (!r.ok || d.success === false) {
            crmToastSafe(d.error || 'Não foi possível excluir o orçamento.', { type: 'error' });
            return;
        }
        crmToastSafe('Orçamento excluído.', { type: 'success' });
        if (typeof loadQuotes === 'function') loadQuotes();
    } catch (e) {
        crmToastSafe('Erro de rede ao excluir o orçamento.', { type: 'error' });
    }
}

function showNewQuoteModal() {
    window.location.href = 'quote-builder.html';
}

function loadEstimateAnalytics() {
    window.location.href = 'estimate-analytics.html';
}

function openImportInvoicePdfModal() {
    const modal = document.getElementById('importInvoicePdfModal');
    const form = document.getElementById('importInvoicePdfForm');
    const fileInput = document.getElementById('importInvoicePdfFile');
    const amountSec = document.getElementById('importInvoicePdfAmountSection');
    const amountEl = document.getElementById('importInvoicePdfAmount');
    const submitBtn = document.getElementById('importInvoicePdfSubmit');
    if (!modal || !form) return;
    form.reset();
    if (amountSec) amountSec.style.display = 'none';
    if (amountEl) amountEl.removeAttribute('required');
    if (submitBtn) submitBtn.disabled = true;
    if (fileInput) fileInput.value = '';
    modal.classList.add('active');
    modal.style.display = 'flex';
}

(function setupImportInvoicePdfModal() {
    const fileInput = document.getElementById('importInvoicePdfFile');
    const amountSec = document.getElementById('importInvoicePdfAmountSection');
    const amountEl = document.getElementById('importInvoicePdfAmount');
    const submitBtn = document.getElementById('importInvoicePdfSubmit');
    const form = document.getElementById('importInvoicePdfForm');
    const modal = document.getElementById('importInvoicePdfModal');
    if (!fileInput || !amountEl || !submitBtn || !form) return;

    function refreshSubmitState() {
        const hasFile = fileInput.files && fileInput.files.length > 0;
        const amt = parseFloat(String(amountEl.value || '').replace(',', '.'), 10);
        submitBtn.disabled = !(hasFile && Number.isFinite(amt) && amt >= 0);
    }

    fileInput.addEventListener('change', () => {
        const has = fileInput.files && fileInput.files.length > 0;
        if (amountSec) amountSec.style.display = has ? 'block' : 'none';
        if (has) {
            amountEl.setAttribute('required', 'required');
        } else {
            amountEl.removeAttribute('required');
            amountEl.value = '';
        }
        refreshSubmitState();
    });
    amountEl.addEventListener('input', refreshSubmitState);

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!fileInput.files || !fileInput.files[0]) return;
        const fd = new FormData();
        fd.append('file', fileInput.files[0]);
        fd.append('total_amount', amountEl.value);
        submitBtn.disabled = true;
        const prevText = submitBtn.textContent;
        submitBtn.textContent = 'A guardar…';
        try {
            const res = await fetch('/api/quotes/import-invoice-pdf', {
                method: 'POST',
                credentials: 'include',
                body: fd,
            });
            const json = await res.json().catch(() => ({}));
            if (json.success) {
                if (typeof closeModal === 'function') closeModal('importInvoicePdfModal');
                else if (modal) modal.style.display = 'none';
                crmToastSafe('PDF importado com sucesso.', { type: 'success' });
                loadQuotes();
            } else {
                crmToastSafe(json.error || 'Erro ao importar PDF', { type: 'error' });
            }
        } catch (err) {
            crmToastSafe('Erro de rede ao importar PDF', { type: 'error' });
        } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = prevText;
            refreshSubmitState();
        }
    });
})();

// Projects
let projectsPage = 1;
async function loadProjects() {
    const tbody = document.getElementById('projectsTableBody');
    tbody.innerHTML = '<tr><td colspan="8" class="text-center">Loading...</td></tr>';
    
    try {
        const response = await fetch(`/api/projects?page=${projectsPage}&limit=20`, { credentials: 'include' });
        const data = await response.json();
        
        if (data.success && data.data) {
            if (data.data.length === 0) {
                tbody.innerHTML = '<tr><td colspan="8" class="text-center">No projects found</td></tr>';
            } else {
                tbody.innerHTML = data.data.map(p => `
                    <tr>
                        <td>${p.id}</td>
                        <td>${p.name || '-'}</td>
                        <td>${p.customer_name || '-'}</td>
                        <td>${p.project_type || '-'}</td>
                        <td><span class="badge badge-${p.status || 'quoted'}">${p.status || 'quoted'}</span></td>
                        <td>$${parseFloat(p.estimated_cost || 0).toLocaleString()}</td>
                        <td>${p.estimated_start_date || '-'}</td>
                        <td><button class="btn btn-sm" onclick="viewProject(${p.id})">View</button></td>
                    </tr>
                `).join('');
            }
            
            const totalPages = Math.ceil(data.total / 20);
            document.getElementById('pageInfoProjects').textContent = `Page ${projectsPage} of ${totalPages || 1}`;
            document.getElementById('prevPageProjects').disabled = projectsPage <= 1;
            document.getElementById('nextPageProjects').disabled = projectsPage >= totalPages;
        }
    } catch (error) {
        tbody.innerHTML = '<tr><td colspan="8" class="text-center">Error: ' + error.message + '</td></tr>';
    }
}

function changePageProjects(delta) {
    projectsPage += delta;
    if (projectsPage < 1) projectsPage = 1;
    loadProjects();
}

function viewProject(id) {
    if (typeof crmNotify === 'function') crmNotify('Ver projeto #' + id + ' — em breve.', 'info');
    else alert('View project ' + id + ' - Feature coming soon!');
}

function showNewProjectModal() {
    if (typeof crmNotify === 'function') crmNotify('Novo projeto — em breve.', 'info');
    else alert('New Project form - Coming soon!');
}

// Visits/Schedule
let visitsPage = 1;
async function loadVisits() {
    const tbody = document.getElementById('visitsTableBody');
    tbody.innerHTML = '<tr><td colspan="7" class="text-center">Loading...</td></tr>';
    
    try {
        const response = await fetch(`/api/visits?page=${visitsPage}&limit=20`, { credentials: 'include' });
        const data = await response.json();
        
        if (data.success && data.data) {
            if (data.data.length === 0) {
                tbody.innerHTML = '<tr><td colspan="7" class="text-center">No visits scheduled</td></tr>';
            } else {
                tbody.innerHTML = data.data.map(v => `
                    <tr>
                        <td>${v.id}</td>
                        <td>${v.scheduled_at ? new Date(v.scheduled_at).toLocaleString() : '-'}</td>
                        <td>${v.lead_name || v.customer_name || '-'}</td>
                        <td>${v.project_name || '-'}</td>
                        <td>${v.seller_id || '-'}</td>
                        <td><span class="badge badge-${v.status || 'scheduled'}">${v.status || 'scheduled'}</span></td>
                        <td><button class="btn btn-sm" onclick="viewVisit(${v.id})">View</button></td>
                    </tr>
                `).join('');
            }
            
            const totalPages = Math.ceil(data.total / 20);
            document.getElementById('pageInfoVisits').textContent = `Page ${visitsPage} of ${totalPages || 1}`;
            document.getElementById('prevPageVisits').disabled = visitsPage <= 1;
            document.getElementById('nextPageVisits').disabled = visitsPage >= totalPages;
        }
    } catch (error) {
        tbody.innerHTML = '<tr><td colspan="7" class="text-center">Error: ' + error.message + '</td></tr>';
    }
}

function changePageVisits(delta) {
    visitsPage += delta;
    if (visitsPage < 1) visitsPage = 1;
    loadVisits();
}

function viewVisit(id) {
    if (typeof crmNotify === 'function') crmNotify('Ver visita #' + id + ' — em breve.', 'info');
    else alert('View visit ' + id + ' - Feature coming soon!');
}

function showNewVisitModal() {
    if (typeof crmNotify === 'function') crmNotify('Nova visita — em breve.', 'info');
    else alert('New Visit form - Coming soon!');
}

// Contracts/Financeiro
let contractsPage = 1;
async function loadContracts() {
    const tbody = document.getElementById('contractsTableBody');
    tbody.innerHTML = '<tr><td colspan="8" class="text-center">Loading...</td></tr>';
    
    try {
        const response = await fetch(`/api/contracts?page=${contractsPage}&limit=20`, { credentials: 'include' });
        const data = await response.json();
        
        if (data.success && data.data) {
            if (data.data.length === 0) {
                tbody.innerHTML = '<tr><td colspan="8" class="text-center">No contracts found</td></tr>';
            } else {
                tbody.innerHTML = data.data.map(c => `
                    <tr>
                        <td>${c.id}</td>
                        <td>${c.customer_name || '-'}</td>
                        <td>${c.project_name || '-'}</td>
                        <td>$${parseFloat(c.closed_amount || 0).toLocaleString()}</td>
                        <td>${c.payment_method || '-'}</td>
                        <td>${c.installments || 1}x</td>
                        <td>${c.start_date || '-'}</td>
                        <td><button class="btn btn-sm" onclick="viewContract(${c.id})">View</button></td>
                    </tr>
                `).join('');
            }
            
            const totalPages = Math.ceil(data.total / 20);
            document.getElementById('pageInfoContracts').textContent = `Page ${contractsPage} of ${totalPages || 1}`;
            document.getElementById('prevPageContracts').disabled = contractsPage <= 1;
            document.getElementById('nextPageContracts').disabled = contractsPage >= totalPages;
        }
    } catch (error) {
        tbody.innerHTML = '<tr><td colspan="8" class="text-center">Error: ' + error.message + '</td></tr>';
    }
}

function changePageContracts(delta) {
    contractsPage += delta;
    if (contractsPage < 1) contractsPage = 1;
    loadContracts();
}

function viewContract(id) {
    if (typeof crmNotify === 'function') crmNotify('Ver contrato #' + id + ' — em breve.', 'info');
    else alert('View contract ' + id + ' - Feature coming soon!');
}

function showNewContractModal() {
    if (typeof crmNotify === 'function') crmNotify('Novo contrato — em breve.', 'info');
    else alert('New Contract form - Coming soon!');
}

// Activities
let activitiesPage = 1;
async function loadActivities() {
    const tbody = document.getElementById('activitiesTableBody');
    tbody.innerHTML = '<tr><td colspan="6" class="text-center">Loading...</td></tr>';
    
    try {
        const response = await fetch(`/api/activities?page=${activitiesPage}&limit=50`, { credentials: 'include' });
        const data = await response.json();
        
        if (data.success && data.data) {
            if (data.data.length === 0) {
                tbody.innerHTML = '<tr><td colspan="6" class="text-center">No activities found</td></tr>';
            } else {
                tbody.innerHTML = data.data.map(a => `
                    <tr>
                        <td>${a.activity_date ? new Date(a.activity_date).toLocaleString() : '-'}</td>
                        <td>${a.activity_type || '-'}</td>
                        <td>${a.subject || '-'}</td>
                        <td>${a.related_to || '-'}</td>
                        <td>${a.user_name || '-'}</td>
                        <td><button class="btn btn-sm" onclick="viewActivity(${a.id})">View</button></td>
                    </tr>
                `).join('');
            }
            
            const totalPages = Math.ceil(data.total / 50);
            document.getElementById('pageInfoActivities').textContent = `Page ${activitiesPage} of ${totalPages || 1}`;
            document.getElementById('prevPageActivities').disabled = activitiesPage <= 1;
            document.getElementById('nextPageActivities').disabled = activitiesPage >= totalPages;
        }
    } catch (error) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-center">Error: ' + error.message + '</td></tr>';
    }
}

function changePageActivities(delta) {
    activitiesPage += delta;
    if (activitiesPage < 1) activitiesPage = 1;
    loadActivities();
}

function viewActivity(id) {
    if (typeof crmNotify === 'function') crmNotify('Ver atividade #' + id + ' — em breve.', 'info');
    else alert('View activity ' + id + ' - Feature coming soon!');
}

function showNewActivityModal() {
    if (typeof crmNotify === 'function') crmNotify('Nova atividade — em breve.', 'info');
    else alert('New Activity form - Coming soon!');
}

// Users & permissões por módulo
let usersPage = 1;
let permissionRegistryCache = null;
let crmUserAvatarPendingFile = null;
let crmUserAvatarRemove = false;

function crmUserInitials(name) {
    return (
        String(name || '?')
            .trim()
            .split(/\s+/)
            .filter(Boolean)
            .map((w) => w[0])
            .join('')
            .slice(0, 2)
            .toUpperCase() || '?'
    );
}

function crmUserAvatarUrl(url) {
    if (!url) return '';
    const u = String(url).trim();
    if (u.startsWith('http://') || u.startsWith('https://')) return u;
    if (u.startsWith('/')) return u;
    return `/${u.replace(/^\/+/, '')}`;
}

function resetCrmUserAvatarState() {
    crmUserAvatarPendingFile = null;
    crmUserAvatarRemove = false;
    const input = document.getElementById('crmUserAvatarInput');
    if (input) input.value = '';
}

function updateCrmUserAvatarPreview(name, avatarUrl) {
    const img = document.getElementById('crmUserAvatarImg');
    const init = document.getElementById('crmUserAvatarInitials');
    const removeBtn = document.getElementById('crmUserAvatarRemoveBtn');
    if (!img || !init) return;

    let src = '';
    if (!crmUserAvatarPendingFile && !crmUserAvatarRemove && avatarUrl) {
        src = crmUserAvatarUrl(avatarUrl);
    }

    if (src) {
        img.src = src;
        img.classList.remove('hidden');
        init.classList.add('hidden');
    } else if (!crmUserAvatarPendingFile) {
        img.removeAttribute('src');
        img.classList.add('hidden');
        init.textContent = crmUserInitials(name);
        init.classList.remove('hidden');
    }

    if (removeBtn) {
        const hasPhoto = !!src || !!crmUserAvatarPendingFile;
        removeBtn.style.display = hasPhoto ? '' : 'none';
        removeBtn.disabled = !hasPhoto;
    }
}

function renderCrmUserTableAvatar(u) {
    const name = u.name || '-';
    const src = u.avatar ? crmUserAvatarUrl(u.avatar) : '';
    const initials = crmUserInitials(name);
    const avatarInner = src
        ? `<img src="${escapeHtmlCrm(src)}" alt="" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';" /><span style="display:none">${escapeHtmlCrm(initials)}</span>`
        : escapeHtmlCrm(initials);
    return `<span class="crm-user-cell__avatar">${avatarInner}</span>`;
}

async function applyCrmUserAvatarChanges(userId) {
    if (!userId) return;
    if (crmUserAvatarRemove) {
        const res = await fetch(`/api/users/${userId}`, {
            method: 'PUT',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ avatar: null }),
        });
        const j = await res.json();
        if (!res.ok) throw new Error(j.error || 'Erro ao remover foto.');
        return;
    }
    if (crmUserAvatarPendingFile) {
        const fd = new FormData();
        fd.append('file', crmUserAvatarPendingFile);
        const res = await fetch(`/api/users/${userId}/avatar`, {
            method: 'POST',
            credentials: 'include',
            body: fd,
        });
        const j = await res.json();
        if (!res.ok) throw new Error(j.error || 'Erro ao enviar foto.');
    }
}


function escapeHtmlCrm(s) {
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/"/g, '&quot;');
}

async function fetchPermissionRegistry() {
    if (permissionRegistryCache) return permissionRegistryCache;
    const res = await fetch('/api/permissions', { credentials: 'include' });
    const data = await res.json();
    permissionRegistryCache = data.success ? data : { by_group: {}, data: [] };
    return permissionRegistryCache;
}

async function loadUsers() {
    const tbody = document.getElementById('usersTableBody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="7" class="text-center">A carregar…</td></tr>';
    updateUsersPageActions();

    try {
        const response = await fetch(`/api/users?page=${usersPage}&limit=20`, { credentials: 'include' });
        const data = await response.json();

        if (response.status === 403) {
            tbody.innerHTML =
                '<tr><td colspan="7" class="text-center">Sem permissão para ver a equipe (' +
                escapeHtmlCrm(data.error || '') +
                ').</td></tr>';
            return;
        }

        if (data.success && data.data) {
            const canEdit = crmUserRole === 'admin' || crmUserPermissions.includes('users.edit');
            const canDel = crmUserRole === 'admin' || crmUserPermissions.includes('users.delete');

            if (data.data.length === 0) {
                tbody.innerHTML = '<tr><td colspan="7" class="text-center">Nenhum utilizador encontrado</td></tr>';
            } else {
                tbody.innerHTML = data.data
                    .map((u) => {
                        const active = u.is_active !== undefined ? u.is_active : u.active;
                        const mustPw = u.must_change_password ? ' <span class="badge badge-warning" title="Trocar senha">senha</span>' : '';
                        const roleLabel = u.role_name || u.role || '—';
                        const uid = String(u.id);
                        const actions = [];
                        if (canEdit)
                            actions.push(
                                `<button type="button" class="btn btn-sm" onclick="openCrmUserModal('${uid.replace(/'/g, "\\'")}')">Editar</button>`
                            );
                        if (canDel)
                            actions.push(
                                `<button type="button" class="btn btn-sm btn-danger" onclick="deactivateCrmUser('${uid.replace(/'/g, "\\'")}')">Desativar</button>`
                            );
                        return `<tr>
                        <td><div class="crm-user-cell">${renderCrmUserTableAvatar(u)}<span>${escapeHtmlCrm(u.name || '-')}${mustPw}</span></div></td>
                        <td>${escapeHtmlCrm(u.email || '-')}</td>
                        <td>${escapeHtmlCrm(u.phone || '-')}</td>
                        <td>${escapeHtmlCrm(roleLabel)}</td>
                        <td><span class="badge badge-${active ? 'active' : 'inactive'}">${active ? 'Ativo' : 'Inativo'}</span></td>
                        <td>${u.created_at ? new Date(u.created_at).toLocaleDateString('pt-PT') : '—'}</td>
                        <td>${actions.join(' ') || '—'}</td>
                    </tr>`;
                    })
                    .join('');
            }

            const totalPages = Math.ceil(data.total / 20);
            document.getElementById('pageInfoUsers').textContent = `Página ${usersPage} de ${totalPages || 1}`;
            document.getElementById('prevPageUsers').disabled = usersPage <= 1;
            document.getElementById('nextPageUsers').disabled = usersPage >= totalPages;
        } else {
            tbody.innerHTML =
                '<tr><td colspan="7" class="text-center">Erro: ' + escapeHtmlCrm(data.error || 'desconhecido') + '</td></tr>';
        }
    } catch (error) {
        tbody.innerHTML = '<tr><td colspan="7" class="text-center">Erro: ' + escapeHtmlCrm(error.message) + '</td></tr>';
    }
}

function changePageUsers(delta) {
    usersPage += delta;
    if (usersPage < 1) usersPage = 1;
    loadUsers();
}

function closeCrmUserModal() {
    const modal = document.getElementById('crmUserModal');
    if (modal) modal.classList.remove('active');
}

function showNewUserModal() {
    openCrmUserModal(null);
}

function renderPermCheckboxes(byGroup, selectedSet, enabled) {
    let html = '';
    const keys = Object.keys(byGroup || {}).sort();
    for (const g of keys) {
        const items = byGroup[g] || [];
        html +=
            '<div style="margin-bottom:0.75rem"><strong style="text-transform:capitalize">' +
            escapeHtmlCrm(g) +
            '</strong>';
        for (const p of items) {
            const id = p.id;
            const checked = selectedSet.has(id) || selectedSet.has(String(id)) ? ' checked' : '';
            const dis = enabled ? '' : ' disabled';
            html +=
                '<label style="display:flex;align-items:flex-start;gap:0.5rem;margin:0.25rem 0 0 1rem;cursor:' +
                (enabled ? 'pointer' : 'default') +
                '">' +
                '<input type="checkbox" class="crm-perm-cb" data-perm-id="' +
                id +
                '"' +
                checked +
                dis +
                '>' +
                '<span>' +
                escapeHtmlCrm(p.permission_name || p.permission_key) +
                ' <small style="color:#94a3b8">(' +
                escapeHtmlCrm(p.permission_key) +
                ')</small></span></label>';
        }
        html += '</div>';
    }
    return html || '<p>Nenhuma permissão na base de dados.</p>';
}

function collectSelectedPermissionIds(root) {
    const scope = root || document;
    return Array.from(scope.querySelectorAll('.crm-perm-cb:checked'))
        .map((cb) => String(cb.getAttribute('data-perm-id') || '').trim())
        .filter(Boolean);
}

async function openCrmUserModal(userId) {
    const modal = document.getElementById('crmUserModal');
    const title = document.getElementById('crmUserModalTitle');
    const errEl = document.getElementById('crmUserFormError');
    const permsSection = document.getElementById('crmUserPermsSection');
    const groupsEl = document.getElementById('crmUserPermsGroups');
    const form = document.getElementById('crmUserForm');
    if (!modal || !form) return;

    errEl.style.display = 'none';
    form.reset();
    resetCrmUserAvatarState();
    document.getElementById('crmUserFormId').value = userId != null ? String(userId) : '';
    document.getElementById('crmUserActive').checked = true;
    document.getElementById('crmUserForcePwChange').checked = true;

    const canManage = canManageUserPerms();
    const reg = await fetchPermissionRegistry();
    const byG = reg.by_group || {};

    const roleSelect = document.getElementById('crmUserRole');
    const onRoleChange = function () {
        if (roleSelect.value === 'admin') {
            permsSection.style.display = 'none';
        } else {
            permsSection.style.display = '';
        }
    };
    roleSelect.onchange = onRoleChange;

    if (userId != null) {
        title.textContent = 'Editar utilizador';
        document.getElementById('crmUserPasswordHint').textContent = '(deixe vazio para não alterar)';
        const [ur, pr] = await Promise.all([
            fetch(`/api/users/${userId}`, { credentials: 'include' }).then((r) => r.json()),
            fetch(`/api/users/${userId}/permissions`, { credentials: 'include' }).then((r) => r.json()),
        ]);
        if (!ur.success || !ur.data) {
            if (typeof crmNotify === 'function') crmNotify(ur.error || 'Erro ao carregar utilizador', 'error');
            else alert(ur.error || 'Erro ao carregar utilizador');
            return;
        }
        const d = ur.data;
        document.getElementById('crmUserName').value = d.name || '';
        document.getElementById('crmUserEmail').value = d.email || '';
        document.getElementById('crmUserPhone').value = d.phone || '';
        await populateCrmUserRoleSelect(d.role || '');
        document.getElementById('crmUserPassword').value = '';
        const active = d.is_active !== undefined ? d.is_active : d.active;
        document.getElementById('crmUserActive').checked = !!active;
        document.getElementById('crmUserForcePwChange').checked = !!d.must_change_password;
        updateCrmUserAvatarPreview(d.name || '', d.avatar || null);
        const selected = new Set(
            (pr.success && pr.data && Array.isArray(pr.data.permission_ids) ? pr.data.permission_ids : []).map(String)
        );
        if (String(d.role).toLowerCase() === 'admin') {
            permsSection.style.display = 'none';
        } else {
            permsSection.style.display = '';
            document.getElementById('crmUserPermsHelp').textContent = canManage
                ? 'Marque os módulos permitidos para este utilizador (além do cargo).'
                : 'Só administradores ou quem gere cargos/utilizadores podem alterar isto.';
            groupsEl.innerHTML = renderPermCheckboxes(byG, selected, canManage);
        }
    } else {
        title.textContent = 'Novo utilizador';
        document.getElementById('crmUserPasswordHint').textContent = '(obrigatório, mín. 8 caracteres)';
        await populateCrmUserRoleSelect('');
        updateCrmUserAvatarPreview('', null);
        permsSection.style.display = '';
        document.getElementById('crmUserPermsHelp').textContent =
            'Opcional: deixe vazio para aplicar as permissões do cargo. Ou marque módulos específicos.';
        groupsEl.innerHTML = renderPermCheckboxes(byG, new Set(), true);
        onRoleChange();
    }

    modal.classList.add('active');
}

async function deactivateCrmUser(id) {
    if (!confirm('Desativar este utilizador? Não poderá iniciar sessão.')) return;
    try {
        const res = await fetch(`/api/users/${id}`, { method: 'DELETE', credentials: 'include' });
        const j = await res.json();
        if (!res.ok) {
            if (typeof crmNotify === 'function') crmNotify(j.error || 'Falha ao desativar', 'error');
            else alert(j.error || 'Falha ao desativar');
            return;
        }
        loadUsers();
    } catch (e) {
        if (typeof crmNotify === 'function') crmNotify(e.message || 'Erro de rede', 'error');
        else alert(e.message || 'Erro de rede');
    }
}

async function onCrmUserFormSubmit(e) {
    e.preventDefault();
    const errEl = document.getElementById('crmUserFormError');
    errEl.style.display = 'none';
    const id = document.getElementById('crmUserFormId').value.trim();
    const name = document.getElementById('crmUserName').value.trim();
    const email = document.getElementById('crmUserEmail').value.trim();
    const phone = document.getElementById('crmUserPhone').value.trim();
    const role = document.getElementById('crmUserRole').value;
    const pw = document.getElementById('crmUserPassword').value;
    const isActive = document.getElementById('crmUserActive').checked;
    const forcePw = document.getElementById('crmUserForcePwChange').checked;
    const submitBtn = document.getElementById('crmUserFormSubmit');

    if (!id && (!pw || pw.length < 8)) {
        errEl.textContent = 'Defina uma senha inicial com pelo menos 8 caracteres.';
        errEl.style.display = 'block';
        return;
    }
    if (pw && pw.length < 8) {
        errEl.textContent = 'A senha deve ter pelo menos 8 caracteres.';
        errEl.style.display = 'block';
        return;
    }

    submitBtn.disabled = true;
    try {
        if (!id) {
            const body = {
                name,
                email,
                phone: phone || null,
                role,
                is_active: isActive,
                force_password_change: forcePw,
                password: pw,
            };
            if (role !== 'admin') {
                const pids = collectSelectedPermissionIds(document.getElementById('crmUserPermsGroups'));
                if (pids.length > 0) body.permission_ids = pids;
            }
            const res = await fetch('/api/users', {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            const j = await res.json();
            if (!res.ok) {
                errEl.textContent = j.error || 'Erro ao criar.';
                errEl.style.display = 'block';
                submitBtn.disabled = false;
                return;
            }
            const newId = j.data?.id;
            if (newId && (crmUserAvatarPendingFile || crmUserAvatarRemove)) {
                try {
                    await applyCrmUserAvatarChanges(String(newId));
                } catch (avatarErr) {
                    errEl.textContent =
                        avatarErr.message || 'Utilizador criado, mas falhou ao guardar a foto.';
                    errEl.style.display = 'block';
                    submitBtn.disabled = false;
                    loadUsers();
                    return;
                }
            }
        } else {
            const body = {
                name,
                email,
                phone: phone || null,
                role,
                is_active: isActive,
                force_password_change: forcePw,
            };
            if (pw) body.password = pw;
            const res = await fetch(`/api/users/${id}`, {
                method: 'PUT',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            const j = await res.json();
            if (!res.ok) {
                errEl.textContent = j.error || 'Erro ao atualizar.';
                errEl.style.display = 'block';
                submitBtn.disabled = false;
                return;
            }
            if (crmUserAvatarPendingFile || crmUserAvatarRemove) {
                try {
                    await applyCrmUserAvatarChanges(id);
                } catch (avatarErr) {
                    errEl.textContent =
                        avatarErr.message || 'Dados guardados, mas falhou ao atualizar a foto.';
                    errEl.style.display = 'block';
                    submitBtn.disabled = false;
                    loadUsers();
                    return;
                }
            }
            if (
                role !== 'admin' &&
                canManageUserPerms()
            ) {
                const pids = collectSelectedPermissionIds(document.getElementById('crmUserPermsGroups'));
                const pr = await fetch(`/api/users/${id}/permissions`, {
                    method: 'PUT',
                    credentials: 'include',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ permission_ids: pids }),
                });
                const pj = await pr.json();
                if (!pr.ok) {
                    errEl.textContent = pj.error || 'Dados guardados, mas falhou ao atualizar permissões.';
                    errEl.style.display = 'block';
                    submitBtn.disabled = false;
                    loadUsers();
                    return;
                }
            }
        }
        closeCrmUserModal();
        permissionRegistryCache = null;
        loadUsers();
    } catch (ex) {
        errEl.textContent = ex.message || 'Erro de rede.';
        errEl.style.display = 'block';
    }
    submitBtn.disabled = false;
}


function closeCrmRoleModal() {
    const modal = document.getElementById('crmRoleModal');
    if (modal) modal.classList.remove('active');
}

async function showNewRoleModal() {
    if (!canManageRoles()) {
        if (typeof crmNotify === 'function') crmNotify('Sem permissão para criar cargos', 'error');
        return;
    }
    const modal = document.getElementById('crmRoleModal');
    const form = document.getElementById('crmRoleForm');
    const errEl = document.getElementById('crmRoleFormError');
    const groupsEl = document.getElementById('crmRolePermsGroups');
    if (!modal || !form) return;
    errEl.style.display = 'none';
    form.reset();
    const reg = await fetchPermissionRegistry();
    groupsEl.innerHTML = renderPermCheckboxes(reg.by_group || {}, new Set(), true);
    modal.classList.add('active');
}

async function onCrmRoleFormSubmit(e) {
    e.preventDefault();
    const errEl = document.getElementById('crmRoleFormError');
    const submitBtn = document.getElementById('crmRoleFormSubmit');
    errEl.style.display = 'none';
    const name = document.getElementById('crmRoleName').value.trim();
    const key = document.getElementById('crmRoleKey').value.trim();
    const description = document.getElementById('crmRoleDescription').value.trim();
    const groupsEl = document.getElementById('crmRolePermsGroups');
    const permission_ids = collectSelectedPermissionIds(groupsEl);
    if (!name) {
        errEl.textContent = 'Indique o nome do cargo.';
        errEl.style.display = 'block';
        return;
    }
    submitBtn.disabled = true;
    try {
        const body = { name, permission_ids };
        if (key) body.key = key;
        if (description) body.description = description;
        const res = await fetch('/api/roles', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        const j = await res.json();
        if (!res.ok) {
            errEl.textContent = j.error || 'Erro ao criar cargo.';
            errEl.style.display = 'block';
            submitBtn.disabled = false;
            return;
        }
        crmRolesCache = null;
        closeCrmRoleModal();
        if (typeof crmNotify === 'function') crmNotify('Cargo criado: ' + (j.data?.name || name), 'success');
        await populateCrmUserRoleSelect(j.data?.key || '');
    } catch (ex) {
        errEl.textContent = ex.message || 'Erro de rede.';
        errEl.style.display = 'block';
    }
    submitBtn.disabled = false;
}

document.addEventListener('DOMContentLoaded', () => {
    const f = document.getElementById('crmUserForm');
    if (f) f.addEventListener('submit', onCrmUserFormSubmit);
    const rf = document.getElementById('crmRoleForm');
    if (rf) rf.addEventListener('submit', onCrmRoleFormSubmit);

    const avatarInput = document.getElementById('crmUserAvatarInput');
    const avatarChooseBtn = document.getElementById('crmUserAvatarChooseBtn');
    const avatarRemoveBtn = document.getElementById('crmUserAvatarRemoveBtn');
    const crmUserNameInput = document.getElementById('crmUserName');

    if (avatarChooseBtn && avatarInput) {
        avatarChooseBtn.addEventListener('click', () => avatarInput.click());
    }
    if (avatarInput) {
        avatarInput.addEventListener('change', () => {
            const file = avatarInput.files && avatarInput.files[0];
            crmUserAvatarPendingFile = file || null;
            crmUserAvatarRemove = false;
            if (!file) {
                updateCrmUserAvatarPreview(crmUserNameInput?.value || '', null);
                return;
            }
            const reader = new FileReader();
            reader.onload = () => {
                const img = document.getElementById('crmUserAvatarImg');
                const init = document.getElementById('crmUserAvatarInitials');
                if (img) {
                    img.src = reader.result;
                    img.classList.remove('hidden');
                }
                if (init) init.classList.add('hidden');
                if (avatarRemoveBtn) {
                    avatarRemoveBtn.style.display = '';
                    avatarRemoveBtn.disabled = false;
                }
            };
            reader.readAsDataURL(file);
        });
    }
    if (avatarRemoveBtn) {
        avatarRemoveBtn.addEventListener('click', () => {
            crmUserAvatarPendingFile = null;
            crmUserAvatarRemove = true;
            if (avatarInput) avatarInput.value = '';
            updateCrmUserAvatarPreview(crmUserNameInput?.value || '', null);
        });
    }
    if (crmUserNameInput) {
        crmUserNameInput.addEventListener('input', () => {
            if (!crmUserAvatarPendingFile && crmUserAvatarRemove) {
                updateCrmUserAvatarPreview(crmUserNameInput.value, null);
            }
        });
    }

    const customersTypeSelect = document.getElementById('customersTypeSelect');
    const customersSearchInput = document.getElementById('customersSearchInput');
    if (customersTypeSelect) {
        customersTypeSelect.addEventListener('change', () => {
            customersTypeFilter = customersTypeSelect.value.trim();
            customersPage = 1;
            syncCustomersPageChrome();
            loadCustomers();
        });
    }
    if (customersSearchInput) {
        customersSearchInput.addEventListener('search', () => {
            if (customersSearchInput.value === '') customersSearchClear();
        });
    }

    const invoicesSearchInput = document.getElementById('invoicesSearchInput');
    if (invoicesSearchInput) {
        invoicesSearchInput.addEventListener('input', () => {
            clearTimeout(invoicesListSearchTimer);
            invoicesListSearchTimer = setTimeout(() => {
                invoicesListPage = 1;
                loadInvoices();
            }, 300);
        });
        invoicesSearchInput.addEventListener('search', () => {
            invoicesListPage = 1;
            loadInvoices();
        });
    }

    const ct = document.getElementById('clientType');
    if (ct) ct.addEventListener('change', syncClientFormBuilderFields);
    document.getElementById('clientPricingModeTable')?.addEventListener('change', onClientPricingModeChange);
    document.getElementById('clientPricingModeCustom')?.addEventListener('change', onClientPricingModeChange);
    document.getElementById('btnEditClientCustomPricing')?.addEventListener('click', () => openClientCustomPricingModal());
    document.getElementById('btnCloseClientCustomPricing')?.addEventListener('click', closeClientCustomPricingModal);
    document.getElementById('btnCancelClientCustomPricing')?.addEventListener('click', closeClientCustomPricingModal);
    document.getElementById('btnApplyClientCustomPricing')?.addEventListener('click', applyClientCustomPricingModal);
    document.getElementById('clientCustomPricingSearch')?.addEventListener('input', (e) => {
        clientCustomPricingSearch = e.target.value || '';
        renderClientCustomPricingList();
    });
    const clientPhone = document.getElementById('clientPhone');
    if (clientPhone) {
        clientPhone.addEventListener('input', function () {
            const next = formatUsPhoneMaskFromDigits(this.value);
            if (this.value !== next) this.value = next;
        });
    }
});
