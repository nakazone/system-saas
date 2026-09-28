import { describe, it, expect } from "vitest";
import {
  buildReportUserPrompt,
  isJobReportAiEnabled,
  mapJobReport,
  parseReportPatch,
} from "../src/lib/job-media/report.js";
import { estimateCostUsd, isAiConfigured } from "../src/lib/ai/client.js";

describe("job report helpers", () => {
  it("builds a structured prompt with photo context", () => {
    const prompt = buildReportUserPrompt({
      jobTitle: "Oak floor install",
      jobNumber: 42,
      client: "Acme Homes",
      address: "123 Main St",
      templateKey: "site_visit",
      photos: [
        {
          id: "p1",
          url: "https://cdn.example/a.jpg",
          caption: "Subfloor ready",
          stage: "before",
          author_name: "Alex",
        },
      ],
    });
    expect(prompt).toContain("Oak floor install");
    expect(prompt).toContain("id=p1");
    expect(prompt).toContain("stage=before");
    expect(prompt).toContain("Subfloor ready");
  });

  it("maps JobReport rows and patches", () => {
    const mapped = mapJobReport({
      id: "r1",
      workOrderId: "w1",
      authorId: "u1",
      templateKey: "progress",
      title: "Progress update",
      status: "draft",
      summary: "Work looks good",
      observationsJson: [{ text: "Floor laid", photo_ids: ["p1"] }],
      issuesJson: [],
      recommendationsJson: ["Seal edges"],
      nextStepsJson: ["Final walkthrough"],
      photoIds: ["p1", "p2"],
      isPublic: false,
      source: "ai",
      modelUsed: "gpt-4o-mini",
      tokensIn: 100,
      tokensOut: 50,
      costUsd: 0.0001,
      publishedAt: null,
      createdAt: new Date("2026-09-28T12:00:00.000Z"),
      updatedAt: new Date("2026-09-28T12:00:00.000Z"),
      author: { name: "Alex Rivera" },
    });
    expect(mapped.observations[0].photo_ids).toEqual(["p1"]);
    expect(mapped.recommendations).toEqual(["Seal edges"]);
    expect(mapped.author_name).toBe("Alex");

    const patch = parseReportPatch({
      title: "Updated",
      status: "published",
      is_public: true,
      recommendations: ["A", "B"],
    });
    expect(patch.title).toBe("Updated");
    expect(patch.status).toBe("published");
    expect(patch.isPublic).toBe(true);
    expect(patch.recommendations).toEqual(["A", "B"]);
  });

  it("gates AI reports on config + feature flags", () => {
    // Without API key, AI is off regardless of flags
    expect(isJobReportAiEnabled({})).toBe(isAiConfigured());
    if (isAiConfigured()) {
      expect(isJobReportAiEnabled({ job_media_ai: false })).toBe(false);
    }
  });

  it("estimates token cost for logging", () => {
    expect(estimateCostUsd(null, null)).toBeNull();
    expect(estimateCostUsd(1_000_000, 1_000_000)).toBeCloseTo(0.75);
  });
});
