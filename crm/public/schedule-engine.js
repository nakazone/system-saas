/**
 * Smart Scheduling Engine - Frontend
 * Interface completa de agendamento inteligente
 * Inclui agendamentos de projetos (crews) e visitas de leads.
 */

let currentScheduleView = 'month';
let allSchedules = [];
let allLeadVisits = [];
let allCrews = [];
let currentDate = new Date();

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    if (document.getElementById('schedulePage')) {
        loadScheduleData();
    }
});

function visitDateKey(v) {
    if (!v || !v.scheduled_at) return null;
    const s = String(v.scheduled_at);
    if (s.length >= 10) return s.slice(0, 10);
    try {
        return new Date(s).toISOString().slice(0, 10);
    } catch {
        return null;
    }
}

function escapeHtml(str) {
    if (str == null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function scheduleCoversDate(s, dateStr) {
    const start = new Date(s.start_date);
    const end = new Date(s.end_date);
    const current = new Date(dateStr);
    return current >= start && current <= end;
}

// Load Schedule Data
async function loadGoogleCalendarStatusBanner() {
    const el = document.getElementById('googleCalendarSyncBanner');
    if (!el) return;
    try {
        const r = await fetch('/api/integrations/google-calendar/status', { credentials: 'include' });
        const d = await r.json();
        if (!d.success) return;
        el.style.display = 'block';
        if (d.configured) {
            el.textContent = `Google Calendar: sincronização ativa (calendário: ${d.calendarId}). Projetos e visitas são enviados ao criar/atualizar.`;
            el.style.borderLeft = '3px solid #34a853';
        } else {
            el.textContent =
                'Google Calendar: não configurado no servidor (variáveis GOOGLE_CALENDAR_*). Veja env.example e database/add-google-calendar-event-ids.sql.';
            el.style.color = '#666';
            el.style.borderLeft = '3px solid #f9ab00';
        }
    } catch {
        el.style.display = 'none';
    }
}

async function loadScheduleData() {
    await Promise.all([
        loadCrews(),
        loadSchedules(),
        loadLeadVisits()
    ]);

    renderForecastDashboard(allSchedules, allLeadVisits);
    renderScheduleView();
    loadGoogleCalendarStatusBanner();
}

// Load Crews
async function loadCrews() {
    try {
        const response = await fetch('/api/crews?active=true', { credentials: 'include' });
        const data = await response.json();

        if (data.success && data.data) {
            allCrews = data.data;
        }
    } catch (error) {
        console.error('Error loading crews:', error);
    }
}

// Load Schedules
async function loadSchedules() {
    try {
        const startDate = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1).toISOString().split('T')[0];
        const endDate = new Date(currentDate.getFullYear(), currentDate.getMonth() + 2, 0).toISOString().split('T')[0];

        const response = await fetch(`/api/schedules?start_date=${startDate}&end_date=${endDate}`, {
            credentials: 'include'
        });
        const data = await response.json();

        if (data.success && data.data) {
            allSchedules = data.data;
        }
    } catch (error) {
        console.error('Error loading schedules:', error);
    }
}

async function loadLeadVisits() {
    try {
        const startDate = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1).toISOString().split('T')[0];
        const endDate = new Date(currentDate.getFullYear(), currentDate.getMonth() + 2, 0).toISOString().split('T')[0];

        const response = await fetch(
            `/api/visits?limit=500&date_from=${startDate}&date_to=${endDate}`,
            { credentials: 'include' }
        );
        const data = await response.json();

        if (data.success && data.data) {
            allLeadVisits = data.data;
        } else {
            allLeadVisits = [];
        }
    } catch (error) {
        console.error('Error loading lead visits:', error);
        allLeadVisits = [];
    }
}

// Refresh forecast + calendar (botão no dashboard)
async function loadScheduleDashboard() {
    await Promise.all([loadSchedules(), loadLeadVisits()]);
    renderForecastDashboard(allSchedules, allLeadVisits);
    renderScheduleView();
    loadGoogleCalendarStatusBanner();
}

// Render Forecast Dashboard
function renderForecastDashboard(schedules, leadVisits) {
    const container = document.getElementById('scheduleForecast');
    if (!container) return;

    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();
    const monthPrefix = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}`;

    const monthSchedules = schedules.filter(s => {
        const scheduleDate = new Date(s.start_date);
        return scheduleDate.getMonth() === currentMonth && scheduleDate.getFullYear() === currentYear;
    });

    const monthVisits = (leadVisits || []).filter(v => {
        const dk = visitDateKey(v);
        return dk && dk.startsWith(monthPrefix);
    });
    const scheduledLeadVisits = monthVisits.filter(v => v.status === 'scheduled').length;

    const totalSqft = monthSchedules.reduce((sum, s) => sum + (parseFloat(s.total_sqft) || 0), 0);
    const bookedDays = new Set(monthSchedules.map(s => s.start_date)).size;
    const totalDays = new Date(currentYear, currentMonth + 1, 0).getDate();
    const bookedPercentage = (bookedDays / totalDays) * 100;

    const totalRevenue = monthSchedules.reduce((sum, s) => sum + (parseFloat(s.projected_profit) || 0), 0);
    const totalProfit = monthSchedules.reduce((sum, s) => {
        const profit = parseFloat(s.projected_profit) || 0;
        const margin = parseFloat(s.projected_margin) || 0;
        return sum + (profit * (margin / 100));
    }, 0);

    container.innerHTML = `
        <div class="stat-card">
            <h3>Monthly Capacity</h3>
            <div class="stat-value">${totalSqft.toLocaleString()} sqft</div>
            <div class="stat-details">
                <span>Booked: ${bookedPercentage.toFixed(1)}%</span>
            </div>
        </div>
        <div class="stat-card">
            <h3>Revenue Forecast</h3>
            <div class="stat-value">$${totalRevenue.toLocaleString()}</div>
            <div class="stat-details">
                <span>${monthSchedules.length} projects</span>
            </div>
        </div>
        <div class="stat-card">
            <h3>Profit Forecast</h3>
            <div class="stat-value">$${totalProfit.toLocaleString()}</div>
            <div class="stat-details">
                <span>This month</span>
            </div>
        </div>
        <div class="stat-card">
            <h3>Lead visits (mês)</h3>
            <div class="stat-value">${scheduledLeadVisits}</div>
            <div class="stat-details">
                <span>${monthVisits.length} total no mês</span>
            </div>
        </div>
        <div class="stat-card">
            <h3>Crew Utilization</h3>
            <div class="stat-value">${bookedPercentage.toFixed(1)}%</div>
            <div class="stat-details">
                <span>${bookedDays}/${totalDays} days</span>
            </div>
        </div>
    `;
}

// Show Schedule View
function showScheduleView(view) {
    currentScheduleView = view;

    document.getElementById('scheduleMonthView').style.display = 'none';
    document.getElementById('scheduleWeekView').style.display = 'none';
    document.getElementById('scheduleCrewView').style.display = 'none';

    if (view === 'month') {
        document.getElementById('scheduleMonthView').style.display = 'block';
        renderMonthView();
    } else if (view === 'week') {
        document.getElementById('scheduleWeekView').style.display = 'block';
        renderWeekView();
    } else if (view === 'crew') {
        document.getElementById('scheduleCrewView').style.display = 'block';
        renderCrewTimeline();
    }
}

function renderScheduleView() {
    showScheduleView(currentScheduleView);
}

// Render Month View
function renderMonthView() {
    const container = document.getElementById('scheduleCalendar');
    if (!container) return;

    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const daysInMonth = lastDay.getDate();
    const startingDayOfWeek = firstDay.getDay();

    let html = `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: var(--spacing-md);">
            <button class="btn btn-secondary" onclick="changeScheduleMonth(-1)">← Previous</button>
            <h3>${firstDay.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</h3>
            <button class="btn btn-secondary" onclick="changeScheduleMonth(1)">Next →</button>
        </div>
        <p style="font-size: 0.85rem; color: var(--text-muted, #666); margin-bottom: var(--spacing-sm);">
            Crew blocks (azul) e visitas de leads (laranja 🏠). Clique numa visita para abrir o lead.
        </p>
        <div class="calendar-grid" style="display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px;">
    `;

    const dayHeaders = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    dayHeaders.forEach(day => {
        html += `<div style="padding: 8px; text-align: center; font-weight: 600; background: var(--bg-light);">${day}</div>`;
    });

    for (let i = 0; i < startingDayOfWeek; i++) {
        html += '<div style="min-height: 80px; background: var(--bg-light);"></div>';
    }

    for (let day = 1; day <= daysInMonth; day++) {
        const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const daySchedules = allSchedules.filter(s => scheduleCoversDate(s, dateStr));
        const dayVisits = allLeadVisits.filter(v => visitDateKey(v) === dateStr);

        const isToday = dateStr === new Date().toISOString().split('T')[0];

        html += `
            <div style="min-height: 80px; border: 1px solid var(--border-color); padding: 4px; background: ${isToday ? '#e3f2fd' : 'var(--bg-white)'};">
                <div style="font-weight: 600; margin-bottom: 4px;">${day}</div>
                ${daySchedules.map(schedule => `
                    <div class="schedule-item"
                         data-schedule-id="${schedule.id}"
                         style="background: ${getScheduleColor(schedule)};
                                padding: 2px 4px;
                                margin: 2px 0;
                                border-radius: 4px;
                                font-size: 0.75rem;
                                cursor: pointer;
                                border-left: 3px solid ${getPriorityColor(schedule.priority)};"
                         onclick="viewSchedule(${schedule.id})"
                         title="${escapeHtml(schedule.crew_name)} — ${escapeHtml(schedule.project_name || schedule.project_number || '')}">
                        ${escapeHtml((schedule.crew_name || '').substring(0, 8))}…
                    </div>
                `).join('')}
                ${dayVisits.map(v => {
                    const nm = (v.lead_name || 'Lead').substring(0, 14);
                    const muted = v.status === 'cancelled' || v.status === 'no_show' ? 'opacity:0.55;text-decoration:line-through;' : '';
                    return `
                    <div class="schedule-item schedule-lead-visit"
                         style="background: #fff8e1; padding: 2px 4px; margin: 2px 0; border-radius: 4px; font-size: 0.75rem;
                                cursor: pointer; border-left: 3px solid #e67e22; ${muted}"
                         onclick="window.location.href='lead-detail.html?id=${encodeURIComponent(v.lead_id)}'"
                         title="${escapeHtml(v.lead_name || '')} — ${escapeHtml(v.assigned_to_name || '')} — ${escapeHtml(v.status || '')}">
                        🏠 ${escapeHtml(nm)}${nm.length >= 14 ? '…' : ''}
                    </div>`;
                }).join('')}
            </div>
        `;
    }

    html += '</div>';
    container.innerHTML = html;
}

// Render Week View
function renderWeekView() {
    const container = document.getElementById('scheduleWeekCalendar');
    if (!container) return;

    const weekStart = new Date(currentDate);
    weekStart.setDate(currentDate.getDate() - currentDate.getDay());
    weekStart.setHours(0, 0, 0, 0);

    let html = `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: var(--spacing-md);">
            <button class="btn btn-secondary" onclick="changeScheduleWeek(-1)">← Previous</button>
            <h3>Week of ${weekStart.toLocaleDateString()}</h3>
            <button class="btn btn-secondary" onclick="changeScheduleWeek(1)">Next →</button>
        </div>
        <div style="overflow-x: auto;">
            <table style="width: 100%; border-collapse: collapse; font-size: 0.9rem;">
                <thead>
                    <tr>
                        <th style="padding: 8px; text-align: left; border-bottom: 2px solid var(--border-color);">Day</th>
                        <th style="padding: 8px; text-align: left; border-bottom: 2px solid var(--border-color);">Projects (crews)</th>
                        <th style="padding: 8px; text-align: left; border-bottom: 2px solid var(--border-color);">Lead visits</th>
                    </tr>
                </thead>
                <tbody>
    `;

    for (let i = 0; i < 7; i++) {
        const day = new Date(weekStart);
        day.setDate(weekStart.getDate() + i);
        const y = day.getFullYear();
        const mo = day.getMonth();
        const d = day.getDate();
        const dateStr = `${y}-${String(mo + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        const daySchedules = allSchedules.filter(s => scheduleCoversDate(s, dateStr));
        const dayVisits = allLeadVisits.filter(v => visitDateKey(v) === dateStr);

        const schedLines = daySchedules.map(s =>
            `<div style="margin: 2px 0;"><span class="badge badge-${s.status || 'scheduled'}">${escapeHtml(s.crew_name || '')}</span> ${escapeHtml(s.project_name || s.project_number || '')}</div>`
        ).join('') || '<span style="color:#999">—</span>';

        const visitLines = dayVisits.map(v => {
            const t = v.scheduled_at ? new Date(v.scheduled_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
            return `<div style="margin: 2px 0;"><a href="lead-detail.html?id=${encodeURIComponent(v.lead_id)}">🏠 ${escapeHtml(v.lead_name || 'Lead')}</a> ${t ? `<small>${escapeHtml(t)}</small>` : ''} <small>(${escapeHtml(v.status || '')})</small></div>`;
        }).join('') || '<span style="color:#999">—</span>';

        html += `
            <tr>
                <td style="padding: 8px; border-bottom: 1px solid var(--border-color); white-space: nowrap;">
                    ${day.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                </td>
                <td style="padding: 8px; border-bottom: 1px solid var(--border-color); vertical-align: top;">${schedLines}</td>
                <td style="padding: 8px; border-bottom: 1px solid var(--border-color); vertical-align: top;">${visitLines}</td>
            </tr>
        `;
    }

    html += '</tbody></table></div>';
    container.innerHTML = html;
}

// Render Crew Timeline View
function renderCrewTimeline() {
    const container = document.getElementById('scheduleCrewTimeline');
    if (!container) return;

    let html = `
        <div style="margin-bottom: var(--spacing-md);">
            <h3>Timeline — projetos e visitas de leads</h3>
        </div>
        <div style="overflow-x: auto;">
            <h4 style="margin: var(--spacing-sm) 0;">Project schedules</h4>
            <table style="width: 100%; border-collapse: collapse;">
                <thead>
                    <tr>
                        <th style="padding: 8px; text-align: left; border-bottom: 2px solid var(--border-color);">Crew</th>
                        <th style="padding: 8px; text-align: left; border-bottom: 2px solid var(--border-color);">Project</th>
                        <th style="padding: 8px; text-align: left; border-bottom: 2px solid var(--border-color);">Start</th>
                        <th style="padding: 8px; text-align: left; border-bottom: 2px solid var(--border-color);">End</th>
                        <th style="padding: 8px; text-align: left; border-bottom: 2px solid var(--border-color);">Status</th>
                        <th style="padding: 8px; text-align: left; border-bottom: 2px solid var(--border-color);">Actions</th>
                    </tr>
                </thead>
                <tbody>
    `;

    allSchedules.forEach(schedule => {
        html += `
            <tr>
                <td style="padding: 8px; border-bottom: 1px solid var(--border-color);">${escapeHtml(schedule.crew_name)}</td>
                <td style="padding: 8px; border-bottom: 1px solid var(--border-color);">${escapeHtml(schedule.project_name || schedule.project_number || 'N/A')}</td>
                <td style="padding: 8px; border-bottom: 1px solid var(--border-color);">${new Date(schedule.start_date).toLocaleDateString()}</td>
                <td style="padding: 8px; border-bottom: 1px solid var(--border-color);">${new Date(schedule.end_date).toLocaleDateString()}</td>
                <td style="padding: 8px; border-bottom: 1px solid var(--border-color);">
                    <span class="badge badge-${schedule.status}">${escapeHtml(schedule.status)}</span>
                </td>
                <td style="padding: 8px; border-bottom: 1px solid var(--border-color);">
                    <button class="btn btn-sm" onclick="viewSchedule(${schedule.id})">View</button>
                </td>
            </tr>
        `;
    });

    html += `
                </tbody>
            </table>
            <h4 style="margin: var(--spacing-md) 0 var(--spacing-sm);">Lead visits</h4>
            <table style="width: 100%; border-collapse: collapse;">
                <thead>
                    <tr>
                        <th style="padding: 8px; text-align: left; border-bottom: 2px solid var(--border-color);">Assigned</th>
                        <th style="padding: 8px; text-align: left; border-bottom: 2px solid var(--border-color);">Lead</th>
                        <th style="padding: 8px; text-align: left; border-bottom: 2px solid var(--border-color);">When</th>
                        <th style="padding: 8px; text-align: left; border-bottom: 2px solid var(--border-color);">Status</th>
                        <th style="padding: 8px; text-align: left; border-bottom: 2px solid var(--border-color);">Actions</th>
                    </tr>
                </thead>
                <tbody>
    `;

    const sortedVisits = [...allLeadVisits].sort((a, b) => {
        const ta = a.scheduled_at ? new Date(a.scheduled_at).getTime() : 0;
        const tb = b.scheduled_at ? new Date(b.scheduled_at).getTime() : 0;
        return ta - tb;
    });

    sortedVisits.forEach(v => {
        const when = v.scheduled_at
            ? `${new Date(v.scheduled_at).toLocaleString()}`
            : '—';
        html += `
            <tr>
                <td style="padding: 8px; border-bottom: 1px solid var(--border-color);">${escapeHtml(v.assigned_to_name || '—')}</td>
                <td style="padding: 8px; border-bottom: 1px solid var(--border-color);">${escapeHtml(v.lead_name || 'Lead')}</td>
                <td style="padding: 8px; border-bottom: 1px solid var(--border-color);">${escapeHtml(when)}</td>
                <td style="padding: 8px; border-bottom: 1px solid var(--border-color);">
                    <span class="badge badge-${v.status || 'scheduled'}">${escapeHtml(v.status || 'scheduled')}</span>
                </td>
                <td style="padding: 8px; border-bottom: 1px solid var(--border-color);">
                    <a class="btn btn-sm" href="lead-detail.html?id=${encodeURIComponent(v.lead_id)}">Open lead</a>
                </td>
            </tr>
        `;
    });

    if (sortedVisits.length === 0) {
        html += `<tr><td colspan="5" style="padding: 12px; color: #999;">No lead visits in this range.</td></tr>`;
    }

    html += '</tbody></table></div>';
    container.innerHTML = html;
}

// Helper Functions
function getScheduleColor(schedule) {
    const statusColors = {
        scheduled: '#e3f2fd',
        in_progress: '#fff3e0',
        completed: '#e8f5e9',
        delayed: '#ffebee',
        cancelled: '#f3e5f5'
    };
    return statusColors[schedule.status] || '#f5f5f5';
}

function getPriorityColor(priority) {
    const colors = {
        high: '#f44336',
        normal: '#2196f3',
        low: '#4caf50'
    };
    return colors[priority] || '#2196f3';
}

async function changeScheduleMonth(delta) {
    currentDate.setMonth(currentDate.getMonth() + delta);
    await Promise.all([loadSchedules(), loadLeadVisits()]);
    renderForecastDashboard(allSchedules, allLeadVisits);
    renderScheduleView();
}

function changeScheduleWeek(delta) {
    currentDate.setDate(currentDate.getDate() + (delta * 7));
    renderWeekView();
}

function viewSchedule(scheduleId) {
    if (typeof crmNotify === 'function') {
        crmNotify('Agenda #' + scheduleId + ' — detalhe em breve.', 'info');
    } else {
        alert(`Schedule ID: ${scheduleId}\nFeature: View schedule details (to be implemented)`);
    }
}

function showNewScheduleModal() {
    if (typeof crmNotify === 'function') crmNotify('Nova marcação — em breve.', 'info');
    else alert('Feature: New schedule modal (to be implemented)');
}

if (typeof window !== 'undefined') {
    window.showScheduleView = showScheduleView;
    window.changeScheduleMonth = changeScheduleMonth;
    window.changeScheduleWeek = changeScheduleWeek;
    window.viewSchedule = viewSchedule;
    window.showNewScheduleModal = showNewScheduleModal;
    window.loadScheduleDashboard = loadScheduleDashboard;
    window.loadScheduleData = loadScheduleData;
}
