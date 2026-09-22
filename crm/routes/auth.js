/**
 * Authentication routes - Login, Logout, Session, Change password
 */
import bcrypt from 'bcryptjs';
import { getDBConnection, resetDbPool, isMysqlInfrastructureError } from '../config/db.js';
import { resolvePermissionKeysForUser } from '../lib/userPermissions.js';

/** Garante que o cookie de sessão é enviado antes da resposta JSON (evita 401 em PUT seguinte). */
function respondLoggedIn(req, res, userPayload, extra = {}) {
  req.session.save((err) => {
    if (err) {
      console.error('Session save error:', err);
      return res.status(500).json({ success: false, error: 'Could not establish session' });
    }
    res.json({ success: true, user: userPayload, ...extra });
  });
}

async function comparePassword(plain, stored) {
  if (!stored || !plain) return false;
  let ok = await bcrypt.compare(plain, stored);
  if (ok) return true;
  if (String(stored).startsWith('$2y$')) {
    const as2a = '$2a$' + String(stored).slice(4);
    ok = await bcrypt.compare(plain, as2a);
  }
  return ok;
}

/** express-session grava JSON; BigInt quebra JSON.stringify — normalizar id do MySQL. */
function sessionSafeUserId(id) {
  if (id == null) return null;
  if (typeof id === 'bigint') {
    const n = Number(id);
    return Number.isSafeInteger(n) ? n : String(id);
  }
  const n = Number(id);
  return Number.isFinite(n) ? n : id;
}

function isDbConnectivityError(e) {
  if (!e) return false;
  const c = e.code;
  return (
    c === 'ETIMEDOUT' ||
    c === 'ECONNREFUSED' ||
    c === 'PROTOCOL_CONNECTION_LOST' ||
    c === 'ECONNRESET' ||
    c === 'EPIPE' ||
    e.fatal === true
  );
}

function dbConnectivityResponse(res, code) {
  resetDbPool().catch(() => {});
  return res.status(503).json({
    success: false,
    error: 'Não foi possível ligar ao MySQL.',
    message:
      'Timeout ou ligação recusada. No Railway: serviço Node → Variables → DATABASE_URL como referência ao MySQL no mesmo projeto. Apague DB_HOST/DB_* manuais que conflitem. Teste GET /api/health/db',
    code: code || undefined,
  });
}

async function setSessionForUser(req, pool, user, columnNames, passwordField, userRole) {
  const uid = sessionSafeUserId(user.id);
  req.session.userId = uid;
  req.session.userEmail = user.email;
  req.session.userRole = userRole;
  req.session.userName = user.name;

  const hasMust = columnNames.includes('must_change_password');
  req.session.mustChangePassword = hasMust
    ? !!user.must_change_password
    : false;

  try {
    req.session.permissionKeys = await resolvePermissionKeysForUser(pool, uid, userRole);
  } catch (_) {
    req.session.permissionKeys = [];
  }
}

export async function login(req, res) {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ success: false, error: 'Email and password required' });
  }

  try {
    const pool = await getDBConnection();
    if (!pool) {
      return res.status(503).json({
        success: false,
        error: 'Database not available',
        hint:
          'No Railway: no serviço Node, defina DATABASE_URL referenciando o MySQL (ou MYSQLHOST/MYSQLUSER/MYSQLPASSWORD/MYSQLDATABASE). Teste GET /api/health/db',
      });
    }

    const [columns] = await pool.query(`SHOW COLUMNS FROM users`);
    const columnNames = columns.map((c) => c.Field);
    const hasPasswordHash = columnNames.includes('password_hash');
    const hasPassword = columnNames.includes('password');
    const hasIsActive = columnNames.includes('is_active');
    const hasActive = columnNames.includes('active');

    const passwordField = hasPasswordHash ? 'password_hash' : hasPassword ? 'password' : null;
    const activeField = hasIsActive ? 'is_active' : hasActive ? 'active' : null;

    let selectFields = 'id, name, email';
    if (columnNames.includes('role')) selectFields += ', role';
    if (activeField) selectFields += `, ${activeField}`;
    if (passwordField) selectFields += `, ${passwordField}`;
    if (columnNames.includes('must_change_password')) selectFields += ', must_change_password';

    let whereClause = 'WHERE email = ?';
    if (activeField) {
      whereClause += ` AND ${activeField} = 1`;
    }

    const [users] = await pool.query(
      `SELECT ${selectFields}
       FROM users 
       ${whereClause}
       LIMIT 1`,
      [email.toLowerCase().trim()]
    );

    if (users.length === 0) {
      return res.status(401).json({ success: false, error: 'Invalid email or password' });
    }

    const user = users[0];
    const storedPassword = passwordField ? user[passwordField] : null;
    const userRole = user.role || 'user';

    if (!storedPassword) {
      if (userRole === 'admin') {
        await setSessionForUser(req, pool, user, columnNames, passwordField, userRole);
        const payload = {
          id: sessionSafeUserId(user.id),
          name: user.name,
          email: user.email,
          role: userRole,
          must_change_password: !!req.session.mustChangePassword,
          permissions: req.session.permissionKeys || [],
        };
        return respondLoggedIn(req, res, payload, {
          message: 'Logged in (no password set - please set one)',
        });
      }
      return res.status(401).json({ success: false, error: 'Password not set for this user' });
    }

    const valid = await comparePassword(password, storedPassword);
    if (!valid) {
      return res.status(401).json({ success: false, error: 'Invalid email or password' });
    }

    await setSessionForUser(req, pool, user, columnNames, passwordField, userRole);

    try {
      if (columnNames.includes('last_login') || columnNames.includes('last_login_at')) {
        const lastLoginField = columnNames.includes('last_login_at') ? 'last_login_at' : 'last_login';
        await pool.query(`UPDATE users SET ${lastLoginField} = NOW() WHERE id = ?`, [user.id]);
      }
    } catch (e) {
      /* ignore */
    }

    const payload = {
      id: sessionSafeUserId(user.id),
      name: user.name,
      email: user.email,
      role: userRole,
      must_change_password: !!req.session.mustChangePassword,
      permissions: req.session.permissionKeys || [],
    };

    return respondLoggedIn(req, res, payload);
  } catch (error) {
    console.error('Login error:', error);
    console.error('Error stack:', error.stack);
    if (isDbConnectivityError(error)) {
      return dbConnectivityResponse(res, error.code);
    }
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message,
    });
  }
}

export async function logout(req, res) {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ success: false, error: 'Could not logout' });
    }
    res.json({ success: true, message: 'Logged out' });
  });
}

export async function checkSession(req, res) {
  try {
    if (!req.session) {
      return res.status(503).json({
        success: false,
        authenticated: false,
        error: 'session_unavailable',
        message:
          'Sessão indisponível. Confirme MySQL no Railway e a tabela `sessions` (express-mysql-session).',
      });
    }
    if (req.session.userId) {
      try {
        const pool = await getDBConnection();
        if (pool) {
          req.session.permissionKeys = await resolvePermissionKeysForUser(
            pool,
            sessionSafeUserId(req.session.userId),
            req.session.userRole
          );
        }
      } catch (_) {
        /* mantém permissionKeys já na sessão */
      }
      return res.json({
        success: true,
        authenticated: true,
        user: {
          id: sessionSafeUserId(req.session.userId),
          email: req.session.userEmail,
          role: req.session.userRole,
          name: req.session.userName,
          must_change_password: !!req.session.mustChangePassword,
          permissions: req.session.permissionKeys || [],
        },
      });
    }
    return res.json({
      success: true,
      authenticated: false,
    });
  } catch (e) {
    console.error('[auth] checkSession', e);
    if (isMysqlInfrastructureError(e)) {
      resetDbPool().catch(() => {});
      return res.status(503).json({
        success: false,
        authenticated: false,
        error: 'database',
        message: 'Base de dados temporariamente indisponível.',
      });
    }
    return res.status(500).json({
      success: false,
      authenticated: false,
      error: 'check_session_failed',
      message: 'Erro ao verificar a sessão.',
    });
  }
}

/**
 * POST { current_password, new_password } — current opcional se must_change_password (ainda exige atual por segurança)
 */
export async function changePassword(req, res) {
  try {
    if (!req.session || !req.session.userId) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }

    const newPassword = String(req.body.new_password || '').trim();
    const currentPassword = String(req.body.current_password || '').trim();

    if (!newPassword || newPassword.length < 8) {
      return res.status(400).json({
        success: false,
        error: 'A nova senha deve ter pelo menos 8 caracteres.',
      });
    }

    const pool = await getDBConnection();
    if (!pool) {
      return res.status(503).json({
        success: false,
        error: 'Database not available',
        hint:
          'No Railway: no serviço Node, defina DATABASE_URL referenciando o MySQL (ou MYSQLHOST/MYSQLUSER/MYSQLPASSWORD/MYSQLDATABASE). Teste GET /api/health/db',
      });
    }

    const [columns] = await pool.query(`SHOW COLUMNS FROM users`);
    const columnNames = columns.map((c) => c.Field);
    const passwordField = columnNames.includes('password_hash') ? 'password_hash' : 'password';
    const hasMust = columnNames.includes('must_change_password');

    let sel = `id, ${passwordField} AS pw`;
    if (hasMust) sel += ', must_change_password';

    const [users] = await pool.query(`SELECT ${sel} FROM users WHERE id = ? LIMIT 1`, [req.session.userId]);
    if (!users.length) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    const row = users[0];
    const stored = row.pw;
    if (stored) {
      if (!currentPassword) {
        return res.status(400).json({ success: false, error: 'Indique a senha atual.' });
      }
      const ok = await comparePassword(currentPassword, stored);
      if (!ok) {
        return res.status(400).json({ success: false, error: 'Senha atual incorreta.' });
      }
    }

    const hash = await bcrypt.hash(newPassword, 10);
    if (hasMust) {
      await pool.execute(`UPDATE users SET ${passwordField} = ?, must_change_password = 0 WHERE id = ?`, [
        hash,
        req.session.userId,
      ]);
    } else {
      await pool.execute(`UPDATE users SET ${passwordField} = ? WHERE id = ?`, [hash, req.session.userId]);
    }

    req.session.mustChangePassword = false;

    req.session.save((err) => {
      if (err) {
        console.error('Session save after password change:', err);
        return res.status(500).json({ success: false, error: 'Senha atualizada; falha ao gravar sessão.' });
      }
      res.json({ success: true, message: 'Senha alterada com sucesso.' });
    });
  } catch (error) {
    console.error('changePassword:', error);
    if (isDbConnectivityError(error)) {
      return dbConnectivityResponse(res, error.code);
    }
    res.status(500).json({ success: false, error: error.message });
  }
}
