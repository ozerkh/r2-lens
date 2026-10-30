import { Hono, type Context } from "hono";
import { CAPABILITIES, DELETE_BATCH, MAX_PART_SIZE, MAX_PARTS, SHARE_DURATIONS } from "../shared/capabilities";
import { baseName, BUCKET_NAME, BUCKET_NAME_RULE, mediaType } from "../shared/names";
import { copyBlocker } from "../shared/copy";
import {
  BINDINGS_ACCOUNT,
  JURISDICTIONS,
  type Backend,
  type BucketInfo,
  type BucketSettings,
  type Jurisdiction,
  type LocationHint,
  type Me,
  type ObjectListing,
  type StorageClass,
} from "../shared/types";
import { allowedAccounts, isReadOnly, r2Bindings, type AppEnv } from "./env";
import { HttpError, settle } from "./errors";
import { accountGuard, bindingsAllowed, loadSession } from "./guards";
import { cloudflare, objectStore, requestJurisdiction } from "./storage";
import { UnsatisfiableRange } from "./storage/types";

const DEFAULT_TYPE = "application/octet-stream";
const INLINE_TYPES = /^(image\/(png|jpeg|gif|webp|avif|bmp|x-icon)|video\/[\w.+-]+|audio\/[\w.+-]+|text\/plain|application\/pdf)$/;

type Ctx = Context<AppEnv>;

function scope(c: Ctx) {
  return { account_id: c.req.param("accountId")!, "cf-r2-jurisdiction": requestJurisdiction(c) };
}

function bucketName(c: Ctx) {
  return c.req.param("bucket")!;
}

function checkKey(key: string) {
  if (key === "." || key === "..") throw new HttpError(400, `Objects named ${key} cannot be opened here`);
  return key;
}

function objectKey(c: Ctx) {
  const key = c.req.query("key");
  if (!key) throw new HttpError(400, "Missing object key");
  return checkKey(key);
}

function contentLength(c: Ctx) {
  const value = Number(c.req.header("content-length"));
  return Number.isFinite(value) && value >= 0 ? value : undefined;
}

function cloudBackend(c: Ctx): Backend {
  return c.get("session")?.kind === "token" ? "s3" : "rest";
}

function toBucket(
  raw: { name?: string; creation_date?: string; location?: LocationHint; jurisdiction?: Jurisdiction; storage_class?: StorageClass },
  fallback: Jurisdiction,
  backend: Backend,
): BucketInfo {
  return {
    name: raw.name ?? "",
    creationDate: raw.creation_date,
    location: raw.location,
    jurisdiction: raw.jurisdiction ?? fallback,
    storageClass: raw.storage_class,
    backend,
  };
}

function contentDisposition(type: "inline" | "attachment", key: string) {
  const name = baseName(key) || "download";
  return `${type}; filename*=UTF-8''${encodeURIComponent(name)}`;
}

export const api = new Hono<AppEnv>();

api.use(loadSession);
api.use("/accounts/:accountId/*", accountGuard);
api.use(async (c, next) => {
  const reads = c.req.method === "GET" || c.req.method === "HEAD" || (c.req.method === "POST" && c.req.path.endsWith("/share"));
  if (isReadOnly(c.env) && !reads) {
    return c.json({ error: "This deployment is read-only" }, 403);
  }
  return next();
});

api.get("/me", async (c) => {
  const session = c.get("session");
  const cf = c.get("cf");
  const bindings = bindingsAllowed(c);
  if (!session && !bindings) return c.json({ error: "Not signed in" }, 401);

  const accounts: Me["accounts"] = [];
  if (cf) {
    const allowed = allowedAccounts(c.env);
    for await (const account of cf.accounts.list()) {
      if (allowed.length === 0 || allowed.includes(account.id)) accounts.push({ id: account.id, name: account.name });
    }
  }
  if (bindings) accounts.push({ id: BINDINGS_ACCOUNT, name: "Worker bindings" });

  const access = c.get("access");
  const user = session ? { id: session.userId, email: session.email } : { id: access?.email ?? "", email: access?.email ?? "" };
  const auth = session ? session.kind : access ? "access" : "local";
  const behindAccess = c.req.header("cf-access-jwt-assertion") !== undefined;
  return c.json<Me>({ user, auth, accounts, readOnly: isReadOnly(c.env), behindAccess });
});

api.get("/accounts/:accountId/buckets", async (c) => {
  if (c.req.param("accountId") === BINDINGS_ACCOUNT) {
    const buckets = r2Bindings(c.env).map(([name]) => ({ name, jurisdiction: "default" as const, backend: "binding" as const }));
    return c.json({ buckets });
  }
  const cf = cloudflare(c);
  const account_id = c.req.param("accountId");
  const backend = cloudBackend(c);
  const lists = await Promise.all(
    (["default", "eu"] as const).map(async (j) => {
      const result = await settle(cf.r2.buckets.list({ account_id, per_page: 1000, "cf-r2-jurisdiction": j }));
      return (result?.buckets ?? []).map((bucket) => toBucket(bucket, j, backend));
    }),
  );
  const buckets = lists.flat().sort((a, b) => a.name.localeCompare(b.name));
  return c.json({ buckets });
});

api.post("/accounts/:accountId/buckets", async (c) => {
  const cf = cloudflare(c);
  const body = await c.req.json<{
    name: string;
    locationHint?: LocationHint;
    storageClass?: StorageClass;
    jurisdiction?: Jurisdiction;
  }>();
  if (!BUCKET_NAME.test(body.name ?? "")) throw new HttpError(400, BUCKET_NAME_RULE);
  const j = body.jurisdiction && JURISDICTIONS.includes(body.jurisdiction) ? body.jurisdiction : "default";
  const bucket = await cf.r2.buckets.create({
    account_id: c.req.param("accountId"),
    name: body.name,
    locationHint: body.locationHint,
    storageClass: body.storageClass,
    "cf-r2-jurisdiction": j,
  });
  return c.json(toBucket(bucket, j, cloudBackend(c)), 201);
});

api.delete("/accounts/:accountId/buckets/:bucket", async (c) => {
  await cloudflare(c).r2.buckets.delete(bucketName(c), scope(c));
  return c.json({ ok: true });
});

api.get("/accounts/:accountId/buckets/:bucket/settings", async (c) => {
  const cf = cloudflare(c);
  const name = bucketName(c);
  const params = scope(c);
  const [bucket, cors, lifecycle, locks, managed, custom] = await Promise.all([
    cf.r2.buckets.get(name, params),
    settle(cf.r2.buckets.cors.get(name, params)),
    settle(cf.r2.buckets.lifecycle.get(name, params)),
    settle(cf.r2.buckets.locks.get(name, params)),
    settle(cf.r2.buckets.domains.managed.list(name, params)),
    settle(cf.r2.buckets.domains.custom.list(name, params)),
  ]);
  return c.json<BucketSettings>({
    bucket: toBucket(bucket, params["cf-r2-jurisdiction"], cloudBackend(c)),
    cors: cors?.rules ?? null,
    lifecycle: lifecycle?.rules ?? null,
    locks: locks?.rules ?? null,
    managedDomain: managed ? { domain: managed.domain, enabled: managed.enabled } : null,
    customDomains: (custom?.domains ?? []).map((d) => ({
      domain: d.domain,
      enabled: d.enabled,
      status: d.status?.ownership,
    })),
  });
});

api.get("/accounts/:accountId/buckets/:bucket/public-url", async (c) => {
  if (c.req.param("accountId") === BINDINGS_ACCOUNT) return c.json({ url: null });
  const cf = cloudflare(c);
  const name = bucketName(c);
  const params = scope(c);
  const [managed, custom] = await Promise.all([
    settle(cf.r2.buckets.domains.managed.list(name, params)),
    settle(cf.r2.buckets.domains.custom.list(name, params)),
  ]);
  const domain =
    custom?.domains?.find((d) => d.enabled && d.status?.ownership === "active")?.domain ??
    (managed?.enabled ? managed.domain : undefined);
  return c.json({ url: domain ? `https://${domain}` : null });
});

api.patch("/accounts/:accountId/buckets/:bucket", async (c) => {
  const { storageClass } = await c.req.json<{ storageClass: StorageClass }>();
  const bucket = await cloudflare(c).r2.buckets.edit(bucketName(c), { ...scope(c), storage_class: storageClass });
  return c.json(toBucket(bucket, requestJurisdiction(c), cloudBackend(c)));
});

async function rulesFrom(c: Ctx) {
  const { rules } = await c.req.json<{ rules: unknown }>();
  if (!Array.isArray(rules)) throw new HttpError(400, "rules must be an array");
  return rules;
}

api.put("/accounts/:accountId/buckets/:bucket/cors", async (c) => {
  const cors = cloudflare(c).r2.buckets.cors;
  const rules = await rulesFrom(c);
  if (rules.length === 0) await cors.delete(bucketName(c), scope(c));
  else await cors.update(bucketName(c), { ...scope(c), rules });
  return c.json({ ok: true });
});

api.put("/accounts/:accountId/buckets/:bucket/lifecycle", async (c) => {
  const lifecycle = cloudflare(c).r2.buckets.lifecycle;
  await lifecycle.update(bucketName(c), { ...scope(c), rules: await rulesFrom(c) });
  return c.json({ ok: true });
});

api.put("/accounts/:accountId/buckets/:bucket/locks", async (c) => {
  const locks = cloudflare(c).r2.buckets.locks;
  await locks.update(bucketName(c), { ...scope(c), rules: await rulesFrom(c) });
  return c.json({ ok: true });
});

api.put("/accounts/:accountId/buckets/:bucket/public-access", async (c) => {
  const managed = cloudflare(c).r2.buckets.domains.managed;
  const { enabled } = await c.req.json<{ enabled: boolean }>();
  const result = await managed.update(bucketName(c), { ...scope(c), enabled: Boolean(enabled) });
  return c.json({ domain: result.domain, enabled: result.enabled });
});

api.get("/accounts/:accountId/buckets/:bucket/objects", async (c) => {
  const store = await objectStore(c);
  const listing = await store.list({
    prefix: c.req.query("prefix"),
    cursor: c.req.query("cursor"),
    recursive: c.req.query("recursive") === "1",
    perPage: Math.min(Math.max(Number(c.req.query("perPage") ?? 200), 1), 1000),
  });
  return c.json<ObjectListing>(listing);
});

async function getObject(c: Ctx) {
  const key = objectKey(c);
  const store = await objectStore(c);
  let stored;
  try {
    stored = await store.get(key, c.req.header("range"));
  } catch (error) {
    if (!(error instanceof UnsatisfiableRange)) throw error;
    return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${error.size}` } });
  }
  if (!stored) throw new HttpError(404, "Object not found");

  const wantsInline = c.req.query("inline") === "1";
  const type = wantsInline && key.toLowerCase().endsWith(".pdf") ? "application/pdf" : (stored.contentType ?? DEFAULT_TYPE);
  const inline = wantsInline && INLINE_TYPES.test(mediaType(type));

  const headers = new Headers({
    "Content-Type": inline ? type : DEFAULT_TYPE,
    "Content-Disposition": contentDisposition(inline ? "inline" : "attachment", key),
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "private, max-age=180",
    "Cross-Origin-Resource-Policy": "same-origin",
  });
  if (stored.etag) headers.set("ETag", stored.etag);
  if (stored.lastModified) headers.set("Last-Modified", stored.lastModified);

  if (stored.contentEncoding) {
    headers.set("Content-Encoding", stored.contentEncoding);
    return new Response(stored.body, { status: 200, headers, encodeBody: "manual" });
  }
  if (!Number.isFinite(stored.size)) return new Response(stored.body, { status: 200, headers });

  headers.set("Accept-Ranges", "bytes");
  if (!stored.range) {
    headers.set("Content-Length", String(stored.size));
    return new Response(stored.body, { status: 200, headers });
  }
  const { start, end } = stored.range;
  headers.set("Content-Range", `bytes ${start}-${end}/${stored.size}`);
  headers.set("Content-Length", String(end - start + 1));
  return new Response(stored.body, { status: 206, headers });
}

api.get("/accounts/:accountId/buckets/:bucket/object", getObject);
api.get("/accounts/:accountId/buckets/:bucket/object/:filename", getObject);

api.put("/accounts/:accountId/buckets/:bucket/object", async (c) => {
  const store = await objectStore(c);
  const storageClass = c.req.query("storageClass") === "InfrequentAccess" ? "InfrequentAccess" : undefined;
  await store.put(objectKey(c), c.req.raw.body, {
    contentType: c.req.header("content-type") || DEFAULT_TYPE,
    length: contentLength(c),
    storageClass,
  });
  return c.json({ key: objectKey(c) }, 201);
});

api.post("/accounts/:accountId/buckets/:bucket/share", async (c) => {
  const { key, expiresIn } = await c.req.json<{ key: string; expiresIn: number }>();
  if (!key) throw new HttpError(400, "Missing object key");
  checkKey(key);
  if (!SHARE_DURATIONS.some((d) => d.seconds === expiresIn)) throw new HttpError(400, "Unsupported link duration");
  const store = await objectStore(c);
  if (!store.presign) throw new HttpError(400, "Share links need an API token sign-in");
  if (!(await store.head(key))) throw new HttpError(404, "Object not found");
  return c.json({ url: await store.presign(key, expiresIn), expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString() });
});

api.post("/accounts/:accountId/buckets/:bucket/folders", async (c) => {
  const { key } = await c.req.json<{ key: string }>();
  if (!key || !key.endsWith("/")) throw new HttpError(400, "Folder key must end with /");
  checkKey(key);
  await (await objectStore(c)).put(key, null, { contentType: DEFAULT_TYPE, length: 0 });
  return c.json({ key }, 201);
});

api.post("/accounts/:accountId/buckets/:bucket/delete", async (c) => {
  const { keys } = await c.req.json<{ keys: string[] }>();
  if (!Array.isArray(keys) || keys.length === 0) throw new HttpError(400, "keys must be a non-empty array");
  if (keys.length > DELETE_BATCH) throw new HttpError(413, `At most ${DELETE_BATCH} keys per request`);
  keys.forEach(checkKey);
  return c.json(await (await objectStore(c)).delete(keys));
});

api.post("/accounts/:accountId/buckets/:bucket/copy", async (c) => {
  const { from, to, move } = await c.req.json<{ from: string; to: string; move?: boolean }>();
  if (!from || !to || from === to) throw new HttpError(400, "Source and destination must differ");
  checkKey(from);
  checkKey(to);
  const store = await objectStore(c);

  const [source, existing] = await Promise.all([store.head(from), store.head(to)]);
  if (!source) throw new HttpError(404, `${from} no longer exists`);
  if (existing) throw new HttpError(409, `${baseName(to)} already exists`);
  const blocker = copyBlocker(source, CAPABILITIES[store.backend].keepsMetadata);
  if (blocker) throw new HttpError(422, blocker);

  const written = await store.copy(source, to);
  if (written !== source.size) {
    await store.delete([to]).catch(() => undefined);
    throw new HttpError(502, `Copy of ${from} was incomplete, the original was left untouched`);
  }
  if (move) {
    const removed = await store.delete([from]);
    if (removed.failed.length) throw new HttpError(502, `Copied to ${to}, but ${from} could not be removed`);
  }
  return c.json({ key: to });
});

async function multipartStore(c: Ctx) {
  const store = await objectStore(c);
  if (!store.multipart) throw new HttpError(400, "This bucket does not support multipart uploads");
  return store.multipart;
}

api.post("/accounts/:accountId/buckets/:bucket/uploads", async (c) => {
  const { contentType } = await c.req.json<{ contentType?: string }>();
  const uploadId = await (await multipartStore(c)).create(objectKey(c), contentType || DEFAULT_TYPE);
  return c.json({ uploadId }, 201);
});

api.put("/accounts/:accountId/buckets/:bucket/uploads/:uploadId/parts/:partNumber", async (c) => {
  const partNumber = Number(c.req.param("partNumber"));
  if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > MAX_PARTS) {
    throw new HttpError(400, `Part numbers go from 1 to ${MAX_PARTS}`);
  }
  const length = contentLength(c);
  if (length === undefined || !c.req.raw.body) throw new HttpError(411, "Content-Length is required");
  if (length > MAX_PART_SIZE) throw new HttpError(413, "Part is too large");
  const etag = await (await multipartStore(c)).uploadPart(objectKey(c), c.req.param("uploadId"), partNumber, c.req.raw.body, length);
  return c.json({ etag });
});

api.post("/accounts/:accountId/buckets/:bucket/uploads/:uploadId/complete", async (c) => {
  const { parts } = await c.req.json<{ parts: { partNumber: number; etag: string }[] }>();
  if (!Array.isArray(parts) || parts.length === 0) throw new HttpError(400, "parts must be a non-empty array");
  const sorted = [...parts].sort((a, b) => a.partNumber - b.partNumber);
  await (await multipartStore(c)).complete(objectKey(c), c.req.param("uploadId"), sorted);
  return c.json({ key: objectKey(c) });
});

api.delete("/accounts/:accountId/buckets/:bucket/uploads/:uploadId", async (c) => {
  await (await multipartStore(c)).abort(objectKey(c), c.req.param("uploadId"));
  return c.json({ ok: true });
});
