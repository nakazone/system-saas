/**
 * Master › empresa › Ofício: choose the company's trade pack (Hardwood, Tile…), optionally adding
 * the trade's default services (no prices) to the Tabela de Valores. Needs the authenticator code.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { createOrganizationWithAdmin } from "../src/modules/organizations/service.js";
import { withTenantTransaction } from "../src/lib/tenant/prisma-tenant.js";
import { hashPassword } from "../src/lib/auth/password.js";
import { encryptSecret, generateTotpSecret, totpAt } from "../src/lib/auth/totp.js";
import { resetThrottle } from "../src/master/auth.js";
import { getPack } from "../src/lib/trades/index.js";
import { createApp } from "../src/app.js";

const probe = new PrismaClient();
const privileged = await probe
  .$queryRaw<{ ok: boolean }[]>`SELECT (rolsuper OR rolbypassrls) AS ok FROM pg_roles WHERE rolname = current_user`
  .then((r) => Boolean(r[0]?.ok))
  .catch(() => false)
  .finally(() => probe.$disconnect());

describe.skipIf(!privileged)("Master: ofício da empresa", () => {
  const prisma = new PrismaClient();
  const suffix = `mt${Date.now().toString(36)}`;
  const secret = generateTotpSecret();
  const masterEmail = `master-${suffix}@example.com`;
  let server: import("node:http").Server;
  let base = "";
  let cookie = "";
  let orgId = "";
  const cookieOf = (r: Response) => (r.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
  async function form(p: string, body: Record<string, string>) {
    const r = await fetch(base + p, {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json", "X-Requested-With": "fetch" },
      body: new URLSearchParams(body),
    });
    return { status: r.status, json: (await r.json().catch(() => ({}))) as Record<string, any> };
  }
  const tradeOf = async () => (await prisma.organization.findUniqueOrThrow({ where: { id: orgId }, select: { tradePacks: true } })).tradePacks;
  const services = () => withTenantTransaction(orgId, (tx) => tx.pricingItem.count({ where: { organizationId: orgId } }));

  beforeAll(async () => {
    resetThrottle();
    const a = await createOrganizationWithAdmin({ organizationName: `Trade Co ${suffix}`, slug: `trade-${suffix}`, adminName: "Pat Admin", adminEmail: `pat-${suffix}@example.com`, password: "password12345" });
    orgId = a.organization.id;
    await prisma.$executeRaw`UPDATE "PlatformAdmin" SET role = 'ADMIN' WHERE role = 'MASTER'`;
    await prisma.platformAdmin.create({ data: { email: masterEmail, name: "Naka Trade", role: "MASTER", status: "active", passwordHash: await hashPassword("master-password-123"), totpSecretEnc: encryptSecret(secret, process.env.SESSION_SECRET!), totpEnabledAt: new Date(), recoveryCodeHashes: [] } });
    server = createApp().listen(0);
    base = `http://127.0.0.1:${(server.address() as import("node:net").AddressInfo).port}`;
    const r1 = await fetch(`${base}/master/entrar`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ email: masterEmail, password: "master-password-123" }), redirect: "manual" });
    cookie = cookieOf(r1);
    const r2 = await fetch(`${base}/master/2fa`, { method: "POST", headers: { Cookie: cookie, "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ code: totpAt(secret, Date.now()) }), redirect: "manual" });
    cookie = cookieOf(r2) || cookie;
  });
  afterAll(async () => {
    server?.close();
    await prisma.organization.deleteMany({ where: { id: orgId } });
    await prisma.platformAdmin.deleteMany({ where: { email: masterEmail } });
    await prisma.$disconnect();
  });

  it("the company page shows the trade and the choice", async () => {
    const html = await (await fetch(`${base}/master/clientes/${orgId}`, { headers: { Cookie: cookie } })).text();
    expect(html).toContain("Hardwood &amp; LVP · Hardwood · LVP · Refinishing");
    expect(html).toContain(`action="/master/clientes/${orgId}/oficio"`);
    expect(html).toContain('value="tile"');
  });

  it("asks for the authenticator code again when it is stale", async () => {
    const admin = await prisma.platformAdmin.findUniqueOrThrow({ where: { email: masterEmail } });
    await prisma.$executeRaw`UPDATE "session" SET sess = jsonb_set(sess::jsonb, '{master,stepUpAt}', '0')::json WHERE sess->'master'->>'adminId' = ${admin.id}`;
    const r = await form(`/master/clientes/${orgId}/oficio`, { trade: "tile" });
    expect(r.status).not.toBe(200);
    expect(await tradeOf()).toEqual(["hardwood"]);
    expect((await form("/master/step-up", { code: totpAt(secret, Date.now()) })).status).toBe(200);
  });

  it("switches to Tile, adds the tile services without prices, keeps the existing ones, and logs it", async () => {
    const before = await services();
    expect(before).toBeGreaterThan(0);
    const r = await form(`/master/clientes/${orgId}/oficio`, { trade: "tile", seed: "1" });
    expect(r.status).toBe(200);
    expect(r.json.message).toContain("Hardwood & LVP → Tile");
    expect(await tradeOf()).toEqual(["tile"]);
    // Names the company already has (same name and group) are kept, not duplicated.
    const log = await prisma.platformAuditLog.findFirst({ where: { action: "tenant.trade", targetId: orgId }, orderBy: { at: "desc" } });
    const added = Number((log?.meta as { servicesAdded?: number })?.servicesAdded);
    expect(added).toBeGreaterThan(getPack("tile").services.length - 5);
    expect(await services()).toBe(before + added);
    const priced = await withTenantTransaction(orgId, (tx) => tx.pricingItem.count({ where: { organizationId: orgId, name: getPack("tile").services[0]!.name, price: { gt: 0 } } }));
    expect(priced).toBe(0);
    expect(log?.meta).toMatchObject({ from: "hardwood", to: "tile" });
    expect(log?.stepUp).toBe(true);

    // Seeding again adds nothing; the same trade without seeding is "nothing changed".
    expect((await form(`/master/clientes/${orgId}/oficio`, { trade: "tile", seed: "1" })).json.message).toContain("0 serviço(s)");
    expect((await form(`/master/clientes/${orgId}/oficio`, { trade: "tile" })).json.message).toBe("Nada mudou.");
  });

  it("refuses an unknown trade and goes back to Hardwood without touching prices", async () => {
    expect((await form(`/master/clientes/${orgId}/oficio`, { trade: "carpet" })).status).toBe(400);
    const n = await services();
    expect((await form(`/master/clientes/${orgId}/oficio`, { trade: "hardwood" })).status).toBe(200);
    expect(await tradeOf()).toEqual(["hardwood"]);
    expect(await services()).toBe(n);
  });
});
