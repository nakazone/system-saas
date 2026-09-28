import fs from "node:fs/promises";
import path from "node:path";
import {
  DeleteObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { env } from "../../config/env.js";
import type { ObjectStorage, StoredObject } from "./types.js";

export class S3CompatibleStorage implements ObjectStorage {
  private client: S3Client;
  private bucket: string;
  private publicUrl?: string;

  constructor() {
    this.bucket = env.S3_BUCKET;
    this.publicUrl = env.S3_PUBLIC_URL;
    this.client = new S3Client({
      region: env.S3_REGION,
      endpoint: env.S3_ENDPOINT,
      forcePathStyle: true,
      credentials:
        env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY
          ? {
              accessKeyId: env.S3_ACCESS_KEY_ID,
              secretAccessKey: env.S3_SECRET_ACCESS_KEY,
            }
          : undefined,
    });
  }

  async upload(params: {
    key: string;
    body: Buffer;
    contentType: string;
  }): Promise<StoredObject> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: params.key,
        Body: params.body,
        ContentType: params.contentType,
      }),
    );

    const url = this.publicUrl
      ? `${this.publicUrl.replace(/\/$/, "")}/${params.key}`
      : `${env.S3_ENDPOINT}/${this.bucket}/${params.key}`;

    return {
      key: params.key,
      url,
      contentType: params.contentType,
      size: params.body.length,
    };
  }

  async delete(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: key,
      }),
    );
  }
}

type LocalEntry = { body: Buffer; contentType: string };

/**
 * Local fallback when S3 is not configured.
 * Never embed multi‑MB data URLs in API/DB responses (breaks mobile uploads).
 * Serves bytes at /api/local-files/<key>.
 */
export class LocalFileStorage implements ObjectStorage {
  private memory = new Map<string, LocalEntry>();
  private root = path.resolve(process.cwd(), "data", "uploads");

  private safePath(key: string): string | null {
    const normalized = path.normalize(key).replace(/^(\.\.(\/|\\|$))+/, "");
    if (!normalized || normalized.includes("..")) return null;
    const full = path.resolve(this.root, normalized);
    if (!full.startsWith(this.root + path.sep) && full !== this.root) return null;
    return full;
  }

  private publicUrlFor(key: string): string {
    const base = env.APP_BASE_URL.replace(/\/$/, "");
    return `${base}/api/local-files/${key
      .split("/")
      .map((p) => encodeURIComponent(p))
      .join("/")}`;
  }

  async upload(params: {
    key: string;
    body: Buffer;
    contentType: string;
  }): Promise<StoredObject> {
    this.memory.set(params.key, {
      body: params.body,
      contentType: params.contentType,
    });
    const filePath = this.safePath(params.key);
    if (filePath) {
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, params.body);
      await fs.writeFile(`${filePath}.meta.json`, JSON.stringify({ contentType: params.contentType }));
    }
    return {
      key: params.key,
      url: this.publicUrlFor(params.key),
      contentType: params.contentType,
      size: params.body.length,
    };
  }

  async get(key: string): Promise<LocalEntry | null> {
    const mem = this.memory.get(key);
    if (mem) return mem;
    const filePath = this.safePath(key);
    if (!filePath) return null;
    try {
      const body = await fs.readFile(filePath);
      let contentType = "application/octet-stream";
      try {
        const meta = JSON.parse(await fs.readFile(`${filePath}.meta.json`, "utf8")) as {
          contentType?: string;
        };
        if (meta.contentType) contentType = meta.contentType;
      } catch {
        /* ignore */
      }
      const entry = { body, contentType };
      this.memory.set(key, entry);
      return entry;
    } catch {
      return null;
    }
  }

  async delete(key: string): Promise<void> {
    this.memory.delete(key);
    const filePath = this.safePath(key);
    if (!filePath) return;
    try {
      await fs.unlink(filePath);
    } catch {
      /* ignore */
    }
    try {
      await fs.unlink(`${filePath}.meta.json`);
    } catch {
      /* ignore */
    }
  }
}

let localStorageSingleton: LocalFileStorage | null = null;

export function getLocalFileStorage(): LocalFileStorage | null {
  return localStorageSingleton;
}

export function createStorage(): ObjectStorage {
  if (env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY && env.S3_ENDPOINT) {
    console.info("[storage] Using S3-compatible storage");
    return new S3CompatibleStorage();
  }
  console.warn(
    "[storage] S3 not fully configured (need S3_ENDPOINT + S3_ACCESS_KEY_ID + S3_SECRET_ACCESS_KEY). Using local file storage at /api/local-files/*",
  );
  localStorageSingleton = new LocalFileStorage();
  return localStorageSingleton;
}

export const storage = createStorage();
