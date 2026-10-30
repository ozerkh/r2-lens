export const JURISDICTIONS = ["default", "eu", "us", "fedramp", "fedramp-high"] as const;
export type Jurisdiction = (typeof JURISDICTIONS)[number];
export type StorageClass = "Standard" | "InfrequentAccess";
export type LocationHint = "apac" | "eeur" | "enam" | "weur" | "wnam" | "oc";

export type Backend = "rest" | "s3" | "binding";
type AuthKind = "oauth" | "token" | "access" | "local";

export const BINDINGS_ACCOUNT = "bindings";

export type Account = { id: string; name: string };

export type Me = {
  user: { id: string; email: string };
  auth: AuthKind;
  accounts: Account[];
  readOnly: boolean;
  behindAccess: boolean;
};

export type Config = {
  allowedAccounts: boolean;
  tokenLogin: boolean;
  oauthRefresh: boolean;
  bindings: number;
  access: boolean;
  readOnly: boolean;
  sessionSecret: boolean;
};

export type OAuthState = "ready" | "missing" | "broken";

export type SetupStatus = {
  ready: boolean;
  oauth: OAuthState;
  tokenLogin: boolean;
  missing: string[];
  redirectUri: string;
  scopes: string[];
  clientProblem?: { error: string; description: string };
  config: Config;
};

export type BucketInfo = {
  name: string;
  creationDate?: string;
  location?: LocationHint;
  jurisdiction: Jurisdiction;
  storageClass?: StorageClass;
  backend: Backend;
};

export type HttpMetadata = {
  contentType?: string;
  contentLanguage?: string;
  contentDisposition?: string;
  contentEncoding?: string;
  cacheControl?: string;
  cacheExpiry?: string;
};

export type ObjectInfo = {
  key: string;
  size: number;
  etag?: string;
  lastModified?: string;
  storageClass?: StorageClass;
  httpMetadata?: HttpMetadata;
  customMetadata?: Record<string, string>;
  ssec?: boolean;
};

export type ObjectListing = {
  objects: ObjectInfo[];
  prefixes: string[];
  cursor: string | null;
};

export type BucketSettings = {
  bucket: BucketInfo;
  cors: unknown[] | null;
  lifecycle: unknown[] | null;
  locks: unknown[] | null;
  managedDomain: { domain: string; enabled: boolean } | null;
  customDomains: { domain: string; enabled: boolean; status?: string }[];
};

export type BatchResult = {
  succeeded: string[];
  failed: { key: string; error: string }[];
};
