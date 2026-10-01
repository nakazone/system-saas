import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import type { Request } from "express";
import { PrismaClient } from "@prisma/client";
import { createApp } from "../src/app.js";
import { createOrganizationWithAdmin } from "../src/modules/organizations/service.js";
import { withTenantTransaction } from "../src/lib/tenant/prisma-tenant.js";
import { DEFAULT_PERMISSIONS } from "../src/lib/tenant/defaults.js";
import { env } from "../src/config/env.js";
import { publicBaseUrl } from "../src/lib/http/public-url.js";
import {
  formatQuantity,
  formatTicketWhen,
  notesToHtml,
  parseLockbox,
  stripLockbox,
} from "../src/modules/work-orders/public-ticket.js";

describe("worker ticket — helpers (pure)", () => {
  it("shows times in the organization's timezone, not the server's", () => {
    // 13:30 UTC = 07:30 in Denver (MDT); the old ticket printed 13:30.
    const start = new Date("2026-10-02T13:30:00Z");
    const end = new Date("2026-10-03T23:00:00Z");
    const w = formatTicketWhen(start, end, "America/Denver", new Date("2026-10-01T18:00:00Z"))!;
    expect(w).toMatchObject({ start: "07:30", day: "Sexta, 2 de outubro", relative: "Amanhã", zone: "MDT", multiDay: true });
    expect(w.until).toBe("até sáb, 3 out · 17:00");
    const same = formatTicketWhen(start, new Date("2026-10-02T23:00:00Z"), "America/Denver", start)!;
    expect(same).toMatchObject({ until: "até 17:00", relative: "Hoje", multiDay: false });
    expect(formatTicketWhen(null, null, "America/Denver")).toBeNull();
    // Bad zone falls back instead of throwing.
    expect(formatTicketWhen(start, null, "Mars/Base")!.start).toBe("09:30");
  });

  it("pulls the lockbox code out of the notes and keeps the rest", () => {
    const notes = "/lockbox 4821 — caixa na porta da garagem.\nSuper: Mark (720) 555-0143.";
    expect(parseLockbox(notes)).toBe("4821");
    expect(stripLockbox(notes)).toBe("Caixa na porta da garagem.\nSuper: Mark (720) 555-0143.");
    expect(stripLockbox("Sem código aqui")).toBe("Sem código aqui");
    expect(parseLockbox("nada")).toBeNull();
  });

  it("uses each service's own unit", () => {
    expect(formatQuantity(1180, "sq_ft")).toBe("1,180 sq ft");
    expect(formatQuantity(14, "step")).toBe("14 degraus");
    expect(formatQuantity(1, "step")).toBe("1 degrau");
    expect(formatQuantity(320, "linear_ft")).toBe("320 lin ft");
    expect(formatQuantity(1, "fixed")).toBe("");
    expect(formatQuantity(0, "sq_ft")).toBe("");
  });

  it("escapes notes and makes phone numbers tappable", () => {
    const html = notesToHtml("<b>oi</b> ligue (720) 555-0143");
    expect(html).toContain("&lt;b&gt;oi&lt;/b&gt;");
    expect(html).toContain('<a href="tel:+17205550143">(720) 555-0143</a>');
  });

  it("hands out the brand domain instead of the hosting provider's", () => {
    const req = (host: string) => ({ get: (h: string) => (h.toLowerCase() === "host" ? host : undefined), protocol: "https" }) as unknown as Request;
    const prevRoot = env.APP_ROOT_DOMAIN;
    const prevEnv = env.NODE_ENV;
    try {
      (env as { APP_ROOT_DOMAIN: string }).APP_ROOT_DOMAIN = "obramate.com";
      (env as { NODE_ENV: string }).NODE_ENV = "production";
      expect(publicBaseUrl(req("system-saas-production.up.railway.app"))).toBe("https://obramate.com");
      expect(publicBaseUrl(req("obramate.com"))).toBe("https://obramate.com");
      expect(publicBaseUrl(req("www.obramate.com"))).toBe("https://obramate.com");
      (env as { NODE_ENV: string }).NODE_ENV = "development";
      expect(publicBaseUrl(req("localhost:3100"))).toMatch(/^https?:\/\/localhost:3100$/);
    } finally {
      (env as { APP_ROOT_DOMAIN: string }).APP_ROOT_DOMAIN = prevRoot;
      (env as { NODE_ENV: string }).NODE_ENV = prevEnv;
    }
  });
});

/** Login reads `User` outside a tenant transaction — needs a privileged DB role. */
const probe = new PrismaClient();
const privileged = await probe
  .$queryRaw<{ ok: boolean }[]>`SELECT (rolsuper OR rolbypassrls) AS ok FROM pg_roles WHERE rolname = current_user`
  .then((r) => Boolean(r[0]?.ok))
  .catch(() => false)
  .finally(() => probe.$disconnect());

describe.skipIf(!privileged)("worker ticket — link + page (HTTP)", () => {
  const prisma = new PrismaClient();
  let server: Server;
  let base = "";
  let orgId = "";
  const suffix = `tkt${Date.now().toString(36)}`;
  const email = `tk-${suffix}@example.com`;

  async function login(): Promise<string> {
    const r = await fetch(`${base}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: "password12345", organizationId: orgId }),
      redirect: "manual",
    });
    const cookie = (r.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
    if (!cookie.includes("=")) throw new Error(`login failed ${r.status}`);
    return cookie;
  }

  async function call(cookie: string, method: string, path: string, body?: unknown) {
    const r = await fetch(`${base}${path}`, {
      method,
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: r.status, json: (await r.json()) as Record<string, any> };
  }

  const tokenOf = (url: string) => url.split("/t/")[1]!;

  beforeAll(async () => {
    for (const p of DEFAULT_PERMISSIONS) {
      await prisma.permission.upsert({
        where: { key: p.key },
        create: { key: p.key, group: p.group, description: p.description },
        update: {},
      });
    }
    const a = await createOrganizationWithAdmin({
      organizationName: `Ticket ${suffix}`,
      slug: `tk-${suffix}`,
      adminName: "Admin",
      adminEmail: email,
      password: "password12345",
    });
    orgId = a.organization.id;
    await prisma.organization.update({
      where: { id: orgId },
      data: { timezone: "America/Denver", contactPhone: "(720) 555-0100" },
    });
    const app = createApp();
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => resolve());
    });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    await prisma.$disconnect();
  });

  it("keeps one short link per worker, renders the ticket in Portuguese and local time", async () => {
    const admin = await login();
    const pricing = await withTenantTransaction(orgId, (tx) =>
      tx.pricingItem.create({ data: { organizationId: orgId, name: "Stair treads", unit: "step", priceBuilder: 45 } }),
    );
    const job = await call(admin, "POST", "/api/work-orders", {
      title: "Summit — Lot 14",
      address: "14 Summit Way, Louisville CO",
      notes: "/lockbox 4821 — caixa na garagem",
      campo_attention: "Proteger os degraus",
      scheduled_start: "2026-10-02T13:30:00.000Z",
      scheduled_end: "2026-10-02T23:00:00.000Z",
      line_items: [{ pricing_item_id: pricing.id, service_name: "Stair treads", quantity_sqft: 14, unit_price: 45 }],
    });
    expect(job.status, JSON.stringify(job.json)).toBe(201);
    const woId = job.json.data.id as string;

    const temp = await call(admin, "POST", `/api/work-orders/${woId}/temp-workers`, { name: "Carlos Mendes", phone: "7205550199" });
    expect(temp.status).toBe(201);
    const url1 = temp.json.data.share.url as string;
    expect(url1).toMatch(/\/t\/[A-Za-z0-9_-]{22}$/);
    expect(decodeURIComponent(temp.json.data.share.whatsapp_url)).toContain("Olá Carlos! Seu ticket do job #");

    // Sending the link again must not kill the one the worker already has.
    const again = await call(admin, "POST", `/api/work-orders/${woId}/temp-workers/${temp.json.data.id}/share-link`);
    expect(again.json.data.url).toBe(url1);

    const page = await fetch(`${base}/t/${tokenOf(url1)}`);
    expect(page.status).toBe(200);
    expect(page.headers.get("x-robots-tag")).toContain("noindex");
    const html = await page.text();
    expect(html).toContain("07:30");
    expect(html).not.toContain("13:30");
    expect(html).toContain("Sexta, 2 de outubro");
    expect(html).toContain("até 17:00");
    expect(html).toContain("Agendado");
    expect(html).toContain("4821");
    expect(html).toContain("Caixa na garagem");
    expect(html).not.toContain("/lockbox");
    expect(html).toContain("Proteger os degraus");
    expect(html).toContain("14 degraus");
    expect(html).toContain("google.com/maps/search");
    expect(html).toContain("tel:+17205550100");
    expect(html).toContain("Carlos Mendes (você)");

    // The old long path keeps working for links already sent.
    expect((await fetch(`${base}/public/jobs/${tokenOf(url1)}`)).status).toBe(200);

    // Explicit rotation replaces the link and the old one stops working.
    const rotated = await call(admin, "POST", `/api/work-orders/${woId}/temp-workers/${temp.json.data.id}/share-link`, { rotate: true });
    expect(rotated.json.data.url).not.toBe(url1);
    const dead = await fetch(`${base}/t/${tokenOf(url1)}`);
    expect(dead.status).toBe(404);
    expect(await dead.text()).toContain("Este link não está mais ativo");
    expect((await fetch(`${base}/t/${tokenOf(rotated.json.data.url)}`)).status).toBe(200);

    // Removing the worker kills the link.
    await call(admin, "DELETE", `/api/work-orders/${woId}/temp-workers/${temp.json.data.id}`);
    expect((await fetch(`${base}/t/${tokenOf(rotated.json.data.url)}`)).status).toBe(404);
  });

  it("answers junk tokens with the friendly page", async () => {
    const r = await fetch(`${base}/t/nope`);
    expect(r.status).toBe(404);
    expect(await r.text()).toContain("Link indisponível");
  });
});
