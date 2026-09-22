/**
 * Carrega ../.env com override: true.
 * O import 'dotenv/config' NÃO sobrepõe variáveis já definidas no shell (ex.: export DATABASE_URL=...).
 * Para migrações, o .env do projeto deve prevalecer após editar o ficheiro.
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, '..', '.env');

if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath, override: true });
}
