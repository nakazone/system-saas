/**
 * Builder Partner Portal  tabelas e colunas (idempotente no arranque).
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
    if (e?.code === 'ER_DUP_FIELDNAME' || String(e.message || '').includes('Duplicate')) return;
    console.warn(`[db] builder portal (${label}):`, e.code || e.message);
  }
}

const DEFAULT_PRICING = [
  ['Hardwood Sanding & Refinishing', 'sand_finish', 'sq ft', 3.5, 5.0, 4.25],
  ['Hardwood Installation', 'installation', 'sq ft', 4.0, 6.5, 5.25],
  ['Engineered Wood Installation', 'installation', 'sq ft', 3.75, 5.5, 4.65],
  ['LVP / Luxury Vinyl Plank', 'installation', 'sq ft', 2.8, 4.0, 3.4],
  ['Tile & Stone Installation', 'installation', 'sq ft', 5.0, 9.0, 7.0],
  ['Stairs & Custom Patterns', 'custom', 'step', 80, 150, 115],
  ['Subfloor Preparation', 'installation', 'sq ft', 1.5, 3.0, 2.25],
  ['Stair Railing', 'custom', 'linear ft', 45, 90, 67.5],
  ['Floor Repair & Patch', 'installation', 'sq ft', 4.0, 8.0, 6.0],
  ['Custom Medallions / Inlays', 'custom', 'unit', 200, 800, 500],
];

async function seedPricingIfEmpty(pool) {
  const [[{ c }]] = await pool.query('SELECT COUNT(*) AS c FROM pricing_services');
  if (Number(c) > 0) return;
  let order = 0;
  for (const [name, category, unit, pmin, pmax, partner] of DEFAULT_PRICING) {
    await pool.execute(
      `INSERT INTO pricing_services (name, category, unit, price_min, price_max, partner_price, is_visible, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?)`,
      [name, category, unit, pmin, pmax, partner, order++]
    );
  }
  console.log('[db] pricing_services seeded with default partner rates.');
}

export async function ensureBuilderPortalSchema(pool) {
  if (!pool) return;
  try {
    if (!(await tableExists(pool, 'builders'))) {
      await pool.query(`
CREATE TABLE builders (
  id INT NOT NULL AUTO_INCREMENT,
  customer_id INT NULL COMMENT 'customers.id when synced with CRM',
  first_name VARCHAR(100) NOT NULL,
  last_name VARCHAR(100) NOT NULL,
  email VARCHAR(255) NOT NULL,
  phone VARCHAR(50) NULL,
  company VARCHAR(255) NULL,
  website VARCHAR(500) NULL,
  type VARCHAR(50) NULL COMMENT 'contractor,architect,designer,developer,subcontractor',
  status VARCHAR(20) NOT NULL DEFAULT 'pending' COMMENT 'active,pending,inactive',
  regions JSON NULL,
  avg_ticket VARCHAR(50) NULL,
  annual_projects INT NULL,
  source VARCHAR(100) NULL,
  referred_by INT NULL,
  internal_note TEXT NULL,
  portal_access TINYINT(1) NOT NULL DEFAULT 0,
  portal_password_hash VARCHAR(255) NULL,
  portal_blocked TINYINT(1) NOT NULL DEFAULT 0,
  discount_pct DECIMAL(5,2) NULL,
  last_login DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_builders_email (email),
  KEY idx_builders_customer (customer_id),
  KEY idx_builders_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
      console.log('[db] Tabela builders criada.');
    }

    if (await tableExists(pool, 'builders')) {
      if (!(await columnExists(pool, 'builders', 'portal_admin_password'))) {
        await tryAlter(
          pool,
          "ALTER TABLE builders ADD COLUMN portal_admin_password VARCHAR(255) NULL COMMENT 'Last admin-set portal password (CRM only)'",
          'portal_admin_password'
        );
      }
      if (!(await columnExists(pool, 'builders', 'portal_password_set_at'))) {
        await tryAlter(
          pool,
          'ALTER TABLE builders ADD COLUMN portal_password_set_at DATETIME NULL',
          'portal_password_set_at'
        );
      }
      if (!(await columnExists(pool, 'builders', 'portal_password_must_change'))) {
        await tryAlter(
          pool,
          'ALTER TABLE builders ADD COLUMN portal_password_must_change TINYINT(1) NOT NULL DEFAULT 0',
          'portal_password_must_change'
        );
      }
      if (!(await columnExists(pool, 'builders', 'account_manager_user_id'))) {
        await tryAlter(
          pool,
          'ALTER TABLE builders ADD COLUMN account_manager_user_id INT NULL COMMENT \'users.id CRM account manager\'',
          'account_manager_user_id'
        );
      }
      if (!(await columnExists(pool, 'builders', 'notification_prefs'))) {
        await tryAlter(
          pool,
          'ALTER TABLE builders ADD COLUMN notification_prefs JSON NULL',
          'notification_prefs'
        );
      }
      if (!(await columnExists(pool, 'builders', 'portal_last_seen_at'))) {
        await tryAlter(
          pool,
          'ALTER TABLE builders ADD COLUMN portal_last_seen_at DATETIME NULL COMMENT \'Last dashboard visit (activity since)\'',
          'portal_last_seen_at'
        );
      }
      if (!(await columnExists(pool, 'builders', 'portal_welcome_dismissed_at'))) {
        await tryAlter(
          pool,
          'ALTER TABLE builders ADD COLUMN portal_welcome_dismissed_at DATETIME NULL',
          'portal_welcome_dismissed_at'
        );
      }
    }

    if (!(await tableExists(pool, 'builder_activity_log'))) {
      await pool.query(`
CREATE TABLE builder_activity_log (
  id INT NOT NULL AUTO_INCREMENT,
  builder_id INT NOT NULL,
  project_id INT NULL,
  activity_type VARCHAR(40) NOT NULL,
  text VARCHAR(500) NOT NULL,
  href VARCHAR(255) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_bal_builder_created (builder_id, created_at),
  KEY idx_bal_project (project_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    }

    if (!(await tableExists(pool, 'builder_password_resets'))) {
      await pool.query(`
CREATE TABLE builder_password_resets (
  id INT NOT NULL AUTO_INCREMENT,
  builder_id INT NOT NULL,
  token_hash VARCHAR(64) NOT NULL,
  expires_at DATETIME NOT NULL,
  used_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_bpr_builder (builder_id),
  KEY idx_bpr_token (token_hash)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    }

    if (!(await tableExists(pool, 'builder_calculations'))) {
      await pool.query(`
CREATE TABLE builder_calculations (
  id INT NOT NULL AUTO_INCREMENT,
  builder_id INT NOT NULL,
  label VARCHAR(255) NULL,
  items_json JSON NOT NULL,
  total_low DECIMAL(12,2) NOT NULL DEFAULT 0,
  total_high DECIMAL(12,2) NOT NULL DEFAULT 0,
  area_sqft_total INT NULL,
  share_token VARCHAR(64) NULL,
  share_expires_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_bc_builder (builder_id),
  UNIQUE KEY uk_bc_share (share_token)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    }

    if (await tableExists(pool, 'builder_calculations')) {
      if (!(await columnExists(pool, 'builder_calculations', 'share_expires_at'))) {
        await pool.query(
          `ALTER TABLE builder_calculations ADD COLUMN share_expires_at TIMESTAMP NULL COMMENT 'Share link expiry' AFTER share_token`
        );
      }
    }

    if (!(await tableExists(pool, 'builder_notifications'))) {
      await pool.query(`
CREATE TABLE builder_notifications (
  id INT NOT NULL AUTO_INCREMENT,
  builder_id INT NOT NULL,
  type VARCHAR(40) NOT NULL DEFAULT 'info',
  title VARCHAR(255) NOT NULL,
  body TEXT NULL,
  link_url VARCHAR(500) NULL,
  is_read TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_bn_builder (builder_id),
  KEY idx_bn_read (builder_id, is_read)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    }

    if (!(await tableExists(pool, 'builder_projects'))) {
      await pool.query(`
CREATE TABLE builder_projects (
  id INT NOT NULL AUTO_INCREMENT,
  builder_id INT NOT NULL,
  project_id INT NOT NULL,
  role VARCHAR(30) NOT NULL DEFAULT 'primary',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_bp_builder_project (builder_id, project_id),
  KEY idx_bp_project (project_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    }

    if (!(await tableExists(pool, 'pricing_services'))) {
      await pool.query(`
CREATE TABLE pricing_services (
  id INT NOT NULL AUTO_INCREMENT,
  name VARCHAR(255) NOT NULL,
  category VARCHAR(50) NULL,
  unit VARCHAR(50) NULL,
  price_min DECIMAL(10,2) NULL,
  price_max DECIMAL(10,2) NULL,
  partner_price DECIMAL(10,2) NULL,
  is_visible TINYINT(1) NOT NULL DEFAULT 1,
  is_locked TINYINT(1) NOT NULL DEFAULT 0,
  notes TEXT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
      await seedPricingIfEmpty(pool);
    } else {
      await seedPricingIfEmpty(pool);
    }

    if (!(await tableExists(pool, 'builder_pricing_overrides'))) {
      await pool.query(`
CREATE TABLE builder_pricing_overrides (
  id INT NOT NULL AUTO_INCREMENT,
  builder_id INT NOT NULL,
  service_id INT NOT NULL,
  custom_price DECIMAL(10,2) NULL,
  discount_pct DECIMAL(5,2) NULL,
  notes TEXT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_bpo_builder_service (builder_id, service_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    }

    if (!(await tableExists(pool, 'gallery_projects'))) {
      await pool.query(`
CREATE TABLE gallery_projects (
  id INT NOT NULL AUTO_INCREMENT,
  project_id INT NULL,
  title VARCHAR(255) NOT NULL,
  description TEXT NULL,
  floor_type VARCHAR(100) NULL,
  area_sqft INT NULL,
  region VARCHAR(100) NULL,
  year INT NULL,
  materials JSON NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'draft',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_gallery_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    }

    if (!(await tableExists(pool, 'gallery_photos'))) {
      await pool.query(`
CREATE TABLE gallery_photos (
  id INT NOT NULL AUTO_INCREMENT,
  gallery_project_id INT NOT NULL,
  url VARCHAR(500) NOT NULL,
  caption VARCHAR(500) NULL,
  phase VARCHAR(20) NOT NULL DEFAULT 'after',
  sort_order INT NOT NULL DEFAULT 0,
  uploaded_by VARCHAR(20) NOT NULL DEFAULT 'admin',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_gp_project (gallery_project_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    }

    if (!(await tableExists(pool, 'builder_messages'))) {
      await pool.query(`
CREATE TABLE builder_messages (
  id INT NOT NULL AUTO_INCREMENT,
  conversation_id INT NOT NULL DEFAULT 0,
  builder_id INT NOT NULL,
  project_id INT NULL,
  sender_type VARCHAR(20) NOT NULL COMMENT 'builder,admin',
  sender_id INT NULL,
  message TEXT NOT NULL,
  attachment_url VARCHAR(500) NULL,
  is_internal_note TINYINT(1) NOT NULL DEFAULT 0,
  is_read TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_bm_builder (builder_id),
  KEY idx_bm_conv (conversation_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    }

    if (!(await tableExists(pool, 'estimate_requests'))) {
      await pool.query(`
CREATE TABLE estimate_requests (
  id INT NOT NULL AUTO_INCREMENT,
  builder_id INT NOT NULL,
  ref_number VARCHAR(32) NOT NULL,
  project_type VARCHAR(100) NULL,
  address TEXT NULL,
  services JSON NULL,
  area_sqft INT NULL,
  desired_start DATE NULL,
  urgency VARCHAR(20) NOT NULL DEFAULT 'flexible',
  notes TEXT NULL,
  attachment_url VARCHAR(500) NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'pending',
  admin_notes TEXT NULL,
  lead_id INT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_est_ref (ref_number),
  KEY idx_est_builder (builder_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    }

    if (await tableExists(pool, 'estimate_requests') && !(await columnExists(pool, 'estimate_requests', 'site_access'))) {
      await tryAlter(
        pool,
        `ALTER TABLE estimate_requests ADD COLUMN site_access TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'Builder can provide site access before estimate'`,
        'site_access'
      );
    }

    if (!(await tableExists(pool, 'builder_documents'))) {
      await pool.query(`
CREATE TABLE builder_documents (
  id INT NOT NULL AUTO_INCREMENT,
  builder_id INT NOT NULL,
  name VARCHAR(255) NOT NULL,
  type VARCHAR(50) NULL,
  url VARCHAR(500) NOT NULL,
  expires_at DATE NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'valid',
  uploaded_by VARCHAR(100) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_bd_builder (builder_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    }

    if (!(await tableExists(pool, 'builder_access_log'))) {
      await pool.query(`
CREATE TABLE builder_access_log (
  id INT NOT NULL AUTO_INCREMENT,
  builder_id INT NOT NULL,
  ip_address VARCHAR(64) NULL,
  user_agent VARCHAR(500) NULL,
  action VARCHAR(50) NOT NULL DEFAULT 'login',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_bal_builder (builder_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    }

    if (!(await tableExists(pool, 'builder_visit_requests'))) {
      await pool.query(`
CREATE TABLE builder_visit_requests (
  id INT NOT NULL AUTO_INCREMENT,
  builder_id INT NOT NULL,
  project_id INT NULL,
  lead_id INT NULL,
  scheduled_at DATETIME NOT NULL,
  address VARCHAR(500) NOT NULL,
  address_line2 VARCHAR(255) NULL,
  city VARCHAR(100) NULL,
  zipcode VARCHAR(20) NULL,
  notes TEXT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending' COMMENT 'pending,approved,declined,cancelled',
  visit_id INT NULL COMMENT 'visits.id when approved',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_bvr_builder (builder_id),
  KEY idx_bvr_scheduled (scheduled_at),
  KEY idx_bvr_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    }

    if (!(await tableExists(pool, 'estimate_request_events'))) {
      await pool.query(`
CREATE TABLE estimate_request_events (
  id INT NOT NULL AUTO_INCREMENT,
  estimate_request_id INT NOT NULL,
  status VARCHAR(30) NOT NULL,
  note VARCHAR(500) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_ere_est (estimate_request_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    }

    if (!(await tableExists(pool, 'estimate_request_files'))) {
      await pool.query(`
CREATE TABLE estimate_request_files (
  id INT NOT NULL AUTO_INCREMENT,
  estimate_request_id INT NOT NULL,
  url VARCHAR(500) NOT NULL,
  original_name VARCHAR(255) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_erf_est (estimate_request_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    }

    if (await tableExists(pool, 'project_checklist')) {
      if (!(await columnExists(pool, 'project_checklist', 'visible_to_builder'))) {
        await tryAlter(
          pool,
          'ALTER TABLE project_checklist ADD COLUMN visible_to_builder TINYINT(1) NOT NULL DEFAULT 0',
          'visible_to_builder'
        );
      }
      if (!(await columnExists(pool, 'project_checklist', 'assigned_to'))) {
        await tryAlter(
          pool,
          'ALTER TABLE project_checklist ADD COLUMN assigned_to VARCHAR(20) NOT NULL DEFAULT \'sf\'',
          'assigned_to'
        );
      }
      if (!(await columnExists(pool, 'project_checklist', 'due_date'))) {
        await tryAlter(pool, 'ALTER TABLE project_checklist ADD COLUMN due_date DATE NULL', 'due_date');
      }
      if (!(await columnExists(pool, 'project_checklist', 'approval_status'))) {
        await tryAlter(
          pool,
          "ALTER TABLE project_checklist ADD COLUMN approval_status VARCHAR(20) NULL COMMENT 'pending_sf,approved'",
          'approval_status'
        );
      }
    }

    if (await tableExists(pool, 'project_documents')) {
      if (!(await columnExists(pool, 'project_documents', 'visible_to_builder'))) {
        await tryAlter(
          pool,
          'ALTER TABLE project_documents ADD COLUMN visible_to_builder TINYINT(1) NOT NULL DEFAULT 0',
          'project_documents.visible_to_builder'
        );
      }
      if (!(await columnExists(pool, 'project_documents', 'display_name'))) {
        await tryAlter(
          pool,
          'ALTER TABLE project_documents ADD COLUMN display_name VARCHAR(255) NULL',
          'display_name'
        );
      }
    }

    if (await tableExists(pool, 'projects')) {
      if (!(await columnExists(pool, 'projects', 'builder_id'))) {
        await tryAlter(
          pool,
          'ALTER TABLE projects ADD COLUMN builder_id INT NULL COMMENT \'customers.id builder customer\'',
          'builder_id'
        );
      }
      if (!(await columnExists(pool, 'projects', 'client_type'))) {
        await tryAlter(
          pool,
          "ALTER TABLE projects ADD COLUMN client_type ENUM('builder','customer') NOT NULL DEFAULT 'customer'",
          'client_type'
        );
      }
      if (!(await columnExists(pool, 'projects', 'deleted_at'))) {
        await tryAlter(pool, 'ALTER TABLE projects ADD COLUMN deleted_at TIMESTAMP NULL', 'deleted_at');
      }

      const projectCols = [
        ['project_number', '`project_number` VARCHAR(50) NULL'],
        ['flooring_type', '`flooring_type` VARCHAR(100) NULL'],
        ['total_sqft', '`total_sqft` DECIMAL(10,2) NULL'],
        [
          'service_type',
          "`service_type` SET('supply','installation','sand_finish') NOT NULL DEFAULT 'installation'",
        ],
        ['contract_value', '`contract_value` DECIMAL(12,2) NOT NULL DEFAULT 0.00'],
        ['start_date', '`start_date` DATE NULL'],
        ['end_date_estimated', '`end_date_estimated` DATE NULL'],
        ['end_date_actual', '`end_date_actual` DATE NULL'],
        ['completion_percentage', '`completion_percentage` INT NOT NULL DEFAULT 0'],
        ['assigned_to', '`assigned_to` INT NULL'],
        ['client_name', '`client_name` VARCHAR(255) NULL COMMENT \'End customer / homeowner name (builder jobs)\''],
        [
          'general_manager_id',
          '`general_manager_id` INT NULL COMMENT \'FK users - GM shown on builder portal\'',
        ],
        [
          'installation_supervisor_id',
          '`installation_supervisor_id` INT NULL COMMENT \'FK users - installation supervisor\'',
        ],
        [
          'sand_finish_supervisor_id',
          '`sand_finish_supervisor_id` INT NULL COMMENT \'FK users - sand & finish supervisor\'',
        ],
      ];
      for (const [name, ddl] of projectCols) {
        if (!(await columnExists(pool, 'projects', name))) {
          await tryAlter(pool, `ALTER TABLE projects ADD COLUMN ${ddl}`, name);
        }
      }
      if (
        (await columnExists(pool, 'projects', 'contract_value')) &&
        (await columnExists(pool, 'projects', 'estimated_cost'))
      ) {
        try {
          await pool.query(
            'UPDATE projects SET contract_value = COALESCE(estimated_cost, 0) WHERE (contract_value IS NULL OR contract_value = 0) AND estimated_cost IS NOT NULL'
          );
        } catch (e) {
          console.warn('[db] builder portal (backfill contract_value):', e.code || e.message);
        }
      }
      if (
        (await columnExists(pool, 'projects', 'completion_percentage')) &&
        (await columnExists(pool, 'projects', 'progress_percentage'))
      ) {
        try {
          await pool.query(
            'UPDATE projects SET completion_percentage = progress_percentage WHERE completion_percentage = 0 AND progress_percentage IS NOT NULL'
          );
        } catch (e) {
          console.warn('[db] builder portal (backfill completion_percentage):', e.code || e.message);
        }
      }

      if (
        (await columnExists(pool, 'projects', 'builder_id')) &&
        (await columnExists(pool, 'projects', 'customer_id'))
      ) {
        let backfill =
          'UPDATE projects SET builder_id = customer_id WHERE builder_id IS NULL AND customer_id IS NOT NULL';
        if (await columnExists(pool, 'projects', 'client_type')) {
          backfill += " AND client_type = 'builder'";
        }
        try {
          await pool.query(backfill);
        } catch (e) {
          console.warn('[db] builder portal (backfill builder_id):', e.code || e.message);
        }
        try {
          await pool.query(
            `UPDATE projects p
             INNER JOIN builders b ON p.customer_id = b.customer_id
             SET p.builder_id = b.customer_id
             WHERE p.builder_id IS NULL AND b.customer_id IS NOT NULL`
          );
        } catch (e) {
          console.warn('[db] builder portal (backfill builder_id from customer_id):', e.code || e.message);
        }
      }
    }

    if (await tableExists(pool, 'projects') && !(await columnExists(pool, 'projects', 'partner_builder_id'))) {
      await tryAlter(
        pool,
        'ALTER TABLE projects ADD COLUMN partner_builder_id INT NULL COMMENT \'builders.id portal partner\'',
        'partner_builder_id'
      );
    }

    if (await tableExists(pool, 'leads') && !(await columnExists(pool, 'leads', 'referring_builder_id'))) {
      await tryAlter(
        pool,
        'ALTER TABLE leads ADD COLUMN referring_builder_id INT NULL COMMENT \'builders.id referral source\'',
        'referring_builder_id'
      );
    }

    if (await tableExists(pool, 'project_materials')) {
      if (!(await columnExists(pool, 'project_materials', 'visible_to_builder'))) {
        await tryAlter(
          pool,
          'ALTER TABLE project_materials ADD COLUMN visible_to_builder TINYINT(1) NOT NULL DEFAULT 1',
          'project_materials.visible_to_builder'
        );
      }
      if (!(await columnExists(pool, 'project_materials', 'builder_approval_status'))) {
        await tryAlter(
          pool,
          "ALTER TABLE project_materials ADD COLUMN builder_approval_status VARCHAR(20) NOT NULL DEFAULT 'pending' COMMENT 'pending,approved,rejected'",
          'builder_approval_status'
        );
      }
      if (!(await columnExists(pool, 'project_materials', 'builder_comment'))) {
        await tryAlter(
          pool,
          'ALTER TABLE project_materials ADD COLUMN builder_comment TEXT NULL',
          'builder_comment'
        );
      }
      if (!(await columnExists(pool, 'project_materials', 'material_color'))) {
        await tryAlter(
          pool,
          'ALTER TABLE project_materials ADD COLUMN material_color VARCHAR(100) NULL',
          'material_color'
        );
      }
      if (!(await columnExists(pool, 'project_materials', 'material_spec'))) {
        await tryAlter(
          pool,
          'ALTER TABLE project_materials ADD COLUMN material_spec TEXT NULL COMMENT \'Color, finish, dimensions for builder approval\'',
          'material_spec'
        );
      }
      if (!(await columnExists(pool, 'project_materials', 'material_image_url'))) {
        await tryAlter(
          pool,
          'ALTER TABLE project_materials ADD COLUMN material_image_url VARCHAR(500) NULL',
          'material_image_url'
        );
      }
    }

    if (await tableExists(pool, 'builders')) {
      if (!(await columnExists(pool, 'builders', 'company_logo_url'))) {
        await tryAlter(
          pool,
          'ALTER TABLE builders ADD COLUMN company_logo_url VARCHAR(500) NULL COMMENT \'URL for co-branded client PDFs\'',
          'company_logo_url'
        );
      }
    }

    if (!(await tableExists(pool, 'builder_project_evaluations'))) {
      await pool.query(`
CREATE TABLE builder_project_evaluations (
  id INT NOT NULL AUTO_INCREMENT,
  builder_id INT NOT NULL,
  project_id INT NOT NULL,
  rating TINYINT NOT NULL COMMENT '1-5 stars',
  comment TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_bpe_builder_project (builder_id, project_id),
  KEY idx_bpe_project (project_id),
  KEY idx_bpe_rating (rating)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    }

    if (await tableExists(pool, 'project_photos')) {
      if (!(await columnExists(pool, 'project_photos', 'uploaded_by_builder_id'))) {
        await tryAlter(
          pool,
          'ALTER TABLE project_photos ADD COLUMN uploaded_by_builder_id INT NULL',
          'uploaded_by_builder_id'
        );
      }
      if (!(await columnExists(pool, 'project_photos', 'partner_upload'))) {
        await tryAlter(
          pool,
          'ALTER TABLE project_photos ADD COLUMN partner_upload TINYINT(1) NOT NULL DEFAULT 0',
          'partner_upload'
        );
      }
    }
  } catch (e) {
    console.warn('[db] ensureBuilderPortalSchema:', e.code || e.message);
  }
}
