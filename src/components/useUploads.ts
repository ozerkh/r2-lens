import { createContext, useCallback, useContext, useRef, useState } from "react";
import { CAPABILITIES, partSizeFor, uploadLimit, usesParts } from "../../shared/capabilities";
import type { Backend } from "../../shared/types";
import { api, type BucketRef } from "../api";
import { reserveApiCall } from "../lib/apiBudget";
import { formatBytes } from "../lib/format";
import { guessContentType } from "../lib/kinds";

const CONCURRENCY = 3;
const PART_CONCURRENCY = 3;

type UploadStatus = "queued" | "uploading" | "done" | "error" | "cancelled";

export type Upload = {
  id: string;
  key: string;
  size: number;
  sent: number;
  stored: number;
  status: UploadStatus;
  error?: string;
};

export type PendingFile = { file: File; path: string };

export const UPLOADED_EVENT = "r2-lens:uploaded";

export function sameBucket(a: BucketRef, b: BucketRef) {
  return a.accountId === b.accountId && a.bucket === b.bucket && a.jurisdiction === b.jurisdiction;
}

type Progress = { sent: number; stored: number };

async function uploadInParts(
  ref: BucketRef,
  key: string,
  file: File,
  onProgress: (progress: Progress) => void,
  signal: AbortSignal,
) {
  const { uploadId } = await api.createUpload(ref, key, guessContentType(file));
  const partsController = new AbortController();
  const stop = () => partsController.abort();
  signal.addEventListener("abort", stop);
  if (signal.aborted) stop();
  const partSize = partSizeFor(file.size);
  const count = Math.ceil(file.size / partSize);
  const sent = new Array<number>(count).fill(0);
  let stored = 0;
  const report = () => onProgress({ sent: sent.reduce((sum, value) => sum + value, 0), stored });
  const parts: { partNumber: number; etag: string }[] = [];
  let next = 0;
  const worker = async () => {
    while (next < count && !partsController.signal.aborted) {
      const index = next++;
      const blob = file.slice(index * partSize, Math.min(file.size, (index + 1) * partSize));
      const etag = await api.uploadPart(ref, key, uploadId, index + 1, blob, (bytes) => {
        sent[index] = bytes;
        report();
      }, partsController.signal);
      parts.push({ partNumber: index + 1, etag });
      sent[index] = blob.size;
      stored += blob.size;
      report();
    }
  };
  try {
    await Promise.all(Array.from({ length: Math.min(PART_CONCURRENCY, count) }, worker));
    if (signal.aborted) throw new Error("Upload cancelled");
    await api.completeUpload(ref, key, uploadId, parts);
  } catch (error) {
    stop();
    await api.abortUpload(ref, key, uploadId).catch(() => undefined);
    throw error;
  } finally {
    signal.removeEventListener("abort", stop);
  }
}

export function useUploads() {
  const [uploads, setUploads] = useState<Upload[]>([]);
  const controllers = useRef(new Map<string, AbortController>());

  const patch = useCallback((id: string, changes: Partial<Upload>) => {
    setUploads((current) => current.map((u) => (u.id === id ? { ...u, ...changes } : u)));
  }, []);

  const start = useCallback(
    async (bucketRef: BucketRef, backend: Backend, files: PendingFile[], prefix: string) => {
      const limit = uploadLimit(backend);
      const jobs = files.map(({ file, path }) => ({
        file,
        upload: {
          id: crypto.randomUUID(),
          key: `${prefix}${path}`,
          size: file.size,
          sent: 0,
          stored: 0,
          status: file.size > limit ? "error" : "queued",
          error: file.size > limit ? `Larger than ${formatBytes(limit)}` : undefined,
        } satisfies Upload as Upload,
      }));
      setUploads((current) => [...current.filter((u) => u.status !== "done"), ...jobs.map((j) => j.upload)]);

      const queue = jobs.filter((j) => j.upload.status === "queued");
      for (const job of queue) controllers.current.set(job.upload.id, new AbortController());
      const worker = async () => {
        for (let job = queue.shift(); job; job = queue.shift()) {
          const { id, key } = job.upload;
          const controller = controllers.current.get(id);
          if (!controller || controller.signal.aborted) {
            controllers.current.delete(id);
            continue;
          }
          patch(id, { status: "uploading" });
          const onProgress = (progress: Progress) => patch(id, progress);
          try {
            if (usesParts(backend, job.file.size)) {
              await uploadInParts(bucketRef, key, job.file, onProgress, controller.signal);
            } else {
              if (CAPABILITIES[backend].usesApiBudget) await reserveApiCall(controller.signal);
              const onSent = (sent: number) => onProgress({ sent, stored: 0 });
              await api.upload(bucketRef, key, job.file, guessContentType(job.file), onSent, controller.signal);
            }
            patch(id, { status: "done", sent: job.file.size, stored: job.file.size });
          } catch (error) {
            const cancelled = controller.signal.aborted;
            patch(id, { status: cancelled ? "cancelled" : "error", error: cancelled ? undefined : (error as Error).message });
          } finally {
            controllers.current.delete(id);
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));
      if (jobs.length) window.dispatchEvent(new CustomEvent<BucketRef>(UPLOADED_EVENT, { detail: bucketRef }));
    },
    [patch],
  );

  const cancel = useCallback((id: string) => {
    controllers.current.get(id)?.abort();
    setUploads((current) => current.map((u) => (u.id === id && u.status === "queued" ? { ...u, status: "cancelled" } : u)));
  }, []);

  const clear = useCallback(() => {
    setUploads((current) => current.filter((u) => u.status === "uploading" || u.status === "queued"));
  }, []);

  return { uploads, start, cancel, clear };
}

export const UploadsContext = createContext<ReturnType<typeof useUploads> | null>(null);

export function useUploadQueue() {
  const queue = useContext(UploadsContext);
  if (!queue) throw new Error("useUploadQueue must be used inside UploadsContext");
  return queue;
}

type Entry = {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  file?: (success: (file: File) => void, failure: (error: Error) => void) => void;
  createReader?: () => { readEntries: (success: (entries: Entry[]) => void, failure: (error: Error) => void) => void };
};

async function walk(entry: Entry, path: string, out: PendingFile[]) {
  if (entry.isFile && entry.file) {
    const file = await new Promise<File>((resolve, reject) => entry.file!(resolve, reject));
    out.push({ file, path: `${path}${file.name}` });
    return;
  }
  if (entry.isDirectory && entry.createReader) {
    const reader = entry.createReader();
    for (;;) {
      const batch = await new Promise<Entry[]>((resolve, reject) => reader.readEntries(resolve, reject));
      if (batch.length === 0) break;
      for (const child of batch) await walk(child, `${path}${entry.name}/`, out);
    }
  }
}

export async function filesFromDrop(dataTransfer: DataTransfer): Promise<PendingFile[]> {
  const entries = Array.from(dataTransfer.items)
    .map((item) => (item.webkitGetAsEntry?.() as Entry | null) ?? null)
    .filter((entry): entry is Entry => entry !== null);
  if (entries.length === 0) {
    return Array.from(dataTransfer.files).map((file) => ({ file, path: file.name }));
  }
  const out: PendingFile[] = [];
  for (const entry of entries) await walk(entry, "", out);
  return out;
}

export function filesFromInput(list: FileList | null): PendingFile[] {
  return Array.from(list ?? []).map((file) => ({ file, path: file.webkitRelativePath || file.name }));
}
