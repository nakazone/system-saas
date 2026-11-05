import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

type Meta = Record<string, unknown>;
type PhotoExif = {
  read(file: File): Promise<Meta | null>;
  uploadMeta(file: File, opt?: { live?: boolean; deviceGps?: () => Promise<Meta | null> }): Promise<Meta>;
};

/** A 1x1 JPEG with an EXIF block (big-endian TIFF): Make/Model, DateTimeOriginal + offset, GPS. */
function jpegWithExif(): Buffer {
  const ascii = (s: string) => Buffer.from(`${s}\0`, "ascii");
  const rat = (list: [number, number][]) => {
    const b = Buffer.alloc(8 * list.length);
    list.forEach(([n, d], i) => {
      b.writeUInt32BE(n, i * 8);
      b.writeUInt32BE(d, i * 8 + 4);
    });
    return b;
  };
  const ifd = (tags: [number, number, number, Buffer | number][], base: number) => {
    const head = Buffer.alloc(2 + tags.length * 12 + 4);
    head.writeUInt16BE(tags.length, 0);
    let extra = Buffer.alloc(0);
    tags.forEach(([tag, type, count, val], i) => {
      const o = 2 + i * 12;
      head.writeUInt16BE(tag, o);
      head.writeUInt16BE(type, o + 2);
      head.writeUInt32BE(count, o + 4);
      if (typeof val === "number") head.writeUInt32BE(val, o + 8);
      else if (val.length <= 4) val.copy(head, o + 8);
      else {
        head.writeUInt32BE(base + head.length + extra.length, o + 8);
        extra = Buffer.concat([extra, val]);
      }
    });
    return Buffer.concat([head, extra]);
  };
  const make = ascii("Apple");
  const model = ascii("iPhone 15 Pro");
  const dto = ascii("2026:10:28 09:15:30");
  const off = ascii("-07:00");
  const exifBase = 8 + (2 + 4 * 12 + 4) + make.length + model.length;
  const gpsBase = exifBase + (2 + 2 * 12 + 4) + dto.length + off.length;
  const tiff = Buffer.concat([
    Buffer.from([0x4d, 0x4d, 0, 0x2a, 0, 0, 0, 8]),
    ifd([[0x010f, 2, make.length, make], [0x0110, 2, model.length, model], [0x8769, 4, 1, exifBase], [0x8825, 4, 1, gpsBase]], 8),
    ifd([[0x9003, 2, dto.length, dto], [0x9011, 2, off.length, off]], exifBase),
    ifd([[1, 2, 2, Buffer.from("N\0\0\0")], [2, 5, 3, rat([[33, 1], [25, 1], [3180, 100]])], [3, 2, 2, Buffer.from("W\0\0\0")], [4, 5, 3, rat([[111, 1], [56, 1], [2400, 100]])]], gpsBase),
  ]);
  const body = Buffer.concat([Buffer.from("Exif\0\0", "binary"), tiff]);
  const app1 = Buffer.concat([Buffer.from([0xff, 0xe1, (body.length + 2) >> 8, (body.length + 2) & 255]), body]);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app1, Buffer.from([0xff, 0xda, 0, 2, 0xff, 0xd9])]);
}

let PE: PhotoExif;
beforeAll(() => {
  const ctx = { window: {} as { PhotoExif?: PhotoExif }, DataView, Date };
  vm.runInNewContext(fs.readFileSync(path.join(process.cwd(), "crm/public/photo-exif.js"), "utf8"), ctx);
  PE = ctx.window.PhotoExif!;
});

describe("photo-exif", () => {
  it("reads the time, GPS and camera a JPEG carries", async () => {
    const meta = await PE.read(new File([jpegWithExif()], "IMG_0420.jpg", { type: "image/jpeg" }));
    expect(meta).toMatchObject({ takenAt: "2026-10-28T16:15:30.000Z", camera: "Apple iPhone 15 Pro" });
    expect(meta!.lat as number).toBeCloseTo(33.4255, 4);
    expect(meta!.lng as number).toBeCloseTo(-111.94, 4);
  });

  it("prefers the photo's own data and does not ask the phone for GPS", async () => {
    let asked = false;
    const m = await PE.uploadMeta(new File([jpegWithExif()], "a.jpg", { type: "image/jpeg" }), {
      live: true,
      deviceGps: async () => ((asked = true), { lat: 1, lng: 1, acc: 9 }),
    });
    expect(m).toMatchObject({ taken_at_source: "exif", location_source: "exif", camera_model: "Apple iPhone 15 Pro" });
    expect(asked).toBe(false);
  });

  it("uses the phone's GPS only for a photo taken just now, and the file date for an old one", async () => {
    const plain = Buffer.from([0xff, 0xd8, 0xff, 0xda, 0, 2, 0xff, 0xd9]);
    const gps = async () => ({ lat: 10, lng: 20, acc: 5 });
    const live = await PE.uploadMeta(new File([plain], "b.jpg", { type: "image/jpeg", lastModified: Date.now() }), { live: true, deviceGps: gps });
    expect(live).toMatchObject({ lat: 10, lng: 20, location_source: "device", taken_at_source: "upload" });
    const weekOld = Date.now() - 7 * 86400e3;
    const old = await PE.uploadMeta(new File([plain], "c.jpg", { type: "image/jpeg", lastModified: weekOld }), { live: false, deviceGps: gps });
    expect(old).toMatchObject({ lat: null, location_source: null, taken_at_source: "file", taken_at_device: new Date(weekOld).toISOString() });
  });

  it("ignores files that are not JPEG", async () => {
    expect(await PE.read(new File([Buffer.from("not a jpeg")], "x.png", { type: "image/png" }))).toBeNull();
  });
});
