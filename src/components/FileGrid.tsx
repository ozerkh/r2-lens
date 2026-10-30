import { Checkbox, cn } from "@cloudflare/kumo";
import { FolderIcon } from "@phosphor-icons/react";
import { useRef, useState } from "react";
import type { ObjectInfo } from "../../shared/types";
import type { BucketRef } from "../api";
import { api } from "../api";
import { baseName } from "../../shared/names";
import { formatBytes } from "../lib/format";
import { canThumbnail, isSvg, KIND_ICONS, kindOf } from "../lib/kinds";
import { isControl } from "../lib/dom";
import { useReadOnly } from "../lib/readOnly";
import { ItemMenu } from "./ItemMenu";
import type { Item, ItemActions } from "./types";
import { SVG_LIMIT, useSvgDataUrl } from "./useSvgDataUrl";
import { useNearViewport, useThumbnail } from "./useThumbnail";

type Props = {
  bucketRef: BucketRef;
  reserveCalls: boolean;
  items: Item[];
  selected: Set<string>;
  activeKey?: string;
  columns: number;
  onToggle: (key: string) => void;
  actions: ItemActions;
};

type ThumbnailProps = { bucketRef: BucketRef; object: ObjectInfo; reserveCalls: boolean };

function SvgThumbnail({ bucketRef, object, reserveCalls }: ThumbnailProps) {
  const ref = useRef<HTMLDivElement>(null);
  const svg = useSvgDataUrl(bucketRef, object, useNearViewport(ref), reserveCalls);
  const Icon = KIND_ICONS.image;
  return (
    <div ref={ref} className="flex h-full w-full items-center justify-center">
      {svg.url ? <img src={svg.url} alt="" className="h-full w-full object-contain p-3" /> : <Icon size={48} className="text-kumo-subtle" />}
    </div>
  );
}

function ImageThumbnail({ bucketRef, object, reserveCalls }: ThumbnailProps) {
  const ref = useRef<HTMLDivElement>(null);
  const thumbnail = useThumbnail(bucketRef, object, useNearViewport(ref), reserveCalls);
  const [failed, setFailed] = useState(false);
  const Icon = KIND_ICONS.image;
  let content = <Icon size={48} className="text-kumo-subtle" />;
  if (thumbnail.url) {
    content = <img src={thumbnail.url} alt="" decoding="async" className="h-full w-full object-cover" />;
  } else if (thumbnail.unsupported && !failed) {
    content = (
      <img
        src={api.objectUrl(bucketRef, object.key, true, object.etag)}
        alt=""
        loading="lazy"
        decoding="async"
        onError={() => setFailed(true)}
        className="h-full w-full object-cover"
      />
    );
  }
  return (
    <div ref={ref} className="flex h-full w-full items-center justify-center">
      {content}
    </div>
  );
}

function Thumbnail({ bucketRef, item, reserveCalls }: { bucketRef: BucketRef; item: Item; reserveCalls: boolean }) {
  if (item.type === "folder") {
    return <FolderIcon size={56} weight="fill" className="text-kumo-brand" />;
  }
  if (isSvg(item.object) && item.object.size <= SVG_LIMIT) {
    return <SvgThumbnail bucketRef={bucketRef} object={item.object} reserveCalls={reserveCalls} />;
  }
  if (canThumbnail(item.object)) {
    return <ImageThumbnail bucketRef={bucketRef} object={item.object} reserveCalls={reserveCalls} />;
  }
  const Icon = KIND_ICONS[kindOf(item.object)];
  return <Icon size={48} className="text-kumo-subtle" />;
}

export function FileGrid({ bucketRef, reserveCalls, items, selected, activeKey, columns, onToggle, actions }: Props) {
  const readOnly = useReadOnly();
  return (
    <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
      {items.map((item) => {
        const isSelected = selected.has(item.key);
        const isActive = item.key === activeKey;
        return (
          <div
            key={item.key}
            data-item
            className={cn(
              "group relative flex cursor-pointer flex-col overflow-hidden rounded-lg bg-kumo-base ring ring-kumo-hairline transition hover:ring-kumo-line",
              isActive && "bg-kumo-brand/10! ring-2 ring-kumo-brand shadow-md hover:ring-kumo-brand",
              isSelected && "ring-2 ring-kumo-brand hover:ring-kumo-brand",
            )}
            onClick={(event) => !isControl(event.target) && actions.open(item)}
          >
            <button
              type="button"
              className="flex aspect-[4/3] items-center justify-center overflow-hidden bg-kumo-recessed"
              onClick={() => actions.open(item)}
              aria-label={`Open ${baseName(item.key)}`}
            >
              <Thumbnail bucketRef={bucketRef} item={item} reserveCalls={reserveCalls} />
            </button>
            <div className="flex items-center gap-1 px-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium" title={baseName(item.key)}>
                  {baseName(item.key)}
                </p>
                <p className="text-xs text-kumo-subtle">
                  {item.type === "file" ? formatBytes(item.object.size) : "Folder"}
                </p>
              </div>
              <ItemMenu item={item} actions={actions} />
            </div>
            {!readOnly && (
              <div
                className={cn(
                  "absolute top-2 left-2 flex opacity-0 drop-shadow-sm transition group-hover:opacity-100",
                  isSelected && "opacity-100",
                )}
              >
                <Checkbox
                  checked={isSelected}
                  onCheckedChange={() => onToggle(item.key)}
                  aria-label={`Select ${baseName(item.key)}`}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
