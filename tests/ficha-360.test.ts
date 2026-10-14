import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { createOrganizationWithAdmin } from "../src/modules/organizations/service.js";
import { healthOf, invalidateHealth, markActiveDay } from "../src/master/health.js";
import { timelineFor } from "../src/master/routes.js";
import { ymdInTz } from "../src/master/lib.js";

/** The Master reads every company outside a tenant transaction — needs a privileged DB role (as in production). */
const probe = new PrismaClient();
const privileged = await probe
  .$queryRaw<{ ok: boolean }[]>`SELECT (rolsuper OR rolbypassrls) AS ok FROM pg_roles WHERE rolname = current_user`
  .then((r) => Boolean(r[0]?.ok))
  .catch(() => false)
  .finally(() => probe.$disconnect());

describe.skipIf(!privileged)("Ficha 360° — uso, onboarding, saúde e linha do tempo", () => {
  const prisma = new PrismaClient();
  const suffix = `f3${Date.now().toString(36)}`;
  let orgId = "";
  let adminId = "";
  let idleOrgId = "";

  beforeAll(async () => {
    const a = await createOrganizationWithAdmin({ organizationName: `Ficha ${suffix}`, slug: `ficha-${suffix}`, adminName: "Fran Admin", adminEmail: `fran-${suffix}@example.com`, password: "Test-Passw0rd-2026" });
    orgId = a.organization.id;
    adminId = a.admin.id;
    const b = await createOrganizationWithAdmin({ organizationName: `Parada ${suffix}`, slug: `parada-${suffix}`, adminName: "Ivy Idle", adminEmail: `ivy-${suffix}@example.com`, password: "Test-Passw0rd-2026" });
    idleOrgId = b.organization.id;
    // Old, unpaid-free company that never used the system.
    await prisma.organization.update({ where: { id: idleOrgId }, data: { createdAt: new Date(Date.now() - 40 * 86400e3), status: "active" } });
    // Usage tracking has history (≥ 7 days) on the platform.
    await prisma.activeDay.createMany({ data: [{ userId: adminId, organizationId: orgId, day: ymdInTz(new Date(Date.now() - 20 * 86400e3)) }], skipDuplicates: true });
  });

  afterAll(async () => {
    invalidateHealth();
    await prisma.$disconnect();
  });

  it("registra o dia de uso uma vez por usuário", async () => {
    markActiveDay(adminId, orgId);
    markActiveDay(adminId, orgId);
    await new Promise((r) => setTimeout(r, 300));
    const today = ymdInTz(new Date());
    expect(await prisma.activeDay.count({ where: { userId: adminId, day: today } })).toBe(1);
  });

  it("onboarding vem dos dados reais e a nota soma as partes", async () => {
    invalidateHealth();
    let h = (await healthOf(orgId)).get(orgId)!;
    expect(h.stepsDone).toBe(0);
    expect(h.band).toBe("new");

    await prisma.lead.create({ data: { organizationId: orgId, name: "First Lead" } });
    // Default price table from signup doesn't count; an item added later does.
    await prisma.pricingItem.create({ data: { organizationId: orgId, name: "Install", createdAt: new Date(Date.now() + 15 * 60e3) } });
    await prisma.quote.create({ data: { organizationId: orgId, number: 1, title: "Kitchen", status: "sent" } });
    await prisma.quote.create({ data: { organizationId: orgId, number: 2, title: "Draft only", status: "draft" } });
    invalidateHealth();
    h = (await healthOf(orgId)).get(orgId)!;
    expect(h.steps.filter((s) => s.done).map((s) => s.key).sort()).toEqual(["lead", "prices", "quote"]);
    expect(h.score).toBe(h.parts.reduce((a, p) => a + p.points, 0));
    expect(h.activeDays14).toBe(1);
    expect(h.activeUsers30).toBe(1);
    expect(h.lastActive).toBeTruthy();
  });

  it("empresa antiga sem uso e sem onboarding fica em risco", async () => {
    invalidateHealth();
    const all = await healthOf();
    const idle = all.get(idleOrgId)!;
    expect(idle.band).toBe("risk");
    expect(idle.parts.find((p) => p.label === "Uso")!.points).toBe(0);
    expect(idle.score).toBeLessThan(50);
  });

  it("linha do tempo junta conta, primeiros passos e ações", async () => {
    await prisma.platformAuditLog.create({ data: { actorName: "Naka Teste", action: "tenant.details", targetType: "org", targetId: orgId, targetLabel: "Ficha" } });
    invalidateHealth();
    const t = await timelineFor(orgId, 50);
    const titles = t.items.map((i) => i.title);
    expect(titles).toContain("Conta criada");
    expect(titles).toContain("Primeiro lead");
    expect(titles).toContain("Primeiro orçamento enviado");
    expect(titles).toContain("Editou os dados da empresa");
    const times = t.items.map((i) => i.at.getTime());
    expect([...times].sort((a, b) => b - a)).toEqual(times);
  });
});
