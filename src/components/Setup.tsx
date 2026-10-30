import { Button, ClipboardText, LinkButton, CloudflareLogo, LayerCard, Table, Tabs, Text } from "@cloudflare/kumo";
import { CodeHighlighted, ShikiProvider } from "@cloudflare/kumo/code";
import { ArrowClockwiseIcon, ArrowSquareOutIcon, CheckIcon, PlusIcon, WrenchIcon, XIcon } from "@phosphor-icons/react";
import { useState, type ReactNode } from "react";
import { LOCAL_HOSTS } from "../../shared/names";
import { workerSettingsUrl } from "../lib/dashboard";

type Props = {
  missing: string[];
  tokenLogin: boolean;
  redirectUri: string;
  scopes: string[];
  clientProblem?: { error: string; description: string };
  onBack?: () => void;
};


const SCOPE_NAMES: Record<string, string> = {
  "account-settings.read": "Account Settings Read",
  "user-details.read": "User Details Read",
  "workers-r2.read": "Workers R2 Storage Read",
  "workers-r2.write": "Workers R2 Storage Write",
  "workers-r2-bucket-item.read": "Workers R2 Storage Bucket Item Read",
  "workers-r2-bucket-item.write": "Workers R2 Storage Bucket Item Write",
};

function linesToFill(code: string) {
  return code
    .split("\n")
    .flatMap((line, index) => (/\$[A-Z_]+|<[^>]+>/.test(line) ? [index + 1] : []));
}

const LINK = "inline-flex items-center gap-1 text-kumo-link hover:underline";

const Mono = ({ children }: { children: ReactNode }) => (
  <code className="font-mono text-[0.95em] text-kumo-default">{children}</code>
);
const Strong = ({ children }: { children: ReactNode }) => (
  <span className="font-medium text-kumo-default">{children}</span>
);

function Step({ number, title, children }: { number: number; title: string; children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-kumo-recessed text-sm font-medium">
        {number}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <p className="font-medium">{title}</p>
        {children}
      </div>
    </li>
  );
}

function Option({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-4 rounded-lg p-5 ring ring-kumo-hairline">
      <h2 className="font-medium">{title}</h2>
      {children}
    </section>
  );
}

function toCallbackUrl(input: string) {
  const value = input.trim();
  if (!value) return null;
  try {
    const url = new URL(value.includes("://") ? value : `https://${value}`);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (url.pathname === "/" || url.pathname === "") url.pathname = "/auth/callback";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

type RedirectUrisProps = { current: string; extra: string[]; onAdd: (uri: string) => void; onRemove: (uri: string) => void };

function RedirectUris({ current, extra, onAdd, onRemove }: RedirectUrisProps) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string>();
  const close = () => {
    setAdding(false);
    setDraft("");
    setError(undefined);
  };
  const add = () => {
    const uri = toCallbackUrl(draft);
    if (!uri) return setError("Enter an http(s) address, e.g. r2-lens.example.workers.dev");
    if (uri === current || extra.includes(uri)) return setError("Already in the list");
    onAdd(uri);
    close();
  };
  return (
    <div className="flex flex-col gap-2">
      <ClipboardText text={current} />
      {extra.map((uri) => (
        <div key={uri} className="flex items-center gap-1">
          <div className="min-w-0 flex-1">
            <ClipboardText text={uri} />
          </div>
          <Button variant="ghost" size="sm" shape="square" icon={XIcon} aria-label={`Remove ${uri}`} onClick={() => onRemove(uri)} />
        </div>
      ))}
      {adding ? (
        <form
          className="flex h-10 items-center overflow-hidden rounded-lg bg-kumo-base font-mono text-sm ring ring-kumo-line focus-within:ring-[1.5px] focus-within:ring-kumo-focus/50"
          onSubmit={(event) => {
            event.preventDefault();
            add();
          }}
        >
          <input
            autoFocus
            aria-label="Add another redirect URL"
            placeholder="r2-lens.example.workers.dev"
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value);
              setError(undefined);
            }}
            onKeyDown={(event) => event.key === "Escape" && close()}
            className="h-full min-w-0 grow bg-transparent ps-4 pe-2 outline-none placeholder:text-kumo-subtle"
          />
          <button
            type="submit"
            aria-label="Add redirect URL"
            className="flex h-full shrink-0 items-center border-l border-kumo-line px-3 text-kumo-default hover:bg-kumo-tint"
          >
            <CheckIcon size={16} />
          </button>
        </form>
      ) : (
        <button type="button" className={`${LINK} self-start text-sm`} onClick={() => setAdding(true)}>
          <PlusIcon size={14} />
          Add another URL
        </button>
      )}
      {error && <span className="text-sm text-kumo-danger">{error}</span>}
    </div>
  );
}

type FieldErrors = Partial<Record<"responseType" | "redirectUris" | "scopes", string>>;

function fieldErrors({ error, description }: { error: string; description: string }): FieldErrors | string {
  if (/redirect_uri/i.test(description)) return { redirectUris: "Invalid redirect URL. Add this URL to the client's redirect URLs." };
  if (error === "invalid_scope" && /offline_access/.test(description)) {
    return { scopes: "Refresh tokens are on (CF_OAUTH_REFRESH), but the client lacks the Refresh token grant. Enable it on the client." };
  }
  if (error === "invalid_scope") {
    const scope = /scope '([^']+)'/.exec(description)?.[1];
    return { scopes: `Invalid scope. Add ${scope ?? "the missing scope"} to the client's scopes.` };
  }
  if (error === "unsupported_response_type") return { responseType: "Invalid response type. Enable Code on the client." };
  return `${error}: ${description}`;
}

function ClientProblem({ problem, redirectUri, scopes }: { problem: { error: string; description: string }; redirectUri: string; scopes: string[] }) {
  const errors = fieldErrors(problem);
  return (
    <div className="flex flex-col gap-4">
      <Text variant="secondary">
        Update the client on the{" "}
        <a href="https://dash.cloudflare.com/?to=/:account/oauth-clients" target="_blank" rel="noopener noreferrer" className={LINK}>
          OAuth clients page
          <ArrowSquareOutIcon size={14} />
        </a>{" "}
        to match these settings.
      </Text>
      {typeof errors === "string" && <span className="text-sm text-kumo-danger">{errors}</span>}
      <ClientSettings
        errors={typeof errors === "string" ? {} : errors}
        redirectUris={
          <ClipboardText
            text={redirectUri}
            className={
              typeof errors !== "string" && errors.redirectUris
                ? "!bg-kumo-danger/10 !ring-kumo-danger [&_button]:!border-kumo-danger/40 [&_button:hover]:!bg-kumo-danger/15"
                : undefined
            }
          />
        }
        scopes={scopes}
      />
    </div>
  );
}

function ClientSettings({ redirectUris, scopes, errors = {} }: { redirectUris: ReactNode; scopes: string[]; errors?: FieldErrors }) {
  const rows: [string, ReactNode, string?][] = [
    ["Response type", "Code", errors.responseType],
    ["Grant type", "Authorization code"],
    ["Token authentication method", "None (PKCE)"],
    ["Redirect URLs", redirectUris, errors.redirectUris],
    [
      "Scopes",
      <ul className="flex flex-col gap-1">
        {scopes.map((scope) => (
          <li key={scope} title={scope}>
            {SCOPE_NAMES[scope] ?? scope}
          </li>
        ))}
      </ul>,
      errors.scopes,
    ],
  ];
  return (
    <div className="overflow-hidden rounded-md ring ring-kumo-hairline">
      <Table layout="fixed">
        <Table.Body>
          {rows.map(([name, value, error]) => (
            <Table.Row key={name}>
              <Table.Cell className="w-56 align-top text-kumo-subtle">{name}</Table.Cell>
              <Table.Cell>
                {value}
                {error && <p className="mt-1.5 text-sm text-kumo-danger">{error}</p>}
              </Table.Cell>
            </Table.Row>
          ))}
        </Table.Body>
      </Table>
    </div>
  );
}

function createClientRequest(redirectUris: string[], scopes: string[]) {
  const fields: [string, unknown][] = [
    ["client_name", "R2 Lens"],
    ["redirect_uris", redirectUris],
    ["grant_types", ["authorization_code"]],
    ["response_types", ["code"]],
    ["token_endpoint_auth_method", "none"],
    ["scopes", scopes],
  ];
  const format = (key: string, value: unknown) =>
    Array.isArray(value) && (key === "scopes" || value.length > 1)
      ? `[\n${value.map((item) => `      ${JSON.stringify(item)}`).join(",\n")}\n    ]`
      : JSON.stringify(value).replace(/","/g, '", "');
  const body = fields.map(([key, value]) => `    "${key}": ${format(key, value)}`).join(",\n");
  return [
    'curl "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/oauth_clients" \\',
    '  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \\',
    '  -H "Content-Type: application/json" \\',
    `  -d '{\n${body}\n  }'`,
  ].join("\n");
}

export default function Setup({ missing: required, tokenLogin, redirectUri, scopes, clientProblem, onBack }: Props) {
  const local = LOCAL_HOSTS.includes(location.hostname);
  const missing = onBack || !tokenLogin ? required : required.filter((name) => name !== "CF_OAUTH_CLIENT_ID");
  const needsClient = missing.includes("CF_OAUTH_CLIENT_ID");
  const needsSecret = missing.includes("SESSION_SECRET");

  const clientIdCode = "CF_OAUTH_CLIENT_ID=<your client ID>";
  const secretsPage = (
    <a href={workerSettingsUrl()} target="_blank" rel="noopener noreferrer" className={LINK}>
      Variables and secrets
      <ArrowSquareOutIcon size={14} />
    </a>
  );
  const [sessionSecret] = useState(() =>
    Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) => byte.toString(16).padStart(2, "0")).join(""),
  );

  const [method, setMethod] = useState<"dashboard" | "api">("dashboard");
  const [extraUris, setExtraUris] = useState<string[]>([]);
  const clientRequest = createClientRequest([redirectUri, ...extraUris], scopes);
  const redirectEditor = (
    <RedirectUris
      current={redirectUri}
      extra={extraUris}
      onAdd={(uri) => setExtraUris((uris) => [...uris, uri])}
      onRemove={(uri) => setExtraUris((uris) => uris.filter((u) => u !== uri))}
    />
  );
  const chooseMethod = needsClient && !tokenLogin && !onBack;
  const secretStep = needsClient && !chooseMethod ? 3 : 1;
  const oauthSteps = (
    <>
            <Tabs
              variant="underline"
              value={method}
              onValueChange={(value) => setMethod(value === "api" ? "api" : "dashboard")}
              tabs={[
                { value: "dashboard", label: "Dashboard" },
                { value: "api", label: "API" },
              ]}
            />
      <ol className="flex flex-col gap-8">
              <Step number={1} title="Create an OAuth client">
                {method === "dashboard" ? (
                  <>
                    <Text variant="secondary">
                      Create a client on the{" "}
                      <a href="https://dash.cloudflare.com/?to=/:account/oauth-clients" target="_blank" rel="noopener noreferrer" className={LINK}>
                        OAuth clients page
                        <ArrowSquareOutIcon size={14} />
                      </a>{" "}
                      with these settings.{" "}
                      <a
                        href="https://developers.cloudflare.com/fundamentals/oauth/create-an-oauth-client/"
                        target="_blank"
                        rel="noopener noreferrer"
                        className={LINK}
                      >
                        Docs
                        <ArrowSquareOutIcon size={14} />
                      </a>
                    </Text>
                    <ClientSettings redirectUris={redirectEditor} scopes={scopes} />
                  </>
                ) : (
                  <>
                    <Text variant="secondary">
                      Use an API token with the <Strong>OAuth Client Write</Strong> permission. The client ID is in{" "}
                      <Mono>result.client_id</Mono>.
                    </Text>
                    <div className="flex flex-col gap-2">
                      <span className="text-sm text-kumo-subtle">Redirect URLs</span>
                      {redirectEditor}
                    </div>
                    <div className="r2-lens-setup-code min-w-0 overflow-x-auto">
                      <CodeHighlighted lang="bash" code={clientRequest} highlightLines={linesToFill(clientRequest)} showCopyButton />
                    </div>
                  </>
                )}
              </Step>
              <Step number={2} title="Add the client ID">
                <Text variant="secondary">
                  {method === "dashboard" ? (
                    <>
                      Copy the <Strong>Client ID</Strong> shown on the client's page after you create it.
                    </>
                  ) : (
                    <>
                      Copy the client ID from <Mono>result.client_id</Mono> in the API response.
                    </>
                  )}{" "}
                  {local ? (
                    <>
                      Add this line to <Mono>.dev.vars</Mono> (next to <Mono>wrangler.jsonc</Mono>) with your ID and
                      save. The running dev server picks it up right away.
                    </>
                  ) : (
                    <>
                      Add it as <Mono>CF_OAUTH_CLIENT_ID</Mono> on your Worker's{" "}
                      {secretsPage} page.
                    </>
                  )}
                </Text>
                {local && (
                  <div className="r2-lens-setup-code min-w-0 overflow-x-auto">
                    <CodeHighlighted lang="bash" code={clientIdCode} showCopyButton />
                  </div>
                )}
              </Step>
      </ol>
    </>
  );
  const secretSteps = (
    <ol className="flex flex-col gap-8">
              <Step number={secretStep} title="Add the session secret">
                {local ? (
                  <Text variant="secondary">
                    <Mono>SESSION_SECRET</Mono> encrypts the sign-in cookie. Stop <Mono>npm run dev</Mono> and start it
                    again: it creates the secret in <Mono>.dev.vars</Mono> when it is missing.
                  </Text>
                ) : (
                  <>
                    <Text variant="secondary">
                      <Mono>SESSION_SECRET</Mono> encrypts the sign-in cookie. Add it as a <Strong>Secret</Strong> on
                      your Worker's {secretsPage} page, with this random value:
                    </Text>
                    <ClipboardText text={sessionSecret} />
                  </>
                )}
              </Step>
    </ol>
  );
  return (
    <ShikiProvider engine="javascript" languages={["bash"]}>
    <main className="flex min-h-full items-center justify-center p-6">
      <LayerCard className="w-full max-w-3xl">
        <LayerCard.Secondary className="flex items-center gap-2">
          <WrenchIcon size={16} />
          {onBack ? "Cloudflare sign-in" : "Setup required"}
        </LayerCard.Secondary>
        <LayerCard.Primary className="flex flex-col gap-6 p-6 sm:p-8">
          <div className="flex items-start gap-4">
            <CloudflareLogo variant="glyph" className="w-10 shrink-0" />
            <div className="flex flex-col gap-1">
              <Text variant="heading2" as="h1">
                {onBack ? "Set up Cloudflare sign-in" : chooseMethod ? "Set up a sign-in method" : "Finish setting up R2 Lens"}
              </Text>
              <Text variant="secondary">
                {chooseMethod
                  ? "Turn on at least one of these to sign in."
                  : missing.length > 0
                    ? "Complete the steps below, then check again."
                    : "The OAuth client is set, but Cloudflare rejects sign-in with it. Update the client, then check again."}
              </Text>
            </div>
          </div>

          {clientProblem && <ClientProblem problem={clientProblem} redirectUri={redirectUri} scopes={scopes} />}

          {chooseMethod ? (
            <>
              <Option title="API token">
                <Text variant="secondary">
                  Set <Mono>TOKEN_LOGIN</Mono> to <Mono>true</Mono> to turn on sign-in with an API token.
                </Text>
                <LinkButton href={workerSettingsUrl()} external variant="secondary" icon={ArrowSquareOutIcon} className="self-start">
                  Open Variables and secrets
                </LinkButton>
              </Option>
              <Option title="Cloudflare OAuth">{oauthSteps}</Option>
              {needsSecret && <Option title="Session secret">{secretSteps}</Option>}
            </>
          ) : (
            <>
              {needsClient && oauthSteps}
              {needsSecret && secretSteps}
            </>
          )}

          <div className="flex justify-end gap-2">
            {onBack && <Button onClick={onBack}>Back</Button>}
            <Button variant="primary" icon={ArrowClockwiseIcon} onClick={() => location.reload()}>
              Check again
            </Button>
          </div>
        </LayerCard.Primary>
      </LayerCard>
    </main>
    </ShikiProvider>
  );
}
