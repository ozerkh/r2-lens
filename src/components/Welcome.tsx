import { Badge, Button, Empty, Input, LayerCard, Loader, useSidebar } from "@cloudflare/kumo";
import { ArchiveIcon, GearSixIcon, MagnifyingGlassIcon, PlusIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { CAPABILITIES } from "../../shared/capabilities";
import type { BucketInfo } from "../../shared/types";
import type { BucketRef } from "../api";
import { formatDate } from "../lib/format";
import { href } from "../lib/route";
import { BucketSettingsDialog } from "./BucketSettingsDialog";
import { SidebarToggle } from "./MobileSidebar";

type Props = {
  accountId?: string;
  buckets: BucketInfo[] | null;
  canCreate: boolean;
  onCreate: () => void;
  onChanged: () => void;
};

export function Welcome(props: Props) {
  const { isMobile } = useSidebar();
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {isMobile && (
        <header className="flex h-[58px] shrink-0 items-center gap-2 border-b border-kumo-line bg-kumo-base px-2">
          <SidebarToggle />
        </header>
      )}
      <Content {...props} />
    </div>
  );
}

function Content({ accountId, buckets, canCreate, onCreate, onChanged }: Props) {
  const [settingsFor, setSettingsFor] = useState<BucketRef | null>(null);
  const [filter, setFilter] = useState("");

  if (!accountId) {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <Empty
          icon={<WarningCircleIcon size={48} className="text-kumo-warning" />}
          title="No accounts available"
          description="The authorization did not include any Cloudflare account. Sign out and grant access to at least one account."
        />
      </div>
    );
  }
  if (buckets === null) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader size={24} />
      </div>
    );
  }
  if (buckets.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <Empty
          icon={<ArchiveIcon size={48} className="text-kumo-inactive" />}
          title="No buckets yet"
          description={canCreate ? "Create your first R2 bucket to start uploading files." : "No buckets are available here."}
          contents={
            canCreate && (
              <Button variant="primary" icon={PlusIcon} onClick={onCreate}>
                Create bucket
              </Button>
            )
          }
        />
      </div>
    );
  }

  const query = filter.trim().toLowerCase();
  const shown = query ? buckets.filter((bucket) => bucket.name.toLowerCase().includes(query)) : buckets;

  return (
    <div className="min-h-0 flex-1 overflow-auto [scrollbar-gutter:stable]">
      <div className="flex min-h-full items-start justify-center px-3 pt-6 pb-3 md:items-center md:p-6">
        <LayerCard className="w-full max-w-2xl">
          <LayerCard.Secondary className="flex items-center gap-2">
            <ArchiveIcon size={16} />
            Buckets
            <span className="ml-auto tabular-nums">{buckets.length}</span>
          </LayerCard.Secondary>
          <LayerCard.Primary className="gap-0 p-0">
            <div className="relative border-b border-kumo-hairline p-3">
              <MagnifyingGlassIcon size={16} className="pointer-events-none absolute top-1/2 left-6 -translate-y-1/2 text-kumo-subtle" />
              <Input
                aria-label="Filter buckets"
                placeholder="Filter buckets"
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
                className="w-full pl-9"
              />
            </div>
            {shown.length === 0 ? (
              <p className="px-4 py-8 text-center text-kumo-subtle">No buckets match “{filter.trim()}”.</p>
            ) : (
              <ul className="max-h-[60vh] divide-y divide-kumo-hairline overflow-auto">
                {shown.map((bucket) => {
                  const ref: BucketRef = { accountId, bucket: bucket.name, jurisdiction: bucket.jurisdiction };
                  return (
                    <li key={`${bucket.jurisdiction}:${bucket.name}`} className="relative flex items-center gap-3 px-4 py-3 hover:bg-kumo-elevated">
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-kumo-recessed text-kumo-subtle">
                        <ArchiveIcon size={18} />
                      </span>
                      <div className="flex min-w-0 flex-1 flex-col">
                        <a href={href(ref)} className="truncate font-medium after:absolute after:inset-0" title={bucket.name}>
                          {bucket.name}
                        </a>
                        <span className="flex items-center gap-2 text-sm text-kumo-subtle">
                          {bucket.backend === "binding" ? "Bound to this Worker" : `Created ${formatDate(bucket.creationDate)}`}
                          {bucket.jurisdiction !== "default" && <Badge variant="secondary">{bucket.jurisdiction.toUpperCase()}</Badge>}
                        </span>
                      </div>
                      {CAPABILITIES[bucket.backend].bucketSettings && (
                        <Button
                          variant="ghost"
                          shape="square"
                          icon={GearSixIcon}
                          aria-label={`${bucket.name} settings`}
                          className="relative z-10 shrink-0 hover:!bg-kumo-fill"
                          onClick={() => setSettingsFor(ref)}
                        />
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            {canCreate && (
              <div className="flex justify-end border-t border-kumo-hairline p-3">
                <Button variant="primary" icon={PlusIcon} onClick={onCreate}>
                  Create bucket
                </Button>
              </div>
            )}
          </LayerCard.Primary>
        </LayerCard>
      </div>

      {settingsFor && (
        <BucketSettingsDialog
          key={`${settingsFor.jurisdiction}:${settingsFor.bucket}`}
          bucketRef={settingsFor}
          open
          onOpenChange={(open) => !open && setSettingsFor(null)}
          onDeleted={() => {
            setSettingsFor(null);
            onChanged();
          }}
        />
      )}
    </div>
  );
}
