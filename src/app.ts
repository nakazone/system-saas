import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import cookieParser from "cookie-parser";
import pg from "pg";
import { env } from "./config/env.js";
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
import { customersRouter } from "./modules/customers/routes.js";
import { quotesRouter, publicQuotesRouter } from "./modules/quotes/routes.js";
import { invoicesRouter } from "./modules/invoices/routes.js";
import { publicInvoicesRouter } from "./modules/invoices/public-routes.js";
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
import { CRM_ASSETS_DIR } from "./crm/mount.js";

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

  app.use(express.urlencoded({ extended: true, limit: "12mb" }));
  app.use(express.json({ limit: "1mb" }));
  app.use(cookieParser());
  app.use("/assets", express.static(CRM_ASSETS_DIR));
  app.use("/assets", express.static(path.join(__dirname, "public")));
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
