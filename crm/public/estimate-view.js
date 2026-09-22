/**
 * Estimate View - Client-facing simplified view
 */

let estimateId = null;
let estimateData = null;

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    const urlParams = new URLSearchParams(window.location.search);
    estimateId = urlParams.get('id') || urlParams.get('estimate_id');
    
    if (estimateId) {
        loadEstimate(estimateId);
    } else {
        document.querySelector('.estimate-view').innerHTML = '<div class="error">Estimate ID not provided</div>';
    }
});

// Load Estimate
async function loadEstimate(id) {
    try {
        const response = await fetch(`/api/estimates/${id}`, { credentials: 'include' });
        const data = await response.json();
        
        if (data.success && data.data) {
            estimateData = data.data;
            renderEstimate(data.data);
            
            // Mark as viewed
            if (data.data.status === 'sent') {
                updateEstimateStatus('viewed');
            }
        } else {
            document.querySelector('.estimate-view').innerHTML = 
                '<div class="error">Estimate not found</div>';
        }
    } catch (error) {
        console.error('Error loading estimate:', error);
        document.querySelector('.estimate-view').innerHTML = 
            '<div class="error">Error loading estimate</div>';
    }
}

// Render Estimate
function renderEstimate(estimate) {
    // Header
    document.getElementById('estimateNumber').textContent = 
        estimate.estimate_number || `EST-${estimate.id}`;
    
    // Info cards
    document.getElementById('totalSqft').textContent = 
        estimate.total_sqft ? `${estimate.total_sqft.toLocaleString()} sqft` : '-';
    document.getElementById('flooringType').textContent = 
        estimate.flooring_type ? estimate.flooring_type.charAt(0).toUpperCase() + estimate.flooring_type.slice(1) : '-';
    document.getElementById('projectType').textContent = 
        estimate.project_type ? estimate.project_type.charAt(0).toUpperCase() + estimate.project_type.slice(1) : '-';
    document.getElementById('expirationDate').textContent = 
        estimate.expiration_date ? new Date(estimate.expiration_date).toLocaleDateString() : 'N/A';
    
    // Scope description
    const scopeDesc = estimate.client_notes || 
        `Professional ${estimate.flooring_type || 'flooring'} installation for ${estimate.total_sqft || 0} square feet.`;
    document.getElementById('scopeDescription').textContent = scopeDesc;
    
    // Group items by category
    if (estimate.items && estimate.items.length > 0) {
        const grouped = groupItemsByCategory(estimate.items);
        renderGroupedItems(grouped);
    }
    
    // Payment schedule
    if (estimate.payment_schedule) {
        try {
            const schedule = typeof estimate.payment_schedule === 'string' 
                ? JSON.parse(estimate.payment_schedule) 
                : estimate.payment_schedule;
            
            if (schedule && schedule.length > 0) {
                renderPaymentSchedule(schedule, estimate.final_price);
            }
        } catch (e) {
            console.error('Error parsing payment schedule:', e);
        }
    }
    
    // Final price
    document.getElementById('finalPrice').textContent = 
        `$${parseFloat(estimate.final_price || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    
    // Hide action buttons if already accepted/declined
    if (estimate.status === 'accepted' || estimate.status === 'declined') {
        document.querySelector('.action-buttons').style.display = 'none';
        const statusMsg = document.createElement('div');
        statusMsg.className = 'info-card';
        statusMsg.style.textAlign = 'center';
        statusMsg.style.marginTop = 'var(--spacing-md)';
        statusMsg.innerHTML = `
            <h3>Status: ${estimate.status === 'accepted' ? 'Accepted' : 'Declined'}</h3>
            ${estimate.accepted_at ? `<p>Date: ${new Date(estimate.accepted_at).toLocaleString()}</p>` : ''}
        `;
        document.querySelector('.total-box').after(statusMsg);
    }
}

// Group Items by Category
function groupItemsByCategory(items) {
    const grouped = {
        material: [],
        labor: [],
        equipment: []
    };
    
    items.forEach(item => {
        if (grouped[item.category]) {
            grouped[item.category].push(item);
        }
    });
    
    return grouped;
}

// Render Grouped Items
function renderGroupedItems(grouped) {
    const container = document.getElementById('itemsGrouped');
    const categoryNames = {
        material: 'Materials',
        labor: 'Labor',
        equipment: 'Equipment'
    };
    
    let html = '';
    
    Object.keys(grouped).forEach(category => {
        if (grouped[category].length > 0) {
            const categoryTotal = grouped[category].reduce((sum, item) => sum + (parseFloat(item.total_cost) || 0), 0);
            
            html += `
                <div class="items-group">
                    <h4>${categoryNames[category]}</h4>
                    ${grouped[category].map(item => `
                        <div class="item-line">
                            <span>${item.name}${item.description ? ` - ${item.description}` : ''}</span>
                            <strong>$${parseFloat(item.total_cost || 0).toFixed(2)}</strong>
                        </div>
                    `).join('')}
                    <div class="item-line" style="font-weight: 600; margin-top: var(--spacing-xs);">
                        <span>${categoryNames[category]} Subtotal</span>
                        <strong>$${categoryTotal.toFixed(2)}</strong>
                    </div>
                </div>
            `;
        }
    });
    
    container.innerHTML = html;
}

// Render Payment Schedule
function renderPaymentSchedule(schedule, totalPrice) {
    const container = document.getElementById('paymentItems');
    document.getElementById('paymentSchedule').style.display = 'block';
    
    container.innerHTML = schedule.map((payment, index) => {
        const amount = payment.amount || (totalPrice * (payment.percentage / 100));
        return `
            <div class="payment-item">
                <span>
                    <strong>${payment.type || `Payment ${index + 1}`}</strong>
                    ${payment.due_date ? `<br><small>Due: ${new Date(payment.due_date).toLocaleDateString()}</small>` : ''}
                </span>
                <strong>$${amount.toFixed(2)}${payment.percentage ? ` (${payment.percentage}%)` : ''}</strong>
            </div>
        `;
    }).join('');
}

// Accept Estimate
async function acceptEstimate() {
    if (!confirm('Do you want to accept this estimate?')) return;
    
    try {
        const response = await fetch(`/api/estimates/${estimateId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ status: 'accepted' })
        });
        
        const data = await response.json();
        
        if (data.success) {
            if (typeof crmNotify === 'function') crmNotify('Estimate accepted! We will contact you soon.', 'success');
            else alert('Estimate accepted! We will contact you soon.');
            location.reload();
        } else {
            if (typeof crmNotify === 'function') crmNotify('Error accepting estimate: ' + (data.error || 'Unknown error'), 'error');
            else alert('Error accepting estimate: ' + (data.error || 'Unknown error'));
        }
    } catch (error) {
        console.error('Error accepting estimate:', error);
        if (typeof crmNotify === 'function') crmNotify('Error accepting estimate', 'error');
        else alert('Error accepting estimate');
    }
}

// Decline Estimate
async function declineEstimate() {
    const reason = prompt('Please provide a reason for declining (optional):');
    
    try {
        const response = await fetch(`/api/estimates/${estimateId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ 
                status: 'declined',
                client_notes: reason || 'Client declined'
            })
        });
        
        const data = await response.json();
        
        if (data.success) {
            if (typeof crmNotify === 'function') crmNotify('Estimate declined. Thank you for your feedback.', 'info');
            else alert('Estimate declined. Thank you for your feedback.');
            location.reload();
        } else {
            if (typeof crmNotify === 'function') crmNotify('Error declining estimate: ' + (data.error || 'Unknown error'), 'error');
            else alert('Error declining estimate: ' + (data.error || 'Unknown error'));
        }
    } catch (error) {
        console.error('Error declining estimate:', error);
        if (typeof crmNotify === 'function') crmNotify('Error declining estimate', 'error');
        else alert('Error declining estimate');
    }
}

// Update Estimate Status
async function updateEstimateStatus(status) {
    try {
        await fetch(`/api/estimates/${estimateId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ status })
        });
    } catch (error) {
        console.error('Error updating status:', error);
    }
}
