/**
 * Financial Management Engine - Frontend
 * Interface completa de gestão financeira
 */

let currentFinancialView = 'dashboard';
let financialCharts = {};

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    if (document.getElementById('financeiroPage')) {
        loadFinancialDashboard();
    }
});

// Show Financial View
function showFinancialView(view) {
    currentFinancialView = view;
    
    // Hide all views
    document.getElementById('financialDashboardView').style.display = 'none';
    document.getElementById('financialExpensesView').style.display = 'none';
    document.getElementById('financialPayrollView').style.display = 'none';
    
    // Show selected view
    if (view === 'dashboard') {
        document.getElementById('financialDashboardView').style.display = 'block';
        loadFinancialDashboard();
    } else if (view === 'expenses') {
        document.getElementById('financialExpensesView').style.display = 'block';
        loadExpenses();
    } else if (view === 'payroll') {
        document.getElementById('financialPayrollView').style.display = 'block';
        loadPayrollEntries();
    }
}

// Load Financial Dashboard
async function loadFinancialDashboard() {
    try {
        const response = await fetch('/api/financial/dashboard', { credentials: 'include' });
        const data = await response.json();
        
        if (data.success && data.data) {
            renderFinancialDashboard(data.data);
        }
    } catch (error) {
        console.error('Error loading financial dashboard:', error);
    }
}

// Render Financial Dashboard
function renderFinancialDashboard(dashboard) {
    const revenueCost = dashboard.revenue_vs_cost || {};
    const estimatedRevenue = parseFloat(revenueCost.estimated_revenue) || 0;
    const actualRevenue = parseFloat(revenueCost.actual_revenue) || 0;
    const estimatedCost = parseFloat(revenueCost.estimated_cost) || 0;
    const actualCost = parseFloat(revenueCost.actual_cost) || 0;
    const estimatedProfit = parseFloat(revenueCost.estimated_profit) || 0;
    const actualProfit = parseFloat(revenueCost.actual_profit) || 0;
    
    // Update stats
    document.getElementById('totalRevenue').textContent = `$${actualRevenue.toLocaleString()}`;
    document.getElementById('revenueVariance').textContent = `Est: $${estimatedRevenue.toLocaleString()}`;
    
    document.getElementById('totalCost').textContent = `$${actualCost.toLocaleString()}`;
    document.getElementById('costVariance').textContent = `Est: $${estimatedCost.toLocaleString()}`;
    
    document.getElementById('totalProfit').textContent = `$${actualProfit.toLocaleString()}`;
    const profitVar = actualProfit - estimatedProfit;
    document.getElementById('profitVariance').textContent = `Var: $${profitVar.toLocaleString()}`;
    
    const margin = actualRevenue > 0 ? (actualProfit / actualRevenue * 100) : 0;
    const estMargin = estimatedRevenue > 0 ? (estimatedProfit / estimatedRevenue * 100) : 0;
    document.getElementById('profitMargin').textContent = `${margin.toFixed(1)}%`;
    document.getElementById('marginVariance').textContent = `Est: ${estMargin.toFixed(1)}%`;
    
    // Render charts
    renderRevenueCostChart(estimatedRevenue, actualRevenue, estimatedCost, actualCost);
    renderExpenseBreakdownChart(dashboard.expense_breakdown || []);
    renderCashFlowChart(dashboard.monthly_cash_flow || []);
    renderCrewCostChart(dashboard.crew_cost_analysis || []);
    renderProfitabilityRanking(dashboard.profitability_ranking || []);
}

// Render Revenue vs Cost Chart
function renderRevenueCostChart(estRev, actRev, estCost, actCost) {
    const ctx = document.getElementById('revenueCostChart');
    if (!ctx) return;
    
    if (financialCharts.revenueCost) {
        financialCharts.revenueCost.destroy();
    }
    
    financialCharts.revenueCost = new Chart(ctx.getContext('2d'), {
        type: 'bar',
        data: {
            labels: ['Estimated', 'Actual'],
            datasets: [
                {
                    label: 'Revenue',
                    data: [estRev, actRev],
                    backgroundColor: 'rgba(54, 162, 235, 0.6)',
                    borderColor: 'rgba(54, 162, 235, 1)',
                    borderWidth: 1
                },
                {
                    label: 'Cost',
                    data: [estCost, actCost],
                    backgroundColor: 'rgba(255, 99, 132, 0.6)',
                    borderColor: 'rgba(255, 99, 132, 1)',
                    borderWidth: 1
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            scales: {
                y: {
                    beginAtZero: true
                }
            }
        }
    });
}

// Render Expense Breakdown Chart
function renderExpenseBreakdownChart(breakdown) {
    const ctx = document.getElementById('expenseBreakdownChart');
    if (!ctx) return;
    
    if (financialCharts.expenseBreakdown) {
        financialCharts.expenseBreakdown.destroy();
    }
    
    financialCharts.expenseBreakdown = new Chart(ctx.getContext('2d'), {
        type: 'doughnut',
        data: {
            labels: breakdown.map(e => e.category),
            datasets: [{
                data: breakdown.map(e => parseFloat(e.total) || 0),
                backgroundColor: [
                    'rgba(255, 99, 132, 0.6)',
                    'rgba(54, 162, 235, 0.6)',
                    'rgba(255, 206, 86, 0.6)',
                    'rgba(75, 192, 192, 0.6)',
                    'rgba(153, 102, 255, 0.6)',
                    'rgba(255, 159, 64, 0.6)'
                ]
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true
        }
    });
}

// Render Cash Flow Chart
function renderCashFlowChart(cashFlow) {
    const ctx = document.getElementById('cashFlowChart');
    if (!ctx) return;
    
    if (financialCharts.cashFlow) {
        financialCharts.cashFlow.destroy();
    }
    
    financialCharts.cashFlow = new Chart(ctx.getContext('2d'), {
        type: 'line',
        data: {
            labels: cashFlow.map(c => c.month),
            datasets: [
                {
                    label: 'Revenue',
                    data: cashFlow.map(c => parseFloat(c.revenue) || 0),
                    borderColor: 'rgba(54, 162, 235, 1)',
                    backgroundColor: 'rgba(54, 162, 235, 0.1)',
                    tension: 0.4
                },
                {
                    label: 'Expenses',
                    data: cashFlow.map(c => parseFloat(c.expenses) || 0),
                    borderColor: 'rgba(255, 99, 132, 1)',
                    backgroundColor: 'rgba(255, 99, 132, 0.1)',
                    tension: 0.4
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            scales: {
                y: {
                    beginAtZero: true
                }
            }
        }
    });
}

// Render Crew Cost Chart
function renderCrewCostChart(crewCosts) {
    const ctx = document.getElementById('crewCostChart');
    if (!ctx) return;
    
    if (financialCharts.crewCost) {
        financialCharts.crewCost.destroy();
    }
    
    financialCharts.crewCost = new Chart(ctx.getContext('2d'), {
        type: 'bar',
        data: {
            labels: crewCosts.map(c => c.crew_name),
            datasets: [{
                label: 'Total Cost',
                data: crewCosts.map(c => parseFloat(c.total_cost) || 0),
                backgroundColor: 'rgba(75, 192, 192, 0.6)',
                borderColor: 'rgba(75, 192, 192, 1)',
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            scales: {
                y: {
                    beginAtZero: true
                }
            }
        }
    });
}

// Render Profitability Ranking
function renderProfitabilityRanking(ranking) {
    const container = document.getElementById('profitabilityRanking');
    if (!container) return;
    
    if (ranking.length === 0) {
        container.innerHTML = '<p style="text-align: center; color: var(--text-muted);">No profitability data available</p>';
        return;
    }
    
    container.innerHTML = ranking.map((project, index) => {
        const profit = parseFloat(project.actual_profit) || 0;
        const margin = parseFloat(project.actual_margin_percentage) || 0;
        const variance = parseFloat(project.profit_variance) || 0;
        const varianceClass = variance >= 0 ? 'success' : 'error';
        
        return `
            <div style="display: flex; justify-content: space-between; align-items: center; padding: var(--spacing-sm); border-bottom: 1px solid var(--border-color);">
                <div style="display: flex; align-items: center; gap: var(--spacing-sm);">
                    <span style="font-weight: 600; color: var(--text-muted);">#${index + 1}</span>
                    <div>
                        <strong>${project.project_number || 'N/A'}</strong>
                        <div style="font-size: 0.85rem; color: var(--text-muted);">
                            Margin: ${margin.toFixed(1)}%
                        </div>
                    </div>
                </div>
                <div style="text-align: right;">
                    <div style="font-weight: 600; color: ${profit >= 0 ? 'var(--success-color)' : 'var(--error-color)'};">
                        $${profit.toLocaleString()}
                    </div>
                    <div style="font-size: 0.85rem; color: var(--${varianceClass}-color);">
                        ${variance >= 0 ? '+' : ''}$${variance.toLocaleString()}
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

// Load Expenses
async function loadExpenses() {
    try {
        const response = await fetch('/api/expenses?limit=100', { credentials: 'include' });
        const data = await response.json();
        
        if (data.success && data.data) {
            renderExpenses(data.data);
        }
    } catch (error) {
        console.error('Error loading expenses:', error);
    }
}

// Render Expenses
function renderExpenses(expenses) {
    const tbody = document.getElementById('expensesTableBody');
    if (!tbody) return;
    
    if (expenses.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" class="text-center">No expenses found</td></tr>';
        return;
    }
    
    tbody.innerHTML = expenses.map(expense => {
        const statusColors = {
            pending: 'warning',
            approved: 'success',
            paid: 'info',
            rejected: 'error'
        };
        
        return `
            <tr>
                <td>${new Date(expense.expense_date).toLocaleDateString()}</td>
                <td><span class="badge badge-${expense.category}">${expense.category}</span></td>
                <td>${expense.vendor || '-'}</td>
                <td>${expense.description.substring(0, 50)}${expense.description.length > 50 ? '...' : ''}</td>
                <td>$${parseFloat(expense.total_amount).toFixed(2)}</td>
                <td>${expense.project_number || 'Overhead'}</td>
                <td><span class="badge badge-${statusColors[expense.status]}">${expense.status}</span></td>
                <td>
                    ${expense.status === 'pending' ? `<button class="btn btn-sm" onclick="approveExpense(${expense.id})">Approve</button>` : ''}
                    ${expense.receipt_url ? `<a href="${expense.receipt_url}" target="_blank" class="btn btn-sm">Receipt</a>` : ''}
                </td>
            </tr>
        `;
    }).join('');
}

// Load Payroll Entries
async function loadPayrollEntries() {
    try {
        const response = await fetch('/api/payroll?limit=100', { credentials: 'include' });
        const data = await response.json();
        
        if (data.success && data.data) {
            renderPayrollEntries(data.data);
        }
    } catch (error) {
        console.error('Error loading payroll entries:', error);
    }
}

// Render Payroll Entries
function renderPayrollEntries(entries) {
    const tbody = document.getElementById('payrollTableBody');
    if (!tbody) return;
    
    if (entries.length === 0) {
        tbody.innerHTML = '<tr><td colspan="9" class="text-center">No payroll entries found</td></tr>';
        return;
    }
    
    tbody.innerHTML = entries.map(entry => {
        const totalCost = parseFloat(entry.total_cost) + (parseFloat(entry.overtime_cost) || 0);
        const totalHours = parseFloat(entry.hours_worked) + (parseFloat(entry.overtime_hours) || 0);
        
        return `
            <tr>
                <td>${new Date(entry.date).toLocaleDateString()}</td>
                <td>${entry.employee_name}</td>
                <td>${totalHours.toFixed(2)}h</td>
                <td>$${parseFloat(entry.hourly_rate).toFixed(2)}/hr</td>
                <td>$${totalCost.toFixed(2)}</td>
                <td>${entry.project_number || 'Overhead'}</td>
                <td>${entry.crew_name || '-'}</td>
                <td><span class="badge badge-${entry.approved ? 'success' : 'warning'}">${entry.approved ? 'Approved' : 'Pending'}</span></td>
                <td>
                    ${!entry.approved ? `<button class="btn btn-sm" onclick="approvePayrollEntry(${entry.id})">Approve</button>` : ''}
                </td>
            </tr>
        `;
    }).join('');
}

// Create Expense
async function createExpense(e) {
    e.preventDefault();
    const form = e.target;
    const formData = new FormData(form);
    
    const expenseData = {
        category: formData.get('category'),
        project_id: formData.get('project_id') || null,
        vendor: formData.get('vendor') || null,
        description: formData.get('description'),
        amount: parseFloat(formData.get('amount')),
        tax_amount: parseFloat(formData.get('tax_amount')) || 0,
        payment_method: formData.get('payment_method') || null,
        expense_date: formData.get('expense_date'),
        receipt_url: formData.get('receipt_url') || null
    };
    
    try {
        const response = await fetch('/api/expenses', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(expenseData)
        });
        
        const data = await response.json();
        if (data.success) {
            if (typeof crmNotify === 'function') crmNotify('Expense created successfully!', 'success');
            else alert('Expense created successfully!');
            closeModal('newExpenseModal');
            form.reset();
            if (currentFinancialView === 'expenses') {
                loadExpenses();
            }
            loadFinancialDashboard();
        } else {
            if (typeof crmNotify === 'function') crmNotify('Error creating expense: ' + (data.error || 'Unknown error'), 'error');
            else alert('Error creating expense: ' + (data.error || 'Unknown error'));
        }
    } catch (error) {
        console.error('Error creating expense:', error);
        if (typeof crmNotify === 'function') crmNotify('Error creating expense', 'error');
        else alert('Error creating expense');
    }
}

// Approve Expense
async function approveExpense(expenseId) {
    if (!confirm('Approve this expense?')) return;
    
    try {
        const response = await fetch(`/api/expenses/${expenseId}/approve`, {
            method: 'PUT',
            credentials: 'include'
        });
        
        const data = await response.json();
        if (data.success) {
            if (typeof crmNotify === 'function') crmNotify('Expense approved!', 'success');
            else alert('Expense approved!');
            loadExpenses();
            loadFinancialDashboard();
        } else {
            if (typeof crmNotify === 'function') crmNotify('Error approving expense: ' + (data.error || 'Unknown error'), 'error');
            else alert('Error approving expense: ' + (data.error || 'Unknown error'));
        }
    } catch (error) {
        console.error('Error approving expense:', error);
        if (typeof crmNotify === 'function') crmNotify('Error approving expense', 'error');
        else alert('Error approving expense');
    }
}

// Create Payroll Entry
async function createPayrollEntry(e) {
    e.preventDefault();
    const form = e.target;
    const formData = new FormData(form);
    
    const payrollData = {
        employee_id: parseInt(formData.get('employee_id')),
        project_id: formData.get('project_id') || null,
        crew_id: formData.get('crew_id') || null,
        date: formData.get('date'),
        hours_worked: parseFloat(formData.get('hours_worked')),
        hourly_rate: parseFloat(formData.get('hourly_rate')),
        overtime_hours: parseFloat(formData.get('overtime_hours')) || 0,
        overtime_rate: formData.get('overtime_rate') || null
    };
    
    try {
        const response = await fetch('/api/payroll', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(payrollData)
        });
        
        const data = await response.json();
        if (data.success) {
            if (typeof crmNotify === 'function') crmNotify('Payroll entry created successfully!', 'success');
            else alert('Payroll entry created successfully!');
            closeModal('newPayrollModal');
            form.reset();
            if (currentFinancialView === 'payroll') {
                loadPayrollEntries();
            }
            loadFinancialDashboard();
        } else {
            if (typeof crmNotify === 'function') crmNotify('Error creating payroll entry: ' + (data.error || 'Unknown error'), 'error');
            else alert('Error creating payroll entry: ' + (data.error || 'Unknown error'));
        }
    } catch (error) {
        console.error('Error creating payroll entry:', error);
        if (typeof crmNotify === 'function') crmNotify('Error creating payroll entry', 'error');
        else alert('Error creating payroll entry');
    }
}

// Approve Payroll Entry
async function approvePayrollEntry(entryId) {
    if (!confirm('Approve this payroll entry?')) return;
    
    try {
        const response = await fetch(`/api/payroll/${entryId}/approve`, {
            method: 'PUT',
            credentials: 'include'
        });
        
        const data = await response.json();
        if (data.success) {
            if (typeof crmNotify === 'function') crmNotify('Payroll entry approved!', 'success');
            else alert('Payroll entry approved!');
            loadPayrollEntries();
            loadFinancialDashboard();
        } else {
            if (typeof crmNotify === 'function') crmNotify('Error approving payroll entry: ' + (data.error || 'Unknown error'), 'error');
            else alert('Error approving payroll entry: ' + (data.error || 'Unknown error'));
        }
    } catch (error) {
        console.error('Error approving payroll entry:', error);
        if (typeof crmNotify === 'function') crmNotify('Error approving payroll entry', 'error');
        else alert('Error approving payroll entry');
    }
}

// Show Modals
function showNewExpenseModal() {
    loadProjectsForSelect('expenseProjectSelect');
    const today = new Date().toISOString().split('T')[0];
    document.querySelector('#newExpenseForm input[name="expense_date"]').value = today;
    document.getElementById('newExpenseModal').classList.add('active');
    document.getElementById('newExpenseModal').style.display = 'flex';
}

function showNewPayrollModal() {
    loadUsersForSelect('payrollEmployeeSelect');
    loadProjectsForSelect('payrollProjectSelect');
    loadCrewsForSelect('payrollCrewSelect');
    const today = new Date().toISOString().split('T')[0];
    document.querySelector('#newPayrollForm input[name="date"]').value = today;
    document.getElementById('newPayrollModal').classList.add('active');
    document.getElementById('newPayrollModal').style.display = 'flex';
}

// Load data for selects
async function loadProjectsForSelect(selectId) {
    try {
        const response = await fetch('/api/projects?limit=100', { credentials: 'include' });
        const data = await response.json();
        
        if (data.success && data.data) {
            const select = document.getElementById(selectId);
            if (select) {
                select.innerHTML = '<option value="">General Overhead</option>';
                data.data.forEach(project => {
                    const option = document.createElement('option');
                    option.value = project.id;
                    option.textContent = `${project.project_number || project.id} - ${project.flooring_type || ''}`;
                    select.appendChild(option);
                });
            }
        }
    } catch (error) {
        console.error('Error loading projects:', error);
    }
}

async function loadUsersForSelect(selectId) {
    try {
        const response = await fetch('/api/users?limit=100', { credentials: 'include' });
        const data = await response.json();
        
        if (data.success && data.data) {
            const select = document.getElementById(selectId);
            if (select) {
                select.innerHTML = '<option value="">Select...</option>';
                data.data.filter(u => u.is_active !== 0).forEach(user => {
                    const option = document.createElement('option');
                    option.value = user.id;
                    option.textContent = `${user.name} (${user.email})`;
                    select.appendChild(option);
                });
            }
        }
    } catch (error) {
        console.error('Error loading users:', error);
    }
}

async function loadCrewsForSelect(selectId) {
    try {
        const response = await fetch('/api/crews?active=true', { credentials: 'include' });
        const data = await response.json();
        
        if (data.success && data.data) {
            const select = document.getElementById(selectId);
            if (select) {
                select.innerHTML = '<option value="">Select crew...</option>';
                data.data.forEach(crew => {
                    const option = document.createElement('option');
                    option.value = crew.id;
                    option.textContent = crew.name;
                    select.appendChild(option);
                });
            }
        }
    } catch (error) {
        console.error('Error loading crews:', error);
    }
}

// Make functions globally available
if (typeof window !== 'undefined') {
    window.showFinancialView = showFinancialView;
    window.loadFinancialDashboard = loadFinancialDashboard;
    window.showNewExpenseModal = showNewExpenseModal;
    window.showNewPayrollModal = showNewPayrollModal;
    window.createExpense = createExpense;
    window.approveExpense = approveExpense;
    window.createPayrollEntry = createPayrollEntry;
    window.approvePayrollEntry = approvePayrollEntry;
}
