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

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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

export function createCrmRouter(): Router {
  const router = express.Router();

  router.use(crmAuthRouter);
  router.use(crmApiRouter);

  // SF logo / brand assets (SaaS CSS remains available via a second /assets mount)
  router.use("/assets", express.static(CRM_ASSETS_DIR));

  router.get("/", requireAuth, (_req, res) => {
    res.redirect("/dashboard.html");
  });

  if (!fs.existsSync(path.join(CRM_PUBLIC_DIR, "dashboard.html"))) {
    console.error(
      `[crm] dashboard.html not found under ${CRM_PUBLIC_DIR} (cwd=${process.cwd()}, __dirname=${__dirname})`,
    );
  }

  router.use(
    express.static(CRM_PUBLIC_DIR, {
      index: false,
      extensions: ["html"],
    }),
  );

  return router;
}
