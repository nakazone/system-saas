/**
 * Interface language routes.
 *   GET  /api/i18n/bundle?locale=en&v=…  dictionary for crm-i18n.js (public, cached by version)
 *   GET  /api/i18n/me                    language of the signed-in user (or the company default)
 *   POST /api/i18n/locale                saves the user's language on the account
 */

import { Router, type Request, type Response } from "express";
import zlib from "node:zlib";
import { prisma } from "../prisma.js";
import { buildBundle, normalizeUiLocale, orgDefaultUiLocale } from "./index.js";
import type { AuthedRequest } from "../../middleware/auth.js";

export const i18nPublicRouter = Router();

const gzCache = new Map<string, Buffer>();

i18nPublicRouter.get("/api/i18n/bundle", async (req: Request, res: Response, next) => {
  try {
    const locale = normalizeUiLocale(req.query.locale) ?? "pt";
    const { bundle, json } = await buildBundle(locale);
    const asked = String(req.query.v || "");
    // The URL carries the version, so a matching one can be cached for a long time.
    res.setHeader("Cache-Control", asked === bundle.v ? "public, max-age=31536000, immutable" : "no-cache");
    res.setHeader("Vary", "Accept-Encoding");
    res.type("application/json; charset=utf-8");
    if (/\bgzip\b/.test(String(req.headers["accept-encoding"] || ""))) {
      const key = `${locale}:${bundle.v}`;
      let gz = gzCache.get(key);
      if (!gz) {
        gz = zlib.gzipSync(json);
        gzCache.set(key, gz);
        if (gzCache.size > 12) gzCache.delete(gzCache.keys().next().value!);
      }
      res.setHeader("Content-Encoding", "gzip");
      res.send(gz);
      return;
    }
    res.send(json);
  } catch (error) {
    next(error);
  }
});

export const i18nCrmRouter = Router();

i18nCrmRouter.get("/api/i18n/me", async (req: AuthedRequest, res, next) => {
  try {
    if (!req.session?.userId || !req.organizationId) {
      res.status(401).json({ success: false, error: "Não autenticado" });
      return;
    }
    const [user, org] = await Promise.all([
      prisma.user.findFirst({ where: { id: req.session.userId, organizationId: req.organizationId }, select: { uiLocale: true } }),
      prisma.organization.findUnique({ where: { id: req.organizationId }, select: { defaultLocale: true } }),
    ]);
    const mine = normalizeUiLocale(user?.uiLocale);
    res.json({
      success: true,
      locale: mine ?? orgDefaultUiLocale(org?.defaultLocale),
      source: mine ? "user" : "company",
      company: orgDefaultUiLocale(org?.defaultLocale),
    });
  } catch (error) {
    next(error);
  }
});

i18nCrmRouter.post("/api/i18n/locale", async (req: AuthedRequest, res, next) => {
  try {
    if (!req.session?.userId || !req.organizationId) {
      res.status(401).json({ success: false, error: "Não autenticado" });
      return;
    }
    const raw = (req.body || {}).locale;
    const locale = raw === null || raw === "" || raw === "company" ? null : normalizeUiLocale(raw);
    if (raw && raw !== "company" && !locale) {
      res.status(400).json({ success: false, error: "Idioma inválido" });
      return;
    }
    await prisma.user.updateMany({
      where: { id: req.session.userId, organizationId: req.organizationId },
      data: { uiLocale: locale },
    });
    res.json({ success: true, locale });
  } catch (error) {
    next(error);
  }
});
