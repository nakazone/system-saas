import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { PrismaClient } from "@prisma/client";
import { createApp } from "../src/app.js";
import { createOrganizationWithAdmin } from "../src/modules/organizations/service.js";
import { withTenantTransaction } from "../src/lib/tenant/prisma-tenant.js";
import { DEFAULT_PERMISSIONS } from "../src/lib/tenant/defaults.js";

/** Login reads `User` outside a tenant transaction — needs a privileged DB role. */
const probe = new PrismaClient();
const privileged = await probe
  .$queryRaw<{ ok: boolean }[]>`SELECT (rolsuper OR rolbypassrls) AS ok FROM pg_roles WHERE rolname = current_user`
  .then((r) => Boolean(r[0]?.ok))
  .catch(() => false)
  .finally(() => probe.$disconnect());

describe.skipIf(!privileged)("página do lead — API", () => {
  const prisma = new PrismaClient();
  let server: Server;
  let base = "";
  let orgId = "";
  let leadId = "";
  let cookie = "";
  const suffix = `lpg${Date.now().toString(36)}`;
  const email = `lp-${suffix}@example.com`;

  async function call(method: string, path: string, body?: unknown) {
    const r = await fetch(`${base}${path}`, {
      method,
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: r.status, json: (await r.json().catch(() => ({}))) as Record<string, any> };
  }

  beforeAll(async () => {
    for (const p of DEFAULT_PERMISSIONS) {
      await prisma.permission.upsert({ where: { key: p.key }, create: { key: p.key, group: p.group, description: p.description }, update: {} });
    }
    const a = await createOrganizationWithAdmin({ organizationName: `Lead ${suffix}`, slug: `lp-${suffix}`, adminName: "Admin", adminEmail: email, password: "password12345" });
    orgId = a.organization.id;
    leadId = await withTenantTransaction(orgId, async (tx) => {
      const lead = await tx.lead.create({
        data: { organizationId: orgId, name: "Lead Página", phone: "7205550100", status: "new", metadata: { message: "Quero hardwood", utm_source: "google" } },
      });
      // Quote linked straight to the lead (no customer yet) — used to vanish from /proposals.
      await tx.quote.create({ data: { organizationId: orgId, number: 7, quoteNumber: "Q-1007", title: "Sala", status: "sent", leadId: lead.id, total: 4200 } });
      return lead.id;
    });
    const app = createApp();
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => resolve());
    });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const r = await fetch(`${base}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: "password12345", organizationId: orgId }),
      redirect: "manual",
    });
    cookie = (r.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    await prisma.$disconnect();
  });

  it("expõe campos do formulário, salva tags, registra etapa e motivo da perda", async () => {
    const got = await call("GET", `/api/leads/${leadId}`);
    expect(got.json.data.message).toBe("Quero hardwood");
    expect(got.json.data.utm_source).toBe("google");
    expect(got.json.data.tags).toEqual([]);

    const tagged = await call("PUT", `/api/leads/${leadId}`, { tags: ["VIP", "vip", " Pets "], company_name: "Casa Azul" });
    expect(tagged.json.data.tags).toEqual(["VIP", "Pets"]);
    expect(tagged.json.data.company_name).toBe("Casa Azul");

    const proposals = await call("GET", `/api/leads/${leadId}/proposals`);
    expect(proposals.json.data).toHaveLength(1);
    expect(proposals.json.data[0]).toMatchObject({ proposal_number: "Q-1007", total_value: 4200, total: 4200 });

    const reasons = await call("GET", `/api/loss-reasons`);
    expect(reasons.json.data.length).toBeGreaterThan(0);
    const reason = reasons.json.data[0];

    const lost = await call("PUT", `/api/leads/${leadId}`, { status: "lost", loss_reason_id: reason.id, loss_note: "Fechou com outro" });
    expect(lost.status).toBe(200);
    expect(lost.json.data.loss_reason_id).toBe(reason.id);
    expect(lost.json.data.loss_reason_name).toBe(reason.name);
    expect(lost.json.data.loss_note).toBe("Fechou com outro");
    expect(lost.json.data.lost_at).toBeTruthy();

    const back = await call("PUT", `/api/leads/${leadId}`, { status: "quote_sent" });
    expect(back.json.data.loss_reason_id).toBeNull();
    expect(back.json.data.lost_at).toBeNull();

    const history = await call("GET", `/api/leads/${leadId}/interactions`);
    const stages = history.json.data.filter((i: any) => i.type === "stage");
    expect(stages).toHaveLength(2);
    expect(stages[0].to_stage).toBe("quote_sent");
    expect(["lost", "closed_lost"]).toContain(stages[1].to_stage);
    expect(stages[1].notes).toBe("Fechou com outro");

    // Stage history can't be deleted; notes can.
    const delStage = await call("DELETE", `/api/leads/${leadId}/interactions/${stages[0].id}`);
    expect(delStage.status).toBe(404);
    const note = await call("POST", `/api/leads/${leadId}/interactions`, { type: "note", notes: "oi" });
    expect((await call("DELETE", `/api/leads/${leadId}/interactions/${note.json.data.id}`)).status).toBe(200);
  });

  it("conclui follow-up", async () => {
    const fu = await call("POST", `/api/leads/${leadId}/followups`, { title: "Ligar", due_date: "2026-10-05T15:00:00.000Z" });
    const done = await call("PUT", `/api/leads/${leadId}/followups/${fu.json.data.id}`, { status: "done" });
    expect(done.json.data.status).toBe("done");
    expect(done.json.data.completed_at).toBeTruthy();
    const reopened = await call("PUT", `/api/leads/${leadId}/followups/${fu.json.data.id}`, { status: "pending" });
    expect(reopened.json.data.completed_at).toBeNull();
    expect((await call("PUT", `/api/leads/${leadId}/followups/nao-existe`, { status: "done" })).status).toBe(404);
  });
});
