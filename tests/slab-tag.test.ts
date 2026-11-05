/**
 * The Mate reads a slab tag: what the model says is kept only where it makes sense (known stone,
 * sizes in inches and in range, length ≥ width, 2 or 3 cm); the route needs the office and a
 * company with a slab yard, and never saves anything.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { cleanSlabTag, SLAB_TAG_PROMPT } from "../src/lib/trades/slab-tag-ai.js";

describe("slab tag cleanup", () => {
  it("keeps a good read, turns the sizes the right way and drops nonsense", () => {
    const t = cleanSlabTag({ material: "Quartz", color: " Calacatta  Laza ", brand: "MSI", thickness_cm: "3", length_in: 63, width_in: "126", serial: "LOT 4471-07", supplier: "null", finish: "polished" });
    expect(t).toMatchObject({ material: "quartz", color: "Calacatta Laza", brand: "MSI", thickness_cm: 3, length_in: 126, width_in: 63, serial: "LOT 4471-07", supplier: null, finish: "polished" });
    const bad = cleanSlabTag({ material: "wood", thickness_cm: 4, length_in: 3, width_in: 900, color: "" });
    expect(bad).toMatchObject({ material: null, thickness_cm: null, length_in: null, width_in: null, color: null });
    expect(cleanSlabTag("garbage")).toMatchObject({ material: null, color: null });
  });
  it("the prompt asks for inches and never to guess a lot", () => {
    expect(SLAB_TAG_PROMPT).toContain("Sizes in inches");
    expect(SLAB_TAG_PROMPT).toContain("Do not invent a lot number");
  });
});

const seen: Array<{ system: string; imageUrls?: string[] }> = [];
vi.mock("../src/lib/ai/client.js", async (orig) => ({
  ...(await orig<typeof import("../src/lib/ai/client.js")>()),
  isAiConfigured: () => true,
  aiChatJson: async (p: { system: string; imageUrls?: string[] }) => {
    seen.push(p);
    return { ok: true, model: "test", provider: "test", tokensIn: null, tokensOut: null, text: JSON.stringify({ material: "granite", color: "Black Pearl", length_in: 118, width_in: 70, thickness_cm: 3, serial: "BP-2209" }) };
  },
}));

const { PrismaClient } = await import("@prisma/client");
const probe = new PrismaClient();
const privileged = await probe
  .$queryRaw<{ ok: boolean }[]>`SELECT (rolsuper OR rolbypassrls) AS ok FROM pg_roles WHERE rolname = current_user`
  .then((r) => Boolean(r[0]?.ok))
  .catch(() => false)
  .finally(() => probe.$disconnect());

describe.skipIf(!privileged)("read-tag route", () => {
  const prisma = new PrismaClient();
  let server: Server;
  let base = "";
  const cookie: Record<string, string> = {};
  const suffix = `stg${Date.now().toString(36)}`;
  const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

  beforeAll(async () => {
    const { createApp } = await import("../src/app.js");
    const { createOrganizationWithAdmin } = await import("../src/modules/organizations/service.js");
    const { DEFAULT_PERMISSIONS } = await import("../src/lib/tenant/defaults.js");
    for (const p of DEFAULT_PERMISSIONS) await prisma.permission.upsert({ where: { key: p.key }, create: { key: p.key, group: p.group, description: p.description }, update: {} });
    const a = await createOrganizationWithAdmin({ organizationName: `Tag ${suffix}`, slug: `tag-${suffix}`, adminName: "Admin", adminEmail: `adm-${suffix}@example.com`, password: "password12345" });
    const w = await createOrganizationWithAdmin({ organizationName: `TagW ${suffix}`, slug: `tagw-${suffix}`, adminName: "Admin", adminEmail: `wadm-${suffix}@example.com`, password: "password12345" });
    await prisma.organization.update({ where: { id: a.organization.id }, data: { tradePacks: ["countertops"] } });
    const app = createApp();
    await new Promise<void>((resolve) => (server = app.listen(0, () => resolve())));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    for (const [k, email, org] of [["tops", `adm-${suffix}@example.com`, a.organization.id], ["wood", `wadm-${suffix}@example.com`, w.organization.id]] as const) {
      const r = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: "password12345", organizationId: org }), redirect: "manual" });
      cookie[k] = (r.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
    }
  });
  afterAll(async () => {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    await prisma.$disconnect();
  });

  const post = (who: string, body: unknown) =>
    fetch(`${base}/api/slabs/read-tag`, { method: "POST", headers: { Cookie: cookie[who]!, "Content-Type": "application/json" }, body: JSON.stringify(body) });

  it("returns the fields read from the photo and saves nothing", async () => {
    const before = await prisma.slab.count();
    const r = await post("tops", { data_url: PNG });
    expect(r.status).toBe(200);
    const j = (await r.json()) as any;
    expect(j.data).toMatchObject({ material: "granite", color: "Black Pearl", length_in: 118, width_in: 70, thickness_cm: 3, serial: "BP-2209" });
    expect(seen.at(-1)!.imageUrls).toEqual([PNG]);
    expect(await prisma.slab.count()).toBe(before);
    const list = (await (await fetch(`${base}/api/slabs`, { headers: { Cookie: cookie.tops! } })).json()) as any;
    expect(list.data.can_read_tag).toBe(true);
  });

  it("refuses a non-image and a company without a slab yard", async () => {
    expect((await post("tops", { data_url: "data:application/pdf;base64,AAAA" })).status).toBe(400);
    expect((await post("wood", { data_url: PNG })).status).toBe(404);
  });
});
