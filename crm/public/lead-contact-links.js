/**
 * Native tel:/sms:/mailto links and stage-based message templates for leads.
 */
(function (global) {
  const SMS_COMPANY = 'Senior Floors';

  const FOLLOW_UP_TEMPLATES = [
    {
      id: 'follow_up_quote_reminder',
      label: 'Follow up — quote reminder',
      template:
        "Hello [name], I hope all is well. Just following up on the quote I sent a few days ago. If everything looks good, I'd be happy to help get your project scheduled and reserve a spot for you.",
    },
    {
      id: 'follow_up_last_check',
      label: 'Follow up — last check-in',
      template:
        "Hello [name], just wanted to check in one last time regarding your flooring project. If timing is better later, no problem at all — I'd still be happy to help whenever you're ready.",
    },
  ];

  /** Templates disponíveis em New Lead — replicados em todas as abas. */
  const NEW_LEAD_TEMPLATES = [
    {
      id: 'new_lead_intro',
      label: 'New lead — introduction',
      template:
        "Hi [name], thanks for reaching out to Senior Floors. I'd be happy to help. Can you tell me a little about the project?",
    },
    ...FOLLOW_UP_TEMPLATES,
  ];

  /** Extras por estágio (antes dos templates New Lead). */
  const STAGE_SMS_EXTRAS = {
    quote_sent: [
      {
        id: 'quote_sent_followup',
        label: 'Quote sent — thank you',
        template:
          "Hello [name], thank you for your time today. I've sent email and attached the quote PDF with the options we discussed. Thank you!\n\nFor know more about us\nhttps://senior-floors.com/",
      },
    ],
  };

  /** @type {Record<string, Array<{ id: string, label: string, template: string }>>} */
  const STAGE_SMS_TEMPLATES = {
    new_lead: NEW_LEAD_TEMPLATES.slice(),
    meeting_scheduled: NEW_LEAD_TEMPLATES.slice(),
    quote_sent: [...(STAGE_SMS_EXTRAS.quote_sent || []), ...NEW_LEAD_TEMPLATES],
    follow_up_1: NEW_LEAD_TEMPLATES.slice(),
    stand_by: NEW_LEAD_TEMPLATES.slice(),
    contacted: NEW_LEAD_TEMPLATES.slice(),
    won: NEW_LEAD_TEMPLATES.slice(),
    lost: NEW_LEAD_TEMPLATES.slice(),
  };

  function escapeHtml(s) {
    if (s == null || s === '') return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function escapeAttr(s) {
    return escapeHtml(s).replace(/'/g, '&#39;');
  }

  function normalizePhoneDigits(phone) {
    const raw = String(phone || '').trim();
    if (!raw) return '';
    const hasPlus = raw.startsWith('+');
    const digits = raw.replace(/\D/g, '');
    if (!digits) return '';
    return hasPlus ? '+' + digits : digits;
  }

  function isIosDevice() {
    if (typeof navigator === 'undefined') return false;
    const ua = navigator.userAgent || '';
    if (/iPad|iPhone|iPod/i.test(ua)) return true;
    return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
  }

  function leadFirstName(lead) {
    const full =
      lead && (lead.name || lead.full_name) ? String(lead.name || lead.full_name).trim() : '';
    return full.split(/\s+/).filter(Boolean)[0] || 'there';
  }

  function resolveLeadStageSlug(lead) {
    if (!lead) return '';
    const raw = String(lead.pipeline_stage_slug || lead.status || '').trim();
    if (typeof global.normalizePipelineSlug === 'function') {
      return global.normalizePipelineSlug(raw);
    }
    return raw;
  }

  function fillSmsTemplate(template, lead) {
    return String(template).replace(/\[name\]/gi, leadFirstName(lead));
  }

  function defaultLeadSmsBody(lead) {
    const first = leadFirstName(lead);
    return `Hi ${first}, this is ${SMS_COMPANY}. How can I help you today?`;
  }

  function getStageSmsDefinitions(slug) {
    if (STAGE_SMS_TEMPLATES[slug] && STAGE_SMS_TEMPLATES[slug].length) {
      return STAGE_SMS_TEMPLATES[slug];
    }
    // Qualquer outra aba: mesmos módulos de New Lead
    return NEW_LEAD_TEMPLATES.slice();
  }

  function leadMessageDefs(lead) {
    const slug = resolveLeadStageSlug(lead);
    const defs = getStageSmsDefinitions(slug);
    if (defs && defs.length) return { defs, filled: false };
    return {
      defs: [{ id: 'default', label: 'Message', template: defaultLeadSmsBody(lead) }],
      filled: true,
    };
  }

  /**
   * @param {object} lead
   * @returns {Array<{ id: string, label: string, body: string }>}
   */
  function getLeadMessageBodies(lead) {
    if (!lead) return [];
    const { defs, filled } = leadMessageDefs(lead);
    return defs.map((def) => ({
      id: def.id,
      label: def.label,
      body: filled ? defaultLeadSmsBody(lead) : fillSmsTemplate(def.template, lead),
    }));
  }

  /**
   * @param {object} lead
   * @returns {Array<{ id: string, label: string, body: string, href: string }>}
   */
  function getLeadSmsOptions(lead) {
    if (!lead || !lead.phone) return [];
    const phone = lead.phone;
    return getLeadMessageBodies(lead)
      .map((o) => ({
        ...o,
        href: buildSmsHref(phone, o.body),
      }))
      .filter((o) => o.href);
  }

  function defaultLeadEmailSubject(lead) {
    const first = leadFirstName(lead);
    return first && first !== 'there' ? `${SMS_COMPANY} — ${first}` : SMS_COMPANY;
  }

  function buildMailtoHref(email, subject, body) {
    const addr = String(email || '').trim();
    if (!addr || !addr.includes('@')) return '';
    const q = [];
    if (subject != null && String(subject).trim()) {
      q.push('subject=' + encodeURIComponent(String(subject)));
    }
    if (body != null && String(body) !== '') {
      q.push('body=' + encodeURIComponent(String(body)));
    }
    return q.length ? `mailto:${addr}?${q.join('&')}` : `mailto:${addr}`;
  }

  /**
   * @param {object} lead
   * @returns {Array<{ id: string, label: string, body: string, href: string, subject: string }>}
   */
  function getLeadEmailOptions(lead) {
    const email = lead && lead.email != null ? String(lead.email).trim() : '';
    if (!email || !email.includes('@')) return [];
    const subject = defaultLeadEmailSubject(lead);
    return getLeadMessageBodies(lead)
      .map((o) => ({
        ...o,
        subject,
        href: buildMailtoHref(email, subject, o.body),
      }))
      .filter((o) => o.href);
  }

  function buildTelHref(phone) {
    const num = normalizePhoneDigits(phone);
    return num ? `tel:${num}` : '';
  }

  function buildSmsHref(phone, body) {
    const num = normalizePhoneDigits(phone);
    if (!num) return '';
    const encoded = encodeURIComponent(body != null ? String(body) : '');
    const sep = isIosDevice() ? '&' : '?';
    return `sms:${num}${sep}body=${encoded}`;
  }

  function buildLeadSmsHref(lead, body) {
    const phone = lead && lead.phone;
    if (!phone) return '';
    if (body != null) return buildSmsHref(phone, body);
    const opts = getLeadSmsOptions(lead);
    if (opts.length) return opts[0].href;
    return buildSmsHref(phone, defaultLeadSmsBody(lead));
  }

  function buildLeadMailtoHref(lead, body) {
    const email = lead && lead.email != null ? String(lead.email).trim() : '';
    if (!email) return '';
    const subject = defaultLeadEmailSubject(lead);
    if (body != null) return buildMailtoHref(email, subject, body);
    const opts = getLeadEmailOptions(lead);
    if (opts.length) return opts[0].href;
    return buildMailtoHref(email, subject, defaultLeadSmsBody(lead));
  }

  let choiceMenuEl = null;

  function closeMessageChoiceMenu() {
    if (choiceMenuEl && choiceMenuEl.parentNode) {
      choiceMenuEl.parentNode.removeChild(choiceMenuEl);
    }
    choiceMenuEl = null;
    document.removeEventListener('click', onChoiceMenuOutside, true);
    window.removeEventListener('resize', positionChoiceMenu);
  }

  function positionChoiceMenu() {
    if (!choiceMenuEl || !choiceMenuEl._anchor) return;
    const anchor = choiceMenuEl._anchor;
    const r = anchor.getBoundingClientRect();
    const margin = 8;
    const belowTop = r.bottom + 4;
    const maxH = Math.min(320, window.innerHeight - belowTop - margin);
    choiceMenuEl.style.position = 'fixed';
    choiceMenuEl.style.left =
      Math.max(margin, Math.min(r.left, window.innerWidth - margin - Math.max(r.width, 260))) + 'px';
    choiceMenuEl.style.top = belowTop + 'px';
    choiceMenuEl.style.width = Math.max(r.width, 260) + 'px';
    choiceMenuEl.style.maxHeight = Math.max(120, maxH) + 'px';
    choiceMenuEl.style.overflowY = 'auto';
    choiceMenuEl.style.zIndex = '25000';
  }

  function onChoiceMenuOutside(e) {
    if (
      choiceMenuEl &&
      (e.target.closest('#sfSmsChoiceMenu') ||
        e.target.closest('#sfEmailChoiceMenu') ||
        e.target.closest('[data-lqs-sms-menu]') ||
        e.target.closest('[data-lqs-email-menu]') ||
        e.target.closest('[data-sf-sms-picker-btn]') ||
        e.target.closest('[data-sf-email-picker-btn]'))
    ) {
      return;
    }
    closeMessageChoiceMenu();
  }

  function openMessageChoiceMenu(anchorEl, options, menuId) {
    if (!anchorEl || !options || !options.length) return;
    if (options.length === 1) {
      global.location.href = options[0].href;
      return;
    }
    closeMessageChoiceMenu();
    const menu = document.createElement('div');
    menu.id = menuId || 'sfSmsChoiceMenu';
    menu.className = 'lead-quick-sheet__status-menu lead-quick-sheet__sms-menu';
    menu.setAttribute('role', 'menu');
    menu.innerHTML = options
      .map(
        (o) =>
          `<a class="lead-quick-sheet__status-option lead-quick-sheet__sms-option" role="menuitem" href="${escapeAttr(
            o.href
          )}">${escapeHtml(o.label)}</a>`
      )
      .join('');
    menu._anchor = anchorEl;
    document.body.appendChild(menu);
    choiceMenuEl = menu;
    positionChoiceMenu();
    window.addEventListener('resize', positionChoiceMenu);
    requestAnimationFrame(() => {
      document.addEventListener('click', onChoiceMenuOutside, true);
    });
  }

  function openSmsChoiceMenu(anchorEl, lead) {
    if (!anchorEl || !lead) return;
    openMessageChoiceMenu(anchorEl, getLeadSmsOptions(lead), 'sfSmsChoiceMenu');
  }

  function openEmailChoiceMenu(anchorEl, lead) {
    if (!anchorEl || !lead) return;
    openMessageChoiceMenu(anchorEl, getLeadEmailOptions(lead), 'sfEmailChoiceMenu');
  }

  /**
   * @param {object} lead
   * @param {string} [buttonClass]
   * @param {object} [attrs] extra data-* attributes for picker button
   */
  function renderLeadSmsActionHtml(lead, buttonClass, attrs) {
    const opts = getLeadSmsOptions(lead);
    if (!opts.length) return '';
    const cls = buttonClass || 'lead-quick-sheet__action';
    if (opts.length === 1) {
      return `<a class="${cls}" href="${escapeAttr(opts[0].href)}">SMS</a>`;
    }
    const extra = attrs && typeof attrs === 'object' ? attrs : {};
    let dataAttrs = ' data-lqs-sms-menu data-sf-sms-picker-btn aria-haspopup="menu"';
    Object.keys(extra).forEach((k) => {
      dataAttrs += ` ${k}="${escapeAttr(extra[k])}"`;
    });
    return `<button type="button" class="${cls}"${dataAttrs}>SMS <span class="lead-quick-sheet__sms-chevron" aria-hidden="true">&#9662;</span></button>`;
  }

  function renderLeadEmailActionHtml(lead, buttonClass, attrs) {
    const opts = getLeadEmailOptions(lead);
    if (!opts.length) return '';
    const cls = buttonClass || 'lead-quick-sheet__action';
    if (opts.length === 1) {
      return `<a class="${cls}" href="${escapeAttr(opts[0].href)}">Email</a>`;
    }
    const extra = attrs && typeof attrs === 'object' ? attrs : {};
    let dataAttrs = ' data-lqs-email-menu data-sf-email-picker-btn aria-haspopup="menu"';
    Object.keys(extra).forEach((k) => {
      dataAttrs += ` ${k}="${escapeAttr(extra[k])}"`;
    });
    return `<button type="button" class="${cls}"${dataAttrs}>Email <span class="lead-quick-sheet__sms-chevron" aria-hidden="true">&#9662;</span></button>`;
  }

  global.sfNormalizePhoneDigits = normalizePhoneDigits;
  global.sfDefaultLeadSmsBody = defaultLeadSmsBody;
  global.sfResolveLeadStageSlug = resolveLeadStageSlug;
  global.sfGetLeadMessageBodies = getLeadMessageBodies;
  global.sfGetLeadSmsOptions = getLeadSmsOptions;
  global.sfGetLeadEmailOptions = getLeadEmailOptions;
  global.sfGetStageSmsDefinitions = getStageSmsDefinitions;
  global.sfFillSmsTemplate = fillSmsTemplate;
  global.sfBuildTelHref = buildTelHref;
  global.sfBuildSmsHref = buildSmsHref;
  global.sfBuildMailtoHref = buildMailtoHref;
  global.sfBuildLeadSmsHref = buildLeadSmsHref;
  global.sfBuildLeadMailtoHref = buildLeadMailtoHref;
  global.sfRenderLeadSmsActionHtml = renderLeadSmsActionHtml;
  global.sfRenderLeadEmailActionHtml = renderLeadEmailActionHtml;
  global.sfOpenSmsChoiceMenu = openSmsChoiceMenu;
  global.sfOpenEmailChoiceMenu = openEmailChoiceMenu;
  global.sfCloseSmsChoiceMenu = closeMessageChoiceMenu;
  global.STAGE_SMS_TEMPLATES = STAGE_SMS_TEMPLATES;
})(typeof window !== 'undefined' ? window : globalThis);
