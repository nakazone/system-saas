/**
 * Senior Floors CRM — multi-tenant mount for System SaaS.
 *
 * Serves the vendored SF static UI at the tenant root (same paths as SF:
 * /dashboard.html, /login.html, /api/auth/*) so the product matches Senior Floors.
 *
 * Module APIs: Dashboard, Leads, Quotes, Invoice, Cadastro, Builders,
 * Tabela de Valores (pricing), Folha de Pagamento, Users — see src/crm/api.ts.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import express, { type Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { crmAuthRouter } from "./auth-api.js";
import { crmApiRouter } from "./api.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const CRM_PUBLIC_DIR = path.resolve(__dirname, "../../crm/public");
export const CRM_ASSETS_DIR = path.resolve(__dirname, "../../crm/assets");

export function createCrmRouter(): Router {
  const router = express.Router();

  router.use(crmAuthRouter);
  router.use(crmApiRouter);

  // SF logo / brand assets (SaaS CSS remains available via a second /assets mount)
  router.use("/assets", express.static(CRM_ASSETS_DIR));

  router.get("/", requireAuth, (_req, res) => {
    res.redirect("/dashboard.html");
  });

  router.use(
    express.static(CRM_PUBLIC_DIR, {
      index: false,
      extensions: ["html"],
    }),
  );

  return router;
}
