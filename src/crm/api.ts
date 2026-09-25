/**
 * SF-compatible multi-tenant CRM APIs for System SaaS.
 * Modules: Dashboard, Leads, Quotes, Invoice, Cadastro, Builders, Pricing, Payroll, Users.
 */
import { Router } from "express";
import { dashboardLeadsRouter } from "./routes/dashboard-leads.js";
import { customersQuotesRouter } from "./routes/customers-quotes.js";
import { buildersPricingRouter } from "./routes/builders-pricing.js";
import { cadastroPayrollUsersRouter } from "./routes/cadastro-payroll-users.js";
import { constructionPayrollRouter } from "./routes/construction-payroll.js";
import { brandingRouter } from "./routes/branding.js";
import { supportRouter } from "./routes/support.js";
import { pushRouter } from "./routes/push.js";
import { scheduleJobsRouter } from "./routes/schedule-jobs.js";
import { financeRouter } from "./routes/finance.js";
import { campoPontoRouter } from "./routes/campo-ponto.js";
import { campoJobsRouter } from "./routes/campo-jobs.js";
import { campoHorasRouter } from "./routes/campo-horas.js";

export const crmApiRouter = Router();

crmApiRouter.use(brandingRouter);
crmApiRouter.use(supportRouter);
crmApiRouter.use(pushRouter);
crmApiRouter.use(scheduleJobsRouter);
crmApiRouter.use(financeRouter);
crmApiRouter.use(dashboardLeadsRouter);
crmApiRouter.use(customersQuotesRouter);
crmApiRouter.use(buildersPricingRouter);
crmApiRouter.use(constructionPayrollRouter);
crmApiRouter.use(cadastroPayrollUsersRouter);
crmApiRouter.use(campoPontoRouter);
crmApiRouter.use(campoJobsRouter);
crmApiRouter.use(campoHorasRouter);
