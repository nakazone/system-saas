/**
 * Project Schedules API - Agendamento de projetos
 */

import { getDBConnection } from '../config/db.js';
import { isNoSuchTableError } from '../lib/mysqlSchemaErrors.js';
import {
  simulateSchedule,
  calculateEstimatedDays,
  checkAndFlagOverbooking
} from '../services/scheduleAllocator.js';
import { syncProjectScheduleById } from '../services/googleCalendarSync.js';

/**
 * Listar agendamentos
 */
export async function listSchedules(req, res) {
  try {
    const pool = await getDBConnection();
    const crewId = req.query.crew_id ? parseInt(req.query.crew_id) : null;
    const projectId = req.query.project_id ? parseInt(req.query.project_id) : null;
    const status = req.query.status || null;
    const startDate = req.query.start_date || null;
    const endDate = req.query.end_date || null;
    
    let whereClause = '1=1';
    const params = [];
    
    if (crewId) {
      whereClause += ' AND ps.crew_id = ?';
      params.push(crewId);
    }
    if (projectId) {
      whereClause += ' AND ps.project_id = ?';
      params.push(projectId);
    }
    if (status) {
      whereClause += ' AND ps.status = ?';
      params.push(status);
    }
    if (startDate) {
      whereClause += ' AND ps.start_date >= ?';
      params.push(startDate);
    }
    if (endDate) {
      whereClause += ' AND ps.end_date <= ?';
      params.push(endDate);
    }
    
    const [rows] = await pool.query(
      `SELECT ps.*,
              p.project_number, p.flooring_type, p.total_sqft as project_total_sqft,
              c.name as crew_name,
              pr.name as project_name
       FROM project_schedules ps
       JOIN projects p ON ps.project_id = p.id
       JOIN crews c ON ps.crew_id = c.id
       LEFT JOIN leads pr ON p.lead_id = pr.id
       WHERE ${whereClause}
       ORDER BY ps.start_date ASC, ps.priority DESC`,
      params
    );
    
    return res.json({ success: true, data: rows });
  } catch (error) {
    if (isNoSuchTableError(error)) {
      return res.json({ success: true, data: [] });
    }
    console.error('Error listing schedules:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
}

/**
 * Obter agendamento específico
 */
export async function getSchedule(req, res) {
  try {
    const pool = await getDBConnection();
    const scheduleId = parseInt(req.params.id);
    
    const [rows] = await pool.query(
      `SELECT ps.*,
              p.*, p.id as project_id,
              c.name as crew_name, c.specializations as crew_specializations,
              pr.name as project_name
       FROM project_schedules ps
       JOIN projects p ON ps.project_id = p.id
       JOIN crews c ON ps.crew_id = c.id
       LEFT JOIN leads pr ON p.lead_id = pr.id
       WHERE ps.id = ?`,
      [scheduleId]
    );
    
    if (rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Schedule not found' });
    }
    
    const schedule = rows[0];
    if (schedule.crew_specializations) {
      schedule.crew_specializations = JSON.parse(schedule.crew_specializations);
    }
    
    return res.json({ success: true, data: schedule });
  } catch (error) {
    console.error('Error getting schedule:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
}

/**
 * Criar agendamento
 */
export async function createSchedule(req, res) {
  try {
    const pool = await getDBConnection();
    const userId = req.session?.user?.id;
    
    const {
      project_id,
      crew_id,
      start_date,
      end_date,
      priority = 'normal',
      locked = false,
      estimate_id = null
    } = req.body;
    
    if (!project_id || !crew_id || !start_date || !end_date) {
      return res.status(400).json({ 
        success: false, 
        error: 'project_id, crew_id, start_date, and end_date are required' 
      });
    }
    
    // Buscar dados do projeto
    const [projects] = await pool.query(
      'SELECT total_sqft, flooring_type FROM projects WHERE id = ?',
      [project_id]
    );
    
    if (projects.length === 0) {
      return res.status(404).json({ success: false, error: 'Project not found' });
    }
    
    const project = projects[0];
    const totalSqft = parseFloat(project.total_sqft) || 0;
    
    // Buscar produtividade da equipe
    const [crews] = await pool.query(
      'SELECT base_productivity_sqft_per_day FROM crews WHERE id = ?',
      [crew_id]
    );
    
    if (crews.length === 0) {
      return res.status(404).json({ success: false, error: 'Crew not found' });
    }
    
    const productivity = crews[0].base_productivity_sqft_per_day || 500;
    const estimatedDays = calculateEstimatedDays(totalSqft, productivity);
    
    // Verificar sobrecarga para cada dia
    const start = new Date(start_date);
    const end = new Date(end_date);
    const dailySqft = totalSqft / estimatedDays;
    let hasOverbooking = false;
    
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const dateStr = d.toISOString().split('T')[0];
      const check = await checkAndFlagOverbooking(pool, crew_id, dateStr, dailySqft);
      if (check.isOverbooked) {
        hasOverbooking = true;
      }
    }
    
    // Criar agendamento
    const [result] = await pool.execute(
      `INSERT INTO project_schedules
       (project_id, crew_id, estimate_id, start_date, end_date, estimated_days,
        total_sqft, allocated_sqft, priority, locked, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        project_id,
        crew_id,
        estimate_id,
        start_date,
        end_date,
        estimatedDays,
        totalSqft,
        totalSqft,
        priority,
        locked ? 1 : 0,
        userId
      ]
    );
    
    const [created] = await pool.query(
      `SELECT ps.*, c.name as crew_name, p.project_number, pr.name as project_name
       FROM project_schedules ps
       JOIN crews c ON ps.crew_id = c.id
       JOIN projects p ON ps.project_id = p.id
       LEFT JOIN leads pr ON p.lead_id = pr.id
       WHERE ps.id = ?`,
      [result.insertId]
    );

    await syncProjectScheduleById(pool, result.insertId);

    return res.status(201).json({
      success: true,
      data: created[0],
      warning: hasOverbooking ? 'Schedule created but crew is overbooked on some days' : null
    });
  } catch (error) {
    console.error('Error creating schedule:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
}

/**
 * Atualizar agendamento
 */
export async function updateSchedule(req, res) {
  try {
    const pool = await getDBConnection();
    const scheduleId = parseInt(req.params.id);
    
    const {
      crew_id,
      start_date,
      end_date,
      status,
      priority,
      locked,
      actual_start_date,
      actual_end_date
    } = req.body;
    
    const updates = [];
    const values = [];
    
    if (crew_id !== undefined) {
      updates.push('crew_id = ?');
      values.push(crew_id);
    }
    if (start_date !== undefined) {
      updates.push('start_date = ?');
      values.push(start_date);
    }
    if (end_date !== undefined) {
      updates.push('end_date = ?');
      values.push(end_date);
    }
    if (status !== undefined) {
      updates.push('status = ?');
      values.push(status);
    }
    if (priority !== undefined) {
      updates.push('priority = ?');
      values.push(priority);
    }
    if (locked !== undefined) {
      updates.push('locked = ?');
      values.push(locked ? 1 : 0);
    }
    if (actual_start_date !== undefined) {
      updates.push('actual_start_date = ?');
      values.push(actual_start_date);
    }
    if (actual_end_date !== undefined) {
      updates.push('actual_end_date = ?');
      if (actual_end_date) {
        values.push(actual_end_date);
      } else {
        values.push(null);
      }
    }
    
    if (updates.length === 0) {
      return res.status(400).json({ success: false, error: 'No fields to update' });
    }
    
    values.push(scheduleId);
    await pool.execute(
      `UPDATE project_schedules SET ${updates.join(', ')} WHERE id = ?`,
      values
    );
    
    const [updated] = await pool.query(
      `SELECT ps.*, c.name as crew_name, p.project_number, pr.name as project_name
       FROM project_schedules ps
       JOIN crews c ON ps.crew_id = c.id
       JOIN projects p ON ps.project_id = p.id
       LEFT JOIN leads pr ON p.lead_id = pr.id
       WHERE ps.id = ?`,
      [scheduleId]
    );

    await syncProjectScheduleById(pool, scheduleId);

    return res.json({ success: true, data: updated[0] });
  } catch (error) {
    console.error('Error updating schedule:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
}

/**
 * Simular agendamento (retorna top 3 opções)
 */
export async function simulateScheduleOptions(req, res) {
  try {
    const pool = await getDBConnection();
    const { project_id, flooring_type, priority = 'normal' } = req.body;
    
    if (!project_id) {
      return res.status(400).json({ success: false, error: 'project_id is required' });
    }
    
    // Buscar total_sqft do projeto
    const [projects] = await pool.query('SELECT total_sqft FROM projects WHERE id = ?', [project_id]);
    if (projects.length === 0) {
      return res.status(404).json({ success: false, error: 'Project not found' });
    }
    
    const totalSqft = parseFloat(projects[0].total_sqft) || 0;
    
    const result = await simulateSchedule(pool, project_id, totalSqft, flooring_type, priority);
    
    return res.json(result);
  } catch (error) {
    console.error('Error simulating schedule:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
}

/**
 * Obter disponibilidade da equipe
 */
export async function getCrewAvailability(req, res) {
  try {
    const pool = await getDBConnection();
    const crewId = parseInt(req.params.crewId);
    const startDate = req.query.start_date || new Date().toISOString().split('T')[0];
    const endDate = req.query.end_date || new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    
    const [rows] = await pool.query(
      `SELECT date, status, daily_capacity_sqft, allocated_sqft, is_overbooked
       FROM crew_availability
       WHERE crew_id = ? AND date BETWEEN ? AND ?
       ORDER BY date`,
      [crewId, startDate, endDate]
    );
    
    // Buscar capacidade padrão
    const [crews] = await pool.query('SELECT max_daily_capacity_sqft FROM crews WHERE id = ?', [crewId]);
    const defaultCapacity = crews[0]?.max_daily_capacity_sqft || 800;
    
    return res.json({ 
      success: true, 
      data: rows,
      default_capacity: defaultCapacity
    });
  } catch (error) {
    console.error('Error getting crew availability:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
}
