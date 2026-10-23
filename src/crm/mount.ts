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
import express, { type Request, type Response, type Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { crmAuthRouter } from "./auth-api.js";
import { crmApiRouter } from "./api.js";
import { i18nCrmRouter } from "../lib/i18n/routes.js";
import { i18nVersion, orgDefaultUiLocale } from "../lib/i18n/index.js";
import type { TenantRequest } from "../lib/tenant/resolve-tenant.js";
import { SAAS_DISABLED_HTML } from "./disabled-modules.js";
import { isMateVoiceEnabled } from "../lib/mate-voice/staging.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const BRANDING_INJECT = [
  '<link rel="stylesheet" href="/api/branding.css" data-saas-branding-css />',
  // App-wide neutral theme (desktop dock, iPhone tab bar, Geist). Loaded last so it wins the cascade.
  '<link rel="preconnect" href="https://fonts.googleapis.com" />',
  '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&display=swap" />',
  '<link rel="stylesheet" href="/om-theme.css?v=20261009-btnw2" data-om-theme />',
  '<script src="/saas-branding.js?v=20261002-branddoc1" defer data-saas-branding-js></script>',
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

/**
 * Pages that are not translated: the builder (partner) portal and the client's quote
 * page stay in English, like every document the client receives.
 */
const NO_I18N_PAGES = /^(builder-(portal|login|calendar|project|projects|referrals|profile|pricing|messages|gallery|history|estimate-request|estimate-requests|calculator|calculator-share|forgot-password|reset-password|change-password)|partner-(login|portal|requests-admin)|quote-public|estimate-view)\.html$/;

/** Bump when crm/public/crm-i18n.js changes (the dictionary version is added to it). */
const I18N_ENGINE_VER = "20261019-e3";

function i18nInject(file: string, version: string, orgLocale: string | null | undefined): string {
  if (NO_I18N_PAGES.test(path.basename(file))) return "";
  // Without a company (apex login) the browser language decides.
  const boot = JSON.stringify({ v: version, locale: orgLocale === undefined ? null : orgDefaultUiLocale(orgLocale) }).replace(/</g, "\\u003c");
  // Not deferred: it must run before the body is parsed so nothing shows untranslated.
  return `<script>window.__OM_I18N=${boot}</script>\n    <script src="/crm-i18n.js?v=${I18N_ENGINE_VER}.${encodeURIComponent(version)}" data-om-i18n></script>`;
}

function injectBranding(html: string, extra = ""): string {
  if (html.includes("data-saas-branding-css")) return html;
  const block = extra ? `${BRANDING_INJECT}\n    ${extra}` : BRANDING_INJECT;
  if (/<\/head>/i.test(html)) {
    return html.replace(/<\/head>/i, `    ${block}\n</head>`);
  }
  return `${block}\n${html}`;
}

async function renderCrmHtml(req: Request, full: string): Promise<string> {
  const org = (req as TenantRequest).organization;
  const extra = i18nInject(full, await i18nVersion().catch(() => "0"), org ? org.defaultLocale ?? null : undefined);
  // Pages that load crm-i18n.js themselves would load it twice; the engine guards it, but skip the tag.
  const html = fs.readFileSync(full, "utf8").replace(/<script[^>]+src="crm-i18n\.js[^"]*"[^>]*><\/script>\s*/g, "");
  return injectBranding(html, extra);
}

/** Login / password pages served outside the CRM router: only the language script. */
export async function crmHtmlWithLanguage(req: Request, full: string): Promise<string> {
  const org = (req as TenantRequest).organization;
  const extra = i18nInject(full, await i18nVersion().catch(() => "0"), org ? org.defaultLocale ?? null : undefined);
  const html = fs.readFileSync(full, "utf8");
  if (!extra) return html;
  return /<\/head>/i.test(html) ? html.replace(/<\/head>/i, `    ${extra}\n</head>`) : `${extra}\n${html}`;
}

async function sendCrmHtml(req: Request, res: Response, filename: string) {
  const full = path.join(CRM_PUBLIC_DIR, filename);
  const html = await renderCrmHtml(req, full);
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.type("html").send(html);
}

export function createCrmRouter(): Router {
  const router = express.Router();

  // The static CRM HTML fallback would otherwise expose a staging-only shell by filename.
  router.use((req, res, next) => {
    if (!isMateVoiceEnabled() && ["/mate-voice", "/mate-voice.html"].includes(req.path)) {
      res.status(404).type("text").send("Not found");
      return;
    }
    next();
  });

  router.use(crmAuthRouter);
  router.use(i18nCrmRouter);
  router.use(crmApiRouter);

  // SF logo / brand assets (SaaS CSS remains available via a second /assets mount)
  router.use("/assets", express.static(CRM_ASSETS_DIR));

  router.get("/", requireAuth, (req, res) => {
    const role = String(req.session?.userRole || "").toLowerCase();
    const isField = role === "installer" || role === "crew_lead" || role === "subcontractor";
    if (isField) {
      // One employee app (Meu dia) on phone and desktop.
      res.redirect("/campo/hoje.html");
      return;
    }
    res.redirect("/dashboard");
  });

  // Início = /dashboard (pipeline board). Legacy SPA only when ?page= is set.
  router.get(["/dashboard", "/dashboard.html"], requireAuth, async (req, res, next) => {
    try {
      if (req.query.page) {
        await sendCrmHtml(req, res, "dashboard.html");
        return;
      }
      await sendCrmHtml(req, res, "pipeline-lab.html");
    } catch (error) {
      next(error);
    }
  });

  router.get(["/mate-ai", "/mate-ai.html"], requireAuth, async (req, res, next) => {
    try {
      await sendCrmHtml(req, res, "mate-ai.html");
    } catch (error) {
      next(error);
    }
  });

  router.get(["/escritorio-ia", "/escritorio-ia.html"], requireAuth, async (req, res, next) => {
    try {
      await sendCrmHtml(req, res, "escritorio-ia.html");
    } catch (error) {
      next(error);
    }
  });

  router.get(["/mate-voice", "/mate-voice.html"], requireAuth, async (req, res, next) => {
    try {
      if (!isMateVoiceEnabled()) {
        res.status(404).type("text").send("Not found");
        return;
      }
      await sendCrmHtml(req, res, "mate-voice.html");
    } catch (error) {
      next(error);
    }
  });

  // Keep ?view=list (and any other query) so tablet Lista → list shell still works.
  router.get("/pipeline-lab.html", requireAuth, (req, res) => {
    const qs = req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";
    res.redirect(302, `/dashboard${qs}`);
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

  // Inject tenant branding (and the interface language) into CRM HTML shells
  router.use(async (req, res, next) => {
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
      const html = await renderCrmHtml(req, full);
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
