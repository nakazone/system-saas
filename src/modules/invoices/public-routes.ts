import { Router } from "express";
import { param } from "../../lib/http/params.js";
import { withTenantTransaction } from "../../lib/tenant/prisma-tenant.js";
import { lookupPublicAccessToken } from "../../lib/quotes/public-token.js";
import { prisma } from "../../lib/prisma.js";
import { recordActivity } from "../../lib/activity/record.js";
import { computeInvoiceMoney, paymentMethodLabel } from "../../lib/invoices/core.js";
import {
  clientOf,
  contractSummaryOf,
  docOrgOf,
  invoiceDetailInclude,
  jobNumberOf,
  projectNameOf,
  quoteNumberOf,
  renderInvoicePdf,
  resolvedInvoiceLines,
  servicesTotalOf,
} from "../../lib/invoices/service.js";

export const publicInvoicesRouter = Router();

async function loadPublicInvoice(token: string) {
  const ref = await lookupPublicAccessToken(token);
  if (!ref || ref.entityType !== "invoice") return null;
  const invoice = await withTenantTransaction(ref.organizationId, (tx) =>
    tx.quoteInvoice.findFirst({ where: { id: ref.entityId }, include: invoiceDetailInclude }),
  );
  const organization = await prisma.organization.findUnique({ where: { id: ref.organizationId } });
  if (!invoice || invoice.status === "void" || invoice.status === "draft" || !organization) return null;
  return { ref, invoice, organization };
}

publicInvoicesRouter.get("/:token", async (req, res, next) => {
  try {
    const data = await loadPublicInvoice(param(req, "token"));
    if (!data) {
      res.status(404).send("Invoice link not found or expired");
      return;
    }
    const { invoice, organization, ref } = data;

    // First client view → "Viewed" in the CRM.
    if (!invoice.viewedAt) {
      await withTenantTransaction(ref.organizationId, async (tx) => {
        await tx.quoteInvoice.update({ where: { id: invoice.id }, data: { viewedAt: new Date() } });
        await recordActivity(tx, {
          organizationId: ref.organizationId,
          entityType: "invoice",
          entityId: invoice.id,
          actorType: "customer",
          action: "viewed",
        });
      });
    }

    const m = computeInvoiceMoney(invoice);
    const summary = contractSummaryOf(invoice);
    res.render("invoices/public", {
      title: invoice.invoiceNumber || "Invoice",
      organization,
      docOrg: docOrgOf(organization),
      invoice,
      client: clientOf(invoice),
      quoteNumber: quoteNumberOf(invoice.quote),
      jobNumber: jobNumberOf(invoice.workOrder),
      projectName: projectNameOf(invoice),
      lineItems: resolvedInvoiceLines(invoice),
      servicesTotal: servicesTotalOf(invoice),
      contractSummary: summary,
      money: m,
      paid: m.paid,
      balance: m.balance,
      payments: invoice.receipts.map((r) => ({
        number: r.receiptNumber,
        paidAt: r.paidAt,
        amount: Number(r.amount),
        method: paymentMethodLabel(r.method),
      })),
      pdfUrl: `${req.baseUrl}/${encodeURIComponent(param(req, "token"))}/pdf`,
    });
  } catch (error) {
    next(error);
  }
});

publicInvoicesRouter.get("/:token/pdf", async (req, res, next) => {
  try {
    const data = await loadPublicInvoice(param(req, "token"));
    if (!data) {
      res.status(404).send("Invoice link not found or expired");
      return;
    }
    const buf = await renderInvoicePdf(data.invoice, data.organization);
    const name = String(data.invoice.invoiceNumber || "invoice").replace(/[^\w.-]+/g, "-");
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${name}.pdf"`);
    res.send(buf);
  } catch (error) {
    next(error);
  }
});
