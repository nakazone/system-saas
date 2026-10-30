/**
 * Zoomed strips of a tall work-order image (phone screenshots of a dealer's system).
 *
 * Vision models shrink each image to fit about 768 px on its short side, so the small print of a
 * work order shown on a phone screenshot (1320 × 2868) ends up 4–5 px tall and quantities like
 * 8 / 9 are misread. Cutting the image into overlapping strips, each enlarged to ~1900 px wide,
 * keeps every line of the table at full size. The strips go to the model after the whole image.
 */
type Sharp = typeof import("sharp");

let sharpLib: Sharp | null | undefined;
async function loadSharp(): Promise<Sharp | null> {
  if (sharpLib !== undefined) return sharpLib;
  try {
    const mod = await import("sharp");
    sharpLib = ((mod as unknown as { default?: Sharp }).default || (mod as unknown as Sharp));
  } catch (error) {
    console.warn("[work-order] sharp unavailable, reading without zoomed strips:", error instanceof Error ? error.message : error);
    sharpLib = null;
  }
  return sharpLib;
}

const OUT_W = 1900;     // strip width sent to the model
const OUT_H = 740;      // strip height (stays under the 768 px short side: no downscale)
const OVERLAP = 110;    // px of the strip repeated in the next one (a table row is never cut in half)
const MAX_STRIPS = 10;

/** The page area of a screenshot: rows/columns that are not the app's flat background. */
async function contentBox(sharp: Sharp, buf: Buffer, w: number, h: number): Promise<{ left: number; top: number; width: number; height: number }> {
  try {
    const scale = Math.min(1, 400 / w);
    const sw = Math.max(1, Math.round(w * scale)); const sh = Math.max(1, Math.round(h * scale));
    const { data } = await sharp(buf).resize(sw, sh, { fit: "fill" }).greyscale().raw().toBuffer({ resolveWithObject: true });
    // a row/column with text has dark pixels; the document is where dark pixels are
    const rowInk = new Array(sh).fill(0); const colInk = new Array(sw).fill(0);
    for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) if (data[y * sw + x]! < 140) { rowInk[y]++; colInk[x]++; }
    const firstLast = (arr: number[], min: number) => {
      let a = 0; while (a < arr.length && arr[a]! < min) a++;
      let b = arr.length - 1; while (b > a && arr[b]! < min) b--;
      return [a, b] as const;
    };
    const [y0, y1] = firstLast(rowInk, 1);
    const [x0, x1] = firstLast(colInk, 1);
    const pad = 12;
    const left = Math.max(0, Math.floor(x0 / scale) - pad); const top = Math.max(0, Math.floor(y0 / scale) - pad);
    const right = Math.min(w, Math.ceil((x1 + 1) / scale) + pad); const bottom = Math.min(h, Math.ceil((y1 + 1) / scale) + pad);
    if (right - left < w * 0.4 || bottom - top < h * 0.3) return { left: 0, top: 0, width: w, height: h };
    return { left, top, width: right - left, height: bottom - top };
  } catch {
    return { left: 0, top: 0, width: w, height: h };
  }
}

/** Overlapping, enlarged strips of one image (top to bottom), as JPEG data URLs. [] when not needed. */
export async function zoomStrips(dataUrl: string): Promise<string[]> {
  const m = /^data:image\/[a-z+.-]+;base64,(.+)$/i.exec(dataUrl);
  if (!m) return [];
  const sharp = await loadSharp();
  if (!sharp) return [];
  try {
    const buf = Buffer.from(m[1]!, "base64");
    const meta = await sharp(buf).rotate().metadata();
    const w = meta.autoOrient?.width || meta.width || 0; const h = meta.autoOrient?.height || meta.height || 0;
    if (!w || !h) return [];
    const upright = await sharp(buf).rotate().toBuffer();
    const box = await contentBox(sharp, upright, w, h);
    const scale = Math.min(2.2, OUT_W / box.width);
    // already big enough for the model as one picture: nothing to zoom
    if (box.height * scale <= OUT_H * 1.15 && scale <= 1.05) return [];
    let stripH = Math.round(OUT_H / scale); let step = Math.round((OUT_H - OVERLAP) / scale);
    let count = Math.max(1, Math.ceil((box.height - stripH) / step) + 1);
    if (count > MAX_STRIPS) {
      // very long page: taller strips (the model shrinks them a little) instead of too many
      step = Math.ceil((box.height - stripH) / (MAX_STRIPS - 1));
      stripH = Math.min(box.height, step + Math.round(OVERLAP / scale));
      count = MAX_STRIPS;
    }
    const out: string[] = [];
    for (let i = 0; i < count; i++) {
      const top = Math.min(box.top + i * step, box.top + Math.max(0, box.height - stripH));
      const height = Math.min(stripH, box.top + box.height - top);
      if (height < 20) break;
      const jpg = await sharp(upright)
        .extract({ left: box.left, top, width: box.width, height })
        .resize(Math.round(box.width * scale), Math.round(height * scale), { kernel: "lanczos3" })
        .sharpen()
        .jpeg({ quality: 86 })
        .toBuffer();
      out.push(`data:image/jpeg;base64,${jpg.toString("base64")}`);
    }
    return out;
  } catch (error) {
    console.warn("[work-order] could not cut zoomed strips:", error instanceof Error ? error.message : error);
    return [];
  }
}
