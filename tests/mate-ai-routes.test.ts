import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { PrismaClient } from "@prisma/client";
import { createApp } from "../src/app.js";
import { createOrganizationWithAdmin } from "../src/modules/organizations/service.js";
import { withTenantTransaction } from "../src/lib/tenant/prisma-tenant.js";
import { DEFAULT_PERMISSIONS } from "../src/lib/tenant/defaults.js";

const probe = new PrismaClient();
const privileged = await probe
  .$queryRawUnsafe("SELECT (rolsuper OR rolbypassrls) AS ok FROM pg_roles WHERE rolname = current_user")
  .then((rows) => Boolean((rows as Array<{ ok: boolean }>)[0]?.ok))
  .catch(() => false)
  .finally(() => probe.$disconnect());

describe.skipIf(!privileged)("Mate AI CRM endpoints (tenant database required)", () => {
  const prisma = new PrismaClient();
  const suffix = Date.now().toString(36);
  const emailA = "mate-a-" + suffix + "@example.com";
  const emailB = "mate-b-" + suffix + "@example.com";
  const customerName = "Mate AI Customer " + suffix;
  let server: Server;
  let base = "";
  let orgA = "";
  let orgB = "";
  let pricingItemId = "";
  let quoteCatalogItemId = "";

  async function login(email: string, organizationId: string): Promise<string> {
    const response = await fetch(base + "/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: "password12345", organizationId }),
      redirect: "manual",
    });
    const headers = response.headers as Headers & { getSetCookie?: () => string[] };
    const setCookieValues = headers.getSetCookie?.() ?? [response.headers.get("set-cookie") || ""];
    const cookie = setCookieValues
      .flatMap((value) => value.split(/,\s*(?=[^;,]+=)/))
      .map((value) => value.split(";")[0])
      .join("; ");
    if (!cookie.includes("=")) {
      throw new Error("Mate AI test login failed: " + response.status + " " + (await response.text()));
    }
    return cookie;
  }

  async function call(cookie: string, body: unknown) {
    const response = await fetch(base + "/api/mate-ai/preview", {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return { status: response.status, json: (await response.json()) as Record<string, any> };
  }

  beforeAll(async () => {
    for (const permission of DEFAULT_PERMISSIONS) {
      await prisma.permission.upsert({
        where: { key: permission.key },
        create: { key: permission.key, group: permission.group, description: permission.description },
        update: {},
      });
    }

    const [a, b] = await Promise.all([
      createOrganizationWithAdmin({
        organizationName: "Mate AI Test A " + suffix,
        slug: "mate-ai-a-" + suffix,
        adminName: "Mate AI Admin A",
        adminEmail: emailA,
        password: "password12345",
      }),
      createOrganizationWithAdmin({
        organizationName: "Mate AI Test B " + suffix,
        slug: "mate-ai-b-" + suffix,
        adminName: "Mate AI Admin B",
        adminEmail: emailB,
        password: "password12345",
      }),
    ]);
    orgA = a.organization.id;
    orgB = b.organization.id;

    await withTenantTransaction(orgA, async (tx) => {
      await tx.customer.create({
        data: { organizationId: orgA, name: customerName, customerType: "particular" },
      });
      const pricingItem = await tx.pricingItem.create({
        data: {
          organizationId: orgA,
          name: "Mate AI Test Installation",
          category: "installation",
          unit: "sq ft",
          price: 20,
          priceParticular: 20,
          priceBuilder: 15,
          active: true,
          isVisible: true,
        },
      });
      pricingItemId = pricingItem.id;
      const quoteCatalogItem = await tx.quoteCatalogItem.create({
        data: {
          organizationId: orgA,
          name: "Mate AI Test Installation",
          serviceType: "installation",
          unitType: "sq ft",
          unitPrice: 30,
          description: "Catalog description for review",
          active: true,
        },
      });
      quoteCatalogItemId = quoteCatalogItem.id;
    });

    const app = createApp();
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => resolve());
    });
    base = "http://127.0.0.1:" + (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    await prisma.$disconnect();
  });

  it("requires a session, creates only a reviewed draft, logs it, and rejects cross-tenant token use", async () => {
    const unauthenticated = await fetch(base + "/api/mate-ai/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command: "Quote para " + customerName + " com 12 sqft de Installation" }),
    });
    // Without a session the tenant guard answers first (404 ORG_REQUIRED); either way nothing leaks.
    expect([401, 404]).toContain(unauthenticated.status);

    const cookieA = await login(emailA, orgA);
    const cookieB = await login(emailB, orgB);
    const preview = await call(cookieA, {
      command: "Crie um Quote para o Cliente " + customerName + " com 12 sqft de Mate AI Test Installation",
    });
    expect(preview.status).toBe(200);
    expect(preview.json.status).toBe("ready");
    expect(preview.json.items[0].unitPrice).toBe(20);
    expect(preview.json.items[0].catalogItemId).toBe(quoteCatalogItemId);
    expect(preview.json.items[0].catalogSource).toBe("quote-catalog");
    expect(preview.json.items[0].description).toBe("Catalog description for review");
    expect(preview.json.subtotal).toBe(240);

    const wrongTenant = await fetch(base + "/api/mate-ai/quote-drafts", {
      method: "POST",
      headers: { Cookie: cookieB, "Content-Type": "application/json" },
      body: JSON.stringify({ preview_token: preview.json.preview_token, confirmed_review: true }),
    });
    expect(wrongTenant.status).toBe(400);

    const unreviewed = await fetch(base + "/api/mate-ai/quote-drafts", {
      method: "POST",
      headers: { Cookie: cookieA, "Content-Type": "application/json" },
      body: JSON.stringify({ preview_token: preview.json.preview_token, confirmed_review: false }),
    });
    expect(unreviewed.status).toBe(400);

    const created = await fetch(base + "/api/mate-ai/quote-drafts", {
      method: "POST",
      headers: { Cookie: cookieA, "Content-Type": "application/json" },
      body: JSON.stringify({ preview_token: preview.json.preview_token, confirmed_review: true }),
    });
    expect(created.status).toBe(201);
    const result = (await created.json()) as { data: { id: string; status: string; total: number } };
    expect(result.data.status).toBe("draft");
    expect(result.data.total).toBe(240);

    const replay = await fetch(base + "/api/mate-ai/quote-drafts", {
      method: "POST",
      headers: { Cookie: cookieA, "Content-Type": "application/json" },
      body: JSON.stringify({ preview_token: preview.json.preview_token, confirmed_review: true }),
    });
    expect(replay.status).toBe(409);

    const quote = await withTenantTransaction(orgA, (tx) =>
      tx.quote.findFirstOrThrow({
        where: { id: result.data.id },
        include: { lineItems: true },
      }),
    );
    expect(quote.publicToken).toBeNull();
    expect(quote.lineItems).toHaveLength(1);
    expect(quote.lineItems[0]?.catalogId).toBeNull();
    expect(quote.lineItems[0]?.unitPrice.toNumber()).toBe(20);
    expect(quote.lineItems[0]?.description).toBe("Mate AI Test Installation\nCatalog description for review");
    expect(quote.lineItems[0]?.meta).toMatchObject({
      service_catalog_id: quoteCatalogItemId,
      pricing_item_id: pricingItemId,
      catalog_source: "quote-catalog",
    });

    const previewEvents = await withTenantTransaction(orgA, (tx) =>
      tx.activityEvent.findMany({
        where: { entityType: "customer", action: "mate_ai.quote_previewed" },
      }),
    );
    const quoteEvents = await withTenantTransaction(orgA, (tx) =>
      tx.activityEvent.findMany({
        where: { entityType: "quote", entityId: result.data.id, action: "created" },
      }),
    );
    expect(previewEvents.length).toBeGreaterThan(0);
    expect(quoteEvents).toHaveLength(1);

    const otherTenantItem = await withTenantTransaction(orgB, (tx) =>
      tx.pricingItem.findFirst({ where: { id: pricingItemId } }),
    );
    expect(otherTenantItem).toBeNull();

    const stalePreview = await call(cookieA, {
      command: "Crie um Quote para o Cliente " + customerName + " com 12 sqft de Mate AI Test Installation",
    });
    expect(stalePreview.json.status).toBe("ready");
    await withTenantTransaction(orgA, (tx) =>
      tx.pricingItem.update({ where: { id: pricingItemId }, data: { priceParticular: 23 } }),
    );
    const staleCreate = await fetch(base + "/api/mate-ai/quote-drafts", {
      method: "POST",
      headers: { Cookie: cookieA, "Content-Type": "application/json" },
      body: JSON.stringify({ preview_token: stalePreview.json.preview_token, confirmed_review: true }),
    });
    expect(staleCreate.status).toBe(409);
  });

  it("does not return a token when the service cannot be matched", async () => {
    const cookieA = await login(emailA, orgA);
    const response = await call(cookieA, {
      command: "Crie um Quote para o Cliente " + customerName + " com 12 sqft de Service That Does Not Exist",
    });
    expect(response.status).toBe(200);
    expect(response.json.status).toBe("needs_clarification");
    expect(response.json.preview_token).toBeUndefined();
  });
});
