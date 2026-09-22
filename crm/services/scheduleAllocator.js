/**
 * Smart Scheduling & Crew Allocation Engine
 * Sistema de alocação inteligente de equipes
 */

/**
 * Calcula dias estimados baseado na produtividade da equipe
 */
export function calculateEstimatedDays(totalSqft, crewProductivity) {
  if (!crewProductivity || crewProductivity <= 0) {
    crewProductivity = 500; // Default
  }
  return Math.ceil(totalSqft / crewProductivity);
}

/**
 * Encontra equipes disponíveis compatíveis com o tipo de piso
 */
export async function findAvailableCrews(pool, flooringType, startDate, endDate, excludeCrewId = null) {
  const crews = [];
  
  // Buscar equipes ativas compatíveis
  const [crewRows] = await pool.query(
    `SELECT c.*, 
            COALESCE(ps.avg_productivity_sqft_per_day, c.base_productivity_sqft_per_day) as productivity
     FROM crews c
     LEFT JOIN (
       SELECT crew_id, AVG(avg_productivity_sqft_per_day) as avg_productivity_sqft_per_day
       FROM crew_performance_stats
       WHERE period_end >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)
       GROUP BY crew_id
     ) ps ON c.id = ps.crew_id
     WHERE c.is_active = 1
     ${excludeCrewId ? 'AND c.id != ?' : ''}
     ORDER BY c.name`,
    excludeCrewId ? [excludeCrewId] : []
  );
  
  for (const crew of crewRows) {
    // Verificar especialização
    if (flooringType) {
      const specializations = crew.specializations ? JSON.parse(crew.specializations) : [];
      if (specializations.length > 0 && !specializations.includes(flooringType)) {
        continue; // Equipe não trabalha com este tipo de piso
      }
    }
    
    // Verificar disponibilidade no período
    const isAvailable = await checkCrewAvailability(pool, crew.id, startDate, endDate);
    
    if (isAvailable.available) {
      crews.push({
        ...crew,
        availability: isAvailable
      });
    }
  }
  
  return crews;
}

/**
 * Verifica disponibilidade da equipe em um período
 */
export async function checkCrewAvailability(pool, crewId, startDate, endDate) {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const days = Math.ceil((end - start) / (1000 * 60 * 60 * 24)) + 1;
  
  // Buscar disponibilidade no período
  const [availabilityRows] = await pool.query(
    `SELECT date, status, daily_capacity_sqft, allocated_sqft, is_overbooked
     FROM crew_availability
     WHERE crew_id = ? AND date BETWEEN ? AND ?
     ORDER BY date`,
    [crewId, startDate, endDate]
  );
  
  const availabilityMap = {};
  availabilityRows.forEach(row => {
    availabilityMap[row.date] = row;
  });
  
  let totalAvailableCapacity = 0;
  let hasUnavailableDays = false;
  let hasOverbookedDays = false;
  let continuousBlock = true;
  
  // Verificar cada dia do período
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const dateStr = d.toISOString().split('T')[0];
    const dayAvailability = availabilityMap[dateStr];
    
    if (!dayAvailability) {
      // Dia não registrado - assumir disponível com capacidade padrão
      const [crew] = await pool.query('SELECT max_daily_capacity_sqft FROM crews WHERE id = ?', [crewId]);
      const capacity = crew[0]?.max_daily_capacity_sqft || 800;
      totalAvailableCapacity += capacity;
    } else {
      if (dayAvailability.status === 'unavailable' || dayAvailability.status === 'maintenance') {
        hasUnavailableDays = true;
        continuousBlock = false;
      }
      if (dayAvailability.is_overbooked) {
        hasOverbookedDays = true;
      }
      const available = (dayAvailability.daily_capacity_sqft || 800) - (dayAvailability.allocated_sqft || 0);
      totalAvailableCapacity += Math.max(0, available);
    }
  }
  
  return {
    available: !hasUnavailableDays && continuousBlock,
    totalAvailableCapacity,
    hasOverbookedDays,
    days,
    continuousBlock
  };
}

/**
 * Simula agendamento e retorna opções ranqueadas
 */
export async function simulateSchedule(pool, projectId, totalSqft, flooringType, priority = 'normal') {
  const project = await getProjectDetails(pool, projectId);
  if (!project) {
    throw new Error('Project not found');
  }
  
  // Encontrar equipes disponíveis
  const availableCrews = await findAvailableCrews(pool, flooringType, null, null);
  
  if (availableCrews.length === 0) {
    return {
      success: false,
      message: 'No available crews found',
      options: []
    };
  }
  
  const options = [];
  const today = new Date();
  const maxDaysAhead = 90; // Buscar disponibilidade até 90 dias à frente
  
  for (const crew of availableCrews) {
    const productivity = crew.productivity || crew.base_productivity_sqft_per_day || 500;
    const estimatedDays = calculateEstimatedDays(totalSqft, productivity);
    
    // Encontrar primeiro bloco contínuo disponível
    const scheduleBlock = await findFirstAvailableBlock(
      pool,
      crew.id,
      estimatedDays,
      today,
      maxDaysAhead,
      totalSqft
    );
    
    if (scheduleBlock) {
      // Calcular métricas
      const projectedProfit = await calculateProjectedProfit(pool, crew.id, totalSqft, estimatedDays);
      const projectedMargin = projectedProfit.margin;
      const delayRisk = calculateDelayRisk(crew, estimatedDays, priority);
      const deliverySpeed = calculateDeliverySpeed(scheduleBlock.startDate, today);
      
      // Calcular score
      const score = calculateAllocationScore({
        projectedMargin,
        deliverySpeed,
        delayRisk,
        priority
      });
      
      options.push({
        crew_id: crew.id,
        crew_name: crew.name,
        start_date: scheduleBlock.startDate,
        end_date: scheduleBlock.endDate,
        estimated_days: estimatedDays,
        projected_profit: projectedProfit.amount,
        projected_margin: projectedMargin,
        delay_risk_level: delayRisk.level,
        score: score,
        productivity: productivity
      });
    }
  }
  
  // Ordenar por score (maior primeiro)
  options.sort((a, b) => b.score - a.score);
  
  // Retornar top 3
  return {
    success: true,
    options: options.slice(0, 3),
    total_options: options.length
  };
}

/**
 * Encontra primeiro bloco contínuo disponível
 */
async function findFirstAvailableBlock(pool, crewId, estimatedDays, startFrom, maxDaysAhead, totalSqft) {
  const start = new Date(startFrom);
  const end = new Date(start);
  end.setDate(end.getDate() + maxDaysAhead);
  
  // Buscar disponibilidade
  const [availabilityRows] = await pool.query(
    `SELECT date, status, daily_capacity_sqft, allocated_sqft
     FROM crew_availability
     WHERE crew_id = ? AND date BETWEEN ? AND ?
     ORDER BY date`,
    [crewId, start.toISOString().split('T')[0], end.toISOString().split('T')[0]]
  );
  
  const availabilityMap = {};
  availabilityRows.forEach(row => {
    availabilityMap[row.date] = row;
  });
  
  // Buscar capacidade padrão da equipe
  const [crewRows] = await pool.query('SELECT max_daily_capacity_sqft FROM crews WHERE id = ?', [crewId]);
  const defaultCapacity = crewRows[0]?.max_daily_capacity_sqft || 800;
  
  // Calcular sqft por dia necessário
  const dailySqftNeeded = totalSqft / estimatedDays;
  
  // Procurar bloco contínuo
  let currentBlockStart = null;
  let currentBlockDays = 0;
  
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const dateStr = d.toISOString().split('T')[0];
    const dayAvailability = availabilityMap[dateStr];
    
    let isAvailable = true;
    let availableCapacity = defaultCapacity;
    
    if (dayAvailability) {
      if (dayAvailability.status === 'unavailable' || dayAvailability.status === 'maintenance') {
        isAvailable = false;
      } else {
        availableCapacity = (dayAvailability.daily_capacity_sqft || defaultCapacity) - (dayAvailability.allocated_sqft || 0);
        if (availableCapacity < dailySqftNeeded) {
          isAvailable = false;
        }
      }
    }
    
    if (isAvailable && availableCapacity >= dailySqftNeeded) {
      if (currentBlockStart === null) {
        currentBlockStart = new Date(d);
      }
      currentBlockDays++;
      
      if (currentBlockDays >= estimatedDays) {
        const blockEnd = new Date(currentBlockStart);
        blockEnd.setDate(blockEnd.getDate() + estimatedDays - 1);
        
        return {
          startDate: currentBlockStart.toISOString().split('T')[0],
          endDate: blockEnd.toISOString().split('T')[0],
          days: estimatedDays
        };
      }
    } else {
      // Reset block
      currentBlockStart = null;
      currentBlockDays = 0;
    }
  }
  
  return null; // Nenhum bloco encontrado
}

/**
 * Calcula lucro projetado
 */
async function calculateProjectedProfit(pool, crewId, totalSqft, estimatedDays) {
  // Buscar estatísticas da equipe
  const [statsRows] = await pool.query(
    `SELECT avg_profit_margin, avg_productivity_sqft_per_day
     FROM crew_performance_stats
     WHERE crew_id = ? AND period_end >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)
     ORDER BY period_end DESC
     LIMIT 1`,
    [crewId]
  );
  
  const avgMargin = statsRows[0]?.avg_profit_margin || 25; // Default 25%
  
  // Estimativa simples - pode ser melhorada com dados reais
  const estimatedRevenue = totalSqft * 10; // $10/sqft estimado
  const profitAmount = estimatedRevenue * (avgMargin / 100);
  
  return {
    amount: profitAmount,
    margin: avgMargin
  };
}

/**
 * Calcula risco de atraso
 */
function calculateDelayRisk(crew, estimatedDays, priority) {
  let riskScore = 0;
  
  // Baseado em histórico de atrasos
  const avgDelay = crew.avg_delay_percentage || 0;
  if (avgDelay > 20) riskScore += 3;
  else if (avgDelay > 10) riskScore += 2;
  else if (avgDelay > 5) riskScore += 1;
  
  // Baseado em duração do projeto
  if (estimatedDays > 14) riskScore += 2;
  else if (estimatedDays > 7) riskScore += 1;
  
  // Baseado em prioridade
  if (priority === 'high') riskScore -= 1; // Menor risco para alta prioridade
  
  if (riskScore >= 4) return { level: 'high', score: riskScore };
  if (riskScore >= 2) return { level: 'medium', score: riskScore };
  return { level: 'low', score: riskScore };
}

/**
 * Calcula velocidade de entrega (quanto mais rápido, melhor)
 */
function calculateDeliverySpeed(startDate, today) {
  const daysUntilStart = Math.ceil((new Date(startDate) - today) / (1000 * 60 * 60 * 24));
  // Quanto mais próximo, maior o score (máximo 100)
  return Math.max(0, 100 - daysUntilStart);
}

/**
 * Calcula score de alocação
 */
function calculateAllocationScore({ projectedMargin, deliverySpeed, delayRisk, priority }) {
  // Pesos configuráveis
  const profitWeight = 0.4;
  const speedWeight = 0.3;
  const riskWeight = 0.3;
  
  // Normalizar valores
  const marginScore = projectedMargin; // Já em percentual
  const speedScore = deliverySpeed; // Já em escala 0-100
  const riskScore = delayRisk.level === 'low' ? 100 : delayRisk.level === 'medium' ? 50 : 0;
  
  // Calcular score final
  const score = (profitWeight * marginScore) + 
                (speedWeight * speedScore / 100 * 100) + 
                (riskWeight * riskScore / 100 * 100) -
                (delayRisk.score * 5); // Penalizar risco
  
  return Math.max(0, score);
}

/**
 * Obtém detalhes do projeto
 */
async function getProjectDetails(pool, projectId) {
  const [rows] = await pool.query(
    `SELECT p.*, e.final_price, e.profit_amount, e.profit_margin_percentage
     FROM projects p
     LEFT JOIN estimates e ON e.project_id = p.id AND e.status = 'accepted'
     WHERE p.id = ?`,
    [projectId]
  );
  
  return rows[0] || null;
}

/**
 * Verifica e marca sobrecarga (overbooking)
 */
export async function checkAndFlagOverbooking(pool, crewId, date, allocatedSqft) {
  const [crewRows] = await pool.query(
    'SELECT max_daily_capacity_sqft FROM crews WHERE id = ?',
    [crewId]
  );
  
  const maxCapacity = crewRows[0]?.max_daily_capacity_sqft || 800;
  const isOverbooked = allocatedSqft > maxCapacity;
  
  // Atualizar ou criar registro de disponibilidade
  await pool.query(
    `INSERT INTO crew_availability (crew_id, date, allocated_sqft, is_overbooked, status)
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       allocated_sqft = ?,
       is_overbooked = ?,
       status = CASE WHEN ? > 0 THEN 'booked' ELSE status END`,
    [
      crewId,
      date,
      allocatedSqft,
      isOverbooked ? 1 : 0,
      isOverbooked ? 'booked' : 'booked',
      allocatedSqft,
      isOverbooked ? 1 : 0,
      allocatedSqft
    ]
  );
  
  return {
    isOverbooked,
    maxCapacity,
    allocatedSqft,
    availableCapacity: maxCapacity - allocatedSqft
  };
}
