import type { Backend } from "./types";

const MIB = 1024 * 1024;

const SINGLE_UPLOAD_LIMIT = 100 * MIB;
const MIN_PART_SIZE = 25 * MIB;
export const MAX_PART_SIZE = 95 * MIB;
export const MAX_PARTS = 10_000;
export const COPY_LIMIT = 5 * 1024 ** 3;
export const REST_COPY_LIMIT = 300 * MIB;
export const REST_RANGE_SKIP_LIMIT = 32 * MIB;

export const DELETE_BATCH = 50;

export const SHARE_DURATIONS = [
  { seconds: 60 * 60, label: "1 hour" },
  { seconds: 24 * 60 * 60, label: "1 day" },
  { seconds: 7 * 24 * 60 * 60, label: "7 days" },
];

export const API_CALLS_HEADER = "X-Cloudflare-Api-Calls";
export const API_REMAINING_HEADER = "X-Cloudflare-Api-Remaining";
export const API_LIMIT = 1200;
const API_WINDOW_MS = 5 * 60 * 1000;
export const API_RESERVE = 300;
export const API_REFILL_PER_SECOND = API_LIMIT / (API_WINDOW_MS / 1000);

const REST_CALLS_PER_OBJECT = { delete: 1, move: 5 };

export function apiCallsFor(backend: Backend, operation: keyof typeof REST_CALLS_PER_OBJECT, objects: number) {
  return CAPABILITIES[backend].usesApiBudget ? REST_CALLS_PER_OBJECT[operation] * objects : 0;
}

type Capabilities = {
  usesApiBudget: boolean;
  multipart: boolean;
  keepsMetadata: boolean;
  bucketSettings: boolean;
  shareLinks: boolean;
};

export const CAPABILITIES: Record<Backend, Capabilities> = {
  rest: { usesApiBudget: true, multipart: false, keepsMetadata: false, bucketSettings: true, shareLinks: false },
  s3: { usesApiBudget: false, multipart: true, keepsMetadata: true, bucketSettings: true, shareLinks: true },
  binding: { usesApiBudget: false, multipart: true, keepsMetadata: true, bucketSettings: false, shareLinks: false },
};

export function uploadLimit(backend: Backend) {
  return CAPABILITIES[backend].multipart ? MAX_PART_SIZE * MAX_PARTS : SINGLE_UPLOAD_LIMIT;
}

export function usesParts(backend: Backend, size: number) {
  return CAPABILITIES[backend].multipart && size > 2 * MIN_PART_SIZE;
}

export function partSizeFor(size: number) {
  return Math.max(MIN_PART_SIZE, Math.ceil(size / MAX_PARTS / MIB) * MIB);
}
