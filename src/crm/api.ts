/**
 * SF-compatible multi-tenant CRM APIs for System SaaS.
 * Modules: Dashboard, Leads, Quotes, Invoice, Cadastro, Builders, Pricing, Payroll, Users.
 */
import { Router } from "express";
import { dashboardLeadsRouter } from "./routes/dashboard-leads.js";
import { customersQuotesRouter } from "./routes/customers-quotes.js";
import { buildersPricingRouter } from "./routes/builders-pricing.js";
import { cadastroPayrollUsersRouter } from "./routes/cadastro-payroll-users.js";
import { brandingRouter } from "./routes/branding.js";
import { supportRouter } from "./routes/support.js";
import { pushRouter } from "./routes/push.js";
import { scheduleJobsRouter } from "./routes/schedule-jobs.js";

export const crmApiRouter = Router();

crmApiRouter.use(brandingRouter);
crmApiRouter.use(supportRouter);
crmApiRouter.use(pushRouter);
crmApiRouter.use(scheduleJobsRouter);
crmApiRouter.use(dashboardLeadsRouter);
crmApiRouter.use(customersQuotesRouter);
crmApiRouter.use(buildersPricingRouter);
crmApiRouter.use(cadastroPayrollUsersRouter);
