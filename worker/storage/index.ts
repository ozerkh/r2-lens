import type { Context } from "hono";
import { BINDINGS_ACCOUNT, JURISDICTIONS, type Jurisdiction } from "../../shared/types";
import { r2Bindings, type AppEnv } from "../env";
import { HttpError } from "../errors";
import { bindingStore } from "./binding";
import { restStore } from "./rest";
import { credentialsFromToken, s3Endpoint, s3Store } from "./s3";
import type { ObjectStore } from "./types";

export function requestJurisdiction(c: Context<AppEnv>): Jurisdiction {
  const value = c.req.query("jurisdiction") as Jurisdiction | undefined;
  return value && JURISDICTIONS.includes(value) ? value : "default";
}

export function cloudflare(c: Context<AppEnv>) {
  if (c.req.param("accountId") === BINDINGS_ACCOUNT) {
    throw new HttpError(400, "This is not available for buckets bound to the Worker");
  }
  const cf = c.get("cf");
  if (!cf) throw new HttpError(401, "Not signed in");
  return cf;
}

export async function objectStore(c: Context<AppEnv>): Promise<ObjectStore> {
  const accountId = c.req.param("accountId")!;
  const bucket = c.req.param("bucket")!;
  if (accountId === BINDINGS_ACCOUNT) {
    const binding = r2Bindings(c.env).find(([name]) => name === bucket)?.[1];
    if (!binding) throw new HttpError(404, `No R2 binding named ${bucket}`);
    return bindingStore(binding);
  }

  const jurisdiction = requestJurisdiction(c);
  const rest = restStore(cloudflare(c), accountId, bucket, jurisdiction);
  const session = c.get("session");
  if (session?.kind !== "token" || !session.tokenId) return rest;
  const credentials = await credentialsFromToken(session.tokenId, session.accessToken);
  return s3Store(rest, s3Endpoint(accountId, jurisdiction), bucket, credentials);
}
