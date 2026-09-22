/**
 * Database config - MySQL (Railway addon or external)
 * Aceita: DATABASE_URL (mysql://user:pass@host:port/db) ou DB_HOST + DB_USER + DB_PASS + DB_NAME
 */
import mysql from 'mysql2/promise';

let pool = null;

/** Ligações MySQL fechadas pelo servidor (idle) — recriar pool. */
export function isTransientMysqlError(err) {
  if (!err) return false;
  const c = err.code;
  return (
    c === 'ECONNREFUSED' ||
    c === 'ENOTFOUND' ||
    c === 'PROTOCOL_CONNECTION_LOST' ||
    c === 'ECONNRESET' ||
    c === 'ETIMEDOUT' ||
    c === 'PROTOCOL_ENQUEUE_AFTER_FATAL_ERROR' ||
    c === 'EPIPE' ||
    err.fatal === true
  );
}

/**
 * Erros de infraestrutura MySQL (pool, sessão, credenciais) — responder 503 em vez de 500 genérico.
 */
export function isMysqlInfrastructureError(err) {
  if (!err) return false;
  if (isTransientMysqlError(err)) return true;
  const c = err.code;
  if (
    c === 'ER_ACCESS_DENIED_ERROR' ||
    c === 'ER_BAD_DB_ERROR' ||
    c === 'ER_DBACCESS_DENIED_ERROR' ||
    c === 'ER_TOO_MANY_USER_CONNECTIONS'
  ) {
    return true;
  }
  const msg = String(err.message || '').toLowerCase();
  if (c === 'ER_NO_SUCH_TABLE' && msg.includes('session')) return true;
  if (msg.includes('server has gone away')) return true;
  if (msg.includes('pool is closed')) return true;
  if (msg.includes('pool is ended')) return true;
  if (msg.includes('connection lost')) return true;
  return false;
}

export async function resetDbPool() {
  if (pool) {
    try {
      await pool.end();
    } catch (_) {
      /* ignore */
    }
    pool = null;
  }
}

/**
 * mysql2 prepared statements rejeitam `undefined`; usar `null` para SQL NULL.
 * @param {unknown} values
 */
export function sanitizeMysqlBindParams(values) {
  if (values == null) return values;
  if (Array.isArray(values)) return values.map((v) => (v === undefined ? null : v));
  if (typeof values === 'object') {
    if (values instanceof Date || Buffer.isBuffer(values) || ArrayBuffer.isView(values)) return values;
    const proto = Object.getPrototypeOf(values);
    if (proto !== Object.prototype && proto !== null) return values;
    const out = { ...values };
    for (const k of Object.keys(out)) {
      if (out[k] === undefined) out[k] = null;
    }
    return out;
  }
  return values;
}

/**
 * Aplica sanitização de binds em pool ou ligação (incl. após pool.getConnection()).
 * @param {import('mysql2/promise').Pool | import('mysql2/promise').PoolConnection} dbLike
 */
function applyMysqlBindSanitizer(dbLike) {
  if (!dbLike || dbLike.__sfMysqlBindSanitizer) return dbLike;
  dbLike.__sfMysqlBindSanitizer = true;
  const origQuery = dbLike.query.bind(dbLike);
  const origExecute = dbLike.execute.bind(dbLike);

  dbLike.query = function (...args) {
    if (args.length === 0) return origQuery();
    const [sql, valOrCb, maybeCb] = args;
    if (args.length === 1 && sql && typeof sql === 'object' && sql.sql != null) {
      const o = { ...sql };
      if (o.values !== undefined) o.values = sanitizeMysqlBindParams(o.values);
      return origQuery(o);
    }
    if (args.length === 2 && typeof valOrCb === 'function') return origQuery(sql, valOrCb);
    if (args.length >= 2 && typeof valOrCb !== 'function') {
      const sanitized = sanitizeMysqlBindParams(valOrCb);
      return args.length === 2 ? origQuery(sql, sanitized) : origQuery(sql, sanitized, maybeCb);
    }
    return origQuery(...args);
  };

  dbLike.execute = function (...args) {
    if (args.length >= 2 && args[1] !== undefined) {
      const next = [...args];
      next[1] = sanitizeMysqlBindParams(next[1]);
      return origExecute(...next);
    }
    return origExecute(...args);
  };

  return dbLike;
}

/** Pool + ligações de getConnection(). */
function patchMysqlPoolBindSanitizer(p) {
  if (!p || p.__sfMysqlPoolBindPatched) return p;
  p.__sfMysqlPoolBindPatched = true;
  applyMysqlBindSanitizer(p);
  const origGetConnection = p.getConnection.bind(p);
  p.getConnection = async function () {
    const conn = await origGetConnection();
    applyMysqlBindSanitizer(conn);
    return conn;
  };
  return p;
}

export function parseDatabaseUrl(url) {
  if (!url || typeof url !== 'string') return null;
  let s = url.trim();
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    s = s.slice(1, -1).trim();
  }
  try {
    const u = s.startsWith('mysql') ? s : 'mysql://' + s.replace(/^\/\//, '');
    const parsed = new URL(u);
    return {
      host: parsed.hostname,
      port: parseInt(parsed.port) || 3306,
      user: decodeURIComponent(parsed.username || ''),
      password: decodeURIComponent(parsed.password || ''),
      database: parsed.pathname.replace(/^\//, '').replace(/\?.*$/, '') || 'railway',
    };
  } catch (_) {
    return null;
  }
}

function isLocalMysqlHost(host) {
  if (!host || typeof host !== 'string') return false;
  const h = host.trim().toLowerCase();
  return h === 'localhost' || h === '127.0.0.1' || h === '::1';
}

/** Host só resolvível na rede privada Railway — em scripts locais use host público ou DATABASE_PUBLIC_URL. */
function isRailwayInternalHost(host) {
  return typeof host === 'string' && /\.railway\.internal$/i.test(host.trim());
}

/** Node a correr no container Railway (não confundir com .env local com RAILWAY_* copiados). */
export function isLikelyRailwayAppContainer() {
  return Boolean(
    process.env.RAILWAY_REPLICA_ID ||
      process.env.RAILWAY_DEPLOYMENT_ID ||
      String(process.env.RAILWAY || '').toLowerCase() === 'true'
  );
}

export function isRailwayPublicMysqlHostname(host) {
  const h = String(host || '').trim().toLowerCase();
  return /\.up\.railway\.app$/.test(h) || /\.proxy\.rlwy\.net$/.test(h);
}

/**
 * Endpoint MySQL público da Railway costuma exigir TLS; sem isto o cliente pode falhar ou
 * em algumas redes nunca completar o handshake (timeout).
 */
export function attachRailwayPublicMysqlSsl(cfg) {
  if (!cfg || !isRailwayPublicMysqlHostname(cfg.host)) return cfg;
  return { ...cfg, ssl: { rejectUnauthorized: false } };
}

/** Variáveis do plugin MySQL no Railway (serviço Node referencia o MySQL). */
function mysqlPluginConfigFromEnv() {
  const host = process.env.MYSQLHOST || process.env.MYSQL_HOST;
  const user = process.env.MYSQLUSER || process.env.MYSQL_USER;
  const database = process.env.MYSQLDATABASE || process.env.MYSQL_DATABASE;
  if (!host?.trim() || !user?.trim() || !database?.trim()) return null;
  const password =
    process.env.MYSQLPASSWORD ||
    process.env.MYSQL_PASSWORD ||
    process.env.MYSQL_ROOT_PASSWORD ||
    '';
  return {
    host: host.trim(),
    port: parseInt(process.env.MYSQLPORT || process.env.MYSQL_PORT || '3306', 10) || 3306,
    user: user.trim(),
    password,
    database: database.trim(),
  };
}

/**
 * No container Railway, DATABASE_URL (ou DB_*) por vezes fica com hostname público *.up.railway.app,
 * que costuma dar ETIMEDOUT entre o Node e o MySQL. Preferir variáveis do plugin (MYSQLHOST=*.railway.internal)
 * ou qualquer URL cujo host seja *.railway.internal.
 */
function preferRailwayInternalMysqlOverPublicHostname(cfg) {
  if (!cfg || !isLikelyRailwayAppContainer()) return cfg;
  if (!isRailwayPublicMysqlHostname(cfg.host)) return cfg;

  const plug = mysqlPluginConfigFromEnv();
  if (plug && isRailwayInternalHost(plug.host)) {
    return {
      ...plug,
      password: plug.password !== '' ? plug.password : cfg.password,
    };
  }

  for (const key of ['DATABASE_URL', 'MYSQL_URL']) {
    const raw = process.env[key]?.trim();
    if (!raw) continue;
    const p = parseDatabaseUrl(raw);
    if (p && p.user && p.database && isRailwayInternalHost(p.host)) {
      return {
        ...p,
        password: p.password !== '' ? p.password : cfg.password,
      };
    }
  }
  return cfg;
}

/**
 * URLs MySQL válidas por ordem DATABASE_URL → DATABASE_PUBLIC_URL → MYSQL_URL (dedupe por string).
 * Fora do container Railway: prefere a primeira URL cujo host não seja *.railway.internal
 * (evita MYSQL_URL interno quando há DATABASE_PUBLIC_URL completa ou URL pública).
 */
function firstParsedMysqlUrlFromEnv() {
  const rawDbUrl = process.env.DATABASE_URL?.trim();
  const rawPublicUrl = process.env.DATABASE_PUBLIC_URL?.trim();
  const rawMysqlUrl = process.env.MYSQL_URL?.trim();
  const pairs = [
    ['DATABASE_URL', rawDbUrl],
    ['DATABASE_PUBLIC_URL', rawPublicUrl],
    ['MYSQL_URL', rawMysqlUrl],
  ];
  const seen = new Set();
  const parsedList = [];
  for (const [source, raw] of pairs) {
    if (!raw || seen.has(raw)) continue;
    seen.add(raw);
    const p = parseDatabaseUrl(raw);
    if (p && p.user && p.database) {
      parsedList.push({ source, parsed: p });
    }
  }
  if (parsedList.length === 0) return { source: null, parsed: null };
  if (!isLikelyRailwayAppContainer()) {
    for (const item of parsedList) {
      if (!isRailwayInternalHost(item.parsed.host)) {
        return { source: item.source, parsed: item.parsed };
      }
    }
  }
  return { source: parsedList[0].source, parsed: parsedList[0].parsed };
}

function isDatabaseConfigured() {
  const { parsed: fromUrl } = firstParsedMysqlUrlFromEnv();
  if (fromUrl) return true;
  if (mysqlPluginConfigFromEnv()) return true;
  const user = process.env.DB_USER || '';
  const pass = process.env.DB_PASS || '';
  const name = process.env.DB_NAME || '';
  const noPlaceholder = (s) => s && !/SEU_USUARIO|SUA_SENHA|your_db/i.test(s);
  return Boolean(
    process.env.DB_HOST?.trim() &&
      noPlaceholder(user) &&
      noPlaceholder(pass) &&
      noPlaceholder(name)
  );
}

/**
 * Config MySQL única para pool (app) e scripts (migrate).
 * Ordem: DATABASE_URL (etc.) se útil; se a URL aponta para localhost mas DB_HOST é remoto, usa DB_* (evita URL velha no shell / .env).
 * Depois DB_* ; depois MYSQLHOST / MYSQLUSER… (Railway).
 * Fora do container: se DATABASE_URL é *.railway.internal e existe DATABASE_PUBLIC_URL válida, usa a pública
 * (TCP do painel). Não substituir por MYSQLHOST (*.up.railway.app) — costuma dar ETIMEDOUT no Mac.
 * localhost → 127.0.0.1 para evitar ::1 no macOS sem listener IPv6.
 */
export function getMysqlConnectionConfig() {
  const rawDbUrl = process.env.DATABASE_URL?.trim();
  const rawPublicUrl = process.env.DATABASE_PUBLIC_URL?.trim();
  const rawMysqlUrl = process.env.MYSQL_URL?.trim();
  const url = rawDbUrl || rawPublicUrl || rawMysqlUrl;

  let fromUrl = firstParsedMysqlUrlFromEnv().parsed;

  if (
    rawDbUrl &&
    rawPublicUrl &&
    fromUrl &&
    isRailwayInternalHost(fromUrl.host) &&
    !isLikelyRailwayAppContainer()
  ) {
    const pubParsed = parseDatabaseUrl(rawPublicUrl);
    if (
      pubParsed &&
      pubParsed.user &&
      pubParsed.database &&
      !isRailwayInternalHost(pubParsed.host) &&
      !isLocalMysqlHost(pubParsed.host)
    ) {
      fromUrl = pubParsed;
    }
  }

  const hasExplicitDb =
    Boolean(process.env.DB_HOST?.trim()) &&
    Boolean(process.env.DB_USER?.trim()) &&
    Boolean(process.env.DB_NAME?.trim());

  const urlLooksLocal = fromUrl && isLocalMysqlHost(fromUrl.host);
  const urlLooksInternalRailway = fromUrl && isRailwayInternalHost(fromUrl.host);
  const dbHostStr = process.env.DB_HOST?.trim() || '';
  const preferExplicitOverLocalUrl =
    hasExplicitDb && urlLooksLocal && !isLocalMysqlHost(dbHostStr);
  /**
   * URL privada Railway + DB_HOST realmente remoto (não localhost) → usar DB_*.
   * localhost no DB_HOST não conta: é placeholder e não deve sobrepor a URL interna.
   */
  const preferExplicitOverInternalRailwayUrl =
    hasExplicitDb &&
    urlLooksInternalRailway &&
    !isRailwayInternalHost(dbHostStr) &&
    !isLocalMysqlHost(dbHostStr);

  let cfg = null;
  if (
    fromUrl &&
    fromUrl.user &&
    fromUrl.database &&
    !preferExplicitOverLocalUrl &&
    !preferExplicitOverInternalRailwayUrl
  ) {
    cfg = { ...fromUrl };
  } else if (hasExplicitDb) {
    cfg = {
      host: process.env.DB_HOST.trim(),
      port: parseInt(process.env.DB_PORT, 10) || 3306,
      user: process.env.DB_USER.trim(),
      password: process.env.DB_PASS ?? '',
      database: process.env.DB_NAME.trim(),
    };
  } else {
    cfg = mysqlPluginConfigFromEnv();
  }
  if (!cfg) return null;

  /*
   * .env local copiado do Railway: MYSQLHOST / DB_HOST = *.railway.internal não resolve no DNS do Mac/PC.
   * No painel do MySQL, a Railway expõe DATABASE_PUBLIC_URL (ou MYSQL_PUBLIC_URL) — usar para scripts locais.
   */
  if (isRailwayInternalHost(cfg.host) && !isLikelyRailwayAppContainer()) {
    const rawPublicUrl =
      process.env.DATABASE_PUBLIC_URL?.trim() ||
      process.env.MYSQL_PUBLIC_URL?.trim();
    const pubParsed = rawPublicUrl ? parseDatabaseUrl(rawPublicUrl) : null;
    if (
      pubParsed &&
      pubParsed.user &&
      pubParsed.database &&
      !isRailwayInternalHost(pubParsed.host) &&
      !isLocalMysqlHost(pubParsed.host)
    ) {
      cfg = {
        ...pubParsed,
        password:
          pubParsed.password !== undefined && pubParsed.password !== ''
            ? pubParsed.password
            : cfg.password,
      };
    }
    /**
     * .env copiado do Railway: MYSQL_URL com mysql.railway.internal mas MYSQLHOST já é o TCP público
     * (*.up.railway.app). Usar plugin quando a URL pública (DATABASE_PUBLIC_URL) está mal formatada.
     */
    if (isRailwayInternalHost(cfg.host)) {
      const plug = mysqlPluginConfigFromEnv();
      if (
        plug &&
        plug.user &&
        plug.database &&
        !isRailwayInternalHost(plug.host) &&
        !isLocalMysqlHost(plug.host)
      ) {
        cfg = {
          ...plug,
          password:
            plug.password !== undefined && plug.password !== ''
              ? plug.password
              : cfg.password,
        };
      }
    }
  }

  cfg = preferRailwayInternalMysqlOverPublicHostname(cfg);

  let h = (cfg.host || '').trim();
  if (h === 'localhost' || h === '::1') cfg = { ...cfg, host: '127.0.0.1' };

  h = (cfg.host || '').trim();
  if (h === 'localhost' || h === '::1') cfg = { ...cfg, host: '127.0.0.1' };
  return attachRailwayPublicMysqlSsl(cfg);
}

/** Para scripts (migrate): o que falta sem expor segredos. */
export function getMysqlEnvDiagnostics() {
  const rawDbUrl = process.env.DATABASE_URL?.trim();
  const rawPublicUrl = process.env.DATABASE_PUBLIC_URL?.trim();
  const rawMysqlUrl = process.env.MYSQL_URL?.trim();
  const url = rawDbUrl || rawPublicUrl || rawMysqlUrl;

  const urlLineParsesOk = (raw) => {
    if (!raw) return false;
    const p = parseDatabaseUrl(raw);
    return Boolean(p && p.user && p.database);
  };

  const first = firstParsedMysqlUrlFromEnv();
  const fromUrl = first.parsed;
  const urlLooksLocal = Boolean(fromUrl && isLocalMysqlHost(fromUrl.host));
  const urlLooksInternalRailway = Boolean(fromUrl && isRailwayInternalHost(fromUrl.host));
  const explicitOverridesParsedUrl =
    Boolean(process.env.DB_HOST?.trim()) &&
    !isRailwayInternalHost(process.env.DB_HOST) &&
    !isLocalMysqlHost(process.env.DB_HOST);
  const hasExplicitDb =
    Boolean(process.env.DB_HOST?.trim()) &&
    Boolean(process.env.DB_USER?.trim()) &&
    Boolean(process.env.DB_NAME?.trim());
  const overtakenByDbHost =
    hasExplicitDb &&
    explicitOverridesParsedUrl &&
    (urlLooksLocal || urlLooksInternalRailway);
  const pubUrlParsed = rawPublicUrl ? parseDatabaseUrl(rawPublicUrl) : null;
  const resolved = getMysqlConnectionConfig();
  return {
    urlSet: Boolean(url?.trim()),
    /** True se pelo menos uma das URLs (por ordem) faz parse válido. */
    urlParsesOk: Boolean(fromUrl),
    effectiveUrlSource: first.source,
    databaseUrlParsesOk: urlLineParsesOk(rawDbUrl),
    urlHostLocal: urlLooksLocal,
    urlHostRailwayInternal: urlLooksInternalRailway,
    urlParsedHost: fromUrl?.host ?? null,
    urlOvertakenByDbHost: overtakenByDbHost,
    databasePublicUrlSet: Boolean(rawPublicUrl),
    databasePublicUrlParsesOk: urlLineParsesOk(rawPublicUrl),
    mysqlUrlSet: Boolean(rawMysqlUrl),
    mysqlUrlParsesOk: urlLineParsesOk(rawMysqlUrl),
    databasePublicHost: pubUrlParsed?.host ?? null,
    dbHost: Boolean(process.env.DB_HOST?.trim()),
    dbHostEnv: process.env.DB_HOST?.trim() || null,
    dbUser: Boolean(process.env.DB_USER?.trim()),
    dbName: Boolean(process.env.DB_NAME?.trim()),
    dbPassSet: process.env.DB_PASS !== undefined && process.env.DB_PASS !== null,
    mysqlPluginHost: (process.env.MYSQLHOST || process.env.MYSQL_HOST)?.trim() || null,
    resolvedHost: resolved?.host ?? null,
    resolvedPort: resolved?.port ?? null,
    resolvedDatabase: resolved?.database ?? null,
  };
}

function getConfig() {
  return getMysqlConnectionConfig();
}

/** Host/port/db para logs e healthcheck (sem credenciais). */
export function getMysqlConnectionTargetInfo() {
  const cfg = getMysqlConnectionConfig();
  if (!cfg) return { configured: false, host: null, port: null, database: null };
  return {
    configured: true,
    host: cfg.host,
    port: cfg.port,
    database: cfg.database,
  };
}

/**
 * Confirma que o pool consegue uma ligação real (createPool é lazy).
 * @param {import('mysql2/promise').Pool} pool
 */
export async function verifyMysqlPoolConnectivity(pool, { attempts = 6, delayMs = 4000 } = {}) {
  if (!pool) return { ok: false, error: new Error('no_pool') };
  let lastErr = null;
  for (let i = 0; i < attempts; i++) {
    try {
      await pool.query('SELECT 1 AS ping');
      return { ok: true };
    } catch (e) {
      lastErr = e;
      console.error(`[db] MySQL ping ${i + 1}/${attempts}: ${e.code || e.message}`);
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  return { ok: false, error: lastErr };
}

async function getDBConnection() {
  if (!isDatabaseConfigured()) return null;
  if (pool) return pool;
  const config = getConfig();
  if (!config) return null;
  try {
    pool = mysql.createPool({
      ...config,
      charset: 'utf8mb4',
      supportBigNumbers: true,
      bigNumberStrings: true,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
      connectTimeout: 10000,
      enableKeepAlive: true,
      keepAliveInitialDelay: 0,
    });
    pool.on('error', (err) => {
      console.error('[DB] Pool error:', err && err.message ? err.message : err);
    });
    patchMysqlPoolBindSanitizer(pool);
    return pool;
  } catch (e) {
    console.error('DB connection error:', e.message);
    return null;
  }
}

export { isDatabaseConfigured, getDBConnection };
