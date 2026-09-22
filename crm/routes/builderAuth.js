/**
 * Builder portal authentication (JWT, separate from CRM session).
 */
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { getDBConnection } from '../config/db.js';
import { signBuilderToken } from '../lib/builderJwt.js';
import { resolveBuilderAccountManager } from '../lib/builderAccountManager.js';
import { clearBuilderAdminPasswordCopy } from '../lib/builderPortalPassword.js';
import { createPasswordResetForEmail, consumePasswordResetToken } from '../lib/builderPasswordReset.js';
import { sendBuilderNotification } from '../lib/builderNotify.js';
import { validateBuilderPortalPassword } from '../lib/builderPasswordPolicy.js';
import { requireBuilderAuth } from '../middleware/builderAuth.js';
import { getUiConfig } from './uiConfig.js';

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many login attempts. Try again in 15 minutes.' },
});

function clientIp(req) {
  return (
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.socket?.remoteAddress ||
    null
  );
}

async function logAccess(pool, builderId, req, action) {
  try {
    await pool.execute(
      `INSERT INTO builder_access_log (builder_id, ip_address, user_agent, action) VALUES (?, ?, ?, ?)`,
      [builderId, clientIp(req), String(req.headers['user-agent'] || '').slice(0, 500), action]
    );
  } catch (_) {
    /* ignore */
  }
}

export async function postLogin(req, res) {
  try {
    const email = String(req.body?.email || '')
      .trim()
      .toLowerCase();
    const password = String(req.body?.password || '');
    if (!email || !password) {
      return res.status(400).json({ success: false, error: 'Email and password required' });
    }
    const pool = await getDBConnection();
    if (!pool) return res.status(503).json({ success: false, error: 'Database not available' });

    const [rows] = await pool.query(
      `SELECT id, email, customer_id, portal_access, portal_password_hash, portal_blocked, status,
              first_name, last_name, company, portal_password_must_change
       FROM builders WHERE LOWER(email) = ? LIMIT 1`,
      [email]
    );
    const b = rows[0];
    if (!b || !b.portal_access) {
      return res.status(401).json({ success: false, error: 'Invalid credentials' });
    }
    if (b.portal_blocked || b.status === 'inactive') {
      return res.status(403).json({ success: false, error: 'Portal access disabled' });
    }
    if (!b.portal_password_hash) {
      return res.status(403).json({ success: false, error: 'Password not set. Contact Senior Floors.' });
    }
    const ok = await bcrypt.compare(password, b.portal_password_hash);
    if (!ok) {
      return res.status(401).json({ success: false, error: 'Invalid credentials' });
    }

    await pool.execute('UPDATE builders SET last_login = NOW() WHERE id = ?', [b.id]);
    await logAccess(pool, b.id, req, 'login');

    const token = signBuilderToken({
      builderId: b.id,
      email: b.email,
      customerId: b.customer_id,
    });

    res.json({
      success: true,
      data: {
        token,
        builder: {
          id: b.id,
          email: b.email,
          first_name: b.first_name,
          last_name: b.last_name,
          company: b.company,
          customer_id: b.customer_id,
          password_must_change: !!b.portal_password_must_change,
        },
      },
    });
  } catch (e) {
    console.error('builder login:', e);
    res.status(500).json({ success: false, error: e.message });
  }
}

export async function postLogout(req, res) {
  res.json({ success: true, message: 'Logged out' });
}

export async function getMe(req, res) {
  try {
    const pool = await getDBConnection();
    if (!pool) return res.status(503).json({ success: false, error: 'Database not available' });
    const [rows] = await pool.query(
      `SELECT id, customer_id, first_name, last_name, email, phone, company, website, type, status,
              regions, avg_ticket, portal_access, last_login, created_at, portal_password_must_change,
              account_manager_user_id, notification_prefs, company_logo_url
       FROM builders WHERE id = ?`,
      [req.builderAuth.builderId]
    );
    if (!rows.length) return res.status(404).json({ success: false, error: 'Builder not found' });
    const b = rows[0];
    if (b.regions && typeof b.regions === 'string') {
      try {
        b.regions = JSON.parse(b.regions);
      } catch {
        b.regions = [];
      }
    }
    delete b.portal_password_hash;

    const account_manager = await resolveBuilderAccountManager(pool, b.account_manager_user_id);

    const [docs] = await pool.query(
      `SELECT id, name, type, url, expires_at, status, created_at
       FROM builder_documents WHERE builder_id = ? ORDER BY created_at DESC`,
      [b.id]
    );

    if (b.notification_prefs && typeof b.notification_prefs === 'string') {
      try {
        b.notification_prefs = JSON.parse(b.notification_prefs);
      } catch {
        b.notification_prefs = {};
      }
    }

    res.json({
      success: true,
      data: {
        ...b,
        account_manager,
        documents: docs,
        pending_documents: docs.filter((d) => d.status !== 'valid').length,
      },
    });
  } catch (e) {
    console.error('builder me:', e);
    res.status(500).json({ success: false, error: e.message });
  }
}

export async function postChangePassword(req, res) {
  try {
    const current = String(req.body?.current_password || '');
    const next = String(req.body?.new_password || '');
    const pool = await getDBConnection();
    const [rows] = await pool.query(
      'SELECT portal_password_hash, portal_password_must_change, email, first_name FROM builders WHERE id = ?',
      [req.builderAuth.builderId]
    );
    const mustChange = !!rows[0]?.portal_password_must_change;
    if (!rows.length) {
      return res.status(404).json({ success: false, error: 'Builder not found' });
    }
    const pwErr = validateBuilderPortalPassword(next);
    if (pwErr) {
      return res.status(400).json({ success: false, error: pwErr });
    }
    if (!mustChange) {
      if (!current) {
        return res.status(400).json({ success: false, error: 'Current password required' });
      }
      if (!(await bcrypt.compare(current, rows[0].portal_password_hash))) {
        return res.status(401).json({ success: false, error: 'Current password incorrect' });
      }
    }
    const hash = await bcrypt.hash(next, 10);
    await pool.execute('UPDATE builders SET portal_password_hash = ? WHERE id = ?', [
      hash,
      req.builderAuth.builderId,
    ]);
    await clearBuilderAdminPasswordCopy(pool, req.builderAuth.builderId);
    await pool.execute('UPDATE builders SET portal_password_must_change = 0 WHERE id = ?', [
      req.builderAuth.builderId,
    ]);

    const builder = rows[0];
    if (builder?.email) {
      const pub = process.env.PUBLIC_CRM_URL || 'https://app.senior-floors.com';
      sendBuilderNotification({
        to: builder.email,
        subject: 'Your Senior Floors portal password was changed',
        html: `<p>Hi ${builder.first_name || 'there'},</p>
<p>This confirms that your Builder Portal password was changed successfully.</p>
<p>If you did not make this change, contact Senior Floors immediately at contact@seniorfloors.com.</p>
<p><a href="${pub}/builder-login.html">Sign in to the portal</a></p>`,
      }).catch((e) => console.warn('[builderAuth] password change email:', e.message));
    }

    res.json({ success: true, message: 'Password updated. A confirmation email was sent.' });
  } catch (e) {
    console.error('builder change password:', e);
    res.status(500).json({ success: false, error: e.message });
  }
}

const forgotLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: { success: false, error: 'Too many reset requests. Try again later.' },
});

export async function postForgotPassword(req, res) {
  try {
    const email = String(req.body?.email || '')
      .trim()
      .toLowerCase();
    if (!email) return res.status(400).json({ success: false, error: 'Email required' });

    const token = await createPasswordResetForEmail(email);
    const pub = (process.env.PUBLIC_CRM_URL || '').replace(/\/$/, '');
    if (token && pub) {
      const [rows] = await (
        await getDBConnection()
      ).query('SELECT first_name FROM builders WHERE LOWER(email) = ? LIMIT 1', [email]);
      const link = `${pub}/builder-reset-password.html?token=${encodeURIComponent(token)}`;
      sendBuilderNotification({
        to: email,
        subject: 'Reset your Senior Floors Builder Portal password',
        html: `<p>Hi ${rows[0]?.first_name || 'there'},</p>
          <p>We received a request to reset your portal password.</p>
          <p><a href="${link}">Reset password</a></p>
          <p>This link expires in 1 hour. If you did not request this, ignore this email.</p>`,
      }).catch(() => {});
    }
    res.json({
      success: true,
      message: 'If that email is registered, you will receive reset instructions shortly.',
    });
  } catch (e) {
    console.error('builder forgot password:', e);
    res.status(500).json({ success: false, error: e.message });
  }
}

export async function postResetPassword(req, res) {
  try {
    const token = String(req.body?.token || '').trim();
    const password = String(req.body?.password || '');
    if (!token || password.length < 8) {
      return res.status(400).json({ success: false, error: 'Token and password (8+ chars) required' });
    }
    await consumePasswordResetToken(token, password);
    res.json({ success: true, message: 'Password updated. You can sign in now.' });
  } catch (e) {
    const status = e.status || 500;
    res.status(status).json({ success: false, error: e.message });
  }
}

export async function putProfile(req, res) {
  try {
    const pool = await getDBConnection();
    const b = req.body || {};
    const sets = [];
    const vals = [];
    const allowed = [
      ['first_name', 100],
      ['last_name', 100],
      ['phone', 50],
      ['company', 255],
      ['website', 500],
      ['company_logo_url', 500],
    ];
    for (const [col, max] of allowed) {
      if (b[col] !== undefined) {
        sets.push(`\`${col}\` = ?`);
        vals.push(b[col] == null ? null : String(b[col]).slice(0, max));
      }
    }
    if (b.notification_prefs !== undefined) {
      sets.push('notification_prefs = ?');
      vals.push(JSON.stringify(b.notification_prefs || {}));
    }
    if (!sets.length) {
      return res.status(400).json({ success: false, error: 'No fields to update' });
    }
    vals.push(req.builderAuth.builderId);
    await pool.execute(`UPDATE builders SET ${sets.join(', ')} WHERE id = ?`, vals);
    return getMe(req, res);
  } catch (e) {
    console.error('builder put profile:', e);
    res.status(500).json({ success: false, error: e.message });
  }
}

export function registerBuilderAuthRoutes(app) {
  app.post('/api/builder-auth/login', loginLimiter, postLogin);
  app.post('/api/builder-auth/logout', postLogout);
  app.post('/api/builder-auth/forgot-password', forgotLimiter, postForgotPassword);
  app.post('/api/builder-auth/reset-password', postResetPassword);
  app.get('/api/builder-auth/me', requireBuilderAuth, getMe);
  app.get('/api/builder-auth/config', requireBuilderAuth, getUiConfig);
  app.put('/api/builder-auth/profile', requireBuilderAuth, putProfile);
  app.post('/api/builder-auth/change-password', requireBuilderAuth, postChangePassword);
}
