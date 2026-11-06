import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { readdirSync, readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { createApp } from "../src/app.js";
import { createOrganizationWithAdmin } from "../src/modules/organizations/service.js";
import { hashPassword } from "../src/lib/auth/password.js";
import { DEFAULT_PERMISSIONS } from "../src/lib/tenant/defaults.js";

describe("Campo pages", () => {
  it("install as ObraCrew", () => {
    const dir = "crm/public/campo";
    const pages = readdirSync(dir).filter((f) => f.endsWith(".html") && f !== "index.html");
    for (const page of pages) {
      const html = readFileSync(`${dir}/${page}`, "utf8");
      expect(html, page).toContain("/obracrew.webmanifest");
      expect(html, page).toContain("/assets/obracrew/apple-touch-icon.png");
      expect(html, page).toContain('content="ObraCrew"');
    }
  });
});

const probe = new PrismaClient();
const privileged = await probe
  .$queryRaw<{ ok: boolean }[]>`SELECT (rolsuper OR rolbypassrls) AS ok FROM pg_roles WHERE rolname = current_user`
  .then((r) => Boolean(r[0]?.ok))
  .catch(() => false)
  .finally(() => probe.$disconnect());

describe.skipIf(!privileged)("GET /obracrew", () => {
  const prisma = new PrismaClient();
  let server: Server;
  let base = "";
  const cookies: Record<string, string> = {};
  const suffix = `cw${Date.now().toString(36)}`;

  async function login(email: string, organizationId: string) {
    const r = await fetch(`${base}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: "password12345", organizationId }),
      redirect: "manual",
    });
    return (r.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
  }

  beforeAll(async () => {
    for (const p of DEFAULT_PERMISSIONS) {
      await prisma.permission.upsert({ where: { key: p.key }, create: { key: p.key, group: p.group, description: p.description }, update: {} });
    }
    const adminEmail = `admin-${suffix}@example.com`;
    const a = await createOrganizationWithAdmin({ organizationName: `Crew ${suffix}`, slug: `crew-${suffix}`, adminName: "Admin", adminEmail, password: "password12345" });
    const orgId = a.organization.id;
    for (const key of ["installer", "crew_lead"]) {
      const role = await prisma.role.findFirst({ where: { organizationId: orgId, key } });
      const u = await prisma.user.create({ data: { organizationId: orgId, email: `${key}-${suffix}@example.com`, name: key, passwordHash: await hashPassword("password12345"), roleId: role!.id, status: "active" } });
      // the crew lead is on the sanding crew; the installer has no employee record (falls back to installation)
      if (key === "crew_lead") await prisma.payrollEmployee.create({ data: { organizationId: orgId, userId: u.id, name: "Lead", sector: "sand_finish" } });
    }
    const app = createApp();
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => resolve());
    });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    cookies.admin = await login(adminEmail, orgId);
    cookies.installer = await login(`installer-${suffix}@example.com`, orgId);
    cookies.lead = await login(`crew_lead-${suffix}@example.com`, orgId);
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    await prisma.$disconnect();
  });

  it("sends the field team to their day", async () => {
    for (const cookie of [cookies.installer, cookies.lead]) {
      const r = await fetch(`${base}/obracrew`, { headers: { Cookie: cookie }, redirect: "manual" });
      expect(r.status).toBe(302);
      expect(r.headers.get("location")).toBe("/campo/hoje.html");
    }
  });

  it("explains to other roles that the app is for the field team", async () => {
    const r = await fetch(`${base}/obracrew`, { headers: { Cookie: cookies.admin } });
    expect(await r.text()).toContain("é para a equipe de campo");
  });

  it("serves the manifest", async () => {
    const r = await fetch(`${base}/obracrew.webmanifest`);
    const m = (await r.json()) as { name: string };
    expect(m.name).toBe("ObraCrew");
  });

  it("serves the sanding crew's manifest: same app, sanding icon", async () => {
    const r = await fetch(`${base}/obracrew-lixa.webmanifest`);
    const m = (await r.json()) as { name: string; id: string; icons: { src: string }[] };
    expect(m.name).toBe("ObraCrew");
    expect(m.id).toBe("/obracrew");
    expect(m.icons.every((i) => i.src.startsWith("/assets/obracrew/lixa/"))).toBe(true);
  });

  it("tells each employee their crew", async () => {
    const sand = await (await fetch(`${base}/api/campo/setor`, { headers: { Cookie: cookies.lead } })).json();
    expect(sand.data.sector).toBe("sand_finish");
    const none = await (await fetch(`${base}/api/campo/setor`, { headers: { Cookie: cookies.installer } })).json();
    expect(none.data.sector).toBeNull();
  });
});

describe("crew icon", () => {
  it("points the sanding crew at its own icon and manifest", () => {
    const js = readFileSync("crm/public/campo/campo-nav.js", "utf8");
    expect(js).toContain("/api/campo/setor");
    expect(js).toContain("/assets/obracrew/lixa/apple-touch-icon.png");
    expect(js).toContain("/obracrew-lixa.webmanifest");
  });
});

describe("saas-branding", () => {
  it("keeps the ObraCrew icon on Campo pages", () => {
    const js = readFileSync("crm/public/saas-branding.js", "utf8");
    expect(js).toContain("/^\\/campo\\//.test(location.pathname)");
    expect(js).toContain("obracam|obracrew");
  });
});
