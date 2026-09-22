import { createOrganizationWithAdmin } from "../src/modules/organizations/service.js";

async function main() {
  try {
    const r = await createOrganizationWithAdmin({
      organizationName: "Demo Floors Co",
      slug: "demo",
      adminName: "Demo Admin",
      adminEmail: "admin@demo.example",
      password: "password12345",
    });
    console.log("created", r.organization.slug, r.admin.email);
  } catch (e) {
    console.log("skip/create:", e instanceof Error ? e.message : e);
  }
}

main();
