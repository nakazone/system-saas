import { Router } from "express";
import { param } from "../../lib/http/params.js";
import { withTenantTransaction } from "../../lib/tenant/prisma-tenant.js";
import { lookupPublicAccessToken } from "../../lib/quotes/public-token.js";
import { paidTotalCents, toCents, fromCents } from "../../lib/payments/engine.js";
import { prisma } from "../../lib/prisma.js";

export const publicInvoicesRouter = Router();

publicInvoicesRouter.get("/:token", async (req, res, next) => {
  try {
    const ref = await lookupPublicAccessToken(param(req, "token"));
    if (!ref || ref.entityType !== "invoice") {
      res.status(404).send("Invoice link not found or expired");
      return;
    }

    const data = await withTenantTransaction(ref.organizationId, async (tx) => {
      const invoice = await tx.quoteInvoice.findFirst({
        where: { id: ref.entityId },
        include: {
          lineItems: { orderBy: { sortOrder: "asc" } },
          receipts: true,
          customer: true,
          quote: true,
        },
      });
      const organization = await prisma.organization.findUnique({
        where: { id: ref.organizationId },
      });
      return { invoice, organization };
    });

    if (!data.invoice || data.invoice.status === "void" || !data.organization) {
      res.status(404).send("Invoice not available");
      return;
    }

    const paid = fromCents(paidTotalCents(data.invoice.receipts));
    res.render("invoices/public", {
      title: data.invoice.invoiceNumber || "Invoice",
      organization: data.organization,
      invoice: data.invoice,
      paid,
      balance: fromCents(toCents(data.invoice.amount) - paidTotalCents(data.invoice.receipts)),
    });
  } catch (error) {
    next(error);
  }
});
