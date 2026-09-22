/**
 * Financial Calculation Engine
 * Engine de cálculos financeiros e análise de lucros
 */

/**
 * Calcula custo total real
 */
export function calculateActualTotalCost(materialCost, laborCost, overhead) {
  return (parseFloat(materialCost) || 0) + 
         (parseFloat(laborCost) || 0) + 
         (parseFloat(overhead) || 0);
}

/**
 * Calcula lucro real
 */
export function calculateActualProfit(revenue, totalCost) {
  return (parseFloat(revenue) || 0) - (parseFloat(totalCost) || 0);
}

/**
 * Calcula margem percentual
 */
export function calculateMarginPercentage(revenue, profit) {
  const rev = parseFloat(revenue) || 0;
  if (rev === 0) return 0;
  return (parseFloat(profit) / rev) * 100;
}

/**
 * Calcula variação de lucro
 */
export function calculateProfitVariance(actualProfit, estimatedProfit) {
  return (parseFloat(actualProfit) || 0) - (parseFloat(estimatedProfit) || 0);
}

/**
 * Calcula variação de custo
 */
export function calculateCostVariance(actualCost, estimatedCost) {
  return (parseFloat(actualCost) || 0) - (parseFloat(estimatedCost) || 0);
}

/**
 * Calcula variação de receita
 */
export function calculateRevenueVariance(actualRevenue, estimatedRevenue) {
  return (parseFloat(actualRevenue) || 0) - (parseFloat(estimatedRevenue) || 0);
}

/**
 * Recalcula todos os valores financeiros do projeto
 */
export function recalculateProjectFinancial(financial) {
  // Calcular custo total estimado
  const estimatedTotalCost = calculateActualTotalCost(
    financial.estimated_material_cost || 0,
    financial.estimated_labor_cost || 0,
    financial.estimated_overhead || 0
  );
  
  // Calcular lucro estimado
  const estimatedProfit = calculateActualProfit(
    financial.estimated_revenue || 0,
    estimatedTotalCost
  );
  
  // Calcular margem estimada
  const estimatedMargin = calculateMarginPercentage(
    financial.estimated_revenue || 0,
    estimatedProfit
  );
  
  // Calcular custo total real
  const actualTotalCost = calculateActualTotalCost(
    financial.actual_material_cost || 0,
    financial.actual_labor_cost || 0,
    financial.actual_overhead || 0
  );
  
  // Calcular lucro real
  const actualProfit = calculateActualProfit(
    financial.actual_revenue || 0,
    actualTotalCost
  );
  
  // Calcular margem real
  const actualMargin = calculateMarginPercentage(
    financial.actual_revenue || 0,
    actualProfit
  );
  
  // Calcular variações
  const profitVariance = calculateProfitVariance(actualProfit, estimatedProfit);
  const costVariance = calculateCostVariance(actualTotalCost, estimatedTotalCost);
  const revenueVariance = calculateRevenueVariance(
    financial.actual_revenue || 0,
    financial.estimated_revenue || 0
  );
  
  return {
    estimated_total_cost: estimatedTotalCost,
    estimated_profit: estimatedProfit,
    estimated_margin_percentage: estimatedMargin,
    actual_total_cost: actualTotalCost,
    actual_profit: actualProfit,
    actual_margin_percentage: actualMargin,
    profit_variance: profitVariance,
    cost_variance: costVariance,
    revenue_variance: revenueVariance
  };
}

/**
 * Aloca despesa automaticamente
 */
export async function allocateExpense(pool, expenseId) {
  const [expenses] = await pool.query(
    'SELECT * FROM expenses WHERE id = ? AND status = ?',
    [expenseId, 'approved']
  );
  
  if (expenses.length === 0) {
    return { success: false, message: 'Expense not found or not approved' };
  }
  
  const expense = expenses[0];
  
  if (expense.project_id) {
    // Alocar para projeto específico
    await allocateToProject(pool, expense.project_id, expense);
  } else {
    // Alocar para overhead geral
    await allocateToOverhead(pool, expense);
  }
  
  return { success: true };
}

/**
 * Aloca despesa para projeto
 */
async function allocateToProject(pool, projectId, expense) {
  // Buscar ou criar financial do projeto
  let [financials] = await pool.query(
    'SELECT * FROM project_financials WHERE project_id = ?',
    [projectId]
  );
  
  if (financials.length === 0) {
    // Criar financial inicial
    await pool.execute(
      `INSERT INTO project_financials (project_id) VALUES (?)`,
      [projectId]
    );
    [financials] = await pool.query(
      'SELECT * FROM project_financials WHERE project_id = ?',
      [projectId]
    );
  }
  
  const financial = financials[0];
  const amount = parseFloat(expense.total_amount) || 0;
  
  // Alocar baseado na categoria
  let updateField = 'actual_overhead';
  if (expense.category === 'material') {
    updateField = 'actual_material_cost';
  } else if (expense.category === 'labor') {
    updateField = 'actual_labor_cost';
  }
  
  // Atualizar custo
  await pool.execute(
    `UPDATE project_financials 
     SET ${updateField} = ${updateField} + ? 
     WHERE project_id = ?`,
    [amount, projectId]
  );
  
  // Recalcular valores
  await recalculateProjectFinancialInDB(pool, projectId);
}

/**
 * Aloca despesa para overhead geral
 */
async function allocateToOverhead(pool, expense) {
  const amount = parseFloat(expense.total_amount) || 0;
  const expenseDate = new Date(expense.expense_date);
  const monthStart = new Date(expenseDate.getFullYear(), expenseDate.getMonth(), 1);
  const monthEnd = new Date(expenseDate.getFullYear(), expenseDate.getMonth() + 1, 0);
  
  // Buscar ou criar pool do mês
  let [pools] = await pool.query(
    'SELECT * FROM company_overhead_pool WHERE period_start = ? AND period_end = ?',
    [monthStart.toISOString().split('T')[0], monthEnd.toISOString().split('T')[0]]
  );
  
  if (pools.length === 0) {
    await pool.execute(
      `INSERT INTO company_overhead_pool (period_start, period_end, total_overhead)
       VALUES (?, ?, ?)`,
      [monthStart.toISOString().split('T')[0], monthEnd.toISOString().split('T')[0], amount]
    );
  } else {
    await pool.execute(
      `UPDATE company_overhead_pool 
       SET total_overhead = total_overhead + ? 
       WHERE period_start = ? AND period_end = ?`,
      [amount, monthStart.toISOString().split('T')[0], monthEnd.toISOString().split('T')[0]]
    );
  }
}

/**
 * Aloca payroll para projeto ou overhead
 */
export async function allocatePayroll(pool, payrollEntryId) {
  const [entries] = await pool.query(
    'SELECT * FROM payroll_entries WHERE id = ? AND approved = 1',
    [payrollEntryId]
  );
  
  if (entries.length === 0) {
    return { success: false, message: 'Payroll entry not found or not approved' };
  }
  
  const entry = entries[0];
  const totalCost = parseFloat(entry.total_cost) + (parseFloat(entry.overtime_cost) || 0);
  
  if (entry.project_id) {
    // Alocar para projeto
    await allocatePayrollToProject(pool, entry.project_id, totalCost);
  } else {
    // Alocar para overhead
    await allocatePayrollToOverhead(pool, entry, totalCost);
  }
  
  return { success: true };
}

/**
 * Aloca payroll para projeto
 */
async function allocatePayrollToProject(pool, projectId, cost) {
  let [financials] = await pool.query(
    'SELECT * FROM project_financials WHERE project_id = ?',
    [projectId]
  );
  
  if (financials.length === 0) {
    await pool.execute(
      `INSERT INTO project_financials (project_id) VALUES (?)`,
      [projectId]
    );
    [financials] = await pool.query(
      'SELECT * FROM project_financials WHERE project_id = ?',
      [projectId]
    );
  }
  
  await pool.execute(
    `UPDATE project_financials 
     SET actual_labor_cost = actual_labor_cost + ? 
     WHERE project_id = ?`,
    [cost, projectId]
  );
  
  await recalculateProjectFinancialInDB(pool, projectId);
}

/**
 * Aloca payroll para overhead
 */
async function allocatePayrollToOverhead(pool, entry, cost) {
  const entryDate = new Date(entry.date);
  const monthStart = new Date(entryDate.getFullYear(), entryDate.getMonth(), 1);
  const monthEnd = new Date(entryDate.getFullYear(), entryDate.getMonth() + 1, 0);
  
  let [pools] = await pool.query(
    'SELECT * FROM company_overhead_pool WHERE period_start = ? AND period_end = ?',
    [monthStart.toISOString().split('T')[0], monthEnd.toISOString().split('T')[0]]
  );
  
  if (pools.length === 0) {
    await pool.execute(
      `INSERT INTO company_overhead_pool (period_start, period_end, total_overhead)
       VALUES (?, ?, ?)`,
      [monthStart.toISOString().split('T')[0], monthEnd.toISOString().split('T')[0], cost]
    );
  } else {
    await pool.execute(
      `UPDATE company_overhead_pool 
       SET total_overhead = total_overhead + ? 
       WHERE period_start = ? AND period_end = ?`,
      [cost, monthStart.toISOString().split('T')[0], monthEnd.toISOString().split('T')[0]]
    );
  }
}

/**
 * Recalcula financial do projeto no banco
 */
export async function recalculateProjectFinancialInDB(pool, projectId) {
  const [financials] = await pool.query(
    'SELECT * FROM project_financials WHERE project_id = ?',
    [projectId]
  );
  
  if (financials.length === 0) return;
  
  const financial = financials[0];
  const recalculated = recalculateProjectFinancial(financial);
  
  await pool.execute(
    `UPDATE project_financials SET
     estimated_total_cost = ?,
     estimated_profit = ?,
     estimated_margin_percentage = ?,
     actual_total_cost = ?,
     actual_profit = ?,
     actual_margin_percentage = ?,
     profit_variance = ?,
     cost_variance = ?,
     revenue_variance = ?
     WHERE project_id = ?`,
    [
      recalculated.estimated_total_cost,
      recalculated.estimated_profit,
      recalculated.estimated_margin_percentage,
      recalculated.actual_total_cost,
      recalculated.actual_profit,
      recalculated.actual_margin_percentage,
      recalculated.profit_variance,
      recalculated.cost_variance,
      recalculated.revenue_variance,
      projectId
    ]
  );
}

/**
 * Calcula análise de lucro em tempo real
 */
export async function calculateRealTimeProfitAnalysis(pool, projectId) {
  const [financials] = await pool.query(
    'SELECT * FROM project_financials WHERE project_id = ?',
    [projectId]
  );
  
  if (financials.length === 0) {
    return null;
  }
  
  const financial = financials[0];
  const recalculated = recalculateProjectFinancial(financial);
  
  return {
    ...financial,
    ...recalculated,
    is_profitable: recalculated.actual_profit > 0,
    variance_percentage: financial.estimated_profit > 0 
      ? (recalculated.profit_variance / financial.estimated_profit) * 100 
      : 0
  };
}
