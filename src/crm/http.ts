import type { NextFunction, Response } from "express";
import type { AuthedRequest } from "../middleware/auth.js";

/** JSON 401 for CRM `/api/*` (SF UI uses fetch, not HTML redirects). */
export function requireCrmAuth(req: AuthedRequest, res: Response, next: NextFunction): void {
  if (!req.user || !req.organizationId) {
    res.status(401).json({ success: false, error: "Authentication required" });
    return;
  }
  next();
}

export function requireCrmPermission(...keys: string[]) {
  return (req: AuthedRequest, res: Response, next: NextFunction): void => {
    if (!req.user || !req.organizationId) {
      res.status(401).json({ success: false, error: "Authentication required" });
      return;
    }
    if (req.user.roleKey === "admin") {
      next();
      return;
    }
    const missing = keys.filter((k) => !req.user!.permissions.includes(k));
    if (missing.length > 0) {
      res.status(403).json({
        success: false,
        error: "Permission denied",
        missing,
      });
      return;
    }
    next();
  };
}

export function dec(value: unknown): number {
  if (value == null) return 0;
  if (typeof value === "number") return value;
  if (typeof value === "object" && value !== null && "toNumber" in value) {
    return (value as { toNumber: () => number }).toNumber();
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function asSnakeBuilder(b: {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  type: string;
  status: string;
  address: string | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  const fullName = [b.firstName, b.lastName].filter(Boolean).join(" ").trim() || b.company || b.email;
  return {
    id: b.id,
    first_name: b.firstName,
    last_name: b.lastName,
    email: b.email,
    phone: b.phone,
    company: b.company,
    type: b.type,
    status: b.status,
    address: b.address,
    notes: b.notes,
    full_name: fullName,
    created_at: b.createdAt,
    updated_at: b.updatedAt,
  };
}
