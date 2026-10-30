import type { HttpMetadata, ObjectInfo, StorageClass } from "../../shared/types";
import { HttpError } from "../errors";
import { parseRange, withLength, type ObjectStore } from "./types";

function toHttpMetadata(metadata: R2HTTPMetadata | undefined): HttpMetadata | undefined {
  if (!metadata) return undefined;
  const { contentType, contentLanguage, contentDisposition, contentEncoding, cacheControl, cacheExpiry } = metadata;
  return { contentType, contentLanguage, contentDisposition, contentEncoding, cacheControl, cacheExpiry: cacheExpiry?.toISOString() };
}

function toObjectInfo(object: R2Object): ObjectInfo {
  return {
    key: object.key,
    size: object.size,
    etag: object.etag,
    lastModified: object.uploaded.toISOString(),
    storageClass: (object.storageClass || undefined) as StorageClass | undefined,
    httpMetadata: toHttpMetadata(object.httpMetadata),
    customMetadata: object.customMetadata,
    ssec: Boolean(object.ssecKeyMd5),
  };
}

function r2Range(header: string | undefined): R2Range | null {
  const match = header ? /^bytes=(\d*)-(\d*)$/.exec(header.trim()) : null;
  if (!match || (!match[1] && !match[2])) return null;
  if (!match[1]) return Number(match[2]) > 0 ? { suffix: Number(match[2]) } : null;
  const offset = Number(match[1]);
  if (!match[2]) return { offset };
  const end = Number(match[2]);
  return end >= offset ? { offset, length: end - offset + 1 } : null;
}

export function bindingStore(bucket: R2Bucket): ObjectStore {
  return {
    backend: "binding",

    async list({ prefix, cursor, recursive, perPage }) {
      const page = await bucket.list({
        prefix: prefix || undefined,
        cursor: cursor || undefined,
        delimiter: recursive ? undefined : "/",
        limit: perPage,
        include: ["httpMetadata", "customMetadata"],
      });
      return {
        objects: page.objects.map(toObjectInfo),
        prefixes: page.delimitedPrefixes,
        cursor: page.truncated ? page.cursor : null,
      };
    },

    async head(key) {
      const object = await bucket.head(key);
      return object ? toObjectInfo(object) : null;
    },

    async get(key, rangeHeader) {
      const requested = r2Range(rangeHeader);
      let object: R2ObjectBody | null = null;
      if (requested) {
        try {
          object = await bucket.get(key, { range: requested });
        } catch {
          object = null;
        }
        if (object?.httpMetadata?.contentEncoding) {
          await object.body.cancel();
          object = null;
        }
      }
      let range: { start: number; end: number } | null = null;
      if (object?.range) {
        const { offset, length, suffix } = object.range as { offset?: number; length?: number; suffix?: number };
        const start = suffix !== undefined ? Math.max(0, object.size - suffix) : (offset ?? 0);
        const end = suffix !== undefined || length === undefined ? object.size - 1 : start + length - 1;
        range = { start, end: Math.min(end, object.size - 1) };
      } else {
        await object?.body.cancel();
        if (rangeHeader) {
          const info = await bucket.head(key);
          if (!info) return null;
          if (!info.httpMetadata?.contentEncoding) range = parseRange(rangeHeader, info.size);
        }
        object = await bucket.get(key, range ? { range: { offset: range.start, length: range.end - range.start + 1 } } : {});
      }
      if (!object) return null;
      return {
        body: object.body,
        size: object.size,
        range: range ?? undefined,
        contentType: object.httpMetadata?.contentType,
        contentEncoding: object.httpMetadata?.contentEncoding,
        etag: object.httpEtag,
        lastModified: object.uploaded.toUTCString(),
      };
    },

    async put(key, body, { contentType, length, storageClass }) {
      const value = body && length !== undefined ? withLength(body, length) : body;
      if (value && length === undefined) throw new HttpError(411, "Content-Length is required");
      await bucket.put(key, value, { httpMetadata: { contentType }, storageClass });
    },

    async delete(keys) {
      await bucket.delete(keys);
      return { succeeded: keys, failed: [] };
    },

    async copy(source, to) {
      const object = await bucket.get(source.key);
      if (!object) throw new HttpError(404, `${source.key} no longer exists`);
      const written = await bucket.put(to, object.body, {
        httpMetadata: object.httpMetadata,
        customMetadata: object.customMetadata,
        storageClass: object.storageClass,
      });
      return written?.size ?? NaN;
    },

    multipart: {
      async create(key, contentType) {
        const upload = await bucket.createMultipartUpload(key, {
          httpMetadata: { contentType },
        });
        return upload.uploadId;
      },

      async uploadPart(key, uploadId, partNumber, body, length) {
        const part = await bucket.resumeMultipartUpload(key, uploadId).uploadPart(partNumber, withLength(body, length));
        return part.etag;
      },

      async complete(key, uploadId, parts) {
        await bucket.resumeMultipartUpload(key, uploadId).complete(parts);
      },

      async abort(key, uploadId) {
        await bucket.resumeMultipartUpload(key, uploadId).abort();
      },
    },
  };
}
