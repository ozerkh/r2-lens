import { Button, DropdownMenu } from "@cloudflare/kumo";
import {
  CopyIcon,
  DotsThreeVerticalIcon,
  DownloadSimpleIcon,
  EyeIcon,
  FolderOpenIcon,
  LinkIcon,
  PencilSimpleIcon,
  ShareNetworkIcon,
  TrashIcon,
} from "@phosphor-icons/react";
import { useReadOnly } from "../lib/readOnly";
import type { Item, ItemActions } from "./types";

export function ItemMenu({ item, actions }: { item: Item; actions: ItemActions }) {
  const isFolder = item.type === "folder";
  const readOnly = useReadOnly();
  return (
    <DropdownMenu>
      <DropdownMenu.Trigger
        render={
          <Button
            variant="ghost"
            size="sm"
            shape="square"
            icon={DotsThreeVerticalIcon}
            aria-label="Actions"
            onClick={(event) => event.stopPropagation()}
          />
        }
      />
      <DropdownMenu.Content>
        <DropdownMenu.Item icon={isFolder ? FolderOpenIcon : EyeIcon} onClick={() => actions.open(item)}>
          {isFolder ? "Open" : "Preview"}
        </DropdownMenu.Item>
        {!isFolder && (
          <DropdownMenu.Item icon={DownloadSimpleIcon} onClick={() => actions.download(item)}>
            Download
          </DropdownMenu.Item>
        )}
        {!readOnly && (
          <DropdownMenu.Item icon={PencilSimpleIcon} onClick={() => actions.rename(item)}>
            Rename
          </DropdownMenu.Item>
        )}
        <DropdownMenu.Item icon={CopyIcon} onClick={() => actions.copyKey(item)}>
          Copy key
        </DropdownMenu.Item>
        {!isFolder && actions.copyLink && (
          <DropdownMenu.Item icon={LinkIcon} onClick={() => actions.copyLink?.(item)}>
            Copy public link
          </DropdownMenu.Item>
        )}
        {!isFolder && actions.share && (
          <DropdownMenu.Item icon={ShareNetworkIcon} onClick={() => actions.share?.(item)}>
            Share link…
          </DropdownMenu.Item>
        )}
        {!readOnly && (
          <>
            <DropdownMenu.Separator />
            <DropdownMenu.Item icon={TrashIcon} variant="danger" onClick={() => actions.remove([item])}>
              Delete
            </DropdownMenu.Item>
          </>
        )}
      </DropdownMenu.Content>
    </DropdownMenu>
  );
}
