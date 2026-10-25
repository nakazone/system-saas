import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { PrismaClient } from "@prisma/client";
import { createApp } from "../src/app.js";
import { createOrganizationWithAdmin } from "../src/modules/organizations/service.js";
import { withTenantTransaction } from "../src/lib/tenant/prisma-tenant.js";
import { DEFAULT_PERMISSIONS } from "../src/lib/tenant/defaults.js";
import { alertFieldProblem, processNoCrewTomorrow } from "../src/lib/mate-ai/alerts.js";
import { getUsage, LIMITS } from "../src/lib/features/index.js";
import { startOfZonedDay, zonedParts, zonedWallTimeToUtc } from "../src/lib/time/zoned.js";

delete process.env.ELEVENLABS_API_KEY;

const probe = new PrismaClient();
const privileged = await probe
  .$queryRawUnsafe("SELECT (rolsuper OR rolbypassrls) AS ok FROM pg_roles WHERE rolname = current_user")
  .then((rows) => Boolean((rows as Array<{ ok: boolean }>)[0]?.ok))
  .catch(() => false)
  .finally(() => probe.$disconnect());

describe.skipIf(!privileged)("Mate voice and alerts (tenant database required)", () => {
  const prisma = new PrismaClient();
  const suffix = Date.now().toString(36);
  const email = "mate-voz-" + suffix + "@example.com";
  const tz = "America/Denver";
  let server: Server;
  let base = "";
  let orgId = "";
  let adminId = "";
  let cookie = "";

  beforeAll(async () => {
    for (const permission of DEFAULT_PERMISSIONS) {
      await prisma.permission.upsert({
        where: { key: permission.key },
        create: { key: permission.key, group: permission.group, description: permission.description },
        update: {},
      });
    }
    const created = await createOrganizationWithAdmin({
      organizationName: "Mate Voz " + suffix,
      slug: "mate-voz-" + suffix,
      adminName: "Admin Voz",
      adminEmail: email,
      password: "password12345",
    });
    orgId = created.organization.id;
    adminId = created.admin.id;
    await prisma.organization.update({ where: { id: orgId }, data: { timezone: tz, status: "active" } });

    const app = createApp();
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => resolve());
    });
    base = "http://127.0.0.1:" + (server.address() as AddressInfo).port;

    const response = await fetch(base + "/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: "password12345", organizationId: orgId }),
      redirect: "manual",
    });
    const headers = response.headers as Headers & { getSetCookie?: () => string[] };
    cookie = (headers.getSetCookie?.() ?? [response.headers.get("set-cookie") || ""])
      .flatMap((value) => value.split(/,\s*(?=[^;,]+=)/))
      .map((value) => value.split(";")[0])
      .join("; ");
  });

  afterAll(async () => {
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
    await prisma.$disconnect();
  });

  it("speak needs a session and falls back to the device voice when ElevenLabs is off", async () => {
    const anon = await fetch(base + "/api/mate-ai/speak", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "Pronto." }),
    });
    expect([401, 403, 404]).toContain(anon.status); // APIs without a session answer 404 on purpose

    const res = await fetch(base + "/api/mate-ai/speak", {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ text: "Pronto, mandei." }),
    });
    expect(res.status).toBe(503);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json.fallback).toBe("browser");
    expect(json.reason).toBe("not_configured");

    const empty = await fetch(base + "/api/mate-ai/speak", {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ text: "  " }),
    });
    expect(empty.status).toBe(400);

    const status = (await (await fetch(base + "/api/mate-ai/status", { headers: { Cookie: cookie } })).json()) as Record<string, unknown>;
    expect(status.speech).toBe(false);
  });

  it("counts voice characters as a plan limit", async () => {
    expect(LIMITS.some((l) => l.key === "voice_chars_month")).toBe(true);
    const usage = await getUsage(orgId);
    expect(usage.voice_chars_month).toBe(0);
  });

  it("tells the office about a problem reported in the field, not the reporter", async () => {
    const job = await withTenantTransaction(orgId, (tx) => tx.workOrder.create({ data: { organizationId: orgId, title: "Piso da sala", number: 501 } }));
    await alertFieldProblem({
      organizationId: orgId,
      reporterId: "00000000-0000-4000-8000-000000000001",
      reporterName: "Lucas",
      job: { id: job.id, number: 501, title: job.title, customerName: "Maria" },
      note: "Contrapiso molhado",
    });
    const rows = await withTenantTransaction(orgId, (tx) => tx.staffNotification.findMany({ where: { organizationId: orgId, type: "job.problem" } }));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.userId).toBe(adminId);
    expect(rows[0]!.title).toContain("Job #501");
    expect(rows[0]!.body).toContain("Lucas: Contrapiso molhado");
    expect(rows[0]!.url).toContain(job.id);
  });

  it("warns once a day after 15h about tomorrow's jobs without a crew", async () => {
    const today = zonedParts(new Date(), tz);
    const afternoon = zonedWallTimeToUtc(tz, today.year, today.month, today.day, 16, 0);
    const morning = zonedWallTimeToUtc(tz, today.year, today.month, today.day, 9, 0);
    const tomorrowTen = new Date(startOfZonedDay(afternoon, tz, 1).getTime() + 10 * 3600_000);
    await withTenantTransaction(orgId, (tx) =>
      tx.workOrder.create({ data: { organizationId: orgId, title: "Lixa e acabamento", number: 502, status: "scheduled", scheduledStart: tomorrowTen } }),
    );

    await processNoCrewTomorrow(morning);
    const before = await withTenantTransaction(orgId, (tx) => tx.staffNotification.count({ where: { organizationId: orgId, type: "jobs.nocrew" } }));
    expect(before).toBe(0);

    await processNoCrewTomorrow(afternoon);
    await processNoCrewTomorrow(new Date(afternoon.getTime() + 30 * 60_000));
    const rows = await withTenantTransaction(orgId, (tx) => tx.staffNotification.findMany({ where: { organizationId: orgId, type: "jobs.nocrew" } }));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.title).toBe("1 job amanhã sem equipe");
    expect(rows[0]!.url).toContain("mate_ask=");
  });
});
