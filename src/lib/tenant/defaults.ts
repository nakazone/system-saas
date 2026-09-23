/**
 * Default permission catalog and role matrices for new organizations.
 *
 * Role key mapping (Phase 2 M1):
 * - admin → full access including settings/users
 * - general_manager → all operational + reports; no account settings/roles
 * - office → leads, customers, quotes, projects, schedule, invoices, imports
 * - sales → leads, customers, quotes, pipeline (with pricing.view)
 * - crew_lead → schedule/visits/projects context; no pricing.view
 * - installer → visits only; no pricing.view
 *
 * Legacy keys (sales_rep, project_manager, support) are not seeded for new orgs.
 * Existing orgs keep their roles; Settings → Users can add missing Phase 2 defaults.
 */

export const DEFAULT_PERMISSIONS = [
  { key: "leads.view", group: "leads", description: "View leads" },
  { key: "leads.create", group: "leads", description: "Create leads" },
  { key: "leads.edit", group: "leads", description: "Edit leads" },
  { key: "leads.delete", group: "leads", description: "Delete leads" },
  { key: "customers.view", group: "customers", description: "View customers" },
  { key: "customers.create", group: "customers", description: "Create customers" },
  { key: "customers.edit", group: "customers", description: "Edit customers" },
  { key: "quotes.view", group: "quotes", description: "View quotes" },
  { key: "quotes.create", group: "quotes", description: "Create quotes" },
  { key: "quotes.edit", group: "quotes", description: "Edit quotes" },
  { key: "quotes.delete", group: "quotes", description: "Delete quotes" },
  { key: "users.view", group: "users", description: "View users" },
  { key: "users.create", group: "users", description: "Create users" },
  { key: "users.edit", group: "users", description: "Edit users" },
  { key: "users.delete", group: "users", description: "Delete users" },
  { key: "users.manage", group: "users", description: "Manage users and invitations" },
  { key: "roles.manage", group: "users", description: "Manage roles and permissions" },
  { key: "settings.manage", group: "settings", description: "Manage organization settings" },
  { key: "pipeline.manage", group: "leads", description: "Manage pipeline stages" },
  { key: "estimate_rules.manage", group: "quotes", description: "Manage estimate rules" },
  { key: "builders.view", group: "builders", description: "View builders" },
  { key: "builders.edit", group: "builders", description: "Edit builders" },
  { key: "payroll.view", group: "payroll", description: "View payroll" },
  { key: "payroll.manage", group: "payroll", description: "Manage payroll" },
  { key: "projects.view", group: "projects", description: "View projects" },
  { key: "reports.view", group: "reports", description: "View reports / marketing" },
  { key: "contracts.view", group: "financial", description: "View financial / contracts" },
  { key: "visits.view", group: "operations", description: "View schedule / visits" },
  { key: "pricing.view", group: "pricing", description: "View prices, costs, totals, and margins" },
  { key: "imports.manage", group: "settings", description: "Import customers and leads from CSV" },
  { key: "assessments.view", group: "operations", description: "View site assessments" },
  { key: "assessments.manage", group: "operations", description: "Create and complete site assessments" },
  { key: "checklists.manage", group: "settings", description: "Manage checklist templates" },
  { key: "invoices.view", group: "financial", description: "View invoices and customer statements" },
  { key: "invoices.manage", group: "financial", description: "Create and send invoices / edit payment schedules" },
  { key: "invoices.record_payment", group: "financial", description: "Record payments against invoices" },
  { key: "projects.manage", group: "projects", description: "Create projects and manage crews" },
  { key: "visits.manage", group: "operations", description: "Create and update visits / schedule" },
  { key: "costs.view", group: "financial", description: "View project costs, budgets, and profitability" },
] as const;

export type PermissionKey = (typeof DEFAULT_PERMISSIONS)[number]["key"];

const ALL: PermissionKey[] = DEFAULT_PERMISSIONS.map((p) => p.key);

const WITHOUT_ACCOUNT_SETTINGS: PermissionKey[] = ALL.filter(
  (k) => k !== "settings.manage" && k !== "roles.manage",
);

const OFFICE_KEYS: PermissionKey[] = [
  "leads.view",
  "leads.create",
  "leads.edit",
  "leads.delete",
  "customers.view",
  "customers.create",
  "customers.edit",
  "quotes.view",
  "quotes.create",
  "quotes.edit",
  "quotes.delete",
  "pipeline.manage",
  "projects.view",
  "visits.view",
  "contracts.view",
  "builders.view",
  "pricing.view",
  "imports.manage",
  "reports.view",
  "assessments.view",
  "assessments.manage",
  "checklists.manage",
  "invoices.view",
  "invoices.manage",
  "invoices.record_payment",
  "projects.manage",
  "visits.manage",
  "costs.view",
];

const SALES_KEYS: PermissionKey[] = [
  "leads.view",
  "leads.create",
  "leads.edit",
  "customers.view",
  "customers.create",
  "customers.edit",
  "quotes.view",
  "quotes.create",
  "quotes.edit",
  "pipeline.manage",
  "builders.view",
  "pricing.view",
  "assessments.view",
  "assessments.manage",
  "invoices.view",
  "invoices.manage",
];

const CREW_LEAD_KEYS: PermissionKey[] = [
  "leads.view",
  "customers.view",
  "projects.view",
  "projects.manage",
  "visits.view",
  "visits.manage",
  "assessments.view",
  "assessments.manage",
];

const INSTALLER_KEYS: PermissionKey[] = [
  "visits.view",
  "projects.view",
  "assessments.view",
];

export const DEFAULT_ROLE_META: Record<
  string,
  { name: string; description: string }
> = {
  admin: { name: "Admin", description: "Full access including settings and users" },
  general_manager: {
    name: "General Manager",
    description: "All operations and reports; no account settings",
  },
  office: {
    name: "Office",
    description: "Leads, customers, quotes, projects, schedule, invoices",
  },
  sales: {
    name: "Sales",
    description: "Leads, customers, quotes, and pipeline",
  },
  crew_lead: {
    name: "Crew Lead",
    description: "Crew schedule, visits, checklists; no pricing",
  },
  installer: {
    name: "Installer",
    description: "Own visits only; no pricing",
  },
};

export const DEFAULT_ROLE_PERMISSIONS: Record<string, PermissionKey[]> = {
  admin: ALL,
  general_manager: WITHOUT_ACCOUNT_SETTINGS,
  office: OFFICE_KEYS,
  sales: SALES_KEYS,
  crew_lead: CREW_LEAD_KEYS,
  installer: INSTALLER_KEYS,
};

/** Senior Floors kanban v9 stage set */
export const DEFAULT_PIPELINE_STAGES = [
  { name: "New Lead", slug: "new_lead", order: 1, color: "#3498db", isClosed: false },
  { name: "Meeting Scheduled", slug: "meeting_scheduled", order: 2, color: "#90EE90", isClosed: false },
  { name: "Quote Sent", slug: "quote_sent", order: 3, color: "#9b59b6", isClosed: false },
  { name: "Follow Up", slug: "follow_up_1", order: 4, color: "#F1C40F", isClosed: false },
  { name: "Stand By", slug: "stand_by", order: 5, color: "#f39c12", isClosed: false },
  { name: "Won", slug: "won", order: 6, color: "#27ae60", isClosed: true },
  { name: "Lost", slug: "lost", order: 7, color: "#c0392b", isClosed: true },
];

export const DEFAULT_ESTIMATE_RULES = [
  {
    flooringType: "hardwood",
    wastePercent: 10,
    materialMarkup: 30,
    laborMarkup: 40,
    defaultPricePerSqft: 8.5,
    defaultLaborPerSqft: 3.5,
  },
  {
    flooringType: "lvp",
    wastePercent: 8,
    materialMarkup: 35,
    laborMarkup: 40,
    defaultPricePerSqft: 4.25,
    defaultLaborPerSqft: 2.75,
  },
  {
    flooringType: "laminate",
    wastePercent: 8,
    materialMarkup: 35,
    laborMarkup: 35,
    defaultPricePerSqft: 3.5,
    defaultLaborPerSqft: 2.5,
  },
  {
    flooringType: "tile",
    wastePercent: 12,
    materialMarkup: 40,
    laborMarkup: 45,
    defaultPricePerSqft: 5.5,
    defaultLaborPerSqft: 6.0,
  },
  {
    flooringType: "carpet",
    wastePercent: 10,
    materialMarkup: 30,
    laborMarkup: 35,
    defaultPricePerSqft: 2.75,
    defaultLaborPerSqft: 1.5,
  },
];

export const DEFAULT_QUOTE_ADDONS = [
  {
    name: "Existing floor removal",
    description: "Remove existing flooring",
    unit: "sqft",
    unitCost: 0.5,
    unitPrice: 1.75,
    sortOrder: 1,
  },
  {
    name: "New baseboards",
    description: "Supply and install new baseboards",
    unit: "lf",
    unitCost: 2,
    unitPrice: 6.5,
    sortOrder: 2,
  },
  {
    name: "Stair tread finish",
    description: "Finish per stair tread",
    unit: "each",
    unitCost: 15,
    unitPrice: 45,
    sortOrder: 3,
  },
  {
    name: "Move furniture",
    description: "Move furniture within the work area",
    unit: "each",
    unitCost: 50,
    unitPrice: 150,
    sortOrder: 4,
  },
  {
    name: "Subfloor leveling",
    description: "Level subfloor as needed",
    unit: "sqft",
    unitCost: 1,
    unitPrice: 3.25,
    sortOrder: 5,
  },
];

export const DEFAULT_CLIENT_VIEW = {
  showQuantities: true,
  showUnitPrices: true,
  showLineTotals: true,
  showRoomBreakdown: true,
} as const;
