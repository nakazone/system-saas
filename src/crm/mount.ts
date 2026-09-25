/**
 * Senior Floors CRM — multi-tenant mount for System SaaS.
 *
 * Serves the vendored SF static UI at the tenant root (same paths as SF:
 * /dashboard.html, /login.html, /api/auth/*) so the product matches Senior Floors.
 *
 * Module APIs: Dashboard, Leads, Quotes, Invoice, Cadastro, Builders,
 * Tabela de Valores (pricing), Folha de Pagamento, Users — see src/crm/api.ts.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express, { type Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { crmAuthRouter } from "./auth-api.js";
import { crmApiRouter } from "./api.js";
import { SAAS_DISABLED_HTML } from "./disabled-modules.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const BRANDING_INJECT = [
  '<link rel="stylesheet" href="/api/branding.css" data-saas-branding-css />',
  '<script src="/saas-branding.js" defer data-saas-branding-js></script>',
].join("\n    ");

/**
 * Resolve CRM static roots for both `tsx src/` and `node dist/src/`.
 * Production previously resolved to `dist/crm/public` (missing) → Cannot GET /dashboard.html.
 */
function resolveCrmDir(subdir: "public" | "assets"): string {
  const candidates = [
    path.resolve(process.cwd(), "crm", subdir),
    path.resolve(__dirname, "../../../crm", subdir), // dist/src/crm → repo root
    path.resolve(__dirname, "../../crm", subdir), // src/crm → repo root
    path.resolve(__dirname, "../../", subdir), // dist/crm/{public,assets} if copied by build
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return candidates[0]!;
}

export const CRM_PUBLIC_DIR = resolveCrmDir("public");
export const CRM_ASSETS_DIR = resolveCrmDir("assets");

function safePublicHtmlPath(urlPath: string): string | null {
  const raw = String(urlPath || "")
    .split("?")[0]
    .replace(/^\//, "");
  if (!raw || raw.includes("..") || raw.includes("\\") || path.isAbsolute(raw)) {
    return null;
  }
  let rel = raw;
  if (!rel.toLowerCase().endsWith(".html")) {
    // express.static extensions:["html"] — allow /dashboard → dashboard.html
    if (!rel.includes(".")) rel = `${rel}.html`;
    else return null;
  }
  const full = path.resolve(CRM_PUBLIC_DIR, rel);
  if (!full.startsWith(path.resolve(CRM_PUBLIC_DIR) + path.sep) && full !== path.resolve(CRM_PUBLIC_DIR)) {
    return null;
  }
  return full;
}

function injectBranding(html: string): string {
  if (html.includes("data-saas-branding-css")) return html;
  if (/<\/head>/i.test(html)) {
    return html.replace(/<\/head>/i, `    ${BRANDING_INJECT}\n</head>`);
  }
  return `${BRANDING_INJECT}\n${html}`;
}

export function createCrmRouter(): Router {
  const router = express.Router();

  router.use(crmAuthRouter);
  router.use(crmApiRouter);

  // SF logo / brand assets (SaaS CSS remains available via a second /assets mount)
  router.use("/assets", express.static(CRM_ASSETS_DIR));

  router.get("/", requireAuth, (req, res) => {
    const ua = String(req.headers["user-agent"] || "");
    const mobile =
      /Android|webOS|iPhone|iPod|BlackBerry|IEMobile|Opera Mini|Mobile|iPad/i.test(ua);
    const role = String(req.session?.userRole || "").toLowerCase();
    const isField = role === "installer" || role === "crew_lead";
    if (mobile && isField) {
      res.redirect("/campo/hoje.html");
      return;
    }
    res.redirect(mobile ? "/home.html" : "/pipeline-lab.html");
  });

  // Block excluded SF modules in SaaS (deep links / bookmarks)
  router.use((req, res, next) => {
    const base = String(req.path || "")
      .split("?")[0]
      .replace(/^\//, "")
      .toLowerCase();
    if (base && SAAS_DISABLED_HTML.has(base)) {
      res.redirect(302, "/dashboard.html");
      return;
    }
    next();
  });

  if (!fs.existsSync(path.join(CRM_PUBLIC_DIR, "dashboard.html"))) {
    console.error(
      `[crm] dashboard.html not found under ${CRM_PUBLIC_DIR} (cwd=${process.cwd()}, __dirname=${__dirname})`,
    );
  }

  // Inject tenant branding into CRM HTML shells
  router.use((req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      next();
      return;
    }
    const full = safePublicHtmlPath(req.path);
    if (!full || !fs.existsSync(full)) {
      next();
      return;
    }
    try {
      const html = injectBranding(fs.readFileSync(full, "utf8"));
      res.setHeader("Cache-Control", "no-store, max-age=0");
      res.type("html").send(html);
    } catch (error) {
      next(error);
    }
  });

  router.use(
    express.static(CRM_PUBLIC_DIR, {
      index: false,
      extensions: ["html"],
    }),
  );

  return router;
}
