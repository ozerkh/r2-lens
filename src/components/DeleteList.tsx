import { FolderSimpleIcon } from "@phosphor-icons/react";
import { baseName } from "../../shared/names";
import { formatBytes } from "../lib/format";
import { KIND_ICONS, kindOf } from "../lib/kinds";
import type { Item } from "./types";

const LIMIT = 5;

export function DeleteList({ items }: { items: Item[] }) {
  const shown = items.slice(0, LIMIT);
  return (
    <ul className="flex flex-col divide-y divide-kumo-hairline overflow-hidden rounded-md ring ring-kumo-hairline">
      {shown.map((item) => {
        const Icon = item.type === "folder" ? FolderSimpleIcon : KIND_ICONS[kindOf(item.object)];
        return (
          <li key={item.key} className="flex items-center gap-3 px-3 py-2 text-sm">
            <Icon size={16} weight={item.type === "folder" ? "fill" : "regular"} className={item.type === "folder" ? "shrink-0 text-kumo-brand" : "shrink-0 text-kumo-subtle"} />
            <span className="min-w-0 flex-1 truncate" title={item.key}>
              {baseName(item.key)}
            </span>
            <span className="shrink-0 text-xs text-kumo-subtle tabular-nums">
              {item.type === "folder" ? "Folder and its contents" : formatBytes(item.object.size)}
            </span>
          </li>
        );
      })}
      {items.length > shown.length && <li className="px-3 py-2 text-xs text-kumo-subtle">and {items.length - shown.length} more</li>}
    </ul>
  );
}
