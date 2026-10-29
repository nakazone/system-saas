import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.S3_PUBLIC_URL = "https://files.example.test";
});

import { storage } from "../src/lib/storage/index.js";
import {
  readStoredObject,
  resolveImagesForAi,
  sniffImageType,
  storageKeyFromAnyUrl,
  storageKeyFromOwnUrl,
} from "../src/lib/storage/resolve.js";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

describe("storage key from URL", () => {
  it("reads keys from this app's own URLs", () => {
    expect(storageKeyFromOwnUrl("https://files.example.test/orgs/a/jobs/b/1-x.jpg")).toBe("orgs/a/jobs/b/1-x.jpg");
    expect(storageKeyFromOwnUrl("/api/local-files/orgs/a/jobs/b/1%20x.jpg")).toBe("orgs/a/jobs/b/1 x.jpg");
    expect(storageKeyFromOwnUrl("https://obramate.com/api/local-files/builders/acc/m1/p.png")).toBe("builders/acc/m1/p.png");
  });

  it("ignores foreign URLs, data URLs and path tricks", () => {
    expect(storageKeyFromOwnUrl("https://evil.test/orgs/a/x.jpg")).toBeNull();
    expect(storageKeyFromOwnUrl("data:image/png;base64,AAAA")).toBeNull();
    expect(storageKeyFromOwnUrl("/api/local-files/orgs/../users/x")).toBeNull();
  });

  it("the loose variant also finds keys under an older bucket address", () => {
    expect(storageKeyFromAnyUrl("https://pub-123.r2.dev/builders/acc/m1/logo.png")).toBe("builders/acc/m1/logo.png");
    expect(storageKeyFromAnyUrl("https://pub-123.r2.dev/virtual-office/o/agent.png")).toBe("virtual-office/o/agent.png");
    expect(storageKeyFromAnyUrl("https://cdn.test/assets/logo.png")).toBeNull();
  });
});

describe("images for AI", () => {
  it("sends stored images as data URLs and respects the tenant folder", async () => {
    const mine = await storage.upload({ key: "orgs/org-a/jobs/j1/test-photo.png", body: PNG, contentType: "image/png" });
    const other = await storage.upload({ key: "orgs/org-b/jobs/j9/test-photo.png", body: PNG, contentType: "image/png" });

    const out = await resolveImagesForAi([mine.url, other.url, "data:image/jpeg;base64,/9j/", "https://example.test/a.jpg", "data:text/html;base64,PGI+"], {
      onlyKeyPrefix: "orgs/org-a/",
    });
    expect(out).toHaveLength(3);
    expect(out[0]).toBe(`data:image/png;base64,${PNG.toString("base64")}`);
    expect(out[1]).toBe("data:image/jpeg;base64,/9j/");
    expect(out[2]).toBe("https://example.test/a.jpg");

    expect(await readStoredObject("orgs/org-a/jobs/j1/test-photo.png")).toEqual(PNG);
    expect(await readStoredObject("orgs/org-a/jobs/j1/test-photo.png", 10)).toBeNull();

    await storage.delete(mine.key);
    await storage.delete(other.key);
  });

  it("sniffs image types", () => {
    expect(sniffImageType(PNG)).toBe("image/png");
    expect(sniffImageType(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(sniffImageType(Buffer.from("hello"))).toBeNull();
  });
});
