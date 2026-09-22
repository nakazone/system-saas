/**
 * Lead Detail Page JavaScript
 */

let currentLeadId = null;
let currentLead = null;

// Check authentication and get lead ID from URL
window.addEventListener('DOMContentLoaded', () => {
    // Get lead ID from URL
    const urlParams = new URLSearchParams(window.location.search);
    currentLeadId = parseInt(urlParams.get('id'));

    if (!currentLeadId) {
        alert('Lead ID não encontrado na URL');
        window.location.href = 'dashboard.html';
        return;
    }

    // Check session
    fetch('/api/auth/session', { credentials: 'include' })
        .then(r => r.json())
        .then(data => {
            if (!data.authenticated) {
                window.location.href = '/login.html';
                return;
            }
            const un = document.getElementById('userName');
            if (un) un.textContent = data.user.name || data.user.email;
            loadLead();
        })
        .catch(err => {
            console.error('Session check error:', err);
            window.location.href = '/login.html';
        });

    // Logout
    document.getElementById('logoutBtn').addEventListener('click', async () => {
        await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
        window.location.href = '/login.html';
    });

    // Tab switching
    document.querySelectorAll('.tab').forEach(tab => {
        tab.addEventListener('click', () => {
            const tabName = tab.dataset.tab;
            switchTab(tabName);
        });
    });

    // Score automático da qualificação
    attachQualificationScoreListeners();

    wireVisitScheduleHalfHourInputs_();

    // Menu lateral fixo: toggle mobile
    const sidebar = document.getElementById('dashboardSidebar');
    const overlay = document.getElementById('mobileOverlay');
    const menuBtn = document.getElementById('mobileMenuToggle');
    if (menuBtn && sidebar && overlay) {
        menuBtn.addEventListener('click', () => { sidebar.classList.toggle('mobile-open'); overlay.classList.toggle('active'); });
        overlay.addEventListener('click', () => { sidebar.classList.remove('mobile-open'); overlay.classList.remove('active'); });
    }

    const phoneActions = document.getElementById('leadPhoneActions');
    if (phoneActions) {
        phoneActions.addEventListener('click', onLeadDetailContactActionsClick);
    }
    const emailActions = document.getElementById('leadEmailActions');
    if (emailActions) {
        emailActions.addEventListener('click', onLeadDetailContactActionsClick);
    }
});

async function loadLead() {
    try {
        const response = await fetch(`/api/leads/${currentLeadId}`, { credentials: 'include' });
        const data = await response.json();
        
        if (data.success) {
            currentLead = data.data;
            if (typeof window.sfPrefetchLeadVisitIcs === 'function' && currentLead.id) {
                void window.sfPrefetchLeadVisitIcs(currentLead.id);
            }
            renderLead();
            loadPipelineStages();
            loadQualification();
            loadFollowups();
            loadInteractions();
            loadVisits();
            loadProposals();

            const qs = new URLSearchParams(window.location.search);
            const tabWant = qs.get('tab');
            if (tabWant && typeof switchTab === 'function') {
                try {
                    switchTab(tabWant);
                } catch (_) {}
            }
            if (qs.get('schedule') === '1' && typeof showNewVisitModal === 'function') {
                setTimeout(() => showNewVisitModal(), 0);
            }
            if (typeof window.sfInitCrmAddressAutocomplete === 'function') {
                setTimeout(() => window.sfInitCrmAddressAutocomplete(), 200);
            }
        } else {
            alert('Erro ao carregar lead: ' + (data.error || 'Desconhecido'));
            window.location.href = 'dashboard.html';
        }
    } catch (error) {
        console.error('Error loading lead:', error);
        alert('Erro ao carregar lead');
    }
}

function renderLeadContactActions(lead) {
    const phoneMount = document.getElementById('leadPhoneActions');
    if (phoneMount) {
        if (!lead || !lead.phone) {
            phoneMount.innerHTML = '';
        } else {
            const tel =
                typeof window.sfBuildTelHref === 'function' ? window.sfBuildTelHref(lead.phone) : '';
            const smsHtml =
                typeof window.sfRenderLeadSmsActionHtml === 'function'
                    ? window.sfRenderLeadSmsActionHtml(lead, 'btn btn-sm btn-secondary lead-contact-actions__btn')
                    : '';
            let html = '';
            if (tel) {
                html += `<a class="btn btn-sm btn-secondary lead-contact-actions__btn" href="${tel}">Ligar</a>`;
            }
            html += smsHtml;
            phoneMount.innerHTML = html;
        }
    }
    const emailMount = document.getElementById('leadEmailActions');
    if (emailMount) {
        emailMount.innerHTML =
            lead && lead.email && typeof window.sfRenderLeadEmailActionHtml === 'function'
                ? window.sfRenderLeadEmailActionHtml(lead, 'btn btn-sm btn-secondary lead-contact-actions__btn')
                : '';
    }
}

function onLeadDetailContactActionsClick(e) {
    if (!currentLead) return;
    const smsBtn = e.target.closest('[data-sf-sms-picker-btn]');
    if (smsBtn) {
        e.preventDefault();
        if (typeof window.sfOpenSmsChoiceMenu === 'function') {
            window.sfOpenSmsChoiceMenu(smsBtn, currentLead);
        }
        return;
    }
    const emailBtn = e.target.closest('[data-sf-email-picker-btn]');
    if (emailBtn) {
        e.preventDefault();
        if (typeof window.sfOpenEmailChoiceMenu === 'function') {
            window.sfOpenEmailChoiceMenu(emailBtn, currentLead);
        }
    }
}

function renderLead() {
    if (!currentLead) return;

    document.getElementById('leadName').textContent = currentLead.name || 'Sem nome';
    document.getElementById('leadEmail').textContent = currentLead.email || '-';
    document.getElementById('leadPhone').textContent = currentLead.phone || '-';
    renderLeadContactActions(currentLead);
    var nextStepsEl = document.getElementById('leadNextSteps');
    if (nextStepsEl) nextStepsEl.textContent = currentLead.next_steps || currentLead.next_steps_notes || '-';

    // Form fields
    var fn = document.getElementById('leadFullName');
    if (fn) fn.value = currentLead.name || '';
    var sp = document.getElementById('leadSummaryPhone');
    if (sp) sp.value = currentLead.phone || '';
    var em = document.getElementById('leadSummaryEmail');
    if (em) em.value = currentLead.email || '';
    var fa = document.getElementById('leadFullAddress');
    if (fa) fa.value = currentLead.address != null ? currentLead.address : '';
    var z = document.getElementById('leadSummaryZip');
    if (z) z.value = currentLead.zipcode || '';
    document.getElementById('leadNotes').value = currentLead.notes || '';
    document.getElementById('leadPriority').value = currentLead.priority || 'medium';
    document.getElementById('leadEstimatedValue').value = currentLead.estimated_value || '';
    // Status select is filled by loadPipelineStages and synced here
    const statusSelect = document.getElementById('leadStatusSelect');
    if (statusSelect && statusSelect.options.length) {
        const slug = currentLead.status || '';
        for (let i = 0; i < statusSelect.options.length; i++) {
            if (statusSelect.options[i].value === slug) {
                statusSelect.selectedIndex = i;
                break;
            }
        }
    }
}

function getStatusColor(status) {
    const colors = {
        new_lead: '#3498db',
        meeting_scheduled: '#90EE90',
        quote_sent: '#9b59b6',
        follow_up_1: '#F1C40F',
        stand_by: '#f39c12',
        contacted: '#f39c12',
        won: '#27ae60',
        lost: '#c0392b',
        lead_received: '#3498db',
        contact_made: '#f39c12',
        qualified: '#f39c12',
        visit_scheduled: '#90EE90',
        measurement_done: '#F1C40F',
        proposal_created: '#9b59b6',
        proposal_sent: '#9b59b6',
        negotiation: '#F1C40F',
        closed_won: '#27ae60',
        closed_lost: '#c0392b',
        production: '#27ae60',
        new: '#3498db',
    };
    return colors[status] || '#95a5a6';
}

async function loadPipelineStages() {
    let stages = [];
    try {
        const res = await fetch('/api/pipeline-stages', { credentials: 'include' });
        const data = await res.json();
        if (data.success && Array.isArray(data.data)) {
            stages = data.data.map(s => ({ id: s.id, name: s.name, slug: s.slug || s.name }));
        }
    } catch (e) { /* ignore */ }
    if (stages.length === 0) {
        stages = [
            { id: 1, name: 'New Lead', slug: 'new_lead' },
            { id: 2, name: 'Meeting Scheduled', slug: 'meeting_scheduled' },
            { id: 3, name: 'Quote Sent', slug: 'quote_sent' },
            { id: 4, name: 'Follow Up', slug: 'follow_up_1' },
            { id: 5, name: 'Stand By', slug: 'stand_by' },
            { id: 6, name: 'Won', slug: 'won' },
            { id: 7, name: 'Lost', slug: 'lost' },
        ];
    }

    try {
        const select = document.getElementById('leadStatusSelect');
        select.innerHTML = '<option value="">Selecione...</option>';
        stages.forEach(stage => {
            const option = document.createElement('option');
            option.value = stage.slug;
            option.textContent =
                typeof pipelineStageDisplayName === 'function'
                    ? pipelineStageDisplayName(stage.slug, stage.name)
                    : stage.name;
            if (currentLead && currentLead.status === stage.slug) {
                option.selected = true;
            }
            select.appendChild(option);
        });
        // Save status when user changes dropdown (header)
        select.addEventListener('change', function onStatusChange() {
            const newStatus = select.value;
            if (!newStatus || !currentLeadId) return;
            fetch(`/api/leads/${currentLeadId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ status: newStatus })
            }).then(r => r.json()).then(data => {
                if (data.success) currentLead.status = newStatus;
            }).catch(() => {});
        });
    } catch (error) {
        console.error('Error loading pipeline stages:', error);
    }
}

async function saveLead() {
    const name = (document.getElementById('leadFullName') && document.getElementById('leadFullName').value) ? document.getElementById('leadFullName').value.trim() : (currentLead.name || '');
    const email = (document.getElementById('leadSummaryEmail') && document.getElementById('leadSummaryEmail').value) ? document.getElementById('leadSummaryEmail').value.trim() : (currentLead.email || '');
    const phone = (document.getElementById('leadSummaryPhone') && document.getElementById('leadSummaryPhone').value) ? document.getElementById('leadSummaryPhone').value.trim() : (currentLead.phone || '');
    const zipRaw = (document.getElementById('leadSummaryZip') && document.getElementById('leadSummaryZip').value) ? document.getElementById('leadSummaryZip').value.replace(/\D/g, '') : (String(currentLead.zipcode || '').replace(/\D/g, ''));
    const addrEl = document.getElementById('leadFullAddress');
    const addressVal = addrEl ? addrEl.value.trim() : '';

    if (name.length < 2) {
        alert('Full name deve ter pelo menos 2 caracteres.');
        return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        alert('Email inválido.');
        return;
    }
    if (phone.length < 3) {
        alert('Telefone inválido.');
        return;
    }
    if (!zipRaw || zipRaw.length < 5) {
        alert('ZIP code deve ter pelo menos 5 dígitos.');
        return;
    }

    const updates = {
        name,
        email,
        phone,
        zipcode: zipRaw.slice(0, 10),
        notes: document.getElementById('leadNotes').value,
        priority: document.getElementById('leadPriority').value,
        estimated_value: parseFloat(document.getElementById('leadEstimatedValue').value) || null,
        status: document.getElementById('leadStatusSelect').value || currentLead.status
    };
    if (addrEl) updates.address = addressVal || null;

    try {
        const response = await fetch(`/api/leads/${currentLeadId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(updates)
        });

        const data = await response.json();
        if (data.success) {
            loadLead();
        } else {
            alert('Erro ao atualizar: ' + (data.error || 'Desconhecido'));
        }
    } catch (error) {
        console.error('Error saving lead:', error);
        alert('Erro ao salvar');
    }
}

/**
 * Calcula score de qualificação (0-100) com base em: tipo, serviço, área, orçamento, urgência.
 * Só considera pontos quando os campos obrigatórios estão preenchidos.
 */
function calculateQualificationScore() {
    const propertyType = (document.getElementById('qualPropertyType')?.value || '').trim();
    const serviceType = (document.getElementById('qualServiceType')?.value || '').trim();
    const area = parseFloat(document.getElementById('qualEstimatedArea')?.value) || 0;
    const budget = parseFloat(document.getElementById('qualEstimatedBudget')?.value) || 0;
    const urgency = (document.getElementById('qualUrgency')?.value || 'medium').trim();

    let pts = 0;
    // Tipo de propriedade (até 20)
    const propertyScores = { house: 20, apartment: 17, commercial: 12, other: 8 };
    pts += propertyScores[propertyType] || 0;
    // Tipo de serviço (até 20)
    const serviceScores = { installation: 20, renovation: 17, repair: 12, other: 8 };
    pts += serviceScores[serviceType] || 0;
    // Área estimada em sqft (até 20) — só conta se preenchido
    if (area > 0) {
        if (area <= 250) pts += 5;
        else if (area <= 500) pts += 10;
        else if (area <= 1000) pts += 14;
        else if (area <= 2000) pts += 18;
        else pts += 20;
    }
    // Orçamento (até 20) — só conta se preenchido
    if (budget > 0) {
        if (budget < 5000) pts += 5;
        else if (budget < 15000) pts += 10;
        else if (budget < 30000) pts += 15;
        else pts += 20;
    }
    // Urgência (até 20)
    const urgencyScores = { low: 8, medium: 12, high: 17, urgent: 20 };
    pts += urgencyScores[urgency] || 12;

    return Math.min(100, Math.round(pts));
}

function updateQualificationScoreDisplay() {
    const el = document.getElementById('qualScore');
    if (el) el.value = calculateQualificationScore();
}

function attachQualificationScoreListeners() {
    const ids = ['qualPropertyType', 'qualServiceType', 'qualEstimatedArea', 'qualEstimatedBudget', 'qualUrgency'];
    ids.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener('input', updateQualificationScoreDisplay);
            el.addEventListener('change', updateQualificationScoreDisplay);
        }
    });
}

var qualificationLabels = {
    property_type: { house: 'Casa', apartment: 'Apartamento', commercial: 'Comercial', other: 'Outro' },
    service_type: { installation: 'Instalação', repair: 'Reparo', renovation: 'Renovação', other: 'Outro' },
    urgency: { low: 'Baixa', medium: 'Média', high: 'Alta', urgent: 'Urgente' },
    payment_type: { cash: 'Dinheiro', financing: 'Financiamento', insurance: 'Seguro' }
};

function getQualificationLabel(field, value) {
    if (!value) return '-';
    const map = qualificationLabels[field];
    return (map && map[value]) ? map[value] : value;
}

function formatQualificationAddressBlock(qual) {
    if (!qual) return '';
    var street = (qual.address_street || '').trim();
    var line2 = (qual.address_line2 || '').trim();
    var city = (qual.address_city || '').trim();
    var state = (qual.address_state || '').trim();
    var zip = (qual.address_zip || '').trim();
    if (!street && !line2 && !city && !state && !zip) return '';
    var line1 = [street, line2].filter(Boolean).join(', ');
    var line2b = [city, state].filter(Boolean).join(', ');
    if (zip) line2b = line2b ? line2b + ' ' + zip : zip;
    var inner = '';
    if (line1) inner += escapeHtml(line1);
    if (line2b) inner += (inner ? '<br>' : '') + escapeHtml(line2b);
    return '<div class="qualification-summary-item span-full"><span class="label">Endereço</span><div class="value">' + inner + '</div></div>';
}

function renderQualificationSummary(qual) {
    const el = document.getElementById('qualificationSummaryContent');
    const block = document.getElementById('qualificationSummaryBlock');
    const form = document.getElementById('qualificationForm');
    if (!el || !block || !form) return;
    var html = '';
    html += '<div class="qualification-summary-item"><span class="label">Tipo de Propriedade</span><div class="value">' + getQualificationLabel('property_type', qual.property_type) + '</div></div>';
    html += '<div class="qualification-summary-item"><span class="label">Tipo de Serviço</span><div class="value">' + getQualificationLabel('service_type', qual.service_type) + '</div></div>';
    html += '<div class="qualification-summary-item"><span class="label">Área (sqft)</span><div class="value">' + (qual.estimated_area != null ? Number(qual.estimated_area).toLocaleString() : '-') + '</div></div>';
    html += '<div class="qualification-summary-item"><span class="label">Orçamento</span><div class="value">$ ' + (qual.estimated_budget != null ? Number(qual.estimated_budget).toLocaleString() : '-') + '</div></div>';
    html += '<div class="qualification-summary-item"><span class="label">Urgência</span><div class="value">' + getQualificationLabel('urgency', qual.urgency) + '</div></div>';
    html += '<div class="qualification-summary-item"><span class="label">Score</span><div class="value score-value">' + (qual.score != null ? qual.score : '-') + '</div></div>';
    if (qual.decision_maker || qual.decision_timeline || qual.payment_type) {
        if (qual.decision_maker) html += '<div class="qualification-summary-item"><span class="label">Tomador de Decisão</span><div class="value">' + escapeHtml(qual.decision_maker) + '</div></div>';
        if (qual.decision_timeline) html += '<div class="qualification-summary-item"><span class="label">Prazo de Decisão</span><div class="value">' + escapeHtml(qual.decision_timeline) + '</div></div>';
        if (qual.payment_type) html += '<div class="qualification-summary-item"><span class="label">Tipo de Pagamento</span><div class="value">' + getQualificationLabel('payment_type', qual.payment_type) + '</div></div>';
    }
    html += formatQualificationAddressBlock(qual);
    if (qual.qualification_notes) {
        html += '<div class="qualification-summary-item span-full"><span class="label">Notas</span><div class="value">' + escapeHtml(qual.qualification_notes) + '</div></div>';
    }
    el.innerHTML = html;
    block.style.display = 'block';
    form.style.display = 'none';
}

function escapeHtml(text) {
    var div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function showQualificationEditForm() {
    var block = document.getElementById('qualificationSummaryBlock');
    var form = document.getElementById('qualificationForm');
    if (block) block.style.display = 'none';
    if (form) form.style.display = 'block';
}

async function loadQualification() {
    try {
        const response = await fetch(`/api/leads/${currentLeadId}/qualification`, { credentials: 'include' });
        const data = await response.json();
        
        if (data.success && data.data) {
            const qual = data.data;
            document.getElementById('qualPropertyType').value = qual.property_type || '';
            document.getElementById('qualServiceType').value = qual.service_type || '';
            document.getElementById('qualEstimatedArea').value = qual.estimated_area || '';
            document.getElementById('qualEstimatedBudget').value = qual.estimated_budget || '';
            document.getElementById('qualUrgency').value = qual.urgency || 'medium';
            document.getElementById('qualDecisionMaker').value = qual.decision_maker || '';
            document.getElementById('qualDecisionTimeline').value = qual.decision_timeline || '';
            document.getElementById('qualPaymentType').value = qual.payment_type || '';
            document.getElementById('qualAddressStreet').value = qual.address_street || '';
            document.getElementById('qualAddressLine2').value = qual.address_line2 || '';
            document.getElementById('qualAddressCity').value = qual.address_city || '';
            document.getElementById('qualAddressState').value = qual.address_state || '';
            document.getElementById('qualAddressZip').value = qual.address_zip || '';
            document.getElementById('qualNotes').value = qual.qualification_notes || '';
            updateQualificationScoreDisplay();
            renderQualificationSummary(qual);
        } else {
            updateQualificationScoreDisplay();
            var block = document.getElementById('qualificationSummaryBlock');
            var form = document.getElementById('qualificationForm');
            if (block) block.style.display = 'none';
            if (form) form.style.display = 'block';
        }
    } catch (error) {
        console.log('Qualification not found or error:', error);
        updateQualificationScoreDisplay();
        var block = document.getElementById('qualificationSummaryBlock');
        var form = document.getElementById('qualificationForm');
        if (block) block.style.display = 'none';
        if (form) form.style.display = 'block';
    }
}

async function saveQualification() {
    const propertyType = document.getElementById('qualPropertyType').value?.trim();
    const serviceType = document.getElementById('qualServiceType').value?.trim();
    const estimatedArea = document.getElementById('qualEstimatedArea').value?.trim();
    const estimatedBudget = document.getElementById('qualEstimatedBudget').value?.trim();
    const urgency = document.getElementById('qualUrgency').value?.trim();

    if (!propertyType) {
        alert('Selecione o Tipo de Propriedade.');
        return;
    }
    if (!serviceType) {
        alert('Selecione o Tipo de Serviço.');
        return;
    }
    if (!estimatedArea || parseFloat(estimatedArea) <= 0) {
        alert('Informe a Área estimada (sqft).');
        return;
    }
    if (!estimatedBudget || parseFloat(estimatedBudget) <= 0) {
        alert('Informe o Orçamento estimado.');
        return;
    }
    if (!urgency) {
        alert('Selecione a Urgência.');
        return;
    }

    const score = calculateQualificationScore();
    const qualification = {
        property_type: propertyType,
        service_type: serviceType,
        estimated_area: parseFloat(estimatedArea) || null,
        estimated_budget: parseFloat(estimatedBudget) || null,
        urgency: urgency,
        decision_maker: document.getElementById('qualDecisionMaker').value?.trim() || null,
        decision_timeline: document.getElementById('qualDecisionTimeline').value?.trim() || null,
        payment_type: document.getElementById('qualPaymentType').value?.trim() || null,
        score: score,
        qualification_notes: document.getElementById('qualNotes').value?.trim() || null,
        address_street: document.getElementById('qualAddressStreet').value?.trim() || null,
        address_line2: document.getElementById('qualAddressLine2').value?.trim() || null,
        address_city: document.getElementById('qualAddressCity').value?.trim() || null,
        address_state: document.getElementById('qualAddressState').value?.trim() || null,
        address_zip: document.getElementById('qualAddressZip').value?.trim() || null
    };

    try {
        const response = await fetch(`/api/leads/${currentLeadId}/qualification`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(qualification)
        });

        const data = await response.json();
        if (data.success) {
            loadQualification();
        } else {
            alert('Erro ao salvar: ' + (data.error || 'Desconhecido'));
        }
    } catch (error) {
        console.error('Error saving qualification:', error);
        alert('Erro ao salvar');
    }
}

async function loadInteractions() {
    try {
        const response = await fetch(`/api/leads/${currentLeadId}/interactions`, { credentials: 'include' });
        const data = await response.json();
        
        const list = document.getElementById('interactionsList');
        if (data.success && data.data && data.data.length > 0) {
            list.innerHTML = data.data.map(interaction => `
                <li class="timeline-item">
                    <div class="timeline-item-header">
                        <span class="timeline-item-title">${getInteractionTypeLabel(interaction.type)}</span>
                        <span class="timeline-item-date">${new Date(interaction.created_at).toLocaleString()}</span>
                    </div>
                    <div class="timeline-item-content">
                        ${interaction.subject ? `<strong>${interaction.subject}</strong><br>` : ''}
                        ${interaction.notes || ''}
                        ${interaction.user_name ? `<br><small>Por: ${interaction.user_name}</small>` : ''}
                    </div>
                </li>
            `).join('');
        } else {
            list.innerHTML = '<li class="empty-state">Nenhuma interação registrada ainda.</li>';
        }
    } catch (error) {
        console.error('Error loading interactions:', error);
    }
}

function getInteractionTypeLabel(type) {
    const labels = {
        'call': '📞 Chamada',
        'whatsapp': '💬 WhatsApp',
        'email': '📧 Email',
        'visit': '🏠 Visita',
        'meeting': '🤝 Reunião'
    };
    return labels[type] || type;
}

async function loadFollowups() {
    if (!currentLeadId) return;
    try {
        const response = await fetch(`/api/leads/${currentLeadId}/followups`, { credentials: 'include' });
        const data = await response.json();
        const list = document.getElementById('followupsList');
        if (!list) return;
        if (data.success && data.data && data.data.length > 0) {
            list.innerHTML = data.data.map(f => {
                const due = f.due_date ? new Date(f.due_date).toLocaleString('pt-BR') : '-';
                const status = f.status === 'completed' ? 'Concluído' : f.status === 'cancelled' ? 'Cancelado' : 'Pendente';
                const priority = f.priority === 'high' ? 'Alta' : f.priority === 'low' ? 'Baixa' : 'Média';
                return `<li class="followup-item">
                    <div class="followup-item-header">
                        <strong>${escapeHtml(f.title)}</strong>
                        <span class="followup-due">${due}</span>
                    </div>
                    ${f.description ? `<div class="followup-item-desc">${escapeHtml(f.description)}</div>` : ''}
                    <div class="followup-item-meta">Prioridade: ${priority} · Status: ${status}${f.assigned_to_name ? ' · ' + escapeHtml(f.assigned_to_name) : ''}</div>
                </li>`;
            }).join('');
        } else {
            list.innerHTML = '<li class="empty-state">Nenhum follow-up agendado.</li>';
        }
    } catch (error) {
        console.error('Error loading followups:', error);
        var list = document.getElementById('followupsList');
        if (list) list.innerHTML = '<li class="empty-state">Erro ao carregar follow-ups.</li>';
    }
}

function showNewFollowupModal() {
    var modal = document.getElementById('newFollowupModal');
    if (!modal) return;
    document.getElementById('followupTitle').value = '';
    document.getElementById('followupDescription').value = '';
    var tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(10, 0, 0, 0);
    document.getElementById('followupDueDate').value = tomorrow.toISOString().slice(0, 16);
    document.getElementById('followupPriority').value = 'medium';
    loadUsersForFollowupSelect();
    modal.classList.add('active');
    modal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
}

function closeFollowupModal() {
    var modal = document.getElementById('newFollowupModal');
    if (modal) {
        modal.classList.remove('active');
        modal.setAttribute('aria-hidden', 'true');
        document.body.style.overflow = '';
    }
}

async function loadUsersForFollowupSelect() {
    var sel = document.getElementById('followupAssignedSelect');
    if (!sel) return;
    try {
        var r = await fetch('/api/users?limit=100', { credentials: 'include' });
        var d = await r.json();
        sel.innerHTML = '<option value="">Eu mesmo</option>';
        if (d.success && d.data && d.data.length) {
            d.data.forEach(u => {
                if (!u.id) return;
                var opt = document.createElement('option');
                opt.value = u.id;
                opt.textContent = u.name || u.email || 'User ' + u.id;
                sel.appendChild(opt);
            });
        }
    } catch (e) { /* ignore */ }
}

function submitFollowupForm(e) {
    e.preventDefault();
    var title = document.getElementById('followupTitle').value.trim();
    var due_date = document.getElementById('followupDueDate').value;
    var description = document.getElementById('followupDescription').value.trim() || null;
    var priority = document.getElementById('followupPriority').value || 'medium';
    var assigned_to = document.getElementById('followupAssignedSelect').value || null;
    if (!title || !due_date) return false;
    closeFollowupModal();
    fetch(`/api/leads/${currentLeadId}/followups`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ title: title, description: description, due_date: due_date, priority: priority, assigned_to: assigned_to ? parseInt(assigned_to, 10) : null })
    }).then(r => r.json()).then(data => {
        if (data.success) loadFollowups();
        else alert('Erro ao criar follow-up: ' + (data.error || 'Desconhecido'));
    }).catch(() => alert('Erro ao criar follow-up'));
    return false;
}

function getVisitStatusLabel(status) {
    const labels = { scheduled: 'Agendada', confirmed: 'Confirmada', completed: 'Realizada', cancelled: 'Cancelada', no_show: 'Não compareceu' };
    return labels[status] || status || 'Agendada';
}

/** Agendamento de visita só em :00 e :30 (datetime-local YYYY-MM-DDTHH:mm). */
function snapVisitDatetimeLocalToHalfHour_(val) {
    if (!val || typeof val !== 'string') return val;
    const parts = val.split('T');
    if (parts.length !== 2) return val;
    let datePart = parts[0];
    const tm = parts[1].match(/^(\d{2}):(\d{2})/);
    if (!tm) return val;
    let h = parseInt(tm[1], 10);
    let min = parseInt(tm[2], 10);
    if (isNaN(h) || isNaN(min)) return val;
    if (min >= 45) {
        h += 1;
        min = 0;
    } else if (min >= 15) {
        min = 30;
    } else {
        min = 0;
    }
    if (h >= 24) {
        const d = new Date(datePart + 'T12:00:00');
        d.setDate(d.getDate() + 1);
        datePart = d.toISOString().slice(0, 10);
        h = 0;
    }
    return datePart + 'T' + String(h).padStart(2, '0') + ':' + String(min).padStart(2, '0');
}

function wireVisitScheduleHalfHourInputs_() {
    ['visitScheduledAt', 'editVisitScheduledAt'].forEach((id) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.setAttribute('step', '1800');
        const snap = () => {
            if (el.value) el.value = snapVisitDatetimeLocalToHalfHour_(el.value);
        };
        el.addEventListener('change', snap);
        el.addEventListener('blur', snap);
    });
}

async function loadVisits() {
    const container = document.getElementById('visitsList');
    if (!container) return;
    try {
        const response = await fetch(`/api/visits?lead_id=${currentLeadId}`, { credentials: 'include' });
        let data;
        try {
            data = await response.json();
        } catch (_) {
            container.innerHTML = '<div class="empty-state">Resposta inválida do servidor (status ' + response.status + ').</div>';
            return;
        }
        if (!data.success) {
            var msg = (data.error || 'Erro ao carregar visitas.');
            if (response.status === 401) msg = 'Sessão expirada. Faça login novamente.';
            container.innerHTML = '<div class="empty-state">' + escapeHtml(msg) + '</div>';
            return;
        }
        const items = data.data || [];
        if (items.length > 0) {
            container.innerHTML = items.map(visit => {
                const dateStr = visit.scheduled_at ? new Date(visit.scheduled_at).toLocaleString() : '-';
                const address = visit.address ? escapeHtml(visit.address) : '-';
                const status = getVisitStatusLabel(visit.status);
                const assigned = visit.assigned_to_name ? escapeHtml(visit.assigned_to_name) : '';
                const notes = visit.notes ? escapeHtml(String(visit.notes)) : '';
                const leadName = visit.lead_name ? escapeHtml(visit.lead_name) : (currentLead && currentLead.name ? escapeHtml(currentLead.name) : '');
                const visitId = visit.id != null ? Number(visit.id) : null;
                return `<div class="visit-card">
                    <div class="visit-card-header">
                        <span class="visit-card-date"><span class="visit-card-date-icon">D</span> ${dateStr}</span>
                        <span class="visit-card-status visit-status-${(visit.status || 'scheduled')}">${status}</span>
                    </div>
                    ${leadName ? `<p class="visit-card-client"><strong>Cliente:</strong> ${leadName}</p>` : ''}
                    <p class="visit-card-address"><strong>Endereço:</strong> ${address}</p>
                    ${assigned ? `<p class="visit-card-assigned"><strong>Responsável:</strong> ${assigned}</p>` : ''}
                    ${notes ? `<p class="visit-card-notes">${notes}</p>` : ''}
                    <div class="visit-card-actions">
                        ${visitId ? `<button type="button" class="btn btn-secondary btn-sm" onclick="showEditVisitModal(${visitId})">Editar visita</button>` : ''}
                    </div>
                </div>`;
            }).join('');
        } else {
            container.innerHTML = '<div class="empty-state">Nenhuma visita agendada ainda.</div>';
        }
    } catch (error) {
        console.error('Error loading visits:', error);
        container.innerHTML = '<div class="empty-state">Erro ao carregar visitas. ' + escapeHtml(error.message || '') + '</div>';
    }
}

async function loadProposals() {
    try {
        const response = await fetch(`/api/leads/${currentLeadId}/proposals`, { credentials: 'include' });
        const data = await response.json();
        
        const container = document.getElementById('proposalsList');
        if (data.success && data.data && data.data.length > 0) {
            container.innerHTML = data.data.map(proposal => `
                <div style="padding: 15px; border: 1px solid #ddd; border-radius: 4px; margin-bottom: 10px;">
                    <h3>${proposal.proposal_number || `Proposta #${proposal.id}`}</h3>
                    <p><strong>Valor:</strong> $${parseFloat(proposal.total_value || 0).toLocaleString()}</p>
                    <p><strong>Status:</strong> ${proposal.status || 'draft'}</p>
                    <p><strong>Criada em:</strong> ${new Date(proposal.created_at).toLocaleDateString()}</p>
                </div>
            `).join('');
        } else {
            container.innerHTML = '<div class="empty-state">Nenhuma proposta criada ainda.</div>';
        }
    } catch (error) {
        console.error('Error loading proposals:', error);
    }
}

function switchTab(tabName) {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
    
    document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');
    document.getElementById(`${tabName}Tab`).classList.add('active');
}

function showNewInteractionModal() {
    const modal = document.getElementById('newInteractionModal');
    if (!modal) return;
    document.getElementById('interactionType').value = '';
    document.getElementById('interactionSubject').value = '';
    document.getElementById('interactionNotes').value = '';
    modal.classList.add('active');
    modal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
}

function closeInteractionModal() {
    const modal = document.getElementById('newInteractionModal');
    if (!modal) return;
    modal.classList.remove('active');
    modal.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
}

function submitInteractionForm(e) {
    e.preventDefault();
    const type = document.getElementById('interactionType').value;
    const subject = document.getElementById('interactionSubject').value.trim() || null;
    const notes = document.getElementById('interactionNotes').value.trim();
    if (!type || !notes) return false;
    closeInteractionModal();
    createInteraction({ type, subject, notes });
    return false;
}

async function showNewVisitModal() {
    if (!currentLead) return;
    if (typeof window.sfOpenLeadVisitInDeviceCalendar === 'function') {
        try {
            const ok = window.sfOpenLeadVisitInDeviceCalendar(currentLead);
            if (ok) return;
        } catch (err) {
            if (typeof crmNotify === 'function') {
                crmNotify(err.message || 'Não foi possível abrir o calendário.', 'error');
            }
        }
    }
    const modal = document.getElementById('newVisitModal');
    if (!modal) return;
    var clientEl = document.getElementById('newVisitClientName');
    if (clientEl) clientEl.textContent = (currentLead && currentLead.name) ? currentLead.name : '—';
    const scheduled = document.getElementById('visitScheduledAt');
    if (scheduled) {
        const d = new Date();
        d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
        scheduled.value = snapVisitDatetimeLocalToHalfHour_(d.toISOString().slice(0, 16));
    }
    var addr = (currentLead && (currentLead.address || currentLead.address_line1)) ? (currentLead.address || currentLead.address_line1) : '';
    if (!addr && currentLead && currentLead.zipcode) addr = 'Zip: ' + currentLead.zipcode;
    setAddressFields('visit', parseAddressForEdit(addr));
    document.getElementById('visitNotes').value = '';
    loadUsersForVisitSelect();
    modal.classList.add('active');
    modal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
}

function closeVisitModal() {
    const modal = document.getElementById('newVisitModal');
    if (modal) {
        modal.classList.remove('active');
        modal.setAttribute('aria-hidden', 'true');
        document.body.style.overflow = '';
    }
}

function closeEditVisitModal() {
    const modal = document.getElementById('editVisitModal');
    if (modal) {
        modal.classList.remove('active');
        modal.setAttribute('aria-hidden', 'true');
        document.body.style.overflow = '';
    }
}

async function loadUsersForVisitSelect() {
    const sel = document.getElementById('visitAssignedSelect');
    if (!sel) return;
    try {
        const r = await fetch('/api/users?limit=100', { credentials: 'include' });
        const d = await r.json();
        sel.innerHTML = '<option value="">Eu mesmo</option>';
        if (d.success && d.data && d.data.length) {
            d.data.forEach(u => {
                if (!u.id) return;
                const opt = document.createElement('option');
                opt.value = u.id;
                opt.textContent = u.name || u.email || 'User ' + u.id;
                sel.appendChild(opt);
            });
        }
    } catch (e) { /* ignore */ }
}

async function loadUsersForEditVisitSelect(selectedUserId) {
    const sel = document.getElementById('editVisitAssignedSelect');
    if (!sel) return;
    try {
        const r = await fetch('/api/users?limit=100', { credentials: 'include' });
        const d = await r.json();
        sel.innerHTML = '<option value="">Eu mesmo</option>';
        if (d.success && d.data && d.data.length) {
            d.data.forEach(u => {
                if (!u.id) return;
                const opt = document.createElement('option');
                opt.value = u.id;
                opt.textContent = u.name || u.email || 'User ' + u.id;
                if (selectedUserId && String(u.id) === String(selectedUserId)) opt.selected = true;
                sel.appendChild(opt);
            });
        }
    } catch (e) { /* ignore */ }
}

function parseAddressForEdit(addressStr) {
    if (!addressStr || typeof addressStr !== 'string') return { addressLine1: '', addressLine2: '', city: '', zipcode: '' };
    var s = addressStr.trim();
    var parts = s.split(',').map(function (p) { return p.trim(); }).filter(Boolean);
    if (parts.length >= 3) {
        return { addressLine1: parts[0], addressLine2: parts.slice(1, -2).join(', '), city: parts[parts.length - 2], zipcode: parts[parts.length - 1] || '' };
    }
    if (parts.length === 2) return { addressLine1: parts[0], addressLine2: '', city: parts[1], zipcode: '' };
    if (parts.length === 1) return { addressLine1: parts[0], addressLine2: '', city: '', zipcode: '' };
    return { addressLine1: s, addressLine2: '', city: '', zipcode: '' };
}

function setAddressFields(prefix, obj) {
    var o = obj || {};
    var line1 = document.getElementById(prefix + 'AddressLine1');
    var line2 = document.getElementById(prefix + 'AddressLine2');
    var city = document.getElementById(prefix + 'City');
    var zip = document.getElementById(prefix + 'ZipCode');
    if (line1) line1.value = o.addressLine1 || '';
    if (line2) line2.value = o.addressLine2 || '';
    if (city) city.value = o.city || '';
    if (zip) zip.value = o.zipcode || '';
}

async function showEditVisitModal(visitId) {
    const modal = document.getElementById('editVisitModal');
    if (!modal) return;
    var clientEl = document.getElementById('editVisitClientName');
    if (clientEl) clientEl.textContent = (currentLead && currentLead.name) ? currentLead.name : (currentLeadId ? 'Lead #' + currentLeadId : '—');
    document.getElementById('editVisitId').value = visitId;
    try {
        const response = await fetch('/api/visits/' + visitId, { credentials: 'include' });
        const data = await response.json();
        if (!data.success || !data.data) {
            alert('Não foi possível carregar a visita.');
            return;
        }
        var v = data.data;
        var scheduledEl = document.getElementById('editVisitScheduledAt');
        if (scheduledEl && v.scheduled_at) {
            var d = new Date(v.scheduled_at);
            d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
            scheduledEl.value = snapVisitDatetimeLocalToHalfHour_(d.toISOString().slice(0, 16));
        }
        setAddressFields('editVisit', parseAddressForEdit(v.address));
        document.getElementById('editVisitNotes').value = v.notes || '';
        document.getElementById('editVisitStatus').value = v.status || 'scheduled';
        await loadUsersForEditVisitSelect(v.seller_id || v.assigned_to);
        modal.classList.add('active');
        modal.setAttribute('aria-hidden', 'false');
        document.body.style.overflow = 'hidden';
    } catch (err) {
        console.error('Error loading visit:', err);
        alert('Erro ao carregar visita.');
    }
}

function submitEditVisitForm(e) {
    e.preventDefault();
    var visitId = document.getElementById('editVisitId').value;
    if (!visitId) return false;
    var editSchedEl = document.getElementById('editVisitScheduledAt');
    var scheduledAt = snapVisitDatetimeLocalToHalfHour_(editSchedEl.value);
    if (editSchedEl) editSchedEl.value = scheduledAt;
    var addressLine1 = (document.getElementById('editVisitAddressLine1') && document.getElementById('editVisitAddressLine1').value) ? document.getElementById('editVisitAddressLine1').value.trim() : '';
    var addressLine2 = (document.getElementById('editVisitAddressLine2') && document.getElementById('editVisitAddressLine2').value) ? document.getElementById('editVisitAddressLine2').value.trim() : '';
    var city = (document.getElementById('editVisitCity') && document.getElementById('editVisitCity').value) ? document.getElementById('editVisitCity').value.trim() : '';
    var zipcode = (document.getElementById('editVisitZipCode') && document.getElementById('editVisitZipCode').value) ? document.getElementById('editVisitZipCode').value.trim() : '';
    var address = [addressLine1, addressLine2, city, zipcode].filter(Boolean).join(', ');
    var notes = document.getElementById('editVisitNotes').value.trim() || null;
    var sellerId = document.getElementById('editVisitAssignedSelect').value || null;
    var status = document.getElementById('editVisitStatus').value || 'scheduled';
    if (!scheduledAt || !addressLine1 || !city) {
        alert('Preencha data/hora, endereço (linha 1) e cidade.');
        return false;
    }
    var btn = document.querySelector('#editVisitForm button[type="submit"]');
    if (btn) { btn.disabled = true; btn.textContent = 'Salvando...'; }
    updateVisit(visitId, {
        scheduled_at: scheduledAt,
        address: address,
        notes: notes,
        seller_id: sellerId ? parseInt(sellerId, 10) : null,
        status: status
    }, btn);
    return false;
}

async function updateVisit(visitId, payload, submitBtn) {
    try {
        const response = await fetch('/api/visits/' + visitId, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(payload)
        });
        const data = await response.json();
        if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Salvar alterações'; }
        if (data.success) {
            closeEditVisitModal();
            await loadVisits();
        } else {
            alert('Erro ao salvar: ' + (data.error || 'Desconhecido'));
        }
    } catch (error) {
        if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Salvar alterações'; }
        console.error('Error updating visit:', error);
        alert('Erro ao salvar visita.');
    }
}

function submitVisitForm(e) {
    e.preventDefault();
    const schedEl = document.getElementById('visitScheduledAt');
    const scheduledAt = snapVisitDatetimeLocalToHalfHour_(schedEl.value);
    if (schedEl) schedEl.value = scheduledAt;
    const addressLine1 = document.getElementById('visitAddressLine1').value.trim();
    const addressLine2 = document.getElementById('visitAddressLine2').value.trim();
    const city = document.getElementById('visitCity').value.trim();
    const zipcode = document.getElementById('visitZipCode').value.trim();
    const notes = document.getElementById('visitNotes').value.trim() || null;
    const sellerId = document.getElementById('visitAssignedSelect').value || null;
    if (!scheduledAt || !addressLine1 || !city) {
        alert('Preencha data/hora, Address line 1 e City.');
        return false;
    }
    var btn = document.querySelector('#newVisitForm button[type="submit"]');
    if (btn) { btn.disabled = true; btn.textContent = 'Agendando...'; }
    createVisit({
        lead_id: parseInt(currentLeadId, 10),
        scheduled_at: scheduledAt,
        address_line1: addressLine1,
        address_line2: addressLine2 || null,
        city: city,
        zipcode: zipcode || null,
        notes: notes,
        seller_id: sellerId ? parseInt(sellerId, 10) : null
    }, btn);
    return false;
}

async function createVisit(payload, submitBtn) {
    try {
        const response = await fetch('/api/visits', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(payload)
        });
        const data = await response.json();
        if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Agendar visita'; }
        if (data.success) {
            closeVisitModal();
            await loadLead();
            switchTab('visits');
        } else {
            alert('Erro ao agendar visita: ' + (data.error || 'Desconhecido'));
        }
    } catch (error) {
        if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Agendar visita'; }
        console.error('Error creating visit:', error);
        alert('Erro ao agendar visita');
    }
}

function showNewProposalModal() {
    alert('Funcionalidade de criar proposta em desenvolvimento');
}

async function createInteraction(interaction) {
    try {
        const response = await fetch(`/api/leads/${currentLeadId}/interactions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(interaction)
        });

        const data = await response.json();
        if (data.success) {
            await loadInteractions();
            switchTab('interactions');
        } else {
            alert('Erro: ' + (data.error || 'Desconhecido'));
        }
    } catch (error) {
        console.error('Error creating interaction:', error);
        alert('Erro ao criar interação');
    }
}
