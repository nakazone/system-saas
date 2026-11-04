/**
 * The visit's Mate for a Countertops company: what it proposes is checked before the confirm card —
 * a new top needs its length, changes and removals only touch tops that exist, answers only fill
 * the known questions, and sizes stay in inches.
 */
import { describe, it, expect } from "vitest";
import { cleanTopsPatch, topsConversationSchema, topsContext, TOPS_CONVERSATION_PROMPT } from "../src/lib/field-quote/tops-ai.js";

const current = { spec: { level: 2 }, pieces: [{ id: "ct1", name: "Sink wall", kind: "run", length: 120 }] };

describe("Mate patch for countertops", () => {
  it("adds a complete top, updates and removes only known tops, keeps known answers", () => {
    const talk = topsConversationSchema.parse({
      reply: "Ilha de 96 por 42 com cooktop, anotado.",
      patch: {
        tops_add: [{ name: "Ilha", kind: "island", length_in: 96, depth_in: 42, overhang_in: 12, cooktop: true, waterfall_right: true }, { name: "Banheiro", kind: "vanity" }],
        tops_update: [{ id: "ct1", length_in: 126 }, { id: "nope", length_in: 50 }],
        tops_remove_ids: ["ghost"],
        spec: { level: 3, color: "Calacatta Laza", edge: "ogee", tearout: true },
        answers: [{ group: "countertops", id: "cabinets", value: "installing" }, { group: "countertops", id: "price", value: "cheap" }],
      },
    });
    const out = cleanTopsPatch(talk, current);
    expect(out.patch.tops_add).toHaveLength(1);
    expect(out.patch.tops_add[0]).toMatchObject({ name: "Ilha", kind: "island", length: 96, depth: 42, overhang: 12, cooktop: true, waterfall: { right: true } });
    expect(out.patch.tops_add[0].id).toMatch(/^ct[0-9a-f]{8}$/);
    expect(out.patch.tops_update).toEqual([{ id: "ct1", length: 126 }]);
    expect(out.patch.tops_remove_ids).toEqual([]);
    expect(out.patch.top_spec).toEqual({ level: 3, color: "Calacatta Laza", edge: "ogee", tearout: true });
    expect(out.patch.answers).toEqual([{ group: "countertops", id: "cabinets", value: "installing" }]);
    // The vanity had no length: not added, and Mate asks for it.
    expect(out.reply).toContain("comprimento");
    expect(out.patch.services_add).toEqual([]);
  });

  it("refuses sizes out of range and unknown kinds", () => {
    expect(topsConversationSchema.safeParse({ reply: "x", patch: { tops_add: [{ length_in: 900 }] } }).success).toBe(false);
    expect(topsConversationSchema.safeParse({ reply: "x", patch: { tops_add: [{ kind: "table", length_in: 60 }] } }).success).toBe(false);
  });

  it("Mate sees the tops in inches with their ids; the prompt never prices", () => {
    expect(topsContext(current).tops[0]).toMatchObject({ id: "ct1", length_in: 120, depth_in: 25.5, kind: "run" });
    expect(TOPS_CONVERSATION_PROMPT).toContain("prices come from the company's price list");
  });
});

// ---- the route: a Countertops company's visit talks tops (AI mocked)
import { vi, beforeAll, afterAll } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

const seen: Array<{ system: string; user: string }> = [];
vi.mock("../src/lib/ai/client.js", async (orig) => ({
  ...(await orig<typeof import("../src/lib/ai/client.js")>()),
  isAiConfigured: () => true,
  aiChatJson: async (p: { system: string; user: string }) => {
    seen.push(p);
    return { ok: true, model: "test", text: JSON.stringify({ reply: "Ilha anotada.", patch: { tops_add: [{ name: "Ilha", kind: "island", length_in: 96 }], spec: { edge: "ogee" }, answers: [{ group: "countertops", id: "plumbing", value: "plumber" }] } }) };
  },
}));

const { PrismaClient } = await import("@prisma/client");
const probe = new PrismaClient();
const privileged = await probe
  .$queryRaw<{ ok: boolean }[]>`SELECT (rolsuper OR rolbypassrls) AS ok FROM pg_roles WHERE rolname = current_user`
  .then((r) => Boolean(r[0]?.ok))
  .catch(() => false)
  .finally(() => probe.$disconnect());

describe.skipIf(!privileged)("Field Quote Mate route for a Countertops company", () => {
  const prisma = new PrismaClient();
  let server: Server;
  let base = "";
  let cookie = "";
  const suffix = `ctm${Date.now().toString(36)}`;

  beforeAll(async () => {
    const { createApp } = await import("../src/app.js");
    const { createOrganizationWithAdmin } = await import("../src/modules/organizations/service.js");
    const { DEFAULT_PERMISSIONS } = await import("../src/lib/tenant/defaults.js");
    for (const p of DEFAULT_PERMISSIONS) await prisma.permission.upsert({ where: { key: p.key }, create: { key: p.key, group: p.group, description: p.description }, update: {} });
    const a = await createOrganizationWithAdmin({ organizationName: `Tops ${suffix}`, slug: `tops-${suffix}`, adminName: "Admin", adminEmail: `adm-${suffix}@example.com`, password: "password12345" });
    await prisma.organization.update({ where: { id: a.organization.id }, data: { tradePacks: ["countertops"] } });
    const app = createApp();
    await new Promise<void>((resolve) => (server = app.listen(0, () => resolve())));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const r = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: `adm-${suffix}@example.com`, password: "password12345", organizationId: a.organization.id }), redirect: "manual" });
    cookie = (r.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
  });
  afterAll(async () => {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    await prisma.$disconnect();
  });

  it("uses the countertop prompt and returns a tops patch", async () => {
    const h = { Cookie: cookie, "Content-Type": "application/json" };
    const fq = (await (await fetch(`${base}/api/field-quotes`, { method: "POST", headers: h, body: JSON.stringify({ client_name: "Mark Ortiz" }) })).json()) as any;
    const r = await fetch(`${base}/api/field-quotes/${fq.data.id}/ai/conversation`, { method: "POST", headers: h, body: JSON.stringify({ message: "Ilha de 8 pés, borda ogee, encanador do cliente" }) });
    const j = (await r.json()) as any;
    expect(r.status).toBe(200);
    expect(seen.at(-1)!.system).toContain("countertop estimator");
    expect(j.data.patch.tops_add[0]).toMatchObject({ name: "Ilha", kind: "island", length: 96 });
    expect(j.data.patch.top_spec).toEqual({ edge: "ogee" });
    expect(j.data.patch.answers).toEqual([{ group: "countertops", id: "plumbing", value: "plumber" }]);
  });
});
