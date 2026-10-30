import { Badge, Button, Dialog, InlineCopyText, Loader, Table } from "@cloudflare/kumo";
import { ArrowsOutIcon, CheckIcon, DownloadSimpleIcon, LinkIcon, ShareNetworkIcon, XIcon } from "@phosphor-icons/react";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { REST_RANGE_SKIP_LIMIT } from "../../shared/capabilities";
import type { Backend, ObjectInfo } from "../../shared/types";
import { api, type BucketRef } from "../api";
import { recordApiCallsFrom } from "../lib/apiBudget";
import { archiveFormat, archiveSizeLimit } from "../lib/archive";
import { baseName } from "../../shared/names";
import { formatBytes, formatDate } from "../lib/format";
import { isSvg, KIND_ICONS, kindOf } from "../lib/kinds";
import { ArchivePreview } from "./ArchivePreview";
import { Lightbox } from "./Lightbox";
import { SVG_LIMIT, useSvgDataUrl } from "./useSvgDataUrl";

const TEXT_LIMIT = 1024 * 1024;
const WIDTH_KEY = "r2-lens-preview-width";
const DEFAULT_WIDTH = 448;
const MIN_WIDTH = 320;
const maxWidth = () => Math.max(MIN_WIDTH, Math.min(900, Math.round(window.innerWidth * 0.6)));
const clampWidth = (value: number) => Math.min(maxWidth(), Math.max(MIN_WIDTH, Math.round(value)));

function readWidth() {
  try {
    const saved = Number(localStorage.getItem(WIDTH_KEY));
    return saved ? clampWidth(saved) : DEFAULT_WIDTH;
  } catch {
    return DEFAULT_WIDTH;
  }
}

function saveWidth(value: number) {
  try {
    localStorage.setItem(WIDTH_KEY, String(value));
  } catch {}
}

function ResizeHandle({ width, onChange }: { width: number; onChange: (width: number, done: boolean) => void }) {
  const start = useRef<{ x: number; width: number } | null>(null);
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize preview"
      aria-valuenow={width}
      aria-valuemin={MIN_WIDTH}
      aria-valuemax={maxWidth()}
      tabIndex={0}
      className="absolute inset-y-0 -left-1 z-10 hidden w-2 cursor-col-resize touch-none outline-none after:absolute after:inset-y-0 after:left-1/2 after:w-px after:-translate-x-1/2 after:transition-colors hover:after:bg-kumo-brand focus-visible:after:bg-kumo-brand sm:block"
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        start.current = { x: event.clientX, width };
        document.body.style.userSelect = "none";
      }}
      onPointerMove={(event) => {
        if (start.current) onChange(clampWidth(start.current.width + start.current.x - event.clientX), false);
      }}
      onPointerUp={(event) => {
        if (!start.current) return;
        onChange(clampWidth(start.current.width + start.current.x - event.clientX), true);
        start.current = null;
        document.body.style.userSelect = "";
      }}
      onDoubleClick={() => onChange(DEFAULT_WIDTH, true)}
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft") onChange(clampWidth(width + 16), true);
        else if (event.key === "ArrowRight") onChange(clampWidth(width - 16), true);
        else return;
        event.preventDefault();
      }}
    />
  );
}
type Props = {
  bucketRef: BucketRef;
  backend: Backend;
  object: ObjectInfo;
  onClose: () => void;
  onDownload: (object: ObjectInfo) => void;
  onCopyLink?: (key: string) => Promise<boolean>;
  onShare?: (key: string) => void;
};

type Mode = "svg" | "image" | "video" | "audio" | "pdf" | "text" | "archive";

function previewMode(object: ObjectInfo): Mode | null {
  const kind = kindOf(object);
  if (isSvg(object)) return object.size <= SVG_LIMIT ? "svg" : null;
  if (kind === "image" || kind === "video" || kind === "audio") return kind;
  if (kind === "pdf") return "pdf";
  if (kind === "text" || kind === "code") return "text";
  const format = archiveFormat(object.key);
  if (format && object.size <= archiveSizeLimit(format)) return "archive";
  return null;
}

function useObjectText(bucketRef: BucketRef, object: ObjectInfo, mode: Mode | null) {
  const [state, setState] = useState<{ text?: string; error?: string; loading: boolean }>({ loading: false });
  useEffect(() => {
    if (mode !== "text") return;
    const controller = new AbortController();
    setState({ loading: true });
    const headers: HeadersInit = object.size > 0 ? { Range: `bytes=0-${TEXT_LIMIT - 1}` } : {};
    fetch(api.objectUrl(bucketRef, object.key, false, object.etag), { signal: controller.signal, headers })
      .then(async (response) => {
        recordApiCallsFrom(response.headers);
        if (!response.ok) throw new Error(`Failed to load (${response.status})`);
        const blob = await response.blob();
        setState({ text: await blob.slice(0, TEXT_LIMIT).text(), loading: false });
      })
      .catch((error: Error) => {
        if (error.name !== "AbortError") setState({ error: error.message, loading: false });
      });
    return () => controller.abort();
  }, [bucketRef, object, mode]);
  return state;
}

function ZoomableImage({ src, alt, className }: { src: string; alt: string; className: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" aria-label={`Enlarge ${alt}`} className="h-full w-full cursor-zoom-in" onClick={() => setOpen(true)}>
        <img src={src} alt={alt} className={className} />
      </button>
      {open && <Lightbox src={src} alt={alt} onClose={() => setOpen(false)} />}
    </>
  );
}

function SvgPreview({ bucketRef, object, expanded }: { bucketRef: BucketRef; object: ObjectInfo; expanded: boolean }) {
  const svg = useSvgDataUrl(bucketRef, object, true);
  if (svg.loading) return <Loader size={24} />;
  if (svg.error || !svg.url) return <p className="px-4 text-center text-sm text-kumo-danger">{svg.error}</p>;
  if (expanded) return <img src={svg.url} alt={baseName(object.key)} className="h-full w-full object-contain p-6" />;
  return <ZoomableImage src={svg.url} alt={baseName(object.key)} className="h-full w-full object-contain p-4" />;
}

type BodyProps = { bucketRef: BucketRef; backend: Backend; object: ObjectInfo; expanded?: boolean };

function Body({ bucketRef, backend, object, expanded = false }: BodyProps) {
  const mode = previewMode(object);
  const text = useObjectText(bucketRef, object, mode);
  const inlineUrl = api.objectUrl(bucketRef, object.key, true, object.etag);
  const name = baseName(object.key);

  if (mode === "svg") return <SvgPreview bucketRef={bucketRef} object={object} expanded={expanded} />;
  if (mode === "image") {
    if (expanded) return <img src={inlineUrl} alt={name} className="h-full w-full object-contain" />;
    return <ZoomableImage src={inlineUrl} alt={name} className="h-full w-full object-contain" />;
  }
  if (mode === "video") return <video src={inlineUrl} controls className="h-full w-full bg-black" />;
  if (mode === "audio") return <audio src={inlineUrl} controls className="w-full px-4" />;
  if (mode === "archive" && backend === "rest" && archiveFormat(object.key) === "zip" && object.size > REST_RANGE_SKIP_LIMIT) {
    return (
      <p className="px-6 text-center text-sm text-kumo-subtle">
        Listing zip files over {formatBytes(REST_RANGE_SKIP_LIMIT)} needs an API token sign-in or a Worker binding.
      </p>
    );
  }
  if (mode === "archive") {
    return <ArchivePreview bucketRef={bucketRef} object={object} format={archiveFormat(object.key)!} expanded={expanded} />;
  }
  if (mode === "pdf") {
    const pdfUrl = api.objectUrl(bucketRef, object.key, true, object.etag, name);
    return <iframe src={pdfUrl} title={name} className="h-full w-full bg-white" />;
  }
  if (mode === "text") {
    if (text.loading) return <Loader size={24} />;
    if (text.error) return <p className="px-4 text-center text-sm text-kumo-danger">{text.error}</p>;
    if (text.text === undefined) return null;
    return (
      <pre
        className={`h-full w-full overflow-auto p-4 font-mono leading-relaxed whitespace-pre-wrap ${expanded ? "text-sm" : "text-xs"}`}
      >
        {text.text}
        {object.size > TEXT_LIMIT && "\n\n… preview truncated"}
      </pre>
    );
  }
  const Icon = KIND_ICONS[kindOf(object)];
  return (
    <div className="flex flex-col items-center justify-center gap-3 text-kumo-subtle">
      <Icon size={56} />
      <p className="text-sm">No preview available for this file type.</p>
    </div>
  );
}

function ExpandedPreview({
  bucketRef,
  backend,
  object,
  onClose,
  onDownload,
}: {
  bucketRef: BucketRef;
  backend: Backend;
  object: ObjectInfo;
  onClose: () => void;
  onDownload: (object: ObjectInfo) => void;
}) {
  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog className="top-4 flex h-[calc(100dvh-2rem)] flex-col p-0 sm:top-6 sm:h-[calc(100dvh-3rem)] sm:w-[min(100rem,calc(100vw-3rem))] sm:max-w-none">
        <div className="flex items-center justify-between gap-4 border-b border-kumo-hairline px-4 py-3">
          <Dialog.Title className="min-w-0 truncate font-semibold">{baseName(object.key)}</Dialog.Title>
          <div className="flex shrink-0 items-center gap-2">
            <Button size="sm" icon={DownloadSimpleIcon} onClick={() => onDownload(object)}>
              Download
            </Button>
            <Dialog.Close
              render={(props) => (
                <Button {...props} variant="ghost" size="sm" shape="square" icon={XIcon} aria-label="Close" />
              )}
            />
          </div>
        </div>
        <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-kumo-recessed">
          <Body bucketRef={bucketRef} backend={backend} object={object} expanded />
        </div>
      </Dialog>
    </Dialog.Root>
  );
}

export function PreviewPanel({ bucketRef, backend, object, onClose, onDownload, onCopyLink, onShare }: Props) {
  const [width, setWidth] = useState(readWidth);
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const mode = previewMode(object);
  const canExpand = mode !== null && mode !== "audio";

  useEffect(() => {
    setExpanded(false);
    setCopied(false);
  }, [object.key]);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);
  const copyLink = async () => {
    if (onCopyLink && (await onCopyLink(object.key))) setCopied(true);
  };  const resize = (next: number, done: boolean) => {
    setWidth(next);
    if (done) saveWidth(next);
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (document.querySelector('[role="dialog"], [role="alertdialog"], [role="menu"]')) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable]")) return;
      onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const metadata: [string, string][] = [
    ["Key", object.key],
    ["Size", `${formatBytes(object.size)} (${object.size.toLocaleString("en")} bytes)`],
    ["Content type", object.httpMetadata?.contentType ?? "—"],
    ["Last modified", formatDate(object.lastModified)],
    ["ETag", object.etag ?? "—"],
    ["Storage class", object.storageClass ?? "Standard"],
    ...Object.entries(object.httpMetadata ?? {})
      .filter(([name]) => name !== "contentType")
      .map(([name, value]) => [name, String(value)] as [string, string]),
    ...Object.entries(object.customMetadata ?? {}).map(([name, value]) => [`x-amz-meta-${name}`, value] as [string, string]),
  ];

  return (
    <aside
      aria-label="File preview"
      style={{ "--panel-width": `${width}px` } as CSSProperties}
      className="absolute inset-y-0 right-0 z-20 flex w-full flex-col bg-kumo-base shadow-xl sm:w-(--panel-width) sm:border-l sm:border-kumo-hairline lg:relative lg:shrink-0 lg:shadow-none"
    >
      <ResizeHandle width={width} onChange={resize} />
      <div className="flex items-center justify-between gap-4 border-b border-kumo-hairline px-4 py-3">
        <h2 className="min-w-0 truncate font-semibold" title={baseName(object.key)}>
          {baseName(object.key)}
        </h2>
        <div className="flex shrink-0 items-center">
          {canExpand && (
            <Button
              variant="ghost"
              size="sm"
              shape="square"
              icon={ArrowsOutIcon}
              aria-label="Expand preview"
              title="Expand preview"
              onClick={() => setExpanded(true)}
            />
          )}
          <Button variant="ghost" size="sm" shape="square" icon={XIcon} aria-label="Close preview" onClick={onClose} />
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-4 [scrollbar-gutter:stable]">
        <div className="flex aspect-[4/3] w-full shrink-0 items-center justify-center overflow-hidden rounded-md bg-kumo-recessed">
          {expanded ? (
            <Button size="sm" icon={ArrowsOutIcon} onClick={() => setExpanded(true)}>
              Showing in expanded view
            </Button>
          ) : (
            <Body key={object.key} bucketRef={bucketRef} backend={backend} object={object} />
          )}
        </div>
        {(object.ssec || object.storageClass === "InfrequentAccess") && (
          <div className="flex flex-wrap gap-2">
            {object.ssec && <Badge variant="warning">SSE-C encrypted</Badge>}
            {object.storageClass === "InfrequentAccess" && (
              <span title="Reading Infrequent Access objects, including previews, is billed per GB">
                <Badge variant="info">Infrequent Access</Badge>
              </span>
            )}
          </div>
        )}
        <div className="shrink-0 overflow-hidden rounded-md ring ring-kumo-hairline">
          <Table layout="fixed">
            <Table.Body>
              {metadata.map(([name, value]) => (
                <Table.Row key={name}>
                  <Table.Cell className="w-32 text-kumo-subtle">{name}</Table.Cell>
                  <Table.Cell className="font-mono text-xs break-all">
                    {name === "Key" ? (
                      <InlineCopyText variant="mono" labels={{ copyAction: "Copy key" }}>
                        {value}
                      </InlineCopyText>
                    ) : (
                      value
                    )}
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
        </div>
      </div>
      <div className="flex gap-2 border-t border-kumo-hairline px-4 py-3">
        {onShare && (
          <Button size="sm" variant="ghost" icon={ShareNetworkIcon} onClick={() => onShare(object.key)}>
            Share
          </Button>
        )}
        <span className="flex-1" />
        {onCopyLink && (
          <Button size="sm" icon={copied ? CheckIcon : LinkIcon} onClick={copyLink}>
            {copied ? "Copied" : "Copy link"}
          </Button>
        )}
        <Button size="sm" variant="primary" icon={DownloadSimpleIcon} onClick={() => onDownload(object)}>
          Download
        </Button>
      </div>
      {expanded && (
        <ExpandedPreview
          key={object.key}
          bucketRef={bucketRef}
          backend={backend}
          object={object}
          onClose={() => setExpanded(false)}
          onDownload={onDownload}
        />
      )}
    </aside>
  );
}
