import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { PrismaClient } from "@prisma/client";
import { createApp } from "../src/app.js";
import { fingerprintOf, normalizeMessage, recordError, stackTop } from "../src/lib/ops/errors.js";
import { jobsOverview, registerJob, runJobNow, trackRun } from "../src/lib/ops/jobs.js";
import { setMaintenance, upcomingNotice, type Maintenance } from "../src/lib/ops/maintenance.js";

const prisma = new PrismaClient();
const suffix = `op${Date.now().toString(36)}`;

afterAll(async () => {
  await setMaintenance({ on: false, message: "", until: null, startedAt: null, scheduledAt: null, scheduledNote: "" });
  await prisma.$disconnect();
});

describe("Erros agrupados", () => {
  it("mesma mensagem com números/ids diferentes vira o mesmo grupo", () => {
    expect(normalizeMessage('Quote 1043 not found for "abc" 6f1c2a9e-1111-4222-8333-444455556666')).toBe("Quote <n> not found for <v> <id>");
    const top = stackTop("Error: x\n    at Object.<anonymous> (/app/node_modules/express/lib/router.js:1:1)\n    at handler (/app/src/crm/routes/invoices.ts:412:18)");
    expect(top).toBe("handler src/crm/routes/invoices.ts:412:18");
    expect(fingerprintOf("server", "Quote 1 not found", top)).toBe(fingerprintOf("server", "Quote 2 not found", top));
    expect(fingerprintOf("server", "Quote 1 not found", top)).not.toBe(fingerprintOf("browser", "Quote 1 not found", top));
  });

  it("conta, guarda as últimas ocorrências e reabre o que foi marcado como resolvido", async () => {
    const msg = `Teste ${suffix} falhou com id 123`;
    const stack = `Error: ${msg}\n    at fn (/app/src/lib/x.ts:10:5)`;
    await recordError({ source: "server", message: msg, stack, path: "/api/x", method: "GET" });
    await recordError({ source: "server", message: msg.replace("123", "456"), stack, path: "/api/x", method: "POST" });
    const fp = fingerprintOf("server", msg, stackTop(stack));
    let g = await prisma.errorGroup.findUniqueOrThrow({ where: { fingerprint: fp } });
    expect(g.count).toBe(2);
    expect((g.samples as unknown[]).length).toBe(2);
    await prisma.errorGroup.update({ where: { fingerprint: fp }, data: { status: "resolved", resolvedAt: new Date() } });
    await recordError({ source: "server", message: msg, stack, path: "/api/x", method: "GET" });
    g = await prisma.errorGroup.findUniqueOrThrow({ where: { fingerprint: fp } });
    expect(g.status).toBe("open");
    expect(g.count).toBe(3);
  });
});

describe("Jobs em segundo plano", () => {
  it("guarda sucesso e falha, roda na mão e marca atrasado", async () => {
    const ok = `t-ok-${suffix}`;
    const bad = `t-bad-${suffix}`;
    registerJob({ name: ok, label: "Teste ok", intervalMs: 60_000, run: async () => ({ processed: 4 }) });
    registerJob({ name: bad, label: "Teste falha", intervalMs: 60_000, run: async () => { throw new Error("quebrou"); } });
    await trackRun(ok, async () => ({ processed: 4 }));
    await expect(trackRun(bad, async () => { throw new Error("quebrou"); })).rejects.toThrow("quebrou");
    const r = await runJobNow(ok);
    expect(r).toEqual({ ok: true, processed: 4 });
    expect((await runJobNow("nao-existe")).ok).toBe(false);

    const view = await jobsOverview();
    const a = view.find((j) => j.name === ok)!;
    const b = view.find((j) => j.name === bad)!;
    expect(a).toMatchObject({ lastOk: true, lastProcessed: 4, runs: 2, late: false, canRun: true });
    expect(b).toMatchObject({ lastOk: false, lastError: "quebrou", failures: 1 });
    const later = await jobsOverview(new Date(Date.now() + 5 * 60_000));
    expect(later.find((j) => j.name === ok)!.late).toBe(true);
  });
});

describe("Modo manutenção", () => {
  let server: Server;
  let base = "";
  beforeAll(() => {
    server = createApp().listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => server?.close());

  it("bloqueia telas, APIs e links públicos; Master, /health e webhooks continuam", async () => {
    await setMaintenance({ on: true, message: "Atualizando o sistema", until: new Date(Date.now() + 3600e3).toISOString(), startedAt: new Date().toISOString() });
    await new Promise((r) => setTimeout(r, 10_100)); // settings cache
    const api = await fetch(`${base}/api/leads`, { headers: { Accept: "application/json" } });
    expect(api.status).toBe(503);
    expect((await api.json()).error).toBe("MAINTENANCE");
    const pageRes = await fetch(`${base}/login.html`);
    expect(pageRes.status).toBe(503);
    expect(await pageRes.text()).toContain("Voltamos já");
    expect((await fetch(`${base}/public/q/whatever`)).status).toBe(503);
    expect((await fetch(`${base}/health`)).status).toBe(200);
    expect((await fetch(`${base}/master/entrar`)).status).toBe(200);
    // The webhook answers by itself (here "not configured", since tests have no Stripe secret) — never the maintenance page.
    const wh = await fetch(`${base}/webhooks/stripe`, { method: "POST", body: "{}", headers: { "Content-Type": "application/json" } });
    expect((await wh.json().catch(() => ({}))).error).not.toBe("MAINTENANCE");

    await setMaintenance({ on: false });
    await new Promise((r) => setTimeout(r, 10_100));
    expect((await fetch(`${base}/api/leads`, { headers: { Accept: "application/json" } })).status).not.toBe(503);
  }, 40_000);

  it("aviso programado aparece só nas 24 h antes", () => {
    const base: Maintenance = { on: false, message: "", until: null, startedAt: null, scheduledAt: null, scheduledNote: "" };
    const now = Date.parse("2026-11-10T12:00:00Z");
    expect(upcomingNotice({ ...base, scheduledAt: "2026-11-11T06:00:00Z", scheduledNote: "15 min" }, now)).toEqual({ at: "2026-11-11T06:00:00Z", note: "15 min" });
    expect(upcomingNotice({ ...base, scheduledAt: "2026-11-12T06:00:00Z" }, now)).toBeNull();
    expect(upcomingNotice({ ...base, scheduledAt: "2026-11-09T06:00:00Z" }, now)).toBeNull();
    expect(upcomingNotice({ ...base, on: true, scheduledAt: "2026-11-11T06:00:00Z" }, now)).toBeNull();
  });
});
