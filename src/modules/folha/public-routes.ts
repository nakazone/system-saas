/**
 * Public Folha conference ticket — opened from WhatsApp / SMS without CRM login.
 * URL: /f/<token>?w=YYYY-MM-DD
 */
import { Router } from "express";
import { param } from "../../lib/http/params.js";
import { lookupPublicAccessToken } from "../../lib/quotes/public-token.js";
import { prisma } from "../../lib/prisma.js";
import { buildConferenceEmailHtml, buildConferencePdf } from "../../lib/payroll/conference-report.js";
import { resolveConference } from "../../crm/routes/folha-admin.js";

export const publicFolhaRouter = Router();

const TOKEN_RE = /^[A-Za-z0-9_-]{16,64}$/;
const WEEK_RE = /^\d{4}-\d{2}-\d{2}$/;

async function resolvePublicConference(rawToken: string, week: string) {
  if (!TOKEN_RE.test(rawToken) || !WEEK_RE.test(week)) return null;
  const ref = await lookupPublicAccessToken(rawToken);
  if (!ref || ref.entityType !== "folha_conference") return null;
  try {
    const { input } = await resolveConference(ref.organizationId, week, ref.entityId);
    if (ref.tokenId) {
      prisma.publicAccessToken
        .update({ where: { id: ref.tokenId }, data: { lastUsedAt: new Date(), viewedAt: new Date() } })
        .catch(() => undefined);
    }
    return input;
  } catch {
    return null;
  }
}

publicFolhaRouter.get("/:token", async (req, res, next) => {
  try {
    const week = String(req.query.w || req.query.week || "");
    const input = await resolvePublicConference(param(req, "token"), week);
    if (!input) {
      res.status(404).type("html").send(`<!DOCTYPE html><html><body style="font-family:system-ui;padding:40px;text-align:center;color:#211d1a">
        <h1 style="font-size:20px">Link inválido ou expirado</h1>
        <p style="color:#8a8074">Peça um novo relatório de conferência ao escritório.</p>
      </body></html>`);
      return;
    }
    const html = buildConferenceEmailHtml(input);
    const pdfHref = `${req.baseUrl}/${encodeURIComponent(param(req, "token"))}/pdf?w=${encodeURIComponent(week)}`;
    const withPdf = html.replace(
      "</body>",
      `<div style="max-width:560px;margin:0 auto;padding:0 16px 32px;text-align:center">
        <a href="${pdfHref}" style="display:inline-block;margin-top:8px;padding:12px 18px;border-radius:12px;background:#211d1a;color:#fff;font-weight:800;font-size:14px;text-decoration:none;font-family:'Plus Jakarta Sans',system-ui,sans-serif">Baixar PDF</a>
      </div></body>`,
    );
    res.type("html").send(withPdf);
  } catch (error) {
    next(error);
  }
});

publicFolhaRouter.get("/:token/pdf", async (req, res, next) => {
  try {
    const week = String(req.query.w || req.query.week || "");
    const input = await resolvePublicConference(param(req, "token"), week);
    if (!input) {
      res.status(404).send("Link inválido ou expirado");
      return;
    }
    const pdf = await buildConferencePdf(input);
    const name = String(input.employeeName || "folha")
      .replace(/[^\w.-]+/g, "-")
      .slice(0, 40);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="folha-${name}.pdf"`);
    res.send(pdf);
  } catch (error) {
    next(error);
  }
});
