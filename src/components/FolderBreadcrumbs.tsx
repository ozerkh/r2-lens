import { Breadcrumbs, Button } from "@cloudflare/kumo";
import { ArchiveIcon, ArrowLeftIcon, ArrowRightIcon } from "@phosphor-icons/react";
import type { BucketRef } from "../api";
import { href, useHistoryNav } from "../lib/route";

const VISIBLE_DEPTH = 3;

export function FolderBreadcrumbs({ bucketRef, prefix }: { bucketRef: BucketRef; prefix: string }) {
  const historyNav = useHistoryNav();
  const crumbs = prefix.split("/").filter(Boolean);
  const firstShown = crumbs.length > VISIBLE_DEPTH ? crumbs.length - 2 : 0;
  const pathTo = (count: number) => `${crumbs.slice(0, count).join("/")}/`;

  return (
    <nav aria-label="Folder navigation" className="flex min-w-0 flex-1 items-center gap-2">
      <div className="flex shrink-0 items-center">
        <Button variant="ghost" shape="square" icon={ArrowLeftIcon} aria-label="Back" disabled={!historyNav.canGoBack} onClick={historyNav.back} />
        <Button
          variant="ghost"
          shape="square"
          icon={ArrowRightIcon}
          aria-label="Forward"
          disabled={!historyNav.canGoForward}
          onClick={historyNav.forward}
        />
      </div>
      <div className="h-5 w-px shrink-0 bg-kumo-hairline" />
      <Breadcrumbs>
        <Breadcrumbs.Link href={href(bucketRef)} icon={<ArchiveIcon size={16} />}>
          {bucketRef.bucket}
        </Breadcrumbs.Link>
        {firstShown > 0 && [
          <Breadcrumbs.Separator key="s-collapsed" />,
          <Breadcrumbs.Link key="collapsed" href={href({ ...bucketRef, prefix: pathTo(firstShown) })}>
            <span title={crumbs.slice(0, firstShown).join(" / ")}>…</span>
          </Breadcrumbs.Link>,
        ]}
        {crumbs.map((part, index) => {
          if (index < firstShown) return null;
          const target = pathTo(index + 1);
          return [
            <Breadcrumbs.Separator key={`s-${target}`} />,
            index === crumbs.length - 1 ? (
              <Breadcrumbs.Current key={target}>{part}</Breadcrumbs.Current>
            ) : (
              <Breadcrumbs.Link key={target} href={href({ ...bucketRef, prefix: target })}>
                {part}
              </Breadcrumbs.Link>
            ),
          ];
        })}
      </Breadcrumbs>
    </nav>
  );
}
