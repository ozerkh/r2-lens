import { Banner, ClipboardText, Loader, Select } from "@cloudflare/kumo";
import { useEffect, useState } from "react";
import { SHARE_DURATIONS } from "../../shared/capabilities";
import { baseName } from "../../shared/names";
import { api, type BucketRef } from "../api";
import { formatDate } from "../lib/format";
import { Modal } from "./Modal";

const DURATION_ITEMS = SHARE_DURATIONS.map(({ seconds, label }) => ({ value: String(seconds), label }));
const DEFAULT_DURATION = SHARE_DURATIONS[0].seconds;

type Props = { bucketRef: BucketRef; objectKey: string | null; onOpenChange: (open: boolean) => void };

export function ShareDialog({ bucketRef, objectKey, onOpenChange }: Props) {
  const [duration, setDuration] = useState(DEFAULT_DURATION);
  const [link, setLink] = useState<{ url: string; expiresAt: string } | null>(null);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!objectKey) return;
    let cancelled = false;
    setLink(null);
    setError(undefined);
    api.shareLink(bucketRef, objectKey, duration).then(
      (result) => !cancelled && setLink(result),
      (err: Error) => !cancelled && setError(err.message),
    );
    return () => {
      cancelled = true;
    };
  }, [bucketRef, objectKey, duration]);

  return (
    <Modal
      open={objectKey !== null}
      onOpenChange={(open) => {
        if (!open) setDuration(DEFAULT_DURATION);
        onOpenChange(open);
      }}
      title="Share link"
      description={
        objectKey && (
          <>
            Anyone with the link can download <span className="font-medium text-kumo-default">{baseName(objectKey)}</span> until
            it expires.
          </>
        )
      }
    >
      <div className="flex flex-col gap-4">
        <Select
          label="Expires in"
          value={String(duration)}
          onValueChange={(value) => setDuration(Number(value) || DEFAULT_DURATION)}
          items={DURATION_ITEMS}
        />
        {error ? (
          <Banner variant="error" description={error} />
        ) : link ? (
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Link</span>
            <ClipboardText text={link.url} size="base" />
          </div>
        ) : (
          <div className="flex h-16 items-center justify-center">
            <Loader size={20} />
          </div>
        )}
        <p className="text-sm text-kumo-subtle">
          {link && `Expires ${formatDate(link.expiresAt)}. `}
          Revoking the API token you signed in with also ends the link.
        </p>
      </div>
    </Modal>
  );
}
