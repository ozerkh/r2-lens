import { cn, LayerCard, Table } from "@cloudflare/kumo";
import { CaretDownIcon, CaretUpIcon, FolderIcon } from "@phosphor-icons/react";
import { baseName } from "../../shared/names";
import { formatBytes, formatDate } from "../lib/format";
import { KIND_ICONS, kindOf } from "../lib/kinds";
import { isControl } from "../lib/dom";
import { useReadOnly } from "../lib/readOnly";
import { ItemMenu } from "./ItemMenu";
import type { Item, ItemActions, Sort, SortKey } from "./types";

type Props = {
  items: Item[];
  selected: Set<string>;
  activeKey?: string;
  sort: Sort;
  onSort: (key: SortKey) => void;
  onToggle: (key: string) => void;
  onToggleAll: () => void;
  actions: ItemActions;
};

function SortHead({ label, column, sort, onSort, className }: {
  label: string;
  column: SortKey;
  sort: Sort;
  onSort: (key: SortKey) => void;
  className?: string;
}) {
  const active = sort.key === column;
  const Icon = sort.direction === "asc" ? CaretUpIcon : CaretDownIcon;
  return (
    <Table.Head className={className}>
      <button type="button" className="inline-flex items-center gap-1 whitespace-nowrap" onClick={() => onSort(column)}>
        {label}
        {active && <Icon size={12} />}
      </button>
    </Table.Head>
  );
}

export function FileTable({ items, selected, activeKey, sort, onSort, onToggle, onToggleAll, actions }: Props) {
  const readOnly = useReadOnly();
  const allSelected = items.length > 0 && selected.size === items.length;
  return (
    <LayerCard className="overflow-x-auto p-0">
      <Table layout="auto" className="min-w-full">
        <Table.Header>
          <Table.Row>
            {!readOnly && (
              <Table.CheckHead
                checked={allSelected}
                indeterminate={selected.size > 0 && !allSelected}
                onCheckedChange={onToggleAll}
              />
            )}
            <SortHead label="Name" column="name" sort={sort} onSort={onSort} />
            <SortHead label="Size" column="size" sort={sort} onSort={onSort} className="w-28" />
            <Table.Head className="w-48">Type</Table.Head>
            <SortHead label="Last modified" column="modified" sort={sort} onSort={onSort} className="w-48" />
            <Table.Head className="w-12" />
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {items.map((item) => {
            const isSelected = selected.has(item.key);
            const Icon = item.type === "folder" ? FolderIcon : KIND_ICONS[kindOf(item.object)];
            return (
              <Table.Row
                key={item.key}
                variant={isSelected ? "selected" : "default"}
                className={cn(
                  "cursor-pointer",
                  item.key === activeKey && "bg-kumo-brand/10!",
                )}
                onClick={(event) => !isControl(event.target) && actions.open(item)}
              >
                {!readOnly && (
                  <Table.CheckCell
                    checked={isSelected}
                    onCheckedChange={() => onToggle(item.key)}
                    aria-label={`Select ${baseName(item.key)}`}
                  />
                )}
                <Table.Cell className="min-w-48">
                  <button
                    type="button"
                    className="flex max-w-96 min-w-0 items-center gap-2 text-left hover:underline"
                    onClick={() => actions.open(item)}
                  >
                    <Icon
                      size={18}
                      weight={item.type === "folder" ? "fill" : "regular"}
                      className={item.type === "folder" ? "shrink-0 text-kumo-brand" : "shrink-0 text-kumo-subtle"}
                    />
                    <span className="truncate">{baseName(item.key)}</span>
                  </button>
                </Table.Cell>
                <Table.Cell className="whitespace-nowrap text-kumo-subtle tabular-nums">
                  {item.type === "file" ? formatBytes(item.object.size) : "—"}
                </Table.Cell>
                <Table.Cell className="text-kumo-subtle">
                  <span className="block max-w-48 truncate" title={item.type === "file" ? item.object.httpMetadata?.contentType : undefined}>
                    {item.type === "file" ? (item.object.httpMetadata?.contentType ?? "—") : "Folder"}
                  </span>
                </Table.Cell>
                <Table.Cell className="whitespace-nowrap text-kumo-subtle">
                  {item.type === "file" ? formatDate(item.object.lastModified) : "—"}
                </Table.Cell>
                <Table.Cell onClick={(event) => event.stopPropagation()}>
                  <ItemMenu item={item} actions={actions} />
                </Table.Cell>
              </Table.Row>
            );
          })}
        </Table.Body>
      </Table>
    </LayerCard>
  );
}
