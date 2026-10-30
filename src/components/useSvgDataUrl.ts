import { useEffect, useState } from "react";
import type { ObjectInfo } from "../../shared/types";
import { api, type BucketRef } from "../api";
import { recordApiCallsFrom, reserveApiCall } from "../lib/apiBudget";

export const SVG_LIMIT = 2 * 1024 * 1024;

export function useSvgDataUrl(
  bucketRef: BucketRef,
  object: Pick<ObjectInfo, "key" | "etag">,
  enabled: boolean,
  reserveCall = false,
) {
  const { key, etag } = object;
  const [state, setState] = useState<{ url?: string; error?: string; loading: boolean }>({ loading: enabled });
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    setState({ loading: true });
    (reserveCall ? reserveApiCall(controller.signal) : Promise.resolve())
      .then(() => fetch(api.objectUrl(bucketRef, key, false, etag), { signal: controller.signal }))
      .then(async (response) => {
        if (!reserveCall) recordApiCallsFrom(response.headers);
        if (!response.ok) throw new Error(`Failed to load (${response.status})`);
        const blob = await response.blob();
        if (blob.size > SVG_LIMIT) throw new Error("SVG is too large to preview");
        const url = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = () => reject(new Error("Could not read SVG"));
          reader.readAsDataURL(new Blob([blob], { type: "image/svg+xml" }));
        });
        if (!controller.signal.aborted) setState({ url, loading: false });
      })
      .catch((error: Error) => {
        if (error.name !== "AbortError") setState({ error: error.message, loading: false });
      });
    return () => controller.abort();
  }, [bucketRef, key, etag, enabled, reserveCall]);
  return state;
}
