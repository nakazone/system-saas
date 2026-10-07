import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import express from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import cookieParser from "cookie-parser";
import pg from "pg";
import { env } from "./config/env.js";
import { getEmailTransportStatus } from "./lib/email/index.js";
import { DEFAULT_ESTIMATE_RULES } from "./lib/tenant/defaults.js";
import { resolveTenant, requireTenant } from "./lib/tenant/resolve-tenant.js";
import { subdomainTenantsSupported } from "./lib/tenant/workspace-url.js";
import { bindTenantContext } from "./lib/tenant/bind-context.js";
import { loadSessionUser } from "./middleware/auth.js";
import { errorHandler } from "./middleware/error-handler.js";
import { organizationsRouter } from "./modules/organizations/routes.js";
import { settingsRouter } from "./modules/organizations/settings-routes.js";
import { authRouter } from "./modules/auth/routes.js";
import { publicEmailLogin } from "./modules/auth/public-login.js";
import { usersRouter, invitationsRouter } from "./modules/users/routes.js";
import { leadsRouter, pipelineRouter } from "./modules/leads/routes.js";
import { publicReceiveLeadRouter } from "./modules/leads/public-receive.js";
import { customersRouter } from "./modules/customers/routes.js";
import { quotesRouter, publicQuotesRouter } from "./modules/quotes/routes.js";
import { invoicesRouter } from "./modules/invoices/routes.js";
import { publicInvoicesRouter } from "./modules/invoices/public-routes.js";
import { publicJobsRouter } from "./modules/work-orders/public-routes.js";
import { scheduleCalendarFeedPublicRouter } from "./crm/routes/schedule-calendar-feed.js";
import { publicPortfolioRouter } from "./modules/portfolio/public-routes.js";
import { paymentSchedulesRouter } from "./modules/invoices/schedule-routes.js";
import { paymentTemplatesRouter } from "./modules/invoices/templates-routes.js";
import { projectsRouter } from "./modules/projects/routes.js";
import { projectCostsRouter } from "./modules/projects/costs-routes.js";
import { laborRatesRouter } from "./modules/projects/labor-rates-routes.js";
import { automationsRouter } from "./modules/automations/routes.js";
import { reportsRouter } from "./modules/reports/routes.js";
import { visitsRouter } from "./modules/visits/routes.js";
import { crewsRouter } from "./modules/crews/routes.js";
import { scheduleRouter } from "./modules/schedule/routes.js";
import { dashboardRouter } from "./modules/dashboard/routes.js";
import { importRouter } from "./modules/imports/routes.js";
import { checklistsRouter } from "./modules/checklists/routes.js";
import { assessmentsRouter } from "./modules/assessments/routes.js";
import { platformAdminRouter } from "./platform-admin/routes.js";
import type { TenantRequest } from "./lib/tenant/resolve-tenant.js";
import { createCrmRouter } from "./crm/mount.js";
import { CRM_ASSETS_DIR, CRM_PUBLIC_DIR } from "./crm/mount.js";
import { getLocalFileStorage } from "./lib/storage/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PgSession = connectPgSimple(session);
const { Pool } = pg;

function createSessionPool() {
  const isProduction = env.NODE_ENV === "production";
  return new Pool({
    connectionString: env.DATABASE_URL,
    // Railway (and most managed Postgres) require TLS.
    ssl: isProduction ? { rejectUnauthorized: false } : undefined,
    max: 10,
    connectionTimeoutMillis: 10_000,
  });
}

export function createApp() {
  const app = express();
  const isProduction = env.NODE_ENV === "production";

  app.set("view engine", "ejs");
  app.set("views", path.join(__dirname, "views"));
  app.set("trust proxy", 1);

  app.use(express.urlencoded({ extended: true, limit: "15mb" }));
  app.use(express.json({ limit: "15mb" }));
  app.use(cookieParser());
  app.use("/assets", express.static(CRM_ASSETS_DIR));
  app.use("/assets", express.static(path.join(__dirname, "public")));

  // CRM static files (css/js/images/fonts) are identical for every tenant. Serve them before
  // the session store, tenant lookup and user load: each asset request used to run ~20 DB
  // statements (session read + touch, org, permission sync, user/role/permissions) and a
  // CRM page loads ~30 of them. HTML shells still go through the tenant stack (branding).
  // Caching is unchanged: browsers revalidate with ETag (304), so edits show up immediately.
  const crmStatic = express.static(CRM_PUBLIC_DIR, { index: false, cacheControl: false, fallthrough: true });
  const CRM_STATIC_FILE = /\.(?:css|js|mjs|map|png|jpe?g|gif|svg|webp|ico|woff2?|ttf)$/i;
  app.use((req, res, next) => {
    if ((req.method !== "GET" && req.method !== "HEAD") || req.path.startsWith("/api/") || !CRM_STATIC_FILE.test(req.path)) {
      next();
      return;
    }
    res.setHeader("Cache-Control", "no-cache");
    crmStatic(req, res, next);
  });

  // Local upload fallback (when S3 is not configured) — keys are unguessable org paths.
  app.get(/^\/api\/local-files\/(.+)/, async (req, res, next) => {
    try {
      const local = getLocalFileStorage();
      if (!local) {
        res.status(404).json({ success: false, error: "Local storage unavailable" });
        return;
      }
      const raw = String(
        (req.params as Record<string, string>)["0"] ||
          req.path.replace(/^\/api\/local-files\//, ""),
      );
      const key = raw
        .split("/")
        .map((p) => decodeURIComponent(p))
        .join("/");
      if (!key || key.includes("..")) {
        res.status(400).end();
        return;
      }
      const obj = await local.get(key);
      if (!obj) {
        res.status(404).end();
        return;
      }
      res.setHeader("Cache-Control", "public, max-age=86400");
      res.type(obj.contentType);
      res.send(obj.body);
    } catch (error) {
      next(error);
    }
  });

  app.get("/favicon.ico", (_req, res) => {
    res.type("image/x-icon");
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.sendFile(path.join(CRM_ASSETS_DIR, "favicon.ico"));
  });
  app.get("/manifest.json", (_req, res) => {
    res.type("application/manifest+json");
    res.setHeader("Cache-Control", "no-cache");
    res.sendFile(path.resolve(process.cwd(), "crm/public/manifest.json"));
  });
  app.get("/obramateLogoSmallTransp.png", (_req, res) => {
    const candidates = [
      path.join(CRM_ASSETS_DIR, "obramateLogoSmallTransp.png"),
      path.resolve(process.cwd(), "public/obramateLogoSmallTransp.png"),
      path.join(__dirname, "../public/obramateLogoSmallTransp.png"),
      path.join(__dirname, "../../public/obramateLogoSmallTransp.png"),
    ];
    const file = candidates.find((p) => fs.existsSync(p));
    if (!file) {
      res.status(404).end();
      return;
    }
    res.type("image/png");
    res.sendFile(file);
  });
  app.get("/manifest.webmanifest", (_req, res) => {
    res.type("application/manifest+json");
    res.sendFile(path.join(__dirname, "../public/manifest.webmanifest"));
  });

  // Health must be registered before session/DB middleware so Railway probes never hang.
  app.get("/health", (_req, res) => {
    res.status(200).json({
      ok: true,
      rootDomain: env.APP_ROOT_DOMAIN,
      tenantRouting: subdomainTenantsSupported() ? "subdomain" : "session",
    });
  });
  app.get("/api/health/email", (_req, res) => {
    const status = getEmailTransportStatus();
    res.status(status.ready ? 200 : 503).json({ success: status.ready, ...status });
  });

  // Canonical host: www → apex (obramate.com)
  app.use((req, res, next) => {
    const hostname = (req.get("host") || "").split(":")[0]?.toLowerCase() ?? "";
    const root = env.APP_ROOT_DOMAIN.toLowerCase();
    if (hostname === `www.${root}`) {
      const proto = isProduction ? "https" : req.protocol;
      res.redirect(301, `${proto}://${root}${req.originalUrl || "/"}`);
      return;
    }
    next();
  });

  app.use(
    session({
      store: new PgSession({
        pool: createSessionPool(),
        tableName: "session",
        createTableIfMissing: true,
        pruneSessionInterval: isProduction ? 60 * 15 : false,
      }),
      secret: env.SESSION_SECRET,
      resave: false,
      saveUninitialized: false,
      proxy: isProduction,
      cookie: {
        httpOnly: true,
        sameSite: "lax",
        secure: isProduction,
        maxAge: 7 * 24 * 60 * 60 * 1000,
      },
    }),
  );

  // Public quote links (token-based, no subdomain tenant required)
  app.use("/public", publicQuotesRouter);
  app.use("/public/invoices", publicInvoicesRouter);
  app.use("/public/jobs", publicJobsRouter);
  // Short worker ticket links (sent by WhatsApp/SMS): /t/<token>
  app.use("/t", publicJobsRouter);
  // Schedule ICS subscription (Apple Calendar / Google / Outlook): /feeds/schedule/<token>.ics
  app.use("/feeds/schedule", scheduleCalendarFeedPublicRouter);
  app.use("/public/portfolio", publicPortfolioRouter);

  // Public LP / Meta lead intake (tenant via slug header/query/subdomain — no session)
  app.use(publicReceiveLeadRouter);

  app.use(resolveTenant);

  // Platform admin host
  app.use((req: TenantRequest, res, next) => {
    if (!req.isPlatformAdminHost) {
      next();
      return;
    }
    platformAdminRouter(req, res, next);
  });

  // Root-domain signup / landing
  app.use((req: TenantRequest, res, next) => {
    if (!(req.isPublicHost && !req.organizationId)) {
      next();
      return;
    }
    if (req.path === "/" || req.path === "") {
      res.render("landing", {
        title: env.PRODUCT_NAME,
        organization: null,
        productName: env.PRODUCT_NAME,
        appRootDomain: env.APP_ROOT_DOMAIN,
        appBaseUrl: env.APP_BASE_URL,
        subdomainTenants: subdomainTenantsSupported(),
        estimateRules: DEFAULT_ESTIMATE_RULES,
        landingPage: true,
      });
      return;
    }
    organizationsRouter(req, res, next);
  });

  // Apex email-first login (before requireTenant)
  app.use((req: TenantRequest, res, next) => {
    if (req.organizationId || !req.isPublicHost) {
      next();
      return;
    }
    const p = String(req.path || "").split("?")[0] || "";
    if (
      p === "/login" ||
      p === "/login.html" ||
      p.startsWith("/api/auth/") ||
      /\.(css|js|map|png|jpg|jpeg|gif|svg|webp|ico|woff2?)$/i.test(p)
    ) {
      publicEmailLogin(req, res, next);
      return;
    }
    next();
  });

  // Tenant-scoped application
  app.use(requireTenant);
  app.use(bindTenantContext);
  app.use(loadSessionUser);

  // Senior Floors CRM UI + /api/auth bridge (primary product experience)
  app.use(createCrmRouter());

  // Phase 2 EJS surfaces are not part of the product nav — send deep links to CRM
  app.use((req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      next();
      return;
    }
    const p = String(req.path || "").replace(/\/$/, "") || "/";
    const phase2Ui =
      p === "/home" ||
      p === "/leads/board" ||
      p === "/schedule" ||
      p === "/schedule/my-day" ||
      p === "/assessments" ||
      p === "/reports" ||
      p === "/settings/automations" ||
      p === "/projects" ||
      /^\/projects\/\d+$/.test(p) ||
      /^\/assessments\/\d+/.test(p) ||
      /^\/reports\/[^/]+$/.test(p);
    if (phase2Ui) {
      res.redirect(302, "/dashboard.html");
      return;
    }
    next();
  });

  app.use(authRouter);
  app.use("/invitations", invitationsRouter);
  app.use(dashboardRouter);
  app.use("/users", usersRouter);
  app.use("/settings", settingsRouter);
  app.use("/settings/import", importRouter);
  app.use("/settings/checklists", checklistsRouter);
  app.use("/settings/payment-templates", paymentTemplatesRouter);
  app.use("/settings/labor-rates", laborRatesRouter);
  app.use("/settings/automations", automationsRouter);
  app.use("/reports", reportsRouter);
  app.use("/leads", leadsRouter);
  app.use("/pipeline", pipelineRouter);
  app.use("/customers", customersRouter);
  app.use("/quotes", quotesRouter);
  app.use("/payment-schedules", paymentSchedulesRouter);
  app.use("/invoices", invoicesRouter);
  app.use("/assessments", assessmentsRouter);
  app.use("/projects", projectsRouter);
  app.use("/projects", projectCostsRouter);
  app.use("/visits", visitsRouter);
  app.use("/crews", crewsRouter);
  app.use("/schedule", scheduleRouter);

  app.use(errorHandler);
  return app;
}
