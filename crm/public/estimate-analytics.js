/**
 * Estimate Analytics - Frontend
 */

let marginChart = null;
let revenueChart = null;

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    loadAnalytics();
});

// Load Analytics
async function loadAnalytics() {
    try {
        const response = await fetch('/api/estimates/analytics/overview', { credentials: 'include' });
        const data = await response.json();
        
        if (data.success && data.data) {
            renderAnalytics(data.data);
        } else {
            console.error('Error loading analytics:', data.error);
        }
    } catch (error) {
        console.error('Error loading analytics:', error);
    }
}

// Render Analytics
function renderAnalytics(analytics) {
    // Acceptance Rate
    const acceptance = analytics.acceptance_rate;
    if (acceptance && acceptance.total > 0) {
        const rate = (acceptance.accepted / acceptance.total) * 100;
        document.getElementById('acceptanceRate').textContent = `${rate.toFixed(1)}%`;
        document.getElementById('acceptanceDetails').innerHTML = `
            <small>
                ${acceptance.accepted} accepted / ${acceptance.total} total<br>
                ${acceptance.declined} declined, ${acceptance.pending} pending
            </small>
        `;
    }
    
    // Average Margin
    const marginByType = analytics.margin_by_project_type;
    if (marginByType && marginByType.length > 0) {
        const avgMargin = marginByType.reduce((sum, m) => sum + parseFloat(m.avg_margin_percentage || 0), 0) / marginByType.length;
        document.getElementById('avgMargin').textContent = `${avgMargin.toFixed(1)}%`;
        document.getElementById('marginDetails').innerHTML = `
            <small>
                ${marginByType.map(m => `${m.project_type}: ${parseFloat(m.avg_margin_percentage || 0).toFixed(1)}%`).join('<br>')}
            </small>
        `;
        
        // Render chart
        renderMarginChart(marginByType);
    }
    
    // Revenue
    const revenueByFlooring = analytics.revenue_by_flooring;
    if (revenueByFlooring && revenueByFlooring.length > 0) {
        const totalRevenue = revenueByFlooring.reduce((sum, r) => sum + parseFloat(r.total_revenue || 0), 0);
        document.getElementById('totalRevenue').textContent = `$${totalRevenue.toLocaleString()}`;
        document.getElementById('revenueDetails').innerHTML = `
            <small>
                ${revenueByFlooring.length} flooring types<br>
                ${revenueByFlooring.reduce((sum, r) => sum + (r.count || 0), 0)} accepted estimates
            </small>
        `;
        
        // Render chart
        renderRevenueChart(revenueByFlooring);
    }
}

// Render Margin Chart
function renderMarginChart(data) {
    const ctx = document.getElementById('marginByTypeChart').getContext('2d');
    
    if (marginChart) {
        marginChart.destroy();
    }
    
    marginChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: data.map(d => d.project_type || 'Unknown'),
            datasets: [{
                label: 'Average Margin %',
                data: data.map(d => parseFloat(d.avg_margin_percentage || 0)),
                backgroundColor: 'rgba(54, 162, 235, 0.6)',
                borderColor: 'rgba(54, 162, 235, 1)',
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        callback: function(value) {
                            return value + '%';
                        }
                    }
                }
            }
        }
    });
}

// Render Revenue Chart
function renderRevenueChart(data) {
    const ctx = document.getElementById('revenueByFlooringChart').getContext('2d');
    
    if (revenueChart) {
        revenueChart.destroy();
    }
    
    revenueChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: data.map(d => d.flooring_type || 'Unknown'),
            datasets: [{
                label: 'Revenue',
                data: data.map(d => parseFloat(d.total_revenue || 0)),
                backgroundColor: [
                    'rgba(255, 99, 132, 0.6)',
                    'rgba(54, 162, 235, 0.6)',
                    'rgba(255, 206, 86, 0.6)',
                    'rgba(75, 192, 192, 0.6)',
                    'rgba(153, 102, 255, 0.6)',
                    'rgba(255, 159, 64, 0.6)'
                ],
                borderColor: [
                    'rgba(255, 99, 132, 1)',
                    'rgba(54, 162, 235, 1)',
                    'rgba(255, 206, 86, 1)',
                    'rgba(75, 192, 192, 1)',
                    'rgba(153, 102, 255, 1)',
                    'rgba(255, 159, 64, 1)'
                ],
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            plugins: {
                legend: {
                    position: 'right'
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const label = context.label || '';
                            const value = context.parsed || 0;
                            return `${label}: $${value.toLocaleString()}`;
                        }
                    }
                }
            }
        }
    });
}

// Make loadAnalytics available globally
window.loadAnalytics = loadAnalytics;
