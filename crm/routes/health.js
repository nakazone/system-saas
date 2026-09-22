/**
 * GET /api/health — liveness para Railway (sempre HTTP 200; BD degradada não derruba o check).
 */
import { getDBConnection } from '../config/db.js';

const DB_PING_MS = Math.min(
  5000,
  Math.max(500, parseInt(process.env.HEALTH_DB_PING_MS || '2000', 10) || 2000)
);

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(label || 'timeout')), ms)
    ),
  ]);
}

export async function getHealth(req, res) {
  const uptime = Math.round(process.uptime());
  const heapBytes = process.memoryUsage().heapUsed;
  const memory = Math.round((heapBytes / 1024 / 1024) * 100) / 100;

  let db = 'ok';
  try {
    const pool = await getDBConnection();
    if (!pool) {
      db = { error: true, message: 'Pool não disponível' };
    } else {
      await withTimeout(pool.query('SELECT 1'), DB_PING_MS, 'db ping timeout');
      db = 'ok';
    }
  } catch (e) {
    db = { error: true, message: e && e.message ? e.message : String(e) };
  }

  const status = db === 'ok' ? 'ok' : 'degraded';

  res.status(200).json({
    status,
    uptime,
    memory,
    node: process.version,
    db,
    timestamp: new Date().toISOString(),
  });
}
