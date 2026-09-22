/**
 * Crews API - Gerenciamento de equipes
 */

import { getDBConnection } from '../config/db.js';
import { isNoSuchTableError } from '../lib/mysqlSchemaErrors.js';

export async function listCrews(req, res) {
  try {
    const pool = await getDBConnection();
    const active = req.query.active !== undefined ? req.query.active === 'true' : null;
    
    let whereClause = '1=1';
    const params = [];
    
    if (active !== null) {
      whereClause += ' AND c.is_active = ?';
      params.push(active ? 1 : 0);
    }
    
    const [rows] = await pool.query(
      `SELECT c.*, 
              u.name as crew_leader_name,
              COALESCE(ps.avg_productivity_sqft_per_day, c.base_productivity_sqft_per_day) as current_productivity,
              COALESCE(ps.avg_delay_percentage, 0) as avg_delay_percentage,
              COALESCE(ps.avg_profit_margin, 0) as avg_profit_margin,
              COALESCE(ps.projects_completed, 0) as projects_completed
       FROM crews c
       LEFT JOIN users u ON c.crew_leader_id = u.id
       LEFT JOIN (
         SELECT crew_id, 
                AVG(avg_productivity_sqft_per_day) as avg_productivity_sqft_per_day,
                AVG(avg_delay_percentage) as avg_delay_percentage,
                AVG(avg_profit_margin) as avg_profit_margin,
                SUM(projects_completed) as projects_completed
         FROM crew_performance_stats
         WHERE period_end >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)
         GROUP BY crew_id
       ) ps ON c.id = ps.crew_id
       WHERE ${whereClause}
       ORDER BY c.name`,
      params
    );
    
    // Parse JSON fields
    rows.forEach(row => {
      if (row.crew_members) row.crew_members = JSON.parse(row.crew_members);
      if (row.specializations) row.specializations = JSON.parse(row.specializations);
    });
    
    return res.json({ success: true, data: rows });
  } catch (error) {
    if (isNoSuchTableError(error)) {
      return res.json({ success: true, data: [] });
    }
    console.error('Error listing crews:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
}

export async function getCrew(req, res) {
  try {
    const pool = await getDBConnection();
    const crewId = parseInt(req.params.id);
    
    const [rows] = await pool.query(
      `SELECT c.*, u.name as crew_leader_name
       FROM crews c
       LEFT JOIN users u ON c.crew_leader_id = u.id
       WHERE c.id = ?`,
      [crewId]
    );
    
    if (rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Crew not found' });
    }
    
    const crew = rows[0];
    if (crew.crew_members) crew.crew_members = JSON.parse(crew.crew_members);
    if (crew.specializations) crew.specializations = JSON.parse(crew.specializations);
    
    return res.json({ success: true, data: crew });
  } catch (error) {
    console.error('Error getting crew:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
}

export async function createCrew(req, res) {
  try {
    const pool = await getDBConnection();
    const {
      name,
      crew_leader_id,
      crew_members,
      specializations,
      base_productivity_sqft_per_day,
      max_daily_capacity_sqft,
      hourly_rate,
      is_active = true
    } = req.body;
    
    if (!name) {
      return res.status(400).json({ success: false, error: 'Name is required' });
    }
    
    const [result] = await pool.execute(
      `INSERT INTO crews 
       (name, crew_leader_id, crew_members, specializations, base_productivity_sqft_per_day, 
        max_daily_capacity_sqft, hourly_rate, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        name,
        crew_leader_id || null,
        crew_members ? JSON.stringify(crew_members) : null,
        specializations ? JSON.stringify(specializations) : null,
        base_productivity_sqft_per_day || 500,
        max_daily_capacity_sqft || 800,
        hourly_rate || null,
        is_active ? 1 : 0
      ]
    );
    
    const [created] = await pool.query('SELECT * FROM crews WHERE id = ?', [result.insertId]);
    const crew = created[0];
    if (crew.crew_members) crew.crew_members = JSON.parse(crew.crew_members);
    if (crew.specializations) crew.specializations = JSON.parse(crew.specializations);
    
    return res.status(201).json({ success: true, data: crew });
  } catch (error) {
    console.error('Error creating crew:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
}

export async function updateCrew(req, res) {
  try {
    const pool = await getDBConnection();
    const crewId = parseInt(req.params.id);
    const updates = req.body;
    
    const allowedFields = [
      'name', 'crew_leader_id', 'crew_members', 'specializations',
      'base_productivity_sqft_per_day', 'max_daily_capacity_sqft',
      'hourly_rate', 'is_active', 'notes'
    ];
    
    const setClauses = [];
    const values = [];
    
    for (const field of allowedFields) {
      if (updates[field] !== undefined) {
        if (field === 'crew_members' || field === 'specializations') {
          setClauses.push(`\`${field}\` = ?`);
          values.push(JSON.stringify(updates[field]));
        } else {
          setClauses.push(`\`${field}\` = ?`);
          values.push(updates[field]);
        }
      }
    }
    
    if (setClauses.length === 0) {
      return res.status(400).json({ success: false, error: 'No fields to update' });
    }
    
    values.push(crewId);
    await pool.execute(
      `UPDATE crews SET ${setClauses.join(', ')} WHERE id = ?`,
      values
    );
    
    const [updated] = await pool.query('SELECT * FROM crews WHERE id = ?', [crewId]);
    const crew = updated[0];
    if (crew.crew_members) crew.crew_members = JSON.parse(crew.crew_members);
    if (crew.specializations) crew.specializations = JSON.parse(crew.specializations);
    
    return res.json({ success: true, data: crew });
  } catch (error) {
    console.error('Error updating crew:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
}
