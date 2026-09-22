/**
 * Adiciona quotes.invoice_pdf (LONGBLOB) para PDFs sobreviverem a redeploys sem disco persistente.
 * Run: node database/migrate-quote-invoice-pdf-blob.js
 */
import 'dotenv/config';
import mysql from 'mysql2/promise';

async function columnExists(conn, table, column) {
  const [rows] = await conn.query(
    `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  );
  return rows[0].c > 0;
}

async function main() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
  });

  console.log('quotes.invoice_pdf migration…');

  if (await columnExists(conn, 'quotes', 'invoice_pdf')) {
    console.log('Column invoice_pdf already exists; skipping.');
    await conn.end();
    return;
  }

  await conn.query(
    'ALTER TABLE `quotes` ADD COLUMN `invoice_pdf` LONGBLOB NULL DEFAULT NULL COMMENT \'PDF da fatura (persistente)\''
  );
  console.log('Added quotes.invoice_pdf');

  await conn.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
