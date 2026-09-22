/**
 * HTML pages / in-app pages disabled for System SaaS product surface.
 * Direct URL hits are redirected to dashboard.html.
 */
export const SAAS_DISABLED_HTML = new Set([
  "marketing.html",
  "projects.html",
  "builder-payments-forecast.html",
  "builder-portal.html",
  "builder-gallery.html",
  "builder-gallery-admin.html",
  "builder-messages.html",
  "builder-messages-admin.html",
  "financial.html",
  // Partner portal surfaces bundled with Portal do Builder
  "builder-login.html",
  "builder-calculator.html",
  "builder-calculator-share.html",
  "builder-calendar.html",
  "builder-change-password.html",
  "builder-estimate-request.html",
  "builder-estimate-requests.html",
  "builder-forgot-password.html",
  "builder-history.html",
  "builder-pricing.html",
  "builder-profile.html",
  "builder-project.html",
  "builder-referrals.html",
]);

export const SAAS_DISABLED_INAPP_PAGES = new Set([
  "marketing",
  "schedule",
  "projects",
  "activities",
  "financeiro",
]);
