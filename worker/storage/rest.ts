import type Cloudflare from "cloudflare";
import type { BatchResult, HttpMetadata, Jurisdiction, ObjectInfo, StorageClass } from "../../shared/types";
import { REST_RANGE_SKIP_LIMIT } from "../../shared/capabilities";
import { parseRange, withLength, type ObjectStore } from "./types";

const DELETE_CONCURRENCY = 6;
const UPLOAD_TIMEOUT_MS = 15 * 60 * 1000;

const HTTP_METADATA_HEADERS: [keyof HttpMetadata, string][] = [
  ["contentType", "Content-Type"],
  ["contentLanguage", "Content-Language"],
  ["contentDisposition", "Content-Disposition"],
  ["cacheControl", "Cache-Control"],
  ["cacheExpiry", "Expires"],
];

type RawObject = {
  key?: string;
  size?: number;
  etag?: string;
  last_modified?: string;
  storage_class?: StorageClass;
  http_metadata?: unknown;
  custom_metadata?: unknown;
  ssec?: boolean;
};

function toObjectInfo(raw: RawObject): ObjectInfo {
  return {
    key: raw.key ?? "",
    size: raw.size ?? 0,
    etag: raw.etag,
    lastModified: raw.last_modified,
    storageClass: raw.storage_class,
    httpMetadata: raw.http_metadata as HttpMetadata | undefined,
    customMetadata: raw.custom_metadata as Record<string, string> | undefined,
    ssec: raw.ssec,
  };
}

const READ_BLOCK = 1024 * 1024;

async function byteRange(body: ReadableStream<Uint8Array>, start: number, end: number, size: number) {
  const reader = body.getReader({ mode: "byob" });
  let buffer = new ArrayBuffer(READ_BLOCK);
  const read = async (length: number) => {
    const { value } = (await reader.readAtLeast(length, new Uint8Array(buffer, 0, length))) as { value?: Uint8Array };
    if (value) buffer = value.buffer as ArrayBuffer;
    return value?.byteLength ? value : null;
  };
  for (let skipped = 0; skipped < start; ) {
    const chunk = await read(Math.min(READ_BLOCK, start - skipped));
    if (!chunk) break;
    skipped += chunk.byteLength;
  }
  if (end === size - 1) {
    reader.releaseLock();
    return body;
  }
  let remaining = end - start + 1;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const chunk = await read(Math.min(READ_BLOCK, remaining));
      if (!chunk) return controller.close();
      remaining -= chunk.byteLength;
      controller.enqueue(chunk.slice());
      if (remaining <= 0) {
        controller.close();
        await reader.cancel();
      }
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
}

export function restStore(cf: Cloudflare, accountId: string, bucket: string, jurisdiction: Jurisdiction): ObjectStore {
  const scope = { account_id: accountId, "cf-r2-jurisdiction": jurisdiction };
  const params = { ...scope, bucket_name: bucket };

  const head = async (key: string) => {
    const page = await cf.r2.buckets.objects.list(bucket, { ...scope, prefix: key, per_page: 1 });
    const found = page.result.find((o) => o.key === key);
    return found ? toObjectInfo(found) : null;
  };

  const upload = (key: string, body: ReadableStream<Uint8Array> | null, headers: Record<string, string>, storageClass?: StorageClass) =>
    cf.r2.buckets.objects.upload(
      key,
      (body ?? new ArrayBuffer(0)) as unknown as Blob,
      { ...params, "cf-r2-storage-class": storageClass === "InfrequentAccess" ? storageClass : undefined },
      { headers, maxRetries: 0, timeout: UPLOAD_TIMEOUT_MS },
    );

  return {
    backend: "rest",

    async list({ prefix, cursor, recursive, perPage }) {
      const page = await cf.r2.buckets.objects.list(bucket, {
        ...scope,
        prefix: prefix || undefined,
        cursor: cursor || undefined,
        delimiter: recursive ? undefined : "/",
        per_page: perPage,
      });
      const info = page.result_info as { cursor?: string; is_truncated?: boolean; delimited?: string[] };
      return {
        objects: page.result.map(toObjectInfo),
        prefixes: info.delimited ?? [],
        cursor: info.is_truncated && info.cursor ? info.cursor : null,
      };
    },

    head,

    async get(key, rangeHeader) {
      const upstream = await cf.r2.buckets.objects.get(key, params);
      const length = upstream.headers.get("content-length");
      let size = length === null || upstream.headers.has("content-encoding") ? NaN : Number(length);
      if (!Number.isFinite(size) && rangeHeader) {
        const listed = await head(key);
        size = listed && !listed.httpMetadata?.contentEncoding ? listed.size : NaN;
      }
      const stored = {
        size,
        contentType: upstream.headers.get("content-type") ?? undefined,
        etag: upstream.headers.get("etag") ?? undefined,
        lastModified: upstream.headers.get("last-modified") ?? undefined,
      };
      if (!upstream.body || !Number.isFinite(size)) return { ...stored, body: upstream.body };

      let range;
      try {
        range = parseRange(rangeHeader, size);
      } catch (error) {
        await upstream.body.cancel();
        throw error;
      }
      if (!range || range.start > REST_RANGE_SKIP_LIMIT) return { ...stored, body: upstream.body };
      const sliced = await byteRange(upstream.body, range.start, range.end, size);
      return { ...stored, range, body: withLength(sliced, range.end - range.start + 1) };
    },

    async put(key, body, { contentType, storageClass }) {
      await upload(key, body, { "Content-Type": contentType }, storageClass);
    },

    async delete(keys) {
      const result: BatchResult = { succeeded: [], failed: [] };
      let index = 0;
      const worker = async () => {
        while (index < keys.length) {
          const key = keys[index++];
          try {
            await cf.r2.buckets.objects.delete(key, params);
            result.succeeded.push(key);
          } catch (error) {
            result.failed.push({ key, error: error instanceof Error ? error.message : "Delete failed" });
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(DELETE_CONCURRENCY, keys.length) }, worker));
      return result;
    },

    async copy(source, to) {
      const metadata = source.httpMetadata ?? {};
      const headers: Record<string, string> = { "Content-Type": metadata.contentType || "application/octet-stream" };
      for (const [field, header] of HTTP_METADATA_HEADERS) {
        if (metadata[field]) headers[header] = metadata[field]!;
      }
      const upstream = await cf.r2.buckets.objects.get(source.key, params);
      const written = await upload(to, upstream.body, headers, source.storageClass);
      return Number(written.size);
    },
  };
}
