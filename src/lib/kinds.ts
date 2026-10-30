import {
  FileArchiveIcon,
  FileAudioIcon,
  FileCodeIcon,
  FileIcon,
  FileImageIcon,
  FilePdfIcon,
  FileTextIcon,
  FileVideoIcon,
  type Icon,
} from "@phosphor-icons/react";
import { mediaType } from "../../shared/names";
import type { ObjectInfo } from "../../shared/types";
import { extension } from "./format";

type FileKind = "image" | "video" | "audio" | "pdf" | "text" | "code" | "archive" | "other";

const BY_EXTENSION: Record<string, FileKind> = {};
const register = (kind: FileKind, list: string) => list.split(" ").forEach((ext) => (BY_EXTENSION[ext] = kind));

register("image", "png jpg jpeg gif webp avif bmp ico svg heic tiff");
register("video", "mp4 webm mov mkv avi m4v ogv");
register("audio", "mp3 wav ogg oga flac m4a aac opus");
register("pdf", "pdf");
register("text", "txt md markdown csv tsv log ini cfg conf env");
register("code", "json jsonc xml yaml yml toml js mjs cjs ts tsx jsx css scss html htm py go rs rb php java kt swift c h cpp hpp cs sh bash zsh sql graphql vue svelte");
register("archive", "zip tar gz tgz bz2 xz 7z rar zst");

const PREVIEW_IMAGE = new Set(["png", "jpg", "jpeg", "gif", "webp", "avif", "bmp", "ico"]);
const PREVIEW_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/avif",
  "image/bmp",
  "image/x-icon",
  "image/vnd.microsoft.icon",
]);

export function kindOf(object: Pick<ObjectInfo, "key" | "httpMetadata">): FileKind {
  const fromExt = BY_EXTENSION[extension(object.key)];
  if (fromExt) return fromExt;
  const type = object.httpMetadata?.contentType ?? "";
  if (type.startsWith("image/")) return "image";
  if (type.startsWith("video/")) return "video";
  if (type.startsWith("audio/")) return "audio";
  if (type === "application/pdf") return "pdf";
  if (type.startsWith("text/")) return "text";
  if (type === "application/json") return "code";
  return "other";
}

export function isSvg(object: Pick<ObjectInfo, "key" | "httpMetadata">) {
  const type = mediaType(object.httpMetadata?.contentType);
  return extension(object.key) === "svg" || type === "image/svg+xml";
}

export function canThumbnail(object: ObjectInfo) {
  const type = mediaType(object.httpMetadata?.contentType);
  const renderable = PREVIEW_IMAGE.has(extension(object.key)) || PREVIEW_IMAGE_TYPES.has(type);
  return kindOf(object) === "image" && renderable && object.size < 15 * 1024 * 1024;
}

export const KIND_ICONS: Record<FileKind, Icon> = {
  image: FileImageIcon,
  video: FileVideoIcon,
  audio: FileAudioIcon,
  pdf: FilePdfIcon,
  text: FileTextIcon,
  code: FileCodeIcon,
  archive: FileArchiveIcon,
  other: FileIcon,
};

export function guessContentType(file: File) {
  if (file.type) return file.type;
  const ext = extension(file.name);
  const map: Record<string, string> = {
    md: "text/markdown",
    json: "application/json",
    yaml: "application/yaml",
    yml: "application/yaml",
    toml: "application/toml",
    ts: "text/plain",
    tsx: "text/plain",
    avif: "image/avif",
    webp: "image/webp",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    svg: "image/svg+xml",
    mp4: "video/mp4",
    webm: "video/webm",
    mp3: "audio/mpeg",
    pdf: "application/pdf",
    zip: "application/zip",
    gz: "application/gzip",
    tar: "application/x-tar",
    csv: "text/csv",
    txt: "text/plain",
    log: "text/plain",
    css: "text/css",
    html: "text/html",
    js: "text/javascript",
  };
  return map[ext] ?? "application/octet-stream";
}
