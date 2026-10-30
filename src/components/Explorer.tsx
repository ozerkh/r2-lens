import { Banner, Button, DropdownMenu, Empty, Input, Loader, Tabs, useKumoToastManager } from "@cloudflare/kumo";
import {
  ArrowClockwiseIcon,
  CaretDownIcon,
  FolderPlusIcon,
  FolderSimpleIcon,
  GearSixIcon,
  ListIcon,
  MagnifyingGlassIcon,
  SquaresFourIcon,
  TrashIcon,
  UploadSimpleIcon,
} from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { CAPABILITIES } from "../../shared/capabilities";
import { baseName } from "../../shared/names";
import type { Backend, ObjectInfo } from "../../shared/types";
import { api, type BucketRef } from "../api";
import { useApiBudgetExhausted } from "../lib/apiBudget";
import { isControl } from "../lib/dom";
import { plural } from "../lib/format";
import { deleteItems, renameItem } from "../lib/objectActions";
import { useReadOnly } from "../lib/readOnly";
import { navigate } from "../lib/route";
import { BucketSettingsDialog } from "./BucketSettingsDialog";
import { ConfirmDialog } from "./ConfirmDialog";
import { DeleteList } from "./DeleteList";
import { FileGrid } from "./FileGrid";
import { FileTable } from "./FileTable";
import { FolderBreadcrumbs } from "./FolderBreadcrumbs";
import { SidebarToggle } from "./MobileSidebar";
import { PreviewPanel } from "./PreviewPanel";
import { PromptDialog } from "./PromptDialog";
import { ShareDialog } from "./ShareDialog";
import type { Item, ItemActions, Sort, SortKey } from "./types";
import { useGridColumns } from "./useGridColumns";
import { useListing } from "./useListing";
import { filesFromDrop, filesFromInput, sameBucket, UPLOADED_EVENT, useUploadQueue, type PendingFile } from "./useUploads";

type View = "list" | "grid";
const VIEW_KEY = "r2-lens-view";

type Props = { bucketRef: BucketRef; backend: Backend; prefix: string; onBucketDeleted: () => void };

function readView(): View {
  try {
    return localStorage.getItem(VIEW_KEY) === "grid" ? "grid" : "list";
  } catch {
    return "list";
  }
}

function validName(value: string) {
  if (value.includes("/")) return "Names cannot contain /";
  if (value === "." || value === "..") return "Invalid name";
  return undefined;
}

function compare(a: Item, b: Item, sort: Sort) {
  if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
  let result = 0;
  if (sort.key === "size" && a.type === "file" && b.type === "file") result = a.object.size - b.object.size;
  else if (sort.key === "modified" && a.type === "file" && b.type === "file")
    result = (a.object.lastModified ?? "").localeCompare(b.object.lastModified ?? "");
  else result = baseName(a.key).localeCompare(baseName(b.key), undefined, { numeric: true, sensitivity: "base" });
  return sort.direction === "asc" ? result : -result;
}

export function Explorer({ bucketRef, backend, prefix, onBucketDeleted }: Props) {
  const capabilities = CAPABILITIES[backend];
  const budgetExhausted = useApiBudgetExhausted();
  const toasts = useKumoToastManager();
  const readOnly = useReadOnly();
  const uploads = useUploadQueue();

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [view, setView] = useState<View>(readView);
  const [filter, setFilter] = useState("");
  const [sort, setSort] = useState<Sort>({ key: "name", direction: "asc" });
  const [dragging, setDragging] = useState(false);
  const [preview, setPreview] = useState<ObjectInfo | null>(null);
  const [activeKey, setActiveKey] = useState<string>();
  const [renaming, setRenaming] = useState<Item | null>(null);
  const [removing, setRemoving] = useState<Item[] | null>(null);
  const [sharing, setSharing] = useState<string | null>(null);
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [publicUrl, setPublicUrl] = useState<string | null>(null);

  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const listing = useRef<HTMLElement>(null);
  const columns = useGridColumns(content, listing);
  const { folders, objects, cursor, loading, loadingMore, error, load, loadMore } = useListing(bucketRef, prefix, () =>
    setSelected(new Set()),
  );

  const closePreview = () => {
    setPreview(null);
    setActiveKey(undefined);
  };

  useEffect(() => {
    setFilter("");
    closePreview();
  }, [bucketRef, prefix]);

  useEffect(() => {
    if (!preview) return;
    const current = objects.find((o) => o.key === preview.key);
    if (!current) setPreview(null);
    else if (current.etag !== preview.etag) setPreview(current);
  }, [objects, preview]);

  useEffect(() => {
    const onUploaded = (event: Event) => {
      if (sameBucket((event as CustomEvent<BucketRef>).detail, bucketRef)) load();
    };
    window.addEventListener(UPLOADED_EVENT, onUploaded);
    return () => window.removeEventListener(UPLOADED_EVENT, onUploaded);
  }, [bucketRef, load]);

  useEffect(() => {
    if (settingsOpen || !capabilities.bucketSettings) return;
    let cancelled = false;
    api.publicUrl(bucketRef).then(
      ({ url }) => !cancelled && setPublicUrl(url),
      () => !cancelled && setPublicUrl(null),
    );
    return () => {
      cancelled = true;
    };
  }, [bucketRef, settingsOpen, capabilities.bucketSettings]);

  const items = useMemo(() => {
    const query = filter.trim().toLowerCase();
    const all: Item[] = [
      ...folders.map((key) => ({ type: "folder" as const, key })),
      ...objects.filter((o) => o.key !== prefix).map((object) => ({ type: "file" as const, key: object.key, object })),
    ];
    return all
      .filter((item) => !query || baseName(item.key).toLowerCase().includes(query))
      .sort((a, b) => compare(a, b, sort));
  }, [folders, objects, prefix, filter, sort]);
  const selectedItems = items.filter((item) => selected.has(item.key));

  const upload = (files: PendingFile[]) => uploads.start(bucketRef, backend, files, prefix);

  const pickFiles = (event: ChangeEvent<HTMLInputElement>) => {
    upload(filesFromInput(event.target.files));
    event.target.value = "";
  };

  const onDrop = async (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    if (readOnly) return;
    const files = await filesFromDrop(event.dataTransfer);
    if (files.length) upload(files);
  };

  const changeView = (next: string) => {
    const value = next === "grid" ? "grid" : "list";
    setView(value);
    try {
      localStorage.setItem(VIEW_KEY, value);
    } catch {}
  };

  const toggle = (key: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const toggleAll = () =>
    setSelected((current) => (current.size === items.length ? new Set() : new Set(items.map((i) => i.key))));

  const onSort = (key: SortKey) =>
    setSort((current) => ({ key, direction: current.key === key && current.direction === "asc" ? "desc" : "asc" }));

  const download = (object: Pick<ObjectInfo, "key" | "etag">) => {
    const link = document.createElement("a");
    link.href = api.objectUrl(bucketRef, object.key, false, object.etag);
    link.download = baseName(object.key);
    document.body.append(link);
    link.click();
    link.remove();
  };

  const copyText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      toasts.add({ title: "Could not copy to the clipboard", description: text, variant: "error" });
      return false;
    }
  };

  const copyLink = publicUrl
    ? (key: string) => copyText(`${publicUrl}/${key.split("/").map(encodeURIComponent).join("/")}`)
    : undefined;
  const share = capabilities.shareLinks ? setSharing : undefined;

  const actions: ItemActions = {
    open: (item) => {
      if (item.type === "folder") return navigate({ ...bucketRef, prefix: item.key });
      setActiveKey(item.key);
      setPreview(item.object);
    },
    download: (item) => item.type === "file" && download(item.object),
    rename: setRenaming,
    remove: setRemoving,
    copyKey: (item) => copyText(item.key),
    copyLink: copyLink && ((item) => copyLink(item.key)),
    share: share && ((item) => share(item.key)),
  };

  const rename = async (name: string) => {
    if (!renaming || name === baseName(renaming.key)) return;
    try {
      await renameItem(bucketRef, backend, renaming, name);
    } finally {
      load();
    }
    toasts.add({ title: "Renamed", description: name, variant: "success" });
  };

  const remove = async () => {
    if (!removing) return;
    const { deleted, failed } = await deleteItems(bucketRef, backend, removing);
    if (failed.length) {
      toasts.add({ title: `${plural(failed.length, "object")} could not be deleted`, description: failed[0].error, variant: "error" });
    } else {
      toasts.add({ title: `Deleted ${plural(deleted, "object")}`, variant: "success" });
    }
    setRemoving(null);
    load();
  };

  const bucketTools = (
    <div className="flex shrink-0 items-center">
      <Button variant="ghost" shape="square" icon={ArrowClockwiseIcon} aria-label="Refresh" onClick={() => load()} />
      {capabilities.bucketSettings && (
        <Button variant="ghost" shape="square" icon={GearSixIcon} aria-label="Bucket settings" onClick={() => setSettingsOpen(true)} />
      )}
    </div>
  );

  const createActions = (
    <>
      <Button icon={FolderPlusIcon} className="justify-center" onClick={() => setCreatingFolder(true)}>
        New folder
      </Button>
      <DropdownMenu>
        <DropdownMenu.Trigger
          render={
            <Button variant="primary" icon={UploadSimpleIcon} className="justify-center">
              Upload
              <CaretDownIcon size={12} />
            </Button>
          }
        />
        <DropdownMenu.Content>
          <DropdownMenu.Item icon={UploadSimpleIcon} onClick={() => fileInput.current?.click()}>
            Files
          </DropdownMenu.Item>
          <DropdownMenu.Item icon={FolderSimpleIcon} onClick={() => folderInput.current?.click()}>
            Folder
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu>
    </>
  );

  return (
    <div
      className="relative flex min-h-0 flex-1 flex-col"
      onDragEnter={(event) => {
        if (!readOnly && event.dataTransfer.types.includes("Files")) setDragging(true);
      }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false);
      }}
      onDrop={onDrop}
    >
      <header className="flex h-[58px] shrink-0 items-center gap-2 border-b border-kumo-line bg-kumo-base px-2 sm:gap-3 md:px-4">
        <SidebarToggle />
        <div className="relative min-w-0 flex-1 md:max-w-md">
          <MagnifyingGlassIcon size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-kumo-subtle" />
          <Input
            aria-label="Filter"
            placeholder="Filter this folder"
            value={filter}
            onChange={(event) => {
              setFilter(event.target.value);
              setSelected(new Set());
            }}
            className="w-full pl-9"
          />
        </div>
        <div className="ml-auto hidden shrink-0 items-center gap-2 md:flex">
          {!readOnly && createActions}
          {bucketTools}
        </div>
      </header>

      <div className="flex items-center gap-2 border-b border-kumo-hairline px-3 py-2 md:hidden">
        <div className="flex flex-1 items-center gap-2 [&>*]:flex-1">{!readOnly && createActions}</div>
        {bucketTools}
      </div>

      <div className="flex items-center gap-2 border-b border-kumo-hairline px-2 md:px-4">
        <FolderBreadcrumbs bucketRef={bucketRef} prefix={prefix} />
        <div className="flex shrink-0 items-center gap-2 py-2">
          {!readOnly && selectedItems.length > 0 && (
            <Button size="sm" variant="secondary-destructive" icon={TrashIcon} onClick={() => setRemoving(selectedItems)}>
              Delete {selectedItems.length}
            </Button>
          )}
          <Tabs
            size="sm"
            value={view}
            onValueChange={changeView}
            tabs={[
              { value: "list", label: <ListIcon size={16} aria-label="List view" /> },
              { value: "grid", label: <SquaresFourIcon size={16} aria-label="Grid view" /> },
            ]}
          />
        </div>
      </div>

      <div ref={content} className="relative flex min-h-0 flex-1">
        <section
          ref={listing}
          className="min-h-0 min-w-0 flex-1 overflow-auto p-3 [scrollbar-gutter:stable] sm:p-4"
          onClick={(event) => {
            if (!isControl(event.target) && !(event.target as Element).closest("tr, [data-item]")) closePreview();
          }}
        >
          {capabilities.usesApiBudget && budgetExhausted && (
            <Banner
              className="mb-3"
              variant="default"
              description="Cloudflare's R2 API limit is nearly used up. Thumbnails and queued uploads continue as it refills, usually within a minute."
            />
          )}
          {error ? (
            <Banner variant="error" title="Could not list objects" description={error} />
          ) : loading ? (
            <div className="flex h-64 items-center justify-center">
              <Loader size={24} />
            </div>
          ) : items.length === 0 ? (
            <Empty
              icon={<UploadSimpleIcon size={48} className="text-kumo-inactive" />}
              title={filter ? "No matches" : "This folder is empty"}
              description={filter ? "No items in this folder match your filter." : "Drag and drop files here or use the upload button."}
            />
          ) : view === "list" ? (
            <FileTable
              items={items}
              selected={selected}
              activeKey={activeKey}
              sort={sort}
              onSort={onSort}
              onToggle={toggle}
              onToggleAll={toggleAll}
              actions={actions}
            />
          ) : (
            <FileGrid
              bucketRef={bucketRef}
              reserveCalls={capabilities.usesApiBudget}
              items={items}
              selected={selected}
              activeKey={activeKey}
              columns={columns}
              onToggle={toggle}
              actions={actions}
            />
          )}
          {cursor && !loading && (
            <div className="mt-4 flex justify-center">
              <Button loading={loadingMore} onClick={loadMore}>
                Load more
              </Button>
            </div>
          )}
        </section>
        {preview && (
          <PreviewPanel
            bucketRef={bucketRef}
            backend={backend}
            object={preview}
            onClose={closePreview}
            onDownload={download}
            onCopyLink={copyLink}
            onShare={share}
          />
        )}
      </div>

      {dragging && (
        <div className="pointer-events-none absolute inset-3 z-30 flex items-center justify-center rounded-xl border-2 border-dashed border-kumo-brand bg-kumo-base/80">
          <div className="flex flex-col items-center gap-2 text-kumo-default">
            <UploadSimpleIcon size={40} />
            <p className="font-medium">Drop files to upload to /{prefix}</p>
          </div>
        </div>
      )}

      <input ref={fileInput} type="file" multiple hidden onChange={pickFiles} />
      <input ref={folderInput} type="file" hidden {...{ webkitdirectory: "" }} onChange={pickFiles} />

      <PromptDialog
        open={creatingFolder}
        onOpenChange={setCreatingFolder}
        title="New folder"
        label="Folder name"
        confirmLabel="Create"
        validate={validName}
        onSubmit={async (name) => {
          await api.createFolder(bucketRef, `${prefix}${name}/`);
          load();
        }}
      />
      <PromptDialog
        open={renaming !== null}
        onOpenChange={(open) => !open && setRenaming(null)}
        title={renaming?.type === "folder" ? "Rename folder" : "Rename file"}
        label="New name"
        initialValue={renaming ? baseName(renaming.key) : ""}
        confirmLabel="Rename"
        validate={validName}
        onSubmit={rename}
      />
      <ShareDialog bucketRef={bucketRef} objectKey={sharing} onOpenChange={(open) => !open && setSharing(null)} />
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={removing?.length === 1 ? `Delete ${removing[0].type === "folder" ? "folder" : "file"}?` : `Delete ${removing?.length ?? 0} items?`}
        description="This can't be undone."
        confirmLabel="Delete"
        onConfirm={remove}
      >
        {removing && <DeleteList items={removing} />}
      </ConfirmDialog>
      <BucketSettingsDialog bucketRef={bucketRef} open={settingsOpen} onOpenChange={setSettingsOpen} onDeleted={onBucketDeleted} />
    </div>
  );
}
