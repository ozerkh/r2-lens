import { useKumoToastManager } from "@cloudflare/kumo";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ObjectInfo } from "../../shared/types";
import { api, type BucketRef } from "../api";

type Listing = { folders: string[]; objects: ObjectInfo[]; cursor: string | null };

const CACHE_LIMIT = 100;
const cache = new Map<string, Listing>();

function remember(key: string, listing: Listing) {
  cache.delete(key);
  cache.set(key, listing);
  if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value!);
}

export function useListing(bucketRef: BucketRef, prefix: string, onReset: () => void) {
  const toasts = useKumoToastManager();
  const [listing, setListing] = useState<Listing>({ folders: [], objects: [], cursor: null });
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string>();
  const requestId = useRef(0);
  const reset = useRef(onReset);
  reset.current = onReset;

  const load = useCallback(
    async (fromCache = false) => {
      const id = ++requestId.current;
      const key = JSON.stringify([bucketRef.accountId, bucketRef.jurisdiction, bucketRef.bucket, prefix]);
      const cached = fromCache ? cache.get(key) : undefined;
      setError(undefined);
      if (cached) {
        setListing(cached);
        reset.current();
        setLoading(false);
      } else {
        setLoading(true);
      }
      try {
        const page = await api.listObjects(bucketRef, { prefix });
        const fresh = { folders: page.prefixes, objects: page.objects, cursor: page.cursor };
        remember(key, fresh);
        if (id !== requestId.current) return;
        setListing(fresh);
        if (!cached) reset.current();
      } catch (err) {
        if (id !== requestId.current) return;
        if (cached) toasts.add({ title: "Could not refresh folder", description: (err as Error).message, variant: "error" });
        else setError((err as Error).message);
      } finally {
        if (id === requestId.current) setLoading(false);
      }
    },
    [bucketRef, prefix],
  );

  useEffect(() => {
    load(true);
  }, [load]);

  const loadMore = async () => {
    if (!listing.cursor) return;
    const id = requestId.current;
    setLoadingMore(true);
    try {
      const page = await api.listObjects(bucketRef, { prefix, cursor: listing.cursor });
      if (id !== requestId.current) return;
      setListing((current) => ({
        folders: Array.from(new Set([...current.folders, ...page.prefixes])),
        objects: [...current.objects, ...page.objects],
        cursor: page.cursor,
      }));
    } catch (err) {
      if (id === requestId.current) toasts.add({ title: "Could not load more", description: (err as Error).message, variant: "error" });
    } finally {
      setLoadingMore(false);
    }
  };

  return { ...listing, loading, loadingMore, error, load, loadMore };
}
