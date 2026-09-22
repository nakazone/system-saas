import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import cookieParser from "cookie-parser";
import { env } from "./config/env.js";
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

export function createApp() {
  const app = express();

  app.set("view engine", "ejs");
  app.set("views", path.join(__dirname, "views"));
  app.set("trust proxy", 1);

  app.use(express.urlencoded({ extended: true, limit: "5mb" }));
  app.use(express.json({ limit: "1mb" }));
  app.use(cookieParser());
  app.use("/assets", express.static(path.join(__dirname, "public")));

  app.use(
    session({
      store: new PgSession({
        conString: env.DATABASE_URL,
        tableName: "session",
        createTableIfMissing: true,
      }),
      secret: env.SESSION_SECRET,
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        sameSite: "lax",
        secure: env.NODE_ENV === "production",
        maxAge: 7 * 24 * 60 * 60 * 1000,
      },
    }),
  );

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

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
        title: "Flooring operations platform",
        organization: null,
        appRootDomain: env.APP_ROOT_DOMAIN,
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
