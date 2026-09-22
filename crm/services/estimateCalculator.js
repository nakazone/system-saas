/**
 * Estimate Calculation Engine
 * Lógica de negócio para cálculos de estimativas
 */

/**
 * Calcula metragem ajustada com desperdício
 */
export function calculateAdjustedSqft(totalSqft, wastePercentage) {
  if (!totalSqft || totalSqft <= 0) return 0;
  const waste = wastePercentage || 0;
  return totalSqft * (1 + waste / 100);
}

/**
 * Obtém percentual de desperdício padrão por tipo de piso
 */
export function getDefaultWastePercentage(flooringType) {
  const defaults = {
    hardwood: 10,
    engineered: 8,
    lvp: 5,
    laminate: 7,
    tile: 12
  };
  return defaults[flooringType?.toLowerCase()] || 7;
}

/**
 * Calcula custo total de uma categoria de itens
 */
export function calculateCategoryTotal(items, category) {
  if (!items || !Array.isArray(items)) return 0;
  return items
    .filter(item => item.category === category)
    .reduce((sum, item) => sum + (parseFloat(item.total_cost) || 0), 0);
}

/**
 * Calcula custo direto (material + labor + equipment)
 */
export function calculateDirectCost(materialTotal, laborTotal, equipmentTotal) {
  return (parseFloat(materialTotal) || 0) + 
         (parseFloat(laborTotal) || 0) + 
         (parseFloat(equipmentTotal) || 0);
}

/**
 * Calcula overhead
 */
export function calculateOverhead(directCost, overheadPercentage) {
  const direct = parseFloat(directCost) || 0;
  const percentage = parseFloat(overheadPercentage) || 0;
  return direct * (percentage / 100);
}

/**
 * Calcula lucro
 */
export function calculateProfit(directCost, overhead, profitMarginPercentage) {
  const direct = parseFloat(directCost) || 0;
  const overheadAmount = parseFloat(overhead) || 0;
  const percentage = parseFloat(profitMarginPercentage) || 0;
  return (direct + overheadAmount) * (percentage / 100);
}

/**
 * Calcula preço final
 */
export function calculateFinalPrice(directCost, overhead, profit) {
  return (parseFloat(directCost) || 0) + 
         (parseFloat(overhead) || 0) + 
         (parseFloat(profit) || 0);
}

/**
 * Aplica regras inteligentes e adiciona itens automaticamente
 */
export async function applySmartRules(pool, projectData, estimateItems = []) {
  const autoItems = [];
  
  // Regra: Moisture Barrier para hardwood em concreto
  if (projectData.flooring_type === 'hardwood' && projectData.subfloor_type === 'concrete') {
    const adjustedSqft = calculateAdjustedSqft(
      projectData.total_sqft,
      projectData.waste_percentage || getDefaultWastePercentage(projectData.flooring_type)
    );
    
    autoItems.push({
      category: 'material',
      name: 'Moisture Barrier',
      description: 'Barreira de umidade para piso de madeira em concreto',
      unit_type: 'sqft',
      quantity: adjustedSqft,
      unit_cost: 0.50,
      total_cost: adjustedSqft * 0.50,
      is_auto_added: true,
      sort_order: 1
    });
  }
  
  // Regra: Leveling Compound para condições ruins
  if (projectData.level_condition === 'major') {
    autoItems.push({
      category: 'material',
      name: 'Leveling Compound',
      description: 'Massa niveladora para piso irregular',
      unit_type: 'sqft',
      quantity: projectData.total_sqft || 0,
      unit_cost: 1.25,
      total_cost: (projectData.total_sqft || 0) * 1.25,
      is_auto_added: true,
      sort_order: 2
    });
  }
  
  // Regra: Stair Labor
  if (projectData.stairs_count > 0) {
    autoItems.push({
      category: 'labor',
      name: 'Stair Installation',
      description: `Instalação de ${projectData.stairs_count} degrau(s)`,
      unit_type: 'stairs',
      quantity: projectData.stairs_count,
      unit_cost: 150.00,
      total_cost: projectData.stairs_count * 150.00,
      is_auto_added: true,
      sort_order: 3
    });
  }
  
  return autoItems;
}

/**
 * Recalcula todos os valores da estimativa baseado nos itens
 */
export function recalculateEstimate(estimateItems = [], overheadPercentage = 0, profitMarginPercentage = 0) {
  // Calcular totais por categoria
  const materialTotal = calculateCategoryTotal(estimateItems, 'material');
  const laborTotal = calculateCategoryTotal(estimateItems, 'labor');
  const equipmentTotal = calculateCategoryTotal(estimateItems, 'equipment');
  
  // Calcular custo direto
  const directCost = calculateDirectCost(materialTotal, laborTotal, equipmentTotal);
  
  // Calcular overhead
  const overheadAmount = calculateOverhead(directCost, overheadPercentage);
  
  // Calcular lucro
  const profitAmount = calculateProfit(directCost, overheadAmount, profitMarginPercentage);
  
  // Calcular preço final
  const finalPrice = calculateFinalPrice(directCost, overheadAmount, profitAmount);
  
  return {
    material_cost_total: materialTotal,
    labor_cost_total: laborTotal,
    equipment_cost_total: equipmentTotal,
    direct_cost: directCost,
    overhead_percentage: parseFloat(overheadPercentage) || 0,
    overhead_amount: overheadAmount,
    profit_margin_percentage: parseFloat(profitMarginPercentage) || 0,
    profit_amount: profitAmount,
    final_price: finalPrice
  };
}

/**
 * Gera número de estimativa único
 */
export async function generateEstimateNumber(pool) {
  const year = new Date().getFullYear();
  const [rows] = await pool.query(
    'SELECT COUNT(*) as count FROM estimates WHERE estimate_number LIKE ?',
    [`EST-${year}-%`]
  );
  const count = rows[0]?.count || 0;
  const nextNumber = String(count + 1).padStart(3, '0');
  return `EST-${year}-${nextNumber}`;
}

/**
 * Calcula margem de lucro percentual
 */
export function calculateMarginPercentage(finalPrice, directCost, overhead) {
  const totalCost = (parseFloat(directCost) || 0) + (parseFloat(overhead) || 0);
  if (totalCost === 0) return 0;
  const profit = (parseFloat(finalPrice) || 0) - totalCost;
  return (profit / totalCost) * 100;
}
