import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { env } from "../../config/env.js";
import type { ListedObject, ObjectStorage, StoredObject } from "./types.js";

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

  async list(prefix: string): Promise<ListedObject[]> {
    const out: ListedObject[] = [];
    let token: string | undefined;
    do {
      const r = await this.client.send(new ListObjectsV2Command({ Bucket: this.bucket, Prefix: prefix, ContinuationToken: token }));
      for (const o of r.Contents ?? []) if (o.Key) out.push({ key: o.Key, size: Number(o.Size ?? 0) });
      token = r.IsTruncated ? r.NextContinuationToken : undefined;
    } while (token);
    return out;
  }

  async getStream(key: string): Promise<Readable | null> {
    try {
      const r = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      return (r.Body as Readable) ?? null;
    } catch (error) {
      if ((error as { name?: string }).name === "NoSuchKey") return null;
      throw error;
    }
  }

  async uploadFile(params: { key: string; filePath: string; contentType: string }): Promise<{ key: string; size: number }> {
    const { size } = await fs.stat(params.filePath);
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: params.key, Body: createReadStream(params.filePath), ContentLength: size, ContentType: params.contentType }),
    );
    return { key: params.key, size };
  }

  async deletePrefix(prefix: string): Promise<number> {
    if (!prefix || prefix.length < 6) throw new Error("Refusing to delete a short prefix");
    const all = await this.list(prefix);
    for (let i = 0; i < all.length; i += 1000) {
      const batch = all.slice(i, i + 1000);
      await this.client.send(new DeleteObjectsCommand({ Bucket: this.bucket, Delete: { Objects: batch.map((o) => ({ Key: o.key })), Quiet: true } }));
    }
    return all.length;
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
    // Relative URL so photos work on obramate.com and Railway host alike.
    return `/api/local-files/${key
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

  async list(prefix: string): Promise<ListedObject[]> {
    const out = new Map<string, number>();
    for (const [k, v] of this.memory) if (k.startsWith(prefix)) out.set(k, v.body.length);
    const walk = async (dir: string): Promise<void> => {
      let entries: import("node:fs").Dirent[];
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) await walk(full);
        else if (!e.name.endsWith(".meta.json")) {
          const key = path.relative(this.root, full).split(path.sep).join("/");
          if (key.startsWith(prefix) && !out.has(key)) out.set(key, (await fs.stat(full)).size);
        }
      }
    };
    // Start from the deepest existing folder of the prefix.
    const base = prefix.includes("/") ? prefix.slice(0, prefix.lastIndexOf("/")) : "";
    const start = this.safePath(base || ".") ?? this.root;
    await walk(start);
    return [...out].map(([key, size]) => ({ key, size }));
  }

  async getStream(key: string): Promise<Readable | null> {
    const e = await this.get(key);
    return e ? Readable.from([e.body]) : null;
  }

  async uploadFile(params: { key: string; filePath: string; contentType: string }): Promise<{ key: string; size: number }> {
    const target = this.safePath(params.key);
    if (!target) throw new Error("Invalid key");
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.copyFile(params.filePath, target);
    await fs.writeFile(`${target}.meta.json`, JSON.stringify({ contentType: params.contentType }));
    const { size } = await fs.stat(target);
    return { key: params.key, size };
  }

  async deletePrefix(prefix: string): Promise<number> {
    if (!prefix || prefix.length < 6) throw new Error("Refusing to delete a short prefix");
    const all = await this.list(prefix);
    for (const o of all) await this.delete(o.key);
    // Remove the now-empty folder when the prefix is a folder.
    if (prefix.endsWith("/")) {
      const dir = this.safePath(prefix.slice(0, -1));
      if (dir && dir !== this.root) await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
    return all.length;
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
