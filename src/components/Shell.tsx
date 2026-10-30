import { Banner, Button, CloudflareLogo, DropdownMenu, Select, Sidebar, Text, useKumoToastManager } from "@cloudflare/kumo";
import {
  ArchiveIcon,
  GearSixIcon,
  InfoIcon,
  MoonIcon,
  PlusIcon,
  SignInIcon,
  SignOutIcon,
  SunIcon,
  UserCircleIcon,
} from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LOCAL_HOSTS } from "../../shared/names";
import { BINDINGS_ACCOUNT, type BucketInfo, type Me, type SetupStatus } from "../../shared/types";
import { api } from "../api";
import { href, navigate, useRoute } from "../lib/route";
import { ReadOnlyContext } from "../lib/readOnly";
import { applyTheme, storedTheme, type Theme } from "../lib/theme";
import { AboutDialog } from "./AboutDialog";
import { CreateBucketDialog } from "./CreateBucketDialog";
import { Explorer } from "./Explorer";
import { UploadPanel } from "./UploadPanel";
import { UploadsContext, useUploads } from "./useUploads";
import { CloseSidebarOnNavigate } from "./MobileSidebar";
import { Welcome } from "./Welcome";

const OPEN_SIGN_IN_KEY = "r2-lens-open-sign-in-dismissed";

type Props = { me: Me; setup?: SetupStatus; onConfigure?: () => void; onSignIn?: () => void; onSignedOut: () => void };

export function Shell({ me, setup, onConfigure, onSignIn, onSignedOut }: Props) {
  const route = useRoute();
  const toasts = useKumoToastManager();
  const [theme, setTheme] = useState<Theme>(storedTheme);
  const [buckets, setBuckets] = useState<BucketInfo[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const accountId = me.accounts.some((a) => a.id === route.accountId) ? route.accountId : me.accounts[0]?.id;
  const canCreate = !me.readOnly && accountId !== BINDINGS_ACCOUNT;
  const authLabel = { oauth: "Signed in", token: "API token", access: "Cloudflare Access", local: "Local development" };
  const userLabel = me.user.email || authLabel[me.auth];
  const signedIn = me.auth === "oauth" || me.auth === "token";
  const [openSignInDismissed, setOpenSignInDismissed] = useState(() => {
    try {
      return localStorage.getItem(OPEN_SIGN_IN_KEY) === "1";
    } catch {
      return false;
    }
  });
  const showOpenSignIn =
    signedIn &&
    !me.behindAccess &&
    setup?.config.allowedAccounts === false &&
    !LOCAL_HOSTS.includes(location.hostname) &&
    !openSignInDismissed;
  const dismissOpenSignIn = () => {
    setOpenSignInDismissed(true);
    try {
      localStorage.setItem(OPEN_SIGN_IN_KEY, "1");
    } catch {}
  };

  useEffect(() => {
    if (accountId && route.accountId !== accountId) navigate({ accountId });
  }, [route.accountId, accountId]);

  const bucketsRequest = useRef(0);
  const loadBuckets = useCallback(async () => {
    if (!accountId) return;
    const id = ++bucketsRequest.current;
    setBuckets(null);
    try {
      const { buckets } = await api.listBuckets(accountId);
      if (id === bucketsRequest.current) setBuckets(buckets);
    } catch (error) {
      if (id !== bucketsRequest.current) return;
      setBuckets([]);
      toasts.add({ title: "Could not load buckets", description: (error as Error).message, variant: "error" });
    }
  }, [accountId]);

  useEffect(() => {
    loadBuckets();
  }, [loadBuckets]);

  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    applyTheme(next);
    setTheme(next);
  };

  const signOut = async () => {
    await api.logout().catch(() => undefined);
    onSignedOut();
  };

  const uploads = useUploads();
  const activeBucket = buckets?.find((b) => b.name === route.bucket && b.jurisdiction === route.jurisdiction);
  const bucketRef = useMemo(
    () => (accountId && activeBucket ? { accountId, bucket: activeBucket.name, jurisdiction: activeBucket.jurisdiction } : null),
    [accountId, activeBucket?.name, activeBucket?.jurisdiction],
  );

  return (
    <ReadOnlyContext.Provider value={me.readOnly}>
    <UploadsContext.Provider value={uploads}>
    <Sidebar.Provider defaultOpen className="h-full">
      <Sidebar>
        <Sidebar.Header>
          <a href="#/" className="flex items-center gap-2">
            <CloudflareLogo variant="glyph" className="w-7 shrink-0" />
            <Text variant="heading3" as="span">
              R2 Lens
            </Text>
          </a>
        </Sidebar.Header>
        <Sidebar.Content>
          {me.accounts.length > 1 && (
            <div className="px-3 pt-3">
              <Select
                aria-label="Account"
                size="sm"
                className="w-full min-w-0"
                value={accountId}
                onValueChange={(value) => value && navigate({ accountId: value as string })}
                items={me.accounts.map((a) => ({ value: a.id, label: a.name }))}
              />
            </div>
          )}
          <Sidebar.Group>
            <div className="flex items-center justify-between pr-2">
              <Sidebar.GroupLabel>Buckets</Sidebar.GroupLabel>
              {canCreate && (
                <Button
                  size="sm"
                  variant="ghost"
                  shape="square"
                  icon={PlusIcon}
                  aria-label="Create bucket"
                  onClick={() => setCreating(true)}
                />
              )}
            </div>
            {buckets === null ? (
              <Sidebar.Loading />
            ) : (
              <Sidebar.Menu>
                {buckets.map((bucket) => (
                  <Sidebar.MenuItem key={`${bucket.jurisdiction}:${bucket.name}`}>
                    <Sidebar.MenuButton
                      icon={ArchiveIcon}
                      active={bucket === activeBucket}
                      href={href({ accountId: accountId!, jurisdiction: bucket.jurisdiction, bucket: bucket.name })}
                    >
                      <span className="truncate">{bucket.name}</span>
                      {bucket.jurisdiction !== "default" && (
                        <span className="ml-auto text-xs uppercase text-kumo-subtle">{bucket.jurisdiction}</span>
                      )}
                    </Sidebar.MenuButton>
                  </Sidebar.MenuItem>
                ))}
                {buckets.length === 0 && (
                  <p className="px-3 py-2 text-sm text-kumo-subtle">No buckets yet</p>
                )}
              </Sidebar.Menu>
            )}
          </Sidebar.Group>
        </Sidebar.Content>
        <Sidebar.Footer>
          <DropdownMenu>
            <DropdownMenu.Trigger
              render={
                <Button variant="ghost" icon={UserCircleIcon} className="w-full justify-start">
                  <span className="truncate">{userLabel}</span>
                </Button>
              }
            />
            <DropdownMenu.Content>
              <DropdownMenu.Item icon={theme === "dark" ? SunIcon : MoonIcon} onClick={toggleTheme}>
                {theme === "dark" ? "Light mode" : "Dark mode"}
              </DropdownMenu.Item>
              {onConfigure && (
                <DropdownMenu.Item icon={GearSixIcon} onClick={onConfigure}>
                  Configure
                </DropdownMenu.Item>
              )}
              <DropdownMenu.Item icon={InfoIcon} onClick={() => setAboutOpen(true)}>
                About
              </DropdownMenu.Item>
              {!signedIn && onSignIn && (
                <>
                  <DropdownMenu.Separator />
                  <DropdownMenu.Item icon={SignInIcon} onClick={onSignIn}>
                    Sign in to Cloudflare
                  </DropdownMenu.Item>
                </>
              )}
              {signedIn && (
                <>
                  <DropdownMenu.Separator />
                  <DropdownMenu.Item icon={SignOutIcon} variant="danger" onClick={signOut}>
                    Sign out
                  </DropdownMenu.Item>
                </>
              )}
            </DropdownMenu.Content>
          </DropdownMenu>
        </Sidebar.Footer>
      </Sidebar>
      <CloseSidebarOnNavigate location={href({ ...route, accountId: accountId ?? "" })} />
      <main className="flex min-w-0 flex-1 flex-col">
        {showOpenSignIn && (
          <Banner
            variant="alert"
            size="sm"
            className="rounded-none"
            description="Anyone with a Cloudflare account can sign in to this app. They only see their own buckets."
            action={
              <>
                {onConfigure && <Banner.Action onClick={onConfigure}>Configure</Banner.Action>}
                <Banner.Action variant="ghost" onClick={dismissOpenSignIn}>
                  Dismiss
                </Banner.Action>
              </>
            }
          />
        )}
        {accountId && activeBucket ? (
          <Explorer
            key={`${accountId}:${activeBucket.jurisdiction}:${activeBucket.name}`}
            bucketRef={bucketRef!}
            backend={activeBucket.backend}
            prefix={route.prefix}
            onBucketDeleted={() => {
              navigate({ accountId });
              loadBuckets();
            }}
          />
        ) : (
          <Welcome
            accountId={accountId}
            buckets={buckets}
            canCreate={canCreate}
            onCreate={() => setCreating(true)}
            onChanged={loadBuckets}
          />
        )}
      </main>
      {accountId && (
        <CreateBucketDialog
          open={creating}
          accountId={accountId}
          onOpenChange={setCreating}
          onCreated={(bucket) => {
            loadBuckets();
            navigate({ accountId, jurisdiction: bucket.jurisdiction, bucket: bucket.name });
          }}
        />
      )}
      <AboutDialog open={aboutOpen} onOpenChange={setAboutOpen} />
    </Sidebar.Provider>
    <UploadPanel uploads={uploads.uploads} onCancel={uploads.cancel} onClear={uploads.clear} />
    </UploadsContext.Provider>
    </ReadOnlyContext.Provider>
  );
}
