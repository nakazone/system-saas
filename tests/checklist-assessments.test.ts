import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Prisma, PrismaClient } from "@prisma/client";
import { createOrganizationWithAdmin } from "../src/modules/organizations/service.js";
import { withTenantTransaction } from "../src/lib/tenant/prisma-tenant.js";
import { DEFAULT_PERMISSIONS } from "../src/lib/tenant/defaults.js";
import {
  extractMeasurementRooms,
  isAssessmentOverdue,
  seedDefaultChecklistTemplates,
  snapshotFields,
} from "../src/lib/checklists/engine.js";
import { DEFAULT_CHECKLIST_TEMPLATES } from "../src/lib/checklists/defaults.js";

const prisma = new PrismaClient();

describe("checklist helpers", () => {
  it("extracts rooms from answers.rooms", () => {
    expect(
      extractMeasurementRooms({
        rooms: [
          { name: "Kitchen", areaSqft: 120 },
          { name: "Hall", area: 40 },
          { name: "", areaSqft: 10 },
        ],
      }),
    ).toEqual([
      { name: "Kitchen", areaSqft: 120 },
      { name: "Hall", areaSqft: 40 },
    ]);
  });

  it("finds room arrays under custom field ids", () => {
    expect(
      extractMeasurementRooms({
        measured_areas: [{ name: "Living", areaSqft: 200 }],
      }),
    ).toEqual([{ name: "Living", areaSqft: 200 }]);
  });

  it("marks scheduled assessments overdue after end/start", () => {
    const now = new Date("2026-09-23T12:00:00Z");
    expect(
      isAssessmentOverdue(
        {
          status: "scheduled",
          scheduledStart: new Date("2026-09-22T10:00:00Z"),
          scheduledEnd: new Date("2026-09-22T11:00:00Z"),
        },
        now,
      ),
    ).toBe(true);
    expect(
      isAssessmentOverdue(
        {
          status: "completed",
          scheduledStart: new Date("2026-09-22T10:00:00Z"),
          scheduledEnd: null,
        },
        now,
      ),
    ).toBe(false);
  });
});

describe("checklist snapshot + assessment isolation", () => {
  let orgAId: string;
  let orgBId: string;
  let assessmentAId: string;
  let responseAId: string;
  let templateAId: string;

  beforeAll(async () => {
    for (const permission of DEFAULT_PERMISSIONS) {
      await prisma.permission.upsert({
        where: { key: permission.key },
        create: {
          key: permission.key,
          group: permission.group,
          description: permission.description,
        },
        update: {},
      });
    }

    const suffix = Date.now().toString(36);
    const orgA = await createOrganizationWithAdmin({
      organizationName: `Assess A ${suffix}`,
      slug: `assess-a-${suffix}`,
      adminName: "Admin A",
      adminEmail: `assess-a-${suffix}@example.com`,
      password: "password12345",
    });
    const orgB = await createOrganizationWithAdmin({
      organizationName: `Assess B ${suffix}`,
      slug: `assess-b-${suffix}`,
      adminName: "Admin B",
      adminEmail: `assess-b-${suffix}@example.com`,
      password: "password12345",
    });
    orgAId = orgA.organization.id;
    orgBId = orgB.organization.id;

    const seeded = await withTenantTransaction(orgAId, async (tx) => {
      await seedDefaultChecklistTemplates(tx, orgAId);
      const template = await tx.checklistTemplate.findFirstOrThrow({
        where: { appliesTo: "site_assessment" },
      });
      const lead = await tx.lead.create({
        data: { organizationId: orgAId, name: "Measure Me", status: "new" },
      });
      const assessment = await tx.siteAssessment.create({
        data: {
          organizationId: orgAId,
          leadId: lead.id,
          status: "scheduled",
          scheduledStart: new Date("2026-01-01T15:00:00Z"),
        },
      });
      const response = await tx.checklistResponse.create({
        data: {
          organizationId: orgAId,
          templateId: template.id,
          templateSnapshot: {
            name: template.name,
            appliesTo: template.appliesTo,
            fields: snapshotFields(template.fields),
          } as Prisma.InputJsonValue,
          entityType: "site_assessment",
          entityId: assessment.id,
          answers: { rooms: [{ name: "Kitchen", areaSqft: 100 }] },
        },
      });
      await tx.siteAssessment.update({
        where: { id: assessment.id },
        data: { checklistResponseId: response.id },
      });
      return { assessmentId: assessment.id, responseId: response.id, templateId: template.id };
    });

    assessmentAId = seeded.assessmentId;
    responseAId = seeded.responseId;
    templateAId = seeded.templateId;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("keeps response snapshot when template fields change", async () => {
    await withTenantTransaction(orgAId, async (tx) => {
      const before = await tx.checklistResponse.findFirstOrThrow({
        where: { id: responseAId },
      });
      const snapshotBefore = before.templateSnapshot as { fields: { id: string }[] };
      expect(snapshotBefore.fields.some((f) => f.id === "rooms")).toBe(true);

      await tx.checklistTemplate.update({
        where: { id: templateAId },
        data: {
          fields: [{ id: "only_notes", label: "Notes", type: "text" }] as Prisma.InputJsonValue,
        },
      });

      const after = await tx.checklistResponse.findFirstOrThrow({
        where: { id: responseAId },
      });
      const snapshotAfter = after.templateSnapshot as { fields: { id: string }[] };
      expect(snapshotAfter.fields.map((f) => f.id)).toEqual(snapshotBefore.fields.map((f) => f.id));
      expect(snapshotAfter.fields.some((f) => f.id === "only_notes")).toBe(false);

      const template = await tx.checklistTemplate.findFirstOrThrow({ where: { id: templateAId } });
      expect((template.fields as { id: string }[])[0]?.id).toBe("only_notes");
    });
  });

  it("hides assessments from other tenants", async () => {
    const visibleInA = await withTenantTransaction(orgAId, async (tx) => {
      return tx.siteAssessment.findMany({ where: { id: assessmentAId } });
    });
    expect(visibleInA).toHaveLength(1);

    const visibleInB = await withTenantTransaction(orgBId, async (tx) => {
      return tx.siteAssessment.findMany({ where: { id: assessmentAId } });
    });
    expect(visibleInB).toHaveLength(0);

    await expect(
      withTenantTransaction(orgBId, async (tx) => {
        return tx.siteAssessment.update({
          where: { id: assessmentAId },
          data: { status: "canceled" },
        });
      }),
    ).rejects.toThrow();
  });
  it("seeds default templates once per org", async () => {
    await withTenantTransaction(orgBId, async (tx) => {
      await seedDefaultChecklistTemplates(tx, orgBId);
      await seedDefaultChecklistTemplates(tx, orgBId);
      const count = await tx.checklistTemplate.count();
      expect(count).toBe(DEFAULT_CHECKLIST_TEMPLATES.length);
    });
  });
});
