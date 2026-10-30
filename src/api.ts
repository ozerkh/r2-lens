import type {
  BatchResult,
  BucketInfo,
  BucketSettings,
  Jurisdiction,
  LocationHint,
  Me,
  ObjectInfo,
  ObjectListing,
  SetupStatus,
  StorageClass,
} from "../shared/types";
import { DELETE_BATCH } from "../shared/capabilities";
import { recordApiCallsFrom } from "./lib/apiBudget";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export type BucketRef = { accountId: string; bucket: string; jurisdiction: Jurisdiction };

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && typeof init.body === "string") headers.set("Content-Type", "application/json");
  const response = await fetch(path, { ...init, headers, credentials: "same-origin" });
  recordApiCallsFrom(response.headers);
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    if (response.status === 401) window.dispatchEvent(new Event("r2-lens:unauthorized"));
    throw new ApiError(response.status, body?.error ?? response.statusText);
  }
  return response.json() as Promise<T>;
}

function bucketPath(ref: BucketRef, suffix = "", query: Record<string, string | undefined> = {}) {
  const params = new URLSearchParams({ jurisdiction: ref.jurisdiction });
  for (const [key, value] of Object.entries(query)) if (value !== undefined) params.set(key, value);
  return `/api/accounts/${encodeURIComponent(ref.accountId)}/buckets/${encodeURIComponent(ref.bucket)}${suffix}?${params}`;
}

function sendBlob(
  method: string,
  url: string,
  body: Blob,
  contentType: string,
  onProgress: (loaded: number) => void,
  signal?: AbortSignal,
) {
  return new Promise<string>((resolve, reject) => {
    if (signal?.aborted) return reject(new ApiError(0, "Upload cancelled"));
    const xhr = new XMLHttpRequest();
    xhr.open(method, url);
    xhr.setRequestHeader("Content-Type", contentType);
    xhr.upload.onprogress = (event) => onProgress(event.loaded);
    xhr.onload = () => {
      recordApiCallsFrom({ get: (name) => xhr.getResponseHeader(name) });
      if (xhr.status >= 200 && xhr.status < 300) return resolve(xhr.responseText);
      let message = xhr.statusText;
      try {
        message = (JSON.parse(xhr.responseText) as { error?: string }).error ?? message;
      } catch {}
      if (xhr.status === 401) window.dispatchEvent(new Event("r2-lens:unauthorized"));
      reject(new ApiError(xhr.status, message || "Upload failed"));
    };
    xhr.onerror = () => reject(new ApiError(0, "Network error"));
    xhr.onabort = () => reject(new ApiError(0, "Upload cancelled"));
    signal?.addEventListener("abort", () => xhr.abort());
    xhr.send(body);
  });
}

export const api = {
  me: () => request<Me>("/api/me"),

  setup: () => request<SetupStatus>("/auth/setup"),

  logout: () => request<{ ok: boolean }>("/auth/logout", { method: "POST" }),

  tokenLogin: (token: string) => request<{ ok: boolean }>("/auth/token", { method: "POST", body: JSON.stringify({ token }) }),

  listBuckets: (accountId: string) =>
    request<{ buckets: BucketInfo[] }>(`/api/accounts/${encodeURIComponent(accountId)}/buckets`),

  createBucket: (
    accountId: string,
    body: { name: string; locationHint?: LocationHint; storageClass?: StorageClass; jurisdiction?: Jurisdiction },
  ) =>
    request<BucketInfo>(`/api/accounts/${encodeURIComponent(accountId)}/buckets`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  deleteBucket: (ref: BucketRef) => request<{ ok: boolean }>(bucketPath(ref), { method: "DELETE" }),

  settings: (ref: BucketRef) => request<BucketSettings>(bucketPath(ref, "/settings")),

  publicUrl: (ref: BucketRef) => request<{ url: string | null }>(bucketPath(ref, "/public-url")),

  setStorageClass: (ref: BucketRef, storageClass: StorageClass) =>
    request<BucketInfo>(bucketPath(ref), { method: "PATCH", body: JSON.stringify({ storageClass }) }),

  setRules: (ref: BucketRef, kind: "cors" | "lifecycle" | "locks", rules: unknown[]) =>
    request<{ ok: boolean }>(bucketPath(ref, `/${kind}`), { method: "PUT", body: JSON.stringify({ rules }) }),

  setPublicAccess: (ref: BucketRef, enabled: boolean) =>
    request<{ domain: string; enabled: boolean }>(bucketPath(ref, "/public-access"), {
      method: "PUT",
      body: JSON.stringify({ enabled }),
    }),

  listObjects: (ref: BucketRef, options: { prefix?: string; cursor?: string; recursive?: boolean; perPage?: number }) =>
    request<ObjectListing>(
      bucketPath(ref, "/objects", {
        prefix: options.prefix || undefined,
        cursor: options.cursor,
        recursive: options.recursive ? "1" : undefined,
        perPage: options.perPage ? String(options.perPage) : undefined,
      }),
    ),

  objectUrl: (ref: BucketRef, key: string, inline = false, version?: string, filename?: string) =>
    bucketPath(ref, filename ? `/object/${encodeURIComponent(filename)}` : "/object", {
      key,
      inline: inline ? "1" : undefined,
      v: version?.replace(/"/g, ""),
    }),

  createFolder: (ref: BucketRef, key: string) =>
    request<{ key: string }>(bucketPath(ref, "/folders"), { method: "POST", body: JSON.stringify({ key }) }),

  deleteObjects: (ref: BucketRef, keys: string[]) =>
    request<BatchResult>(bucketPath(ref, "/delete"), { method: "POST", body: JSON.stringify({ keys }) }),

  shareLink: (ref: BucketRef, key: string, expiresIn: number) =>
    request<{ url: string; expiresAt: string }>(bucketPath(ref, "/share"), {
      method: "POST",
      body: JSON.stringify({ key, expiresIn }),
    }),

  copyObject: (ref: BucketRef, from: string, to: string, move = false) =>
    request<{ key: string }>(bucketPath(ref, "/copy"), { method: "POST", body: JSON.stringify({ from, to, move }) }),

  upload(ref: BucketRef, key: string, file: Blob, contentType: string, onProgress: (loaded: number) => void, signal?: AbortSignal) {
    return sendBlob("PUT", bucketPath(ref, "/object", { key }), file, contentType, onProgress, signal);
  },

  createUpload: (ref: BucketRef, key: string, contentType: string) =>
    request<{ uploadId: string }>(bucketPath(ref, "/uploads", { key }), { method: "POST", body: JSON.stringify({ contentType }) }),

  async uploadPart(
    ref: BucketRef,
    key: string,
    uploadId: string,
    partNumber: number,
    part: Blob,
    onProgress: (loaded: number) => void,
    signal?: AbortSignal,
  ) {
    const url = bucketPath(ref, `/uploads/${encodeURIComponent(uploadId)}/parts/${partNumber}`, { key });
    const response = await sendBlob("PUT", url, part, "application/octet-stream", onProgress, signal);
    return (JSON.parse(response) as { etag: string }).etag;
  },

  completeUpload: (ref: BucketRef, key: string, uploadId: string, parts: { partNumber: number; etag: string }[]) =>
    request<{ key: string }>(bucketPath(ref, `/uploads/${encodeURIComponent(uploadId)}/complete`, { key }), {
      method: "POST",
      body: JSON.stringify({ parts }),
    }),

  abortUpload: (ref: BucketRef, key: string, uploadId: string) =>
    request<{ ok: boolean }>(bucketPath(ref, `/uploads/${encodeURIComponent(uploadId)}`, { key }), { method: "DELETE" }),
};

export async function listAllObjects(ref: BucketRef, prefix: string) {
  const objects: ObjectInfo[] = [];
  let cursor: string | undefined;
  do {
    const page = await api.listObjects(ref, { prefix, cursor, recursive: true, perPage: 1000 });
    objects.push(...page.objects);
    cursor = page.cursor ?? undefined;
  } while (cursor);
  return objects;
}

export async function listAll(ref: BucketRef, prefix: string) {
  return (await listAllObjects(ref, prefix)).map((o) => o.key);
}

export async function deleteKeys(ref: BucketRef, keys: string[], onProgress?: (done: number) => void) {
  const failed: BatchResult["failed"] = [];
  let done = 0;
  for (let i = 0; i < keys.length; i += DELETE_BATCH) {
    const result = await api.deleteObjects(ref, keys.slice(i, i + DELETE_BATCH));
    failed.push(...result.failed);
    done += result.succeeded.length + result.failed.length;
    onProgress?.(done);
  }
  return failed;
}
