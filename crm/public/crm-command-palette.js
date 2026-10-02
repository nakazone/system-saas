/**
 * Command palette — Ctrl+K / Cmd+K and the top-bar "Pesquisar…" button.
 *
 * - Mounts its own markup (it used to exist only in dashboard.html, so on every other
 *   page the search button and ⌘K silently did nothing).
 * - Searches records (leads, clientes, quotes, jobs) via GET /api/search, plus the
 *   module shortcuts ("Ir para").
 */
(function () {
  if (window.__crmCommandPalette) return;

  const ACTIONS = [
    { id: 'dash', label: 'Dashboard', sub: 'Pipeline e visão geral', href: 'pipeline-lab.html', perm: null, desktopOnly: true },
    { id: 'home', label: 'Início', sub: 'Visão geral', href: 'home.html', perm: null, mobileOnly: true },
    { id: 'pipeline', label: 'Leads', sub: 'Lista por estágio', href: 'pipeline-lab.html', perm: null, mobileOnly: true },
    { id: 'leads', label: 'Leads', sub: 'Kanban / pipeline', href: 'leads.html', perm: 'leads.view' },
    { id: 'quotes', label: 'Quotes', sub: 'Orçamentos', href: 'quotes.html', perm: 'quotes.view' },
    { id: 'invoices', label: 'Faturas', sub: 'Invoices', href: 'invoices.html', perm: 'invoices.view' },
    { id: 'clients', label: 'Clientes', sub: 'Cadastro', href: 'dashboard.html?page=customers', perm: 'customers.view' },
    { id: 'pricing', label: 'Tabela de Valor', sub: 'Cadastro', href: 'builder-pricing-admin.html', perm: 'builders.view' },
    { id: 'team', label: 'Equipe', sub: 'Cadastro', href: 'equipe.html', perm: 'users.view' },
    { id: 'schedule', label: 'Agenda', sub: 'Jobs, visitas e compromissos', href: 'schedule.html', perm: 'schedule.view' },
    { id: 'jobs', label: 'Jobs', sub: 'Work orders / trabalhos', href: 'jobs.html', perm: 'work_orders.view' },
    { id: 'payroll', label: 'Folha de pagamento', sub: '', href: 'folha.html', perm: 'payroll.view' },
    { id: 'finance', label: 'Financeiro', sub: 'Fluxo de caixa, recebimentos e custos', href: 'finance.html', perm: 'finance.view' },
    { id: 'settings', label: 'Configurações', sub: 'Visão geral da empresa', href: 'configuracoes.html#visao-geral', perm: null },
    { id: 'settings-company', label: 'Dados da empresa', sub: 'Configurações · endereço, licença, horário', href: 'configuracoes.html#empresa', perm: 'settings.manage' },
    { id: 'settings-brand', label: 'Marca e aparência', sub: 'Configurações · logo e cores', href: 'configuracoes.html#marca', perm: 'settings.manage' },
    { id: 'settings-quote-messages', label: 'Mensagens do Orçamento', sub: 'Configurações · SMS e WhatsApp do quote', href: 'configuracoes.html#mensagens-orcamento', perm: 'settings.manage' },
    { id: 'settings-lead-messages', label: 'Mensagens para Leads', sub: 'Configurações · e-mails do pipeline', href: 'configuracoes.html#mensagens-fase', perm: 'settings.manage' },
    { id: 'support', label: 'Ajuda / suporte', sub: 'Help center e contato', href: '#help', perm: null },
    { id: 'install', label: 'Instalar app', sub: 'Baixar no dispositivo', href: '#pwa-install', perm: null },
  ];

  const TYPE_LABEL = { lead: 'Lead', customer: 'Cliente', quote: 'Quote', job: 'Job' };

  let items = [];
  let active = -1;
  let searchSeq = 0;
  let searchTimer = null;
  let lastRecords = [];

  function $(id) {
    return document.getElementById(id);
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function can(perm) {
    if (!perm) return true;
    const role = window.__crmPaletteRole || window.__crmUserRole || '';
    const keys = window.__crmPalettePerms || window.__crmPermissionKeys || [];
    if (role === 'admin') return true;
    return keys.includes(perm);
  }

  function isMobileClient() {
    if (window.__omDevice && typeof window.__omDevice.isMobile === 'function') {
      return window.__omDevice.isMobile();
    }
    return /Android|webOS|iPhone|iPod|BlackBerry|IEMobile|Opera Mini|Mobile|iPad/i.test(navigator.userAgent || '');
  }

  function stageLabel(slug) {
    if (!slug) return '';
    if (typeof window.pipelineStageDisplayName === 'function') return window.pipelineStageDisplayName(slug, null);
    return String(slug).replace(/_/g, ' ');
  }

  function filterActions(q) {
    const t = String(q || '').trim().toLowerCase();
    const mobile = isMobileClient();
    return ACTIONS.filter((a) => can(a.perm))
      .filter((a) => !(a.mobileOnly && !mobile) && !(a.desktopOnly && mobile))
      .filter((a) => {
        if (!t) return true;
        return a.label.toLowerCase().includes(t) || (a.sub && a.sub.toLowerCase().includes(t)) || a.id.includes(t);
      });
  }

  function ensureMarkup() {
    let root = $('crmCmdPalette');
    if (root) {
      const list = $('crmCmdPaletteList');
      if (list) {
        list.setAttribute('role', 'listbox');
        list.setAttribute('aria-label', 'Resultados');
      }
      return root;
    }
    root = document.createElement('div');
    root.id = 'crmCmdPalette';
    root.className = 'crm-cmd-palette';
    root.setAttribute('aria-hidden', 'true');
    root.innerHTML = `
      <div class="crm-cmd-palette__panel" role="dialog" aria-modal="true" aria-label="Pesquisar">
        <div class="crm-cmd-palette__head">
          <svg class="crm-cmd-palette__glass" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>
          <input type="search" id="crmCmdPaletteInput" class="crm-cmd-palette__input" placeholder="Buscar leads, clientes, quotes, jobs…" autocomplete="off" aria-label="Pesquisar" aria-controls="crmCmdPaletteList" />
          <button type="button" class="crm-cmd-palette__close" id="crmCmdPaletteClose" aria-label="Fechar">Esc</button>
        </div>
        <div id="crmCmdPaletteList" class="crm-cmd-palette__list" role="listbox" aria-label="Resultados"></div>
      </div>`;
    document.body.appendChild(root);
    return root;
  }

  function close() {
    const root = $('crmCmdPalette');
    if (!root) return;
    root.classList.remove('crm-cmd-palette--open');
    root.setAttribute('aria-hidden', 'true');
    document.documentElement.classList.remove('crm-cmd-palette-lock');
    if (lastFocus && typeof lastFocus.focus === 'function') {
      try {
        lastFocus.focus({ preventScroll: true });
      } catch (_) {}
    }
  }

  let lastFocus = null;

  function openPalette(initialQuery) {
    const root = ensureMarkup();
    bindRoot(root);
    const input = $('crmCmdPaletteInput');
    if (!input) return;
    lastFocus = document.activeElement && document.activeElement !== document.body ? document.activeElement : null;
    root.classList.add('crm-cmd-palette--open');
    root.setAttribute('aria-hidden', 'false');
    document.documentElement.classList.add('crm-cmd-palette-lock');
    input.value = typeof initialQuery === 'string' ? initialQuery : '';
    lastRecords = [];
    onInput();
    input.focus();
  }

  window.openCrmCommandPalette = openPalette;

  function go(href) {
    close();
    if (href === '#pwa-install') {
      if (typeof window.openCrmPwaInstall === 'function') window.openCrmPwaInstall();
      return;
    }
    if (href === '#help') {
      if (window.__crmHelpPanel && typeof window.__crmHelpPanel.open === 'function') window.__crmHelpPanel.open();
      return;
    }
    if (href) window.location.href = href;
  }

  function setActive(i) {
    const list = $('crmCmdPaletteList');
    const input = $('crmCmdPaletteInput');
    if (!list || !items.length) {
      active = -1;
      if (input) input.removeAttribute('aria-activedescendant');
      return;
    }
    active = Math.max(0, Math.min(items.length - 1, i));
    list.querySelectorAll('.crm-cmd-palette__item').forEach((el, idx) => {
      const on = idx === active;
      el.classList.toggle('is-active', on);
      el.setAttribute('aria-selected', on ? 'true' : 'false');
      if (on) {
        if (input) input.setAttribute('aria-activedescendant', el.id);
        el.scrollIntoView({ block: 'nearest' });
      }
    });
  }

  function render(q, state) {
    const list = $('crmCmdPaletteList');
    if (!list) return;
    const mobile = isMobileClient();
    const trimmed = String(q || '').trim();
    const recordItems = lastRecords.map((r) => ({
      kind: 'record',
      href: (mobile && r.mobile_href) || r.href,
      title: r.title,
      sub: [r.type === 'lead' && r.stage ? stageLabel(r.stage) : '', r.subtitle || ''].filter(Boolean).join(' · '),
      type: r.type,
    }));
    const actionItems = filterActions(q).map((a) => ({ kind: 'action', href: a.href, title: a.label, sub: a.sub }));
    items = [...recordItems, ...actionItems];

    let idx = 0;
    const row = (it) => {
      const id = `crmCmdItem${idx++}`;
      const badge =
        it.kind === 'record'
          ? `<em class="crm-cmd-palette__type is-${esc(it.type)}">${esc(TYPE_LABEL[it.type] || it.type)}</em>`
          : '';
      return `<button type="button" role="option" aria-selected="false" id="${id}" class="crm-cmd-palette__item" data-href="${esc(it.href)}">${badge}<strong>${esc(it.title)}</strong>${it.sub ? `<span>${esc(it.sub)}</span>` : ''}</button>`;
    };
    const hint = (text) => `<div class="crm-cmd-palette__hint">${esc(text)}</div>`;

    const out = [];
    if (trimmed.length >= 2) {
      out.push('<p class="crm-cmd-palette__group">Registros</p>');
      if (recordItems.length) out.push(recordItems.map(row).join(''));
      else if (state === 'loading') out.push(hint('Buscando…'));
      else if (state === 'error') out.push(hint('Não foi possível buscar agora. Tente de novo.'));
      else out.push(hint(`Nenhum lead, cliente, quote ou job com “${trimmed}”.`));
    } else if (!trimmed) {
      out.push(hint('Digite nome, telefone, e-mail, nº do quote ou do job.'));
    }
    if (actionItems.length) {
      out.push('<p class="crm-cmd-palette__group">Ir para</p>');
      out.push(actionItems.map(row).join(''));
    } else if (trimmed && trimmed.length < 2) {
      out.push('<div class="crm-cmd-palette__empty">Sem resultados</div>');
    }
    list.innerHTML = out.join('');

    list.querySelectorAll('.crm-cmd-palette__item').forEach((btn, i) => {
      btn.addEventListener('click', () => go(btn.getAttribute('data-href')));
      btn.addEventListener('mousemove', () => {
        if (active !== i) setActive(i);
      });
    });
    setActive(items.length ? 0 : -1);
  }

  async function searchRecords(q) {
    const seq = ++searchSeq;
    try {
      const r = await fetch(`/api/search?q=${encodeURIComponent(q)}`, { credentials: 'include' });
      const j = await r.json().catch(() => ({}));
      if (seq !== searchSeq) return;
      if (!r.ok || j.success === false) throw new Error(j.error || `HTTP ${r.status}`);
      lastRecords = Array.isArray(j.results) ? j.results : [];
      render(q, 'done');
    } catch (_) {
      if (seq !== searchSeq) return;
      lastRecords = [];
      render(q, 'error');
    }
  }

  function onInput() {
    const input = $('crmCmdPaletteInput');
    const q = input ? input.value : '';
    clearTimeout(searchTimer);
    if (String(q).trim().length >= 2) {
      render(q, 'loading');
      searchTimer = setTimeout(() => searchRecords(String(q).trim()), 180);
    } else {
      searchSeq++;
      lastRecords = [];
      render(q, 'idle');
    }
  }

  function bindRoot(root) {
    if (!root || root.dataset.bound === '1') return;
    root.dataset.bound = '1';
    root.addEventListener('click', (e) => {
      if (e.target === root) close();
    });
    const closeBtn = $('crmCmdPaletteClose');
    if (closeBtn) closeBtn.addEventListener('click', close);
    const input = $('crmCmdPaletteInput');
    if (input) {
      input.setAttribute('placeholder', 'Buscar leads, clientes, quotes, jobs…');
      input.addEventListener('input', onInput);
      input.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setActive(active + 1);
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          setActive(active - 1);
        } else if (e.key === 'Enter') {
          const it = items[active];
          if (it) {
            e.preventDefault();
            go(it.href);
          }
        }
      });
    }
  }

  function init() {
    document.addEventListener('keydown', (e) => {
      const root = $('crmCmdPalette');
      const open = !!(root && root.classList.contains('crm-cmd-palette--open'));
      if ((e.ctrlKey || e.metaKey) && String(e.key).toLowerCase() === 'k') {
        e.preventDefault();
        if (open) close();
        else openPalette();
      } else if (e.key === 'Escape' && open) {
        e.preventDefault();
        close();
      }
    });
    const existing = $('crmCmdPalette');
    if (existing) bindRoot(existing);
  }

  window.__crmCommandPalette = { open: openPalette, close };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
