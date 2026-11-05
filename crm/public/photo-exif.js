/**
 * Reads what a JPEG knows about itself (EXIF) before the upload compresses it away:
 * when it was taken, where (GPS) and with which camera.
 *
 * window.PhotoExif.read(file)            -> Promise<{ takenAt, lat, lng, accuracy, camera } | null>
 * window.PhotoExif.uploadMeta(file, opt) -> Promise<{ taken_at_device, taken_at_source, lat, lng,
 *                                           gps_accuracy_m, location_source, camera_model }>
 *   opt.live: the photo was just taken with the camera button (device GPS may stand in)
 *   opt.deviceGps: () => Promise<{ lat, lng, acc } | null>, asked only when the photo has no GPS of its own
 *
 * Canvas compression drops EXIF, so this must run on the original File.
 */
(function () {
  const HEAD_BYTES = 256 * 1024;

  function readAscii(view, start, count) {
    let s = "";
    for (let i = 0; i < count; i += 1) {
      const c = view.getUint8(start + i);
      if (c === 0) break;
      s += String.fromCharCode(c);
    }
    return s.trim();
  }

  function parseTiff(view, tiff) {
    const order = view.getUint16(tiff);
    const le = order === 0x4949;
    if (!le && order !== 0x4d4d) return null;
    const u16 = (o) => view.getUint16(o, le);
    const u32 = (o) => view.getUint32(o, le);
    const SIZES = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };

    function ifd(offset) {
      const out = {};
      const at = tiff + offset;
      if (at + 2 > view.byteLength) return out;
      const n = u16(at);
      for (let i = 0; i < n; i += 1) {
        const e = at + 2 + i * 12;
        if (e + 12 > view.byteLength) break;
        const tag = u16(e);
        const type = u16(e + 2);
        const count = u32(e + 4);
        const size = (SIZES[type] || 1) * count;
        const valAt = size <= 4 ? e + 8 : tiff + u32(e + 8);
        if (valAt + size > view.byteLength) continue;
        if (type === 2) out[tag] = readAscii(view, valAt, count);
        else if (type === 3) out[tag] = u16(valAt);
        else if (type === 4) out[tag] = u32(valAt);
        else if (type === 5 || type === 10) {
          const vals = [];
          for (let k = 0; k < count; k += 1) {
            const num = type === 10 ? view.getInt32(valAt + k * 8, le) : u32(valAt + k * 8);
            const den = type === 10 ? view.getInt32(valAt + k * 8 + 4, le) : u32(valAt + k * 8 + 4);
            vals.push(den ? num / den : 0);
          }
          out[tag] = count === 1 ? vals[0] : vals;
        }
      }
      return out;
    }

    const ifd0 = ifd(u32(tiff + 4));
    const exif = ifd0[0x8769] ? ifd(ifd0[0x8769]) : {};
    const gps = ifd0[0x8825] ? ifd(ifd0[0x8825]) : {};
    return { ifd0, exif, gps };
  }

  /** "2026:10:30 14:05:09" (+ optional "-07:00") -> ISO string, or null. */
  function exifDate(raw, offset) {
    const m = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(String(raw || ""));
    if (!m || m[1] === "0000") return null;
    const local = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`;
    // Without an offset the camera clock is local time; the browser's zone is the best guess.
    const d = /^[+-]\d{2}:\d{2}$/.test(String(offset || "")) ? new Date(local + offset) : new Date(local);
    if (Number.isNaN(d.getTime())) return null;
    if (d.getTime() > Date.now() + 36 * 3600e3 || d.getFullYear() < 2000) return null;
    return d.toISOString();
  }

  function dms(v, ref) {
    if (!Array.isArray(v) || v.length < 3) return null;
    const deg = v[0] + v[1] / 60 + v[2] / 3600;
    if (!Number.isFinite(deg) || deg === 0) return null;
    return /[SW]/i.test(String(ref || "")) ? -deg : deg;
  }

  async function read(file) {
    try {
      if (!file || !/jpe?g/i.test(file.type || file.name || "")) return null;
      const buf = await file.slice(0, HEAD_BYTES).arrayBuffer();
      const view = new DataView(buf);
      if (view.byteLength < 4 || view.getUint16(0) !== 0xffd8) return null;
      let o = 2;
      while (o + 4 < view.byteLength) {
        if (view.getUint8(o) !== 0xff) return null;
        const marker = view.getUint8(o + 1);
        const len = view.getUint16(o + 2);
        if (marker === 0xe1 && readAscii(view, o + 4, 4) === "Exif") {
          const t = parseTiff(view, o + 10);
          if (!t) return null;
          const lat = dms(t.gps[2], t.gps[1]);
          const lng = dms(t.gps[4], t.gps[3]);
          const make = t.ifd0[0x010f] || "";
          const model = t.ifd0[0x0110] || "";
          const camera = model.toLowerCase().startsWith(make.toLowerCase()) ? model : [make, model].filter(Boolean).join(" ");
          return {
            takenAt: exifDate(t.exif[0x9003] || t.ifd0[0x0132], t.exif[0x9011]),
            lat: lat != null && lng != null ? lat : null,
            lng: lat != null && lng != null ? lng : null,
            accuracy: typeof t.gps[31] === "number" ? t.gps[31] : null,
            camera: camera.trim() || null,
          };
        }
        if (marker === 0xda) return null;
        o += 2 + len;
      }
      return null;
    } catch (_) {
      return null;
    }
  }

  async function uploadMeta(file, opt) {
    const o = opt || {};
    const exif = await read(file);
    const now = Date.now();
    const lastMod = file && file.lastModified ? Number(file.lastModified) : 0;
    const fresh = lastMod && now - lastMod < 10 * 60e3;
    let takenAt = exif && exif.takenAt;
    let takenSource = takenAt ? "exif" : null;
    if (!takenAt && lastMod && !o.live && now - lastMod > 2 * 60e3) {
      takenAt = new Date(lastMod).toISOString();
      takenSource = "file";
    }
    if (!takenAt) {
      takenAt = new Date(now).toISOString();
      takenSource = "upload";
    }
    let lat = exif && exif.lat;
    let lng = exif && exif.lng;
    let acc = exif && exif.accuracy;
    let locSource = lat != null ? "exif" : null;
    // Where the phone is now only says where the photo was taken if it was just taken.
    if (lat == null && (o.live || fresh) && typeof o.deviceGps === "function") {
      const pos = await o.deviceGps();
      if (pos && pos.lat != null) {
        lat = pos.lat;
        lng = pos.lng;
        acc = pos.acc != null ? pos.acc : pos.gpsAccuracyM != null ? pos.gpsAccuracyM : pos.accuracy;
        locSource = "device";
      }
    }
    return {
      taken_at_device: takenAt,
      taken_at_source: takenSource,
      lat: lat != null ? lat : null,
      lng: lng != null ? lng : null,
      gps_accuracy_m: acc != null ? acc : null,
      location_source: locSource,
      camera_model: (exif && exif.camera) || null,
    };
  }

  window.PhotoExif = { read, uploadMeta };
})();
