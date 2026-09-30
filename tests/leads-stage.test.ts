import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { createOrganizationWithAdmin } from "../src/modules/organizations/service.js";
import { withTenantTransaction } from "../src/lib/tenant/prisma-tenant.js";
import { DEFAULT_PERMISSIONS } from "../src/lib/tenant/defaults.js";
import { findDuplicateLead, findStageForSlug, stageRank } from "../src/lib/leads/stage.js";
import { syncLeadForQuoteStatus } from "../src/lib/pipeline/move.js";

const prisma = new PrismaClient();

describe("lead stage + duplicates", () => {
  let orgId: string;
  let otherOrgId: string;
  let leadId: string;
  let quoteId: string;

  beforeAll(async () => {
    for (const permission of DEFAULT_PERMISSIONS) {
      await prisma.permission.upsert({
        where: { key: permission.key },
        create: { key: permission.key, group: permission.group, description: permission.description },
        update: {},
      });
    }
    const suffix = Date.now().toString(36);
    const a = await createOrganizationWithAdmin({
      organizationName: `Stage A ${suffix}`,
      slug: `stage-a-${suffix}`,
      adminName: "Admin",
      adminEmail: `stage-a-${suffix}@example.com`,
      password: "password12345",
    });
    const b = await createOrganizationWithAdmin({
      organizationName: `Stage B ${suffix}`,
      slug: `stage-b-${suffix}`,
      adminName: "Admin",
      adminEmail: `stage-b-${suffix}@example.com`,
      password: "password12345",
    });
    orgId = a.organization.id;
    otherOrgId = b.organization.id;

    const seeded = await withTenantTransaction(orgId, async (tx) => {
      const assess = await tx.pipelineStage.findFirstOrThrow({ where: { slug: "assessment_scheduled" } });
      const lead = await tx.lead.create({
        data: {
          organizationId: orgId,
          name: "Stage Lead",
          email: "Stage.Lead@Example.com",
          phone: "(720) 555-0142",
          status: "assessment_scheduled",
          pipelineStageId: assess.id,
        },
      });
      const quote = await tx.quote.create({
        data: { organizationId: orgId, number: 1, title: "Q", status: "draft", leadId: lead.id, total: 1000 },
      });
      return { lead, quote };
    });
    leadId = seeded.lead.id;
    quoteId = seeded.quote.id;
    await withTenantTransaction(otherOrgId, async (tx) => {
      await tx.lead.create({ data: { organizationId: otherOrgId, name: "Other tenant", phone: "7205550199" } });
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("resolves any slug dialect to the tenant's own stage", async () => {
    await withTenantTransaction(orgId, async (tx) => {
      expect((await findStageForSlug(tx, "new_lead"))?.slug).toBe("new");
      expect((await findStageForSlug(tx, "meeting_scheduled"))?.slug).toBe("assessment_scheduled");
      expect((await findStageForSlug(tx, "closed_won"))?.slug).toBe("won");
      expect((await findStageForSlug(tx, "quote_sent"))?.slug).toBe("quote_sent");
      expect(await findStageForSlug(tx, "banana")).toBeNull();
    });
    expect(stageRank("new")).toBeLessThan(stageRank("assessment_scheduled"));
    expect(stageRank("follow_up_1")).toBeGreaterThan(stageRank("quote_sent"));
  });

  it("finds duplicates by e-mail (case-insensitive) or last 10 phone digits, only in the tenant", async () => {
    await withTenantTransaction(orgId, async (tx) => {
      expect((await findDuplicateLead(tx, orgId, { email: "stage.lead@example.com" }))?.match).toBe("email");
      expect((await findDuplicateLead(tx, orgId, { phone: "+1 720.555.0142" }))?.id).toBe(leadId);
      expect(await findDuplicateLead(tx, orgId, { phone: "720 555 0199" })).toBeNull(); // other tenant
      expect(await findDuplicateLead(tx, orgId, { phone: "123" })).toBeNull();
    });
  });

  it("moves the lead forward when its quote is sent/approved, keeping status and stage in sync", async () => {
    const read = () =>
      withTenantTransaction(orgId, (tx) =>
        tx.lead.findFirstOrThrow({ where: { id: leadId }, include: { pipelineStage: true } }),
      );
    await withTenantTransaction(orgId, (tx) =>
      syncLeadForQuoteStatus(tx, { organizationId: orgId, quoteId, previousStatus: "draft", nextStatus: "sent" }),
    );
    let lead = await read();
    expect(lead.status).toBe("quote_sent");
    expect(lead.pipelineStage?.slug).toBe("quote_sent");

    // Lead advanced to Follow Up by hand; re-sending must not pull it back.
    await withTenantTransaction(orgId, async (tx) => {
      const fu = await tx.pipelineStage.findFirstOrThrow({ where: { slug: "follow_up_1" } });
      await tx.lead.update({ where: { id: leadId }, data: { status: "follow_up_1", pipelineStageId: fu.id } });
      await syncLeadForQuoteStatus(tx, { organizationId: orgId, quoteId, previousStatus: "draft", nextStatus: "sent" });
    });
    lead = await read();
    expect(lead.status).toBe("follow_up_1");

    await withTenantTransaction(orgId, (tx) =>
      syncLeadForQuoteStatus(tx, { organizationId: orgId, quoteId, previousStatus: "sent", nextStatus: "approved" }),
    );
    lead = await read();
    expect(lead.status).toBe("won");
    expect(lead.pipelineStage?.slug).toBe("won");
  });

  it("links a lead from send hint and moves it to Quote Sent even if quote.leadId was null", async () => {
    const { moveLeadForQuoteEvent } = await import("../src/lib/pipeline/move.js");
    const seeded = await withTenantTransaction(orgId, async (tx) => {
      const stageNew = await tx.pipelineStage.findFirstOrThrow({ where: { slug: "new" } });
      const lead = await tx.lead.create({
        data: {
          organizationId: orgId,
          name: "Hint Lead",
          status: "new",
          pipelineStageId: stageNew.id,
        },
      });
      const quote = await tx.quote.create({
        data: {
          organizationId: orgId,
          number: 99,
          title: "Unlinked",
          status: "draft",
          leadId: null,
          total: 500,
        },
      });
      return { lead, quote };
    });

    const move = await withTenantTransaction(orgId, (tx) =>
      moveLeadForQuoteEvent(tx, {
        organizationId: orgId,
        quoteId: seeded.quote.id,
        slug: "quote_sent",
        leadIdHint: seeded.lead.id,
      }),
    );
    expect(move.moved).toBe(true);
    expect(move.leadId).toBe(seeded.lead.id);

    await withTenantTransaction(orgId, async (tx) => {
      const q = await tx.quote.findFirstOrThrow({ where: { id: seeded.quote.id } });
      expect(q.leadId).toBe(seeded.lead.id);
      const lead = await tx.lead.findFirstOrThrow({
        where: { id: seeded.lead.id },
        include: { pipelineStage: true },
      });
      expect(lead.status).toBe("quote_sent");
      expect(lead.pipelineStage?.slug).toBe("quote_sent");
    });
  });

  it("heals stale lead.status when pipeline stage is already Quote Sent", async () => {
    const { moveLeadToSystemStage } = await import("../src/lib/pipeline/move.js");
    const seeded = await withTenantTransaction(orgId, async (tx) => {
      const qs = await tx.pipelineStage.findFirstOrThrow({ where: { slug: "quote_sent" } });
      const lead = await tx.lead.create({
        data: {
          organizationId: orgId,
          name: "Desynced Lead",
          status: "new",
          pipelineStageId: qs.id,
        },
      });
      return { lead, qs };
    });

    const result = await withTenantTransaction(orgId, (tx) =>
      moveLeadToSystemStage(tx, {
        organizationId: orgId,
        leadId: seeded.lead.id,
        slug: "quote_sent",
      }),
    );
    expect(result.moved).toBe(true);
    expect(result.reason).toBe("status_healed");

    const lead = await withTenantTransaction(orgId, (tx) =>
      tx.lead.findFirstOrThrow({ where: { id: seeded.lead.id } }),
    );
    expect(lead.status).toBe("quote_sent");
    expect(lead.pipelineStageId).toBe(seeded.qs.id);
  });

  it("creates missing canonical stages so quote_sent / follow_up / meeting resolve", async () => {
    const { ensureStageForSlug } = await import("../src/lib/leads/stage.js");
    // Wipe stages to simulate a broken/legacy tenant.
    await withTenantTransaction(orgId, async (tx) => {
      await tx.lead.deleteMany({});
      await tx.pipelineStage.deleteMany({});
    });

    const quoteSent = await withTenantTransaction(orgId, (tx) => ensureStageForSlug(tx, "quote_sent"));
    const followUp = await withTenantTransaction(orgId, (tx) => ensureStageForSlug(tx, "follow_up_1"));
    const meeting = await withTenantTransaction(orgId, (tx) => ensureStageForSlug(tx, "meeting_scheduled"));

    expect(quoteSent?.slug).toBe("quote_sent");
    expect(followUp?.slug).toBe("follow_up_1");
    expect(meeting?.slug).toBe("assessment_scheduled");

    // Idempotent
    const again = await withTenantTransaction(orgId, (tx) => ensureStageForSlug(tx, "quote_sent"));
    expect(again?.id).toBe(quoteSent?.id);
  });
});
