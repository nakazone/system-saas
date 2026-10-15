import { describe, it, expect, beforeAll, afterAll } from "vitest";
import zlib from "node:zlib";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { PrismaClient } from "@prisma/client";
import { createApp } from "../src/app.js";
import { hashPassword } from "../src/lib/auth/password.js";
import { encryptSecret, generateTotpSecret, totpAt } from "../src/lib/auth/totp.js";
import { resetThrottle } from "../src/master/auth.js";
import { createOrganizationWithAdmin } from "../src/modules/organizations/service.js";
import { applyTerms, baseDictionary, buildBundle, bumpI18n, i18nVersion, previewText, translateWith } from "../src/lib/i18n/index.js";

const prisma = new PrismaClient();
const suffix = `i18n${Date.now().toString(36)}`;

const privileged = await prisma
  .$queryRaw<{ ok: boolean }[]>`SELECT (rolsuper OR rolbypassrls) AS ok FROM pg_roles WHERE rolname = current_user`
  .then((r) => Boolean(r[0]?.ok))
  .catch(() => false);

afterAll(async () => {
  await prisma.i18nTerm.deleteMany({ where: { note: suffix } });
  await prisma.i18nPhrase.deleteMany({ where: { source: { contains: suffix } } });
  await bumpI18n();
  await prisma.$disconnect();
});

describe("Dicionário base", () => {
  it("carrega, tem os três idiomas e os {n} da tradução existem no original", () => {
    const { entries } = baseDictionary();
    expect(entries.length).toBeGreaterThan(7000);
    let en = 0;
    let es = 0;
    for (const e of entries) {
      const src = new Set(e.k.match(/\{\d+\}/g) || []);
      for (const loc of ["pt", "en", "es"] as const) {
        const t = e[loc];
        if (t === undefined) continue;
        for (const ph of t.match(/\{\d+\}/g) || []) expect(src.has(ph), `${loc}: ${e.k} → ${t}`).toBe(true);
      }
      if (e.en) en += 1;
      if (e.es) es += 1;
    }
    expect(en).toBeGreaterThan(5500); // the rest is already English in the code
    expect(es).toBeGreaterThan(6500);
    const k = (s: string) => baseDictionary().byKey.get(s)!;
    expect(k("Salvar").en).toBe("Save");
    expect(k("Salvar").es).toBe("Guardar");
    expect(k("Novo orçamento").en).toBe("New quote");
  });
});

describe("Troca de palavras", () => {
  const quote = [{ f: "Orçamento", r: "Quote", fp: "Orçamentos", rp: "Quotes" }];

  it("troca palavra inteira, plural e mantém maiúscula/minúscula", () => {
    expect(applyTerms("Novo orçamento", quote)).toBe("Novo quote");
    expect(applyTerms("Orçamentos enviados", quote)).toBe("Quotes enviados");
    expect(applyTerms("ORÇAMENTO", quote)).toBe("QUOTE");
    expect(applyTerms("Orçamento #12 · orçamentos: 3", quote)).toBe("Quote #12 · quotes: 3");
    expect(applyTerms("Orçamentação", quote)).toBe("Orçamentação"); // only the whole word
  });

  it("sem plural cadastrado não mexe no plural; 'exato' respeita a grafia", () => {
    expect(applyTerms("Orçamentos", [{ f: "Orçamento", r: "Quote" }])).toBe("Orçamentos");
    expect(applyTerms("Job e job", [{ f: "Job", r: "Obra", c: true }])).toBe("Obra e job");
  });
});

describe("Busca da tradução (igual ao navegador)", () => {
  const bundle = {
    exact: { Instalação: "Installation", "A pagar": "To pay", hoje: "today", Enviados: "Sent" },
    patterns: [
      ["A pagar{0}", "To pay{0}"],
      ["Orçamentos{0}", "Quotes{0}"],
      ["até {0}", "until {0}"],
    ] as [string, string][],
  };

  it("padrões, partes separadas por · e marcador colado a uma palavra", () => {
    expect(translateWith(bundle, "A pagar · Instalação")).toBe("To pay · Installation");
    expect(translateWith(bundle, "até hoje")).toBe("until today");
    expect(translateWith(bundle, "Orçamentos enviados")).toBeNull(); // would come out half translated
    expect(translateWith(bundle, "Semana · Instalação")).toBe("Semana · Installation");
  });
});

describe("Pacote por idioma com as edições do Master", () => {
  it("frase editada e troca entram no pacote; a versão muda", async () => {
    const v1 = await i18nVersion();
    const source = `Texto de teste ${suffix}`;
    await prisma.i18nPhrase.create({ data: { source, locale: "en", text: `Test text ${suffix}`, custom: true, updatedByName: "teste" } });
    await prisma.i18nTerm.create({ data: { locale: "pt", find: "Orçamento", replace: "Quote", findPlural: "Orçamentos", replacePlural: "Quotes", note: suffix, updatedByName: "teste" } });
    await new Promise((r) => setTimeout(r, 5));
    await bumpI18n();
    expect(await i18nVersion()).not.toBe(v1);
    const en = (await buildBundle("en")).bundle;
    expect(en.exact[source]).toBe(`Test text ${suffix}`);
    const pt = (await buildBundle("pt")).bundle;
    expect(pt.terms.some((t) => t.f === "Orçamento" && t.r === "Quote")).toBe(true);
    const p = await previewText("Novo orçamento");
    expect(p.pt).toBe("Novo quote");
    expect(p.en).toBe("New quote");
    expect(p.es).toBe("Nuevo presupuesto");
  });

  it("texto inglês do código fica de fora dentro dos documentos do cliente", async () => {
    const pt = (await buildBundle("pt")).bundle;
    expect(pt.english).toContain("Client name is required.");
    expect(pt.english).not.toContain("Salvar");
  });
});

describe("Rotas do CRM", () => {
  let server: Server;
  let base = "";
  const cookieOf = (r: Response) => (r.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");

  beforeAll(() => {
    server = createApp().listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => server?.close());

  it("pacote público, com gzip e cache pela versão", async () => {
    const r = await fetch(`${base}/api/i18n/bundle?locale=es`, { headers: { "Accept-Encoding": "identity" } });
    expect(r.status).toBe(200);
    const j = (await r.json()) as { v: string; locale: string; exact: Record<string, string> };
    expect(j.locale).toBe("es");
    expect(j.exact["Salvar"]).toBe("Guardar");
    const r2 = await fetch(`${base}/api/i18n/bundle?locale=es&v=${encodeURIComponent(j.v)}`, { headers: { "Accept-Encoding": "gzip" } });
    expect(r2.headers.get("cache-control")).toMatch(/immutable/);
    // fetch decodes gzip by itself; the body is the same JSON
    expect(((await r2.json()) as { v: string }).v).toBe(j.v);
    expect(zlib.gzipSync(JSON.stringify(j)).length).toBeLessThan(JSON.stringify(j).length);
  });

  it.skipIf(!privileged)("idioma da conta: segue a empresa até a pessoa escolher", async () => {
    const a = await createOrganizationWithAdmin({ organizationName: `Lang Co ${suffix}`, slug: `lang-${suffix}`, adminName: "Ana Lima", adminEmail: `lang-${suffix}@example.com`, password: "password12345" });
    await prisma.organization.update({ where: { id: a.organization.id }, data: { defaultLocale: "es" } });
    const host = `lang-${suffix}.localhost`;
    const login = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json", Host: host }, body: JSON.stringify({ email: `lang-${suffix}@example.com`, password: "password12345", organizationId: a.organization.id }) });
    expect(login.status).toBe(200);
    const cookie = cookieOf(login);
    const j = async (p: string, body?: unknown) => {
      const r = await fetch(base + p, { method: body ? "POST" : "GET", headers: { Cookie: cookie, Host: host, "Content-Type": "application/json", Accept: "application/json" }, body: body ? JSON.stringify(body) : undefined });
      return { status: r.status, json: (await r.json().catch(() => ({}))) as Record<string, any> };
    };
    expect((await j("/api/i18n/me")).json).toMatchObject({ locale: "es", source: "company" });
    expect((await j("/api/i18n/locale", { locale: "en" })).status).toBe(200);
    expect((await j("/api/i18n/me")).json).toMatchObject({ locale: "en", source: "user", company: "es" });
    expect((await j("/api/i18n/locale", { locale: "xx" })).status).toBe(400);
    expect((await j("/api/i18n/locale", { locale: "company" })).status).toBe(200);
    expect((await j("/api/i18n/me")).json).toMatchObject({ locale: "es", source: "company" });
    // The page carries the language script and the company default.
    const page = await fetch(`${base}/leads.html`, { headers: { Cookie: cookie, Host: host } });
    const html = await page.text();
    expect(html).toContain('window.__OM_I18N={"v":');
    expect(html).toContain('"locale":"es"');
    expect(html).toContain("/crm-i18n.js?v=");
    // The builder portal stays in English (no language script).
    const portal = await fetch(`${base}/builder-login.html`, { headers: { Host: host } });
    expect(await portal.text()).not.toContain("crm-i18n.js");
  });

  it("sem login não salva idioma", async () => {
    const r = await fetch(`${base}/api/i18n/locale`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ locale: "en" }) });
    expect([401, 404]).toContain(r.status);
  });
});

describe.skipIf(!privileged)("Master › Idiomas", () => {
  let server: Server;
  let base = "";
  let cookie = "";
  const secret = generateTotpSecret();
  const masterEmail = `master-${suffix}@example.com`;
  const cookieOf = (r: Response) => (r.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
  async function form(path: string, body: Record<string, string>) {
    const r = await fetch(base + path, { method: "POST", headers: { Cookie: cookie, "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json", "X-Requested-With": "fetch" }, body: new URLSearchParams(body) });
    return { status: r.status, json: (await r.json().catch(() => ({}))) as Record<string, any> };
  }

  beforeAll(async () => {
    resetThrottle();
    await prisma.$executeRaw`UPDATE "PlatformAdmin" SET role = 'ADMIN' WHERE role = 'MASTER'`;
    await prisma.platformAdmin.create({
      data: { email: masterEmail, name: "Naka Idiomas", role: "MASTER", status: "active", passwordHash: await hashPassword("master-password-123"), totpSecretEnc: encryptSecret(secret, process.env.SESSION_SECRET!), totpEnabledAt: new Date(), recoveryCodeHashes: [] },
    });
    server = createApp().listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const r1 = await fetch(`${base}/master/entrar`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ email: masterEmail, password: "master-password-123" }), redirect: "manual" });
    cookie = cookieOf(r1);
    const r2 = await fetch(`${base}/master/2fa`, { method: "POST", headers: { Cookie: cookie, "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ code: totpAt(secret, Date.now()) }), redirect: "manual" });
    cookie = cookieOf(r2) || cookie;
  });
  afterAll(() => server?.close());

  it("as três abas abrem", async () => {
    for (const p of ["/master/idiomas", "/master/idiomas?aba=termos&idioma=es", "/master/idiomas?aba=frases&q=Salvar", "/master/idiomas?aba=frases&editadas=1", "/master/idiomas?aba=testar"]) {
      const r = await fetch(base + p, { headers: { Cookie: cookie } });
      expect(r.status, p).toBe(200);
    }
    const html = await (await fetch(`${base}/master/idiomas?aba=frases&q=Salvar%20altera`, { headers: { Cookie: cookie } })).text();
    expect(html).toContain("Save changes");
    expect(html).toContain("Guardar cambios");
  });

  it("troca: alcance, cria, não duplica, edita, desliga e exclui (com auditoria)", async () => {
    const reach = await fetch(`${base}/master/idiomas/termos/alcance?idioma=pt&find=Orçamento&replace=Quote&findPlural=Orçamentos&replacePlural=Quotes`, { headers: { Cookie: cookie, Accept: "application/json" } });
    const rj = (await reach.json()) as { count: number; examples: { before: string; after: string }[] };
    expect(rj.count).toBeGreaterThan(20);
    expect(rj.examples[0]!.after).toMatch(/[Qq]uote/);

    expect((await form("/master/idiomas/termos", { locale: "pt", find: "", replace: "x" })).status).toBe(400);
    expect((await form("/master/idiomas/termos", { locale: "es", find: "Presupuesto", replace: "Cotización", findPlural: "Presupuestos" })).status).toBe(400);
    const c = await form("/master/idiomas/termos", { locale: "es", find: "Presupuesto", replace: "Cotización", findPlural: "Presupuestos", replacePlural: "Cotizaciones", note: suffix });
    expect(c.status).toBe(200);
    expect((await form("/master/idiomas/termos", { locale: "es", find: "presupuesto", replace: "Otro", note: suffix })).status).toBe(400);
    const t = await prisma.i18nTerm.findFirstOrThrow({ where: { locale: "es", note: suffix } });
    expect((await buildBundle("es")).bundle.terms.some((x) => x.r === "Cotización")).toBe(true);
    expect((await form(`/master/idiomas/termos/${t.id}`, { find: "Presupuesto", replace: "Cotizacion", findPlural: "Presupuestos", replacePlural: "Cotizaciones", note: suffix })).status).toBe(200);
    expect(await prisma.i18nTerm.findUniqueOrThrow({ where: { id: t.id } })).toMatchObject({ replace: "Cotizacion" });
    expect((await form(`/master/idiomas/termos/${t.id}`, { op: "toggle" })).status).toBe(200);
    expect((await buildBundle("es")).bundle.terms.some((x) => x.r === "Cotizacion")).toBe(false);
    expect((await form(`/master/idiomas/termos/${t.id}`, { op: "delete" })).status).toBe(200);
    expect(await prisma.i18nTerm.count({ where: { id: t.id } })).toBe(0);
    expect(await prisma.platformAuditLog.count({ where: { action: { startsWith: "i18n.term_" }, actorName: "Naka Idiomas" } })).toBeGreaterThanOrEqual(4);
  });

  it("frase: edita um idioma, valida {n}, volta ao padrão; nova frase", async () => {
    expect((await form("/master/idiomas/frases", { source: "Salvar alterações", en: "Save it all" })).status).toBe(200);
    expect((await buildBundle("en")).bundle.exact["Salvar alterações"]).toBe("Save it all");
    expect((await buildBundle("es")).bundle.exact["Salvar alterações"]).toBe("Guardar cambios");
    expect((await form("/master/idiomas/frases", { source: "{0} dias", en: "{1} days" })).status).toBe(400);
    expect((await form("/master/idiomas/frases/padrao", { source: "Salvar alterações" })).status).toBe(200);
    expect((await buildBundle("en")).bundle.exact["Salvar alterações"]).toBe("Save changes");
    const src = `Frase nova ${suffix}`;
    expect((await form("/master/idiomas/frases", { source: src, custom: "1", pt: src, en: `New phrase ${suffix}`, es: `Frase nueva ${suffix}` })).status).toBe(200);
    expect((await buildBundle("es")).bundle.exact[src]).toBe(`Frase nueva ${suffix}`);
    expect((await form("/master/idiomas/frases", { source: "Salvar", custom: "1", en: "x" })).status).toBe(400);
  });

  it("testar mostra os três idiomas", async () => {
    const r = await form("/master/idiomas/testar", { text: "Salvar\nNovo orçamento" });
    expect(r.json.result.en).toBe("Save\nNew quote");
    expect(r.json.result.es).toBe("Guardar\nNuevo presupuesto");
  });
});
