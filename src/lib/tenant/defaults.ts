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
  { key: "users.manage", group: "users", description: "Manage users and invitations" },
  { key: "roles.manage", group: "users", description: "Manage roles and permissions" },
  { key: "settings.manage", group: "settings", description: "Manage organization settings" },
  { key: "pipeline.manage", group: "leads", description: "Manage pipeline stages" },
  { key: "estimate_rules.manage", group: "quotes", description: "Manage estimate rules" },
] as const;

export type PermissionKey = (typeof DEFAULT_PERMISSIONS)[number]["key"];

export const DEFAULT_ROLE_PERMISSIONS: Record<string, PermissionKey[]> = {
  admin: DEFAULT_PERMISSIONS.map((p) => p.key),
  sales_rep: [
    "leads.view",
    "leads.create",
    "leads.edit",
    "customers.view",
    "customers.create",
    "customers.edit",
    "quotes.view",
    "quotes.create",
    "quotes.edit",
  ],
  project_manager: [
    "leads.view",
    "customers.view",
    "customers.edit",
    "quotes.view",
    "quotes.edit",
  ],
  support: ["leads.view", "customers.view", "quotes.view"],
};

export const DEFAULT_PIPELINE_STAGES = [
  { name: "New", order: 1, color: "#64748b" },
  { name: "Contacted", order: 2, color: "#2563eb" },
  { name: "Qualified", order: 3, color: "#7c3aed" },
  { name: "Proposal", order: 4, color: "#ea580c" },
  { name: "Won", order: 5, color: "#16a34a" },
  { name: "Lost", order: 6, color: "#dc2626" },
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
