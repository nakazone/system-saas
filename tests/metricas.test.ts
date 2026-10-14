import { describe, it, expect, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { createOrganizationWithAdmin } from "../src/modules/organizations/service.js";
import { monthEnds, movementFrom, mrrFromPayments, takeSnapshot, trialFunnel, type MonthPoint } from "../src/master/metrics.js";

const probe = new PrismaClient();
const privileged = await probe
  .$queryRaw<{ ok: boolean }[]>`SELECT (rolsuper OR rolbypassrls) AS ok FROM pg_roles WHERE rolname = current_user`
  .then((r) => Boolean(r[0]?.ok))
  .catch(() => false)
  .finally(() => probe.$disconnect());

const D = (s: string) => new Date(s);

describe("Métricas — cálculos", () => {
  it("MRR pelos pagamentos: mensal conta inteiro, anual ÷ 12, fora do período não conta", () => {
    const pays = [
      { organizationId: "a", amountCents: 12900, periodStart: D("2026-09-10T00:00:00Z"), periodEnd: D("2026-10-10T00:00:00Z"), paidAt: D("2026-09-10T00:00:00Z") },
      { organizationId: "b", amountCents: 129000, periodStart: D("2026-01-15T00:00:00Z"), periodEnd: D("2027-01-15T00:00:00Z"), paidAt: D("2026-01-15T00:00:00Z") },
      { organizationId: "c", amountCents: 29900, periodStart: D("2026-07-01T00:00:00Z"), periodEnd: D("2026-08-01T00:00:00Z"), paidAt: D("2026-07-01T00:00:00Z") },
    ];
    expect(mrrFromPayments(pays, D("2026-09-30T23:00:00Z"))).toEqual({ a: 12900, b: 10750 });
  });

  it("movimento: nova, upgrade, downgrade, cancelada e quem voltou; churn em empresas e receita", () => {
    const pt = (ym: string, m: Record<string, number>, estimated = false): MonthPoint => ({ ym, label: ym, mrrCents: Object.values(m).reduce((a, b) => a + b, 0), paying: Object.keys(m).length, estimated, orgMrr: m, estOrgMrr: m });
    const mv = movementFrom([
      pt("2026-07", { a: 100, b: 200, c: 300 }),
      pt("2026-08", { a: 150, b: 100, d: 400 }), // a up 50, b down 100, c churned 300, d new 400
      pt("2026-09", { a: 150, b: 100, d: 400, c: 300 }), // c came back
    ]);
    expect(mv[0]).toMatchObject({ newCents: 400, expansionCents: 50, contractionCents: 100, churnCents: 300, reactivationCents: 0, netCents: 50, churnedCompanies: 1, startPaying: 3 });
    expect(mv[0].logoChurnPct).toBeCloseTo(33.3, 1);
    expect(mv[0].revenueChurnPct).toBeCloseTo(66.7, 1);
    expect(mv[1]).toMatchObject({ reactivationCents: 300, newCents: 0, netCents: 300 });
  });

  it("compara igual com igual: mês da foto diária vs mês estimado usa os dois estimados", () => {
    const est: MonthPoint = { ym: "2026-09", label: "set", mrrCents: 1000, paying: 2, estimated: true, orgMrr: { a: 500, b: 500 }, estOrgMrr: { a: 500, b: 500 } };
    const snap: MonthPoint = { ym: "2026-10", label: "out", mrrCents: 500, paying: 1, estimated: false, orgMrr: { a: 500 }, estOrgMrr: { a: 500, b: 500 } };
    const [m] = movementFrom([est, snap]);
    expect(m.churnCents).toBe(0);
    expect(m.estimated).toBe(true);
  });

  it("fim de cada mês: o mês atual termina hoje", () => {
    const e = monthEnds(3, D("2026-10-14T18:00:00Z"));
    expect(e.map((x) => x.endDay)).toEqual(["2026-08-31", "2026-09-30", "2026-10-14"]);
  });
});

describe.skipIf(!privileged)("Métricas — foto diária e funil", () => {
  const prisma = new PrismaClient();
  const suffix = `mx${Date.now().toString(36)}`;
  afterAll(async () => {
    await prisma.platformDailyMetric.deleteMany({ where: { day: "2099-01-01" } });
    await prisma.$disconnect();
  });

  it("foto diária grava MRR e empresas pagando, e pode ser refeita no mesmo dia", async () => {
    const a = await createOrganizationWithAdmin({ organizationName: `Paga ${suffix}`, slug: `paga-${suffix}`, adminName: "Pia Paga", adminEmail: `pia-${suffix}@example.com`, password: "Test-Passw0rd-2026" });
    await prisma.organization.update({ where: { id: a.organization.id }, data: { status: "active", plan: "starter", billingCycle: "monthly", planPriceCents: 4200 } });
    const s1 = await takeSnapshot(new Date(), "2099-01-01");
    expect((s1.orgMrr as Record<string, number>)[a.organization.id]).toBe(4200);
    await prisma.organization.update({ where: { id: a.organization.id }, data: { status: "canceled" } });
    const s2 = await takeSnapshot(new Date(), "2099-01-01");
    expect((s2.orgMrr as Record<string, number>)[a.organization.id]).toBeUndefined();
    expect(await prisma.platformDailyMetric.count({ where: { day: "2099-01-01" } })).toBe(1);
  });

  it("funil: ativou = orçamento enviado em até 7 dias; pagou = pagamento confirmado", async () => {
    const b = await createOrganizationWithAdmin({ organizationName: `Funil ${suffix}`, slug: `funil-${suffix}`, adminName: "Fred Funil", adminEmail: `fred-${suffix}@example.com`, password: "Test-Passw0rd-2026" });
    const before = (await trialFunnel(12)).totals;
    await prisma.quote.create({ data: { organizationId: b.organization.id, number: 1, title: "First", status: "sent" } });
    await prisma.platformPayment.create({ data: { organizationId: b.organization.id, amountCents: 12900, paidAt: new Date(), method: "zelle", source: "manual", status: "paid" } });
    const after = (await trialFunnel(12)).totals;
    expect(after.signups).toBe(before.signups);
    expect(after.activated).toBe(before.activated + 1);
    expect(after.paid).toBe(before.paid + 1);
  });
});
