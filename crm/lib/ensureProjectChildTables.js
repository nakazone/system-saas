/**
 * Cria project_costs, project_materials, project_checklist, project_photos se faltarem
 * (equivalente a migrate-projects-complete.js → createChildTables + migrateChildTableColumns).
 * Evita erro «Table project_costs doesn't exist» em ambientes onde só existia `projects`.
 */
async function tableExists(pool, name) {
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS c FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [name]
  );
  return Number(rows[0]?.c) > 0;
}

async function columnExists(pool, table, col) {
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, col]
  );
  return Number(rows[0]?.c) > 0;
}

async function tryAlter(pool, sql, label) {
  try {
    await pool.query(sql);
  } catch (e) {
    if (e && (e.code === 'ER_DUP_FIELDNAME' || String(e.message || '').includes('Duplicate column'))) return;
    console.warn(`[db] ensure project child tables (${label}):`, e.code || e.message);
  }
}

export async function ensureProjectChildTables(pool) {
  if (!pool) return;
  try {
    if (!(await tableExists(pool, 'projects'))) return;

    await pool.query(`
CREATE TABLE IF NOT EXISTS \`project_costs\` (
  \`id\` INT NOT NULL AUTO_INCREMENT,
  \`project_id\` INT NOT NULL,
  \`cost_type\` ENUM('labor','material','additional') NOT NULL,
  \`service_category\` ENUM('supply','installation','sand_finish','general') NOT NULL DEFAULT 'general',
  \`description\` VARCHAR(255) NOT NULL,
  \`quantity\` DECIMAL(10,2) NOT NULL DEFAULT 1,
  \`unit\` VARCHAR(50) NULL,
  \`unit_cost\` DECIMAL(10,2) NOT NULL DEFAULT 0,
  \`total_cost\` DECIMAL(10,2) NOT NULL DEFAULT 0,
  \`paid\` TINYINT(1) NOT NULL DEFAULT 0,
  \`paid_at\` DATE NULL,
  \`vendor\` VARCHAR(255) NULL,
  \`receipt_path\` VARCHAR(500) NULL,
  \`notes\` TEXT NULL,
  \`created_by\` INT NULL,
  \`created_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (\`id\`),
  KEY \`idx_project_costs_project\` (\`project_id\`),
  KEY \`idx_project_costs_type\` (\`cost_type\`),
  CONSTRAINT \`fk_project_costs_project\` FOREIGN KEY (\`project_id\`) REFERENCES \`projects\` (\`id\`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
`);

    await pool.query(`
CREATE TABLE IF NOT EXISTS \`project_materials\` (
  \`id\` INT NOT NULL AUTO_INCREMENT,
  \`project_id\` INT NOT NULL,
  \`product_name\` VARCHAR(255) NOT NULL,
  \`sku\` VARCHAR(100) NULL,
  \`supplier\` VARCHAR(255) NULL,
  \`unit\` VARCHAR(50) NULL,
  \`qty_ordered\` DECIMAL(10,2) NOT NULL DEFAULT 0,
  \`qty_received\` DECIMAL(10,2) NOT NULL DEFAULT 0,
  \`qty_used\` DECIMAL(10,2) NOT NULL DEFAULT 0,
  \`unit_cost\` DECIMAL(10,2) NOT NULL DEFAULT 0,
  \`total_cost\` DECIMAL(10,2) NOT NULL DEFAULT 0,
  \`service_category\` ENUM('supply','installation','sand_finish','general') NOT NULL DEFAULT 'general',
  \`status\` ENUM('pending','ordered','received','partial','returned') NOT NULL DEFAULT 'pending',
  \`order_date\` DATE NULL,
  \`received_date\` DATE NULL,
  \`notes\` TEXT NULL,
  \`created_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  \`updated_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (\`id\`),
  KEY \`idx_project_materials_project\` (\`project_id\`),
  CONSTRAINT \`fk_project_materials_project\` FOREIGN KEY (\`project_id\`) REFERENCES \`projects\` (\`id\`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
`);

    await pool.query(`
CREATE TABLE IF NOT EXISTS \`project_checklist\` (
  \`id\` INT NOT NULL AUTO_INCREMENT,
  \`project_id\` INT NOT NULL,
  \`category\` VARCHAR(100) NOT NULL,
  \`item\` VARCHAR(255) NOT NULL,
  \`checked\` TINYINT(1) NOT NULL DEFAULT 0,
  \`checked_by\` INT NULL,
  \`checked_at\` TIMESTAMP NULL,
  \`notes\` TEXT NULL,
  PRIMARY KEY (\`id\`),
  KEY \`idx_project_checklist_project\` (\`project_id\`),
  CONSTRAINT \`fk_project_checklist_project\` FOREIGN KEY (\`project_id\`) REFERENCES \`projects\` (\`id\`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
`);

    await pool.query(`
CREATE TABLE IF NOT EXISTS \`project_photos\` (
  \`id\` INT NOT NULL AUTO_INCREMENT,
  \`project_id\` INT NOT NULL,
  \`phase\` ENUM('before','during','after') NOT NULL DEFAULT 'during',
  \`filename\` VARCHAR(255) NOT NULL,
  \`original_name\` VARCHAR(255) NULL,
  \`file_path\` VARCHAR(500) NOT NULL,
  \`file_size\` INT NULL,
  \`mime_type\` VARCHAR(100) NULL,
  \`caption\` VARCHAR(255) NULL,
  \`taken_at\` TIMESTAMP NULL,
  \`uploaded_by\` INT NULL,
  \`created_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (\`id\`),
  KEY \`idx_project_photos_project\` (\`project_id\`),
  CONSTRAINT \`fk_project_photos_project\` FOREIGN KEY (\`project_id\`) REFERENCES \`projects\` (\`id\`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
`);

    if (await tableExists(pool, 'project_costs')) {
      if (!(await columnExists(pool, 'project_costs', 'is_projected'))) {
        await tryAlter(
          pool,
          'ALTER TABLE `project_costs` ADD COLUMN `is_projected` TINYINT(1) NOT NULL DEFAULT 0',
          'project_costs.is_projected'
        );
      }
      if (!(await columnExists(pool, 'project_costs', 'payroll_entry_id'))) {
        await tryAlter(
          pool,
          'ALTER TABLE `project_costs` ADD COLUMN `payroll_entry_id` INT NULL',
          'project_costs.payroll_entry_id'
        );
      }
    }

    if (await tableExists(pool, 'project_photos')) {
      if (!(await columnExists(pool, 'project_photos', 'file_url'))) {
        await tryAlter(
          pool,
          'ALTER TABLE `project_photos` ADD COLUMN `file_url` VARCHAR(500) NULL',
          'project_photos.file_url'
        );
      }
      if (!(await columnExists(pool, 'project_photos', 'is_portfolio'))) {
        await tryAlter(
          pool,
          'ALTER TABLE `project_photos` ADD COLUMN `is_portfolio` TINYINT(1) NOT NULL DEFAULT 0',
          'project_photos.is_portfolio'
        );
      }
      if (!(await columnExists(pool, 'project_photos', 'is_cover'))) {
        await tryAlter(
          pool,
          'ALTER TABLE `project_photos` ADD COLUMN `is_cover` TINYINT(1) NOT NULL DEFAULT 0',
          'project_photos.is_cover'
        );
      }
    }

    if (await tableExists(pool, 'project_checklist')) {
      if (!(await columnExists(pool, 'project_checklist', 'sort_order'))) {
        await tryAlter(
          pool,
          'ALTER TABLE `project_checklist` ADD COLUMN `sort_order` INT NOT NULL DEFAULT 0',
          'project_checklist.sort_order'
        );
      }
    }

    if (await tableExists(pool, 'project_materials')) {
      if (!(await columnExists(pool, 'project_materials', 'is_projected'))) {
        await tryAlter(
          pool,
          'ALTER TABLE `project_materials` ADD COLUMN `is_projected` TINYINT(1) NOT NULL DEFAULT 0',
          'project_materials.is_projected'
        );
      }
      if (!(await columnExists(pool, 'project_materials', 'unit_cost_projected'))) {
        await tryAlter(
          pool,
          'ALTER TABLE `project_materials` ADD COLUMN `unit_cost_projected` DECIMAL(10,2) NOT NULL DEFAULT 0.00',
          'project_materials.unit_cost_projected'
        );
      }
      if (!(await columnExists(pool, 'project_materials', 'qty_returned'))) {
        await tryAlter(
          pool,
          'ALTER TABLE `project_materials` ADD COLUMN `qty_returned` DECIMAL(10,2) NOT NULL DEFAULT 0',
          'project_materials.qty_returned'
        );
      }
      if (!(await columnExists(pool, 'project_materials', 'erp_product_id'))) {
        await tryAlter(
          pool,
          'ALTER TABLE `project_materials` ADD COLUMN `erp_product_id` INT NULL DEFAULT NULL COMMENT \'FK lógico products.id\'',
          'project_materials.erp_product_id'
        );
      }
    }

    console.log('[db] Tabelas filhas de projetos (costs, materials, checklist, photos) verificadas.');
  } catch (e) {
    if (e && e.code === 'ER_CANNOT_ADD_FOREIGN') {
      console.warn(
        '[db] ensureProjectChildTables: FK falhou — corra à mão: npm run migrate:projects-complete',
        e.message
      );
      return;
    }
    console.warn('[db] ensureProjectChildTables:', e.code || e.message);
  }
}
