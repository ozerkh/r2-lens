import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { EncryptJWT, jwtDecrypt, type JWTPayload } from "jose";
import type { AppEnv, Bindings } from "./env";

const ISSUER = "r2-lens";
const SESSION_COOKIE = "r2_lens_session";
const FLOW_COOKIE = "r2_lens_oauth";
export const SESSION_TTL = 60 * 60 * 24 * 7;
const FLOW_TTL = 60 * 10;

export const hasSessionSecret = (env: Bindings) => (env.SESSION_SECRET?.length ?? 0) >= 32;

async function deriveKey(env: Bindings): Promise<Uint8Array> {
  if (!hasSessionSecret(env)) {
    throw new Error("SESSION_SECRET must be set to a random value of at least 32 characters");
  }
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(env.SESSION_SECRET));
  return new Uint8Array(digest);
}

async function seal(env: Bindings, audience: string, payload: JWTPayload, ttl: number) {
  return new EncryptJWT(payload)
    .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
    .setIssuer(ISSUER)
    .setAudience(audience)
    .setIssuedAt()
    .setExpirationTime(`${ttl}s`)
    .encrypt(await deriveKey(env));
}

async function unseal<T>(env: Bindings, audience: string, token: string | undefined): Promise<T | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtDecrypt(token, await deriveKey(env), { issuer: ISSUER, audience });
    return payload as T;
  } catch {
    return null;
  }
}

const cookieOptions = (maxAge: number) =>
  ({ path: "/", secure: true, httpOnly: true, sameSite: "Lax", maxAge, prefix: "host" }) as const;

export async function writeCookie<T extends JWTPayload>(c: Context<AppEnv>, kind: "session" | "flow", data: T) {
  const [name, ttl] = kind === "session" ? [SESSION_COOKIE, SESSION_TTL] : [FLOW_COOKIE, FLOW_TTL];
  setCookie(c, name, await seal(c.env, kind, data, ttl), cookieOptions(ttl));
}

export function readCookie<T>(c: Context<AppEnv>, kind: "session" | "flow"): Promise<T | null> {
  const name = kind === "session" ? SESSION_COOKIE : FLOW_COOKIE;
  return unseal<T>(c.env, kind, getCookie(c, name, "host"));
}

export function clearCookie(c: Context<AppEnv>, kind: "session" | "flow") {
  const name = kind === "session" ? SESSION_COOKIE : FLOW_COOKIE;
  deleteCookie(c, name, { path: "/", secure: true, prefix: "host" });
}
