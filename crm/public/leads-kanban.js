/**
 * Leads Kanban Board and Management Functions
 */

let currentView = 'list'; // 'list' or 'kanban'
let pipelineStages = [];
let allLeads = [];
/** lead_id → resumo de orçamento (e-mail / link / PDF) */
let quoteEngagementByLeadId = {};
let allUsers = [];
/** Todas as visitas scheduled da API (Kanban filtra por estágio do lead) */
let scheduledVisitsRawForKanban = [];
/** Inicial: 5 cards por coluna; "Ver mais" +5 */
const KANBAN_CARDS_INITIAL = 5;
const KANBAN_CARDS_STEP = 5;
/** Colunas com leads mais antigos no topo */
const KANBAN_OLDEST_FIRST_SLUGS = new Set(['quote_sent', 'follow_up_1']);
/** Colunas ocultas no quadro principal (acessíveis via botão Lost). */
const KANBAN_HIDDEN_BOARD_SLUGS = new Set(['lost']);
let kanbanShowLostColumn = false;
let kanbanLostToggleBound = false;
/** Chave = slug do estágio (ex.: meeting_scheduled); usado em "Ver mais" */
let kanbanColumnVisible = {};

function kanbanNumericId(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : NaN;
}

function findLeadByIdKanban(leadId) {
    const n = kanbanNumericId(leadId);
    if (!Number.isFinite(n)) return undefined;
    return allLeads.find((l) => kanbanNumericId(l.id) === n);
}

function escapeKanbanHtml(s) {
    if (s == null || s === undefined) return '';
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/"/g, '&quot;');
}

/** Prioridade: emoji (gelo / traço / fogo), sem texto low|medium|high */
function kanbanPriorityMarkup(priorityRaw) {
    const p =
        String(priorityRaw || 'medium')
            .toLowerCase()
            .replace(/[^a-z]/g, '') || 'medium';
    if (p === 'high') {
        return `<span class="kanban-card-priority kanban-card-priority--emoji high" title="Alta" aria-label="Prioridade alta">\u{1F525}</span>`;
    }
    if (p === 'low') {
        return `<span class="kanban-card-priority kanban-card-priority--emoji low" title="Baixa" aria-label="Prioridade baixa">\u{1F9CA}</span>`;
    }
    return `<span class="kanban-card-priority kanban-card-priority--emoji medium" title="Média" aria-label="Prioridade média">\u2014</span>`;
}

function kanbanColumnTitle(stage) {
    if (typeof pipelineStageDisplayName === 'function') {
        return pipelineStageDisplayName(stage.slug, stage.name);
    }
    return (stage && stage.name) || '';
}

function formatVisitKanbanDateTime(iso) {
    if (!iso) return '—';
    try {
        return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
    } catch {
        return '—';
    }
}

// Load users for modais de lead (não confundir com loadUsers() da página Users em dashboard.js)
async function loadLeadFormUsers() {
    try {
        const response = await fetch('/api/users?limit=100', { credentials: 'include' });
        const data = await response.json();
        
        if (data.success && data.data) {
            allUsers = data.data.filter(u => u.is_active !== 0 && u.role === 'sales' || u.role === 'manager' || u.role === 'admin');
            
            // Populate selects
            const selects = ['newLeadOwnerSelect', 'assignLeadOwnerSelect', 'followupAssignedSelect'];
            selects.forEach(selectId => {
                const select = document.getElementById(selectId);
                if (select) {
                    select.innerHTML = '<option value="">Não designar</option>';
                    allUsers.forEach(user => {
                        const option = document.createElement('option');
                        option.value = user.id;
                        option.textContent = `${user.name} (${user.email})`;
                        select.appendChild(option);
                    });
                }
            });
        }
    } catch (error) {
        console.error('Error loading users:', error);
    }
}

// Load pipeline stages
async function loadPipelineStages() {
    try {
        const response = await fetch('/api/pipeline-stages', { credentials: 'include' }).catch(() => null);
        
        if (response && response.ok) {
            const data = await response.json();
            if (data.success) {
                const merged =
                    typeof mergePipelineStagesForKanban === 'function'
                        ? mergePipelineStagesForKanban(data.data || [])
                        : data.data || [];
                pipelineStages = merged.sort((a, b) => {
                    const slugs =
                        typeof PIPELINE_V9_SLUGS !== 'undefined' && Array.isArray(PIPELINE_V9_SLUGS)
                            ? PIPELINE_V9_SLUGS
                            : null;
                    if (slugs) {
                        const ia = slugs.indexOf(a.slug);
                        const ib = slugs.indexOf(b.slug);
                        if (ia !== -1 && ib !== -1) return ia - ib;
                    }
                    return (a.order_num || 0) - (b.order_num || 0);
                });
                return;
            }
        }
        
        // Fallback: Kanban v4
        pipelineStages = [
            { id: 1, name: 'New Lead', slug: 'new_lead', color: '#3498db', order_num: 1 },
            { id: 2, name: 'Meeting Scheduled', slug: 'meeting_scheduled', color: '#90EE90', order_num: 2 },
            { id: 3, name: 'Quote Sent', slug: 'quote_sent', color: '#9b59b6', order_num: 3 },
            { id: 4, name: 'Follow Up', slug: 'follow_up_1', color: '#F1C40F', order_num: 4 },
            { id: 5, name: 'Stand By', slug: 'stand_by', color: '#f39c12', order_num: 5 },
            { id: 6, name: 'Won', slug: 'won', color: '#27ae60', order_num: 6 },
            { id: 7, name: 'Lost', slug: 'lost', color: '#c0392b', order_num: 7 },
        ];
    } catch (error) {
        console.error('Error loading pipeline stages:', error);
        // Use fallback
        pipelineStages = [
            { id: 1, name: 'New Lead', slug: 'new_lead', color: '#3498db', order_num: 1 },
            { id: 2, name: 'Meeting Scheduled', slug: 'meeting_scheduled', color: '#90EE90', order_num: 2 },
            { id: 3, name: 'Quote Sent', slug: 'quote_sent', color: '#9b59b6', order_num: 3 },
            { id: 4, name: 'Follow Up', slug: 'follow_up_1', color: '#F1C40F', order_num: 4 },
            { id: 5, name: 'Stand By', slug: 'stand_by', color: '#f39c12', order_num: 5 },
            { id: 6, name: 'Won', slug: 'won', color: '#27ae60', order_num: 6 },
            { id: 7, name: 'Lost', slug: 'lost', color: '#c0392b', order_num: 7 },
        ];
    }
}

// Load CRM Kanban (called from dashboard)
async function loadCRMKanban() {
    currentView = 'kanban';
    await loadLeadFormUsers();
    await loadPipelineStages();
    await loadKanbanBoard();
}

// Show Kanban View (deprecated - kept for compatibility)
function showKanbanView() {
    currentView = 'kanban';
    const kanbanView = document.getElementById('kanbanView');
    const listView = document.getElementById('listView');
    if (kanbanView) kanbanView.style.display = 'block';
    if (listView) listView.style.display = 'none';
    loadKanbanBoard();
}

// Show List View (deprecated - kept for compatibility)
function showListView() {
    showKanbanView();
}

/** Normalize legacy `leads.status` / slug typos to canonical pipeline slug (matches migrate-pipeline-kanban-v3). */
function normalizeLeadPipelineSlug(raw) {
    const s = String(raw || '').trim();
    if (!s) return '';
    const legacy = {
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
        proposal_created: 'quote_sent',
        proposal_sent: 'quote_sent',
        negotiation: 'follow_up_1',
        closing_attempt: 'follow_up_1',
        closed_won: 'won',
        closed_lost: 'lost',
        production: 'won',
    };
    if (legacy[s]) return legacy[s];
    const lower = s.toLowerCase().replace(/\s+/g, '_');
    if (legacy[lower]) return legacy[lower];
    return s;
}

function resolveStageForLead(lead) {
    if (!pipelineStages.length) return null;
    const norm =
        typeof normalizePipelineSlug === 'function'
            ? normalizePipelineSlug
            : normalizeLeadPipelineSlug;
    const statusRaw = (lead.status || '').trim();
    const joinRaw = (lead.pipeline_stage_slug || '').trim();
    const statusCanon = statusRaw ? norm(statusRaw) : '';
    const joinCanon = joinRaw ? norm(joinRaw) : '';
    // leads.status (alterado no painel) tem prioridade sobre JOIN legado desatualizado
    const leadCanon = statusCanon || joinCanon;
    if (leadCanon) {
        const bySlug = pipelineStages.find((s) => {
            const stageCanon =
                typeof normalizePipelineSlug === 'function'
                    ? normalizePipelineSlug(s.slug || '')
                    : normalizeLeadPipelineSlug(s.slug || '');
            return stageCanon === leadCanon;
        });
        if (bySlug) return bySlug;
    }
    const byId = pipelineStages.find((s) => kanbanNumericId(s.id) === kanbanNumericId(lead.pipeline_stage_id));
    if (byId) return byId;
    return pipelineStages[0];
}

/** Atualiza lead em memoria e re-renderiza colunas (apos PUT do painel). */
function patchKanbanLeadCache(updatedLead) {
    if (!updatedLead || updatedLead.id == null) return;
    const nid = kanbanNumericId(updatedLead.id);
    if (!Number.isFinite(nid)) return;
    const idx = allLeads.findIndex((l) => kanbanNumericId(l.id) === nid);
    if (idx >= 0) {
        const merged = { ...allLeads[idx], ...updatedLead };
        if (updatedLead.status) {
            merged.status = updatedLead.status;
            merged.pipeline_stage_slug =
                updatedLead.pipeline_stage_slug || updatedLead.status;
        }
        allLeads[idx] = merged;
    } else {
        const row = { ...updatedLead };
        if (row.status && !row.pipeline_stage_slug) {
            row.pipeline_stage_slug = row.status;
        }
        allLeads.push(row);
    }
    renderKanbanBoard();
    bindKanbanLoadMore();
    syncKanbanLostToggleUi();
    renderLeadsMobilePipeline();
}

function kanbanStageDomId(stage) {
    if (stage.slug != null && stage.slug !== '') {
        return `kanban-stage-${stage.slug}`;
    }
    return `kanban-stage-${stage.id}`;
}

function kanbanColumnVisibilityKey(stage) {
    if (stage.slug != null && stage.slug !== '') {
        return String(stage.slug);
    }
    return String(stage.id);
}

function leadMatchesKanbanColumn(lead, stage) {
    const st = resolveStageForLead(lead);
    if (!st || !stage) return false;
    if (typeof normalizePipelineSlug === 'function') {
        return normalizePipelineSlug(st.slug || '') === normalizePipelineSlug(stage.slug || '');
    }
    return kanbanNumericId(st.id) === kanbanNumericId(stage.id);
}

function setKanbanBoardMessage(html) {
    const board = document.getElementById('kanbanBoard');
    if (!board) return;
    board.classList.add('kanban-board-grid');
    board.innerHTML = html;
}

// Load Kanban Board
async function loadKanbanBoard() {
    const board = document.getElementById('kanbanBoard');
    if (!board) return;
    if (!pipelineStages.length) {
        await loadPipelineStages();
    }
    setKanbanBoardMessage('<p class="kanban-board-message">A carregar…</p>');
    board.removeAttribute('aria-busy');
    try {
        const searchEl = document.getElementById('leadsListSearchInput');
        const q =
            searchEl && searchEl.value && String(searchEl.value).trim()
                ? '&q=' + encodeURIComponent(String(searchEl.value).trim())
                : '';
        const response = await fetch('/api/leads?limit=5000&page=1' + q, { credentials: 'include' });
        const data = await response.json().catch(() => ({}));

        scheduledVisitsRawForKanban = [];

        if (!response.ok || !data.success) {
            setKanbanBoardMessage(
                '<p class="kanban-board-message kanban-board-message--error">' +
                    escapeKanbanHtml(data.error || 'Não foi possível carregar os leads.') +
                    '</p>'
            );
            return;
        }
        allLeads = Array.isArray(data.data) ? data.data : [];
        quoteEngagementByLeadId = {};
        try {
            const engRes = await fetch('/api/leads/quote-engagement-summary', { credentials: 'include' });
            const engJson = await engRes.json().catch(() => ({}));
            if (engRes.ok && engJson.success && engJson.data) {
                quoteEngagementByLeadId = engJson.data;
                allLeads.forEach((l) => {
                    l._quoteEngagement = quoteEngagementByLeadId[l.id] || null;
                });
            }
        } catch (engErr) {
            console.warn('Quote engagement summary:', engErr);
        }
        renderKanbanBoard();
        bindKanbanLoadMore();
        bindKanbanLostToggle();
        syncKanbanLostToggleUi();
    } catch (error) {
        console.error('Error loading kanban:', error);
        setKanbanBoardMessage(
            '<p class="kanban-board-message kanban-board-message--error">Erro ao carregar leads. Tente novamente.</p>'
        );
    }
}

function getVisitScheduledPipelineStage() {
    return (
        pipelineStages.find((s) => s.slug === 'meeting_scheduled') ||
        pipelineStages.find((s) => s.slug === 'visit_scheduled') ||
        null
    );
}

function leadIsInVisitScheduledStage(lead, visitStage) {
    if (!visitStage || !lead) return false;
    const sid = kanbanNumericId(visitStage.id);
    const lid = kanbanNumericId(lead.pipeline_stage_id);
    const sameStageById = Number.isFinite(sid) && Number.isFinite(lid) && lid === sid;
    const sameBySlugOnly =
        lead.status === visitStage.slug &&
        (lead.pipeline_stage_id == null || lead.pipeline_stage_id === '');
    return sameStageById || sameBySlugOnly;
}

/** Visitas a mostrar na coluna dedicada: scheduled e lead ainda em "Visita Agendada" */
function getScheduledVisitsForKanbanColumn() {
    const visitStage = getVisitScheduledPipelineStage();
    const filtered = scheduledVisitsRawForKanban.filter((v) => {
        const lead = findLeadByIdKanban(v.lead_id);
        if (!lead) return false;
        if (!visitStage) return true;
        return leadIsInVisitScheduledStage(lead, visitStage);
    });
    filtered.sort((a, b) => {
        const ta = a.scheduled_at ? new Date(a.scheduled_at).getTime() : 0;
        const tb = b.scheduled_at ? new Date(b.scheduled_at).getTime() : 0;
        return ta - tb;
    });
    // Um cartão por lead (próxima visita): evita duplicar no Kanban quando há várias linhas em visits
    const seenLeadIds = new Set();
    const deduped = [];
    for (const v of filtered) {
        const lid = kanbanNumericId(v.lead_id);
        if (!Number.isFinite(lid) || seenLeadIds.has(lid)) continue;
        seenLeadIds.add(lid);
        deduped.push(v);
    }
    return deduped;
}

/** Estágio(s) de qualificação: coluna de visitas agendadas vem logo a seguir */
function isKanbanQualificationStage(stage) {
    if (!stage || !stage.slug) return false;
    const s = String(stage.slug).toLowerCase();
    return s === 'qualified' || s === 'qualification' || s === 'qualificado';
}

function buildVisitsKanbanColumnElement(visitsForColumn) {
    const visitsColumn = document.createElement('div');
    visitsColumn.className = 'kanban-column kanban-column--visits';
    visitsColumn.dataset.visitOnly = 'true';
    visitsColumn.dataset.stageId = '0';
    visitsColumn.dataset.stageSlug = 'visit_booked_column';
    const visitCardsHtml =
        visitsForColumn.length === 0
            ? '<div class="kanban-column-empty">Nenhuma visita agendada</div>'
            : visitsForColumn.map((v) => renderVisitKanbanCard(v)).join('');
    visitsColumn.innerHTML = `
            <div class="kanban-column-header kanban-column-header--visits">
                <div class="kanban-column-title">
                    <span>📅 Visitas agendadas</span>
                    <span class="kanban-column-count">${visitsForColumn.length}</span>
                </div>
            </div>
            <div class="kanban-column-cards" id="kanban-visits-cards">
                ${visitCardsHtml}
            </div>
        `;
    return visitsColumn;
}

function getLostPipelineStage() {
    return pipelineStages.find((s) => kanbanCanonicalStageSlug(s.slug) === 'lost') || null;
}

function countKanbanLostLeads() {
    const lostStage = getLostPipelineStage();
    if (!lostStage) return 0;
    return allLeads.filter((lead) => leadMatchesKanbanColumn(lead, lostStage)).length;
}

function getKanbanBoardStages() {
    return pipelineStages.filter((stage) => {
        const canon = kanbanCanonicalStageSlug(stage.slug);
        if (KANBAN_HIDDEN_BOARD_SLUGS.has(canon) && !kanbanShowLostColumn) return false;
        return true;
    });
}

function syncKanbanLostToggleUi() {
    const btn = document.getElementById('kanbanToggleLostBtn');
    const countEl = document.getElementById('kanbanLostCount');
    const count = countKanbanLostLeads();
    if (countEl) countEl.textContent = String(count);
    if (!btn) return;
    const label = btn.querySelector('.kanban-lost-toggle__label');
    btn.setAttribute('aria-pressed', kanbanShowLostColumn ? 'true' : 'false');
    btn.setAttribute('aria-expanded', kanbanShowLostColumn ? 'true' : 'false');
    if (label) {
        label.textContent = kanbanShowLostColumn
            ? 'Ocultar Lost'
            : count > 0
              ? `Ver Lost (${count})`
              : 'Ver Lost';
    }
    btn.disabled = !getLostPipelineStage();
}

function toggleKanbanLostColumn() {
    kanbanShowLostColumn = !kanbanShowLostColumn;
    renderKanbanBoard();
    bindKanbanLoadMore();
    syncKanbanLostToggleUi();
    if (kanbanShowLostColumn) {
        const lostStage = getLostPipelineStage();
        if (lostStage) {
            const col = document.querySelector(
                `.kanban-column[data-stage-slug="${lostStage.slug}"]`
            );
            col?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'end' });
        }
    }
}

function bindKanbanLostToggle() {
    if (kanbanLostToggleBound) return;
    const btn = document.getElementById('kanbanToggleLostBtn');
    if (!btn) return;
    kanbanLostToggleBound = true;
    btn.addEventListener('click', () => toggleKanbanLostColumn());
}

// Render Kanban Board
function renderKanbanBoard() {
    const board = document.getElementById('kanbanBoard');
    if (!board) return;

    board.classList.add('kanban-board-grid');
    board.classList.toggle('kanban-board-grid--with-lost', kanbanShowLostColumn);
    board.removeAttribute('aria-busy');

    if (!pipelineStages.length) {
        setKanbanBoardMessage('<p class="kanban-board-message">A carregar estágios…</p>');
        return;
    }

    board.innerHTML = '';

    try {
    getKanbanBoardStages().forEach((stage) => {
        const stageLeads = sortKanbanColumnLeads(
            allLeads.filter((lead) => leadMatchesKanbanColumn(lead, stage)),
            stage.slug
        );

        const total = stageLeads.length;
        const colKey = kanbanColumnVisibilityKey(stage);
        const visibleCap =
            typeof kanbanColumnVisible[colKey] === 'number'
                ? kanbanColumnVisible[colKey]
                : KANBAN_CARDS_INITIAL;
        const visibleLeads = stageLeads.slice(0, visibleCap);
        const remaining = total - visibleLeads.length;

        const column = document.createElement('div');
        column.className = 'kanban-column';
        column.dataset.stageId =
            stage.id != null && stage.id !== '' ? String(stage.id) : '';
        column.dataset.stageSlug = stage.slug || '';

        const stageCardsId = kanbanStageDomId(stage);
        const headerLight = stage.slug === 'meeting_scheduled' || stage.slug === 'follow_up_1';

        column.innerHTML = `
            <div class="kanban-column-header${headerLight ? ' kanban-column-header--light' : ''}" style="background: ${stage.color || '#3498db'}">
                <div class="kanban-column-title">
                    <span>${escapeKanbanHtml(kanbanColumnTitle(stage))}</span>
                    <span class="kanban-column-count">${total}</span>
                </div>
            </div>
            <div class="kanban-column-cards" id="${stageCardsId}">
                ${visibleLeads
                    .map((lead) => {
                        try {
                            return renderKanbanCard(lead);
                        } catch (e) {
                            console.error('Kanban card render error', lead && lead.id, e);
                            return '';
                        }
                    })
                    .join('')}
            </div>
            ${
                remaining > 0
                    ? `<div class="kanban-column-footer">
                <button type="button" class="btn btn-secondary btn-sm kanban-load-more-btn" data-stage-id="${stage.id != null && stage.id !== '' ? stage.id : ''}" data-stage-slug="${stage.slug || ''}">
                    Ver mais (${remaining})
                </button>
            </div>`
                    : ''
            }
        `;

        board.appendChild(column);
    });
    } catch (err) {
        console.error('Error rendering kanban:', err);
        setKanbanBoardMessage(
            '<p class="kanban-board-message kanban-board-message--error">Erro ao mostrar o pipeline.</p>'
        );
    }
    syncKanbanLostToggleUi();
    renderLeadsMobilePipeline();
}

function bindKanbanLoadMore() {
    const board = document.getElementById('kanbanBoard');
    if (!board) return;
    board.querySelectorAll('.kanban-load-more-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
            const slug = (btn.dataset.stageSlug || '').trim();
            if (!slug) return;
            const cur = kanbanColumnVisible[slug] ?? KANBAN_CARDS_INITIAL;
            kanbanColumnVisible[slug] = cur + KANBAN_CARDS_STEP;
            renderKanbanBoard();
            bindKanbanLoadMore();
        });
    });
}

function visitKanbanAddress(v) {
    const a = v.address && String(v.address).trim();
    if (a) return a.length > 90 ? a.slice(0, 87) + '…' : a;
    return buildAddressFromVisitParts(v);
}

function buildAddressFromVisitParts(v) {
    const parts = [v.address_line1, v.city, v.zipcode].filter(Boolean).map(String).map((s) => s.trim());
    const s = parts.join(', ');
    return s.length > 90 ? s.slice(0, 87) + '…' : s;
}

function renderVisitKanbanCard(visit) {
    const lead = findLeadByIdKanban(visit.lead_id);
    const name = escapeKanbanHtml(visit.lead_name || lead?.name || 'Lead');
    const when = formatVisitKanbanDateTime(visit.scheduled_at);
    const addr = escapeKanbanHtml(visitKanbanAddress(visit) || '—');
    const assignee = escapeKanbanHtml(visit.assigned_to_name || '');
    const leadId = kanbanNumericId(visit.lead_id);
    const leadIdAttr = Number.isFinite(leadId) ? leadId : '';
    const titleBtn = Number.isFinite(leadId)
        ? `<span class="kanban-card-title-btn">${name}</span>`
        : `<span class="kanban-card-title-fallback">${name}</span>`;
    const sheetAttrs = Number.isFinite(leadId)
        ? ` role="button" tabindex="0" onclick="viewLead(${leadId}, event)" title="Ver detalhes do lead" class="kanban-card kanban-card--visit kanban-card--compact kanban-card--open-sheet"`
        : ` class="kanban-card kanban-card--visit kanban-card--compact"`;
    return `
        <div${sheetAttrs} data-lead-id="${leadIdAttr}" data-visit-id="${visit.id}">
            <div class="kanban-card-top">
                ${titleBtn}
                ${kanbanPriorityMarkup(lead?.priority)}
            </div>
            <div class="kanban-card-meta kanban-card-body--visit">
                <div class="kanban-card-row"><span class="kanban-card-label">Quando</span><span class="kanban-card-value">${escapeKanbanHtml(when)}</span></div>
                <div class="kanban-card-row"><span class="kanban-card-label">Local</span><span class="kanban-card-value">${addr}</span></div>
                ${assignee ? `<div class="kanban-card-row"><span class="kanban-card-label">Resp.</span><span class="kanban-card-value">${assignee}</span></div>` : ''}
            </div>
        </div>
    `;
}


function kanbanCanonicalStageSlug(slug) {
    if (typeof normalizePipelineSlug === 'function') {
        return normalizePipelineSlug(String(slug || '').trim());
    }
    return String(slug || '').trim();
}

/** Quando o lead entrou no estágio atual (fallback: updated_at, created_at). */
function kanbanStageEnteredAtRaw(lead) {
    return lead.pipeline_stage_entered_at || lead.updated_at || lead.created_at;
}

function kanbanDaysInCurrentColumn(lead) {
    const raw = kanbanStageEnteredAtRaw(lead);
    if (!raw) return null;
    const entered = new Date(raw);
    if (Number.isNaN(entered.getTime())) return null;
    const start = new Date(entered.getFullYear(), entered.getMonth(), entered.getDate());
    const today = new Date();
    const end = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const ms = end.getTime() - start.getTime();
    return Math.max(0, Math.floor(ms / 86400000));
}

function kanbanStageEnteredMs(lead) {
    const raw = kanbanStageEnteredAtRaw(lead);
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? 0 : d.getTime();
}

function sortKanbanColumnLeads(leads, stageSlug) {
    const canon = kanbanCanonicalStageSlug(stageSlug);
    const oldestFirst = KANBAN_OLDEST_FIRST_SLUGS.has(canon);
    return [...leads].sort((a, b) => {
        const ta = kanbanStageEnteredMs(a);
        const tb = kanbanStageEnteredMs(b);
        if (ta !== tb) return oldestFirst ? ta - tb : tb - ta;
        const ca = a.created_at ? new Date(a.created_at).getTime() : 0;
        const cb = b.created_at ? new Date(b.created_at).getTime() : 0;
        return oldestFirst ? ca - cb : cb - ca;
    });
}

function formatKanbanLeadEnteredAt(createdAt) {
    if (!createdAt) return 'Data não disponível';
    const d = new Date(createdAt);
    if (Number.isNaN(d.getTime())) return 'Data não disponível';
    try {
        return d.toLocaleDateString('pt-PT', { day: '2-digit', month: 'short', year: 'numeric' });
    } catch (_) {
        return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
    }
}

function formatKanbanDaysInColumnLabel(days) {
    if (days == null) return '';
    if (days === 0) return 'Hoje';
    if (days === 1) return '1 dia';
    return `${days} dias`;
}

/** LP → Google logo; Meta Instant → Facebook logo. */
function resolveKanbanLeadOrigin(lead) {
    if (!lead) return '';
    const source = String(lead.source || '').trim().toLowerCase();
    const formType = String(lead.form_type || '').trim().toLowerCase();
    const platform = String(lead.marketing_platform || '').trim().toLowerCase();
    const utm = String(lead.utm_source || '').trim().toLowerCase();
    const medium = String(lead.utm_medium || '').trim().toLowerCase();
    const blob = [source, formType, platform, utm, medium].join(' ');
    if (
        /meta-instant|meta_instant/.test(blob) ||
        /\bmeta\b/.test(blob) ||
        /facebook|fbclid|instagram|\big\b/.test(blob)
    ) {
        return 'meta';
    }
    if (
        /^lp[-_]?/i.test(String(lead.source || '').trim()) ||
        /lp-contact|lp-hero|lp_contact|lp_hero/.test(blob) ||
        /google|gclid|adwords|landing/.test(blob) ||
        formType === 'hero-form' ||
        formType === 'contact-form'
    ) {
        return 'google';
    }
    return '';
}

function kanbanOriginLogoHtml(lead) {
    const origin = resolveKanbanLeadOrigin(lead);
    if (origin === 'meta') {
        return `<span class="kanban-card-origin-logo kanban-card-origin-logo--meta" title="Meta / Facebook" aria-label="Meta">${
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">' +
            '<path fill="#1877F2" d="M24 12.07C24 5.41 18.63 0 12 0S0 5.41 0 12.07C0 18.1 4.39 23.1 10.13 24v-8.44H7.08v-3.49h3.05v-2.66c0-3.02 1.79-4.7 4.54-4.7 1.31 0 2.68.24 2.68.24v2.95h-1.51c-1.49 0-1.95.93-1.95 1.89v2.28h3.32l-.53 3.49h-2.79V24C19.61 23.1 24 18.1 24 12.07z"/>' +
            '</svg>'
        }</span>`;
    }
    if (origin === 'google') {
        return `<span class="kanban-card-origin-logo kanban-card-origin-logo--google" title="Google / Landing page" aria-label="Google">${
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">' +
            '<path fill="#4285F4" d="M23.49 12.27c0-.79-.07-1.54-.2-2.27H12v4.3h6.44a5.5 5.5 0 0 1-2.39 3.61v3h3.87c2.26-2.09 3.57-5.17 3.57-8.64z"/>' +
            '<path fill="#34A853" d="M12 24c3.24 0 5.95-1.07 7.93-2.91l-3.87-3a7.1 7.1 0 0 1-4.06 1.15c-3.12 0-5.76-2.11-6.7-4.94H1.3v3.09A12 12 0 0 0 12 24z"/>' +
            '<path fill="#FBBC05" d="M5.3 14.3A7.2 7.2 0 0 1 4.92 12c0-.8.14-1.58.38-2.3V6.61H1.3A12 12 0 0 0 0 12c0 1.94.46 3.77 1.3 5.39l4-3.09z"/>' +
            '<path fill="#EA4335" d="M12 4.77c1.76 0 3.34.61 4.58 1.8l3.43-3.43C17.95 1.19 15.24 0 12 0A12 12 0 0 0 1.3 6.61l4 3.09C6.24 6.88 8.88 4.77 12 4.77z"/>' +
            '</svg>'
        }</span>`;
    }
    return '';
}

// Render Kanban Card
function renderKanbanCard(lead) {
    const enteredAt = escapeKanbanHtml(formatKanbanLeadEnteredAt(lead.created_at));
    const daysInColumn = kanbanDaysInCurrentColumn(lead);
    const daysLabel = escapeKanbanHtml(formatKanbanDaysInColumnLabel(daysInColumn));
    const staleAlert = daysInColumn != null && daysInColumn >= 5;
    const daysHtml =
        daysInColumn != null
            ? `<span class="kanban-card-column-days${staleAlert ? ' kanban-card-column-days--alert' : ''}" title="Tempo nesta coluna">${daysLabel}${staleAlert ? '<span class="kanban-card-stale-dot" aria-hidden="true"></span>' : ''}</span>`
            : '';
    const name = escapeKanbanHtml(lead.name || 'Sem nome');
    const email = lead.email ? escapeKanbanHtml(lead.email) : '';
    const phone = lead.phone ? escapeKanbanHtml(lead.phone) : '';
    const emailRow = email
        ? `<div class="kanban-card-row"><span class="kanban-card-label">Email</span><span class="kanban-card-value kanban-card-truncate" title="${email}">${email}</span></div>`
        : '';
    const phoneRow = phone
        ? `<div class="kanban-card-row"><span class="kanban-card-label">Tel.</span><span class="kanban-card-value">${phone}</span></div>`
        : '';
    const valueRow =
        lead.estimated_value != null && lead.estimated_value !== ''
            ? `<div class="kanban-card-row"><span class="kanban-card-label">Valor</span><span class="kanban-card-value">$${parseFloat(lead.estimated_value).toLocaleString()}</span></div>`
            : '';
    const quoteIcons =
        typeof renderLeadQuoteEngagementIconsHtml === 'function'
            ? renderLeadQuoteEngagementIconsHtml(
                  lead._quoteEngagement || quoteEngagementByLeadId[lead.id] || null,
                  escapeKanbanHtml,
                  { compact: true }
              )
            : '';
    const originLogo = kanbanOriginLogoHtml(lead);
    const deleteBtn = `<button type="button" class="btn-lead-delete-kanban" onclick="event.stopPropagation(); if (typeof deleteLead === 'function') deleteLead(${lead.id});" title="Excluir lead" aria-label="Excluir lead">✕</button>`;

    return `
        <div class="kanban-card kanban-card--compact kanban-card--open-sheet" data-lead-id="${lead.id}" role="button" tabindex="0" onclick="viewLead(${lead.id}, event)" title="Ver detalhes do lead">
            <div class="kanban-card-top">
                ${originLogo}
                <span class="kanban-card-title-btn">${name}</span>
                <span class="kanban-card-actions">
                    ${kanbanPriorityMarkup(lead.priority)}
                    ${deleteBtn}
                </span>
            </div>
            <div class="kanban-card-meta">
                ${emailRow}
                ${phoneRow}
                ${valueRow}
            </div>
            ${quoteIcons}
            <div class="kanban-card-footer-row" title="Data de entrada · tempo na coluna">
                <span class="kanban-card-entered-date">${enteredAt}</span>
                ${daysHtml}
            </div>
        </div>
    `;
}

/** Preenche o select de estágio do modal Novo Lead (inclui Visita Agendada, etc.). */
async function populateNewLeadPipelineSelect() {
    const select = document.getElementById('newLeadPipelineStage');
    if (!select) return;
    let stages = [];
    try {
        const res = await fetch('/api/pipeline-stages', { credentials: 'include' });
        const data = await res.json();
        if (data.success && Array.isArray(data.data) && typeof mergePipelineStagesForUi === 'function') {
            stages = mergePipelineStagesForUi(data.data);
        } else if (data.success && Array.isArray(data.data)) {
            stages = data.data
                .filter((s) => s.is_active !== 0)
                .sort((a, b) => (a.order_num || 0) - (b.order_num || 0));
        }
    } catch (e) {
        /* ignore */
    }
    if (stages.length === 0) {
        stages = [
            { id: 1, slug: 'new_lead', name: 'New Lead' },
            { id: 2, slug: 'meeting_scheduled', name: 'Meeting Scheduled' },
            { id: 3, slug: 'quote_sent', name: 'Quote Sent' },
            { id: 4, slug: 'follow_up_1', name: 'Follow Up' },
            { id: 5, slug: 'stand_by', name: 'Stand By' },
            { id: 6, slug: 'won', name: 'Won' },
            { id: 7, slug: 'lost', name: 'Lost' },
        ];
    }
    const prev = select.value || 'new_lead';
    select.innerHTML = '';
    stages.forEach((s) => {
        const slug = s.slug || s.name;
        if (!slug) return;
        const opt = document.createElement('option');
        opt.value = slug;
        opt.textContent =
            typeof pipelineStageDisplayName === 'function'
                ? pipelineStageDisplayName(slug, s.name)
                : s.name || slug;
        if (s.id != null) opt.dataset.stageId = String(s.id);
        select.appendChild(opt);
    });
    let found = false;
    for (let i = 0; i < select.options.length; i++) {
        if (select.options[i].value === prev) {
            select.selectedIndex = i;
            found = true;
            break;
        }
    }
    if (!found) {
        for (let j = 0; j < select.options.length; j++) {
            if (select.options[j].value === 'new_lead') {
                select.selectedIndex = j;
                break;
            }
        }
    }
}

// Show New Lead Modal
function showNewLeadModal() {
    loadLeadFormUsers();
    void populateNewLeadPipelineSelect();
    document.getElementById('newLeadModal').classList.add('active');
    document.getElementById('newLeadModal').style.display = 'flex';
}

// Create Lead Manually
async function createLeadManual(e) {
    e.preventDefault();
    const form = e.target;
    const formData = new FormData(form);
    
    const stageSelect = document.getElementById('newLeadPipelineStage');
    const stageSlug = (stageSelect && stageSelect.value) || 'new_lead';
    const stageOpt = stageSelect && stageSelect.options[stageSelect.selectedIndex];
    const stageIdRaw = stageOpt && stageOpt.dataset && stageOpt.dataset.stageId;
    const pipelineStageId = stageIdRaw ? parseInt(stageIdRaw, 10) : null;

    const leadData = {
        name: formData.get('name'),
        email: formData.get('email'),
        phone: formData.get('phone'),
        zipcode: formData.get('zipcode'),
        message: formData.get('message'),
        source: formData.get('source') || 'Manual',
        priority: formData.get('priority') || 'medium',
        owner_id: formData.get('owner_id') || null,
        estimated_value: parseFloat(formData.get('estimated_value')) || null,
        notes: formData.get('notes'),
        status: stageSlug,
    };
    if (Number.isFinite(pipelineStageId)) {
        leadData.pipeline_stage_id = pipelineStageId;
    }
    
    try {
        const response = await fetch('/api/leads', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(leadData)
        });
        
        const data = await response.json();
        if (data.success) {
            if (typeof crmNotify === 'function') crmNotify('Lead criado com sucesso!', 'success');
            else alert('Lead criado com sucesso!');
            closeModal('newLeadModal');
            form.reset();
            if (currentView === 'kanban') {
                loadKanbanBoard();
            } else {
                loadLeads();
            }
        } else {
            if (typeof crmNotify === 'function') crmNotify('Erro ao criar lead: ' + (data.error || 'Desconhecido'), 'error');
            else alert('Erro ao criar lead: ' + (data.error || 'Desconhecido'));
        }
    } catch (error) {
        console.error('Error creating lead:', error);
        if (typeof crmNotify === 'function') crmNotify('Erro ao criar lead', 'error');
        else alert('Erro ao criar lead');
    }
}

// Show Assign Lead Modal
function showAssignLeadModal(leadId) {
    loadLeadFormUsers();
    document.getElementById('assignLeadId').value = leadId;
    document.getElementById('assignLeadModal').classList.add('active');
    document.getElementById('assignLeadModal').style.display = 'flex';
}

// Assign Lead
async function assignLead(e) {
    e.preventDefault();
    const form = e.target;
    const formData = new FormData(form);
    const leadId = parseInt(formData.get('lead_id'));
    const ownerId = formData.get('owner_id') || null;
    
    try {
        const response = await fetch(`/api/leads/${leadId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ owner_id: ownerId })
        });
        
        const data = await response.json();
        if (data.success) {
            if (typeof crmNotify === 'function') crmNotify('Lead designado com sucesso!', 'success');
            else alert('Lead designado com sucesso!');
            closeModal('assignLeadModal');
            if (currentView === 'kanban') {
                loadKanbanBoard();
            } else {
                loadLeads();
            }
        } else {
            if (typeof crmNotify === 'function') crmNotify('Erro ao designar lead: ' + (data.error || 'Desconhecido'), 'error');
            else alert('Erro ao designar lead: ' + (data.error || 'Desconhecido'));
        }
    } catch (error) {
        console.error('Error assigning lead:', error);
        if (typeof crmNotify === 'function') crmNotify('Erro ao designar lead', 'error');
        else alert('Erro ao designar lead');
    }
}

// Show Follow-up Modal
function showFollowupModal(leadId) {
    loadLeadFormUsers();
    document.getElementById('followupLeadId').value = leadId;
    
    // Set default due date to tomorrow
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(10, 0, 0, 0);
    const datetimeLocal = tomorrow.toISOString().slice(0, 16);
    document.querySelector('#followupForm input[name="due_date"]').value = datetimeLocal;
    
    document.getElementById('followupModal').classList.add('active');
    document.getElementById('followupModal').style.display = 'flex';
}

// Create Follow-up
async function createFollowup(e) {
    e.preventDefault();
    const form = e.target;
    const formData = new FormData(form);
    const leadId = parseInt(formData.get('lead_id'));
    
    const followupData = {
        title: formData.get('title'),
        description: formData.get('description'),
        due_date: formData.get('due_date'),
        priority: formData.get('priority') || 'medium',
        assigned_to: formData.get('assigned_to') || null
    };
    
    try {
        const response = await fetch(`/api/leads/${leadId}/followups`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(followupData)
        });
        
        const data = await response.json();
        if (data.success) {
            if (typeof crmNotify === 'function') crmNotify('Follow-up criado com sucesso!', 'success');
            else alert('Follow-up criado com sucesso!');
            closeModal('followupModal');
            form.reset();
        } else {
            if (typeof crmNotify === 'function') crmNotify('Erro ao criar follow-up: ' + (data.error || 'Desconhecido'), 'error');
            else alert('Erro ao criar follow-up: ' + (data.error || 'Desconhecido'));
        }
    } catch (error) {
        console.error('Error creating followup:', error);
        if (typeof crmNotify === 'function') crmNotify('Erro ao criar follow-up', 'error');
        else alert('Erro ao criar follow-up');
    }
}

// Close Modal
function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.remove('active');
        modal.style.display = 'none';
    }
}

// Close modals when clicking outside
document.addEventListener('click', (e) => {
    if (e.target.classList.contains('modal')) {
        e.target.classList.remove('active');
        e.target.style.display = 'none';
    }
});

/* ========== Mobile Leads pipeline (shell #leadsMobileShell) ========== */
let leadsMobileActiveSlug = '';
let leadsMobileSwipeBound = false;
let leadsMobileSearchBound = false;
const LCARD_SWIPE_LEFT = -96;
const LCARD_SWIPE_RIGHT = 96;

function isLeadsMobileLayout() {
    return typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 1024px)').matches;
}

function getLeadsMobileActiveStage() {
    const stages = getKanbanBoardStages();
    if (!stages.length) return null;
    if (leadsMobileActiveSlug) {
        const hit = stages.find(
            (s) => kanbanCanonicalStageSlug(s.slug) === kanbanCanonicalStageSlug(leadsMobileActiveSlug)
        );
        if (hit) return hit;
    }
    leadsMobileActiveSlug = stages[0].slug || '';
    return stages[0];
}

function setLeadsMobileActiveStage(slug) {
    leadsMobileActiveSlug = String(slug || '');
    renderLeadsMobilePipeline();
    const active = document.querySelector('#leadsMobileChips .chiptrack__chip.is-active');
    if (active && typeof active.scrollIntoView === 'function') {
        active.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    }
}

function syncChiptrackBar(trackId, barId, activeSelector) {
    const track = document.getElementById(trackId);
    const bar = document.getElementById(barId);
    if (!track || !bar) return;
    const scroll = track.querySelector('.chiptrack__scroll') || track;
    const active = scroll.querySelector(activeSelector);
    if (!active) {
        bar.style.width = '0px';
        return;
    }
    const trackRect = track.getBoundingClientRect();
    const activeRect = active.getBoundingClientRect();
    const x = activeRect.left - trackRect.left;
    bar.style.width = Math.max(20, activeRect.width) + 'px';
    bar.style.transform = `translateX(${Math.max(0, x)}px)`;
}

function leadsMobileStageLabel(stage) {
    return escapeKanbanHtml(kanbanColumnTitle(stage) || stage.slug || 'Stage');
}

function leadsMobilePriClass(priorityRaw) {
    const p = String(priorityRaw || 'medium').toLowerCase().replace(/[^a-z]/g, '') || 'medium';
    if (p === 'high') return 'lcard__pri--high';
    if (p === 'low') return 'lcard__pri--low';
    return 'lcard__pri--medium';
}

function leadsMobileTelHref(phone) {
    if (typeof window.sfBuildTelHref === 'function') return window.sfBuildTelHref(phone) || '';
    if (!phone) return '';
    const digits = String(phone).replace(/[^\d+]/g, '');
    return digits ? `tel:${digits}` : '';
}

function renderLeadsMobileCard(lead, stage, stages) {
    const id = kanbanNumericId(lead.id);
    const name = escapeKanbanHtml(lead.name || 'Sem nome');
    const phone = lead.phone ? escapeKanbanHtml(lead.phone) : '';
    const tel = leadsMobileTelHref(lead.phone);
    const days = kanbanDaysInCurrentColumn(lead);
    const daysLabel = formatKanbanDaysInColumnLabel(days);
    const stale = days != null && days >= 5;
    const val =
        lead.estimated_value != null && lead.estimated_value !== ''
            ? `$${parseFloat(lead.estimated_value).toLocaleString()}`
            : '';
    const idx = stages.findIndex(
        (s) => kanbanCanonicalStageSlug(s.slug) === kanbanCanonicalStageSlug(stage.slug)
    );
    const hasNext = idx >= 0 && idx < stages.length - 1;
    const callDisabled = !tel;
    const flagHtml = stale
        ? `<span class="lcard__flag">Follow-up atrasado ${escapeKanbanHtml(String(days))}d</span>`
        : daysLabel
          ? `<span class="lcard__days">${escapeKanbanHtml(daysLabel)}</span>`
          : '';
    const metaBits = [phone, lead.email ? escapeKanbanHtml(lead.email) : ''].filter(Boolean);
    const callIcon =
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.8 19.8 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.81.36 1.6.68 2.34a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.74-1.74a2 2 0 0 1 2.11-.45c.74.32 1.53.55 2.34.68A2 2 0 0 1 22 16.92z"/></svg>';
    const advanceIcon =
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14"/><path d="M13 5l7 7-7 7"/></svg>';

    return `<article class="lcard" data-lead-id="${id}">
  <div class="lcard__actions" aria-hidden="true">
    <div class="lcard__action-slot lcard__action-slot--left">
      <button type="button" class="lcard__action-btn lcard__action-btn--call" data-lcard-call="${id}" ${callDisabled ? 'disabled' : ''} data-crm-permission="leads.view">${callIcon}<span>Ligar</span></button>
    </div>
    <div class="lcard__action-slot lcard__action-slot--right">
      <button type="button" class="lcard__action-btn lcard__action-btn--advance" data-lcard-advance="${id}" ${hasNext ? '' : 'disabled'} data-crm-permission="leads.view">${advanceIcon}<span>Avançar</span></button>
    </div>
  </div>
  <div class="lcard__body touchable" data-lcard-open="${id}" role="button" tabindex="0">
    <div class="lcard__top">
      <span class="lcard__pri ${leadsMobilePriClass(lead.priority)}" aria-hidden="true"></span>
      <div style="flex:1;min-width:0">
        <div class="lcard__name">${name}</div>
        ${metaBits.length ? `<div class="lcard__meta">${metaBits.join(' · ')}</div>` : ''}
      </div>
    </div>
    <div class="lcard__row">
      ${val ? `<span class="lcard__value">${escapeKanbanHtml(val)}</span>` : '<span></span>'}
      ${flagHtml}
    </div>
  </div>
</article>`;
}

function renderLeadsMobilePipeline() {
    const shell = document.getElementById('leadsMobileShell');
    const chipsEl = document.getElementById('leadsMobileChips');
    const listEl = document.getElementById('leadsMobileList');
    if (!shell || !chipsEl || !listEl) return;
    if (!isLeadsMobileLayout() && shell.offsetParent === null) {
        /* still update if shell exists — layout may toggle */
    }

    bindLeadsMobileSearchOnce();

    const stages = getKanbanBoardStages();
    if (!stages.length) {
        chipsEl.innerHTML = '';
        listEl.innerHTML = '<div class="llist__empty">A carregar estágios…</div>';
        return;
    }

    const active = getLeadsMobileActiveStage();
    const activeCanon = kanbanCanonicalStageSlug(active && active.slug);

    chipsEl.innerHTML = stages
        .map((stage) => {
            const count = allLeads.filter((lead) => leadMatchesKanbanColumn(lead, stage)).length;
            const slug = escapeKanbanHtml(stage.slug || '');
            const isActive = kanbanCanonicalStageSlug(stage.slug) === activeCanon;
            return `<button type="button" class="chiptrack__chip${isActive ? ' is-active' : ''}" role="tab" aria-selected="${isActive ? 'true' : 'false'}" data-stage-slug="${slug}">${leadsMobileStageLabel(stage)}<span class="chiptrack__chip-count">${count}</span></button>`;
        })
        .join('');

    if (!chipsEl.dataset.chipClickBound) {
        chipsEl.dataset.chipClickBound = '1';
        chipsEl.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-stage-slug]');
            if (!btn) return;
            setLeadsMobileActiveStage(btn.getAttribute('data-stage-slug'));
        });
        const track = document.getElementById('leadsMobileChiptrack');
        if (track) {
            track.addEventListener(
                'scroll',
                () => syncChiptrackBar('leadsMobileChiptrack', 'leadsMobileChipBar', '.chiptrack__chip.is-active'),
                { passive: true }
            );
        }
    }

    requestAnimationFrame(() => {
        syncChiptrackBar('leadsMobileChiptrack', 'leadsMobileChipBar', '.chiptrack__chip.is-active');
    });

    const stageLeads = sortKanbanColumnLeads(
        allLeads.filter((lead) => leadMatchesKanbanColumn(lead, active)),
        active.slug
    );

    let sum = 0;
    stageLeads.forEach((l) => {
        const v = parseFloat(l.estimated_value);
        if (Number.isFinite(v)) sum += v;
    });

    const countEl = document.getElementById('leadsMobileStageCount');
    const valueEl = document.getElementById('leadsMobileStageValue');
    const subEl = document.getElementById('leadsMobileSubtitle');
    const n = stageLeads.length;
    if (countEl) countEl.textContent = n === 1 ? '1 lead' : `${n} leads`;
    if (valueEl) {
        valueEl.textContent =
            '$' +
            sum.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 });
    }
    if (subEl) subEl.textContent = kanbanColumnTitle(active) || 'Pipeline';

    if (!stageLeads.length) {
        listEl.innerHTML = `<div class="llist__empty">Nenhum lead em ${leadsMobileStageLabel(active)}</div>`;
    } else {
        listEl.innerHTML = stageLeads.map((lead) => renderLeadsMobileCard(lead, active, stages)).join('');
    }

    bindLeadsMobileListInteractions(listEl);

    if (typeof applyCrmNavPermissions === 'function' && typeof crmUserPermissions !== 'undefined') {
        try {
            applyCrmNavPermissions(crmUserPermissions, typeof crmUserRole !== 'undefined' ? crmUserRole : null);
        } catch (_) {}
    }
}

function bindLeadsMobileSearchOnce() {
    if (leadsMobileSearchBound) return;
    const mobile = document.getElementById('leadsMobileSearch');
    const desktop = document.getElementById('leadsListSearchInput');
    if (!mobile) return;
    leadsMobileSearchBound = true;
    if (desktop && desktop.value && !mobile.value) mobile.value = desktop.value;
    const syncAndSearch = () => {
        if (desktop) desktop.value = mobile.value;
        if (typeof leadsSearchSubmit === 'function') leadsSearchSubmit();
        else if (typeof loadKanbanBoard === 'function') void loadKanbanBoard();
    };
    mobile.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            syncAndSearch();
        }
    });
    let t = null;
    mobile.addEventListener('input', () => {
        clearTimeout(t);
        t = setTimeout(syncAndSearch, 320);
    });
}

function notifyLeadsMobile(msg, kind) {
    if (typeof crmNotify === 'function') crmNotify(msg, kind || 'info');
    else if (typeof window.crmToast === 'object' && window.crmToast) {
        const fn = kind === 'error' ? window.crmToast.error : window.crmToast.success || window.crmToast.info;
        if (typeof fn === 'function') fn(msg);
    }
}

async function advanceLeadMobileStage(leadId) {
    const stages = getKanbanBoardStages();
    const lead = allLeads.find((l) => kanbanNumericId(l.id) === kanbanNumericId(leadId));
    if (!lead || !stages.length) return;
    const cur = resolveStageForLead(lead);
    const idx = stages.findIndex(
        (s) =>
            kanbanCanonicalStageSlug(s.slug) ===
            kanbanCanonicalStageSlug(cur && cur.slug)
    );
    if (idx < 0 || idx >= stages.length - 1) {
        notifyLeadsMobile('Já está no último estágio do pipeline.', 'info');
        return;
    }
    const next = stages[idx + 1];
    const nextSlug = next.slug;
    const nextName = kanbanColumnTitle(next) || nextSlug;
    if (typeof window.updateLeadPipelineStage === 'function') {
        const ok = await window.updateLeadPipelineStage(leadId, nextSlug);
        if (ok) {
            leadsMobileActiveSlug = nextSlug;
            notifyLeadsMobile(`Movido para ${nextName}`, 'success');
            renderLeadsMobilePipeline();
        }
        return;
    }
    notifyLeadsMobile('Não foi possível avançar o estágio.', 'error');
}

function bindLeadsMobileListInteractions(container) {
    if (!container) return;
    if (!leadsMobileSwipeBound) {
        leadsMobileSwipeBound = true;
        let activeCard = null;
        let startX = 0;
        let startY = 0;
        let dragging = false;
        let axisLocked = null;
        let skipClick = false;

        function getBody(card) {
            return card && card.querySelector('.lcard__body');
        }

        function setOffset(card, x) {
            const body = getBody(card);
            if (!body) return;
            if (!x) {
                body.style.transform = '';
                card.classList.remove('lcard--open-left', 'lcard--open-right');
                return;
            }
            body.style.transform = `translateX(${x}px)`;
            card.classList.toggle('lcard--open-right', x > 40);
            card.classList.toggle('lcard--open-left', x < -40);
        }

        function closeAll(except) {
            container.querySelectorAll('.lcard').forEach((c) => {
                if (c !== except) setOffset(c, 0);
            });
        }

        container.addEventListener(
            'pointerdown',
            (e) => {
                const card = e.target.closest('.lcard');
                if (!card || e.target.closest('button')) return;
                activeCard = card;
                startX = e.clientX;
                startY = e.clientY;
                dragging = false;
                axisLocked = null;
                skipClick = false;
                const body = getBody(card);
                if (body) body.style.transition = 'none';
            },
            { passive: true }
        );

        container.addEventListener(
            'pointermove',
            (e) => {
                if (!activeCard) return;
                const dx = e.clientX - startX;
                const dy = e.clientY - startY;
                if (!axisLocked) {
                    if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
                    axisLocked = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
                }
                if (axisLocked !== 'x') return;
                dragging = true;
                skipClick = true;
                let next = dx;
                if (next > LCARD_SWIPE_RIGHT + 20) next = LCARD_SWIPE_RIGHT + 20;
                if (next < LCARD_SWIPE_LEFT - 20) next = LCARD_SWIPE_LEFT - 20;
                setOffset(activeCard, next);
            },
            { passive: true }
        );

        const endDrag = () => {
            if (!activeCard) return;
            const card = activeCard;
            const body = getBody(card);
            activeCard = null;
            if (body) body.style.transition = '';
            if (!dragging || axisLocked !== 'x') {
                dragging = false;
                axisLocked = null;
                return;
            }
            dragging = false;
            axisLocked = null;
            const style = body && body.style.transform ? body.style.transform : '';
            const m = /translateX\((-?\d+(?:\.\d+)?)px\)/.exec(style);
            const x = m ? parseFloat(m[1]) : 0;
            closeAll(card);
            if (x >= 56) setOffset(card, LCARD_SWIPE_RIGHT);
            else if (x <= -56) setOffset(card, LCARD_SWIPE_LEFT);
            else setOffset(card, 0);
            try {
                if (Math.abs(x) >= 56) navigator.vibrate(8);
            } catch (_) {}
        };

        container.addEventListener('pointerup', endDrag, { passive: true });
        container.addEventListener('pointercancel', endDrag, { passive: true });

        container.addEventListener('click', (e) => {
            const callBtn = e.target.closest('[data-lcard-call]');
            if (callBtn) {
                e.preventDefault();
                e.stopPropagation();
                const id = parseInt(callBtn.getAttribute('data-lcard-call'), 10);
                const lead = allLeads.find((l) => kanbanNumericId(l.id) === id);
                const href = lead ? leadsMobileTelHref(lead.phone) : '';
                if (href) window.location.href = href;
                else notifyLeadsMobile('Este lead não tem telefone.', 'error');
                return;
            }
            const advBtn = e.target.closest('[data-lcard-advance]');
            if (advBtn) {
                e.preventDefault();
                e.stopPropagation();
                const id = parseInt(advBtn.getAttribute('data-lcard-advance'), 10);
                if (Number.isFinite(id)) void advanceLeadMobileStage(id);
                return;
            }
            if (skipClick) {
                skipClick = false;
                return;
            }
            const openEl = e.target.closest('[data-lcard-open]');
            if (!openEl) return;
            const card = openEl.closest('.lcard');
            if (card && (card.classList.contains('lcard--open-left') || card.classList.contains('lcard--open-right'))) {
                setOffset(card, 0);
                return;
            }
            const id = parseInt(openEl.getAttribute('data-lcard-open'), 10);
            if (!Number.isFinite(id)) return;
            if (typeof window.openLeadQuickSheet === 'function') {
                void window.openLeadQuickSheet(id, openEl);
            } else if (typeof viewLead === 'function') {
                viewLead(id);
            }
        });
    }
}

// Initialize on page load
if (typeof window !== 'undefined') {
    window.showKanbanView = showKanbanView;
    window.showListView = showListView;
    window.loadCRMKanban = loadCRMKanban;
    window.showNewLeadModal = showNewLeadModal;
    window.showAssignLeadModal = showAssignLeadModal;
    window.showFollowupModal = showFollowupModal;
    window.createLeadManual = createLeadManual;
    window.assignLead = assignLead;
    window.createFollowup = createFollowup;
    window.closeModal = closeModal;
    window.loadKanbanBoard = loadKanbanBoard;
    window.patchKanbanLeadCache = patchKanbanLeadCache;
    window.toggleKanbanLostColumn = toggleKanbanLostColumn;
    window.renderLeadsMobilePipeline = renderLeadsMobilePipeline;
    window.getKanbanBoardStages = getKanbanBoardStages;
    window.syncChiptrackBar = syncChiptrackBar;

    // loadCRMKanban is already defined above

    // Leads = só Kanban (lista desativada na UI)
    const originalLoadLeads = window.loadLeads;
    if (originalLoadLeads) {
        window.loadLeads = async function () {
            if (typeof loadCRMKanban === 'function') {
                await loadCRMKanban();
            } else {
                await originalLoadLeads();
            }
        };
    }
}
