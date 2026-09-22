import type { Request } from "express";

/** Express 5 types params as string | string[]; normalize to a single string. */
export function param(req: Request, name: string): string {
  const value = req.params[name];
  if (Array.isArray(value)) {
    return value[0] ?? "";
  }
  return value ?? "";
}
