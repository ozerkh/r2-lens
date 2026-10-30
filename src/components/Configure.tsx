import { Badge, Button, CloudflareLogo, LayerCard, Text } from "@cloudflare/kumo";
import { ArrowClockwiseIcon, ArrowLeftIcon, ArrowSquareOutIcon, GearSixIcon } from "@phosphor-icons/react";
import { useState, type ReactNode } from "react";
import type { SetupStatus } from "../../shared/types";
import { api } from "../api";
import { workerSettingsUrl } from "../lib/dashboard";
import { REPO_URL } from "../lib/version";
import { plural } from "../lib/format";

type Status = { label: string; variant: "success" | "warning" | "error" | "secondary" };

const SET: Status = { label: "Set", variant: "success" };
const ON: Status = { label: "On", variant: "success" };
const OFF: Status = { label: "Off", variant: "secondary" };
const NOT_SET_UP: Status = { label: "Not set up", variant: "secondary" };

const LINK = "inline-flex items-center gap-1 self-start text-kumo-link hover:underline";

const Mono = ({ children }: { children: ReactNode }) => (
  <code className="font-mono text-[0.95em] text-kumo-default">{children}</code>
);

type RowProps = { title: string; name?: string; status: Status; children?: ReactNode; action?: ReactNode };

function Row({ title, name, status, children, action }: RowProps) {
  return (
    <div className="flex flex-col gap-2 px-4 py-3.5 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{title}</span>
          {name && <Mono>{name}</Mono>}
        </div>
        {children && <div className="text-sm text-kumo-subtle">{children}</div>}
        {action && <div className="text-sm">{action}</div>}
      </div>
      <Badge variant={status.variant} className="shrink-0 self-start">
        {status.label}
      </Badge>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-medium text-kumo-subtle">{title}</h2>
      <div className="divide-y divide-kumo-hairline overflow-hidden rounded-md ring ring-kumo-hairline">{children}</div>
    </section>
  );
}

type Props = { setup: SetupStatus; onBack: () => void; onSetUpOAuth: (setup: SetupStatus) => void };

export default function Configure({ setup: initial, onBack, onSetUpOAuth }: Props) {
  const [setup, setSetup] = useState(initial);
  const [checking, setChecking] = useState(false);
  const { config, oauth } = setup;

  const check = async () => {
    setChecking(true);
    try {
      setSetup(await api.setup());
    } finally {
      setChecking(false);
    }
  };

  const oauthStatus: Status =
    oauth === "ready" ? ON : oauth === "broken" ? { label: "Needs fixing", variant: "error" } : NOT_SET_UP;
  const bindingsStatus: Status =
    config.bindings === 0 ? NOT_SET_UP : config.access ? ON : { label: "Needs Access", variant: "warning" };

  return (
    <main className="flex min-h-full items-center justify-center p-6">
      <LayerCard className="w-full max-w-3xl">
        <LayerCard.Secondary className="flex items-center gap-2">
          <GearSixIcon size={16} />
          Configure
        </LayerCard.Secondary>
        <LayerCard.Primary className="flex flex-col gap-6 p-6 sm:p-8">
          <div className="flex items-start gap-4">
            <CloudflareLogo variant="glyph" className="w-10 shrink-0" />
            <div className="flex flex-col gap-1">
              <Text variant="heading2" as="h1">
                Configure R2 Lens
              </Text>
              <Text variant="secondary">
                Add settings on your Worker's{" "}
                <a href={workerSettingsUrl()} target="_blank" rel="noopener noreferrer" className={LINK}>
                  Variables and secrets
                  <ArrowSquareOutIcon size={14} />
                </a>{" "}
                page. Changes apply right away.
              </Text>
            </div>
          </div>

          <Section title="Access">
            <Row
              title="Allowed accounts"
              name="ALLOWED_ACCOUNT_IDS"
              status={config.allowedAccounts ? SET : { label: "Recommended", variant: "warning" }}
            >
              {config.allowedAccounts
                ? "Only these Cloudflare accounts can sign in."
                : "Anyone with a Cloudflare account can sign in. Add your account ID to allow only yours."}
            </Row>
          </Section>

          <Section title="Authentication">
            <Row title="API token" name="TOKEN_LOGIN" status={config.tokenLogin ? ON : OFF}>
              {config.tokenLogin ? (
                <>
                  Set to <Mono>false</Mono> to turn it off.
                </>
              ) : (
                <>
                  Remove it or set it to <Mono>true</Mono> to turn it on.
                </>
              )}
            </Row>
            <Row
              title="Cloudflare OAuth"
              name="CF_OAUTH_CLIENT_ID"
              status={oauthStatus}
              action={
                oauth !== "ready" && (
                  <button type="button" className={LINK} onClick={() => onSetUpOAuth(setup)}>
                    {oauth === "broken" ? "See what to fix" : "Set up an OAuth client"}
                  </button>
                )
              }
            >
              {oauth === "ready" ? (
                config.oauthRefresh ? (
                  "People stay signed in for up to 7 days."
                ) : (
                  <>
                    Set <Mono>CF_OAUTH_REFRESH</Mono> to <Mono>true</Mono> to keep people signed in for up to 7 days.
                  </>
                )
              ) : (
                "Sign in with your Cloudflare account instead of a token. Uploads are limited to 100 MB per file."
              )}
            </Row>
            <Row
              title="Bucket bindings"
              status={bindingsStatus}
              action={
                !(config.bindings > 0 && config.access) && (
                  <a href={`${REPO_URL}#bucket-bindings`} target="_blank" rel="noopener noreferrer" className={LINK}>
                    How to set up
                    <ArrowSquareOutIcon size={14} />
                  </a>
                )
              }
            >
              {config.bindings === 0 ? (
                <>
                  Bind buckets in <Mono>wrangler.jsonc</Mono> and put the Worker behind Cloudflare Access.
                </>
              ) : config.access ? (
                `${plural(config.bindings, "bucket")} bound. Open the app through Cloudflare Access to use them.`
              ) : (
                <>
                  {plural(config.bindings, "bucket")} bound, but they only work locally until you set{" "}
                  <Mono>ACCESS_TEAM_DOMAIN</Mono> and <Mono>ACCESS_AUD</Mono>.
                </>
              )}
            </Row>
          </Section>

          <Section title="Other">
            <Row title="Read-only" name="READ_ONLY" status={config.readOnly ? ON : { label: "Off", variant: "error" }}>
              {config.readOnly ? (
                "Uploads, deletes and setting changes are turned off."
              ) : (
                <>
                  Set to <Mono>true</Mono> to turn off uploads, deletes and setting changes.
                </>
              )}
            </Row>
            <Row title="Session secret" name="SESSION_SECRET" status={config.sessionSecret ? SET : { label: "Missing", variant: "error" }}>
              Encrypts the sign-in cookie. Created by <Mono>npm run deploy</Mono>.
            </Row>
          </Section>

          <div className="flex justify-end gap-2">
            <Button icon={ArrowLeftIcon} onClick={onBack}>
              Back
            </Button>
            <Button variant="primary" icon={ArrowClockwiseIcon} loading={checking} onClick={check}>
              Check again
            </Button>
          </div>
        </LayerCard.Primary>
      </LayerCard>
    </main>
  );
}
