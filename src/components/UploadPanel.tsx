import { Button, LayerCard, Meter, useKumoToastManager } from "@cloudflare/kumo";
import { CheckCircleIcon, WarningCircleIcon, XIcon } from "@phosphor-icons/react";
import { useEffect, useRef } from "react";
import { baseName } from "../../shared/names";
import { formatBytes, plural } from "../lib/format";
import type { Upload } from "./useUploads";

type Props = { uploads: Upload[]; onCancel: (id: string) => void; onClear: () => void };

const UNCONFIRMED_WEIGHT = 0.9;

function progressPercent({ size, sent, stored }: Upload) {
  if (!size) return 0;
  return ((stored + (sent - stored) * UNCONFIRMED_WEIGHT) / size) * 100;
}

export function UploadPanel({ uploads, onCancel, onClear }: Props) {
  const toasts = useKumoToastManager();
  const active = uploads.filter((u) => u.status === "uploading" || u.status === "queued").length;
  const finished = uploads.length > 0 && active === 0;
  const reported = useRef(new Set<string>());

  useEffect(() => {
    if (!finished) return;
    const batch = uploads.filter((u) => !reported.current.has(u.id));
    batch.forEach((u) => reported.current.add(u.id));
    const done = batch.filter((u) => u.status === "done").length;
    const failed = batch.filter((u) => u.status === "error").length;
    if (failed) {
      toasts.add({ title: `${plural(failed, "file")} could not be uploaded`, description: done ? `${plural(done, "file")} uploaded.` : undefined, variant: "error" });
    } else if (done) {
      toasts.add({ title: `Uploaded ${plural(done, "file")}`, variant: "success" });
    }
    if (!failed) onClear();
  }, [finished]);

  if (uploads.length === 0) return null;
  return (
    <LayerCard className="fixed right-4 bottom-4 z-40 w-96 max-w-[calc(100vw-2rem)] shadow-lg">
      <LayerCard.Secondary className="flex items-center justify-between">
        <span>{active ? `Uploading ${plural(active, "file")}` : "Uploads complete"}</span>
        {!active && (
          <Button size="xs" variant="ghost" shape="square" icon={XIcon} aria-label="Dismiss" onClick={onClear} />
        )}
      </LayerCard.Secondary>
      <LayerCard.Primary className="flex max-h-72 flex-col gap-3 overflow-auto">
        {uploads.map((upload) => (
          <div key={upload.id} className="flex items-center gap-2">
            <div className="min-w-0 flex-1">
              {upload.status === "uploading" || upload.status === "queued" ? (
                <Meter
                  label={baseName(upload.key)}
                  value={progressPercent(upload)}
                  customValue={
                    upload.status === "uploading" && upload.sent >= upload.size
                      ? "Saving to R2…"
                      : `${formatBytes(upload.sent)} / ${formatBytes(upload.size)}`
                  }
                />
              ) : (
                <div className="flex items-center gap-2 text-sm">
                  {upload.status === "done" ? (
                    <CheckCircleIcon size={16} weight="fill" className="shrink-0 text-kumo-success" />
                  ) : (
                    <WarningCircleIcon size={16} weight="fill" className="shrink-0 text-kumo-danger" />
                  )}
                  <span className="truncate">{baseName(upload.key)}</span>
                  {upload.status !== "done" && (
                    <span className="ml-auto shrink-0 text-xs text-kumo-subtle">{upload.error ?? upload.status}</span>
                  )}
                </div>
              )}
            </div>
            {(upload.status === "uploading" || upload.status === "queued") && (
              <Button
                size="xs"
                variant="ghost"
                shape="square"
                icon={XIcon}
                aria-label="Cancel upload"
                onClick={() => onCancel(upload.id)}
              />
            )}
          </div>
        ))}
      </LayerCard.Primary>
    </LayerCard>
  );
}
