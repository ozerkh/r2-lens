import { recordApiCallsFrom } from "./apiBudget";
import { baseName } from "../../shared/names";

export type ArchiveFormat = "zip" | "tar" | "tgz" | "gz";

type ArchiveEntry = { path: string; size: number; directory: boolean; modified?: Date };

export type ArchiveListing = { entries: ArchiveEntry[]; truncated: boolean };

export const ENTRY_LIMIT = 5000;
const ZIP_LIMIT = 4 * 1024 ** 3;
const STREAM_LIMIT = 512 * 1024 ** 2;
const GZ_TEXT_LIMIT = 1024 * 1024;

export function archiveFormat(key: string): ArchiveFormat | null {
  const name = baseName(key).toLowerCase();
  if (name.endsWith(".zip")) return "zip";
  if (name.endsWith(".tar")) return "tar";
  if (name.endsWith(".tar.gz") || name.endsWith(".tgz")) return "tgz";
  if (name.endsWith(".gz")) return "gz";
  return null;
}

export function archiveSizeLimit(format: ArchiveFormat) {
  return format === "zip" ? ZIP_LIMIT : STREAM_LIMIT;
}

const WHOLE_FILE_LIMIT = 32 * 1024 ** 2;

async function fetchRange(url: string, start: number, end: number, signal: AbortSignal) {
  const response = await fetch(url, { headers: { Range: `bytes=${start}-${end}` }, signal });
  recordApiCallsFrom(response.headers);
  if (response.status === 206) return new DataView(await response.arrayBuffer());
  const length = Number(response.headers.get("content-length"));
  if (response.status !== 200 || !(length <= WHOLE_FILE_LIMIT)) {
    await response.body?.cancel();
    throw new Error(`Range request failed (${response.status})`);
  }
  const whole = await response.arrayBuffer();
  if (end >= whole.byteLength) throw new Error("Not a zip file, or the zip is damaged");
  return new DataView(whole, start, end - start + 1);
}

const utf8 = new TextDecoder();

function dosDate(date: number, time: number) {
  if (!date) return undefined;
  return new Date(
    1980 + (date >> 9),
    ((date >> 5) & 0xf) - 1,
    date & 0x1f,
    time >> 11,
    (time >> 5) & 0x3f,
    (time & 0x1f) * 2,
  );
}

function bigUint(view: DataView, offset: number) {
  return Number(view.getBigUint64(offset, true));
}

export async function listZip(url: string, size: number, signal: AbortSignal): Promise<ArchiveListing> {
  if (size === 0) return { entries: [], truncated: false };
  const tailStart = Math.max(0, size - (22 + 0xffff + 20));
  const tail = await fetchRange(url, tailStart, size - 1, signal);

  let eocd = -1;
  for (let i = tail.byteLength - 22; i >= 0; i--) {
    if (tail.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("Not a zip file, or the zip is damaged");

  let count = tail.getUint16(eocd + 10, true);
  let cdSize = tail.getUint32(eocd + 12, true);
  let cdOffset = tail.getUint32(eocd + 16, true);

  if ((count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) && eocd >= 20) {
    const locator = eocd - 20;
    if (tail.getUint32(locator, true) === 0x07064b50) {
      const recordOffset = bigUint(tail, locator + 8);
      const record = await fetchRange(url, recordOffset, recordOffset + 55, signal);
      if (record.getUint32(0, true) !== 0x06064b50) throw new Error("Damaged zip64 directory");
      count = bigUint(record, 32);
      cdSize = bigUint(record, 40);
      cdOffset = bigUint(record, 48);
    }
  }
  if (cdSize === 0) return { entries: [], truncated: false };
  if (cdOffset + cdSize > size) throw new Error("Damaged zip directory");

  const directory = await fetchRange(url, cdOffset, cdOffset + cdSize - 1, signal);
  const entries: ArchiveEntry[] = [];
  let offset = 0;
  while (offset + 46 <= directory.byteLength && directory.getUint32(offset, true) === 0x02014b50) {
    if (entries.length >= ENTRY_LIMIT) return { entries, truncated: true };
    const time = directory.getUint16(offset + 12, true);
    const date = directory.getUint16(offset + 14, true);
    let entrySize = directory.getUint32(offset + 24, true);
    const nameLength = directory.getUint16(offset + 28, true);
    const extraLength = directory.getUint16(offset + 30, true);
    const commentLength = directory.getUint16(offset + 32, true);
    const nameStart = directory.byteOffset + offset + 46;
    const path = utf8.decode(new Uint8Array(directory.buffer, nameStart, nameLength));

    if (entrySize === 0xffffffff) {
      let extra = offset + 46 + nameLength;
      const extraEnd = extra + extraLength;
      while (extra + 4 <= extraEnd) {
        const id = directory.getUint16(extra, true);
        const length = directory.getUint16(extra + 2, true);
        if (id === 0x0001 && length >= 8) {
          entrySize = bigUint(directory, extra + 4);
          break;
        }
        extra += 4 + length;
      }
    }

    entries.push({ path, size: entrySize, directory: path.endsWith("/"), modified: dosDate(date, time) });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return { entries, truncated: false };
}

class ByteReader {
  private chunks: Uint8Array[] = [];
  private buffered = 0;
  private done = false;
  private reader: ReadableStreamDefaultReader<Uint8Array>;

  constructor(reader: ReadableStreamDefaultReader<Uint8Array>) {
    this.reader = reader;
  }

  private async fill(length: number) {
    while (this.buffered < length && !this.done) {
      const { done, value } = await this.reader.read();
      if (done) this.done = true;
      else if (value.byteLength) {
        this.chunks.push(value);
        this.buffered += value.byteLength;
      }
    }
  }

  async read(length: number): Promise<Uint8Array | null> {
    await this.fill(length);
    if (this.buffered < length) return null;
    const out = new Uint8Array(length);
    let filled = 0;
    while (filled < length) {
      const chunk = this.chunks[0];
      const take = Math.min(chunk.byteLength, length - filled);
      out.set(chunk.subarray(0, take), filled);
      filled += take;
      if (take === chunk.byteLength) this.chunks.shift();
      else this.chunks[0] = chunk.subarray(take);
    }
    this.buffered -= length;
    return out;
  }

  async skip(length: number) {
    let remaining = length;
    while (remaining > 0) {
      await this.fill(1);
      if (this.buffered === 0) return false;
      const chunk = this.chunks[0];
      const take = Math.min(chunk.byteLength, remaining);
      if (take === chunk.byteLength) this.chunks.shift();
      else this.chunks[0] = chunk.subarray(take);
      this.buffered -= take;
      remaining -= take;
    }
    return true;
  }

  async readSome(max: number): Promise<Uint8Array | null> {
    await this.fill(1);
    if (this.buffered === 0) return null;
    return this.read(Math.min(max, this.chunks[0].byteLength));
  }

  cancel() {
    return this.reader.cancel().catch(() => undefined);
  }
}

function field(block: Uint8Array, start: number, length: number) {
  const bytes = block.subarray(start, start + length);
  const end = bytes.indexOf(0);
  return utf8.decode(end === -1 ? bytes : bytes.subarray(0, end));
}

function octal(block: Uint8Array, start: number, length: number) {
  if (block[start] & 0x80) {
    let value = 0;
    for (let i = start + 1; i < start + length; i++) value = value * 256 + block[i];
    return value;
  }
  const text = field(block, start, length).trim();
  return text ? Number.parseInt(text, 8) || 0 : 0;
}

function paxPath(data: Uint8Array) {
  const text = utf8.decode(data);
  for (const line of text.split("\n")) {
    const match = /^\d+ path=(.*)$/.exec(line);
    if (match) return match[1];
  }
  return undefined;
}

async function listTarStream(stream: ReadableStream<Uint8Array>): Promise<ArchiveListing> {
  const reader = new ByteReader(stream.getReader());
  const entries: ArchiveEntry[] = [];
  let longName: string | undefined;
  try {
    for (;;) {
      const header = await reader.read(512);
      if (!header || header.every((byte) => byte === 0)) return { entries, truncated: false };
      if (entries.length >= ENTRY_LIMIT) return { entries, truncated: true };

      const size = octal(header, 124, 12);
      const type = String.fromCharCode(header[156] || 48);
      const padded = Math.ceil(size / 512) * 512;

      if (type === "L" || type === "x") {
        const data = await reader.read(padded);
        if (!data) throw new Error("Archive ended unexpectedly");
        longName = type === "L" ? field(data, 0, size) : (paxPath(data.subarray(0, size)) ?? longName);
        continue;
      }
      if (type === "g") {
        if (!(await reader.skip(padded))) throw new Error("Archive ended unexpectedly");
        continue;
      }

      const magic = field(header, 257, 6);
      const prefix = magic.startsWith("ustar") ? field(header, 345, 155) : "";
      const name = field(header, 0, 100);
      const path = longName ?? (prefix ? `${prefix}/${name}` : name);
      longName = undefined;
      const mtime = octal(header, 136, 12);
      const directory = type === "5" || path.endsWith("/");
      entries.push({ path, size: directory ? 0 : size, directory, modified: mtime ? new Date(mtime * 1000) : undefined });

      if (padded && !(await reader.skip(padded))) throw new Error("Archive ended unexpectedly");
    }
  } finally {
    await reader.cancel();
  }
}

async function openStream(url: string, signal: AbortSignal) {
  const response = await fetch(url, { signal });
  recordApiCallsFrom(response.headers);
  if (!response.ok || !response.body) throw new Error(`Failed to load (${response.status})`);
  return response.body;
}

type Bytes = Uint8Array<ArrayBuffer>;

async function gunzip(body: ReadableStream<Bytes>) {
  const reader = body.getReader();
  const first = await reader.read();
  const head: Bytes = first.value ?? new Uint8Array();
  const stream = new ReadableStream<Bytes>({
    start(controller) {
      if (head.byteLength) controller.enqueue(head);
      if (first.done) controller.close();
    },
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) controller.close();
      else controller.enqueue(value);
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
  return head[0] === 0x1f && head[1] === 0x8b ? stream.pipeThrough(new DecompressionStream("gzip")) : stream;
}

export async function listTar(url: string, gzipped: boolean, signal: AbortSignal) {
  const body = await openStream(url, signal);
  return listTarStream(gzipped ? await gunzip(body) : body);
}

export async function readGzipText(url: string, signal: AbortSignal) {
  const body = await openStream(url, signal);
  const reader = new ByteReader((await gunzip(body)).getReader());
  try {
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (total <= GZ_TEXT_LIMIT) {
      const chunk = await reader.readSome(GZ_TEXT_LIMIT + 1 - total);
      if (!chunk) break;
      chunks.push(chunk);
      total += chunk.byteLength;
    }
    const joined = new Uint8Array(chunks.reduce((sum, c) => sum + c.byteLength, 0));
    let position = 0;
    for (const chunk of chunks) {
      joined.set(chunk, position);
      position += chunk.byteLength;
    }
    const truncated = joined.byteLength > GZ_TEXT_LIMIT;
    const bytes = truncated ? joined.subarray(0, GZ_TEXT_LIMIT) : joined;
    if (bytes.subarray(0, 8192).includes(0)) throw new Error("This file is not text, so it cannot be previewed");
    return { text: new TextDecoder().decode(bytes), truncated };
  } finally {
    await reader.cancel();
  }
}
