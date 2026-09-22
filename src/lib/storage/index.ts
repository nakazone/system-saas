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

/** In-memory/dev fallback that returns data URLs when S3 is not configured */
export class MemoryStorage implements ObjectStorage {
  private store = new Map<string, { body: Buffer; contentType: string }>();

  async upload(params: {
    key: string;
    body: Buffer;
    contentType: string;
  }): Promise<StoredObject> {
    this.store.set(params.key, {
      body: params.body,
      contentType: params.contentType,
    });
    const base64 = params.body.toString("base64");
    return {
      key: params.key,
      url: `data:${params.contentType};base64,${base64}`,
      contentType: params.contentType,
      size: params.body.length,
    };
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }
}

export function createStorage(): ObjectStorage {
  if (env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY && env.S3_ENDPOINT) {
    return new S3CompatibleStorage();
  }
  return new MemoryStorage();
}

export const storage = createStorage();
