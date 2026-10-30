import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { PrismaClient } from "@prisma/client";
import sharp from "sharp";
import { createApp } from "../src/app.js";
import { createOrganizationWithAdmin } from "../src/modules/organizations/service.js";
import { withTenantTransaction } from "../src/lib/tenant/prisma-tenant.js";
import { DEFAULT_PERMISSIONS } from "../src/lib/tenant/defaults.js";
import { sampleColorText, sampleDisplayName, parseBlend } from "../src/lib/stain/catalog.js";

/** Login reads `User` outside a tenant transaction — needs a privileged DB role. */
const probe = new PrismaClient();
const privileged = await probe
  .$queryRaw<{ ok: boolean }[]>`SELECT (rolsuper OR rolbypassrls) AS ok FROM pg_roles WHERE rolname = current_user`
  .then((r) => Boolean(r[0]?.ok))
  .catch(() => false)
  .finally(() => probe.$disconnect());

describe("Samples de stain — texto das cores", () => {
  it("monta o nome da mistura e de outra marca", () => {
    const blend = parseBlend([{ color: "Jacobean", percent: 50 }, { color: "Special Walnut", percent: 50 }, { color: "", percent: 10 }]);
    expect(blend).toHaveLength(2);
    expect(sampleColorText({ kind: "blend", colorName: "", blend })).toBe("50% Jacobean + 50% Special Walnut");
    expect(sampleDisplayName({ kind: "blend", colorName: "", blend })).toBe("Custom blend (50% Jacobean + 50% Special Walnut)");
    expect(sampleDisplayName({ kind: "other", brand: "Bona", colorName: "Provincial" })).toBe("Bona Provincial");
    expect(sampleDisplayName({ kind: "natural", colorName: "Natural" })).toBe("Natural");
  });
});

describe.skipIf(!privileged)("Samples de stain — do piso à assinatura da cliente", () => {
  const prisma = new PrismaClient();
  let server: Server;
  let base = "";
  let orgId = "";
  let jobId = "";
  let otherJobId = "";
  let cookie = "";
  let photo = "";
  let signature = "";
  const suffix = `st${Date.now().toString(36)}`;
  const email = `st-${suffix}@example.com`;

  async function call(method: string, path: string, body?: unknown) {
    const r = await fetch(`${base}${path}`, {
      method,
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: r.status, json: (await r.json().catch(() => ({}))) as Record<string, any> };
  }
  async function form(path: string, fields: Record<string, string>) {
    return fetch(`${base}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(fields).toString(),
      redirect: "manual",
    });
  }

  beforeAll(async () => {
    for (const p of DEFAULT_PERMISSIONS) {
      await prisma.permission.upsert({ where: { key: p.key }, create: { key: p.key, group: p.group, description: p.description }, update: {} });
    }
    const a = await createOrganizationWithAdmin({ organizationName: `Stain ${suffix}`, slug: `st-${suffix}`, adminName: "Admin", adminEmail: email, password: "password12345" });
    orgId = a.organization.id;
    jobId = await withTenantTransaction(orgId, async (tx) => {
      const customer = await tx.customer.create({ data: { organizationId: orgId, name: "Jane Smith", email: "jane@example.com" } });
      const builder = await tx.builder.create({ data: { organizationId: orgId, firstName: "Mike", company: "Colorado Floor Company" } });
      const wo = await tx.workOrder.create({ data: { organizationId: orgId, title: "Sand & Finish White Oak", status: "scheduled", sector: "sand_finish", customerId: customer.id, builderId: builder.id, address: "123 Test St" } });
      return wo.id;
    });
    const b = await createOrganizationWithAdmin({ organizationName: `Other ${suffix}`, slug: `st2-${suffix}`, adminName: "Other", adminEmail: `o-${email}`, password: "password12345" });
    otherJobId = await withTenantTransaction(b.organization.id, async (tx) => (await tx.workOrder.create({ data: { organizationId: b.organization.id, title: "Other job" } })).id);

    const jpeg = await sharp({ create: { width: 64, height: 48, channels: 3, background: { r: 107, g: 74, b: 47 } } }).jpeg().toBuffer();
    photo = `data:image/jpeg;base64,${jpeg.toString("base64")}`;
    const noise = Buffer.alloc(120 * 40 * 3);
    for (let i = 0; i < noise.length; i++) noise[i] = (i * 37) % 251;
    const png = await sharp(noise, { raw: { width: 120, height: 40, channels: 3 } }).png().toBuffer();
    signature = `data:image/png;base64,${png.toString("base64")}`;

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

  it("registra, envia, a cliente assina, trava a cor e manda ao builder", async () => {
    // job of another company is invisible
    expect((await call("GET", `/api/work-orders/${otherJobId}/stain`)).status).toBe(404);

    const created = await call("POST", `/api/work-orders/${jobId}/stain/rounds`, { wood_species: "White Oak", room: "Living room" });
    expect(created.status).toBe(201);
    const roundId = created.json.data.round_id;
    const round = created.json.data.rounds[0];
    expect(round).toMatchObject({ number: 1, status: "draft", wood_species: "White Oak", recipient_email: "jane@example.com", send_to_builder: true });

    const s1 = await call("POST", `/api/stain/rounds/${roundId}/samples`, { kind: "duraseal", color_name: "special walnut" });
    expect(s1.status).toBe(201);
    const s2 = await call("POST", `/api/stain/rounds/${roundId}/samples`, { kind: "blend", blend: [{ color: "Jacobean", percent: 50 }, { color: "Special Walnut", percent: 50 }] });
    expect(s2.status).toBe(201);
    expect((await call("POST", `/api/stain/rounds/${roundId}/samples`, { kind: "duraseal", color_name: "Not A Color" })).status).toBe(400);
    const samples = s2.json.data.rounds[0].samples;
    expect(samples.map((s: any) => [s.number, s.label])).toEqual([[1, "Special Walnut"], [2, "50% Jacobean + 50% Special Walnut"]]);

    // no photo yet → can't send
    const early = await call("POST", `/api/stain/rounds/${roundId}/send`, { link_only: true });
    expect(early.status).toBe(400);
    expect(early.json.error).toMatch(/foto/i);

    for (const s of samples) {
      const up = await call("POST", `/api/stain/samples/${s.id}/photos`, { data_url: photo, client_upload_id: `u-${s.id}` });
      expect(up.status).toBe(201);
    }
    // same client upload id → same photo, not a second one
    await call("POST", `/api/stain/samples/${samples[0].id}/photos`, { data_url: photo, client_upload_id: `u-${samples[0].id}` });
    const media = await withTenantTransaction(orgId, (tx) => tx.jobMedia.findMany({ where: { workOrderId: jobId } }));
    expect(media).toHaveLength(2);
    expect(media.every((m) => m.stage === "during" && m.caption?.startsWith("Stain sample #"))).toBe(true);

    const sent = await call("POST", `/api/stain/rounds/${roundId}/send`, { link_only: true });
    expect(sent.status).toBe(200);
    const url = new URL(sent.json.data.url);
    expect(sent.json.data.rounds[0].status).toBe("sent");
    const pagePath = url.pathname;

    // the client page (no cookie)
    const page = await fetch(`${base}${pagePath}`);
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain("Choose your stain color");
    expect(html).toContain("Special Walnut");
    expect(page.headers.get("x-robots-tag")).toMatch(/noindex/);
    const viewed = await withTenantTransaction(orgId, (tx) => tx.stainSampleRound.findFirst({ where: { id: roundId } }));
    expect(viewed?.status).toBe("viewed");

    // photos: only the round's
    const photoOk = await fetch(`${base}${pagePath}/photo/${media[0]!.id}`);
    expect(photoOk.status).toBe(200);
    expect((await fetch(`${base}${pagePath}/photo/00000000-0000-4000-8000-000000000000`)).status).toBe(404);
    expect((await fetch(`${base}/public/stain/notarealtoken1234567890`)).status).toBe(404);

    // terms unchecked / no signature → back with an error, nothing saved
    const noTerms = await form(`${pagePath}/approve`, { sample_id: samples[0].id, signer_name: "Jane Smith", signature_data_url: signature });
    expect(noTerms.status).toBe(303);
    expect(noTerms.headers.get("location")).toContain("error=");
    const noSig = await form(`${pagePath}/approve`, { sample_id: samples[0].id, signer_name: "Jane Smith", signature_data_url: "", accept_terms: "on" });
    expect(noSig.headers.get("location")).toContain("error=");

    const ok = await form(`${pagePath}/approve`, { sample_id: samples[0].id, signer_name: "jane smith", signature_data_url: signature, accept_terms: "on" });
    expect(ok.status).toBe(303);
    expect(ok.headers.get("location")).toBe(pagePath);

    const done = await (await fetch(`${base}${pagePath}`)).text();
    expect(done).toContain("You approved Special Walnut");

    // a second answer is refused
    const twice = await form(`${pagePath}/approve`, { sample_id: samples[1].id, signer_name: "Jane", signature_data_url: signature, accept_terms: "on" });
    expect(decodeURIComponent(twice.headers.get("location") || "")).toContain("already answered");

    const pdf = await fetch(`${base}${pagePath}/pdf`);
    expect(pdf.status).toBe(200);
    expect(Buffer.from(await pdf.arrayBuffer()).subarray(0, 5).toString()).toBe("%PDF-");

    // saved on the job, locked, PDF stored, builder told
    const state = await call("GET", `/api/work-orders/${jobId}/stain`);
    expect(state.json.data.approved).toMatchObject({ signer_name: "Jane Smith", has_pdf: true, round_number: 1 });
    expect(state.json.data.approved.sample.label).toBe("Special Walnut");
    expect(state.json.data.approved.builder_notified_at).toBeTruthy();
    expect(state.json.data.history.some((h: any) => /aprovou e assinou/.test(h.text))).toBe(true);
    const job = await withTenantTransaction(orgId, (tx) => tx.workOrder.findFirst({ where: { id: jobId }, select: { approvedStainSampleId: true } }));
    expect(job?.approvedStainSampleId).toBe(samples[0].id);
    const msg = await withTenantTransaction(orgId, (tx) => tx.jobPartnerMessage.findFirst({ where: { workOrderId: jobId } }));
    expect(msg?.side).toBe("company");
    expect(msg?.body).toMatch(/Stain color approved: Special Walnut/);
    expect((msg?.files as unknown[]).length).toBe(2);
    const shared = await withTenantTransaction(orgId, (tx) => tx.jobMedia.count({ where: { workOrderId: jobId, sharedWithPartners: true } }));
    expect(shared).toBe(2);

    // office PDF route
    const officePdf = await fetch(`${base}/api/stain/approvals/${state.json.data.approved.approval_id}/pdf`, { headers: { Cookie: cookie } });
    expect(officePdf.status).toBe(200);

    // the signed record can't be edited
    await expect(
      withTenantTransaction(orgId, (tx) => tx.stainApproval.updateMany({ where: { roundId }, data: { signerName: "Someone else" } })),
    ).rejects.toThrow();

    // round 1 is closed for edits; the office opens a change as round 2, the approved color stays until the new signature
    expect((await call("POST", `/api/stain/rounds/${roundId}/samples`, { kind: "natural" })).status).toBe(409);
    const change = await call("POST", `/api/work-orders/${jobId}/stain/rounds`, {});
    expect(change.status).toBe(201);
    expect(change.json.data.rounds[1]).toMatchObject({ number: 2, status: "draft", wood_species: "White Oak" });
    expect(change.json.data.approved.sample.label).toBe("Special Walnut");
  });

  it("a cliente pede outra amostra em vez de aprovar", async () => {
    const otherJob = await withTenantTransaction(orgId, async (tx) => (await tx.workOrder.create({ data: { organizationId: orgId, title: "Second job" } })).id);
    const r = await call("POST", `/api/work-orders/${otherJob}/stain/rounds`, {});
    const roundId = r.json.data.round_id;
    const s = await call("POST", `/api/stain/rounds/${roundId}/samples`, { kind: "duraseal", color_name: "Provincial" });
    await call("POST", `/api/stain/samples/${s.json.data.sample_id}/photos`, { data_url: photo });
    const sent = await call("POST", `/api/stain/rounds/${roundId}/send`, { link_only: true });
    const path = new URL(sent.json.data.url).pathname;
    const res = await form(`${path}/another`, { comment: "A bit lighter than #1" });
    expect(res.status).toBe(303);
    const after = await call("GET", `/api/work-orders/${otherJob}/stain`);
    expect(after.json.data.rounds[0].status).toBe("changes_requested");
    expect(after.json.data.approved).toBeNull();
    expect(await (await fetch(`${base}${path}`)).text()).toContain("We got your note");
  });
});
