/**
 * Idempotent migration: UTM + marketing fields on leads, ad_spend table.
 * Run: node database/migrate-marketing-analytics.js
 * Requires DB_* env (same as app).
 */
import './load-dotenv-override.mjs';
import mysql from 'mysql2/promise';

async function columnExists(conn, table, column) {
  const [rows] = await conn.query(
    `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  );
  return rows[0].c > 0;
}

async function addColumn(conn, table, ddl) {
  await conn.query(`ALTER TABLE \`${table}\` ADD COLUMN ${ddl}`);
}

async function main() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    multipleStatements: true,
  });

  console.log('Marketing analytics migration…');

  const leadCols = [
    ['utm_source', "`utm_source` VARCHAR(255) NULL DEFAULT NULL COMMENT 'UTM source'"],
    ['utm_medium', "`utm_medium` VARCHAR(255) NULL DEFAULT NULL"],
    ['utm_campaign', "`utm_campaign` VARCHAR(255) NULL DEFAULT NULL"],
    ['utm_content', "`utm_content` VARCHAR(255) NULL DEFAULT NULL"],
    ['utm_term', "`utm_term` VARCHAR(255) NULL DEFAULT NULL"],
    ['utm_adset', "`utm_adset` VARCHAR(255) NULL DEFAULT NULL COMMENT 'Meta ad set name/id'"],
    ['utm_ad', "`utm_ad` VARCHAR(255) NULL DEFAULT NULL COMMENT 'Meta ad name/id'"],
    [
      'marketing_platform',
      "`marketing_platform` VARCHAR(64) NULL DEFAULT NULL COMMENT 'Meta, Google, Organic, Referral, Other'",
    ],
    ['landing_page', '`landing_page` VARCHAR(2000) NULL DEFAULT NULL'],
  ];

  for (const [name, ddl] of leadCols) {
    if (!(await columnExists(conn, 'leads', name))) {
      await addColumn(conn, 'leads', ddl);
      console.log('  + leads.' + name);
    }
  }

  await conn.query(`
    CREATE TABLE IF NOT EXISTS ad_spend (
      id INT AUTO_INCREMENT PRIMARY KEY,
      platform VARCHAR(32) NOT NULL COMMENT 'Meta, Google, Other',
      campaign_name VARCHAR(255) NOT NULL,
      utm_campaign VARCHAR(255) NULL DEFAULT NULL,
      spend DECIMAL(12,2) NOT NULL DEFAULT 0,
      spend_date DATE NOT NULL,
      notes VARCHAR(500) NULL DEFAULT NULL,
      created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_ad_spend_date (spend_date),
      KEY idx_ad_spend_platform (platform),
      KEY idx_ad_spend_utm (utm_campaign)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  console.log('  ✓ ad_spend table');

  await conn.end();
  console.log('Done.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
