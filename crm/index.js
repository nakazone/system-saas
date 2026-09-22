/**
 * Senior Floors System — Node.js API for Railway
 * Receives leads from LP (Vercel), CRM APIs (leads list/get/update), db-check
 * Admin panel with authentication
 */
import 'dotenv/config';
import express from 'express';
import 'express-async-errors';
import rateLimit from 'express-rate-limit';
import cors from 'cors';
import session from 'express-session';
import MySQLStoreFactory from 'express-mysql-session';
import path from 'path';
import { fileURLToPath } from 'url';
import { handleReceiveLead, handleReceiveLeadBatch } from './routes/receiveLead.js';
import { handleDbCheck } from './routes/dbCheck.js';
import {
  listLeads,
  getLead,
  createLead,
  updateLead,
  deleteLead,
  getLeadsQuoteEngagementSummary,
  getLeadVisitCalendar,
} from './routes/leads.js';
import { login, logout, checkSession, changePassword } from './routes/auth.js';
import { requireAuth, requireRole, requirePermission } from './middleware/auth.js';
import {
  listCustomers,
  getCustomer,
  getCustomerInsight,
  createCustomer,
  updateCustomer,
  getCustomerByLead,
  createCustomerFromLead,
} from './routes/customers.js';
import {
  listQuotes,
  getQuote,
  createQuote,
  updateQuote,
  deleteQuote,
  createQuoteFromInvoicePdf,
  streamQuoteInvoicePdf,
  listQuoteBuildersLookup,
} from './routes/quotes.js';
import * as quoteExt from './routes/quoteExtended.js';
import { registerQuoteInvoiceRoutes } from './routes/quoteInvoices.js';
import { registerQuoteSignatureRoutes } from './routes/quoteSignatures.js';
import { getEmailTransportStatus } from './modules/quotes/quoteMail.js';
import * as erpMaterials from './routes/erpMaterials.js';
import * as publicQuote from './routes/publicQuote.js';
import { isPublicQuoteNumberPath } from './lib/publicQuoteUrl.js';
import { quotePdfUploadMiddleware } from './lib/quotePdfUpload.js';
import projectsRouter from './routes/projects.js';
import builderPaymentForecastsRouter from './routes/builderPaymentForecasts.js';
import { listVisits, getVisit, createVisit, updateVisit } from './routes/visits.js';
import { listActivities, createActivity } from './routes/activities.js';
import { listContracts, getContract, createContract, updateContract } from './routes/contracts.js';
import {
  listUsers,
  getUser,
  createUser,
  updateUser,
  deleteUser,
  getUserPermissions,
  updateUserPermissions,
  postUserAvatar,
} from './routes/users.js';
import { uploadUserAvatar } from './lib/userAvatarUpload.js';
import { listPermissionRegistry } from './routes/permissions.js';
import { getDashboardStats, getDashboardDebug, fixDashboardOrphanLeads } from './routes/dashboard.js';
import marketingRouter from './routes/marketing.js';
import { getQualification, createOrUpdateQualification } from './routes/qualification.js';
import { listInteractions, createInteraction } from './routes/interactions.js';
import { getMeasurement, createOrUpdateMeasurement } from './routes/measurements.js';
import { listProposals, getProposal, createProposal, updateProposal } from './routes/proposals.js';
import { listFollowups, createFollowup, updateFollowup, deleteFollowup } from './routes/followups.js';
import { listPipelineStages } from './routes/pipelineStages.js';
import { listEstimates, getEstimate, createEstimate, updateEstimate, deleteEstimate, getEstimateAnalytics } from './routes/estimates.js';
import { listCrews, getCrew, createCrew, updateCrew } from './routes/crews.js';
import { listSchedules, getSchedule, createSchedule, updateSchedule, simulateScheduleOptions, getCrewAvailability } from './routes/schedules.js';
import {
  googleCalendarStatus,
  googleCalendarOAuthStart,
  googleCalendarOAuthCallback,
} from './routes/googleCalendarIntegration.js';
import {
  getProjectFinancial,
  updateProjectFinancial,
  listExpenses,
  createExpense,
  getExpense,
  updateExpense,
  approveExpense,
  deleteExpense,
  listPayrollEntries,
  createPayrollEntry,
  approvePayrollEntry,
  getFinancialDashboard,
} from './routes/financials.js';
import {
  financialPlRouter,
  vendorsRouter,
  operationalCostsRouter,
  paymentReceiptsRouter,
  uploadExpenseReceipt,
  postExpenseReceiptAttachment,
} from './routes/financial-complete.js';
import * as constructionPayroll from './routes/constructionPayroll.js';
import {
  getDBConnection,
  getMysqlConnectionTargetInfo,
  verifyMysqlPoolConnectivity,
  resetDbPool,
  isDatabaseConfigured,
  isMysqlInfrastructureError,
  isRailwayPublicMysqlHostname,
  isLikelyRailwayAppContainer,
} from './config/db.js';
import { getHealth } from './routes/health.js';
import { ensureQuoteInvoicePdfColumn } from './lib/ensureQuoteInvoicePdfColumn.js';
import { ensureQuoteInvoicesSchema } from './lib/ensureQuoteInvoicesSchema.js';
import { ensureQuotePdfViewedColumn } from './lib/ensureQuotePdfViewedColumn.js';
import { ensureQuoteNumberOffset } from './lib/ensureQuoteNumberOffset.js';
import { ensureQuoteSignatureSchema } from './lib/ensureQuoteSignatureSchema.js';
import { ensureQuotePartySchema } from './lib/ensureQuotePartySchema.js';
import { ensureQuoteClientPublishSchema } from './lib/ensureQuoteClientPublishSchema.js';
import { ensureUserModuleColumns } from './lib/ensureUserModuleColumns.js';
import { ensureCustomersResponsibleNameColumn } from './lib/ensureCustomersResponsibleNameColumn.js';
import { ensureLeadPipelineStageEnteredAt } from './lib/ensureLeadPipelineStageEnteredAt.js';
import { ensurePayrollTimesheetDailyOverrideColumn } from './lib/ensurePayrollTimesheetDailyOverrideColumn.js';
import { ensurePayrollEmployeeAllowOutsidePeriodColumn } from './lib/ensurePayrollEmployeeAllowOutsidePeriodColumn.js';
import { ensureBuilderPaymentForecastsTable } from './lib/ensureBuilderPaymentForecastsTable.js';
import { ensureBuilderPortalSchema } from './lib/ensureBuilderPortalSchema.js';
import { ensureProjectChildTables } from './lib/ensureProjectChildTables.js';
import { registerBuilderAuthRoutes } from './routes/builderAuth.js';
import { registerBuilderNotificationRoutes } from './routes/builderNotifications.js';
import { registerBuilderCalculationRoutes } from './routes/builderCalculations.js';
import { registerBuilderRoutes } from './routes/builders.js';
import { registerBuilderPortalProjectRoutes } from './routes/builderPortalProjects.js';
import { registerBuilderPortalExtraRoutes } from './routes/builderPortalExtras.js';
import { registerBuilderDocumentRoutes } from './routes/builderDocuments.js';
import { registerBuilderCalendarRoutes } from './routes/builderCalendar.js';
import { registerBuilderPricingRoutes } from './routes/builderPricing.js';
import { registerBuilderGalleryRoutes } from './routes/builderGallery.js';
import { registerBuilderMessagesRoutes } from './routes/builderMessages.js';
import { registerBuilderEstimateRoutes } from './routes/builderEstimates.js';
import { registerBuilderClientReportRoutes } from './routes/builderClientReport.js';
import { registerBuilderEvaluationRoutes } from './routes/builderEvaluations.js';
import { ensureFinancialCompleteSchema } from './lib/ensureFinancialCompleteSchema.js';
import { getUiConfig } from './routes/uiConfig.js';

function validateEnv() {
  const missing = [];
  if (!process.env.SESSION_SECRET?.trim()) {
    missing.push('SESSION_SECRET');
  }
  const dbKeys = ['DB_HOST', 'DB_NAME', 'DB_USER', 'DB_PASS'];
  const allDbVarsSet = dbKeys.every((key) => process.env[key]?.trim());
  if (!allDbVarsSet && !isDatabaseConfigured()) {
    dbKeys.forEach((key) => {
      if (!process.env[key]?.trim()) {
        missing.push(key);
      }
    });
  }
  if (missing.length) {
    console.error('[boot] Variáveis de ambiente em falta ou vazias:');
    missing.forEach((k) => console.error(`  - ${k}`));
    console.error(
      '[boot] Para MySQL: preencha DB_HOST, DB_NAME, DB_USER e DB_PASS, ou use DATABASE_URL / variáveis MYSQL* (Railway).'
    );
    process.exit(1);
  }
}

validateEnv();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const mysqlPool = await getDBConnection();
if (!mysqlPool) {
  console.error('[boot] Não foi possível criar o pool MySQL (ver credenciais e conectividade).');
  process.exit(1);
}

const MySQLStore = MySQLStoreFactory(session);
const sessionStore = new MySQLStore(
  {
    createDatabaseTable: true,
    clearExpired: true,
    checkExpirationInterval: 900000,
    endConnectionOnClose: false,
  },
  mysqlPool
);

const loginLimiter = rateLimit({
  windowMs: 60000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler(req, res) {
    res.status(429).json({
      error: true,
      message: 'Muitas tentativas de início de sessão a partir deste IP. Aguarde um minuto.',
    });
  },
});

const receiveLeadLimiter = rateLimit({
  windowMs: 60000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  handler(req, res) {
    res.status(429).json({
      error: true,
      message: 'Limite de envio de leads excedido para este IP. Aguarde um minuto.',
    });
  },
});

const apiLimiter = rateLimit({
  windowMs: 60000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  handler(req, res) {
    res.status(429).json({
      error: true,
      message: 'Limite de pedidos à API excedido para este IP. Aguarde um minuto.',
    });
  },
});

const app = express();
const rawPort = process.env.PORT;
const PORT =
  rawPort !== undefined && rawPort !== null && String(rawPort).trim() !== ''
    ? parseInt(String(rawPort), 10)
    : 3000;
if (!Number.isFinite(PORT) || PORT < 1 || PORT > 65535) {
  console.error('[boot] PORT inválido:', rawPort);
  process.exit(1);
}

// res.json não serializa BigInt (quebra APIs/sessão se algum campo escapar)
app.set('json replacer', (_, value) => (typeof value === 'bigint' ? value.toString() : value));

// UTF-8 explícito em JSON (evita ? em acentos no cliente quando o proxy omite charset)
app.use((req, res, next) => {
  const sendJson = res.json.bind(res);
  res.json = (body) => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return sendJson(body);
  };
  next();
});

// Railway / reverse proxy — necessário para cookie Secure e req.secure corretos
app.set('trust proxy', 1);

const isProduction = process.env.NODE_ENV === 'production' || !!process.env.RAILWAY_ENVIRONMENT;
// UI em outro domínio (ex.: Vercel) chamando API no Railway: defina SESSION_CROSS_SITE=1 (cookie SameSite=None; Secure)
const crossSiteSession = process.env.SESSION_CROSS_SITE === '1' || process.env.SESSION_CROSS_SITE === 'true';

const sessionMiddleware = session({
  store: sessionStore,
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  name: 'seniorfloors.sid',
  rolling: true,
  cookie: {
    secure: crossSiteSession || isProduction,
    httpOnly: true,
    sameSite: crossSiteSession ? 'none' : 'lax',
    maxAge: 24 * 60 * 60 * 1000,
  },
});

app.use(cors({
  origin: true,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Accept', 'Authorization', 'X-Requested-With', 'X-Sheets-Sync', 'X-Sheets-Sync-Secret'],
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/**
 * Rotas de diagnóstico sem sessão MySQL — assim consegue abrir /api/health/db mesmo quando
 * express-mysql-session falha (mesmo sintoma que o 503 "base de dados").
 */
function skipsMysqlSessionMiddleware(req) {
  if (req.method !== 'GET') return false;
  const p = req.path || '';
  return (
    p === '/api/health' ||
    p === '/api/health/' ||
    p === '/api/health/db' ||
    p === '/api/health/db/' ||
    p === '/api/health/email' ||
    p === '/api/health/email/'
  );
}

app.use((req, res, next) => {
  if (skipsMysqlSessionMiddleware(req)) return next();
  return sessionMiddleware(req, res, next);
});

function shouldSkipGeneralApiRateLimit(req) {
  if (!req.path.startsWith('/api')) return true;
  if (req.method === 'GET' && skipsMysqlSessionMiddleware(req)) return true;
  if (req.method === 'POST' && req.path === '/api/auth/login') return true;
  if (
    req.method === 'POST' &&
    (req.path === '/api/receive-lead' || req.path === '/api/receive-lead-batch')
  ) {
    return true;
  }
  return false;
}

app.use((req, res, next) => {
  if (shouldSkipGeneralApiRateLimit(req)) return next();
  return apiLimiter(req, res, next);
});

// Root route - redirect to admin or show API info
app.get('/', (req, res) => {
  if (req.session && req.session.userId) {
    return res.redirect('/dashboard.html');
  }
  res.redirect('/login.html');
});

// Authentication routes (public)
app.post('/api/auth/login', loginLimiter, login);
app.post('/api/auth/logout', logout);
app.get('/api/auth/session', checkSession);
app.post('/api/auth/change-password', requireAuth, changePassword);

// Public API routes (LP can call these)
app.get('/api/db-check', handleDbCheck);
app.post('/api/receive-lead', receiveLeadLimiter, handleReceiveLead);
app.post('/api/receive-lead-batch', receiveLeadLimiter, handleReceiveLeadBatch);
app.get('/api/health', getHealth);

/** Ligação real ao MySQL (diagnóstico Railway). Sem credenciais na resposta. */
app.get('/api/health/email', (req, res) => {
  res.json({ ok: true, ...getEmailTransportStatus(), time: new Date().toISOString() });
});

app.get('/api/health/db', async (req, res) => {
  const target = getMysqlConnectionTargetInfo();
  const body = {
    ok: false,
    configured: target.configured,
    host: target.host,
    port: target.port,
    database: target.database,
    error_code: null,
    message: null,
  };
  try {
    if (!target.configured) {
      body.message = 'MySQL não configurado (sem DATABASE_URL / DB_* / MYSQL* válidos).';
      return res.status(503).json(body);
    }
    const pool = await getDBConnection();
    if (!pool) {
      body.message = 'Pool não disponível.';
      return res.status(503).json(body);
    }
    await pool.query('SELECT 1');
    body.ok = true;
    body.message = 'MySQL respondeu.';
    res.json(body);
  } catch (e) {
    body.error_code = e.code || null;
    body.message = e.message || String(e);
    if (
      (e.code === 'ETIMEDOUT' || e.code === 'ECONNREFUSED') &&
      isRailwayPublicMysqlHostname(body.host) &&
      isLikelyRailwayAppContainer()
    ) {
      body.hint =
        'No serviço Node use DATABASE_URL com mysql.railway.internal (variável de referência ao MySQL). O hostname *.up.railway.app é para acesso fora da Railway e costuma dar ETIMEDOUT entre serviços.';
    }
    res.status(503).json(body);
  }
});

// Public quote (no auth) — número legível SF-2026-001 (Q- legado) ou token
app.get('/api/public/quotes/by-number/:quoteNumber/owner-signature', publicQuote.getPublicQuoteOwnerSignatureByNumber);
app.get('/api/public/quotes/by-number/:quoteNumber/client-signature', publicQuote.getPublicQuoteClientSignatureByNumber);
app.get('/api/public/quotes/by-number/:quoteNumber', publicQuote.getPublicQuoteByNumber);
app.get('/api/public/quotes/by-number/:quoteNumber/pdf', publicQuote.getPublicQuotePdfByNumber);
app.post('/api/public/quotes/by-number/:quoteNumber/approve', publicQuote.postApproveQuoteByNumber);
app.get('/api/public/quotes/:token/owner-signature', publicQuote.getPublicQuoteOwnerSignatureByToken);
app.get('/api/public/quotes/:token/client-signature', publicQuote.getPublicQuoteClientSignatureByToken);
app.get('/api/public/quotes/:token', publicQuote.getPublicQuote);
app.get('/api/public/quotes/:token/pdf', publicQuote.getPublicQuotePdf);
app.post('/api/public/quotes/:token/approve', publicQuote.postApproveQuote);

// Protected API routes (require authentication)

// Dashboard
app.get('/api/dashboard/stats', requireAuth, getDashboardStats);
app.get('/api/dashboard/debug', requireAuth, getDashboardDebug);
app.get('/api/dashboard/fix-orphan-leads', requireAuth, requireRole('admin'), fixDashboardOrphanLeads);

// Marketing (router inclui requireAuth + reports.view)
app.use('/api/marketing', marketingRouter);

// Pipeline Stages
app.get('/api/pipeline-stages', requireAuth, listPipelineStages);

// Leads (rotas com subpath primeiro, depois :id)
app.get('/api/leads', requireAuth, listLeads);
app.get('/api/leads/quote-engagement-summary', requireAuth, getLeadsQuoteEngagementSummary);
app.get('/api/leads/:leadId/qualification', requireAuth, getQualification);
app.post('/api/leads/:leadId/qualification', requireAuth, createOrUpdateQualification);
app.put('/api/leads/:leadId/qualification', requireAuth, createOrUpdateQualification);
app.get('/api/leads/:leadId/interactions', requireAuth, listInteractions);
app.post('/api/leads/:leadId/interactions', requireAuth, createInteraction);
app.get('/api/leads/:leadId/followups', requireAuth, listFollowups);
app.post('/api/leads/:leadId/followups', requireAuth, createFollowup);
app.get('/api/leads/:leadId/proposals', requireAuth, listProposals);
app.post('/api/leads/:leadId/proposals', requireAuth, createProposal);
app.get('/api/leads/:leadId/calendar.ics', requireAuth, getLeadVisitCalendar);
app.get('/api/leads/:id', requireAuth, getLead);
app.post('/api/leads', requireAuth, createLead);
app.put('/api/leads/:id', requireAuth, updateLead);
app.delete('/api/leads/:id', requireAuth, deleteLead);

// Follow-ups (por ID de follow-up)
app.put('/api/followups/:followupId', requireAuth, updateFollowup);
app.delete('/api/followups/:followupId', requireAuth, deleteFollowup);

// Proposals
app.get('/api/proposals/:proposalId', requireAuth, getProposal);
app.put('/api/proposals/:proposalId', requireAuth, updateProposal);

// Customers
app.get('/api/customers/by-lead/:leadId', requireAuth, getCustomerByLead);
app.post('/api/customers/from-lead', requireAuth, requirePermission('customers.create'), createCustomerFromLead);
app.get('/api/customers', requireAuth, listCustomers);
app.get('/api/customers/:id/insight', requireAuth, getCustomerInsight);
app.get('/api/customers/:id', requireAuth, getCustomer);
app.post('/api/customers', requireAuth, requirePermission('customers.create'), createCustomer);
app.put('/api/customers/:id', requireAuth, requirePermission('customers.edit'), updateCustomer);

// Quotes (rotas específicas antes de :id)
app.get('/api/quotes', requireAuth, listQuotes);
app.get('/api/quotes/lookup/builders', requireAuth, requirePermission('quotes.view'), listQuoteBuildersLookup);
app.post('/api/quotes/import-invoice-pdf', requireAuth, quotePdfUploadMiddleware, createQuoteFromInvoicePdf);
app.post('/api/quotes/full', requireAuth, requirePermission('quotes.create'), quoteExt.postQuoteCreateFull);
app.post('/api/quotes/from-template', requireAuth, requirePermission('quotes.create'), quoteExt.postQuoteFromTemplate);
app.get('/api/quote-catalog', requireAuth, requirePermission('quotes.view'), quoteExt.getQuoteCatalog);
app.post('/api/quote-catalog', requireAuth, requirePermission('quotes.edit'), quoteExt.postQuoteCatalog);
app.put('/api/quote-catalog/:id', requireAuth, requirePermission('quotes.edit'), quoteExt.putQuoteCatalog);
app.delete('/api/quote-catalog/:id', requireAuth, requirePermission('quotes.edit'), quoteExt.deleteQuoteCatalog);
app.get('/api/quote-templates', requireAuth, requirePermission('quotes.view'), quoteExt.getQuoteTemplates);
app.get('/api/quote-templates/:id', requireAuth, requirePermission('quotes.view'), quoteExt.getQuoteTemplate);
app.post('/api/quote-templates', requireAuth, requirePermission('quotes.edit'), quoteExt.postQuoteTemplate);
app.delete('/api/quote-templates/:id', requireAuth, requirePermission('quotes.edit'), quoteExt.deleteQuoteTemplate);

app.get('/api/config/ui', requireAuth, getUiConfig);
app.get('/api/erp/category-margins', requireAuth, requirePermission('quotes.view'), erpMaterials.getCategoryMargins);
app.put('/api/erp/category-margins', requireAuth, requirePermission('quotes.edit'), erpMaterials.putCategoryMargin);
app.get('/api/erp/suppliers', requireAuth, requirePermission('quotes.view'), erpMaterials.listSuppliersApi);
app.post('/api/erp/suppliers', requireAuth, requirePermission('quotes.edit'), erpMaterials.postSupplier);
app.put('/api/erp/suppliers/:id', requireAuth, requirePermission('quotes.edit'), erpMaterials.putSupplier);
app.delete('/api/erp/suppliers/:id', requireAuth, requirePermission('quotes.edit'), erpMaterials.deleteSupplier);
app.get('/api/erp/products/preview/:id', requireAuth, requirePermission('quotes.view'), erpMaterials.getProductPricingPreview);
app.get('/api/erp/products', requireAuth, requirePermission('quotes.view'), erpMaterials.listProductsApi);
app.post('/api/erp/products', requireAuth, requirePermission('quotes.edit'), erpMaterials.postProduct);
app.put('/api/erp/products/:id', requireAuth, requirePermission('quotes.edit'), erpMaterials.putProduct);
app.delete('/api/erp/products/:id', requireAuth, requirePermission('quotes.edit'), erpMaterials.deleteProduct);
app.get('/api/quotes/:id/invoice-pdf', requireAuth, streamQuoteInvoicePdf);
app.put('/api/quotes/:id/full', requireAuth, requirePermission('quotes.edit'), quoteExt.putQuoteSaveFull);
app.post('/api/quotes/:id/duplicate', requireAuth, requirePermission('quotes.create'), quoteExt.postQuoteDuplicate);
app.post('/api/quotes/:id/generate-pdf', requireAuth, requirePermission('quotes.edit'), quoteExt.postQuoteGeneratePdf);
app.post('/api/quotes/:id/send-email', requireAuth, requirePermission('quotes.edit'), quoteExt.postQuoteSendEmail);
app.post('/api/quotes/:id/publish-client', requireAuth, requirePermission('quotes.edit'), quoteExt.postQuotePublishClient);
app.post('/api/quotes/:id/mark-sent', requireAuth, requirePermission('quotes.edit'), quoteExt.postQuoteMarkSent);
app.get('/api/quotes/:id/engagement', requireAuth, requirePermission('quotes.view'), quoteExt.getQuoteEngagement);
app.get('/api/quotes/:id/snapshots', requireAuth, requirePermission('quotes.view'), quoteExt.getQuoteSnapshots);
registerQuoteInvoiceRoutes(app);
registerQuoteSignatureRoutes(app);
app.get('/api/quotes/:id', requireAuth, getQuote);
app.post('/api/quotes', requireAuth, createQuote);
app.put('/api/quotes/:id', requireAuth, updateQuote);
app.delete('/api/quotes/:id', requireAuth, requirePermission('quotes.edit'), deleteQuote);

// Estimates (Professional Flooring Estimate Engine)
app.get('/api/estimates', requireAuth, listEstimates);
app.get('/api/estimates/:id', requireAuth, getEstimate);
app.post('/api/estimates', requireAuth, createEstimate);
app.put('/api/estimates/:id', requireAuth, updateEstimate);
app.delete('/api/estimates/:id', requireAuth, deleteEstimate);
app.get('/api/estimates/analytics/overview', requireAuth, getEstimateAnalytics);

// Financial (antes do router /api/projects para não colidir com /:id)
app.get('/api/projects/:projectId/financial', requireAuth, getProjectFinancial);
app.put('/api/projects/:projectId/financial', requireAuth, updateProjectFinancial);

// Projects (router completo: lista, custos, checklist, fotos, P&L, etc.)
app.use('/api/projects', projectsRouter);
app.use('/api/builder-payment-forecasts', builderPaymentForecastsRouter);
registerBuilderAuthRoutes(app);
registerBuilderNotificationRoutes(app);
registerBuilderCalculationRoutes(app);
registerBuilderPortalProjectRoutes(app);
registerBuilderPortalExtraRoutes(app);
registerBuilderDocumentRoutes(app);
registerBuilderCalendarRoutes(app);
registerBuilderPricingRoutes(app);
registerBuilderGalleryRoutes(app);
registerBuilderMessagesRoutes(app);
registerBuilderEstimateRoutes(app);
registerBuilderRoutes(app);

// Visits/Schedule
app.get('/api/visits', requireAuth, listVisits);
app.get('/api/visits/:id', requireAuth, getVisit);
app.post('/api/visits', requireAuth, createVisit);
app.put('/api/visits/:id', requireAuth, updateVisit);

// Crews
app.get('/api/crews', requireAuth, listCrews);
app.get('/api/crews/:id', requireAuth, getCrew);
app.post('/api/crews', requireAuth, createCrew);
app.put('/api/crews/:id', requireAuth, updateCrew);

// Google Calendar (CRM → Google)
app.get('/api/integrations/google-calendar/status', requireAuth, googleCalendarStatus);
app.get('/api/integrations/google-calendar/oauth-url', requireAuth, requireRole('admin'), googleCalendarOAuthStart);
app.get('/api/integrations/google-calendar/callback', googleCalendarOAuthCallback);

// Project Schedules (Smart Scheduling)
app.get('/api/schedules', requireAuth, listSchedules);
app.get('/api/schedules/:id', requireAuth, getSchedule);
app.post('/api/schedules', requireAuth, createSchedule);
app.put('/api/schedules/:id', requireAuth, updateSchedule);
app.post('/api/schedules/simulate', requireAuth, simulateScheduleOptions);
app.get('/api/crews/:crewId/availability', requireAuth, getCrewAvailability);

// Measurements (from visits)
app.get('/api/visits/:visitId/measurement', requireAuth, getMeasurement);
app.post('/api/visits/:visitId/measurement', requireAuth, createOrUpdateMeasurement);
app.put('/api/visits/:visitId/measurement', requireAuth, createOrUpdateMeasurement);

// Activities
app.get('/api/activities', requireAuth, listActivities);
app.post('/api/activities', requireAuth, createActivity);

// Contracts/Financeiro
app.get('/api/contracts', requireAuth, listContracts);
app.get('/api/contracts/:id', requireAuth, getContract);
app.post('/api/contracts', requireAuth, createContract);
app.put('/api/contracts/:id', requireAuth, updateContract);

// Financial Management
app.get('/api/expenses', requireAuth, listExpenses);
app.get('/api/expenses/:id', requireAuth, getExpense);
app.post('/api/expenses', requireAuth, createExpense);
app.put('/api/expenses/:id', requireAuth, updateExpense);
app.post(
  '/api/expenses/:id/receipt',
  requireAuth,
  uploadExpenseReceipt.single('file'),
  postExpenseReceiptAttachment
);
app.put('/api/expenses/:id/approve', requireAuth, approveExpense);
app.delete('/api/expenses/:id', requireAuth, deleteExpense);
app.get('/api/payroll', requireAuth, listPayrollEntries);
app.post('/api/payroll', requireAuth, createPayrollEntry);
app.put('/api/payroll/:id/approve', requireAuth, approvePayrollEntry);
app.get('/api/financial/dashboard', requireAuth, getFinancialDashboard);
app.use('/api/financial', financialPlRouter);
app.use('/api/vendors', vendorsRouter);
app.use('/api/operational-costs', operationalCostsRouter);
app.use('/api/payment-receipts', paymentReceiptsRouter);

// Construction payroll v2 (field employees + timesheets + periods)
app.get(
  '/api/construction-payroll/dashboard/summary',
  requireAuth,
  requirePermission('payroll.view'),
  constructionPayroll.getPayrollDashboard
);
app.get('/api/construction-payroll/employees', requireAuth, requirePermission('payroll.view'), constructionPayroll.listEmployees);
app.get('/api/construction-payroll/employees/:id', requireAuth, requirePermission('payroll.view'), constructionPayroll.getEmployee);
app.post('/api/construction-payroll/employees', requireAuth, requirePermission('payroll.manage'), constructionPayroll.createEmployee);
app.put('/api/construction-payroll/employees/:id', requireAuth, requirePermission('payroll.manage'), constructionPayroll.updateEmployee);
app.delete(
  '/api/construction-payroll/employees/:id',
  requireAuth,
  requirePermission('payroll.manage'),
  constructionPayroll.deleteEmployee
);

app.get('/api/construction-payroll/periods', requireAuth, requirePermission('payroll.view'), constructionPayroll.listPeriods);
app.post('/api/construction-payroll/periods', requireAuth, requirePermission('payroll.manage'), constructionPayroll.createPeriod);
app.get('/api/construction-payroll/periods/:id/preview', requireAuth, requirePermission('payroll.view'), constructionPayroll.getPeriodPreview);
app.get(
  '/api/construction-payroll/periods/:id/slips/:employeeId/pdf',
  requireAuth,
  requirePermission('payroll.view'),
  constructionPayroll.getEmployeePaySlipPdf
);
app.get(
  '/api/construction-payroll/periods/:id/individual-reports.pdf',
  requireAuth,
  requirePermission('payroll.view'),
  constructionPayroll.getIndividualReportsPdf
);
app.post(
  '/api/construction-payroll/periods/:id/individual-reports.pdf',
  requireAuth,
  requirePermission('payroll.view'),
  constructionPayroll.postIndividualReportsPdf
);
app.post(
  '/api/construction-payroll/periods/:id/slips/email',
  requireAuth,
  requirePermission('payroll.manage'),
  constructionPayroll.postDistributePaySlips
);
app.put(
  '/api/construction-payroll/periods/:id/adjustments',
  requireAuth,
  requirePermission('payroll.manage'),
  constructionPayroll.putPeriodAdjustments
);
app.post('/api/construction-payroll/periods/:id/close', requireAuth, requirePermission('payroll.manage'), constructionPayroll.closePeriod);
app.post('/api/construction-payroll/periods/:id/reopen', requireAuth, requirePermission('payroll.manage'), constructionPayroll.reopenPeriod);
app.get('/api/construction-payroll/periods/:periodId/timesheets', requireAuth, requirePermission('payroll.view'), constructionPayroll.listTimesheets);
app.post(
  '/api/construction-payroll/periods/:periodId/timesheets/bulk',
  requireAuth,
  requirePermission('payroll.view'),
  constructionPayroll.bulkTimesheets
);
app.put('/api/construction-payroll/timesheets/:id', requireAuth, requirePermission('payroll.view'), constructionPayroll.updateTimesheet);
app.delete('/api/construction-payroll/timesheets/:id', requireAuth, requirePermission('payroll.view'), constructionPayroll.deleteTimesheet);
app.get('/api/construction-payroll/periods/:id', requireAuth, requirePermission('payroll.view'), constructionPayroll.getPeriod);
app.put('/api/construction-payroll/periods/:id', requireAuth, requirePermission('payroll.manage'), constructionPayroll.updatePeriod);
app.delete('/api/construction-payroll/periods/:id', requireAuth, requirePermission('payroll.manage'), constructionPayroll.deletePeriod);

app.get(
  '/api/construction-payroll/reports/employee-earnings',
  requireAuth,
  requirePermission('payroll.view'),
  constructionPayroll.reportEmployeeEarnings
);
app.get(
  '/api/construction-payroll/reports/project-labor',
  requireAuth,
  requirePermission('payroll.view'),
  constructionPayroll.reportProjectLabor
);
app.get(
  '/api/construction-payroll/reports/total-expenses',
  requireAuth,
  requirePermission('payroll.view'),
  constructionPayroll.reportTotalExpenses
);

// Permissions (matriz de módulos)
app.get('/api/permissions', requireAuth, requirePermission('users.view'), listPermissionRegistry);

// Users (subpaths antes de :id)
app.get('/api/users/:id/permissions', requireAuth, requirePermission('users.view'), getUserPermissions);
app.put(
  '/api/users/:id/permissions',
  requireAuth,
  requirePermission('users.manage_permissions'),
  updateUserPermissions
);
app.get('/api/users', requireAuth, requirePermission('users.view'), listUsers);
app.get('/api/users/:id', requireAuth, requirePermission('users.view'), getUser);
app.post(
  '/api/users/:id/avatar',
  requireAuth,
  requirePermission('users.edit'),
  (req, res, next) => {
    uploadUserAvatar.single('file')(req, res, (err) => {
      if (err) return res.status(400).json({ success: false, error: err.message });
      next();
    });
  },
  postUserAvatar
);
app.post('/api/users', requireAuth, requirePermission('users.create'), createUser);
app.put('/api/users/:id', requireAuth, requirePermission('users.edit'), updateUser);
app.delete('/api/users/:id', requireAuth, requirePermission('users.delete'), deleteUser);

// Compatibility: system.php?api=receive-lead
app.all('/system.php', (req, res) => {
  if (req.query.api === 'receive-lead' && req.method === 'POST') {
    return receiveLeadLimiter(req, res, () => handleReceiveLead(req, res));
  }
  if (req.query.api === 'db-check' && req.method === 'GET') return handleDbCheck(req, res);
  res.status(404).json({ error: 'Not found' });
});

// Orçamento público — https://app.senior-floors.com/SF-2026-001
app.get('/:quoteSlug', (req, res, next) => {
  if (!isPublicQuoteNumberPath(req.params.quoteSlug)) return next();
  return res.sendFile(path.join(__dirname, 'public', 'quote-public.html'));
});

// Estático depois de todas as rotas (API tem prioridade; evita POST/PUT em /api/* a serem tratados como ficheiros)
app.use(
  express.static(path.join(__dirname, 'public'), {
    setHeaders(res, filePath) {
      const lower = String(filePath).toLowerCase();
      if (lower.endsWith('.html')) {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
      } else if (lower.endsWith('.js')) {
        res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
      } else if (lower.endsWith('.css')) {
        res.setHeader('Content-Type', 'text/css; charset=utf-8');
      }
      if (lower.endsWith('.html') || lower.endsWith('.js')) {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.setHeader('Pragma', 'no-cache');
      }
    },
  })
);
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

const hideErrorDetailFromClient =
  (process.env.NODE_ENV === 'production' || !!process.env.RAILWAY_ENVIRONMENT) &&
  process.env.API_ERROR_DETAIL !== '1';

app.use((err, req, res, next) => {
  console.error('[ERROR]', err && err.message ? err.message : err, err && err.stack ? err.stack : '');
  const infraDb = isMysqlInfrastructureError(err);
  if (infraDb) {
    resetDbPool().catch(() => {});
  }

  let status =
    (typeof err.statusCode === 'number' && err.statusCode) ||
    (typeof err.status === 'number' && err.status) ||
    (infraDb ? 503 : 500);
  if (status < 400 || status > 599) status = 500;

  if (status >= 500 && hideErrorDetailFromClient) {
    return res.status(status).json({
      error: true,
      message: infraDb
        ? 'Serviço temporariamente indisponível (base de dados).'
        : 'Erro interno do servidor',
      ...(infraDb
        ? {
            hint:
              'Railway: no serviço Node, ligue o plugin MySQL (Variables → DATABASE_URL) ou MYSQLHOST/MYSQLUSER/MYSQLPASSWORD/MYSQLDATABASE. Remova DB_HOST/DB_* em conflito.',
            check: '/api/health/db',
          }
        : {}),
    });
  }

  return res.status(status).json({
    error: true,
    message: (err && err.message) || 'Pedido inválido',
  });
});

// 404 handler (rotas /api/* desconhecidas — ver path/method na resposta)
app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    res.status(404).json({
      success: false,
      error: 'Not found',
      path: req.path,
      method: req.method,
      hint:
        'Confirme o URL (ex.: POST /api/quotes/:id/send-email, GET /api/health/email). Deploy recente inclui /api/health/email.',
    });
  } else {
    res.status(404).send('Page not found');
  }
});

async function start() {
  const pool = mysqlPool;
  const skipMysqlPing =
    process.env.SKIP_MYSQL_PING === '1' || process.env.SKIP_MYSQL_PING === 'true';

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Senior Floors System running on port ${PORT}`);
    console.log('  Admin Panel: http://localhost:' + PORT);
    console.log('\n  API Endpoints:');
    console.log('  Dashboard: GET /api/dashboard/stats');
    console.log('  Dashboard debug: GET /api/dashboard/debug (requer DASHBOARD_DEBUG=1)');
    console.log('  Leads: GET /api/leads, GET /api/leads/:id, PUT /api/leads/:id, DELETE /api/leads/:id');
    console.log('  Customers: GET /api/customers, GET /api/customers/:id/insight, POST /api/customers, PUT /api/customers/:id');
    console.log('  Quotes: GET /api/quotes, POST /api/quotes, PUT /api/quotes/:id');
    console.log('  Projects: /api/projects (router completo + financial em /:id/financial)');
    console.log('  Visits: GET /api/visits, POST /api/visits, PUT /api/visits/:id');
    console.log('  Activities: GET /api/activities, POST /api/activities');
    console.log('  Contracts: GET /api/contracts, POST /api/contracts, PUT /api/contracts/:id');
    console.log('  Users: GET/POST/PUT/DELETE /api/users, permissões, change-password');

    (async () => {
      if (!pool) {
        console.error(
          '[db] AVISO: sem pool MySQL — no serviço Node defina DATABASE_URL (referência ao MySQL). Diagnóstico: GET /api/health/db'
        );
        return;
      }
      if (!skipMysqlPing) {
        const ping = await verifyMysqlPoolConnectivity(pool);
        if (!ping.ok) {
          const t = getMysqlConnectionTargetInfo();
          const err = ping.error;
          console.error(
            '[db] AVISO: MySQL inacessível em',
            `${t.host}:${t.port}`,
            '—',
            err?.code || err?.message
          );
          console.error(
            '[db] Corrija DATABASE_URL no Node (mesmo projeto que o MySQL). Rotas que usam BD respondem 503 até lá.'
          );
        } else {
          console.log('[db] MySQL OK (ping).');
        }
      }
      await ensureQuoteInvoicePdfColumn(pool);
      await ensureQuoteInvoicesSchema(pool);
      await ensureQuotePdfViewedColumn(pool);
      await ensureQuoteNumberOffset(pool);
      await ensureQuoteSignatureSchema(pool);
      await ensureQuotePartySchema(pool);
      await ensureQuoteClientPublishSchema(pool);
      await ensureUserModuleColumns(pool);
      await ensureCustomersResponsibleNameColumn(pool);
      await ensureLeadPipelineStageEnteredAt(pool);
      await ensurePayrollTimesheetDailyOverrideColumn(pool);
      await ensurePayrollEmployeeAllowOutsidePeriodColumn(pool);
      await ensureBuilderPaymentForecastsTable(pool);
      await ensureBuilderPortalSchema(pool);
      await ensureProjectChildTables(pool);
      try {
        await ensureFinancialCompleteSchema(pool);
        console.log('[db] Schema financeiro (vendors, operational_costs, …) verificado no arranque.');
      } catch (e) {
        console.warn('[db] ensure financial schema:', e && (e.code || e.message));
      }
    })().catch((e) => console.error('[db] Arranque pós-listen:', e));
  });
}

start().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});

process.on('uncaughtException', (err) => {
  console.error('[fatal] uncaughtException', err);
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  console.error('[fatal] unhandledRejection', reason);
});
