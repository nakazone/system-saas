import { createWriteStream, type WriteStream } from "node:fs";
import zlib from "node:zlib";
import type { Readable } from "node:stream";

/**
 * Minimal ZIP writer (no dependency) that streams to a file on disk.
 * Text is deflated; photos/PDFs are stored as-is (already compressed).
 * Sizes go in a data descriptor after each entry, so files of unknown size can be streamed.
 * Limit: 4 GB per archive and 65,535 entries (no ZIP64) — checked, with a clear error.
 */

const MAX = 0xffffffff;
const CRC32_TABLE = new Uint32Array(256);

for (let i = 0; i < CRC32_TABLE.length; i++) {
  let value = i;
  for (let bit = 0; bit < 8; bit++) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  CRC32_TABLE[i] = value >>> 0;
}

function updateCrc32(data: Buffer, previous = 0): number {
  let crc = (previous ^ 0xffffffff) >>> 0;
  for (const byte of data) {
    crc = (CRC32_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8)) >>> 0;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

type Entry = { name: Buffer; crc: number; csize: number; usize: number; offset: number; method: number; time: number; date: number };

function dosTime(d: Date): { time: number; date: number } {
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

export class ZipWriter {
  private out: WriteStream;
  private offset = 0;
  private entries: Entry[] = [];
  private names = new Set<string>();

  constructor(filePath: string) {
    this.out = createWriteStream(filePath);
  }

  get bytes(): number {
    return this.offset;
  }

  private write(buf: Buffer): Promise<void> {
    this.offset += buf.length;
    if (this.offset > MAX) return Promise.reject(new Error("Arquivo passou de 4 GB (limite do ZIP sem ZIP64)."));
    return new Promise((resolve, reject) => {
      const ok = this.out.write(buf, (err) => (err ? reject(err) : undefined));
      if (ok) resolve();
      else this.out.once("drain", resolve);
    });
  }

  /** Same name twice gets " (2)", " (3)"… before the extension. */
  private uniqueName(name: string): string {
    let n = name.replace(/^\/+/, "").replace(/\\/g, "/");
    if (!this.names.has(n)) {
      this.names.add(n);
      return n;
    }
    const dot = n.lastIndexOf(".");
    const base = dot > n.lastIndexOf("/") ? n.slice(0, dot) : n;
    const ext = dot > n.lastIndexOf("/") ? n.slice(dot) : "";
    for (let i = 2; ; i++) {
      const c = `${base} (${i})${ext}`;
      if (!this.names.has(c)) {
        this.names.add(c);
        n = c;
        return n;
      }
    }
  }

  async addBuffer(name: string, data: Buffer, opts: { compress?: boolean; date?: Date } = {}): Promise<void> {
    async function* one() {
      yield data;
    }
    await this.addStream(name, one(), opts);
  }

  async addStream(name: string, source: Readable | AsyncIterable<Buffer | Uint8Array | string>, opts: { compress?: boolean; date?: Date } = {}): Promise<void> {
    if (this.entries.length >= 0xffff) throw new Error("Arquivos demais para um ZIP (65.535).");
    const fname = Buffer.from(this.uniqueName(name), "utf8");
    const method = opts.compress ? 8 : 0;
    const { time, date } = dosTime(opts.date ?? new Date());
    const offset = this.offset;
    // Local header: bit 3 (sizes in data descriptor) + bit 11 (UTF-8 names).
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0);
    h.writeUInt16LE(20, 4);
    h.writeUInt16LE(0x0808, 6);
    h.writeUInt16LE(method, 8);
    h.writeUInt16LE(time, 10);
    h.writeUInt16LE(date, 12);
    h.writeUInt16LE(fname.length, 26);
    await this.write(h);
    await this.write(fname);

    let crc = 0;
    let usize = 0;
    let csize = 0;
    if (method === 8) {
      const deflate = zlib.createDeflateRaw({ level: 6 });
      const pump = (async () => {
        for await (const chunk of deflate) {
          csize += chunk.length;
          await this.write(chunk as Buffer);
        }
      })();
      for await (const raw of source) {
        const chunk = typeof raw === "string" ? Buffer.from(raw) : Buffer.from(raw);
        crc = updateCrc32(chunk, crc);
        usize += chunk.length;
        if (!deflate.write(chunk)) await new Promise((r) => deflate.once("drain", r));
      }
      deflate.end();
      await pump;
    } else {
      for await (const raw of source) {
        const chunk = typeof raw === "string" ? Buffer.from(raw) : Buffer.from(raw);
        crc = updateCrc32(chunk, crc);
        usize += chunk.length;
        csize += chunk.length;
        await this.write(chunk);
      }
    }
    if (usize > MAX || csize > MAX) throw new Error("Um arquivo passou de 4 GB.");
    const dd = Buffer.alloc(16);
    dd.writeUInt32LE(0x08074b50, 0);
    dd.writeUInt32LE(crc >>> 0, 4);
    dd.writeUInt32LE(csize, 8);
    dd.writeUInt32LE(usize, 12);
    await this.write(dd);
    this.entries.push({ name: fname, crc: crc >>> 0, csize, usize, offset, method, time, date });
  }

  async close(): Promise<number> {
    const cdStart = this.offset;
    for (const e of this.entries) {
      const c = Buffer.alloc(46);
      c.writeUInt32LE(0x02014b50, 0);
      c.writeUInt16LE(20, 4);
      c.writeUInt16LE(20, 6);
      c.writeUInt16LE(0x0808, 8);
      c.writeUInt16LE(e.method, 10);
      c.writeUInt16LE(e.time, 12);
      c.writeUInt16LE(e.date, 14);
      c.writeUInt32LE(e.crc, 16);
      c.writeUInt32LE(e.csize, 20);
      c.writeUInt32LE(e.usize, 24);
      c.writeUInt16LE(e.name.length, 28);
      c.writeUInt32LE(e.offset, 42);
      await this.write(c);
      await this.write(e.name);
    }
    const cdSize = this.offset - cdStart;
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(this.entries.length, 8);
    end.writeUInt16LE(this.entries.length, 10);
    end.writeUInt32LE(cdSize, 12);
    end.writeUInt32LE(cdStart, 16);
    await this.write(end);
    await new Promise<void>((resolve, reject) => this.out.end((err?: Error | null) => (err ? reject(err) : resolve())));
    return this.offset;
  }

  /** Stops writing and closes the file (on error). */
  abort(): void {
    this.out.destroy();
  }
}
