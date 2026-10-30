import { Banner, Button, CloudflareLogo, Input, LayerCard, LinkButton, Text } from "@cloudflare/kumo";
import { KeyIcon, LockKeyIcon, SignInIcon } from "@phosphor-icons/react";
import { useState, type FormEvent } from "react";
import type { OAuthState } from "../../shared/types";
import { api } from "../api";
import { workerAccessUrl } from "../lib/dashboard";

const TOKEN_PERMISSIONS = [
  { key: "account_settings", type: "read" },
  { key: "workers_r2", type: "edit" },
  { key: "user_details", type: "read" },
];
const TOKENS_URL = `https://dash.cloudflare.com/profile/api-tokens?${new URLSearchParams({
  permissionGroupKeys: JSON.stringify(TOKEN_PERMISSIONS),
  accountId: "*",
  zoneId: "all",
  name: "R2 Lens",
})}`;

const MESSAGES: Record<string, string> = {
  access_denied: "Authorization was cancelled.",
  invalid_state: "The sign-in request expired. Sign in again.",
  token_exchange_failed: "Cloudflare did not accept the authorization code.",
  account_not_allowed: "None of your Cloudflare accounts are allowed on this deployment.",
  profile_unavailable: "Signed in, but your Cloudflare profile could not be read.",
  client_problem: "Cloudflare rejected this app's sign-in settings. Open Configure to see what needs fixing.",
};

type Props = {
  error?: string;
  problem?: string;
  oauth: OAuthState;
  tokenLogin: boolean;
  onSignedIn: () => void;
  onConfigure: () => void;
};

function TokenForm({ primary, onSignedIn }: { primary: boolean; onSignedIn: () => void }) {
  const [token, setToken] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      await api.tokenLogin(token);
      onSignedIn();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <Input
        label="API token"
        type="password"
        autoComplete="off"
        spellCheck={false}
        value={token}
        onChange={(event) => setToken(event.target.value)}
        error={error}
        labelTooltip={
          <>
            Needs Account Settings Read and Workers R2 Storage Read or Edit.{" "}
            <a href={TOKENS_URL} target="_blank" rel="noopener noreferrer" className="text-kumo-link hover:underline">
              Create a token
            </a>
          </>
        }
      />
      <Button
        type="submit"
        variant={primary ? "primary" : "secondary"}
        size="lg"
        icon={KeyIcon}
        loading={busy}
        disabled={!token.trim()}
        className="w-full justify-center"
      >
        Sign in with API token
      </Button>
    </form>
  );
}

export function Login({ error, problem, oauth, tokenLogin, onSignedIn, onConfigure }: Props) {
  const returnTo = encodeURIComponent(`/${location.hash}`);
  return (
    <main className="flex min-h-full items-center justify-center p-6">
      <LayerCard className="w-full max-w-md">
        <LayerCard.Secondary className="flex items-center gap-2">
          <LockKeyIcon size={16} />
          Sign in
        </LayerCard.Secondary>
        <LayerCard.Primary className="flex flex-col gap-6 p-8">
          <CloudflareLogo className="w-36" />
          <div className="flex flex-col gap-2">
            <Text variant="heading2" as="h1">
              R2 Lens
            </Text>
            <Text variant="secondary">
              Browse and manage your Cloudflare R2 buckets. You can do only what your account or token allows.
            </Text>
          </div>
          {(error || problem) && (
            <Banner variant="error" description={error ? (MESSAGES[error] ?? "Sign-in failed.") : problem} />
          )}
          {oauth === "ready" && (
            <LinkButton
              href={`/auth/login?returnTo=${returnTo}`}
              variant="primary"
              size="lg"
              icon={SignInIcon}
              className="w-full justify-center"
            >
              Sign in with Cloudflare
            </LinkButton>
          )}
          {oauth === "ready" && tokenLogin && (
            <div className="flex items-center gap-3 text-sm text-kumo-subtle">
              <span className="h-px flex-1 bg-kumo-hairline" />
              or
              <span className="h-px flex-1 bg-kumo-hairline" />
            </div>
          )}
          {tokenLogin && <TokenForm primary={oauth !== "ready"} onSignedIn={onSignedIn} />}
          {oauth !== "ready" && !tokenLogin && (
            <div className="flex flex-col gap-3">
              <Text variant="secondary">
                Bound buckets open through Cloudflare Access. Turn it on for this Worker, then add its AUD tag and team
                domain as <code className="font-mono">ACCESS_AUD</code> and <code className="font-mono">ACCESS_TEAM_DOMAIN</code>{" "}
                variables.
              </Text>
              <LinkButton href={workerAccessUrl()} external variant="primary" size="lg" icon={LockKeyIcon} className="w-full justify-center">
                Open Access settings
              </LinkButton>
            </div>
          )}
          <button type="button" className="self-center text-sm text-kumo-link hover:underline" onClick={onConfigure}>
            Configure
          </button>
        </LayerCard.Primary>
      </LayerCard>
    </main>
  );
}
