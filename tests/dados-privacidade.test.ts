import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { execFileSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { DEFAULT_PERMISSIONS } from "../src/lib/tenant/defaults.js";
import { createOrganizationWithAdmin } from "../src/modules/organizations/service.js";
import { storage } from "../src/lib/storage/index.js";
import { ZipWriter } from "../src/lib/data/zip.js";
import { requestExport, createDownloadLink, findByToken, cleanupExports, isDownloadable } from "../src/lib/data/export.js";
import { findPerson, erasePerson, normalizeSubject, maskSubject, REMOVED } from "../src/lib/data/erase.js";
import { deletionCheck, deleteCompany } from "../src/lib/data/delete-company.js";
import { orgTables, inTenant } from "../src/lib/data/tables.js";
import { withTenantTransaction } from "../src/lib/tenant/prisma-tenant.js";
import { createApp } from "../src/app.js";
import { hashPassword } from "../src/lib/auth/password.js";
import { encryptSecret, generateTotpSecret, totpAt } from "../src/lib/auth/totp.js";
import { resetThrottle } from "../src/master/auth.js";

const prisma = new PrismaClient();
const suffix = `dp${Date.now().toString(36)}`;
const hasUnzip = (() => {
  try {
    execFileSync("unzip", ["-v"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

afterAll(async () => {
  await prisma.$disconnect();
});

describe("ZIP", () => {
  it("gera um ZIP válido com texto comprimido e binário guardado", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "zip-"));
    const file = path.join(dir, "t.zip");
    const z = new ZipWriter(file);
    await z.addBuffer("data/a.csv", Buffer.from("x,y\r\n1,2\r\n".repeat(500)), { compress: true });
    await z.addBuffer("files/foto.jpg", Buffer.from([0xff, 0xd8, 1, 2, 3]));
    await z.addBuffer("files/foto.jpg", Buffer.from([9]));
    await z.close();
    const buf = await fs.readFile(file);
    expect(buf.readUInt32LE(0)).toBe(0x04034b50);
    expect(buf.readUInt32LE(buf.length - 22)).toBe(0x06054b50);
    expect(buf.readUInt16LE(buf.length - 12)).toBe(3);
    if (hasUnzip) {
      const list = execFileSync("unzip", ["-Z1", file]).toString().trim().split("\n");
      expect(list).toEqual(["data/a.csv", "files/foto.jpg", "files/foto (2).jpg"]);
      expect(execFileSync("unzip", ["-p", file, "data/a.csv"]).toString()).toBe("x,y\r\n1,2\r\n".repeat(500));
      execFileSync("unzip", ["-t", file], { stdio: "ignore" });
    }
    void zlib;
  });
});

describe("Exportar, excluir pessoa e excluir empresa", () => {
  let orgId = "";
  let slug = "";
  let adminId = "";
  const person = `cliente-${suffix}@example.com`;

  beforeAll(async () => {
    for (const p of DEFAULT_PERMISSIONS) {
      await prisma.permission.upsert({ where: { key: p.key }, create: { key: p.key, group: p.group, description: p.description }, update: {} });
    }
    slug = `dados-${suffix}`;
    const a = await createOrganizationWithAdmin({ organizationName: `Dados Co ${suffix}`, slug, adminName: "Ana Admin", adminEmail: `admin-${suffix}@example.com`, password: "password12345" });
    orgId = a.organization.id;
    adminId = a.admin.id;
    await withTenantTransaction(orgId, async (tx) => {
      await tx.lead.create({ data: { organizationId: orgId, name: "John Carter", email: person.toUpperCase(), phone: "(303) 555-0142", notes: "Gate code 4411", metadata: { visits: [{ address: "1 Main St" }] } } as never });
      await tx.lead.create({ data: { organizationId: orgId, name: "Other Lead", email: `other-${suffix}@example.com`, phone: "720 555 9999" } as never });
      const c = await tx.customer.create({ data: { organizationId: orgId, name: "John Carter", email: person, phone: "+1 303-555-0142", address: "1 Main St, Denver", notes: "Dog in yard" } as never });
      await tx.property.create({ data: { organizationId: orgId, customerId: c.id, line1: "1 Main St", city: "Denver", state: "CO", postalCode: "80202" } as never });
    });
    await storage.upload({ key: `orgs/${orgId}/jobs/x/foto-${suffix}.jpg`, body: Buffer.from([0xff, 0xd8, 0xff, 7, 7, 7]), contentType: "image/jpeg" });
  });

  it("exporta CSVs de todas as tabelas da empresa + arquivos, sem senha, e entrega por link", async () => {
    const { export: e } = await requestExport({ organizationId: orgId, requestedById: null, requestedByName: "Teste", background: false });
    const row = await prisma.dataExport.findUniqueOrThrow({ where: { id: e.id } });
    expect(row.status).toBe("ready");
    expect(row.files).toBe(1);
    expect(row.rows).toBeGreaterThanOrEqual(4);
    expect(isDownloadable(row)).toBe(true);
    const stream = await storage.getStream(row.fileKey!);
    const chunks: Buffer[] = [];
    for await (const c of stream!) chunks.push(Buffer.from(c));
    const tmp = path.join(os.tmpdir(), `exp-${suffix}.zip`);
    await fs.writeFile(tmp, Buffer.concat(chunks));
    if (hasUnzip) {
      const list = execFileSync("unzip", ["-Z1", tmp]).toString().split("\n");
      expect(list).toContain("data/Lead.csv");
      expect(list).toContain("data/Organization.csv");
      expect(list).toContain(`files/jobs/x/foto-${suffix}.jpg`);
      expect(list).toContain("README.txt");
      expect(list).not.toContain("data/PlatformNote.csv");
      const users = execFileSync("unzip", ["-p", tmp, "data/User.csv"]).toString();
      expect(users).toContain(`admin-${suffix}@example.com`);
      expect(users.split("\r\n")[0]).not.toMatch(/password/i);
      expect(execFileSync("unzip", ["-p", tmp, "data/Lead.csv"]).toString()).toContain("Gate code 4411");
    }
    const url = await createDownloadLink(e.id);
    const token = url.split("/exportacao/")[1];
    expect((await findByToken(token))?.id).toBe(e.id);
    expect(await findByToken("nope")).toBeNull();
    // After 7 days the file is deleted and the link stops.
    await cleanupExports(new Date(Date.now() + 8 * 86400e3));
    const after = await prisma.dataExport.findUniqueOrThrow({ where: { id: e.id } });
    expect(after.status).toBe("expired");
    expect(await storage.getStream(row.fileKey!)).toBeNull();
    expect(await findByToken(token)).toBeNull();
  });

  it("acha a pessoa por e-mail ou telefone e anonimiza só ela", async () => {
    const s = normalizeSubject(person, "303.555.0142");
    if ("error" in s) throw new Error(s.error);
    expect(maskSubject(s)).toBe("c***@example.com · ***-0142");
    expect(normalizeSubject("", "")).toHaveProperty("error");
    const preview = await findPerson(orgId, s);
    expect(preview.find((c) => c.key === "leads")).toMatchObject({ count: 1, samples: ["John Carter"] });
    expect(preview.find((c) => c.key === "customers")?.count).toBe(1);
    const counts = await erasePerson(orgId, s, ["leads", "customers"]);
    expect(counts).toMatchObject({ Lead: 1, Customer: 1, Property: 1 });
    const [lead, other, cust] = await inTenant(orgId, (tx) =>
      Promise.all([
        tx.lead.findFirstOrThrow({ where: { organizationId: orgId, name: REMOVED } }),
        tx.lead.findFirstOrThrow({ where: { organizationId: orgId, name: "Other Lead" } }),
        tx.customer.findFirstOrThrow({ where: { organizationId: orgId } }),
      ]),
    );
    expect(lead).toMatchObject({ email: null, phone: null, notes: null, metadata: {} });
    expect(other.email).toBe(`other-${suffix}@example.com`);
    expect(cust).toMatchObject({ name: REMOVED, email: null, address: null, notes: null });
    // The only admin can't be erased.
    const adminSubject = normalizeSubject(`admin-${suffix}@example.com`, null) as { email: string; phone: null };
    expect((await findPerson(orgId, adminSubject)).find((c) => c.key === "users")?.blocked).toMatch(/único administrador/);
    await expect(erasePerson(orgId, adminSubject, ["users"])).rejects.toThrow(/único administrador/);
  });

  it("só exclui empresa cancelada há 90 dias (ou com pedido formal), com slug, e apaga tudo", async () => {
    let c = await deletionCheck(orgId);
    expect(c.canDelete).toBe(false);
    expect(c.blockers[0]).toMatch(/cancelada/);
    await prisma.organization.update({ where: { id: orgId }, data: { status: "canceled", canceledAt: new Date(Date.now() - 10 * 86400e3) } });
    c = await deletionCheck(orgId);
    expect(c.blockers[0]).toMatch(/90 dias/);
    await prisma.privacyRequest.create({ data: { organizationId: orgId, orgName: "x", kind: "deletion", subjectType: "company", requesterName: "Ana", requesterEmail: "a@x.com", dueAt: new Date(Date.now() + 30 * 86400e3), createdByName: "Teste" } });
    c = await deletionCheck(orgId);
    expect(c.canDelete).toBe(true);
    await expect(deleteCompany({ organizationId: orgId, confirmSlug: "errado", reason: "pedido", performedById: null, performedByName: "Teste" })).rejects.toThrow(/endereço/);

    const { receipt } = await deleteCompany({ organizationId: orgId, confirmSlug: slug, reason: "Pedido formal da empresa", exportSkippedWhy: c.exportReady ? null : "teste", performedById: null, performedByName: "Teste" });
    expect(receipt.kind).toBe("company");
    expect((receipt.counts as Record<string, number>).Lead).toBe(2);
    expect(receipt.filesDeleted).toBe(1);
    expect(await prisma.organization.findUnique({ where: { id: orgId } })).toBeNull();
    // No row of the company is left in any table except the kept records.
    for (const t of await orgTables()) {
      const n = await inTenant(orgId, (tx) => tx.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*)::bigint AS n FROM "${t.name}" WHERE "organizationId" = $1::uuid`, orgId));
      const keep = ["DataExport", "DataDeletion", "PrivacyRequest"].includes(t.name);
      if (!keep) expect(Number(n[0].n), t.name).toBe(0);
    }
    expect(await storage.list(`orgs/${orgId}/`)).toEqual([]);
    expect(await prisma.user.findUnique({ where: { id: adminId } }).catch(() => null)).toBeNull();
  });
});

describe("Link público da exportação", () => {
  it("token inválido mostra página de expirado (410)", async () => {
    const server = createApp().listen(0);
    const base = `http://127.0.0.1:${(server.address() as import("node:net").AddressInfo).port}`;
    try {
      const r = await fetch(`${base}/exportacao/nao-existe`);
      expect(r.status).toBe(410);
      expect(await r.text()).toContain("This link has expired");
      expect((await fetch(`${base}/exportacao/nao-existe/download`)).status).toBe(410);
    } finally {
      server.close();
    }
  });
});

const privileged = await prisma
  .$queryRaw<{ ok: boolean }[]>`SELECT (rolsuper OR rolbypassrls) AS ok FROM pg_roles WHERE rolname = current_user`
  .then((r) => Boolean(r[0]?.ok))
  .catch(() => false);

describe.skipIf(!privileged)("Master › Privacidade (HTTP)", () => {
  let server: import("node:http").Server;
  let base = "";
  let cookie = "";
  let orgId = "";
  const secret = generateTotpSecret();
  const masterEmail = `master-${suffix}@example.com`;
  const cookieOf = (r: Response) => (r.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
  async function form(p: string, body: Record<string, string | string[]>) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(body)) for (const x of Array.isArray(v) ? v : [v]) params.append(k, x);
    const r = await fetch(base + p, { method: "POST", headers: { Cookie: cookie, "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json", "X-Requested-With": "fetch" }, body: params });
    return { status: r.status, json: (await r.json().catch(() => ({}))) as Record<string, any> };
  }
  const staleStepUp = async () => {
    const admin = await prisma.platformAdmin.findUniqueOrThrow({ where: { email: masterEmail } });
    await prisma.$executeRaw`UPDATE "session" SET sess = jsonb_set(sess::jsonb, '{master,stepUpAt}', '0')::json WHERE sess->'master'->>'adminId' = ${admin.id}`;
  };
  const freshStepUp = async () => {
    expect((await form("/master/step-up", { code: totpAt(secret, Date.now()) })).status).toBe(200);
  };

  beforeAll(async () => {
    resetThrottle();
    const a = await createOrganizationWithAdmin({ organizationName: `Priv Co ${suffix}`, slug: `priv-${suffix}`, adminName: "Pat Admin", adminEmail: `pat-${suffix}@example.com`, password: "password12345" });
    orgId = a.organization.id;
    await withTenantTransaction(orgId, (tx) => tx.lead.create({ data: { organizationId: orgId, name: "Mary Client", email: `mary-${suffix}@example.com` } as never }));
    await prisma.$executeRaw`UPDATE "PlatformAdmin" SET role = 'ADMIN' WHERE role = 'MASTER'`;
    await prisma.platformAdmin.create({ data: { email: masterEmail, name: "Naka Priv", role: "MASTER", status: "active", passwordHash: await hashPassword("master-password-123"), totpSecretEnc: encryptSecret(secret, process.env.SESSION_SECRET!), totpEnabledAt: new Date(), recoveryCodeHashes: [] } });
    server = createApp().listen(0);
    base = `http://127.0.0.1:${(server.address() as import("node:net").AddressInfo).port}`;
    const r1 = await fetch(`${base}/master/entrar`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ email: masterEmail, password: "master-password-123" }), redirect: "manual" });
    cookie = cookieOf(r1);
    const r2 = await fetch(`${base}/master/2fa`, { method: "POST", headers: { Cookie: cookie, "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ code: totpAt(secret, Date.now()) }), redirect: "manual" });
    cookie = cookieOf(r2) || cookie;
  });
  afterAll(() => server?.close());

  it("telas abrem", async () => {
    for (const p of ["/master/privacidade", "/master/privacidade?aba=exportacoes", "/master/privacidade?aba=exclusoes", "/master/privacidade?aba=pedidos&ver=fechados", `/master/privacidade/pessoa?empresa=${orgId}&email=mary-${suffix}@example.com`, `/master/clientes/${orgId}`]) {
      const r = await fetch(base + p, { headers: { Cookie: cookie } });
      expect(r.status, p).toBe(200);
    }
  });

  it("pedido: registra com prazo de 30 dias e só fecha com resposta", async () => {
    expect((await form("/master/privacidade/pedidos", { kind: "deletion", subjectType: "company", requesterName: "Pat", requesterEmail: "pat@x.com" })).json.message).toMatch(/empresa/);
    const r = await form("/master/privacidade/pedidos", { kind: "deletion", subjectType: "person", organizationId: orgId, requesterName: "Mary", requesterEmail: `mary-${suffix}@example.com`, subjectEmail: `mary-${suffix}@example.com` });
    expect(r.status).toBe(200);
    const p = await prisma.privacyRequest.findFirstOrThrow({ where: { requesterEmail: `mary-${suffix}@example.com` } });
    expect(Math.round((p.dueAt.getTime() - p.receivedAt.getTime()) / 86400e3)).toBe(30);
    expect((await form(`/master/privacidade/pedidos/${p.id}`, { status: "done", response: "" })).status).toBe(400);
    expect((await form(`/master/privacidade/pedidos/${p.id}`, { status: "in_progress" })).status).toBe(200);
  });

  it("excluir pessoa pede 2FA de novo e EXCLUIR; gera comprovante", async () => {
    const body = { organizationId: orgId, email: `mary-${suffix}@example.com`, phone: "", cats: ["leads"], reason: "pedido", confirm: "EXCLUIR" };
    await staleStepUp();
    expect((await form("/master/privacidade/pessoa", body)).status).toBe(428);
    await freshStepUp();
    expect((await form("/master/privacidade/pessoa", { ...body, confirm: "sim" })).status).toBe(400);
    const ok = await form("/master/privacidade/pessoa", body);
    expect(ok.status).toBe(200);
    expect(ok.json.redirect).toMatch(/\/master\/privacidade\/exclusoes\//);
    const page = await fetch(base + ok.json.redirect, { headers: { Cookie: cookie } });
    const html = await page.text();
    expect(html).toContain("Data deletion certificate");
    expect(html).toContain("m***@example.com");
    expect(html).not.toContain(`mary-${suffix}@example.com`);
  });

  it("exportar pela ficha, baixar e link para a empresa", async () => {
    await freshStepUp();
    expect((await form(`/master/clientes/${orgId}/exportar`, {})).status).toBe(200);
    let e = await prisma.dataExport.findFirstOrThrow({ where: { organizationId: orgId }, orderBy: { createdAt: "desc" } });
    for (let i = 0; i < 50 && e.status !== "ready"; i++) {
      await new Promise((r) => setTimeout(r, 100));
      e = await prisma.dataExport.findUniqueOrThrow({ where: { id: e.id } });
    }
    expect(e.status).toBe("ready");
    const dl = await fetch(`${base}/master/privacidade/exportacoes/${e.id}/baixar`, { headers: { Cookie: cookie } });
    expect(dl.status).toBe(200);
    expect(dl.headers.get("content-type")).toBe("application/zip");
    expect((await dl.arrayBuffer()).byteLength).toBe(Number(e.sizeBytes));
    const link = await form(`/master/privacidade/exportacoes/${e.id}/link`, {});
    const url = String(link.json.reveal.value);
    const pub = await fetch(url.replace(/^https?:\/\/[^/]+/, base));
    expect(pub.status).toBe(200);
    const file = await fetch(url.replace(/^https?:\/\/[^/]+/, base) + "/download");
    expect(file.status).toBe(200);
    expect((await prisma.dataExport.findUniqueOrThrow({ where: { id: e.id } })).downloads).toBe(1);
    expect((await form(`/master/privacidade/exportacoes/${e.id}/link/cancelar`, {})).status).toBe(200);
    expect((await fetch(url.replace(/^https?:\/\/[^/]+/, base))).status).toBe(410);
  });

  it("excluir empresa pela ficha: recusa sem cancelar, confere o endereço", async () => {
    await freshStepUp();
    expect((await form(`/master/clientes/${orgId}/excluir`, { confirm: `priv-${suffix}`, reason: "x" })).json.message).toMatch(/cancelada/);
    await prisma.organization.update({ where: { id: orgId }, data: { status: "canceled", canceledAt: new Date(Date.now() - 91 * 86400e3) } });
    expect((await form(`/master/clientes/${orgId}/excluir`, { confirm: "outra", reason: "x" })).json.message).toMatch(/endereço/);
    const ok = await form(`/master/clientes/${orgId}/excluir`, { confirm: `priv-${suffix}`, reason: "Cancelada há 90+ dias" });
    expect(ok.status).toBe(200);
    expect(await prisma.organization.findUnique({ where: { id: orgId } })).toBeNull();
    const log = await prisma.platformAuditLog.findFirst({ where: { action: "data.company_deleted", targetId: orgId } });
    expect(log?.stepUp).toBe(true);
  });
});
