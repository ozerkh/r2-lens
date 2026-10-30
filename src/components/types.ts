import type { ObjectInfo } from "../../shared/types";

export type Item = { type: "folder"; key: string } | { type: "file"; key: string; object: ObjectInfo };

export type SortKey = "name" | "size" | "modified";
export type Sort = { key: SortKey; direction: "asc" | "desc" };

export type ItemActions = {
  open: (item: Item) => void;
  download: (item: Item) => void;
  rename: (item: Item) => void;
  remove: (items: Item[]) => void;
  copyKey: (item: Item) => void;
  copyLink?: (item: Item) => void;
  share?: (item: Item) => void;
};
