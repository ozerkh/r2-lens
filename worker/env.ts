import { LOCAL_HOSTS } from "../shared/names";
import type Cloudflare from "cloudflare";

export type Bindings = Env & {
  SESSION_SECRET: string;
  CF_OAUTH_CLIENT_ID: string;
  CF_OAUTH_CLIENT_SECRET?: string;
  CF_OAUTH_REFRESH?: string;
  TOKEN_LOGIN?: string;
  READ_ONLY?: string;
  ALLOWED_ACCOUNT_IDS?: string;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
};

export type Session = {
  kind: "oauth" | "token";
  accessToken: string;
  refreshToken?: string;
  tokenId?: string;
  expiresAt: number;
  userId: string;
  email: string;
};

export type AppEnv = {
  Bindings: Bindings;
  Variables: {
    session?: Session;
    cf?: Cloudflare;
    access?: { email?: string };
    apiCalls: { count: number; remaining?: number };
  };
};

export const isReadOnly = (env: Bindings) => env.READ_ONLY === "true";

export const tokenLoginEnabled = (env: Bindings) => env.TOKEN_LOGIN !== "false";

export function allowedAccounts(env: Bindings): string[] {
  return (env.ALLOWED_ACCOUNT_IDS ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
}

function isR2Bucket(value: unknown): value is R2Bucket {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<R2Bucket>;
  return typeof candidate.createMultipartUpload === "function" && typeof candidate.head === "function";
}

export function r2Bindings(env: Bindings): [string, R2Bucket][] {
  return Object.entries(env as unknown as Record<string, unknown>)
    .filter((entry): entry is [string, R2Bucket] => isR2Bucket(entry[1]))
    .sort(([a], [b]) => a.localeCompare(b));
}


const LOOPBACK_IPS = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
const PROXY_HEADERS = ["x-forwarded-for", "x-real-ip", "forwarded", "true-client-ip"];

export function isLocalRequest(request: Request) {
  if (!LOCAL_HOSTS.includes(new URL(request.url).hostname)) return false;
  const clientIp = request.headers.get("cf-connecting-ip");
  if (clientIp !== null && !LOOPBACK_IPS.has(clientIp)) return false;
  return !PROXY_HEADERS.some((name) => request.headers.has(name));
}
