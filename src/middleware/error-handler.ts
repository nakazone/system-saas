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
  // Only treat real body-parser / HTTP 413 oversize as upload errors.
  // Do NOT match the word "payload" — Prisma errors often include a `payload` field name.
  const isPayload =
    anyErr?.type === "entity.too.large" ||
    anyErr?.status === 413 ||
    anyErr?.statusCode === 413 ||
    /request entity too large|entity\.too\.large/i.test(String(anyErr?.message || ""));

  const status = isPayload
    ? 413
    : typeof anyErr?.status === "number"
      ? anyErr.status
      : typeof anyErr?.statusCode === "number"
        ? anyErr.statusCode
        : 500;

  const message = isPayload
    ? "Ficheiro ou pedido demasiado grande. Tente uma imagem mais pequena."
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
