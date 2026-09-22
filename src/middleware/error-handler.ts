import type { NextFunction, Request, Response } from "express";

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  console.error(err);
  const message = err instanceof Error ? err.message : "Unexpected error";
  if (res.headersSent) {
    return;
  }
  res.status(500).render("errors/server-error", {
    title: "Server error",
    message: process.env.NODE_ENV === "production" ? "Something went wrong." : message,
    organization: null,
  });
}
