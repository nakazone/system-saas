/**
 * Completa ad_spend + marketing_goals + marketing_campaigns.
 * Idempotente: SHOW COLUMNS + ALTER só para colunas em falta. Nunca DROP TABLE.
 * Run: npm run migrate:marketing-complete
 *
 * Usa a mesma resolução de credenciais que a app (DATABASE_URL, MYSQL*, DB_*)
 * e força localhost → 127.0.0.1 para evitar ::1:3306 no macOS.
 *
 * .env prevalece sobre o terminal: ver database/load-dotenv-override.mjs
 */
import './load-dotenv-override.mjs';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mysql from 'mysql2/promise';
import {
  getMysqlConnectionConfig,
  getMysqlEnvDiagnostics,
  parseDatabaseUrl,
  isRailwayPublicMysqlHostname,
  attachRailwayPublicMysqlSsl,
} from '../config/db.js';

const MIGRATE_DIR = path.dirname(fileURLToPath(import.meta.url));
/** Mesmo caminho que database/load-dotenv-override.mjs (senior-floors-system/.env). */
const PROJECT_ENV_PATH = path.resolve(MIGRATE_DIR, '..', '.env');

function isRailwayInternalHost(host) {
  return typeof host === 'string' && /\.railway\.internal$/i.test(host.trim());
}

function isLocalMysqlHost(host) {
  const h = String(host || '')
    .trim()
    .toLowerCase();
  return h === '127.0.0.1' || h === 'localhost' || h === '::1';
}

/**
 * Variáveis que o Railway injeta no container em execução — não confiar em RAILWAY_PROJECT_ID /
 * RAILWAY_ENVIRONMENT no .env local (copiadas do painel e dão falso "estou na Railway").
 */
function isLikelyInsideRailwayContainer() {
  return Boolean(
    process.env.RAILWAY_REPLICA_ID ||
      process.env.RAILWAY_DEPLOYMENT_ID ||
      String(process.env.RAILWAY || '').toLowerCase() === 'true'
  );
}

/**
 * Host *.railway.internal só resolve dentro da rede Railway.
 * Fora do container: obrigatório DATABASE_PUBLIC_URL (URL pública) ou railway run.
 */
function resolveMysqlConfigForMigrate() {
  let cfg = getMysqlConnectionConfig();
  if (!cfg) return { cfg: null };

  if (isRailwayInternalHost(cfg.host)) {
    const pubUrl = process.env.DATABASE_PUBLIC_URL?.trim();
    if (pubUrl) {
      const pub = parseDatabaseUrl(pubUrl);
      if (pub && pub.user && pub.database && !isRailwayInternalHost(pub.host)) {
        if (isLocalMysqlHost(pub.host)) {
          console.error(
            '[migrate] DATABASE_PUBLIC_URL aponta para localhost — isso não liga à MySQL da Railway no seu Mac.'
          );
          console.error(
            '  Railway → serviço MySQL → Connect → copie a URL "Public network" (host tipo *.proxy.rlwy.net, não localhost).'
          );
          if (!isLikelyInsideRailwayContainer()) {
            return { cfg, internalOnly: true, internalHost: cfg.host };
          }
        } else {
          console.warn(
            '[migrate] Host interno Railway; a usar DATABASE_PUBLIC_URL (ligação a partir desta máquina).'
          );
          return { cfg: attachRailwayPublicMysqlSsl({ ...pub }) };
        }
      }
    }
    if (!isLikelyInsideRailwayContainer()) {
      return { cfg, internalOnly: true, internalHost: cfg.host };
    }
  }
  return { cfg };
}

async function columnExists(conn, table, column) {
  const [rows] = await conn.query(
    `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  );
  return Number(rows[0].c) > 0;
}

async function tableExists(conn, name) {
  const [t] = await conn.query('SHOW TABLES LIKE ?', [name]);
  return t && t.length > 0;
}

async function addColumn(conn, table, ddl) {
  await conn.query(`ALTER TABLE \`${table}\` ADD COLUMN ${ddl}`);
}

function envHasMysqlUrl() {
  return Boolean(
    process.env.DATABASE_URL?.trim() ||
      process.env.DATABASE_PUBLIC_URL?.trim() ||
      process.env.MYSQL_URL?.trim()
  );
}

function envHasMysqlPluginHost() {
  return Boolean(process.env.MYSQLHOST?.trim() || process.env.MYSQL_HOST?.trim());
}

/** Valores típicos do env.example — não são credenciais reais. */
function looksLikeEnvExampleCredentials(cfg) {
  const db = (cfg.database || '').toLowerCase();
  const user = (cfg.user || '').toLowerCase();
  if (db === 'your_db_name' || db === 'nome_do_banco') return true;
  if (user === 'usuario_mysql' || user === 'seu_usuario') return true;
  if (/\b(your_db|nome_do_banco|example)\b/i.test(cfg.database || '')) return true;
  return false;
}

function printIncompleteMysqlEnvHelp() {
  console.error(
    '[migrate] O .env do senior-floors-system está incompleto: não há DATABASE_URL, DATABASE_PUBLIC_URL, MYSQL_URL nem MYSQLHOST,'
  );
  console.error('  e DB_* ainda parecem o env.example (ex. DB_HOST=localhost, DB_NAME=your_db_name).');
  console.error(`  Caminho absoluto do .env carregado: ${PROJECT_ENV_PATH}`);
  if (fs.existsSync(PROJECT_ENV_PATH)) {
    console.error(
      '  O ficheiro existe — acrescente DATABASE_URL aqui (não na raiz do monorepo nem noutra pasta).'
    );
  } else {
    console.error('  Crie este ficheiro (pode copiar de .env.example) e defina DATABASE_URL.');
  }
  console.error('  Corrija um destes cenários:');
  console.error('  A) Copie do Railway → serviço MySQL → Variables a variável DATABASE_URL (referência ao MySQL) para o .env.');
  console.error('     No Mac, acrescente também DATABASE_PUBLIC_URL com a URL "Public network" / TCP (Connect), se o interno não resolver.');
  console.error('  B) Ou preencha DB_HOST (host público do painel), DB_USER, DB_PASS, DB_NAME com valores reais — não localhost nem placeholders.');
  console.error(
    '  C) Sem .env local completo: correr o migrate **no container** (rede privada Railway):'
  );
  console.error(
    '     railway ssh -s senior-floors-system -- npm run migrate:marketing-complete'
  );
  console.error(
    '     (Nota: `railway run` corre no seu Mac com env da Railway — não contorna firewall à porta 3306.)'
  );
}

function printRailwayInternalHelp(host) {
  console.error('[migrate] Host', host || 'mysql.railway.internal', 'só existe na rede privada Railway — não resolve no seu computador.');
  console.error('  Opções:');
  console.error('  1) No .env de senior-floors-system, acrescente DATABASE_PUBLIC_URL= com a URL "Public network" / TCP (MySQL → Connect).');
  console.error('     Mantenha DATABASE_URL interno se quiser; no Mac a ligação usa DATABASE_PUBLIC_URL automaticamente.');
  console.error('  2) Correr o migrate no servidor (recomendado se o WiFi bloqueia TCP 3306):');
  console.error('     railway ssh -s senior-floors-system -- npm run migrate:marketing-complete');
  console.error('  3) Ou DB_HOST + DB_USER + DB_PASS + DB_NAME com o host/porta TCP do painel (não mysql.railway.internal).');
}

async function main() {
  const resolved = resolveMysqlConfigForMigrate();
  if (resolved.internalOnly) {
    printRailwayInternalHelp(resolved.internalHost);
    console.error('  Diagnóstico:', JSON.stringify(getMysqlEnvDiagnostics(), null, 2));
    process.exit(1);
  }
  const cfg = resolved.cfg;
  if (!cfg) {
    console.error('[migrate] MySQL não configurado.');
    console.error('  Defina DATABASE_URL ou DB_HOST + DB_USER + DB_PASS + DB_NAME no .env');
    console.error('  Diagnóstico:', JSON.stringify(getMysqlEnvDiagnostics(), null, 2));
    console.error(
      '  Na Railway (dentro do container): railway ssh -s senior-floors-system -- npm run migrate:marketing-complete'
    );
    process.exit(1);
  }

  if (
    isLocalMysqlHost(cfg.host) &&
    !envHasMysqlUrl() &&
    !envHasMysqlPluginHost() &&
    looksLikeEnvExampleCredentials(cfg)
  ) {
    printIncompleteMysqlEnvHelp();
    console.error('  Diagnóstico:', JSON.stringify(getMysqlEnvDiagnostics(), null, 2));
    process.exit(1);
  }

  console.log(
    `[migrate] A ligar a ${cfg.host}:${cfg.port || 3306} (base=${cfg.database})`
  );

  let conn;
  try {
    conn = await mysql.createConnection({
      ...cfg,
      multipleStatements: true,
      connectTimeout: 30000,
    });
  } catch (e) {
    if (e?.code === 'ETIMEDOUT') {
      console.error('[migrate] Timeout (ETIMEDOUT) ao ligar a', `${cfg.host}:${cfg.port || 3306}`);
      const diag = getMysqlEnvDiagnostics();
      if (isRailwayPublicMysqlHostname(cfg.host)) {
        console.error('  MySQL público da Railway a partir do Mac: muitas redes bloqueiam saída TCP 3306 ou o host/porta do painel mudou.');
        console.error(
          '  • Melhor opção (migrate no container, rede privada Railway): railway ssh -s senior-floors-system -- npm run migrate:marketing-complete'
        );
        console.error(
          '  • `railway run` corre no seu computador com variáveis da Railway — não evita bloqueio à porta 3306.'
        );
        if (diag.urlHostRailwayInternal && !diag.databasePublicUrlSet) {
          console.error('  • Adicione DATABASE_PUBLIC_URL ao .env (URL TCP em MySQL → Connect → Public network). Com DATABASE_URL interno, o cliente usa essa URL no Mac em vez de mysql.railway.internal.');
        }
        if (diag.databasePublicUrlSet && !diag.databasePublicUrlParsesOk) {
          console.error('  • DATABASE_PUBLIC_URL não está num formato mysql:// válido — corrija no .env.');
        }
        console.error('  • MySQL → Connect → copie host e porta exatos da "Public network" / TCP proxy.');
        console.error('  • Experimente outra rede (ex. hotspot) se estiver em WiFi empresarial.');
        console.error('  • O cliente já usa SSL para *.up.railway.app / *.proxy.rlwy.net (config/db.js).');
      } else {
        console.error('  • Confirme firewall, host/porta e que o servidor MySQL aceita ligações remotas.');
      }
      console.error('  Diagnóstico:', JSON.stringify(diag, null, 2));
      process.exit(1);
    }
    if (e?.code === 'ECONNREFUSED') {
      console.error('[migrate] Ligação recusada em', `${cfg.host}:${cfg.port || 3306}`);
      if (isLocalMysqlHost(cfg.host)) {
        console.error('  Está a apontar para MySQL na sua máquina, mas nada está a escutar na porta 3306.');
        console.error('  Se a base de dados está na Railway:');
        if (!envHasMysqlUrl()) {
          console.error('  • Não há DATABASE_URL / DATABASE_PUBLIC_URL / MYSQL_URL no ambiente — copie-as do painel Railway (MySQL → Variables).');
        }
        console.error('  • No .env: DB_HOST deve ser o host público (Railway → MySQL → Connect → Public network), não localhost.');
        console.error('  • Se DATABASE_URL no terminal (export) tiver localhost, prevalece sobre o .env — faça unset DATABASE_URL ou corrija.');
        console.error('  • DATABASE_PUBLIC_URL também não pode usar localhost para a BD na Railway.');
        console.error(
          '  • Ou no container: railway ssh -s senior-floors-system -- npm run migrate:marketing-complete'
        );
        console.error('  Diagnóstico:', JSON.stringify(getMysqlEnvDiagnostics(), null, 2));
      } else {
        console.error('  • Confirme firewall / IP permitido no painel MySQL e porta', cfg.port || 3306);
        console.error(
          '  • railway ssh -s senior-floors-system -- npm run migrate:marketing-complete'
        );
        console.error('  Diagnóstico:', JSON.stringify(getMysqlEnvDiagnostics(), null, 2));
      }
      process.exit(1);
    }
    if (e?.code === 'ENOTFOUND' && isRailwayInternalHost(cfg.host)) {
      printRailwayInternalHelp(cfg.host);
      process.exit(1);
    }
    throw e;
  }

  console.log('migrate-marketing-complete…', `(host=${cfg.host}, db=${cfg.database})`);

  if (!(await tableExists(conn, 'ad_spend'))) {
    await conn.query(`
      CREATE TABLE ad_spend (
        id INT AUTO_INCREMENT PRIMARY KEY,
        platform ENUM('google_ads','meta','instagram','tiktok','other') NOT NULL DEFAULT 'other',
        campaign_name VARCHAR(255) NOT NULL DEFAULT '',
        campaign_id VARCHAR(100) NULL DEFAULT NULL,
        ad_set_name VARCHAR(255) NULL DEFAULT NULL,
        ad_name VARCHAR(255) NULL DEFAULT NULL,
        period_start DATE NULL DEFAULT NULL,
        period_end DATE NULL DEFAULT NULL,
        impressions INT NOT NULL DEFAULT 0,
        clicks INT NOT NULL DEFAULT 0,
        spend DECIMAL(10,2) NOT NULL DEFAULT 0.00,
        conversions INT NOT NULL DEFAULT 0,
        conversion_value DECIMAL(10,2) NOT NULL DEFAULT 0.00,
        reach INT NOT NULL DEFAULT 0,
        frequency DECIMAL(5,2) NOT NULL DEFAULT 0,
        video_views INT NOT NULL DEFAULT 0,
        notes TEXT NULL,
        import_source VARCHAR(50) NULL DEFAULT NULL,
        import_batch_id VARCHAR(100) NULL DEFAULT NULL,
        deleted_at TIMESTAMP NULL DEFAULT NULL,
        created_by INT NULL DEFAULT NULL,
        created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        utm_campaign VARCHAR(255) NULL DEFAULT NULL,
        spend_date DATE NULL DEFAULT NULL,
        KEY idx_ad_spend_period (period_start, period_end),
        KEY idx_ad_spend_platform (platform),
        KEY idx_ad_spend_deleted (deleted_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log('  ✓ created ad_spend (full)');
  } else {
    const cols = [
      ['campaign_id', '`campaign_id` VARCHAR(100) NULL DEFAULT NULL'],
      ['ad_set_name', '`ad_set_name` VARCHAR(255) NULL DEFAULT NULL'],
      ['ad_name', '`ad_name` VARCHAR(255) NULL DEFAULT NULL'],
      ['period_start', '`period_start` DATE NULL DEFAULT NULL'],
      ['period_end', '`period_end` DATE NULL DEFAULT NULL'],
      ['impressions', '`impressions` INT NOT NULL DEFAULT 0'],
      ['clicks', '`clicks` INT NOT NULL DEFAULT 0'],
      ['conversions', '`conversions` INT NOT NULL DEFAULT 0'],
      ['conversion_value', '`conversion_value` DECIMAL(10,2) NOT NULL DEFAULT 0.00'],
      ['reach', '`reach` INT NOT NULL DEFAULT 0'],
      ['frequency', '`frequency` DECIMAL(5,2) NOT NULL DEFAULT 0'],
      ['video_views', '`video_views` INT NOT NULL DEFAULT 0'],
      ['import_source', '`import_source` VARCHAR(50) NULL DEFAULT NULL'],
      ['import_batch_id', '`import_batch_id` VARCHAR(100) NULL DEFAULT NULL'],
      ['deleted_at', '`deleted_at` TIMESTAMP NULL DEFAULT NULL'],
      ['created_by', '`created_by` INT NULL DEFAULT NULL'],
      ['updated_at', '`updated_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'],
    ];

    for (const [name, ddl] of cols) {
      if (!(await columnExists(conn, 'ad_spend', name))) {
        await addColumn(conn, 'ad_spend', ddl);
        console.log('  + ad_spend.' + name);
      }
    }

    if ((await columnExists(conn, 'ad_spend', 'notes')) && (await columnExists(conn, 'ad_spend', 'campaign_name'))) {
      try {
        await conn.query('ALTER TABLE ad_spend MODIFY COLUMN notes TEXT NULL');
        console.log('  ~ ad_spend.notes → TEXT');
      } catch (e) {
        console.warn('  (skip notes TEXT)', e.message);
      }
    }

    if (await columnExists(conn, 'ad_spend', 'spend')) {
      try {
        await conn.query('ALTER TABLE ad_spend MODIFY COLUMN spend DECIMAL(10,2) NOT NULL DEFAULT 0.00');
      } catch (_) {}
    }

    await conn.query(`
      UPDATE ad_spend SET
        period_start = COALESCE(period_start, spend_date),
        period_end = COALESCE(period_end, spend_date)
      WHERE spend_date IS NOT NULL AND (period_start IS NULL OR period_end IS NULL)
    `);

    if (await columnExists(conn, 'ad_spend', 'platform')) {
      await conn.query(`
        UPDATE ad_spend SET platform = CASE
          WHEN LOWER(platform) LIKE '%google%' THEN 'google_ads'
          WHEN LOWER(platform) IN ('instagram','ig') THEN 'instagram'
          WHEN LOWER(platform) IN ('meta','facebook','fb') THEN 'meta'
          WHEN LOWER(platform) LIKE '%tiktok%' THEN 'tiktok'
          WHEN platform IN ('google_ads','meta','instagram','tiktok','other') THEN platform
          ELSE 'other'
        END
      `);
      try {
        await conn.query(`
          ALTER TABLE ad_spend MODIFY COLUMN platform
          ENUM('google_ads','meta','instagram','tiktok','other') NOT NULL DEFAULT 'other'
        `);
        console.log('  ~ ad_spend.platform ENUM');
      } catch (e) {
        console.warn('  (platform ENUM skipped — normalize manually)', e.message);
      }
    }
  }

  if ((await tableExists(conn, 'ad_spend')) && (await tableExists(conn, 'users')) && (await columnExists(conn, 'ad_spend', 'created_by'))) {
    try {
      await conn.query(`
        ALTER TABLE ad_spend
        ADD CONSTRAINT fk_ad_spend_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
      `);
      console.log('  ✓ ad_spend.created_by → users(id) FK');
    } catch (e) {
      if (!/Duplicate|already exists|errno: 1826|errno: 121/i.test(String(e.message || e.sqlMessage || ''))) {
        console.warn('  (skip FK ad_spend.created_by)', e.message);
      }
    }
  }

  await conn.query(`
    CREATE TABLE IF NOT EXISTS marketing_goals (
      id INT AUTO_INCREMENT PRIMARY KEY,
      month DATE NOT NULL,
      platform ENUM('google_ads','meta','instagram','tiktok','all') NOT NULL DEFAULT 'all',
      budget_limit DECIMAL(10,2) NULL DEFAULT NULL,
      goal_leads INT NULL DEFAULT NULL,
      goal_cpl_max DECIMAL(10,2) NULL DEFAULT NULL,
      goal_roas_min DECIMAL(5,2) NULL DEFAULT NULL,
      goal_cpa_max DECIMAL(10,2) NULL DEFAULT NULL,
      notes TEXT NULL,
      created_by INT NULL DEFAULT NULL,
      created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY unique_month_platform (month, platform)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  console.log('  ✓ marketing_goals');

  await conn.query(`
    CREATE TABLE IF NOT EXISTS marketing_campaigns (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      platform ENUM('google_ads','meta','instagram','tiktok','other') NOT NULL,
      status ENUM('active','paused','ended') NOT NULL DEFAULT 'active',
      budget_monthly DECIMAL(10,2) NULL DEFAULT NULL,
      start_date DATE NULL DEFAULT NULL,
      end_date DATE NULL DEFAULT NULL,
      goal ENUM('leads','awareness','conversions','traffic') NOT NULL DEFAULT 'leads',
      notes TEXT NULL,
      created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  console.log('  ✓ marketing_campaigns');

  await conn.end();
  console.log('Done.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
