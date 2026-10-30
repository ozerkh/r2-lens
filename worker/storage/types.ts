import type { Backend, BatchResult, ObjectInfo, ObjectListing, StorageClass } from "../../shared/types";

type ListOptions = { prefix?: string; cursor?: string; recursive: boolean; perPage: number };

type StoredObject = {
  body: ReadableStream<Uint8Array> | null;
  size: number;
  range?: { start: number; end: number };
  contentType?: string;
  contentEncoding?: string;
  etag?: string;
  lastModified?: string;
};

type PutOptions = { contentType: string; length?: number; storageClass?: StorageClass };

type UploadedPart = { partNumber: number; etag: string };

type MultipartStore = {
  create(key: string, contentType: string): Promise<string>;
  uploadPart(key: string, uploadId: string, partNumber: number, body: ReadableStream<Uint8Array>, length: number): Promise<string>;
  complete(key: string, uploadId: string, parts: UploadedPart[]): Promise<void>;
  abort(key: string, uploadId: string): Promise<void>;
};

export type ObjectStore = {
  backend: Backend;
  list(options: ListOptions): Promise<ObjectListing>;
  head(key: string): Promise<ObjectInfo | null>;
  get(key: string, range?: string): Promise<StoredObject | null>;
  put(key: string, body: ReadableStream<Uint8Array> | null, options: PutOptions): Promise<void>;
  delete(keys: string[]): Promise<BatchResult>;
  copy(source: ObjectInfo, to: string): Promise<number>;
  multipart?: MultipartStore;
  presign?(key: string, expiresIn: number): Promise<string>;
};

export class UnsatisfiableRange extends Error {
  constructor(readonly size: number) {
    super("Range not satisfiable");
  }
}

export function parseRange(header: string | undefined, size: number): { start: number; end: number } | null {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || (!match[1] && !match[2])) return null;
  if (match[1] && match[2] && Number(match[2]) < Number(match[1])) return null;
  const range = match[1]
    ? { start: Number(match[1]), end: match[2] ? Math.min(Number(match[2]), size - 1) : size - 1 }
    : { start: Math.max(0, size - Number(match[2])), end: size - 1 };
  if (range.start >= size || range.start > range.end) throw new UnsatisfiableRange(size);
  return range;
}

export function withLength(body: ReadableStream<Uint8Array>, length: number) {
  const fixed = new FixedLengthStream(length);
  body.pipeTo(fixed.writable).catch(() => undefined);
  return fixed.readable;
}
