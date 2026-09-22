import { createHmac, timingSafeEqual } from 'crypto';

const DEFAULT_TTL_SEC = 8 * 60 * 60; // 8h

function secret() {
  return (
    process.env.BUILDER_JWT_SECRET ||
    process.env.SESSION_SECRET ||
    'change-builder-jwt-secret-in-production'
  );
}

function b64urlEncode(obj) {
  return Buffer.from(JSON.stringify(obj)).toString('base64url');
}

function b64urlDecode(str) {
  return JSON.parse(Buffer.from(str, 'base64url').toString('utf8'));
}

/** @param {{ builderId: number, email: string, customerId?: number|null }} payload */
export function signBuilderToken(payload, ttlSec = DEFAULT_TTL_SEC) {
  const header = b64urlEncode({ alg: 'HS256', typ: 'JWT' });
  const body = b64urlEncode({
    sub: String(payload.builderId),
    email: payload.email,
    customerId: payload.customerId ?? null,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + ttlSec,
  });
  const data = `${header}.${body}`;
  const sig = createHmac('sha256', secret()).update(data).digest('base64url');
  return `${data}.${sig}`;
}

export function verifyBuilderToken(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, body, sig] = parts;
  const data = `${header}.${body}`;
  const expected = createHmac('sha256', secret()).update(data).digest('base64url');
  try {
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }
  let decoded;
  try {
    decoded = b64urlDecode(body);
  } catch {
    return null;
  }
  if (!decoded.exp || decoded.exp < Math.floor(Date.now() / 1000)) return null;
  const builderId = parseInt(decoded.sub, 10);
  if (!Number.isFinite(builderId)) return null;
  return {
    builderId,
    email: decoded.email,
    customerId: decoded.customerId != null ? Number(decoded.customerId) : null,
  };
}

export function randomTempPassword(len = 12) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$';
  let out = '';
  for (let i = 0; i < len; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}
