import { describe, it, expect } from "vitest";
import {
  isJobMediaEnabled,
  mapJobMedia,
  parsePhotoUploadMeta,
  sha256Buffer,
  JOB_MEDIA_STAGES,
} from "../src/lib/job-media/index.js";
import { isFieldMeasureEnabled } from "../src/lib/job-media/ocr.js";

describe("job-media helpers", () => {
  it("computes stable sha256 for buffer", () => {
    const a = sha256Buffer(Buffer.from("hello"));
    const b = sha256Buffer(Buffer.from("hello"));
    expect(a).toBe(b);
    expect(a).toMatch(/^[a-f0-9]{64}$/);
    expect(sha256Buffer(Buffer.from("other"))).not.toBe(a);
  });

  it("enables job media by default and respects feature flags", () => {
    expect(isJobMediaEnabled(null)).toBe(true);
    expect(isJobMediaEnabled({})).toBe(true);
    expect(isJobMediaEnabled({ job_media: true })).toBe(true);
    expect(isJobMediaEnabled({ job_media: false })).toBe(false);
    expect(isJobMediaEnabled({ jobMedia: false })).toBe(false);
  });

  it("enables field measure by default and respects job_measure flag", () => {
    expect(isFieldMeasureEnabled(null)).toBe(true);
    expect(isFieldMeasureEnabled({})).toBe(true);
    expect(isFieldMeasureEnabled({ job_measure: true })).toBe(true);
    expect(isFieldMeasureEnabled({ job_measure: false })).toBe(false);
    expect(isFieldMeasureEnabled({ jobMeasure: false })).toBe(false);
  });

  it("parses upload meta (stage, GPS, caption, client id)", () => {
    const meta = parsePhotoUploadMeta({
      stage: "before",
      caption: "  west wall  ",
      taken_at_device: "2026-09-28T15:00:00.000Z",
      lat: "39.7392",
      lng: "-104.9903",
      gps_accuracy_m: "12.5",
      client_upload_id: "u-abc",
      device_label: "iOS Safari",
      is_public: true,
    });
    expect(JOB_MEDIA_STAGES).toContain("before");
    expect(meta.stage).toBe("before");
    expect(meta.caption).toBe("west wall");
    expect(meta.takenAtDevice?.toISOString()).toBe("2026-09-28T15:00:00.000Z");
    expect(meta.lat).toBeCloseTo(39.7392);
    expect(meta.lng).toBeCloseTo(-104.9903);
    expect(meta.gpsAccuracyM).toBeCloseTo(12.5);
    expect(meta.clientUploadId).toBe("u-abc");
    expect(meta.deviceLabel).toBe("iOS Safari");
    expect(meta.isPublic).toBe(true);
  });

  it("rejects unknown stage and invalid GPS", () => {
    const meta = parsePhotoUploadMeta({
      stage: "maybe",
      lat: "not-a-number",
      lng: "",
    });
    expect(meta.stage).toBeNull();
    expect(meta.lat).toBeNull();
    expect(meta.lng).toBeNull();
    expect(meta.isPublic).toBe(false);
  });

  it("maps JobMedia row to API shape", () => {
    const mapped = mapJobMedia({
      id: "11111111-1111-1111-1111-111111111111",
      type: "photo",
      url: "https://cdn.example/p.jpg",
      thumbUrl: null,
      sha256: "abc",
      takenAtDevice: new Date("2026-09-28T12:00:00.000Z"),
      receivedAtServer: new Date("2026-09-28T12:01:00.000Z"),
      lat: 40.0,
      lng: -75.0,
      gpsAccuracyM: 8,
      address: "123 Main St",
      caption: "After install",
      stage: "after",
      annotationsJson: null,
      isPublic: true,
      inPortfolio: true,
      ocrJson: { serial_number: "SN-1" },
      clientUploadId: "c1",
      deviceLabel: "Android",
      authorId: "u1",
      author: { name: "Alex Rivera" },
      createdAt: new Date("2026-09-28T12:01:00.000Z"),
      deletedAt: null,
    });
    expect(mapped.stage).toBe("after");
    expect(mapped.is_public).toBe(true);
    expect(mapped.in_portfolio).toBe(true);
    expect(mapped.ocr).toEqual({ serial_number: "SN-1" });
    expect(mapped.location_available).toBe(true);
    expect(mapped.author_name).toBe("Alex");
    expect(mapped.thumb_url).toBe("https://cdn.example/p.jpg");
  });
});
