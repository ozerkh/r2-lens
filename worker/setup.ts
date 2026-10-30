import { Hono } from "hono";
import type { OAuthState, SetupStatus } from "../shared/types";
import { allowedAccounts, isReadOnly, r2Bindings, tokenLoginEnabled, type AppEnv, type Bindings } from "./env";
import { authorizeUrl, clientScopes, requestedScopes } from "./oauth";
import { hasSessionSecret } from "./session";

const PROBE_CHALLENGE = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";

function missingConfig(env: Bindings) {
  const missing: string[] = [];
  if (!hasSessionSecret(env)) missing.push("SESSION_SECRET");
  if (!env.CF_OAUTH_CLIENT_ID) missing.push("CF_OAUTH_CLIENT_ID");
  return missing;
}

type ClientProblem = { error: string; description: string };

const PROBE_OK_TTL = 60 * 1000;
const probeOk = new Map<string, number>();

export async function probeClient(env: Bindings, redirectUri: string): Promise<ClientProblem | null> {
  const key = `${env.CF_OAUTH_CLIENT_ID} ${redirectUri} ${requestedScopes(env)}`;
  if ((probeOk.get(key) ?? 0) > Date.now()) return null;
  probeOk.delete(key);
  const url = authorizeUrl(env, redirectUri, "setup-probe", PROBE_CHALLENGE);
  try {
    const response = await fetch(url, { redirect: "manual" });
    const location = response.headers.get("location");
    if (!location) return null;
    const params = new URL(location, url).searchParams;
    const error = params.get("error");
    if (!error) {
      probeOk.set(key, Date.now() + PROBE_OK_TTL);
      return null;
    }
    return { error, description: params.get("error_description") ?? "" };
  } catch {
    return null;
  }
}

export const setup = new Hono<AppEnv>();

setup.get("/", async (c) => {
  const missing = missingConfig(c.env);
  const redirectUri = new URL("/auth/callback", c.req.url).toString();
  const clientProblem = missing.includes("CF_OAUTH_CLIENT_ID") ? null : await probeClient(c.env, redirectUri);
  const oauth: OAuthState = missing.includes("CF_OAUTH_CLIENT_ID") ? "missing" : clientProblem ? "broken" : "ready";
  const tokenLogin = tokenLoginEnabled(c.env);
  const anyLogin = oauth === "ready" || tokenLogin || r2Bindings(c.env).length > 0;
  return c.json<SetupStatus>({
    ready: !missing.includes("SESSION_SECRET") && anyLogin,
    oauth,
    tokenLogin,
    missing,
    redirectUri,
    scopes: clientScopes(c.env),
    ...(clientProblem && { clientProblem }),
    config: {
      allowedAccounts: allowedAccounts(c.env).length > 0,
      tokenLogin,
      oauthRefresh: c.env.CF_OAUTH_REFRESH === "true",
      bindings: r2Bindings(c.env).length,
      access: Boolean(c.env.ACCESS_TEAM_DOMAIN && c.env.ACCESS_AUD),
      readOnly: isReadOnly(c.env),
      sessionSecret: !missing.includes("SESSION_SECRET"),
    },
  });
});
