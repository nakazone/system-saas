/**
 * Lead origin badge — Meta / Google / ObraMate (manual, builder, loja, etc.).
 * Shared by kanban cards and mobile lead lists.
 */
(function (g) {
  "use strict";
  if (g.OmLeadOrigin) return;

  const OM_FAVICON = "/assets/favicon-192.png?v=20260924-pwa";

  function resolve(lead) {
    if (!lead) return "obramate";
    const source = String(lead.source || "").trim().toLowerCase();
    const formType = String(lead.form_type || "").trim().toLowerCase();
    const platform = String(lead.marketing_platform || "").trim().toLowerCase();
    const utm = String(lead.utm_source || "").trim().toLowerCase();
    const medium = String(lead.utm_medium || "").trim().toLowerCase();
    const blob = [source, formType, platform, utm, medium].join(" ");

    if (
      /meta-instant|meta_instant/.test(blob) ||
      /\bmeta\b/.test(blob) ||
      /facebook|fbclid|instagram|\big\b/.test(blob)
    ) {
      return "meta";
    }
    if (
      /^lp[-_]?/i.test(String(lead.source || "").trim()) ||
      /lp-contact|lp-hero|lp_contact|lp_hero/.test(blob) ||
      /google|gclid|adwords|landing/.test(blob) ||
      formType === "hero-form" ||
      formType === "contact-form"
    ) {
      return "google";
    }
    // Manual CRM, builder portal, lojas, or anything else → ObraMate
    return "obramate";
  }

  function logoHtml(lead) {
    const origin = resolve(lead);
    if (origin === "meta") {
      return (
        `<span class="kanban-card-origin-logo kanban-card-origin-logo--meta lead-origin" title="Meta / Facebook" aria-label="Facebook">` +
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">` +
        `<path fill="#1877F2" d="M24 12.07C24 5.41 18.63 0 12 0S0 5.41 0 12.07C0 18.1 4.39 23.1 10.13 24v-8.44H7.08v-3.49h3.05v-2.66c0-3.02 1.79-4.7 4.54-4.7 1.31 0 2.68.24 2.68.24v2.95h-1.51c-1.49 0-1.95.93-1.95 1.89v2.28h3.32l-.53 3.49h-2.79V24C19.61 23.1 24 18.1 24 12.07z"/>` +
        `</svg></span>`
      );
    }
    if (origin === "google") {
      return (
        `<span class="kanban-card-origin-logo kanban-card-origin-logo--google lead-origin" title="Google / Landing page" aria-label="Google">` +
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">` +
        `<path fill="#4285F4" d="M23.49 12.27c0-.79-.07-1.54-.2-2.27H12v4.3h6.44a5.5 5.5 0 0 1-2.39 3.61v3h3.87c2.26-2.09 3.57-5.17 3.57-8.64z"/>` +
        `<path fill="#34A853" d="M12 24c3.24 0 5.95-1.07 7.93-2.91l-3.87-3a7.1 7.1 0 0 1-4.06 1.15c-3.12 0-5.76-2.11-6.7-4.94H1.3v3.09A12 12 0 0 0 12 24z"/>` +
        `<path fill="#FBBC05" d="M5.3 14.3A7.2 7.2 0 0 1 4.92 12c0-.8.14-1.58.38-2.3V6.61H1.3A12 12 0 0 0 0 12c0 1.94.46 3.77 1.3 5.39l4-3.09z"/>` +
        `<path fill="#EA4335" d="M12 4.77c1.76 0 3.34.61 4.58 1.8l3.43-3.43C17.95 1.19 15.24 0 12 0A12 12 0 0 0 1.3 6.61l4 3.09C6.24 6.88 8.88 4.77 12 4.77z"/>` +
        `</svg></span>`
      );
    }
    return (
      `<span class="kanban-card-origin-logo kanban-card-origin-logo--om lead-origin" title="ObraMate" aria-label="ObraMate">` +
      `<img src="${OM_FAVICON}" alt="" width="14" height="14" decoding="async" />` +
      `</span>`
    );
  }

  const api = { resolve, logoHtml, OM_FAVICON };
  g.OmLeadOrigin = api;
  // Back-compat for existing kanban callers
  g.resolveKanbanLeadOrigin = resolve;
  g.kanbanOriginLogoHtml = logoHtml;
})(typeof window !== "undefined" ? window : globalThis);
