import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { env } from "../config/env.js";
import { hashPassword } from "../lib/auth/password.js";
import { email as emailProvider } from "../lib/email/index.js";
import { newToken, hashToken, takeRate, requestIp, HOUR } from "../lib/security/db-rate-limit.js";

/**
 * "Forgot password" for company users (CRM login).
 * - The answer is always the same, so nobody can find out which e-mails have an account.
 * - One link per workspace the e-mail belongs to, valid for 1 hour, one use; a new request cancels older links.
 * - Changing the password signs the user out everywhere and sends a "password changed" notice.
 */
export const passwordResetRouter = Router();

export const RESET_TTL_MS = HOUR;

const GENERIC = "If this e-mail has an account, we sent a link to reset the password. It works for 1 hour.";

function resetUrl(token: string): string {
  return `${env.APP_BASE_URL.replace(/\/$/, "")}/reset-password.html?token=${encodeURIComponent(token)}`;
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function shell(inner: string): string {
  return `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#211d1a;max-width:520px;margin:0 auto;padding:24px">${inner}</div>`;
}

async function sendResetEmail(to: string, name: string, company: string, token: string): Promise<void> {
  const link = resetUrl(token);
  const first = name.split(/\s+/)[0] || name;
  await emailProvider.send({
    to,
    subject: `Reset your ${env.PRODUCT_NAME} password`,
    text: [
      `Hi ${first},`,
      "",
      `We received a request to reset your password for ${company} on ${env.PRODUCT_NAME}. Open this link to choose a new one:`,
      link,
      "",
      "The link works for 1 hour and only once. If you did not ask for this, ignore this e-mail — your password stays the same.",
    ].join("\n"),
    html: shell(`<p style="font-size:16px;margin:0 0 12px">Hi ${esc(first)},</p>
  <p style="font-size:16px;line-height:1.5;margin:0 0 20px">We received a request to reset your password for <strong>${esc(company)}</strong> on ${esc(env.PRODUCT_NAME)}.</p>
  <p style="margin:0 0 24px"><a href="${link}" style="display:inline-block;background:#211d1a;color:#fff;text-decoration:none;font-weight:700;padding:12px 20px;border-radius:10px">Choose a new password</a></p>
  <p style="font-size:13px;color:#6e655c;line-height:1.5;margin:0">The link works for 1 hour and only once. If you did not ask for this, ignore this e-mail — your password stays the same.</p>`),
  });
}

async function sendChangedEmail(to: string, name: string, company: string, ip: string): Promise<void> {
  const first = name.split(/\s+/)[0] || name;
  const when = new Date().toLocaleString("en-US", { timeZone: "America/Denver", dateStyle: "medium", timeStyle: "short" });
  await emailProvider.send({
    to,
    subject: `Your ${env.PRODUCT_NAME} password was changed`,
    text: `Hi ${first},\n\nThe password for your ${company} account on ${env.PRODUCT_NAME} was changed on ${when} (Mountain Time) from IP ${ip}. You were signed out on all devices.\n\nIf this was not you, reset your password right away and tell your company administrator.`,
    html: shell(`<p style="font-size:16px;margin:0 0 12px">Hi ${esc(first)},</p>
  <p style="font-size:16px;line-height:1.5;margin:0 0 12px">The password for your <strong>${esc(company)}</strong> account was changed on ${esc(when)} (Mountain Time) from IP ${esc(ip)}. You were signed out on all devices.</p>
  <p style="font-size:14px;color:#6e655c;line-height:1.5;margin:0">If this was not you, reset your password right away and tell your company administrator.</p>`),
  });
}

/** Users that can receive a reset link for this e-mail (active, in a company that is not closed). */
async function usersForEmail(address: string) {
  return prisma.user.findMany({
    where: {
      email: address,
      status: "active",
      organization: { status: { notIn: ["canceled", "suspended"] } },
    },
    select: { id: true, name: true, email: true, organizationId: true, organization: { select: { name: true } } },
    take: 5,
  });
}

passwordResetRouter.post("/api/auth/forgot-password", async (req, res, next) => {
  try {
    const parsed = z.object({ email: z.string().trim().toLowerCase().email().max(200) }).safeParse(req.body);
    if (!parsed.success) return void res.status(400).json({ success: false, error: "Enter a valid e-mail." });
    const address = parsed.data.email;
    const ip = requestIp(req);
    const allowed = await takeRate([
      { key: `forgot:ip:${ip}`, max: 10, windowMs: HOUR },
      { key: `forgot:email:${address}`, max: 3, windowMs: HOUR },
    ]);
    if (!allowed) return void res.status(429).json({ success: false, error: "Too many requests. Please wait a while and try again." });

    const users = await usersForEmail(address);
    for (const u of users) {
      // A new link cancels the previous ones.
      await prisma.passwordResetToken.updateMany({ where: { userId: u.id, usedAt: null }, data: { usedAt: new Date() } });
      const { token, hash } = newToken();
      await prisma.passwordResetToken.create({
        data: { userId: u.id, organizationId: u.organizationId, tokenHash: hash, expiresAt: new Date(Date.now() + RESET_TTL_MS), ip: ip.slice(0, 80) },
      });
      await sendResetEmail(u.email, u.name, u.organization.name, token).catch((e) => console.error("[password-reset] e-mail failed", e));
    }
    res.json({ success: true, message: GENERIC });
  } catch (error) {
    next(error);
  }
});

async function findValidToken(token: string) {
  if (!token || token.length > 200) return null;
  const row = await prisma.passwordResetToken.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: { select: { id: true, name: true, email: true, status: true, organization: { select: { name: true, status: true } } } } },
  });
  if (!row || row.usedAt || row.expiresAt.getTime() < Date.now()) return null;
  if (row.user.status !== "active" || ["canceled", "suspended"].includes(row.user.organization.status)) return null;
  return row;
}

passwordResetRouter.get("/api/auth/reset-password", async (req, res, next) => {
  try {
    const row = await findValidToken(String(req.query.token || ""));
    if (!row) return void res.status(410).json({ success: false, error: "This link expired or was already used. Ask for a new one." });
    res.json({ success: true, data: { email: row.user.email, organization_name: row.user.organization.name } });
  } catch (error) {
    next(error);
  }
});

passwordResetRouter.post("/api/auth/reset-password", async (req, res, next) => {
  try {
    const parsed = z.object({ token: z.string().min(10).max(200), password: z.string().min(8).max(128) }).safeParse(req.body);
    if (!parsed.success) return void res.status(400).json({ success: false, error: "Use a password with at least 8 characters." });
    const ip = requestIp(req);
    if (!(await takeRate([{ key: `reset:ip:${ip}`, max: 20, windowMs: HOUR }]))) {
      return void res.status(429).json({ success: false, error: "Too many attempts. Please wait a while." });
    }
    const row = await findValidToken(parsed.data.token);
    if (!row) return void res.status(410).json({ success: false, error: "This link expired or was already used. Ask for a new one." });
    if (parsed.data.password.toLowerCase() === row.user.email.toLowerCase()) {
      return void res.status(400).json({ success: false, error: "Choose a password that is not your e-mail." });
    }
    // Claim the token first so it cannot be used twice in parallel.
    const claimed = await prisma.passwordResetToken.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: new Date() } });
    if (claimed.count === 0) return void res.status(410).json({ success: false, error: "This link was already used. Ask for a new one." });

    await prisma.user.update({ where: { id: row.userId }, data: { passwordHash: await hashPassword(parsed.data.password), mustChangePassword: false } });
    await prisma.passwordResetToken.updateMany({ where: { userId: row.userId, usedAt: null }, data: { usedAt: new Date() } });
    await prisma.$executeRaw`DELETE FROM "session" WHERE sess->>'userId' = ${row.userId}`.catch(() => 0);
    await sendChangedEmail(row.user.email, row.user.name, row.user.organization.name, ip).catch((e) => console.error("[password-reset] notice failed", e));
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});
