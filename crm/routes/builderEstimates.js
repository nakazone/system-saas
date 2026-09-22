/**
 * Builder estimate requests, calculator, history, referrals (Sprint 4).
 */
import path from 'path';
import { getDBConnection } from '../config/db.js';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { requireBuilderAuth } from '../middleware/builderAuth.js';
import { generateEstimateRefNumber } from '../lib/estimateRefNumber.js';
import { uploadEstimateFiles } from '../lib/estimateMultiUpload.js';
import { sendBuilderNotification, adminNotifyEmail } from '../lib/builderNotify.js';
import { builderWantsEmail } from '../lib/builderNotifyPrefs.js';
import { notifyBuilder } from './builderNotifications.js';
import { getBuilderCustomerId, getProjectBuilderLinkMeta, buildProjectBuilderMatch, buildProjectOrderSql, buildProjectSelectSql, projectNotDeletedClause } from '../lib/builderProjectAccess.js';
import { getPartnerPricingForBuilder } from './builderPricing.js';
import { calculateLine } from '../lib/builderPricingCalc.js';
import { logEstimateEvent } from '../lib/builderActivityLog.js';
import { estimateStatusLabel, normalizeEstimateStatus } from '../lib/estimateRequestStatus.js';
import { buildBuilderHistoryPdfBuffer } from '../modules/builder/builderHistoryPdf.js';
import { sanitizePdfText } from '../lib/pdfWinAnsi.js';

async function tableExists(pool, name) {
 const [r] = await pool.query(
 `SELECT COUNT(*) AS c FROM information_schema.TABLES
 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
 [name]
 );
 return Number(r[0]?.c) > 0;
}

async function columnExists(pool, table, col) {
 const [r] = await pool.query(
 `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
 [table, col]
 );
 return Number(r[0]?.c) > 0;
}

async function createLeadFromEstimate(pool, builder, est, refNumber) {
 const [b] = await pool.query('SELECT first_name, last_name, email, phone, company FROM builders WHERE id = ?', [
 builder.builderId,
 ]);
 const builderRow = b[0] || {};
 const builderName = [builderRow.first_name, builderRow.last_name].filter(Boolean).join(' ');
 const services = Array.isArray(est.services) ? est.services.join(', ') : '';
 const notes = [
 `[Builder Portal] Estimate ${refNumber}`,
 `Builder: ${builderName} (${builderRow.company || ''})`,
 `Project type: ${est.project_type || ''}`,
 `Address: ${est.address || ''}`,
 `Services: ${services}`,
 `Area: ${est.area_sqft || ''} sqft`,
 `Urgency: ${est.urgency}`,
 est.site_access ? 'Site access: yes' : 'Site access: no',
 est.notes || '',
 ]
 .filter(Boolean)
 .join('\n');

 const name = builderRow.company || builderName || 'Builder referral';
 const email = builderRow.email || `builder+${builder.builderId}@portal.local`;
 const phone = builderRow.phone || '0000000000';
 const zip = '80202';
 const message = `Builder estimate ${refNumber} - ${est.address || 'see notes'}`.slice(0, 65535);

 const hasReferring = await columnExists(pool, 'leads', 'referring_builder_id');
 const cols = ['name', 'email', 'phone', 'zipcode', 'message', 'source', 'form_type', 'status', 'notes'];
 const vals = [name.slice(0, 255), email, phone.slice(0, 50), zip, message, 'Portal Builder', 'builder_estimate', 'new_lead', notes.slice(0, 65535)];
 if (hasReferring) {
 cols.push('referring_builder_id');
 vals.push(builder.builderId);
 }

 const [ins] = await pool.execute(
 `INSERT INTO leads (${cols.map((c) => `\`${c}\``).join(', ')}, created_at) VALUES (${cols.map(() => '?').join(', ')}, NOW())`,
 vals
 );
 return ins.insertId;
}

export async function postEstimateRequest(req, res) {
 try {
 const pool = await getDBConnection();
 if (!pool) return res.status(503).json({ success: false, error: 'Database not available' });

 const builderId = req.builderAuth.builderId;
 const body = req.body || {};
 let services = [];
 try {
 if (body.services) {
 services = typeof body.services === 'string' ? JSON.parse(body.services) : body.services;
 }
 } catch {
 services = [];
 }
 if (!Array.isArray(services)) services = [];
 const refNumber = await generateEstimateRefNumber(pool);
 let attachmentUrl = body.attachment_url || null;
 const files = req.files && req.files.length ? req.files : req.file ? [req.file] : [];
 if (files.length && !attachmentUrl) {
 const rel = path.join('estimates', String(builderId), files[0].filename).replace(/\\/g, '/');
 attachmentUrl = `/uploads/${rel}`;
 }

 const siteAccess =
 body.site_access === '1' || body.site_access === true || body.site_access === 'true' ? 1 : 0;
 const estRow = {
 project_type: body.project_type || null,
 address: body.address || null,
 services: JSON.stringify(Array.isArray(services) ? services : []),
 area_sqft: body.area_sqft != null ? parseInt(body.area_sqft, 10) : null,
 desired_start: body.desired_start || null,
 urgency: body.urgency || 'flexible',
 notes: body.notes || null,
 site_access: siteAccess,
 };

 const hasSiteAccess = await columnExists(pool, 'estimate_requests', 'site_access');
 const insertCols = [
 'builder_id',
 'ref_number',
 'project_type',
 'address',
 'services',
 'area_sqft',
 'desired_start',
 'urgency',
 'notes',
 'attachment_url',
 'status',
 ];
 const insertVals = [
 builderId,
 refNumber,
 estRow.project_type,
 estRow.address,
 estRow.services,
 estRow.area_sqft,
 estRow.desired_start,
 estRow.urgency,
 estRow.notes,
 attachmentUrl,
 'pending',
 ];
 if (hasSiteAccess) {
 insertCols.splice(insertCols.length - 1, 0, 'site_access');
 insertVals.splice(insertVals.length - 1, 0, siteAccess);
 }

 const [ins] = await pool.execute(
 `INSERT INTO estimate_requests (${insertCols.map((c) => `\`${c}\``).join(', ')}) VALUES (${insertCols.map(() => '?').join(', ')})`,
 insertVals
 );

 const leadId = await createLeadFromEstimate(pool, req.builderAuth, { ...estRow, services }, refNumber);
 await pool.execute('UPDATE estimate_requests SET lead_id = ? WHERE id = ?', [leadId, ins.insertId]);

 if (await tableExists(pool, 'estimate_request_files')) {
 for (const f of files) {
 const rel = path.join('estimates', String(builderId), f.filename).replace(/\\/g, '/');
 await pool.execute(
 'INSERT INTO estimate_request_files (estimate_request_id, url, original_name) VALUES (?, ?, ?)',
 [ins.insertId, `/uploads/${rel}`, f.originalname || null]
 );
 }
 }
 if (await tableExists(pool, 'estimate_request_events')) {
 await pool.execute(
 'INSERT INTO estimate_request_events (estimate_request_id, status, note) VALUES (?, ?, ?)',
 [ins.insertId, 'pending', 'Request submitted']
 );
 logEstimateEvent(pool, builderId, refNumber, 'pending', 'Request submitted').catch(() => {});
 }

 const [builder] = await pool.query(
 'SELECT email, first_name, notification_prefs FROM builders WHERE id = ?',
 [builderId]
 );
 const pub = process.env.PUBLIC_CRM_URL || '';
 const svcList = Array.isArray(services) ? services.join(', ') : '';
 if (builder[0]?.email && builderWantsEmail(builder[0].notification_prefs, 'project_status')) {
 sendBuilderNotification({
 to: builder[0].email,
 subject: `Estimate request received - ${refNumber}`,
 html: `<p>Hi ${builder[0].first_name || 'there'},</p>
<p>We received your estimate request <strong>${refNumber}</strong>.</p>
<ul>
 <li><strong>Address:</strong> ${estRow.address || 'n/a'}</li>
 <li><strong>Services:</strong> ${svcList || 'n/a'}</li>
 <li><strong>Area:</strong> ${estRow.area_sqft || 'n/a'} sq ft</li>
</ul>
<p>Our team will contact you within <strong>48 hours</strong>.</p>
<p><a href="${pub}/builder-referrals.html">Track status in Referrals</a></p>`,
 }).catch(() => {});
 }
 const adminTo = adminNotifyEmail();
 if (adminTo) {
 sendBuilderNotification({
 to: adminTo,
 subject: `New builder estimate - ${refNumber}`,
 html: `<p>New estimate request from builder portal.</p><p>Ref: <strong>${refNumber}</strong></p><p>Address: ${estRow.address || 'n/a'}</p><p><a href="${pub}/dashboard.html?page=leads">View leads</a></p>`,
 }).catch(() => {});
 }

 notifyBuilder(pool, builderId, {
 type: 'estimate',
 title: `Estimate request ${refNumber}`,
 body: 'We received your request. Our team will respond within 48 hours.',
 linkUrl: '/builder-referrals.html',
 }).catch(() => {});

 res.status(201).json({
 success: true,
 data: { id: ins.insertId, ref_number: refNumber, lead_id: leadId },
 });
 } catch (e) {
 console.error('postEstimateRequest:', e);
 res.status(500).json({ success: false, error: e.message });
 }
}

export async function postPricingCalculate(req, res) {
 try {
 const area = Math.max(0, parseInt(req.body?.area_sqft, 10) || 0);
 const serviceId = parseInt(req.body?.service_id, 10);
 if (!area || !Number.isFinite(serviceId)) {
 return res.status(400).json({ success: false, error: 'area_sqft and service_id required' });
 }

 const pool = await getDBConnection();
 const services = await getPartnerPricingForBuilder(pool, req.builderAuth.builderId);
 const svc = services.find((s) => s.id === serviceId);
 if (!svc || svc.is_locked) {
 return res.status(404).json({ success: false, error: 'Service not available' });
 }
 const line = calculateLine(svc, area);
 res.json({
 success: true,
 data: {
 service: line.service,
 unit: line.unit,
 rate: line.partner_rate,
 area_sqft: line.area_sqft,
 estimate_low: line.estimate_low,
 estimate_high: line.estimate_high,
 volume_discount_pct: line.volume_discount_pct,
 estimate_low_discounted: line.estimate_low_discounted,
 estimate_high_discounted: line.estimate_high_discounted,
 public_estimate_low: line.public_estimate_low,
 public_estimate_high: line.public_estimate_high,
 public_savings_low: line.public_savings_low,
 public_savings_high: line.public_savings_high,
 },
 });
 } catch (e) {
 res.status(500).json({ success: false, error: e.message });
 }
}

export async function listEstimateRequestsAdmin(req, res) {
 try {
 const pool = await getDBConnection();
 const status = req.query.status || null;
 let where = '1=1';
 const params = [];
 if (status) {
 where += ' AND e.status = ?';
 params.push(status);
 }
 const [rows] = await pool.query(
 `SELECT e.*, b.first_name, b.last_name, b.company, b.email AS builder_email
 FROM estimate_requests e
 JOIN builders b ON b.id = e.builder_id
 WHERE ${where}
 ORDER BY e.created_at DESC
 LIMIT 100`,
 params
 );
 res.json({ success: true, data: rows });
 } catch (e) {
 res.status(500).json({ success: false, error: e.message });
 }
}

export async function updateEstimateRequest(req, res) {
 try {
 const pool = await getDBConnection();
 const id = parseInt(req.params.id, 10);
 const { status, admin_notes } = req.body || {};
 const normalizedStatus = status ? normalizeEstimateStatus(status) : null;
 const [prev] = await pool.query('SELECT builder_id, status, ref_number FROM estimate_requests WHERE id = ?', [
 id,
 ]);
 await pool.execute(
 'UPDATE estimate_requests SET status = COALESCE(?, status), admin_notes = COALESCE(?, admin_notes), updated_at = NOW() WHERE id = ?',
 [normalizedStatus, admin_notes, id]
 );
 if (normalizedStatus && (await tableExists(pool, 'estimate_request_events'))) {
 await pool.execute(
 'INSERT INTO estimate_request_events (estimate_request_id, status, note) VALUES (?, ?, ?)',
 [id, normalizedStatus, admin_notes ? String(admin_notes).slice(0, 500) : 'Status updated']
 );
 if (prev[0]?.builder_id) {
 logEstimateEvent(
 pool,
 prev[0].builder_id,
 prev[0].ref_number,
 normalizedStatus,
 admin_notes ? String(admin_notes).slice(0, 500) : 'Status updated'
 ).catch(() => {});
 }
 }
 const [rows] = await pool.query('SELECT * FROM estimate_requests WHERE id = ?', [id]);
 const row = rows[0];
 if (normalizedStatus && prev[0] && prev[0].status !== normalizedStatus && prev[0].builder_id) {
 const [b] = await pool.query(
 'SELECT email, first_name, notification_prefs FROM builders WHERE id = ?',
 [prev[0].builder_id]
 );
 if (b[0]?.email && builderWantsEmail(b[0].notification_prefs, 'project_status')) {
 sendBuilderNotification({
 to: b[0].email,
 subject: `Estimate ${prev[0].ref_number} - ${estimateStatusLabel(normalizedStatus)}`,
 html: `<p>Hi ${b[0].first_name || 'there'},</p><p>Your estimate <strong>${prev[0].ref_number}</strong> is now: <strong>${estimateStatusLabel(normalizedStatus)}</strong>.</p><p><a href="${process.env.PUBLIC_CRM_URL || ''}/builder-referrals.html">View referrals</a></p>`,
 }).catch(() => {});
 }
 notifyBuilder(pool, prev[0].builder_id, {
 type: 'estimate',
 title: `Estimate ${prev[0].ref_number} updated`,
 body: `Status: ${estimateStatusLabel(normalizedStatus)}`,
 linkUrl: '/builder-referrals.html',
 }).catch(() => {});
 }
 res.json({ success: true, data: row });
 } catch (e) {
 res.status(500).json({ success: false, error: e.message });
 }
}

export function filterBuilderHistoryRows(rows, { year, q } = {}) {
 let list = rows || [];
 if (year) list = list.filter((p) => p.completed_year === String(year));
 const qq = String(q || '')
  .trim()
  .toLowerCase();
 if (qq) {
  list = list.filter((p) => {
   const hay = [p.name, p.address, p.project_number, p.flooring_type].filter(Boolean).join(' ').toLowerCase();
   return hay.includes(qq);
  });
 }
 return list;
}

export function summarizeBuilderHistory(rows) {
 let totalSqft = 0;
 let totalValue = 0;
 (rows || []).forEach((r) => {
  totalSqft += Number(r.total_sqft) || 0;
  totalValue += Number(r.contract_value) || 0;
 });
 return {
  project_count: (rows || []).length,
  total_sqft: totalSqft,
  total_value: Math.round(totalValue * 100) / 100,
 };
}

export async function fetchBuilderHistoryProjects(pool, builderId) {
 const cid = await getBuilderCustomerId(pool, builderId);
 if (!cid) return { data: [], builderName: '' };
 const linkMeta = await getProjectBuilderLinkMeta(pool);
 const match = buildProjectBuilderMatch('p', builderId, cid, linkMeta);
 const selectSql = await buildProjectSelectSql(
  pool,
  [
   'id',
   'name',
   'address',
   'status',
   'contract_value',
   'completion_percentage',
   'flooring_type',
   'total_sqft',
   'project_number',
   'end_date_actual',
   'start_date',
  ],
  'p'
 );
 const orderSql = await buildProjectOrderSql(pool, 'end_date_actual', 'p');
 const [rows] = await pool.query(
  `SELECT ${selectSql}
   FROM projects p
   WHERE ${match.sql}${projectNotDeletedClause('p', linkMeta)}
   AND status IN ('completed','closed')
   ORDER BY ${orderSql} DESC`,
  match.params
 );

 const projectIds = rows.map((r) => r.id).filter(Boolean);
 const photoMeta = {};
 if (projectIds.length) {
  const [ph] = await pool.query(
   `SELECT project_id,
      COUNT(*) AS c,
      SUM(CASE WHEN phase = 'before' THEN 1 ELSE 0 END) AS before_cnt,
      SUM(CASE WHEN phase = 'after' THEN 1 ELSE 0 END) AS after_cnt
    FROM project_photos
    WHERE project_id IN (${projectIds.map(() => '?').join(',')})
    GROUP BY project_id`,
   projectIds
  );
  ph.forEach((row) => {
   photoMeta[row.project_id] = {
    count: Number(row.c) || 0,
    has_before_after: Number(row.before_cnt) > 0 && Number(row.after_cnt) > 0,
   };
  });
 }

 const data = rows.map((r) => {
  const pm = photoMeta[r.id] || { count: 0, has_before_after: false };
  return {
   ...r,
   photo_count: pm.count,
   has_before_after: pm.has_before_after,
   completed_year: r.end_date_actual ? String(r.end_date_actual).slice(0, 4) : null,
  };
 });

 const [b] = await pool.query(
  'SELECT first_name, last_name, company FROM builders WHERE id = ?',
  [builderId]
 );
 const builderName =
  b[0]?.company || [b[0]?.first_name, b[0]?.last_name].filter(Boolean).join(' ') || '';

 return { data, builderName };
}

export async function listBuilderHistory(req, res) {
 try {
 const pool = await getDBConnection();
 const { data } = await fetchBuilderHistoryProjects(pool, req.builderAuth.builderId);
 res.json({
  success: true,
  data,
  summary: summarizeBuilderHistory(data),
 });
 } catch (e) {
 res.status(500).json({ success: false, error: e.message });
 }
}

export async function getBuilderHistoryPdf(req, res) {
 try {
 const pool = await getDBConnection();
 const builderId = req.builderAuth.builderId;
 const { data, builderName } = await fetchBuilderHistoryProjects(pool, builderId);
 const year = req.query.year ? String(req.query.year) : '';
 const q = req.query.q ? String(req.query.q) : '';
 const filtered = filterBuilderHistoryRows(data, { year, q });
 const summary = summarizeBuilderHistory(filtered);
 const filterParts = [];
 if (year) filterParts.push(`Year ${year}`);
 if (q.trim()) filterParts.push(`Search "${q.trim()}"`);
 const filterLabel = filterParts.length ? filterParts.join('  ') : 'All completed projects';

 const pdfBuf = await buildBuilderHistoryPdfBuffer({
  projects: filtered.map((p) => ({
   ...p,
   name: sanitizePdfText(p.name),
   address: sanitizePdfText(p.address),
   flooring_type: sanitizePdfText(p.flooring_type),
   project_number: sanitizePdfText(p.project_number),
  })),
  summary,
  builderName: sanitizePdfText(builderName),
  filterLabel: sanitizePdfText(filterLabel),
 });

 const stamp = new Date().toISOString().slice(0, 10);
 res.setHeader('Content-Type', 'application/pdf');
 res.setHeader(
  'Content-Disposition',
  `attachment; filename="senior-floors-completed-projects-${stamp}.pdf"`
 );
 res.send(pdfBuf);
 } catch (e) {
 console.error('getBuilderHistoryPdf:', e);
 res.status(500).json({ success: false, error: e.message });
 }
}

function parseEstimateServices(raw) {
 if (!raw) return [];
 try {
  const j = typeof raw === 'string' ? JSON.parse(raw) : raw;
  return Array.isArray(j) ? j.filter(Boolean) : [];
 } catch {
  return [];
 }
}

function buildLeadReferralEvents(lead) {
 const events = [
  {
   status: 'new_lead',
   note: 'Referral received',
   created_at: lead.created_at,
  },
 ];
 const created = String(lead.created_at || '').slice(0, 19);
 const updated = String(lead.updated_at || '').slice(0, 19);
 if (updated && updated !== created && lead.status) {
  events.push({
   status: lead.status,
   note: 'Status updated',
   created_at: lead.updated_at,
  });
 }
 return events;
}

async function loadReferralValueByLead(pool, leadIds) {
 const out = { project: {}, quote: {}, estimated: {} };
 if (!leadIds.length) return out;

 if (await tableExists(pool, 'projects')) {
  const hasCv = await columnExists(pool, 'projects', 'contract_value');
  const hasLead = await columnExists(pool, 'projects', 'lead_id');
  if (hasCv && hasLead) {
   const del = (await columnExists(pool, 'projects', 'deleted_at'))
    ? ' AND (deleted_at IS NULL)'
    : '';
   const [rows] = await pool.query(
    `SELECT lead_id, SUM(COALESCE(contract_value, 0)) AS v
     FROM projects WHERE lead_id IN (${leadIds.map(() => '?').join(',')})${del}
     GROUP BY lead_id`,
    leadIds
   );
   rows.forEach((r) => {
    out.project[r.lead_id] = Number(r.v) || 0;
   });
  }
 }

 if (await tableExists(pool, 'quotes')) {
  const hasAmt = await columnExists(pool, 'quotes', 'total_amount');
  const hasLead = await columnExists(pool, 'quotes', 'lead_id');
  if (hasAmt && hasLead) {
   const [rows] = await pool.query(
    `SELECT lead_id, MAX(COALESCE(total_amount, 0)) AS v
     FROM quotes WHERE lead_id IN (${leadIds.map(() => '?').join(',')})
     GROUP BY lead_id`,
    leadIds
   );
   rows.forEach((r) => {
    out.quote[r.lead_id] = Number(r.v) || 0;
   });
  }
 }

 return out;
}

function referralValueAmount(item, valueMaps) {
 const lid = item.lead_id;
 if (!lid) return 0;
 const st = normalizeEstimateStatus(item.status);
 const proj = valueMaps.project[lid] || 0;
 const quote = valueMaps.quote[lid] || 0;
 const est = Number(item.estimated_value) || 0;
 if (st === 'won') return Math.max(proj, quote, est);
 if (st === 'quoted') return Math.max(quote, est);
 return 0;
}

export async function listBuilderReferrals(req, res) {
 try {
 const pool = await getDBConnection();
 const builderId = req.builderAuth.builderId;
 const referrals = [];

 const hasReferring = await columnExists(pool, 'leads', 'referring_builder_id');
 if (hasReferring) {
  const leadCols = ['id', 'name', 'email', 'status', 'created_at', 'notes'];
  if (await columnExists(pool, 'leads', 'address')) leadCols.push('address');
  if (await columnExists(pool, 'leads', 'updated_at')) leadCols.push('updated_at');
  if (await columnExists(pool, 'leads', 'estimated_value')) leadCols.push('estimated_value');
  const [leads] = await pool.query(
   `SELECT ${leadCols.join(', ')}
    FROM leads WHERE referring_builder_id = ?
    ORDER BY created_at DESC LIMIT 50`,
   [builderId]
  );
  leads.forEach((l) => {
   const services = [];
   referrals.push({
    type: 'lead',
    id: l.id,
    ref_number: null,
    title: l.name,
    status: l.status,
    created_at: l.created_at,
    updated_at: l.updated_at || l.created_at,
    address: l.address || null,
    services,
    services_label: services.length ? services.join(', ') : null,
    area_sqft: null,
    lead_id: l.id,
    estimated_value: l.estimated_value,
    events: buildLeadReferralEvents(l),
   });
  });
 }

 const estCols = [
  'id',
  'ref_number',
  'status',
  'address',
  'services',
  'area_sqft',
  'created_at',
  'updated_at',
  'lead_id',
 ];
 const [ests] = await pool.query(
  `SELECT ${estCols.join(', ')}
   FROM estimate_requests WHERE builder_id = ?
   ORDER BY created_at DESC LIMIT 50`,
  [builderId]
 );
 const estIds = ests.map((e) => e.id);
 const eventsByEst = {};
 if (estIds.length && (await tableExists(pool, 'estimate_request_events'))) {
  const [ev] = await pool.query(
   `SELECT * FROM estimate_request_events WHERE estimate_request_id IN (${estIds.map(() => '?').join(',')}) ORDER BY created_at ASC`,
   estIds
  );
  ev.forEach((row) => {
   if (!eventsByEst[row.estimate_request_id]) eventsByEst[row.estimate_request_id] = [];
   eventsByEst[row.estimate_request_id].push(row);
  });
 }

 ests.forEach((e) => {
  const services = parseEstimateServices(e.services);
  referrals.push({
   type: 'estimate',
   id: e.id,
   ref_number: e.ref_number,
   title: e.ref_number,
   status: e.status,
   created_at: e.created_at,
   updated_at: e.updated_at || e.created_at,
   address: e.address,
   services,
   services_label: services.length ? services.join(', ') : null,
   area_sqft: e.area_sqft,
   lead_id: e.lead_id,
   estimated_value: null,
   events:
    eventsByEst[e.id]?.length > 0
     ? eventsByEst[e.id]
     : [{ status: e.status || 'pending', note: 'Request submitted', created_at: e.created_at }],
  });
 });

 referrals.sort((a, b) => new Date(b.updated_at || b.created_at) - new Date(a.updated_at || a.created_at));

 const leadIds = [...new Set(referrals.map((r) => r.lead_id).filter(Boolean))];
 const valueMaps = await loadReferralValueByLead(pool, leadIds);
 referrals.forEach((r) => {
  r.value_amount = Math.round(referralValueAmount(r, valueMaps) * 100) / 100;
 });

 const converted = referrals.filter((r) => normalizeEstimateStatus(r.status) === 'won').length;
 let valueGenerated = 0;
 referrals.forEach((r) => {
  valueGenerated += Number(r.value_amount) || 0;
 });
 valueGenerated = Math.round(valueGenerated * 100) / 100;

 const commissionPct = parseFloat(process.env.BUILDER_REFERRAL_COMMISSION_PCT || '0', 10);
 const commissionActive = Number.isFinite(commissionPct) && commissionPct > 0;
 const commissionAccrued = commissionActive
  ? Math.round(((valueGenerated * commissionPct) / 100) * 100) / 100
  : 0;

 res.json({
  success: true,
  data: referrals,
  summary: {
   submitted: referrals.length,
   converted,
   value_generated: valueGenerated,
   commission_accrued: commissionAccrued,
   commission_pct: commissionActive ? commissionPct : null,
   note: commissionActive
    ? null
    : 'Commission tracking will appear when your referral program is active.',
  },
 });
 } catch (e) {
 res.status(500).json({ success: false, error: e.message });
 }
}

export async function listBuilderEstimatesSelf(req, res) {
 try {
 const pool = await getDBConnection();
 const [rows] = await pool.query(
 'SELECT id, ref_number, status, address, area_sqft, created_at, lead_id FROM estimate_requests WHERE builder_id = ? ORDER BY created_at DESC',
 [req.builderAuth.builderId]
 );
 res.json({ success: true, data: rows });
 } catch (e) {
 res.status(500).json({ success: false, error: e.message });
 }
}

export function registerBuilderEstimateRoutes(app) {
 app.post(
 '/api/estimate-requests',
 requireBuilderAuth,
 (req, res, next) => {
 uploadEstimateFiles.array('attachments', 5)(req, res, (err) => {
 if (err) return res.status(400).json({ success: false, error: err.message });
 next();
 });
 },
 postEstimateRequest
 );
 app.get('/api/estimate-requests/mine', requireBuilderAuth, listBuilderEstimatesSelf);
 app.get('/api/estimate-requests', requireAuth, requirePermission('builders.view'), listEstimateRequestsAdmin);
 app.put('/api/estimate-requests/:id', requireAuth, requirePermission('builders.edit'), updateEstimateRequest);

 app.post('/api/pricing/calculate', requireBuilderAuth, postPricingCalculate);
 app.get('/api/builder-history', requireBuilderAuth, listBuilderHistory);
 app.get('/api/builder-history/pdf', requireBuilderAuth, getBuilderHistoryPdf);
 app.get('/api/builder-referrals', requireBuilderAuth, listBuilderReferrals);
}
