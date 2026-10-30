import { AwsClient } from "aws4fetch";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { HttpMetadata, Jurisdiction, ObjectInfo, StorageClass } from "../../shared/types";
import { HttpError } from "../errors";
import { parseRange, withLength, type ObjectStore } from "./types";

type S3Credentials = { accessKeyId: string; secretAccessKey: string };

export async function credentialsFromToken(tokenId: string, token: string): Promise<S3Credentials> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  const secretAccessKey = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return { accessKeyId: tokenId, secretAccessKey };
}

export function s3Endpoint(accountId: string, jurisdiction: Jurisdiction) {
  const region = jurisdiction === "eu" || jurisdiction === "fedramp" ? `.${jurisdiction}` : "";
  return `https://${accountId}${region}.r2.cloudflarestorage.com`;
}

const S3_STORAGE_CLASS: Record<StorageClass, string> = { Standard: "STANDARD", InfrequentAccess: "STANDARD_IA" };
const STORAGE_CLASS_FROM_S3: Record<string, StorageClass> = { STANDARD: "Standard", STANDARD_IA: "InfrequentAccess" };
const META_PREFIX = "x-amz-meta-";

function toObjectInfo(key: string, headers: Headers): ObjectInfo {
  const httpMetadata: HttpMetadata = {
    contentType: headers.get("content-type") ?? undefined,
    contentLanguage: headers.get("content-language") ?? undefined,
    contentDisposition: headers.get("content-disposition") ?? undefined,
    contentEncoding: headers.get("content-encoding") ?? undefined,
    cacheControl: headers.get("cache-control") ?? undefined,
    cacheExpiry: headers.get("expires") ?? undefined,
  };
  const customMetadata = Object.fromEntries(
    [...headers].filter(([name]) => name.startsWith(META_PREFIX)).map(([name, value]) => [name.slice(META_PREFIX.length), value]),
  );
  const lastModified = headers.get("last-modified");
  return {
    key,
    size: Number(headers.get("content-length")),
    etag: headers.get("etag")?.replace(/"/g, ""),
    lastModified: lastModified ? new Date(lastModified).toISOString() : undefined,
    storageClass: STORAGE_CLASS_FROM_S3[headers.get("x-amz-storage-class") ?? "STANDARD"] ?? "Standard",
    httpMetadata,
    customMetadata,
    ssec: headers.has("x-amz-server-side-encryption-customer-algorithm"),
  };
}

function xmlValue(xml: string, tag: string) {
  return new RegExp(`<${tag}>([^<]*)</${tag}>`).exec(xml)?.[1];
}

function escapeXml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function unescapeXml(value: string) {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

async function failure(response: Response, action: string): Promise<never> {
  const text = await response.text().catch(() => "");
  const message = xmlValue(text, "Message") || xmlValue(text, "Code") || `${action} failed (${response.status})`;
  const status = (response.status >= 400 && response.status < 500 ? response.status : 502) as ContentfulStatusCode;
  throw new HttpError(status, message);
}

function hasDotSegment(key: string) {
  return key.split("/").some((segment) => segment === "." || segment === "..");
}

export function s3Store(rest: ObjectStore, endpoint: string, bucket: string, credentials: S3Credentials): ObjectStore {
  const client = new AwsClient({ ...credentials, service: "s3", region: "auto", retries: 0 });
  const objectUrl = (key: string, query = "") => {
    if (hasDotSegment(key)) throw new HttpError(400, "Keys with . or .. segments cannot be uploaded in parts");
    return `${endpoint}/${encodeURIComponent(bucket)}/${key.split("/").map(encodeURIComponent).join("/")}${query}`;
  };

  const send = async (action: string, url: string, init: RequestInit) => {
    const response = await client.fetch(url, init);
    if (!response.ok) await failure(response, action);
    return response;
  };

  const head = async (key: string) => {
    if (hasDotSegment(key)) return rest.head(key);
    const response = await client.fetch(objectUrl(key), { method: "HEAD" });
    if (response.status === 404) return null;
    if (response.status === 400) return rest.head(key);
    if (!response.ok) await failure(response, "Head");
    return toObjectInfo(key, response.headers);
  };

  return {
    backend: "s3",
    list: rest.list,
    head,

    async delete(keys) {
      const body = `<Delete><Quiet>true</Quiet>${keys
        .map((key) => `<Object><Key>${escapeXml(key)}</Key></Object>`)
        .join("")}</Delete>`;
      const response = await send("Delete", `${endpoint}/${encodeURIComponent(bucket)}?delete`, {
        method: "POST",
        headers: { "Content-Type": "application/xml" },
        body,
      });
      const text = await response.text();
      const failed = [...text.matchAll(/<Error>([\s\S]*?)<\/Error>/g)].map(([, error]) => ({
        key: unescapeXml(xmlValue(error, "Key") ?? ""),
        error: xmlValue(error, "Message") ?? "Delete failed",
      }));
      const failedKeys = new Set(failed.map((item) => item.key));
      return { succeeded: keys.filter((key) => !failedKeys.has(key)), failed };
    },

    async get(key, rangeHeader) {
      if (hasDotSegment(key)) return rest.get(key, rangeHeader);
      const fetchObject = (range?: string) => client.fetch(objectUrl(key), { headers: range ? { Range: range } : {} });
      const parts = rangeHeader ? /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim()) : null;
      const validRange =
        parts && (parts[1] || parts[2]) && !(parts[1] && parts[2] && Number(parts[2]) < Number(parts[1])) ? rangeHeader!.trim() : undefined;
      let response = await fetchObject(validRange);
      if (response.status === 416) {
        await response.body?.cancel();
        const info = await head(key);
        if (!info) return null;
        parseRange(rangeHeader, info.size);
        response = await fetchObject();
      } else if (response.status === 206 && response.headers.has("content-encoding")) {
        await response.body?.cancel();
        response = await fetchObject();
      }
      if (response.status === 404) return null;
      if (!response.ok) await failure(response, "Download");

      const contentRange = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get("content-range") ?? "");
      const length = response.headers.get("content-length");
      const decoded = response.headers.has("content-encoding");
      return {
        body: response.body,
        size: contentRange ? Number(contentRange[3]) : length === null || decoded ? NaN : Number(length),
        range: contentRange ? { start: Number(contentRange[1]), end: Number(contentRange[2]) } : undefined,
        contentType: response.headers.get("content-type") ?? undefined,
        etag: response.headers.get("etag") ?? undefined,
        lastModified: response.headers.get("last-modified") ?? undefined,
      };
    },

    async put(key, body, options) {
      if (hasDotSegment(key)) return rest.put(key, body, options);
      const { contentType, length, storageClass } = options;
      const headers: Record<string, string> = { "Content-Type": contentType };
      if (storageClass) headers["x-amz-storage-class"] = S3_STORAGE_CLASS[storageClass];
      if (!body || length === 0) {
        await send("Upload", objectUrl(key), { method: "PUT", headers, body: "" });
        return;
      }
      if (length === undefined) throw new HttpError(411, "Content-Length is required");
      await send("Upload", objectUrl(key), { method: "PUT", headers, body: withLength(body, length) });
    },

    async copy(source, to) {
      if (hasDotSegment(source.key) || hasDotSegment(to)) return rest.copy(source, to);
      const copySource = `/${encodeURIComponent(bucket)}/${source.key.split("/").map(encodeURIComponent).join("/")}`;
      const response = await send("Copy", objectUrl(to), {
        method: "PUT",
        headers: {
          "x-amz-copy-source": copySource,
          "x-amz-metadata-directive": "COPY",
          "x-amz-storage-class": S3_STORAGE_CLASS[source.storageClass ?? "Standard"],
        },
      });
      const text = await response.text();
      if (text.includes("<Error>")) throw new HttpError(502, xmlValue(text, "Message") || "Copy failed");
      return (await head(to))?.size ?? NaN;
    },

    async presign(key, expiresIn) {
      if (hasDotSegment(key)) throw new HttpError(400, "Share links cannot be made for keys with . or .. segments");
      const signed = await client.sign(objectUrl(key, `?X-Amz-Expires=${expiresIn}`), { method: "GET", aws: { signQuery: true } });
      return signed.url;
    },

    multipart: {
      async create(key, contentType) {
        const response = await send("Starting the upload", objectUrl(key, "?uploads"), {
          method: "POST",
          headers: { "Content-Type": contentType },
        });
        const uploadId = xmlValue(await response.text(), "UploadId");
        if (!uploadId) throw new HttpError(502, "R2 did not return an upload ID");
        return uploadId;
      },

      async uploadPart(key, uploadId, partNumber, body, length) {
        const query = `?partNumber=${partNumber}&uploadId=${encodeURIComponent(uploadId)}`;
        const response = await send("Part upload", objectUrl(key, query), { method: "PUT", body: withLength(body, length) });
        const etag = response.headers.get("etag");
        if (!etag) throw new HttpError(502, "R2 did not return an ETag for the part");
        return etag;
      },

      async complete(key, uploadId, parts) {
        const xml = `<CompleteMultipartUpload>${parts
          .map((part) => `<Part><PartNumber>${part.partNumber}</PartNumber><ETag>${escapeXml(part.etag)}</ETag></Part>`)
          .join("")}</CompleteMultipartUpload>`;
        const response = await send("Finishing the upload", objectUrl(key, `?uploadId=${encodeURIComponent(uploadId)}`), {
          method: "POST",
          headers: { "Content-Type": "application/xml" },
          body: xml,
        });
        const text = await response.text();
        if (text.includes("<Error>")) throw new HttpError(502, xmlValue(text, "Message") || "Finishing the upload failed");
      },

      async abort(key, uploadId) {
        const response = await client.fetch(objectUrl(key, `?uploadId=${encodeURIComponent(uploadId)}`), { method: "DELETE" });
        if (!response.ok && response.status !== 404) await failure(response, "Cancelling the upload");
      },
    },
  };
}
