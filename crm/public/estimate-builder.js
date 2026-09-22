/**
 * Estimate Builder - Frontend Logic
 */

let estimateItems = [];
let currentProject = null;

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    const urlParams = new URLSearchParams(window.location.search);
    const projectId = urlParams.get('project_id');
    const estimateId = urlParams.get('estimate_id');
    
    if (projectId) {
        document.getElementById('projectId').value = projectId;
        loadProjectData(projectId);
    }
    
    if (estimateId) {
        document.getElementById('estimateId').value = estimateId;
        loadEstimate(estimateId);
    }
    
    updateCalculations();
});

// Load Project Data
async function loadProjectData(projectId) {
    try {
        const response = await fetch(`/api/projects/${projectId}`, { credentials: 'include' });
        const data = await response.json();
        
        if (data.success && data.data) {
            currentProject = data.data;
            populateProjectFields(data.data);
            applySmartRules();
        }
    } catch (error) {
        console.error('Error loading project:', error);
        if (typeof crmNotify === 'function') crmNotify('Error loading project data', 'error');
        else alert('Error loading project data');
    }
}

// Populate Project Fields
function populateProjectFields(project) {
    if (project.project_type) document.getElementById('projectType').value = project.project_type;
    if (project.service_type) document.getElementById('serviceType').value = project.service_type;
    if (project.flooring_type) document.getElementById('flooringType').value = project.flooring_type;
    if (project.total_sqft) document.getElementById('totalSqft').value = project.total_sqft;
    if (project.waste_percentage) document.getElementById('wastePercentage').value = project.waste_percentage;
    if (project.subfloor_type) document.getElementById('subfloorType').value = project.subfloor_type;
    if (project.level_condition) document.getElementById('levelCondition').value = project.level_condition;
    if (project.stairs_count) document.getElementById('stairsCount').value = project.stairs_count;
    if (project.rooms_count) document.getElementById('roomsCount').value = project.rooms_count;
    
    updateCalculations();
}

// Reset Waste Percentage
function resetWaste() {
    const flooringType = document.getElementById('flooringType').value;
    const defaults = {
        hardwood: 10,
        engineered: 8,
        lvp: 5,
        laminate: 7,
        tile: 12
    };
    
    const waste = defaults[flooringType] || 7;
    document.getElementById('wastePercentage').value = waste;
    updateCalculations();
}

// Update Calculations
function updateCalculations() {
    const totalSqft = parseFloat(document.getElementById('totalSqft').value) || 0;
    const wastePercent = parseFloat(document.getElementById('wastePercentage').value) || 0;
    
    const adjustedSqft = totalSqft * (1 + wastePercent / 100);
    document.getElementById('adjustedSqft').value = adjustedSqft.toFixed(2);
    
    recalculateTotals();
}

// Apply Smart Rules
async function applySmartRules() {
    const flooringType = document.getElementById('flooringType').value;
    const subfloorType = document.getElementById('subfloorType').value;
    const levelCondition = document.getElementById('levelCondition').value;
    const stairsCount = parseInt(document.getElementById('stairsCount').value) || 0;
    const totalSqft = parseFloat(document.getElementById('totalSqft').value) || 0;
    const wastePercent = parseFloat(document.getElementById('wastePercentage').value) || 0;
    
    // Remove auto-added items
    estimateItems = estimateItems.filter(item => !item.is_auto_added);
    
    const adjustedSqft = totalSqft * (1 + wastePercent / 100);
    
    // Rule: Moisture Barrier for hardwood on concrete
    if (flooringType === 'hardwood' && subfloorType === 'concrete') {
        estimateItems.push({
            category: 'material',
            name: 'Moisture Barrier',
            description: 'Barreira de umidade para piso de madeira em concreto',
            unit_type: 'sqft',
            quantity: adjustedSqft,
            unit_cost: 0.50,
            total_cost: adjustedSqft * 0.50,
            is_auto_added: true
        });
    }
    
    // Rule: Leveling Compound for major condition
    if (levelCondition === 'major' && totalSqft > 0) {
        estimateItems.push({
            category: 'material',
            name: 'Leveling Compound',
            description: 'Massa niveladora para piso irregular',
            unit_type: 'sqft',
            quantity: totalSqft,
            unit_cost: 1.25,
            total_cost: totalSqft * 1.25,
            is_auto_added: true
        });
    }
    
    // Rule: Stair Labor
    if (stairsCount > 0) {
        estimateItems.push({
            category: 'labor',
            name: 'Stair Installation',
            description: `Instalação de ${stairsCount} degrau(s)`,
            unit_type: 'stairs',
            quantity: stairsCount,
            unit_cost: 150.00,
            total_cost: stairsCount * 150.00,
            is_auto_added: true
        });
    }
    
    renderItems();
    recalculateTotals();
}

// Add Item
function addItem() {
    const category = prompt('Category (material/labor/equipment):', 'material');
    if (!category) return;
    
    const name = prompt('Item Name:');
    if (!name) return;
    
    const unitType = prompt('Unit Type (sqft/linear_ft/unit/stairs/fixed):', 'sqft');
    if (!unitType) return;
    
    const quantity = parseFloat(prompt('Quantity:', '0')) || 0;
    const unitCost = parseFloat(prompt('Unit Cost:', '0')) || 0;
    
    estimateItems.push({
        category: category.toLowerCase(),
        name: name,
        description: '',
        unit_type: unitType,
        quantity: quantity,
        unit_cost: unitCost,
        total_cost: quantity * unitCost,
        is_auto_added: false
    });
    
    renderItems();
    recalculateTotals();
}

// Render Items
function renderItems() {
    const container = document.getElementById('itemsList');
    
    if (estimateItems.length === 0) {
        container.innerHTML = '<p style="color: var(--text-muted); text-align: center; padding: var(--spacing-md);">No items added yet</p>';
        return;
    }
    
    container.innerHTML = estimateItems.map((item, index) => `
        <div class="item-card">
            <div class="item-header">
                <div>
                    <span class="item-category ${item.category}">${item.category}</span>
                    <strong style="margin-left: var(--spacing-xs);">${item.name}</strong>
                    ${item.is_auto_added ? '<span style="font-size: 0.7rem; color: var(--text-muted);">(Auto)</span>' : ''}
                </div>
                <button class="btn btn-sm" onclick="removeItem(${index})">Remove</button>
            </div>
            <div style="font-size: 0.85rem; color: var(--text-muted); margin-top: var(--spacing-xs);">
                ${item.description || ''}
            </div>
            <div style="display: flex; justify-content: space-between; margin-top: var(--spacing-xs);">
                <span>${item.quantity} ${item.unit_type} × $${item.unit_cost.toFixed(2)}</span>
                <strong>$${item.total_cost.toFixed(2)}</strong>
            </div>
            <div style="margin-top: var(--spacing-xs);">
                <button class="btn btn-sm" onclick="editItem(${index})">Edit</button>
            </div>
        </div>
    `).join('');
}

// Remove Item
function removeItem(index) {
    if (confirm('Remove this item?')) {
        estimateItems.splice(index, 1);
        renderItems();
        recalculateTotals();
    }
}

// Edit Item
function editItem(index) {
    const item = estimateItems[index];
    if (item.is_auto_added) {
        if (typeof crmNotify === 'function') crmNotify('Auto-added items cannot be edited. They will be regenerated when you change project settings.', 'info');
        else alert('Auto-added items cannot be edited. They will be regenerated when you change project settings.');
        return;
    }
    
    const quantity = parseFloat(prompt('Quantity:', item.quantity)) || 0;
    const unitCost = parseFloat(prompt('Unit Cost:', item.unit_cost)) || 0;
    
    item.quantity = quantity;
    item.unit_cost = unitCost;
    item.total_cost = quantity * unitCost;
    
    renderItems();
    recalculateTotals();
}

// Recalculate Totals
function recalculateTotals() {
    const materialTotal = estimateItems
        .filter(i => i.category === 'material')
        .reduce((sum, i) => sum + (i.total_cost || 0), 0);
    
    const laborTotal = estimateItems
        .filter(i => i.category === 'labor')
        .reduce((sum, i) => sum + (i.total_cost || 0), 0);
    
    const equipmentTotal = estimateItems
        .filter(i => i.category === 'equipment')
        .reduce((sum, i) => sum + (i.total_cost || 0), 0);
    
    const directCost = materialTotal + laborTotal + equipmentTotal;
    
    const overheadPercent = parseFloat(document.getElementById('overheadSlider').value) || 15;
    const overheadAmount = directCost * (overheadPercent / 100);
    
    const profitPercent = parseFloat(document.getElementById('profitSlider').value) || 25;
    const profitAmount = (directCost + overheadAmount) * (profitPercent / 100);
    
    const finalPrice = directCost + overheadAmount + profitAmount;
    const grossProfit = profitAmount;
    const marginPercent = directCost > 0 ? ((grossProfit / directCost) * 100) : 0;
    
    // Update UI
    document.getElementById('materialTotal').textContent = `$${materialTotal.toFixed(2)}`;
    document.getElementById('laborTotal').textContent = `$${laborTotal.toFixed(2)}`;
    document.getElementById('equipmentTotal').textContent = `$${equipmentTotal.toFixed(2)}`;
    document.getElementById('directCost').textContent = `$${directCost.toFixed(2)}`;
    document.getElementById('overheadPercent').textContent = overheadPercent;
    document.getElementById('overheadAmount').textContent = `$${overheadAmount.toFixed(2)}`;
    document.getElementById('profitPercent').textContent = profitPercent;
    document.getElementById('profitAmount').textContent = `$${profitAmount.toFixed(2)}`;
    document.getElementById('finalPrice').textContent = `$${finalPrice.toFixed(2)}`;
    document.getElementById('grossProfit').textContent = `$${grossProfit.toFixed(2)}`;
    document.getElementById('marginPercent').textContent = `${marginPercent.toFixed(1)}%`;
    document.getElementById('marginBar').style.width = `${Math.min(marginPercent, 100)}%`;
}

// Update Scenario
function updateScenario() {
    const overheadValue = document.getElementById('overheadSlider').value;
    const profitValue = document.getElementById('profitSlider').value;
    
    document.getElementById('overheadSliderValue').textContent = `${overheadValue}%`;
    document.getElementById('profitSliderValue').textContent = `${profitValue}%`;
    
    recalculateTotals();
}

// Load Estimate
async function loadEstimate(estimateId) {
    try {
        const response = await fetch(`/api/estimates/${estimateId}`, { credentials: 'include' });
        const data = await response.json();
        
        if (data.success && data.data) {
            const estimate = data.data;
            
            if (estimate.project_id) {
                document.getElementById('projectId').value = estimate.project_id;
                await loadProjectData(estimate.project_id);
            }
            
            // Load estimate items
            if (estimate.items) {
                estimateItems = estimate.items;
                renderItems();
            }
            
            // Load margins
            document.getElementById('overheadSlider').value = estimate.overhead_percentage || 15;
            document.getElementById('profitSlider').value = estimate.profit_margin_percentage || 25;
            
            updateScenario();
            recalculateTotals();
        }
    } catch (error) {
        console.error('Error loading estimate:', error);
        if (typeof crmNotify === 'function') crmNotify('Error loading estimate', 'error');
        else alert('Error loading estimate');
    }
}

// Save Estimate
async function saveEstimate() {
    const projectId = document.getElementById('projectId').value;
    const estimateId = document.getElementById('estimateId').value;
    
    if (!projectId) {
        if (typeof crmNotify === 'function') crmNotify('Please load or select a project first', 'info');
        else alert('Please load or select a project first');
        return;
    }
    
    const projectData = {
        project_type: document.getElementById('projectType').value,
        service_type: document.getElementById('serviceType').value,
        flooring_type: document.getElementById('flooringType').value,
        total_sqft: parseFloat(document.getElementById('totalSqft').value) || 0,
        waste_percentage: parseFloat(document.getElementById('wastePercentage').value) || 0,
        subfloor_type: document.getElementById('subfloorType').value,
        level_condition: document.getElementById('levelCondition').value,
        stairs_count: parseInt(document.getElementById('stairsCount').value) || 0,
        rooms_count: parseInt(document.getElementById('roomsCount').value) || 0
    };
    
    const overheadPercent = parseFloat(document.getElementById('overheadSlider').value) || 15;
    const profitPercent = parseFloat(document.getElementById('profitSlider').value) || 25;
    
    try {
        const url = estimateId ? `/api/estimates/${estimateId}` : '/api/estimates';
        const method = estimateId ? 'PUT' : 'POST';
        
        const response = await fetch(url, {
            method: method,
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
                project_id: projectId,
                project_data: projectData,
                items: estimateItems,
                overhead_percentage: overheadPercent,
                profit_margin_percentage: profitPercent
            })
        });
        
        const data = await response.json();
        
        if (data.success) {
            if (typeof crmNotify === 'function') crmNotify('Estimate saved successfully!', 'success');
            else alert('Estimate saved successfully!');
            if (!estimateId && data.data.id) {
                document.getElementById('estimateId').value = data.data.id;
                window.history.replaceState({}, '', `?estimate_id=${data.data.id}&project_id=${projectId}`);
            }
        } else {
            if (typeof crmNotify === 'function') crmNotify('Error saving estimate: ' + (data.error || 'Unknown error'), 'error');
            else alert('Error saving estimate: ' + (data.error || 'Unknown error'));
        }
    } catch (error) {
        console.error('Error saving estimate:', error);
        if (typeof crmNotify === 'function') crmNotify('Error saving estimate', 'error');
        else alert('Error saving estimate');
    }
}

// Load Project (Modal)
function loadProject() {
    const projectId = prompt('Enter Project ID:');
    if (projectId) {
        document.getElementById('projectId').value = projectId;
        loadProjectData(projectId);
    }
}
