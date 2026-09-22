import crypto from 'crypto';
import { getDBConnection } from '../config/db.js';

async function tableExists(pool, name) {
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS c FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [name]
  );
  return Number(rows[0]?.c) > 0;
}

export function hashResetToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

export function generateResetToken() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * @returns {Promise<string|null>} plain token or null if email not found / no portal
 */
export async function createPasswordResetForEmail(email) {
  const pool = await getDBConnection();
  if (!pool || !(await tableExists(pool, 'builder_password_resets'))) return null;

  const normalized = String(email || '')
    .trim()
    .toLowerCase();
  if (!normalized) return null;

  const [rows] = await pool.query(
    `SELECT id, portal_access, portal_blocked, status FROM builders WHERE LOWER(email) = ? LIMIT 1`,
    [normalized]
  );
  const b = rows[0];
  if (!b || !b.portal_access || b.portal_blocked || b.status === 'inactive') {
    return null;
  }

  const token = generateResetToken();
  const tokenHash = hashResetToken(token);
  const expires = new Date(Date.now() + 60 * 60 * 1000);

  await pool.execute(
    `UPDATE builder_password_resets SET used_at = NOW()
     WHERE builder_id = ? AND used_at IS NULL`,
    [b.id]
  );
  await pool.execute(
    `INSERT INTO builder_password_resets (builder_id, token_hash, expires_at) VALUES (?, ?, ?)`,
    [b.id, tokenHash, expires]
  );

  return token;
}

export async function consumePasswordResetToken(plainToken, newPassword) {
  const pool = await getDBConnection();
  if (!pool) throw new Error('Database not available');
  const tokenHash = hashResetToken(plainToken);
  const [rows] = await pool.query(
    `SELECT r.id, r.builder_id, r.expires_at, r.used_at
     FROM builder_password_resets r
     WHERE r.token_hash = ? LIMIT 1`,
    [tokenHash]
  );
  const row = rows[0];
  if (!row || row.used_at) {
    const err = new Error('Invalid or expired reset link');
    err.status = 400;
    throw err;
  }
  if (new Date(row.expires_at) < new Date()) {
    const err = new Error('Reset link has expired');
    err.status = 400;
    throw err;
  }

  const bcrypt = (await import('bcryptjs')).default;
  const hash = await bcrypt.hash(String(newPassword), 10);
  await pool.execute(
    `UPDATE builders SET portal_password_hash = ?, portal_password_must_change = 0, portal_admin_password = NULL WHERE id = ?`,
    [hash, row.builder_id]
  );
  await pool.execute('UPDATE builder_password_resets SET used_at = NOW() WHERE id = ?', [row.id]);
  return row.builder_id;
}
