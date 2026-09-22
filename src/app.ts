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
import { bindTenantContext } from "./lib/tenant/bind-context.js";
import { loadSessionUser } from "./middleware/auth.js";
import { errorHandler } from "./middleware/error-handler.js";
import { organizationsRouter } from "./modules/organizations/routes.js";
import { settingsRouter } from "./modules/organizations/settings-routes.js";
import { authRouter } from "./modules/auth/routes.js";
import { usersRouter, invitationsRouter } from "./modules/users/routes.js";
import { leadsRouter, pipelineRouter } from "./modules/leads/routes.js";
import { customersRouter } from "./modules/customers/routes.js";
import { quotesRouter, publicQuotesRouter } from "./modules/quotes/routes.js";
import { dashboardRouter } from "./modules/dashboard/routes.js";
import { platformAdminRouter } from "./platform-admin/routes.js";
import type { TenantRequest } from "./lib/tenant/resolve-tenant.js";

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

  app.use(express.urlencoded({ extended: true, limit: "5mb" }));
  app.use(express.json({ limit: "1mb" }));
  app.use(cookieParser());
  app.use("/assets", express.static(path.join(__dirname, "public")));

  // Health must be registered before session/DB middleware so Railway probes never hang.
  app.get("/health", (_req, res) => {
    res.status(200).json({ ok: true });
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
        estimateRules: DEFAULT_ESTIMATE_RULES,
      });
      return;
    }
    organizationsRouter(req, res, next);
  });

  // Tenant-scoped application
  app.use(requireTenant);
  app.use(bindTenantContext);
  app.use(loadSessionUser);

  app.use(authRouter);
  app.use("/invitations", invitationsRouter);
  app.use(dashboardRouter);
  app.use("/users", usersRouter);
  app.use("/settings", settingsRouter);
  app.use("/leads", leadsRouter);
  app.use("/pipeline", pipelineRouter);
  app.use("/customers", customersRouter);
  app.use("/quotes", quotesRouter);

  app.use(errorHandler);
  return app;
}
