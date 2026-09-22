/**
 * POST /api/receive-lead — save lead from LP (Vercel sends here)
 * POST /api/receive-lead-batch — vários leads num pedido (1 UrlFetch no Google Apps Script)
 */
import crypto from 'crypto';
import { getDBConnection, isDatabaseConfigured } from '../config/db.js';
import { checkDuplicateLead, getNextOwnerRoundRobin } from '../lib/leadLogic.js';
import { notifyNewLead } from '../lib/leadPushNotify.js';
import { getLeadsTableColumns } from '../lib/leadColumns.js';
import { extractMarketingFromBody, MARKETING_KEYS } from '../lib/marketingLeadFields.js';

function parseBody(req) {
  const ct = (req.headers['content-type'] || '').toLowerCase();

  if (typeof req.body === 'object' && req.body !== null && Object.keys(req.body).length > 0) {
    return req.body;
  }

  if (ct.includes('application/json')) {
    try {
      return JSON.parse(req.body || '{}');
    } catch (e) {
      return {};
    }
  }

  if (ct.includes('application/x-www-form-urlencoded')) {
    if (typeof req.body === 'string') {
      const params = new URLSearchParams(req.body);
      const result = {};
      for (const [key, value] of params.entries()) {
        result[key] = value;
      }
      return result;
    }
    return req.body || {};
  }

  return {};
}

/** Cabeçalhos da planilha com espaços extra ("Email ") ou cópias trimadas. */
function normalizePostForLead(post) {
  if (!post || typeof post !== 'object' || Array.isArray(post)) return post || {};
  const merged = { ...post };
  for (const k of Object.keys(post)) {
    if (typeof k !== 'string') continue;
    const t = k.trim();
    if (t && t !== k && merged[t] === undefined) merged[t] = post[k];
  }
  return merged;
}

function getSheetsSyncFromRequest(req) {
  return (req.headers['x-sheets-sync'] || req.headers['X-Sheets-Sync'] || '').trim() === '1';
}

/** Retorna { error: { status, json } } se 401; senão { error: null }. */
function checkSheetsSyncAuth(req, post) {
  const sheetsSecret = (process.env.SHEETS_SYNC_SECRET || '').trim();
  const isSheetsSyncRequest = getSheetsSyncFromRequest(req);
  if (sheetsSecret && isSheetsSyncRequest) {
    const fromHeader = (req.headers['x-sheets-sync-secret'] || req.headers['X-Sheets-Sync-Secret'] || '').trim();
    const fromBody = String(post['sync-secret'] || '').trim();
    if ((fromHeader || fromBody) !== sheetsSecret) {
      return {
        error: {
          status: 401,
          json: {
            success: false,
            errors: ['Unauthorized'],
            hint: 'X-Sheets-Sync-Secret header (ou body sync-secret) deve coincidir com SHEETS_SYNC_SECRET no Railway.',
            api_version: 'receive-lead-system',
          },
        },
      };
    }
  }
  return { error: null };
}

/** Primeiro valor não vazio entre chaves (planilha Meta / Apps Script usa cabeçalhos variados). */
function firstString(post, keys) {
  for (const k of keys) {
    if (post[k] === undefined || post[k] === null) continue;
    const v = String(post[k]).trim();
    if (v) return v;
  }
  const byLower = new Map();
  for (const k of Object.keys(post)) {
    if (typeof k !== 'string') continue;
    const lk = k.trim().toLowerCase();
    if (!byLower.has(lk)) byLower.set(lk, post[k]);
  }
  for (const want of keys) {
    const v = byLower.get(String(want).trim().toLowerCase());
    if (v === undefined || v === null) continue;
    const s = String(v).trim();
    if (s) return s;
  }
  return '';
}

/**
 * Meta Lead Ads / Instant Forms: "p:+13035550100", "+1 303-555-0100" → "(303) 555-0100".
 */
function normalizeUsPhoneForLead(raw) {
  let s = String(raw || '').trim();
  if (!s) return '';
  s = s.replace(/^p:\s*/i, '').replace(/^tel:\s*/i, '').replace(/^whatsapp:\s*/i, '');
  let digits = s.replace(/\D/g, '');
  if (digits.length === 11 && digits.charAt(0) === '1') digits = digits.slice(1);
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return s.length > 50 ? s.slice(0, 50) : s;
}

function pickLeadFieldsFromPost(post) {
  const name =
    firstString(post, [
      'name',
      'full_name',
      'full name',
      'Full Name',
      'fullname',
      'Nome',
      'nome',
      'Name',
      'first_name',
      'firstname',
      'First Name',
    ]) ||
    [post.first_name, post.last_name]
      .filter((x) => x != null && String(x).trim())
      .map((x) => String(x).trim())
      .join(' ')
      .trim() ||
    [post.firstName, post.lastName]
      .filter((x) => x != null && String(x).trim())
      .map((x) => String(x).trim())
      .join(' ')
      .trim();
  const email = firstString(post, [
    'email',
    'email_address',
    'Email',
    'Email Address',
    'e-mail',
    'E-mail',
    'work_email',
    'Work Email',
    'contact_email',
    'Contact email',
  ]);
  const phone = firstString(post, [
    'phone',
    'phone_number',
    'Phone',
    'Phone Number',
    'mobile',
    'Mobile',
    'tel',
    'Telefone',
    'work_phone_number',
    'Work Phone Number',
    'work phone number',
  ]);
  const zipcode = firstString(post, [
    'zipcode',
    'zip',
    'zip_code',
    'Zip',
    'Zip code',
    'Postal Code',
    'postal_code',
    'postcode',
    'CEP',
  ]);
  const message = firstString(post, ['message', 'Message', 'notes', 'Comments', 'questions']);
  return { name, email, phone, zipcode, message };
}

/**
 * Lógica de um lead após autenticação sheets (se aplicável).
 * @returns {{ status: number, json: object }}
 */
async function ingestOneLead(req, post, isSheetsSyncRequest) {
  const form_name = (post['form-name'] || post.formName || 'contact-form').trim();
  const picked = pickLeadFieldsFromPost(post);
  let name = picked.name || (post.name || '').trim();
  let phone = picked.phone || (post.phone || '').trim();
  let email = picked.email || (post.email || '').trim();
  let zipcode = picked.zipcode || (post.zipcode || '').trim();
  let message = picked.message || (post.message || '').trim();

  const isMetaForm = /meta/i.test(form_name) || form_name === 'meta-instant-form';
  const relaxImportRules = isSheetsSyncRequest || isMetaForm;

  if (relaxImportRules && phone) {
    phone = normalizeUsPhoneForLead(phone);
  }

  const phoneDigitsEarly = (phone || '').replace(/\D/g, '');
  const emailLooksValid = email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  // Instant Forms do Meta muitas vezes não pedem email — gera placeholder estável por telefone.
  if (!emailLooksValid && relaxImportRules && phoneDigitsEarly.length >= 10) {
    email = `meta-import-${phoneDigitsEarly.slice(-10)}-${crypto.randomBytes(4).toString('hex')}@invalid.invalid`;
  }

  const errors = [];
  if (!name || name.length < 2) errors.push('Name is required');
  if (!phone) errors.push('Phone is required');
  if (relaxImportRules && phoneDigitsEarly.length > 0 && phoneDigitsEarly.length < 10) {
    errors.push('Valid phone is required');
  }
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push('Valid email is required');
  let zipClean = (zipcode || '').replace(/\D/g, '');
  if (!zipClean || zipClean.length < 5) {
    if (relaxImportRules) {
      zipClean = '00000';
    } else {
      errors.push('Valid 5-digit US zip code is required');
    }
  } else {
    zipClean = zipClean.slice(0, 5);
  }
  if (errors.length > 0) {
    console.warn(
      '[receive-lead] validation failed ' +
        JSON.stringify({
          errors,
          form_name,
          isSheetsSyncRequest,
          nameLen: name.length,
          emailLen: email.length,
          phoneLen: phone.length,
          rawZipLen: (zipcode || '').length,
        })
    );
    return {
      status: 400,
      json: { success: false, errors, api_version: 'receive-lead-system' },
    };
  }

  name = name.slice(0, 255);
  phone = phone.slice(0, 50);
  email = email.slice(0, 255);
  zipcode = zipClean;
  message = message.slice(0, 65535);

  let lead_id = null;
  let db_saved = false;
  let inserted_new = null;
  let db_error_reason = null;
  let duplicate_skipped = false;

  if (!isDatabaseConfigured()) {
    db_error_reason = 'Database not configured';
  } else {
    try {
      const pool = await getDBConnection();
      if (!pool) db_error_reason = 'Could not connect to database';
      else {
        const [tables] = await pool.query("SHOW TABLES LIKE 'leads'");
        if (!tables || tables.length === 0) db_error_reason = "Table 'leads' does not exist";
        else {
          let source = 'LP-Contact';
          if (form_name === 'hero-form') source = 'LP-Hero';
          else if (/meta/i.test(form_name) || form_name === 'meta-instant-form') source = 'Meta-Instant';
          const ip_address = req.ip || req.headers['x-forwarded-for'] || null;
          let owner_id = null;
          let is_dup = false;
          const phoneDigits = (phone || '').replace(/\D/g, '');
          const dup = await checkDuplicateLead(pool, email, phoneDigits, null);
          if (dup.is_duplicate) {
            is_dup = true;
            duplicate_skipped = true;
            lead_id = dup.existing_id;
            db_saved = true;
            inserted_new = false;
            console.info(
              '[receive-lead] duplicate skipped (planilha/LP) ' +
                JSON.stringify({
                  existing_lead_id: lead_id,
                  isSheetsSyncRequest,
                  form_name,
                })
            );
          } else {
            owner_id = await getNextOwnerRoundRobin(pool);
          }
          if (!is_dup) {
            let defaultPipelineId = 1;
            try {
              const [st] = await pool.execute(
                "SELECT id FROM pipeline_stages WHERE slug IN ('new_lead','lead_received') ORDER BY FIELD(slug,'new_lead','lead_received') LIMIT 1"
              );
              if (st && st[0] && st[0].id != null) defaultPipelineId = st[0].id;
            } catch (_) {}
            let cols = 'name, email, phone, zipcode, message, source, form_type, status, priority, ip_address';
            let place = '?, ?, ?, ?, ?, ?, ?, ?, ?, ?';
            const values = [name, email, phone, zipcode, message, source, form_name, 'new_lead', 'medium', ip_address];
            try {
              const [oc] = await pool.query("SHOW COLUMNS FROM leads LIKE 'owner_id'");
              if (oc && oc.length > 0) {
                cols += ', owner_id';
                place += ', ?';
                values.push(owner_id);
              }
            } catch (_) {}
            try {
              const [pc] = await pool.query("SHOW COLUMNS FROM leads LIKE 'pipeline_stage_id'");
              if (pc && pc.length > 0) {
                cols += ', pipeline_stage_id';
                place += ', ?';
                values.push(defaultPipelineId);
              }
            } catch (_) {}
            const marketing = extractMarketingFromBody(post);
            const colSet = await getLeadsTableColumns(pool);
            for (const key of MARKETING_KEYS) {
              if (colSet.has(key)) {
                cols += `, \`${key}\``;
                place += ', ?';
                values.push(marketing[key]);
              }
            }
            const [result] = await pool.execute(`INSERT INTO leads (${cols}) VALUES (${place})`, values);
            lead_id = result.insertId;
            db_saved = true;
            inserted_new = true;
            notifyNewLead({
              name,
              email,
              phone,
              zipcode,
              source,
              leadId: lead_id,
              formName: form_name,
            }).catch(() => {});
          }
        }
      }
    } catch (e) {
      db_error_reason = e.message;
    }
  }

  const resp = {
    success: true,
    message: "Thank you! We'll contact you within 24 hours.",
    timestamp: new Date().toISOString().slice(0, 19).replace('T', ' '),
    lead_id,
    database_saved: db_saved,
    inserted_new,
    duplicate_skipped,
    api_version: 'receive-lead-system',
    data: { form_type: form_name, name, email, phone, zipcode },
  };
  if (duplicate_skipped) {
    resp.message = 'Lead já existia (email ou telefone); nenhuma linha nova inserida.';
  }
  if (!db_saved) resp.db_error = db_error_reason || 'Unknown';
  return { status: 200, json: resp };
}

export async function handleReceiveLead(req, res) {
  const post = normalizePostForLead(parseBody(req));

  const auth = checkSheetsSyncAuth(req, post);
  if (auth.error) {
    res.setHeader('Content-Type', 'application/json; charset=UTF-8');
    return res.status(auth.error.status).json(auth.error.json);
  }

  const isSheetsSyncRequest = getSheetsSyncFromRequest(req);
  const out = await ingestOneLead(req, post, isSheetsSyncRequest);
  res.setHeader('Content-Type', 'application/json; charset=UTF-8');
  res.status(out.status).json(out.json);
}

/**
 * Um único UrlFetch com N leads. Exige SHEETS_SYNC_SECRET e cabeçalhos de sync.
 */
export async function handleReceiveLeadBatch(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=UTF-8');

  const sheetsSecret = (process.env.SHEETS_SYNC_SECRET || '').trim();
  if (!sheetsSecret) {
    return res.status(503).json({
      success: false,
      error: 'Defina SHEETS_SYNC_SECRET no Railway para usar /api/receive-lead-batch.',
      api_version: 'receive-lead-batch',
    });
  }
  if (!getSheetsSyncFromRequest(req)) {
    return res.status(401).json({
      success: false,
      errors: ['Unauthorized'],
      hint: 'Envie o cabeçalho X-Sheets-Sync: 1',
      api_version: 'receive-lead-batch',
    });
  }
  const fromHeader = (req.headers['x-sheets-sync-secret'] || req.headers['X-Sheets-Sync-Secret'] || '').trim();
  if (fromHeader !== sheetsSecret) {
    return res.status(401).json({
      success: false,
      errors: ['Unauthorized'],
      hint: 'X-Sheets-Sync-Secret deve coincidir com SHEETS_SYNC_SECRET.',
      api_version: 'receive-lead-batch',
    });
  }

  const root = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
  const leadsRaw = root.leads;
  if (!Array.isArray(leadsRaw) || leadsRaw.length === 0) {
    return res.status(400).json({
      success: false,
      error: 'Corpo JSON deve incluir "leads": [ { "name", "email", "phone", ... }, ... ]',
      api_version: 'receive-lead-batch',
    });
  }

  const max = Math.min(200, Math.max(1, parseInt(process.env.RECEIVE_LEAD_BATCH_MAX || '150', 10) || 150));
  const leads = leadsRaw.slice(0, max);
  const defaultForm = String(root['form-name'] || 'meta-instant-form').trim();

  const results = [];
  for (let i = 0; i < leads.length; i++) {
    const item = leads[i];
    const obj = typeof item === 'object' && item !== null ? item : {};
    const post = normalizePostForLead({
      ...obj,
      'form-name': obj['form-name'] || defaultForm,
    });
    const out = await ingestOneLead(req, post, true);
    results.push({
      index: i,
      status: out.status,
      ...out.json,
    });
  }

  return res.status(200).json({
    success: true,
    api_version: 'receive-lead-batch',
    count: results.length,
    results,
  });
}
