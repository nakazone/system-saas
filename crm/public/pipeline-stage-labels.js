/**
 * Canonical English labels for pipeline columns (by slug).
 * Used when DB `pipeline_stages.name` differs or legacy `leads.status` values exist.
 */
(function (global) {
  /** Kanban order — New Lead → … → Won (Lost hidden until toggle). */
  const PIPELINE_V9_SLUGS = [
    'new_lead',
    'meeting_scheduled',
    'quote_sent',
    'follow_up_1',
    'stand_by',
    'won',
    'lost',
  ];

  /** Default colors / order for Kanban columns (when API row missing). */
  const PIPELINE_V9_KANBAN_DEFAULTS = {
    new_lead: { color: '#3498db', order_num: 1 },
    meeting_scheduled: { color: '#90EE90', order_num: 2 },
    quote_sent: { color: '#9b59b6', order_num: 3 },
    follow_up_1: { color: '#F1C40F', order_num: 4 },
    stand_by: { color: '#f39c12', order_num: 5 },
    won: { color: '#27ae60', order_num: 6 },
    lost: { color: '#c0392b', order_num: 7 },
  };

  const LEGACY_SLUG_TO_CANONICAL = {
    lead_received: 'new_lead',
    new: 'new_lead',
    contacted: 'stand_by',
    contact_made: 'stand_by',
    qualified: 'stand_by',
    visit_scheduled: 'meeting_scheduled',
    measurement_done: 'follow_up_1',
    followup_1: 'follow_up_1',
    follow_up1: 'follow_up_1',
    followup_2: 'follow_up_1',
    follow_up2: 'follow_up_1',
    'follow-up-2': 'follow_up_1',
    followup2: 'follow_up_1',
    proposal_created: 'quote_sent',
    proposal_sent: 'quote_sent',
    negotiation: 'follow_up_1',
    closing_attempt: 'follow_up_1',
    closed_won: 'won',
    closed_lost: 'lost',
    production: 'won',
  };

  const PIPELINE_STAGE_LABELS_EN = {
    new_lead: 'New Lead',
    meeting_scheduled: 'Meeting Scheduled',
    quote_sent: 'Quote Sent',
    follow_up_1: 'Follow Up',
    stand_by: 'Stand By',
    won: 'Won',
    lost: 'Lost',
    contacted: 'Stand By',
    lead_received: 'New Lead',
    new: 'New Lead',
    contact_made: 'Stand By',
    qualified: 'Stand By',
    visit_scheduled: 'Meeting Scheduled',
    measurement_done: 'Follow Up',
    proposal_created: 'Quote Sent',
    proposal_sent: 'Quote Sent',
    negotiation: 'Follow Up',
    closed_won: 'Won',
    closed_lost: 'Lost',
    production: 'Won',
  };

  const V9_SET = new Set(PIPELINE_V9_SLUGS);

  function normalizePipelineSlug(slug) {
    const s = String(slug || '').trim();
    return LEGACY_SLUG_TO_CANONICAL[s] || s;
  }

  /**
   * Merge API `pipeline_stages` rows with the canonical slugs.
   * @param {Array<object>} apiRows
   * @returns {Array<{ id?: number, slug: string, name?: string|null, order_num: number }>}
   */
  function mergePipelineStagesForUi(apiRows) {
    const rows = Array.isArray(apiRows) ? apiRows : [];
    const active = rows.filter((s) => {
      if (!s || s.slug == null) return false;
      const ia = s.is_active;
      if (ia === 0 || ia === '0' || ia === false) return false;
      return true;
    });

    const byCanon = new Map();
    for (const s of active) {
      const raw = String(s.slug || '').trim();
      const canon = normalizePipelineSlug(raw);
      if (!V9_SET.has(canon)) continue;
      const cur = byCanon.get(canon);
      if (!cur) {
        byCanon.set(canon, { ...s, slug: canon });
      } else if (raw === canon) {
        byCanon.set(canon, { ...s, slug: canon });
      }
    }

    return PIPELINE_V9_SLUGS.map((slug, i) => {
      const row = byCanon.get(slug);
      const order_num = i + 1;
      if (row) {
        return {
          id: row.id,
          slug,
          name: row.name,
          order_num,
        };
      }
      return { slug, name: null, order_num };
    });
  }

  /**
   * Same as mergePipelineStagesForUi plus `color` for Kanban columns.
   * @param {Array<object>} apiRows
   * @returns {Array<{ id?: number|null, slug: string, name?: string|null, color: string, order_num: number, is_active: number }>}
   */
  function mergePipelineStagesForKanban(apiRows) {
    const merged = mergePipelineStagesForUi(apiRows);
    const rows = Array.isArray(apiRows) ? apiRows : [];
    return merged.map((row) => {
      const def = PIPELINE_V9_KANBAN_DEFAULTS[row.slug] || { color: '#3498db', order_num: 99 };
      const raw = rows.find((r) => {
        if (!r || r.slug == null) return false;
        return normalizePipelineSlug(String(r.slug).trim()) === row.slug;
      });
      // Prefer canonical UI defaults for color so Meeting stays light green even if DB has old hex.
      const color = def.color || (raw && raw.color) || '#3498db';
      const order_num = def.order_num;
      return {
        id: row.id != null ? row.id : null,
        slug: row.slug,
        name: row.name,
        color,
        order_num,
        is_active: 1,
      };
    });
  }

  /**
   * @param {string} [slug]
   * @param {string} [nameFallback] - name from API (`pipeline_stages.name`)
   * @returns {string}
   */
  function pipelineStageDisplayName(slug, nameFallback) {
    const s = (slug || '').trim();
    if (s && Object.prototype.hasOwnProperty.call(PIPELINE_STAGE_LABELS_EN, s)) {
      return PIPELINE_STAGE_LABELS_EN[s];
    }
    return nameFallback || s || '';
  }

  global.PIPELINE_V9_SLUGS = PIPELINE_V9_SLUGS;
  global.PIPELINE_V9_KANBAN_DEFAULTS = PIPELINE_V9_KANBAN_DEFAULTS;
  global.normalizePipelineSlug = normalizePipelineSlug;
  global.mergePipelineStagesForUi = mergePipelineStagesForUi;
  global.mergePipelineStagesForKanban = mergePipelineStagesForKanban;
  global.PIPELINE_STAGE_LABELS_EN = PIPELINE_STAGE_LABELS_EN;
  /** @deprecated use PIPELINE_STAGE_LABELS_EN */
  global.PIPELINE_STAGE_LABELS_PT = PIPELINE_STAGE_LABELS_EN;
  global.pipelineStageDisplayName = pipelineStageDisplayName;
})(typeof window !== 'undefined' ? window : globalThis);
