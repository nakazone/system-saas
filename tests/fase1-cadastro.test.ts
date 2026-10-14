import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import pg from "pg";
import { PrismaClient } from "@prisma/client";
import { createApp } from "../src/app.js";
import { createOrganizationWithAdmin } from "../src/modules/organizations/service.js";
import { setSignupMode } from "../src/modules/organizations/signup.js";
import { setLegalPrompt } from "../src/lib/legal/acceptance.js";
import { email as emailProvider, type EmailMessage } from "../src/lib/email/index.js";
import { backupRestoreCheck, recordBackupCheck } from "../scripts/backup-restore-check.js";

/** Login reads `User` outside a tenant transaction — needs a privileged DB role (as in production). */
const probe = new PrismaClient();
const privileged = await probe
  .$queryRaw<{ ok: boolean }[]>`SELECT (rolsuper OR rolbypassrls) AS ok FROM pg_roles WHERE rolname = current_user`
  .then((r) => Boolean(r[0]?.ok))
  .catch(() => false)
  .finally(() => probe.$disconnect());

/**
 * Fase 1 — the rest of "ready to charge":
 * sign-up with e-mail confirmation and limits, Terms/Privacy/DPA with recorded acceptance,
 * forgot password for company users, and the backup restore check.
 */
describe("Fase 1 — cadastro, termos, senha e backup", () => {
  const prisma = new PrismaClient();
  let server: Server;
  let base = "";
  const suffix = `c1${Date.now().toString(36)}`;
  const sent: EmailMessage[] = [];

  function cookieOf(r: Response) {
    return (r.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
  }
  async function form(path: string, body: Record<string, string>, opts: { ip?: string; cookie?: string } = {}) {
    const r = await fetch(base + path, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", ...(opts.ip ? { "X-Forwarded-For": opts.ip } : {}), ...(opts.cookie ? { Cookie: opts.cookie } : {}) },
      body: new URLSearchParams(body),
      redirect: "manual",
    });
    return { status: r.status, location: r.headers.get("location") || "", html: await r.text(), cookie: cookieOf(r) };
  }
  async function json(method: string, path: string, body?: unknown, cookie = "", ip?: string) {
    const r = await fetch(base + path, {
      method,
      headers: { "Content-Type": "application/json", Accept: "application/json", "X-Requested-With": "fetch", ...(cookie ? { Cookie: cookie } : {}), ...(ip ? { "X-Forwarded-For": ip } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: "manual",
    });
    return { status: r.status, json: (await r.json().catch(() => ({}))) as Record<string, any>, cookie: cookieOf(r) };
  }
  async function login(emailAddr: string, password: string, organizationId: string) {
    return json("POST", "/api/auth/login", { email: emailAddr, password, organizationId });
  }
  function linkIn(m: EmailMessage | undefined, re: RegExp): string {
    const found = m?.text.match(re);
    if (!found) throw new Error(`No link in e-mail: ${m?.subject}`);
    return found[0];
  }
  const signupForm = (key: string, extra: Record<string, string> = {}) => ({
    organizationName: `Cadastro ${key} ${suffix}`,
    slug: `${key}-${suffix}`,
    adminName: "Dana Owner",
    adminEmail: `${key}-${suffix}@example.com`,
    password: "a-strong-pass-9",
    timezone: "America/Denver",
    acceptLegal: "on",
    ...extra,
  });

  beforeAll(async () => {
    vi.spyOn(emailProvider, "send").mockImplementation(async (m) => {
      sent.push(m);
      return { ok: true, transport: "console" };
    });
    await setSignupMode("open");
    const app = createApp();
    server = app.listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  beforeEach(async () => {
    sent.length = 0;
    await prisma.rateEvent.deleteMany({});
  });

  afterAll(async () => {
    await setSignupMode("open");
    vi.restoreAllMocks();
    server?.close();
    await prisma.$disconnect();
  });

  it("Termos, Privacidade e DPA são páginas públicas e o cadastro mostra os links", async () => {
    for (const path of ["/terms", "/privacy", "/dpa"]) {
      const r = await fetch(base + path);
      expect(r.status, path).toBe(200);
      expect(await r.text()).toMatch(/Version|Effective/i);
    }
    const page = await (await fetch(`${base}/signup`)).text();
    expect(page).toContain('href="/terms"');
    expect(page).toContain('href="/privacy"');
    expect(page).toContain('href="/dpa"');
  });

  it("cadastro: só cria a empresa depois de confirmar o e-mail, com aceite gravado", async () => {
    const f = signupForm("ok");
    // Without accepting the terms nothing happens.
    const noTerms = await form("/signup", { ...f, acceptLegal: "" });
    expect(noTerms.status).toBe(400);
    expect(noTerms.html).toContain("Terms of Service");
    expect(sent).toHaveLength(0);

    const r = await form("/signup", f);
    expect(r.status).toBe(303);
    expect(r.location).toBe("/signup/check");
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe(f.adminEmail);
    expect(await prisma.organization.findUnique({ where: { slug: f.slug } })).toBeNull();
    const req = await prisma.signupRequest.findFirst({ where: { email: f.adminEmail } });
    expect(req?.passwordHash).toBeTruthy();
    expect(req?.passwordHash).not.toContain(f.password);

    const link = linkIn(sent[0], /https?:\/\/\S+\/signup\/verify\?token=\S+/);
    const token = new URL(link).searchParams.get("token")!;
    // Opening the link (e.g. by an e-mail scanner) does not create anything.
    const view = await fetch(`${base}/signup/verify?token=${encodeURIComponent(token)}`);
    expect(view.status).toBe(200);
    expect(await prisma.organization.findUnique({ where: { slug: f.slug } })).toBeNull();

    const ok = await form("/signup/verify", { token });
    expect(ok.status).toBe(200);
    const org = await prisma.organization.findUnique({ where: { slug: f.slug } });
    expect(org?.status).toBe("trial");
    expect(org?.trialEndsAt).toBeTruthy();
    const acc = await prisma.legalAcceptance.findMany({ where: { organizationId: org!.id } });
    expect(acc.map((a) => a.document).sort()).toEqual(["dpa", "privacy", "terms"]);
    expect(acc.every((a) => a.source === "signup" && a.userEmail === f.adminEmail)).toBe(true);

    // Double click / second confirmation: still one company.
    const again = await form("/signup/verify", { token });
    expect(again.status).toBe(200);
    expect(await prisma.organization.count({ where: { slug: f.slug } })).toBe(1);

    // The password typed in the form works.
    if (privileged) expect((await login(f.adminEmail, f.password, org!.id)).status).toBe(200);

    // Invalid token: 410, nothing created.
    expect((await fetch(`${base}/signup/verify?token=nope`)).status).toBe(410);
  });

  it("cadastro: limite por IP, honeypot e endereço já usado", async () => {
    const ip = "203.0.113.7";
    for (let i = 0; i < 5; i++) {
      const r = await form("/signup", signupForm(`rl${i}`), { ip });
      expect(r.status, `attempt ${i + 1}`).toBe(303);
    }
    const blocked = await form("/signup", signupForm("rl5"), { ip });
    expect(blocked.status).toBe(429);
    // Another IP still works.
    expect((await form("/signup", signupForm("rl6"), { ip: "203.0.113.8" })).status).toBe(303);

    // Bots filling the hidden field get the same answer but nothing is stored or sent.
    sent.length = 0;
    const bot = await form("/signup", signupForm("bot", { website: "http://spam.example" }), { ip: "203.0.113.9" });
    expect(bot.status).toBe(303);
    expect(sent).toHaveLength(0);
    expect(await prisma.signupRequest.count({ where: { slug: `bot-${suffix}` } })).toBe(0);

    // Address of an existing company.
    await createOrganizationWithAdmin({ organizationName: `Taken ${suffix}`, slug: `taken-${suffix}`, adminName: "T", adminEmail: `t-${suffix}@example.com`, password: "Test-Passw0rd-2026" });
    const taken = await form("/signup", signupForm("taken"), { ip: "203.0.113.10" });
    expect(taken.status).toBe(400);
    expect(taken.html).toContain("already taken");
  });

  it("cadastro só por convite: sem convite recusa; o convite define plano e fica usado", async () => {
    await setSignupMode("invite");
    try {
      const no = await form("/signup", signupForm("inv0"), { ip: "198.51.100.1" });
      expect(no.status).toBe(403);
      const code = `inv-${suffix}`;
      await prisma.signupInvite.create({ data: { code, email: `inv1-${suffix}@example.com`, plan: "professional", trialDays: 45 } });
      const wrongEmail = await form("/signup", signupForm("inv2", { invite: code }), { ip: "198.51.100.1" });
      expect(wrongEmail.status).toBe(400);
      const r = await form("/signup", signupForm("inv1", { invite: code }), { ip: "198.51.100.1" });
      expect(r.status).toBe(303);
      const token = new URL(linkIn(sent.at(-1), /https?:\/\/\S+\/signup\/verify\?token=\S+/)).searchParams.get("token")!;
      expect((await form("/signup/verify", { token })).status).toBe(200);
      const org = await prisma.organization.findUnique({ where: { slug: `inv1-${suffix}` } });
      expect(org?.plan).toBe("professional");
      const days = Math.round((org!.trialEndsAt!.getTime() - Date.now()) / 86400e3);
      expect(days).toBeGreaterThanOrEqual(44);
      expect((await prisma.signupInvite.findUnique({ where: { code } }))?.usedAt).toBeTruthy();
    } finally {
      await setSignupMode("open");
    }
  });

  it.skipIf(!privileged)("empresa antiga sem aceite: o admin vê o pedido e aceita (até em só leitura)", async () => {
    const adminEmail = `legal-${suffix}@example.com`;
    const a = await createOrganizationWithAdmin({ organizationName: `Legal ${suffix}`, slug: `legal-${suffix}`, adminName: "Lee Admin", adminEmail, password: "Test-Passw0rd-2026" });
    await prisma.organization.update({ where: { id: a.organization.id }, data: { status: "read_only" } });
    const li = await login(adminEmail, "Test-Passw0rd-2026", a.organization.id);
    expect(li.status).toBe(200);

    // Off by default: nothing is asked until the Master turns it on.
    await setLegalPrompt(false);
    const off = await json("GET", "/api/account/status", undefined, li.cookie);
    expect(off.json.data.legal.pending).toEqual([]);
    await setLegalPrompt(true);

    const st = await json("GET", "/api/account/status", undefined, li.cookie);
    expect(st.status).toBe(200);
    expect(st.json.data.legal.first_time).toBe(true);
    expect(st.json.data.legal.pending.sort()).toEqual(["dpa", "privacy", "terms"]);

    const acc = await json("POST", "/api/account/legal/accept", {}, li.cookie);
    expect(acc.status).toBe(200);
    const after = await json("GET", "/api/account/status", undefined, li.cookie);
    expect(after.json.data.legal.pending).toEqual([]);
    const rows = await prisma.legalAcceptance.findMany({ where: { organizationId: a.organization.id } });
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.source === "in_app" && r.userEmail === adminEmail)).toBe(true);
    await setLegalPrompt(false);
  });

  it.skipIf(!privileged)("esqueci minha senha: mesma resposta para qualquer e-mail, link de uso único e sessões encerradas", async () => {
    const userEmail = `reset-${suffix}@example.com`;
    const a = await createOrganizationWithAdmin({ organizationName: `Reset ${suffix}`, slug: `reset-${suffix}`, adminName: "Rae User", adminEmail: userEmail, password: "old-password-1" });
    const before = await login(userEmail, "old-password-1", a.organization.id);
    expect(before.status).toBe(200);
    expect((await json("GET", "/api/account/status", undefined, before.cookie)).status).toBe(200);

    const unknown = await json("POST", "/api/auth/forgot-password", { email: `nobody-${suffix}@example.com` });
    const known = await json("POST", "/api/auth/forgot-password", { email: userEmail });
    expect(unknown.status).toBe(200);
    expect(known.json.message).toBe(unknown.json.message);
    expect(sent).toHaveLength(1);
    const first = new URL(linkIn(sent[0], /https?:\/\/\S+reset-password\.html\?token=\S+/)).searchParams.get("token")!;

    // A second request cancels the first link.
    await json("POST", "/api/auth/forgot-password", { email: userEmail });
    const second = new URL(linkIn(sent[1], /https?:\/\/\S+reset-password\.html\?token=\S+/)).searchParams.get("token")!;
    expect((await json("GET", `/api/auth/reset-password?token=${first}`)).status).toBe(410);
    expect((await json("GET", `/api/auth/reset-password?token=${second}`)).json.data.email).toBe(userEmail);

    const done = await json("POST", "/api/auth/reset-password", { token: second, password: "new-password-2" });
    expect(done.status).toBe(200);
    expect(sent.at(-1)?.subject).toMatch(/password was changed/);
    expect((await json("POST", "/api/auth/reset-password", { token: second, password: "another-pass-3" })).status).toBe(410);

    // Old session is gone; old password fails; new one works.
    expect((await json("GET", "/api/account/status", undefined, before.cookie)).status).not.toBe(200);
    expect((await login(userEmail, "old-password-1", a.organization.id)).status).not.toBe(200);
    expect((await login(userEmail, "new-password-2", a.organization.id)).status).toBe(200);

    // Limit per e-mail: 3 per hour (already used 2).
    await json("POST", "/api/auth/forgot-password", { email: userEmail });
    expect((await json("POST", "/api/auth/forgot-password", { email: userEmail })).status).toBe(429);
  });
});

/* ───────────── backup restore check (needs pg_dump and CREATE DATABASE) ───────────── */

const run = promisify(execFile);
const hasPgDump = await run("pg_dump", ["--version"]).then(() => true).catch(() => false);
const adminUrl = process.env.DATABASE_URL || "";
const canCreateDb = adminUrl
  ? await (async () => {
      const c = new pg.Client({ connectionString: adminUrl.replace(/\?schema=[^&]*&?/, "?").replace(/\?$/, ""), ...(new URL(adminUrl).searchParams.get("host") ? { host: new URL(adminUrl).searchParams.get("host")! } : {}) });
      try {
        await c.connect();
        const r = await c.query(`SELECT rolcreatedb OR rolsuper AS ok FROM pg_roles WHERE rolname = current_user`);
        return Boolean(r.rows[0]?.ok);
      } catch {
        return false;
      } finally {
        await c.end().catch(() => undefined);
      }
    })()
  : false;

describe.skipIf(!hasPgDump || !canCreateDb)("Backup: teste de restauração", () => {
  const stamp = Date.now().toString(36);
  const srcDb = `bk_src_${stamp}`;
  const dstDb = `bk_dst_${stamp}`;
  const urlFor = (db: string) => {
    const u = new URL(adminUrl);
    u.pathname = `/${db}`;
    u.searchParams.delete("schema");
    return u.toString();
  };
  const socket = new URL(adminUrl).searchParams.get("host");
  async function sql(db: string | null, text: string) {
    const c = new pg.Client({ connectionString: db ? urlFor(db) : urlFor("postgres"), ...(socket ? { host: socket } : {}) });
    await c.connect();
    try {
      return await c.query(text);
    } finally {
      await c.end();
    }
  }

  beforeAll(async () => {
    await sql(null, `CREATE DATABASE ${srcDb}`);
    await sql(null, `CREATE DATABASE ${dstDb}`);
    await sql(
      srcDb,
      `CREATE TABLE "Organization" (id serial PRIMARY KEY, name text NOT NULL);
       CREATE TABLE "Lead" (id serial PRIMARY KEY, org int REFERENCES "Organization"(id), name text);
       CREATE INDEX lead_org ON "Lead"(org);
       CREATE TABLE "JobRun" (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, "startedAt" timestamp(3) NOT NULL DEFAULT now(), "finishedAt" timestamp(3), ok boolean, processed int NOT NULL DEFAULT 0, detail jsonb, error text, trigger text NOT NULL DEFAULT 'schedule');
       INSERT INTO "Organization"(name) SELECT 'Org ' || g FROM generate_series(1, 12) g;
       INSERT INTO "Lead"(org, name) SELECT 1 + (g % 12), 'Lead ' || g FROM generate_series(1, 250) g;`,
    );
  });

  afterAll(async () => {
    await sql(null, `DROP DATABASE IF EXISTS ${srcDb} WITH (FORCE)`).catch(() => undefined);
    await sql(null, `DROP DATABASE IF EXISTS ${dstDb} WITH (FORCE)`).catch(() => undefined);
  });

  it("copia, restaura num banco vazio, compara tabela por tabela e grava o resultado", async () => {
    const started = new Date();
    const r = await backupRestoreCheck({ sourceUrl: urlFor(srcDb), targetUrl: urlFor(dstDb) });
    expect(r.problems).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.tables).toBe(3);
    expect(r.rows).toBe(262);
    expect(r.dumpBytes).toBeGreaterThan(0);
    const restored = await sql(dstDb, `SELECT count(*)::int AS n FROM "Lead"`);
    expect(restored.rows[0].n).toBe(250);

    await recordBackupCheck(urlFor(srcDb), r, started);
    const saved = await sql(srcDb, `SELECT ok, processed, detail->>'rows' AS rows FROM "JobRun" WHERE name = 'backup-restore-check'`);
    expect(saved.rows).toEqual([{ ok: true, processed: 3, rows: "262" }]);
  });

  it("recusa destino que não está vazio e recusa restaurar na própria origem", async () => {
    await expect(backupRestoreCheck({ sourceUrl: urlFor(srcDb), targetUrl: urlFor(dstDb) })).rejects.toThrow(/not empty/);
    await expect(backupRestoreCheck({ sourceUrl: urlFor(srcDb), targetUrl: urlFor(srcDb) })).rejects.toThrow(/source database/);
  });
});
