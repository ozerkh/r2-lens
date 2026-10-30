export const BUCKET_NAME = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;
export const BUCKET_NAME_RULE = "Use 3-63 lowercase letters, numbers or hyphens";

export const LOCAL_HOSTS = ["localhost", "127.0.0.1", "[::1]"];

export function baseName(key: string) {
  const trimmed = key.endsWith("/") ? key.slice(0, -1) : key;
  return trimmed.slice(trimmed.lastIndexOf("/") + 1);
}

export function mediaType(contentType: string | undefined) {
  return (contentType ?? "").split(";")[0].trim().toLowerCase();
}
