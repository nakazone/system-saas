import type { NextFunction, Request, Response } from "express";

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  console.error(err);
  if (res.headersSent) {
    return;
  }

  const anyErr = err as { status?: number; statusCode?: number; type?: string; message?: string };
  const isPayload =
    anyErr?.type === "entity.too.large" ||
    anyErr?.status === 413 ||
    anyErr?.statusCode === 413 ||
    /too large|payload/i.test(String(anyErr?.message || ""));

  const status = isPayload
    ? 413
    : typeof anyErr?.status === "number"
      ? anyErr.status
      : typeof anyErr?.statusCode === "number"
        ? anyErr.statusCode
        : 500;

  const message = isPayload
    ? "Image too large. Try a smaller photo."
    : err instanceof Error
      ? err.message
      : "Unexpected error";
  const safe =
    process.env.NODE_ENV === "production" && status >= 500 ? "Something went wrong." : message;

  const wantsJson =
    String(req.path || "").startsWith("/api/") ||
    String(req.headers.accept || "").includes("application/json");
  if (wantsJson) {
    res.status(status).json({ success: false, error: safe });
    return;
  }
  res.status(status).render("errors/server-error", {
    title: status === 413 ? "Upload too large" : "Server error",
    message: safe,
    organization: null,
  });
}
