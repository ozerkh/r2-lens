import { Loader } from "@cloudflare/kumo";
import { FileIcon } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import type { ObjectInfo } from "../../shared/types";
import { api, type BucketRef } from "../api";
import {
  ENTRY_LIMIT,
  listTar,
  listZip,
  readGzipText,
  type ArchiveFormat,
  type ArchiveListing,
} from "../lib/archive";
import { formatBytes, plural } from "../lib/format";

type State =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "listing"; listing: ArchiveListing }
  | { status: "text"; text: string; truncated: boolean };

type Props = { bucketRef: BucketRef; object: ObjectInfo; format: ArchiveFormat; expanded?: boolean };

export function ArchivePreview({ bucketRef, object, format, expanded }: Props) {
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    const url = api.objectUrl(bucketRef, object.key, false, object.etag);
    setState({ status: "loading" });
    const task =
      format === "zip"
        ? listZip(url, object.size, controller.signal).then((listing) => ({ status: "listing" as const, listing }))
        : format === "gz"
          ? readGzipText(url, controller.signal).then((result) => ({ status: "text" as const, ...result }))
          : listTar(url, format === "tgz", controller.signal).then((listing) => ({ status: "listing" as const, listing }));
    task.then(
      (next) => !controller.signal.aborted && setState(next),
      (error: Error) => {
        if (!controller.signal.aborted) setState({ status: "error", message: error.message || "Could not read archive" });
      },
    );
    return () => controller.abort();
  }, [bucketRef, object.key, object.etag, object.size, format]);

  if (state.status === "loading") return <Loader size={24} />;
  if (state.status === "error") return <p className="px-4 text-center text-sm text-kumo-danger">{state.message}</p>;
  if (state.status === "text") {
    return (
      <pre
        className={`h-full w-full overflow-auto p-4 font-mono leading-relaxed whitespace-pre-wrap ${expanded ? "text-sm" : "text-xs"}`}
      >
        {state.text}
        {state.truncated && "\n\n… preview truncated"}
      </pre>
    );
  }

  const files = state.listing.entries.filter((entry) => !entry.directory);
  const total = files.reduce((sum, entry) => sum + entry.size, 0);
  const summary = [
    plural(files.length, "file"),
    `${formatBytes(total)} uncompressed`,
    state.listing.truncated && `first ${ENTRY_LIMIT.toLocaleString("en")} entries`,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="flex h-full w-full flex-col">
      <div className="shrink-0 border-b border-kumo-hairline px-4 py-2 text-xs text-kumo-subtle">{summary}</div>
      {files.length === 0 ? (
        <p className="m-auto text-sm text-kumo-subtle">This archive is empty.</p>
      ) : (
        <ul className={`min-h-0 flex-1 overflow-auto py-1 ${expanded ? "text-sm" : "text-xs"}`}>
          {files.map((entry, index) => (
            <li key={`${index}:${entry.path}`} className="flex items-center gap-2 px-4 py-1">
              <FileIcon size={14} className="shrink-0 text-kumo-subtle" />
              <span className="min-w-0 flex-1 truncate font-mono" title={entry.path}>
                {entry.path}
              </span>
              <span className="shrink-0 text-kumo-subtle tabular-nums">{formatBytes(entry.size)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
