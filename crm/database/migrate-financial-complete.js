/**
 * Módulo financeiro completo: vendors, operational_costs, payment_receipts, weekly_forecast + colunas em expenses.
 * Idempotente. Nunca DROP. Run: npm run migrate:financial-complete
 * (O mesmo DDL corre no arranque da API — ver lib/ensureFinancialCompleteSchema.js.)
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import mysql from 'mysql2/promise';
import { getMysqlConnectionConfig, getMysqlEnvDiagnostics } from '../config/db.js';
import { ensureFinancialCompleteSchema } from '../lib/ensureFinancialCompleteSchema.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(__dirname, '..', '.env');
const envInjectedByRailway =
  Boolean(process.env.RAILWAY_PROJECT_ID) ||
  Boolean(process.env.MYSQL_URL?.trim()) ||
  Boolean(process.env.MYSQLHOST?.trim());
if (!envInjectedByRailway) {
  dotenv.config({ path: envPath, override: true });
}

async function logIntrospection(conn) {
  const [tables] = await conn.query('SHOW TABLES');
  const names = tables.map((r) => Object.values(r)[0]);
  console.log('[migrate-financial] SHOW TABLES:', names.length, 'tabelas');
  const watch = ['expenses', 'projects', 'payroll_entries', 'project_costs', 'ad_spend', 'project_schedules', 'project_materials'];
  for (const t of watch) {
    if (!names.includes(t)) {
      console.log('  (sem tabela', t + ')');
      continue;
    }
    const [cols] = await conn.query('SHOW COLUMNS FROM `' + t + '`');
    console.log('  ', t + ':', cols.map((c) => c.Field).join(', '));
  }
}

async function main() {
  let cfg = getMysqlConnectionConfig();
  if (!cfg) {
    console.error('[migrate] MySQL não configurado.', JSON.stringify(getMysqlEnvDiagnostics(), null, 2));
    process.exit(1);
  }

  console.log(`migrate-financial-complete… (${cfg.host}:${cfg.port || 3306}, db=${cfg.database})`);
  let conn;
  try {
    conn = await mysql.createConnection({
      ...cfg,
      multipleStatements: true,
      connectTimeout: 25000,
      enableKeepAlive: true,
      keepAliveInitialDelay: 0,
    });
  } catch (e) {
    if (e && (e.code === 'ETIMEDOUT' || e.code === 'ECONNREFUSED')) {
      console.error('\n[migrate] Ligação MySQL falhou:', e.code, '→', e.message);
      console.error(`
Isto é normal se estás no teu computador e:
  • O MySQL da Railway não tem TCP público ativado, ou
  • A firewall / rede bloqueia a porta MySQL (3306), ou
  • Estás a usar hostname *.railway.internal (só funciona dentro da Railway).

O que fazer (escolhe uma):
  1) Railway → serviço Node (CRM) → Shell / Deploy logs terminal:
       cd /app 2>/dev/null || true
       node database/migrate-financial-complete.js
     (usa MYSQLHOST interno; não precisa de IP público.)

  2) Na CLI, na pasta do projeto (com projeto ligado ao serviço certo):
       railway run npm run migrate:financial-complete

  3) Para correr no Mac: no painel MySQL da Railway ativa "Public networking"
     e copia DATABASE_PUBLIC_URL (ou o host proxy.rlwy.net + porta) para o .env
     como DATABASE_PUBLIC_URL=mysql://...
     Ver também config/db.js (SSL para *.up.railway.app / *.proxy.rlwy.net).
`);
      console.error('[migrate] Diagnóstico (sem passwords):', JSON.stringify(getMysqlEnvDiagnostics(), null, 2));
    }
    throw e;
  }

  await logIntrospection(conn);
  await ensureFinancialCompleteSchema(conn, { verbose: true });

  await conn.end();
  console.log('Done.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
