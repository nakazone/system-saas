/**
 * Users API - User management, permissões por módulo
 */
import bcrypt from 'bcryptjs';
import fs from 'fs';
import path from 'path';
import { getDBConnection } from '../config/db.js';
import { ROLE_DEFAULT_PERMISSION_KEYS, normalizeRoleForPermissions } from '../lib/userPermissions.js';
import { ensureUserModuleColumns } from '../lib/ensureUserModuleColumns.js';

function deleteLocalAvatarFile(avatarUrl) {
  if (!avatarUrl || typeof avatarUrl !== 'string') return;
  const normalized = avatarUrl.trim();
  if (!normalized.startsWith('/uploads/users/')) return;
  const rel = normalized.replace(/^\/uploads\//, '');
  const full = path.join(process.cwd(), 'uploads', rel);
  try {
    fs.unlinkSync(full);
  } catch {
    /* ignore missing file */
  }
}

/** Colunas seguras para listagem (sem password) — só as que existem na tabela */
function buildUserSelectColumns(columnNames) {
  const names = new Set(columnNames);
  const want = [
    'id',
    'name',
    'email',
    'phone',
    'avatar',
    'role',
    'is_active',
    'active',
    'must_change_password',
    'created_at',
    'updated_at',
    'last_login',
    'last_login_at',
  ];
  const pick = want.filter((w) => names.has(w));
  return pick.length ? pick.join(', ') : 'id, name, email, role';
}

async function replaceUserPermissions(pool, userId, permissionIds, grantedBy) {
  await pool.execute('DELETE FROM user_permissions WHERE user_id = ?', [userId]);
  const ids = [
    ...new Set(
      (permissionIds || []).map((x) => parseInt(x, 10)).filter((n) => Number.isFinite(n) && n > 0)
    ),
  ];
  for (const pid of ids) {
    await pool.execute(
      'INSERT INTO user_permissions (user_id, permission_id, granted, granted_by) VALUES (?, ?, 1, ?)',
      [userId, pid, grantedBy || null]
    );
  }
}

async function seedDefaultPermissionsForRole(pool, userId, role, grantedBy) {
  const keys = ROLE_DEFAULT_PERMISSION_KEYS[normalizeRoleForPermissions(role)];
  if (!keys || !keys.length) return;
  const [rows] = await pool.query(
    `SELECT id FROM permissions WHERE permission_key IN (${keys.map(() => '?').join(',')})`,
    keys
  );
  const ids = (rows || []).map((r) => r.id);
  if (ids.length) await replaceUserPermissions(pool, userId, ids, grantedBy);
}

export async function listUsers(req, res) {
  try {
    const pool = await getDBConnection();
    if (!pool) {
      return res.status(503).json({ success: false, error: 'Database not available' });
    }

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const offset = (page - 1) * limit;
    const role = req.query.role || null;
    const active = req.query.active !== undefined ? req.query.active === 'true' : null;

    let whereClause = '1=1';
    const params = [];

    if (role) {
      whereClause += ' AND role = ?';
      params.push(role);
    }
    const [columns] = await pool.query('SHOW COLUMNS FROM users');
    const columnNames = columns.map((c) => c.Field);
    if (active !== null) {
      const activeField = columnNames.includes('is_active') ? 'is_active' : 'active';
      whereClause += ` AND ${activeField} = ?`;
      params.push(active ? 1 : 0);
    }

    const selectList = buildUserSelectColumns(columnNames);
    const orderCol = columnNames.includes('created_at') ? 'created_at' : 'id';

    const [rows] = await pool.query(
      `SELECT ${selectList}
       FROM users 
       WHERE ${whereClause}
       ORDER BY ${orderCol} DESC 
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) as total FROM users WHERE ${whereClause}`,
      params
    );

    res.json({ success: true, data: rows, total, page, limit });
  } catch (error) {
    console.error('List users error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
}

export async function getUser(req, res) {
  try {
    const pool = await getDBConnection();
    if (!pool) {
      return res.status(503).json({ success: false, error: 'Database not available' });
    }

    const [colsForGet] = await pool.query('SHOW COLUMNS FROM users');
    const selectList = buildUserSelectColumns(colsForGet.map((c) => c.Field));
    const [rows] = await pool.query(`SELECT ${selectList} FROM users WHERE id = ?`, [req.params.id]);
    if (rows.length === 0) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    const user = rows[0];
    delete user.password;
    delete user.password_hash;

    res.json({ success: true, data: user });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
}

export async function getUserPermissions(req, res) {
  try {
    const pool = await getDBConnection();
    if (!pool) {
      return res.status(503).json({ success: false, error: 'Database not available' });
    }
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ success: false, error: 'Invalid id' });

    const [rows] = await pool.query(
      `SELECT up.permission_id, p.permission_key, p.permission_name, p.permission_group
       FROM user_permissions up
       INNER JOIN permissions p ON p.id = up.permission_id
       WHERE up.user_id = ? AND up.granted = 1
       ORDER BY p.permission_group, p.id`,
      [id]
    );

    res.json({
      success: true,
      data: {
        permission_ids: (rows || []).map((r) => r.permission_id),
        permissions: rows || [],
      },
    });
  } catch (error) {
    if (error.code === 'ER_NO_SUCH_TABLE') {
      return res.json({ success: true, data: { permission_ids: [], permissions: [] } });
    }
    console.error('getUserPermissions:', error);
    res.status(500).json({ success: false, error: error.message });
  }
}

export async function updateUserPermissions(req, res) {
  try {
    const pool = await getDBConnection();
    if (!pool) {
      return res.status(503).json({ success: false, error: 'Database not available' });
    }
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ success: false, error: 'Invalid id' });

    const permission_ids = req.body.permission_ids;
    if (!Array.isArray(permission_ids)) {
      return res.status(400).json({ success: false, error: 'permission_ids deve ser um array.' });
    }

    const [users] = await pool.query('SELECT id, role FROM users WHERE id = ?', [id]);
    if (!users.length) return res.status(404).json({ success: false, error: 'User not found' });

    if (String(users[0].role || '').toLowerCase() === 'admin') {
      return res.json({
        success: true,
        message: 'Administradores têm todas as permissões; matriz não aplicada.',
      });
    }

    await replaceUserPermissions(pool, id, permission_ids, req.session.userId);
    res.json({ success: true, message: 'Permissões atualizadas.' });
  } catch (error) {
    console.error('updateUserPermissions:', error);
    res.status(500).json({ success: false, error: error.message });
  }
}

export async function createUser(req, res) {
  try {
    const pool = await getDBConnection();
    if (!pool) {
      return res.status(503).json({ success: false, error: 'Database not available' });
    }
    await ensureUserModuleColumns(pool);

    const {
      name,
      email,
      phone,
      role,
      password,
      is_active,
      permission_ids,
      force_password_change,
    } = req.body;

    if (!name || !email) {
      return res.status(400).json({ success: false, error: 'Name and email are required' });
    }

    const [columns] = await pool.query(`SHOW COLUMNS FROM users`);
    const columnNames = columns.map((c) => c.Field);
    const passwordField = columnNames.includes('password_hash') ? 'password_hash' : 'password';
    const activeField = columnNames.includes('is_active') ? 'is_active' : 'active';

    const resolvedRole = role || 'sales_rep';
    let passwordHash = null;
    if (password) {
      passwordHash = await bcrypt.hash(password, 10);
    }

    const mustChange =
      columnNames.includes('must_change_password') &&
      (force_password_change === true || force_password_change === 'true' || force_password_change === 1);

    const insertCols = ['name', 'email', 'role', passwordField, activeField];
    const insertVals = [
      name,
      email.toLowerCase().trim(),
      resolvedRole,
      passwordHash,
      is_active !== undefined ? (is_active ? 1 : 0) : 1,
    ];
    if (columnNames.includes('phone')) {
      const phoneVal =
        phone == null || String(phone).trim() === '' ? null : String(phone).trim().slice(0, 50);
      insertCols.splice(2, 0, 'phone');
      insertVals.splice(2, 0, phoneVal);
    } else if (phone != null && String(phone).trim() !== '') {
      return res.status(503).json({
        success: false,
        error: 'Coluna phone em users ainda não existe. Reinicie o servidor para aplicar a migração automática.',
      });
    }
    if (columnNames.includes('must_change_password')) {
      insertCols.push('must_change_password');
      insertVals.push(mustChange ? 1 : 0);
    }

    const placeholders = insertCols.map(() => '?').join(', ');
    const [result] = await pool.execute(
      `INSERT INTO users (${insertCols.join(', ')}) VALUES (${placeholders})`,
      insertVals
    );

    const uid = result.insertId;
    const r = String(resolvedRole).toLowerCase();

    try {
      if (r !== 'admin') {
        if (Array.isArray(permission_ids) && permission_ids.length > 0) {
          await replaceUserPermissions(pool, uid, permission_ids, req.session.userId);
        } else {
          await seedDefaultPermissionsForRole(pool, uid, r, req.session.userId);
        }
      }
    } catch (pe) {
      console.warn('[users] permissões iniciais:', pe.message);
    }

    res.status(201).json({ success: true, data: { id: uid }, message: 'User created' });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ success: false, error: 'Email already exists' });
    }
    console.error('Create user error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
}

export async function updateUser(req, res) {
  try {
    const pool = await getDBConnection();
    if (!pool) {
      return res.status(503).json({ success: false, error: 'Database not available' });
    }
    await ensureUserModuleColumns(pool);

    const { name, email, phone, avatar, role, password, is_active, force_password_change } = req.body;

    const [columns] = await pool.query(`SHOW COLUMNS FROM users`);
    const columnNames = columns.map((c) => c.Field);
    const passwordField = columnNames.includes('password_hash') ? 'password_hash' : 'password';
    const activeField = columnNames.includes('is_active') ? 'is_active' : 'active';

    const updates = [];
    const values = [];

    if (name !== undefined) {
      updates.push('name = ?');
      values.push(name);
    }
    if (email !== undefined) {
      updates.push('email = ?');
      values.push(String(email).toLowerCase().trim());
    }
    if (phone !== undefined) {
      if (!columnNames.includes('phone')) {
        return res.status(503).json({
          success: false,
          error: 'Coluna phone em users ainda não existe. Reinicie o servidor para aplicar a migração automática.',
        });
      }
      const phoneVal =
        phone == null || String(phone).trim() === '' ? null : String(phone).trim().slice(0, 50);
      updates.push('phone = ?');
      values.push(phoneVal);
    }
    if (avatar !== undefined) {
      if (!columnNames.includes('avatar')) {
        return res.status(503).json({
          success: false,
          error: 'Coluna avatar em users ainda não existe. Reinicie o servidor para aplicar a migração automática.',
        });
      }
      const avatarVal =
        avatar == null || String(avatar).trim() === '' ? null : String(avatar).trim().slice(0, 500);
      if (avatarVal === null) {
        const [prevRows] = await pool.query('SELECT avatar FROM users WHERE id = ?', [req.params.id]);
        deleteLocalAvatarFile(prevRows[0]?.avatar);
      }
      updates.push('avatar = ?');
      values.push(avatarVal);
    }
    if (role !== undefined) {
      updates.push('role = ?');
      values.push(role);
    }
    if (is_active !== undefined) {
      updates.push(`${activeField} = ?`);
      values.push(is_active ? 1 : 0);
    }
    if (password) {
      const hash = await bcrypt.hash(password, 10);
      updates.push(`${passwordField} = ?`);
      values.push(hash);
    }
    if (columnNames.includes('must_change_password') && force_password_change !== undefined) {
      updates.push('must_change_password = ?');
      values.push(force_password_change === true || force_password_change === 'true' || force_password_change === 1 ? 1 : 0);
    }

    if (updates.length === 0) {
      return res.status(400).json({ success: false, error: 'No fields to update' });
    }

    values.push(req.params.id);
    await pool.execute(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, values);

    const selectList = buildUserSelectColumns(columnNames);
    const [rows] = await pool.query(`SELECT ${selectList} FROM users WHERE id = ?`, [req.params.id]);
    const user = rows[0] || null;
    if (user) {
      delete user.password;
      delete user.password_hash;
    }

    res.json({ success: true, message: 'User updated', data: user });
  } catch (error) {
    console.error('Update user error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
}

/** Upload de foto de perfil (multipart field: file) */
export async function postUserAvatar(req, res) {
  try {
    const pool = await getDBConnection();
    if (!pool) {
      return res.status(503).json({ success: false, error: 'Database not available' });
    }
    await ensureUserModuleColumns(pool);

    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ success: false, error: 'Invalid id' });
    if (!req.file) return res.status(400).json({ success: false, error: 'Ficheiro de imagem obrigatório.' });

    const [columns] = await pool.query('SHOW COLUMNS FROM users');
    const columnNames = columns.map((c) => c.Field);
    if (!columnNames.includes('avatar')) {
      return res.status(503).json({
        success: false,
        error: 'Coluna avatar em users ainda não existe. Reinicie o servidor para aplicar a migração automática.',
      });
    }

    const [users] = await pool.query('SELECT id, avatar FROM users WHERE id = ?', [id]);
    if (!users.length) return res.status(404).json({ success: false, error: 'User not found' });

    const rel = path.join('users', String(id), req.file.filename).replace(/\\/g, '/');
    const fileUrl = `/uploads/${rel}`;

    deleteLocalAvatarFile(users[0].avatar);
    await pool.execute('UPDATE users SET avatar = ? WHERE id = ?', [fileUrl, id]);

    const selectList = buildUserSelectColumns(columnNames);
    const [rows] = await pool.query(`SELECT ${selectList} FROM users WHERE id = ?`, [id]);
    const user = rows[0] || null;
    if (user) {
      delete user.password;
      delete user.password_hash;
    }

    res.json({ success: true, message: 'Foto atualizada.', data: user, avatar_url: fileUrl });
  } catch (error) {
    console.error('postUserAvatar:', error);
    res.status(500).json({ success: false, error: error.message });
  }
}

/** Desativa utilizador (soft delete) */
export async function deleteUser(req, res) {
  try {
    const pool = await getDBConnection();
    if (!pool) {
      return res.status(503).json({ success: false, error: 'Database not available' });
    }

    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ success: false, error: 'Invalid id' });
    if (id === req.session.userId) {
      return res.status(400).json({ success: false, error: 'Não pode desativar a sua própria conta.' });
    }

    const [columns] = await pool.query('SHOW COLUMNS FROM users');
    const columnNames = columns.map((c) => c.Field);
    const activeField = columnNames.includes('is_active') ? 'is_active' : 'active';

    await pool.execute(`UPDATE users SET ${activeField} = 0 WHERE id = ?`, [id]);
    res.json({ success: true, message: 'Utilizador desativado.' });
  } catch (error) {
    console.error('deleteUser:', error);
    res.status(500).json({ success: false, error: error.message });
  }
}
