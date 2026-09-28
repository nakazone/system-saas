import { describe, it, expect } from "vitest";
import {
  applyChecklistToggle,
  buildRecap,
  normalizeAnnotations,
  parseCampoChecklist,
  proposeChecklistFromSpeech,
  templateToChecklist,
} from "../src/lib/job-media/checklist.js";

describe("campo checklist + annotations", () => {
  it("parses extended checklist fields and defaults photo ids", () => {
    const items = parseCampoChecklist([
      { id: "a", text: "Check subfloor", done: false, photo_required: true },
    ]);
    expect(items[0].photo_required).toBe(true);
    expect(items[0].photo_media_ids).toEqual([]);
  });

  it("blocks completing photo-required items without media", () => {
    const base = parseCampoChecklist([
      { id: "a", text: "Photo subfloor", done: false, photo_required: true },
    ]);
    const blocked = applyChecklistToggle(base, "a", true, "Alex");
    expect(blocked.ok).toBe(false);

    const withPhoto = applyChecklistToggle(base, "a", false, "Alex", "media-1");
    expect(withPhoto.ok).toBe(true);
    const done = applyChecklistToggle(withPhoto.items, "a", true, "Alex");
    expect(done.ok).toBe(true);
    expect(done.items[0].done).toBe(true);
    expect(done.items[0].done_by).toBe("Alex");
    expect(done.items[0].photo_media_ids).toContain("media-1");
  });

  it("loads field templates", () => {
    const items = templateToChecklist("final_walkthrough");
    expect(items?.length).toBeGreaterThan(0);
    expect(items?.some((i) => i.photo_required)).toBe(true);
    expect(templateToChecklist("missing")).toBeNull();
  });

  it("builds recap risks from missing photos", () => {
    const recap = buildRecap({
      checklist: [
        { id: "1", text: "After photos", done: false, photo_required: true, photo_media_ids: [] },
      ],
      photoCount: 0,
      photosByStage: {},
      lastPhotoAt: null,
    });
    expect(recap.pending).toContain("After photos");
    expect(recap.risks.some((r) => /No job photos/i.test(r))).toBe(true);
  });

  it("normalizes annotation shapes", () => {
    const doc = normalizeAnnotations({
      shapes: [{ type: "circle", color: "#f00", width: 2, cx: 0.5, cy: 0.5, r: 0.1 }],
    });
    expect(doc.version).toBe(1);
    expect(doc.shapes[0].id).toBeTruthy();
    expect(doc.updated_at).toBeTruthy();
  });

  it("proposes checklist heuristically without AI", async () => {
    const result = await proposeChecklistFromSpeech(
      "check moisture, verify baseboards, take after photo",
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.items.length).toBeGreaterThanOrEqual(2);
      expect(result.items.some((i) => i.photo_required)).toBe(true);
    }
  });
});
