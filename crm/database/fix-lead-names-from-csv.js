/**
 * Corrige `leads.name` quando o sync da planilha gravou campanha/reels no lugar do nome.
 *
 * Fonte de verdade: exporte a planilha (ou só as colunas) com pelo menos:
 *   full_name (ou Full Name) + email
 *
 * Uso:
 *   cd senior-floors-system && cp ../.env .env   # ou exporte DATABASE_URL / DB_*
 *   node database/fix-lead-names-from-csv.js --csv ~/Downloads/leads.csv --dry-run
 *   node database/fix-lead-names-from-csv.js --csv ~/Downloads/leads.csv
 *
 * Um lead só:
 *   node database/fix-lead-names-from-csv.js --json '[{"email":"a@b.com","full_name":"Lisa Clifford Hansen"}]'
 *
 * Por padrão só atualiza se o nome atual parecer título de campanha (--force atualiza sempre que bater email).
 *
 * Requer: DATABASE_URL (mysql://...) ou DB_HOST, DB_USER, DB_PASS, DB_NAME
 */
import 'dotenv/config';
import fs from 'fs';
import mysql from 'mysql2/promise';

function parseDatabaseUrl(url) {
  if (!url || typeof url !== 'string') return null;
  try {
    const u = url.startsWith('mysql') ? url : 'mysql://' + url.replace(/^\/\//, '');
    const parsed = new URL(u);
    return {
      host: parsed.hostname,
      port: parseInt(parsed.port, 10) || 3306,
      user: decodeURIComponent(parsed.username || ''),
      password: decodeURIComponent(parsed.password || ''),
      database: parsed.pathname.replace(/^\//, '').replace(/\?.*$/, '') || 'railway',
    };
  } catch (_) {
    return null;
  }
}

function getMysqlConfig() {
  const url = process.env.DATABASE_URL || process.env.DATABASE_PUBLIC_URL || process.env.MYSQL_URL;
  const fromUrl = parseDatabaseUrl(url);
  if (fromUrl && fromUrl.user && fromUrl.database) return fromUrl;
  if (process.env.DB_HOST && process.env.DB_USER && process.env.DB_PASS && process.env.DB_NAME) {
    return {
      host: process.env.DB_HOST,
      port: parseInt(process.env.DB_PORT, 10) || 3306,
      user: process.env.DB_USER,
      password: process.env.DB_PASS,
      database: process.env.DB_NAME,
    };
  }
  return null;
}

/** Nome que provavelmente veio de coluna de campanha/reels, não de pessoa. */
function isLikelyWrongLeadName(name) {
  const s = String(name || '').trim();
  if (!s) return false;
  if (/^\[[^\]]{2,}\]/i.test(s)) return true;
  if (/\[[^\]]*(reel|sand and finish|campaign|ad set|adset|meta lead|instant form)[^\]]*\]/i.test(s)) return true;
  return false;
}

function normHeader(h) {
  return String(h || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_?]/g, '');
}

function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      inQ = !inQ;
      continue;
    }
    if (!inQ && c === ',') {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim().replace(/^"|"$/g, ''));
}

function parseArgs(argv) {
  const out = { dryRun: false, force: false, csv: null, json: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') out.dryRun = true;
    else if (a === '--force') out.force = true;
    else if (a === '--csv' && argv[i + 1]) {
      out.csv = argv[++i];
    } else if (a === '--json' && argv[i + 1]) {
      out.json = argv[++i];
    }
  }
  return out;
}

function loadRowsFromCsv(path) {
  const text = fs.readFileSync(path, 'utf8');
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];
  const headerCells = parseCsvLine(lines[0]).map(normHeader);
  const idx = {};
  headerCells.forEach((h, i) => {
    if (!idx[h]) idx[h] = i;
  });
  const nameKey = ['full_name', 'fullname', 'name', 'nome', 'nome_completo'].find((k) => idx[k] != null);
  const emailKey = ['email', 'e_mail', 'email_address'].find((k) => idx[k] != null);
  if (nameKey == null || emailKey == null) {
    throw new Error(
      `CSV precisa de colunas de nome (ex.: full_name) e email. Cabeçalhos: ${headerCells.join(', ')}`
    );
  }
  const rows = [];
  for (let r = 1; r < lines.length; r++) {
    const cells = parseCsvLine(lines[r]);
    const fullName = String(cells[idx[nameKey]] || '').trim();
    const email = String(cells[idx[emailKey]] || '').trim().toLowerCase();
    if (!fullName || !email) continue;
    rows.push({ full_name: fullName, email });
  }
  return rows;
}

function loadRowsFromJson(raw) {
  const data = JSON.parse(raw);
  if (!Array.isArray(data)) throw new Error('--json deve ser array de objetos');
  return data.map((o) => {
    const email = String(o.email || o.Email || '').trim().toLowerCase();
    const fullName = String(o.full_name || o.fullName || o.name || o.Full_Name || '').trim();
    return { email, full_name: fullName };
  }).filter((r) => r.email && r.full_name);
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.csv && !args.json) {
    console.error(`Uso:
  node database/fix-lead-names-from-csv.js --csv caminho/export.csv [--dry-run] [--force]
  node database/fix-lead-names-from-csv.js --json '[{"email":"...","full_name":"..."}]' [--dry-run] [--force]

  --dry-run   só mostra o que faria
  --force     atualiza nome para todo email encontrado no CSV (não só nomes "de campanha")
`);
    process.exit(1);
  }

  const cfg = getMysqlConfig();
  if (!cfg) {
    console.error('Defina DATABASE_URL ou DB_HOST, DB_USER, DB_PASS, DB_NAME');
    process.exit(1);
  }

  let pairs = [];
  if (args.csv) pairs = loadRowsFromCsv(args.csv);
  else pairs = loadRowsFromJson(args.json);

  if (pairs.length === 0) {
    console.error('Nenhuma linha válida (email + full_name).');
    process.exit(1);
  }

  const conn = await mysql.createConnection({ ...cfg, charset: 'utf8mb4' });
  let updated = 0;
  let skipped = 0;
  let notFound = 0;

  try {
    for (const { email, full_name } of pairs) {
      const [rows] = await conn.query(
        'SELECT id, name, email FROM leads WHERE LOWER(TRIM(email)) = ? LIMIT 2',
        [email]
      );
      if (!rows.length) {
        notFound++;
        console.log(`Não achado no CRM: ${email}`);
        continue;
      }
      if (rows.length > 1) {
        console.warn(`Vários leads com mesmo email ${email} — atualizando id=${rows[0].id} apenas`);
      }
      const lead = rows[0];
      if (!args.force && !isLikelyWrongLeadName(lead.name)) {
        skipped++;
        console.log(`Pulado (nome não parece campanha, use --force): id=${lead.id} ${email} → "${lead.name}"`);
        continue;
      }
      if (lead.name === full_name) {
        skipped++;
        continue;
      }
      console.log(`${args.dryRun ? '[dry-run] ' : ''}id=${lead.id} ${email}: "${lead.name}" → "${full_name}"`);
      if (!args.dryRun) {
        await conn.query('UPDATE leads SET name = ? WHERE id = ?', [full_name.slice(0, 255), lead.id]);
        updated++;
      } else {
        updated++;
      }
    }
  } finally {
    await conn.end();
  }

  console.log(
    `\nResumo: ${args.dryRun ? 'simulado ' : ''}atualizar=${updated}, pulado=${skipped}, email não encontrado=${notFound}`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
