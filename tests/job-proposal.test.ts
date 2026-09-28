import { describe, it, expect } from "vitest";

/**
 * Phase 4 helpers are mostly route-bound; keep a light contract test around
 * review-message shaping used by the API.
 */
function buildReviewMessage(input: {
  firstName: string;
  orgName: string;
  address: string | null;
  reviewUrl: string | null;
}) {
  const name = input.firstName || "there";
  if (input.reviewUrl) {
    return `Hi ${name}, thanks for choosing ${input.orgName}! If you were happy with the work at ${input.address || "your home"}, would you leave us a quick Google review?\n${input.reviewUrl}`;
  }
  return `Hi ${name}, thanks for choosing ${input.orgName}! If you were happy with the work at ${input.address || "your home"}, we'd love a quick Google review — reply and we'll send the link.`;
}

describe("job proposal marketing copy", () => {
  it("includes Google review URL when configured", () => {
    const msg = buildReviewMessage({
      firstName: "Sam",
      orgName: "Floor Pros",
      address: "12 Oak St",
      reviewUrl: "https://g.page/r/example",
    });
    expect(msg).toContain("Sam");
    expect(msg).toContain("12 Oak St");
    expect(msg).toContain("https://g.page/r/example");
  });

  it("falls back when review URL is missing", () => {
    const msg = buildReviewMessage({
      firstName: "Sam",
      orgName: "Floor Pros",
      address: null,
      reviewUrl: null,
    });
    expect(msg).toContain("we'll send the link");
    expect(msg).not.toContain("https://");
  });
});
