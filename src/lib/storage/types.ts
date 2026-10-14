import type { Readable } from "node:stream";

export type StoredObject = {
  key: string;
  url: string;
  contentType: string;
  size: number;
};

export type ListedObject = { key: string; size: number };

export interface ObjectStorage {
  upload(params: {
    key: string;
    body: Buffer;
    contentType: string;
  }): Promise<StoredObject>;
  delete(key: string): Promise<void>;
  /** Every object whose key starts with `prefix` (Master › exportar/excluir empresa). */
  list(prefix: string): Promise<ListedObject[]>;
  /** Object bytes as a stream, or null when missing. */
  getStream(key: string): Promise<Readable | null>;
  /** Upload a file from disk without loading it in memory (big exports). */
  uploadFile(params: { key: string; filePath: string; contentType: string }): Promise<{ key: string; size: number }>;
  /** Deletes everything under `prefix`; returns how many objects were removed. */
  deletePrefix(prefix: string): Promise<number>;
}
