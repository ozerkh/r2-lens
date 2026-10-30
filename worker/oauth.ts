import Cloudflare from "cloudflare";
import { Hono } from "hono";
import { base64url } from "jose";
import { allowedAccounts, isReadOnly, type AppEnv, type Bindings, type Session } from "./env";
import { clearCookie, readCookie, writeCookie } from "./session";
import { probeClient, setup } from "./setup";
import { tokenLogin } from "./token";

const AUTHORIZE_URL = "https://dash.cloudflare.com/oauth2/auth";
const TOKEN_URL = "https://dash.cloudflare.com/oauth2/token";
const REVOKE_URL = "https://dash.cloudflare.com/oauth2/revoke";
const SCOPES = [
  "account-settings.read",
  "user-details.read",
  "workers-r2.read",
  "workers-r2.write",
  "workers-r2-bucket-item.read",
  "workers-r2-bucket-item.write",
];

type Flow = { state: string; verifier: string; returnTo: string };

type TokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  token_type: string;
  scope?: string;
};

export function clientScopes(env: Bindings) {
  return isReadOnly(env) ? SCOPES.filter((scope) => !scope.endsWith(".write")) : SCOPES;
}

export function requestedScopes(env: Bindings) {
  const scopes = clientScopes(env).join(" ");
  return env.CF_OAUTH_REFRESH === "true" ? `${scopes} offline_access` : scopes;
}

export function authorizeUrl(env: Bindings, redirectUri: string, state: string, codeChallenge: string) {
  const url = new URL(AUTHORIZE_URL);
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: env.CF_OAUTH_CLIENT_ID,
    redirect_uri: redirectUri,
    scope: requestedScopes(env),
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  }).toString();
  return url;
}

function randomToken(bytes = 32) {
  return base64url.encode(crypto.getRandomValues(new Uint8Array(bytes)));
}

async function challengeFor(verifier: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64url.encode(new Uint8Array(digest));
}

function clientHeaders(env: Bindings): HeadersInit {
  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
    Accept: "application/json",
  };
  if (env.CF_OAUTH_CLIENT_SECRET) {
    headers.Authorization = `Basic ${btoa(`${env.CF_OAUTH_CLIENT_ID}:${env.CF_OAUTH_CLIENT_SECRET}`)}`;
  }
  return headers;
}

class TokenError extends Error {
  constructor(readonly status: number) {
    super(`Token endpoint returned ${status}`);
  }
}

export class RefreshUnavailable extends Error {}

async function tokenRequest(env: Bindings, params: Record<string, string>): Promise<TokenResponse> {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: clientHeaders(env),
    body: new URLSearchParams({ client_id: env.CF_OAUTH_CLIENT_ID, ...params }),
  });
  if (!response.ok) {
    throw new TokenError(response.status);
  }
  return response.json<TokenResponse>();
}

function expiry(token: TokenResponse) {
  return Date.now() + (token.expires_in ?? 3600) * 1000;
}

export async function refreshSession(env: Bindings, session: Session, refreshToken: string): Promise<Session | null> {
  try {
    const token = await tokenRequest(env, { grant_type: "refresh_token", refresh_token: refreshToken });
    return {
      ...session,
      accessToken: token.access_token,
      refreshToken: token.refresh_token ?? refreshToken,
      expiresAt: expiry(token),
    };
  } catch (error) {
    if (error instanceof TokenError && error.status >= 400 && error.status < 500) return null;
    throw new RefreshUnavailable();
  }
}

function safeReturnTo(value: string | undefined) {
  if (!value || !value.startsWith("/") || /[\\\u0000-\u001f]/.test(value)) return "/";
  const base = "https://return-to.invalid";
  const url = new URL(value, base);
  const path = `${url.pathname}${url.search}${url.hash}`;
  return url.origin === base && !path.startsWith("//") ? path : "/";
}

export const auth = new Hono<AppEnv>();

auth.route("/setup", setup);
auth.route("/token", tokenLogin);

auth.get("/login", async (c) => {
  if (!c.env.CF_OAUTH_CLIENT_ID) {
    return c.text("CF_OAUTH_CLIENT_ID is not configured", 500);
  }
  const redirectUri = new URL("/auth/callback", c.req.url).toString();
  if (await probeClient(c.env, redirectUri)) {
    return c.redirect("/?error=client_problem", 302);
  }
  const flow: Flow = {
    state: randomToken(),
    verifier: randomToken(48),
    returnTo: safeReturnTo(c.req.query("returnTo")),
  };
  await writeCookie(c, "flow", flow);

  const url = authorizeUrl(c.env, redirectUri, flow.state, await challengeFor(flow.verifier));
  return c.redirect(url.toString(), 302);
});

auth.get("/callback", async (c) => {
  const flow = await readCookie<Flow>(c, "flow");
  clearCookie(c, "flow");

  const error = c.req.query("error");
  if (error) {
    return c.redirect(`/?error=${encodeURIComponent(error)}`, 302);
  }
  const code = c.req.query("code");
  if (!flow || !code || c.req.query("state") !== flow.state) {
    return c.redirect("/?error=invalid_state", 302);
  }

  let token: TokenResponse;
  try {
    token = await tokenRequest(c.env, {
      grant_type: "authorization_code",
      code,
      redirect_uri: new URL("/auth/callback", c.req.url).toString(),
      code_verifier: flow.verifier,
    });
  } catch {
    return c.redirect("/?error=token_exchange_failed", 302);
  }

  const cf = new Cloudflare({ apiToken: token.access_token });
  let user: Awaited<ReturnType<typeof cf.user.get>>;
  const ids: string[] = [];
  const allowed = allowedAccounts(c.env);
  try {
    user = await cf.user.get();
    if (allowed.length > 0) for await (const account of cf.accounts.list()) ids.push(account.id);
  } catch {
    await revoke(c.env, token.access_token).catch(() => undefined);
    return c.redirect("/?error=profile_unavailable", 302);
  }

  if (allowed.length > 0 && !ids.some((id) => allowed.includes(id))) {
    await revoke(c.env, token.access_token);
    return c.redirect("/?error=account_not_allowed", 302);
  }

  const session: Session = {
    kind: "oauth",
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    expiresAt: expiry(token),
    userId: user.id ?? "",
    email: (user as { email?: string }).email ?? "",
  };
  await writeCookie(c, "session", session);
  return c.redirect(flow.returnTo, 302);
});

auth.post("/logout", async (c) => {
  const session = await readCookie<Session>(c, "session");
  clearCookie(c, "session");
  if (session && session.kind !== "token") {
    await Promise.allSettled([
      revoke(c.env, session.accessToken),
      session.refreshToken ? revoke(c.env, session.refreshToken) : Promise.resolve(),
    ]);
  }
  return c.json({ ok: true });
});

async function revoke(env: Bindings, token: string) {
  await fetch(REVOKE_URL, {
    method: "POST",
    headers: clientHeaders(env),
    body: new URLSearchParams({ client_id: env.CF_OAUTH_CLIENT_ID, token }),
  });
}
