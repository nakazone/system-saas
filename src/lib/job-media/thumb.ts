import { storage } from "../storage/index.js";

/**
 * Grid tiles are ~125–140 CSS px; 480 px covers a 3x phone screen. The original keeps its EXIF
 * (it is the evidence); the thumbnail is only for lists, so it is rotated upright and stripped.
 */
export const PHOTO_THUMB_WIDTH = 480;
const THUMB_QUALITY = 72;

export async function makePhotoThumb(body: Buffer): Promise<Buffer | null> {
  try {
    const sharp = (await import("sharp")).default;
    return await sharp(body, { failOn: "none" })
      .rotate()
      .resize({ width: PHOTO_THUMB_WIDTH, height: PHOTO_THUMB_WIDTH, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: THUMB_QUALITY, mozjpeg: true })
      .toBuffer();
  } catch {
    return null;
  }
}

/**
 * Stores a small JPEG next to the original (`<key>-thumb.jpg`) and returns its URL.
 * Falls back to the original URL when the image cannot be decoded or the upload fails,
 * so a photo is never lost because of its thumbnail.
 */
export async function uploadPhotoThumb(originalKey: string, body: Buffer, fallbackUrl: string): Promise<string> {
  const thumb = await makePhotoThumb(body);
  if (!thumb || thumb.length >= body.length) return fallbackUrl;
  try {
    const stored = await storage.upload({ key: `${originalKey}-thumb.jpg`, body: thumb, contentType: "image/jpeg" });
    return stored.url;
  } catch {
    return fallbackUrl;
  }
}
