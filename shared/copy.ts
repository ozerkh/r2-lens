import { COPY_LIMIT, REST_COPY_LIMIT } from "./capabilities";
import { baseName } from "./names";
import type { ObjectInfo } from "./types";

type Copyable = Pick<ObjectInfo, "key" | "size" | "customMetadata" | "httpMetadata" | "ssec">;

export function copyBlocker(object: Copyable, keepsMetadata: boolean): string | null {
  const name = baseName(object.key) || object.key;
  if (object.ssec) {
    return `${name} is encrypted with a customer key (SSE-C), so it cannot be copied here.`;
  }
  if (object.size > COPY_LIMIT) {
    return `${name} is larger than 5 GB, so it cannot be copied here.`;
  }
  if (keepsMetadata) return null;
  if (object.size > REST_COPY_LIMIT) {
    return `${name} is larger than 300 MB, the most the Cloudflare API can copy.`;
  }
  if (object.customMetadata && Object.keys(object.customMetadata).length > 0) {
    return `${name} has custom metadata, which the Cloudflare API cannot copy. Renaming it here would lose that metadata.`;
  }
  if (object.httpMetadata?.contentEncoding) {
    return `${name} is stored with Content-Encoding: ${object.httpMetadata.contentEncoding}, which the Cloudflare API cannot copy byte for byte.`;
  }
  return null;
}
