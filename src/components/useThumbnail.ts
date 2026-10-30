import { useEffect, useState, type RefObject } from "react";
import type { ObjectInfo } from "../../shared/types";
import { api, type BucketRef } from "../api";
import { reserveApiCall } from "../lib/apiBudget";
import type { ThumbnailResponse } from "../lib/thumbnails.worker";

const CACHE_LIMIT = 500;
const cache = new Map<string, string>();

function remember(key: string, url: string) {
  cache.set(key, url);
  if (cache.size > CACHE_LIMIT) {
    const [oldKey, oldUrl] = cache.entries().next().value!;
    cache.delete(oldKey);
    URL.revokeObjectURL(oldUrl);
  }
}

let worker: Worker | null | undefined;
let nextId = 0;
const pending = new Map<number, (response: ThumbnailResponse) => void>();

function getWorker() {
  if (worker !== undefined) return worker;
  try {
    worker =
      typeof OffscreenCanvas === "undefined"
        ? null
        : new Worker(new URL("../lib/thumbnails.worker.ts", import.meta.url), { type: "module" });
  } catch {
    worker = null;
  }
  worker?.addEventListener("message", (event: MessageEvent<ThumbnailResponse>) => {
    const resolve = pending.get(event.data.id);
    pending.delete(event.data.id);
    resolve?.(event.data);
  });
  return worker;
}

export function useNearViewport(ref: RefObject<Element | null>, margin = "200px") {
  const [near, setNear] = useState(false);
  useEffect(() => {
    const node = ref.current;
    if (!node || near) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setNear(true);
          observer.disconnect();
        }
      },
      { rootMargin: margin },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [ref, margin, near]);
  return near;
}

type State = { url?: string; failed?: boolean; unsupported?: boolean };

export function useThumbnail(bucketRef: BucketRef, object: ObjectInfo, enabled: boolean, reserveCall: boolean): State {
  const cacheKey = JSON.stringify([bucketRef.accountId, bucketRef.jurisdiction, bucketRef.bucket, object.key, object.etag]);
  const [state, setState] = useState<State>(() => ({ url: cache.get(cacheKey) }));

  useEffect(() => {
    const cached = cache.get(cacheKey);
    if (cached) return setState({ url: cached });
    if (!enabled) return;
    const target = getWorker();
    if (!target) return setState({ unsupported: true });

    const id = ++nextId;
    const controller = new AbortController();
    pending.set(id, (response) => {
      if (!response.blob) return setState({ failed: true });
      const url = URL.createObjectURL(response.blob);
      remember(cacheKey, url);
      setState({ url });
    });
    const url = api.objectUrl(bucketRef, object.key, true, object.etag);
    (reserveCall ? reserveApiCall(controller.signal) : Promise.resolve()).then(
      () => !controller.signal.aborted && target.postMessage({ type: "load", id, url }),
      () => pending.delete(id),
    );
    return () => {
      controller.abort();
      if (pending.delete(id)) target.postMessage({ type: "cancel", id });
    };
  }, [cacheKey, enabled, reserveCall]);

  return state;
}
