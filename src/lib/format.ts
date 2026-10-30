import { baseName } from "../../shared/names";
const UNITS = ["B", "KB", "MB", "GB", "TB", "PB"];

export function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), UNITS.length - 1);
  const value = bytes / 1024 ** exponent;
  return `${value.toFixed(value >= 10 || exponent === 0 ? 0 : 1)} ${UNITS[exponent]}`;
}

const dateFormat = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" });

export function formatDate(value?: string) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : dateFormat.format(date);
}

export function parentPrefix(key: string) {
  const trimmed = key.endsWith("/") ? key.slice(0, -1) : key;
  const index = trimmed.lastIndexOf("/");
  return index === -1 ? "" : trimmed.slice(0, index + 1);
}

export function extension(key: string) {
  const name = baseName(key);
  const index = name.lastIndexOf(".");
  return index > 0 ? name.slice(index + 1).toLowerCase() : "";
}

export const STORAGE_CLASS_ITEMS = [
  { value: "Standard", label: "Standard" },
  { value: "InfrequentAccess", label: "Infrequent Access" },
];

export function plural(count: number, noun: string) {
  return `${count.toLocaleString("en")} ${noun}${count === 1 ? "" : "s"}`;
}
