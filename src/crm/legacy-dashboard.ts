/** Where a link into the retired dashboard SPA (`/dashboard.html?page=…`) should go now. */
export function legacyDashboardPageUrl(query: Record<string, unknown>): string {
  const page = String(query.page || "").toLowerCase();
  const id = typeof query.id === "string" ? query.id : "";
  const edit = typeof query.edit === "string" ? query.edit : "";
  const isNew = query.new === "1";
  const enc = encodeURIComponent;
  switch (page) {
    case "leads":
      return id ? `/lead-detail.html?id=${enc(id)}` : isNew ? "/leads.html?new=1" : "/leads.html";
    case "customers": {
      const cid = edit || id;
      return cid ? `/customers.html?id=${enc(cid)}` : isNew ? "/customers.html?new=1" : "/customers.html";
    }
    case "quotes":
      return id ? `/quote-builder.html?id=${enc(id)}` : "/quotes.html";
    case "invoices":
      return id ? `/invoice.html?id=${enc(id)}` : "/invoices.html";
    case "schedule":
      return "/schedule.html";
    case "users":
      return "/configuracoes.html#usuarios";
    default:
      // dashboard, crm, activities, projects and anything unknown → Início
      return "/dashboard";
  }
}
