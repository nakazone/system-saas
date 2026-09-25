import type { NextFunction, Request, Response } from "express";

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  console.error(err);
  const message = err instanceof Error ? err.message : "Unexpected error";
  if (res.headersSent) {
    return;
  }
  const safe = process.env.NODE_ENV === "production" ? "Something went wrong." : message;
  const wantsJson =
    String(req.path || "").startsWith("/api/") ||
    String(req.headers.accept || "").includes("application/json");
  if (wantsJson) {
    res.status(500).json({ success: false, error: safe });
    return;
  }
  res.status(500).render("errors/server-error", {
    title: "Server error",
    message: safe,
    organization: null,
  });
}
