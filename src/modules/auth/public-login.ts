import type { Request, Response, NextFunction } from "express";
import express from "express";
import path from "node:path";
import { crmAuthRouter } from "../../crm/auth-api.js";
import { CRM_PUBLIC_DIR } from "../../crm/mount.js";

const loginStatic = express.static(CRM_PUBLIC_DIR, {
  index: false,
  fallthrough: true,
});

/**
 * Apex email-first login: serve /login.html, login CSS/JS, and /api/auth/*
 * without a pre-selected organization (slug / find-workspace).
 */
export function publicEmailLogin(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const p = String(req.path || "").split("?")[0] || "";

  if (p === "/login") {
    res.redirect(302, "/login.html");
    return;
  }

  if (p === "/login.html") {
    res.sendFile(path.join(CRM_PUBLIC_DIR, "login.html"));
    return;
  }

  if (p.startsWith("/api/auth/")) {
    crmAuthRouter(req, res, next);
    return;
  }

  // Styles/scripts referenced by login.html (styles.css, crm-toast.js, …)
  if (/\.(css|js|map|png|jpg|jpeg|gif|svg|webp|ico|woff2?)$/i.test(p)) {
    loginStatic(req, res, next);
    return;
  }

  next();
}
