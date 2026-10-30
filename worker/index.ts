import Cloudflare from "cloudflare";
import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
import { mediaType } from "../shared/names";
import { api } from "./api";
import { HttpError } from "./errors";
import type { AppEnv } from "./env";
import { cloudflareAccess, sameOrigin } from "./guards";
import { auth } from "./oauth";

const app = new Hono<AppEnv>();

app.use(async (c, next) => {
  await next();
  const type = c.res.headers.get("content-type");
  const disposition = c.res.headers.get("content-disposition") ?? "";
  if (mediaType(type ?? undefined) === "application/pdf" && disposition.startsWith("inline")) {
    c.res.headers.set("Content-Security-Policy", "default-src 'none'; frame-ancestors 'self'");
    c.res.headers.set("X-Frame-Options", "SAMEORIGIN");
  }
});
app.use(
  secureHeaders({
    contentSecurityPolicy: { defaultSrc: ["'none'"], frameAncestors: ["'none'"], sandbox: [] },
    referrerPolicy: "no-referrer",
    crossOriginResourcePolicy: false,
  }),
);
app.use(cloudflareAccess);
app.use(sameOrigin);
app.use("*", async (c, next) => {
  await next();
  if (!c.res.headers.has("Cache-Control")) c.header("Cache-Control", "no-store");
});

app.route("/auth", auth);
app.route("/api", api);

app.notFound((c) => c.json({ error: "Not found" }, 404));

app.onError((error, c) => {
  if (error instanceof HttpError) {
    return c.json({ error: error.message }, error.status);
  }
  if (error instanceof SyntaxError) {
    return c.json({ error: "Invalid JSON body" }, 400);
  }
  if (error instanceof Cloudflare.APIError) {
    const status = error.status ?? 502;
    const errors = (error.errors ?? []) as { message?: string }[];
    const detail = errors.map((e) => e.message).filter(Boolean).join("; ") || error.message;
    const message = /<[a-z!]/i.test(detail) ? `Cloudflare API returned ${status}` : detail;
    if (status === 401) return c.json({ error: "Session expired" }, 401);
    return c.json({ error: message }, status >= 400 && status < 600 ? (status as 400) : 502);
  }
  console.error(error);
  return c.json({ error: "Internal error" }, 500);
});

export default app;
