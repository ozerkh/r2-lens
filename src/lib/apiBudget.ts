import { useEffect, useState } from "react";
import {
  API_CALLS_HEADER,
  API_LIMIT,
  API_REFILL_PER_SECOND,
  API_REMAINING_HEADER,
  API_RESERVE,
} from "../../shared/capabilities";

const STORAGE_KEY = "r2-lens-api-level";
const POLL_MS = 2000;
const BUDGET = API_LIMIT - API_RESERVE;
const TOKEN_HINT = "Signing in with an API token avoids these calls.";

type Level = { remaining: number; at: number };

let saved: Level = { remaining: API_LIMIT, at: 0 };

function remainingNow() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) saved = JSON.parse(raw) as Level;
  } catch {}
  const refilled = ((Date.now() - saved.at) / 1000) * API_REFILL_PER_SECOND;
  return Math.min(API_LIMIT, saved.remaining + refilled);
}

function store(remaining: number) {
  saved = { remaining, at: Date.now() };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
  } catch {}
}

function recordApiCalls(count: number) {
  if (!(count > 0)) return;
  store(remainingNow() - count);
}

export function recordApiCallsFrom(headers: { get(name: string): string | null }) {
  const reported = headers.get(API_REMAINING_HEADER);
  if (reported !== null && Number.isFinite(Number(reported))) store(Number(reported));
  else recordApiCalls(Number(headers.get(API_CALLS_HEADER)));
}

function apiCallsAvailable() {
  return Math.floor(remainingNow()) - API_RESERVE;
}

function waitText(needed: number) {
  const seconds = Math.max(1, Math.ceil((needed - apiCallsAvailable()) / API_REFILL_PER_SECOND));
  return seconds < 60 ? `${seconds} s` : `${Math.ceil(seconds / 60)} min`;
}

export function apiBudgetError(needed: number, action: string) {
  const available = apiCallsAvailable();
  if (needed <= available) return null;
  const calls = `${action} needs about ${needed.toLocaleString("en")} Cloudflare API calls.`;
  const limit = `Cloudflare gives each user ${API_LIMIT.toLocaleString("en")} R2 API calls that refill at ${API_REFILL_PER_SECOND} per second, and blocks calls for 5 minutes once they run out`;
  if (needed > BUDGET) {
    return `${calls} ${limit}, so this app uses at most ${BUDGET} at a time. Do it in smaller parts. ${TOKEN_HINT}`;
  }
  return `${calls} ${Math.max(0, available)} are left right now. ${limit}. Try again in about ${waitText(needed)}. ${TOKEN_HINT}`;
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
}

async function waitForApiCall(signal?: AbortSignal) {
  while (apiCallsAvailable() < 1) {
    throwIfAborted(signal);
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

export async function reserveApiCall(signal?: AbortSignal) {
  await waitForApiCall(signal);
  throwIfAborted(signal);
  recordApiCalls(1);
}

export function useApiBudgetExhausted() {
  const [exhausted, setExhausted] = useState(() => apiCallsAvailable() < 1);
  useEffect(() => {
    const timer = setInterval(() => setExhausted(apiCallsAvailable() < 1), POLL_MS);
    return () => clearInterval(timer);
  }, []);
  return exhausted;
}
