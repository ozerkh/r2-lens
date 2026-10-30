import Cloudflare from "cloudflare";
import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { API_CALLS_HEADER, API_REMAINING_HEADER } from "../shared/capabilities";
import { BINDINGS_ACCOUNT } from "../shared/types";
import { allowedAccounts, isLocalRequest, r2Bindings, type AppEnv, type Session } from "./env";
import { HttpError } from "./errors";
import { RefreshUnavailable, refreshSession } from "./oauth";
import { readCookie, writeCookie } from "./session";

const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function teamOrigin(domain: string) {
  const value = domain.startsWith("http") ? domain : `https://${domain}`;
  return new URL(value).origin;
}

export const cloudflareAccess = createMiddleware<AppEnv>(async (c, next) => {
  const { ACCESS_TEAM_DOMAIN, ACCESS_AUD } = c.env;
  if (!ACCESS_TEAM_DOMAIN || !ACCESS_AUD) return next();

  const token = c.req.header("cf-access-jwt-assertion");
  if (!token) return c.json({ error: "Missing Cloudflare Access token" }, 403);

  const issuer = teamOrigin(ACCESS_TEAM_DOMAIN);
  let jwks = jwksCache.get(issuer);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`));
    jwksCache.set(issuer, jwks);
  }
  try {
    const { payload } = await jwtVerify(token, jwks, { issuer, audience: ACCESS_AUD });
    c.set("access", { email: typeof payload.email === "string" ? payload.email : undefined });
  } catch {
    return c.json({ error: "Invalid Cloudflare Access token" }, 403);
  }
  return next();
});

export const sameOrigin = createMiddleware<AppEnv>(async (c, next) => {
  const method = c.req.method;
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return next();
  const origin = c.req.header("origin");
  if (!origin || origin !== new URL(c.req.url).origin) {
    return c.json({ error: "Cross-origin request rejected" }, 403);
  }
  if (c.req.header("sec-fetch-site") && c.req.header("sec-fetch-site") !== "same-origin") {
    return c.json({ error: "Cross-site request rejected" }, 403);
  }
  return next();
});

const REFRESH_REUSE_MS = 30_000;
const refreshes = new Map<string, { at: number; result: Promise<Session | null> }>();

function sharedRefresh(c: Context<AppEnv>, session: Session) {
  const key = session.refreshToken;
  if (!key) return Promise.resolve(null);
  const now = Date.now();
  for (const [token, entry] of refreshes) {
    if (now - entry.at > REFRESH_REUSE_MS) refreshes.delete(token);
  }
  const existing = refreshes.get(key);
  if (existing) return existing.result;
  const result = refreshSession(c.env, session, key);
  refreshes.set(key, { at: now, result });
  const forget = () => refreshes.delete(key);
  result.then((refreshed) => refreshed || forget(), forget);
  c.executionCtx.waitUntil(result.catch(() => undefined));
  return result;
}

async function currentSession(c: Context<AppEnv>) {
  const session = await readCookie<Session>(c, "session");
  if (!session || session.expiresAt - 60_000 >= Date.now()) return session;
  let refreshed: Session | null = null;
  try {
    refreshed = session.kind === "token" ? null : await sharedRefresh(c, session);
  } catch (error) {
    if (error instanceof RefreshUnavailable) {
      throw new HttpError(503, "Cloudflare sign-in is not responding right now. Try again in a moment.");
    }
    throw error;
  }
  if (refreshed) await writeCookie(c, "session", refreshed);
  return refreshed;
}

function remainingCalls(response: Response) {
  const header = response.headers.get("ratelimit");
  if (!header) return undefined;
  const values = [...header.matchAll(/;\s*r=(\d+)/g)].map((match) => Number(match[1]));
  return values.length ? Math.min(...values) : undefined;
}

export const loadSession = createMiddleware<AppEnv>(async (c, next) => {
  const session = await currentSession(c);
  const apiCalls: { count: number; remaining?: number } = { count: 0 };
  c.set("apiCalls", apiCalls);
  if (session) {
    c.set("session", session);
    c.set(
      "cf",
      new Cloudflare({
        apiToken: session.accessToken,
        maxRetries: 1,
        fetch: async (input, init) => {
          apiCalls.count++;
          const response = await fetch(input, init);
          const remaining = remainingCalls(response);
          if (remaining !== undefined) apiCalls.remaining = Math.min(remaining, apiCalls.remaining ?? remaining);
          return response;
        },
      }),
    );
  }
  await next();
  if (apiCalls.count > 0) c.res.headers.set(API_CALLS_HEADER, String(apiCalls.count));
  if (apiCalls.remaining !== undefined) c.res.headers.set(API_REMAINING_HEADER, String(apiCalls.remaining));
});

export function bindingsAllowed(c: Context<AppEnv>) {
  return r2Bindings(c.env).length > 0 && (c.get("access") !== undefined || isLocalRequest(c.req.raw));
}

export const accountGuard = createMiddleware<AppEnv>(async (c, next) => {
  const accountId = c.req.param("accountId");
  if (accountId === BINDINGS_ACCOUNT) {
    return bindingsAllowed(c) ? next() : c.json({ error: "Worker bindings are not available" }, 403);
  }
  if (!c.get("session")) return c.json({ error: "Not signed in" }, 401);
  const allowed = allowedAccounts(c.env);
  if (allowed.length > 0 && (!accountId || !allowed.includes(accountId))) {
    return c.json({ error: "Account not allowed" }, 403);
  }
  return next();
});
