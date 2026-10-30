import Cloudflare from "cloudflare";
import { Hono } from "hono";
import { allowedAccounts, tokenLoginEnabled, type AppEnv, type Session } from "./env";
import { settle } from "./errors";
import { SESSION_TTL, writeCookie } from "./session";

async function accountIds(cf: Cloudflare) {
  const ids: string[] = [];
  try {
    for await (const account of cf.accounts.list()) ids.push(account.id);
  } catch {}
  return ids;
}

async function verifiedTokenId(cf: Cloudflare, accounts: string[]) {
  const user = await settle(cf.user.tokens.verify());
  if (user?.status === "active") return user.id;
  for (const account_id of accounts) {
    const owned = await settle(cf.accounts.tokens.verify({ account_id }));
    if (owned?.status === "active") return owned.id;
  }
  return null;
}

export const tokenLogin = new Hono<AppEnv>();

tokenLogin.post("/", async (c) => {
  if (!tokenLoginEnabled(c.env)) return c.json({ error: "Signing in with an API token is turned off" }, 403);
  const body = await c.req.json<{ token?: unknown }>();
  const value = typeof body.token === "string" ? body.token.trim() : "";
  if (!/^[\w-]{20,200}$/.test(value)) return c.json({ error: "That does not look like a Cloudflare API token" }, 400);

  const cf = new Cloudflare({ apiToken: value, maxRetries: 0 });
  const accounts = await accountIds(cf);
  const tokenId = await verifiedTokenId(cf, accounts);
  if (!tokenId) return c.json({ error: "Cloudflare did not accept this token, or it is not active" }, 400);
  if (accounts.length === 0) return c.json({ error: "This token cannot see any account. Add Account Settings Read." }, 400);

  const allowed = allowedAccounts(c.env);
  if (allowed.length > 0 && !accounts.some((id) => allowed.includes(id))) {
    return c.json({ error: "None of this token's accounts are allowed on this deployment" }, 403);
  }

  const user = await settle(cf.user.get());
  const session: Session = {
    kind: "token",
    accessToken: value,
    tokenId,
    expiresAt: Date.now() + SESSION_TTL * 1000,
    userId: user?.id ?? tokenId,
    email: (user as { email?: string } | null)?.email ?? "",
  };
  await writeCookie(c, "session", session);
  return c.json({ ok: true });
});
